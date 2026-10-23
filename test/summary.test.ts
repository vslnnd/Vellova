import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, type RenameRules } from '../src/lib/rename/engine/profile';
import { renameSummary, stepLabel } from '../src/lib/rename/engine/summary';
import { DEFAULT_SPLIT_RULES } from '../src/lib/split/engine/profile';
import { splitSummary } from '../src/lib/split/engine/summary';
import type { SplitRules, Step } from '../src/lib/shared/types';

const text = (s: Step) => stepLabel(s);

describe('stepLabel', () => {
  it('names a value step by its keyword and side', () => {
    expect(text({ type: 'pdfValue', keyword: 'Invoice No.:', position: 'after', occurrence: 1 })).toBe('Text after "Invoice No.:"');
    expect(text({ type: 'pdfValue', keyword: 'Total', position: 'below', occurrence: 2 })).toBe('Text below "Total"');
    expect(text({ type: 'pdfValue', keyword: '', position: 'after', occurrence: 1 })).toBe('Text after a keyword');
    expect(text({ type: 'pdfValue', keyword: '  ', position: 'below', occurrence: 1 })).toBe('Text below a keyword');
  });

  it('names each pattern preset', () => {
    const p = (preset: 'invoice' | 'date' | 'custom' | 'title' | 'created', regex = ''): Step => ({ type: 'pdfPattern', preset, regex, occurrence: 1 });
    expect(text(p('invoice'))).toBe('Invoice-style number');
    expect(text(p('date'))).toBe('Date in the PDF');
    expect(text(p('custom', '\\d{4}'))).toBe('Pattern \\d{4}');
    expect(text(p('title'))).toBe('Document title');
    expect(text(p('created'))).toBe('Creation date');
  });

  it('names a list step by the list file', () => {
    expect(text({ type: 'list', path: 'C:\\lists\\names.xlsx', match: 'File', name: 'Client', against: 'name' })).toBe('Name from names.xlsx');
  });

  it('adds text at the start, at the end, both, and at a position', () => {
    const add = (prefix: string, suffix: string, insert?: { text: string; at: number }): Step => ({ type: 'addText', prefix, suffix, ...(insert ? { insert } : {}) });
    expect(text(add('CN_', ''))).toBe('Add "CN_" at the start');
    expect(text(add('', '_x'))).toBe('Add "_x" at the end');
    expect(text(add('CN_', '_x'))).toBe('Add "CN_" at the start and "_x" at the end');
    expect(text(add('CN_', '_x', { text: '!', at: 1 }))).toBe('Add "CN_" at the start and "_x" at the end, "!" at position 1');
    expect(text(add('', '', { text: '!', at: 1 }))).toBe('Add "!" at position 1');
    expect(text(add('', ''))).toBe('Add text');
  });

  it('names replace, remove, trim and case steps', () => {
    expect(text({ type: 'replace', find: 'a', with: 'b', regex: false, matchCase: false, all: true })).toBe('Replace "a" with "b"');
    const rm = (what: 'range' | 'digits' | 'between'): Step => ({ type: 'remove', what, from: 3, to: 5, start: '(', end: ')' });
    expect(text(rm('range'))).toBe('Remove characters 3 to 5');
    expect(text(rm('digits'))).toBe('Remove digits');
    expect(text(rm('between'))).toBe('Remove text between "(" and ")"');
    expect(text({ type: 'trim' })).toBe('Trim spaces');
    expect(['upper', 'lower', 'title', 'sentence'].map((to) => text({ type: 'case', to } as Step))).toEqual(['UPPER CASE', 'lower case', 'Title Case', 'Sentence case']);
  });

  it('names number and date steps', () => {
    expect(text({ type: 'number', start: 1, step: 1, pad: 3, at: 'end', sep: '_' })).toBe('Number from 001, at the end');
    expect(text({ type: 'number', start: 7, step: 1, pad: 1, at: 'start', sep: '_' })).toBe('Number from 7, at the start');
    expect(text({ type: 'date', from: 'modified', format: 'yyyy-MM-dd', at: 'start', sep: '_' })).toBe('Date modified as yyyy-MM-dd, at the start');
    expect(text({ type: 'date', from: 'created', format: 'yyyyMMdd', at: 'end', sep: '_' })).toBe('Date created as yyyyMMdd, at the end');
    expect(text({ type: 'date', from: 'today', format: 'yyyyMMdd', at: 'end', sep: '_' })).toBe("Today's date as yyyyMMdd, at the end");
  });
});

describe('renameSummary', () => {
  const rules = (over: Partial<RenameRules>): RenameRules => ({ ...structuredClone(DEFAULT_RULES), ...over });

  it('lists a line per step, then where the files go, what happens if taken and matching files', () => {
    const r = rules({
      steps: [
        { type: 'pdfValue', keyword: 'Invoice No.:', position: 'after', occurrence: 1 },
        { type: 'addText', prefix: 'CN_', suffix: '' },
      ],
    });
    expect(renameSummary(r).lines).toEqual([
      { key: 'step-0', label: 'New name', text: 'Text after "Invoice No.:"' },
      { key: 'step-1', label: 'New name', text: 'Add "CN_" at the start' },
      { key: 'dest', label: 'Files go', text: 'Rename in place' },
      { key: 'conflict', label: 'If taken', text: 'Add (1)' },
      { key: 'pair', label: 'Matching files', text: 'Renamed too' },
    ]);
  });

  it('names the other destinations, conflicts and pairing', () => {
    const lines = (r: RenameRules) => Object.fromEntries(renameSummary(r).lines.map((l) => [l.key, l.text]));
    expect(lines(rules({ destination: { mode: 'copy', folder: 'D:\\out\\{value}' }, conflict: 'skip', pair: false }))).toMatchObject({
      dest: 'Copy to D:\\out\\{value}', conflict: 'Skip', pair: 'Left alone',
    });
    expect(lines(rules({ destination: { mode: 'move', folder: 'D:\\out' }, conflict: 'replace' }))).toMatchObject({ dest: 'Move to D:\\out', conflict: 'Replace' });
  });
});

describe('splitSummary', () => {
  const rules = (over: Partial<SplitRules>): SplitRules => ({ ...structuredClone(DEFAULT_SPLIT_RULES), ...over });
  const lines = (r: SplitRules, archive: string | null = null) => Object.fromEntries(splitSummary(r, archive).lines.map((l) => [l.key, l.text]));

  it('lists the settings of a split by value, in order', () => {
    expect(splitSummary(rules({}), null).lines).toEqual([
      { key: 'mode', label: 'Split by', text: 'By value' },
      { key: 'header', label: 'Header', text: 'Row 1' },
      { key: 'save', label: 'Save to', text: 'Same folder as the source · same type · if taken: add (1)' },
      { key: 'names', label: 'File names', text: '{date}_{file}_{group}' },
      { key: 'subfolders', label: 'Subfolders', text: 'Off' },
      { key: 'archive', label: 'Archive', text: 'Off' },
    ]);
  });

  it('names the value column', () => {
    expect(lines(rules({ column: 'Region' })).mode).toBe('By value (Region)');
    expect(lines(rules({ mode: 'people', column: 'Region' })).mode).toBe('People');
  });

  it('names every mode', () => {
    const modes = (['value', 'people', 'rows', 'parts', 'sheets'] as const).map((mode) => lines(rules({ mode })).mode);
    expect(modes).toEqual(['By value', 'People', 'Rows', 'Parts', 'Sheets']);
  });

  it('shows the header row, and no header line for Sheets', () => {
    expect(lines(rules({ header: { mode: 'manual', row: 4 } })).header).toBe('Row 4');
    expect(lines(rules({ mode: 'sheets' })).header).toBeUndefined();
  });

  it('shows the folder, format and conflict', () => {
    expect(lines(rules({ folder: { mode: 'folder', path: 'D:\\out' }, format: 'xlsx', conflict: 'skip' })).save).toBe('D:\\out · .xlsx · if taken: skip');
    expect(lines(rules({ format: 'csv', conflict: 'replace' })).save).toBe('Same folder as the source · .csv · if taken: replace');
  });

  it('shows the typed template, or the mode default', () => {
    expect(lines(rules({ template: '{file}_{group}' })).names).toBe('{file}_{group}');
    expect(lines(rules({ mode: 'rows' })).names).toBe('{date}_{file}_part{part}');
    expect(lines(rules({ mode: 'people', peopleOutput: 'column' })).names).toBe('{date}_{file}_assigned');
  });

  it('shows subfolders only for value and people files', () => {
    expect(lines(rules({ subfolder: true })).subfolders).toBe('One per group');
    expect(lines(rules({ mode: 'people', subfolder: true })).subfolders).toBe('One per group');
    for (const r of [rules({ mode: 'people', peopleOutput: 'column' }), rules({ mode: 'rows' }), rules({ mode: 'parts' }), rules({ mode: 'sheets' })]) {
      expect(lines(r).subfolders).toBeUndefined();
    }
  });

  it('shows the archive folder or Off', () => {
    expect(lines(rules({}), 'D:\\archive').archive).toBe('D:\\archive');
    expect(lines(rules({}), null).archive).toBe('Off');
  });
});
