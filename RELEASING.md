# Releasing

The version lives in exactly one place: `version` in `package.json`. WXT copies
it into the manifest at build time, and the release workflow refuses a tag that
does not match it.

## Checklist

1. `npm ci`
2. Bump `version` in `package.json`.
3. Move the changelog entries under the new version with today's date in
   `CHANGELOG.md`, and update the compare link at the bottom.
4. `npm run verify` — typecheck, build, offline guarantees, 61 e2e checks.
5. `npm run zip` → `.output/screenshot-to-text-<version>-chrome.zip`.
6. Commit, tag, push:

   ```bash
   git add -A
   git commit -m "Release <version>"
   git tag v<version>
   git push origin main --tags
   ```

7. The `release` workflow verifies again, builds the zip, writes
   `SHA256SUMS.txt`, and publishes a GitHub release with both attached.
8. Upload that same zip to the Chrome Web Store dashboard. The listing copy,
   privacy text, permission justifications and screenshots are in `store/`.

## Before the first submission

- `homepage_url` points at the public repository. Update it if the repository
  moves.
- Add `author: { email }` to the manifest if you want the store to show a
  contact address.
- Regenerate the store screenshots after any UI change:
  `node scripts/store-shots.mjs` (writes to `store/screenshots/`).
- Work through `store/qa-checklist.md` once on a clean Chrome profile.

## Verifying a release artifact

```bash
sha256sum -c SHA256SUMS.txt
```

Then load the unpacked zip in a throwaway profile and confirm the version in
`chrome://extensions` matches the tag.
