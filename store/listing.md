# Chrome Web Store listing

## Name

Screenshot to Text

## Summary (max 132 characters)

Turn screenshots into clean Markdown for AI agents. 100% on your device — no uploads, no account, no internet.

## Category

Productivity

## Language

English

## Single purpose

Convert a screenshot of text into editable, layout-preserving Markdown that can
be pasted into an AI agent.

## Detailed description

Screenshots are a bad way to give an AI agent text: a 780 × 470 capture is
billed as roughly 500 vision tokens, and a full page costs far more. This
extension reads the text on your device and returns clean Markdown instead,
often several times smaller — and editable when the OCR is imperfect.

**Six ways in**

- Paste with `Ctrl+V`, drag & drop, or pick a file.
- **Select region** and drag over one part of a page.
- Capture the **visible tab**, or a whole **full page** — the page is scrolled,
  photographed in overlapping tiles, and stitched so no paragraph is cut in half.
- Right-click any image → **Extract text from this image**.

**Layout that survives**

Headings, nested bullet and numbered lists, tables (including empty cells),
fenced code with indentation, label/value pairs from settings screens, and
two-column reading order. The output is Markdown you can edit, plus plain-text,
outline and raw view tabs.

**Fix the crop instead of recapturing**

Open **Regions** on any result and draw boxes. Exclude a cookie banner or a
navigation bar, or keep only the part you need. The original capture is kept, so
edits never stack up.

**Append instead of redoing**

Reading a long document? **Add** drops the next screenshot below the first and
removes the repeated lines at the seam.

**Offline, and provably so**

Everything runs on your device: the OCR engine, the language model and the
layout engine are inside the extension. There is no server, no account, and no
analytics. The manifest's Content Security Policy sets `connect-src 'self'`, so
the browser itself refuses any outbound request the extension could ever make.

No host permissions are requested. Chrome grants access to a tab only when you
invoke the extension on it — click the toolbar icon on the page, press
`Ctrl+Shift+X`, or use the right-click menu. That grant is per tab and ends when
you navigate away; the panel tells you when a capture needs it.

**Notes**

- English OCR in this release.
- Charts, photos and handwriting have little readable text; the panel says so
  instead of returning noise.
- Everything is stored locally: your settings and the last 20 results.

## Permission justifications

See `permissions.md`.

## Privacy

See `privacy.md`.
