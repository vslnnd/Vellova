import { ipc } from './ipc';
import {
  capHistory, isHistory, isObj, isProfiles, loadJson, parseLog, pruneLog, withDefaults,
  type LogEntry, type ProfilesFile,
} from './store';
import type { Batch, Settings } from './types';

export const data = $state({
  settings: withDefaults({}) as Settings,
  profiles: { rename: [], split: [] } as ProfilesFile,
  history: [] as Batch[],
  log: [] as LogEntry[],
  loaded: false,
});

type Kind = 'settings' | 'profiles' | 'history' | 'log';
const FILE: Record<Kind, string> = { settings: 'settings.json', profiles: 'profiles.json', history: 'history.json', log: 'log.jsonl' };
const io = { read: ipc.dataRead, write: ipc.dataWrite, rename: ipc.dataRename };
const timers = new Map<Kind, ReturnType<typeof setTimeout>>();

export function log(e: Omit<LogEntry, 't'>) {
  data.log = pruneLog([...data.log, { t: Date.now(), ...e }], Date.now());
  save('log');
}

export async function loadAll() {
  const corrupt = (name: string, backup: string) =>
    log({ level: 'warn', tool: 'app', message: `${name} could not be read. It was set aside as ${backup} and defaults are used.` });
  data.log = pruneLog(parseLog(await ipc.dataRead(FILE.log).catch(() => null)), Date.now());
  data.settings = withDefaults(await loadJson<unknown>(io, FILE.settings, {}, isObj, corrupt));
  data.profiles = await loadJson<ProfilesFile>(io, FILE.profiles, { rename: [], split: [] }, isProfiles, corrupt);
  data.history = capHistory(await loadJson<Batch[]>(io, FILE.history, [], isHistory, corrupt));
  data.loaded = true;
}

function write(kind: Kind) {
  timers.delete(kind);
  const text = kind === 'log'
    ? data.log.map((e) => JSON.stringify(e)).join('\n')
    : JSON.stringify($state.snapshot(data[kind]), null, 2);
  return ipc.dataWrite(FILE[kind], text).catch((e) => console.error(`saving ${FILE[kind]} failed`, e));
}

/** Saves one data file atomically, 250 ms after the last change. */
export function save(kind: Kind) {
  clearTimeout(timers.get(kind));
  timers.set(kind, setTimeout(() => void write(kind), 250));
}

/** Writes pending saves now (before closing or restarting). */
export async function flush() {
  const kinds = [...timers.keys()];
  kinds.forEach((k) => clearTimeout(timers.get(k)));
  await Promise.all(kinds.map(write));
}
