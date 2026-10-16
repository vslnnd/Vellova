import { extOf, join, sanitize, splitExt, splitPath } from '../../shared/names';
import type { Conflict, Destination, Op, PlanItem, Reason, Status } from '../../shared/types';
import { PDF, pathKey } from './files';

export type ValueResult = { ok: true; value: string } | { ok: false; reason: Reason; detail: string };

export type PlanInput = {
  /** paths in list order; the order decides who gets " (1)" */
  files: string[];
  /** PDF → value or why there is none (missing = still reading); unreadable companions too */
  values: Record<string, ValueResult>;
  /** companion → PDF; null while files are still being read */
  pairs: Record<string, string> | null;
  pairEnabled: boolean;
  prefix: string;
  suffix: string;
  destination: Destination;
  conflict: Conflict;
  /** pathKey of every entry in the target folders */
  existing: Set<string>;
  /** path → name typed in the preview, without extension */
  overrides: Record<string, string>;
  skipped: Set<string>;
};

const item = (source: string, status: Status, extra: Partial<PlanItem> = {}): PlanItem => ({ id: source, source, op: null, status, ...extra });

/** The preview: one item per file, in list order. */
export function planRename(input: PlanInput): PlanItem[] {
  // A name is free when its file moves away in this batch. Assume every file moves, then plan again with the
  // files that really do until nothing changes. A pass can only drop files, so this ends.
  let leaving = new Set(input.destination.mode === 'inplace' ? input.files.map(pathKey) : []);
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

  /** Gives `source` the first free name of `base`, `base (1)`, `base (2)`… in its target folder. */
  const place = (source: string, base: string, status: Status): PlanItem => {
    const ext = extOf(source);
    if (!base) return item(source, 'attention', { reason: 'no-value', detail: 'The new name would be empty.' });
    if (dest.mode === 'copy' && !dest.folder) return item(source, 'pending', { name: base + ext, detail: 'Choose a folder to copy into.' });
    const dir = dest.mode === 'copy' ? dest.folder : splitPath(source).dir;
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

  const out = new Map<string, PlanItem>();
  // PDFs and typed names claim names first; companions then take their PDF's final name.
  for (const f of input.files) {
    if (input.skipped.has(f)) out.set(f, item(f, 'skipped'));
    else if (f in input.overrides) out.set(f, place(f, sanitize(input.overrides[f]), 'ready'));
    else if (extOf(f) === PDF) {
      const v = input.values[f];
      if (!v) out.set(f, item(f, 'pending', { detail: 'Waiting for its value…' }));
      else if (!v.ok) out.set(f, item(f, 'attention', { reason: v.reason, detail: v.detail }));
      else out.set(f, place(f, sanitize(input.prefix + v.value + input.suffix), 'ready'));
    }
  }
  for (const f of input.files) {
    if (out.has(f)) continue;
    const v = input.values[f];
    const pdf = input.pairs?.[f];
    const p = pdf ? out.get(pdf) : undefined;
    // A PDF that is skipped (or waiting for a folder) gives no final name to follow.
    const pdfName = p && (p.op || p.status === 'unchanged') ? p.name : undefined;
    if (!input.pairEnabled) out.set(f, item(f, 'unchanged', { detail: 'Pairing with PDFs is off.' }));
    else if (v && !v.ok) out.set(f, item(f, 'attention', { reason: v.reason, detail: v.detail }));
    else if (!input.pairs) out.set(f, item(f, 'pending', { detail: 'Waiting for the PDFs…' }));
    else if (!pdf) out.set(f, item(f, 'attention', { reason: 'no-match', detail: 'None of the PDF values appears in this file.' }));
    else if (!pdfName) out.set(f, item(f, 'skipped', { detail: 'Its PDF is not being renamed.' }));
    else out.set(f, place(f, splitExt(pdfName).base, 'paired'));
  }
  return input.files.map((f) => out.get(f)!);
}

export function summary(items: PlanItem[], destination: Destination) {
  const ops = items.filter((i) => i.op).length;
  const verb = destination.mode === 'copy' ? 'Copy' : 'Rename';
  return {
    ops,
    attention: items.filter((i) => i.status === 'attention').length,
    pending: items.filter((i) => i.status === 'pending').length,
    label: `${verb} ${ops} ${ops === 1 ? 'file' : 'files'}`,
  };
}
