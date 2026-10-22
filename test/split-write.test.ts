import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { loadSource } from '../src/lib/split/engine/grid';
import { writeOutputs } from '../src/lib/split/engine/write';

const fx = (n: string) => new Uint8Array(readFileSync(`test/fixtures/split/${n}`));
const read = async (b: Uint8Array) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(b as unknown as ArrayBuffer);
  return wb;
};
const base = { sheet: null, header: 2, format: 'xlsx' as const, delimiter: ',' };
const people = [
  { person: 'Ana', rows: 2, groups: 1, share: 66.7 },
  { person: 'Ben', rows: 1, groups: 1, share: 33.3 },
];

describe('writeOutputs xlsx source', () => {
  it('keeps title block, styles, merges, widths, hidden and formats; formulas become their values', async () => {
    const src = await loadSource('.xlsx', fx('formatted.xlsx'));
    const [out] = await writeOutputs(src, { ...base, outputs: [{ kind: 'rows', rows: [3, 4, 5] }] });
    const ws = (await read(out)).worksheets[0];
    expect(ws.name).toBe('Report');
    expect(ws.rowCount).toBe(6);
    expect(ws.getCell('A3').value).toBe('Region');
    expect([4, 5, 6].map((r) => ws.getCell(`B${r}`).value)).toEqual([1001, 1002, 1003]);
    expect(ws.model.merges).toEqual(['A1:E1']);
    expect(ws.getColumn(5).hidden).toBe(true);
    expect(ws.getColumn(1).width).toBeGreaterThan(0);
    expect(ws.getCell('A3').font?.bold).toBe(true);
    expect(ws.getCell('A3').fill).toBeTruthy();
    expect(ws.getCell('D4').numFmt).toBe('#,##0.00');
    expect(ws.getCell('F4').value).toBe(200);
  });

  it('keeps a data-block merge only when both ends are in the output', async () => {
    const wb = new ExcelJS.Workbook();
    const w = wb.addWorksheet('S');
    w.addRows([['H1', 'H2'], ['a', 'x'], ['b', 'y'], ['c', 'z'], ['d', 'q']]);
    w.mergeCells('A3:A4');
    const src = { kind: 'xlsx' as const, wb };
    const o = { ...base, header: 0 };
    const [both, one] = await writeOutputs(src, {
      ...o,
      outputs: [{ kind: 'rows', rows: [1, 2, 3] }, { kind: 'rows', rows: [1, 3] }],
    });
    expect((await read(both)).worksheets[0].model.merges).toEqual(['A3:A4']);
    expect((await read(one)).worksheets[0].model.merges).toEqual([]);
    const [moved] = await writeOutputs(src, { ...o, outputs: [{ kind: 'rows', rows: [2, 3] }] });
    expect((await read(moved)).worksheets[0].model.merges).toEqual(['A2:A3']);
  });

  it('adds an Assigned to column and a Summary sheet', async () => {
    const src = await loadSource('.xlsx', fx('formatted.xlsx'));
    const [out] = await writeOutputs(src, {
      ...base,
      outputs: [{ kind: 'rows', rows: [3, 4], assigned: { 3: 'Ana', 4: 'Ben' }, summary: people }],
    });
    const wb = await read(out);
    const ws = wb.worksheets[0];
    const c = ws.columnCount;
    expect(ws.getRow(3).getCell(c).value).toBe('Assigned to');
    expect(ws.getRow(3).getCell(c).font?.bold).toBe(true);
    expect([4, 5].map((r) => ws.getRow(r).getCell(c).value)).toEqual(['Ana', 'Ben']);
    const s = wb.getWorksheet('Summary')!;
    expect(s.getRow(1).values).toEqual([undefined, 'Person', 'Rows', 'Groups', 'Share %']);
    expect(s.getRow(2).values).toEqual([undefined, 'Ana', 2, 1, 66.7]);
    expect(s.rowCount).toBe(3);
  });

  it('writes a summary-only workbook and a whole-sheet workbook', async () => {
    const src = await loadSource('.xlsx', fx('formatted.xlsx'));
    const [sum, sheet] = await writeOutputs(src, { ...base, outputs: [{ kind: 'summary', summary: people }, { kind: 'sheet', sheet: 'Report' }] });
    const a = await read(sum);
    expect(a.worksheets.map((w) => w.name)).toEqual(['Summary']);
    const b = (await read(sheet)).worksheets[0];
    expect(b.name).toBe('Report');
    expect(b.rowCount).toBe(44);
    expect(b.model.merges).toEqual(['A1:E1']);
    expect(b.getColumn(5).hidden).toBe(true);
  });

  it('writes csv with BOM, delimiter, quoting and CRLF', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('S').addRows([['a', 'b;c'], ['say "hi"', 'x\ny']]);
    const [out] = await writeOutputs({ kind: 'xlsx', wb }, { sheet: null, header: 0, format: 'csv', delimiter: ';', outputs: [{ kind: 'rows', rows: [1] }] });
    expect(out.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(new TextDecoder().decode(out.slice(3))).toBe('a;"b;c"\r\n"say ""hi""";"x\ny"');
  });
});

describe('writeOutputs values source', () => {
  it('turns csv numbers into numbers, keeps leading-zero columns as text', async () => {
    const src = await loadSource('.csv', fx('bom-semicolon.csv'));
    const [out] = await writeOutputs(src, { ...base, header: 0, outputs: [{ kind: 'rows', rows: [1, 2] }] });
    const ws = (await read(out)).worksheets[0];
    expect(ws.getCell('A1').value).toBe('ID');
    expect(ws.getCell('C2').value).toBe(1234.56);
    expect(ws.getCell('C3').value).toBe(78.9);
    expect(ws.getCell('A2').value).toBe('00123');
    expect(ws.getCell('A3').value).toBe('456');
  });

  it('keeps original text when written as csv', async () => {
    const src = await loadSource('.csv', fx('bom-semicolon.csv'));
    const [out] = await writeOutputs(src, { sheet: null, header: 0, format: 'csv', delimiter: ';', outputs: [{ kind: 'rows', rows: [1, 2] }] });
    expect(new TextDecoder().decode(out.slice(3))).toBe('ID;Name;Amount\r\n00123;Doe, Jane;1.234,56\r\n456;Test Person;78,90');
  });
});

describe('writeOutputs guards', () => {
  const mk = (merge: string, name = 'S') => {
    const wb = new ExcelJS.Workbook();
    const w = wb.addWorksheet(name);
    w.addRows([['H1', 'H2'], ['a', 'x'], ['b', 'y'], ['c', 'z'], ['d', 'q']]);
    w.mergeCells(merge);
    return { kind: 'xlsx' as const, wb };
  };
  const merges = async (src: ReturnType<typeof mk>, rows: number[], header = 0) => {
    const [o] = await writeOutputs(src, { ...base, header, outputs: [{ kind: 'rows', rows }] });
    return (await read(o)).worksheets[0].model.merges;
  };
  it('drops a merge with a gap, keeps contiguous ones', async () => {
    expect(await merges(mk('A2:A4'), [1, 3])).toEqual([]);
    expect(await merges(mk('A2:A4'), [1, 2, 3])).toEqual(['A2:A4']);
  });
  it('keeps a header-crossing merge only when rows follow unbroken', async () => {
    expect(await merges(mk('A1:A3'), [1, 2])).toEqual(['A1:A3']);
    expect(await merges(mk('A1:A3'), [2])).toEqual([]);
  });
  it('picks a free Summary sheet name', async () => {
    const src = mk('A2:A3', 'summary');
    const [o] = await writeOutputs(src, { ...base, header: 0, outputs: [{ kind: 'rows', rows: [1], summary: people }] });
    expect((await read(o)).worksheets.map((w) => w.name)).toEqual(['summary', 'Summary (2)']);
  });
  it('refuses a summary in a csv output', async () => {
    await expect(
      writeOutputs(mk('A2:A3'), { sheet: null, header: 0, format: 'csv', delimiter: ',', outputs: [{ kind: 'rows', rows: [1], summary: people }] }),
    ).rejects.toThrow("A summary can't be written");
  });
  it('splits 20,000 rows into 20 outputs quickly', { timeout: 20000 }, async () => {
    const rows = Array.from({ length: 20001 }, (_, r) => Array.from({ length: 10 }, (_, c) => (r === 0 ? `h${c}` : r * c)));
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('S').addRows(rows);
    const outputs = Array.from({ length: 20 }, (_, i) => ({ kind: 'rows' as const, rows: Array.from({ length: 1000 }, (_, j) => 1 + i * 1000 + j) }));
    for (const src of [{ kind: 'xlsx' as const, wb }, { kind: 'values' as const, sheets: [{ name: 'S', rows }] }]) {
      const t = Date.now();
      expect(await writeOutputs(src, { ...base, header: 0, outputs })).toHaveLength(20);
      expect(Date.now() - t).toBeLessThan(5000);
    }
  });
});
