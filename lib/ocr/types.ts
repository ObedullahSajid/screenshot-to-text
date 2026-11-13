export interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: Bbox;
}

export interface OcrLine {
  text: string;
  confidence: number;
  bbox: Bbox;
  words?: OcrWord[];
}

export interface OcrParagraph {
  text: string;
  confidence: number;
  bbox: Bbox;
  lines: OcrLine[];
}

export interface OcrBlock {
  text: string;
  confidence: number;
  bbox: Bbox;
  blocktype?: string;
  paragraphs?: OcrParagraph[];
}

export interface OcrPage {
  text: string;
  confidence: number;
  blocks?: OcrBlock[] | null;
  paragraphs?: OcrParagraph[] | null;
  lines?: OcrLine[] | null;
}
