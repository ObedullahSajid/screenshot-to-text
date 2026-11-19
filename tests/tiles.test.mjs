import test from 'node:test';
import assert from 'node:assert/strict';
import { planTiles, stitchTiles } from '../lib/fullpage.ts';
import { makeLine, makePage, makeParagraph } from './helpers.mjs';

test('tile offsets start at the top and end at the page bottom', () => {
  const plan = planTiles(1800, 700);

  assert.equal(plan.offsets[0], 0);
  assert.equal(plan.offsets[plan.offsets.length - 1], 1800 - 700);
  assert.equal(plan.truncated, false);
  for (let index = 1; index < plan.offsets.length; index++) {
    assert.ok(plan.offsets[index] > plan.offsets[index - 1]);
  }
});

test('a page shorter than the viewport is a single tile', () => {
  assert.deepEqual(planTiles(400, 700), { offsets: [0], overlap: 0, truncated: false });
});

test('oversized pages stop at the tile cap', () => {
  const plan = planTiles(400_000, 700);

  assert.equal(plan.offsets.length, 24);
  assert.equal(plan.truncated, true);
  assert.ok(plan.offsets[plan.offsets.length - 1] < 400_000 - 700);
});

test('a tiny viewport still advances without skipping a strip', () => {
  const plan = planTiles(1000, 100);
  const step = plan.offsets[1] - plan.offsets[0];

  assert.ok(step > 0);
  assert.ok(step <= 100);
});

function tilePage(lines) {
  return makePage([makeParagraph(lines)]);
}

test('the same line seen in two tiles is kept once', () => {
  const first = tilePage([makeLine('Alpha line', 40, 300), makeLine('Shared seam', 40, 500)]);
  const second = tilePage([makeLine('Shared seam', 40, 100), makeLine('Beta line', 40, 260)]);

  const stitched = stitchTiles([
    { page: first, offset: 0, dpr: 1, scale: 1, index: 0 },
    { page: second, offset: 400, dpr: 1, scale: 1, index: 1 },
  ]);

  assert.equal(stitched.duplicates, 1);
  assert.equal((stitched.page.text.match(/Shared seam/g) ?? []).length, 1);
});

test('stitched lines come back in page order', () => {
  const first = tilePage([makeLine('First', 40, 100)]);
  const second = tilePage([makeLine('Second', 40, 40)]);

  const stitched = stitchTiles([
    { page: first, offset: 0, dpr: 1, scale: 1, index: 0 },
    { page: second, offset: 400, dpr: 1, scale: 1, index: 1 },
  ]);

  assert.match(stitched.page.text, /First[\s\S]*Second/);
});

test('a clipped duplicate never replaces the complete line', () => {
  const full = makeLine('A complete sentence of text', 40, 500, { height: 22 });
  const clipped = makeLine('A complete sentence of te', 40, 100, { height: 9 });

  const stitched = stitchTiles([
    { page: tilePage([full]), offset: 0, dpr: 1, scale: 1, index: 0 },
    { page: tilePage([clipped]), offset: 400, dpr: 1, scale: 1, index: 1 },
  ]);

  assert.match(stitched.page.text, /A complete sentence of text/);
});

test('tiles with no lines do not break stitching', () => {
  const empty = { text: '', confidence: 0, blocks: [], paragraphs: [], lines: [] };

  const stitched = stitchTiles([
    { page: empty, offset: 0, dpr: 1, scale: 1, index: 0 },
    { page: tilePage([makeLine('Only line', 40, 40)]), offset: 400, dpr: 1, scale: 1, index: 1 },
  ]);

  assert.equal(stitched.lines, 1);
  assert.match(stitched.page.text, /Only line/);
});
