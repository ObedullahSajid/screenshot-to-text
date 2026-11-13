export const MSG = {
  captureVisible: 'stt:capture-visible',
  captureRegion: 'stt:capture-region',
  captureFull: 'stt:capture-full',
  cancelFull: 'stt:cancel-full',
  fullPageProgress: 'stt:fullpage-progress',
  pendingCapture: 'stt:pending-capture',
} as const;

export const PENDING_KEY = 'stt_pending_capture';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

export interface Selection {
  rect: Rect;
  viewport: Viewport;
}

/**
 * Why a capture could not start. Chrome only grants page access on invocation
 * (toolbar icon, keyboard command or context menu), so a panel opened any other
 * way has no access even though the page itself is fine.
 */
export type CaptureErrorCode = 'no-access' | 'restricted' | 'no-tab';

export type CaptureResponse =
  | {
      ok: true;
      dataUrl: string;
      /** Present for region captures. */
      selection?: Selection;
      source: 'visible' | 'region' | 'image';
    }
  | {
      ok: false;
      /** 'cancelled' means the user backed out, not an error worth shouting about. */
      error: string;
      cancelled?: boolean;
      code?: CaptureErrorCode;
      hint?: string;
    };

/** Left in storage.session when a capture is started from a command or context menu. */
export type PendingCapture =
  | { kind: 'region'; createdAt: number }
  | {
      kind: 'image';
      dataUrl: string;
      selection: Selection;
      createdAt: number;
    };

/** One viewport-sized screenshot taken while scrolling down a page. */
export interface CapturedTile {
  dataUrl: string;
  /** Actual scroll offset of this tile, in CSS pixels. */
  offset: number;
}

/** A scroll capture: overlapping tiles plus what is needed to stitch them. */
export type FullCaptureResponse =
  | {
      ok: true;
      tiles: CapturedTile[];
      dpr: number;
      scrollHeight: number;
      viewportWidth: number;
      viewportHeight: number;
      /** True when the page was taller than the tile limit allows. */
      truncated: boolean;
      /** Fixed/sticky elements hidden from the second tile on. */
      hidden: number;
    }
  | {
      ok: false;
      error: string;
      cancelled?: boolean;
      code?: CaptureErrorCode;
      hint?: string;
    };

/** Progress updates sent while the background worker scrolls and captures. */
export interface FullPageProgress {
  type: typeof MSG.fullPageProgress;
  stage: string;
  progress: number;
  tile?: number;
  tiles?: number;
}
