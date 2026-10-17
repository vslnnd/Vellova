// Regenerates the synthetic test files in test/fixtures (fake companies, numbers and names only).
// Run: npm run fixtures   (then commit test/fixtures)
import {
  PDFDocument, PDFOperator, PDFOperatorNames, StandardFonts, beginText, endText, moveText, setFontAndSize,
} from 'pdf-lib';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = resolve('test/fixtures');
const PAIR = join(OUT, 'pair');
mkdirSync(PAIR, { recursive: true });
const A4 = [595.28, 841.89];
const FIXED = new Date(Date.UTC(2026, 0, 1));
/** keywords the golden script tries on each PDF (with every position) */
const cases = {};

async function pdf(name, keywords, draw, dir = OUT) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(FIXED);
  doc.setModificationDate(FIXED);
  doc.setProducer('Vellova fixtures');
  doc.setCreator('make-fixtures.mjs');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage(A4);
  // t(): draw text with y measured from the top, like a report designer
  const t = (text, x, y, size = 9, f = font) => page.drawText(text, { x, y: A4[1] - y, size, font: f });
  await draw({ doc, page, font, bold, t });
  writeFileSync(join(dir, name), await doc.save({ useObjectStreams: false }));
  if (dir === OUT) cases[name] = keywords;
}

function letterhead({ t, bold }, title) {
  t('Northwind Testing Ltd', 40, 50, 14, bold);
  t('12 Example Street', 40, 66);
  t('1000 Sampletown', 40, 78);
  t(title, 40, 110, 12, bold);
}

function lines({ t }, y, rows) {
  t('Item', 40, y);
  t('Qty', 330, y);
  t('Amount', 470, y);
  rows.forEach(([what, qty, amount], i) => {
    t(what, 40, y + 16 * (i + 1));
    t(qty, 330, y + 16 * (i + 1));
    t(amount, 470, y + 16 * (i + 1));
  });
}

// SSRS writes each label and value as its own positioned box, and often splits labels in two.
await pdf('ssrs-same-line.pdf', ['Invoice No.:', 'Invoice No', 'No.:', 'Date:', 'Customer', 'Total'], (c) => {
  letterhead(c, 'DEBIT NOTE');
  const { t } = c;
  t('Invoice', 330, 140); t('No.:', 363, 140); t('DN-2026-00017', 430, 140);
  t('Date:', 330, 154); t('15.10.2026', 430, 154);
  t('Customer', 40, 140); t('Contoso Fake GmbH', 40, 154);
  lines(c, 220, [['Consulting', '3', '900,00'], ['Travel', '1', '334,50']]);
  t('Total', 330, 300, 9, c.bold); t('1.234,50', 470, 300, 9, c.bold);
});

await pdf('ssrs-no-colon.pdf', ['Invoice No', 'invoice no', 'Invoice Date', 'No', 'Amount due'], (c) => {
  letterhead(c, 'INVOICE');
  const { t } = c;
  t('Invoice No', 330, 140); t('INV 2026 00118', 430, 140);
  t('Invoice Date', 330, 154); t('01.10.2026', 430, 154);
  t('Amount due', 330, 168); t('EUR 2.500,00', 430, 168);
  t('Bill to', 40, 140); t('Fabrikam Example d.o.o.', 40, 154);
  lines(c, 220, [['Licence', '1', '2.500,00']]);
});

await pdf('ssrs-below.pdf', ['Debit note number', 'Due date', 'DN-2026-00018', 'Reference'], (c) => {
  letterhead(c, 'DEBIT NOTE');
  const { t } = c;
  t('Debit note number', 330, 140); t('Due date', 470, 140);
  t('DN-2026-00018', 331, 154); t('30.10.2026', 471, 154); // values one row below, nudged 1 pt like SSRS cells
  t('Reference', 40, 140); t('PO-55-0912', 40, 154);
  lines(c, 220, [['Service fee', '12', '1.200,00']]);
});

await pdf('ssrs-two-column.pdf', ['Invoice No.:', 'Order No.:', 'No.:', 'Date:', 'Bill to'], (c) => {
  letterhead(c, 'INVOICE');
  const { t } = c;
  t('Bill to', 40, 140); t('Tailspin Sample Inc.', 40, 154); t('Anystreet 5', 40, 166);
  t('Invoice', 330, 140); t('No.:', 363, 140); t('INV-2026-00119', 430, 140);
  t('Order', 330, 154); t('No.:', 357, 154); t('PO-2026-7781', 430, 154);
  t('Date:', 330, 168); t('02.10.2026', 430, 168);
  lines(c, 220, [['Hardware', '2', '640,00']]);
});

await pdf('ssrs-repeat.pdf', ['Invoice No.:', 'Total'], (c) => {
  letterhead(c, 'CREDIT NOTE');
  const { t } = c;
  t('Invoice No.:', 330, 140); t('CN-2026-00019', 430, 140);
  lines(c, 220, [['Refund', '1', '-120,00']]);
  t('Total', 330, 300); t('-120,00', 470, 300);
  t('Invoice No.:', 40, 700); t('DN-2026-00011', 120, 700); // second occurrence: the note this credit refers to
});

// One text-show per glyph, as some producers write.
await pdf('perglyph.pdf', ['Invoice No.:', 'Date:'], (c) => {
  const glyphs = (text, x, y, size = 9) => {
    for (const ch of text) {
      c.t(ch, x, y, size);
      x += c.font.widthOfTextAtSize(ch, size);
    }
  };
  glyphs('Invoice No.:', 330, 140); glyphs('INV-77120', 430, 140);
  glyphs('Date:', 330, 154); glyphs('03.10.2026', 430, 154);
});

// TJ arrays with kerning; a large gap splits the value the way some producers do.
await pdf('tj-kerning.pdf', ['Invoice No.:', 'Invoice', 'Date:'], ({ doc, page, font }) => {
  const F = page.node.newFontDictionary('FK', font.ref);
  const tj = (parts, x, y) =>
    page.pushOperators(
      beginText(),
      setFontAndSize(F, 9),
      moveText(x, A4[1] - y),
      PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [doc.context.obj(parts.map((p) => (typeof p === 'string' ? font.encodeText(p) : p)))]),
      endText(),
    );
  tj(['Invoice', -250, 'No.:'], 330, 140);
  tj(['INV', -20, '-2026', 300, '-0042'], 430, 140);
  tj(['Date:'], 330, 154);
  tj(['04.10.2026'], 430, 154);
});

// A scan: shapes only, no text layer.
await pdf('scanned.pdf', ['Invoice No.:'], ({ page }) => {
  for (let i = 0; i < 12; i++) page.drawRectangle({ x: 40, y: 760 - i * 40, width: 300 + (i % 3) * 60, height: 10 });
});

// Not PDFs at all: must be reported as unreadable.
writeFileSync(join(OUT, 'broken.pdf'), '%PDF-1.7\nthis is not really a pdf\n');
writeFileSync(join(OUT, 'empty.pdf'), '');

// An HTML invoice printed by a Chromium browser (Edge, Chrome or Playwright's headless shell).
function findBrowser() {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean);
  const candidates = [
    ...roots.map((r) => join(r, 'Microsoft/Edge/Application/msedge.exe')),
    ...roots.map((r) => join(r, 'Google/Chrome/Application/chrome.exe')),
  ];
  const pw = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).filter((d) => d.startsWith('chromium')).sort().reverse()) {
      candidates.push(join(pw, d, 'chrome-headless-shell-win64/chrome-headless-shell.exe'), join(pw, d, 'chrome-win64/chrome.exe'), join(pw, d, 'chrome-win/chrome.exe'));
    }
  }
  return candidates.find((c) => existsSync(c));
}
const HTML_KEYWORDS = ['Invoice No.:', 'Date', 'Customer No.', 'Total'];
const browser = findBrowser();
if (browser) {
  execFileSync(browser, ['--headless', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${join(OUT, 'html-print.pdf')}`, pathToFileURL(resolve('scripts/fixtures/invoice.html')).href], { stdio: 'ignore' });
}
if (existsSync(join(OUT, 'html-print.pdf'))) cases['html-print.pdf'] = HTML_KEYWORDS;
else console.warn('No Chromium browser found: html-print.pdf skipped');

// Companion files for pairing.
const book = (rows) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};
writeFileSync(join(PAIR, 'export-17.xlsx'), book([['Invoice No.:', 'Amount'], ['DN-2026-00017', 1234.5]]));
writeFileSync(join(PAIR, 'numbers.xlsx'), book([['Ref', 'Amount'], [12345, 10], ['  DN-2026-00011  ', 5]]));
writeFileSync(join(PAIR, 'decoy.xlsx'), book([['Invoice No.:'], ['DN-2026-99999']]));
writeFileSync(join(PAIR, 'list-18.csv'), '﻿Ref;Customer;Amount\r\n"DN-2026-00018";"Fabrikam; Example";"1.200,00"\r\n');
writeFileSync(join(PAIR, 'remit-19.xml'), '<?xml version="1.0"?>\n<remittance><ref>CN-2026-00019</ref></remittance>\n');
writeFileSync(join(PAIR, 'note-17.txt'), 'Payment for DN-2026-00017 received.\r\n');

// The tour's sample set, bundled with the app: four invoices with a number, one without, one matching export.
const TOUR = resolve('src-tauri/resources/tour');
mkdirSync(TOUR, { recursive: true });
const sampleInvoice = (no) => (c) => {
  letterhead(c, 'INVOICE');
  c.t('Invoice No.:', 330, 140); c.t(no, 430, 140);
  c.t('Date:', 330, 154); c.t('16.10.2026', 430, 154);
  lines(c, 220, [['Sample service', '1', '100,00']]);
};
for (const [file, no] of [['scan_0011.pdf', 'INV-2041'], ['scan_0012.pdf', 'INV-2042'], ['scan_0013.pdf', 'INV-2043'], ['scan_0015.pdf', 'INV-2044']]) {
  await pdf(file, [], sampleInvoice(no), TOUR);
}
await pdf('scan_0014.pdf', [], (c) => {
  letterhead(c, 'DELIVERY NOTE');
  c.t('Delivery date:', 330, 140); c.t('16.10.2026', 430, 140);
  lines(c, 220, [['Sample parcel', '1', '']]);
}, TOUR);
writeFileSync(join(TOUR, 'export_0012.xlsx'), book([['Invoice No.:', 'Amount'], ['INV-2042', 100]]));

// Split fixtures.
const SPLIT = join(OUT, 'split');
mkdirSync(SPLIT, { recursive: true });
const regions = ['North', 'South', 'East', 'West'];
const people = ['Ana Test', 'Ben Sample', 'Cleo Fake', 'Dan Example'];
const exWorkbook = () => {
  const wb = new ExcelJS.Workbook();
  wb.created = FIXED;
  wb.modified = FIXED;
  return wb;
};

{
  const wb = exWorkbook();
  const ws = wb.addWorksheet('Report');
  ws.getCell('A1').value = 'Fake Costs Report';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.mergeCells('A1:E1');
  ws.getCell('A2').value = 'Synthetic data';
  ws.addRow(['Region', 'Cost centre', 'Person', 'Amount', 'Note']);
  ws.getRow(3).font = { bold: true };
  ws.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  // data rows 4..44 minus the blank row 20: 40 data rows
  for (let i = 0; i < 41; i++) {
    const r = 4 + i;
    if (r === 20) continue;
    const row = ws.getRow(r);
    row.values = [regions[i % 4], 1001 + (i % 5), people[i % 4], 100 + i * 12.5, `note ${i}`];
    if (i % 2) row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    row.getCell(4).numFmt = '#,##0.00';
  }
  ws.getCell('D4').value = 100;
  ws.getCell('F4').value = { formula: 'D4*2', result: 200 };
  ws.columns.forEach((c, i) => { c.width = [12, 14, 16, 12, 20][i] ?? 10; });
  ws.getColumn(5).hidden = true;
  writeFileSync(join(SPLIT, 'formatted.xlsx'), Buffer.from(await wb.xlsx.writeBuffer()));
}

{
  const wb = exWorkbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(['Region', 'Person', 'Amount']);
  for (let i = 0; i < 12; i++) ws.addRow([regions[i % 4], people[i % 4], 50 + i * 7]);
  wb.addWorksheet('Notes').addRow(['Synthetic notes']);
  writeFileSync(join(SPLIT, 'simple.xlsx'), Buffer.from(await wb.xlsx.writeBuffer()));
}

writeFileSync(
  join(SPLIT, 'bom-semicolon.csv'),
  '﻿ID;Name;Amount\r\n00123;"Doe, Jane";1.234,56\r\n456;Test Person;78,90\r\n00789;Sample Co;5,00\r\n',
);
// Windows-1250 bytes written directly: Č=C8 a=61 k=6B o=6F v=76 e=65 c=63, Đ=D0 u=75 r=72 đ=F0 e=65 v=76 a=61 c=63, Š=8A i=69 b=62 e=65 n=6E i=69 k=6B
writeFileSync(
  join(SPLIT, 'cp1250.csv'),
  Buffer.concat([
    Buffer.from('City,Count\r\n', 'latin1'),
    Buffer.from([0xc8, 0x61, 0x6b, 0x6f, 0x76, 0x65, 0x63]), Buffer.from(',1\r\n'),
    Buffer.from([0xd0, 0x75, 0x72, 0xf0, 0x65, 0x76, 0x61, 0x63]), Buffer.from(',2\r\n'),
    Buffer.from([0x8a, 0x69, 0x62, 0x65, 0x6e, 0x69, 0x6b]), Buffer.from(',3\r\n'),
  ]),
);
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Region', 'Amount'], ['North', 10], ['South', 20]]), 'Alpha');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Person', 'Amount'], ['Ana Test', 5]]), 'Beta');
  writeFileSync(join(SPLIT, 'legacy.xls'), XLSX.write(wb, { type: 'buffer', bookType: 'xls' }));
}
writeFileSync(join(OUT, 'cases.json'), `${JSON.stringify(cases, null, 2)}\n`);
console.log(`wrote ${Object.keys(cases).length} PDFs with cases, plus broken.pdf, empty.pdf and ${PAIR}`);
