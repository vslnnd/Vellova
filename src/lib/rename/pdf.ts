import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { classifyPdfError, extractItems, pdfDate, type DocLike, type Item } from './engine/pdfItems';
import type { PdfText } from './engine/steps';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
let worker: pdfjsLib.PDFWorker | null = null;

/** Opens a PDF in the shared worker, runs `use` on it and closes it; a crashed worker is replaced next time. */
async function withDoc<T>(bytes: Uint8Array, use: (doc: pdfjsLib.PDFDocumentProxy) => Promise<T>): Promise<T> {
  worker ??= new pdfjsLib.PDFWorker();
  try {
    const doc = await pdfjsLib.getDocument({ data: bytes, worker, isEvalSupported: false, verbosity: 0 }).promise;
    try {
      return await use(doc);
    } finally {
      void doc.destroy();
    }
  } catch (e) {
    // a crashed worker would fail every later file: start a fresh one next time
    if (classifyPdfError(e).reason === 'internal') {
      worker?.destroy();
      worker = null;
    }
    throw e;
  }
}

/** Text items, title and creation date of a PDF, read by pdf.js 3.11.174 (Nomina 1.4.6's version) in one shared worker. */
export function readPdfText(bytes: Uint8Array): Promise<PdfText> {
  return withDoc(bytes, async (doc) => {
    const items = await extractItems(doc as unknown as DocLike);
    const info = ((await doc.getMetadata().catch(() => null))?.info ?? {}) as { Title?: unknown; CreationDate?: unknown };
    return { items, title: typeof info.Title === 'string' ? info.Title.trim() : '', created: pdfDate(info.CreationDate) };
  });
}

export type Word = Item & { w: number; h: number };

/**
 * Draws page `page` on `canvas`, `width` CSS pixels wide, and lists its words in PDF units, built and ordered like
 * extractItems' items of that page (so word k is the k-th item of the page).
 */
export function openPage(bytes: Uint8Array, page: number, canvas: HTMLCanvasElement, width: number): Promise<{ pages: number; scale: number; words: Word[] }> {
  return withDoc(bytes, async (doc) => {
    const pg = await doc.getPage(page);
    const base = pg.getViewport({ scale: 1 });
    const scale = width / base.width;
    const dpr = window.devicePixelRatio || 1;
    const vp = pg.getViewport({ scale: scale * dpr });
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${base.height * scale}px`;
    await pg.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
    const words: Word[] = [];
    for (const raw of (await pg.getTextContent()).items as { str?: string; transform: number[]; width: number }[]) {
      const str = (raw.str ?? '').trim();
      if (!str) continue;
      const t = raw.transform;
      words.push({ str, x: t[4], y: base.height - t[5], page, w: raw.width, h: Math.hypot(t[2], t[3]) });
    }
    return { pages: doc.numPages, scale, words };
  });
}
