import type { Reason } from './types';

/** Plain-language title and advice for every reason a file needs attention. */
export const REASONS: Record<Reason, { title: string; hint: string }> = {
  'keyword-not-found': { title: 'Keyword not found', hint: 'Check the keyword, or type a name for this file.' },
  'no-value': { title: 'No value next to the keyword', hint: 'Try another position, or type a name for this file.' },
  'no-text': { title: 'Scanned PDF (no text layer)', hint: 'This PDF is an image. Type a name for it.' },
  'no-column': { title: 'Column missing in this file', hint: 'Choose the column for this file, or skip it.' },
  'no-pattern': { title: 'Pattern not found', hint: 'Check the pattern, or type a name for this file.' },
  'not-in-list': { title: 'Not in the list', hint: 'Add it to the list, type a name, or skip it.' },
  unreadable: { title: 'Unreadable or damaged file', hint: "This file can't be read. Skip it." },
  'no-match': { title: 'Companion file without a match', hint: 'Pick its PDF, or skip it.' },
  exists: { title: 'Target name exists', hint: 'A file with the new name appeared after the preview. Retry to pick a free name.' },
  locked: { title: 'File locked or in use', hint: 'The file is open in another program. Close it, then Retry.' },
  permission: { title: 'No permission', hint: 'Windows refused access to this file or its folder.' },
  missing: { title: 'File missing', hint: 'The file is no longer where it was.' },
  internal: { title: 'Internal error', hint: 'Something went wrong. Retry; the details are in History › Log.' },
};
