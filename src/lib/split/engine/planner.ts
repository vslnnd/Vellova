import { extOf, join, sanitize, splitExt, splitPath } from '../../shared/names';
import type { PlanItem, Reason, SplitMode, SplitRules, Status } from '../../shared/types';
import { pathKey } from '../../rename/engine/files';
import type { Grid } from './grid';
import { findColumn, headerInfo } from './header';
import { byValue, equalParts, evenBlocks, fixedRows, keepGroups } from './modes';

export { DEFAULT_SPLIT_RULES, splitProfile } from './profile';

export type SummaryRow = { person: string; rows: number; groups: number; share: number };
export type OutSpec =
  | { kind: 'rows'; rows: number[]; assigned?: Record<number, string>; summary?: SummaryRow[] } // grid row indices
  | { kind: 'sheet'; sheet: string }
  | { kind: 'summary'; summary: SummaryRow[] };
export type SplitItem = PlanItem & { rows: number; label?: string; share?: number; spec?: OutSpec; format?: 'xlsx' | 'csv' };
export type FileRead = { ok: true; grid: Grid } | { ok: false; reason: Reason; detail: string };
export type SplitPlanInput = {
  files: string[]; reads: Record<string, FileRead | undefined>; rules: SplitRules;
  columnFor: Record<string, string>; skipped: Set<string>;
  /** pathKeys of every file in every folder the plan can write to: the source folders or the chosen one, plus each subfolder it would use. */
  existing: Set<string>; date: Date;
};
type Vars = Partial<Record<'date' | 'file' | 'group' | 'person' | 'part' | 'sheet', string>>;

export const DEFAULT_TEMPLATE: Record<SplitMode | 'assigned', string> = {
  value: '{date}_{file}_{group}',
  people: '{date}_{file}_{person}',
  rows: '{date}_{file}_part{part}',
  parts: '{date}_{file}_part{part}',
  sheets: '{date}_{file}_{sheet}',
  assigned: '{date}_{file}_assigned',
};
const SUMMARY_TEMPLATE = '{date}_{file}_summary';

const PIECE = /[\\/?%*:|"<>]/g;

/** Fills {date} {file} {group} {person} {part} {sheet}; unknown or unset keys stay as typed. */
export function renderName(template: string, vars: Vars): string {
  return sanitize(template.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (!Object.hasOwn(vars, k)) return m;
    const v = (vars as Record<string, string>)[k];
    // as Splitify: only the cell-derived pieces; {file} and {sheet} are already valid names
    return k === 'group' || k === 'person' ? v.replace(PIECE, '-') : v;
  }));
}

/** One path piece for a subfolder: it can never be empty, `.`, `..` or hold a separator. */
const piece = (s: string) => sanitize(s.replace(PIECE, '-').replace(/[. ]+$/, '')) || '_';

const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

type Draft = { rows: number; spec: OutSpec; template: string; vars: Vars; sub?: string; label?: string; share?: number; detail?: string };
const norm = (s: string) => s.trim().toLowerCase();

function summaryOf(people: { name: string }[], rowsBy: number[], groupsBy: number[], total: number): SummaryRow[] {
  return people.map((p, i) => ({ person: p.name, rows: rowsBy[i], groups: groupsBy[i], share: total ? Math.round((rowsBy[i] / total) * 1000) / 10 : 0 }));
}

export function planSplit(input: SplitPlanInput): SplitItem[] {
  const { rules, existing, date } = input;
  const used = new Set<string>();
  const sources = new Set(input.files.map(pathKey));
  const today = ymd(date);

  const fileItem = (source: string, status: Status, extra: Partial<SplitItem> = {}): SplitItem => ({ id: source, source, op: null, status, rows: 0, ...extra });

  /** Gives an output the first free name of `base`, `base (1)`, `base (2)`… in its folder. */
  const place = (source: string, n: number, d: Draft, csv: boolean): SplitItem => {
    const id = `${source}|${n}`;
    const ext = csv ? '.csv' : '.xlsx';
    const base = renderName(d.template, { ...d.vars, date: today, file: splitExt(splitPath(source).name).base });
    const common = { id, source, rows: d.rows, spec: d.spec, format: csv ? ('csv' as const) : ('xlsx' as const), ...(d.label !== undefined ? { label: d.label } : {}), ...(d.share !== undefined ? { share: d.share } : {}) };
    if (!base) return { ...common, op: null, status: 'attention', reason: 'no-value', detail: 'The name would be empty.' };
    let dir = rules.folder.mode === 'folder' ? rules.folder.path : splitPath(source).dir;
    if (rules.subfolder && d.sub !== undefined) dir = join(dir, piece(d.sub));
    let dup = false;
    for (let k = 0; ; k++) {
      const name = `${k ? `${base} (${k})` : base}${ext}`;
      const to = join(dir, name);
      const key = pathKey(to);
      if (used.has(key)) {
        dup = true;
        continue;
      }
      // A file being split in this run is never replaced; its name is numbered like any other taken name.
      const isSource = sources.has(key);
      const taken = isSource || existing.has(key);
      if (taken && (rules.conflict === 'add' || (rules.conflict === 'replace' && isSource))) continue;
      if (taken && rules.conflict === 'skip') return { ...common, op: null, status: 'skipped', name, detail: `${name} already exists.` };
      used.add(key);
      return { ...common, name, status: dup ? 'duplicate' : 'ready', op: { kind: 'copy', from: '', to, ...(taken ? { replace: true } : {}) }, ...(d.detail ? { detail: d.detail } : {}) };
    }
  };

  const one = (source: string): SplitItem[] => {
    if (input.skipped.has(source)) return [fileItem(source, 'skipped')];
    const read = input.reads[source];
    if (!read) return [fileItem(source, 'pending', { detail: 'Waiting to read this file…' })];
    if (!read.ok) return [fileItem(source, 'attention', { reason: read.reason, detail: read.detail })];
    const grid = read.grid;
    const csv = rules.format === 'csv' || (rules.format === 'same' && extOf(source) === '.csv');
    const tpl = rules.template || DEFAULT_TEMPLATE[rules.mode];
    let drafts: Draft[] = [];

    if (rules.mode === 'sheets') {
      drafts = grid.sheets.filter((s) => s.rows > 0).map((s) => ({ rows: s.rows, spec: { kind: 'sheet', sheet: s.name }, template: tpl, vars: { sheet: s.name } }));
      if (!drafts.length) return [fileItem(source, 'skipped', { detail: 'No data rows.' })];
    } else {
      const head = headerInfo(grid, rules.header);
      const data = head.data;
      if (!data.length) return [fileItem(source, 'skipped', { detail: 'No data rows.' })];
      const needsColumn = rules.mode === 'value' || (rules.mode === 'people' && rules.assign === 'groups');
      const colName = input.columnFor[source] ?? rules.column;
      if (needsColumn && !colName.trim()) return [fileItem(source, 'pending', { detail: 'Choose the column to split by.' })];
      const col = needsColumn ? findColumn(head.columns, colName) : undefined;
      if (needsColumn && !col) return [fileItem(source, 'attention', { reason: 'no-column', detail: `This file has no column "${colName}".` })];
      const cell = (i: number) => (col ? grid.rows[data[i]][col.index] ?? '' : '');
      const gridRows = (positions: number[]) => positions.map((p) => data[p]);
      const chunks = (sizes: number[]) => {
        let at = 0;
        return sizes.map((s) => data.slice(at, (at += s)));
      };

      if (rules.mode === 'value') {
        const r = byValue(data.map((_, i) => cell(i)), rules.params);
        drafts = r.groups.map((g) => ({ rows: g.rows.length, spec: { kind: 'rows', rows: gridRows(g.rows) }, template: tpl, vars: { group: g.key }, sub: g.key, label: g.key }));
        const rest = [...r.unmatched, ...r.excluded];
        if (rules.nonMatching && rest.length)
          drafts.push({ rows: rest.length, spec: { kind: 'rows', rows: gridRows(rest) }, template: tpl, vars: { group: 'NON_MATCHING' }, sub: 'NON_MATCHING', label: 'NON_MATCHING' });
        if (!drafts.length) return [fileItem(source, 'skipped', { detail: 'No rows matched.' })];
      } else if (rules.mode === 'rows' || rules.mode === 'parts') {
        const sizes = rules.mode === 'rows' ? fixedRows(data.length, rules.rows) : equalParts(data.length, rules.parts);
        drafts = chunks(sizes).map((rows, i) => ({ rows: rows.length, spec: { kind: 'rows', rows }, template: tpl, vars: { part: String(i + 1) } }));
      } else {
        const people = rules.people;
        if (!people.length) return [fileItem(source, 'attention', { reason: 'no-value', detail: 'Add the people to split between.' })];
        let who: number[];
        let groupsBy: number[];
        const notes: string[] = [];
        if (rules.assign === 'groups') {
          const a = keepGroups(data.map((_, i) => norm(cell(i))), people);
          who = a.person;
          groupsBy = a.groups;
          notes.push(...a.warnings);
        } else {
          who = chunks(evenBlocks(data.length, people)).flatMap((rows, p) => rows.map(() => p));
          groupsBy = people.map(() => 0);
        }
        const mine = people.map(() => [] as number[]);
        who.forEach((p, i) => mine[p].push(data[i]));
        const summary = summaryOf(people, mine.map((m) => m.length), groupsBy, data.length);
        if (rules.peopleOutput === 'column') {
          const assigned: Record<number, string> = {};
          who.forEach((p, i) => (assigned[data[i]] = people[p].name));
          const inside = rules.summary && !csv;
          drafts = [{ rows: data.length, spec: { kind: 'rows', rows: [...data], assigned, ...(inside ? { summary } : {}) }, template: rules.template || DEFAULT_TEMPLATE.assigned, vars: {} }];
          if (rules.summary && csv) drafts.push({ rows: summary.length, spec: { kind: 'summary', summary }, template: SUMMARY_TEMPLATE, vars: {} });
        } else {
          drafts = people.flatMap((p, i) => (mine[i].length ? [{ rows: mine[i].length, spec: { kind: 'rows' as const, rows: mine[i] }, template: tpl, vars: { person: p.name }, sub: p.name, label: p.name, share: summary[i].share }] : []));
          const none = people.filter((_, i) => !mine[i].length).map((p) => p.name);
          if (none.length) notes.push(`${none.join(', ')} got no rows.`);
          if (rules.summary) drafts.push({ rows: summary.length, spec: { kind: 'summary', summary }, template: SUMMARY_TEMPLATE, vars: {} });
        }
        if (notes.length && drafts.length) drafts[0].detail = notes.join(' ');
      }
    }
    if (!drafts.length) return [fileItem(source, 'skipped', { detail: 'Nothing to write.' })];
    return drafts.map((d, n) => place(source, n, d, csv));
  };

  return input.files.flatMap(one);
}

/** `<base>_<yyyymmdd><ext>`, then `_2`, `_3`… in the archive folder. */
export function planArchive(sources: string[], folder: string, existing: Set<string>, date: Date): { source: string; to: string }[] {
  const used = new Set(existing);
  const stamp = ymd(date);
  return sources.map((source) => {
    const { base, ext } = splitExt(splitPath(source).name);
    for (let k = 1; ; k++) {
      const to = join(folder, `${base}_${stamp}${k > 1 ? `_${k}` : ''}${ext}`);
      if (!used.has(pathKey(to))) {
        used.add(pathKey(to));
        return { source, to };
      }
    }
  });
}
