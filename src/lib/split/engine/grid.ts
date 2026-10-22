import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';

export type Grid = { sheets: { name: string; rows: number }[]; sheet: string; rows: string[][]; merges: string[]; delimiter?: string };
export type Source =
  | { kind: 'xlsx'; wb: ExcelJS.Workbook }
  | { kind: 'values'; sheets: { name: string; rows: unknown[][] }[]; delimiter?: string };

const pad = (n: number) => String(n).padStart(2, '0');

/** Cell text as Splitify read it: rich text joined, formulas by their result, dates as yyyy-MM-dd (UTC). */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return o.richText.map((p) => String((p as { text?: unknown }).text ?? '')).join('');
    if ('formula' in o || 'sharedFormula' in o) return cellText(o.result);
    if ('text' in o) return cellText(o.text);
    if ('error' in o) return String(o.error);
  }
  return String(v);
}

export function decodeCsv(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1250' | 'windows-1252'; delimiter: ',' | ';' | '\t' } {
  let encoding: 'utf-8' | 'windows-1250' | 'windows-1252' = 'utf-8';
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (!bom) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      // ponytail: byte heuristic for 1250 vs 1252; add a manual encoding picker if a real file is misread
      const has = (set: number[]) => bytes.some((b) => set.includes(b));
      encoding = has([0xe8, 0xe6, 0xf0, 0xc8, 0xc6, 0xd0]) && !has([0xe0, 0xe2, 0xe7, 0xc0]) ? 'windows-1250' : 'windows-1252';
    }
  }
  const text = new TextDecoder(encoding).decode(bytes).replace(/^﻿/, '');
  const count: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  let started = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (started) break;
    } else {
      started = true;
      if (!quoted && ch in count) count[ch]++;
    }
  }
  const delimiter = ([';', '\t'] as const).reduce<',' | ';' | '\t'>((best, d) => (count[d] > count[best] ? d : best), ',');
  return { text, encoding, delimiter };
}

const valueSheets = (wb: XLSX.WorkBook) =>
  wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true, UTC: true }),
  }));

export async function loadSource(ext: string, bytes: Uint8Array): Promise<Source> {
  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    return { kind: 'xlsx', wb };
  }
  if (ext === '.csv') {
    const { text, delimiter } = decodeCsv(bytes);
    return { kind: 'values', sheets: valueSheets(XLSX.read(text, { type: 'string', raw: true, FS: delimiter })), delimiter };
  }
  return { kind: 'values', sheets: valueSheets(XLSX.read(bytes, { type: 'array', cellDates: true })) };
}

export function gridOf(src: Source, sheet: string | null): Grid {
  if (src.kind === 'xlsx') {
    const all = src.wb.worksheets;
    const ws = sheet === null ? all[0] : all.find((w) => w.name === sheet);
    if (!ws) throw new Error(`Sheet not found: ${sheet}`);
    const rows = Array.from({ length: ws.rowCount }, (_, r) => {
      const row = ws.getRow(r + 1);
      // a merged cell that is not its master reads as '' (ExcelJS gives it the master's value)
      const t = Array.from({ length: row.cellCount }, (_, c) => {
        const cell = row.getCell(c + 1);
        return cell.isMerged && cell.master.address !== cell.address ? '' : cellText(cell.value);
      });
      while (t.length && t[t.length - 1] === '') t.pop();
      return t;
    });
    return {
      sheets: all.map((w) => ({ name: w.name, rows: w.rowCount })),
      sheet: ws.name,
      rows,
      merges: [...(ws.model.merges ?? [])],
    };
  }
  const s = sheet === null ? src.sheets[0] : src.sheets.find((x) => x.name === sheet);
  if (!s) throw new Error(`Sheet not found: ${sheet}`);
  const rows = s.rows.map((r) => {
    const t = r.map(cellText);
    while (t.length && t[t.length - 1] === '') t.pop();
    return t;
  });
  return {
    sheets: src.sheets.map((x) => ({ name: x.name, rows: x.rows.length })),
    sheet: s.name,
    rows,
    merges: [],
    ...(src.delimiter ? { delimiter: src.delimiter } : {}),
  };
}

/** The CSV numbers rule for one cell; null = keep as text. */
export function csvNumber(text: string, decimal: ',' | '.'): number | null {
  const t = text.trim();
  const group = decimal === ',' ? '.' : ',';
  const m = new RegExp(`^(-?)([0-9]{1,3}(?:[${group}][0-9]{3})+|[0-9]+)(?:[${decimal}]([0-9]+))?$`).exec(t);
  if (!m) return null;
  const int = m[2].split(group).join('');
  if (/^0\d/.test(int) || int.length + (m[3]?.length ?? 0) > 15) return null;
  return Number(`${m[1]}${int}${m[3] ? `.${m[3]}` : ''}`);
}
