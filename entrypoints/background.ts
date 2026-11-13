import { defineBackground } from 'wxt/utils/define-background';
import { locateImage, selectRegion } from '../lib/region-selector';
import {
  hideRepeatingFullPage,
  planTiles,
  prepareFullPage,
  restoreFullPage,
  scrollFullPage,
  type PageMetrics,
} from '../lib/fullpage';
import {
  MSG,
  PENDING_KEY,
  type CaptureResponse,
  type CapturedTile,
  type FullCaptureResponse,
  type FullPageProgress,
  type PendingCapture,
  type Selection,
} from '../lib/messages';

const MENU_ID = 'stt-extract-image';
/** captureVisibleTab is quota-limited to roughly two calls per second. */
const CAPTURE_INTERVAL = 620;

let fullCaptureRunning = false;
let fullCaptureCancelled = false;

export default defineBackground(() => {
  // Clicking the toolbar icon must reach `action.onClicked`: that click is what
  // grants the `activeTab` permission the captures need. `openPanelOnActionClick`
  // would open the panel but swallow the click, and the panel would then have no
  // access to the page (Chromium issues 336592430 / 40916430).
  //
  // The old value persists per profile, so it has to be reset explicitly for
  // anyone upgrading from a build that relied on it.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {
    // Older Chrome: the default is already false.
  });

  chrome.action.onClicked.addListener((tab) => {
    // Opening the panel inside the click's gesture keeps the panel usable.
    // Nothing may be awaited before this call or the gesture is lost.
    if (tab.windowId == null) return;
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
      // Already open in this window, or the gesture was rejected.
    });
  });

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: MENU_ID,
        title: 'Extract text from this image',
        contexts: ['image'],
      });
    });
  });

  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'capture-region') return;
    const tab = await getActiveTab();
    if (!tab?.id) return;

    await openPanel(tab.windowId);
    await sleep(220);

    const response = await captureRegion();
    if (response.ok) {
      await pushPending({
        kind: 'image',
        dataUrl: response.dataUrl,
        selection: response.selection!,
        createdAt: Date.now(),
      });
    }
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab?.id || !info.srcUrl) return;
    await openPanel(tab.windowId);
    await sleep(220);

    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: locateImage,
        args: [info.srcUrl],
      });
      const located = injection?.result as Selection | null | undefined;
      if (!located) return;

      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'jpeg',
        quality: 92,
      });
      await pushPending({
        kind: 'image',
        dataUrl,
        selection: located,
        createdAt: Date.now(),
      });
    } catch {
      // Restricted page or a tainted image: the panel still works with
      // paste/drop, so stay quiet here.
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MSG.captureVisible) {
      captureVisible().then(sendResponse);
      return true;
    }
    if (message?.type === MSG.captureRegion) {
      captureRegion().then(sendResponse);
      return true;
    }
    if (message?.type === MSG.captureFull) {
      captureFullPage().then(sendResponse);
      return true;
    }
    if (message?.type === MSG.cancelFull) {
      fullCaptureCancelled = true;
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
});

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

/** A tab we can actually scroll and photograph (not chrome:// or the panel). */
function isCapturable(tab: chrome.tabs.Tab | undefined): tab is chrome.tabs.Tab {
  if (!tab?.id || tab.windowId == null) return false;
  const url = tab.url ?? '';
  return !/^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url);
}

/**
 * The active tab of the focused window, falling back to the active tab of any
 * window. Without this a panel opened in its own window would try to capture
 * itself.
 */
async function getCaptureTab(): Promise<chrome.tabs.Tab | undefined> {
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (isCapturable(focused)) return focused;
  const all = await chrome.tabs.query({ active: true });
  return all.find(isCapturable);
}

async function openPanel(windowId: number | undefined): Promise<void> {
  if (windowId == null) return;
  try {
    await chrome.sidePanel.open({ windowId });
  } catch {
    // Already open, or no user gesture. Not fatal.
  }
}

async function captureVisible(): Promise<CaptureResponse> {
  const tab = await getCaptureTab();
  if (!tab?.id || tab.windowId == null) return noCaptureTabFailure();

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 92,
    });
    return { ok: true, dataUrl, source: 'visible' };
  } catch (cause) {
    return captureFailure(cause);
  }
}

async function captureRegion(): Promise<CaptureResponse> {
  const tab = await getCaptureTab();
  if (!tab?.id || tab.windowId == null) return noCaptureTabFailure();

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: selectRegion,
    });
    const selection = injection?.result as Selection | null | undefined;
    if (!selection) {
      return { ok: false, error: 'Selection cancelled.', cancelled: true };
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 92,
    });
    return { ok: true, dataUrl, selection, source: 'region' };
  } catch (cause) {
    return captureFailure(cause);
  }
}

/**
 * Scrolls the page from top to bottom and photographs every viewport.
 *
 * The tiles overlap, so a line that lands on a seam is still complete in one
 * of them. The caller stitches the OCR lines afterwards.
 */
async function captureFullPage(): Promise<FullCaptureResponse> {
  if (fullCaptureRunning) {
    return { ok: false, error: 'A full-page capture is already running.' };
  }

  fullCaptureRunning = true;
  fullCaptureCancelled = false;
  let metrics: PageMetrics | null = null;
  const tab = await getCaptureTab();

  if (!tab?.id || tab.windowId == null) {
    fullCaptureRunning = false;
    const failure = await noCaptureTabFailure();
    return { ...failure, hint: failure.hint ?? 'Open the page you want, click the extension icon, then try again.' };
  }

  try {
    const [prepared] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: prepareFullPage,
    });
    metrics = (prepared?.result as PageMetrics | undefined) ?? null;
    if (!metrics) throw new Error('Could not read the page size.');

    const plan = planTiles(metrics.scrollHeight, metrics.viewportHeight);
    reportFull({
      stage: 'Preparing full page',
      progress: 0.02,
      tiles: plan.offsets.length,
    });

    const tiles: CapturedTile[] = [];
    let hidden = 0;
    let lastCapture = 0;

    for (let index = 0; index < plan.offsets.length; index++) {
      if (fullCaptureCancelled) {
        return { ok: false, error: 'Full-page capture cancelled.', cancelled: true };
      }

      // The first tile shows the page as-is, including any fixed header.
      // Leaving it on every tile would repeat it all the way down.
      if (index === 1) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: hideRepeatingFullPage,
        });
        hidden = metrics.repeating;
      }

      const [scrolled] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrollFullPage,
        args: [plan.offsets[index]],
      });
      const actual =
        (scrolled?.result as { scrollY: number } | undefined)?.scrollY ??
        plan.offsets[index];

      reportFull({
        stage: `Capturing tile ${index + 1} of ${plan.offsets.length}`,
        progress: 0.04 + (index / plan.offsets.length) * 0.9,
        tile: index + 1,
        tiles: plan.offsets.length,
      });

      // Chrome rejects captureVisibleTab calls that arrive too quickly.
      const wait = Math.max(0, CAPTURE_INTERVAL - (Date.now() - lastCapture));
      if (wait > 0) await sleep(wait);

      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'jpeg',
        quality: 92,
      });
      lastCapture = Date.now();
      tiles.push({ dataUrl, offset: actual });
    }

    reportFull({ stage: 'Page captured', progress: 1 });
    return {
      ok: true,
      tiles,
      dpr: metrics.dpr,
      scrollHeight: metrics.scrollHeight,
      viewportWidth: metrics.viewportWidth,
      viewportHeight: metrics.viewportHeight,
      truncated: plan.truncated,
      hidden,
    };
  } catch (cause) {
    if (fullCaptureCancelled) {
      return { ok: false, error: 'Full-page capture cancelled.', cancelled: true };
    }
    const failure = captureFailure(cause);
    return {
      ...failure,
      hint:
        failure.code === 'no-access'
          ? failure.hint
          : 'Full page works on scrollable http(s) pages. PDFs, the Web Store and internal pages are blocked by Chrome.',
    };
  } finally {
    fullCaptureRunning = false;
    if (metrics) {
      // Put the page back where the user left it, even after an error.
      await chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          func: restoreFullPage,
          args: [metrics.scrollY, metrics.htmlBehavior, metrics.bodyBehavior],
        })
        .catch(() => {
          // The tab navigated or closed mid-capture.
        });
    }
  }
}

function reportFull(progress: Omit<FullPageProgress, 'type'>): void {
  const message: FullPageProgress = { type: MSG.fullPageProgress, ...progress };
  // No listener while the panel is closed is normal, not an error.
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function pushPending(pending: PendingCapture): Promise<void> {
  await chrome.storage.session.set({ [PENDING_KEY]: pending });
  try {
    await chrome.runtime.sendMessage({ type: MSG.pendingCapture });
  } catch {
    // Panel closed or still loading; it will pick the value up on mount.
  }
}

/** The failure half of either capture response. */
type CaptureFailure = Extract<CaptureResponse, { ok: false }>;

const NO_ACCESS_FAILURE: CaptureFailure = {
  ok: false,
  code: 'no-access',
  error: "This panel doesn't have access to the page yet.",
  hint:
    'Chrome grants page access when you start the extension on that tab, so click the extension ' +
    'icon (or press Ctrl+Shift+X) and try again. Internal pages such as chrome://, the Web Store ' +
    'and PDFs stay blocked: paste or upload the screenshot instead.',
};

const RESTRICTED_FAILURE: CaptureFailure = {
  ok: false,
  code: 'restricted',
  error: 'Chrome does not allow capturing this page.',
  hint: 'PDFs, the Web Store and chrome:// pages are blocked. Paste (Ctrl+V) or upload the screenshot instead.',
};

/**
 * Nothing usable is active. Without page access Chrome hides `tab.url`, so an
 * unreadable URL is the only signal available; it covers both a panel that was
 * opened without invoking the extension and a genuinely internal page.
 */
async function noCaptureTabFailure(): Promise<CaptureFailure> {
  const active = await chrome.tabs.query({ active: true });
  const own = `chrome-extension://${chrome.runtime.id}/`;

  // A readable internal page is a page Chrome refuses outright. Our own panel
  // is not a capture target, so it does not count.
  const internal = active.find(
    (tab) =>
      tab.id != null &&
      tab.url &&
      !tab.url.startsWith(own) &&
      /^(chrome|edge|about|devtools|view-source|file):/i.test(tab.url),
  );
  // An unreadable URL means the extension was never invoked on that tab.
  const hidden = active.find((tab) => tab.id != null && !tab.url);

  if (internal) return RESTRICTED_FAILURE;
  if (hidden) return NO_ACCESS_FAILURE;

  return {
    ok: false,
    code: 'no-tab',
    error: 'No web page is active.',
    hint: 'Open the page you want, click the extension icon, then try again.',
  };
}

/**
 * Chrome words a missing permission as a scripting or capture error; turning it
 * into "this page is blocked" is what made the panel look randomly broken.
 */
function captureFailure(cause: unknown): CaptureFailure {
  const message = cause instanceof Error ? cause.message : String(cause);

  if (/chrome:\/\/|chrome-extension:\/\/|extensions gallery|view-source|devtools:|about:|edge:\/\//i.test(message)) {
    return RESTRICTED_FAILURE;
  }
  if (/cannot access contents|manifest must request|host permission|not have permission|activeTab|<all_urls>|could not read the page size/i.test(message)) {
    return NO_ACCESS_FAILURE;
  }
  return RESTRICTED_FAILURE;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
