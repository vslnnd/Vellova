import * as XLSX from 'xlsx';

/** What a companion file offers for matching: its cell values, or its raw text. */
export type CompanionData = { cells: string[] } | { text: string };

function cellsOf(wb: XLSX.WorkBook): string[] {
  const out = new Set<string>();
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '' });
    for (const row of rows) for (const cell of row) out.add(String(cell).trim());
  }
  out.delete('');
  return [...out];
}

/**
 * Reads a companion once. .xlsx: every cell, trimmed (as 1.4.6). .csv: every field, kept as text.
 * .txt / .xml: the raw text (1.4.6 matched with `includes`).
 */
export function companionData(ext: string, bytes: Uint8Array): CompanionData {
  if (ext === '.xlsx') return { cells: cellsOf(XLSX.read(bytes, { type: 'array' })) };
  const text = new TextDecoder().decode(bytes);
  if (ext === '.csv') return { cells: cellsOf(XLSX.read(text, { type: 'string', raw: true })) };
  return { text };
}
