/**
 * End-to-end smoke test in real Chrome.
 *
 * Loads the built extension, renders two synthetic screenshots inside the panel
 * (a document with a table/list and a dark-mode code block), and checks the
 * Markdown that comes back. It also asserts that nothing went to the network:
 * the manifest CSP must block it, and no outbound request may be observed.
 *
 * The second half covers full-page capture: a deterministic tile-stitching test,
 * a two-tile OCR run, and a real scroll-and-capture loop against a tall local
 * page (using a temporary `<all_urls>` copy, because Chrome only grants
 * activeTab from a real toolbar click).
 *
 * Usage: npm run build && node scripts/e2e.mjs   (HEADFUL=1 for a visible window)
 */
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { join } from 'node:path';
import {
  ROOT,
  clickSelector,
  dropDataUrl,
  launch,
  launchWithHostAccess,
  openPanel,
  openPanelWindow,
  readResultMeta,
  startOver,
  waitForResult,
} from './lib/harness.mjs';

let failures = 0;
function check(label, passed) {
  if (!passed) failures++;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
}

const externalRequests = new Set();
const session = await launch({ headless: process.env.HEADFUL !== '1' });

try {
  console.log(`extension id: ${session.extensionId}`);

  const page = await openPanel(session.browser, session.extensionId, {
    onRequest: (url) => {
      if (/^(https?|wss?):/i.test(url)) externalRequests.add(url);
    },
  });

  /* ------------------------------------------------ fixture 1: document */

  const documentImage = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 780;
    canvas.height = 470;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'top';

    ctx.font = '700 30px Arial';
    ctx.fillText('Quarterly Summary', 40, 32);

    ctx.font = '17px Arial';
    ctx.fillText('Revenue grew by 18% in Q3, driven by enterprise accounts.', 40, 92);
    ctx.fillText('The team shipped four major releases this quarter.', 40, 120);

    ctx.font = '700 19px Arial';
    ctx.fillText('Highlights', 40, 168);

    ctx.font = '17px Arial';
    ctx.fillText('\u2022  Faster onboarding flow', 56, 204);
    ctx.fillText('\u2022  Better reporting dashboard', 56, 232);
    ctx.fillText('\u2022  Three new integrations', 56, 260);

    const left = 40;
    const top = 310;
    const widths = [180, 150, 150];
    const rowHeight = 40;
    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 2;
    const rows = [
      ['Region', 'Revenue', 'Growth'],
      ['North America', '$4.2M', '+22%'],
      ['Europe', '$2.8M', '+11%'],
    ];
    rows.forEach((row, rowIndex) => {
      let x = left;
      row.forEach((cell, columnIndex) => {
        ctx.fillStyle = rowIndex === 0 ? '#111111' : '#222222';
        ctx.font = rowIndex === 0 ? '700 16px Arial' : '16px Arial';
        ctx.fillText(cell, x + 10, top + rowIndex * rowHeight + 11);
        ctx.strokeRect(x, top + rowIndex * rowHeight, widths[columnIndex], rowHeight);
        x += widths[columnIndex];
      });
    });

    return canvas.toDataURL('image/png');
  });

  await writeFile(
    join(ROOT, '.output', 'e2e-fixture.png'),
    Buffer.from(documentImage.split(',')[1], 'base64'),
  );

  const started = Date.now();
  await dropDataUrl(page, documentImage, 'document.png');
  const markdown = await waitForResult(page);
  const summary = await readResultMeta(page);

  console.log(`\nOCR finished in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  console.log('--- markdown ---');
  console.log(markdown);
  console.log('--- stats ---');
  console.log({ stats: summary.tokens + ' tokens', confidence: summary.confidence });

  await writeFile(join(ROOT, '.output', 'e2e-result.md'), markdown, 'utf8');
  await page.screenshot({ path: join(ROOT, '.output', 'e2e-panel.png'), fullPage: true });

  check('heading text', /Quarterly Summary/.test(markdown));
  check('body text', /Revenue grew by 18%/.test(markdown));
  check('list item', /^\s*[-*]\s+Faster onboarding/m.test(markdown));
  check('table syntax', /\|\s*Region\s*\|/.test(markdown));
  check('no external requests', externalRequests.size === 0);

  /* ------------------------------------------------------- output presets */

  await clickSelector(page, '[data-view="text"]');
  const plain = await page.$eval('.raw', (element) => element.textContent ?? '');
  check('plain text drops heading markers', !/^#/m.test(plain));
  check('plain text drops table pipes', !plain.includes('|'));
  check('plain text keeps table cells', /Region\tRevenue\tGrowth/.test(plain));
  check('plain text keeps bullets', /•\s+Faster onboarding/.test(plain));

  await clickSelector(page, '[data-view="outline"]');
  const outline = await page.$eval('.raw', (element) => element.textContent ?? '');
  check('outline keeps the heading', /^#+\s+Quarterly Summary/m.test(outline));
  check('outline keeps list items', /Faster onboarding/.test(outline));
  check('outline drops body copy', !/Revenue grew by 18%/.test(outline));

  await clickSelector(page, '[data-view="markdown"]');
  const restored = await page.$eval('#markdown-editor', (element) => element.value);
  check('markdown tab restores the editor', restored === markdown);

  /* ------------------------------------------------ fixture 2: dark code */

  await startOver(page);

  const codeImage = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 230;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e8e8e8';
    ctx.font = '17px Consolas, monospace';
    ctx.fillText('function add(a, b) {', 36, 52);
    ctx.fillText('  return a + b;', 36, 90);
    ctx.fillText('}', 36, 128);
    ctx.fillText('const total = add(2, 3);', 36, 166);
    return canvas.toDataURL('image/png');
  });

  await writeFile(
    join(ROOT, '.output', 'e2e-code-fixture.png'),
    Buffer.from(codeImage.split(',')[1], 'base64'),
  );

  await dropDataUrl(page, codeImage, 'code.png');
  const codeMarkdown = await waitForResult(page);
  const codeMeta = await readResultMeta(page);
  console.log('\n--- dark code markdown ---');
  console.log(codeMarkdown);

  check('code fence', /```/.test(codeMarkdown));
  check('code body', /return a \+ b;/.test(codeMarkdown));
  check(
    'dark mode inverted',
    await page.$eval('.result-sub', (element) =>
      (element.textContent ?? '').includes('dark mode inverted'),
    ),
  );
  check('still no external requests', externalRequests.size === 0);

  /* ---------------------------------------------------- regions + quality */

  check('quality metrics recorded', Number(codeMeta.sharpness) > 0);

  await clickSelector(page, '[aria-label="Select regions"]');
  const regionsOpened = await page
    .waitForSelector('.region-card', { timeout: 3_000 })
    .then(() => true)
    .catch(() => false);

  if (regionsOpened) {
    check(
      'region dialog opens on the whole image',
      await page.$eval('.region-dims', (element) => element.textContent === 'Whole image'),
    );

    await clickSelector(page, '[aria-label="Add a region box"]');
    const sizeBefore = await page.$eval('.region-dims', (element) => element.textContent ?? '');
    check('region dialog shows dimensions', /\d+ × \d+ px/.test(sizeBefore));

    const handle = await page.$('.region-handle--se');
    const box = await handle?.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x - 32, box.y - 24, { steps: 6 });
      await page.mouse.up();
    }
    const sizeAfter = await page.$eval('.region-dims', (element) => element.textContent ?? '');
    check('dragging a handle resizes the region', sizeAfter !== sizeBefore);

    await clickSelector(page, '.region-card .btn-primary');
    await page.waitForSelector('.region-card', { hidden: true, timeout: 5_000 });
    const cropped = await waitForResult(page);
    check('region selection re-runs the pipeline', cropped.trim().length > 0);
  } else {
    check('region dialog opens', false);
  }

  /* ------------------------------------------------------ append + merge */

  await startOver(page);

  const captureLines = (lines) =>
    page.evaluate((values) => {
      const canvas = document.createElement('canvas');
      canvas.width = 560;
      canvas.height = 220;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#111111';
      ctx.textBaseline = 'top';
      ctx.font = '20px Arial';
      values.forEach((line, index) => {
        ctx.fillText(`\u2022  ${line}`, 40, 32 + index * 52);
      });
      return canvas.toDataURL('image/png');
    }, lines);

  const firstPage = await captureLines([
    'Alpha entry 1',
    'Shared entry 42',
    'Shared entry 43',
  ]);
  await dropDataUrl(page, firstPage, 'append-first.png');
  const firstMarkdown = await waitForResult(page);
  check(
    'append base extracted',
    /Shared entry 42/.test(firstMarkdown) && /Shared entry 43/.test(firstMarkdown),
  );

  await clickSelector(page, '[aria-label="Add another capture"]');
  await page.waitForSelector('.dropzone', { timeout: 5_000 });
  check('append banner visible', Boolean(await page.$('.append-banner')));
  await page.screenshot({ path: join(ROOT, '.output', 'e2e-append.png'), fullPage: true });

  const secondPage = await captureLines([
    'Shared entry 42',
    'Shared entry 43',
    'Beta entry 7',
  ]);
  await dropDataUrl(page, secondPage, 'append-second.png');
  const merged = await waitForResult(page);

  const occurrences = (value, needle) => value.split(needle).length - 1;
  check('append keeps the earlier capture', /Alpha entry 1/.test(merged));
  // Tesseract sometimes drops the space between two words; match the letters.
  check('append adds the new capture', /Beta\s*entry\s*7/.test(merged));
  check(
    'append removes repeated lines',
    occurrences(merged, 'Shared entry 42') === 1 &&
      occurrences(merged, 'Shared entry 43') === 1,
  );
  check(
    'append reports the capture count',
    await page.$eval('.result-sub', (element) =>
      (element.textContent ?? '').includes('2 captures merged'),
    ),
  );

  /* ------------------------------------------------------- label/value pairs */

  await startOver(page);

  const panelImage = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 560;
    canvas.height = 190;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'top';
    ctx.font = '700 20px Arial';
    ctx.fillText('Preferences', 32, 20);

    ctx.font = '16px Arial';
    const rows = [
      ['Compact output', 'On'],
      ['Max image width', '2400 px'],
    ];
    rows.forEach((row, index) => {
      const y = 74 + index * 44;
      ctx.fillText(row[0], 32, y);
      ctx.fillText(row[1], 380, y);
      ctx.strokeStyle = '#444444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(32, y + 28);
      ctx.lineTo(528, y + 28);
      ctx.stroke();
    });
    return canvas.toDataURL('image/png');
  });

  await dropDataUrl(page, panelImage, 'panel.png');
  const panelMarkdown = await waitForResult(page);
  check('label/value pairing', /^Compact output: On/m.test(panelMarkdown));
  check('no invented table header', !/\|\s*Compact output/.test(panelMarkdown));

  /* --------------------------------------------------- keep/exclude regions */

  await startOver(page);

  const bannerImage = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 680;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // A nav/cookie banner that should be cut out.
    ctx.fillStyle = '#dbeafe';
    ctx.fillRect(0, 0, canvas.width, 84);
    ctx.fillStyle = '#0f172a';
    ctx.textBaseline = 'top';
    ctx.font = '700 22px Arial';
    ctx.fillText('Cookie banner - Accept all', 28, 26);

    // The article body that should survive.
    ctx.fillStyle = '#111111';
    ctx.font = '700 26px Arial';
    ctx.fillText('Quarterly report', 28, 132);
    ctx.font = '18px Arial';
    ctx.fillText('Revenue grew by 18 percent', 28, 188);
    ctx.fillText('Second body line', 28, 222);
    return canvas.toDataURL('image/png');
  });

  await dropDataUrl(page, bannerImage, 'banner.png');
  const wholeMarkdown = await waitForResult(page);
  check('banner text is read before exclusion', /Cookie/i.test(wholeMarkdown));

  const dragOnFrame = async (fromX, fromY, toX, toY) => {
    const frame = await page.$('.region-frame');
    const bounds = await frame?.boundingBox();
    if (!bounds) throw new Error('Region frame is not visible');
    await page.mouse.move(bounds.x + bounds.width * fromX, bounds.y + bounds.height * fromY);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * toX, bounds.y + bounds.height * toY, {
      steps: 8,
    });
    await page.mouse.up();
  };

  await clickSelector(page, '[aria-label="Select regions"]');
  await page.waitForSelector('.region-card', { timeout: 3_000 });
  await clickSelector(page, '.region-mode[data-mode="exclude"]');
  await dragOnFrame(0.04, 0.02, 0.96, 0.33);
  await page.waitForSelector('.region-box--exclude', { timeout: 2_000 });
  check('exclude box added', (await page.$$('.region-box--exclude')).length === 1);
  await page.screenshot({ path: join(ROOT, '.output', 'e2e-regions.png'), fullPage: true });

  const beforeNudge = await page.$eval(
    '.region-box--exclude',
    (element) => element.style.left,
  );
  await page.keyboard.press('ArrowLeft');
  const afterNudge = await page.$eval(
    '.region-box--exclude',
    (element) => element.style.left,
  );
  check('arrow keys nudge a selected region', beforeNudge !== afterNudge);

  await clickSelector(page, '.region-card .btn-primary');
  await page.waitForSelector('.region-card', { hidden: true, timeout: 5_000 });
  const excluded = await waitForResult(page);
  check('excluded text is removed', !/Cookie/i.test(excluded));
  check('body text survives an exclusion', /Quarterly report/.test(excluded));
  check(
    'region count is shown on the result',
    /Regions \(1\)/.test(
      await page.$eval('[aria-label="Select regions"]', (element) => element.textContent ?? ''),
    ),
  );

  // A keep box is the mirror case: only the selected area is read.
  await clickSelector(page, '[aria-label="Select regions"]');
  await page.waitForSelector('.region-card', { timeout: 3_000 });
  await clickSelector(page, '[data-action="reset"]');
  await clickSelector(page, '.region-mode[data-mode="keep"]');
  await dragOnFrame(0.04, 0.38, 0.96, 0.95);
  await page.waitForSelector('.region-box--keep', { timeout: 2_000 });
  check('keep box added', (await page.$$('.region-box--keep')).length === 1);

  await clickSelector(page, '.region-card .btn-primary');
  await page.waitForSelector('.region-card', { hidden: true, timeout: 5_000 });
  const kept = await waitForResult(page);
  check('only the kept region is read', !/Cookie/i.test(kept) && /Revenue grew by 18/.test(kept));

  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.screenshot({ path: join(ROOT, '.output', 'e2e-light.png'), fullPage: true });

  /* ----------------------------------------- full-page tiling + stitching */

  const debugPage = await openPanel(session.browser, session.extensionId, {
    quiet: true,
    query: '?debug=1',
  });

  // Deterministic maths: overlapping synthetic OCR lines stitched by position.
  const stitchMath = await debugPage.evaluate(() => {
    const debug = window.__sttDebug;
    if (!debug) return null;

    const lineHeight = 24;
    const first = 12;
    const total = 29;
    const viewport = 400;
    const pageHeight = first + total * lineHeight;

    const makeTile = (offset, index) => {
      const lines = [];
      for (let i = 0; i < total; i++) {
        const y0 = first + i * lineHeight;
        const y1 = y0 + 16;
        if (y0 < offset || y1 > offset + viewport) continue;
        // The overlap lines are deliberately truncated in the second tile: the
        // stitcher must keep the complete text from the first one.
        const clipped = offset > 0 && y0 < offset + 80;
        const number = String(i + 1).padStart(2, '0');
        lines.push({
          text: clipped ? `Line ${number} alp` : `Line ${number} alpha beta`,
          confidence: clipped ? 52 : 92,
          bbox: { x0: 40, y0: y0 - offset, x1: 340, y1: y1 - offset },
          words: [],
        });
      }
      const bbox = lines.reduce(
        (box, line) => ({
          x0: Math.min(box.x0, line.bbox.x0),
          y0: Math.min(box.y0, line.bbox.y0),
          x1: Math.max(box.x1, line.bbox.x1),
          y1: Math.max(box.y1, line.bbox.y1),
        }),
        { x0: 1e6, y0: 1e6, x1: 0, y1: 0 },
      );
      const text = lines.map((line) => `${line.text}\n`).join('');
      return {
        page: {
          text,
          confidence: 92,
          blocks: [
            {
              text,
              confidence: 92,
              bbox,
              blocktype: 'text',
              paragraphs: [{ text, confidence: 92, bbox, lines }],
            },
          ],
          paragraphs: [],
          lines: [],
        },
        offset,
        dpr: 1,
        scale: 1,
        index,
      };
    };

    const stitched = debug.stitchTiles([makeTile(0, 0), makeTile(308, 1)]);
    const layout = debug.rebuildLayout(stitched.page);
    const found = [...layout.markdown.matchAll(/Line (\d{2})/g)].map((match) => match[1]);
    const plan = debug.planTiles(pageHeight, viewport);
    const capped = debug.planTiles(400_000, viewport);
    const tiny = debug.planTiles(1000, 100);

    return {
      duplicates: stitched.duplicates,
      lines: stitched.lines,
      found,
      unique: new Set(found).size,
      truncatedWon: /Line \d{2} alp(?![a-z])/.test(layout.markdown),
      planOffsets: plan.offsets,
      cappedCount: capped.offsets.length,
      cappedTruncated: capped.truncated,
      cappedLast: capped.offsets[capped.offsets.length - 1],
      cappedMax: 400_000 - viewport,
      tinyGap: tiny.offsets[1] - tiny.offsets[0],
      tinyViewport: 100,
    };
  });

  check('debug hook is opt-in', stitchMath !== null);
  if (stitchMath) {
    const expected = Array.from({ length: 29 }, (_, index) =>
      String(index + 1).padStart(2, '0'),
    ).join(',');
    check(
      'tile plan ends exactly at the page bottom',
      stitchMath.planOffsets[stitchMath.planOffsets.length - 1] === 708 - 400,
    );
    check(
      'oversized pages stop at the tile cap',
      stitchMath.cappedCount === 24 &&
        stitchMath.cappedTruncated &&
        stitchMath.cappedLast < stitchMath.cappedMax,
    );
    check(
      'a short viewport never skips a strip',
      stitchMath.tinyGap > 0 && stitchMath.tinyGap <= stitchMath.tinyViewport,
    );
    check(
      'overlap dedupe keeps every line exactly once',
      stitchMath.lines === 29 &&
        stitchMath.found.length === 29 &&
        stitchMath.unique === 29 &&
        stitchMath.duplicates === 3,
    );
    check('a clipped seam line never wins', !stitchMath.truncatedWon);
    check('stitched lines keep reading order', stitchMath.found.join(',') === expected);
  }

  // Real OCR through the tiled pipeline: two overlapping viewports of a tall
  // synthetic page. This is the path the Full page button uses.
  const tiled = await debugPage.evaluate(async () => {
    const debug = window.__sttDebug;
    if (!debug) return null;

    const width = 900;
    const height = 1410;
    const viewport = 760;
    const offset = 640;

    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const ctx = source.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'top';
    ctx.font = '700 26px Arial';
    ctx.fillText('Scroll report', 40, 30);
    ctx.font = '18px Arial';
    for (let index = 0; index < 40; index++) {
      const number = String(index + 1).padStart(2, '0');
      ctx.fillText(`Row ${number} apple banana cherry`, 40, 90 + index * 32);
    }

    const makeTile = (top) => {
      const tile = document.createElement('canvas');
      tile.width = width;
      tile.height = viewport;
      tile
        .getContext('2d')
        .drawImage(source, 0, top, width, viewport, 0, 0, width, viewport);
      return tile.toDataURL('image/jpeg', 0.92);
    };

    const output = await debug.runTiledPipeline(
      {
        tiles: [
          { dataUrl: makeTile(0), offset: 0 },
          { dataUrl: makeTile(offset), offset },
        ],
        dpr: 1,
        scrollHeight: height,
        viewportWidth: width,
      },
      { compact: true, maxWidth: 2400 },
      () => {},
      () => false,
    );

    const found = [...output.markdown.matchAll(/Row (\d{2})/g)].map((match) => match[1]);
    return {
      found,
      unique: new Set(found).size,
      thumb: output.thumb.startsWith('data:image/jpeg'),
      width: output.width,
      height: output.height,
      imageTokens: output.imageTokens,
    };
  });

  if (tiled) {
    const expected = Array.from({ length: 40 }, (_, index) =>
      String(index + 1).padStart(2, '0'),
    ).join(',');
    check('tiled OCR keeps all 40 rows once', tiled.found.length === 40 && tiled.unique === 40);
    check('tiled OCR keeps reading order', tiled.found.join(',') === expected);
    check(
      'tiled result measures the whole page',
      tiled.width === 900 &&
        tiled.height === 1410 &&
        tiled.thumb &&
        tiled.imageTokens > 0,
    );
  }
  await debugPage.close();

  /* --------------------------------------------------------------- CSP */

  const violations = await page.evaluate(() => window.__sttViolations ?? []);
  const networkViolations = violations.filter((entry) =>
    /connect-src|img-src|script-src/.test(entry.directive),
  );
  if (networkViolations.length) console.error(networkViolations);
  check('CSP blocked no needed resource', networkViolations.length === 0);
  check('no outbound network observed', externalRequests.size === 0);

  /* --------------------------------------- page access without a grant */

  await runAccessErrorCheck();

  /* ------------------------------------------ real full-page capture loop */

  await runLiveFullPage();
} catch (error) {
  console.error(error);
  failures++;
} finally {
  await session.close();
}

process.exitCode = failures ? 1 : 0;

/**
 * A panel that was opened without invoking the extension has no page access:
 * Chrome only grants `activeTab` from a real toolbar click, a keyboard command
 * or a context menu. The capture has to say so instead of blaming the page.
 */
async function runAccessErrorCheck() {
  const backgroundSource = await readFile(
    join(ROOT, '.output', 'chrome-mv3', 'background.js'),
    'utf8',
  );
  check(
    'the toolbar icon stays a real invocation',
    /openPanelOnActionClick\s*:\s*(!1|false)/.test(backgroundSource) &&
      !/openPanelOnActionClick\s*:\s*(!0|true)/.test(backgroundSource),
  );

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      '<!doctype html><meta charset="utf-8"><title>Local page</title><h1>Hello</h1>',
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const target = await session.browser.newPage();
    await target.goto(`http://127.0.0.1:${port}/`);
    await target.bringToFront();

    // The panel lives in its own window, so the local page stays the active tab
    // of the other one — the state a user is in when the panel was opened from
    // Chrome's side panel picker rather than from the toolbar icon.
    const panel = await openPanelWindow(session.browser, session.extensionId, {
      query: '?access=1',
    });

    await clickSelector(panel, '.capture-actions .btn-primary');
    await panel.waitForSelector('.error', { timeout: 15_000 });

    const title = await panel.$eval('.error-title', (element) => element.textContent?.trim() ?? '');
    const hint = await panel.$eval('.error-hint', (element) => element.textContent?.trim() ?? '');

    check('a missing grant is not blamed on the page', !/does not allow capturing/i.test(title));
    check('the panel reports the missing page access', /access/i.test(title));
    check('the panel explains how to grant access', /extension icon/i.test(hint));

    await target.close().catch(() => {});
  } finally {
    server.close();
  }
}

/**
 * Exercises the real background capture loop against a tall local page:
 * scroll, photograph each viewport, restore the scroll position, then run the
 * tiles through OCR. Chrome will not open a side panel without a user gesture,
 * so the panel lives in its own window and the build gets `<all_urls>` for the
 * duration of the test (see `launchWithHostAccess`).
 */
async function runLiveFullPage() {
  const paragraphs = Array.from(
    { length: 70 },
    (_, index) =>
      `<p>Paragraph ${String(index + 1).padStart(2, '0')} apple banana cherry dolphin.</p>`,
  ).join('\n');

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><meta charset="utf-8"><title>Tall page</title>
<style>
  body { margin: 0; font: 16px/1.6 Arial; color: #111; }
  .nav { position: fixed; inset: 0 0 auto 0; background: #eef2ff; padding: 12px 24px; font-weight: 700; }
  main { padding: 90px 40px 40px; }
  h1 { font-size: 28px; margin: 0 0 20px; }
</style>
<div class="nav">STICKY NAVIGATION BAR</div>
<main>
  <h1>Offline capture report</h1>
  ${paragraphs}
</main>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const live = await launchWithHostAccess({ protocolTimeout: 300_000 });
  try {
    const tall = await live.browser.newPage();
    await tall.setViewport({ width: 1000, height: 800 });
    await tall.goto(`http://127.0.0.1:${port}/`);
    await tall.bringToFront();

    const panel = await openPanelWindow(live.browser, live.extensionId);

    // The panel opens in its own focused window, which covers the tall page.
    // Chrome then throttles that page and can hand `captureVisibleTab` a stale
    // compositor frame, which shows up as a hole in the stitched output. Keep
    // the captured tab in front; the panel only talks to the service worker.
    await tall.bringToFront();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const capture = await panel.evaluate(async () => {
      return chrome.runtime.sendMessage({ type: 'stt:capture-full' });
    });

    const tiles = capture?.tiles ?? [];
    check('full-page capture returns overlapping tiles', Boolean(capture?.ok) && tiles.length >= 2);
    if (!capture?.ok) {
      console.error('full-page capture failed:', capture);
      return;
    }

    const last = tiles[tiles.length - 1].offset;
    check(
      'the last tile lands on the page bottom',
      Math.abs(last - (capture.scrollHeight - capture.viewportHeight)) <= 1,
    );
    check('repeating page chrome is tagged', capture.hidden >= 1);

    console.log('tile offsets:', tiles.map((tile) => tile.offset).join(', '));

    const result = await panel.evaluate(async (input) => {
      window.__sttTrace = true;
      const output = await window.__sttDebug.runTiledPipeline(
        input,
        { compact: true, maxWidth: 2400 },
        () => {},
        () => false,
      );
      const numbers = [...output.markdown.matchAll(/Paragraph (\d{2})/g)].map(
        (match) => match[1],
      );
      const expected = Array.from({ length: 70 }, (_, index) =>
        String(index + 1).padStart(2, '0'),
      );
      const seen = new Set(numbers);
      return {
        unique: seen.size,
        count: numbers.length,
        first: numbers[0],
        last: numbers[numbers.length - 1],
        missing: expected.filter((number) => !seen.has(number)),
        duplicated: [...seen].filter(
          (number) => numbers.filter((value) => value === number).length > 1,
        ),
        sticky: (output.markdown.match(/STICKY NAVIGATION BAR/g) ?? []).length,
      };
    }, {
      tiles,
      dpr: capture.dpr,
      scrollHeight: capture.scrollHeight,
      viewportWidth: capture.viewportWidth,
    });

    if (result.unique !== 70 || result.count !== 70) {
      console.error('tiled page mismatch:', {
        unique: result.unique,
        count: result.count,
        missing: result.missing,
        duplicated: result.duplicated,
      });
      const trace = await panel.evaluate(() => {
        window.__sttTrace = false;
        return window.__sttTraceData ?? null;
      });
      console.error('stitch tiles:', JSON.stringify(trace?.tiles ?? []));
      for (const pair of trace?.pairs ?? []) {
        console.error('stitch pair:', JSON.stringify(pair));
      }
    }

    check('a five-tile page comes back whole', result.unique === 70 && result.count === 70);
    check(
      'tile seams keep the first and last paragraph',
      result.first === '01' && result.last === '70',
    );
    check('a fixed header is captured once', result.sticky === 1);
    check(
      'the page scroll position is restored',
      (await tall.evaluate(() => window.scrollY)) === 0,
    );
  } finally {
    await live.close();
    server.close();
  }
}
