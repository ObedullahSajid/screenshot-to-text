import { defineConfig } from 'wxt';

/**
 * Chrome-only (MV3). `side_panel` and `minimum_chrome_version` are valid Chrome
 * manifest keys but are missing from the typings bundled with WXT, hence the cast.
 */
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Screenshot to Text',
    description:
      'Turn screenshots into clean, layout-preserving Markdown for AI agents. Runs 100% on your device.',
    permissions: [
      'activeTab',
      'scripting',
      'storage',
      'sidePanel',
      'contextMenus',
      'clipboardWrite',
    ],
    action: {
      default_title: 'Screenshot to Text',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    commands: {
      'capture-region': {
        suggested_key: {
          default: 'Ctrl+Shift+X',
          mac: 'Command+Shift+X',
        },
        description: 'Capture a region of the page and extract its text',
      },
    },
    content_security_policy: {
      // WebAssembly (Tesseract core) needs 'wasm-unsafe-eval'.
      //
      // `connect-src 'self'` is the offline guarantee: the panel and its worker
      // may only fetch chrome-extension:// URLs, so an accidental (or added)
      // request to any API or CDN is blocked by the browser, not by convention.
      // It cannot be 'none' because Tesseract fetches the traineddata from the
      // extension origin at runtime.
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self'; " +
        "img-src 'self' data: blob:; media-src 'none'; frame-src 'none'",
    },
    minimum_chrome_version: '116',
    homepage_url: 'https://github.com/ObedullahSajid/screenshot-to-text',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    // `side_panel` / `minimum_chrome_version` are missing from WXT's manifest type.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
});
