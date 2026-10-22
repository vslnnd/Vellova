import { describe, expect, it } from 'vitest';
import { mergeFiles } from '../src/lib/rename/engine/files';
import { planRename, readResults, summary, type PlanInput } from '../src/lib/rename/engine/planner';
import { DEFAULT_RULES, profileFromRules, rulesFromProfile, type RenameRules } from '../src/lib/rename/engine/profile';
import type { Named } from '../src/lib/rename/engine/steps';
import type { PlanItem } from '../src/lib/shared/types';

const named = (base: string, value = base): Named => ({ ok: true, base, value, n: '1', date: '2026-10-23' });
const failed = (reason: Extract<Named, { ok: false }>['reason'], detail: string): Named => ({ ok: false, reason, detail });
const plan = (over: Partial<PlanInput>) =>
  planRename({
    files: [], names: {}, failures: {}, pairs: {}, pairEnabled: true,
    destination: { mode: 'inplace' }, conflict: 'add', existing: new Set(), overrides: {}, skipped: new Set(),
    ...over,
  });
const brief = (items: PlanItem[]) => items.map((i) => [i.status, i.name ?? null]);
const A = 'C:\\in\\a.pdf', B = 'C:\\in\\b.pdf', C = 'C:\\in\\c.pdf';

describe('planRename', () => {
  it('renames a PDF to prefix + value + suffix, extension lower-cased', () => {
    const [item] = plan({ files: ['C:\\in\\scan.PDF'], names: { 'C:\\in\\scan.PDF': named('CN_DN-2026-00017_x', 'DN-2026-00017') } });
    expect(item).toEqual({
      id: 'C:\\in\\scan.PDF', source: 'C:\\in\\scan.PDF', status: 'ready', name: 'CN_DN-2026-00017_x.pdf',
      op: { kind: 'rename', from: 'C:\\in\\scan.PDF', to: 'C:\\in\\CN_DN-2026-00017_x.pdf' },
    });
  });

  it('sanitizes the whole name, as 1.4.6 did', () => {
    expect(brief(plan({ files: [A, B], names: { [A]: named('A:INV/17'), [B]: named('A:CON') } }))).toEqual([
      ['ready', 'A_INV_17.pdf'], ['ready', 'A_CON.pdf'],
    ]);
    expect(plan({ files: [A], names: { [A]: named('CON') } })[0].name).toBe('CON_.pdf');
  });

  it('equal values get (1), (2) in list order, and companions follow their PDF', () => {
    const X = 'C:\\in\\b.xlsx';
    const items = plan({ files: [A, B, C, X], names: { [A]: named('DN-17'), [B]: named('DN-17'), [C]: named('DN-17') }, pairs: { [X]: B } });
    expect(brief(items)).toEqual([
      ['ready', 'DN-17.pdf'], ['duplicate', 'DN-17 (1).pdf'], ['duplicate', 'DN-17 (2).pdf'], ['paired', 'DN-17 (1).xlsx'],
    ]);
  });

  it('values that differ only by letter case still get unique names', () => {
    expect(brief(plan({ files: [A, B], names: { [A]: named('inv-17'), [B]: named('INV-17') } }))).toEqual([
      ['ready', 'inv-17.pdf'], ['duplicate', 'INV-17 (1).pdf'],
    ]);
  });

  it('a file that already has its name is unchanged; a case-only change is a rename', () => {
    const same = plan({ files: ['C:\\in\\DN-17.pdf'], names: { 'C:\\in\\DN-17.pdf': named('DN-17') }, existing: new Set(['c:\\in\\dn-17.pdf']) });
    expect(same[0]).toMatchObject({ status: 'unchanged', op: null });
    const caseOnly = plan({ files: ['C:\\in\\dn-17.pdf'], names: { 'C:\\in\\dn-17.pdf': named('DN-17') }, existing: new Set(['c:\\in\\dn-17.pdf']) });
    expect(caseOnly[0]).toMatchObject({ status: 'ready', op: { kind: 'rename', from: 'C:\\in\\dn-17.pdf', to: 'C:\\in\\DN-17.pdf' } });
  });

  it('a name already taken on disk follows Add (1) / Skip / Replace', () => {
    const base = { files: [A], names: { [A]: named('DN-17') }, existing: new Set(['c:\\in\\a.pdf', 'c:\\in\\dn-17.pdf']) };
    expect(plan({ ...base, conflict: 'add' })[0]).toMatchObject({ status: 'ready', name: 'DN-17 (1).pdf' });
    expect(plan({ ...base, conflict: 'skip' })[0]).toMatchObject({ status: 'skipped', op: null, detail: 'DN-17.pdf already exists.' });
    expect(plan({ ...base, conflict: 'replace' })[0].op).toEqual({ kind: 'rename', from: A, to: 'C:\\in\\DN-17.pdf', replace: true });
  });

  it('a name freed by another file in the same batch is not a conflict, so swaps work', () => {
    const items = plan({ files: [A, B], names: { [A]: named('b'), [B]: named('a') }, existing: new Set(['c:\\in\\a.pdf', 'c:\\in\\b.pdf']), conflict: 'skip' });
    expect(items.map((i) => i.op)).toEqual([
      { kind: 'rename', from: A, to: 'C:\\in\\b.pdf' },
      { kind: 'rename', from: B, to: 'C:\\in\\a.pdf' },
    ]);
  });

  it('a name held by a file that stays put is a conflict', () => {
    const X = 'C:\\in\\x.pdf', Y = 'C:\\in\\y.pdf';
    const items = plan({
      files: [X, Y],
      names: { [X]: named('y'), [Y]: failed('keyword-not-found', 'Keyword "No." not found in this PDF.') },
      existing: new Set(['c:\\in\\x.pdf', 'c:\\in\\y.pdf']),
    });
    expect(items[0]).toMatchObject({ status: 'ready', name: 'y (1).pdf' });
    expect(items[1]).toMatchObject({ status: 'attention', reason: 'keyword-not-found', op: null });
  });

  it('copy mode: waits for a folder, copies into it, and skips a copy onto itself', () => {
    const names = { [A]: named('DN-17') };
    expect(plan({ files: [A], names, destination: { mode: 'copy', folder: '' } })[0]).toMatchObject({ status: 'pending', name: 'DN-17.pdf', op: null });
    expect(plan({ files: [A], names, destination: { mode: 'copy', folder: 'D:\\out' } })[0].op).toEqual({ kind: 'copy', from: A, to: 'D:\\out\\DN-17.pdf' });
    const self = plan({ files: ['C:\\in\\DN-17.pdf'], names: { 'C:\\in\\DN-17.pdf': named('DN-17') }, destination: { mode: 'copy', folder: 'C:\\in' }, existing: new Set(['c:\\in\\dn-17.pdf']) });
    expect(self[0].status).toBe('unchanged');
  });

  it('PDFs still being read are pending; failures pass their reason through', () => {
    const items = plan({ files: [A, B], names: { [B]: failed('no-text', 'This PDF has no text layer (it may be a scan).') } });
    expect(items[0]).toMatchObject({ status: 'pending', op: null });
    expect(items[1]).toMatchObject({ status: 'attention', reason: 'no-text', detail: 'This PDF has no text layer (it may be a scan).' });
  });

  it('a typed name wins and is sanitized; an empty one needs attention', () => {
    expect(plan({ files: [A], names: {}, overrides: { [A]: 'Mine?' } })[0]).toMatchObject({ status: 'ready', name: 'Mine_.pdf' });
    expect(plan({ files: [A], names: { [A]: named('x') }, overrides: { [A]: '   ' } })[0]).toMatchObject({ status: 'attention', reason: 'no-value' });
  });

  it('companions: unmatched, unreadable, waiting, pairing off, and following a skipped PDF', () => {
    const X = 'C:\\in\\x.xlsx', T = 'C:\\in\\t.txt';
    const names = { [A]: named('DN-17') }, failures = { [T]: { reason: 'locked' as const, detail: 'in use' } };
    expect(brief(plan({ files: [A, X, T], names, failures, pairs: {} })).slice(1)).toEqual([['attention', null], ['attention', null]]);
    expect(plan({ files: [A, X], names, pairs: {} })[1].reason).toBe('no-match');
    expect(plan({ files: [A, X], names, pairs: null })[1].status).toBe('pending');
    expect(plan({ files: [A, X], names, pairs: { [X]: A }, pairEnabled: false })[1].status).toBe('unchanged');
    expect(plan({ files: [A, X], names, pairs: { [X]: A }, skipped: new Set([A]) }).map((i) => i.status)).toEqual(['skipped', 'skipped']);
  });

  it('a companion does not follow a PDF skipped by the Skip conflict rule', () => {
    const X = 'C:\\in\\x.xlsx';
    const items = plan({ files: [A, X], names: { [A]: named('DN-17') }, pairs: { [X]: A }, conflict: 'skip', existing: new Set(['c:\\in\\a.pdf', 'c:\\in\\x.xlsx', 'c:\\in\\dn-17.pdf']) });
    expect(items.map((i) => [i.status, i.op])).toEqual([['skipped', null], ['skipped', null]]);
  });

  it('copy mode with Replace never overwrites a listed source that a later copy still reads', () => {
    const items = plan({
      files: [A, B], names: { [A]: named('b'), [B]: named('z') }, destination: { mode: 'copy', folder: 'C:\\in' },
      conflict: 'replace', existing: new Set(['c:\\in\\a.pdf', 'c:\\in\\b.pdf']),
    });
    expect(items.map((i) => i.op)).toEqual([
      { kind: 'copy', from: A, to: 'C:\\in\\b (1).pdf' },
      { kind: 'copy', from: B, to: 'C:\\in\\z.pdf' },
    ]);
  });

  it('copy mode without a folder keeps a paired companion pending, not skipped', () => {
    const X = 'C:\\in\\x.xlsx';
    const items = plan({ files: [A, X], names: { [A]: named('DN-17') }, pairs: { [X]: A }, destination: { mode: 'copy', folder: '' } });
    expect(items.map((i) => i.status)).toEqual(['pending', 'pending']);
    expect(items[1].detail).toBe('Choose a folder to copy into.');
  });

  it('summary counts what will happen', () => {
    const items = plan({ files: [A, B, C], names: { [A]: named('1'), [B]: named('2'), [C]: failed('no-value', '') } });
    expect(summary(items, { mode: 'inplace' })).toEqual({ ops: 2, attention: 1, pending: 0, label: 'Rename 2 files' });
    expect(summary(items.slice(0, 1), { mode: 'copy', folder: 'D:\\' }).label).toBe('Copy 1 file');
  });

  describe('move and sort into folders', () => {
    const X = 'C:\\in\\a.xlsx';
    const move = (value: string, folder = 'C:\\out\\{value}') =>
      plan({ files: [A, X], names: { [A]: named('DN', value) }, pairs: { [X]: A }, destination: { mode: 'move', folder } });

    it('moves into the expanded folder as a rename; the companion goes beside its PDF', () => {
      const items = move('ACME/77');
      expect(items.map((i) => i.op)).toEqual([
        { kind: 'rename', from: A, to: 'C:\\out\\ACME_77\\DN.pdf' },
        { kind: 'rename', from: X, to: 'C:\\out\\ACME_77\\DN.xlsx' },
      ]);
      expect(items.map((i) => i.status)).toEqual(['ready', 'paired']);
      expect(summary(items, { mode: 'move', folder: 'C:\\out' }).label).toBe('Move 2 files');
    });

    it('a value that is dots lands in "_", never above the folder', () => {
      expect(move('..')[0].op?.to).toBe('C:\\out\\_\\DN.pdf');
      expect(move('.')[0].op?.to).toBe('C:\\out\\_\\DN.pdf');
    });

    it('copy sorts too: the same name in one folder gets (1), in another folder it keeps its name', () => {
      const items = plan({
        files: [A, B, C], names: { [A]: named('DN', 'x'), [B]: named('DN', 'x'), [C]: named('DN', 'y') },
        destination: { mode: 'copy', folder: 'D:\\{value}' },
      });
      expect(items.map((i) => i.op?.to)).toEqual(['D:\\x\\DN.pdf', 'D:\\x\\DN (1).pdf', 'D:\\y\\DN.pdf']);
    });

    it('a name taken in the target folder follows the conflict rule; a file leaving that folder frees its name', () => {
      const D = 'C:\\out\\x\\dn.pdf';
      const existing = new Set(['c:\\in\\a.pdf', 'c:\\out\\x\\dn.pdf']);
      const destination = { mode: 'move' as const, folder: 'C:\\out\\{value}' };
      expect(plan({ files: [A], names: { [A]: named('DN', 'x') }, existing, destination })[0].name).toBe('DN (1).pdf');
      const swap = plan({ files: [A, D], names: { [A]: named('DN', 'x'), [D]: named('a', 'y') }, existing, conflict: 'skip', destination });
      expect(swap.map((i) => i.op?.to)).toEqual(['C:\\out\\x\\DN.pdf', 'C:\\out\\y\\a.pdf']);
    });

    it('a typed name still wins; without a value its folder falls back to "_"', () => {
      const items = plan({ files: [A], overrides: { [A]: 'Mine' }, destination: { mode: 'move', folder: 'C:\\out\\{value}' } });
      expect(items[0].op?.to).toBe('C:\\out\\_\\Mine.pdf');
    });

    it('a typed companion name goes beside its PDF; with its PDF skipped it is skipped too', () => {
      const names = { [A]: named('DN', 'ACME') }, pairs = { [X]: A }, overrides = { [X]: 'Typed' };
      const destination = { mode: 'move' as const, folder: 'C:\\out\\{value}' };
      expect(plan({ files: [A, X], names, pairs, overrides, destination })[1]).toMatchObject({
        status: 'ready', name: 'Typed.xlsx', op: { kind: 'rename', from: X, to: 'C:\\out\\ACME\\Typed.xlsx' },
      });
      expect(plan({ files: [A, X], names, pairs, overrides, destination, skipped: new Set([A]) }).map((i) => [i.status, i.op])).toEqual([['skipped', null], ['skipped', null]]);
      expect(plan({ files: [A, X], pairs, overrides, destination })[1]).toMatchObject({ status: 'pending', op: null });
    });

    it('a typed name for a companion without a PDF stays in place, or falls back to "_" in a placeholder folder', () => {
      expect(plan({ files: [X], overrides: { [X]: 'Typed' } })[0].op?.to).toBe('C:\\in\\Typed.xlsx');
      expect(plan({ files: [X], overrides: { [X]: 'Typed' }, destination: { mode: 'move', folder: 'C:\\out\\{value}' } })[0].op?.to).toBe('C:\\out\\_\\Typed.xlsx');
      expect(plan({ files: [X], overrides: { [X]: 'Typed' }, destination: { mode: 'move', folder: 'C:\\out' } })[0].op?.to).toBe('C:\\out\\Typed.xlsx');
    });

    it('waits for a folder, naming the mode', () => {
      const names = { [A]: named('DN') };
      expect(plan({ files: [A], names, destination: { mode: 'move', folder: '' } })[0]).toMatchObject({ status: 'pending', detail: 'Choose a folder to move into.' });
      expect(plan({ files: [A], names, destination: { mode: 'copy', folder: '' } })[0].detail).toBe('Choose a folder to copy into.');
    });

    it('a file already in its target folder with its name is unchanged', () => {
      const P = 'C:\\out\\x\\DN.pdf';
      const same = plan({ files: [P], names: { [P]: named('DN', 'x') }, existing: new Set(['c:\\out\\x\\dn.pdf']), destination: { mode: 'move', folder: 'C:\\out\\{value}' } });
      expect(same[0]).toMatchObject({ status: 'unchanged', op: null });
    });
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

describe('readResults', () => {
  it('failures keep their reason, cancelled files stay untouched, a missing result is internal', () => {
    const D = 'C:\in\d.pdf';
    const items: PlanItem[] = [A, B, C, D].map((source, n) => ({
      id: source, source, status: 'ready' as const, op: { kind: 'rename' as const, from: source, to: `C:\in\N${n}.pdf` },
    }));
    const r = readResults(items, [
      { i: 1, ok: false, code: 'locked', message: 'os error 32' },
      { i: 0, ok: true },
      { i: 2, ok: false, code: 'cancelled' },
    ]);
    expect(r.done).toEqual([A]);
    expect(r.batch).toEqual([
      { from: A, to: 'C:\in\N0.pdf', ok: true },
      { from: B, to: 'C:\in\N1.pdf', ok: false, reason: 'locked' },
      { from: D, to: 'C:\in\N3.pdf', ok: false, reason: 'internal' },
    ]);
    expect(r.failed.map((f) => [f.source, f.reason, f.message])).toEqual([
      [B, 'locked', 'os error 32'],
      [D, 'internal', 'No result came back for this file.'],
    ]);
  });

  it('a file that moved but could not be journaled counts as done, with a warning', () => {
    const items: PlanItem[] = [{ id: A, source: A, status: 'ready', op: { kind: 'rename', from: A, to: 'C:\in\N.pdf' } }];
    const r = readResults(items, [{ i: 0, ok: false, code: 'internal', message: "done, but it can't be undone: disk full" }]);
    expect(r.done).toEqual([A]);
    expect(r.failed).toEqual([]);
    expect(r.batch).toEqual([{ from: A, to: 'C:\in\N.pdf', ok: true, reason: 'internal' }]);
    expect(r.warned).toEqual([{ source: A, message: "done, but it can't be undone: disk full" }]);
  });
});
