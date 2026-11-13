# Permission justifications

Paste one line per permission into the Chrome Web Store "Privacy practices"
form. Keep them factual: reviewers reject vague answers.

## `activeTab`

Access the page only after the user invokes the extension on it (toolbar icon,
`Ctrl+Shift+X` or the context menu), so a screenshot can be taken. The grant is
per tab and is revoked when the user navigates away. No host permissions are
requested, so the extension has no standing access to any site.

## `scripting`

Draw the drag-to-select overlay used for region capture, and run three small
helpers during a full-page capture: read the page size, temporarily hide
fixed/sticky elements after the first tile, and restore the original scroll
position and styles afterwards. No page data is read or stored.

## `sidePanel`

The extension's entire interface is a side panel. There is no popup, options
page or embedded page.

## `contextMenus`

Adds a single right-click item, "Extract text from this image", so a user can
capture one image and read its text without selecting a region.

## `storage`

Stores the user's three settings and a local history of the last 20 results,
including a small thumbnail. Nothing is synced or transmitted.

## `clipboardWrite`

The "Copy for agent" button writes the result to the clipboard.

## Host permissions

None. The extension requests no host permissions and declares no optional host
permissions. Screenshots rely on `activeTab`, which the user grants by invoking
the extension.

## Remote code

None. The OCR worker, the 3.9 MB WebAssembly core and the 2.9 MB English model
are files inside the package. The Content Security Policy is
`script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'`, and
`npm run check:offline` asserts both in CI.

## Data usage

The extension collects no user data. History and settings stay in
`chrome.storage.local` on the device and are deleted when the user clears
history or removes the extension. Declare: no data collected, no data sold, no
data used for creditworthiness or lending, no data transferred to third
parties.
