import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ undo: vi.fn() }));
vi.mock('../src/lib/shared/ipc', () => ({
  ipc: { undoBatch: (id: string) => m.undo(id), dataWrite: async () => {} },
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', {});
});

const batch = (id: string) => ({ id, tool: 'rename' as const, time: 1, verb: 'renamed', profile: undefined, items: [], undoable: true });

describe('undoLast', () => {
  it('does not retry a partly undone batch, and moves on to the next one', async () => {
    const b = await import('../src/lib/shared/batches');
    const s = await import('../src/lib/shared/state.svelte');
    const i = await import('../src/lib/shell/islandState.svelte');
    b.recordBatch(batch('old'));
    b.recordBatch(batch('new'));
    m.undo.mockResolvedValue({ restored: 1, skipped: [{ path: 'C:\a.txt', reason: 'changed' }] });
    await b.undoLast();
    i.send({ type: 'clearTransient' });
    await b.undoLast();
    expect(m.undo.mock.calls.map((c) => c[0])).toEqual(['new', 'old']);
    expect(s.data.history.every((h) => !h.undone)).toBe(true);
    i.send({ type: 'clearTransient' });
    await b.undoLast();
    expect(m.undo).toHaveBeenCalledTimes(2);
    await b.undoBatch('new'); // the explicit Undo button still works
    expect(m.undo).toHaveBeenCalledTimes(3);
  });
});

describe('undo text', () => {
  it('says names restored for Rename and changes undone for Split', async () => {
    const b = await import('../src/lib/shared/batches');
    const i = await import('../src/lib/shell/islandState.svelte');
    m.undo.mockResolvedValue({ restored: 3, skipped: [] });
    b.recordBatch({ ...batch('r'), tool: 'rename' });
    await b.undoBatch('r');
    expect(i.island.transient?.text).toBe('3 names restored');
    i.send({ type: 'clearTransient' });
    b.recordBatch({ ...batch('s'), tool: 'split', verb: 'created' });
    await b.undoBatch('s');
    expect(i.island.transient?.text).toBe('3 changes undone');
  });
});
