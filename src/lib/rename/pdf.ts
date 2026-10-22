import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { classifyPdfError, extractItems, pdfDate, type DocLike } from './engine/pdfItems';
import type { PdfText } from './engine/steps';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
let worker: pdfjsLib.PDFWorker | null = null;

/** Text items, title and creation date of a PDF, read by pdf.js 3.11.174 (Nomina 1.4.6's version) in one shared worker. */
export async function readPdfText(bytes: Uint8Array): Promise<PdfText> {
  worker ??= new pdfjsLib.PDFWorker();
  try {
    const doc = await pdfjsLib.getDocument({ data: bytes, worker, isEvalSupported: false, verbosity: 0 }).promise;
    try {
      const items = await extractItems(doc as unknown as DocLike);
      const info = ((await doc.getMetadata().catch(() => null))?.info ?? {}) as { Title?: unknown; CreationDate?: unknown };
      return { items, title: typeof info.Title === 'string' ? info.Title.trim() : '', created: pdfDate(info.CreationDate) };
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
