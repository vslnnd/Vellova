import { splitProfile } from '../split/engine/profile';
import type { Batch, BatchItem, RenameProfile, Settings, SplitProfile } from './types';

export type LogEntry = { t: number; level: 'error' | 'warn' | 'info'; tool: 'rename' | 'split' | 'app'; file?: string; message: string; detail?: string };
export type ProfilesFile = { rename: RenameProfile[]; split: SplitProfile[] };
export type DataIO = {
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  updates: { onStartup: true, everyHours: 6 },
  rename: { folder: '', recursive: false },
  split: { archive: false, favourites: [], folder: '' },
  welcomed: false,
  tour: null,
};
export const LOG_MAX = 1000;
export const LOG_DAYS = 30;
export const HISTORY_MAX = 200;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function withDefaults(v: unknown): Settings {
  const s = isObj(v) ? v : {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    updates: { ...DEFAULT_SETTINGS.updates, ...(isObj(s.updates) ? s.updates : {}) },
    rename: { ...DEFAULT_SETTINGS.rename, ...(isObj(s.rename) ? s.rename : {}) },
    split: splitSettings(s.split),
    tour: isObj(s.tour) && typeof s.tour.dir === 'string' ? tourMarker(s.tour) : null,
  };
}

/** Split settings field by field: anything of the wrong type falls back to its default. */
function splitSettings(v: unknown): Settings['split'] {
  const s = isObj(v) ? v : {};
  return {
    archive: typeof s.archive === 'boolean' ? s.archive : false,
    favourites: Array.isArray(s.favourites) ? [...new Set(s.favourites.filter((f: unknown): f is string => typeof f === 'string'))] : [],
    folder: typeof s.folder === 'string' ? s.folder : '',
  };
}

/** A loaded profiles file: split profiles are checked one by one (a file from before Split has none). */
export function normalizeProfiles(v: ProfilesFile | { rename: RenameProfile[]; split?: unknown }): ProfilesFile {
  return { ...v, split: (Array.isArray(v.split) ? v.split : []).flatMap((p) => splitProfile(p) ?? []) };
}

/** A marker keeps `ended` only when it is a boolean. */
function tourMarker(t: Record<string, unknown>): Settings['tour'] {
  const { ended, ...rest } = t;
  return (typeof ended === 'boolean' ? { ...rest, ended } : rest) as Settings['tour'];
}

/**
 * Reads a JSON data file. Missing → fallback. Unparseable or the wrong shape → the file is renamed
 * `<name>.corrupt-<date>.json`, `onCorrupt` is told, and the fallback is used.
 */
export async function loadJson<T>(
  io: DataIO,
  name: string,
  fallback: T,
  valid: (v: unknown) => boolean,
  onCorrupt: (name: string, backup: string) => void,
  now = new Date(),
): Promise<T> {
  const text = await io.read(name);
  if (text === null) return fallback;
  try {
    const v: unknown = JSON.parse(text);
    if (valid(v)) return v as T;
  } catch {
    // fall through: set the file aside
  }
  const backup = `${name.replace(/\.json$/, '')}.corrupt-${now.toISOString().replace(/[:.]/g, '-')}.json`;
  await io.rename(name, backup);
  onCorrupt(name, backup);
  return fallback;
}

export const isProfiles = (v: unknown) => isObj(v) && Array.isArray(v.rename);
export const isHistory = (v: unknown) => Array.isArray(v);

export function parseLog(text: string | null): LogEntry[] {
  if (!text) return [];
  return text.split('\n').flatMap((line) => {
    try {
      const e: unknown = JSON.parse(line);
      return isObj(e) && typeof e.t === 'number' && typeof e.message === 'string' ? [e as LogEntry] : [];
    } catch {
      return [];
    }
  });
}

export function pruneLog(entries: LogEntry[], now: number): LogEntry[] {
  const cutoff = now - LOG_DAYS * 86_400_000;
  return entries.filter((e) => e.t >= cutoff).slice(-LOG_MAX);
}

export function logToText(entries: LogEntry[]): string {
  return entries
    .map((e) => [new Date(e.t).toISOString(), e.level.toUpperCase(), e.tool, e.file ?? '-', e.message, e.detail ?? ''].join('\t').trimEnd())
    .join('\r\n');
}

export const capHistory = (h: Batch[]) => h.slice(0, HISTORY_MAX);

export function batchSummary(b: Batch): string {
  const ok = b.items.filter((i) => i.ok).length;
  const pending = b.items.filter((i) => i.pending).length;
  const failed = b.items.length - ok - pending;
  const archived = b.items.filter((i) => i.ok && i.archived).length;
  return `${ok} ${ok === 1 ? 'file' : 'files'} ${b.verb}${archived ? ` · ${archived} archived` : ''}${failed ? ` · ${failed} failed` : ''}${pending ? ` · ${pending} unfinished` : ''}`;
}

/**
 * Puts `b` on top of the history. A batch with the same id (Apply fixes) is merged: later results win per source
 * (Rename), or per target for Split, where a source's earlier failures also go once it has new results.
 */
export function mergeBatch(history: Batch[], b: Batch): Batch[] {
  const prev = history.find((h) => h.id === b.id);
  const replaced = (i: BatchItem) =>
    b.tool === 'split'
      ? b.items.some((n) => n.to === i.to || (!i.ok && n.from === i.from))
      : b.items.some((n) => n.from === i.from);
  const merged: Batch = prev
    ? {
        ...prev,
        time: b.time,
        items: [...prev.items.filter((i) => !replaced(i)), ...b.items],
        undoable: prev.undoable || b.undoable,
      }
    : { ...b };
  merged.summary = batchSummary(merged);
  return capHistory([merged, ...history.filter((h) => h.id !== b.id)]);
}

/** Takes back what was recorded under `id` since `prev` (its earlier entry, if any); other batches stay as they are now. */
export const putBackBatch = (history: Batch[], id: string, prev: Batch | undefined): Batch[] =>
  prev ? history.map((h) => (h.id === id ? prev : h)) : history.filter((h) => h.id !== id);

export const lastUndoable =(history: Batch[]) => history.find((b) => b.undoable && !b.undone);
