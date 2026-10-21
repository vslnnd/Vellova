import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gridOf, loadSource, type Grid } from '../src/lib/split/engine/grid';
import { colLetter, findColumn, headerInfo } from '../src/lib/split/engine/header';

const load = async (n: string) => gridOf(await loadSource('.xlsx', new Uint8Array(readFileSync(`test/fixtures/split/${n}`))), null);
const mk = (rows: string[][]): Grid => ({ sheets: [], sheet: 'S', rows, merges: [] });
const def = { mode: 'default' } as const;

describe('headerInfo', () => {
  it('default on simple.xlsx', async () => {
    const h = headerInfo(await load('simple.xlsx'), def);
    expect(h.row).toBe(0);
    expect(h.data).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(h.warnings).toEqual([]);
    expect(h.columns.every((c) => c.samples.length <= 5 && new Set(c.samples).size === c.samples.length)).toBe(true);
  });

  it('samples are up to 5 distinct non-empty values', () => {
    const h = headerInfo(mk([['A'], ['x'], [''], ['x'], ['y'], ['z'], ['1'], ['2'], ['3']]), def);
    expect(h.columns[0].samples).toEqual(['x', 'y', 'z', '1', '2']);
  });

  it('default on a title row warns', async () => {
    const w = headerInfo(await load('formatted.xlsx'), def).warnings;
    expect(w.some((x) => x.includes('Row 1') && x.includes('empty column names'))).toBe(true);
  });

  it('manual row 3 on formatted.xlsx', async () => {
    const h = headerInfo(await load('formatted.xlsx'), { mode: 'manual', row: 3 });
    expect(h.row).toBe(2);
    expect(h.data).toHaveLength(40);
    expect(h.data).not.toContain(19);
    expect(h.warnings).toEqual([]);
  });

  it('numeric header looks like data', () => {
    expect(headerInfo(mk([['1', '2', 'x'], ['a']]), def).warnings).toContain('Row 1 looks like data. Is the header on another row?');
  });

  it('duplicates and findColumn', () => {
    const h = headerInfo(mk([['Amount', 'Amount'], ['1', '2']]), def);
    expect(h.warnings).toEqual(['Row 1 repeats the column name "Amount".']);
    expect(findColumn(h.columns, ' amount ')).toBe(h.columns[0]);
  });

  it('empty names and past the end', () => {
    const h = headerInfo(mk([['A', 'B', '', 'D'], ['1']]), def);
    expect(h.columns[2].name).toBe('Column C');
    expect(h.warnings).toEqual(['Row 1 has 1 empty column names.']);
    expect(headerInfo(mk([['A']]), { mode: 'manual', row: 99 })).toEqual({
      row: 98, columns: [], data: [], warnings: ['Row 99 is past the end of the sheet.'],
    });
  });

  it('colLetter', () => {
    expect([0, 25, 26, 27, 701, 702].map(colLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
});
