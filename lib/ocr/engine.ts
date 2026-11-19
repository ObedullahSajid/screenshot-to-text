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

/**
 * One Tesseract worker plus the state that belongs to it. The panel usually
 * runs a single worker; a long captured page can use a second one, and each
 * needs its own layout mode and progress sink.
 */
interface Slot {
  worker: Promise<TesseractWorker> | null;
  psm: PsmMode | null;
  progress: OcrProgress | null;
}

const slots: Slot[] = [];

function slotAt(index: number): Slot {
  while (slots.length <= index) {
    slots.push({ worker: null, psm: null, progress: null });
  }
  return slots[index];
}

function report(slot: Slot, stage: string, progress: number) {
  slot.progress?.(stage, Math.max(0, Math.min(1, progress)));
}

/**
 * Tesseract is loaded entirely from files bundled inside the extension:
 * no CDN, no network request, no remote code (MV3 requirement).
 */
async function createEngine(index: number): Promise<TesseractWorker> {
  const slot = slotAt(index);
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
        report(slot, label, 0.15 + (message.progress ?? 0) * 0.85);
      } else {
        report(slot, label, Math.min(0.15, (message.progress ?? 0) * 0.15));
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
  slot.psm = PSM_MODES.auto;

  return worker;
}

/** Starts (or reuses) the worker in the given slot. One recognition at a time per slot. */
export function getEngine(index = 0): Promise<TesseractWorker> {
  const slot = slotAt(index);
  if (!slot.worker) {
    slot.worker = createEngine(index).catch((error) => {
      slot.worker = null;
      throw error;
    });
  }
  return slot.worker;
}

/** One full recognition pass at a given layout mode. Progress is 0-1. */
export async function recognizeOnce(
  canvas: HTMLCanvasElement,
  psm: PsmMode,
  onProgress: OcrProgress,
  index = 0,
): Promise<OcrPage> {
  const slot = slotAt(index);
  slot.progress = onProgress;
  try {
    const worker = await getEngine(index);
    if (slot.psm !== psm) {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      slot.psm = psm;
    }
    const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
    return data as unknown as OcrPage;
  } finally {
    slot.progress = null;
  }
}

/**
 * Starts loading the worker in the background. The first capture otherwise pays
 * for the ~7 MB wasm core and language model on the critical path.
 */
export function prewarmEngine(): void {
  void getEngine().catch(() => {
    // A failure here is not fatal: the next capture reports it properly, with
    // the panel's own error UI around it.
  });
}

/** Frees the ~100 MB each worker holds. Call when the panel is closed. */
export async function disposeEngine(): Promise<void> {
  const open = slots.map(async (slot) => {
    if (!slot.worker) return;
    try {
      const worker = await slot.worker;
      await worker.terminate();
    } catch {
      // Already gone.
    }
  });
  await Promise.all(open);
  slots.length = 0;
}
