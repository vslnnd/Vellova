import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { recordBatch, undoLast } from '../shared/batches';
import { ipc, ipcReason, type OpResult } from '../shared/ipc';
import { extOf, splitPath } from '../shared/names';
import { data, flush, log, save } from '../shared/state.svelte';
import { putBackBatch } from '../shared/store';
import type { FileInfo, Reason, RenameProfile } from '../shared/types';
import { island, send } from '../shell/islandState.svelte';
import { readCompanion } from './companions';
import type { CompanionData } from './engine/companion';
import { mergeFiles, PDF, pathKey } from './engine/files';
import { findValue } from './engine/findValue';
import { pairCompanions } from './engine/pairing';
import { classifyPdfError, type Item } from './engine/pdfItems';
import { planRename, readResults, type ValueResult } from './engine/planner';
import { DEFAULT_RULES, profileFromRules, rulesFromProfile, type RenameRules } from './engine/profile';
import { readPdfItems } from './pdf';

/** Plain-language title and advice for every reason a file needs attention. */
export const REASONS: Record<Reason, { title: string; hint: string }> = {
  'keyword-not-found': { title: 'Keyword not found', hint: 'Check the keyword, or type a name for this file.' },
  'no-value': { title: 'No value next to the keyword', hint: 'Try another position, or type a name for this file.' },
  'no-text': { title: 'Scanned PDF (no text layer)', hint: 'This PDF is an image. Type a name for it.' },
  unreadable: { title: 'Unreadable or damaged file', hint: "This file can't be read. Skip it." },
  'no-match': { title: 'Companion file without a match', hint: 'Pick its PDF, or skip it.' },
  exists: { title: 'Target name exists', hint: 'A file with the new name appeared after the preview. Retry to pick a free name.' },
  locked: { title: 'File locked or in use', hint: 'The file is open in another program. Close it, then Retry.' },
  permission: { title: 'No permission', hint: 'Windows refused access to this file or its folder.' },
  missing: { title: 'File missing', hint: 'The file is no longer where it was.' },
  internal: { title: 'Internal error', hint: 'Something went wrong. Retry; the details are in History › Log.' },
};

export const session = $state({
  files: [] as FileInfo[],
  rules: structuredClone(DEFAULT_RULES) as RenameRules,
  profileId: null as string | null,
  /** per PDF: the value or why there is none; per companion: only read failures */
  values: {} as Record<string, ValueResult>,
  /** companion → PDF; null until the first read finishes (a re-read keeps the previous pairs until it is done) */
  pairs: null as Record<string, string> | null,
  /** companions paired by hand in Needs attention */
  manualPairs: {} as Record<string, string>,
  existing: [] as string[],
  overrides: {} as Record<string, string>,
  skipped: [] as string[],
  /** files whose operation failed when applied */
  failures: {} as Record<string, { reason: Reason; detail: string }>,
  /** files fixed in Needs attention, for Apply fixes */
  fixed: [] as string[],
  loading: false,
  /** the inputs changed (or a read was cancelled) and no read has finished since: values may be stale */
  dirty: false,
  busy: false,
  /** the last batch, which Apply fixes adds to */
  batch: null as string | null,
});

const items = $derived.by(() => {
  const r = session.rules;
  const noKeyword = !r.keyword.trim();
  const planned = planRename({
    files: session.files.map((f) => f.path),
    values: session.values,
    pairs: session.pairs && { ...session.pairs, ...session.manualPairs },
    pairEnabled: r.pair,
    prefix: r.prefix,
    suffix: r.suffix,
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
    // without a keyword nothing is searched: PDFs, and companions looking for a PDF value, wait for one
    if (noKeyword && ((it.status === 'pending' && extOf(it.source) === PDF) || it.reason === 'no-match')) {
      return { ...it, status: 'pending' as const, reason: undefined, detail: 'Enter a keyword to find the value.' };
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
const pdfCache = new Map<string, Read<Item[]>>();
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
    else cache.set(key, read);
    return read;
  }
}

const sheetError = (e: unknown) =>
  (e as { internal?: boolean })?.internal
    ? { reason: 'internal' as const, detail: String((e as Error).message) }
    : { reason: 'unreadable' as const, detail: `This file can't be read (${String((e as Error)?.message ?? e)}).` };

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
}

/** Reads what the preview needs and pairs companions. A newer call makes an older one stop. */
export async function refresh() {
  const gen = ++generation;
  const stale = () => gen !== generation;
  const files = $state.snapshot(session.files);
  const rules = $state.snapshot(session.rules);
  const keyword = rules.keyword.trim();
  const occurrence = Math.max(1, Math.floor(rules.occurrence) || 1);
  session.loading = true;
  // the island only shows reading that takes a while
  const timer = setTimeout(() => {
    if (stale() || (!reading && island.activity)) return;
    reading = true;
    send({ type: 'start', label: 'Reading', total: files.length, cancellable: true });
  }, 300);
  try {
    const dest = rules.destination;
    const dirs = dest.mode === 'copy' ? [dest.folder].filter(Boolean) : [...new Set(files.map((f) => splitPath(f.path).dir))];
    const listed = await ipc.listDir(dirs).catch(() => [] as string[]);
    if (stale()) return;
    // the listed files count too, even where their folder could not be read
    session.existing = [...new Set([...listed, ...files.map((f) => f.path)].map(pathKey))];
    const values: Record<string, ValueResult> = {};
    const sheets: { path: string; data: CompanionData }[] = [];
    session.values = {};
    let n = 0;
    for (const f of files) {
      const ext = extOf(f.path); // lower-cased
      if (ext === PDF) {
        if (keyword) {
          const r = await readCached(pdfCache, f, readPdfItems, classifyPdfError);
          if (stale()) return;
          values[f.path] = r.ok ? findValue(r.data, keyword, rules.position, occurrence) : r;
        }
      } else if (rules.pair) {
        const r = await readCached(sheetCache, f, (b) => readCompanion(ext, b), sheetError);
        if (stale()) return;
        if (r.ok) sheets.push({ path: f.path, data: r.data });
        else values[f.path] = r;
      }
      session.values = { ...values };
      n++;
      if (reading) send({ type: 'progress', done: n, total: files.length });
    }
    // an empty value would be found in every companion
    const pdfs = files.flatMap((f) => {
      const v = values[f.path];
      return extOf(f.path) === PDF && v?.ok && v.value.trim() ? [{ path: f.path, value: v.value }] : [];
    });
    session.pairs = pairCompanions(pdfs, sheets);
    session.dirty = false;
  } finally {
    clearTimeout(timer);
    // a stale read leaves the island to whoever owns it now (a newer read, or a batch after a Cancel)
    if (!stale()) {
      stopReading();
      session.loading = false;
    }
  }
}

export async function addPaths(paths: string[]) {
  if (!paths.length) return;
  session.files = mergeFiles(session.files, await ipc.listFiles(paths, data.settings.rename.recursive));
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
  session.rules.destination = { mode: 'copy', folder };
  data.settings.rename.folder = folder;
  save('settings');
}

function forget(paths: string[]) {
  const gone = new Set(paths);
  session.files = session.files.filter((f) => !gone.has(f.path));
  session.skipped = session.skipped.filter((p) => !gone.has(p));
  session.fixed = session.fixed.filter((p) => !gone.has(p));
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
  const copy = session.rules.destination.mode === 'copy';
  const last = pick && data.history.find((h) => h.id === session.batch);
  // fixes join the last batch, unless it was undone (its journal is spent)
  const id = last && !last.undone ? last.id : crypto.randomUUID();
  // the island is busy before the first await, so Undo can't start meanwhile
  session.busy = true;
  send({ type: 'start', label: copy ? 'Copying' : 'Renaming', total: run.length, cancellable: true });
  const meta = { id, tool: 'rename' as const, verb: copy ? 'copied' : 'renamed', profile: profileName() };
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
    log({ level: 'warn', tool: 'rename', file: w.source, message: `${copy ? 'Copied' : 'Renamed'}, but Undo can't reverse this file.`, detail: w.message });
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
  send({ type: 'finish', text: b.summary, attention: plan.items.filter((i) => i.status === 'attention').length });
}

export const applyFixes = () => runBatch([...session.fixed]);

export function useProfile(p: RenameProfile) {
  session.rules = rulesFromProfile(p);
  session.profileId = p.id;
}

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
if (import.meta.env.DEV) Object.assign(window, { __rename: { session, plan, addPaths, runBatch, undoLast } });
