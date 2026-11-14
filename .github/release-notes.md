Turn screenshots into clean, layout-preserving Markdown for AI agents. Everything
runs on your device: the OCR engine, its WebAssembly core and the English model are
bundled, and the extension has no network permission at all.

## Install (Chrome 116+, desktop)

The extension is not on the Chrome Web Store yet, so it installs as an unpacked
extension. Chrome works normally; you only turn **Developer mode** on once.

1. Download the `.zip` attached below.
2. Optional: compare it with `SHA256SUMS.txt`, also attached below.
   - PowerShell: `Get-FileHash .\screenshot-to-text-*-chrome.zip -Algorithm SHA256`
   - macOS: `shasum -a 256 screenshot-to-text-*-chrome.zip`
   - Linux: `sha256sum screenshot-to-text-*-chrome.zip`
3. Unzip it to a folder that stays put — a local path, not OneDrive, Dropbox or a
   network drive. The folder must contain `manifest.json` at its top level.
4. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
   and select that folder.
5. Pin the extension (puzzle-piece icon in the toolbar), then click it on any page
   to open the side panel.

The [install guide](https://github.com/ObedullahSajid/screenshot-to-text#install)
covers updating, uninstalling and troubleshooting.

## What changed

See [CHANGELOG.md](https://github.com/ObedullahSajid/screenshot-to-text/blob/main/CHANGELOG.md).
