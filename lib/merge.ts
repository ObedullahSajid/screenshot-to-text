import type { LayoutStats } from './layout/rebuild';

export interface MergeStats {
  /** Non-empty lines contributed by the new capture. */
  added: number;
  /** Non-empty lines dropped because they repeat the end of the previous capture. */
  overlap: number;
  /** Non-empty lines in the merged result. */
  total: number;
}

export interface MergeResult {
  markdown: string;
  stats: MergeStats;
}

/**
 * Joins two consecutive captures of the same page.
 *
 * The seam is where a scrolled screenshot repeats what the previous one
 * already showed. We look for the longest suffix of `base` that matches a
 * prefix of `next` and drop the duplicate. A single-line match is only trusted
 * for headings and table rows, where an exact repeat is structural rather than
 * a coincidence (footers such as "Confidential" would otherwise disappear).
 */
export function mergeOutputs(base: string, next: string): MergeResult {
  const left = toLines(base);
  const right = toLines(next);

  if (!left.length) {
    return {
      markdown: right.join('\n'),
      stats: { added: countContent(right), overlap: 0, total: countContent(right) },
    };
  }

  if (!right.length) {
    return {
      markdown: left.join('\n'),
      stats: { added: 0, overlap: 0, total: countContent(left) },
    };
  }

  const overlap = findOverlap(left, right);
  const tail = right.slice(overlap);
  const overlapLines = right.slice(0, overlap);

  let markdown: string;
  if (!tail.length) {
    markdown = left.join('\n');
  } else if (overlap > 0) {
    // The two captures were contiguous here, so no artificial blank line.
    markdown = [...left, ...tail].join('\n');
  } else {
    // Separate captures: leave a Markdown block boundary at the seam.
    markdown = `${left.join('\n')}\n\n${tail.join('\n')}`;
  }

  return {
    markdown,
    stats: {
      added: countContent(tail),
      overlap: countContent(overlapLines),
      total: countContent(markdown.split('\n')),
    },
  };
}

/** Adds the structural counts of two captures, weighting confidence by words. */
export function combineStats(base: LayoutStats, next: LayoutStats): LayoutStats {
  const words = base.words + next.words;
  const confidence =
    words > 0
      ? Math.round((base.confidence * base.words + next.confidence * next.words) / words)
      : Math.round((base.confidence + next.confidence) / 2);

  return {
    blocks: base.blocks + next.blocks,
    words,
    tables: base.tables + next.tables,
    headings: base.headings + next.headings,
    listItems: base.listItems + next.listItems,
    codeBlocks: base.codeBlocks + next.codeBlocks,
    confidence,
  };
}

/* --------------------------------------------------------------- internals */

function toLines(text: string): string[] {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
  return normalized ? normalized.split('\n') : [];
}

function key(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function countContent(lines: string[]): number {
  return lines.reduce((total, line) => total + (key(line) ? 1 : 0), 0);
}

function isStrongLine(line: string): boolean {
  const value = line.trim();
  return value.startsWith('|') || /^#{1,6}\s/.test(value);
}

function findOverlap(left: string[], right: string[]): number {
  const max = Math.min(left.length, right.length);

  for (let size = max; size >= 1; size--) {
    let content = 0;
    let matches = true;

    for (let offset = 0; offset < size; offset++) {
      const a = key(left[left.length - size + offset]);
      const b = key(right[offset]);
      if (a !== b) {
        matches = false;
        break;
      }
      if (a) content++;
    }

    if (!matches || content === 0) continue;
    // A lone repeated line is weak evidence; only structure is trusted.
    if (size === 1 && !isStrongLine(right[0])) continue;
    return size;
  }

  return 0;
}
