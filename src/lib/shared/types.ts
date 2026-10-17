export type Position = 'after' | 'before' | 'above' | 'below';
export type Conflict = 'add' | 'skip' | 'replace';
export type Destination = { mode: 'inplace' } | { mode: 'copy'; folder: string };

/** Why a file needs attention. Rust apply/read errors use missing | permission | locked | exists | internal. */
export type Reason =
  | 'keyword-not-found'
  | 'no-value'
  | 'no-text'
  | 'unreadable'
  | 'no-match'
  | 'no-column'
  | 'exists'
  | 'locked'
  | 'permission'
  | 'missing'
  | 'internal';

export type Op = { kind: 'rename' | 'copy'; from: string; to: string; replace?: boolean };
export type Status = 'ready' | 'paired' | 'duplicate' | 'unchanged' | 'attention' | 'skipped' | 'pending';

/** One preview row. `name` is the new file name; `op` is null when nothing will happen. */
export type PlanItem = { id: string; source: string; op: Op | null; status: Status; name?: string; reason?: Reason; detail?: string };

export type FileInfo = { path: string; size: number; mtime: number };

export type Step =
  | { type: 'pdfValue'; keyword: string; position: Position; occurrence: number }
  | { type: 'addText'; prefix: string; suffix: string };

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
