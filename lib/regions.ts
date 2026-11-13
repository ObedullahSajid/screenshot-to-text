import { loadImage, type ImageRect } from './preprocess';

export type RegionMode = 'keep' | 'exclude';

/** A rectangle of the original screenshot that is kept or cut out. */
export interface RegionBox extends ImageRect {
  mode: RegionMode;
}

export interface ComposedImage {
  blob: Blob;
  /** How many regions were applied, for the result UI. */
  keeps: number;
  excludes: number;
}

/** A dragged box smaller than this is treated as a stray click. */
export const MIN_REGION = 12;
/** Vertical breathing room between stacked keep regions. */
const GAP = 14;

/**
 * Applies keep/exclude boxes to the original capture and returns one image.
 *
 * - Exclude boxes are painted over first, so a cookie banner or a nav bar can
 *   be removed without touching the rest of the page.
 * - Keep boxes are then cut out of the masked image and stacked top to bottom
 *   in reading order. No keep boxes means the whole (masked) image.
 *
 * Working on the original pixels means a region edit never compounds a previous
 * crop: the boxes are always measured against the same source image.
 */
export async function composeRegions(
  source: string | Blob,
  regions: RegionBox[],
): Promise<ComposedImage> {
  // The common case is no regions at all. Skip the canvas round-trip so a
  // capture is passed through untouched (and a JPEG keeps its original bytes).
  if (!regions.length) {
    return { blob: await sourceBlob(source), keeps: 0, excludes: 0 };
  }

  const image = await loadImage(source);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  const keeps = regions
    .filter((region) => region.mode === 'keep')
    .map((region) => clampRect(region, width, height))
    .filter((rect): rect is ImageRect => rect !== null)
    .sort(readingOrder);
  const excludes = regions
    .filter((region) => region.mode === 'exclude')
    .map((region) => clampRect(region, width, height))
    .filter((rect): rect is ImageRect => rect !== null);

  const full = document.createElement('canvas');
  full.width = width;
  full.height = height;
  // The background sampler reads four corner patches back from this canvas;
  // without the hint Chrome logs a Canvas2D readback warning and may keep the
  // canvas GPU-backed, making each getImageData call a slow synchronisation.
  const ctx = full.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is unavailable.');
  // A transparent PNG would otherwise sample as black; white is the safer page
  // background for OCR.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  const background = sampleBackground(ctx, width, height);

  if (excludes.length) {
    ctx.fillStyle = background;
    for (const rect of excludes) {
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  const coversWhole =
    keeps.length === 0 ||
    (keeps.length === 1 && isFullFrame(keeps[0], width, height));

  if (coversWhole) {
    return {
      blob: await toBlob(full),
      keeps: keeps.length,
      excludes: excludes.length,
    };
  }

  // Keep regions are several crops of the same page. Stacking them in reading
  // order keeps the text in the order a person would read it, and the gap stops
  // the last line of one region touching the first line of the next.
  const outputWidth = Math.max(...keeps.map((rect) => rect.width));
  const outputHeight =
    keeps.reduce((total, rect) => total + rect.height, 0) + GAP * (keeps.length - 1);

  const output = document.createElement('canvas');
  output.width = outputWidth;
  output.height = outputHeight;
  const out = output.getContext('2d');
  if (!out) throw new Error('Canvas is unavailable.');

  out.fillStyle = background;
  out.fillRect(0, 0, outputWidth, outputHeight);

  let top = 0;
  for (const rect of keeps) {
    out.drawImage(full, rect.x, rect.y, rect.width, rect.height, 0, top, rect.width, rect.height);
    top += rect.height + GAP;
  }

  return {
    blob: await toBlob(output),
    keeps: keeps.length,
    excludes: excludes.length,
  };
}

/** Top-to-bottom, then left-to-right for boxes that share a row. */
function readingOrder(a: ImageRect, b: ImageRect): number {
  const tolerance = 12;
  if (Math.abs(a.y - b.y) > tolerance) return a.y - b.y;
  return a.x - b.x;
}

function isFullFrame(rect: ImageRect, width: number, height: number): boolean {
  return (
    rect.x <= 0 &&
    rect.y <= 0 &&
    rect.width >= width &&
    rect.height >= height
  );
}

function clampRect(rect: ImageRect, width: number, height: number): ImageRect | null {
  const x = clamp(Math.round(rect.x), 0, Math.max(0, width - 1));
  const y = clamp(Math.round(rect.y), 0, Math.max(0, height - 1));
  const w = clamp(Math.round(rect.width), 1, width - x);
  const h = clamp(Math.round(rect.height), 1, height - y);
  if (w < MIN_REGION || h < MIN_REGION) return null;
  return { x, y, width: w, height: h };
}

/**
 * The colour to paint excluded areas with. Sampling the corners rather than
 * averaging the whole image avoids picking up the very text we are removing;
 * the median of the four patches stays with the page background in both light
 * and dark captures.
 */
function sampleBackground(ctx: CanvasRenderingContext2D, width: number, height: number): string {
  const patch = Math.max(3, Math.min(20, Math.floor(Math.min(width, height) / 12)));
  const corners: Array<[number, number]> = [
    [0, 0],
    [Math.max(0, width - patch), 0],
    [0, Math.max(0, height - patch)],
    [Math.max(0, width - patch), Math.max(0, height - patch)],
  ];

  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];

  for (const [x, y] of corners) {
    const data = ctx.getImageData(x, y, patch, patch).data;
    for (let index = 0; index < data.length; index += 4) {
      reds.push(data[index]);
      greens.push(data[index + 1]);
      blues.push(data[index + 2]);
    }
  }

  return `rgb(${median(reds)}, ${median(greens)}, ${median(blues)})`;
}

function median(values: number[]): number {
  if (!values.length) return 255;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not apply the regions.'))),
      'image/png',
    );
  });
}

/** Decodes a data URL without touching a canvas. */
async function sourceBlob(source: string | Blob): Promise<Blob> {
  if (typeof source !== 'string') return source;

  const comma = source.indexOf(',');
  if (comma < 0) throw new Error('Unsupported image source.');
  const header = source.slice(0, comma);
  const body = source.slice(comma + 1);
  const type = /^data:([^;,]+)/i.exec(header)?.[1] ?? 'image/png';

  if (!/;base64/i.test(header)) {
    return new Blob([decodeURIComponent(body)], { type });
  }

  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
