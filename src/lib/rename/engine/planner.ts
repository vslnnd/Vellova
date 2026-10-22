import { expandFolder, extOf, join, sanitize, splitExt, splitPath } from '../../shared/names';
import type { OpResult } from '../../shared/ipc';
import type { BatchItem, Conflict, Destination, Op, PlanItem, Reason, Status } from '../../shared/types';
import { PDF, pathKey } from './files';
import type { Named } from './steps';

export type PlanInput = {
  /** paths in list order; the order decides who gets " (1)" */
  files: string[];
  /** PDF → its new name or why there is none (missing = still reading) */
  names: Record<string, Named>;
  /** companions that could not be read */
  failures: Record<string, { reason: Reason; detail: string }>;
  /** companion → PDF; null while files are still being read */
  pairs: Record<string, string> | null;
  pairEnabled: boolean;
  destination: Destination;
  conflict: Conflict;
  /** pathKey of every entry in the target folders */
  existing: Set<string>;
  /** path → name typed in the preview, without extension */
  overrides: Record<string, string>;
  skipped: Set<string>;
  /** PDF → its {n} and {date}, used for a PDF without a name (failed or still reading) */
  slots?: Record<string, { n: string; date: string }>;
};

const item = (source: string, status: Status, extra: Partial<PlanItem> = {}): PlanItem => ({ id: source, source, op: null, status, ...extra });

/** The preview: one item per file, in list order. */
export function planRename(input: PlanInput): PlanItem[] {
  // A name is free when its file moves away in this batch. Assume every file moves, then plan again with the
  // files that really do until nothing changes. A pass can only drop files, so this ends.
  let leaving = new Set(input.destination.mode === 'copy' ? [] : input.files.map(pathKey));
  for (;;) {
    const items = planOnce(input, leaving);
    const next = new Set(items.filter((i) => i.op?.kind === 'rename').map((i) => pathKey(i.source)));
    if (next.size === leaving.size && [...next].every((k) => leaving.has(k))) return items;
    leaving = next;
  }
}

function planOnce(input: PlanInput, leaving: Set<string>): PlanItem[] {
  const { destination: dest, conflict, existing } = input;
  const used = new Set<string>();
  const sources = new Set(input.files.map(pathKey));

  /** Gives `source` the first free name of `base`, `base (1)`, `base (2)`… in `dir`. */
  const place = (source: string, base: string, status: Status, dir: string): PlanItem => {
    const ext = extOf(source);
    if (!base) return item(source, 'attention', { reason: 'no-value', detail: 'The new name would be empty.' });
    if (dest.mode !== 'inplace' && !dest.folder) return item(source, 'pending', { name: base + ext, detail: `Choose a folder to ${dest.mode} into.` });
    let dup = false;
    for (let k = 0; ; k++) {
      const name = `${k ? `${base} (${k})` : base}${ext}`;
      const to = join(dir, name);
      const key = pathKey(to);
      if (used.has(key)) {
        dup = true;
        continue;
      }
      const self = key === pathKey(source);
      const taken = !self && existing.has(key) && !leaving.has(key);
      // Copy mode runs in list order: a listed source may still be read later, so it is numbered, never replaced.
      if (taken && (conflict === 'add' || (conflict === 'replace' && dest.mode === 'copy' && sources.has(key)))) continue;
      if (taken && conflict === 'skip') return item(source, 'skipped', { name, detail: `${name} already exists.` });
      used.add(key);
      if (self && (dest.mode === 'copy' || splitPath(source).name === name)) return item(source, 'unchanged', { name });
      const op: Op = { kind: dest.mode === 'copy' ? 'copy' : 'rename', from: source, to, ...(taken ? { replace: true } : {}) };
      return item(source, dup ? 'duplicate' : status, { name, op });
    }
  };

  /** Where a PDF or a typed name goes. Without a value (nothing to follow) the folder is expanded as if the value were empty. */
  const folderOf = (file: string, named?: Named) =>
    dest.mode === 'inplace' ? splitPath(file).dir : expandFolder(dest.folder, named?.ok ? named : { value: null, n: '1', date: '', ...input.slots?.[file] });

  const out = new Map<string, PlanItem>();
  // PDFs and typed names claim names first; companions then take their PDF's final name.
  for (const f of input.files) {
    if (input.skipped.has(f)) out.set(f, item(f, 'skipped'));
    else if (extOf(f) === PDF) {
      const v = input.names[f];
      if (f in input.overrides) out.set(f, place(f, sanitize(input.overrides[f]), 'ready', folderOf(f, v)));
      else if (!v) out.set(f, item(f, 'pending', { detail: 'Waiting for its value…' }));
      else if (!v.ok) out.set(f, item(f, 'attention', { reason: v.reason, detail: v.detail }));
      else out.set(f, place(f, sanitize(v.base), 'ready', folderOf(f, v)));
    }
  }
  for (const f of input.files) {
    if (out.has(f)) continue;
    const v = input.failures[f];
    const pdf = input.pairs?.[f];
    const p = pdf ? out.get(pdf) : undefined;
    // A PDF that is skipped (or waiting for a folder) gives no final name to follow.
    const pdfName = p && (p.op || p.status === 'unchanged') ? p.name : undefined;
    // A typed name needs no PDF to match. In place it stays where the companion is; in a folder it goes beside its PDF.
    const typed = f in input.overrides ? sanitize(input.overrides[f]) : null;
    if (typed !== null && (!p || dest.mode === 'inplace')) out.set(f, place(f, typed, 'ready', folderOf(f)));
    else if (typed === null && !input.pairEnabled) out.set(f, item(f, 'unchanged', { detail: 'Pairing with PDFs is off.' }));
    else if (typed === null && v) out.set(f, item(f, 'attention', { reason: v.reason, detail: v.detail }));
    else if (typed === null && !input.pairs) out.set(f, item(f, 'pending', { detail: 'Waiting for the PDFs…' }));
    else if (typed === null && !pdf) out.set(f, item(f, 'attention', { reason: 'no-match', detail: 'None of the PDF values appears in this file.' }));
    else if (p?.status === 'pending') out.set(f, item(f, 'pending', { detail: p.detail }));
    else if (!pdfName) out.set(f, item(f, 'skipped', { detail: 'Its PDF is not being renamed.' }));
    // beside its PDF's final place; in place, where the companion itself is
    else out.set(f, place(f, typed ?? splitExt(pdfName).base, typed === null ? 'paired' : 'ready', splitPath(dest.mode === 'inplace' ? f : (p!.op?.to ?? p!.source)).dir));
  }
  return input.files.map((f) => out.get(f)!);
}

export function summary(items: PlanItem[], destination: Destination) {
  const ops = items.filter((i) => i.op).length;
  const verb = { inplace: 'Rename', copy: 'Copy', move: 'Move' }[destination.mode];
  return {
    ops,
    attention: items.filter((i) => i.status === 'attention').length,
    pending: items.filter((i) => i.status === 'pending').length,
    label: `${verb} ${ops} ${ops === 1 ? 'file' : 'files'}`,
  };
}

/** ops.rs: the file reached its new name, but its journal line could not be written, so Undo can't reverse it. */
export const movedUnjournaled = (r?: OpResult) => !!r && !r.ok && r.code === 'internal' && /can't be undone/.test(r.message ?? '');

/**
 * Matches apply results to the items that ran. Cancelled items are neither done nor failed, so they stay listed.
 * A file that moved without a journal line is done (ok, with reason `internal`) and listed in `warned`.
 */
export function readResults(items: PlanItem[], results: OpResult[]) {
  const byIndex = new Map(results.map((r) => [r.i, r]));
  const batch: BatchItem[] = [];
  const failed: { source: string; reason: Reason; message: string }[] = [];
  const warned: { source: string; message: string }[] = [];
  items.forEach((it, i) => {
    const r = byIndex.get(i);
    if (r?.code === 'cancelled') return;
    const to = it.op!.to;
    if (r?.ok) {
      batch.push({ from: it.source, to, ok: true });
      return;
    }
    if (movedUnjournaled(r)) {
      batch.push({ from: it.source, to, ok: true, reason: 'internal' });
      warned.push({ source: it.source, message: r!.message! });
      return;
    }
    const reason = (r?.code ?? 'internal') as Reason;
    batch.push({ from: it.source, to, ok: false, reason });
    failed.push({ source: it.source, reason, message: r?.message ?? 'No result came back for this file.' });
  });
  return { batch, failed, warned, done: batch.filter((b) => b.ok).map((b) => b.from) };
}
