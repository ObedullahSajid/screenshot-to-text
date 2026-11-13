import type { Selection } from './messages';

export async function loadImage(source: Blob | string): Promise<HTMLImageElement> {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await image.decode();
  } catch {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not read that image.'));
    });
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url);
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error('That image appears to be empty.');
  }
  return image;
}

export async function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(blob);
  });
}

export interface ImageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function imageSize(source: Blob | string): Promise<{ width: number; height: number }> {
  const image = await loadImage(source);
  return { width: image.naturalWidth, height: image.naturalHeight };
}

/**
 * The region overlay reports viewport pixels, but the screenshot is captured at
 * device pixel ratio. Convert once so every later crop is in image pixels.
 */
export function selectionToImageRect(
  selection: Selection,
  imageWidth: number,
  imageHeight: number,
): ImageRect {
  const { rect, viewport } = selection;
  const scaleX = imageWidth / Math.max(1, viewport.width);
  const scaleY = imageHeight / Math.max(1, viewport.height);

  const x = clamp(Math.round(rect.x * scaleX), 0, Math.max(0, imageWidth - 1));
  const y = clamp(Math.round(rect.y * scaleY), 0, Math.max(0, imageHeight - 1));
  const width = clamp(Math.round(rect.width * scaleX), 1, imageWidth - x);
  const height = clamp(Math.round(rect.height * scaleY), 1, imageHeight - y);

  return { x, y, width, height };
}

/* ------------------------------------------------------------------ quality */

export interface ImageQuality {
  /** Variance of the Laplacian on the greyscale image. Higher is sharper. */
  sharpness: number;
  /** True when the capture looks soft enough to hurt OCR. */
  blurry: boolean;
  /** 2%-98% luminance spread of the source, 0-255. */
  contrast: number;
  /** True when the source had very little tonal separation. */
  lowContrast: boolean;
  /** True when equalisation was applied to rescue the contrast. */
  contrastBoosted: boolean;
}

export interface PreparedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  scale: number;
  inverted: boolean;
  quality: ImageQuality;
}

/**
 * Screenshots are usually too small and too dark for OCR. This upscales tiny
 * crops, caps huge ones, stretches contrast, rescues flat captures and inverts
 * dark-mode screenshots.
 *
 * Everything happens in one canvas pass so the cost stays close to `drawImage`.
 */
export function prepareImage(
  image: HTMLImageElement | ImageBitmap,
  maxWidth = 2400,
): PreparedImage {
  const srcW = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const srcH = 'naturalHeight' in image ? image.naturalHeight : image.height;

  let scale = 1;
  // Only tiny crops benefit from upscaling. Upscaling a normal screenshot
  // blurs the anti-aliased glyph edges and makes segmentation worse. Small
  // captures aim at ~1280 px wide (3x cap) so 11-15 px text lands in the
  // range Tesseract is trained on.
  if (srcW < 700) scale = Math.min(3, 1280 / srcW);
  let width = Math.max(1, Math.round(srcW * scale));
  let height = Math.max(1, Math.round(srcH * scale));

  if (width > maxWidth) {
    const k = maxWidth / width;
    width = Math.round(width * k);
    height = Math.round(height * k);
  }
  // Keep total pixels sane so Tesseract does not choke on tall captures.
  const MAX_PIXELS = 9_000_000;
  if (width * height > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (width * height));
    width = Math.max(1, Math.round(width * k));
    height = Math.max(1, Math.round(height * k));
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is unavailable.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);

  const pixels = ctx.getImageData(0, 0, width, height);
  const data = pixels.data;
  const gray = new Uint8Array(width * height);

  // Greyscale + histogram in one pass (subsampled for speed).
  const histogram = new Uint32Array(256);
  const step = Math.max(4, Math.floor((width * height) / 250_000)) * 4;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    const value = lum | 0;
    gray[p] = value;
    if (i % step === 0) {
      histogram[value]++;
      sum += value;
      sumSq += value * value;
      count++;
    }
  }

  const mean = count ? sum / count : 128;
  const variance = count ? Math.max(0, sumSq / count - mean * mean) : 0;
  const stdDev = Math.sqrt(variance);
  const inverted = mean < 108;

  // Tail-clipped range. The tails are deliberately small (0.5%): a capture
  // with only a few lines of text has ~1% ink, so a 2% clip would land in the
  // background and report a flat image that is actually high contrast.
  const target = Math.max(1, count * 0.005);
  let low = 0;
  let high = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += histogram[v];
    if (acc >= target) {
      low = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += histogram[v];
    if (acc >= target) {
      high = v;
      break;
    }
  }
  const contrast = Math.max(0, high - low);
  // Standard deviation alone is a poor signal for sparse text: a page with 1%
  // ink has a high range but a low deviation from all that background. Only
  // treat *both* a narrow range and a nearly uniform image as flat.
  const lowContrast = contrast < 56 && stdDev < 48;

  // A flat capture (grey-on-grey UI, disabled form fields, low-alpha text) loses
  // most of its signal in a global stretch. Equalisation separates the two
  // luminance clusters instead, which is what Tesseract needs to find glyphs.
  const contrastBoosted = lowContrast && contrast >= 8 && stdDev >= 3;

  const levels = contrastBoosted
    ? equalizeLevels(histogram, count, low, high)
    : buildLinearLevels(low, high > low ? high : low + 12);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    let value = levels[gray[p]];
    if (inverted) value = 255 - value;
    data[i] = data[i + 1] = data[i + 2] = value;
  }

  const sharpness = laplacianVariance(gray, width, height);
  const blurry = measureBlurry(sharpness, gray, width, height) && scale <= 1.05;

  ctx.putImageData(pixels, 0, 0);
  return {
    canvas,
    width,
    height,
    scale: width / srcW,
    inverted,
    quality: { sharpness, blurry, contrast, lowContrast, contrastBoosted },
  };
}

/** Maps 0-255 through a 256-entry lookup table. */
function buildLinearLevels(low: number, high: number): Uint8ClampedArray {
  const span = Math.max(1, high - low);
  const levels = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) levels[v] = ((v - low) / span) * 255;
  return levels;
}

/**
 * Contrast-limited histogram equalisation. Clipping each bin (CLAHE's trick,
 * applied globally) stops a large flat background from owning the whole range.
 */
function equalizeLevels(
  histogram: Uint32Array,
  count: number,
  low: number,
  high: number,
): Uint8ClampedArray {
  const bins = new Float64Array(256);
  const limit = Math.max(1, count * 0.012);
  let excess = 0;
  for (let v = 0; v < 256; v++) {
    const value = histogram[v];
    if (value > limit) {
      excess += value - limit;
      bins[v] = limit;
    } else {
      bins[v] = value;
    }
  }
  const share = excess / 256;
  for (let v = 0; v < 256; v++) bins[v] += share;

  const levels = new Uint8ClampedArray(256);
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += bins[v];
    const normalized = acc / Math.max(1, count + excess);
    // Blend with the linear stretch so strokes keep their anti-aliasing instead
    // of turning into hard black/white pixels.
    const linear = ((v - low) / Math.max(1, high - low)) * 255;
    levels[v] = linear * 0.35 + normalized * 255 * 0.65;
  }
  return levels;
}

/** Variance of a 4-neighbour Laplacian. Cheap proxy for focus. */
function laplacianVariance(gray: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  // Sub-sample wide images: the score is stable and this keeps it ~O(200k).
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 200_000)));
  for (let y = 1; y < height - 1; y += stride) {
    for (let x = 1; x < width - 1; x += stride) {
      const index = y * width + x;
      const lap =
        gray[index - width] +
        gray[index + width] +
        gray[index - 1] +
        gray[index + 1] -
        4 * gray[index];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
}

/**
 * A flat capture (blank page, solid colour) has no edges, so low Laplacian
 * variance means "nothing to read", not "blurry". Require some edge density
 * before blaming the focus.
 */
function measureBlurry(
  sharpness: number,
  gray: Uint8Array,
  width: number,
  height: number,
): boolean {
  if (sharpness <= 0) return false;
  if (sharpness >= 58) return false;

  let edges = 0;
  let samples = 0;
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 150_000)));
  for (let y = 1; y < height - 1; y += stride) {
    for (let x = 1; x < width - 1; x += stride) {
      const index = y * width + x;
      const lap =
        gray[index - width] +
        gray[index + width] +
        gray[index - 1] +
        gray[index + 1] -
        4 * gray[index];
      if (Math.abs(lap) > 14) edges++;
      samples++;
    }
  }
  return samples > 0 && edges / samples > 0.004;
}

export async function makeThumbnail(source: Blob | string, size = 128): Promise<string> {
  const image = await loadImage(source);
  const ratio = Math.min(size / image.naturalWidth, size / image.naturalHeight, 1);
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
