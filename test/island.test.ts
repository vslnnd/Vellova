import { describe, expect, it } from 'vitest';
import { chips, INITIAL, layer, layerText, openTarget, reduce, TIMEOUT_MS, type IslandEvent, type IslandState } from '../src/lib/shell/island';

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

  it('finish carries what Open folder and Open file act on, and reset clears it', () => {
    const open = { folder: 'C:\\out', file: null };
    const s = run(start, { type: 'finish', text: '2 files renamed', attention: 0, open });
    expect(s.opened).toEqual(open);
    expect(run(start, { type: 'finish', text: '2 files renamed', attention: 0 }).opened).toBeNull();
    expect(reduce(s, { type: 'reset' }).opened).toBeNull();
    expect(reduce(s, { type: 'restored', text: '2 names restored' }).opened).toBeNull();
  });

  it('restored with keep shows the message but leaves the batch undoable', () => {
    const open = { folder: 'C:\\out', file: null };
    const s = run(start, { type: 'finish', text: '2 files renamed', attention: 0, open });
    const kept = reduce(s, { type: 'restored', text: "Couldn't open · see History › Log", keep: true });
    expect(layer(kept)).toBe('restored');
    expect(kept.done).toBe('2 files renamed');
    expect(kept.opened).toEqual(open);
    expect(chips(reduce(kept, { type: 'collapse' }))).toEqual(['done']);
    const plain = reduce(s, { type: 'restored', text: '2 names restored' });
    expect(plain.done).toBeNull();
    expect(chips(reduce(plain, { type: 'collapse' }))).toEqual([]);
  });

  it('openTarget: none, one file, several files, a drive root', () => {
    expect(openTarget([])).toBeNull();
    expect(openTarget(['C:\\out\\a.pdf'])).toEqual({ folder: 'C:\\out', file: 'C:\\out\\a.pdf' });
    expect(openTarget(['C:\\out\\a.pdf', 'D:\\other\\b.pdf'])).toEqual({ folder: 'C:\\out', file: null });
    expect(openTarget(['C:\\a.pdf'])?.folder).toBe('C:\\');
  });
});
