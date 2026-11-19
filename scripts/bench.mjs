/**
 * Timing benchmark for the on-device pipeline.
 *
 * Runs the real built extension in Chrome and calls the pipeline directly, so
 * every number comes from the same Tesseract worker, canvas code and layout
 * engine the panel uses. Stages are derived from the progress labels the
 * pipeline already emits; no production instrumentation is involved.
 *
 * Usage:
 *   npm run build && npm run bench
 *   npm run bench -- --only=article,table
 *   npm run bench -- --runs=3 --widths=2400,1600
 *
 * Writes .output/bench/timing.md and timing.json. This is a local measurement
 * tool: no thresholds are enforced, because timings vary by machine.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURES } from './fixtures.mjs';
import { ROOT, launch, openPanel, openRenderPage, renderFixture } from './lib/harness.mjs';

const OUT = join(ROOT, '.output', 'bench');

const onlyArg = process.argv.find((argument) => argument.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
const fixtures = (only ? FIXTURES.filter((fixture) => only.has(fixture.id)) : FIXTURES).slice(0, 6);

const runsArg = process.argv.find((argument) => argument.startsWith('--runs='));
const RUNS = Math.max(1, Number(runsArg?.slice('--runs='.length) ?? 1));

const widthsArg = process.argv.find((argument) => argument.startsWith('--widths='));
const WIDTHS = (widthsArg?.slice('--widths='.length) ?? '2400,1600')
  .split(',')
  .map(Number)
  .filter((value) => Number.isFinite(value) && value > 0);

function pad(value, width) {
  const text = String(value);
  return text + ' '.repeat(Math.max(0, width - text.length));
}

function table(header, rows) {
  const widths = header.map((_, column) =>
    Math.max(...[header, ...rows].map((row) => String(row[column] ?? '').length)),
  );
  const line = (row) => row.map((cell, index) => pad(cell ?? '', widths[index])).join('  ');
  return [line(header), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.map(line)].join(
    '\n',
  );
}

function round(value) {
  return Math.round(value);
}

/** Sums the time spent in each progress label, by first word group. */
function stageTimes(events, total) {
  const buckets = {};
  for (let index = 0; index < events.length; index++) {
    const next = index + 1 < events.length ? events[index + 1].at : total;
    const key = events[index].stage.split(' · ')[0];
    buckets[key] = (buckets[key] ?? 0) + Math.max(0, next - events[index].at);
  }
  return buckets;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** A tall document sliced into overlapping viewport tiles. */
async function buildLongPage(renderPage) {
  return renderPage.evaluate(() => {
    const width = 1000;
    const viewport = 800;
    const overlap = 140;
    const step = viewport - overlap;
    const height = 3200;

    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const ctx = source.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'top';
    ctx.font = '700 26px Arial';
    ctx.fillText('Long page timing report', 40, 30);
    ctx.font = '18px Arial';
    for (let index = 0; index < 88; index++) {
      const number = String(index + 1).padStart(2, '0');
      ctx.fillText(`Row ${number} alpha beta gamma delta epsilon`, 40, 90 + index * 34);
    }

    const offsets = [];
    for (let top = 0; top <= height - viewport; top += step) offsets.push(top);
    if (offsets[offsets.length - 1] !== height - viewport) offsets.push(height - viewport);

    const tiles = offsets.map((top) => {
      const tile = document.createElement('canvas');
      tile.width = width;
      tile.height = viewport;
      tile
        .getContext('2d')
        .drawImage(source, 0, top, width, viewport, 0, 0, width, viewport);
      return { dataUrl: tile.toDataURL('image/jpeg', 0.92), offset: top };
    });

    return { tiles, dpr: 1, scrollHeight: height, viewportWidth: width };
  });
}

/** A wide capture, where the OCR width cap actually changes the pixel count. */
async function buildWidePage(renderPage, fontSize) {
  return renderPage.evaluate((size) => {
    const width = 2560;
    const pitch = Math.round(size * 1.9);
    const rows = 30;
    const height = 160 + rows * pitch;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${Math.round(size * 1.8)}px Arial`;
    ctx.fillText('Wide document accuracy check', 80, 40);
    ctx.font = `${size}px Arial`;
    for (let index = 0; index < rows; index++) {
      const number = String(index + 1).padStart(2, '0');
      ctx.fillText(
        `Row ${number} the quick brown fox jumps over the lazy dog while the team reviews quarterly numbers`,
        80,
        120 + index * pitch,
      );
    }
    return canvas.toDataURL('image/png');
  }, fontSize);
}

async function measurePipeline(page, dataUrl, options) {
  return page.evaluate(
    async ({ dataUrl: source, options: pipelineOptions, runs }) => {
      const debug = window.__sttDebug;
      if (!debug) throw new Error('Open the panel with ?debug=1');
      const heap = () => performance.memory?.usedJSHeapSize ?? 0;

      const results = [];
      for (let run = 0; run < runs; run++) {
        const events = [];
        let peak = heap();
        const started = performance.now();
        const output = await debug.runPipeline(source, pipelineOptions, (stage) => {
          events.push({ stage, at: performance.now() - started });
          const used = heap();
          if (used > peak) peak = used;
        });
        results.push({
          total: performance.now() - started,
          events,
          peak,
          passes: output.passes,
          markdown: output.markdown,
          stats: output.stats,
          page: output.page,
          scale: output.scale,
        });
      }
      return results;
    },
    { dataUrl, options, runs: RUNS },
  );
}

async function measureTiled(page, capture, options) {
  return page.evaluate(
    async ({ capture: tiledCapture, options: pipelineOptions }) => {
      const debug = window.__sttDebug;
      if (!debug) throw new Error('Open the panel with ?debug=1');
      const heap = () => performance.memory?.usedJSHeapSize ?? 0;

      const events = [];
      let peak = heap();
      const started = performance.now();
      const output = await debug.runTiledPipeline(
        tiledCapture,
        pipelineOptions,
        (stage) => {
          events.push({ stage, at: performance.now() - started });
          const used = heap();
          if (used > peak) peak = used;
        },
        () => false,
      );

      return {
        total: performance.now() - started,
        events,
        peak,
        passes: output.passes,
        markdown: output.markdown,
        stats: output.stats,
        tiles: tiledCapture.tiles.length,
      };
    },
    { capture, options },
  );
}

await mkdir(OUT, { recursive: true });

const session = await launch({ headless: process.env.HEADFUL !== '1' });
const report = { generatedAt: new Date().toISOString(), runs: RUNS, fixtures: [], tiled: null, widthSweep: [] };
let exitCode = 0;

try {
  const page = await openPanel(session.browser, session.extensionId, {
    quiet: true,
    query: '?debug=1&nowarm=1',
  });
  const renderPage = await openRenderPage(session.browser);

  /* --------------------------------------------------------- engine & tokens */

  const coldEngineMs = await page.evaluate(async () => {
    const started = performance.now();
    await window.__sttDebug.getEngine();
    return performance.now() - started;
  });
  const coldTokensMs = await page.evaluate(async () => {
    const started = performance.now();
    await window.__sttDebug.countTextTokens('warm up the vocabulary');
    return performance.now() - started;
  });
  const warmTokensMs = await page.evaluate(async () => {
    const started = performance.now();
    await window.__sttDebug.countTextTokens('warm up the vocabulary');
    return performance.now() - started;
  });

  report.engine = { coldMs: round(coldEngineMs) };
  report.tokens = { coldMs: round(coldTokensMs), warmMs: round(warmTokensMs) };

  /* -------------------------------------------------------------- fixtures */

  const options = { compact: true, maxWidth: 2400 };

  // The first recognition is slower even with a loaded worker (JIT, caches), so
  // it is charged to a discarded run.
  const warmup = await renderFixture(renderPage, fixtures[0] ?? FIXTURES[0]);
  await measurePipeline(page, warmup, options);

  let regionSample = null;

  for (const fixture of fixtures) {
    const dataUrl = await renderFixture(renderPage, fixture);
    const samples = await measurePipeline(page, dataUrl, options);
    const last = samples[samples.length - 1];
    const total = median(samples.map((sample) => sample.total));
    const stages = stageTimes(last.events, last.total);
    const words = last.stats.words;
    if (!regionSample && last.page) {
      regionSample = { page: last.page, scale: last.scale, ocrMs: round(total) };
    }

    report.fixtures.push({
      id: fixture.id,
      totalMs: round(total),
      stages: Object.fromEntries(
        Object.entries(stages).map(([stage, value]) => [stage, round(value)]),
      ),
      passes: last.passes,
      words,
      peakMb: round(last.peak / (1024 * 1024)),
      msPerWord: words ? Number((total / words).toFixed(2)) : 0,
    });
    console.log(
      `  ${pad(fixture.id, 14)} ${pad(`${round(total)} ms`, 9)} ${last.passes} pass  ${words} words`,
    );
  }

  /* --------------------------------------------------------- region edits */

  if (regionSample) {
    // Cut a thin band through the widest gap between two lines, which is what
    // dragging an exclude box over a banner does. No line is clipped, so the
    // cached page answers the edit without OCR.
    report.regionEdit = await page.evaluate(
      async ({ page: recognised, scale, ocrMs, options: pipelineOptions }) => {
        const debug = window.__sttDebug;
        const lines = (recognised.blocks ?? [])
          .flatMap((block) => (block.paragraphs ?? []).flatMap((paragraph) => paragraph.lines ?? []))
          .sort((a, b) => a.bbox.y0 - b.bbox.y0);

        let gap = null;
        for (let index = 1; index < lines.length; index++) {
          const space = lines[index].bbox.y0 - lines[index - 1].bbox.y1;
          if (space > 8 && (!gap || space > gap.space)) {
            gap = { top: lines[index - 1].bbox.y1, space };
          }
        }
        // Boxes are measured on the original capture, line boxes on the
        // prepared image.
        const regions = gap
          ? [
              {
                x: 0,
                y: (gap.top + 1) / (scale || 1),
                width: 4000,
                height: 4 / (scale || 1),
                mode: 'exclude',
              },
            ]
          : [];

        const started = performance.now();
        const filtered = debug.filterPageByRegions(recognised, regions, scale ?? 1);
        const rendered = debug.renderPage(filtered.page, pipelineOptions);
        const ms = performance.now() - started;

        return {
          ms: Math.round(ms),
          ocrMs,
          partial: filtered.partial,
          lines: filtered.lines,
          kept: rendered.markdown.trim().length > 0,
        };
      },
      {
        page: regionSample.page,
        scale: regionSample.scale,
        ocrMs: regionSample.ocrMs,
        options,
      },
    );
  }

  /* ------------------------------------------------------------ long page */
  const longPage = await buildLongPage(renderPage);
  const tiled = await measureTiled(page, longPage, options);
  const tileLabels = tiled.events
    .map((event) => event.stage.split(' · ')[0])
    .filter((label) => label.startsWith('Reading tile'));
  const perTile = stageTimes(
    tiled.events.filter((event) => event.stage.startsWith('Reading tile')),
    tiled.total,
  );
  const tileOcr = Object.values(perTile);
  const ocrMs = tileOcr.reduce((total, value) => total + value, 0);

  report.tiled = {
    tiles: tiled.tiles,
    totalMs: round(tiled.total),
    ocrMs: round(ocrMs),
    perTileMs: tileOcr.map(round),
    stitchMs: round(stageTimes(tiled.events, tiled.total)['Stitching tiles'] ?? 0),
    layoutMs: round(stageTimes(tiled.events, tiled.total)['Rebuilding layout'] ?? 0),
    tokensMs: round(stageTimes(tiled.events, tiled.total)['Counting tokens'] ?? 0),
    lines: tiled.stats.words,
    peakMb: round(tiled.peak / (1024 * 1024)),
    uniqueTiles: tileLabels.length,
  };
  await writeFile(join(OUT, 'tiled.md'), tiled.markdown, 'utf8');

  /* ----------------------------------------------------------- width sweep */

  const widePages = [
    { id: 'wide 22px', dataUrl: await buildWidePage(renderPage, 22), rows: 30 },
    { id: 'dense 14px', dataUrl: await buildWidePage(renderPage, 14), rows: 30 },
  ];
  for (const widePage of widePages) {
    for (const width of WIDTHS) {
      const samples = await measurePipeline(page, widePage.dataUrl, {
        compact: true,
        maxWidth: width,
      });
      const last = samples[samples.length - 1];
      const found = new Set(
        [...last.markdown.matchAll(/Row\s*(\d{2})/g)].map((match) => Number(match[1])),
      );
      const recall =
        Array.from({ length: widePage.rows }, (_, index) => index + 1).filter((row) =>
          found.has(row),
        ).length / widePage.rows;

      report.widthSweep.push({
        page: widePage.id,
        maxWidth: width,
        totalMs: round(median(samples.map((sample) => sample.total))),
        words: last.stats.words,
        recall,
        confidence: last.stats.confidence,
      });
    }
  }
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await session.close();
}

/* ----------------------------------------------------------------- report */

if (!report.fixtures.length && exitCode === 0) {
  console.log('No fixtures matched --only.');
}

const fixtureTable = table(
  ['fixture', 'total', 'prepare', 'read', 're-read', 'tokens', 'pass', 'words', 'peak'],
  report.fixtures.map((fixture) => [
    fixture.id,
    `${fixture.totalMs} ms`,
    `${fixture.stages['Preparing image'] ?? 0} ms`,
    `${fixture.stages['Reading text'] ?? 0} ms`,
    `${fixture.stages['Re-reading (sparse layout)'] ?? 0}${
      fixture.stages['Re-reading (dense layout)']
        ? `/${fixture.stages['Re-reading (dense layout)']}`
        : ''
    } ms`,
    `${fixture.stages['Counting tokens'] ?? 0} ms`,
    fixture.passes,
    fixture.words,
    `${fixture.peakMb} MB`,
  ]),
);

const sweepTable = table(
  ['page', 'max width', 'total', 'words', 'row recall', 'confidence'],
  report.widthSweep.map((entry) => [
    entry.page,
    `${entry.maxWidth} px`,
    `${entry.totalMs} ms`,
    entry.words,
    entry.recall.toFixed(2),
    entry.confidence,
  ]),
);

const tiled = report.tiled;
const regionText = report.regionEdit
  ? `region edit: ${report.regionEdit.ms} ms without OCR (first read: ${report.regionEdit.ocrMs} ms) · ${report.regionEdit.lines} lines kept, ${report.regionEdit.partial} partial`
  : 'region edit: not measured';
const tiledText = tiled
  ? [
      `tiles: ${tiled.tiles} (${Math.round(tiled.ocrMs / Math.max(1, tiled.tiles))} ms of OCR each)`,
      `total: ${tiled.totalMs} ms · OCR ${tiled.ocrMs} ms · stitch ${tiled.stitchMs} ms · layout ${tiled.layoutMs} ms · tokens ${tiled.tokensMs} ms`,
      `words: ${tiled.lines} · peak heap ${tiled.peakMb} MB`,
      `per tile: ${tiled.perTileMs.join(', ')} ms`,
    ].join('\n')
  : 'not measured';

console.log('\nTiming benchmark\n');
console.log(`engine cold start: ${report.engine.coldMs} ms`);
console.log(
  `tokenizer: ${report.tokens.coldMs} ms cold · ${report.tokens.warmMs} ms warm (${RUNS} run${
    RUNS === 1 ? '' : 's'
  } per fixture)\n`,
);
console.log(fixtureTable);
console.log(`\n${regionText}`);
console.log(`\nLong page\n${tiledText}\n`);
console.log('Width sweep\n');
console.log(sweepTable);
console.log('');

const markdown = [
  '# Pipeline timing',
  '',
  `Generated ${report.generatedAt} · ${RUNS} run(s) per fixture · headless Chrome`,
  '',
  `Engine cold start: **${report.engine.coldMs} ms** · tokenizer **${report.tokens.coldMs} ms** cold, **${report.tokens.warmMs} ms** warm.`,
  '',
  '## Single captures',
  '',
  '```',
  fixtureTable,
  '```',
  '',
  regionText,
  '',
  '## Long page (tiled)',  '',
  '```',
  tiledText,
  '```',
  '',
  '## OCR width sweep',
  '',
  '```',
  sweepTable,
  '```',
  '',
].join('\n');

await writeFile(join(OUT, 'timing.json'), JSON.stringify(report, null, 2), 'utf8');
await writeFile(join(OUT, 'timing.md'), markdown, 'utf8');

process.exitCode = exitCode;
