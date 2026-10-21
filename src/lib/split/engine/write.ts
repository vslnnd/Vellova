import ExcelJS from 'exceljs';
import { csvNumber, gridOf, type Source } from './grid';
import type { OutSpec, SummaryRow } from './planner';

export type WriteReq = { sheet: string | null; header: number; format: 'xlsx' | 'csv'; delimiter: string; outputs: OutSpec[] };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function copyStyle(s: ExcelJS.Cell, d: ExcelJS.Cell) {
  try {
    if (s.font) d.font = clone(s.font);
    if (s.fill) d.fill = clone(s.fill);
    if (s.border) d.border = clone(s.border);
    if (s.alignment) d.alignment = clone(s.alignment);
    if (s.numFmt) d.numFmt = s.numFmt;
    if (s.protection) d.protection = clone(s.protection);
  } catch {
    // a style that will not copy is dropped, the value still lands
  }
}

function copyRow(src: ExcelJS.Row, dest: ExcelJS.Worksheet, n: number) {
  const d = dest.getRow(n);
  if (src.height) d.height = src.height;
  src.eachCell({ includeEmpty: true }, (s, col) => {
    const c = d.getCell(col);
    if (s.type === ExcelJS.ValueType.Formula) c.value = { formula: s.formula, result: s.result } as ExcelJS.CellFormulaValue;
    else if (s.type === ExcelJS.ValueType.RichText || s.type === ExcelJS.ValueType.Hyperlink) c.value = clone(s.value);
    else c.value = s.value;
    copyStyle(s, c);
  });
  d.commit();
}

/** An ExcelJS sheet from plain values; csv sources get real numbers below the header (leading-zero ID columns stay text). */
function sheetFromValues(name: string, rows: unknown[][], header: number, delimiter?: string): ExcelJS.Worksheet {
  const ws = new ExcelJS.Workbook().addWorksheet(name);
  const decimal = delimiter === ';' ? ',' : '.';
  const text = new Set<number>();
  if (delimiter)
    rows.forEach((r, i) => {
      if (i > header) r.forEach((v, c) => typeof v === 'string' && /^0\d/.test(v.trim()) && text.add(c));
    });
  rows.forEach((r, i) =>
    ws.addRow(r.map((v, c) => {
      if (delimiter && i > header && typeof v === 'string' && !text.has(c)) return csvNumber(v, decimal) ?? v;
      return v ?? null;
    })),
  );
  return ws;
}

function summarySheet(wb: ExcelJS.Workbook, rows: SummaryRow[]) {
  const ws = wb.addWorksheet('Summary');
  ws.addRow(['Person', 'Rows', 'Groups', 'Share %']).font = { bold: true };
  rows.forEach((r) => ws.addRow([r.person, r.rows, r.groups, r.share]));
}

/** srcRows are sheet row numbers (1-based) in output order; merges survive only when both ends are in the output. */
function buildSheet(wb: ExcelJS.Workbook, src: ExcelJS.Worksheet, srcRows: number[], assigned?: string[]) {
  const out = wb.addWorksheet(src.name);
  try {
    src.columns?.forEach((col, i) => {
      if (!col) return;
      const oc = out.getColumn(i + 1);
      if (col.width) oc.width = col.width;
      if (col.hidden) oc.hidden = col.hidden;
      if (col.style) oc.style = clone(col.style);
    });
  } catch {
    // files without column definitions
  }
  const map = new Map(srcRows.map((r, i) => [r, i + 1]));
  for (const m of src.model.merges ?? []) {
    try {
      const x = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m);
      if (!x) continue;
      const a = map.get(Number(x[2]));
      const b = map.get(Number(x[4]));
      if (a && b) out.mergeCells(`${x[1]}${a}:${x[3]}${b}`);
    } catch {
      // an unmergeable range is skipped
    }
  }
  srcRows.forEach((r, i) => copyRow(src.getRow(r), out, i + 1));
  return out;
}

function csvBytes(rows: string[][], delimiter: string): Uint8Array {
  const q = (s: string) => (s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return new TextEncoder().encode('﻿' + rows.map((r) => r.map(q).join(delimiter)).join('\r\n'));
}

export async function writeOutputs(src: Source, req: WriteReq): Promise<Uint8Array[]> {
  const { header, format } = req;
  const grid = gridOf(src, req.sheet);
  const sheetOf = (name: string) =>
    src.kind === 'xlsx'
      ? src.wb.worksheets.find((w) => w.name === name)!
      : sheetFromValues(name, src.sheets.find((s) => s.name === name)!.rows, header, src.delimiter);
  const summaryRows = (s: SummaryRow[]) => [['Person', 'Rows', 'Groups', 'Share %'], ...s.map((r) => [r.person, String(r.rows), String(r.groups), String(r.share)])];
  const result: Uint8Array[] = [];

  for (const spec of req.outputs) {
    if (format === 'csv') {
      let rows: string[][];
      if (spec.kind === 'summary') rows = summaryRows(spec.summary);
      else if (spec.kind === 'sheet') rows = gridOf(src, spec.sheet).rows;
      else {
        const idx = [...Array.from({ length: header + 1 }, (_, i) => i), ...spec.rows];
        rows = idx.map((r, i) => {
          const row = [...(grid.rows[r] ?? [])];
          if (spec.assigned) {
            const w = Math.max(...Array.from({ length: header + 1 }, (_, h) => grid.rows[h]?.length ?? 0));
            while (row.length < w) row.push('');
            row.push(i === header ? 'Assigned to' : i > header ? (spec.assigned[r] ?? '') : '');
          }
          return row;
        });
      }
      result.push(csvBytes(rows, req.delimiter));
      continue;
    }

    const wb = new ExcelJS.Workbook();
    wb.modified = new Date();
    if (spec.kind === 'summary') summarySheet(wb, spec.summary);
    else if (spec.kind === 'sheet') {
      const ws = sheetOf(spec.sheet);
      buildSheet(wb, ws, Array.from({ length: ws.rowCount }, (_, i) => i + 1));
    } else {
      const ws = sheetOf(grid.sheet);
      const idx = [...Array.from({ length: header + 1 }, (_, i) => i), ...spec.rows];
      const out = buildSheet(wb, ws, idx.map((r) => r + 1));
      if (spec.assigned) {
        const col = ws.columnCount + 1;
        const h = out.getRow(header + 1).getCell(col);
        h.value = 'Assigned to';
        copyStyle(ws.getRow(header + 1).getCell(col - 1), h);
        spec.rows.forEach((r, i) => (out.getRow(header + 2 + i).getCell(col).value = spec.assigned![r] ?? ''));
      }
      if (spec.summary) summarySheet(wb, spec.summary);
    }
    result.push(new Uint8Array(await wb.xlsx.writeBuffer()));
  }
  return result;
}
