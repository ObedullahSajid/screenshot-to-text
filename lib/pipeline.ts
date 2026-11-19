import { cleanOutput } from './clean';
import { getEngine, PSM_MODES, recognizeOnce, type OcrProgress, type PsmMode } from './ocr/engine';
import { workersForTiles } from './ocr/pool';
import { rebuildLayout, type LayoutResult } from './layout/rebuild';
import type { OcrPage } from './ocr/types';
import {
  adaptiveMaxWidth,
  prepareImage,
  isBlankCanvas,
  loadImage,
  makeThumbnail,
  type ImageQuality,
  type PreparedImage,
} from './preprocess';
import { countTextTokens, estimateImageTokens } from './tokens';
import { contiguousPrefix, stitchTiles } from './fullpage';

export interface PipelineOptions {
  compact: boolean;
  maxWidth: number;
  /**
   * Lower a wide capture's OCR width when a line-height probe says its text
   * survives the downscale. On by default; the benchmark turns it off to sweep
   * explicit widths.
   */
  adaptive?: boolean;
}

export const NEUTRAL_QUALITY: ImageQuality = {
  sharpness: 0,
  blurry: false,
  contrast: 0,
  lowContrast: false,
  contrastBoosted: false,
};

export const EMPTY_PAGE: OcrPage = {
  text: '',
  confidence: 0,
  blocks: [],
  paragraphs: [],
  lines: [],
};

/**
 * Turns a recognised page into the Markdown the panel shows. Kept separate from
 * recognition so a region edit can re-render an existing page without OCR.
 */
export function renderPage(
  page: OcrPage,
  options: PipelineOptions,
): { markdown: string; rawText: string; stats: LayoutResult['stats'] } {
  const layout = rebuildLayout(page);
  return {
    markdown: cleanOutput(layout.markdown, { compact: options.compact }),
    rawText: (page.text ?? '').trim(),
    stats: layout.stats,
  };
}

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
  /**
   * The recognised page. It is kept so a keep/exclude edit can be applied to
   * the text instead of reading the capture again.
   */
  page?: OcrPage;
  /** Prepared pixels per captured pixel for `page`. */
  scale?: number;
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

/**
 * A growing top-of-page result, published while a full-page capture is still
 * being read. It covers the first `tiles` tiles only, so it is a real prefix of
 * the final page rather than a snapshot of whichever tiles happened to finish.
 */
export interface TiledPartial {
  markdown: string;
  rawText: string;
  stats: LayoutResult['stats'];
  /** Contiguous tiles from the top that this preview covers. */
  tiles: number;
  total: number;
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

  const maxWidth =
    options.adaptive === false ? options.maxWidth : adaptiveMaxWidth(image, options.maxWidth);
  const prepared = prepareImage(image, maxWidth);

  // Nothing to read: a stray click, a paste of an empty canvas or a blank
  // stretch between sections. Skipping the pass keeps the worker idle.
  if (isBlankCanvas(prepared.canvas)) {
    onProgress('Done', 1);
    return {
      markdown: '',
      rawText: '',
      thumb: await makeThumbnail(source),
      tokens: 0,
      imageTokens: estimateImageTokens(width, height),
      stats: rebuildLayout(EMPTY_PAGE).stats,
      width,
      height,
      inverted: prepared.inverted,
      quality: prepared.quality,
      passes: 1,
      page: EMPTY_PAGE,
      scale: prepared.scale,
    };
  }

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
    page: best.page,
    scale: prepared.scale,
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
  onPartial?: (partial: TiledPartial) => void,
): Promise<PipelineOutput> {
  const { tiles } = capture;
  if (!tiles.length) throw new Error('No tiles were captured.');

  /** One read tile, in page coordinates. */
  interface TileRecognition {
    page: OcrPage;
    offset: number;
    scale: number;
    index: number;
  }

  const recognitions: Array<TileRecognition | null> = new Array(tiles.length).fill(null);
  const workers = workersForTiles(tiles.length);
  let nextTile = 0;
  let completed = 0;
  let aborted = false;
  let passes = 1;
  let quality = NEUTRAL_QUALITY;
  let inverted = false;
  let width = 0;
  // Filled by the slot loops, hence the box: TypeScript cannot see assignments
  // made inside those async closures.
  const thumbBox: { value: PageThumb | null } = { value: null };

  // One bar for the whole run. Two workers report progress independently, so
  // their fractions are combined rather than forwarded; the bar then still
  // moves forward when tiles finish out of order.
  let lastProgress = 0.04;
  const inFlight = new Map<number, number>();

  const publish = (stage?: string) => {
    const running = Array.from(inFlight.values()).reduce((sum, value) => sum + value, 0);
    const fraction = Math.min(1, (completed + running) / tiles.length);
    lastProgress = Math.max(lastProgress, 0.04 + fraction * 0.82);
    const done = `${completed} of ${tiles.length} done`;
    const prefix = tiles.length === 1 ? 'Reading tile' : 'Reading tiles';
    onProgress(stage ? `${stage} · ${done}` : `${prefix} · ${done}`, lastProgress);
  };

  const asTileInput = (entry: TileRecognition) => ({
    page: entry.page,
    offset: entry.offset,
    dpr: capture.dpr,
    scale: entry.scale,
    index: entry.index,
  });

  let previewed = 0;

  /**
   * Publishes the top of the page as tiles complete. The prefix is re-stitched
   * from scratch, not appended to, so a seam is de-duplicated and a paragraph
   * crossing it is merged exactly as the final pass will do it.
   */
  const publishPartial = () => {
    if (!onPartial) return;
    const prefix = contiguousPrefix(recognitions);
    if (prefix <= previewed) return;
    previewed = prefix;

    const read = recognitions
      .slice(0, prefix)
      .filter((entry): entry is TileRecognition => entry !== null);
    const stitched = stitchTiles(read.map(asTileInput));
    const rendered = renderPage(stitched.page, options);
    // A page that starts with a hero image has nothing to preview yet; the next
    // tile will publish.
    if (!rendered.markdown.trim()) return;
    onPartial({
      markdown: rendered.markdown,
      rawText: rendered.rawText,
      stats: rendered.stats,
      tiles: prefix,
      total: tiles.length,
    });
  };

  /**
   * Reads tiles from one worker until the queue is empty. Decoding and
   * preparing stay here on the main thread; only recognition runs on the
   * worker, so two slots overlap without sharing a canvas.
   */
  const readSlot = async (slot: number) => {
    while (true) {
      if (aborted || isCancelled()) return;
      const index = nextTile++;
      if (index >= tiles.length) return;
      const tile = tiles[index];
      inFlight.set(slot, 0);
      publish(`Reading tile ${index + 1}`);

      const image = await loadImage(tile.dataUrl);
      // Build the preview before the image goes out of scope, so a 24-tile page
      // never holds 24 decoded screenshots in memory at once.
      if (!thumbBox.value) thumbBox.value = createPageThumb(capture, image);
      drawTileIntoThumb(thumbBox.value, image, tile.offset, capture.dpr);

      const prepared = prepareImage(
        image,
        options.adaptive === false
          ? options.maxWidth
          : adaptiveMaxWidth(image, options.maxWidth),
      );

      if (isBlankCanvas(prepared.canvas)) {
        // A blank stretch between sections costs nothing. The page still counts
        // towards the preview and the offsets, it just holds no lines.
        if (index === 0) {
          quality = prepared.quality;
          inverted = prepared.inverted;
          width = image.naturalWidth;
        }
        recognitions[index] = {
          page: EMPTY_PAGE,
          offset: tile.offset,
          scale: prepared.scale,
          index,
        };
        inFlight.delete(slot);
        completed++;
        publish();
        publishPartial();
        continue;
      }

      const best = await recognizeBest(
        prepared,
        options,
        (stage, progress) => {
          // A tile's own 0-1 progress counts as at most one tile's share, so
          // the combined bar can never sit above the tiles actually finished.
          inFlight.set(slot, progress * 0.9);
          publish(stage);
        },
        0,
        1,
        slot,
      );

      if (index === 0) {
        quality = prepared.quality;
        inverted = prepared.inverted;
        width = image.naturalWidth;
      }
      passes = Math.max(passes, best.passes);
      recognitions[index] = {
        page: best.page,
        offset: tile.offset,
        scale: prepared.scale,
        index,
      };
      inFlight.delete(slot);
      completed++;
      publish();
      publishPartial();
    }
  };

  /**
   * Starts a worker and lets it drain the queue. The second worker is opened
   * while the first tile is already being read, so its start-up is hidden. If
   * it cannot start, the page is read on the worker that does work instead of
   * failing the whole capture.
   */
  const openSlot = async (slot: number) => {
    if (slot > 0) {
      const ready = await getEngine(slot).then(
        () => true,
        () => false,
      );
      if (!ready) return;
    }
    try {
      await readSlot(slot);
    } catch (error) {
      // Stop the other worker from picking up more tiles after the capture has
      // already failed.
      aborted = true;
      throw error;
    }
  };

  await Promise.all(Array.from({ length: workers }, (_, slot) => openSlot(slot)));

  if (isCancelled()) throw new Error('Cancelled.');

  if (recognitions.some((entry) => entry === null)) {
    // The only way here is a worker that stopped without reporting an error.
    throw new Error('Not every tile was read.');
  }

  onProgress('Stitching tiles', 0.9);
  const read = recognitions.filter((entry): entry is TileRecognition => entry !== null);
  const stitched = stitchTiles(read.map(asTileInput));

  onProgress('Rebuilding layout', 0.93);
  const page = stitched.page;
  const rendered = renderPage(page, options);
  const { markdown } = rendered;

  onProgress('Counting tokens', 0.97);
  const tokens = await countTextTokens(markdown);
  const thumbUrl = thumbBox.value
    ? thumbBox.value.canvas.toDataURL('image/jpeg', 0.72)
    : '';

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
    stats: rendered.stats,
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
  slot = 0,
): Promise<Recognition> {
  const first = await recognizeOnce(
    prepared.canvas,
    PSM_MODES.auto,
    (stage, progress) => onProgress(stage, base + progress * span * 0.68),
    slot,
  );
  let best = evaluate(first, options);
  let passes = 1;

  if (needsSecondPass(best)) {
    const mode: PsmMode = best.layout.stats.words === 0 ? PSM_MODES.sparse : PSM_MODES.block;
    onProgress(
      mode === PSM_MODES.sparse ? 'Re-reading (sparse layout)' : 'Re-reading (dense layout)',
      base + span * 0.7,
    );
    const second = await recognizeOnce(
      prepared.canvas,
      mode,
      (stage, progress) => onProgress(stage, base + span * 0.7 + progress * span * 0.3),
      slot,
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
