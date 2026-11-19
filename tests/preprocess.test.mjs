import test from 'node:test';
import assert from 'node:assert/strict';
import {
  looksBlank,
  measureLineBands,
  OCR_WIDTH_FLOOR,
  pickOcrWidth,
} from '../lib/preprocess.ts';

const SIZE = 64;
const PIXELS = SIZE * SIZE;

function canvas(fill) {
  const data = new Uint8ClampedArray(PIXELS * 4);
  for (let index = 0; index < PIXELS; index++) {
    const [r, g, b] = fill(index);
    data[index * 4] = r;
    data[index * 4 + 1] = g;
    data[index * 4 + 2] = b;
    data[index * 4 + 3] = 255;
  }
  return data;
}

/** A page of full-width ink bands standing in for rows of text. */
function bands({
  width = 200,
  height = 160,
  heights = [12, 12, 12, 12, 12],
  gap = 10,
  top = 8,
  ink = 20,
  background = 255,
} = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = background;
    data[index * 4 + 1] = background;
    data[index * 4 + 2] = background;
    data[index * 4 + 3] = 255;
  }
  let row = top;
  for (const bandHeight of heights) {
    for (let y = row; y < Math.min(height, row + bandHeight); y++) {
      for (let x = 10; x < width - 10; x++) {
        const index = (y * width + x) * 4;
        data[index] = ink;
        data[index + 1] = ink;
        data[index + 2] = ink;
      }
    }
    row += bandHeight + gap;
  }
  return data;
}

test('a plain page is blank', () => {
  assert.equal(looksBlank(canvas(() => [255, 255, 255]), SIZE, SIZE), true);
  assert.equal(looksBlank(canvas(() => [24, 24, 24]), SIZE, SIZE), true);
});

test('a few stray pixels are still blank', () => {
  const data = canvas((index) => (index === 100 ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(looksBlank(data, SIZE, SIZE), true);
});

test('a band of text is not blank', () => {
  // ~2% ink: 80 dark pixels spread over one row, like a line of small text.
  const data = canvas((index) => (index > 1000 && index < 1080 ? [20, 20, 20] : [255, 255, 255]));
  assert.equal(looksBlank(data, SIZE, SIZE), false);
});

test('light text on a dark page is not blank', () => {
  const data = canvas((index) => (index > 2000 && index < 2200 ? [230, 230, 230] : [18, 18, 18]));
  assert.equal(looksBlank(data, SIZE, SIZE), false);
});

test('a little noise on the background is not treated as ink', () => {
  // Every pixel wobbles by 6 levels: compression noise, not content.
  const data = canvas((index) => {
    const value = 250 - (index % 7);
    return [value, value, value];
  });
  assert.equal(looksBlank(data, SIZE, SIZE), true);
});

test('the probe measures the height of the text rows', () => {
  const profile = measureLineBands(bands(), 200, 160);
  assert.equal(profile.lines, 5);
  assert.equal(profile.low, 12);
  assert.equal(profile.median, 12);
  // 12 px band followed by a 10 px gap.
  assert.equal(profile.pitch, 22);
});

test('mixed row heights report the dense rows, not the headings', () => {
  const data = bands({ heights: [26, 9, 9, 9, 9, 9, 9] });
  const profile = measureLineBands(data, 200, 160);
  assert.equal(profile.lines, 7);
  assert.equal(profile.median, 9);
  assert.equal(profile.low, 9);
});

test('a blank page has no rows', () => {
  const profile = measureLineBands(bands({ heights: [] }), 200, 160);
  assert.equal(profile.lines, 0);
  assert.equal(profile.low, 0);
});

test('single-pixel rules are not text rows', () => {
  const profile = measureLineBands(bands({ heights: [1, 12, 1, 12, 1, 12, 1, 12] }), 200, 160);
  assert.equal(profile.lines, 4);
  assert.equal(profile.low, 12);
});

test('light text on a dark page is measured the same way', () => {
  const profile = measureLineBands(bands({ background: 18, ink: 235 }), 200, 160);
  assert.equal(profile.lines, 5);
  assert.equal(profile.median, 12);
});

test('a wide capture with tall text is lowered to the floor', () => {
  assert.equal(pickOcrWidth({ lines: 8, low: 13, median: 14, pitch: 22 }, 2400), OCR_WIDTH_FLOOR);
});

test('dense small text keeps the preferred width', () => {
  assert.equal(pickOcrWidth({ lines: 8, low: 8, median: 9, pitch: 17 }, 2400), 2400);
});

test('too few rows is not enough evidence to shrink', () => {
  assert.equal(pickOcrWidth({ lines: 2, low: 14, median: 14, pitch: 30 }, 2400), 2400);
  assert.equal(pickOcrWidth({ lines: 0, low: 0, median: 0, pitch: 0 }, 2400), 2400);
});

test('a preferred width at or below the floor is left alone', () => {
  const tall = { lines: 8, low: 20, median: 20, pitch: 30 };
  assert.equal(pickOcrWidth(tall, OCR_WIDTH_FLOOR), OCR_WIDTH_FLOOR);
  assert.equal(pickOcrWidth(tall, 1200), 1200);
});
