/**
 * Renders the Chrome Web Store screenshots.
 *
 * The panel is designed for ~420 px, so each shot is composed onto a 1280 × 800
 * canvas (the size the store requires) instead of stretching the UI to desktop
 * width. Run after any UI change:
 *
 *   node scripts/store-shots.mjs          # headless
 *   HEADFUL=1 node scripts/store-shots.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ROOT,
  clickSelector,
  dropDataUrl,
  launch,
  openPanel,
  waitForResult,
} from './lib/harness.mjs';

const OUT = join(ROOT, 'store', 'screenshots');
const PANEL = { width: 420, height: 860 };

await mkdir(OUT, { recursive: true });
const session = await launch({ headless: process.env.HEADFUL !== '1' });

try {
  const panel = await openPanel(session.browser, session.extensionId, { viewport: PANEL, quiet: true });

  // The store's first shots read better in the light theme; the last one shows
  // dark mode. Emulating the preference also keeps the output identical on a
  // machine whose OS theme is dark.
  await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await sleep(300);

  // No second page is opened until every panel shot is taken: Chrome throttles
  // background tabs, and a compositor screenshot of a throttled tab can stall.
  const shots = [];

  shots.push({
    file: '01-empty.png',
    title: 'Screenshot to Markdown',
    lines: ['Paste, drop, or capture a region of any page.', 'No uploads, no account, no internet.'],
    png: await capture(panel),
  });

  const fixture = await drawFixture(panel);
  await dropDataUrl(panel, fixture, 'store.png');
  await waitForResult(panel);
  await sleep(900);

  shots.push({
    file: '02-result.png',
    title: 'Readable Markdown, not pixels',
    lines: ['Headings, lists and pipe tables stay intact.', 'Edit the text and copy it straight into an agent.'],
    png: await capture(panel),
  });

  await clickSelector(panel, '[aria-label="Select regions"]');
  await panel.waitForSelector('.region-card', { timeout: 10_000 });
  await sleep(400);

  shots.push({
    file: '03-regions.png',
    title: 'Keep the text, cut the clutter',
    lines: ['Exclude a banner, or read only the boxes you pick.', 'The original capture is never altered.'],
    png: await capture(panel),
  });

  await clickSelector(panel, '.region-card [aria-label="Close"]');
  await panel.waitForSelector('.region-card', { hidden: true, timeout: 10_000 });

  await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await sleep(400);

  shots.push({
    file: '04-dark.png',
    title: 'Light and dark',
    lines: ['The same offline engine reads the same way.', 'History and settings never leave the device.'],
    tone: 'dark',
    png: await capture(panel),
  });

  // Every panel shot is in hand before the composer page exists, so the panel
  // is never throttled while it is being captured.
  const composer = await openComposer(session.browser);

  for (const shot of shots) {
    await composer.bringToFront();
    const dataUrl = await compose(composer, shot);
    await writeFile(join(OUT, shot.file), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`[shots] ${shot.file}`);
  }

  const promo = await composePromo(composer);
  await writeFile(join(OUT, 'promo-440x280.png'), Buffer.from(promo.split(',')[1], 'base64'));
  console.log('[shots] promo-440x280.png');

  await composer.close();
} finally {
  await session.close();
}

/**
 * Chrome throttles rendering in background tabs, and a compositor screenshot of
 * a throttled tab can stall until `protocolTimeout`. Bringing the panel to the
 * front first keeps the capture cheap and immediate.
 */
async function capture(page) {
  await page.bringToFront();
  return page.screenshot({ encoding: 'base64' });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openComposer(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('about:blank');
  return page;
}

/** Draws a document-like screenshot so the result shot has real structure. */
async function drawFixture(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 760;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = 'top';

    ctx.fillStyle = '#111111';
    ctx.font = '700 30px Arial';
    ctx.fillText('Release notes', 40, 30);

    ctx.font = '17px Arial';
    ctx.fillText('Version 2.4 ships the new capture pipeline and', 40, 86);
    ctx.fillText('fixes table detection on narrow layouts.', 40, 112);

    ctx.fillStyle = '#111111';
    ctx.font = '700 19px Arial';
    ctx.fillText('Highlights', 40, 152);

    ctx.font = '17px Arial';
    ctx.fillText('\u2022  Faster region capture', 56, 188);
    ctx.fillText('\u2022  Smarter column order', 56, 214);
    ctx.fillText('\u2022  Full-page stitching', 56, 240);

    // Columns are wide enough apart (and cells inset) that the layout engine
    // reads this as a pipe table rather than as label/value pairs.
    const left = 40;
    const top = 292;
    const widths = [230, 260, 190];
    const rows = [
      ['Change', 'Owner', 'Status'],
      ['Table detection', 'Layout', 'Shipped'],
      ['Column order', 'Layout', 'Shipped'],
      ['Full-page stitch', 'Capture', 'Beta'],
    ];
    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 2;
    rows.forEach((row, rowIndex) => {
      let x = left;
      row.forEach((cell, columnIndex) => {
        ctx.fillStyle = '#111111';
        ctx.font = rowIndex === 0 ? '700 17px Arial' : '17px Arial';
        ctx.fillText(cell, x + 12, top + rowIndex * 44 + 12);
        ctx.strokeRect(x, top + rowIndex * 44, widths[columnIndex], 44);
        x += widths[columnIndex];
      });
    });

    return canvas.toDataURL('image/png');
  });
}

/** Places the 420 × 860 panel on the store's 1280 × 800 canvas. */
async function compose(page, shot) {
  return page.evaluate(
    async ({ png, title, lines, tone }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();

      const palette =
        tone === 'dark'
          ? {
              backdrop: ['#14161f', '#1b1e2b'],
              glow: 'rgba(139, 135, 255, 0.18)',
              frame: '#101219',
              shadow: 'rgba(0, 0, 0, 0.55)',
              title: '#f4f5ff',
              body: '#a9aec9',
            }
          : {
              backdrop: ['#f7f8fb', '#e7ebf3'],
              glow: 'rgba(79, 70, 229, 0.14)',
              frame: '#ffffff',
              shadow: 'rgba(16, 24, 40, 0.22)',
              title: '#14161b',
              body: '#687083',
            };

      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 800;
      const ctx = canvas.getContext('2d');

      const backdrop = ctx.createLinearGradient(0, 0, 1280, 800);
      backdrop.addColorStop(0, palette.backdrop[0]);
      backdrop.addColorStop(1, palette.backdrop[1]);
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, 1280, 800);

      const glow = ctx.createRadialGradient(980, 120, 0, 980, 120, 520);
      glow.addColorStop(0, palette.glow);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 1280, 800);

      const panelWidth = Math.round(420 * 0.85);
      const panelHeight = Math.round(860 * 0.85);
      const panelX = 90;
      const panelY = Math.round((800 - panelHeight) / 2);

      ctx.save();
      ctx.shadowColor = palette.shadow;
      ctx.shadowBlur = 48;
      ctx.shadowOffsetY = 18;
      ctx.beginPath();
      ctx.roundRect(panelX, panelY, panelWidth, panelHeight, 18);
      ctx.fillStyle = palette.frame;
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(panelX, panelY, panelWidth, panelHeight, 18);
      ctx.clip();
      ctx.drawImage(image, panelX, panelY, panelWidth, panelHeight);
      ctx.restore();

      const textX = 530;
      let y = 300;
      ctx.fillStyle = palette.title;
      ctx.font = '700 42px "Segoe UI", -apple-system, Arial';
      for (const line of wrap(ctx, title, 660)) {
        ctx.fillText(line, textX, y);
        y += 52;
      }

      y += 26;
      ctx.fillStyle = palette.body;
      ctx.font = '22px "Segoe UI", -apple-system, Arial';
      for (const source of lines) {
        for (const line of wrap(ctx, source, 660)) {
          ctx.fillText(line, textX, y);
          y += 34;
        }
        y += 6;
      }

      ctx.fillStyle = '#6c63ff';
      ctx.fillRect(textX, 232, 56, 5);

      return canvas.toDataURL('image/png');

      function wrap(context, text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let current = '';
        for (const word of words) {
          const next = current ? `${current} ${word}` : word;
          if (context.measureText(next).width > maxWidth && current) {
            lines.push(current);
            current = word;
          } else {
            current = next;
          }
        }
        if (current) lines.push(current);
        return lines;
      }
    },
    { png: shot.png, title: shot.title, lines: shot.lines, tone: shot.tone ?? 'light' },
  );
}

async function composePromo(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 440;
    canvas.height = 280;
    const ctx = canvas.getContext('2d');

    const backdrop = ctx.createLinearGradient(0, 0, 440, 280);
    backdrop.addColorStop(0, '#1c1f2b');
    backdrop.addColorStop(1, '#2b2f45');
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, 440, 280);

    const glow = ctx.createRadialGradient(380, 40, 0, 380, 40, 260);
    glow.addColorStop(0, 'rgba(139, 135, 255, 0.35)');
    glow.addColorStop(1, 'rgba(139, 135, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 440, 280);

    const accent = '#8b87ff';
    const base = '#f4f5ff';

    ctx.fillStyle = accent;
    ctx.fillRect(32, 62, 36, 4);

    ctx.font = '700 34px "Segoe UI", -apple-system, Arial';
    ctx.fillStyle = base;
    ctx.fillText('Screenshot', 32, 108);

    ctx.fillStyle = base;
    ctx.fillText('to ', 32, 154);
    const offset = ctx.measureText('to ').width;
    ctx.fillStyle = accent;
    ctx.fillText('Markdown', 32 + offset, 154);

    ctx.fillStyle = '#a9aec9';
    ctx.font = '17px "Segoe UI", -apple-system, Arial';
    ctx.fillText('Offline OCR for AI agents', 32, 198);

    return canvas.toDataURL('image/png');
  });
}
