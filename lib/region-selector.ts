import type { Selection } from './messages';

/**
 * Injected into the page with chrome.scripting.executeScript.
 *
 * IMPORTANT: this function is serialized and run in the page's isolated world,
 * so it must be completely self-contained (no imports, no module-scope refs).
 */
export async function selectRegion(): Promise<Selection | null> {
  return new Promise((resolve) => {
    const existing = document.getElementById('stt-region-overlay');
    existing?.remove();

    const host = document.createElement('div');
    host.id = 'stt-region-overlay';
    host.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(9,12,20,.35);' +
      'user-select:none;-webkit-user-select:none;touch-action:none;';

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .box{position:fixed;border:2px solid #7c8cff;border-radius:4px;
        background:rgba(124,140,255,.14);box-shadow:0 0 0 9999px rgba(9,12,20,.28);
        pointer-events:none;display:none}
      .hint{position:fixed;left:50%;top:16px;transform:translateX(-50%);
        font:500 12px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;
        background:rgba(17,20,28,.92);border:1px solid rgba(255,255,255,.16);
        padding:7px 12px;border-radius:999px;white-space:nowrap;pointer-events:none;
        box-shadow:0 8px 24px rgba(0,0,0,.28)}
      .hint b{font-weight:700}
      .dims{position:absolute;right:6px;bottom:6px;font:600 11px/1 ui-monospace,monospace;
        color:#fff;background:rgba(17,20,28,.9);padding:4px 6px;border-radius:4px;display:none}
    `;
    const box = document.createElement('div');
    box.className = 'box';
    const dims = document.createElement('div');
    dims.className = 'dims';
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.innerHTML = 'Drag to select text <b>·</b> Esc to cancel';

    shadow.append(style, box, dims, hint);
    document.documentElement.appendChild(host);

    let startX = 0;
    let startY = 0;
    let dragging = false;

    const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
    const cleanup = () => {
      host.remove();
      window.removeEventListener('keydown', onKey, true);
    };

    const finish = async (value: Selection | null) => {
      cleanup();
      // Let the browser paint the page without the overlay before the caller
      // takes its screenshot.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      resolve(value);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        void finish(null);
      }
    };

    const currentRect = (x: number, y: number) => {
      const left = clamp(Math.min(startX, x), window.innerWidth);
      const top = clamp(Math.min(startY, y), window.innerHeight);
      const right = clamp(Math.max(startX, x), window.innerWidth);
      const bottom = clamp(Math.max(startY, y), window.innerHeight);
      return { x: left, y: top, width: right - left, height: bottom - top };
    };

    host.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      host.setPointerCapture(event.pointerId);
      startX = event.clientX;
      startY = event.clientY;
      dragging = true;
      hint.style.display = 'none';
      box.style.display = 'block';
    });

    host.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const rect = currentRect(event.clientX, event.clientY);
      Object.assign(box.style, {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      dims.style.display = 'block';
      dims.style.left = `${rect.x + rect.width - 74}px`;
      dims.style.top = `${Math.max(rect.y + rect.height - 26, 0)}px`;
      dims.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    });

    host.addEventListener('pointerup', (event) => {
      if (!dragging) return;
      dragging = false;
      const rect = currentRect(event.clientX, event.clientY);
      if (rect.width < 8 || rect.height < 8) {
        void finish(null);
        return;
      }
      void finish({
        rect,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
        },
      });
    });

    host.addEventListener('pointercancel', () => void finish(null));
    window.addEventListener('keydown', onKey, true);
  });
}

/**
 * Injected into the page to locate an <img> and scroll it into view.
 * Returns viewport coordinates of the visible part of the image.
 */
export async function locateImage(srcUrl: string): Promise<
  | {
      rect: { x: number; y: number; width: number; height: number };
      viewport: { width: number; height: number; dpr: number };
    }
  | null
> {
  const normalize = (value: string) => {
    try {
      const url = new URL(value, location.href);
      return url.href;
    } catch {
      return value;
    }
  };
  const target = normalize(srcUrl);
  const images = Array.from(document.images);
  const image =
    images.find((img) => normalize(img.currentSrc) === target) ??
    images.find((img) => normalize(img.src) === target);

  if (!image) return null;

  image.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
  await new Promise((r) => setTimeout(r, 350));

  const box = image.getBoundingClientRect();
  const left = Math.max(box.left, 0);
  const top = Math.max(box.top, 0);
  const right = Math.min(box.right, window.innerWidth);
  const bottom = Math.min(box.bottom, window.innerHeight);

  if (right - left < 8 || bottom - top < 8) return null;

  return {
    rect: { x: left, y: top, width: right - left, height: bottom - top },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    },
  };
}
