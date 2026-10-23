import type { Position } from '../../shared/types';
import { findValue, keywordHits } from './findValue';
import type { Item } from './pdfItems';

export type Proposal = { keyword: string; position: Position; occurrence: number };

const LINE_TOL = 8; // findValue's same-line tolerance
// ponytail: any digit marks a value, not a label (labels with digits like "Line 2" are never proposed; the user types them)
const VALUEISH = /\d/;

/**
 * The label for a value clicked on the PDF (`picked` indexes `items`): the nearest words on each side, tried in the
 * order after, below, before, above, kept only when findValue with them gives back exactly the picked text.
 */
export function proposeLabel(items: Item[], picked: number): Proposal | null {
  const p = items[picked];
  if (!p) return null;
  const others = items.map((it, i) => ({ it, i })).filter(({ i }) => i !== picked);
  const sameLine = others.filter(({ it }) => Math.abs(it.y - p.y) <= LINE_TOL);
  const vertical = (dir: 1 | -1) =>
    others
      .filter(({ it }) => it.page === p.page && (p.y - it.y) * dir > LINE_TOL)
      .sort((a, b) => Math.abs(a.it.y - p.y) - Math.abs(b.it.y - p.y) || Math.abs(a.it.x - p.x) - Math.abs(b.it.x - p.x));
  const sides: [Position, { it: Item; i: number }[]][] = [
    ['after', sameLine.filter(({ it }) => it.x < p.x - 2).sort((a, b) => b.it.x - a.it.x)],
    ['below', vertical(1)],
    ['before', sameLine.filter(({ it }) => it.x > p.x + 2).sort((a, b) => a.it.x - b.it.x)],
    ['above', vertical(-1)],
  ];
  for (const [position, cands] of sides) {
    for (const { it, i } of cands.slice(0, 3)) {
      if (it.str === p.str || VALUEISH.test(it.str)) continue;
      const occurrence = keywordHits(items, it.str).indexOf(i) + 1;
      if (occurrence < 1) continue;
      const r = findValue(items, it.str, position, occurrence);
      if (r.ok && r.value === p.str) return { keyword: it.str, position, occurrence };
    }
  }
  return null;
}
