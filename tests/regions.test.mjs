import test from 'node:test';
import assert from 'node:assert/strict';
import { coversFullFrame, filterPageByRegions } from '../lib/layout/filter.ts';
import { makeLine, makePage, makeParagraph } from './helpers.mjs';

const LINES = [
  makeLine('Alpha line', 20, 10, { height: 20 }),
  makeLine('Beta line', 20, 50, { height: 20 }),
  makeLine('Gamma line', 20, 90, { height: 20 }),
];

function page() {
  return makePage([makeParagraph(LINES)]);
}

test('a page is only cacheable when the frame is untouched', () => {
  assert.equal(coversFullFrame([], 400, 300), true);
  assert.equal(
    coversFullFrame([{ x: 0, y: 0, width: 400, height: 300, mode: 'keep' }], 400, 300),
    true,
  );
  assert.equal(
    coversFullFrame([{ x: 0, y: 0, width: 200, height: 300, mode: 'keep' }], 400, 300),
    false,
  );
  assert.equal(
    coversFullFrame([{ x: 0, y: 200, width: 400, height: 100, mode: 'exclude' }], 400, 300),
    false,
  );
});

test('a full exclude box removes its lines and keeps the rest', () => {
  const result = filterPageByRegions(
    page(),
    [{ x: 0, y: 45, width: 400, height: 30, mode: 'exclude' }],
    1,
  );

  assert.equal(result.partial, 0);
  assert.equal(result.lines, 2);
  assert.match(result.page.text, /Alpha line/);
  assert.ok(!result.page.text.includes('Beta line'));
  assert.match(result.page.text, /Gamma line/);
});

test('an exclude box that clips a line asks for a full read', () => {
  const result = filterPageByRegions(
    page(),
    [{ x: 0, y: 40, width: 400, height: 20, mode: 'exclude' }],
    1,
  );

  assert.equal(result.partial, 1);
  assert.ok(!result.page.text.includes('Beta line'));
});

test('a keep box drops everything outside it', () => {
  const result = filterPageByRegions(
    page(),
    [{ x: 0, y: 0, width: 400, height: 80, mode: 'keep' }],
    1,
  );

  assert.equal(result.partial, 0);
  assert.equal(result.lines, 2);
  assert.match(result.page.text, /Alpha line/);
  assert.match(result.page.text, /Beta line/);
  assert.ok(!result.page.text.includes('Gamma line'));
});

test('region boxes are measured on the capture, not the prepared image', () => {
  // Twice the prepared size: a 30 px box on the capture covers 60 px of text.
  const result = filterPageByRegions(
    page(),
    [{ x: 0, y: 0, width: 400, height: 30, mode: 'keep' }],
    2,
  );

  assert.equal(result.partial, 1);
  assert.equal(result.lines, 1);
  assert.ok(result.page.text.includes('Alpha line'));
});

test('filtering keeps blocks and paragraphs consistent', () => {
  const result = filterPageByRegions(
    page(),
    [{ x: 0, y: 80, width: 400, height: 40, mode: 'keep' }],
    1,
  );

  assert.equal(result.page.blocks?.length, 1);
  assert.equal(result.page.paragraphs?.length, 1);
  assert.equal(result.page.paragraphs?.[0].lines.length, 1);
  assert.equal(result.page.paragraphs?.[0].text, 'Gamma line\n\n');
});
