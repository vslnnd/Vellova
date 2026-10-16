import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { extractItems, type DocLike, type Item } from '../src/lib/rename/engine/pdfItems';
import { findValue } from '../src/lib/rename/engine/findValue';
import type { Position } from '../src/lib/shared/types';

const require = createRequire(import.meta.url);
export const golden: Record<string, Record<string, string | null>> = JSON.parse(readFileSync('test/fixtures/golden-146.json', 'utf8'));
export const cases: Record<string, string[]> = JSON.parse(readFileSync('test/fixtures/cases.json', 'utf8'));

/** Reads a fixture with pdf.js 3.11.174: 'legacy' is what Nomina 1.4.6 ran in Node, 'modern' is what the app runs in WebView2. */
export async function fixtureItems(build: 'legacy' | 'modern', file: string, dir = 'test/fixtures'): Promise<Item[]> {
  const lib = require(build === 'legacy' ? 'pdfjs-dist/legacy/build/pdf.js' : 'pdfjs-dist/build/pdf.js');
  lib.GlobalWorkerOptions.workerSrc = false;
  const data = new Uint8Array(readFileSync(`${dir}/${file}`));
  const doc = await lib.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  try {
    return await extractItems(doc as DocLike);
  } finally {
    await doc.destroy();
  }
}

export async function expectParity(build: 'legacy' | 'modern', file: string) {
  const items = await fixtureItems(build, file);
  for (const [key, expected] of Object.entries(golden[file])) {
    const [keyword, position] = key.split('|');
    const r = findValue(items, keyword, position as Position);
    expect(r.ok ? r.value : null, `${file} ${key}`).toBe(expected);
  }
}
