import type { SplitRules } from '../../shared/types';
import type { Grid } from './grid';

export type Column = { index: number; name: string; samples: string[] };
export type HeaderInfo = { row: number; columns: Column[]; data: number[]; warnings: string[] };

export const colLetter = (index: number): string => {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const norm = (s: string) => s.trim().toLowerCase();

export function findColumn(columns: Column[], name: string): Column | undefined {
  return columns.find((c) => norm(c.name) === norm(name));
}

/** The non-empty column names, each once (the first of a repeated name is the one a split uses). */
export const columnNames = (grid: Grid, header: SplitRules['header']): string[] => [
  ...new Set(headerInfo(grid, header).columns.map((c) => c.name).filter((n) => n.trim())),
];

export function headerInfo(grid: Grid, header: SplitRules['header']): HeaderInfo {
  const row = header.mode === 'manual' ? header.row - 1 : 0;
  const n = row + 1;
  if (row >= grid.rows.length) return { row, columns: [], data: [], warnings: [`Row ${n} is past the end of the sheet.`] };
  const head = grid.rows[row];
  const data = grid.rows.flatMap((r, i) => (i > row && r.some((c) => c.trim() !== '') ? [i] : []));
  const width = Math.max(head.length, ...data.map((i) => grid.rows[i].length));
  const columns: Column[] = Array.from({ length: width }, (_, index) => {
    const samples: string[] = [];
    for (const i of data) {
      const v = grid.rows[i][index] ?? '';
      if (v.trim() !== '' && !samples.includes(v) && samples.push(v) === 5) break;
    }
    return { index, name: (head[index] ?? '').trim() || `Column ${colLetter(index)}`, samples };
  });

  const warnings: string[] = [];
  const filled = head.filter((c) => c.trim() !== '');
  if (filled.length && filled.filter((c) => /^-?\d+([.,]\d+)?$/.test(c.trim())).length * 2 >= filled.length)
    warnings.push(`Row ${n} looks like data. Is the header on another row?`);
  const empty = columns.filter((c) => (head[c.index] ?? '').trim() === '').length;
  // ponytail: a stray cell right of the header (formatted.xlsx F4) must not warn, so trailing blanks only count when they are half the columns
  const interior = columns.some((c) => c.index < head.length && (head[c.index] ?? '').trim() === '');
  if (empty && (interior || empty * 2 >= columns.length)) warnings.push(`Row ${n} has ${empty} empty column name${empty === 1 ? '' : 's'}.`);
  const seen = new Set<string>();
  for (const c of columns) {
    if (c.name !== `Column ${colLetter(c.index)}` || (head[c.index] ?? '').trim() !== '') {
      const k = norm(c.name);
      if (seen.has(k) && !warnings.includes(`Row ${n} repeats the column name "${c.name}".`))
        warnings.push(`Row ${n} repeats the column name "${c.name}".`);
      seen.add(k);
    }
  }
  return { row, columns, data, warnings };
}
