import { describe, it, expect } from 'vitest';
import { byValue, evenBlocks, keepGroups, fixedRows, equalParts } from '../src/lib/split/engine/modes';

const P = (name: string, weight = 1) => ({ name, weight });

describe('byValue', () => {
  it('groups, unmatched, excluded', () => {
    const r = byValue([' 1001 ', '1002', 'X', '1003', '1001'], [
      { value: '1001', label: 'North', payable: true },
      { value: '1003', label: '', payable: true },
      { value: '1002', label: 'South', payable: false },
    ]);
    expect(r.groups).toEqual([
      { key: 'North', rows: [0, 4], values: ['1001'] },
      { key: '1003', rows: [3], values: ['1003'] },
    ]);
    expect(r.unmatched).toEqual([2]);
    expect(r.excluded).toEqual([1]);
  });
  it('is case-insensitive', () => {
    const r = byValue(['ABC'], [{ value: 'abc', label: '', payable: true }]);
    expect(r.groups[0].rows).toEqual([0]);
  });
  it('sorts merged values', () => {
    const r = byValue(['b', 'a'], [
      { value: 'b', label: 'G', payable: true },
      { value: 'a', label: 'G', payable: true },
    ]);
    expect(r.groups).toEqual([{ key: 'G', rows: [0, 1], values: ['a', 'b'] }]);
  });
});

describe('evenBlocks', () => {
  it('splits by weight', () => {
    expect(evenBlocks(10, [P('A'), P('B'), P('C')])).toEqual([4, 3, 3]);
    expect(evenBlocks(7, [P('A', 2), P('B')])).toEqual([5, 2]);
    expect(evenBlocks(0, [P('A'), P('B')])).toEqual([0, 0]);
    expect(evenBlocks(4, [P('A', 0), P('B', 0)])).toEqual([2, 2]);
  });
});

describe('keepGroups', () => {
  it('assigns whole groups', () => {
    const r = keepGroups(['a', 'a', 'a', 'b', 'b', 'c'], [P('A'), P('B')]);
    expect(r.person).toEqual([0, 0, 0, 1, 1, 1]);
    expect(r.groups).toEqual([1, 2]);
    expect(r.warnings).toEqual([]);
  });
  it('warns on oversized group, never splits', () => {
    const keys = [...Array(8).fill('big'), 's', 't'];
    const r = keepGroups(keys, [P('A'), P('B')]);
    expect(r.person.slice(0, 8)).toEqual(Array(8).fill(0));
    expect(r.warnings).toEqual(['"big" has 8 rows, more than A\'s share of 5.']);
  });
  it('blank key is its own group; ties go to earlier', () => {
    const r = keepGroups(['', 'x'], [P('A'), P('B')]);
    expect(r.person).toEqual([0, 1]);
  });
});

describe('fixedRows / equalParts', () => {
  it('sizes', () => {
    expect(fixedRows(10, 4)).toEqual([4, 4, 2]);
    expect(equalParts(10, 3)).toEqual([4, 3, 3]);
    expect(equalParts(2, 5)).toEqual([1, 1]);
  });
});
