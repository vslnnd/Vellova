import { describe, expect, it } from 'vitest';
import { pathKey } from '../src/lib/rename/engine/files';
import type { Grid } from '../src/lib/split/engine/grid';
import { DEFAULT_SPLIT_RULES, splitProfile, splitRules } from '../src/lib/split/engine/profile';
import { DEFAULT_TEMPLATE, planArchive, planSplit, renderName, type FileRead, type SplitItem } from '../src/lib/split/engine/planner';
import type { SplitRules } from '../src/lib/shared/types';

const date = new Date(2026, 9, 17);
const grid = (rows: string[][], sheets = [{ name: 'Sheet1', rows: rows.length }]): Grid => ({ sheets, sheet: sheets[0].name, rows, merges: [] });
const simple = grid([['Name', 'Cost centre', 'Amount'], ['a', 'A', '1'], ['b', 'B', '2'], ['c', 'A', '3'], ['d', 'Z', '4'], ['e', 'X', '5']]);
const P = (value: string, payable = true, label = '') => ({ value, label, payable });
const rules = (r: Partial<SplitRules> = {}): SplitRules => ({ ...DEFAULT_SPLIT_RULES, column: 'Cost centre', params: [P('A'), P('B'), P('X', false)], ...r });
const run = (r: SplitRules, files: Record<string, Grid | FileRead>, extra: Record<string, unknown> = {}) =>
  planSplit({
    files: Object.keys(files),
    reads: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, 'ok' in v ? v : { ok: true as const, grid: v }])),
    rules: r, columnFor: {}, skipped: new Set(), existing: new Set(), date, ...extra,
  });
const names = (items: SplitItem[]) => items.map((i) => i.name);
const Q = 'C:\\in\\Q3.xlsx';

describe('renderName', () => {
  it('fills and sanitizes', () => {
    expect(renderName('{date}_{file}_{group}', { date: '20261017', file: 'Q3', group: 'A/B' })).toBe('20261017_Q3_A-B');
    expect(renderName('{person}', { person: 'CON' })).toBe('CON_');
    expect(renderName('{x}_{file}', { file: 'Q3' })).toBe('{x}_Q3');
    expect(renderName('{group}', {})).toBe('{group}');
  });
  it('replaces piece characters only in group and person', () => {
    expect(renderName('{file}_{sheet}_{group}_{person}', { file: '50%', sheet: 'Q%', group: '1%', person: 'a?' })).toBe('50%_Q%_1-_a-');
  });
});

describe('by value', () => {
  it('groups in first-appearance order, then NON_MATCHING', () => {
    const items = run(rules({ nonMatching: true }), { [Q]: simple });
    expect(names(items)).toEqual(['20261017_Q3_A.xlsx', '20261017_Q3_B.xlsx', '20261017_Q3_NON_MATCHING.xlsx']);
    expect(items.map((i) => i.rows)).toEqual([2, 1, 2]);
    expect(items.map((i) => i.label)).toEqual(['A', 'B', 'NON_MATCHING']);
    expect(items[0].id).toBe(`${Q}|0`);
    expect(items[0].spec).toEqual({ kind: 'rows', rows: [1, 3] });
    expect(items[2].spec).toEqual({ kind: 'rows', rows: [4, 5] });
    expect(items[0].op).toEqual({ kind: 'copy', from: '', to: 'C:\\in\\20261017_Q3_A.xlsx' });
    expect(DEFAULT_TEMPLATE.value).toBe('{date}_{file}_{group}');
  });
  it('omits NON_MATCHING when off', () => {
    expect(run(rules(), { [Q]: simple })).toHaveLength(2);
  });
  it('missing column and columnFor', () => {
    const r = rules({ column: 'Cost centre' });
    const g = grid([['Name', 'Dept'], ['a', 'A']]);
    const [it] = run(r, { [Q]: g });
    expect(it).toMatchObject({ id: Q, status: 'attention', reason: 'no-column', detail: 'This file has no column "Cost centre".', op: null });
    expect(run(r, { [Q]: g }, { columnFor: { [Q]: 'dept' } })).toHaveLength(1);
  });
  it('waits for a column when none is chosen', () => {
    const [it] = run(rules({ column: ' ' }), { [Q]: simple });
    expect(it).toMatchObject({ id: Q, status: 'pending', detail: 'Choose the column to split by.', op: null });
    expect(run(rules({ column: '' }), { [Q]: simple }, { columnFor: { [Q]: 'Cost centre' } })).toHaveLength(2);
  });
  it('empty, pending, unreadable, skipped', () => {
    expect(run(rules(), { [Q]: grid([['Cost centre']]) })[0]).toMatchObject({ status: 'skipped', detail: 'No data rows.' });
    const p = planSplit({ files: [Q], reads: {}, rules: rules(), columnFor: {}, skipped: new Set(), existing: new Set(), date });
    expect(p[0]).toMatchObject({ status: 'pending', id: Q });
    expect(run(rules(), { [Q]: { ok: false, reason: 'unreadable', detail: 'Bad file.' } })[0]).toMatchObject({ status: 'attention', reason: 'unreadable', detail: 'Bad file.' });
    expect(run(rules(), { [Q]: simple }, { skipped: new Set([Q]) })[0]).toMatchObject({ status: 'skipped', op: null });
  });
});

describe('people', () => {
  const people = [{ name: 'Ann', weight: 1 }, { name: 'Bob', weight: 1 }, { name: 'Cy', weight: 0.0001 }];
  const four = grid([['K'], ['1'], ['2'], ['3'], ['4']]);
  it('files mode: blocks, shares, summary file', () => {
    const items = run(rules({ mode: 'people', people, summary: true }), { [Q]: four });
    expect(names(items)).toEqual(['20261017_Q3_Ann.xlsx', '20261017_Q3_Bob.xlsx', '20261017_Q3_summary.xlsx']);
    expect(items[0]).toMatchObject({ rows: 2, share: 50, spec: { kind: 'rows', rows: [1, 2] } });
    expect(items[1].spec).toMatchObject({ rows: [3, 4] });
    expect(items[2].spec).toMatchObject({ kind: 'summary', summary: [
      { person: 'Ann', rows: 2, groups: 0, share: 50 }, { person: 'Bob', rows: 2, groups: 0, share: 50 }, { person: 'Cy', rows: 0, groups: 0, share: 0 }] });
    expect(items.some((i) => i.detail?.includes('Cy'))).toBe(true);
  });
  it('groups assign by column, no summary', () => {
    const g = grid([['K'], ['x'], ['y'], ['x'], ['y']]);
    const items = run(rules({ mode: 'people', column: 'K', assign: 'groups', summary: false, people: people.slice(0, 2) }), { [Q]: g });
    expect(items.map((i) => (i.spec && 'rows' in i.spec ? i.spec.rows : null))).toEqual([[1, 3], [2, 4]]);
  });
  it('column mode: xlsx has summary inside, csv a separate item', () => {
    const r = rules({ mode: 'people', peopleOutput: 'column', people: people.slice(0, 2) });
    const items = run(r, { [Q]: four });
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('20261017_Q3_assigned.xlsx');
    expect(items[0].spec).toMatchObject({ kind: 'rows', rows: [1, 2, 3, 4], assigned: { 1: 'Ann', 2: 'Ann', 3: 'Bob', 4: 'Bob' }, summary: [{ person: 'Ann' }, { person: 'Bob' }] });
    const c = run({ ...r, format: 'csv' }, { [Q]: four });
    expect(names(c)).toEqual(['20261017_Q3_assigned.csv', '20261017_Q3_summary.csv']);
    expect(c[0].spec).not.toHaveProperty('summary');
  });
  it('a group bigger than a share warns on the first output', () => {
    const g = grid([['K'], ['x'], ['x'], ['x'], ['y']]);
    const items = run(rules({ mode: 'people', column: 'K', assign: 'groups', summary: false, people: people.slice(0, 2) }), { [Q]: g });
    expect(items[0].detail).toBe(`"x" has 3 rows, more than Ann's share of 2.`);
  });
  it('no people', () => {
    expect(run(rules({ mode: 'people' }), { [Q]: four })[0].status).toBe('attention');
  });
});

describe('rows, parts, sheets', () => {
  const five = grid([['K'], ['1'], ['2'], ['3'], ['4'], ['5']]);
  it('numbers parts from 1', () => {
    expect(names(run(rules({ mode: 'rows', rows: 2 }), { [Q]: five }))).toEqual(['20261017_Q3_part1.xlsx', '20261017_Q3_part2.xlsx', '20261017_Q3_part3.xlsx']);
    expect(run(rules({ mode: 'parts', parts: 2 }), { [Q]: five }).map((i) => i.rows)).toEqual([3, 2]);
  });
  it('sheets with rows only', () => {
    const g = grid([['K']], [{ name: 'Jan', rows: 3 }, { name: 'Empty', rows: 0 }, { name: 'Feb', rows: 2 }]);
    const items = run(rules({ mode: 'sheets' }), { [Q]: g });
    expect(names(items)).toEqual(['20261017_Q3_Jan.xlsx', '20261017_Q3_Feb.xlsx']);
    expect(items[0]).toMatchObject({ rows: 3, spec: { kind: 'sheet', sheet: 'Jan' } });
  });
});

describe('format and folders', () => {
  it('formats', () => {
    const f = (path: string, format: SplitRules['format']) => run(rules({ format, mode: 'parts', parts: 1 }), { [path]: simple })[0];
    expect(f('C:\\in\\a.xls', 'same')).toMatchObject({ name: '20261017_a_part1.xlsx', format: 'xlsx' });
    expect(f('C:\\in\\a.csv', 'same')).toMatchObject({ name: '20261017_a_part1.csv', format: 'csv' });
    expect(f('C:\\in\\a.xlsx', 'csv').name).toBe('20261017_a_part1.csv');
  });
  it('folder and subfolder, no escape', () => {
    const g = grid([['K'], ['..'], ['a\\b']]);
    const r = rules({ column: 'K', params: [P('..'), P('a\\b')], folder: { mode: 'folder', path: 'D:\\out' }, subfolder: true });
    const to = run(r, { [Q]: g }).map((i) => i.op!.to);
    expect(to[0]).toBe('D:\\out\\_\\20261017_Q3_...xlsx');
    expect(to[1]).toBe('D:\\out\\a-b\\20261017_Q3_a-b.xlsx');
  });
  it('subfolder for people', () => {
    const r = rules({ mode: 'people', people: [{ name: 'Ann', weight: 1 }], summary: false, subfolder: true });
    expect(run(r, { [Q]: simple })[0].op!.to).toBe('C:\\in\\Ann\\20261017_Q3_Ann.xlsx');
  });
  it('a subfolder with trailing dots is not a reserved name', () => {
    const r = rules({ mode: 'people', people: [{ name: 'CON .', weight: 1 }], summary: false, subfolder: true });
    expect(run(r, { [Q]: simple })[0].op!.to).toBe('C:\\in\\CON_\\20261017_Q3_CON ..xlsx');
  });
});

describe('collisions', () => {
  const t = (over: Partial<SplitRules>, extra: Record<string, unknown> = {}, files: Record<string, Grid> = { [Q]: simple }) =>
    run(rules({ mode: 'parts', parts: 1, template: 'out', ...over }), files, extra);
  it('same name across files', () => {
    const files = { [Q]: simple, 'D:\\x\\Q3.xlsx': simple };
    expect(names(t({}, {}, files))).toEqual(['out.xlsx', 'out.xlsx']);
    const same = t({ folder: { mode: 'folder', path: 'D:\\o' } }, {}, files);
    expect(names(same)).toEqual(['out.xlsx', 'out (1).xlsx']);
    expect(same[1].status).toBe('duplicate');
  });
  it('a source name is taken, even with replace', () => {
    const [i] = t({ template: '{file}', conflict: 'replace' });
    expect(i.name).toBe('Q3 (1).xlsx');
    expect(i.op!.replace).toBeUndefined();
  });
  it('existing: add, skip, replace', () => {
    const existing = new Set([pathKey('C:\\in\\out.xlsx')]);
    expect(t({ conflict: 'add' }, { existing })[0].name).toBe('out (1).xlsx');
    expect(t({ conflict: 'skip' }, { existing })[0]).toMatchObject({ status: 'skipped', op: null });
    const r = t({ conflict: 'replace' }, { existing })[0];
    expect(r.name).toBe('out.xlsx');
    expect(r.op!.replace).toBe(true);
  });
});

describe('planArchive', () => {
  it('numbers from _2', () => {
    const existing = new Set([pathKey('C:\\arch\\a_20261017.xlsx')]);
    expect(planArchive(['C:\\in\\a.xlsx', 'D:\\x\\a.xlsx'], 'C:\\arch', existing, date)).toEqual([
      { source: 'C:\\in\\a.xlsx', to: 'C:\\arch\\a_20261017_2.xlsx' },
      { source: 'D:\\x\\a.xlsx', to: 'C:\\arch\\a_20261017_3.xlsx' },
    ]);
  });
});

describe('profile', () => {
  it('fills defaults, drops bad params, needs id and name', () => {
    const p = splitProfile({ id: 'x', name: 'N', rules: { mode: 'rows', params: [{ value: 3 }, { value: 'a', label: 'L' }, { value: {} }, 5], rows: 'many', folder: { mode: 'folder' } } })!;
    expect(p).toMatchObject({ id: 'x', name: 'N', desc: '', archiveFolder: null });
    expect(p.rules.mode).toBe('rows');
    expect(p.rules.rows).toBe(1000);
    expect(p.rules.folder).toEqual({ mode: 'source' });
    expect(p.rules.params).toEqual([{ value: '3', label: '', payable: true }, { value: 'a', label: 'L', payable: true }]);
    expect(p.rules.conflict).toBe('add');
    expect(splitProfile({ name: 'N' })).toBeNull();
    expect(splitProfile(null)).toBeNull();
    expect(splitRules(7)).toEqual(DEFAULT_SPLIT_RULES);
    expect(splitRules({ ...DEFAULT_SPLIT_RULES, folder: { mode: 'folder', path: 'D:\\o' }, header: { mode: 'manual', row: 3 } })).toMatchObject({ folder: { mode: 'folder', path: 'D:\\o' }, header: { mode: 'manual', row: 3 } });
  });
});
