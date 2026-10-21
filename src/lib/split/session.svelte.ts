import { open } from '@tauri-apps/plugin-dialog';
import { recordBatch, undoRunning } from '../shared/batches';
import { ipc, ipcReason, type OpResult } from '../shared/ipc';
import { extOf, splitPath } from '../shared/names';
import { REASONS } from '../shared/reasons';
import { data, flush, log, save } from '../shared/state.svelte';
import { putBackBatch } from '../shared/store';
import type { Batch, BatchItem, FileInfo, Op, Reason, SplitProfile, SplitRules } from '../shared/types';
import { island, send } from '../shell/islandState.svelte';
import { mergeFiles, pathKey } from '../rename/engine/files';
import { movedUnjournaled } from '../rename/engine/planner';
import { planArchive, planSplit, type FileRead, type SplitItem } from './engine/planner';
import { DEFAULT_SPLIT_RULES, splitRules } from './engine/profile';
import { readGrid, writeFile } from './sheets';

const SHEETS = ['.xlsx', '.xls', '.csv'];
const ARCHIVE = 'archive:';

export const session = $state({
  files: [] as FileInfo[],
  rules: structuredClone(DEFAULT_SPLIT_RULES) as SplitRules,
  profileId: null as string | null,
  reads: {} as Record<string, FileRead>,
  /** per file: the column to split by when its header differs (Needs attention) */
  columnFor: {} as Record<string, string>,
  /** item ids: a file's id is its path, an output's `<path>|<n>`, a failed archive's `archive:<path>` */
  skipped: [] as string[],
  /** by item id: outputs that failed to be written, archives that failed to move */
  failures: {} as Record<string, { reason: Reason; detail: string }>,
  /** item ids fixed in Needs attention, for Apply fixes */
  fixed: [] as string[],
  /**
   * Outputs already written in `batch`: they leave the preview while their source stays (a sibling failed).
   * They count only while that batch is not undone and the plan is still the one they were written under (`doneKey`).
   */
  done: [] as string[],
  doneKey: '',
  existing: [] as string[],
  loading: false,
  dirty: false,
  busy: false,
  batch: null as string | null,
});

/** The plan with run failures and skipped outputs applied, done outputs still in (to judge what is finished). */
const all = $derived.by(() => {
  const skipped = new Set(session.skipped);
  const planned = planSplit({
    files: session.files.map((f) => f.path),
    reads: session.reads,
    rules: session.rules,
    columnFor: session.columnFor,
    skipped,
    existing: new Set(session.existing),
    date: new Date(),
  });
  return planned.map((it): SplitItem => {
    if (it.id !== it.source && skipped.has(it.id)) return { ...it, op: null, status: 'skipped' };
    const f = session.failures[it.id];
    return f && it.op ? { ...it, status: 'attention', reason: f.reason, detail: f.detail } : it;
  });
});

/** The last batch is in History and not undone: what it wrote, and its failed archives, still stand. */
const batchLive = () => {
  const b = data.history.find((h) => h.id === session.batch);
  return !!b && !b.undone;
};
/** What decides an output's id and content: a change re-plans, so earlier `done` ids no longer describe these outputs. */
const planKey = (batch: string | null) => JSON.stringify([batch, session.rules, session.columnFor]);
const liveDone = $derived(batchLive() && session.doneKey === planKey(session.batch) ? new Set(session.done) : new Set<string>());

const items = $derived.by(() => {
  const done = liveDone;
  const live = batchLive();
  const archives = Object.entries(session.failures).flatMap(([id, f]): SplitItem[] =>
    live && id.startsWith(ARCHIVE) ? [{ id, source: id.slice(ARCHIVE.length), op: null, status: 'attention', reason: f.reason, detail: f.detail, rows: 0 }] : [],
  );
  return [...all.filter((i) => !done.has(i.id)), ...archives];
});

/** The live preview (a getter: derived state can't be exported directly). */
export const plan = {
  get items() {
    return items;
  },
};

const cache = new Map<string, FileRead>();

/** Forgets what was read from `path`, so the next refresh reads it again (Retry). */
function evict(path: string) {
  for (const k of cache.keys()) if (k.startsWith(`${path}|`)) cache.delete(k);
}

const keyOf = (f: FileInfo) => `${f.path}|${f.size}|${f.mtime}`;

/** Reads one sheet of a file once per path, size, modified time and sheet. Read errors and internal ones are not remembered. */
async function readCached(f: FileInfo, sheet: string | null): Promise<FileRead> {
  const key = keyOf(f);
  const hit = cache.get(`${key}|${sheet ?? ''}`);
  if (hit) return hit;
  let bytes: Uint8Array;
  try {
    bytes = await ipc.readFile(f.path);
  } catch (e) {
    return { ok: false, ...ipcReason(e) };
  }
  let read: FileRead;
  try {
    read = { ok: true, grid: await readGrid(key, extOf(f.path), bytes, sheet) };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if ((e as { internal?: boolean })?.internal) {
      log({ level: 'error', tool: 'split', file: f.path, message: 'The spreadsheet reader stopped on this file and was restarted.', detail: msg });
      return { ok: false, reason: 'internal', detail: msg };
    }
    const missing = /^Sheet not found: (.*)$/.exec(msg);
    read = missing
      ? { ok: false, reason: 'no-column', detail: `This file has no sheet "${missing[1]}".` }
      : { ok: false, reason: 'unreadable', detail: `This file can't be read (${msg}).` };
    if (!missing) log({ level: 'warn', tool: 'split', file: f.path, message: "This file couldn't be read.", detail: msg });
  }
  cache.set(`${key}|${sheet ?? ''}`, read);
  return read;
}

let generation = 0;
/** The island shows our "Reading" layer. Only the current read may update or stop it. */
let reading = false;

function stopReading() {
  if (!reading) return;
  reading = false;
  send({ type: 'stop' });
}

/** The inputs changed: what is being read is stale, and Split waits for the next refresh to finish. */
export function invalidate() {
  generation++;
  session.dirty = true;
  session.loading = true;
}

const listed = (dirs: string[]) => (dirs.length ? ipc.listDir(dirs).catch(() => [] as string[]) : Promise.resolve([] as string[]));

/** Reads every file's grid and lists the folders the plan writes to. A newer call makes an older one stop. */
export async function refresh() {
  const gen = ++generation;
  const stale = () => gen !== generation;
  const files = $state.snapshot(session.files);
  const rules = $state.snapshot(session.rules) as SplitRules;
  session.loading = true;
  const timer = setTimeout(() => {
    if (stale() || (!reading && island.activity)) return;
    reading = true;
    send({ type: 'start', label: 'Reading', total: files.length, cancellable: true });
  }, 300);
  try {
    const reads: Record<string, FileRead> = {};
    session.reads = {};
    let n = 0;
    for (const f of files) {
      reads[f.path] = await readCached(f, rules.sheet);
      if (stale()) return;
      session.reads = { ...reads };
      n++;
      if (reading) send({ type: 'progress', done: n, total: files.length });
    }
    const dirs = rules.folder.mode === 'folder' ? [rules.folder.path] : [...new Set(files.map((f) => splitPath(f.path).dir))];
    const keys = new Set([...(await listed(dirs)), ...files.map((f) => f.path)].map(pathKey));
    if (stale()) return;
    if (rules.subfolder) {
      // the subfolders the plan would write to; one that doesn't exist yet lists as empty
      const base = new Set(dirs.map(pathKey));
      const outs = planSplit({ files: files.map((f) => f.path), reads, rules, columnFor: $state.snapshot(session.columnFor), skipped: new Set(), existing: keys, date: new Date() });
      const subs = [...new Set(outs.flatMap((i) => (i.op ? [splitPath(i.op.to).dir] : [])))].filter((d) => !base.has(pathKey(d)));
      for (const p of await listed(subs)) keys.add(pathKey(p));
      if (stale()) return;
    }
    session.existing = [...keys];
    session.dirty = false;
  } catch (e) {
    if (!stale()) log({ level: 'error', tool: 'split', message: 'Reading the files stopped.', detail: String(e) });
  } finally {
    clearTimeout(timer);
    if (!stale()) {
      stopReading();
      session.loading = false;
    }
  }
}

export async function addPaths(paths: string[]) {
  if (!paths.length) return;
  const found = await ipc.listFiles(paths, false);
  // `~$` files are Excel's lock files next to an open workbook
  session.files = mergeFiles(session.files, found.filter((f) => !splitPath(f.path).name.startsWith('~$')), SHEETS);
}

export async function pickFiles() {
  const picked = await open({ multiple: true, filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls', 'csv'] }] });
  if (picked) await addPaths(picked);
}

export async function pickFolder() {
  const picked = await open({ directory: true, multiple: true });
  if (picked) await addPaths(picked);
}

export async function pickOutputFolder() {
  const folder = await open({ directory: true, defaultPath: data.settings.split.folder || undefined });
  if (!folder) return;
  session.rules.folder = { mode: 'folder', path: folder };
  data.settings.split.folder = folder;
  save('settings');
}

/** The source an item id belongs to. */
const sourceOf = (id: string) => (id.startsWith(ARCHIVE) ? id.slice(ARCHIVE.length) : id.replace(/\|\d+$/, ''));

function forget(paths: string[]) {
  const gone = new Set(paths);
  const keep = (id: string) => !gone.has(sourceOf(id));
  session.files = session.files.filter((f) => !gone.has(f.path));
  session.skipped = session.skipped.filter(keep);
  session.fixed = session.fixed.filter(keep);
  session.done = session.done.filter(keep);
  for (const id of Object.keys(session.failures)) if (!keep(id)) delete session.failures[id];
  for (const p of paths) {
    delete session.columnFor[p];
    delete session.reads[p];
  }
}

export const removeFile = (path: string) => forget([path]);

export function clearFiles() {
  forget(session.files.map((f) => f.path));
  session.batch = null;
}

const markFixed = (id: string) => {
  if (!session.fixed.includes(id)) session.fixed.push(id);
};

/** A source leaves the list once nothing of it is left to do. */
function settle(sources: Iterable<string>) {
  const open = new Set(items.filter((i) => i.status !== 'skipped').map((i) => i.source));
  forget([...new Set(sources)].filter((s) => !open.has(s)));
}

/** Skips an item, or includes it again. Skipping a failed archive leaves its source where it is. */
export function skip(id: string) {
  if (id.startsWith(ARCHIVE)) {
    delete session.failures[id];
    return settle([sourceOf(id)]);
  }
  session.skipped = session.skipped.includes(id) ? session.skipped.filter((p) => p !== id) : [...session.skipped, id];
  delete session.failures[id];
}

/** Tries a failed item again: a failed archive runs again at once; anything else is read afresh and re-planned. */
export async function retry(id: string) {
  const path = sourceOf(id);
  const failed = session.failures[id];
  delete session.failures[id];
  const [fresh] = await ipc.listFiles([path], false);
  if (!fresh) {
    session.failures[id] = { reason: 'missing', detail: REASONS.missing.hint };
    return;
  }
  if (id.startsWith(ARCHIVE)) {
    // its batch was undone: the outputs are gone, so the source must not be archived
    if (!batchLive()) return;
    // nothing to re-plan: put the failure back until the run says otherwise
    if (failed) session.failures[id] = failed;
    return runBatch([id]);
  }
  evict(path);
  session.files = session.files.map((f) => (f.path === path ? fresh : f));
  markFixed(id);
}

/** The column to split this file by, chosen in Needs attention. */
export function setColumn(path: string, name: string) {
  session.columnFor[path] = name;
  markFixed(path);
}

let cancelled = false;

/** The island's Cancel: stops a running batch before its next output, or stops reading. */
export function cancelActivity() {
  if (session.busy) {
    cancelled = true;
    return void ipc.cancelApply();
  }
  invalidate();
  session.loading = false;
  reading = false;
  send({ type: 'stop' });
}

const profile = () => data.profiles.split.find((p) => p.id === session.profileId);

/** The profile's archive folder when Settings › archive is on. */
export const archiveFolder = (): string | null => (data.settings.split.archive && profile()?.archiveFolder) || null;

type Outcome = { item: BatchItem; failed?: { reason: Reason; message: string }; warn?: string };

/** One op's result: cancelled → null (the item stays listed); a move without a journal line counts as done. */
function outcome(from: string, to: string, r: OpResult | undefined, archived = false): Outcome | null {
  if (r?.code === 'cancelled') return null;
  const extra = archived ? { archived: true as const } : {};
  if (r?.ok) return { item: { from, to, ok: true, ...extra } };
  if (movedUnjournaled(r)) return { item: { from, to, ok: true, reason: 'internal', ...extra }, warn: r!.message };
  const reason = (r?.code ?? 'internal') as Reason;
  return { item: { from, to, ok: false, reason, ...extra }, failed: { reason, message: r?.message ?? 'No result came back for this file.' } };
}

const stageReason = (e: unknown) => {
  const r = ipcReason(e);
  return r.reason === 'unreadable' ? { reason: 'internal' as const, detail: r.detail } : r;
};

/**
 * Writes the preview's outputs (or only `only`, inside the last batch): each source is read and split in the worker,
 * every output is staged, then copied into place; after that qualifying sources move to the archive folder.
 */
export async function runBatch(only?: string[]) {
  if (session.busy || session.loading || session.dirty || island.activity) return;
  const pick = only && new Set(only);
  const outputs = all.filter((i) => i.op && !liveDone.has(i.id) && (pick ? pick.has(i.id) || pick.has(i.source) : i.status !== 'attention'));
  const archiveOnly = pick && batchLive() ? [...pick].filter((id) => id.startsWith(ARCHIVE) && session.failures[id]).map(sourceOf) : [];
  if (!outputs.length && !archiveOnly.length) return;
  const last = pick && data.history.find((h) => h.id === session.batch);
  const id = last && !last.undone ? last.id : crypto.randomUUID();
  session.busy = true;
  cancelled = false;
  // `done` and failed archives belong to one batch; a new batch starts without them
  if (id !== session.batch) {
    const old = Object.keys(session.failures).filter((k) => k.startsWith(ARCHIVE));
    for (const k of old) delete session.failures[k];
    settle(old.map(sourceOf));
  }
  if (id !== session.batch || session.doneKey !== planKey(id)) session.done = [];
  session.doneKey = planKey(id);
  send({ type: 'start', label: outputs.length ? 'Splitting' : 'Archiving', total: outputs.length || archiveOnly.length, cancellable: true });
  const meta = { id, tool: 'split' as const, verb: 'created', profile: profile()?.name };
  const prev = id === last?.id ? $state.snapshot(last) : undefined;
  const rerun = { files: session.files.map((f) => f.path), rules: $state.snapshot(session.rules) as SplitRules, profileId: session.profileId };
  recordBatch({ ...meta, time: Date.now(), items: outputs.map((i) => ({ from: i.source, to: i.op!.to, ok: false, pending: true })), undoable: true, rerun });

  const batch: BatchItem[] = [];
  const fail = (itemId: string, source: string, reason: Reason, detail: string, message = detail) => {
    session.failures[itemId] = { reason, detail };
    log({ level: 'error', tool: 'split', file: source, message: REASONS[reason].title, detail: message });
  };
  const warn = (source: string, message: string) => log({ level: 'warn', tool: 'split', file: source, message: "Done, but Undo can't reverse this file.", detail: message });
  const ran = new Set<string>();
  const doneNow: string[] = [];
  const sources = [...new Set(outputs.map((o) => o.source))];
  let stagedAny = false;
  try {
    await flush();
    try {
      // 1. stage: one worker call per source, one staged file per output
      const staged: { item: SplitItem; op: Op }[] = [];
      let progress = 0;
      for (const source of sources) {
        if (cancelled) break;
        const outs = outputs.filter((o) => o.source === source);
        const f = session.files.find((x) => x.path === source)!;
        const read = session.reads[source];
        let parts: Uint8Array[];
        try {
          const bytes = await ipc.readFile(source).catch((e) => Promise.reject(ipcReason(e)));
          const grid = read?.ok ? read.grid : undefined;
          const header = session.rules.header.mode === 'manual' ? session.rules.header.row - 1 : 0;
          parts = await writeFile(keyOf(f), extOf(source), bytes, {
            sheet: session.rules.sheet, header, format: outs[0].format ?? 'xlsx', delimiter: grid?.delimiter ?? ',', outputs: outs.map((o) => o.spec!),
          }).catch((e) => Promise.reject({ reason: (e as { internal?: boolean })?.internal ? 'internal' : 'unreadable', detail: String((e as Error)?.message ?? e) }));
        } catch (e) {
          const r = e as { reason: Reason; detail: string };
          for (const o of outs) {
            fail(o.id, source, r.reason, REASONS[r.reason].hint, r.detail);
            ran.add(o.id);
          }
          progress += outs.length;
          send({ type: 'progress', done: progress, total: outputs.length });
          continue;
        }
        for (const [k, o] of outs.entries()) {
          if (cancelled) break;
          if (!parts[k]) throw new Error(`The spreadsheet writer returned ${parts.length} files for ${outs.length} outputs.`);
          stagedAny = true;
          try {
            const path = await ipc.stageWrite(id, outputs.indexOf(o), parts[k]);
            staged.push({ item: o, op: { ...o.op!, from: path } });
          } catch (e) {
            const r = stageReason(e);
            fail(o.id, source, r.reason, REASONS[r.reason].hint, r.detail);
            ran.add(o.id);
          }
          send({ type: 'progress', done: ++progress, total: outputs.length });
        }
      }
      // 2. copy the staged outputs into place
      if (staged.length) {
        const results = await ipc.applyPlan(id, staged.map((s) => s.op));
        const byIndex = new Map(results.map((r) => [r.i, r]));
        staged.forEach(({ item, op }, i) => {
          const o = outcome(item.source, op.to, byIndex.get(i));
          if (!o) return;
          ran.add(item.id);
          batch.push(o.item);
          if (o.warn) warn(item.source, o.warn);
          if (o.failed) fail(item.id, item.source, o.failed.reason, REASONS[o.failed.reason].hint, o.failed.message);
          else doneNow.push(item.id);
        });
        session.done = [...session.done, ...doneNow];
        session.existing = [...session.existing, ...staged.map((s) => pathKey(s.op.to))];
      }
    } finally {
      if (stagedAny) await ipc.stageClear(id).catch((e) => log({ level: 'warn', tool: 'split', message: 'Staged files could not be removed.', detail: String(e) }));
    }
    // 3. archive: sources whose outputs were all written (at least one), and archives being retried
    const folder = archiveFolder();
    const done = new Set(session.done);
    const finished = (s: string) => {
      const its = all.filter((i) => i.source === s);
      // an output skipped (by the conflict rule or by hand) was chosen not to be written: it doesn't hold the archive back
      return its.some((i) => done.has(i.id)) && its.every((i) => done.has(i.id) || i.status === 'skipped');
    };
    // after a Cancel too: sources written in full before it are archived (Cancel stops only what had not started)
    const toArchive = folder ? [...new Set([...sources.filter((s) => doneNow.some((d) => sourceOf(d) === s) && finished(s)), ...archiveOnly])] : [];
    if (folder && toArchive.length) {
      send({ type: 'start', label: 'Archiving', total: toArchive.length, cancellable: false });
      for (const s of toArchive) delete session.failures[ARCHIVE + s];
      const [exists] = await ipc.foldersExist([folder]).catch(() => [false]);
      if (!exists) {
        for (const s of toArchive) {
          fail(ARCHIVE + s, s, 'missing', 'The archive folder no longer exists.');
          batch.push({ from: s, to: folder, ok: false, reason: 'missing', archived: true });
        }
      } else {
        const moves = planArchive(toArchive, folder, new Set((await listed([folder])).map(pathKey)), new Date());
        let results: OpResult[] = [];
        try {
          results = await ipc.applyPlan(id, moves.map((m) => ({ kind: 'rename', from: m.source, to: m.to })));
        } catch (e) {
          log({ level: 'error', tool: 'split', message: 'The archive step could not run.', detail: String(e) });
        }
        const byIndex = new Map(results.map((r) => [r.i, r]));
        moves.forEach((m, i) => {
          const o = outcome(m.source, m.to, byIndex.get(i), true);
          if (!o) return void (session.failures[ARCHIVE + m.source] ??= { reason: 'internal', detail: REASONS.internal.hint });
          batch.push(o.item);
          if (o.warn) warn(m.source, o.warn);
          if (o.failed) fail(ARCHIVE + m.source, m.source, o.failed.reason, REASONS[o.failed.reason].hint, o.failed.message);
        });
      }
    }
  } catch (e) {
    // the copy step failed before its first op (another batch running, journal not writable, a writer fault): nothing moved
    data.history = putBackBatch(data.history, id, prev);
    save('history');
    log({ level: 'error', tool: 'split', message: 'The batch could not run.', detail: String(e) });
    send({ type: 'stop' });
    send({ type: 'restored', text: "Couldn't start · see History › Log" });
    return;
  } finally {
    session.busy = false;
  }
  const ranSources = new Set([...ran].map(sourceOf));
  session.fixed = session.fixed.filter((f) => !ran.has(f) && !(f === sourceOf(f) && ranSources.has(f)) && !(f.startsWith(ARCHIVE) && archiveOnly.includes(sourceOf(f))));
  data.history = putBackBatch(data.history, id, prev);
  if (!batch.length) {
    settle([...ranSources, ...archiveOnly]);
    save('history');
    return void send({ type: 'stop' });
  }
  session.batch = id;
  const b = recordBatch({ ...meta, time: Date.now(), items: batch, undoable: batch.some((x) => x.ok), rerun });
  // after the batch is current and recorded, so its `done` outputs count
  settle([...ranSources, ...archiveOnly]);
  log({ level: 'info', tool: 'split', message: b.summary });
  send({ type: 'finish', text: b.summary, attention: plan.items.filter((i) => i.status === 'attention').length });
}

export const applyFixes = () => runBatch([...session.fixed]);

/** Waits until no batch or undo is moving files, up to `capMs`. */
export async function whenIdle(capMs = 30_000) {
  const end = Date.now() + capMs;
  while ((session.busy || undoRunning()) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
}

export function useProfile(p: SplitProfile) {
  session.rules = splitRules($state.snapshot(p.rules));
  session.profileId = p.id;
}

/** Saves the rules into the current profile, or as a new profile when `name` is given. */
export function saveProfile(name?: string) {
  const list = data.profiles.split;
  const rules = $state.snapshot(session.rules) as SplitRules;
  const current = list.find((p) => p.id === session.profileId);
  if (current && !name) current.rules = rules;
  else {
    const p: SplitProfile = { id: crypto.randomUUID(), name: name ?? 'New profile', desc: '', rules, archiveFolder: null };
    list.push(p);
    session.profileId = p.id;
  }
  save('profiles');
}

/** Loads a past batch's rules and the files of it that still exist. */
export async function rerun(b: Batch) {
  if (!b.rerun) return;
  const rules = splitRules(b.rerun.rules);
  const paths = (Array.isArray(b.rerun.files) ? (b.rerun.files as unknown[]) : []).filter((f): f is string => typeof f === 'string');
  const found = paths.length ? await ipc.listFiles(paths, false) : [];
  const have = new Set(found.map((f) => pathKey(f.path)));
  for (const p of paths) if (!have.has(pathKey(p))) log({ level: 'warn', tool: 'split', file: p, message: 'Not loaded for the re-run: the file is no longer there.' });
  if (rules.folder.mode === 'folder') {
    const [exists] = await ipc.foldersExist([rules.folder.path]).catch(() => [false]);
    if (!exists) {
      log({ level: 'warn', tool: 'split', message: `The output folder ${rules.folder.path} no longer exists; the re-run writes next to each file.` });
      rules.folder = { mode: 'source' };
    }
  }
  clearFiles();
  session.rules = rules;
  const pid = b.rerun.profileId;
  session.profileId = typeof pid === 'string' && data.profiles.split.some((p) => p.id === pid) ? pid : null;
  session.files = mergeFiles([], found, SHEETS);
}

// dev only: lets scripts/cdp.mjs drive the screen
if (import.meta.env.DEV) Object.assign(window, { __split: { session, plan, addPaths, runBatch, cancelActivity, refresh } });
