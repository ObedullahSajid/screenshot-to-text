import test from 'node:test';
import assert from 'node:assert/strict';
import { rebuildLayout } from '../lib/layout/rebuild.ts';
import { cleanOutput } from '../lib/clean.ts';
import { makeCellsLine, makeLine, makePage, makeParagraph } from './helpers.mjs';

test('a larger first line becomes a heading', () => {
  const heading = makeLine('Quarterly Summary', 40, 20, { charWidth: 16, height: 32 });
  const body = makeLine('Revenue grew by 18% in Q3.', 40, 90);
  const page = makePage([makeParagraph([heading]), makeParagraph([body])]);
  const { markdown, stats } = rebuildLayout(page);

  assert.match(markdown, /^#{1,3} Quarterly Summary$/m);
  assert.equal(stats.headings, 1);
});

test('bulleted lines become a Markdown list', () => {
  const page = makePage([
    makeParagraph([
      makeLine('• Faster onboarding', 40, 40),
      makeLine('• Better reporting dashboard', 40, 70),
    ]),
  ]);
  const { markdown, stats } = rebuildLayout(page);

  assert.match(markdown, /^- Faster onboarding$/m);
  assert.match(markdown, /^- Better reporting dashboard$/m);
  assert.equal(stats.listItems, 2);
});

test('a grid that covers every line of its paragraph becomes a table', () => {
  const positions = [40, 240, 440];
  const page = makePage([
    makeParagraph([
      makeCellsLine(['Region', 'Revenue', 'Growth'], positions, 40),
      makeCellsLine(['North', '120', '18%'], positions, 80),
      makeCellsLine(['South', '90', '12%'], positions, 120),
    ]),
  ]);
  const { markdown, stats } = rebuildLayout(page);

  assert.equal(stats.tables, 1);
  assert.match(markdown, /^\| Region \| Revenue \| Growth \|$/m);
  assert.match(markdown, /^\| North \| 120 \| 18% \|$/m);
});

test('a grid may not claim a paragraph it only partly covers', () => {
  // The regression this guards: the run covers three of the paragraph's five
  // lines, so rendering it as a table would silently drop the other two.
  const positions = [40, 240, 440];
  const page = makePage([
    makeParagraph([
      makeCellsLine(['Region', 'Revenue', 'Growth'], positions, 40),
      makeCellsLine(['North', '120', '18%'], positions, 80),
      makeCellsLine(['South', '90', '12%'], positions, 120),
      makeLine('These lines belong to the same paragraph.', 300, 160),
      makeLine('They must survive the layout pass.', 300, 190),
    ]),
  ]);
  const { markdown, stats } = rebuildLayout(page);

  assert.equal(stats.tables, 0);
  assert.ok(!markdown.includes('|'));
  assert.match(markdown, /These lines belong to the same paragraph\./);
  assert.match(markdown, /They must survive the layout pass\./);
});

test('wrapped prose is re-flowed into one paragraph', () => {
  const page = makePage([
    makeParagraph([
      makeLine('The quick brown', 40, 40),
      makeLine('fox jumps over', 40, 70),
      makeLine('the lazy dog', 40, 100),
    ]),
  ]);
  const { markdown } = rebuildLayout(page);

  assert.equal(markdown, 'The quick brown fox jumps over the lazy dog');
});

test('a paragraph of code lines becomes one fenced block', () => {
  const page = makePage([
    makeParagraph([
      makeLine('function add(a, b) {', 40, 40),
      makeLine('  return a + b;', 40, 70),
      makeLine('}', 40, 100),
    ]),
  ]);
  const { markdown, stats } = rebuildLayout(page);

  assert.equal(stats.codeBlocks, 1);
  assert.match(markdown, /^```\nfunction add\(a, b\) \{/m);
  assert.match(markdown, /return a \+ b;/);
});

test('compact output drops page numbers and repeated lines', () => {
  const cleaned = cleanOutput(
    ['Title', '', 'Page 3 of 9', 'Body line', 'Body line', '', '', 'Tail'].join('\n'),
    { compact: true },
  );

  assert.equal(cleaned, ['Title', '', 'Body line', '', 'Tail'].join('\n'));
});

test('compact output never edits the inside of a code fence', () => {
  const source = ['```', 'Page 3 of 9', 'x = 1', 'x = 1', '```'].join('\n');
  assert.equal(cleanOutput(source, { compact: true }), source);
});
