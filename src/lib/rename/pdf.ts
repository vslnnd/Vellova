import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { classifyPdfError, extractItems, type DocLike, type Item } from './engine/pdfItems';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
let worker: pdfjsLib.PDFWorker | null = null;

/** Text items of a PDF, read by pdf.js 3.11.174 (Nomina 1.4.6's version) in one shared worker. */
export async function readPdfItems(bytes: Uint8Array): Promise<Item[]> {
  worker ??= new pdfjsLib.PDFWorker();
  try {
    const doc = await pdfjsLib.getDocument({ data: bytes, worker, isEvalSupported: false, verbosity: 0 }).promise;
    try {
      return await extractItems(doc as unknown as DocLike);
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
