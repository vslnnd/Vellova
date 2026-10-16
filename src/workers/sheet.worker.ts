import { companionData } from '../lib/rename/engine/companion';

type Req = { id: number; ext: string; bytes: Uint8Array };
const post = (m: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m);

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, ext, bytes } = e.data;
  try {
    post({ id, data: companionData(ext, bytes) });
  } catch (err) {
    post({ id, error: String((err as Error)?.message ?? err) });
  }
};
