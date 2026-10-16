import type { CompanionData } from './companion';

/**
 * Companion path → PDF path. As in Nomina 1.4.6, the first PDF in list order whose value the companion
 * contains wins. Each companion is read once instead of once per PDF.
 */
export function pairCompanions(
  pdfs: { path: string; value: string }[],
  companions: { path: string; data: CompanionData }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of companions) {
    const cells = 'cells' in c.data ? new Set(c.data.cells) : null;
    const text = 'text' in c.data ? c.data.text : '';
    // ponytail: 1.4.6 searched a header==keyword column first, then every cell; both give the same yes/no, so one lookup is enough
    const hit = pdfs.find((p) => (cells ? cells.has(p.value.trim()) : text.includes(p.value.trim())));
    if (hit) out[c.path] = hit.path;
  }
  return out;
}
