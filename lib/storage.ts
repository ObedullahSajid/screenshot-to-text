import { isOutputPreset, type OutputPreset } from './format';
import type { LayoutStats } from './layout/rebuild';
import type { ImageQuality } from './preprocess';

export interface Settings {
  /** Drop page numbers, repeated lines and extra blank lines. */
  compact: boolean;
  /** Widest image passed to OCR, in pixels. */
  maxWidth: number;
  /** Format a fresh result opens in. */
  preset: OutputPreset;
}

export const DEFAULT_SETTINGS: Settings = {
  compact: true,
  maxWidth: 2400,
  preset: 'markdown',
};

export interface HistoryItem {
  id: string;
  createdAt: number;
  title: string;
  markdown: string;
  rawText: string;
  thumb: string;
  tokens: number;
  imageTokens: number;
  stats: LayoutStats;
  width: number;
  height: number;
  /** Optional: entries written by older builds do not have these. */
  quality?: ImageQuality;
  passes?: number;
  /** How many overlapping tiles a full-page capture used. */
  tiles?: number;
}

const SETTINGS_KEY = 'stt_settings';
const HISTORY_KEY = 'stt_history';
const HISTORY_LIMIT = 20;

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const value = stored[SETTINGS_KEY] as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    // Entries written by older builds have no preset, and a hand-edited value
    // could be anything.
    preset: isOutputPreset(value?.preset) ? value.preset : DEFAULT_SETTINGS.preset,
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getHistory(): Promise<HistoryItem[]> {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(stored[HISTORY_KEY]) ? (stored[HISTORY_KEY] as HistoryItem[]) : [];
}

export async function addHistory(item: HistoryItem): Promise<HistoryItem[]> {
  const history = await getHistory();
  const next = [item, ...history.filter((entry) => entry.id !== item.id)].slice(0, HISTORY_LIMIT);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
  return next;
}

export async function removeHistory(id: string): Promise<HistoryItem[]> {
  const next = (await getHistory()).filter((entry) => entry.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
  return next;
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(HISTORY_KEY);
}

export function makeTitle(markdown: string): string {
  const first = markdown
    .split('\n')
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim())
    .find((line) => line.length > 0);
  if (!first) return 'Screenshot';
  return first.length > 64 ? `${first.slice(0, 61)}…` : first;
}
