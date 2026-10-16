import { describe, expect, it } from 'vitest';
import { mergeFiles } from '../src/lib/rename/engine/files';
import { planRename, summary, type PlanInput, type ValueResult } from '../src/lib/rename/engine/planner';
import { DEFAULT_RULES, profileFromRules, rulesFromProfile, type RenameRules } from '../src/lib/rename/engine/profile';
import type { PlanItem } from '../src/lib/shared/types';

const ok = (value: string): ValueResult => ({ ok: true, value });
const plan = (over: Partial<PlanInput>) =>
  planRename({
    files: [], values: {}, pairs: {}, pairEnabled: true, prefix: '', suffix: '',
    destination: { mode: 'inplace' }, conflict: 'add', existing: new Set(), overrides: {}, skipped: new Set(),
    ...over,
  });
const brief = (items: PlanItem[]) => items.map((i) => [i.status, i.name ?? null]);
const A = 'C:\\in\\a.pdf', B = 'C:\\in\\b.pdf', C = 'C:\\in\\c.pdf';

describe('planRename', () => {
  it('renames a PDF to prefix + value + suffix, extension lower-cased', () => {
    const [item] = plan({ files: ['C:\\in\\scan.PDF'], values: { 'C:\\in\\scan.PDF': ok('DN-2026-00017') }, prefix: 'CN_', suffix: '_x' });
    expect(item).toEqual({
      id: 'C:\\in\\scan.PDF', source: 'C:\\in\\scan.PDF', status: 'ready', name: 'CN_DN-2026-00017_x.pdf',
      op: { kind: 'rename', from: 'C:\\in\\scan.PDF', to: 'C:\\in\\CN_DN-2026-00017_x.pdf' },
    });
  });

  it('sanitizes the whole name, as 1.4.6 did', () => {
    expect(brief(plan({ files: [A, B], values: { [A]: ok('INV/17'), [B]: ok('CON') }, prefix: 'A:' }))).toEqual([
      ['ready', 'A_INV_17.pdf'], ['ready', 'A_CON.pdf'],
    ]);
    expect(plan({ files: [A], values: { [A]: ok('CON') } })[0].name).toBe('CON_.pdf');
  });

  it('equal values get (1), (2) in list order, and companions follow their PDF', () => {
    const X = 'C:\\in\\b.xlsx';
    const items = plan({ files: [A, B, C, X], values: { [A]: ok('DN-17'), [B]: ok('DN-17'), [C]: ok('DN-17') }, pairs: { [X]: B } });
    expect(brief(items)).toEqual([
      ['ready', 'DN-17.pdf'], ['duplicate', 'DN-17 (1).pdf'], ['duplicate', 'DN-17 (2).pdf'], ['paired', 'DN-17 (1).xlsx'],
    ]);
  });

  it('values that differ only by letter case still get unique names', () => {
    expect(brief(plan({ files: [A, B], values: { [A]: ok('inv-17'), [B]: ok('INV-17') } }))).toEqual([
      ['ready', 'inv-17.pdf'], ['duplicate', 'INV-17 (1).pdf'],
    ]);
  });

  it('a file that already has its name is unchanged; a case-only change is a rename', () => {
    const same = plan({ files: ['C:\\in\\DN-17.pdf'], values: { 'C:\\in\\DN-17.pdf': ok('DN-17') }, existing: new Set(['c:\\in\\dn-17.pdf']) });
    expect(same[0]).toMatchObject({ status: 'unchanged', op: null });
    const caseOnly = plan({ files: ['C:\\in\\dn-17.pdf'], values: { 'C:\\in\\dn-17.pdf': ok('DN-17') }, existing: new Set(['c:\\in\\dn-17.pdf']) });
    expect(caseOnly[0]).toMatchObject({ status: 'ready', op: { kind: 'rename', from: 'C:\\in\\dn-17.pdf', to: 'C:\\in\\DN-17.pdf' } });
  });

  it('a name already taken on disk follows Add (1) / Skip / Replace', () => {
    const base = { files: [A], values: { [A]: ok('DN-17') }, existing: new Set(['c:\\in\\a.pdf', 'c:\\in\\dn-17.pdf']) };
    expect(plan({ ...base, conflict: 'add' })[0]).toMatchObject({ status: 'ready', name: 'DN-17 (1).pdf' });
    expect(plan({ ...base, conflict: 'skip' })[0]).toMatchObject({ status: 'skipped', op: null, detail: 'DN-17.pdf already exists.' });
    expect(plan({ ...base, conflict: 'replace' })[0].op).toEqual({ kind: 'rename', from: A, to: 'C:\\in\\DN-17.pdf', replace: true });
  });

  it('a name freed by another file in the same batch is not a conflict, so swaps work', () => {
    const items = plan({ files: [A, B], values: { [A]: ok('b'), [B]: ok('a') }, existing: new Set(['c:\\in\\a.pdf', 'c:\\in\\b.pdf']), conflict: 'skip' });
    expect(items.map((i) => i.op)).toEqual([
      { kind: 'rename', from: A, to: 'C:\\in\\b.pdf' },
      { kind: 'rename', from: B, to: 'C:\\in\\a.pdf' },
    ]);
  });

  it('a name held by a file that stays put is a conflict', () => {
    const X = 'C:\\in\\x.pdf', Y = 'C:\\in\\y.pdf';
    const items = plan({
      files: [X, Y],
      values: { [X]: ok('y'), [Y]: { ok: false, reason: 'keyword-not-found', detail: 'Keyword "No." not found in this PDF.' } },
      existing: new Set(['c:\\in\\x.pdf', 'c:\\in\\y.pdf']),
    });
    expect(items[0]).toMatchObject({ status: 'ready', name: 'y (1).pdf' });
    expect(items[1]).toMatchObject({ status: 'attention', reason: 'keyword-not-found', op: null });
  });

  it('copy mode: waits for a folder, copies into it, and skips a copy onto itself', () => {
    const values = { [A]: ok('DN-17') };
    expect(plan({ files: [A], values, destination: { mode: 'copy', folder: '' } })[0]).toMatchObject({ status: 'pending', name: 'DN-17.pdf', op: null });
    expect(plan({ files: [A], values, destination: { mode: 'copy', folder: 'D:\\out' } })[0].op).toEqual({ kind: 'copy', from: A, to: 'D:\\out\\DN-17.pdf' });
    const self = plan({ files: ['C:\\in\\DN-17.pdf'], values: { 'C:\\in\\DN-17.pdf': ok('DN-17') }, destination: { mode: 'copy', folder: 'C:\\in' }, existing: new Set(['c:\\in\\dn-17.pdf']) });
    expect(self[0].status).toBe('unchanged');
  });

  it('PDFs still being read are pending; failures pass their reason through', () => {
    const items = plan({ files: [A, B], values: { [B]: { ok: false, reason: 'no-text', detail: 'This PDF has no text layer (it may be a scan).' } } });
    expect(items[0]).toMatchObject({ status: 'pending', op: null });
    expect(items[1]).toMatchObject({ status: 'attention', reason: 'no-text', detail: 'This PDF has no text layer (it may be a scan).' });
  });

  it('a typed name wins and is sanitized; an empty one needs attention', () => {
    expect(plan({ files: [A], values: {}, overrides: { [A]: 'Mine?' } })[0]).toMatchObject({ status: 'ready', name: 'Mine_.pdf' });
    expect(plan({ files: [A], values: { [A]: ok('x') }, overrides: { [A]: '   ' } })[0]).toMatchObject({ status: 'attention', reason: 'no-value' });
  });

  it('companions: unmatched, unreadable, waiting, pairing off, and following a skipped PDF', () => {
    const X = 'C:\\in\\x.xlsx', T = 'C:\\in\\t.txt';
    const values = { [A]: ok('DN-17'), [T]: { ok: false, reason: 'locked', detail: 'in use' } as ValueResult };
    expect(brief(plan({ files: [A, X, T], values, pairs: {} })).slice(1)).toEqual([['attention', null], ['attention', null]]);
    expect(plan({ files: [A, X], values, pairs: {} })[1].reason).toBe('no-match');
    expect(plan({ files: [A, X], values, pairs: null })[1].status).toBe('pending');
    expect(plan({ files: [A, X], values, pairs: { [X]: A }, pairEnabled: false })[1].status).toBe('unchanged');
    expect(plan({ files: [A, X], values, pairs: { [X]: A }, skipped: new Set([A]) }).map((i) => i.status)).toEqual(['skipped', 'skipped']);
  });

  it('a companion does not follow a PDF skipped by the Skip conflict rule', () => {
    const X = 'C:\\in\\x.xlsx';
    const items = plan({ files: [A, X], values: { [A]: ok('DN-17') }, pairs: { [X]: A }, conflict: 'skip', existing: new Set(['c:\\in\\a.pdf', 'c:\\in\\x.xlsx', 'c:\\in\\dn-17.pdf']) });
    expect(items.map((i) => [i.status, i.op])).toEqual([['skipped', null], ['skipped', null]]);
  });

  it('copy mode with Replace never overwrites a listed source that a later copy still reads', () => {
    const items = plan({
      files: [A, B], values: { [A]: ok('b'), [B]: ok('z') }, destination: { mode: 'copy', folder: 'C:\\in' },
      conflict: 'replace', existing: new Set(['c:\\in\\a.pdf', 'c:\\in\\b.pdf']),
    });
    expect(items.map((i) => i.op)).toEqual([
      { kind: 'copy', from: A, to: 'C:\\in\\b (1).pdf' },
      { kind: 'copy', from: B, to: 'C:\\in\\z.pdf' },
    ]);
  });

  it('copy mode without a folder keeps a paired companion pending, not skipped', () => {
    const X = 'C:\\in\\x.xlsx';
    const items = plan({ files: [A, X], values: { [A]: ok('DN-17') }, pairs: { [X]: A }, destination: { mode: 'copy', folder: '' } });
    expect(items.map((i) => i.status)).toEqual(['pending', 'pending']);
    expect(items[1].detail).toBe('Choose a folder to copy into.');
  });

  it('summary counts what will happen', () => {
    const items = plan({ files: [A, B, C], values: { [A]: ok('1'), [B]: ok('2'), [C]: { ok: false, reason: 'no-value', detail: '' } } });
    expect(summary(items, { mode: 'inplace' })).toEqual({ ops: 2, attention: 1, pending: 0, label: 'Rename 2 files' });
    expect(summary(items.slice(0, 1), { mode: 'copy', folder: 'D:\\' }).label).toBe('Copy 1 file');
  });
});

describe('mergeFiles', () => {
  const f = (path: string) => ({ path, size: 1, mtime: 1 });
  it('lists a file once, however it was added, and keeps only supported types', () => {
    const list = mergeFiles([f('C:\\In\\a.pdf')], [f('c:/in/A.PDF'), f('C:\\In\\b.xlsx'), f('C:\\In\\notes.docx'), f('C:/In/b.xlsx')]);
    expect(list.map((x) => x.path)).toEqual(['C:\\In\\a.pdf', 'C:\\In\\b.xlsx']);
  });
});

describe('profiles', () => {
  it('rules round-trip through a profile', () => {
    const rules: RenameRules = {
      ...DEFAULT_RULES, keyword: 'Invoice No.:', position: 'below', occurrence: 2, prefix: 'CN_',
      destination: { mode: 'copy', folder: 'D:\\out' }, conflict: 'replace',
    };
    const p = profileFromRules(rules, 'Debit notes', 'p1');
    expect(p.steps).toEqual([
      { type: 'pdfValue', keyword: 'Invoice No.:', position: 'below', occurrence: 2 },
      { type: 'addText', prefix: 'CN_', suffix: '' },
    ]);
    expect(rulesFromProfile(p)).toEqual(rules);
  });

  it('a profile without steps gives the defaults', () => {
    expect(rulesFromProfile({ id: 'x', name: 'x', desc: '', steps: [], pair: true, destination: { mode: 'inplace' }, conflict: 'add' })).toEqual(DEFAULT_RULES);
  });
});
