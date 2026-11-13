export interface CleanOptions {
  /** Compact mode drops page numbers, repeated lines and excess blank lines. */
  compact: boolean;
}

const PAGE_NUMBER = /^\s*(page\s+)?\d{1,3}(\s*(of|\/)\s*\d{1,3})?\s*$/i;
const FENCE = /^```/;

export function cleanOutput(markdown: string, options: CleanOptions): string {
  const lines = markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''));

  const output: string[] = [];
  let inFence = false;
  let blanks = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (FENCE.test(trimmed)) {
      inFence = !inFence;
      output.push(line);
      blanks = 0;
      continue;
    }

    // Code is literal: never drop a repeated line, a numeric line or a blank
    // line inside a fence.
    if (inFence) {
      output.push(line);
      continue;
    }

    if (options.compact) {
      if (PAGE_NUMBER.test(trimmed)) continue;
      // Drop immediately repeated lines (common with sticky headers and
      // overlapping captures).
      if (trimmed && output[output.length - 1] === line) continue;
    }

    if (trimmed) {
      blanks = 0;
    } else if (++blanks > 1) {
      continue;
    }

    output.push(line);
  }

  while (output.length && !output[0].trim()) output.shift();
  while (output.length && !output[output.length - 1].trim()) output.pop();
  return output.join('\n');
}
