/**
 * Output presets. The pipeline always produces Markdown so the structure is
 * never lost; these helpers derive a plain-text or outline view from it at
 * display/copy time. Markdown stays the source of truth.
 */
export type OutputPreset = 'markdown' | 'text' | 'outline';

export function isOutputPreset(value: unknown): value is OutputPreset {
  return value === 'markdown' || value === 'text' || value === 'outline';
}

export function formatOutput(markdown: string, preset: OutputPreset): string {
  if (preset === 'markdown') return markdown;
  if (preset === 'text') return toPlainText(markdown);
  return toOutline(markdown);
}

/* ------------------------------------------------------------------ tables */

function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';

  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === '\\' && body[index + 1] === '|') {
      current += '|';
      index++;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function isTableLine(line: string): boolean {
  return line.trim().startsWith('|');
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/* ----------------------------------------------------------------- inline */

/** Removes the few inline markers the rebuild can emit. Code is handled apart. */
function plainInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`+([^`]+)`+/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1$2');
}

const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,3}[.)])\s+(.*)$/;

/* -------------------------------------------------------------- plain text */

/**
 * Human-readable text: no markers, tables as tab-separated rows, bullets as
 * `•`, fenced code unwrapped but left untouched. Useful when the consumer is
 * not a Markdown-aware model.
 */
function toPlainText(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();

    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      output.push(line.replace(/[ \t]+$/, ''));
      continue;
    }

    if (isTableLine(line)) {
      while (index < lines.length && isTableLine(lines[index])) {
        const cells = splitRow(lines[index]);
        if (!isSeparatorRow(cells)) {
          output.push(cells.map((cell) => plainInline(cell)).join('\t'));
        }
        index++;
      }
      index--;
      continue;
    }

    if (!trimmed) {
      output.push('');
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      output.push(plainInline(heading[2].trim()));
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      output.push(`${bullet[1]}• ${plainInline(bullet[2])}`);
      continue;
    }

    const numbered = line.match(NUMBERED);
    if (numbered) {
      output.push(`${numbered[1]}${numbered[2]} ${plainInline(numbered[3])}`);
      continue;
    }

    // A horizontal rule carries no text.
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) continue;

    output.push(plainInline(line.replace(/^\s*>\s?/, '')));
  }

  return tidy(output.join('\n'));
}

/* ----------------------------------------------------------------- outline */

/**
 * Skeleton view: headings and list items only, with body copy, tables and
 * code dropped. Handy for giving an agent the shape of a long page cheaply.
 */
function toOutline(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = line.match(HEADING);
    if (heading) {
      output.push(`${'#'.repeat(heading[1].length)} ${plainInline(heading[2].trim())}`);
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      output.push(`${bullet[1]}- ${plainInline(bullet[2])}`);
      continue;
    }

    const numbered = line.match(NUMBERED);
    if (numbered) {
      output.push(`${numbered[1]}${numbered[2]} ${plainInline(numbered[3])}`);
    }
  }

  return tidy(output.join('\n'));
}

function tidy(value: string): string {
  return value
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}
