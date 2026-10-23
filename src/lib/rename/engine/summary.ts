import { splitPath } from '../../shared/names';
import type { Step, Summary } from '../../shared/types';
import type { RenameRules } from './profile';

export type { Summary };

const quote = (s: string) => `"${s}"`;

/** One line for a step: what it does to the name. Also the header of a collapsed step. */
export function stepLabel(s: Step): string {
  switch (s.type) {
    case 'pdfValue':
      return `Text ${s.position} ${s.keyword.trim() ? quote(s.keyword) : 'a keyword'}`;
    case 'pdfPattern':
      return { invoice: 'Invoice-style number', date: 'Date in the PDF', custom: `Pattern ${s.regex}`, title: 'Document title', created: 'Creation date' }[s.preset];
    case 'list':
      return `Name from ${splitPath(s.path).name}`;
    case 'addText': {
      const ends = [s.prefix && `${quote(s.prefix)} at the start`, s.suffix && `${quote(s.suffix)} at the end`].filter(Boolean).join(' and ');
      const inserted = s.insert && `${quote(s.insert.text)} at position ${s.insert.at}`;
      return `Add ${[ends, inserted].filter(Boolean).join(', ') || 'text'}`;
    }
    case 'replace':
      return `Replace ${quote(s.find)} with ${quote(s.with)}`;
    case 'remove':
      return { range: `Remove characters ${s.from} to ${s.to}`, digits: 'Remove digits', between: `Remove text between ${quote(s.start)} and ${quote(s.end)}` }[s.what];
    case 'trim':
      return 'Trim spaces';
    case 'case':
      return { upper: 'UPPER CASE', lower: 'lower case', title: 'Title Case', sentence: 'Sentence case' }[s.to];
    case 'number':
      return `Number from ${String(s.start).padStart(s.pad, '0')}, at the ${s.at}`;
    case 'date':
      return `${{ today: "Today's date", modified: 'Date modified', created: 'Date created' }[s.from]} as ${s.format}, at the ${s.at}`;
  }
}

/** The profile's settings as label and text lines, for the summary card and the Profiles panel. */
export function renameSummary(r: RenameRules): Summary {
  const dest = r.destination;
  return {
    lines: [
      ...r.steps.map((s, i) => ({ key: `step-${i}`, label: 'New name', text: stepLabel(s) })),
      { key: 'dest', label: 'Files go', text: dest.mode === 'inplace' ? 'Rename in place' : `${dest.mode === 'copy' ? 'Copy' : 'Move'} to ${dest.folder}` },
      { key: 'conflict', label: 'If taken', text: { add: 'Add (1)', skip: 'Skip', replace: 'Replace' }[r.conflict] },
      { key: 'pair', label: 'Matching files', text: r.pair ? 'Renamed too' : 'Left alone' },
    ],
  };
}
