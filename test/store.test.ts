import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS, lastUndoable, loadJson, logToText, mergeBatch, parseLog, pruneLog, withDefaults,
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

  it('merges fixes into the same batch, later results win', () => {
    let h = mergeBatch([], batch('b1', [{ from: 'b', to: 'B', ok: false, reason: 'locked' }], { undoable: false }));
    h = mergeBatch(mergeBatch(h, batch('b0', [])), batch('b1', [{ from: 'b', to: 'B', ok: true }]));
    expect(h.map((b) => b.id)).toEqual(['b1', 'b0']);
    expect(h[0].items).toEqual([{ from: 'b', to: 'B', ok: true }]);
    expect(h[0].undoable).toBe(true);
    expect(h[0].summary).toBe('1 file renamed');
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
});
