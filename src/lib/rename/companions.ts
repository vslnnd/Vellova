import type { CompanionData } from './engine/companion';

type Waiting = { resolve: (d: CompanionData) => void; reject: (e: Error) => void };
let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, Waiting>();

function start(): Worker {
  const w = new Worker(new URL('../../workers/sheet.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number; data?: CompanionData; error?: string }>) => {
    const p = waiting.get(e.data.id);
    if (!p) return;
    waiting.delete(e.data.id);
    if (e.data.error !== undefined) p.reject(new Error(e.data.error));
    else p.resolve(e.data.data!);
  };
  // the worker died: fail what is pending as an internal error and start a fresh one next time
  w.onerror = (e) => {
    for (const p of waiting.values()) p.reject(Object.assign(new Error(e.message || 'The spreadsheet reader stopped.'), { internal: true }));
    waiting.clear();
    w.terminate();
    worker = null;
  };
  return w;
}

/** Reads a companion file (.xlsx/.csv/.xml/.txt) in the sheet worker. */
export function readCompanion(ext: string, bytes: Uint8Array): Promise<CompanionData> {
  const w = (worker ??= start());
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage({ id, ext, bytes }, [bytes.buffer]);
  });
}
