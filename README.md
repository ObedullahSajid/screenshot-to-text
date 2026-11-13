# Screenshot to Text

A Chrome side-panel extension that turns screenshots into **layout-preserving Markdown**, so you can paste compact text into an AI agent instead of a ~1,000+ token image.

Everything runs on your device: the OCR worker, the WebAssembly core and the English model are bundled in the extension. There are no network requests and no API keys.

```
screenshot ──► regions ──► preprocess ──► Tesseract OCR ──► layout rebuild ──► clean ──► Markdown + token meter
 (paste/drop/region)  (keep/exclude,   (quality metrics,   (1–2 layout passes)  (blocks, lines,   (dedupe,
                       stacking)        upscale, contrast,                       word boxes)      page numbers)
                                        invert)
```

---

## Why

A 780 × 470 screenshot costs roughly **470 vision tokens**. The same content as Markdown is about **87 tokens** — an ~82% reduction, and it compounds every turn an agent re-reads its context.

The extension keeps what matters to a model — headings, lists, tables, code, reading order — instead of reproducing pixel positions with spaces.

---

## Features

- **Six ways to add a screenshot**: paste (`Ctrl+V`), drag & drop, file picker, region capture (`Ctrl+Shift+X`), the visible tab, or a scrolled **full page**.
- **Page access stays opt-in**: Chrome only lets the extension read a tab after you invoke it there — toolbar icon, `Ctrl+Shift+X` or the context menu. No always-on host access, no install-time warning, and the panel says so when a capture needs that grant.
- **Full-page capture**: one click scrolls the page and photographs each viewport with 140 px overlap. Lines are stitched by their page coordinates — not by joining Markdown — so a paragraph cut by a tile boundary is complete and appears once. Fixed headers are captured only on the first tile, and your scroll position is put back.
- **Keep/exclude regions without recapturing**: open **Regions** on a result to draw as many boxes as you need. **Exclude** cuts out a nav bar or cookie banner; **Keep** reads only the boxes you choose and stacks them in reading order. Boxes can be moved, resized, nudged with the keyboard, or removed; the pipeline runs again on the untouched capture.
- **Layout reconstruction**: headings, bullet/numbered lists (including nested ones), pipe tables, fenced code blocks (with indentation), paragraph re-flowing, de-hyphenation, CJK-aware spacing.
- **Reading order that survives columns**: a two-column article is read down the first column and then down the second, not row by row.
- **Label/value pairing**: a settings panel or a receipt comes out as `Compact output: On` instead of a table with a made-up header row. Stacked form fields (`Email: ada@example.com`) are grouped by their label/value rhythm.
- **Smart preprocessing**: contrast stretch, contrast-limited equalisation for flat/grey-on-grey captures, automatic inversion for dark-mode screenshots, tiny-crop upscaling, pixel cap for huge captures.
- **Quality hints**: a soft-capture warning, a "low contrast boosted" note, and "re-read at higher detail" when a second OCR pass was needed.
- **Editable result** with a live token count and an "82% smaller than image" meter.
- **Four output views** — Markdown (editable), plain text (tab-separated tables, `•` bullets), outline (headings and list items only), and the raw OCR text. Copy and download follow the active view.
- **Append captures** — click **Add** on a result to drop, paste or capture the next part of a long page. The seam is merged and repeated lines are removed, so a scrolled document stays one result.
- **History** of the last 20 captures, stored locally.
- **Dark and light themes**, keyboard accessible, reduced-motion aware.
- **100% on-device**, enforced by the manifest's own Content Security Policy (see below).

---

## Quick start

Requirements: Node 20+, Chrome 116+.

```bash
npm install       # also generates .wxt types
npm run build     # copies OCR assets into public/, builds .output/chrome-mv3
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. **Load unpacked** → select `screenshot-to-text/.output/chrome-mv3`.
4. Click the toolbar icon **on the page you want to capture**. The side panel opens and Chrome grants the extension access to that tab.

For development with hot reload:

```bash
npm run dev
```

WXT launches a separate Chrome profile with the extension loaded. Click the toolbar icon to open the panel.

### Page access

Chrome only lets an extension read a tab when the user **invokes** it on that tab: a click on the toolbar icon, the `Ctrl+Shift+X` shortcut, or the context menu. A click inside the side panel does not count — the panel is not an invocation.

So the workflow is:

- **Click the toolbar icon on the page** → the panel opens and every capture button works for that tab.
- The grant lasts until you navigate, reload or switch tabs. After that, click the icon again on the new tab.
- `Ctrl+Shift+X` grants access the same way and starts a region capture immediately.

If a capture starts without that grant, the panel says so and points at the icon instead of blaming the page. Internal pages (`chrome://`, the Web Store, the PDF viewer) stay blocked either way — paste or upload the screenshot there.

### Try it

- Copy any screenshot, click the panel, press `Ctrl+V`.
- Click the toolbar icon **on the page** (that grants access to it), then click **Select region** and drag over text.
- Or press `Ctrl+Shift+X` and drag over text right away.
- Or right-click an image → **Extract text from this image**.

---

## Output example

Input: a synthetic screenshot with a title, paragraph, list and table.

```markdown
# Quarterly Summary

Revenue grew by 18% in Q3, driven by enterprise accounts. The team shipped four major releases this quarter.

## Highlights
- Faster onboarding flow
- Better reporting dashboard
- Three new integrations

| Region | Revenue | Growth |
| --- | --- | --- |
| North America | $4.2M | +22% |
| Europe | $2.8M | +11% |
```

A dark-mode code screenshot becomes:

````markdown
```
function add(a, b) {
  return a + b;
}
const total = add(2, 3);
```
````

### The other views

The same capture as **plain text** — no markers, tables as tab-separated rows:

```
Quarterly Summary

Revenue grew by 18% in Q3, driven by enterprise accounts. The team shipped four major releases this quarter.

Highlights
• Faster onboarding flow
• Better reporting dashboard
• Three new integrations

Region	Revenue	Growth
North America	$4.2M	+22%
Europe	$2.8M	+11%
```

And as an **outline** — the skeleton of the page, without the body copy:

```
# Quarterly Summary
## Highlights
- Faster onboarding flow
- Better reporting dashboard
- Three new integrations
```

---

## How the layout rebuild works

`lib/layout/rebuild.ts` is the interesting part. Tesseract already solves text detection and reading order; the job is to recover **semantics** from geometry:

1. **Font size** — median *word* box height per line (line boxes are distorted by `$`, descenders and padding).
2. **Headings** — a line ≥ 1.2× the median word height; shorter lines become `#`/`##`/`###`.
3. **Lists** — leading bullet glyphs (`•`, `«` when Tesseract misreads a bullet, `+`, `-`) or numbering, including a heading that shares a paragraph with its list. Indented markers become nested items: the marker positions of a list are clustered over the whole page, so a sub-item stays a sub-item even when Tesseract splits the list across paragraphs.
4. **Tables** — words are grouped into cells by gaps much larger than the median word gap; two or more vertically adjacent rows with aligned columns become a pipe table. A row whose trailing cells are empty is padded to the table's width instead of breaking the table in two, and a row with an empty *middle* cell (`Total`, ``, `$9.00`) is projected onto the existing column starts so the values stay under the right headings.
5. **Columns** — a grid whose cells contain whole phrases is a text layout, not a table: each column's cells become synthetic lines and are rendered with the same semantics as any other paragraph (headings, lists, fields, code). Columns are read one after the other, so a two-column article does not interleave, and a table below the columns still lands after them.
6. **Label/value pairs** — a two-column grid whose first row is *not* a header comes out as `Label: Value` lines. A row only counts as a header when it names the column it introduces (usually a word above a column of numbers) and at least two rows of data agree. Stacked pairs are also recognised outside tables: a small label with a larger value directly beneath it is a form field, and consecutive field paragraphs are grouped when the gap between fields is larger than the gap inside one.
7. **Code** — symbol density, code keywords, indentation and shell prompts. Indentation is re-derived from word x-offsets because Tesseract drops leading spaces.
8. **Paragraphs** — line text is joined, hyphenated words are repaired, CJK characters are joined without spaces.

Tables, lists and code blocks are merged when Tesseract splits one logical block across several paragraphs.

### Choosing what to read

`lib/regions.ts` applies the boxes from the region dialog to the untouched capture:

- **Exclude** boxes are painted out first. The fill colour is the median of the four corner patches, so a cookie banner disappears from a light page and a dark capture stays dark.
- **Keep** boxes are cut out of the masked image and stacked top-to-bottom in reading order, with a small gap so the last line of one box cannot touch the first line of the next. With no keep boxes, the whole (masked) image is read.
- Every box is measured against the original pixels. Region edits therefore never compound: excluding a banner and then adding a keep box does not re-crop an already-cropped image, and the boxes can be edited in any order.

### Image quality

`lib/preprocess.ts` measures and normalises each capture in one canvas pass:

- **Sharpness** — variance of a 4-neighbour Laplacian on a subsample, plus edge density so a blank page is not called blurry.
- **Contrast** — the 0.5 %/99.5 % luminance spread. The tails are small on purpose: a sparse capture has ~1 % ink, so a 2 % clip would measure the background.
- **Rescue** — flat, grey-on-grey captures get contrast-limited histogram equalisation blended with a linear stretch; normal captures keep the plain percentile stretch.
- **Geometry** — dark captures are inverted, tiny ones upscaled to ~1280 px (max 3×), huge ones capped at 9 MP.

Those signals become the chips under the result: *Soft capture*, *Low contrast boosted*, *Re-read at higher detail*.

### Two-pass OCR

Layout analysis is the usual failure mode, not character recognition: a panel, a receipt or a code block can be split into nonsense blocks. The pipeline therefore runs `AUTO` first and only retries with a different page-segmentation mode when the first result is unconvincing — no confidence (< 75), no findings at all, or structure present but low confidence. The retry uses `SPARSE_TEXT` when nothing was found and `SINGLE_BLOCK` otherwise. A retry has to beat the first result by a clear margin, so a good structured result is never flattened by a second pass. Confident captures pay for exactly one pass.

### Full page

`lib/fullpage.ts` captures a scrolling page in viewport-sized tiles and rebuilds it as one image's worth of Markdown:

- **Planning** — tiles overlap by 140 px, and the offsets are spread evenly so the last tile ends exactly at the bottom of the page. A page that would need more than 24 tiles is captured up to that cap and the result says so.
- **Scrolling** — the page's `scroll-behavior` is forced to `auto` and restored afterwards. Fixed and sticky elements are tagged before the first tile; from the second tile on they are hidden with `visibility: hidden`, which keeps their layout box so nothing shifts. The original scroll position is restored in a `finally` block.
- **Capture** — `chrome.tabs.captureVisibleTab` is rate-limited to roughly two calls per second, so tiles are spaced 620 ms apart. A five-tile page takes about three seconds to photograph.
- **Stitching** — joining the tiles' Markdown would duplicate text: Tesseract groups a whole tile of prose into one paragraph, so the same sentence appears inside two different giant lines. Instead the OCR **lines** are shifted into page coordinates (`scrollOffset × dpr × preparedScale + lineY`), de-duplicated when their boxes overlap and their text is similar, and a clipped fragment never replaces the complete line from the neighbouring tile. Paragraphs that span a seam are merged, then layout is rebuilt exactly once over the virtual page.
- **Ordering** — paragraphs keep the tile's own reading order. This protects sidebars and columns, which a global y-sort would interleave.

---

## Project structure

```
entrypoints/
  background.ts          service worker: visible/region/full-page capture, commands, context menu, pending payloads
  sidepanel/             React UI (the whole app lives in the side panel)
    App.tsx              states: capture → processing → result, regions, history, settings
    components/RegionsDialog.tsx  multi-box keep/exclude editor (drag, handles, keyboard)
    style.css            light/dark theme, accessible focus states
lib/
  ocr/engine.ts          Tesseract worker lifecycle + PSM switching (bundled worker/wasm/traineddata)
  ocr/types.ts           structural OCR types, decoupled from tesseract.js
  layout/rebuild.ts      OCR geometry → Markdown
  regions.ts             apply keep/exclude boxes and stack kept areas
  preprocess.ts          quality metrics, contrast/equalisation, invert, resize, thumbnails
  clean.ts               compaction pass (fence-aware)
  format.ts              Markdown → plain-text / outline presets
  merge.ts               append two captures, de-duplicate the seam
  fullpage.ts            tile plan, injected scroll/hide/restore, OCR line stitching
  tokens.ts              GPT-4o tokenizer (lazy-loaded) + image estimate
  region-selector.ts     injected region overlay and image locator
  pipeline.ts            preprocess → OCR (1–2 passes) → rebuild → clean → count, for one image or many tiles
  storage.ts             settings + local history
scripts/
  copy-assets.mjs        copies worker/wasm/traineddata/licenses into public/ (runs pre-build)
  make-icons.mjs         draws the PNG icons without image dependencies
  check-offline.mjs      asserts the CSP, permissions, bundled assets and licences
  fixtures.mjs           sixteen synthetic captures used by the benchmark
  benchmark.mjs          offline accuracy/timing benchmark
  e2e.mjs                end-to-end test in real Chrome
  store-shots.mjs        renders the 1280 × 800 store screenshots
  lib/harness.mjs        shared Chrome launch/panel/fixture helpers
  debug-layout.mjs       dumps raw Tesseract geometry for the test fixture
public/                  generated assets (icons, tessdata, tesseract core, licences)
store/                   Chrome Web Store pack: listing, privacy, permissions, QA, screenshots
.github/workflows/       verify (push/PR) and release (tag) pipelines
```

---

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Capture the tab only after you invoke the extension on it (toolbar icon, `Ctrl+Shift+X`, context menu). No always-on host access. Full page needs the same grant. |
| `scripting` | Inject the region overlay and the full-page scroll/hide/restore helpers into the current tab. |
| `sidePanel` | The entire UI. |
| `contextMenus` | "Extract text from this image". |
| `storage` | Settings and local history. |
| `clipboardWrite` | The copy button. |

No `<all_urls>`, no `tabs` (browsing history), no network host permissions.

**Privacy:** every asset — `worker.min.js`, the 3.9 MB WASM core, the 2.9 MB language model — is inside the extension. Chrome's MV3 ban on remote code is satisfied without exceptions. The service worker only moves images between the panel and the page.

### The offline guarantee is enforced, not promised

```json
"content_security_policy": {
  "extension_pages":
    "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self';
     img-src 'self' data: blob:; media-src 'none'; frame-src 'none'"
}
```

`connect-src 'self'` is the actual lock: the panel **and the OCR worker it spawns** may only fetch `chrome-extension://` URLs, so a request to any API or CDN is refused by Chrome itself. It cannot be `'none'` because Tesseract fetches its `traineddata` from the extension origin at runtime — that is the one connection the extension is allowed to make, and it never leaves the browser.

`npm run check:offline` verifies the built package (CSP directives, absence of host permissions, bundled worker/WASM/model sizes, local asset paths, no remote tags in the HTML, the license files, and no source maps or `node_modules`). `npm run test:e2e` additionally observes every outgoing request during a real OCR run and fails if one leaves the machine.

---

## Settings

- **Default format** — Markdown, plain text or outline; the view a new capture opens in. The tabs on a result change the current view only.
- **Compact output** — drop page numbers, repeated lines and extra blank lines.
- **Max image width** — 1600 / 2400 / 3200 px. Larger keeps small text, slower to read.
- History and settings live in `chrome.storage.local`.

### Output presets and merging

The pipeline always builds Markdown first, so structure is never lost. `lib/format.ts` derives the other views on demand:

- **Plain text** removes heading markers, turns tables into tab-separated rows, uses `•` for bullets, and unwraps code fences without touching the code.
- **Outline** keeps only headings and list items — a cheap skeleton of a long page.
- **Raw** shows Tesseract's own text output for troubleshooting.

`lib/merge.ts` joins captures by finding the longest suffix of the current result that matches the start of the next one. Two or more matching lines are trusted; a single repeated line only counts when it is a heading or table row, so a repeated footer like "Confidential" is not silently deleted. Markdown stays the source of truth, which means the tabs, copy button and download all work from the same text.

---

## Testing

```bash
npm run build
npm run check:offline  # CSP, permissions, bundled OCR assets
npm run test:e2e       # headless Chrome; HEADFUL=1 for a visible window
npm run benchmark      # accuracy/timing over sixteen synthetic captures
npm run store:shots    # renders the 1280 × 800 Chrome Web Store screenshots
npm run verify         # typecheck + build + offline check + e2e
```

The e2e test loads the real extension, renders fixtures in the panel (a document with a table + list, and a dark-mode code screenshot) and checks the Markdown for headings, list items, table syntax, code fences and dark-mode inversion. It switches through the plain-text and outline presets, appends a second capture and asserts the shared lines appear once, and captures a settings panel to check the label/value pairing. It also opens the region editor, adds and resizes a box, applies it and confirms the pipeline re-ran, then cuts a banner out of a capture and keeps only the body.

Full page has two more layers. A deterministic test feeds the stitcher overlapping synthetic OCR lines and checks the seam de-duplication, the clipped-line replacement, the reading order, the exact bottom offset and the 24-tile cap. A second test runs the **real** background loop against a tall local page: it scrolls, captures five tiles, restores the scroll position, then reads them and asserts all 70 paragraphs appear once, the fixed header appears once and the tile offsets end at the page bottom. Chrome refuses `sidePanel.open()` without a user gesture, which automation cannot produce, so that check runs a temporary copy of the build with `<all_urls>` and the panel in its own window (`launchWithHostAccess` in `lib/harness.mjs`). The shipped package still has no host permissions, and `check:offline` asserts that.

A third test covers page access. It opens a local page in the shipped build — no host permissions, no `activeTab` — and clicks **Select region** from a panel that was never invoked. The capture must fail with a "you need to grant access" message, not with "Chrome does not allow capturing this page", and the built background must keep `openPanelOnActionClick` off so the toolbar icon stays a real invocation.

It writes:

- `.output/e2e-result.md`
- `.output/e2e-panel.png`
- `.output/e2e-append.png`
- `.output/e2e-regions.png`
- `.output/e2e-light.png`

The benchmark scores phrase recall plus structural checks (heading, bullet, nested bullet, numbered list, table, padded row, empty middle cell, label/value pair, stacked form field, column order, column + table order, fence, indentation, quality notes) per fixture, reports confidence, sharpness, contrast and timing, and writes `.output/bench/benchmark.{json,md}` together with each rendered PNG and its Markdown. A gated fixture must reach 0.75 recall and pass every structural check; `--only=table,list` runs a subset. A snapshot on a normal desktop: 0.99 gated recall, under a second per capture after the engine is warm.

Debug a layout change without rebuilding the extension:

```bash
npm run debug:layout   # prints block/paragraph/line/word geometry + rebuilt Markdown
```

---

## Known limitations

- **English only** for now. To add a language: install `@tesseract.js-data/<lang>`, copy the `.traineddata.gz` into `public/tessdata/`, and pass `'eng+deu'` to `createWorker`.
- **No handwriting** — Tesseract's LSTM is built for print. Handwriting is out of scope while the extension stays fully offline.
- **Charts, photos and diagrams** contain little text; the panel tells you when nothing readable was found instead of returning noise.
- **Tables are best-effort** — simple grids work well; a middle cell that is empty keeps its column, but cells that visually span several columns still degrade. A two-column grid whose header cannot be told from its data becomes `Label: Value` lines, which keeps the content but drops the column names.
- **Columns are detected per capture** — a two-column article is read column by column, and a table below it is kept in order. Sidebars that interleave with body content at the same vertical level can still be misread.
- **Soft captures are detected, not fixed** — sharpness comes from Laplacian variance plus edge density; a soft, non-upscaled capture is flagged with a hint to crop tighter or recapture. Small captures are upscaled (up to 3×) before measuring, so they are never reported as blurry.
- **Region capture needs `activeTab`** — Chrome grants it when you invoke the extension on that tab (toolbar icon, `Ctrl+Shift+X`, context menu), not when you click inside the panel. Without the grant the panel says so and points at the icon. Pages Chrome blocks outright (`chrome://`, the Web Store, the PDF viewer) still need a paste or an upload.
- **Keep regions are stacked, not stitched in place** — several keep boxes are read top-to-bottom and joined with a short gap. That fixes reading order, but a box that cuts through a line of text will cut that line.
- **Exclude fills with the page background** — the fill is sampled from the corners. A photo or gradient at the corners can pick a colour that differs from the area being removed; OCR ignores the flat patch either way, but it can be visible in the thumbnail.
- **Full page is capped at 24 tiles** — roughly 16,000 px on an 800 px-tall viewport. Past that the result says it stopped; scroll to the rest and use **Add**, or capture a region.
- **Full page is vertical only** — it follows the document scroller, not an inner scrollable panel, and it does not follow horizontal scrolling.
- **Fixed/sticky chrome is hidden after the first tile** — a sticky header is captured once, at the top, and its space stays reserved so the page does not shift. A sticky element that *contains* body text (for example a sticky table header) therefore appears only once.
- **Full-page capture needs `activeTab` or host access** — Chrome blocks `captureVisibleTab` and `scripting` on `chrome://`, the Web Store, the PDF viewer and extension pages, and it only grants `activeTab` from a real invocation (toolbar icon, `Ctrl+Shift+X`, context menu). If full page fails, capture the visible tab or paste screenshots instead.
- **Full-page tiles are read one by one** — Tesseract is fast, but a 24-tile page takes a few seconds to photograph and several more to read. Cancel leaves the page where it was.
- **Very long single screenshots** are capped at 9 MP; text may get small. Capture in sections or use full page for best accuracy.
- **Append de-duplication is exact** — a repeated line is removed when its text matches. OCR differences at a seam can leave a duplicate; review the join or crop one of the captures.
- Tesseract occasionally misreads punctuation in code (e.g. `l` vs `1`). Review before sending exact code to an agent.

---

## Roadmap

Everything here stays offline; there is no server-side or vision-model step.

*Done: output presets and append/merge; the first layout-accuracy pass (column reading order, nested lists, label/value pairing, padded table rows); multi-box keep/exclude regions; layout accuracy round two (empty middle cells, stacked form fields, column semantics, mixed column + table reading order); and tiled full-page capture with overlap de-duplication — the last planned item.*

No further items are queued. Future work is maintenance and accuracy fixes for these features.

Release engineering is in place: MIT license, third-party notices inside the package, CI on every push and pull request, tagged releases with a SHA-256 and a GitHub release, and the Chrome Web Store pack in `store/`.

---

## Engine notes

`tesseract.js` is Apache-2.0, `gpt-tokenizer` is MIT. `wxt`, React and Puppeteer are MIT.

I deliberately did **not** use `scribe.js-ocr`, which produces nice Markdown out of the box: it is **AGPL-3.0**, which is viral for the whole extension. The layout engine here is original code.

## License

The extension itself is [MIT](LICENSE). The bundled OCR engine keeps its own
licence: `LICENSE` and `THIRD_PARTY_NOTICES.md` ship inside the package, and
`npm run check:offline` fails the build if either is missing.

## Releasing

`RELEASING.md` has the checklist. Short version: bump `version` in
`package.json`, update `CHANGELOG.md`, run `npm run verify`, tag `v<version>`,
and the `release` workflow verifies again, zips, writes a SHA-256 and publishes
the GitHub release. The store listing, privacy text, permission justifications,
screenshots (`npm run store:shots`) and the manual QA checklist live in `store/`.
