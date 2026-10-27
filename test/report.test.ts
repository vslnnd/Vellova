import { describe, expect, it } from 'vitest';
import { reportRows, toCsv } from '../src/lib/shared/report';
import type { Batch } from '../src/lib/shared/types';

describe('reportRows', () => {
  it('gives one row per item with the date, both paths and a plain result', () => {
    const b: Batch = {
      id: 'b1', tool: 'split', time: new Date(2026, 9, 23, 14, 5).getTime(), verb: 'copied', summary: '',
      undoable: true,
      items: [
        { from: 'C:\\in\\a.xlsx', to: 'C:\\out\\a-1.xlsx', ok: true },
        { from: 'C:\\in\\a.xlsx', to: 'C:\\archive\\a.xlsx', ok: true, archived: true },
        { from: 'C:\\in\\b.xlsx', to: 'C:\\out\\b-1.xlsx', ok: false, pending: true },
        { from: 'C:\\in\\c.xlsx', to: 'C:\\out\\c-1.xlsx', ok: false, reason: 'locked' },
      ],
    };
    expect(reportRows(b)).toEqual([
      ['Date', 'Old path', 'New path', 'Result'],
      ['2026-10-23 14:05', 'C:\\in\\a.xlsx', 'C:\\out\\a-1.xlsx', 'Done'],
      ['2026-10-23 14:05', 'C:\\in\\a.xlsx', 'C:\\archive\\a.xlsx', 'Archived'],
      ['2026-10-23 14:05', 'C:\\in\\b.xlsx', 'C:\\out\\b-1.xlsx', 'Not finished'],
      ['2026-10-23 14:05', 'C:\\in\\c.xlsx', 'C:\\out\\c-1.xlsx', 'File locked or in use'],
    ]);
  });

  it('pads single digits and leaves an empty old path empty', () => {
    const b: Batch = {
      id: 'b2', tool: 'rename', time: new Date(2026, 0, 2, 3, 4).getTime(), verb: 'renamed', summary: '', undoable: true,
      items: [{ from: '', to: 'C:\\x.pdf', ok: false }],
    };
    expect(reportRows(b)[1]).toEqual(['2026-01-02 03:04', '', 'C:\\x.pdf', 'Failed']);
  });
});

describe('toCsv', () => {
  it('writes a BOM, CRLF line ends, and quotes only the fields that need it', () => {
    expect(toCsv([['a,b', 'say "hi"'], ['x\ny', '']])).toBe('\uFEFF"a,b","say ""hi"""\r\n"x\ny",\r\n');
    expect(toCsv([['plain', 'two words']])).toBe('\uFEFFplain,two words\r\n');
    expect(toCsv([['cr\rhere']])).toBe('\uFEFF"cr\rhere"\r\n');
  });
});
