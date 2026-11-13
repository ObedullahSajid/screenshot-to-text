import type { Bbox, OcrBlock, OcrLine, OcrPage, OcrParagraph, OcrWord } from '../ocr/types';

export interface LayoutStats {
  blocks: number;
  words: number;
  tables: number;
  headings: number;
  listItems: number;
  /** Paragraphs that were rendered as a fenced code block. */
  codeBlocks: number;
  confidence: number;
}

export interface LayoutResult {
  markdown: string;
  stats: LayoutStats;
}

type Kind = 'list' | 'ordered' | 'code' | 'other';

interface Output {
  md: string;
  kind: Kind;
}

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const centerY = (box: Bbox) => (box.y0 + box.y1) / 2;
const visible = (line: OcrLine) => clean(line.text).length > 0;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Tesseract's own layout analysis decides the reading order, so we keep its
 * block order and only re-derive semantics: headings, lists, tables, code and
 * paragraphs. Geometry comes from word bounding boxes, which are far more
 * stable than line boxes (a "$" or a descender inflates a line box).
 */
export function rebuildLayout(page: OcrPage): LayoutResult {
  const stats: LayoutStats = {
    blocks: 0,
    words: 0,
    tables: 0,
    headings: 0,
    listItems: 0,
    codeBlocks: 0,
    confidence: Math.round(page.confidence ?? 0),
  };

  const blocks = (page.blocks ?? []).filter((block) => block && block.bbox);
  if (!blocks.length) {
    const fallback = (page.text ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
    stats.words = fallback ? fallback.split(/\s+/).length : 0;
    return { markdown: fallback, stats };
  }

  interface Entry {
    paragraph: OcrParagraph;
    lines: OcrLine[];
  }

  const entries: Entry[] = [];
  for (const block of blocks) {
    const paragraphs = [...(block.paragraphs ?? [])].sort(
      (a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0,
    );
    for (const paragraph of paragraphs) {
      const lines = [...(paragraph.lines ?? [])]
        .filter(visible)
        .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
      if (lines.length) entries.push({ paragraph, lines });
    }
  }

  const allLines = entries.flatMap((entry) => entry.lines);
  const medianHeight = median(allLines.map(lineHeight)) || 16;
  const medianCharWidth =
    median(
      allLines.flatMap((line) =>
        (line.words ?? [])
          .filter((word) => clean(word.text))
          .map((word) => (word.bbox.x1 - word.bbox.x0) / Math.max(1, clean(word.text).length)),
      ),
    ) || medianHeight * 0.5;

  // A word space is much narrower than a table gutter. Measuring the gap
  // against the median glyph advance keeps the threshold stable even when most
  // lines in the capture are table rows (where cell gutters would dominate a
  // median-of-gaps estimate).
  const gapThreshold = Math.max(medianCharWidth * 2.5, medianHeight * 1.2, 18);

  const layouts = detectLayouts(entries, medianHeight, gapThreshold);
  const layoutByParagraph = new Map<OcrParagraph, Layout>();
  for (const layout of layouts) {
    for (const paragraph of layout.paragraphs) layoutByParagraph.set(paragraph, layout);
  }

  // List markers are indented relative to their list, not to the paragraph
  // they happen to land in, so the levels are worked out over the whole page.
  const listLevels = computeListLevels(allLines, medianHeight, medianCharWidth);

  stats.blocks = blocks.filter((block) => clean(block.text)).length;
  stats.words = allLines.reduce(
    (total, line) =>
      total + ((line.words ?? []).filter((word) => clean(word.text)).length ||
        clean(line.text).split(' ').length),
    0,
  );

  const emitted = new Set<Layout>();
  const sections: Output[] = [];

  const push = (output: Output) => {
    const previous = sections[sections.length - 1];
    if (output.kind === 'code' && previous?.kind === 'code') {
      // Tesseract can split one code block into several paragraphs.
      previous.md = `\`\`\`\n${unfence(previous.md)}\n${unfence(output.md)}\n\`\`\``;
      return;
    }
    if (output.kind !== 'other' && previous?.kind === output.kind) {
      previous.md += `\n${output.md}`;
    } else {
      sections.push(output);
    }
  };

  // A code block split into one paragraph per line. Consecutive single lines
  // that each look like code are stitched back into one fence.
  let codeRun: OcrLine[] = [];
  const flushCodeRun = () => {
    if (!codeRun.length) return;
    const lines = codeRun;
    codeRun = [];
    if (lines.length >= 2) {
      const md = renderCode(lines);
      if (md) {
        stats.codeBlocks++;
        push({ md, kind: 'code' });
        return;
      }
    }
    for (const line of lines) push({ md: clean(line.text), kind: 'other' });
  };

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const layout = layoutByParagraph.get(entry.paragraph);
    if (layout) {
      flushCodeRun();
      if (!emitted.has(layout)) {
        emitted.add(layout);
        if (layout.kind === 'table') {
          stats.tables++;
          push({ md: renderTable(layout.rows), kind: 'other' });
        } else {
          for (const section of renderColumns(
            layout.columns,
            medianHeight,
            medianCharWidth,
            listLevels,
            stats,
          )) {
            push({ md: section, kind: 'other' });
          }
        }
      }
      continue;
    }

    // A form is usually one paragraph per field. Group the pair-shaped
    // paragraphs back together before falling through to prose rendering.
    const fields = collectFieldGroup(
      entries,
      index,
      layoutByParagraph,
      medianHeight,
      medianCharWidth,
    );
    if (fields) {
      flushCodeRun();
      push(renderFields(fields.pairs));
      index += fields.consumed - 1;
      continue;
    }

    const output = renderParagraph(
      entry.lines,
      medianHeight,
      medianCharWidth,
      listLevels,
      stats,
    );
    if (!output) continue;

    if (
      output.kind === 'other' &&
      entry.lines.length === 1 &&
      !/^#{1,3}\s/.test(output.md) &&
      isStrongCodeLine(clean(entry.lines[0].text))
    ) {
      codeRun.push(entry.lines[0]);
      continue;
    }

    flushCodeRun();
    push(output);
  }
  flushCodeRun();

  return {
    markdown: sections
      .map((section) => section.md)
      .filter(Boolean)
      .join('\n\n'),
    stats,
  };
}

/* ---------------------------------------------------------------- geometry */

function lineHeight(line: OcrLine): number {
  const heights = (line.words ?? [])
    .filter((word) => clean(word.text))
    .map((word) => word.bbox.y1 - word.bbox.y0)
    .filter((height) => height > 3);
  if (heights.length) return median(heights);
  return Math.max(0, line.bbox.y1 - line.bbox.y0);
}

/** Median glyph advance in a line; a font-size proxy that ignores descenders. */
function lineCharWidth(line: OcrLine): number {
  const widths = (line.words ?? [])
    .filter((word) => clean(word.text))
    .map((word) => (word.bbox.x1 - word.bbox.x0) / Math.max(1, clean(word.text).length))
    .filter((width) => width > 0);
  return median(widths) || 0;
}

/* ---------------------------------------------------------------- headings */

function tryHeading(
  line: OcrLine,
  medianHeight: number,
  medianCharWidth: number,
): string | null {
  const words = (line.words ?? []).filter((word) => clean(word.text));
  return headingFrom(clean(line.text), words, medianHeight, medianCharWidth);
}

/**
 * A line is a heading when its glyphs are clearly larger than the body text.
 * Word-box height alone under-reports large text that happens to have no
 * descenders ("Preferences"), so glyph *width* counts as well.
 */
function headingFrom(
  text: string,
  words: OcrWord[],
  medianHeight: number,
  medianCharWidth: number,
): string | null {
  if (!text || text.length > 90) return null;

  const heights = words
    .map((word) => word.bbox.y1 - word.bbox.y0)
    .filter((height) => height > 3);
  const widths = words
    .map((word) => (word.bbox.x1 - word.bbox.x0) / Math.max(1, clean(word.text).length))
    .filter((width) => width > 0);

  const heightRatio = (median(heights) || 0) / Math.max(1, medianHeight);
  const widthRatio = (median(widths) || 0) / Math.max(1, medianCharWidth);
  const ratio = Math.max(heightRatio, widthRatio * 0.95);
  if (ratio < 1.2) return null;

  // A line that ends like a sentence and is only slightly larger is body copy.
  if (ratio < 1.8 && /[.;:,]$/.test(text)) return null;

  const level = ratio >= 1.85 ? 1 : ratio >= 1.45 ? 2 : 3;
  return `${'#'.repeat(level)} ${text}`;
}

/* ------------------------------------------------------------------- lists */

const BULLET = /^\s*(?:[•·▪◦●○■□◆◇►▶→✓✔+*«»]|[-–—])\s+/;
const NUMBERED = /^\s*(?:\(?\d{1,3}[.)]|[a-zA-Z][.)])\s+/;

interface ListItem {
  text: string;
  /** Indentation level, 0 for the outermost items. */
  level: number;
}

function tryList(
  lines: OcrLine[],
  medianCharWidth: number,
  listLevels: Map<OcrLine, number>,
): Output | null {
  if (!lines.length) return null;

  const bulleted = lines.filter((line) => BULLET.test(line.text)).length;
  const numbered = lines.filter((line) => NUMBERED.test(line.text)).length;
  const marked = bulleted + numbered;
  if (!marked) return null;
  if (lines.length > 1 && marked / lines.length < 0.5) return null;

  const ordered = numbered > bulleted;
  const matcher = ordered ? NUMBERED : BULLET;

  const items: ListItem[] = [];
  const indents: number[] = [];
  for (const line of lines) {
    const match = line.text.match(matcher);
    if (match) {
      const text = clean(line.text.slice(match[0].length));
      if (text) {
        items.push({ text, level: listLevels.get(line) ?? 0 });
        indents.push(markerX(line));
      }
    } else if (items.length) {
      items[items.length - 1].text = joinSmart(items[items.length - 1].text, clean(line.text));
    }
  }
  if (!items.length) return null;

  // Nested items are indented further than their parent. The exact indent is
  // unknown, so the distinct marker positions are clustered instead: the
  // leftmost cluster is level 0, the next one level 1, and so on. The page
  // level map is authoritative; the local clustering is the fallback for a
  // list the page scan did not see.
  if (!items.some((item) => item.level > 0)) {
    const levels = clusterLevels(indents, medianCharWidth);
    items.forEach((item, index) => {
      item.level = levels[index] ?? 0;
    });
  }

  const counters: number[] = [];
  const md = items
    .map((item) => {
      if (ordered) {
        counters[item.level] = (counters[item.level] ?? 0) + 1;
        for (let level = item.level + 1; level < counters.length; level++) counters[level] = 0;
        return `${'   '.repeat(item.level)}${counters[item.level]}. ${item.text}`;
      }
      return `${'  '.repeat(item.level)}- ${item.text}`;
    })
    .join('\n');

  return { md, kind: ordered ? 'ordered' : 'list' };
}

/**
 * Works out the indent level of every list marker on the page.
 *
 * Markers that sit at the same x belong to the same level; markers further
 * right are nested. Lists that are far apart vertically are separate lists,
 * so they are measured on their own.
 */
function computeListLevels(
  allLines: OcrLine[],
  medianHeight: number,
  medianCharWidth: number,
): Map<OcrLine, number> {
  const levels = new Map<OcrLine, number>();
  const candidates = allLines.filter(
    (line) => BULLET.test(line.text) || NUMBERED.test(line.text),
  );
  if (!candidates.length) return levels;

  const groupGap = Math.max(medianHeight * 4, 30);
  const groups: OcrLine[][] = [];
  let current: OcrLine[] = [];
  let previous: OcrLine | undefined;

  for (const line of candidates) {
    if (previous && line.bbox.y0 - previous.bbox.y1 > groupGap) {
      groups.push(current);
      current = [];
    }
    current.push(line);
    previous = line;
  }
  if (current.length) groups.push(current);

  for (const group of groups) {
    const groupLevels = clusterLevels(
      group.map(markerX),
      medianCharWidth,
    );
    group.forEach((line, index) => levels.set(line, groupLevels[index] ?? 0));
  }

  return levels;
}

/** The x position of a list marker, i.e. of the line's first word. */
function markerX(line: OcrLine): number {
  const word = (line.words ?? []).find((candidate) => clean(candidate.text));
  return word ? word.bbox.x0 : line.bbox.x0;
}

/**
 * Turns marker positions into indent levels: positions that sit within a
 * character width of each other belong to the same level.
 */
function clusterLevels(indents: number[], medianCharWidth: number): number[] {
  if (!indents.length) return [];
  const tolerance = Math.max(4, medianCharWidth * 0.8);
  const sorted = [...indents].sort((a, b) => a - b);

  const clusters: number[] = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (last === undefined || value - last > tolerance) clusters.push(value);
  }

  return indents.map((value) => {
    let level = 0;
    for (const cluster of clusters) {
      if (value - cluster <= tolerance) break;
      level++;
    }
    return level;
  });
}

/* ------------------------------------------------------------- field pairs */

interface FieldPair {
  label: string;
  value: string;
  labelTop: number;
  labelBottom: number;
  valueTop: number;
  valueBottom: number;
  labelHeight: number;
  valueHeight: number;
}

const SENTENCE_END = /[.!?]$/;

/**
 * A short line that names the field below it. Labels are title-ish and do not
 * end like a sentence; "Password" and "Max image width" pass, prose does not.
 */
function looksLikeLabel(value: string): boolean {
  const text = clean(value).replace(/:\s*$/, '');
  if (!text || text.length > 28) return false;
  if (SENTENCE_END.test(text)) return false;
  if (BULLET.test(text) || NUMBERED.test(text)) return false;
  if (/[,;]/.test(text)) return false;
  if (!/^[A-Z0-9]/.test(text)) return false;
  return text.split(/\s+/).length <= 4;
}

function looksLikeValue(value: string): boolean {
  const text = clean(value);
  if (!text || text.length > 64) return false;
  if (BULLET.test(text) || NUMBERED.test(text)) return false;
  return text.split(/\s+/).length <= 8;
}

/**
 * Reads two stacked lines as a label/value pair, the way a form field or a
 * sidebar row is laid out: label first, value directly under it.
 */
function readFieldPair(
  lines: OcrLine[],
  medianHeight: number,
  medianCharWidth: number,
): FieldPair | null {
  if (lines.length !== 2) return null;
  const [label, value] = lines;
  const labelText = clean(label.text);
  const valueText = clean(value.text);
  if (!looksLikeLabel(labelText) || !looksLikeValue(valueText)) return null;

  // The value sits under the label, not beside it.
  if (Math.abs(label.bbox.x0 - value.bbox.x0) > Math.max(6, medianCharWidth * 1.5)) {
    return null;
  }
  const gap = value.bbox.y0 - label.bbox.y1;
  if (gap > Math.max(medianHeight * 1.8, 18)) return null;

  return {
    label: labelText.replace(/:\s*$/, ''),
    value: valueText,
    labelTop: label.bbox.y0,
    labelBottom: label.bbox.y1,
    valueTop: value.bbox.y0,
    valueBottom: value.bbox.y1,
    labelHeight: lineHeight(label),
    valueHeight: lineHeight(value),
  };
}

function renderFields(pairs: FieldPair[]): Output {
  return {
    md: pairs.map((pair) => `${pair.label}: ${pair.value}`).join('\n'),
    kind: 'other',
  };
}

/**
 * A single paragraph can hold a whole form: label, value, label, value. Pairs
 * are only accepted when the vertical rhythm proves the pairing — a bigger gap
 * between fields than inside a field — or when the label is visibly smaller.
 */
function tryFieldPairs(
  lines: OcrLine[],
  medianHeight: number,
  medianCharWidth: number,
): Output | null {
  if (lines.length < 2) return null;

  if (lines.length === 2) {
    const pair = readFieldPair(lines, medianHeight, medianCharWidth);
    if (!pair) return null;
    const colon = /:\s*$/.test(clean(lines[0].text));
    // A lone pair needs a typographic cue: a colon, or a smaller label. Two
    // ordinary lines in a row are far more likely to be prose.
    if (!colon && pair.valueHeight < pair.labelHeight * 1.15) return null;
    return renderFields([pair]);
  }

  if (lines.length % 2 !== 0) return null;

  const pairs: FieldPair[] = [];
  for (let index = 0; index < lines.length; index += 2) {
    const pair = readFieldPair(lines.slice(index, index + 2), medianHeight, medianCharWidth);
    if (!pair) return null;
    pairs.push(pair);
  }
  if (!fieldRhythm(pairs)) return null;
  return renderFields(pairs);
}

/** The gap between fields should be larger than the gap inside a field. */
function fieldRhythm(pairs: FieldPair[]): boolean {
  if (pairs.length < 2) return false;
  const inner = median(pairs.map((pair) => pair.valueTop - pair.labelBottom));
  const outer = median(
    pairs.slice(1).map((pair, index) => pair.labelTop - pairs[index].valueBottom),
  );
  return outer > inner * 1.2;
}

/**
 * A form is often split by Tesseract into one two-line paragraph per field.
 * Consecutive pair-shaped paragraphs are grouped back into one block when the
 * spacing between them proves they belong together.
 */
function collectFieldGroup(
  entries: Array<{ paragraph: OcrParagraph; lines: OcrLine[] }>,
  start: number,
  layouts: Map<OcrParagraph, Layout>,
  medianHeight: number,
  medianCharWidth: number,
): { pairs: FieldPair[]; consumed: number } | null {
  const pairs: FieldPair[] = [];
  let index = start;

  while (index < entries.length) {
    const entry = entries[index];
    if (entry.lines.length !== 2 || layouts.has(entry.paragraph)) break;
    const pair = readFieldPair(entry.lines, medianHeight, medianCharWidth);
    if (!pair) break;
    pairs.push(pair);
    index++;
  }

  if (pairs.length < 2 || !fieldRhythm(pairs)) return null;
  return { pairs, consumed: index - start };
}

/* -------------------------------------------------------------------- code */

const CODE_TOKEN =
  /\b(const|let|var|function|class|interface|type|import|export|return|await|async|def|public|private|static|void|if|else|for|while|try|catch|new|from)\b/;

function symbolRatio(text: string): number {
  const symbols = text.match(/[{}[\]()<>;=+*/\\|&%$#@!?~^`]/g)?.length ?? 0;
  return symbols / Math.max(1, text.length);
}

function looksLikeCode(text: string): boolean {
  if (/^\s{2,}\S/.test(text)) return true;
  if (symbolRatio(text) > 0.2) return true;
  if (CODE_TOKEN.test(text) && /[=;{}()]/.test(text)) return true;
  if (/^(<\/|$\s|>\s|[a-z-]+:\s)/.test(text.trim())) return true;
  return false;
}

function tryCode(lines: OcrLine[]): Output | null {
  if (lines.length < 2) return null;

  const texts = lines.map((line) =>
    line.text.replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+$/, ''),
  );
  const codey = texts.filter(looksLikeCode).length / texts.length;
  if (codey < 0.6) return null;

  const md = renderCode(lines);
  if (!md) return null;
  return { md, kind: 'code' };
}

/**
 * A single line that is strongly code-like. Used to stitch a code block back
 * together when Tesseract's layout analysis puts every line in its own
 * paragraph (common after upscaling a small capture).
 */
function isStrongCodeLine(text: string): boolean {
  if (/[{};]\s*$/.test(text)) return true;
  if (/^\s*[})\]]/.test(text)) return true;
  if (symbolRatio(text) > 0.22) return true;
  return CODE_TOKEN.test(text) && /[=;{}()]/.test(text);
}

/** Re-indents code from word x-offsets; Tesseract drops leading spaces. */
function renderCode(lines: OcrLine[]): string | null {
  const texts = lines.map((line) =>
    line.text.replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+$/, ''),
  );

  const words = lines.flatMap((line) => (line.words ?? []).filter((word) => clean(word.text)));
  const charWidth =
    median(
      words.map((word) => (word.bbox.x1 - word.bbox.x0) / Math.max(1, word.text.length)),
    ) || 8;
  const firstStarts = words.map((word) => word.bbox.x0);
  const baseX = firstStarts.length ? Math.min(...firstStarts) : 0;

  const body = lines
    .map((line, index) => {
      const first = (line.words ?? []).find((word) => clean(word.text));
      const delta = first ? first.bbox.x0 - baseX : 0;
      const spaces = delta > charWidth * 0.6 ? Math.min(8, Math.round(delta / charWidth)) : 0;
      return `${' '.repeat(spaces)}${texts[index].trim()}`;
    })
    .join('\n')
    .replace(/\s+$/, '');

  if (!body.trim()) return null;
  return ['```', body, '```'].join('\n');
}

function unfence(markdown: string): string {
  return markdown.replace(/^```\n?/, '').replace(/\n?```$/, '');
}

/* ------------------------------------------------------- tables and columns */

interface Table {
  kind: 'table';
  paragraphs: Set<OcrParagraph>;
  rows: string[][];
}

/** A grid whose cells are sentences: a two-column text layout, not a table. */
interface ColumnRun {
  kind: 'columns';
  paragraphs: Set<OcrParagraph>;
  /** One entry per visual column, each holding that column's cells in order. */
  columns: OcrWord[][][];
}

type Layout = Table | ColumnRun;

interface TableLine {
  paragraph: OcrParagraph;
  line: OcrLine;
  cells: OcrWord[][];
  lefts: number[];
}

function splitCells(line: OcrLine, gapThreshold: number): OcrWord[][] | null {
  const words = (line.words ?? []).filter((word) => clean(word.text));
  if (!words.length) return null;

  const cells: OcrWord[][] = [];
  let current: OcrWord[] = [words[0]];
  for (let index = 1; index < words.length; index++) {
    const gap = words[index].bbox.x0 - words[index - 1].bbox.x1;
    if (gap > gapThreshold) {
      cells.push(current);
      current = [words[index]];
    } else {
      current.push(words[index]);
    }
  }
  cells.push(current);

  return cells;
}

/**
 * Maps the cells of a short row onto the table's existing column starts.
 *
 * A middle cell can be empty — `Total`, ``, `$9.00` — which Tesseract reports
 * as two cells. Padding on the right would slide the money into the quantity
 * column, so each cell is instead matched to the column start it lines up
 * with. Columns before, between and after the cells stay empty.
 */
function projectCells(
  cells: OcrWord[][],
  targetLefts: number[],
  tolerance: number,
): OcrWord[][] | null {
  if (cells.length >= targetLefts.length) return null;

  const projected: OcrWord[][] = targetLefts.map(() => []);
  let last = -1;

  for (const cell of cells) {
    const start = cell[0]?.bbox.x0;
    if (start === undefined) return null;

    // Cells keep their left-to-right order, so only later columns are candidates.
    let best = -1;
    let bestDelta = Infinity;
    for (let index = last + 1; index < targetLefts.length; index++) {
      const delta = Math.abs(start - targetLefts[index]);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = index;
      }
    }
    if (best < 0 || bestDelta > tolerance) return null;

    projected[best] = cell;
    last = best;
  }

  return projected;
}

function detectLayouts(
  entries: Array<{ paragraph: OcrParagraph; lines: OcrLine[] }>,
  medianHeight: number,
  gapThreshold: number,
): Layout[] {
  const layouts: Layout[] = [];
  const tolerance = Math.max(medianHeight * 2, 24);
  let run: TableLine[] = [];

  const flush = () => {
    if (run.length >= 2) {
      const columnCount = Math.max(...run.map((row) => row.cells.length));
      if (columnCount >= 2 && columnCount <= 8) {
        const paragraphs = new Set(run.map((row) => row.paragraph));
        if (looksLikeColumns(run)) {
          const columns: OcrWord[][][] = [];
          for (let index = 0; index < columnCount; index++) {
            columns.push(
              run.map((row) => row.cells[index] ?? []).filter((cell) => cell.length > 0),
            );
          }
          layouts.push({ kind: 'columns', paragraphs, columns });
        } else {
          const rows = run.map((row) =>
            row.cells.map((cell) => clean(cell.map((word) => word.text).join(' '))),
          );
          const firstCellIsBullet = run.every((row) =>
            /^[•·▪◦●○■□◆◇►▶→✓✔+*«»\-–—]$/.test(
              clean(row.cells[0].map((word) => word.text).join(' ')),
            ),
          );
          const consistent = rows.every((row) => row.every((cell) => cell.length <= 60));

          if (!firstCellIsBullet && consistent) {
            layouts.push({ kind: 'table', paragraphs, rows });
          }
        }
      }
    }
    run = [];
  };

  for (const entry of entries) {
    for (const line of entry.lines) {
      const cells = splitCells(line, gapThreshold);
      if (!cells) {
        flush();
        continue;
      }

      const previous = run[run.length - 1];
      let rowCells = cells;
      let lefts = cells.map((cell) => cell[0].bbox.x0);

      if (previous && cells.length < previous.cells.length) {
        // A row with an empty middle cell ("Total", "", "$9.00") is reported
        // with fewer cells. Line the cells up with the column starts that
        // already exist instead of padding them on the right.
        const projected = projectCells(cells, previous.lefts, tolerance);
        if (projected) {
          rowCells = projected;
          lefts = [...previous.lefts];
        } else {
          // A row whose trailing cells are empty: keep it and pad it to the
          // width of the table instead of breaking the table in two.
          const missing = previous.cells.length - cells.length;
          rowCells = [...cells, ...Array.from({ length: missing }, () => [] as OcrWord[])];
          lefts = [...lefts, ...previous.lefts.slice(cells.length)];
        }
      }

      const compatible =
        !previous ||
        (rowCells.length === previous.cells.length &&
          lefts.every((left, index) => Math.abs(left - previous.lefts[index]) <= tolerance) &&
          centerY(line.bbox) - centerY(previous.line.bbox) < medianHeight * 5);

      if (!compatible) flush();

      run.push({ paragraph: entry.paragraph, line, cells: rowCells, lefts });
    }
  }
  flush();

  return layouts;
}

/**
 * A grid whose cells contain whole phrases is a text layout that happens to
 * line up, not a table: a two-column article read row by row would interleave
 * both columns. Table cells hold short values, so the word count separates
 * the two cases.
 */
function looksLikeColumns(run: TableLine[]): boolean {
  const cells = run.flatMap((row) => row.cells).filter((cell) => cell.length > 0);
  if (cells.length < 4) return false;
  const sentences = cells.filter((cell) => cell.length >= 3).length;
  return sentences / cells.length >= 0.6;
}

/**
 * Renders one column of a text layout. Each visual line becomes a synthetic
 * OCR line, so a column gets the same semantics as a normal paragraph:
 * headings, lists, fields and code all work inside it.
 */
function renderColumns(
  columns: OcrWord[][][],
  medianHeight: number,
  medianCharWidth: number,
  listLevels: Map<OcrLine, number>,
  stats: LayoutStats,
): string[] {
  const sections: string[] = [];

  for (const cells of columns) {
    for (const group of groupCells(cells, medianCharWidth)) {
      const lines = group.map(cellLine);
      const output = renderParagraph(
        lines,
        medianHeight,
        medianCharWidth,
        listLevels,
        stats,
      );
      if (output?.md) sections.push(output.md);
    }
  }

  return sections;
}

/** Builds an OCR line from the words of one table/column cell. */
function cellLine(cell: OcrWord[]): OcrLine {
  const words = cell.filter((word) => clean(word.text));
  const bbox = words.length
    ? {
        x0: Math.min(...words.map((word) => word.bbox.x0)),
        y0: Math.min(...words.map((word) => word.bbox.y0)),
        x1: Math.max(...words.map((word) => word.bbox.x1)),
        y1: Math.max(...words.map((word) => word.bbox.y1)),
      }
    : { x0: 0, y0: 0, x1: 0, y1: 0 };
  return {
    text: clean(words.map((word) => word.text).join(' ')),
    confidence: median(words.map((word) => word.confidence)),
    bbox,
    words,
  };
}


/** Splits the cells of a column into paragraphs by vertical gap and indent. */
function groupCells(cells: OcrWord[][], medianCharWidth: number): OcrWord[][][] {
  const groups: OcrWord[][][] = [];
  const tops = cells.map((cell) => cell[0]?.bbox.y0 ?? 0);
  const pitch = median(
    tops.slice(1).map((top, index) => top - tops[index]).filter((value) => value > 0),
  );
  const indentLimit = Math.max(6, medianCharWidth * 1.5);

  let current: OcrWord[][] = [];
  let previous: OcrWord | undefined;
  let baseX: number | null = null;

  for (const cell of cells) {
    const first = cell[0];
    const last = cell[cell.length - 1];
    if (!first || !last) continue;

    if (previous) {
      const gap = first.bbox.y0 - previous.bbox.y1;
      const indent = baseX === null ? 0 : Math.abs(first.bbox.x0 - baseX);
      if (gap > pitch * 0.55 || indent > indentLimit) {
        groups.push(current);
        current = [];
        baseX = first.bbox.x0;
      }
    } else {
      baseX = first.bbox.x0;
    }

    current.push(cell);
    previous = last;
  }

  if (current.length) groups.push(current);
  return groups;
}

/**
 * Renders a grid as a Markdown table — or, when the grid is really a list of
 * label/value pairs, as plain `Label: Value` lines.
 */
function renderTable(rows: string[][]): string {
  const columns = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => {
    const cells = [...row];
    while (cells.length < columns) cells.push('');
    return cells.map((cell) => cell.replace(/\|/g, '\\|').replace(/\n/g, ' '));
  });

  if (columns === 2 && !hasHeaderRow(normalized)) {
    return normalized
      .map(([label, value]) => `${label}: ${value}`.trim())
      .join('\n');
  }

  const [header, ...body] = normalized;
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((cells) => `| ${cells.join(' | ')} |`),
  ].join('\n');
}

/**
 * Does the first row name the columns, or is it just the first row of data?
 *
 * A real header differs from the data it introduces: "Revenue" above a column
 * of money, "Region" above a column of places. A settings panel or a receipt
 * has no header at all — its first row is a value like any other. With a
 * single row of data the two are indistinguishable, and calling data a header
 * is the worse mistake, so a header needs at least two rows to prove itself.
 */
function hasHeaderRow(rows: string[][]): boolean {
  if (rows.length < 3) return false;
  const [head, ...body] = rows;

  for (let column = 0; column < head.length; column++) {
    const value = head[column].trim().toLowerCase();
    if (!value) continue;
    // A header cell that repeats a value below it is not a header.
    if (body.some((row) => (row[column] ?? '').trim().toLowerCase() === value)) return false;
  }

  return head.some((cell, column) => {
    const headNumeric = hasDigit(cell);
    const data = body.map((row) => row[column] ?? '').filter((value) => value.trim());
    if (!data.length) return false;
    const allNumeric = data.every((value) => hasDigit(value));
    const allText = data.every((value) => !hasDigit(value));
    return (headNumeric && allText) || (!headNumeric && allNumeric);
  });
}

function hasDigit(value: string): boolean {
  return /\d/.test(value);
}

/* ------------------------------------------------------------------- prose */

function renderParagraph(
  lines: OcrLine[],
  medianHeight: number,
  medianCharWidth: number,
  listLevels: Map<OcrLine, number>,
  stats: LayoutStats,
): Output | null {
  if (!lines.length) return null;

  const code = tryCode(lines);
  if (code) {
    stats.codeBlocks++;
    return code;
  }

  // "Highlights" + bullets: a leading heading inside the same paragraph.
  const heading =
    lines.length > 1 ? tryHeading(lines[0], medianHeight, medianCharWidth) : null;
  const body = heading ? lines.slice(1) : lines;

  const list = tryList(body, medianCharWidth, listLevels);
  if (list) {
    stats.listItems += list.md.split('\n').length;
    if (heading) {
      stats.headings++;
      return { md: `${heading}\n${list.md}`, kind: list.kind };
    }
    return list;
  }

  // A two-line paragraph can be one field of a form: a small label above a
  // larger value. A heading has already been ruled out above, so a pair here
  // is safe to read as `Label: Value`.
  if (!heading) {
    const fields = tryFieldPairs(lines, medianHeight, medianCharWidth);
    if (fields) return fields;
  }

  if (lines.length === 1) {
    const single = tryHeading(lines[0], medianHeight, medianCharWidth);
    if (single) {
      stats.headings++;
      return { md: single, kind: 'other' };
    }
  }

  if (heading) {
    stats.headings++;
    return { md: `${heading}\n\n${joinLines(body.map((line) => line.text))}`, kind: 'other' };
  }

  return { md: joinLines(lines.map((line) => line.text)), kind: 'other' };
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u3000-\u303f]/;

function joinSmart(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  const last = left[left.length - 1];
  const first = right[0];

  if (CJK.test(last) && CJK.test(first)) return left + right;
  if (last === '-' && /[a-z]/.test(first)) return left.slice(0, -1) + right;
  return `${left} ${right}`;
}

function joinLines(lines: string[]): string {
  return lines
    .map((line) => clean(line))
    .filter(Boolean)
    .reduce((accumulator, line) => joinSmart(accumulator, line), '');
}
