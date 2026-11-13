import type { Bbox, OcrBlock, OcrLine, OcrPage, OcrParagraph, OcrWord } from './ocr/types';

/** Vertical overlap between two tiles, in CSS pixels. */
export const TILE_OVERLAP = 140;
/** A page taller than this many tiles is captured up to the limit. */
export const MAX_TILES = 24;

export interface PageMetrics {
  scrollHeight: number;
  viewportHeight: number;
  viewportWidth: number;
  dpr: number;
  scrollY: number;
  htmlBehavior: string;
  bodyBehavior: string;
  /** How many fixed/sticky elements were tagged for hiding after tile 1. */
  repeating: number;
}

export interface TilePlan {
  /** Scroll offset for each tile, in CSS pixels. Always starts at 0. */
  offsets: number[];
  /** Actual vertical overlap between consecutive tiles. */
  overlap: number;
  /** True when the page is taller than MAX_TILES allows. */
  truncated: boolean;
}

/**
 * Plans a top-to-bottom scroll capture.
 *
 * Tiles overlap, so a line of text is fully visible in at least one of them
 * even when it falls on a tile boundary. The offsets are spread evenly so the
 * last tile is a useful step rather than a sliver of leftovers.
 */
export function planTiles(
  scrollHeight: number,
  viewportHeight: number,
  overlap = TILE_OVERLAP,
  maxTiles = MAX_TILES,
): TilePlan {
  const pageHeight = Math.max(1, scrollHeight);
  const viewport = Math.max(1, viewportHeight);
  const maxScroll = Math.max(0, pageHeight - viewport);
  if (maxScroll === 0) return { offsets: [0], overlap: 0, truncated: false };

  // A tile must overlap the previous one, but it also has to advance by a
  // useful part of the viewport. Capping the overlap at 75% handles tiny
  // (zoomed) viewports without ever skipping a strip of the page.
  const lowestStep = Math.ceil(viewport * 0.25);
  const clampedOverlap = Math.min(
    Math.max(0, overlap),
    Math.max(0, viewport - lowestStep),
  );
  const maxStep = Math.max(1, viewport - clampedOverlap);
  const needed = Math.max(1, Math.ceil(maxScroll / maxStep));

  if (needed + 1 > maxTiles) {
    const step = maxStep;
    const offsets = Array.from({ length: maxTiles }, (_, index) =>
      Math.min(maxScroll, Math.round(index * step)),
    );
    return {
      offsets,
      overlap: Math.max(0, viewport - step),
      truncated: offsets[offsets.length - 1] < maxScroll,
    };
  }

  const step = maxScroll / needed;
  const offsets = Array.from({ length: needed + 1 }, (_, index) =>
    index === needed ? maxScroll : Math.round(index * step),
  );
  return {
    offsets,
    overlap: Math.max(0, viewport - step),
    truncated: false,
  };
}

/* ------------------------------------------------------- injected page code */

/**
 * Runs in the page through chrome.scripting.executeScript, so it must stay
 * self-contained: no imports and no module-scope references.
 */
export async function prepareFullPage(): Promise<PageMetrics> {
  const scroller = document.scrollingElement ?? document.documentElement;
  const html = document.documentElement;
  const body = document.body;

  const scrollHeight = Math.max(
    scroller?.scrollHeight ?? 0,
    html.scrollHeight,
    body?.scrollHeight ?? 0,
  );
  const htmlBehavior = html.style.scrollBehavior;
  const bodyBehavior = body?.style.scrollBehavior ?? '';

  // Smooth scrolling would animate the capture and blur the tile offsets.
  html.style.scrollBehavior = 'auto';
  if (body) body.style.scrollBehavior = 'auto';

  let repeating = 0;
  for (const element of document.querySelectorAll<HTMLElement>('body *')) {
    const style = getComputedStyle(element);
    if (style.position !== 'fixed' && style.position !== 'sticky') continue;
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    element.setAttribute('data-stt-repeating', '1');
    repeating++;
  }

  return {
    scrollHeight,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    dpr: window.devicePixelRatio || 1,
    scrollY: Math.round(window.scrollY),
    htmlBehavior,
    bodyBehavior,
    repeating,
  };
}

/**
 * The first tile shows the page as it really looks. From the second tile on,
 * fixed and sticky chrome would repeat in every capture, so it is hidden
 * without removing its layout box (visibility, not display).
 */
export function hideRepeatingFullPage(): void {
  if (document.getElementById('stt-fullpage-style')) return;
  const style = document.createElement('style');
  style.id = 'stt-fullpage-style';
  style.textContent = '[data-stt-repeating]{visibility:hidden!important}';
  (document.head ?? document.documentElement).appendChild(style);
}

/** Scrolls one tile and waits for the paint to settle. */
export async function scrollFullPage(top: number): Promise<{
  scrollY: number;
  scrollHeight: number;
}> {
  window.scrollTo({ top, left: 0, behavior: 'instant' as ScrollBehavior });
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  await new Promise((resolve) => setTimeout(resolve, 90));
  const scroller = document.scrollingElement ?? document.documentElement;
  return {
    scrollY: Math.round(window.scrollY),
    scrollHeight: scroller.scrollHeight,
  };
}

/** Puts the page back exactly where the user left it. */
export function restoreFullPage(
  scrollY: number,
  htmlBehavior: string,
  bodyBehavior: string,
): void {
  document.getElementById('stt-fullpage-style')?.remove();
  for (const element of document.querySelectorAll('[data-stt-repeating]')) {
    element.removeAttribute('data-stt-repeating');
  }
  const html = document.documentElement;
  html.style.scrollBehavior = htmlBehavior;
  if (document.body) document.body.style.scrollBehavior = bodyBehavior;
  window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' as ScrollBehavior });
}

/* ------------------------------------------------------------- line stitching */

export interface TileInput {
  page: OcrPage;
  /** Scroll offset of this tile, in CSS pixels. */
  offset: number;
  dpr: number;
  /** Prepared-image scale (prepared px / captured px). */
  scale: number;
  /** Capture order; earlier tiles win the reading-order tie-break. */
  index: number;
}

export interface StitchedPage {
  page: OcrPage;
  /** Lines dropped because another tile already showed them. */
  duplicates: number;
  lines: number;
}

interface FlatLine {
  text: string;
  confidence: number;
  box: Bbox;
  words: OcrWord[];
  tile: number;
  /** [tile index, block index, paragraph index]. */
  order: [number, number, number];
  keep: boolean;
}

interface ParagraphCandidate {
  lines: FlatLine[];
  box: Bbox;
  order: [number, number, number];
  tiles: Set<number>;
}

/**
 * Stitches overlapping OCR tiles into one virtual page.
 *
 * Matching at the Markdown level is hopeless: Tesseract groups a whole tile of
 * prose into one paragraph, so the same text appears inside a giant different
 * line. Matching the OCR *lines* by their absolute page position is stable.
 * Duplicate lines are collapsed, paragraphs that overlap across a seam are
 * merged, and the caller rebuilds layout once over the whole page.
 */
export function stitchTiles(tiles: TileInput[]): StitchedPage {
  const flat: FlatLine[] = [];
  // Debug-only trace for `scripts/e2e.mjs`: `globalThis.__sttTrace` is set by the
  // harness, never by the extension itself.
  const traceRequested =
    (globalThis as unknown as { __sttTrace?: boolean }).__sttTrace === true;
  const trace: {
    tiles: Array<{ index: number; offset: number; scale: number; dpr: number; lines: number }>;
    pairs: Array<{ loser: string; winner: string; loserY: number; winnerY: number }>;
  } | null = traceRequested ? { tiles: [], pairs: [] } : null;

  for (const tile of tiles) {
    const shift = tile.offset * tile.dpr * tile.scale;
    const tileStart = flat.length;
    const blockList = pageBlocks(tile.page);

    blockList.forEach((block, blockIndex) => {
      const paragraphs = [...(block.paragraphs ?? [])].sort(
        (a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0,
      );
      const list = paragraphs.length
        ? paragraphs
        : [
            {
              text: block.text,
              confidence: block.confidence,
              bbox: block.bbox,
              lines: [],
            } as OcrParagraph,
          ];

      list.forEach((paragraph, paragraphIndex) => {
        for (const line of paragraph.lines ?? []) {
          const text = clean(line.text);
          if (!text) continue;
          flat.push({
            text,
            confidence: line.confidence ?? 0,
            box: shiftBox(line.bbox, shift),
            words: (line.words ?? []).map((word) => ({
              ...word,
              bbox: shiftBox(word.bbox, shift),
            })),
            tile: tile.index,
            order: [tile.index, blockIndex, paragraphIndex],
            keep: true,
          });
        }
      });
    });

    trace?.tiles.push({
      index: tile.index,
      offset: tile.offset,
      scale: tile.scale,
      dpr: tile.dpr,
      lines: flat.length - tileStart,
    });
  }

  if (!flat.length) {
    return {
      page: { text: '', confidence: 0, blocks: [], paragraphs: [], lines: [] },
      duplicates: 0,
      lines: 0,
    };
  }

  flat.sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  const medianHeight = Math.max(6, median(flat.map((line) => line.box.y1 - line.box.y0)));
  const bucketSize = Math.max(6, medianHeight);

  const buckets = new Map<number, FlatLine[]>();
  let duplicates = 0;

  for (const line of flat) {
    const bucket = Math.floor(line.box.y0 / bucketSize);
    let match: FlatLine | undefined;

    for (let offset = -1; offset <= 1 && !match; offset++) {
      for (const other of buckets.get(bucket + offset) ?? []) {
        if (other.keep && sameLine(other, line)) {
          match = other;
          break;
        }
      }
    }

    if (!match) {
      line.keep = true;
      addToBucket(buckets, bucket, line);
      continue;
    }

    duplicates++;
    if (scoreLine(line) > scoreLine(match)) {
      trace?.pairs.push({
        loser: match.text,
        winner: line.text,
        loserY: Math.round(match.box.y0),
        winnerY: Math.round(line.box.y0),
      });
      match.keep = false;
      line.keep = true;
      addToBucket(buckets, bucket, line);
    } else {
      trace?.pairs.push({
        loser: line.text,
        winner: match.text,
        loserY: Math.round(line.box.y0),
        winnerY: Math.round(match.box.y0),
      });
      line.keep = false;
    }
  }

  if (trace) {
    (globalThis as unknown as { __sttTraceData?: unknown }).__sttTraceData = trace;
  }

  const kept = flat.filter((line) => line.keep);
  const paragraphs = mergeParagraphs(kept);

  const lines: OcrLine[] = [];
  const outParagraphs: OcrParagraph[] = [];
  const blocks: OcrBlock[] = [];

  for (const candidate of paragraphs) {
    const paragraphLines: OcrLine[] = candidate.lines.map((line) => ({
      text: line.text,
      confidence: line.confidence,
      bbox: line.box,
      words: line.words,
    }));
    lines.push(...paragraphLines);

    const paragraph: OcrParagraph = {
      text: `${candidate.lines.map((line) => line.text).join('\n')}\n\n`,
      confidence: median(candidate.lines.map((line) => line.confidence)),
      bbox: candidate.box,
      lines: paragraphLines,
    };
    outParagraphs.push(paragraph);
    blocks.push({
      text: paragraph.text,
      confidence: paragraph.confidence,
      bbox: paragraph.bbox,
      blocktype: 'text',
      paragraphs: [paragraph],
    });
  }

  return {
    page: {
      text: outParagraphs.map((paragraph) => paragraph.text).join(''),
      confidence: median(outParagraphs.map((paragraph) => paragraph.confidence)),
      blocks,
      paragraphs: outParagraphs,
      lines,
    },
    duplicates,
    lines: lines.length,
  };
}

function mergeParagraphs(lines: FlatLine[]): ParagraphCandidate[] {
  const groups = new Map<string, ParagraphCandidate>();

  for (const line of lines) {
    const key = line.order.join(':');
    const existing = groups.get(key);
    if (existing) {
      existing.lines.push(line);
      existing.box = unionBox(existing.box, line.box);
    } else {
      groups.set(key, {
        lines: [line],
        box: line.box,
        order: line.order,
        tiles: new Set([line.tile]),
      });
    }
  }

  const candidates = [...groups.values()].sort((a, b) => compareOrder(a.order, b.order));
  const merged: ParagraphCandidate[] = [];

  for (const candidate of candidates) {
    let target: ParagraphCandidate | undefined;
    let best = 0;

    for (const existing of merged) {
      // Paragraphs from the same tile were deliberately split by Tesseract.
      if ([...candidate.tiles].some((tile) => existing.tiles.has(tile))) continue;
      const vertical = overlap(existing.box.y0, existing.box.y1, candidate.box.y0, candidate.box.y1);
      if (vertical <= 0) continue;
      const horizontal = overlap(existing.box.x0, existing.box.x1, candidate.box.x0, candidate.box.x1);
      if (horizontal <= 0) continue;
      const narrower = Math.max(
        1,
        Math.min(existing.box.x1 - existing.box.x0, candidate.box.x1 - candidate.box.x0),
      );
      if (horizontal / narrower < 0.4) continue;
      const score = vertical * (horizontal / narrower);
      if (score > best) {
        best = score;
        target = existing;
      }
    }

    if (target) {
      target.lines.push(...candidate.lines);
      target.box = unionBox(target.box, candidate.box);
      target.tiles.add([...candidate.tiles][0]);
      if (compareOrder(candidate.order, target.order) < 0) target.order = candidate.order;
    } else {
      merged.push({
        lines: [...candidate.lines],
        box: candidate.box,
        order: candidate.order,
        tiles: new Set(candidate.tiles),
      });
    }
  }

  for (const candidate of merged) {
    candidate.lines.sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  }
  merged.sort((a, b) => compareOrder(a.order, b.order));
  return merged;
}

/* ------------------------------------------------------------------ helpers */

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * Tesseract normally returns blocks, but a page can come back with only
 * paragraphs or flat lines. Normalise the three shapes into blocks so the
 * stitcher never silently drops text.
 */
function pageBlocks(page: OcrPage): OcrBlock[] {
  const blocks = page.blocks ?? [];
  if (blocks.length) return blocks;

  const paragraphs = page.paragraphs ?? [];
  if (paragraphs.length) {
    return [
      {
        text: page.text ?? '',
        confidence: page.confidence ?? 0,
        bbox: paragraphs.reduce((box, paragraph) => unionBox(box, paragraph.bbox), zeroBox()),
        blocktype: 'text',
        paragraphs,
      },
    ];
  }

  const lines = page.lines ?? [];
  if (!lines.length) return [];
  const bbox = lines.reduce((box, line) => unionBox(box, line.bbox), zeroBox());
  return [
    {
      text: page.text ?? '',
      confidence: page.confidence ?? 0,
      bbox,
      blocktype: 'text',
      paragraphs: [{ text: page.text ?? '', confidence: page.confidence ?? 0, bbox, lines }],
    },
  ];
}

function zeroBox(): Bbox {
  return { x0: 0, y0: 0, x1: 0, y1: 0 };
}

function shiftBox(box: Bbox, shift: number): Bbox {
  return { x0: box.x0, y0: box.y0 + shift, x1: box.x1, y1: box.y1 + shift };
}

function addToBucket(
  buckets: Map<number, FlatLine[]>,
  bucket: number,
  line: FlatLine,
): void {
  const list = buckets.get(bucket);
  if (list) list.push(line);
  else buckets.set(bucket, [line]);
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

function unionBox(a: Bbox, b: Bbox): Bbox {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function compareOrder(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Same visual line: vertical and horizontal overlap, and compatible text. */
function sameLine(a: FlatLine, b: FlatLine): boolean {
  const heightA = a.box.y1 - a.box.y0;
  const heightB = b.box.y1 - b.box.y0;
  const vertical = overlap(a.box.y0, a.box.y1, b.box.y0, b.box.y1);
  if (vertical < Math.max(2, Math.min(heightA, heightB) * 0.35)) return false;

  const widthA = a.box.x1 - a.box.x0;
  const widthB = b.box.x1 - b.box.x0;
  const horizontal = overlap(a.box.x0, a.box.x1, b.box.x0, b.box.x1);
  if (horizontal < Math.max(2, Math.min(widthA, widthB) * 0.35)) return false;

  // A clipped fragment a few pixels tall is never better than the full line.
  if (Math.min(heightA, heightB) < Math.max(heightA, heightB) * 0.55) return true;

  return similarText(a.text, b.text);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function similarText(a: string, b: string): boolean {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length >= 4 && longer.includes(shorter) && shorter.length >= longer.length * 0.5) {
    return true;
  }

  return (
    editDistance(left, right) <=
    Math.max(2, Math.round(Math.max(left.length, right.length) * 0.12))
  );
}

/** Levenshtein distance, capped by the short length of OCR lines. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row++) {
    const current = [row];
    for (let column = 1; column <= b.length; column++) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost,
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function scoreLine(line: FlatLine): number {
  const height = line.box.y1 - line.box.y0;
  return height * 3 + Math.min(line.text.length, 80) + line.confidence * 0.6;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
