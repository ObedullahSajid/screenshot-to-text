type Counter = (text: string) => number;

let counter: Counter | null = null;
let loading: Promise<Counter> | null = null;

function loadCounter(): Promise<Counter> {
  if (counter) return Promise.resolve(counter);
  if (!loading) {
    loading = import('gpt-tokenizer/model/gpt-4o')
      .then((module) => {
        counter = module.countTokens;
        return counter;
      })
      .catch(() => {
        // Fallback if the tokenizer fails to load: ~4 characters per token.
        const fallback: Counter = (value: string) => Math.ceil(value.length / 4);
        counter = fallback;
        return fallback;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

/**
 * Loads the ~1.5 MB GPT-4o vocabulary while the panel is idle, so the first
 * result does not pay for parsing it on the critical path.
 */
export function warmTokenizer(): Promise<void> {
  return loadCounter().then(() => undefined);
}

/**
 * Exact-ish token count with the GPT-4o (o200k) vocabulary. Loaded lazily so the
 * ~1.5 MB of BPE ranks never blocks the first paint of the panel.
 */
export async function countTextTokens(text: string): Promise<number> {
  if (!text.trim()) return 0;
  const count = await loadCounter();
  return count(text);
}

/**
 * Rough vision-token cost of the original screenshot (28 px patch grid, the
 * shape used by current vision models). Only used for the "saved" meter.
 */
export function estimateImageTokens(width: number, height: number): number {
  return Math.max(85, Math.ceil(width / 28) * Math.ceil(height / 28));
}
