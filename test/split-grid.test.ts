import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cellText, csvNumber, decodeCsv, gridOf, loadSource } from '../src/lib/split/engine/grid';

const fx = (n: string) => new Uint8Array(readFileSync(`test/fixtures/split/${n}`));

describe('cellText', () => {
  it('turns cell values into text', () => {
    expect(cellText(null)).toBe('');
    expect(cellText({ richText: [{ text: 'A' }, { text: 'B' }] })).toBe('AB');
    expect(cellText({ formula: 'D4*2', result: 20 })).toBe('20');
    expect(cellText({ text: 'site', hyperlink: 'x' })).toBe('site');
    expect(cellText(1001)).toBe('1001');
    expect(cellText(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01-05');
    expect(cellText(true)).toBe('TRUE');
  });
});

describe('decodeCsv', () => {
  it('detects encoding and delimiter', () => {
    const a = decodeCsv(fx('bom-semicolon.csv'));
    expect([a.encoding, a.delimiter]).toEqual(['utf-8', ';']);
    expect(a.text.startsWith('﻿')).toBe(false);
    const b = decodeCsv(fx('cp1250.csv'));
    expect(b.encoding).toBe('windows-1250');
    expect(b.text).toContain('Đurđevac');
    const c = decodeCsv(new Uint8Array([0x61, 0xe0, 0x2c, 0x62, 0xe8]));
    expect(c.encoding).toBe('windows-1252');
    expect(decodeCsv(new TextEncoder().encode('a\tb\n1\t2')).delimiter).toBe('\t');
    expect(decodeCsv(new TextEncoder().encode('"a,b,c";d\n')).delimiter).toBe(';');
  });
});

describe('grid', () => {
  it('reads xlsx rows 1:1 with sheet rows', async () => {
    const g = gridOf(await loadSource('.xlsx', fx('formatted.xlsx')), null);
    expect(g.rows[2].slice(0, 5)).toEqual(['Region', 'Cost centre', 'Person', 'Amount', 'Note']);
    expect(g.rows[19]).toEqual([]);
    expect(g.merges).toContain('A1:E1');
    expect(g.sheets[0].rows).toBe(44);
    expect(g.rows).toHaveLength(44);
    expect(g.rows[3][1]).toBe('1001');
    expect(g.rows[0]).toEqual(['Fake Costs Report']);
  });

  it('throws a clear error for an unknown sheet', async () => {
    const src = await loadSource('.xlsx', fx('simple.xlsx'));
    expect(() => gridOf(src, 'NoSuchSheet')).toThrow('Sheet not found: NoSuchSheet');
  });

  it('reads xls sheets', async () => {
    const src = await loadSource('.xls', fx('legacy.xls'));
    const g = gridOf(src, null);
    expect(g.sheets.map((s) => s.name)).toEqual(['Alpha', 'Beta']);
    expect(g.rows[1]).toEqual(['North', '10']);
    expect(gridOf(src, 'Beta').rows[1]).toEqual(['Ana Test', '5']);
  });

  it('reads csv with a quoted comma as one field', async () => {
    const g = gridOf(await loadSource('.csv', fx('bom-semicolon.csv')), null);
    expect(g.delimiter).toBe(';');
    expect(g.rows[1]).toEqual(['00123', 'Doe, Jane', '1.234,56']);
  });
});

describe('csvNumber', () => {
  it.each([
    ['1234', '.', 1234], ['-12.5', '.', -12.5], ['1,234.56', '.', 1234.56], ['1.234,56', ',', 1234.56],
    ['0,5', ',', 0.5], ['0', '.', 0], ['00123', '.', null], ['1234567890123456', '.', null],
    ['1,23.4', '.', null], ['12.5', ',', null], ['2026-01-05', '.', null], [' 42 ', '.', 42],
    ['', '.', null], ['1e5', '.', null],
  ] as const)('%s with %s', (t, d, want) => expect(csvNumber(t, d)).toBe(want));
});
