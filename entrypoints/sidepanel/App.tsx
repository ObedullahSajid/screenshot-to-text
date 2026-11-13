import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { imageSize, selectionToImageRect, toDataUrl } from '../../lib/preprocess';
import {
  NEUTRAL_QUALITY,
  runPipeline,
  runTiledPipeline,
  type PipelineOutput,
  type TiledCapture,
} from '../../lib/pipeline';
import { composeRegions, type RegionBox } from '../../lib/regions';
import { disposeEngine } from '../../lib/ocr/engine';
import { countTextTokens } from '../../lib/tokens';
import { formatOutput, isOutputPreset, type OutputPreset } from '../../lib/format';
import { combineStats, mergeOutputs } from '../../lib/merge';
import {
  MSG,
  PENDING_KEY,
  type CaptureErrorCode,
  type CaptureResponse,
  type FullCaptureResponse,
  type FullPageProgress,
  type PendingCapture,
  type Selection,
} from '../../lib/messages';
import {
  addHistory,
  clearHistory,
  DEFAULT_SETTINGS,
  getHistory,
  getSettings,
  makeTitle,
  removeHistory,
  saveSettings,
  type HistoryItem,
  type Settings,
} from '../../lib/storage';
import {
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconCopy,
  IconCrop,
  IconDownload,
  IconImage,
  IconMonitor,
  IconPage,
  IconPlus,
  IconScan,
  IconSettings,
  IconShield,
  IconTrash,
  IconX,
} from './components/Icons';
import RegionsDialog from './components/RegionsDialog';

interface Job {
  stage: string;
  progress: number;
}

interface Failure {
  message: string;
  hint?: string;
  code?: CaptureErrorCode;
}

/** The untouched capture plus the keep/exclude boxes last applied to it. */
interface Source {
  dataUrl: string;
  width: number;
  height: number;
  regions: RegionBox[];
}

type Overlay = 'none' | 'history' | 'settings';
type View = OutputPreset | 'raw';

/** The result we left behind while the user adds another capture to it. */
interface AppendBase {
  markdown: string;
  tokens: number;
  result: PipelineOutput;
  source: Source | null;
  captures: number;
  view: View;
  tiles: number | null;
}

const VIEWS: Array<{ id: View; label: string; title: string }> = [
  { id: 'markdown', label: 'Markdown', title: 'Markdown' },
  { id: 'text', label: 'Text', title: 'Plain text' },
  { id: 'outline', label: 'Outline', title: 'Headings and list items only' },
  { id: 'raw', label: 'Raw', title: 'Raw OCR text' },
];

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [ready, setReady] = useState(false);

  const [result, setResult] = useState<PipelineOutput | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [tokens, setTokens] = useState(0);
  const [view, setView] = useState<View>('markdown');
  const [captures, setCaptures] = useState(1);
  const [fullTiles, setFullTiles] = useState<number | null>(null);
  const [appendMode, setAppendMode] = useState(false);
  const [mergeNote, setMergeNote] = useState<string | null>(null);
  const [fullNote, setFullNote] = useState<string | null>(null);

  const [source, setSource] = useState<Source | null>(null);
  const [regionsOpen, setRegionsOpen] = useState(false);

  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);

  const runId = useRef(0);
  const pendingBusy = useRef(false);
  const fullBusy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const appendBase = useRef<AppendBase | null>(null);

  /* ------------------------------------------------------------- pipeline */

  /** Puts the result that was set aside for an append back on screen. */
  const leaveAppend = useCallback(() => {
    const base = appendBase.current;
    appendBase.current = null;
    setAppendMode(false);
    if (!base) return;
    setResult(base.result);
    setMarkdown(base.markdown);
    setTokens(base.tokens);
    setCaptures(base.captures);
    setSource(base.source);
    setView(base.view);
    setFullTiles(base.tiles);
  }, []);

  const run = useCallback(
    async (dataUrl: string, regions: RegionBox[]) => {
      const id = ++runId.current;
      const base = appendBase.current;
      setError(null);
      if (!base) {
        setResult(null);
        setMarkdown('');
        setTokens(0);
        setFullTiles(null);
      }
      setFullNote(null);
      setView(settings.preset);
      setOverlay('none');
      setRegionsOpen(false);
      setJob({ stage: 'Preparing image', progress: 0.02 });

      try {
        const composed = await composeRegions(dataUrl, regions);
        const output = await runPipeline(
          composed.blob,
          { compact: settings.compact, maxWidth: settings.maxWidth },
          (stage, progress) => {
            if (runId.current === id) setJob({ stage, progress });
          },
        );
        if (runId.current !== id) return;

        if (!output.markdown.trim()) {
          setJob(null);
          leaveAppend();
          setError({
            message: base
              ? 'No readable text found in that capture.'
              : 'No readable text found here.',
            hint: 'Try a tighter crop around the text, or capture at a larger size.',
          });
          return;
        }

        let final: PipelineOutput = output;
        if (base) {
          const merged = mergeOutputs(base.markdown, output.markdown);
          final = {
            ...output,
            markdown: merged.markdown,
            rawText: [base.result.rawText, output.rawText].filter(Boolean).join('\n\n'),
            tokens: await countTextTokens(merged.markdown),
            // The "smaller than image" meter compares against every image the
            // text came from, not just the newest one.
            imageTokens: base.result.imageTokens + output.imageTokens,
            stats: combineStats(base.result.stats, output.stats),
            passes: Math.max(base.result.passes, output.passes),
          };
          appendBase.current = null;
          setAppendMode(false);
          // A region edit would only re-read the last image, so it is no
          // longer meaningful for the merged result.
          setSource(null);
          setCaptures(base.captures + 1);
          setMergeNote(describeMerge(merged.stats));
        } else {
          setCaptures(1);
          setMergeNote(null);
        }

        setResult(final);
        setMarkdown(final.markdown);
        setTokens(final.tokens);
        setJob(null);

        const item: HistoryItem = {
          id: newId(),
          createdAt: Date.now(),
          title: makeTitle(final.markdown),
          markdown: final.markdown,
          rawText: final.rawText,
          thumb: final.thumb,
          tokens: final.tokens,
          imageTokens: final.imageTokens,
          stats: final.stats,
          width: final.width,
          height: final.height,
          quality: final.quality,
          passes: final.passes,
        };
        setHistory(await addHistory(item));
      } catch (cause) {
        if (runId.current !== id) return;
        setJob(null);
        leaveAppend();
        setError({
          message: cause instanceof Error ? cause.message : 'Could not process that image.',
          hint: 'If this keeps happening, reload the extension and try again.',
        });
      }
    },
    [settings, leaveAppend],
  );

  /** Same as `run`, but the source is a set of overlapping viewport tiles. */
  const runTiles = useCallback(
    async (capture: TiledCapture, note: string | null) => {
      const id = ++runId.current;
      const base = appendBase.current;
      setError(null);
      if (!base) {
        setResult(null);
        setMarkdown('');
        setTokens(0);
      }
      setView(settings.preset);
      setOverlay('none');
      setRegionsOpen(false);
      setFullNote(note);
      setMergeNote(null);
      setJob({ stage: 'Reading tile 1', progress: 0.04 });

      try {
        const output = await runTiledPipeline(
          capture,
          { compact: settings.compact, maxWidth: settings.maxWidth },
          (stage, progress) => {
            if (runId.current === id) setJob({ stage, progress });
          },
          () => runId.current !== id,
        );
        if (runId.current !== id) return;

        if (!output.markdown.trim()) {
          setJob(null);
          leaveAppend();
          setError({
            message: base
              ? 'No readable text found in that capture.'
              : 'No readable text found on that page.',
            hint: 'Try scrolling to the text first, or capture a region instead.',
          });
          return;
        }

        let final: PipelineOutput = output;
        if (base) {
          const merged = mergeOutputs(base.markdown, output.markdown);
          final = {
            ...output,
            markdown: merged.markdown,
            rawText: [base.result.rawText, output.rawText].filter(Boolean).join('\n\n'),
            tokens: await countTextTokens(merged.markdown),
            imageTokens: base.result.imageTokens + output.imageTokens,
            stats: combineStats(base.result.stats, output.stats),
            passes: Math.max(base.result.passes, output.passes),
          };
          appendBase.current = null;
          setAppendMode(false);
          setSource(null);
          setCaptures(base.captures + 1);
          setFullTiles(null);
          setMergeNote(describeMerge(merged.stats));
        } else {
          setCaptures(1);
          setSource(null);
          setFullTiles(capture.tiles.length);
        }

        setResult(final);
        setMarkdown(final.markdown);
        setTokens(final.tokens);
        setJob(null);

        const item: HistoryItem = {
          id: newId(),
          createdAt: Date.now(),
          title: makeTitle(final.markdown),
          markdown: final.markdown,
          rawText: final.rawText,
          thumb: final.thumb,
          tokens: final.tokens,
          imageTokens: final.imageTokens,
          stats: final.stats,
          width: final.width,
          height: final.height,
          quality: final.quality,
          passes: final.passes,
          tiles: base ? undefined : capture.tiles.length,
        };
        setHistory(await addHistory(item));
      } catch (cause) {
        if (runId.current !== id) return;
        setJob(null);
        leaveAppend();
        setError({
          message: cause instanceof Error ? cause.message : 'Could not process that page.',
          hint: 'If this keeps happening, reload the extension and try again.',
        });
      }
    },
    [settings, leaveAppend],
  );

  /** Scrolls the active page, captures every viewport, then reads the tiles. */
  const captureFull = useCallback(async () => {
    if (fullBusy.current) return;
    fullBusy.current = true;
    setError(null);
    setMergeNote(null);
    setJob({ stage: 'Preparing full page', progress: 0.01 });

    try {
      const response = (await chrome.runtime.sendMessage({
        type: MSG.captureFull,
      })) as FullCaptureResponse | undefined;

      if (!response) throw new Error('The background worker did not respond.');
      if (!response.ok) {
        fullBusy.current = false;
        setJob(null);
        if (!response.cancelled) {
          setError({ message: response.error, hint: response.hint, code: response.code });
        }
        return;
      }
      // The user may have cancelled while the page was scrolling.
      if (!fullBusy.current) return;

      const notes: string[] = [];
      if (response.truncated) {
        notes.push(`Stopped after ${response.tiles.length} tiles — the page is taller`);
      }
      if (response.hidden > 0) {
        notes.push(
          `Hid ${response.hidden} sticky element${response.hidden > 1 ? 's' : ''} after the first tile`,
        );
      }

      await runTiles(
        {
          tiles: response.tiles,
          dpr: response.dpr,
          scrollHeight: response.scrollHeight,
          viewportWidth: response.viewportWidth,
        },
        notes.length ? notes.join(' · ') : null,
      );
    } catch (cause) {
      setJob(null);
      setError({
        message: cause instanceof Error ? cause.message : 'Full-page capture failed.',
        hint: 'You can still capture the visible tab or paste screenshots.',
      });
    } finally {
      fullBusy.current = false;
    }
  }, [runTiles]);

  /** Adopts a fresh capture (whole image or a region) and runs it. */
  const accept = useCallback(
    async (dataUrl: string, selection?: Selection) => {
      const { width, height } = await imageSize(dataUrl);
      const regions: RegionBox[] = selection
        ? [{ ...selectionToImageRect(selection, width, height), mode: 'keep' }]
        : [];
      setSource({ dataUrl, width, height, regions });
      await run(dataUrl, regions);
    },
    [run],
  );

  const capture = useCallback(
    async (kind: 'visible' | 'region') => {
      setError(null);
      try {
        const response = (await chrome.runtime.sendMessage({
          type: kind === 'region' ? MSG.captureRegion : MSG.captureVisible,
        })) as CaptureResponse | undefined;

        if (!response) throw new Error('The background worker did not respond.');
        if (!response.ok) {
          if (!response.cancelled) {
            setError({ message: response.error, hint: response.hint, code: response.code });
          }
          return;
        }
        await accept(response.dataUrl, response.selection);
      } catch (cause) {
        setError({
          message: cause instanceof Error ? cause.message : 'Capture failed.',
          hint: 'You can always paste (Ctrl+V) or upload a screenshot instead.',
        });
      }
    },
    [accept],
  );

  const handlePending = useCallback(async () => {
    if (pendingBusy.current) return;
    pendingBusy.current = true;
    try {
      const stored = await chrome.storage.session.get(PENDING_KEY);
      const pending = stored[PENDING_KEY] as PendingCapture | undefined;
      if (!pending) return;
      await chrome.storage.session.remove(PENDING_KEY);

      if (pending.kind === 'region') {
        await capture('region');
      } else {
        await accept(pending.dataUrl, pending.selection);
      }
    } catch {
      // The pending payload was malformed or already consumed.
    } finally {
      pendingBusy.current = false;
    }
  }, [capture, accept]);

  const acceptFile = useCallback(
    async (file: Blob) => {
      try {
        await accept(await toDataUrl(file));
      } catch (cause) {
        setError({
          message: cause instanceof Error ? cause.message : 'Could not read that image.',
        });
      }
    },
    [accept],
  );

  /* --------------------------------------------------------------- effects */

  useEffect(() => {
    void (async () => {
      const [storedSettings, storedHistory] = await Promise.all([getSettings(), getHistory()]);
      setSettings(storedSettings);
      setHistory(storedHistory);
      setReady(true);
    })();
  }, []);

  // Release the OCR worker's memory when the panel is closed.
  useEffect(() => () => void disposeEngine(), []);

  useEffect(() => {
    if (!ready) return;
    void handlePending();
  }, [ready, handlePending]);

  useEffect(() => {
    const listener = (message: unknown) => {
      if ((message as { type?: string } | null)?.type === MSG.pendingCapture) {
        void handlePending();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [handlePending]);

  // Progress from the background worker while it scrolls and captures tiles.
  useEffect(() => {
    const listener = (message: unknown) => {
      const progress = message as FullPageProgress | null;
      if (progress?.type !== MSG.fullPageProgress || !fullBusy.current) return;
      setJob({ stage: progress.stage, progress: progress.progress });
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!ready) return;
    void saveSettings(settings);
  }, [settings, ready]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (regionsOpen) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
      ) {
        return;
      }
      const items = Array.from(event.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      event.preventDefault();
      void acceptFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [acceptFile, regionsOpen]);

  // What the active view shows, and therefore what Copy and Download use.
  const outputText = useMemo(() => {
    if (!result) return '';
    if (view === 'raw') return result.rawText;
    return formatOutput(markdown, view);
  }, [result, view, markdown]);

  // Live token count for the text the user is actually looking at.
  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void countTextTokens(outputText).then((count) => {
        if (!cancelled) setTokens(count);
      });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [outputText, result]);

  /* --------------------------------------------------------------- actions */

  const cancel = () => {
    if (fullBusy.current) {
      fullBusy.current = false;
      void chrome.runtime.sendMessage({ type: MSG.cancelFull }).catch(() => {});
    }
    runId.current++;
    setJob(null);
    leaveAppend();
  };

  const startOver = () => {
    runId.current++;
    fullBusy.current = false;
    appendBase.current = null;
    setAppendMode(false);
    setJob(null);
    setResult(null);
    setMarkdown('');
    setTokens(0);
    setCaptures(1);
    setFullTiles(null);
    setFullNote(null);
    setMergeNote(null);
    setError(null);
    setView(settings.preset);
    setSource(null);
    setRegionsOpen(false);
  };

  /** Sets the current result aside and shows the capture surface again. */
  const beginAppend = () => {
    if (!result) return;
    appendBase.current = {
      markdown,
      tokens,
      result: { ...result, markdown },
      source,
      captures,
      view,
      tiles: fullTiles,
    };
    setAppendMode(true);
    setResult(null);
    setMarkdown('');
    setTokens(0);
    setError(null);
    setMergeNote(null);
    setJob(null);
    setRegionsOpen(false);
  };

  const applyRegions = (next: RegionBox[]) => {
    if (!source) return;
    setSource({ ...source, regions: next });
    void run(source.dataUrl, next);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(outputText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError({ message: 'The clipboard is blocked.', hint: 'Select the text and copy it manually.' });
    }
  };

  const download = () => {
    const extension = view === 'text' || view === 'raw' ? 'txt' : 'md';
    const type = extension === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
    const blob = new Blob([outputText], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${fileSlug(makeTitle(markdown))}.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const openHistoryItem = (item: HistoryItem) => {
    runId.current++;
    setResult({
      markdown: item.markdown,
      rawText: item.rawText,
      thumb: item.thumb,
      tokens: item.tokens,
      imageTokens: item.imageTokens,
      stats: item.stats,
      width: item.width,
      height: item.height,
      inverted: false,
      quality: item.quality ?? NEUTRAL_QUALITY,
      passes: item.passes ?? 1,
    });
    setMarkdown(item.markdown);
    setTokens(item.tokens);
    setView(settings.preset);
    setCaptures(1);
    setFullTiles(item.tiles ?? null);
    setFullNote(null);
    setMergeNote(null);
    setAppendMode(false);
    appendBase.current = null;
    setError(null);
    setOverlay('none');
    // History entries keep the text, not the original pixels.
    setSource(null);
  };

  const drop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = Array.from(event.dataTransfer.files).find((item) =>
      item.type.startsWith('image/'),
    );
    if (file) void acceptFile(file);
  };

  /* ------------------------------------------------------------------ view */

  const savedPercent =
    result && result.imageTokens > 0
      ? Math.max(0, Math.round((1 - tokens / result.imageTokens) * 100))
      : 0;

  // A region capture is one implicit keep box, so only mention boxes when the
  // user actually edited them (or cut something out).
  const appliedRegions =
    source && (source.regions.length > 1 || source.regions.some((region) => region.mode === 'exclude'))
      ? `${source.regions.filter((region) => region.mode === 'keep').length} keep · ${
          source.regions.filter((region) => region.mode === 'exclude').length
        } exclude`
      : null;

  const notes: string[] = [];
  if (fullNote) notes.push(fullNote);
  if (mergeNote) notes.push(mergeNote);
  if (result?.quality.blurry) notes.push('Soft capture — a tighter crop reads better');
  if (result?.quality.contrastBoosted) notes.push('Low contrast boosted');
  if (result && result.passes > 1) notes.push('Re-read at higher detail');

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <IconScan size={17} />
          </span>
          <div className="brand-text">
            <h1>Screenshot to Text</h1>
            <p>Markdown that keeps the layout</p>
          </div>
        </div>
        <div className="top-actions">
          <button
            type="button"
            className={`icon-btn${overlay === 'history' ? ' is-active' : ''}`}
            aria-label="Captured history"
            aria-pressed={overlay === 'history'}
            onClick={() => setOverlay(overlay === 'history' ? 'none' : 'history')}
          >
            <IconClock />
          </button>
          <button
            type="button"
            className={`icon-btn${overlay === 'settings' ? ' is-active' : ''}`}
            aria-label="Settings"
            aria-pressed={overlay === 'settings'}
            onClick={() => setOverlay(overlay === 'settings' ? 'none' : 'settings')}
          >
            <IconSettings />
          </button>
        </div>
      </header>

      <main className="content">
        {overlay === 'history' ? (
          <section aria-label="History">
            <div className="page-head">
              <button type="button" className="icon-btn" aria-label="Back" onClick={() => setOverlay('none')}>
                <IconArrowLeft />
              </button>
              <h2>History</h2>
              {history.length > 0 && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={async () => {
                    await clearHistory();
                    setHistory([]);
                  }}
                >
                  Clear all
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <p className="empty-note">Nothing captured yet. Your last 20 extractions appear here.</p>
            ) : (
              <ul className="history-list">
                {history.map((item) => (
                  <li key={item.id} className="history-item">
                    <button type="button" className="history-open" onClick={() => openHistoryItem(item)}>
                      {item.thumb ? (
                        <img className="history-thumb" src={item.thumb} alt="" />
                      ) : (
                        <span className="history-thumb history-thumb--empty" aria-hidden="true">
                          <IconImage size={16} />
                        </span>
                      )}
                      <span className="history-meta">
                        <span className="history-title">{item.title}</span>
                        <span className="history-sub">
                          {timeAgo(item.createdAt)} · {item.tokens} tokens
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn--subtle"
                      aria-label="Delete capture"
                      onClick={async () => setHistory(await removeHistory(item.id))}
                    >
                      <IconTrash size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : overlay === 'settings' ? (
          <section aria-label="Settings">
            <div className="page-head">
              <button type="button" className="icon-btn" aria-label="Back" onClick={() => setOverlay('none')}>
                <IconArrowLeft />
              </button>
              <h2>Settings</h2>
            </div>

            <div className="card">
              <div className="row">
                <div>
                  <p className="row-title">Default format</p>
                  <p className="row-sub">What new captures open in.</p>
                </div>
                <select
                  className="select"
                  value={settings.preset}
                  aria-label="Default format"
                  onChange={(event) => {
                    const preset = event.target.value;
                    if (!isOutputPreset(preset)) return;
                    setSettings({ ...settings, preset });
                    if (result && view !== 'raw') setView(preset);
                  }}
                >
                  <option value="markdown">Markdown</option>
                  <option value="text">Plain text</option>
                  <option value="outline">Outline</option>
                </select>
              </div>

              <div className="row">
                <div>
                  <p className="row-title">Compact output</p>
                  <p className="row-sub">Drop page numbers, repeats and extra blank lines.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.compact}
                  aria-label="Compact output"
                  className={`switch${settings.compact ? ' is-on' : ''}`}
                  onClick={() => setSettings({ ...settings, compact: !settings.compact })}
                >
                  <span />
                </button>
              </div>

              <div className="row">
                <div>
                  <p className="row-title">Max image width</p>
                  <p className="row-sub">Larger keeps detail, slower to read.</p>
                </div>
                <select
                  className="select"
                  value={settings.maxWidth}
                  aria-label="Max image width"
                  onChange={(event) =>
                    setSettings({ ...settings, maxWidth: Number(event.target.value) })
                  }
                >
                  <option value={1600}>1600 px</option>
                  <option value={2400}>2400 px</option>
                  <option value={3200}>3200 px</option>
                </select>
              </div>
            </div>

            <div className="card card--about">
              <p className="row-title">Engine</p>
              <p className="row-sub">
                Tesseract 5 (LSTM), English. The worker, WASM core and language model are bundled
                in the extension — no CDN, no remote code, no network requests.
              </p>
              <p className="row-sub">
                The extension is blocked from opening network connections by its own security
                policy, so screenshots cannot leave your device.
              </p>
              <p className="row-sub">Shortcut: <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>X</kbd> selects a region.</p>
            </div>
          </section>
        ) : job ? (
          <section className="progress-card" aria-live="polite">
            <div className="progress-head">
              <div className="spinner" aria-hidden="true" />
              <div>
                <p className="progress-stage">{job.stage}…</p>
                <p className="progress-sub">
                  {Math.round(job.progress * 100)}% · running on this device
                </p>
              </div>
            </div>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}>
              <span className="bar-fill" style={{ width: `${Math.max(4, job.progress * 100)}%` }} />
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>
              Cancel
            </button>
            <p className="progress-note">The OCR engine loads once per session (~7 MB, local).</p>
          </section>
        ) : result ? (
          <section aria-label="Extracted text">
            <div className="result-head">
              <div className="result-id">
                {result.thumb ? (
                  <img className="thumb" src={result.thumb} alt="" />
                ) : (
                  <span className="thumb thumb--empty" aria-hidden="true">
                    <IconImage size={16} />
                  </span>
                )}
                <div className="result-copy">
                  <p className="result-title">
                    {result.stats.headings > 0 ? 'Structured text' : 'Extracted text'}
                  </p>
                  <p className="result-sub">
                    {captures > 1
                      ? `${captures} captures merged`
                      : fullTiles
                        ? `Full page · ${fullTiles} tiles`
                        : `${result.width} × ${result.height}`}
                    {result.inverted && captures === 1 ? ' · dark mode inverted' : ''}
                  </p>
                </div>
              </div>
              <div className="result-tools">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label="Add another capture"
                  onClick={beginAppend}
                >
                  <IconPlus size={14} />
                  <span>Add</span>
                </button>
                {source && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label="Select regions"
                    onClick={() => setRegionsOpen(true)}
                  >
                    <IconCrop size={14} />
                    <span>
                      {source.regions.length ? `Regions (${source.regions.length})` : 'Regions'}
                    </span>
                  </button>
                )}
                <button type="button" className="icon-btn" aria-label="Start over" onClick={startOver}>
                  <IconX />
                </button>
              </div>
            </div>

            <div className="stats" role="group" aria-label="Result summary">
              <div className="stat">
                <span className="stat-value">{tokens.toLocaleString()}</span>
                <span className="stat-label">tokens</span>
              </div>
              <div className={`stat${savedPercent > 0 ? ' stat--good' : ''}`}>
                <span className="stat-value">{savedPercent}%</span>
                <span className="stat-label">smaller than image</span>
              </div>
              <div className="stat">
                <span className="stat-value">{Math.round(result.stats.confidence)}%</span>
                <span className="stat-label">confidence</span>
              </div>
            </div>

            <div
              className="meta-line"
              data-sharpness={Math.round(result.quality.sharpness)}
              data-contrast={Math.round(result.quality.contrast)}
              data-passes={result.passes}
            >
              {result.stats.words.toLocaleString()} words
              {result.stats.tables > 0 && ` · ${result.stats.tables} table${result.stats.tables > 1 ? 's' : ''}`}
              {result.stats.listItems > 0 && ` · ${result.stats.listItems} list items`}
              {appliedRegions && ` · ${appliedRegions}`}
            </div>

            {notes.length > 0 && (
              <div className="notes">
                {notes.map((note) => (
                  <span key={note} className="note-chip">
                    {note}
                  </span>
                ))}
              </div>
            )}

            <div className="tabs" role="tablist" aria-label="Output format">
              {VIEWS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="tab"
                  title={option.title}
                  data-view={option.id}
                  aria-selected={view === option.id}
                  className={`tab${view === option.id ? ' is-active' : ''}`}
                  onClick={() => setView(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {view === 'markdown' ? (
              <>
                <label className="sr-only" htmlFor="markdown-editor">
                  Extracted Markdown
                </label>
                <textarea
                  id="markdown-editor"
                  className="editor"
                  value={markdown}
                  spellCheck={false}
                  onChange={(event) => setMarkdown(event.target.value)}
                />
                <p className="editor-note">Editable — the token count updates as you type.</p>
              </>
            ) : view === 'raw' ? (
              <pre className="raw">{result.rawText || 'No raw text.'}</pre>
            ) : outputText.trim() ? (
              <>
                <pre
                  className="raw"
                  aria-label={view === 'text' ? 'Plain text output' : 'Outline output'}
                >
                  {outputText}
                </pre>
                <p className="editor-note">
                  Generated from the Markdown — edit it in the Markdown view.
                </p>
              </>
            ) : (
              <p className="empty-note">
                This capture has no headings or list items. Switch to Markdown or Text.
              </p>
            )}

            <div className="actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={copy}
                disabled={!outputText.trim()}
              >
                {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                {copied ? 'Copied' : 'Copy for agent'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={download}
                disabled={!outputText.trim()}
              >
                <IconDownload size={16} />
                {view === 'text' || view === 'raw' ? '.txt' : '.md'}
              </button>
            </div>
          </section>
        ) : (
          <section aria-label="Add a screenshot">
            {appendMode && (
              <div className="append-banner" role="status">
                <div className="append-copy">
                  <p className="append-title">Adding to your result</p>
                  <p className="append-sub">
                    {captures} capture{captures > 1 ? 's' : ''} so far · repeated lines at the
                    seam are removed
                  </p>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={leaveAppend}>
                  Cancel
                </button>
              </div>
            )}

            <div
              className={`dropzone${dragging ? ' is-over' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="Drop a screenshot, paste, or choose a file"
              onClick={() => fileInput.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  fileInput.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={drop}
            >
              <span className="dropzone-icon" aria-hidden="true">
                <IconImage size={22} />
              </span>
              <p className="dropzone-title">
                {appendMode ? 'Drop the next screenshot' : 'Drop a screenshot here'}
              </p>
              <p className="dropzone-sub">
                or press <kbd>Ctrl</kbd> + <kbd>V</kbd> to paste one
              </p>
            </div>

            <div className="capture-actions">
              <button type="button" className="btn btn-primary" onClick={() => void capture('region')}>
                <IconCrop size={17} />
                Select region
              </button>
              <button type="button" className="btn" onClick={() => void capture('visible')}>
                <IconMonitor size={17} />
                Visible tab
              </button>
              <button
                type="button"
                className="btn btn-ghost capture-wide"
                onClick={() => void captureFull()}
              >
                <IconPage size={17} />
                Full page
                <span className="capture-wide-hint">scroll &amp; stitch</span>
              </button>
            </div>

            <p className="hint">
              Region capture: <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>X</kbd>
            </p>
            <p className="hint hint--muted">
              Text, tables, lists and code become Markdown. Capturing a page needs access to it:
              click the extension icon on that tab — Chrome grants access per tab, until you
              navigate away.
            </p>

            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void acceptFile(file);
              }}
            />
          </section>
        )}

        {error && (
          <div
            className={error.code === 'no-access' ? 'error error--notice' : 'error'}
            role="alert"
          >
            <div>
              <p className="error-title">{error.message}</p>
              {error.hint && <p className="error-hint">{error.hint}</p>}
              {source && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm error-action"
                  onClick={() => setRegionsOpen(true)}
                >
                  <IconCrop size={14} />
                  Adjust regions
                </button>
              )}
            </div>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setError(null)}>
              <IconX size={15} />
            </button>
          </div>
        )}
      </main>

      <footer className="footer">
        <IconShield size={13} />
        <span>Runs on your device · no uploads</span>
      </footer>

      {regionsOpen && source && (
        <RegionsDialog
          dataUrl={source.dataUrl}
          imageWidth={source.width}
          imageHeight={source.height}
          initial={source.regions}
          onApply={applyRegions}
          onCancel={() => setRegionsOpen(false)}
        />
      )}
    </div>
  );
}

function describeMerge(stats: { added: number; overlap: number }): string | null {
  if (stats.added === 0) return 'No new text — that capture was already included';
  if (stats.overlap > 0) {
    return `Removed ${stats.overlap} repeated line${stats.overlap > 1 ? 's' : ''}`;
  }
  return null;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function fileSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'screenshot'
  );
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function timeAgo(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const table: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of table) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}
