import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { recordBatch, undoLast, undoRunning } from '../shared/batches';
import { ipc, ipcReason, type OpResult } from '../shared/ipc';
import { expandFolder, extOf, splitExt, splitPath } from '../shared/names';
import { data, flush, log, save } from '../shared/state.svelte';
import { REASONS } from '../shared/reasons';
import { putBackBatch } from '../shared/store';
import type { FileInfo, Reason, RenameProfile, Step } from '../shared/types';
import { openTarget } from '../shell/island';
import { island, send } from '../shell/islandState.svelte';
import type { Grid } from '../split/engine/grid';
import { readGrid } from '../split/sheets';
import { readCompanion } from './companions';
import type { CompanionData } from './engine/companion';
import { mergeFiles, PDF, pathKey } from './engine/files';
import { pairCompanions } from './engine/pairing';
import { classifyPdfError } from './engine/pdfItems';
import { planRename, readResults } from './engine/planner';
import { DEFAULT_RULES, matchNo, profileFromRules, rulesFromProfile, type RenameRules } from './engine/profile';
import { formatDate, listKey, listMap, patternError, runSteps, type ListRead, type Named, type PdfText } from './engine/steps';
import { readPdfText } from './pdf';

export { REASONS };

type Failure = { reason: Reason; detail: string };

export const session = $state({
  files: [] as FileInfo[],
  rules: structuredClone(DEFAULT_RULES) as RenameRules,
  profileId: null as string | null,
  /** the left column shows the settings instead of the loaded profile's summary; set by Edit or Change, ended by using a profile or Reset */
  editing: false,
  /** the PDF the picker shows, while picking a value with a click */
  picking: null as string | null,
  /** per list step (listKey): why its list can't be used, from the last read */
  listErrors: {} as Record<string, string>,
  /** per PDF: its new name or why there is none (missing: not read yet) */
  names: {} as Record<string, Named>,
  /** companions that could not be read */
  readFailures: {} as Record<string, Failure>,
  /** companion → PDF; null until the first read finishes (a re-read keeps the previous pairs until it is done) */
  pairs: null as Record<string, string> | null,
  /** companions paired by hand in Needs attention */
  manualPairs: {} as Record<string, string>,
  existing: [] as string[],
  overrides: {} as Record<string, string>,
  skipped: [] as string[],
  /** files whose operation failed when applied */
  failures: {} as Record<string, Failure>,
  /** files fixed in Needs attention, for Apply fixes */
  fixed: [] as string[],
  loading: false,
  /** the inputs changed (or a read was cancelled) and no read has finished since: values may be stale */
  dirty: false,
  busy: false,
  /** the last batch, which Apply fixes adds to */
  batch: null as string | null,
});

const KEYWORD = 'Enter a keyword to find the value.';

/** Why PDFs wait instead of being read: the first keyword is empty, or a custom pattern is broken. */
function waitReason(steps: Step[]): string | null {
  const value = steps.find((s) => s.type === 'pdfValue');
  if (value && !value.keyword.trim()) return KEYWORD;
  for (const s of steps) {
    const e = patternError(s);
    if (e) return e;
  }
  return null;
}

/** {n} and {date} of every PDF, so a PDF without a name (failed, or still reading) still expands its folder. */
function slotsOf(files: FileInfo[], today: Date) {
  const date = formatDate(today, 'yyyy-MM-dd');
  const pdfs = files.filter((f) => extOf(f.path) === PDF);
  return Object.fromEntries(pdfs.map((f, i) => [f.path, { n: String(i + 1), date }]));
}

const items = $derived.by(() => {
  const r = session.rules;
  const wait = waitReason(r.steps);
  const planned = planRename({
    files: session.files.map((f) => f.path),
    names: session.names,
    failures: session.readFailures,
    slots: slotsOf(session.files, new Date()),
    pairs: session.pairs && { ...session.pairs, ...session.manualPairs },
    pairEnabled: r.pair,
    destination: r.destination,
    conflict: r.conflict,
    existing: new Set(session.existing),
    overrides: session.overrides,
    skipped: new Set(session.skipped),
  });
  return planned.map((it) => {
    // a file whose operation failed keeps it (for Retry) but shows as attention
    const f = session.failures[it.source];
    if (f && it.op) return { ...it, status: 'attention' as const, reason: f.reason, detail: f.detail };
    // without a keyword (or with a broken pattern) nothing is searched: PDFs, and companions looking for a PDF value, wait
    if (wait && ((it.status === 'pending' && extOf(it.source) === PDF) || it.reason === 'no-match')) {
      return { ...it, status: 'pending' as const, reason: undefined, detail: wait };
    }
    return it;
  });
});

/** The live preview (a getter: derived state can't be exported directly). */
export const plan = {
  get items() {
    return items;
  },
};

type Read<T> = { ok: true; data: T } | { ok: false; reason: Reason; detail: string };
const pdfCache = new Map<string, Read<PdfText>>();
const sheetCache = new Map<string, Read<CompanionData>>();

/** Forgets what was read from `path`, so the next refresh reads it again (Retry). */
function evict(path: string) {
  for (const cache of [pdfCache, sheetCache] as Map<string, unknown>[]) {
    for (const k of cache.keys()) if (k.startsWith(`${path}|`)) cache.delete(k);
  }
}

/**
 * Reads and parses a file once per path, size and modified time. A file that can't be parsed is remembered too,
 * so it isn't parsed on every keystroke; read errors (locked, missing…) and internal ones are not, they may pass.
 */
async function readCached<T>(
  cache: Map<string, Read<T>>,
  f: FileInfo,
  parse: (bytes: Uint8Array) => Promise<T>,
  why: (e: unknown) => { reason: Reason; detail: string },
): Promise<Read<T>> {
  const key = `${f.path}|${f.size}|${f.mtime}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let bytes: Uint8Array;
  try {
    bytes = await ipc.readFile(f.path);
  } catch (e) {
    return { ok: false, ...ipcReason(e) };
  }
  try {
    // `bytes` may be transferred to a worker here: it is not used again
    const read: Read<T> = { ok: true, data: await parse(bytes) };
    cache.set(key, read);
    return read;
  } catch (e) {
    const read: Read<T> = { ok: false, ...why(e) };
    if (read.reason === 'internal') log({ level: 'error', tool: 'rename', file: f.path, message: 'A reader stopped on this file and was restarted.', detail: read.detail });
    else {
      // remembered per file version, so this logs once, not on every keystroke
      cache.set(key, read);
      log({ level: 'warn', tool: 'rename', file: f.path, message: "This file couldn't be read.", detail: read.detail });
    }
    return read;
  }
}

const sheetError = (e: unknown) =>
  (e as { internal?: boolean })?.internal
    ? { reason: 'internal' as const, detail: String((e as Error).message) }
    : { reason: 'unreadable' as const, detail: `This file can't be read (${String((e as Error)?.message ?? e)}).` };

/** List files read, per path, size and modified time (only the newest version of each path is kept). */
const gridCache = new Map<string, Grid>();
const MISSING_LIST = 'The list file is missing.';

/** Why a list file could not be read, from the read's error. */
export function listReadError(e: unknown): string {
  const r = ipcReason(e);
  return r.reason === 'missing' ? MISSING_LIST : r.reason === 'locked' ? 'The list file is open in another program.' : r.detail;
}

/** The map of a list step; a failure becomes the reason shown on each PDF. */
async function readList(s: Extract<Step, { type: 'list' }>): Promise<ListRead> {
  const f = (await ipc.listFiles([s.path], false)).find((x) => pathKey(x.path) === pathKey(s.path));
  if (!f) return { ok: false, detail: MISSING_LIST };
  const key = `list|${f.path}|${f.size}|${f.mtime}`;
  let grid = gridCache.get(key);
  if (!grid) {
    let bytes: Uint8Array;
    try {
      bytes = await ipc.readFile(f.path);
    } catch (e) {
      return { ok: false, detail: listReadError(e) };
    }
    try {
      grid = await readGrid(key, extOf(f.path), bytes, null);
    } catch (e) {
      return { ok: false, detail: String((e as Error)?.message ?? e) };
    }
    for (const k of gridCache.keys()) if (k.startsWith(`list|${f.path}|`)) gridCache.delete(k);
    gridCache.set(key, grid);
  }
  return listMap(grid, s.match, s.name);
}

/** Sets or clears `key` in `to` as it is in `from`. */
function put<T>(to: Record<string, T>, from: Record<string, T>, key: string) {
  if (key in from) to[key] = from[key];
  else delete to[key];
}

let generation = 0;
/** The island shows our "Reading" layer. Only the current read may update or stop it; a newer read takes it over. */
let reading = false;

function stopReading() {
  if (!reading) return;
  reading = false;
  send({ type: 'stop' });
}

/** The inputs changed: what is being read is stale, and Rename waits for the next refresh to finish. */
export function invalidate() {
  generation++;
  session.dirty = true;
  session.loading = true; // a read follows shortly (Rename debounces); until then the screen says it is reading
}

/** Reads what the preview needs and pairs companions. A newer call makes an older one stop. */
export async function refresh() {
  const gen = ++generation;
  const stale = () => gen !== generation;
  const files = $state.snapshot(session.files);
  const rules = $state.snapshot(session.rules);
  // a number input can leave a match number empty or fractional
  const steps = rules.steps.map((s) => ('occurrence' in s ? { ...s, occurrence: matchNo(s.occurrence) } : s));
  const wait = waitReason(steps);
  const needPdf = steps.some((s) => s.type === 'pdfValue' || s.type === 'pdfPattern');
  session.loading = true;
  // the island only shows reading that takes a while
  const timer = setTimeout(() => {
    if (stale() || (!reading && island.activity)) return;
    reading = true;
    send({ type: 'start', label: 'Reading', total: files.length, cancellable: true });
  }, 300);
  try {
    const dest = rules.destination;
    const lists: Record<string, ListRead> = {};
    for (const s of wait ? [] : steps) {
      if (s.type !== 'list' || listKey(s) in lists) continue;
      lists[listKey(s)] = await readList(s);
      if (stale()) return;
    }
    session.listErrors = Object.fromEntries(Object.entries(lists).flatMap(([k, l]) => (l.ok ? [] : [[k, l.detail]])));
    const names: Record<string, Named> = {};
    const failures: Record<string, Failure> = {};
    const sheets: { path: string; data: CompanionData }[] = [];
    const today = new Date();
    const slots = slotsOf(files, today);
    let n = 0;
    let index = 0;
    for (const f of files) {
      const ext = extOf(f.path); // lower-cased
      if (ext === PDF) {
        if (!wait) {
          const r = needPdf ? await readCached(pdfCache, f, readPdfText, classifyPdfError) : null;
          if (stale()) return;
          const base = splitExt(splitPath(f.path).name).base;
          names[f.path] = !r || r.ok ? runSteps(steps, { base, pdf: r?.data ?? null, lists, index, mtime: f.mtime, ctime: f.ctime, today }) : r;
        }
        index++;
      } else if (rules.pair) {
        const r = await readCached(sheetCache, f, (b) => readCompanion(ext, b), sheetError);
        if (stale()) return;
        if (r.ok) sheets.push({ path: f.path, data: r.data });
        else failures[f.path] = r;
      }
      // file by file, so the previous names stay shown until the new ones land
      put(session.names, names, f.path);
      put(session.readFailures, failures, f.path);
      n++;
      if (reading) send({ type: 'progress', done: n, total: files.length });
    }
    // drops files that left the list
    session.names = names;
    session.readFailures = failures;
    // the target folders follow the names, so they are listed once every name is known
    const dirs =
      dest.mode === 'inplace'
        ? files.map((f) => splitPath(f.path).dir)
        : [
            expandFolder(dest.folder, { value: null, n: '1', date: '' }), // a typed companion name without its PDF
            ...Object.entries(slots).map(([p, slot]) => {
              const v = names[p];
              return expandFolder(dest.folder, v?.ok ? v : { value: null, ...slot });
            }),
          ];
    const listed = await ipc.listDir([...new Set(dirs)].filter(Boolean)).catch(() => [] as string[]);
    if (stale()) return;
    // the listed files count too, even where their folder could not be read
    session.existing = [...new Set([...listed, ...files.map((f) => f.path)].map(pathKey))];
    // an empty value would be found in every companion
    const pdfs = files.flatMap((f) => {
      const v = names[f.path];
      return extOf(f.path) === PDF && v?.ok && v.value?.trim() ? [{ path: f.path, value: v.value }] : [];
    });
    session.pairs = pairCompanions(pdfs, sheets);
    session.dirty = false;
  } catch (e) {
    // dirty stays set: the preview offers "Read again"
    if (!stale()) log({ level: 'error', tool: 'rename', message: 'Reading the files stopped.', detail: String(e) });
  } finally {
    clearTimeout(timer);
    // a stale read leaves the island to whoever owns it now (a newer read, or a batch after a Cancel)
    if (!stale()) {
      stopReading();
      session.loading = false;
    }
  }
}

/** While set, only files it accepts can be added (the tour keeps the list to its samples). */
let addFilter: ((path: string) => boolean) | null = null;
export const setAddFilter = (f: ((path: string) => boolean) | null) => (addFilter = f);

export async function addPaths(paths: string[]) {
  if (!paths.length) return;
  const listed = await ipc.listFiles(paths, data.settings.rename.recursive);
  const keep = addFilter;
  session.files = mergeFiles(session.files, keep ? listed.filter((f) => keep(f.path)) : listed);
}

export async function pickFiles() {
  const picked = await open({ multiple: true, filters: [{ name: 'PDFs and companion files', extensions: ['pdf', 'xlsx', 'txt', 'xml', 'csv'] }] });
  if (picked) await addPaths(picked);
}

export async function pickFolder() {
  const picked = await open({ directory: true, multiple: true });
  if (picked) await addPaths(picked);
}

export async function pickCopyFolder() {
  const folder = await open({ directory: true, defaultPath: data.settings.rename.folder || undefined });
  if (!folder) return;
  session.rules.destination = { mode: session.rules.destination.mode === 'move' ? 'move' : 'copy', folder };
  data.settings.rename.folder = folder;
  save('settings');
}

function forget(paths: string[]) {
  const gone = new Set(paths);
  session.files = session.files.filter((f) => !gone.has(f.path));
  session.skipped = session.skipped.filter((p) => !gone.has(p));
  session.fixed = session.fixed.filter((p) => !gone.has(p));
  if (session.picking && gone.has(session.picking)) session.picking = null;
  for (const p of paths) {
    delete session.overrides[p];
    delete session.failures[p];
    delete session.manualPairs[p];
  }
}

export const removeFile = (path: string) => forget([path]);

export function clearFiles() {
  forget(session.files.map((f) => f.path));
  session.batch = null;
}

const markFixed = (path: string) => {
  if (!session.fixed.includes(path)) session.fixed.push(path);
};

/** Skips a file, or includes it again. */
export function skip(path: string) {
  session.skipped = session.skipped.includes(path) ? session.skipped.filter((p) => p !== path) : [...session.skipped, path];
  delete session.failures[path];
}

/** A name typed in the preview (without extension); empty goes back to the rules. */
export function setName(path: string, name: string, fix = false) {
  if (name.trim()) session.overrides[path] = name;
  else delete session.overrides[path];
  if (fix) markFixed(path);
}

/** Tries a failed file again: reads it afresh and re-plans it (a name taken meanwhile gets the conflict rule). */
export async function retry(path: string) {
  delete session.failures[path];
  const [fresh] = await ipc.listFiles([path], false);
  if (!fresh) {
    session.failures[path] = { reason: 'missing', detail: REASONS.missing.hint };
    return;
  }
  evict(path);
  session.files = session.files.map((f) => (f.path === path ? fresh : f));
  markFixed(path);
}

export function pickPdf(companion: string, pdf: string) {
  session.manualPairs[companion] = pdf;
  markFixed(companion);
}

/** The island's Cancel: stops a running batch before its next file, or stops reading. */
export function cancelActivity() {
  if (session.busy) return void ipc.cancelApply();
  // the values are half read: pairs made from older values must not be used, and Rename waits for a full read
  invalidate();
  session.loading = false;
  session.pairs = null;
  reading = false;
  send({ type: 'stop' });
}

const profileName = () => data.profiles.rename.find((p) => p.id === session.profileId)?.name;

/** Applies the preview (or only `only`, inside the last batch). Done files leave the list; failures stay with a reason. */
export async function runBatch(only?: string[]) {
  if (session.busy || session.loading || session.dirty || island.activity) return;
  const pick = only && new Set(only);
  const run = plan.items.filter((i) => i.op && (pick ? pick.has(i.source) : i.status !== 'attention'));
  if (!run.length) return;
  const mode = session.rules.destination.mode;
  const [label, verb] = { inplace: ['Renaming', 'renamed'], copy: ['Copying', 'copied'], move: ['Moving', 'moved'] }[mode];
  const last = pick && data.history.find((h) => h.id === session.batch);
  // fixes join the last batch, unless it was undone (its journal is spent)
  const id = last && !last.undone ? last.id : crypto.randomUUID();
  // the island is busy before the first await, so Undo can't start meanwhile
  session.busy = true;
  send({ type: 'start', label, total: run.length, cancellable: true });
  const meta = { id, tool: 'rename' as const, verb, profile: profileName() };
  // what History held under this id before (Apply fixes), to put back if the run records nothing
  const prev = id === last?.id ? $state.snapshot(last) : undefined;
  // In History, saved, before anything moves: a batch the app never finished can still be undone.
  recordBatch({ ...meta, time: Date.now(), items: run.map((i) => ({ from: i.source, to: i.op!.to, ok: false, pending: true })), undoable: true });
  let unlisten = () => {};
  let results: OpResult[];
  try {
    await flush();
    unlisten = await listen<[number, number]>('plan-progress', (e) => send({ type: 'progress', done: e.payload[0], total: e.payload[1] }));
    results = await ipc.applyPlan(id, run.map((i) => i.op!));
  } catch (e) {
    // apply_plan fails only before its first op (another batch running, journal not writable): nothing moved
    data.history = putBackBatch(data.history, id, prev);
    save('history');
    log({ level: 'error', tool: 'rename', message: 'The batch could not run.', detail: String(e) });
    send({ type: 'stop' });
    send({ type: 'restored', text: "Couldn't start · see History › Log" });
    return;
  } finally {
    unlisten();
    session.busy = false;
  }
  const { batch, failed, warned, done } = readResults(run, results);
  for (const f of failed) {
    session.failures[f.source] = { reason: f.reason, detail: REASONS[f.reason].hint };
    log({ level: 'error', tool: 'rename', file: f.source, message: REASONS[f.reason].title, detail: f.message });
  }
  for (const w of warned) {
    log({ level: 'warn', tool: 'rename', file: w.source, message: `${verb[0].toUpperCase() + verb.slice(1)}, but Undo can't reverse this file.`, detail: w.message });
  }
  forget(done);
  // the real results replace the pending record; cancelled files leave it
  data.history = putBackBatch(data.history, id, prev);
  if (!batch.length) {
    save('history');
    return void send({ type: 'stop' }); // everything was cancelled
  }
  session.batch = id;
  const b = recordBatch({ ...meta, time: Date.now(), items: batch, undoable: batch.some((x) => x.ok) });
  log({ level: 'info', tool: 'rename', message: b.summary });
  // from the merged batch, so Open matches the summary after Apply fixes too
  const open = openTarget(b.items.filter((i) => i.ok).map((i) => i.to));
  send({ type: 'finish', text: b.summary, attention: plan.items.filter((i) => i.status === 'attention').length, open });
}

export const applyFixes = () => runBatch([...session.fixed]);

/** Waits until no batch or undo is moving files, up to `capMs`, so closing or updating doesn't stop one half-way. */
export async function whenIdle(capMs = 30_000) {
  const end = Date.now() + capMs;
  while ((session.busy || undoRunning()) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
}

export function useProfile(p: RenameProfile) {
  session.rules = rulesFromProfile($state.snapshot(p)); // a stored profile is a $state proxy, which structuredClone rejects
  session.profileId = p.id;
  session.editing = false;
}

const loaded = () => data.profiles.rename.find((p) => p.id === session.profileId);

/** Rules back to the loaded profile (else the defaults) and an empty file list. Not while a batch runs. */
export function reset() {
  if (session.busy) return;
  const p = loaded();
  session.rules = p ? rulesFromProfile($state.snapshot(p)) : structuredClone(DEFAULT_RULES);
  session.editing = false;
  clearFiles();
}

/** A profile is loaded and the rules differ from it (as the session would load it). */
const changed = $derived.by(() => {
  const p = loaded();
  return !!p && JSON.stringify($state.snapshot(session.rules)) !== JSON.stringify(rulesFromProfile($state.snapshot(p)));
});
export const edited = {
  get value() {
    return changed;
  },
};

/** Saves the rules into the current profile, or as a new profile when `name` is given. */
export function saveProfile(name?: string) {
  const list = data.profiles.rename;
  const current = list.find((p) => p.id === session.profileId);
  if (current && !name) {
    Object.assign(current, profileFromRules($state.snapshot(session.rules), current.name, current.id, current.desc));
  } else {
    const p = profileFromRules($state.snapshot(session.rules), name ?? 'New profile', crypto.randomUUID());
    list.push(p);
    session.profileId = p.id;
  }
  save('profiles');
}

// dev only: lets scripts/cdp.mjs drive the screen
if (import.meta.env.DEV) Object.assign(window, { __rename: { session, plan, addPaths, runBatch, undoLast, cancelActivity, refresh } });
