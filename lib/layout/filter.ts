import type { OcrBlock, OcrLine, OcrPage, OcrParagraph } from '../ocr/types';

/** A rectangle of the original capture that is kept or cut out. */
export interface RegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  mode: 'keep' | 'exclude';
}

/**
 * True when the boxes leave the whole capture visible: nothing is excluded and
 * no keep box narrows the frame. A page recognised under those boxes can be
 * re-filtered later without OCR, because it still holds every line.
 */
export function coversFullFrame(
  regions: RegionRect[],
  width: number,
  height: number,
): boolean {
  if (regions.some((region) => region.mode === 'exclude')) return false;
  const keeps = regions.filter((region) => region.mode === 'keep');
  if (!keeps.length) return true;
  return keeps.length === 1 && coversAll(keeps[0], width, height);
}

function coversAll(rect: RegionRect, width: number, height: number): boolean {
  return rect.x <= 0 && rect.y <= 0 && rect.width >= width && rect.height >= height;
}

export interface FilteredPage {
  page: OcrPage;
  /** Lines that survived the boxes. */
  lines: number;
  /**
   * Lines a box cuts through. Their text would come out clipped, so the caller
   * should fall back to a full read instead of trusting the filtered page.
   */
  partial: number;
}

/**
 * Applies keep/exclude boxes to an already-recognised page.
 *
 * This mirrors what `composeRegions` does to pixels, but at the text level: a
 * line survives only when every pixel of it survives, so a kept crop never
 * gains halves of the lines just outside it and an exclusion never leaves a
 * clipped fragment behind. A line that the boxes cut through is reported as
 * partial instead.
 *
 * `scale` is prepared pixels per captured pixel: boxes are measured on the
 * original screenshot, OCR boxes on the prepared image.
 */
export function filterPageByRegions(
  page: OcrPage,
  regions: RegionRect[],
  scale: number,
): FilteredPage {
  if (!regions.length || scale <= 0) {
    return { page, lines: countLines(page), partial: 0 };
  }

  const keep = regions
    .filter((region) => region.mode === 'keep')
    .map((region) => scaleRect(region, scale));
  const exclude = regions
    .filter((region) => region.mode === 'exclude')
    .map((region) => scaleRect(region, scale));

  let lines = 0;
  let partial = 0;

  const keepLine = (line: OcrLine): boolean => {
    const box = line.bbox;
    if (exclude.some((rect) => intersects(rect, box))) {
      // Fully inside a masked box: the text is gone either way. A box that only
      // clips the line would change its text, so let the caller re-read.
      if (!exclude.some((rect) => contains(rect, box))) partial++;
      return false;
    }
    if (!keep.length) return true;

    if (keep.some((rect) => contains(rect, box))) return true;
    // Overlapping a keep box but not fully inside it means the crop cuts the
    // line. Outside every keep box, the line is simply cropped away.
    if (keep.some((rect) => intersects(rect, box))) partial++;
    return false;
  };

  const blocks: OcrBlock[] = [];
  for (const block of page.blocks ?? []) {
    const paragraphs: OcrParagraph[] = [];
    for (const paragraph of block.paragraphs ?? []) {
      const kept = (paragraph.lines ?? []).filter(keepLine);
      if (!kept.length) continue;
      lines += kept.length;
      paragraphs.push({
        ...paragraph,
        text: `${kept.map((line) => line.text).join('\n')}\n\n`,
        bbox: unionBoxes(kept.map((line) => line.bbox)),
        lines: kept,
      });
    }
    if (!paragraphs.length) continue;
    blocks.push({
      ...block,
      text: paragraphs.map((paragraph) => paragraph.text).join(''),
      bbox: unionBoxes(paragraphs.map((paragraph) => paragraph.bbox)),
      paragraphs,
    });
  }

  const paragraphs = blocks.flatMap((block) => block.paragraphs ?? []);
  const keptLines = paragraphs.flatMap((paragraph) => paragraph.lines);

  return {
    page: {
      ...page,
      text: paragraphs.map((paragraph) => paragraph.text).join(''),
      blocks,
      paragraphs,
      lines: page.lines ? keptLines : page.lines,
    },
    lines,
    partial,
  };
}

function countLines(page: OcrPage): number {
  return (page.blocks ?? []).reduce(
    (total, block) =>
      total +
      (block.paragraphs ?? []).reduce(
        (inner, paragraph) => inner + (paragraph.lines ?? []).length,
        0,
      ),
    0,
  );
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function scaleRect(rect: Rect, scale: number): Rect {
  return {
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

function contains(rect: Rect, box: OcrLine['bbox']): boolean {
  return (
    box.x0 >= rect.x &&
    box.y0 >= rect.y &&
    box.x1 <= rect.x + rect.width &&
    box.y1 <= rect.y + rect.height
  );
}

function intersects(rect: Rect, box: OcrLine['bbox']): boolean {
  return (
    box.x0 < rect.x + rect.width &&
    box.x1 > rect.x &&
    box.y0 < rect.y + rect.height &&
    box.y1 > rect.y
  );
}

function unionBoxes(boxes: Array<OcrLine['bbox']>): OcrLine['bbox'] {
  if (!boxes.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return boxes.reduce((union, box) => ({
    x0: Math.min(union.x0, box.x0),
    y0: Math.min(union.y0, box.y0),
    x1: Math.max(union.x1, box.x1),
    y1: Math.max(union.y1, box.y1),
  }));
}
