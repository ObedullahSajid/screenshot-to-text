/**
 * Shared browser plumbing for the e2e test and the benchmark: launch Chrome
 * with the built extension, open the side panel, and move images into it.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DIST = join(ROOT, '.output', 'chrome-mv3');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function chromePath() {
  const custom = process.env.CHROME_PATH;
  if (custom && existsSync(custom)) return custom;
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH to chrome.exe.');
  return found;
}

export async function launch({ headless = true, protocolTimeout, dist = DIST } = {}) {
  if (!existsSync(join(dist, 'manifest.json'))) {
    throw new Error('Build first: npm run build');
  }

  const profile = await mkdtemp(join(tmpdir(), 'stt-e2e-'));
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless,
    protocolTimeout: protocolTimeout ?? 180_000,
    // Puppeteer injects --disable-extensions by default.
    ignoreDefaultArgs: ['--disable-extensions'],
    enableExtensions: [dist],
    args: [
      '--enable-unsafe-extension-debugging',
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-search-engine-choice-screen',
      '--window-size=1280,900',
    ],
  });

  try {
    const target = await browser.waitForTarget(
      (candidate) =>
        candidate.type() === 'service_worker' && candidate.url().startsWith('chrome-extension://'),
      { timeout: 20_000 },
    );
    const extensionId = new URL(target.url()).host;
    return {
      browser,
      extensionId,
      profile,
      async close() {
        await browser.close().catch(() => {});
        await rm(profile, { recursive: true, force: true }).catch(() => {});
      },
    };
  } catch (error) {
    await browser.close().catch(() => {});
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function openPanel(browser, extensionId, options = {}) {
  const {
    viewport = { width: 420, height: 860 },
    onRequest,
    quiet = false,
    query = '',
  } = options;

  const page = await browser.newPage();
  await page.setViewport(viewport);

  if (!quiet) {
    page.on('pageerror', (error) => console.error('[page error]', error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error('[console]', message.text());
    });
  }
  if (onRequest) page.on('request', (request) => onRequest(request.url()));

  // Records any attempt the browser refuses under the extension's CSP.
  await page.evaluateOnNewDocument(() => {
    window.__sttViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__sttViolations.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
      });
    });
  });

  await page.goto(`chrome-extension://${extensionId}/sidepanel.html${query}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('.dropzone', { timeout: 15_000 });
  return page;
}

/**
 * Copies the built extension and adds `<all_urls>`.
 *
 * Real full-page capture needs host access or an activeTab grant. Chrome only
 * gives activeTab in response to a real toolbar click, which cannot be driven
 * from Puppeteer, so the integration test runs against this temporary copy.
 * The privacy guarantees of the shipped build are unchanged and checked
 * separately by `check:offline`.
 */
export async function launchWithHostAccess({ headless = true, protocolTimeout } = {}) {
  const copy = join(ROOT, '.output', 'chrome-mv3-live');
  await rm(copy, { recursive: true, force: true });
  await cp(DIST, copy, { recursive: true });
  const manifestPath = join(copy, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const session = await launch({ headless, protocolTimeout, dist: copy });
  return {
    ...session,
    async close() {
      await session.close();
      await rm(copy, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/**
 * Opens the panel in its own window, so the page being captured stays the
 * active tab of the other window. Chrome requires a user gesture for
 * `sidePanel.open()`, which automation cannot produce.
 *
 * The `query` string doubles as a marker, so a session that already has a panel
 * open still gets the window it just asked for.
 */
export async function openPanelWindow(browser, extensionId, { query = '?debug=1' } = {}) {
  const target = await browser.target().createCDPSession();
  await target.send('Target.createTarget', {
    url: `chrome-extension://${extensionId}/sidepanel.html${query}`,
    newWindow: true,
    width: 460,
    height: 900,
  });
  await target.detach().catch(() => {});

  const marker = query ? `sidepanel.html${query}` : 'sidepanel.html';
  let page;
  for (let attempt = 0; attempt < 60 && !page; attempt++) {
    const pages = await browser.pages();
    page = pages.find((candidate) => candidate.url().includes(marker));
    if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!page) throw new Error('The panel window did not open.');
  await page.waitForSelector('.dropzone', { timeout: 20_000 });
  return page;
}

/**
 * A page with no extension CSP, used to rasterise fixtures. `new Function`
 * would be blocked inside the panel (`script-src 'self'`), so fixtures are
 * drawn here and handed over as PNG data URLs.
 */
export async function openRenderPage(browser) {
  const page = await browser.newPage();
  await page.goto('about:blank');
  return page;
}

export async function renderFixture(renderPage, fixture) {
  // Fixtures use method shorthand (`draw(ctx) {}`), which is not an expression;
  // turn it into a function expression before handing it to the render page.
  const source = fixture.draw.toString();
  const expression = /^[\w$]+\s*\(/.test(source) ? `function ${source}` : source;
  return renderPage.evaluate(
    ({ src, width, height, background }) => {
      const draw = new Function(`return (${src})`)();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = background ?? '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.textBaseline = 'top';
      draw(ctx, canvas);
      return canvas.toDataURL('image/png');
    },
    {
      src: expression,
      width: fixture.width,
      height: fixture.height,
      background: fixture.background,
    },
  );
}

/**
 * Clicks the centre of a selector with a real mouse event.
 *
 * `ElementHandle.click()` stalls on the extension page: its isolated-world
 * `Runtime.callFunctionOn` never resolves after an OCR run. Input events and
 * main-world evaluation are unaffected, so the coordinates are measured here
 * and dispatched with `page.mouse`.
 */
export async function clickSelector(page, selector) {
  const point = await page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
  if (!point) throw new Error(`No element matches ${selector}`);
  await page.mouse.click(point.x, point.y);
}

/** Drops a data URL on the panel's dropzone, exactly like a user would. */
export async function dropDataUrl(page, dataUrl, name = 'fixture.png') {
  await page.evaluate(
    ({ dataUrl: source, name: fileName }) => {
      const binary = atob(source.slice(source.indexOf(',') + 1));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
      }
      const file = new File([bytes], fileName, { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const dropzone = document.querySelector('.dropzone');
      if (!dropzone) throw new Error('Dropzone not found');
      dropzone.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
    },
    { dataUrl, name },
  );
}

export async function waitForResult(page, timeout = 120_000) {
  await page.waitForSelector('#markdown-editor', { timeout });
  return page.$eval('#markdown-editor', (element) => element.value);
}

export async function readResultMeta(page) {
  return page.evaluate(() => {
    const values = [...document.querySelectorAll('.stat .stat-value')].map(
      (element) => element.textContent?.trim() ?? '',
    );
    const meta = document.querySelector('.meta-line');
    return {
      tokens: values[0] ?? '',
      saved: values[1] ?? '',
      confidence: values[2] ?? '',
      sharpness: meta?.getAttribute('data-sharpness') ?? '',
      contrast: meta?.getAttribute('data-contrast') ?? '',
      passes: meta?.getAttribute('data-passes') ?? '',
      notes: [...document.querySelectorAll('.note-chip')].map(
        (element) => element.textContent?.trim() ?? '',
      ),
      metaText: meta?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    };
  });
}

export async function startOver(page) {
  await clickSelector(page, '[aria-label="Start over"]');
  await page.waitForSelector('.dropzone', { timeout: 15_000 });
}
