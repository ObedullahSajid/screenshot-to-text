import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageRect } from '../../../lib/preprocess';
import { MIN_REGION, type RegionBox, type RegionMode } from '../../../lib/regions';
import { IconCrop, IconPlus, IconTrash, IconX } from './Icons';

interface RegionsDialogProps {
  dataUrl: string;
  imageWidth: number;
  imageHeight: number;
  initial: RegionBox[];
  onApply: (regions: RegionBox[]) => void;
  onCancel: () => void;
}

type Handle = 'nw' | 'ne' | 'sw' | 'se';

type Drag =
  | { kind: 'draw'; pointerId: number; start: { x: number; y: number } }
  | {
      kind: 'move' | 'resize';
      pointerId: number;
      index: number;
      start: { x: number; y: number };
      origin: ImageRect;
      handle?: Handle;
    };

const HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se'];

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

function normalizeRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  bounds: { width: number; height: number },
): ImageRect {
  const width = clamp(Math.abs(b.x - a.x), MIN_REGION, bounds.width);
  const height = clamp(Math.abs(b.y - a.y), MIN_REGION, bounds.height);
  return {
    x: clamp(Math.min(a.x, b.x), 0, bounds.width - width),
    y: clamp(Math.min(a.y, b.y), 0, bounds.height - height),
    width,
    height,
  };
}

/**
 * Multi-box region editor: draw boxes that either keep a part of the capture
 * or cut it out. It uses the crop overlay's geometry (image pixels, draggable
 * handles) but the boxes are independent, so a nav bar can be excluded while
 * two article columns are kept.
 */
export default function RegionsDialog({
  dataUrl,
  imageWidth,
  imageHeight,
  initial,
  onApply,
  onCancel,
}: RegionsDialogProps) {
  const [regions, setRegions] = useState<RegionBox[]>(initial);
  const [selected, setSelected] = useState<number | null>(initial.length ? 0 : null);
  const [mode, setMode] = useState<RegionMode>(initial[0]?.mode ?? 'exclude');
  const [draft, setDraft] = useState<RegionBox | null>(null);

  const frameRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const draftRef = useRef<RegionBox | null>(null);

  const setDraftBox = (box: RegionBox | null) => {
    draftRef.current = box;
    setDraft(box);
  };

  const toNatural = useCallback(
    (clientX: number, clientY: number) => {
      const bounds = frameRef.current?.getBoundingClientRect();
      if (!bounds || !bounds.width || !bounds.height) return { x: 0, y: 0 };
      return {
        x: clamp(((clientX - bounds.left) / bounds.width) * imageWidth, 0, imageWidth),
        y: clamp(((clientY - bounds.top) / bounds.height) * imageHeight, 0, imageHeight),
      };
    },
    [imageWidth, imageHeight],
  );

  /* ------------------------------------------------------------- pointer */

  const startDraw = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    frameRef.current?.setPointerCapture(event.pointerId);
    drag.current = {
      kind: 'draw',
      pointerId: event.pointerId,
      start: toNatural(event.clientX, event.clientY),
    };
    setSelected(null);
    setDraftBox(null);
  };

  const startBox = (index: number) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).focus();
    setSelected(index);
    setMode(regions[index].mode);
    frameRef.current?.setPointerCapture(event.pointerId);
    drag.current = {
      kind: 'move',
      pointerId: event.pointerId,
      index,
      start: toNatural(event.clientX, event.clientY),
      origin: regions[index],
    };
  };

  const startHandle = (index: number, handle: Handle) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    frameRef.current?.setPointerCapture(event.pointerId);
    drag.current = {
      kind: 'resize',
      pointerId: event.pointerId,
      index,
      start: toNatural(event.clientX, event.clientY),
      origin: regions[index],
      handle,
    };
  };

  const updateRegion = (index: number, rect: ImageRect) => {
    setRegions((current) =>
      current.map((region, position) =>
        position === index ? { ...rect, mode: region.mode } : region,
      ),
    );
  };

  const move = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const point = toNatural(event.clientX, event.clientY);

    if (current.kind === 'draw') {
      const dx = point.x - current.start.x;
      const dy = point.y - current.start.y;
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      setDraftBox({
        ...normalizeRect(current.start, point, { width: imageWidth, height: imageHeight }),
        mode,
      });
      return;
    }

    if (current.kind === 'move') {
      updateRegion(current.index, {
        x: clamp(
          current.origin.x + (point.x - current.start.x),
          0,
          imageWidth - current.origin.width,
        ),
        y: clamp(
          current.origin.y + (point.y - current.start.y),
          0,
          imageHeight - current.origin.height,
        ),
        width: current.origin.width,
        height: current.origin.height,
      });
      return;
    }

    const handle = current.handle;
    if (!handle) return;
    let left = current.origin.x;
    let top = current.origin.y;
    let right = current.origin.x + current.origin.width;
    let bottom = current.origin.y + current.origin.height;

    if (handle.includes('w')) left = clamp(point.x, 0, right - MIN_REGION);
    if (handle.includes('e')) right = clamp(point.x, left + MIN_REGION, imageWidth);
    if (handle.includes('n')) top = clamp(point.y, 0, bottom - MIN_REGION);
    if (handle.includes('s')) bottom = clamp(point.y, top + MIN_REGION, imageHeight);

    updateRegion(current.index, { x: left, y: top, width: right - left, height: bottom - top });
  };

  const end = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;

    if (current.kind === 'draw') {
      const box = draftRef.current;
      setDraftBox(null);
      if (box) {
        const index = regions.length;
        setRegions((existing) => [...existing, box]);
        setSelected(index);
      }
    }

    const frame = frameRef.current;
    if (frame?.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId);
  };

  /* ------------------------------------------------------------ keyboard */

  const removeSelected = () => {
    if (selected === null) return;
    setRegions((current) => current.filter((_, index) => index !== selected));
    setSelected(null);
    cardRef.current?.focus();
  };

  const chooseMode = (next: RegionMode) => {
    setMode(next);
    if (selected === null) return;
    setRegions((current) =>
      current.map((region, index) => (index === selected ? { ...region, mode: next } : region)),
    );
  };

  const addBox = () => {
    const box: RegionBox = {
      x: Math.round(imageWidth * 0.12),
      y: Math.round(imageHeight * 0.12),
      width: Math.max(MIN_REGION, Math.round(imageWidth * 0.76)),
      height: Math.max(MIN_REGION, Math.round(imageHeight * 0.3)),
      mode,
    };
    const index = regions.length;
    setRegions((current) => [...current, box]);
    setSelected(index);
  };

  const nudge = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onApply(regions);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selected !== null) {
      event.preventDefault();
      removeSelected();
      return;
    }
    if (!event.key.startsWith('Arrow') || selected === null) return;
    event.preventDefault();

    const step = event.altKey ? 1 : 2;
    const resizeStep = event.altKey ? 2 : 8;
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const positive = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const origin = regions[selected];

    if (event.shiftKey) {
      if (horizontal) {
        updateRegion(selected, {
          ...origin,
          width: clamp(origin.width + (positive ? resizeStep : -resizeStep), MIN_REGION, imageWidth - origin.x),
        });
      } else {
        updateRegion(selected, {
          ...origin,
          height: clamp(origin.height + (positive ? resizeStep : -resizeStep), MIN_REGION, imageHeight - origin.y),
        });
      }
      return;
    }

    const delta = positive ? step : -step;
    updateRegion(selected, {
      ...origin,
      x: clamp(origin.x + (horizontal ? delta : 0), 0, imageWidth - origin.width),
      y: clamp(origin.y + (horizontal ? 0 : delta), 0, imageHeight - origin.height),
    });
  };

  /* --------------------------------------------------------------- dialog */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  useEffect(() => {
    if (selected !== null) boxRef.current?.focus();
  }, [selected]);

  // Start on the card so the keyboard hints work even when no box exists yet.
  useEffect(() => {
    if (selected === null) cardRef.current?.focus();
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const boxStyle = (rect: ImageRect) => ({
    left: `${(rect.x / imageWidth) * 100}%`,
    top: `${(rect.y / imageHeight) * 100}%`,
    width: `${(rect.width / imageWidth) * 100}%`,
    height: `${(rect.height / imageHeight) * 100}%`,
  });

  const keeps = regions.filter((region) => region.mode === 'keep').length;
  const excludes = regions.length - keeps;
  const status =
    draft !== null
      ? `${draft.mode === 'keep' ? 'Keep' : 'Exclude'} · ${Math.round(draft.width)} × ${Math.round(draft.height)} px`
      : selected !== null
        ? `${regions[selected].mode === 'keep' ? 'Keep' : 'Exclude'} · ${Math.round(regions[selected].width)} × ${Math.round(regions[selected].height)} px`
        : regions.length === 0
          ? 'Whole image'
          : `${keeps} keep · ${excludes} exclude`;

  return (
    <div className="region-overlay" role="dialog" aria-modal="true" aria-label="Select regions">
      <div className="region-card" ref={cardRef} tabIndex={-1}>
        <div className="region-head">
          <h2>
            <IconCrop size={15} /> Select regions
          </h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onCancel}>
            <IconX size={15} />
          </button>
        </div>

        <div className="region-stage">
          <div
            ref={frameRef}
            className="region-frame"
            onPointerDown={startDraw}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <img src={dataUrl} alt="" draggable={false} />

            {regions.map((region, index) => (
              <div
                key={index}
                ref={selected === index ? boxRef : undefined}
                className={`region-box region-box--${region.mode}${
                  selected === index ? ' is-selected' : ''
                }`}
                style={boxStyle(region)}
                role="group"
                tabIndex={0}
                aria-label={`${region.mode === 'keep' ? 'Keep' : 'Exclude'} region ${
                  index + 1
                }: ${Math.round(region.width)} by ${Math.round(region.height)} pixels`}
                onFocus={() => {
                  setSelected(index);
                  setMode(region.mode);
                }}
                onPointerDown={startBox(index)}
                onKeyDown={nudge}
              >
                <span className="region-tag">{region.mode === 'keep' ? 'Keep' : 'Exclude'}</span>
                {selected === index &&
                  HANDLES.map((handle) => (
                    <span
                      key={handle}
                      className={`region-handle region-handle--${handle}`}
                      onPointerDown={startHandle(index, handle)}
                    />
                  ))}
              </div>
            ))}

            {draft && (
              <div
                className={`region-box region-box--${draft.mode} is-draft`}
                style={boxStyle(draft)}
                aria-hidden="true"
              >
                <span className="region-tag">{draft.mode === 'keep' ? 'Keep' : 'Exclude'}</span>
              </div>
            )}
          </div>
        </div>

        <div className="region-foot">
          <div className="region-toolbar">
            <div className="region-modes" role="group" aria-label="Box type">
              <button
                type="button"
                data-mode="keep"
                className={`region-mode${mode === 'keep' ? ' is-active' : ''}`}
                aria-pressed={mode === 'keep'}
                onClick={() => chooseMode('keep')}
              >
                Keep
              </button>
              <button
                type="button"
                data-mode="exclude"
                className={`region-mode${mode === 'exclude' ? ' is-active' : ''}`}
                aria-pressed={mode === 'exclude'}
                onClick={() => chooseMode('exclude')}
              >
                Exclude
              </button>
            </div>

            <div className="region-tools">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={addBox}
                aria-label="Add a region box"
              >
                <IconPlus size={13} />
                Add box
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={removeSelected}
                disabled={selected === null}
                aria-label="Remove selected region"
              >
                <IconTrash size={13} />
                Remove
              </button>
            </div>
          </div>

          <div className="region-actions">
            <span className="region-dims">{status}</span>
            <div className="region-buttons">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                data-action="reset"
                onClick={() => {
                  setRegions([]);
                  setSelected(null);
                  setDraftBox(null);
                }}
              >
                Whole image
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onApply(regions)}>
                Use regions
              </button>
            </div>
          </div>
        </div>

        <p className="region-hint">
          Drag on the image to add a box. Select a box to move it, drag a corner to resize, or press{' '}
          <kbd>Delete</kbd> to remove it. <kbd>Enter</kbd> applies, <kbd>Esc</kbd> cancels.
        </p>
      </div>
    </div>
  );
}
