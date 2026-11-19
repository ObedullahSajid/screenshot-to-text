/**
 * How many Tesseract workers a full-page capture may use.
 *
 * One worker is the safe default: a side panel is not a video editor, and every
 * worker holds its own copy of the wasm core and language model (~100 MB). A
 * long page is the one place where a second worker pays for itself, so it is
 * allowed only when the page has enough tiles to keep both busy and the machine
 * reports enough cores and memory.
 */

/** More than this competes for memory without finishing the page sooner. */
export const MAX_WORKERS = 2;

/** A page needs at least this many tiles before a second worker is useful. */
const MIN_TILES = 3;
const MIN_CORES = 3;
const MIN_MEMORY_GB = 4;

let limit = MAX_WORKERS;

export interface PoolInput {
  tiles: number;
  cores: number;
  /** Memory the browser reports, in GiB. Absent when it cannot be read. */
  memory?: number;
  /** Upper bound; the benchmark lowers it to compare one and two workers. */
  max?: number;
}

/** Pure so the decision can be tested without a browser. */
export function planWorkers({ tiles, cores, memory, max = MAX_WORKERS }: PoolInput): number {
  const cap = Math.max(1, Math.min(MAX_WORKERS, Math.floor(max)));
  if (tiles < MIN_TILES || cores < MIN_CORES) return 1;
  // An unknown memory figure is not a reason to refuse: Chrome exposes this on
  // desktop, and cores already gate the decision.
  if (memory !== undefined && memory < MIN_MEMORY_GB) return 1;
  return Math.min(cap, tiles);
}

/**
 * Debug and benchmark only: caps the pool without changing the real heuristic.
 * The panel never calls this; `?debug=1` exposes it.
 */
export function setMaxWorkers(value: number): void {
  limit = Number.isFinite(value)
    ? Math.max(1, Math.min(MAX_WORKERS, Math.floor(value)))
    : MAX_WORKERS;
}

function deviceMemory(): number | undefined {
  // Device Memory is Chromium-only and missing from the DOM typings.
  const value = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  return typeof value === 'number' ? value : undefined;
}

/** The pool size for a capture of `tiles` tiles on this machine. */
export function workersForTiles(tiles: number): number {
  return planWorkers({
    tiles,
    cores: navigator.hardwareConcurrency ?? 1,
    memory: deviceMemory(),
    max: limit,
  });
}
