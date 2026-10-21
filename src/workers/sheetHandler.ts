import { companionData } from '../lib/rename/engine/companion';
import { gridOf, loadSource, type Source } from '../lib/split/engine/grid';
import { writeOutputs, type WriteReq } from '../lib/split/engine/write';

export type Msg =
  | { id: number; op?: 'companion'; ext: string; bytes: Uint8Array }
  | { id: number; op: 'grid'; key: string; ext: string; bytes: Uint8Array; sheet: string | null }
  | { id: number; op: 'write'; key: string; ext: string; bytes: Uint8Array; req: WriteReq };
export type Reply = { id: number; data?: unknown; error?: string };

const CACHE_MAX = 3; // ponytail: 3-entry cache; raise if big multi-file runs re-parse

export function createHandler(load: typeof loadSource = loadSource) {
  const cache = new Map<string, Source>();
  const source = async (key: string, ext: string, bytes: Uint8Array) => {
    let s = cache.get(key);
    if (!s) {
      s = await load(ext, bytes);
      cache.set(key, s);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    }
    return s;
  };
  return async (m: Msg): Promise<Reply> => {
    try {
      if (m.op === 'grid') return { id: m.id, data: gridOf(await source(m.key, m.ext, m.bytes), m.sheet) };
      if (m.op === 'write') return { id: m.id, data: await writeOutputs(await source(m.key, m.ext, m.bytes), m.req) };
      return { id: m.id, data: companionData(m.ext, m.bytes) };
    } catch (err) {
      return { id: m.id, error: String((err as Error)?.message ?? err) };
    }
  };
}
