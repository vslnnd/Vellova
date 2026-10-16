import type { Position } from '../../shared/types';
import type { Item } from './pdfItems';

export type FindResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'keyword-not-found' | 'no-value' | 'no-text'; detail: string };

/** Nomina 1.4.6: items within 8 units vertically are on the same line. */
const LINE_TOL = 8;

// Port of Nomina 1.4.6 `extract-pdf-value` (main.js), rule for rule. The golden tests are the judge: don't improve it.

/**
 * Keyword hits, case-insensitive, first pass that finds anything wins:
 * items equal to the keyword; else items containing it; else runs of consecutive items that,
 * joined by single spaces, equal it (the hit is the run's last item).
 */
export function keywordHits(items: Item[], keyword: string): number[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];
  const lower = items.map((it) => it.str.toLowerCase());
  let hits = lower.flatMap((s, i) => (s === kw ? [i] : []));
  if (!hits.length) hits = lower.flatMap((s, i) => (s.includes(kw) ? [i] : []));
  if (!hits.length) {
    const words = kw.split(/\s+/);
    for (let i = 0; i <= items.length - words.length; i++) {
      if (lower.slice(i, i + words.length).join(' ') === kw) hits.push(i + words.length - 1);
    }
  }
  return hits;
}

/** The value next to the `occurrence`-th keyword hit (1 = what 1.4.6 returned). */
export function findValue(items: Item[], keyword: string, position: Position, occurrence = 1): FindResult {
  if (!items.length) return { ok: false, reason: 'no-text', detail: 'This PDF has no text layer (it may be a scan).' };
  const hits = keywordHits(items, keyword);
  const kwIndex = hits[occurrence - 1];
  if (kwIndex === undefined) {
    const detail = hits.length
      ? `"${keyword.trim()}" appears only ${hits.length} time(s) in this PDF.`
      : `Keyword "${keyword.trim()}" not found in this PDF.`;
    return { ok: false, reason: 'keyword-not-found', detail };
  }
  const kw = items[kwIndex];
  const others = items.filter((_, i) => i !== kwIndex);
  let cands: Item[];
  if (position === 'after') {
    // 1.4.6 did not check the page for after/before; neither do we
    cands = others.filter((it) => Math.abs(it.y - kw.y) <= LINE_TOL && it.x > kw.x + 2).sort((a, b) => a.x - b.x);
  } else if (position === 'before') {
    cands = others.filter((it) => Math.abs(it.y - kw.y) <= LINE_TOL && it.x < kw.x - 2).sort((a, b) => b.x - a.x);
  } else {
    const dir = position === 'below' ? 1 : -1;
    cands = others
      .filter((it) => it.page === kw.page && (it.y - kw.y) * dir > LINE_TOL)
      .sort((a, b) => {
        const dy = (a.y - b.y) * dir;
        return Math.abs(dy) > 3 ? dy : Math.abs(a.x - kw.x) - Math.abs(b.x - kw.x);
      });
  }
  return cands.length
    ? { ok: true, value: cands[0].str }
    : { ok: false, reason: 'no-value', detail: `Nothing found ${position} "${keyword.trim()}".` };
}
