/**
 * Proves the built extension is offline-only.
 *
 * The hard guarantee is the manifest CSP: `connect-src 'self'` makes the
 * browser refuse every request that is not a chrome-extension:// file, in the
 * panel and in the OCR worker it spawns. These checks make sure that policy and
 * the bundled OCR assets survive a build.
 *
 * Usage: node scripts/check-offline.mjs
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, '.output', 'chrome-mv3');

const failures = [];
const passes = [];

function pass(message) {
  passes.push(message);
}
function fail(message) {
  failures.push(message);
}

function parseDirectives(csp) {
  const map = new Map();
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    map.set(tokens[0].toLowerCase(), tokens.slice(1));
  }
  return map;
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('Build first: npm run build');
  process.exit(1);
}

/* ------------------------------------------------------------- manifest */

const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
const csp = manifest.content_security_policy?.extension_pages ?? '';

if (!csp) {
  fail('manifest has no extension_pages CSP');
} else {
  const directives = parseDirectives(csp);
  const connect = directives.get('connect-src');
  if (!connect) {
    fail("CSP has no connect-src, so the extension could reach the network");
  } else if (connect.length === 1 && connect[0] === "'self'") {
    pass("CSP connect-src is exactly 'self' (no outbound network possible)");
  } else {
    fail(`CSP connect-src is permissive: ${connect.join(' ')}`);
  }

  const script = directives.get('script-src') ?? [];
  if (!script.includes("'self'")) fail('CSP script-src does not include self');
  if (script.includes('*') || script.some((value) => /^https?:/i.test(value))) {
    fail(`CSP script-src allows remote code: ${script.join(' ')}`);
  } else {
    pass('CSP script-src loads only local code');
  }
}

const permissions = manifest.permissions ?? [];
const hostPermissions = manifest.host_permissions ?? [];
const optionalHosts = manifest.optional_host_permissions ?? [];
if (hostPermissions.length === 0 && optionalHosts.length === 0) {
  pass('no host permissions (nothing to call out to)');
} else {
  fail(`host permissions declared: ${[...hostPermissions, ...optionalHosts].join(', ')}`);
}
if (permissions.includes('webRequest')) fail('webRequest permission is unnecessary');

/* --------------------------------------------------------------- assets */

const required = [
  ['tesseract/worker.min.js', 'Tesseract worker'],
  ['tesseract/tesseract-core-simd-lstm.wasm.js', 'WASM core'],
  ['tessdata/eng.traineddata.gz', 'English model'],
];

for (const [file, label] of required) {
  const path = join(dist, file);
  if (!existsSync(path)) {
    fail(`missing bundled ${label}: ${file}`);
    continue;
  }
  const size = (await stat(path)).size;
  if (size < 10_000) fail(`${label} looks truncated (${size} bytes)`);
  else pass(`${label} bundled locally (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

/* --------------------------------------------------------------- licenses */

for (const [file, label] of [
  ['LICENSE', 'project license'],
  ['THIRD_PARTY_NOTICES.md', 'third-party notices'],
]) {
  if (!existsSync(join(dist, file))) fail(`missing ${label}: ${file}`);
  else pass(`${label} ships with the package (${file})`);
}

const noticesPath = join(dist, 'THIRD_PARTY_NOTICES.md');
if (existsSync(noticesPath)) {
  const notices = await readFile(noticesPath, 'utf8');
  const hasApache = /Apache License\s+Version 2\.0/.test(notices);
  const hasMit = /MIT License/.test(notices);
  if (hasApache && hasMit) pass('Apache-2.0 and MIT texts are present');
  else fail(`THIRD_PARTY_NOTICES.md is missing ${!hasApache ? 'Apache-2.0' : 'MIT'} text`);
}

/* --------------------------------------------------------------- hygiene */

const packaged = await walk(dist);

const sourceMaps = packaged.filter((file) => file.endsWith('.map'));
if (sourceMaps.length) fail(`${sourceMaps.length} source map(s) shipped in the package`);
else pass('no source maps in the package');

const leaked = packaged.filter((file) => file.includes(`${sep}node_modules${sep}`));
if (leaked.length) fail(`node_modules leaked into the package (${leaked.length} files)`);
else pass('no node_modules in the package');

/* --------------------------------------------------------------- bundle */

const bundleFiles = (await walk(dist)).filter(
  (file) => file.endsWith('.js') && !file.includes(`${join(dist, 'tesseract')}`),
);
const bundle = (
  await Promise.all(bundleFiles.map((file) => readFile(file, 'utf8')))
).join('\n');

for (const needle of ['tesseract/worker.min.js', 'tesseract-core-simd-lstm.wasm.js', 'tessdata']) {
  if (bundle.includes(needle)) {
    pass(`bundle points at the local asset: ${needle}`);
  } else {
    fail(`bundle does not reference ${needle} (a library default may load it from a CDN)`);
  }
}

const html = await readFile(join(dist, 'sidepanel.html'), 'utf8');
const remoteTags = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\//gi)];
if (remoteTags.length) fail(`sidepanel.html loads ${remoteTags.length} remote resource(s)`);
else pass('sidepanel.html loads no remote resources');

/* --------------------------------------------------------------- report */

const hosts = new Map();
for (const match of bundle.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
  const host = match[1].toLowerCase();
  hosts.set(host, (hosts.get(host) ?? 0) + 1);
}

console.log('\nOffline check\n');
for (const line of passes) console.log(`  PASS  ${line}`);
for (const line of failures) console.log(`  FAIL  ${line}`);

if (hosts.size) {
  console.log('\n  URLs present in the bundle (inert strings, blocked by CSP):');
  const listed = [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [host, count] of listed) console.log(`    ${host} ×${count}`);
}

console.log(
  `\n${failures.length === 0 ? 'Offline guarantees hold' : `${failures.length} problem(s)`} ` +
    `(${relative(root, dist)})\n`,
);

process.exitCode = failures.length ? 1 : 0;
