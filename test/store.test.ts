import { describe, expect, it, vi } from 'vitest';
import {
  batchSummary, DEFAULT_SETTINGS, lastUndoable, loadJson, logToText, mergeBatch, normalizeProfiles, parseLog, pruneLog, putBackBatch, withDefaults,
  type DataIO, type LogEntry,
} from '../src/lib/shared/store';
import type { Batch } from '../src/lib/shared/types';

function fakeIO(files: Record<string, string>): DataIO & { renamed: [string, string][] } {
  const renamed: [string, string][] = [];
  return {
    renamed,
    read: async (n) => files[n] ?? null,
    write: async (n, t) => void (files[n] = t),
    rename: async (from, to) => void renamed.push([from, to]),
  };
}
const NOW = new Date('2026-10-15T12:00:00.000Z');
const isObj = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);

describe('loadJson', () => {
  it('returns the fallback when the file does not exist', async () => {
    const io = fakeIO({});
    expect(await loadJson(io, 'settings.json', { a: 1 }, isObj, vi.fn())).toEqual({ a: 1 });
    expect(io.renamed).toEqual([]);
  });

  it('returns the saved value', async () => {
    expect(await loadJson(fakeIO({ 'settings.json': '{"a":2}' }), 'settings.json', { a: 1 }, isObj, vi.fn())).toEqual({ a: 2 });
  });

  it.each([['broken JSON', '{"a":'], ['wrong shape', '[1,2]']])('sets aside %s and starts with defaults', async (_, text) => {
    const io = fakeIO({ 'settings.json': text });
    const onCorrupt = vi.fn();
    expect(await loadJson(io, 'settings.json', { a: 1 }, isObj, onCorrupt, NOW)).toEqual({ a: 1 });
    expect(io.renamed).toEqual([['settings.json', 'settings.corrupt-2026-10-15T12-00-00-000Z.json']]);
    expect(onCorrupt).toHaveBeenCalledWith('settings.json', 'settings.corrupt-2026-10-15T12-00-00-000Z.json');
  });
});

describe('loadJson failures', () => {
  it('rejects when the file cannot be read, so the caller leaves it alone', async () => {
    const io = { ...fakeIO({}), read: async () => { throw new Error('locked'); } };
    await expect(loadJson(io, 'settings.json', {}, isObj, vi.fn())).rejects.toThrow('locked');
  });

  it('rejects when a bad file cannot be set aside, without reporting it as set aside', async () => {
    const io = { ...fakeIO({ 'settings.json': '{"a":' }), rename: async () => { throw new Error('antivirus lock'); } };
    const onCorrupt = vi.fn();
    await expect(loadJson(io, 'settings.json', {}, isObj, onCorrupt, NOW)).rejects.toThrow('antivirus lock');
    expect(onCorrupt).not.toHaveBeenCalled();
  });
});

describe('settings defaults', () => {
  it('fills missing and nested values', () => {
    expect(withDefaults({ theme: 'light', updates: { everyHours: 24 } })).toEqual({
      ...DEFAULT_SETTINGS, theme: 'light', updates: { onStartup: true, everyHours: 24 },
    });
    expect(withDefaults('nonsense')).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults and merges the split settings', () => {
    expect(withDefaults({}).split).toEqual({ archive: false, favourites: [], folder: '' });
    expect(withDefaults({ split: { archive: true } }).split).toEqual({ archive: true, favourites: [], folder: '' });
  });

  it('checks every split setting by type', () => {
    expect(withDefaults({ split: { archive: 'yes', favourites: ['a', 3, 'a', 'b'], folder: 7, extra: 1 } }).split)
      .toEqual({ archive: false, favourites: ['a', 'b'], folder: '' });
    expect(withDefaults({ split: { favourites: 'a', folder: 'C:\out' } }).split).toEqual({ archive: false, favourites: [], folder: 'C:\out' });
    expect(withDefaults({ split: [] }).split).toEqual({ archive: false, favourites: [], folder: '' });
  });
});

describe('profiles', () => {
  it('loads split profiles as [] when missing, and checks each one', () => {
    expect(normalizeProfiles({ rename: [] })).toEqual({ rename: [], split: [] });
    const p = normalizeProfiles({ rename: [], split: [{ id: 'p', name: 'Q3', rules: { mode: 'rows' } }, { name: 'no id' }, 5] });
    expect(p.split).toHaveLength(1);
    expect(p.split[0]).toMatchObject({ id: 'p', name: 'Q3', desc: '', archiveFolder: null, rules: { mode: 'rows', rows: 1000 } });
  });
});

describe('log', () => {
  const e = (t: number, message = 'm'): LogEntry => ({ t, level: 'warn', tool: 'rename', message });

  it('keeps 30 days and at most 1000 entries', () => {
    const now = NOW.getTime();
    const old = e(now - 31 * 86_400_000, 'old');
    const many = Array.from({ length: 1200 }, (_, i) => e(now - i));
    const kept = pruneLog([old, ...many], now);
    expect(kept).toHaveLength(1000);
    expect(kept.some((x) => x.message === 'old')).toBe(false);
    expect(kept.at(-1)).toEqual(many.at(-1));
  });

  it('skips damaged lines', () => {
    expect(parseLog('{"t":1,"level":"info","tool":"app","message":"a"}\nnot json\n{"x":1}')).toEqual([
      { t: 1, level: 'info', tool: 'app', message: 'a' },
    ]);
    expect(parseLog(null)).toEqual([]);
  });

  it('exports tab-separated lines', () => {
    expect(logToText([{ t: NOW.getTime(), level: 'error', tool: 'rename', file: 'C:\\a.pdf', message: 'locked', detail: 'os error 32' }]))
      .toBe('2026-10-15T12:00:00.000Z\tERROR\trename\tC:\\a.pdf\tlocked\tos error 32');
  });
});

describe('history', () => {
  const batch = (id: string, items: Batch['items'], extra: Partial<Batch> = {}): Batch =>
    ({ id, tool: 'rename', time: 1, verb: 'renamed', summary: '', items, undoable: true, ...extra });

  it('adds a batch on top with a summary', () => {
    const h = mergeBatch([], batch('b1', [{ from: 'a', to: 'A', ok: true }, { from: 'b', to: 'B', ok: false, reason: 'locked' }]));
    expect(h[0].summary).toBe('1 file renamed · 1 failed');
  });

  it('counts items recorded before the batch ran, with no result yet, as unfinished', () => {
    const h = mergeBatch([], batch('b1', [{ from: 'a', to: 'A', ok: true }, { from: 'b', to: 'B', ok: false, pending: true }]));
    expect(h[0].summary).toBe('1 file renamed · 1 unfinished');
  });

  it('merges fixes into the same batch, later results win', () => {
    let h = mergeBatch([], batch('b1', [{ from: 'b', to: 'B', ok: false, reason: 'locked' }], { undoable: false }));
    h = mergeBatch(mergeBatch(h, batch('b0', [])), batch('b1', [{ from: 'b', to: 'B', ok: true }]));
    expect(h.map((b) => b.id)).toEqual(['b1', 'b0']);
    expect(h[0].items).toEqual([{ from: 'b', to: 'B', ok: true }]);
    expect(h[0].undoable).toBe(true);
    expect(h[0].summary).toBe('1 file renamed');
  });

  it('puts back only the given batch, keeping changes made to the others meanwhile', () => {
    const old = batch('b1', [{ from: 'a', to: 'A', ok: false, reason: 'locked' }]);
    const now = [batch('b1', [{ from: 'a', to: 'A', ok: false, pending: true }]), batch('b2', []), batch('b0', [])];
    expect(putBackBatch(now, 'b1', old)).toEqual([old, now[1], now[2]]);
    expect(putBackBatch(now, 'b1', undefined).map((b) => b.id)).toEqual(['b2', 'b0']);
  });

  const split = (id: string, items: Batch['items']): Batch => batch(id, items, { tool: 'split', verb: 'created' });

  it('counts archived split items as files and names them', () => {
    const h = mergeBatch([], split('s1', [
      { from: 'a', to: 'A1', ok: true }, { from: 'a', to: 'A2', ok: true }, { from: 'b', to: 'B1', ok: true },
      { from: 'a', to: 'arch\a', ok: true, archived: true }, { from: 'b', to: 'B2', ok: false, reason: 'locked' },
    ]));
    expect(h[0].summary).toBe('4 files created · 1 archived · 1 failed');
    expect(batchSummary(split('s2', [{ from: 'a', to: 'A1', ok: true }]))).toBe('1 file created');
  });

  it('merges split fixes by target, dropping earlier failures of the same source', () => {
    let h = mergeBatch([], split('s1', [
      { from: 'a', to: 'A1', ok: true }, { from: 'a', to: 'A2', ok: false, reason: 'locked' }, { from: 'b', to: 'B1', ok: false, reason: 'locked' },
    ]));
    h = mergeBatch(h, split('s1', [{ from: 'a', to: 'A2b', ok: true }, { from: 'c', to: 'B1', ok: true }]));
    expect(h[0].items).toEqual([{ from: 'a', to: 'A1', ok: true }, { from: 'a', to: 'A2b', ok: true }, { from: 'c', to: 'B1', ok: true }]);
  });

  it('keeps the last 200 batches', () => {
    let h: Batch[] = [];
    for (let i = 0; i < 205; i++) h = mergeBatch(h, batch(`b${i}`, []));
    expect(h).toHaveLength(200);
    expect(h[0].id).toBe('b204');
  });

  it('finds the newest batch that can still be undone', () => {
    const h = [batch('b3', [], { undoable: false }), batch('b2', [], { undone: true }), batch('b1', [])];
    expect(lastUndoable(h)?.id).toBe('b1');
    expect(lastUndoable([])).toBeUndefined();
  });

  it('drops a tour marker that is not a well-formed object', () => {
    expect(withDefaults({ tour: 'C:\\Windows' }).tour).toBeNull();
    expect(withDefaults({ tour: { dir: 5 } }).tour).toBeNull();
    expect(withDefaults({ tour: { dir: 'C:\\Temp\\vellova-tour-1', batch: 'b', profile: null } }).tour).toEqual({ dir: 'C:\\Temp\\vellova-tour-1', batch: 'b', profile: null });
    expect(withDefaults({}).tour).toBeNull();
  });

  it('keeps a tour marker `ended` only when it is a boolean', () => {
    const t = { dir: 'C:\\Temp\\vellova-tour-1', batch: null, profile: null };
    expect(withDefaults({ tour: { ...t, ended: true } }).tour).toEqual({ ...t, ended: true });
    expect(withDefaults({ tour: { ...t, ended: 'yes' } }).tour).toEqual(t);
  });
});
