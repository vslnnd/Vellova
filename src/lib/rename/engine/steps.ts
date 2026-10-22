import type { Reason, Step } from '../../shared/types';
import type { Grid } from '../../split/engine/grid';
import { findValue } from './findValue';
import type { Item } from './pdfItems';

export type PdfText = { items: Item[]; title: string; created: string }; // created: yyyy-MM-dd or ''
export type ListRead = { ok: true; map: Map<string, string> } | { ok: false; detail: string }; // key: trim().toLowerCase()

/** Where StepCtx.lists keeps a list step's map: one per file and column pair. */
export const listKey = (s: Extract<Step, { type: 'list' }>) => `${s.path}|${s.match}|${s.name}`;
export type StepCtx = { base: string; pdf: PdfText | null; lists: Record<string, ListRead>; index: number; mtime: number; ctime: number; today: Date };
export type Named = { ok: true; base: string; value: string | null; n: string; date: string } | { ok: false; reason: Reason; detail: string };

type Of<T extends Step['type']> = Extract<Step, { type: T }>;
type Fail = Extract<Named, { ok: false }>;
type State = { name: string; value: string | null; n: string; date: string };

const fail = (reason: Reason, detail: string): Fail => ({ ok: false, reason, detail });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const two = (n: number) => String(n).padStart(2, '0');
const join = (name: string, piece: string, at: 'start' | 'end', sep: string) => (at === 'start' ? piece + sep + name : name + sep + piece);

export const PRESETS: Record<'invoice' | 'date', RegExp> = {
  invoice: /\b[A-Z]{1,6}[-/]?\d{3,}(?:[-/]\d+)*\b/g,
  date: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4})\b/g,
};

/** What "+ Add a step" starts from. */
export const NEW_STEP: Record<Step['type'], Step> = {
  pdfValue: { type: 'pdfValue', keyword: '', position: 'after', occurrence: 1 },
  pdfPattern: { type: 'pdfPattern', preset: 'invoice', regex: '', occurrence: 1 },
  list: { type: 'list', path: '', match: '', name: '', against: 'name' },
  addText: { type: 'addText', prefix: '', suffix: '' },
  replace: { type: 'replace', find: '', with: '', regex: false, matchCase: false, all: true },
  remove: { type: 'remove', what: 'range', from: 1, to: 1, start: '(', end: ')' },
  trim: { type: 'trim' },
  case: { type: 'case', to: 'upper' },
  number: { type: 'number', start: 1, step: 1, pad: 3, at: 'end', sep: '_' },
  date: { type: 'date', from: 'today', format: 'yyyy-MM-dd', at: 'start', sep: '_' },
};

/** Tokens yyyy yy MM dd HH mm, local time; anything else stays as typed. */
export function formatDate(d: Date, format: string): string {
  const t: Record<string, string> = {
    yyyy: String(d.getFullYear()), yy: two(d.getFullYear() % 100), MM: two(d.getMonth() + 1),
    dd: two(d.getDate()), HH: two(d.getHours()), mm: two(d.getMinutes()),
  };
  return format.replace(/yyyy|yy|MM|dd|HH|mm/g, (k) => t[k]);
}

/** A list's first row names the columns (trimmed, any case); each row maps its match cell to its name cell. */
export function listMap(grid: Grid, match: string, name: string): ListRead {
  const head = (grid.rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (h: string) => (h.trim() ? head.indexOf(h.trim().toLowerCase()) : -1);
  const [mi, ni] = [col(match), col(name)];
  if (mi < 0 || ni < 0) return { ok: false, detail: `The list has no column "${(mi < 0 ? match : name).trim()}".` };
  const map = new Map<string, string>();
  for (const r of grid.rows.slice(1)) {
    const key = (r[mi] ?? '').trim().toLowerCase();
    const to = (r[ni] ?? '').trim();
    if (key && to && !map.has(key)) map.set(key, to);
  }
  return { ok: true, map };
}

/** For the editor: why a custom pattern can't be used, or null. */
export function patternError(step: Step): string | null {
  if (step.type !== 'pdfPattern' || step.preset !== 'custom') return null;
  try {
    return new RegExp(step.regex).test('') ? 'The pattern matches empty text.' : null;
  } catch (e) {
    return errText(e);
  }
}

type Found = { ok: true; value: string } | Fail;

function pdfPattern(s: Of<'pdfPattern'>, pdf: PdfText): Found {
  if (s.preset === 'title' || s.preset === 'created') {
    const v = s.preset === 'title' ? pdf.title : pdf.created;
    return v ? { ok: true, value: v } : fail('no-pattern', `This PDF has no ${s.preset === 'title' ? 'title' : 'creation date'} in its document info.`);
  }
  let re: RegExp;
  try {
    re = s.preset === 'custom' ? new RegExp(s.regex, 'g') : PRESETS[s.preset];
  } catch (e) {
    return fail('no-pattern', errText(e));
  }
  // empty matches never count: a name must not come out blank
  const hits = [...pdf.items.map((i) => i.str).join(' ').matchAll(re)].map((m) => m[1] ?? m[0]).filter(Boolean);
  const value = hits[s.occurrence - 1];
  return value ? { ok: true, value } : fail('no-pattern', hits.length ? `The pattern matches only ${hits.length} time(s) in this PDF.` : 'The pattern was not found in this PDF.');
}

function remove(s: Of<'remove'>, name: string): string {
  if (s.what === 'digits') return name.replace(/\d+/g, '');
  if (s.what === 'range') {
    const a = Math.max(s.from, 1) - 1;
    return s.to > a ? name.slice(0, a) + name.slice(s.to) : name;
  }
  const i = s.start ? name.indexOf(s.start) : -1;
  const j = i < 0 || !s.end ? -1 : name.indexOf(s.end, i + s.start.length);
  return j < 0 ? name : name.slice(0, i) + name.slice(j + s.end.length);
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

function recase(to: Of<'case'>['to'], name: string): string {
  if (to === 'upper') return name.toUpperCase();
  if (to === 'lower') return name.toLowerCase();
  if (to === 'sentence') return cap(name.toLowerCase());
  return name.toLowerCase().replace(/[^ _-]+/g, cap);
}

/** Runs one step on `st`; returns the failure, if any. */
function apply(s: Step, st: State, ctx: StepCtx): Fail | null {
  switch (s.type) {
    case 'pdfValue':
    case 'pdfPattern': {
      if (!ctx.pdf) return fail('internal', 'The PDF text was not read.');
      const r = s.type === 'pdfValue' ? findValue(ctx.pdf.items, s.keyword, s.position, s.occurrence) : pdfPattern(s, ctx.pdf);
      if (!r.ok) return r;
      st.name = st.value = r.value;
      break;
    }
    case 'list': {
      const key = s.against === 'name' ? st.name : st.value;
      if (key === null) return fail('not-in-list', 'No value was found before this step.');
      const list = ctx.lists[listKey(s)];
      if (!list) return fail('internal', 'The list was not read.');
      if (!list.ok) return fail('not-in-list', list.detail);
      const to = list.map.get(key.trim().toLowerCase());
      if (to === undefined) return fail('not-in-list', `"${key}" is not in the list.`);
      st.name = to;
      break;
    }
    case 'addText': {
      const at = Math.max(s.insert?.at ?? 0, 0);
      const mid = s.insert ? st.name.slice(0, at) + s.insert.text + st.name.slice(at) : st.name;
      st.name = s.prefix + mid + s.suffix;
      break;
    }
    case 'replace': {
      if (!s.find) break;
      const flags = (s.all ? 'g' : '') + (s.matchCase ? '' : 'i');
      try {
        st.name = s.regex
          ? st.name.replace(new RegExp(s.find, flags), s.with)
          : st.name.replace(new RegExp(s.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags), () => s.with);
      } catch (e) {
        return fail('no-pattern', errText(e));
      }
      break;
    }
    case 'remove':
      st.name = remove(s, st.name);
      break;
    case 'trim':
      st.name = st.name.trim().replace(/\s+/g, ' ');
      break;
    case 'case':
      st.name = recase(s.to, st.name);
      break;
    case 'number':
      st.n = String(s.start + ctx.index * s.step).padStart(Math.min(Math.max(s.pad, 0), 20), '0'); // bounded: a huge pad would throw
      st.name = join(st.name, st.n, s.at, s.sep);
      break;
    case 'date':
      st.date = formatDate(s.from === 'today' ? ctx.today : new Date(s.from === 'modified' ? ctx.mtime : ctx.ctime), s.format);
      st.name = join(st.name, st.date, s.at, s.sep);
      break;
  }
  return null;
}

/**
 * The new base name for one PDF: the steps run in order on `ctx.base`. A source step (value, pattern, list) replaces the name;
 * `value` is the last value found in the PDF (pairing and {value} use it); `n` and `date` feed {n} and {date}.
 */
export function runSteps(steps: Step[], ctx: StepCtx): Named {
  const st: State = { name: ctx.base, value: null, n: String(ctx.index + 1), date: formatDate(ctx.today, 'yyyy-MM-dd') };
  for (const s of steps) {
    const f = apply(s, st, ctx);
    if (f) return f;
  }
  return { ok: true, base: st.name, value: st.value, n: st.n, date: st.date };
}
