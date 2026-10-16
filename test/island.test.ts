import { describe, expect, it } from 'vitest';
import { chips, INITIAL, layer, layerText, reduce, TIMEOUT_MS, type IslandEvent, type IslandState } from '../src/lib/shell/island';

const run = (...events: IslandEvent[]) => events.reduce(reduce, INITIAL);
const start: IslandEvent = { type: 'start', label: 'Renaming', total: 12, cancellable: true };

describe('island', () => {
  it('idles on the tools with no chips', () => {
    expect(layer(INITIAL)).toBe('tools');
    expect(chips(INITIAL)).toEqual([]);
  });

  it('shows progress while working', () => {
    const s = run(start, { type: 'progress', done: 2, total: 12 });
    expect(layer(s)).toBe('working');
    expect(layerText(s)).toBe('Renaming 3 of 12');
    expect(layerText(run({ type: 'start', label: 'Undoing', total: 0, cancellable: false }))).toBe('Undoing…');
  });

  it('a clean batch shows done, then folds into the Undo chip', () => {
    const done = run(start, { type: 'finish', text: '12 files renamed', attention: 0 });
    expect(layer(done)).toBe('done');
    expect(layerText(done)).toBe('12 files renamed');
    const folded = reduce(done, { type: 'collapse' });
    expect(layer(folded)).toBe('tools');
    expect(chips(folded)).toEqual(['done']);
  });

  it('attention outranks done; chips are ordered attention, undo, update', () => {
    let s = run(start, { type: 'finish', text: '9 files renamed', attention: 3 });
    expect(layer(s)).toBe('attention');
    expect(layerText(s)).toBe('3 files need attention');
    s = reduce(s, { type: 'updateReady', version: '0.2.0' });
    expect(layer(s)).toBe('attention');
    s = reduce(s, { type: 'collapse' });
    expect(chips(s)).toEqual(['attention', 'done', 'update']);
  });

  it('working outranks every notice, and starting folds the open one', () => {
    const s = run({ type: 'updateReady', version: '0.2.0' }, start);
    expect(layer(s)).toBe('working');
    expect(layer(reduce(s, { type: 'stop' }))).toBe('tools');
    expect(chips(reduce(s, { type: 'stop' }))).toEqual(['update']);
  });

  it('fixing every file clears the attention notice', () => {
    const s = run(start, { type: 'finish', text: null, attention: 1 }, { type: 'attention', count: 0 });
    expect(layer(s)).toBe('tools');
    expect(chips(s)).toEqual([]);
  });

  it('undo shows restored briefly and removes the Undo chip', () => {
    const s = run(start, { type: 'finish', text: '2 files renamed', attention: 0 }, { type: 'collapse' }, { type: 'restored', text: '2 names restored' });
    expect(layer(s)).toBe('restored');
    expect(layerText(s)).toBe('2 names restored');
    expect(chips(reduce(s, { type: 'collapse' }))).toEqual([]);
  });

  it('restarting wins over everything', () => {
    const s: IslandState = run(start, { type: 'restarting' });
    expect(layer(s)).toBe('restarting');
  });

  it('uses the spec timings', () => {
    expect(TIMEOUT_MS).toEqual({ done: 4000, attention: 6000, update: 3500, restored: 2200 });
  });

  it('reset clears the tour batch but keeps a ready update', () => {
    const s = run(start, { type: 'finish', text: '6 files renamed', attention: 1 }, { type: 'updateReady', version: '0.1.1' });
    const r = reduce(s, { type: 'reset' });
    expect(r.done).toBeNull();
    expect(r.attention).toBe(0);
    expect(r.update).toBe('0.1.1');
    expect(layer(r)).toBe('tools');
  });
});
