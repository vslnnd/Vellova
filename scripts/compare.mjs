// Private check on real files: runs Nomina 1.4.6's engine and Vellova's engine on every PDF in a folder.
// Prints only counts and anonymous structure statistics, never file names or values.
// usage: npm run compare -- "<folder>" --keyword "<kw>" [--position after|before|above|below]
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { extract146 } from './golden-146.mjs';
import { extractItems } from '../src/lib/rename/engine/pdfItems.ts';
import { findValue } from '../src/lib/rename/engine/findValue.ts';

const require = createRequire(import.meta.url);
const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { keyword: { type: 'string' }, position: { type: 'string', default: 'after' } },
});
const folder = positionals[0];
if (!folder || !opts.keyword) {
  console.error('usage: npm run compare -- "<folder>" --keyword "<kw>" [--position after|before|above|below]');
  process.exit(2);
}

const lib = require('pdfjs-dist/build/pdf.js'); // the build the app runs
lib.GlobalWorkerOptions.workerSrc = false;

/** How many text items the keyword is spread over (1 = one item, 0 = not found). */
function pieces(items, keyword) {
  const kw = keyword.trim().toLowerCase();
  if (items.some((i) => i.str.toLowerCase().includes(kw))) return 1;
  const n = kw.split(/\s+/).length;
  for (let i = 0; i + n <= items.length; i++) {
    if (items.slice(i, i + n).map((x) => x.str.toLowerCase()).join(' ') === kw) return n;
  }
  return 0;
}

const files = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.pdf'));
let match = 0;
const mismatches = [];
for (const f of files) {
  const bytes = readFileSync(join(folder, f));
  const ref = await extract146(bytes, opts.keyword, opts.position);
  let mine;
  let stats = {};
  try {
    const doc = await lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
    const items = await extractItems(doc);
    mine = findValue(items, opts.keyword, opts.position);
    const lens = items.map((i) => i.str.length).sort((a, b) => a - b);
    const info = (await doc.getMetadata()).info ?? {};
    stats = {
      pages: doc.numPages,
      items: items.length,
      charsPerItem: { min: lens[0] ?? 0, median: lens[lens.length >> 1] ?? 0, max: lens.at(-1) ?? 0 },
      keywordPieces: pieces(items, opts.keyword),
      producer: String(info.Producer ?? 'unknown').replace(/[^\w .()-]/g, '').slice(0, 80),
    };
    await doc.destroy();
  } catch {
    mine = { ok: false, reason: 'unreadable' };
  }
  if ((ref.success ? ref.value : null) === (mine.ok ? mine.value : null)) match++;
  else mismatches.push({ ...stats, outcome: `1.4.6 ${ref.success ? 'value' : 'none'} / Vellova ${mine.ok ? 'value' : mine.reason}` });
}
console.log(`${match} of ${files.length} match`);
for (const m of mismatches) console.log(JSON.stringify(m));
