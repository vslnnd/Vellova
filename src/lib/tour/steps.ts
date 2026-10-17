import { pathKey } from '../rename/engine/files';
import { splitPath } from '../shared/names';
import type { Batch, RenameProfile, TourMarker } from '../shared/types';

/** The sample set bundled in src-tauri/resources/tour (made by scripts/make-fixtures.mjs). */
export const SAMPLE_COUNT = 6;
/** sample PDFs that have an invoice number */
export const WITH_VALUE = 4;
export const NO_NUMBER = 'scan_0014.pdf';
export const PAIRED = 'export_0012.xlsx';
export const FIRST_SAMPLE = 'scan_0011.pdf';

/** What the tour reads from the app to decide whether a step is done. */
export type TourView = {
  /** sample files in the list */
  samples: number;
  /** sample PDFs with a value found */
  values: number;
  /** a read is running or pending */
  reading: boolean;
  /** the PDF without a number has a typed name */
  named: boolean;
  /** the batch applied during the tour */
  batch: string | null;
  /** a batch or undo is running */
  busy: boolean;
  /** the tour's batch was undone */
  undone: boolean;
  /** a profile saved during the tour */
  profile: string | null;
  /** an error was logged since this step began */
  error: boolean;
};

export type TourStep = {
  id: string;
  /** `data-tour` of the element pointed at; none = a card */
  target?: string;
  /** card heading */
  title?: string;
  /** hint text; `backticks` show as code */
  text: string;
  /** 'next': the user presses Next; 'card': the card's own buttons; else the step ends when this is true */
  done: 'next' | 'card' | ((v: TourView) => boolean);
  /** why the step can't be done right now, shown above its hint */
  lost?: (v: TourView) => string | null;
};

const filesGone = (v: TourView) => (!v.batch && v.samples === 0 ? 'The sample files left the list.' : null);
const valuesGone = (v: TourView) => !v.batch && !v.reading && v.values < WITH_VALUE;
/** the position picker is the step's target: picking After again brings the numbers back */
const positionGone = (v: TourView) => filesGone(v) ?? (valuesGone(v) ? 'Pick After again: these samples have the number after the label.' : null);
/** later steps can't reach the keyword or position fields */
const numbersGone = (v: TourView) => filesGone(v) ?? (valuesGone(v) ? 'The numbers are no longer found. Skip the tour, then start it again from Settings.' : null);

export const STEPS: TourStep[] = [
  { id: 'start', title: 'Try it out', text: "Let's rename five sample invoices. Nothing on your computer is touched. They live in a temporary folder.", done: 'card' },
  { id: 'drop', target: 'drop', text: 'Drag the sample files in here.', done: (v) => v.samples === SAMPLE_COUNT },
  { id: 'keyword', target: 'keyword', text: 'Type `Invoice No.:`, the label printed just before each number.', done: (v) => v.values >= WITH_VALUE && !v.reading, lost: filesGone },
  { id: 'position', target: 'position', text: 'The number comes after the label. Pick Below or Above when your invoices put it under or over it.', done: 'next', lost: positionGone },
  { id: 'preview', target: 'preview', text: 'Every new name, before anything changes.', done: 'next', lost: numbersGone },
  { id: 'name', target: 'name-row', text: 'This invoice has no number, so Vellova asks you. Type a name for it, then press Enter.', done: (v) => v.named, lost: numbersGone },
  { id: 'pair', target: 'pair-row', text: 'The spreadsheet with the same number gets the same new name automatically.', done: 'next', lost: numbersGone },
  { id: 'apply', target: 'apply', text: 'Rename them.', done: (v) => !!v.batch && !v.busy, lost: numbersGone },
  { id: 'undo', target: 'undo', text: "Changed your mind? Undo puts every name back. It's also in History any time later.", done: (v) => v.undone && !v.busy },
  { id: 'profile', target: 'profile', text: 'Save this setup. Next time, pick the profile and drop files.', done: (v) => !!v.profile },
  { id: 'tools', target: 'tools', text: 'Switch tools here. Split arrives in the next update.', done: 'next' },
  { id: 'history', target: 'history', text: 'History: every batch, undoable, plus the log.', done: 'next' },
  { id: 'profiles', target: 'profiles', text: 'Profiles: your saved setups.', done: 'next' },
  { id: 'settings', target: 'settings', text: 'Settings: theme, updates, and this tour again.', done: 'next' },
  { id: 'theme', target: 'theme', text: 'Light or dark.', done: 'next' },
  { id: 'done', title: "You're set", text: 'You can replay this tour from Settings.', done: 'card' },
];

/** The steps with a step number ("4 of 14"): those pointing at something. */
export const counted = STEPS.filter((s) => s.target);

/** `path` lies directly in the sample folder `dir` (any case or slash style). */
export const inSampleDir = (dir: string, path: string) => {
  const key = pathKey(dir).replace(/\\+$/, '');
  return /[\\/]vellova-tour-[^\\/]+$/.test(key) && !/(^|[\\/])\.\.([\\/]|$)/.test(key) && pathKey(splitPath(path).dir) === key;
};

/** The profile the tour may delete: the selected one, but only if it didn't exist when the tour began. */
export const tourProfile = (profileId: string | null, beforeIds: string[]) => (profileId && !beforeIds.includes(profileId) ? profileId : null);

/**
 * What the tour made: every History batch whose files all lie in the marker's sample folder (the marker's
 * batch id is not trusted on its own; this also catches a batch a crash mid-Apply left unrecorded in the
 * marker), and the marker's profile. `forget` lists those batches; `profiles` is the list without the profile.
 */
export function withoutTour(history: Batch[], profiles: RenameProfile[], m: TourMarker) {
  return {
    forget: history.filter((b) => b.items.length > 0 && b.items.every((i) => inSampleDir(m.dir, i.from))).map((b) => b.id),
    profiles: profiles.filter((p) => !m.profile || p.id !== m.profile),
  };
}
