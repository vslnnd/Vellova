import { describe, expect, it } from 'vitest';
import { findValue } from '../src/lib/rename/engine/findValue';
import type { Item } from '../src/lib/rename/engine/pdfItems';
import { proposeLabel } from '../src/lib/rename/engine/propose';
import { fixtureItems } from './golden-helpers';

const item = (str: string, x: number, y: number, page = 1): Item => ({ str, x, y, page });

describe('proposeLabel', () => {
  it('takes the label on the same line to the left as after', () => {
    const items = [item('Invoice', 10, 100), item('INV-001', 80, 100)];
    expect(proposeLabel(items, 1)).toEqual({ keyword: 'Invoice', position: 'after', occurrence: 1 });
  });

  it('takes the label above as below', () => {
    const items = [item('Invoice No', 10, 100), item('12345', 10, 120)];
    expect(proposeLabel(items, 1)).toEqual({ keyword: 'Invoice No', position: 'below', occurrence: 1 });
  });

  it('counts which occurrence of the label is nearest', () => {
    const items = [item('Total', 10, 100), item('50.00', 80, 100), item('Total', 10, 200), item('75.00', 80, 200)];
    expect(proposeLabel(items, 3)).toEqual({ keyword: 'Total', position: 'after', occurrence: 2 });
  });

  it('gives null when only a number is near', () => {
    const items = [item('123', 10, 100), item('ABC-9', 80, 100)];
    expect(proposeLabel(items, 1)).toBeNull();
  });

  it('skips a nearer value from the other column that findValue would not lead back from', () => {
    const items = [
      item('Customer', 40, 100),
      item('Tailspin Inc.', 40, 120), // nearest on the left, but its own "after" is Suite 5
      item('Suite 5', 120, 113),
      item('Due date', 200, 113),
      item('02.10.2026', 200, 124),
    ];
    expect(proposeLabel(items, 4)).toEqual({ keyword: 'Due date', position: 'below', occurrence: 1 });
  });

  it.each([
    ['ssrs-same-line.pdf', 'DN-2026-00017', { keyword: 'No.:', position: 'after', occurrence: 1 }],
    ['ssrs-below.pdf', 'DN-2026-00018', { keyword: 'Debit note number', position: 'below', occurrence: 1 }],
    ['ssrs-below.pdf', '30.10.2026', { keyword: 'Due date', position: 'below', occurrence: 1 }],
    ['ssrs-two-column.pdf', 'PO-2026-7781', { keyword: 'No.:', position: 'after', occurrence: 2 }],
    ['ssrs-two-column.pdf', 'INV-2026-00119', { keyword: 'No.:', position: 'after', occurrence: 1 }],
  ])('on %s, %s gets its label', async (file, value, expected) => {
    const items = await fixtureItems('modern', file);
    const p = proposeLabel(items, items.findIndex((i) => i.str === value));
    expect(p).toEqual(expected);
    expect(findValue(items, p!.keyword, p!.position, p!.occurrence)).toEqual({ ok: true, value });
  });
});
