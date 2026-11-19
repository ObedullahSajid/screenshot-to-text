/**
 * Token counting for the panel.
 *
 * The GPT-4o vocabulary is ~2 MB of BPE ranks. Parsing it on the panel's thread
 * froze the UI for a few hundred milliseconds on a fast machine and several
 * seconds on a slow one, so the tokenizer runs in a dedicated worker and the
 * panel only waits for a number.
 */

/* ------------------------------------------------------------------ worker */

let worker: Worker | null = null;
let workerBroken = false;
let nextRequest = 1;
const pending = new Map<number, (count: number) => void>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  if (typeof Worker === 'undefined') {
    workerBroken = true;
    return null;
  }

  try {
    worker = new Worker(new URL('./tokens.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    workerBroken = true;
    return null;
  }

  worker.addEventListener('message', (event: MessageEvent<{ id: number; count: number }>) => {
    const settle = pending.get(event.data.id);
    if (!settle) return;
    pending.delete(event.data.id);
    settle(event.data.count);
  });

  // A worker that fails to load would leave every count hanging, so release the
  // waiters and let the approximate path take over from now on.
  worker.addEventListener('error', () => {
    workerBroken = true;
    worker?.terminate();
    worker = null;
    for (const settle of pending.values()) settle(-1);
    pending.clear();
  });

  return worker;
}

/** Returns null when the worker is unavailable or died mid-request. */
function countInWorker(text: string): Promise<number | null> {
  const instance = getWorker();
  if (!instance) return Promise.resolve(null);

  const id = nextRequest++;
  return new Promise((resolve) => {
    pending.set(id, (count) => resolve(count >= 0 ? count : null));
    instance.postMessage({ id, text });
  });
}

/* -------------------------------------------------------------------- API */

/**
 * Loads the vocabulary in the worker while the panel is idle, so the first
 * result does not wait for it. The parse never touches the panel thread.
 */
export function warmTokenizer(): Promise<void> {
  return countInWorker('warm').then(() => undefined);
}

/**
 * Exact-ish token count with the GPT-4o (o200k) vocabulary. Loaded lazily so the
 * vocabulary never blocks the first paint of the panel. If the worker cannot
 * start, the ~4 characters per token estimate keeps the meter honest enough.
 */
export async function countTextTokens(text: string): Promise<number> {
  if (!text.trim()) return 0;
  const fromWorker = await countInWorker(text);
  if (fromWorker !== null) return fromWorker;
  return Math.ceil(text.length / 4);
}

/**
 * Rough vision-token cost of the original screenshot (28 px patch grid, the
 * shape used by current vision models). Only used for the "saved" meter.
 */
export function estimateImageTokens(width: number, height: number): number {
  return Math.max(85, Math.ceil(width / 28) * Math.ceil(height / 28));
}
