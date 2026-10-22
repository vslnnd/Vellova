import { describe, expect, it } from 'vitest';
import type { Item } from '../src/lib/rename/engine/pdfItems';
import { formatDate, listMap, NEW_STEP, patternError, runSteps, type StepCtx } from '../src/lib/rename/engine/steps';
import type { Grid } from '../src/lib/split/engine/grid';
import type { Step } from '../src/lib/shared/types';

const item = (str: string, x: number, y: number, page = 1): Item => ({ str, x, y, page });
const items = [item('Invoice No.:', 50, 100), item('DN-2026-00017', 150, 100)];
const ctx = (o: Partial<StepCtx>): StepCtx => ({
  base: 'scan 01',
  pdf: { items, title: 'Q3 report', created: '2026-10-01' },
  lists: {},
  index: 4,
  mtime: Date.UTC(2026, 0, 2, 12),
  ctime: Date.UTC(2025, 11, 31, 12),
  today: new Date(2026, 9, 23),
  ...o,
});
const pdfValue = (keyword: string, position: 'after' | 'before' | 'above' | 'below'): Step => ({ type: 'pdfValue', keyword, position, occurrence: 1 });
const pattern = (o: Partial<Extract<Step, { type: 'pdfPattern' }>>): Step => ({ ...NEW_STEP.pdfPattern, ...o }) as Step;
const SRC = 'a  B-c (x) 12';
/** The name after one modifier step, run on SRC. */
const on = (step: Step, base = SRC) => {
  const r = runSteps([step], ctx({ base }));
  if (!r.ok) throw new Error(r.detail);
  return r.base;
};

describe('runSteps: sources and pairing values', () => {
  it('reads a value from the PDF, then adds text around it', () => {
    expect(runSteps([pdfValue('Invoice No.:', 'after'), { type: 'addText', prefix: 'CN_', suffix: '' }], ctx({}))).toEqual({
      ok: true, base: 'CN_DN-2026-00017', value: 'DN-2026-00017', n: '5', date: '2026-10-23',
    });
  });

  it('without steps the name stays the base and there is no value', () => {
    expect(runSteps([], ctx({}))).toEqual({ ok: true, base: 'scan 01', value: null, n: '5', date: '2026-10-23' });
  });

  it('pdfValue failures keep the 1.4.6 reason; unread text is internal', () => {
    expect(runSteps([pdfValue('Nope', 'after')], ctx({}))).toMatchObject({ ok: false, reason: 'keyword-not-found' });
    expect(runSteps([pdfValue('Invoice No.:', 'after')], ctx({ pdf: { items: [], title: '', created: '' } }))).toMatchObject({ ok: false, reason: 'no-text' });
    expect(runSteps([pdfValue('Invoice No.:', 'after')], ctx({ pdf: null }))).toEqual({ ok: false, reason: 'internal', detail: 'The PDF text was not read.' });
    expect(runSteps([pattern({ preset: 'invoice' })], ctx({ pdf: null }))).toEqual({ ok: false, reason: 'internal', detail: 'The PDF text was not read.' });
  });

  it('presets and custom patterns find the value; the first capture group wins', () => {
    const value = (p: Partial<Extract<Step, { type: 'pdfPattern' }>>) => {
      const r = runSteps([pattern(p)], ctx({}));
      return r.ok ? r.value : r;
    };
    expect(value({ preset: 'invoice' })).toBe('DN-2026-00017');
    expect(value({ preset: 'custom', regex: 'No\\.:\\s*(\\S+)' })).toBe('DN-2026-00017');
    expect(value({ preset: 'custom', regex: 'No\\.:\\s*\\S+' })).toBe('No.: DN-2026-00017');
    expect(value({ preset: 'title' })).toBe('Q3 report');
    expect(value({ preset: 'created' })).toBe('2026-10-01');
  });

  it('the date preset reads both date styles, and occurrence picks the match', () => {
    const pdf = { items: [item('Due 31.12.2026 and 2026-10-05', 0, 0)], title: '', created: '' };
    const value = (occurrence: number) => {
      const r = runSteps([pattern({ preset: 'date', occurrence })], ctx({ pdf }));
      return r.ok ? r.value : r.reason;
    };
    expect([value(1), value(2), value(3)]).toEqual(['31.12.2026', '2026-10-05', 'no-pattern']);
  });

  it('an invalid pattern, a missing match, a second match that is not there and an empty title are no-pattern', () => {
    const reason = (p: Partial<Extract<Step, { type: 'pdfPattern' }>>, o: Partial<StepCtx> = {}) => {
      const r = runSteps([pattern(p)], ctx(o));
      return r.ok ? 'ok' : r.reason;
    };
    expect(reason({ preset: 'custom', regex: '(' })).toBe('no-pattern');
    expect(reason({ preset: 'custom', regex: 'ZZZ' })).toBe('no-pattern');
    expect(reason({ preset: 'invoice', occurrence: 2 })).toBe('no-pattern');
    expect(reason({ preset: 'title' }, { pdf: { items, title: '', created: '' } })).toBe('no-pattern');
    expect(runSteps([pattern({ preset: 'title' })], ctx({ pdf: { items, title: '', created: '' } }))).toMatchObject({
      detail: 'This PDF has no title in its document info.',
    });
  });

  it('a pattern that can match nothing never yields an empty value', () => {
    expect(runSteps([pattern({ preset: 'custom', regex: 'x*' })], ctx({}))).toMatchObject({ ok: false, reason: 'no-pattern' });
  });

  it('patternError flags invalid and empty-matching custom patterns only', () => {
    expect(patternError(pattern({ preset: 'custom', regex: '(' }))).toMatch(/\S/);
    expect(patternError(pattern({ preset: 'custom', regex: 'x*' }))).toMatch(/matches empty text/);
    expect(patternError(pattern({ preset: 'custom', regex: 'No\\.' }))).toBeNull();
    expect(patternError(pattern({ preset: 'invoice' }))).toBeNull();
    expect(patternError({ type: 'trim' })).toBeNull();
  });

  it('value stays from the last pdf source; a list step never sets it', () => {
    const lists = { 'C:\\l.xlsx': { ok: true as const, map: new Map([['dn-2026-00017', 'Acme']]) } };
    const list: Step = { type: 'list', path: 'C:\\l.xlsx', match: 'Code', name: 'Name', against: 'value' };
    expect(runSteps([pdfValue('Invoice No.:', 'after'), list], ctx({ lists }))).toMatchObject({ ok: true, base: 'Acme', value: 'DN-2026-00017' });
  });
});

describe('runSteps: lists', () => {
  const list = (against: 'name' | 'value'): Step => ({ type: 'list', path: 'C:\\l.xlsx', match: 'Code', name: 'Name', against });

  it('looks the current name up, trimmed and case-insensitive', () => {
    const lists = { 'C:\\l.xlsx': { ok: true as const, map: new Map([['scan 01', 'Acme']]) } };
    expect(runSteps([list('name')], ctx({ lists }))).toMatchObject({ ok: true, base: 'Acme' });
    expect(runSteps([list('name')], ctx({ lists, base: ' SCAN 01 ' }))).toMatchObject({ ok: true, base: 'Acme' });
  });

  it('a name that is not listed is not-in-list', () => {
    const lists = { 'C:\\l.xlsx': { ok: true as const, map: new Map([['other', 'Acme']]) } };
    expect(runSteps([list('name')], ctx({ lists }))).toMatchObject({ ok: false, reason: 'not-in-list' });
  });

  it('against the value needs a source step first', () => {
    expect(runSteps([list('value')], ctx({}))).toEqual({ ok: false, reason: 'not-in-list', detail: 'No value was found before this step.' });
  });

  it('a list that could not be read reports its detail', () => {
    const lists = { 'C:\\l.xlsx': { ok: false as const, detail: 'locked' } };
    const r = runSteps([list('name')], ctx({ lists }));
    expect(r).toMatchObject({ ok: false, reason: 'not-in-list' });
    expect(!r.ok && r.detail).toContain('locked');
  });

  it('a list the session never read is internal', () => {
    expect(runSteps([list('name')], ctx({}))).toMatchObject({ ok: false, reason: 'internal' });
  });
});

describe('runSteps: modifiers', () => {
  it('replace: literal and case-insensitive by default, all matches, $ is not special', () => {
    expect(on({ type: 'replace', find: 'B', with: 'Z', regex: false, matchCase: false, all: true })).toBe('a  Z-c (x) 12');
    expect(on({ type: 'replace', find: 'b', with: 'Z', regex: false, matchCase: true, all: true })).toBe(SRC);
    expect(on({ type: 'replace', find: 'a', with: '-', regex: false, matchCase: false, all: false }, 'aaa')).toBe('-aa');
    expect(on({ type: 'replace', find: 'a', with: '$&$&', regex: false, matchCase: false, all: true }, 'xa')).toBe('x$&$&');
    expect(on({ type: 'replace', find: '(x)', with: 'y', regex: false, matchCase: false, all: true })).toBe('a  B-c y 12');
  });

  it('replace: regex with groups; nothing to find leaves the name; a bad pattern is no-pattern', () => {
    expect(on({ type: 'replace', find: '\\d+', with: '#', regex: true, matchCase: false, all: true })).toBe('a  B-c (x) #');
    expect(on({ type: 'replace', find: '(\\w)-(\\w)', with: '$2-$1', regex: true, matchCase: true, all: true })).toBe('a  c-B (x) 12');
    expect(on({ type: 'replace', find: '', with: 'Z', regex: false, matchCase: false, all: true })).toBe(SRC);
    const r = runSteps([{ type: 'replace', find: '(', with: '', regex: true, matchCase: false, all: true }], ctx({}));
    expect(r).toMatchObject({ ok: false, reason: 'no-pattern' });
    expect(!r.ok && r.detail).toMatch(/\S/);
  });

  it('remove: a 1-based inclusive range, digits, and the first span between two markers', () => {
    const remove = (o: Partial<Extract<Step, { type: 'remove' }>>): Step => ({ ...NEW_STEP.remove, ...o }) as Step;
    expect(on(remove({ what: 'range', from: 1, to: 2 }))).toBe(' B-c (x) 12');
    expect(on(remove({ what: 'range', from: 4, to: 4 }))).toBe('a  -c (x) 12');
    expect(on(remove({ what: 'range', from: 12, to: 99 }))).toBe('a  B-c (x) ');
    expect(on(remove({ what: 'range', from: 5, to: 2 }))).toBe(SRC);
    expect(on(remove({ what: 'digits' }))).toBe('a  B-c (x) ');
    expect(on(remove({ what: 'between', start: '(', end: ')' }))).toBe('a  B-c  12');
    expect(on(remove({ what: 'between', start: '[', end: ']' }))).toBe(SRC);
    expect(on(remove({ what: 'between', start: '"', end: '"' }), 'a "b" c "d"')).toBe('a  c "d"');
  });

  it('trim trims and collapses whitespace runs', () => {
    expect(on({ type: 'trim' })).toBe('a B-c (x) 12');
    expect(on({ type: 'trim' }, '  a \t b  ')).toBe('a b');
  });

  it('case: upper, lower, title (first letter after start, space, _ or -) and sentence (first letter, the rest lower)', () => {
    const to = (c: 'upper' | 'lower' | 'title' | 'sentence', base = SRC) => on({ type: 'case', to: c }, base);
    expect(to('upper')).toBe('A  B-C (X) 12');
    expect(to('lower')).toBe('a  b-c (x) 12');
    expect(to('title')).toBe('A  B-C (x) 12');
    expect(to('title', 'ANNUAL_report-q3 final')).toBe('Annual_Report-Q3 Final');
    expect(to('sentence')).toBe('A  b-c (x) 12');
    expect(to('sentence', 'ANNUAL REPORT')).toBe('Annual report');
  });

  it('addText: prefix, suffix, and an insert at a position counted from 0', () => {
    expect(on({ type: 'addText', prefix: 'P_', suffix: '_S' })).toBe('P_a  B-c (x) 12_S');
    expect(on({ type: 'addText', prefix: '', suffix: '', insert: { text: '!', at: 1 } })).toBe('a!  B-c (x) 12');
    expect(on({ type: 'addText', prefix: '', suffix: '', insert: { text: '!', at: 0 } })).toBe('!a  B-c (x) 12');
    expect(on({ type: 'addText', prefix: '', suffix: '', insert: { text: '!', at: 99 } })).toBe('a  B-c (x) 12!');
    expect(on({ type: 'addText', prefix: 'P_', suffix: '', insert: { text: '!', at: 1 } }, 'ab')).toBe('P_a!b');
  });
});

describe('runSteps: number and date', () => {
  it('number: start + index * step, padded, joined at the start or end, and offered as {n}', () => {
    expect(runSteps([{ type: 'number', start: 7, step: 2, pad: 3, at: 'start', sep: '-' }], ctx({}))).toMatchObject({ ok: true, base: '015-scan 01', n: '015' });
    expect(runSteps([{ ...NEW_STEP.number } as Step], ctx({ index: 0 }))).toMatchObject({ base: 'scan 01_001', n: '001' });
  });

  it('number: the padding is bounded to 20 digits, and a negative pad adds none', () => {
    const n = (pad: number) => {
      const r = runSteps([{ ...NEW_STEP.number, pad } as Step], ctx({ index: 0 }));
      return r.ok ? r.n : r.detail;
    };
    expect(n(999)).toBe('1'.padStart(20, '0'));
    expect(n(1e12)).toBe('1'.padStart(20, '0'));
    expect(n(-5)).toBe('1');
  });

  it('date: modified, created or today, formatted, joined, and offered as {date}', () => {
    expect(runSteps([{ type: 'date', from: 'modified', format: 'yyyyMMdd', at: 'end', sep: '_' }], ctx({}))).toMatchObject({ ok: true, base: 'scan 01_20260102', date: '20260102' });
    expect(runSteps([{ type: 'date', from: 'created', format: 'yyyy-MM-dd', at: 'start', sep: ' ' }], ctx({}))).toMatchObject({ base: '2025-12-31 scan 01' });
    expect(runSteps([{ type: 'date', from: 'today', format: 'dd.MM.yy', at: 'end', sep: '_' }], ctx({}))).toMatchObject({ base: 'scan 01_23.10.26' });
  });

  it('formatDate knows yyyy yy MM dd HH mm and leaves anything else as it is', () => {
    expect(formatDate(new Date(2026, 0, 5, 9, 7), 'dd.MM.yy HH:mm')).toBe('05.01.26 09:07');
    expect(formatDate(new Date(2026, 0, 5, 9, 7), 'yyyy-MM-dd (Q1) mm')).toBe('2026-01-05 (Q1) 07');
  });
});

describe('listMap', () => {
  const grid = (rows: string[][]): Grid => ({ sheets: [{ name: 'S', rows: rows.length }], sheet: 'S', rows, merges: [] });

  it('maps the match column to the name column by header, trimmed and case-insensitive', () => {
    const r = listMap(grid([[' Code ', 'New name'], [' A1 ', ' Acme '], ['b2', 'Beta']]), 'code', 'NEW NAME');
    expect(r.ok && r.map.get('a1')).toBe('Acme');
    expect(r.ok && r.map.get('b2')).toBe('Beta');
  });

  it('skips rows with a blank code or name, and the first row for a code wins', () => {
    const r = listMap(grid([['Code', 'Name'], ['', 'x'], ['c', ''], ['d', 'First'], ['D', 'Second'], ['short']]), 'Code', 'Name');
    expect(r.ok && [...r.map]).toEqual([['d', 'First']]);
  });

  it('a missing column says which one', () => {
    expect(listMap(grid([['Name'], ['x']]), 'Code', 'Name')).toEqual({ ok: false, detail: 'The list has no column "Code".' });
    expect(listMap(grid([['Code'], ['x']]), 'Code', 'Name')).toEqual({ ok: false, detail: 'The list has no column "Name".' });
    expect(listMap(grid([]), 'Code', 'Name')).toMatchObject({ ok: false });
  });

  it('a blank column name never matches a blank header', () => {
    expect(listMap(grid([['', 'Name'], ['x', 'y']]), '', 'Name')).toMatchObject({ ok: false });
  });
});

describe('NEW_STEP', () => {
  it('has a default for every kind, of that kind', () => {
    for (const [type, step] of Object.entries(NEW_STEP)) expect(step.type).toBe(type);
    expect(NEW_STEP.number).toEqual({ type: 'number', start: 1, step: 1, pad: 3, at: 'end', sep: '_' });
    expect(NEW_STEP.date).toEqual({ type: 'date', from: 'today', format: 'yyyy-MM-dd', at: 'start', sep: '_' });
  });
});
