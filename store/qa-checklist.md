# Release-candidate checklist

Run once per release on a clean Chrome profile, against the built package
(`.output/chrome-mv3` or the zip). Tick every line; anything that fails becomes
a blocker or a changelog note.

## Install and upgrade

- [ ] Fresh profile → **Load unpacked** → no install warning beyond the expected
      permission list.
- [ ] Toolbar icon opens the side panel (it is not swallowed by
      `openPanelOnActionClick`).
- [ ] Upgrade over a profile that ran 0.1.0: the icon still opens the panel.
- [ ] Panel stays open while switching tabs and reloading the extension.

## Page access

- [ ] On a normal page: click the icon, then **Select region** — overlay appears.
- [ ] **Visible tab** works right after the icon click.
- [ ] **Full page** works right after the icon click.
- [ ] Switch to another tab and click **Select region** without the icon — the
      panel shows the "doesn't have access" notice, not a blocked-page error.
- [ ] Click the icon on that tab, then retry — it works.
- [ ] `Ctrl+Shift+X` starts a region capture on the current tab.
- [ ] After navigating to a new page, the grant is gone and the notice returns.
- [ ] `chrome://extensions`, the Web Store page, the PDF viewer and a `file://`
      page each fail with the "blocked page" message (or the access notice),
      never with a crash.

## Capture paths

- [ ] Paste (`Ctrl+V`), drag & drop and the file picker all produce a result.
- [ ] Region capture with a very small drag (< 8 px) is treated as a cancel.
- [ ] Full page on a long article: result says `Full page · N tiles`, the page
      scroll position is restored, and a fixed header appears once.
- [ ] Cancel during a full-page capture restores the page.
- [ ] Right-click an image → **Extract text from this image**.

## Results

- [ ] Markdown view is editable; the token count updates as you type.
- [ ] Text / Outline / Raw tabs change the view but not the stored result.
- [ ] **Copy for agent** copies the active view.
- [ ] **Add** appends a second capture and de-duplicates the seam.
- [ ] **Regions** → exclude a banner; body text survives.
- [ ] **Regions** → keep a single box; only that text is read.
- [ ] History: 20 entries max, oldest drop off, **Clear history** works.
- [ ] Storage: fill history with large captures and confirm saving never shows
      a processing error.

## UI and accessibility

- [ ] Panel at 320 px, 420 px and 600 px: no clipped buttons, no horizontal
      scroll, full-page button spans the row.
- [ ] Dark and light system themes both render correctly.
- [ ] `prefers-reduced-motion: reduce` removes transitions.
- [ ] Keyboard only: tab to every control, `Enter`/`Space` activate, focus ring
      visible, `Esc` closes the region editor and overlays.
- [ ] Screen reader: the panel announces the job stage, errors (`role="alert"`)
      and the result summary.
- [ ] 200% display scaling: text is not clipped.

## Environment

- [ ] Chrome stable on Windows.
- [ ] Chrome stable on macOS (`Command+Shift+X`).
- [ ] Chrome at the declared minimum (116) — or raise the minimum.
- [ ] Edge loads the package and the panel opens (or the listing states
      Chrome-only).
