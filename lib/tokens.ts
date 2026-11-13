type Counter = (text: string) => number;

let counter: Counter | null = null;

/**
 * Exact-ish token count with the GPT-4o (o200k) vocabulary. Loaded lazily so the
 * ~1.5 MB of BPE ranks never blocks the first paint of the panel.
 */
export async function countTextTokens(text: string): Promise<number> {
  if (!text.trim()) return 0;
  if (!counter) {
    try {
      const module = await import('gpt-tokenizer/model/gpt-4o');
      counter = module.countTokens;
    } catch {
      // Fallback if the tokenizer fails to load: ~4 characters per token.
      counter = (value: string) => Math.ceil(value.length / 4);
    }
  }
  return counter(text);
}

/**
 * Rough vision-token cost of the original screenshot (28 px patch grid, the
 * shape used by current vision models). Only used for the "saved" meter.
 */
export function estimateImageTokens(width: number, height: number): number {
  return Math.max(85, Math.ceil(width / 28) * Math.ceil(height / 28));
}
