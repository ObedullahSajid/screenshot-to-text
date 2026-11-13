import { cleanOutput } from './clean';
import { PSM_MODES, recognizeOnce, type OcrProgress, type PsmMode } from './ocr/engine';
import { rebuildLayout, type LayoutResult } from './layout/rebuild';
import type { OcrPage } from './ocr/types';
import {
  prepareImage,
  loadImage,
  makeThumbnail,
  type ImageQuality,
  type PreparedImage,
} from './preprocess';
import { countTextTokens, estimateImageTokens } from './tokens';
import { stitchTiles } from './fullpage';

export interface PipelineOptions {
  compact: boolean;
  maxWidth: number;
}

export const NEUTRAL_QUALITY: ImageQuality = {
  sharpness: 0,
  blurry: false,
  contrast: 0,
  lowContrast: false,
  contrastBoosted: false,
};

export interface PipelineOutput {
  markdown: string;
  rawText: string;
  thumb: string;
  tokens: number;
  imageTokens: number;
  stats: LayoutResult['stats'];
  width: number;
  height: number;
  inverted: boolean;
  quality: ImageQuality;
  /** How many recognition passes ran (2 = a retry produced the chosen result). */
  passes: number;
}

/** One captured tile of a full-page capture. */
export interface TiledInput {
  dataUrl: string;
  /** Actual scroll offset of this tile, in CSS pixels. */
  offset: number;
}

export interface TiledCapture {
  tiles: TiledInput[];
  /** Device pixel ratio the tiles were captured at. */
  dpr: number;
  /** Full page height in CSS pixels. */
  scrollHeight: number;
  /** Viewport width in CSS pixels. */
  viewportWidth: number;
}

interface Candidate {
  page: OcrPage;
  layout: LayoutResult;
  markdown: string;
  score: number;
}

interface Recognition extends Candidate {
  passes: number;
}

/**
 * A screenshot whose layout confuses Tesseract still contains readable text.
 * Instead of trusting one pass, retry once with a different layout mode and
 * keep whichever result looks structurally better. This never runs on a
 * confident capture, so the common case pays nothing.
 */
export async function runPipeline(
  source: Blob | string,
  options: PipelineOptions,
  onProgress: OcrProgress,
): Promise<PipelineOutput> {
  onProgress('Preparing image', 0.03);

  const image = await loadImage(source);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  const prepared = prepareImage(image, options.maxWidth);
  const best = await recognizeBest(prepared, options, onProgress, 0.08, 0.8);

  onProgress('Counting tokens', 0.97);
  const tokens = await countTextTokens(best.markdown);
  const thumb = await makeThumbnail(source);

  onProgress('Done', 1);

  return {
    markdown: best.markdown,
    rawText: (best.page.text ?? '').trim(),
    thumb,
    tokens,
    imageTokens: estimateImageTokens(width, height),
    stats: best.layout.stats,
    width,
    height,
    inverted: prepared.inverted,
    quality: prepared.quality,
    passes: best.passes,
  };
}

/**
 * Recognises a scroll capture: every tile is read on its own, then the OCR
 * lines are stitched together in page coordinates and the layout is rebuilt
 * once. Recognising each tile separately is what makes the overlap usable —
 * Tesseract never sees a tile boundary inside a word.
 */
export async function runTiledPipeline(
  capture: TiledCapture,
  options: PipelineOptions,
  onProgress: OcrProgress,
  isCancelled: () => boolean = () => false,
): Promise<PipelineOutput> {
  const { tiles } = capture;
  if (!tiles.length) throw new Error('No tiles were captured.');

  const recognitions: Array<{
    page: OcrPage;
    offset: number;
    scale: number;
    index: number;
  }> = [];
  let passes = 1;
  let quality = NEUTRAL_QUALITY;
  let inverted = false;
  let width = 0;
  let thumb: PageThumb | null = null;

  for (let index = 0; index < tiles.length; index++) {
    if (isCancelled()) throw new Error('Cancelled.');
    const tile = tiles[index];
    const label = `Reading tile ${index + 1} of ${tiles.length}`;
    onProgress(label, 0.04 + (index / tiles.length) * 0.82);

    const image = await loadImage(tile.dataUrl);
    // Build the preview before the image goes out of scope, so a 24-tile page
    // never holds 24 decoded screenshots in memory at once.
    if (!thumb) thumb = createPageThumb(capture, image);
    drawTileIntoThumb(thumb, image, tile.offset, capture.dpr);

    const prepared = prepareImage(image, options.maxWidth);
    const best = await recognizeBest(
      prepared,
      options,
      (stage, progress) =>
        // Keep the tile number visible even while Tesseract reports its own
        // stage, otherwise the panel jumps between "Reading text" and blanks.
        onProgress(`${label} · ${stage}`, 0.04 + ((index + progress) / tiles.length) * 0.82),
      0,
      1,
    );

    if (index === 0) {
      quality = prepared.quality;
      inverted = prepared.inverted;
      width = image.naturalWidth;
    }
    passes = Math.max(passes, best.passes);
    recognitions.push({
      page: best.page,
      offset: tile.offset,
      scale: prepared.scale,
      index,
    });
  }

  if (isCancelled()) throw new Error('Cancelled.');

  onProgress('Stitching tiles', 0.9);
  const stitched = stitchTiles(
    recognitions.map((entry) => ({
      page: entry.page,
      offset: entry.offset,
      dpr: capture.dpr,
      scale: entry.scale,
      index: entry.index,
    })),
  );

  onProgress('Rebuilding layout', 0.93);
  const page = stitched.page;
  const layout = rebuildLayout(page);
  const markdown = cleanOutput(layout.markdown, { compact: options.compact });

  onProgress('Counting tokens', 0.97);
  const tokens = await countTextTokens(markdown);
  const thumbUrl = thumb ? thumb.canvas.toDataURL('image/jpeg', 0.72) : '';

  onProgress('Done', 1);

  return {
    markdown,
    rawText: (page.text ?? '').trim(),
    thumb: thumbUrl,
    tokens,
    imageTokens: estimateImageTokens(
      Math.max(1, Math.round(capture.viewportWidth * capture.dpr)),
      Math.max(1, Math.round(capture.scrollHeight * capture.dpr)),
    ),
    stats: layout.stats,
    width: Math.max(1, Math.round(width || capture.viewportWidth * capture.dpr)),
    height: Math.max(1, Math.round(capture.scrollHeight * capture.dpr)),
    inverted,
    quality,
    passes,
  };
}

/**
 * Runs the auto pass and, only when the result is unconvincing, one retry with
 * a different layout mode. Progress is reported inside [base, base + span].
 */
async function recognizeBest(
  prepared: PreparedImage,
  options: PipelineOptions,
  onProgress: OcrProgress,
  base: number,
  span: number,
): Promise<Recognition> {
  const first = await recognizeOnce(prepared.canvas, PSM_MODES.auto, (stage, progress) =>
    onProgress(stage, base + progress * span * 0.68),
  );
  let best = evaluate(first, options);
  let passes = 1;

  if (needsSecondPass(best)) {
    const mode: PsmMode = best.layout.stats.words === 0 ? PSM_MODES.sparse : PSM_MODES.block;
    onProgress(
      mode === PSM_MODES.sparse ? 'Re-reading (sparse layout)' : 'Re-reading (dense layout)',
      base + span * 0.7,
    );
    const second = await recognizeOnce(prepared.canvas, mode, (stage, progress) =>
      onProgress(stage, base + span * 0.7 + progress * span * 0.3),
    );
    passes = 2;
    const alternative = evaluate(second, options);
    // The retry has to be clearly better: AUTO is the better layout analyser
    // when it does find structure, and SINGLE_BLOCK tends to flatten tables and
    // code into loose lines.
    if (alternative.score > best.score + 4) best = alternative;
  }

  return { ...best, passes };
}

function evaluate(page: OcrPage, options: PipelineOptions): Candidate {
  const layout = rebuildLayout(page);
  const markdown = cleanOutput(layout.markdown, { compact: options.compact });
  const { stats } = layout;
  // Structure is what makes the output useful to an agent, so it outweighs a
  // few extra characters of noisy text.
  const structure =
    stats.tables * 4 +
    stats.codeBlocks * 3 +
    stats.headings * 2 +
    stats.listItems * 0.6;
  const score = stats.confidence + structure + Math.min(stats.words, 300) * 0.05;
  return { page, layout, markdown, score };
}

function hasStructure(candidate: Candidate): boolean {
  const { stats } = candidate.layout;
  return stats.headings + stats.tables + stats.listItems + stats.codeBlocks > 0;
}

function needsSecondPass(candidate: Candidate): boolean {
  const raw = (candidate.page.text ?? '').trim();
  // Nothing was found: a retry would only burn time.
  if (raw.length < 24) return false;
  const { stats } = candidate.layout;

  // A confident result that already found headings, a table, list items or
  // code is trusted: PSM.SINGLE_BLOCK would flatten exactly that structure.
  if (hasStructure(candidate) && stats.confidence >= 75) return false;

  if (stats.confidence < 75) return true;

  // Readable characters but no usable structure usually means the layout
  // analysis swallowed the whole capture into one malformed block.
  return candidate.markdown.trim().length < 24;
}

/**
 * The tiny page preview used by history. It is built while the tiles are
 * recognised, so the caller never has to keep every screenshot around.
 */
interface PageThumb {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  ratio: number;
}

/**
 * Draws the tiles into a page-shaped preview, so history shows the whole
 * capture instead of the first viewport.
 */
function createPageThumb(capture: TiledCapture, first: HTMLImageElement): PageThumb | null {
  const totalDeviceHeight = Math.max(
    first.naturalHeight,
    Math.round(capture.scrollHeight * capture.dpr),
  );
  const ratio = Math.min(96 / Math.max(1, first.naturalWidth), 320 / totalDeviceHeight, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(first.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(totalDeviceHeight * ratio));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx, ratio };
}

function drawTileIntoThumb(
  thumb: PageThumb | null,
  image: HTMLImageElement,
  offset: number,
  dpr: number,
): void {
  if (!thumb) return;
  thumb.ctx.drawImage(
    image,
    0,
    Math.round(offset * dpr * thumb.ratio),
    thumb.canvas.width,
    Math.max(1, Math.round(image.naturalHeight * thumb.ratio)),
  );
}
