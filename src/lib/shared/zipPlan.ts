import { pathKey } from '../rename/engine/files';
import { join } from './names';
import type { Batch } from './types';

const parts = (p: string) => p.split(/[\\/]+/);

/** The files a batch made that are still its own: not failed, not an archived original, not the zip itself. */
export const zipSources = (b: Batch): string[] => [...new Set(b.items.filter((i) => i.ok && !i.archived && !i.zip).map((i) => i.to))];

/** A batch that can be zipped: it made something, was not undone and has no zip yet. */
export const canZip = (b: Batch | undefined): b is Batch => !!b && !b.undone && !b.items.some((i) => i.zip && i.ok) && zipSources(b).length > 0;

/**
 * Where the zip goes and what each file is called inside it: the folder all the files share, and each file's
 * path from there (so files sorted into subfolders keep them, and two files of the same name don't clash).
 */
export function zipLayout(paths: string[]): { dir: string; entries: { path: string; name: string }[] } {
  const split = paths.map(parts);
  let n = Math.min(...split.map((s) => s.length - 1));
  for (let i = 0; i < n; i++) {
    if (split.some((s) => s[i].toLowerCase() !== split[0][i].toLowerCase())) n = i;
  }
  return { dir: split[0].slice(0, n).join('\\'), entries: paths.map((path, k) => ({ path, name: split[k].slice(n).join('/') })) };
}

const two = (n: number) => String(n).padStart(2, '0');

/** `Rename_20261110_2145.zip` in `dir`, with ` (1)`, ` (2)`… while that name is taken. */
export function zipPath(dir: string, tool: Batch['tool'], at: Date, taken: Set<string>): string {
  const base = `${tool === 'split' ? 'Split' : 'Rename'}_${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}_${two(at.getHours())}${two(at.getMinutes())}`;
  for (let k = 0; ; k++) {
    const p = join(dir, `${k ? `${base} (${k})` : base}.zip`);
    if (!taken.has(pathKey(p))) return p;
  }
}
