import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { companionData, type CompanionData } from '../src/lib/rename/engine/companion';
import { pairCompanions } from '../src/lib/rename/engine/pairing';

const read = (f: string) => companionData(f.slice(f.lastIndexOf('.')), new Uint8Array(readFileSync(`test/fixtures/pair/${f}`)));
const cells = (d: CompanionData) => ('cells' in d ? d.cells : []);
const text = (d: CompanionData) => ('text' in d ? d.text : '');

describe('companion files are read once into values', () => {
  it('xlsx: every cell, trimmed, numbers as text', () => {
    expect(cells(read('numbers.xlsx'))).toEqual(expect.arrayContaining(['Ref', '12345', 'DN-2026-00011', '10', '5']));
  });
  it('csv: every field, with ; delimiters, quotes and a BOM', () => {
    expect(cells(read('list-18.csv'))).toEqual(expect.arrayContaining(['Ref', 'DN-2026-00018', 'Fabrikam; Example', '1.200,00']));
  });
  it('xml and txt: the raw text', () => {
    expect(text(read('remit-19.xml'))).toContain('<ref>CN-2026-00019</ref>');
    expect(text(read('note-17.txt'))).toContain('DN-2026-00017');
  });
});

describe('pairCompanions', () => {
  const pdfs = [
    { path: 'A.pdf', value: 'DN-2026-00017' },
    { path: 'B.pdf', value: 'DN-2026-00018' },
    { path: 'C.pdf', value: 'CN-2026-00019' },
  ];
  const comp = (path: string, data: CompanionData) => ({ path, data });

  it('pairs each companion with the PDF whose value it contains; decoys stay unpaired', () => {
    const got = pairCompanions(pdfs, [
      comp('x.xlsx', read('export-17.xlsx')), comp('l.csv', read('list-18.csv')),
      comp('r.xml', read('remit-19.xml')), comp('d.xlsx', read('decoy.xlsx')),
    ]);
    expect(got).toEqual({ 'x.xlsx': 'A.pdf', 'l.csv': 'B.pdf', 'r.xml': 'C.pdf' });
  });

  it('the first PDF in list order wins, like 1.4.6', () => {
    expect(pairCompanions([{ path: 'B.pdf', value: 'X' }, { path: 'A.pdf', value: 'Y' }], [comp('t.txt', { text: 'Y and X' })])).toEqual({ 't.txt': 'B.pdf' });
  });

  it('cells must match exactly; text matches anywhere (1.4.6)', () => {
    const short = [{ path: 'S.pdf', value: 'DN-2026-0001' }];
    expect(pairCompanions(short, [comp('x.xlsx', read('export-17.xlsx'))])).toEqual({});
    expect(pairCompanions(short, [comp('n.txt', read('note-17.txt'))])).toEqual({ 'n.txt': 'S.pdf' });
  });

  it('trims values and cells', () => {
    expect(pairCompanions([{ path: 'P.pdf', value: ' DN-2026-00011 ' }], [comp('n.xlsx', read('numbers.xlsx'))])).toEqual({ 'n.xlsx': 'P.pdf' });
  });
});
