import { createWorker, OEM, PSM } from 'tesseract.js';
import type { OcrPage } from './types';

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

export type OcrProgress = (stage: string, progress: number) => void;

/**
 * Layout modes we can switch between without reinitialising the worker.
 * `AUTO` is right for documents; `SINGLE_BLOCK` rescues screenshots where
 * Tesseract's layout analysis splits a panel into nonsense; `SPARSE_TEXT`
 * finds text floating in a diagram or a mostly empty UI.
 */
export const PSM_MODES = {
  auto: PSM.AUTO,
  block: PSM.SINGLE_BLOCK,
  sparse: PSM.SPARSE_TEXT,
} as const;

export type PsmMode = PSM;

const STAGE_LABELS: Record<string, string> = {
  'loading tesseract core': 'Loading OCR engine',
  'initializing tesseract': 'Starting OCR engine',
  'loading language traineddata': 'Loading language model',
  'initializing api': 'Preparing OCR engine',
  'recognizing text': 'Reading text',
};

let enginePromise: Promise<TesseractWorker> | null = null;
let progressSink: OcrProgress | null = null;
let activePsm: PsmMode | null = null;

function report(stage: string, progress: number) {
  progressSink?.(stage, Math.max(0, Math.min(1, progress)));
}

/**
 * Tesseract is loaded entirely from files bundled inside the extension:
 * no CDN, no network request, no remote code (MV3 requirement).
 */
async function createEngine(): Promise<TesseractWorker> {
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('tesseract/tesseract-core-simd-lstm.wasm.js'),
    langPath: chrome.runtime.getURL('tessdata'),
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'none',
    logger: (message) => {
      const label = STAGE_LABELS[message.status];
      if (!label) return;
      if (message.status === 'recognizing text') {
        report(label, 0.15 + (message.progress ?? 0) * 0.85);
      } else {
        report(label, Math.min(0.15, (message.progress ?? 0) * 0.15));
      }
    },
  });

  await worker.setParameters({
    tessedit_pageseg_mode: PSM_MODES.auto,
    // Screenshots rarely carry DPI metadata; a fixed value stops Tesseract
    // from wildly mis-estimating the resolution (e.g. 282 for 96 DPI text).
    user_defined_dpi: '150',
    // Keeps the raw text closer to the visual spacing, which helps the
    // "raw text" tab and indentation hints in code blocks.
    preserve_interword_spaces: '1',
  });
  activePsm = PSM_MODES.auto;

  return worker;
}

export function getEngine(): Promise<TesseractWorker> {
  if (!enginePromise) {
    enginePromise = createEngine().catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

/** One full recognition pass at a given layout mode. Progress is 0-1. */
export async function recognizeOnce(
  canvas: HTMLCanvasElement,
  psm: PsmMode,
  onProgress: OcrProgress,
): Promise<OcrPage> {
  progressSink = onProgress;
  try {
    const worker = await getEngine();
    if (activePsm !== psm) {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      activePsm = psm;
    }
    const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
    return data as unknown as OcrPage;
  } finally {
    progressSink = null;
  }
}

/** Frees the ~100 MB the worker holds. Call when the panel is closed. */
export async function disposeEngine(): Promise<void> {
  if (!enginePromise) return;
  try {
    const worker = await enginePromise;
    await worker.terminate();
  } catch {
    // Already gone.
  } finally {
    enginePromise = null;
    activePsm = null;
  }
}
