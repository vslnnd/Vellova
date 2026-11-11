import { describe, expect, it } from 'vitest';
import { batchSummary, mergeBatch } from '../src/lib/shared/store';
import { canZip, zipLayout, zipPath, zipSources } from '../src/lib/shared/zipPlan';
import type { Batch, BatchItem } from '../src/lib/shared/types';

const batch = (items: BatchItem[], over: Partial<Batch> = {}): Batch => ({ id: 'b', tool: 'rename', time: 1, verb: 'renamed', summary: '', items, undoable: true, ...over });
const ok = (to: string, extra: Partial<BatchItem> = {}): BatchItem => ({ from: 'C:\\in\\x', to, ok: true, ...extra });

describe('zipSources and canZip', () => {
  it('takes what the batch made: not failures, archived originals or the zip itself', () => {
    const b = batch([ok('C:\\out\\a.pdf'), { from: 'x', to: 'C:\\out\\b.pdf', ok: false }, ok('C:\\arch\\src.xlsx', { archived: true }), ok('C:\\out\\a.pdf')]);
    expect(zipSources(b)).toEqual(['C:\\out\\a.pdf']);
    expect(canZip(b)).toBe(true);
  });

  it('not twice, not after Undo, not with nothing made', () => {
    expect(canZip(batch([ok('C:\\out\\a.pdf'), { from: '', to: 'C:\\out\\z.zip', ok: true, zip: true }]))).toBe(false);
    expect(canZip(batch([ok('C:\\out\\a.pdf')], { undone: true }))).toBe(false);
    expect(canZip(batch([{ from: 'x', to: 'y', ok: false }]))).toBe(false);
    expect(canZip(undefined)).toBe(false);
  });
});

describe('zipLayout', () => {
  it('files of one folder are named plainly, in that folder', () => {
    expect(zipLayout(['C:\\out\\a.pdf', 'C:\\out\\b.pdf'])).toEqual({ dir: 'C:\\out', entries: [{ path: 'C:\\out\\a.pdf', name: 'a.pdf' }, { path: 'C:\\out\\b.pdf', name: 'b.pdf' }] });
  });

  it('files sorted into subfolders keep them, from the folder they share (any case, either slash)', () => {
    const l = zipLayout(['C:\\Out\\North\\a.xlsx', 'c:/out/South/a.xlsx']);
    expect(l.dir).toBe('C:\\Out');
    expect(l.entries.map((e) => e.name)).toEqual(['North/a.xlsx', 'South/a.xlsx']);
  });

  it('a single file goes beside itself', () => {
    expect(zipLayout(['C:\\out\\sub\\a.pdf'])).toEqual({ dir: 'C:\\out\\sub', entries: [{ path: 'C:\\out\\sub\\a.pdf', name: 'a.pdf' }] });
  });
});

describe('zipPath', () => {
  const at = new Date(2026, 10, 10, 21, 5);
  it('names the zip after the tool and the time, and steps past taken names', () => {
    expect(zipPath('C:\\out', 'rename', at, new Set())).toBe('C:\\out\\Rename_20261110_2105.zip');
    expect(zipPath('C:\\out', 'split', at, new Set(['c:\\out\\split_20261110_2105.zip']))).toBe('C:\\out\\Split_20261110_2105 (1).zip');
  });
});

describe('a zip in History', () => {
  const zipped = batch([ok('C:\\out\\a.pdf'), { from: '', to: 'C:\\out\\z.zip', ok: true, zip: true }]);
  it('is not counted as a file of the batch', () => {
    expect(batchSummary(zipped)).toBe('1 file renamed');
  });

  it('stays when fixes are merged into the batch', () => {
    const [merged] = mergeBatch([zipped], batch([{ from: 'C:\\in\\y', to: 'C:\\out\\c.pdf', ok: true }]));
    expect(merged.items.filter((i) => i.zip)).toHaveLength(1);
    expect(merged.summary).toBe('2 files renamed');
  });
});
