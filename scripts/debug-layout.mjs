/**
 * Debug helper: runs the same Tesseract configuration on a fixture and dumps
 * the raw block/paragraph/line geometry, then the Markdown produced by the
 * layout rebuild. No extension, no browser.
 *
 * Usage: node scripts/debug-layout.mjs [path/to/image.png]
 */
import { createWorker, OEM, PSM } from 'tesseract.js';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imagePath = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : join(root, '.output', 'e2e-fixture.png');

const worker = await createWorker('eng', OEM.LSTM_ONLY, {
  langPath: join(root, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int'),
  gzip: true,
  cacheMethod: 'none',
});

await worker.setParameters({
  tessedit_pageseg_mode: PSM.AUTO,
  user_defined_dpi: '150',
  preserve_interword_spaces: '1',
});

const { data } = await worker.recognize(imagePath, {}, { blocks: true, text: true });
await worker.terminate();

console.log('--- page text ---');
console.log(data.text);

for (const [index, block] of (data.blocks ?? []).entries()) {
  console.log(
    `\nBLOCK ${index} [${block.blocktype}] conf=${Math.round(block.confidence)} box=${JSON.stringify(block.bbox)} text=${JSON.stringify(block.text)}`,
  );
  for (const [pIndex, paragraph] of (block.paragraphs ?? []).entries()) {
    console.log(`  P${pIndex} box=${JSON.stringify(paragraph.bbox)} text=${JSON.stringify(paragraph.text)}`);
    for (const line of paragraph.lines ?? []) {
      console.log(`    L box=${JSON.stringify(line.bbox)} text=${JSON.stringify(line.text)}`);
      console.log(`      row=${JSON.stringify(line.rowAttributes)}`);
      console.log(
        '      words=' +
          JSON.stringify(
            (line.words ?? []).map((word) => ({
              t: word.text,
              x: [Math.round(word.bbox.x0), Math.round(word.bbox.x1)],
              y: [Math.round(word.bbox.y0), Math.round(word.bbox.y1)],
            })),
          ),
      );
    }
  }
}

await writeFile(join(root, '.output', 'ocr-debug.json'), JSON.stringify(data, null, 2), 'utf8');

const { rebuildLayout } = await import('../lib/layout/rebuild.ts');
const layout = rebuildLayout(data);
console.log('\n--- rebuilt markdown ---');
console.log(layout.markdown);
console.log('\n--- stats ---');
console.log(layout.stats);
