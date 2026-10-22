import { DEFAULT_RULES, POSITIONS, profileFromRules, renameProfile } from '../rename/engine/profile';
import { splitProfile } from '../split/engine/profile';
import { batchSummary, capHistory, isObj } from '../shared/store';
import { profilesOf, splitifyItems } from './splitify';
import type { Batch, BatchItem, RenameProfile, Settings, SplitProfile } from '../shared/types';

/** Where the previous rename app kept its data, relative to %APPDATA%. Order matters for planImport. */
export const NOMINA_FILES = ['Nomina\\nomina-profiles.json', 'Nomina\\nomina-history.json', 'Nomina\\nomina_history.json', 'Nomina\\nomina-settings.json'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const obj = (v: unknown): Record<string, any> => (isObj(v) ? v : {});
const list = (v: unknown) => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
function parse(text: string | null): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Old profiles → one Value-from-PDF step plus Add text, with pairing on. */
export function mapProfiles(v: unknown): RenameProfile[] {
  return list(v)
    .filter((p) => str(p.name))
    .map((p) =>
      profileFromRules(
        { ...DEFAULT_RULES, keyword: str(p.keyword), position: POSITIONS.includes(p.position) ? p.position : 'after', prefix: str(p.prefix), suffix: str(p.suffix), pair: true },
        str(p.name),
        `nomina-${str(p.id) || str(p.name)}`,
        str(p.description),
      ),
    );
}

function batch(id: string, time: number, items: BatchItem[], profile?: string): Batch {
  const b: Batch = { id, tool: 'rename', time, verb: 'renamed', summary: '', items, undoable: false, ...(profile ? { profile } : {}) };
  b.summary = batchSummary(b);
  return b;
}

/** Both old history files → read-only batches (there is no journal, so no undo), newest first. */
export function mapHistory(current: unknown, old: unknown): Batch[] {
  const time = (t: unknown) => (typeof t === 'number' ? t : Date.parse(str(t)));
  const a = list(current).map((h) =>
    batch(
      `nomina-${h.id}`,
      time(h.timestamp),
      list(h.files).map((f) => ({ from: '', to: str(f.path) || str(f.name), ok: true })),
      h.profileName && h.profileName !== '—' ? str(h.profileName) : undefined,
    ),
  );
  const b = list(old).map((h) => batch(`nomina-old-${h.id}`, time(h.timestamp), list(h.files).map((f) => ({ from: str(f.originalName), to: str(f.newName), ok: true }))));
  return [...a, ...b].filter((x) => !Number.isNaN(x.time)).sort((x, y) => y.time - x.time);
}

const HOURS: Record<string, number> = { '30min': 1, hourly: 1, '6h': 6, daily: 24 };

/** Old settings → theme and update checks (the old default interval was hourly). */
export function mapSettings(v: unknown): Partial<Settings> {
  const s = obj(v);
  const out: Partial<Settings> = {};
  if (s.theme === 'light' || s.theme === 'dark') out.theme = s.theme;
  const known = typeof s.checkInterval === 'string' && Object.hasOwn(HOURS, s.checkInterval);
  if (typeof s.checkOnStartup === 'boolean' || known) {
    out.updates = { onStartup: s.checkOnStartup !== false, everyHours: known ? HOURS[s.checkInterval] : 1 };
  }
  return out;
}

export type ImportPlan = { profiles: RenameProfile[]; history: Batch[]; settings: Partial<Settings> };

/** The old files' texts, in NOMINA_FILES order (null = missing), → what Vellova can import. */
export function planImport(texts: (string | null)[]): ImportPlan {
  const [profiles, history, oldHistory, settings] = texts.map(parse);
  return { profiles: mapProfiles(profiles), history: mapHistory(history, oldHistory), settings: mapSettings(settings) };
}

export const isEmpty = (p: ImportPlan) => !p.profiles.length && !p.history.length && !Object.keys(p.settings).length;

/** Adds what isn't there yet (same id = imported before). */
export function mergeImport(current: { profiles: RenameProfile[]; history: Batch[] }, plan: ImportPlan) {
  const pids = new Set(current.profiles.map((p) => p.id));
  const hids = new Set(current.history.map((b) => b.id));
  const profiles = plan.profiles.filter((p) => !pids.has(p.id));
  const history = plan.history.filter((b) => !hids.has(b.id));
  return {
    profiles: [...current.profiles, ...profiles],
    history: capHistory([...current.history, ...history].sort((x, y) => y.time - x.time)),
    added: { profiles: profiles.length, history: history.length },
  };
}

/** A profiles file chosen in Profiles › Import: Vellova's own export, Splitify's profiles file, or the previous rename app's. */
export function importProfiles(text: string): { rename: RenameProfile[]; split: SplitProfile[] } {
  const sp = splitifyItems(text);
  if (sp) return { rename: [], split: profilesOf(sp) };
  const v = parse(text);
  const o = obj(v);
  const items = Array.isArray(v) ? v : o.rename;
  const ours = list(items).map(renameProfile).filter((p): p is RenameProfile => !!p);
  const split = list(o.split).map(splitProfile).filter((p): p is SplitProfile => !!p);
  return { rename: ours.length ? ours : Array.isArray(v) ? mapProfiles(items) : [], split };
}

/** The imported profiles whose id is new: not in `ids` and not repeated within the import. */
export const freshProfiles = <T extends { id: string }>(ids: Iterable<string>, imported: T[]): T[] => {
  const seen = new Set(ids);
  return imported.filter((p) => !seen.has(p.id) && !!seen.add(p.id));
};
