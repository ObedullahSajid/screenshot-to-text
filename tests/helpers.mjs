/** Small builders for synthetic Tesseract pages, shared by the unit tests. */

export function makeLine(text, x, y, { charWidth = 9, height = 20, gap = 8 } = {}) {
  let cursor = x;
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const width = word.length * charWidth;
      const value = {
        text: word,
        confidence: 92,
        bbox: { x0: cursor, y0: y, x1: cursor + width, y1: y + height },
      };
      cursor += width + gap;
      return value;
    });

  return {
    text,
    confidence: 92,
    bbox: {
      x0: x,
      y0: y,
      x1: words.length ? words[words.length - 1].bbox.x1 : x,
      y1: y + height,
    },
    words,
  };
}

/** A line whose words are grouped into cells at fixed x positions. */
export function makeCellsLine(cells, positions, y, { height = 20 } = {}) {
  const words = [];
  cells.forEach((cell, index) => {
    let cursor = positions[index];
    for (const word of cell.split(/\s+/).filter(Boolean)) {
      const width = word.length * 9;
      words.push({
        text: word,
        confidence: 92,
        bbox: { x0: cursor, y0: y, x1: cursor + width, y1: y + height },
      });
      cursor += width + 8;
    }
  });

  return {
    text: cells.join(' '),
    confidence: 92,
    bbox: {
      x0: words[0].bbox.x0,
      y0: y,
      x1: words[words.length - 1].bbox.x1,
      y1: y + height,
    },
    words,
  };
}

function union(boxes) {
  return boxes.reduce((box, item) => ({
    x0: Math.min(box.x0, item.x0),
    y0: Math.min(box.y0, item.y0),
    x1: Math.max(box.x1, item.x1),
    y1: Math.max(box.y1, item.y1),
  }));
}

export function makeParagraph(lines) {
  return {
    text: `${lines.map((line) => line.text).join('\n')}\n\n`,
    confidence: 92,
    bbox: union(lines.map((line) => line.bbox)),
    lines,
  };
}

export function makePage(paragraphs) {
  const blocks = paragraphs.map((paragraph) => ({
    text: paragraph.text,
    confidence: paragraph.confidence,
    bbox: paragraph.bbox,
    blocktype: 'text',
    paragraphs: [paragraph],
  }));

  return {
    text: paragraphs.map((paragraph) => paragraph.text).join(''),
    confidence: 92,
    blocks,
    paragraphs,
    lines: paragraphs.flatMap((paragraph) => paragraph.lines),
  };
}
