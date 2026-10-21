import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadSource } from '../src/lib/split/engine/grid';
import { createHandler } from '../src/workers/sheetHandler';

const fx = (n: string) => new Uint8Array(readFileSync(`test/fixtures/split/${n}`));

describe('sheet worker handler', () => {
  it('parses once per key for grid then write', async () => {
    const load = vi.fn(loadSource);
    const handle = createHandler(load);
    const g = await handle({ id: 1, op: 'grid', key: 'a|1|1', ext: '.xlsx', bytes: fx('simple.xlsx'), sheet: null });
    expect(g.error).toBeUndefined();
    expect((g.data as { rows: string[][] }).rows.length).toBeGreaterThan(0);
    const w = await handle({
      id: 2, op: 'write', key: 'a|1|1', ext: '.xlsx', bytes: fx('simple.xlsx'),
      req: { sheet: null, header: 0, format: 'xlsx', delimiter: ',', outputs: [{ kind: 'rows', rows: [1] }] },
    });
    expect(w.id).toBe(2);
    expect((w.data as Uint8Array[]).length).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps at most 3 sources', async () => {
    const load = vi.fn(loadSource);
    const handle = createHandler(load);
    for (const k of ['1', '2', '3', '4', '1'])
      await handle({ id: 1, op: 'grid', key: k, ext: '.xlsx', bytes: fx('simple.xlsx'), sheet: null });
    expect(load).toHaveBeenCalledTimes(5);
  });

  it('replies with an error for a broken file and a missing sheet', async () => {
    const handle = createHandler();
    const bad = await handle({ id: 3, op: 'grid', key: 'bad', ext: '.xlsx', bytes: new Uint8Array([1, 2, 3]), sheet: null });
    expect(bad.id).toBe(3);
    expect(typeof bad.error).toBe('string');
    const miss = await handle({ id: 4, op: 'grid', key: 'ok', ext: '.xlsx', bytes: fx('simple.xlsx'), sheet: 'Nope' });
    expect(miss.error).toBe('Sheet not found: Nope');
  });

  it('still answers companion requests without op', async () => {
    const handle = createHandler();
    const r = await handle({ id: 5, ext: '.csv', bytes: new TextEncoder().encode('a,b\n1,2\n') });
    expect(r.id).toBe(5);
    expect(r.error).toBeUndefined();
  });
});
