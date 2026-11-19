# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Full-page captures now show a live preview while the page is read. As tiles
  finish, the contiguous prefix from the top of the page is stitched and
  rendered into the progress card, so the beginning of the document is readable
  before the capture is complete. The preview follows the newest line unless you
  scroll up to read an earlier section, and the final stitched result replaces
  it. The two-tile e2e run checks that previews grow a tile at a time from the
  top.

## [0.3.0] - 2026-11-19

### Changed

- Wide captures now choose their OCR width from the image itself. A copy capped
  at 1600 px profiles ink per row and measures the text rows; when several lines
  are still at least 12 px tall, the capture is read at 1600 px instead of the
  preferred width. Small or dense text, too few detected lines and captures that
  are already narrow keep the preferred width, so the 14 px case that loses
  recall at 1600 px is left alone. On the benchmark's 22 px page this cuts the
  read from 13.1 s to 9.1 s with identical output and full row recall, and
  `npm run bench` now reports the width each wide page chose. Two end-to-end
  checks cover the real canvas path: large text is lowered, dense text is not.

## [0.2.0] - 2026-11-19

### Added

- **Browser-free unit tests** (`npm run test`): tiling maths, the partial-grid
  rule, keep/exclude filtering, blank-page detection, compaction and the
  worker-count rule.
- **Per-stage timing harness** (`npm run bench`): engine cold start, tokenizer,
  each pipeline stage, a long page read with one and two workers, and an OCR
  width sweep, written to `.output/bench/timing.{json,md}`.

### Changed

- Full-page captures read tiles on two Tesseract workers when the page has at
  least three tiles and the machine reports three or more cores and 4 GB+ of
  memory. Output is identical; on the benchmark the five-tile page went from
  22.6 s to 13.3 s (1.7×) and a nine-tile page from 39.0 s to 23.3 s (1.67×).
  Small pages, weak machines and a failed second worker stay on one worker, and
  the pool never grows past two because each worker holds its own ~100 MB copy
  of the core and language model.
- The OCR worker and token vocabulary now load while the panel is idle, so the
  first capture no longer pays their start-up. The vocabulary is parsed in a
  dedicated worker, so warming it never freezes the panel.
- Keep/exclude edits that only remove whole lines are applied to the recognised
  page and re-rendered, instead of reading the capture again (2 ms instead of
  ~450 ms on a small screenshot). A box that cuts through a line still triggers
  a full read, so no line is silently clipped.
- Blank tiles in a full-page capture are skipped instead of being passed to
  Tesseract.

### Notes

- The 2400 px OCR cap stays the default. The width sweep showed 1600 px is 36%
  faster on a 2560 px page of 22 px text with identical output, but dense 14 px
  text lost most of its rows at that size.

## [0.1.0] - 2026-11-13

First public release. Chrome-only, runs entirely on the device.

### Added

- **Screenshot to Markdown**: paste (`Ctrl+V`), drag & drop, file picker, region
  capture, the visible tab, or a scrolled full page.
- **Region capture** with `Ctrl+Shift+X` (`Command+Shift+X` on macOS): drag over
  any part of a page and read only that rectangle.
- **Full-page capture**: the page is scrolled and photographed in overlapping
  tiles (140 px overlap, up to 24 tiles) and stitched at OCR-line level, so a
  paragraph cut by a tile boundary appears once and stays complete.
- **Layout reconstruction**: headings, nested bullet and numbered lists, pipe
  tables with padded and empty cells, fenced code blocks with indentation,
  paragraph re-flowing, de-hyphenation, label/value pairing, and column-aware
  reading order.
- **Keep / exclude regions** on a result, without recapturing: cut out a cookie
  banner or read only the boxes you choose.
- **Four output views** — Markdown (editable), plain text, outline, and raw OCR
  — with a live token count and an image-token comparison.
- **Append captures** with seam merging, so a long document becomes one result.
- **History** of the last 20 captures, stored locally only.
- **Two-pass OCR** when the first pass is unconvincing, and quality hints for
  soft or low-contrast captures.
- Dark and light themes, keyboard access, reduced-motion support.

### Notes

- Page access is opt-in per tab: Chrome grants it when you invoke the extension
  (toolbar icon, `Ctrl+Shift+X`, context menu) and revokes it when you navigate
  or switch tabs. The panel explains this when a capture needs the grant.
- No host permissions, no network permissions, no analytics. The manifest CSP
  (`connect-src 'self'`) makes outbound requests impossible rather than
  discouraged.
- English OCR only in this release.
