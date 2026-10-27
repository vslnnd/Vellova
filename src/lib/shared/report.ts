import { REASONS } from './reasons';
import type { Batch, BatchItem } from './types';

const two = (n: number) => String(n).padStart(2, '0');

/** `yyyy-MM-dd HH:mm`, local time. */
const stamp = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

/** A failure shows its reason, as in History; `Archived` is a source moved to the archive folder. */
function result(i: BatchItem): string {
  if (i.pending) return 'Not finished';
  if (!i.ok) return i.reason ? REASONS[i.reason].title : 'Failed';
  return i.archived ? 'Archived' : 'Done';
}

/** One row per item under a header row, for a batch report. */
export function reportRows(b: Batch): string[][] {
  const date = stamp(b.time);
  return [['Date', 'Old path', 'New path', 'Result'], ...b.items.map((i) => [date, i.from, i.to, result(i)])];
}

/** The save dialog's file name (no extension; the dialog adds it): the batch's tool and time, without the colon Windows refuses. */
export const reportName = (b: Batch) => `Vellova ${b.tool} ${stamp(b.time).replace(':', '')}`;

/** UTF-8 with a BOM so Excel reads non-ASCII text; comma-separated, CRLF line ends. */
export function toCsv(rows: string[][]): string {
  const field = (f: string) => (/[",\r\n]/.test(f) ? `"${f.replaceAll('"', '""')}"` : f);
  return '﻿' + rows.map((r) => r.map(field).join(',') + '\r\n').join('');
}
