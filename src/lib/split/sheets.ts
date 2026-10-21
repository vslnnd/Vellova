import type { Grid } from './engine/grid';
import type { WriteReq } from './engine/write';

type Waiting = { resolve: (d: never) => void; reject: (e: Error) => void };
let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, Waiting>();

function start(): Worker {
  const w = new Worker(new URL('../../workers/sheet.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number; data?: unknown; error?: string }>) => {
    const p = waiting.get(e.data.id);
    if (!p) return;
    waiting.delete(e.data.id);
    if (e.data.error !== undefined) p.reject(new Error(e.data.error));
    else p.resolve(e.data.data as never);
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

/** One request to the shared sheet worker; the bytes are transferred, so callers pass a copy they still need. */
export function callSheetWorker<T>(msg: Record<string, unknown> & { bytes: Uint8Array }): Promise<T> {
  const w = (worker ??= start());
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (d: never) => void, reject });
    w.postMessage({ id, ...msg }, [msg.bytes.buffer]);
  });
}

export const readGrid = (key: string, ext: string, bytes: Uint8Array, sheet: string | null): Promise<Grid> =>
  callSheetWorker({ op: 'grid', key, ext, bytes, sheet });

export const writeFile = (key: string, ext: string, bytes: Uint8Array, req: WriteReq): Promise<Uint8Array[]> =>
  callSheetWorker({ op: 'write', key, ext, bytes, req });
