# Privacy policy

Screenshot to Text works entirely on your device. Nothing you capture, read or
type is transmitted anywhere.

## What is stored, and where

All data stays in the extension's local storage on your computer:

- **Settings** — compact mode, maximum capture width, default output view.
- **History** — the Markdown, raw text, token counts and a small thumbnail for
  your last 20 captures. Older entries are discarded automatically.

Removing the extension, or using **Clear history** in the panel, deletes this
data. There is no copy on any server, because no server exists.

## What is never collected

- No analytics, telemetry, crash reporting or usage statistics.
- No account, email address or identifier.
- No browsing history. The extension never requests the `tabs` permission.
- No page content beyond a screenshot you explicitly capture.
- No network requests of any kind.

This is enforced, not promised: the extension's Content Security Policy sets
`connect-src 'self'`, which makes the browser block every request that is not a
file inside the extension.

## Permissions

| Permission | What it does |
| --- | --- |
| `activeTab` | Lets a capture read the tab you invoked the extension on. Granted per tab, revoked when you navigate away. |
| `scripting` | Draws the region overlay and runs the scroll/hide/restore helpers during a full-page capture. |
| `sidePanel` | The entire user interface. |
| `contextMenus` | The "Extract text from this image" right-click item. |
| `storage` | Settings and the local history described above. |
| `clipboardWrite` | The copy button. |

No host permissions are requested. The extension declares no optional host
permissions either.

## OCR engine

Text recognition uses Tesseract.js and its English language model, both bundled
inside the extension and both running locally. See `THIRD_PARTY_NOTICES.md` in
the package for their licenses.

## Contact

Open an issue in the project repository.
