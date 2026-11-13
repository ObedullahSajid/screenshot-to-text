# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
