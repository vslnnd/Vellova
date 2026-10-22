export type Item = { str: string; x: number; y: number; page: number };

type PageLike = {
  getViewport(o: { scale: number }): { height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
};
/** The part of a pdf.js document this module needs (lets tests pass a fake). */
export type DocLike = { numPages: number; getPage(n: number): Promise<PageLike> };

/** Text pieces with positions, built exactly like Nomina 1.4.6: trimmed, non-empty, y measured from the top. */
export async function extractItems(doc: DocLike): Promise<Item[]> {
  const items: Item[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const height = page.getViewport({ scale: 1 }).height;
    const tc = await page.getTextContent();
    for (const raw of tc.items as { str?: string; transform: number[] }[]) {
      const str = (raw.str ?? '').trim();
      if (!str) continue;
      items.push({ str, x: raw.transform[4], y: height - raw.transform[5], page: p });
    }
  }
  return items;
}

/** A plain-language reason for a PDF that pdf.js could not open. Unknown failures are 'internal' (e.g. a dead worker). */
export function classifyPdfError(e: unknown): { reason: 'unreadable' | 'internal'; detail: string } {
  const err = e as { name?: string; message?: string; details?: string } | null;
  if (err?.name === 'PasswordException') return { reason: 'unreadable', detail: 'This PDF is password-protected.' };
  if (err?.name === 'InvalidPDFException' || err?.name === 'MissingPDFException') {
    return { reason: 'unreadable', detail: "This file isn't a readable PDF (it is damaged or empty)." };
  }
  // pdf.js 3.11 wraps every other worker-side error (FormatError, TypeError…) in this; the worker itself is fine.
  // ponytail: counted as the file's fault; pdf.js's own text stays in the detail so a real bug can still be traced
  if (err?.name === 'UnknownErrorException') {
    return { reason: 'unreadable', detail: `This file isn't a readable PDF (pdf.js: ${err.details || err.message}).` };
  }
  return { reason: 'internal', detail: String(err?.message ?? e) };
}

/** A PDF date (`D:YYYYMMDD...`) as yyyy-MM-dd, or '' when it isn't one. */
export function pdfDate(v: unknown): string {
  const m = typeof v === 'string' ? /^(?:D:)?(\d{4})(\d{2})(\d{2})/.exec(v) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
