import test from 'node:test';
import assert from 'node:assert/strict';
import { looksBlank } from '../lib/preprocess.ts';

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
