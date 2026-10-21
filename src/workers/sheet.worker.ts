import { createHandler, type Msg } from './sheetHandler';

const handle = createHandler();
const post = (m: unknown, t: Transferable[]) => (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(m, t);

self.onmessage = async (e: MessageEvent<Msg>) => {
  const r = await handle(e.data);
  post(r, Array.isArray(r.data) ? (r.data as Uint8Array[]).map((b) => b.buffer) : []);
};
