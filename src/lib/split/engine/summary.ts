import type { SplitMode, SplitRules, Summary } from '../../shared/types';
import { DEFAULT_TEMPLATE } from './planner';

const MODE: Record<SplitMode, string> = { value: 'By value', people: 'People', rows: 'Rows', parts: 'Parts', sheets: 'Sheets' };
const FORMAT = { same: 'same type', xlsx: '.xlsx', csv: '.csv' };

/** The profile's settings as label and text lines. A setting the mode doesn't use has no line. */
export function splitSummary(r: SplitRules, archive: string | null): Summary {
  const assigned = r.mode === 'people' && r.peopleOutput === 'column';
  const folder = r.folder.mode === 'folder' ? r.folder.path : 'Same folder as the source';
  const lines: Summary['lines'] = [{ key: 'mode', label: 'Split by', text: MODE[r.mode] }];
  if (r.mode !== 'sheets') lines.push({ key: 'header', label: 'Header', text: `Row ${r.header.mode === 'manual' ? r.header.row : 1}` });
  lines.push(
    { key: 'save', label: 'Save to', text: `${folder} · ${FORMAT[r.format]} · if taken: ${{ add: 'add (1)', skip: 'skip', replace: 'replace' }[r.conflict]}` },
    { key: 'names', label: 'File names', text: r.template || DEFAULT_TEMPLATE[assigned ? 'assigned' : r.mode] },
  );
  if (r.mode === 'value' || (r.mode === 'people' && !assigned)) lines.push({ key: 'subfolders', label: 'Subfolders', text: r.subfolder ? 'One per group' : 'Off' });
  lines.push({ key: 'archive', label: 'Archive', text: archive ?? 'Off' });
  return { lines };
}
