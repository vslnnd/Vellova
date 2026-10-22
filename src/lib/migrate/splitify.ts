import { DEFAULT_SPLIT_RULES, splitProfile } from '../split/engine/profile';
import { batchSummary, capHistory, isObj } from '../shared/store';
import type { Batch, Settings, SplitProfile } from '../shared/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const items = (text: string): Record<string, any>[] => {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v.filter(isObj) : [];
  } catch {
    return [];
  }
};

/** The parsed items when the text is Splitify's profiles file (they carry `parameters`, or the older `params`; Nomina's carry neither), else null. */
export const splitifyItems = (text: string) => {
  const all = items(text);
  return all.some((p) => 'parameters' in p || 'params' in p) ? all : null;
};

/** Splitify's profiles items → split profiles by value. The result goes through the profile validator. */
export function profilesOf(all: ReturnType<typeof items>): SplitProfile[] {
  return all
    .map((p) =>
      splitProfile({
        id: typeof p.id === 'string' || typeof p.id === 'number' ? `splitify-${p.id}` : undefined,
        name: p.name,
        desc: p.description,
        archiveFolder: p.archiveFolder,
        rules: { ...DEFAULT_SPLIT_RULES, mode: 'value', params: p.parameters ?? p.params },
      }),
    )
    .filter((p): p is SplitProfile => !!p);
}

export const splitifyProfiles = (text: string) => profilesOf(items(text));

/** Where Splitify kept its data, relative to %APPDATA%. Order matters for planSplitifyImport. */
export const SPLITIFY_FILES = ['Splitify\\splitify_profiles.json', 'Splitify\\splitify_history.json', 'Splitify\\splitify_favfolders.json', 'Splitify\\splitify_settings.json'];

const NO_PROFILE = '\u2014 no profile \u2014';
const parse = (text: string | null): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const nearest = (n: number) => [1, 6, 24].reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));

export type SplitifyPlan = {
  profiles: SplitProfile[];
  history: Batch[];
  favourites: string[];
  settings: Omit<Partial<Settings>, 'split'> & { split?: Partial<Settings['split']> };
};

/** Splitify's files' texts, in SPLITIFY_FILES order (null = missing), give what Vellova can import. Bad files import nothing. */
export function planSplitifyImport(texts: (string | null)[]): SplitifyPlan {
  const [profiles, history, favs, settings] = texts.map(parse);
  const batches = (Array.isArray(history) ? history.filter(isObj) : []).flatMap((h): Batch[] => {
    const time = typeof h.timestamp === 'number' ? h.timestamp : Date.parse(str(h.timestamp));
    if (!Number.isFinite(time) || (typeof h.id !== 'string' && typeof h.id !== 'number')) return [];
    const files = Array.isArray(h.files) ? h.files.filter(isObj) : [];
    const b: Batch = { id: `splitify-${h.id}`, tool: 'split', time, verb: 'created', summary: '', items: files.map((f) => ({ from: str(f.path) || str(f.name), to: str(h.outputDir), ok: true })), undoable: false };
    if (str(h.profileName) && h.profileName !== NO_PROFILE) b.profile = h.profileName;
    b.summary = Number.isInteger(h.totalCreated) && h.totalCreated >= 0 ? `${h.totalCreated} ${h.totalCreated === 1 ? 'file' : 'files'} created` : batchSummary(b);
    return [b];
  });
  const s = isObj(settings) ? settings : {};
  const out: SplitifyPlan['settings'] = {};
  if (s.theme === 'light' || s.theme === 'dark') out.theme = s.theme;
  const hours = typeof s.updateIntervalHours === 'number' && Number.isFinite(s.updateIntervalHours);
  if (typeof s.checkUpdatesOnStartup === 'boolean' || hours) out.updates = { onStartup: s.checkUpdatesOnStartup !== false, everyHours: hours ? nearest(s.updateIntervalHours) : 6 };
  if (typeof s.archiveOriginals === 'boolean') out.split = { archive: s.archiveOriginals };
  return {
    profiles: Array.isArray(profiles) ? profilesOf(profiles.filter(isObj)) : [],
    history: capHistory(batches.sort((x, y) => y.time - x.time)),
    favourites: [...new Set((Array.isArray(favs) ? favs : []).filter((f): f is string => typeof f === 'string'))],
    settings: out,
  };
}
