/**
 * Offline accuracy benchmark.
 *
 * Drives the real built extension in Chrome over a set of synthetic captures
 * and scores the Markdown it produces, so a layout or preprocessing change can
 * be judged by numbers instead of vibes.
 *
 * Usage: npm run build && node scripts/benchmark.mjs   (HEADFUL=1 to watch)
 *        node scripts/benchmark.mjs --only=table,list
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURES } from './fixtures.mjs';
import {
  ROOT,
  dropDataUrl,
  launch,
  openPanel,
  openRenderPage,
  readResultMeta,
  renderFixture,
  startOver,
  waitForResult,
} from './lib/harness.mjs';

const OUT = join(ROOT, '.output', 'bench');
const RECALL_GATE = 0.75;

const onlyArg = process.argv.find((argument) => argument.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
const fixtures = only ? FIXTURES.filter((fixture) => only.has(fixture.id)) : FIXTURES;

/** Punctuation-insensitive comparison; keeps numbers and currency marks. */
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9$%+\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phraseRecall(markdown, phrases) {
  if (!phrases.length) return 1;
  const haystack = normalize(markdown);
  const found = phrases.filter((phrase) => haystack.includes(normalize(phrase))).length;
  return found / phrases.length;
}

function pad(value, width) {
  const text = String(value);
  return text + ' '.repeat(Math.max(0, width - text.length));
}

await mkdir(OUT, { recursive: true });

const session = await launch({ headless: process.env.HEADFUL !== '1' });
const results = [];

try {
  const page = await openPanel(session.browser, session.extensionId, { quiet: true });
  const renderPage = await openRenderPage(session.browser);

  if (!process.env.HEADFUL) {
    // Warm-up: the first recognition pays for the ~7 MB engine load. Charge it
    // to a discarded run so the per-fixture timings stay comparable.
    const warmup = await renderFixture(renderPage, fixtures[0]);
    await dropDataUrl(page, warmup, 'warmup.png');
    await waitForResult(page);
    await startOver(page);
  }

  for (const fixture of fixtures) {
    const dataUrl = await renderFixture(renderPage, fixture);
    await writeFile(
      join(OUT, `${fixture.id}.png`),
      Buffer.from(dataUrl.split(',')[1], 'base64'),
    );

    const started = Date.now();
    await dropDataUrl(page, dataUrl, `${fixture.id}.png`);
    const markdown = await waitForResult(page);
    const ms = Date.now() - started;
    const meta = await readResultMeta(page);
    await writeFile(join(OUT, `${fixture.id}.md`), markdown, 'utf8');

    const recall = phraseRecall(markdown, fixture.phrases);
    const checks = fixture.checks.map(([label, pattern]) => ({
      label,
      passed: pattern.test(markdown),
    }));
    const structureOk = checks.every((entry) => entry.passed);
    const notesOk = (fixture.notes ?? []).every((note) =>
      meta.notes.some((chip) => chip.includes(note)),
    );
    const passed =
      (!fixture.gated || (recall >= RECALL_GATE && structureOk)) && notesOk;

    results.push({
      id: fixture.id,
      gated: Boolean(fixture.gated),
      ms,
      recall,
      structureOk,
      notesOk,
      checks,
      passed,
      meta,
      markdown,
    });

    await startOver(page);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await session.close();
}

/* ------------------------------------------------------------------ report */

const header = ['fixture', 'gate', 'recall', 'conf', 'time', 'pass', 'sharp', 'contr', 'notes', 'status'];
const rows = results.map((result) => [
  result.id,
  result.gated ? 'gate' : 'info',
  result.recall.toFixed(2),
  result.meta.confidence || '-',
  `${result.ms}ms`,
  result.meta.passes || '-',
  result.meta.sharpness || '-',
  result.meta.contrast || '-',
  result.meta.notes.join(', ') || '-',
  result.passed ? 'ok' : 'FAIL',
]);

const widths = header.map((_, column) =>
  Math.max(...[header, ...rows].map((row) => String(row[column]).length)),
);

console.log('\nOffline OCR benchmark\n');
console.log(header.map((cell, index) => pad(cell, widths[index])).join('  '));
console.log(widths.map((width) => '-'.repeat(width)).join('  '));
for (const row of rows) {
  console.log(row.map((cell, index) => pad(cell, widths[index])).join('  '));
}

for (const result of results) {
  const failedChecks = result.checks.filter((entry) => !entry.passed);
  if (failedChecks.length) {
    console.log(`\n  ${result.id}: failed structure ${failedChecks.map((c) => c.label).join(', ')}`);
    console.log('  ' + result.markdown.replace(/\n/g, '\n  ').slice(0, 600));
  }
  if (!result.notesOk) {
    console.log(`\n  ${result.id}: missing quality note (got: ${result.meta.notes.join(', ') || 'none'})`);
  }
}

const gated = results.filter((result) => result.gated);
const meanRecall = gated.length
  ? gated.reduce((total, result) => total + result.recall, 0) / gated.length
  : 0;
const meanTime = results.length
  ? results.reduce((total, result) => total + result.ms, 0) / results.length
  : 0;
const failed = results.filter((result) => !result.passed);

console.log(
  `\ngated recall ${meanRecall.toFixed(3)} · mean ${Math.round(meanTime)} ms/capture · ` +
    `${failed.length ? `${failed.length} failing` : 'all passing'}\n`,
);

const summary = {
  generatedAt: new Date().toISOString(),
  recallGate: RECALL_GATE,
  meanRecall,
  meanMs: Math.round(meanTime),
  failed: failed.map((result) => result.id),
  results,
};
await writeFile(join(OUT, 'benchmark.json'), JSON.stringify(summary, null, 2), 'utf8');

const markdown = [
  '# OCR benchmark',
  '',
  `Generated ${summary.generatedAt}`,
  '',
  `| ${header.join(' | ')} |`,
  `| ${header.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.join(' | ')} |`),
  '',
  `Gated recall: **${meanRecall.toFixed(3)}** (gate ${RECALL_GATE}) · mean **${Math.round(meanTime)} ms** per capture.`,
  '',
];
await writeFile(join(OUT, 'benchmark.md'), markdown.join('\n'), 'utf8');

if (process.exitCode !== 1) process.exitCode = failed.length ? 1 : 0;
