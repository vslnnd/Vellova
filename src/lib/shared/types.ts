export type Position = 'after' | 'before' | 'above' | 'below';
export type Conflict = 'add' | 'skip' | 'replace';
/** `folder` may hold {value}, {n} and {date}. */
export type Destination = { mode: 'inplace' } | { mode: 'copy' | 'move'; folder: string };

/** Why a file needs attention. Rust apply/read errors use missing | permission | locked | exists | internal. */
export type Reason =
  | 'keyword-not-found'
  | 'no-value'
  | 'no-text'
  | 'unreadable'
  | 'no-match'
  | 'no-column'
  | 'no-pattern'
  | 'not-in-list'
  | 'exists'
  | 'locked'
  | 'permission'
  | 'missing'
  | 'internal';

export type Op = { kind: 'rename' | 'copy'; from: string; to: string; replace?: boolean };
export type Status = 'ready' | 'paired' | 'duplicate' | 'unchanged' | 'attention' | 'skipped' | 'pending';

/** One preview row. `name` is the new file name; `op` is null when nothing will happen. */
export type PlanItem = { id: string; source: string; op: Op | null; status: Status; name?: string; reason?: Reason; detail?: string };

export type FileInfo = { path: string; size: number; mtime: number; ctime: number };

export type Step =
  | { type: 'pdfValue'; keyword: string; position: Position; occurrence: number }
  | { type: 'pdfPattern'; preset: 'invoice' | 'date' | 'custom' | 'title' | 'created'; regex: string; occurrence: number }
  | { type: 'list'; path: string; match: string; name: string; against: 'name' | 'value' } // match/name: header names in row 1
  | { type: 'addText'; prefix: string; suffix: string; insert?: { text: string; at: number } } // at: 0 = before the first character
  | { type: 'replace'; find: string; with: string; regex: boolean; matchCase: boolean; all: boolean }
  | { type: 'remove'; what: 'range' | 'digits' | 'between'; from: number; to: number; start: string; end: string } // from/to: 1-based, inclusive
  | { type: 'trim' }
  | { type: 'case'; to: 'upper' | 'lower' | 'title' | 'sentence' }
  | { type: 'number'; start: number; step: number; pad: number; at: 'start' | 'end'; sep: string }
  | { type: 'date'; from: 'today' | 'modified' | 'created'; format: string; at: 'start' | 'end'; sep: string };

export type RenameProfile = {
  id: string;
  name: string;
  desc: string;
  steps: Step[];
  pair: boolean;
  destination: Destination;
  conflict: Conflict;
};

export type SplitMode = 'value' | 'people' | 'rows' | 'parts' | 'sheets';
export type Param = { value: string; label: string; payable: boolean };
export type Person = { name: string; weight: number };
export type SplitFolder = { mode: 'source' } | { mode: 'folder'; path: string };
export type SplitRules = {
  mode: SplitMode;
  sheet: string | null; // null = first sheet
  header: { mode: 'default' } | { mode: 'manual'; row: number }; // row is 1-based
  column: string; // header name: value column, or group column for people
  params: Param[]; nonMatching: boolean;
  people: Person[]; assign: 'blocks' | 'groups'; peopleOutput: 'files' | 'column'; summary: boolean;
  rows: number; parts: number;
  template: string; // '' = the mode's default
  folder: SplitFolder; subfolder: boolean;
  format: 'same' | 'xlsx' | 'csv';
  conflict: Conflict;
};
export type SplitProfile = { id: string; name: string; desc: string; rules: SplitRules; archiveFolder: string | null };

/** A profile's settings as one line each, for the summary card: `key` names the setting a Change link goes to. */
export type Summary = { lines: { key: string; label: string; text: string }[] };

/** `pending`: recorded before the batch ran and no result came back yet (the app stopped mid-batch). */
export type BatchItem = { from: string; to: string; ok: boolean; reason?: Reason; pending?: boolean; archived?: true };

export type Batch = {
  id: string;
  tool: 'rename' | 'split';
  time: number;
  /** past tense used in the summary: "renamed", "copied" */
  verb: string;
  summary: string;
  profile?: string;
  items: BatchItem[];
  undoable: boolean;
  undone?: boolean;
  rerun?: { files: string[]; rules: SplitRules; profileId: string | null };
};

/** What a running tour has made, kept in settings so a crash mid-tour is cleaned up at the next start. */
/** `ended`: Finish or Skip was pressed, so a cleanup still pending at the next start offers no "Resume". */
export type TourMarker = { dir: string; batch: string | null; profile: string | null; ended?: boolean };

export type Settings = {
  theme: 'system' | 'dark' | 'light';
  updates: { onStartup: boolean; everyHours: number };
  rename: { folder: string; recursive: boolean };
  split: { archive: boolean; favourites: string[]; folder: string };
  welcomed: boolean;
  tour: TourMarker | null;
};
