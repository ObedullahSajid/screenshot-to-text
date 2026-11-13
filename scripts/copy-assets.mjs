/**
 * Copies the OCR runtime into `public/` so it ships inside the extension.
 * MV3 forbids remotely hosted code, so the worker, wasm core and language
 * model must all be local files.
 *
 * Runs automatically before `dev` and `build` (see package.json).
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');

const files = [
  [
    'node_modules/tesseract.js/dist/worker.min.js',
    'public/tesseract/worker.min.js',
    'Tesseract worker',
  ],
  [
    'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    'public/tesseract/tesseract-core-simd-lstm.wasm.js',
    'Tesseract wasm core (SIMD + LSTM)',
  ],
  [
    'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
    'public/tessdata/eng.traineddata.gz',
    'English language model',
  ],
];

for (const [from, to, label] of files) {
  const src = join(root, from);
  if (!existsSync(src)) {
    console.error(`\n[assets] Missing ${label}: ${from}`);
    console.error('[assets] Run `npm install` first.\n');
    process.exit(1);
  }
  const dest = join(root, to);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  console.log(`[assets] ${label} -> ${to}`);
}

// Apache-2.0 requires the license to travel with the distribution, so the
// notices ship inside the package rather than only in the repository.
for (const [from, to, label] of [
  ['LICENSE', 'public/LICENSE', 'License'],
  ['THIRD_PARTY_NOTICES.md', 'public/THIRD_PARTY_NOTICES.md', 'Third-party notices'],
]) {
  const src = join(root, from);
  if (!existsSync(src)) {
    console.error(`\n[assets] Missing ${from}. It is part of the repository, not a dependency.`);
    process.exit(1);
  }
  const dest = join(root, to);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  console.log(`[assets] ${label} -> ${to}`);
}

if (!existsSync(join(publicDir, 'icon', '128.png'))) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'make-icons.mjs')], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
