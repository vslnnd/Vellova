import { describe, expect, it } from 'vitest';
import { classifyPdfError, extractItems, type DocLike, type Item } from '../src/lib/rename/engine/pdfItems';
import { findValue, keywordHits } from '../src/lib/rename/engine/findValue';

const item = (str: string, x: number, y: number, page = 1): Item => ({ str, x, y, page });

describe('extractItems', () => {
  it('builds trimmed, non-empty items with y measured from the top (1.4.6)', async () => {
    const doc: DocLike = {
      numPages: 2,
      getPage: async (n) => ({
        getViewport: () => ({ height: 800 }),
        getTextContent: async () => ({
          items: n === 1
            ? [{ str: ' Invoice ', transform: [1, 0, 0, 1, 10, 700] }, { str: '   ', transform: [1, 0, 0, 1, 50, 700] }]
            : [{ str: 'X', transform: [1, 0, 0, 1, 5, 100] }],
        }),
      }),
    };
    expect(await extractItems(doc)).toEqual([item('Invoice', 10, 100, 1), item('X', 5, 700, 2)]);
  });

  it('explains unreadable PDFs and flags unknown failures as internal', () => {
    expect(classifyPdfError({ name: 'PasswordException', message: 'No password given' })).toEqual({ reason: 'unreadable', detail: 'This PDF is password-protected.' });
    expect(classifyPdfError({ name: 'InvalidPDFException', message: 'Invalid PDF structure.' }).reason).toBe('unreadable');
    expect(classifyPdfError(new Error('worker died'))).toEqual({ reason: 'internal', detail: 'worker died' });
  });
});

describe('keyword search (the three 1.4.6 passes)', () => {
  const items = [item('Total Invoice No.: x', 10, 10), item('Invoice No.:', 100, 50), item('Invoice', 100, 90), item('No:', 140, 90)];

  it('prefers an item equal to the keyword', () => expect(keywordHits(items, 'invoice no.:')).toEqual([1]));
  it('falls back to items containing it', () => expect(keywordHits(items, 'Total Invoice')).toEqual([0]));
  it('then joins consecutive items with single spaces; the hit is the last piece', () => {
    expect(keywordHits(items, 'Invoice No:')).toEqual([3]);
  });
  it('ignores case and surrounding spaces; an empty keyword finds nothing', () => {
    expect(keywordHits(items, '  INVOICE NO.:  ')).toEqual([1]);
    expect(keywordHits(items, '   ')).toEqual([]);
  });
});

describe('value position', () => {
  const line = [
    item('Header', 100, 20),
    item('Invoice No.:', 100, 100),
    item('far right', 400, 100),
    item('INV-1', 200, 101),
    item('off the line', 150, 109),
    item('left', 20, 100),
    item('nearer left', 60, 99),
    item('touching', 101, 100),
  ];
  const grid = [
    item('Due date', 100, 100),
    item('same line', 300, 104),
    item('next row, far', 160, 115),
    item('next row, near', 101, 117),
    item('two rows down', 100, 140),
    item('row above', 100, 80),
    item('other page', 100, 115, 2),
  ];

  it('after: same line (|dy| <= 8), nearest to the right, more than 2 units away', () => {
    expect(findValue(line, 'Invoice No.:', 'after')).toEqual({ ok: true, value: 'INV-1' });
  });
  it('before: same line, nearest to the left', () => {
    expect(findValue(line, 'Invoice No.:', 'before')).toEqual({ ok: true, value: 'nearer left' });
  });
  it('below: nearest row down on the same page; within 3 units the one closer in x wins', () => {
    expect(findValue(grid, 'Due date', 'below')).toEqual({ ok: true, value: 'next row, near' });
  });
  it('above: nearest row up', () => {
    expect(findValue(grid, 'Due date', 'above')).toEqual({ ok: true, value: 'row above' });
  });
  it('after/before look at every page, as 1.4.6 did', () => {
    expect(findValue([item('Total', 100, 500, 1), item('42,00', 300, 500, 2)], 'Total', 'after')).toEqual({ ok: true, value: '42,00' });
  });
  it('reports no text layer, a missing keyword and a missing value', () => {
    expect(findValue([], 'x', 'after')).toMatchObject({ ok: false, reason: 'no-text' });
    expect(findValue(line, 'Order No', 'after')).toMatchObject({ ok: false, reason: 'keyword-not-found' });
    expect(findValue(line, 'far right', 'after')).toMatchObject({ ok: false, reason: 'no-value' });
  });
  it('occurrence picks the n-th hit', () => {
    const items = [item('No.:', 10, 10), item('A-1', 50, 10), item('No.:', 10, 30), item('B-2', 50, 30)];
    expect(findValue(items, 'No.:', 'after')).toEqual({ ok: true, value: 'A-1' });
    expect(findValue(items, 'No.:', 'after', 2)).toEqual({ ok: true, value: 'B-2' });
    expect(findValue(items, 'No.:', 'after', 3)).toMatchObject({ ok: false, reason: 'keyword-not-found' });
  });
});
