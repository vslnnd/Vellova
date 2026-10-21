import { extOf } from '../../shared/names';
import type { FileInfo } from '../../shared/types';

export const PDF = '.pdf';
/** Files that take a PDF's name when they contain its value (the types Nomina 1.4.6 accepted). */
export const COMPANIONS = ['.xlsx', '.txt', '.xml', '.csv'];
export const SUPPORTED = [PDF, ...COMPANIONS];

/** A path's identity on Windows: case-insensitive, either slash. */
export const pathKey = (p: string) => p.replace(/\//g, '\\').toLowerCase();

/** Adds the supported files that aren't listed yet, keeping list order. */
export function mergeFiles(list: FileInfo[], add: FileInfo[], supported = SUPPORTED): FileInfo[] {
  const seen = new Set(list.map((f) => pathKey(f.path)));
  const out = [...list];
  for (const f of add) {
    const key = pathKey(f.path);
    if (seen.has(key) || !supported.includes(extOf(f.path))) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
