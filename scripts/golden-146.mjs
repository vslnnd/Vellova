// Records what Nomina 1.4.6's engine returns for every fixture × keyword × position.
// extract146 is the 1.4.6 `extract-pdf-value` handler from main.js, verbatim except that it takes
// bytes instead of a path. Do not "fix" it: it is the reference.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const POSITIONS = ['after', 'before', 'above', 'below'];

export async function extract146(bytes, keyword, position) {
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = false;

    const data = new Uint8Array(bytes);
    const doc = await pdfjsLib.getDocument({ data, verbosity: 0 }).promise;
    const allItems = [];

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      for (const item of tc.items) {
        const str = item.str.trim();
        if (!str) continue;
        allItems.push({
          str,
          x: item.transform[4],
          y: vp.height - item.transform[5], // flip Y: higher = lower on page
          page: p,
        });
      }
    }

    // Find keyword (case-insensitive, single or multi-word)
    const kwLower = keyword.trim().toLowerCase();
    let kwIndex = -1;

    // Exact match
    for (let i = 0; i < allItems.length; i++) {
      if (allItems[i].str.toLowerCase() === kwLower) { kwIndex = i; break; }
    }
    // Contains match
    if (kwIndex === -1) {
      for (let i = 0; i < allItems.length; i++) {
        if (allItems[i].str.toLowerCase().includes(kwLower)) { kwIndex = i; break; }
      }
    }
    // Multi-word consecutive match
    if (kwIndex === -1) {
      const words = kwLower.split(/\s+/);
      for (let i = 0; i <= allItems.length - words.length; i++) {
        const chunk = allItems.slice(i, i + words.length).map(x => x.str.toLowerCase()).join(' ');
        if (chunk === kwLower) { kwIndex = i + words.length - 1; break; }
      }
    }

    if (kwIndex === -1) return { success: false, error: `Keyword "${keyword}" not found in PDF` };

    const kw = allItems[kwIndex];
    const LINE_TOL = 8;
    let value = null;

    if (position === 'after') {
      const cands = allItems
        .filter((item, i) => i !== kwIndex && Math.abs(item.y - kw.y) <= LINE_TOL && item.x > kw.x + 2)
        .sort((a, b) => a.x - b.x);
      if (cands.length) value = cands[0].str;

    } else if (position === 'before') {
      const cands = allItems
        .filter((item, i) => i !== kwIndex && Math.abs(item.y - kw.y) <= LINE_TOL && item.x < kw.x - 2)
        .sort((a, b) => b.x - a.x);
      if (cands.length) value = cands[0].str;

    } else if (position === 'below') {
      const below = allItems
        .filter((item, i) => i !== kwIndex && item.y > kw.y + LINE_TOL && item.page === kw.page)
        .sort((a, b) => {
          const dy = a.y - b.y;
          if (Math.abs(dy) > 3) return dy;
          return Math.abs(a.x - kw.x) - Math.abs(b.x - kw.x);
        });
      if (below.length) value = below[0].str;

    } else if (position === 'above') {
      const above = allItems
        .filter((item, i) => i !== kwIndex && item.y < kw.y - LINE_TOL && item.page === kw.page)
        .sort((a, b) => {
          const dy = b.y - a.y;
          if (Math.abs(dy) > 3) return dy;
          return Math.abs(a.x - kw.x) - Math.abs(b.x - kw.x);
        });
      if (above.length) value = above[0].str;
    }

    if (!value) return { success: false, error: `No value found ${position} keyword "${keyword}"` };
    return { success: true, value };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = resolve('test/fixtures');
  const cases = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'));
  const golden = {};
  for (const [file, keywords] of Object.entries(cases)) {
    const bytes = readFileSync(join(dir, file));
    golden[file] = {};
    for (const keyword of keywords) {
      for (const position of POSITIONS) {
        const r = await extract146(bytes, keyword, position);
        golden[file][`${keyword}|${position}`] = r.success ? r.value : null;
      }
    }
  }
  writeFileSync(join(dir, 'golden-146.json'), `${JSON.stringify(golden, null, 2)}\n`);
  console.log('wrote test/fixtures/golden-146.json');
}
