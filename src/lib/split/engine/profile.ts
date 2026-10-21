import type { Param, Person, SplitFolder, SplitProfile, SplitRules } from '../../shared/types';

export const DEFAULT_SPLIT_RULES: SplitRules = {
  mode: 'value', sheet: null, header: { mode: 'default' }, column: '', params: [], nonMatching: false,
  people: [], assign: 'blocks', peopleOutput: 'files', summary: true, rows: 1000, parts: 2, template: '',
  folder: { mode: 'source' }, subfolder: false, format: 'same', conflict: 'add',
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);
const count = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : d);

/** Validates stored or imported rules field by field; anything of the wrong type falls back to its default. */
export function splitRules(v: unknown): SplitRules {
  const o = obj(v);
  const d = DEFAULT_SPLIT_RULES;
  const h = obj(o.header);
  const f = obj(o.folder);
  const params: Param[] = (Array.isArray(o.params) ? o.params : []).flatMap((p) => {
    const x = obj(p);
    return typeof x.value === 'string' || typeof x.value === 'number'
      ? [{ value: String(x.value), label: str(x.label, ''), payable: bool(x.payable, true) }]
      : [];
  });
  const people: Person[] = (Array.isArray(o.people) ? o.people : []).flatMap((p) => {
    const x = obj(p);
    return typeof x.name === 'string'
      ? [{ name: x.name, weight: typeof x.weight === 'number' && Number.isFinite(x.weight) ? x.weight : 1 }]
      : [];
  });
  const folder: SplitFolder = f.mode === 'folder' && typeof f.path === 'string' ? { mode: 'folder', path: f.path } : { mode: 'source' };
  return {
    mode: oneOf(o.mode, ['value', 'people', 'rows', 'parts', 'sheets'], d.mode),
    sheet: typeof o.sheet === 'string' ? o.sheet : null,
    header: h.mode === 'manual' && typeof h.row === 'number' && Number.isFinite(h.row) && h.row >= 1 ? { mode: 'manual', row: Math.floor(h.row) } : { mode: 'default' },
    column: str(o.column, d.column),
    params,
    nonMatching: bool(o.nonMatching, d.nonMatching),
    people,
    assign: oneOf(o.assign, ['blocks', 'groups'], d.assign),
    peopleOutput: oneOf(o.peopleOutput, ['files', 'column'], d.peopleOutput),
    summary: bool(o.summary, d.summary),
    rows: count(o.rows, d.rows),
    parts: count(o.parts, d.parts),
    template: str(o.template, d.template),
    folder,
    subfolder: bool(o.subfolder, d.subfolder),
    format: oneOf(o.format, ['same', 'xlsx', 'csv'], d.format),
    conflict: oneOf(o.conflict, ['add', 'skip', 'replace'], d.conflict),
  };
}

/** A stored or imported profile with defaults filled in, or null without an id and a name. */
export function splitProfile(v: unknown): SplitProfile | null {
  const o = obj(v);
  if (typeof o.id !== 'string' || typeof o.name !== 'string') return null;
  return { id: o.id, name: o.name, desc: str(o.desc, ''), rules: splitRules(o.rules), archiveFolder: typeof o.archiveFolder === 'string' ? o.archiveFolder : null };
}
