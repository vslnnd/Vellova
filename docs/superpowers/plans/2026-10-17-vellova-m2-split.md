# Vellova Milestone 2 (Split) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Split placeholder with the full Split tool (five modes, output template, archive originals, undo, re-run, Splitify migration), so Splitify can be uninstalled, and ship it as Vellova 0.2.0.

**Architecture:** A pure TypeScript engine (`src/lib/split/engine/`) turns read sheets plus the rules into a Plan of output items, exactly like Rename. The sheet worker reads workbooks (ExcelJS for .xlsx, SheetJS for .xls/.csv) and writes output bytes. Rust gets no new op kind: outputs are written to a staging folder and placed with the existing journaled `copy` op (so Undo sends them to the Recycle Bin), and archiving uses the existing `rename` op (cross-volume move, temp names, undo moves back).

**Tech Stack:** Tauri 2, Svelte 5 + TypeScript, Vite, Vitest, ExcelJS 4.4.0 (new), SheetJS 0.20.3 (installed), Rust.

**Spec:** `docs/superpowers/specs/2026-10-15-vellova-design.md`, sections "Split", "Errors", "Testing" and "Delivery". Reference app: Splitify at the Splitify source folder (`main.js` lines 269-509 hold `read-file-columns`, `split-file`, `copyRow`, `writeRegionFile`; `archive.js` holds archive naming).

## Global Constraints

- Commits: author is the repo-local `77767757+vslnnd@users.noreply.github.com` (already set). No `Co-Authored-By` or `Claude-Session` lines. No em dashes anywhere (UI text, docs, comments, commit messages).
- Never push, tag, or touch GitHub. Work stays on branch `m2-split`.
- Test files are synthetic only (fake companies, names, numbers). Never read or copy real client files.
- Delete policy: never delete a user file. Replaced files go to the Recycle Bin. The only files Vellova removes for good are its own staging files.
- Header row (decided with the user, overrides the spec's auto-detect): **Default (1st row)** or **Manual** (click a row in a grid of the file's first 15 rows). Rows above a manual header are a title block copied on top of every data output.
- Multi-file runs match the chosen column **by header name** (trimmed, case-insensitive) in each file. A file without it goes to Needs attention: "Choose column for this file" or Skip.
- By-value parity with Splitify: cell text is rich text joined, else `String(value)`; matching is `trim().toLowerCase()`; group key is the trimmed label, else `String(value)`; group order is first appearance; `NON_MATCHING` holds unmatched rows, then excluded rows; group pieces in names replace `/ \ ? % * : | " < >` with `-`.
- `{date}` is the local run date as `yyyyMMdd`. Default templates: value `{date}_{file}_{group}`, people `{date}_{file}_{person}`, rows and parts `{date}_{file}_part{part}`, sheets `{date}_{file}_{sheet}`, Assigned to `{date}_{file}_assigned`. Summary file in file-per-person mode: `{date}_{file}_summary`.
- Format: same as input (default; .xls becomes .xlsx) | always .xlsx | always .csv. CSV output is UTF-8 with BOM, delimiter `,`, or the input's delimiter when the input is .csv.
- Collisions: Add (1) | Skip | Replace (Recycle Bin), as Rename. A file being split in this run is never replaced; its name gets numbered.
- Archive: `<base>_<yyyymmdd><ext>`, then `<base>_<yyyymmdd>_2<ext>`, `_3`... Runs after all outputs; a source qualifies when every one of its outputs was written and at least one was. A missing archive folder fails loudly (never created).
- Run `npm test`, `npm run check` and (when Rust changed) `cargo test` in `src-tauri` before every commit; all must pass.

## Review Focus

1. **Blank and formula cells in the data.** A blank row between data rows is dropped (not output, not counted). A formula cell matches by its cached result, a number cell `1001` matches parameter `"1001"`. Pinned in Task 2 (`cellText`) and Task 3 (blank rows leave `data`).
2. **Two outputs want the same name** (two source files with the same `{group}` and a template without `{file}`, or a template that yields a source file's own name in its folder). The second gets ` (1)`, and a source being split is never replaced, even with Replace. Pinned in Task 5.
3. **A source or archive target is open in Excel.** Reading gives `locked` with Retry; an archive rename that hits a lock leaves the original in place and offers Retry/Skip; outputs already written stay. Pinned in Task 9.
4. **Illegal or reserved characters in group or person names** (`A/B`, `CON`, trailing dots). Names are made safe and never escape the output folder through a subfolder. Pinned in Task 5.
5. **Header row that is wrong** (row 1 is a title, has empty or duplicate names, or looks like data). The preview warns and offers "Choose header row" instead of producing nonsense. Pinned in Task 3.

---

### Task 1: Spec update and the two tour follow-ups

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-vellova-design.md` (Split › Input header bullet; Architecture › Rust commands)
- Modify: `src/lib/tour/steps.ts:79` (`inSampleDir`)
- Modify: `src-tauri/src/tour.rs` (`is_tour_dir`, `remove_tour_dir`)
- Test: `test/tour.test.ts`, `src-tauri/src/tour.rs` tests

**Interfaces:**
- Produces: `inSampleDir(dir: string, path: string): boolean` (same signature, stricter).

- [ ] **Step 1: Update the spec.** Replace the "Pick the header row (default: auto-detected...)" bullet with the Global Constraints header-row rule. In "Rust commands", replace the `write` op and `archive_files` with: outputs are staged by `stage_write` and placed by journaled `copy` ops; archiving is a `rename` op whose name the planner picks; `folders_exist` checks the archive folder. Plain punctuation only.
- [ ] **Step 2: Write failing tests.** In `test/tour.test.ts`: `inSampleDir('C:\\Temp\\other', 'C:\\Temp\\other\\a.pdf')` is `false`; `inSampleDir('C:\\Temp\\vellova-tour-12', 'C:\\Temp\\vellova-tour-12\\a.pdf')` is `true`; `inSampleDir('C:\\Temp\\vellova-tour-', 'C:\\Temp\\vellova-tour-\\a.pdf')` is `false`. In `tour.rs`: `remove_tour_dir` with `temp` given in a different but equivalent spelling (the tempdir path with a trailing separator, and upper-cased on Windows) still removes `vellova-tour-7`.
- [ ] **Step 3: Run them and see them fail.** `npm test -- test/tour.test.ts` and `cd src-tauri && cargo test tour` → the new cases FAIL.
- [ ] **Step 4: Implement.** `inSampleDir` also requires the folder's own name to be `vellova-tour-` plus at least one character. `is_tour_dir` compares `fs::canonicalize` of `temp` and of `dir.parent()` when both exist, falling back to the current plain comparison when either can't be canonicalized; the name check is unchanged. A missing `dir` that passes the name check is still Ok in `remove_tour_dir`.
- [ ] **Step 5: Run the tests and see them pass.** Same commands, all PASS.
- [ ] **Step 6: Commit.** `git commit -m "fix: tour sample checks require the vellova-tour- folder and compare canonical temp paths"` (spec change in a separate commit: `docs: split header row is Default or Manual; outputs go through staging and copy ops`).

### Task 2: Split types, ExcelJS, and reading sheets into a grid

**Files:**
- Modify: `package.json` (add `"exceljs": "4.4.0"` to dependencies)
- Modify: `src/lib/shared/types.ts`
- Create: `src/lib/split/engine/grid.ts`
- Modify: `scripts/make-fixtures.mjs` (split fixtures into `test/fixtures/split/`)
- Test: `test/split-grid.test.ts`

**Interfaces:**
- Produces (in `types.ts`):
```ts
export type SplitMode = 'value' | 'people' | 'rows' | 'parts' | 'sheets';
export type Param = { value: string; label: string; payable: boolean };
export type Person = { name: string; weight: number };
export type SplitFolder = { mode: 'source' } | { mode: 'folder'; path: string };
export type SplitRules = {
  mode: SplitMode;
  sheet: string | null;                 // null = first sheet
  header: { mode: 'default' } | { mode: 'manual'; row: number }; // row is 1-based
  column: string;                       // header name: value column, or group column for people
  params: Param[]; nonMatching: boolean;
  people: Person[]; assign: 'blocks' | 'groups'; peopleOutput: 'files' | 'column'; summary: boolean;
  rows: number; parts: number;
  template: string;                     // '' = the mode's default
  folder: SplitFolder; subfolder: boolean;
  format: 'same' | 'xlsx' | 'csv';
  conflict: Conflict;
};
export type SplitProfile = { id: string; name: string; desc: string; rules: SplitRules; archiveFolder: string | null };
```
  `Reason` gains `'no-column'`. `BatchItem` gains `archived?: true`. `Batch` gains `rerun?: { files: string[]; rules: SplitRules; profileId: string | null }`. `Settings` gains `split: { archive: boolean; favourites: string[]; folder: string }`.
- Produces (in `grid.ts`):
```ts
export type Grid = { sheets: { name: string; rows: number }[]; sheet: string; rows: string[][]; merges: string[]; delimiter?: string };
export type Source = { kind: 'xlsx'; wb: ExcelJS.Workbook } | { kind: 'values'; sheets: { name: string; rows: unknown[][] }[]; delimiter?: string };
export function cellText(v: unknown): string;
export function decodeCsv(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1250' | 'windows-1252'; delimiter: ',' | ';' | '\t' };
export function loadSource(ext: string, bytes: Uint8Array): Promise<Source>;
export function gridOf(src: Source, sheet: string | null): Grid;
```
  `rows[r]` is the text of 1-based sheet row `r + 1` (ExcelJS) with blank rows kept as `[]`, so row indices map 1:1 to sheet rows. `merges` are A1 ranges like `A1:C1`.

- [ ] **Step 1: Add ExcelJS.** `npm install exceljs@4.4.0`. Confirm `npm run build` still succeeds before any code uses it.
- [ ] **Step 2: Add split fixtures to `make-fixtures.mjs`** (ExcelJS is now installed; fixed creation dates, deterministic data, fake names only):
  - `split/formatted.xlsx`: rows 1-2 a title block with merge `A1:E1`, header on row 3 (`Region, Cost centre, Person, Amount, Note`), 40 data rows with fills, bold header, number format `#,##0.00` on Amount, column widths, column E hidden, one formula column cell `=D4*2` with cached result, a blank row at row 20, and `Cost centre` values as numbers (1001, 1002, ...).
  - `split/simple.xlsx`: header on row 1, 12 data rows, two sheets (`Data`, `Notes`).
  - `split/bom-semicolon.csv`: UTF-8 BOM, `;` delimiter, a quoted field containing a comma.
  - `split/cp1250.csv`: Windows-1250 bytes with `Čakovec`, `Đurđevac`, `Šibenik`, comma delimiter (write the bytes directly).
  - `split/legacy.xls`: SheetJS `bookType: 'xls'`, 2 sheets.
  Run `npm run fixtures` and commit the files with the code.
- [ ] **Step 3: Write failing tests** in `test/split-grid.test.ts`:
  - `cellText`: `null`→`''`; `{ richText: [{text:'A'},{text:'B'}] }`→`'AB'`; `{ formula: 'D4*2', result: 20 }`→`'20'`; `{ text: 'site', hyperlink: 'x' }`→`'site'`; `1001`→`'1001'`; `new Date(Date.UTC(2026,0,5))`→`'2026-01-05'`; `true`→`'TRUE'`.
  - `decodeCsv` on `bom-semicolon.csv` → `utf-8`, `;`; on `cp1250.csv` → `windows-1250` and the text contains `Đurđevac`; on a 1252 buffer containing `à` (0xE0) and `è` (0xE8) → `windows-1252`; on `a\tb\n1\t2` → `\t`.
  - `gridOf(await loadSource('.xlsx', formatted))`: `rows[2]` is the header, `rows[19]` is `[]` (blank row), `merges` contains `A1:E1`, `sheets[0].rows` is 44 (2 title rows, header, 40 data rows, 1 blank row).
  - `.xls` and `.csv` sources: `sheets` lists both xls sheets; the csv quoted comma stays one field.
- [ ] **Step 4: Run and see them fail.** `npm test -- test/split-grid.test.ts`.
- [ ] **Step 5: Implement `grid.ts`.** ExcelJS: `await new ExcelJS.Workbook().xlsx.load(bytes)`. SheetJS: `.xls` via `XLSX.read(bytes, { type: 'array', cellDates: true })`, rows via `sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true })`; `.csv` via `decodeCsv` then `XLSX.read(text, { type: 'string', raw: true, FS: delimiter })`. Encoding rule, pinned by the tests:
  ```
  BOM EF BB BF → utf-8. Else TextDecoder('utf-8', { fatal: true }) succeeds → utf-8.
  Else windows-1250 when any byte is 0xE8 0xE6 0xF0 0xC8 0xC6 0xD0 (č ć đ Č Ć Đ) and none is 0xE0 0xE2 0xE7 0xC0; else windows-1252.
  // ponytail: byte heuristic for 1250 vs 1252; add a manual encoding picker if a real file is misread
  Delimiter: the most frequent of , ; \t outside quotes on the first non-empty line; ties go to ','.
  ```
  `cellText` formats a Date as `yyyy-MM-dd` (UTC parts, as ExcelJS stores dates in UTC).
- [ ] **Step 6: Run and see them pass**, then `npm run check`.
- [ ] **Step 7: Commit.** `feat: read xlsx, xls and csv into a split grid; split types and fixtures`

### Task 3: Header row and columns

**Files:**
- Create: `src/lib/split/engine/header.ts`
- Test: `test/split-header.test.ts`

**Interfaces:**
- Consumes: `Grid`, `SplitRules['header']`.
- Produces:
```ts
export type Column = { index: number; name: string; samples: string[] };   // name: trimmed text, or "Column C" when empty
export type HeaderInfo = { row: number; columns: Column[]; data: number[]; warnings: string[] }; // row and data are 0-based grid indices
export function headerInfo(grid: Grid, header: SplitRules['header']): HeaderInfo;
export function findColumn(columns: Column[], name: string): Column | undefined; // trimmed, case-insensitive; first wins
export const colLetter: (index: number) => string; // 0 → "A", 26 → "AA"
```

- [ ] **Step 1: Write failing tests:**
  - default header on `simple.xlsx` → `row 0`, data rows 1..12, no warnings; samples hold up to 5 distinct non-empty values per column (Splitify's sampling).
  - default header on `formatted.xlsx` (row 1 is a title) → a warning containing `Row 1` and `empty column names`.
  - manual `{ row: 3 }` on `formatted.xlsx` → `row 2`, 40 data rows (the blank row 20 excluded), no warnings.
  - a header row whose non-empty cells are mostly numbers (≥ half) → warning `Row 1 looks like data. Is the header on another row?`.
  - duplicate names `Amount, Amount` → warning naming `Amount`; `findColumn(cols, ' amount ')` returns the first.
  - an empty header cell in column C is named `Column C`; a manual row beyond the sheet → `columns: []`, `data: []`, warning `Row 99 is past the end of the sheet.`
  - `colLetter(0) === 'A'`, `colLetter(25) === 'Z'`, `colLetter(26) === 'AA'`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement `header.ts`.** Columns span the widest of the header row and the data rows. Data rows are every later row with at least one non-blank cell. Warnings use the exact texts above plus `Row N has K empty column names.` and `Row N repeats the column name "X".`
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit.** `feat: split header row (default or manual) with warnings`

### Task 4: The five modes

**Files:**
- Create: `src/lib/split/engine/modes.ts`
- Test: `test/split-modes.test.ts`

**Interfaces:**
- Produces (positions are indices into the `data` list, not grid rows):
```ts
export type ValueGroup = { key: string; rows: number[]; values: string[] };    // values: matched parameter values, sorted
export function byValue(cells: string[], params: Param[]): { groups: ValueGroup[]; unmatched: number[]; excluded: number[] };
export function evenBlocks(n: number, people: Person[]): number[];              // rows per person, sums to n
export type Assignment = { person: number[]; groups: number[]; warnings: string[] }; // person index per position; groups per person
export function keepGroups(keys: string[], people: Person[]): Assignment;
export function fixedRows(n: number, size: number): number[];                   // sizes
export function equalParts(n: number, parts: number): number[];                // sizes
```

- [ ] **Step 1: Write failing tests** (exact values):
  - `byValue([' 1001 ','1002','X','1003','1001'], [{value:'1001',label:'North',payable:true},{value:'1003',label:'',payable:true},{value:'1002',label:'South',payable:false}])` → groups `[{key:'North',rows:[0,4],values:['1001']},{key:'1003',rows:[3],values:['1003']}]`, unmatched `[2]`, excluded `[1]`. Matching is case-insensitive: param `abc` matches cell `ABC`.
  - `evenBlocks(10, [{name:'A',weight:1},{name:'B',weight:1},{name:'C',weight:1}])` → `[4,3,3]`; `evenBlocks(7, [A w2, B w1])` → `[5,2]`; `evenBlocks(0, ...)` → all zeros; all weights 0 → treated as 1 each.
  - `keepGroups(['a','a','a','b','b','c'], [A w1, B w1])` → `a` (3 rows) to A, `b` (2) to B, `c` (1) to B; `person` = `[0,0,0,1,1,1]`; `groups` = `[1,2]`.
  - Oversized group: `keepGroups(['big'×8,'s','t'], [A,B])` → `big` to A with warning `"big" has 8 rows, more than A's share of 5.`; never split.
  - Ties: equal deficits go to the earlier name; equal group sizes keep first-appearance order. A blank key is its own group.
  - `fixedRows(10, 4)` → `[4,4,2]`; `equalParts(10, 3)` → `[4,3,3]`; `equalParts(2, 5)` → `[1,1]` (no empty parts).
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** `evenBlocks`: targets `w_i / W * n`, floor, then hand the remainder out by largest fractional part, ties to the earlier name. `keepGroups`: groups ordered by size descending (ties: first appearance); each goes to the largest `target_i - assigned_i` with `target_i = w_i / W * n` (real numbers), ties to the earlier name; the warning uses the rounded target.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit.** `feat: split modes (by value, people, rows, parts)`

### Task 5: Output planner and archive names

**Files:**
- Create: `src/lib/split/engine/planner.ts`
- Create: `src/lib/split/engine/profile.ts`
- Test: `test/split-planner.test.ts`

**Interfaces:**
- Consumes: `Grid`, `HeaderInfo`, `findColumn`, modes, `sanitize`, `join`, `splitPath`, `splitExt` (`src/lib/shared/names.ts`), `pathKey` (`src/lib/rename/engine/files.ts`).
- Produces:
```ts
export type SummaryRow = { person: string; rows: number; groups: number; share: number };   // share in %, 1 decimal
export type OutSpec =
  | { kind: 'rows'; rows: number[]; assigned?: Record<number, string>; summary?: SummaryRow[] } // grid row indices
  | { kind: 'sheet'; sheet: string }
  | { kind: 'summary'; summary: SummaryRow[] };
export type SplitItem = PlanItem & { rows: number; label?: string; share?: number; spec?: OutSpec; format?: 'xlsx' | 'csv' };
export type FileRead = { ok: true; grid: Grid } | { ok: false; reason: Reason; detail: string };
export type SplitPlanInput = {
  files: string[]; reads: Record<string, FileRead | undefined>; rules: SplitRules;
  columnFor: Record<string, string>; skipped: Set<string>;
  existing: Set<string>; date: Date;
};
export const DEFAULT_TEMPLATE: Record<SplitMode | 'assigned', string>;
export function renderName(template: string, vars: Partial<Record<'date' | 'file' | 'group' | 'person' | 'part' | 'sheet', string>>): string;
export function planSplit(input: SplitPlanInput): SplitItem[];
export function planArchive(sources: string[], folder: string, existing: Set<string>, date: Date): { source: string; to: string }[];
export const DEFAULT_SPLIT_RULES: SplitRules;
export function splitProfile(v: unknown): SplitProfile | null;   // validates a stored or imported profile, filling defaults
```
  Item ids: an output is `` `${source}|${n}` `` (n = output order); a file-level item (waiting, unreadable, no-column, no data, skipped) has id = source and no `op`. An output's `op` is `{ kind: 'copy', from: '', to }` (`from` is filled with the staged path at run time) plus `replace` when Replace applies. `DEFAULT_SPLIT_RULES`: mode `value`, sheet null, header default, column `''`, params `[]`, nonMatching false, people `[]`, assign `blocks`, peopleOutput `files`, summary true, rows 1000, parts 2, template `''`, folder source, subfolder false, format `same`, conflict `add`.

- [ ] **Step 1: Write failing tests:**
  - `renderName('{date}_{file}_{group}', { date: '20261017', file: 'Q3', group: 'A/B' })` → `'20261017_Q3_A-B'`; `{person}` `'CON'` → whole name passes `sanitize`; unknown `{x}` stays literally.
  - By value on `simple.xlsx`-shaped grid: one item per group in first-appearance order, then `NON_MATCHING` when `nonMatching` (its rows: unmatched then excluded), names from the default template, `rows` counts, `label` = group key.
  - People, files mode: one item per person with rows (none for a person with 0 rows; a file-level detail says who got none), `share`; with `summary` an extra `kind: 'summary'` item named `{date}_{file}_summary`. Column mode: a single item named `{date}_{file}_assigned` with `assigned` covering every data row and the summary inside the spec (xlsx) or as a separate summary item (csv).
  - Rows/parts: `part` numbers from 1. Sheets: one item per sheet with rows > 0, `{sheet}` filled.
  - Missing column → file item `attention`, reason `no-column`, detail `This file has no column "Cost centre".`; `columnFor[file]` resolves it.
  - Empty data → file item `skipped`, detail `No data rows.`. Unread file → `pending`. Unreadable → `attention` with its reason.
  - Format: `.xls` + `same` → `.xlsx`; `.csv` + `same` → `.csv`; `csv` forces `.csv`.
  - Folder `source` writes next to the source; `subfolder` puts value/people outputs in `join(dir, sanitize(group))`; a group named `..` or `a\b` cannot leave the folder.
  - **Review Focus 2:** two files whose outputs share a name → second gets ` (1)`; template `{file}` with same folder and format → the source's name is taken, the output becomes `Q3 (1).xlsx` even with conflict `replace`; `existing` names: add → ` (1)`, skip → item `skipped`, replace → `op.replace === true`.
  - `planArchive(['C:\\in\\a.xlsx','D:\\x\\a.xlsx'], 'C:\\arch', new Set([pathKey('C:\\arch\\a_20261017.xlsx')]), date)` → `a_20261017_2.xlsx`, then `a_20261017_3.xlsx`.
  - `splitProfile` accepts a full profile, fills missing rule fields from `DEFAULT_SPLIT_RULES`, drops params that are not `{value: string|number}`, and returns null without `id` and `name`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** Compose header → column lookup → mode → items, then place names with the same first-free-name walk as `src/lib/rename/engine/planner.ts` (`place`): `used` per run, `existing` from the target folders, every source in `files` counts as taken and is never replaced.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit.** `feat: split planner with name template, folders, collisions and archive names`

### Task 6: Writing outputs (port of copyRow and writeRegionFile)

**Files:**
- Create: `src/lib/split/engine/write.ts`
- Test: `test/split-write.test.ts`

**Interfaces:**
- Consumes: `Source`, `OutSpec`, `cellText`.
- Produces:
```ts
export type WriteReq = { sheet: string | null; header: number; format: 'xlsx' | 'csv'; delimiter: string; outputs: OutSpec[] };
export function writeOutputs(src: Source, req: WriteReq): Promise<Uint8Array[]>;   // one per output, same order
```
  `header` is the 0-based header row; rows `0..header` are copied on top of every `rows` output (title block plus header).

- [ ] **Step 1: Write failing tests** (read each result back with ExcelJS or as text):
  - `formatted.xlsx`, rows output of 3 data rows: rows 1-3 are the title block and header, rows 4-6 the data in order; `A1:E1` merge kept; a merge inside the data block is kept only when both ends are in the output, at remapped rows; column widths and column E `hidden` kept; header font bold and fill kept; Amount `numFmt` `#,##0.00`; the formula cell has `formula` and `result`; sheet name equals the source sheet's.
  - `assigned`: an extra last column headed `Assigned to`, with the header row's last cell style, and each row's person.
  - `summary` in a rows output: a second sheet `Summary` with header `Person, Rows, Groups, Share %` and one row per person. `kind: 'summary'` alone → a workbook with just that sheet.
  - `kind: 'sheet'` → the whole sheet (every row, merges, widths) as a one-sheet workbook.
  - Values source (`.csv`) to xlsx: values only, header repeated. To csv: UTF-8 BOM, the given delimiter, quotes where a field holds the delimiter, a quote or a newline, `\r\n` line ends.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** by porting Splitify `main.js` 375-479 (`copyStyle`, `copyRow`, `writeRegionFile`) to TypeScript, generalised to a row map that covers the title block, and to `values` sources (build an ExcelJS sheet from values first, then the same path). Output bytes: `new Uint8Array(await wb.xlsx.writeBuffer())`. Each `try/catch {}` in the original stays as a guard around style and merge copies.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit.** `feat: write split outputs keeping styles, merges, widths and formulas`

### Task 7: Sheet worker and its client

**Files:**
- Modify: `src/workers/sheet.worker.ts`
- Create: `src/lib/split/sheets.ts`
- Test: `test/split-worker.test.ts`

**Interfaces:**
- Consumes: `loadSource`, `gridOf`, `writeOutputs`, `companionData` (unchanged).
- Produces (worker messages, all with `id`; every reply is `{ id, data }` or `{ id, error }`):
  - `{ id, op: 'companion', ext, bytes }` → `CompanionData` (the existing request; requests without `op` keep working).
  - `{ id, op: 'grid', key, ext, bytes, sheet }` → `Grid`.
  - `{ id, op: 'write', key, ext, bytes, req: WriteReq }` → `Uint8Array[]` (transferred).
  - The worker caches parsed `Source`s by `key` (`path|size|mtime`), at most 3, oldest dropped. `// ponytail: 3-entry cache; raise if big multi-file runs re-parse`
- Produces (client):
```ts
export function readGrid(key: string, ext: string, bytes: Uint8Array, sheet: string | null): Promise<Grid>;
export function writeFile(key: string, ext: string, bytes: Uint8Array, req: WriteReq): Promise<Uint8Array[]>;
```
  Same crash handling as `src/lib/rename/companions.ts`: a dead worker rejects pending calls with `{ internal: true }` and restarts on next use. Move the shared `start()` and request plumbing into `sheets.ts` and make `companions.ts` call it, so there is one worker.

- [ ] **Step 1: Write a failing test** for a pure `handle(msg)` exported from the worker module (the `onmessage` body): `grid` then `write` on `simple.xlsx` with the same key parses once (count via a spy on `loadSource`); a broken file replies `{ error }`.
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see it pass**, then `npm run build` and confirm the worker chunk contains ExcelJS (the build output lists `sheet.worker-*.js`) and the app still starts with `npm run tauri dev` (Rename companions still pair on the tour samples).
- [ ] **Step 5: Commit.** `feat: sheet worker reads grids and writes split outputs`

### Task 8: Rust staging and folder checks

**Files:**
- Modify: `src-tauri/src/files.rs`, `src-tauri/src/lib.rs`
- Modify: `src/lib/shared/ipc.ts`

**Interfaces:**
- Produces:
```rust
#[tauri::command] pub async fn stage_write(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String>; // writes data_dir/staging/<batch>/<n>.bin, returns its path
#[tauri::command] pub async fn stage_clear(app: AppHandle, batch: String) -> Result<(), String>;   // removes data_dir/staging/<batch>; missing is Ok
#[tauri::command] pub async fn folders_exist(paths: Vec<String>) -> Vec<bool>;                       // true only for an existing directory
```
```ts
stageWrite: (batch: string, n: number, bytes: Uint8Array) => invoke<string>('stage_write', bytes, { headers: { batch, n: String(n) } }), // raw body
stageClear: (batch: string) => invoke<void>('stage_clear', { batch }),
foldersExist: (paths: string[]) => invoke<boolean[]>('folders_exist', { paths }),
```
  `stage_write` takes the bytes as a raw IPC body (`tauri::ipc::Request`, headers `batch` and `name`) so large outputs are not JSON-encoded; `batch` is validated like `journal()` (ASCII alphanumerics and `-`) and `n` must parse as a number. The staged name doesn't matter (the `copy` op's `to` sets the final name), which also keeps non-ASCII names out of the IPC headers.

- [ ] **Step 1: Write failing Rust tests** for the pure helpers behind the commands (`stage_dir(base, batch)` rejects `..\x` and empty ids; `write_staged` writes bytes and returns a path inside the staging folder; `clear_staged` on a missing folder is Ok; `folders_exist` returns `[true, false, false]` for a directory, a file and a missing path).
- [ ] **Step 2: Run** `cd src-tauri && cargo test files` → FAIL.
- [ ] **Step 3: Implement**, register the commands in `lib.rs`, add the ipc wrappers.
- [ ] **Step 4: Run** `cargo test` and `npm run check` → PASS.
- [ ] **Step 5: Commit.** `feat: staging for split outputs and an archive folder check`

### Task 9: Split session (read, plan, run, retry, archive, undo text)

**Files:**
- Create: `src/lib/split/session.svelte.ts`
- Modify: `src/lib/shared/store.ts` (`batchSummary`, `mergeBatch`, settings and profiles defaults)
- Modify: `src/lib/shared/batches.ts` (undo text per tool)
- Modify: `src/lib/shared/state.svelte.ts` (normalize `profiles.split` with `splitProfile`)
- Test: `test/split-session.test.ts`, `test/store.test.ts`, `test/batches.test.ts`

**Interfaces:**
- Consumes: everything above, `recordBatch`, `putBackBatch`, `REASONS` (add `'no-column': { title: 'Column missing in this file', hint: 'Choose the column for this file, or skip it.' }`), island `send`.
- Produces:
```ts
export const session: { files: FileInfo[]; rules: SplitRules; profileId: string | null; reads: Record<string, FileRead>;
  columnFor: Record<string, string>; skipped: string[]; failures: Record<string, { reason: Reason; detail: string }>;
  fixed: string[]; existing: string[]; loading: boolean; dirty: boolean; busy: boolean; batch: string | null };
export const plan: { readonly items: SplitItem[] };
export function addPaths(paths: string[]): Promise<void>;   // keeps .xlsx .xls .csv only
export function pickFiles(): Promise<void>; export function pickFolder(): Promise<void>; export function pickOutputFolder(): Promise<void>;
export function refresh(): Promise<void>; export function invalidate(): void;
export function removeFile(path: string): void; export function clearFiles(): void;
export function skip(id: string): void; export function retry(id: string): Promise<void>; export function setColumn(path: string, name: string): void;
export function runBatch(only?: string[]): Promise<void>; export const applyFixes: () => Promise<void>;
export function cancelActivity(): void; export function whenIdle(capMs?: number): Promise<void>;
export function useProfile(p: SplitProfile): void; export function saveProfile(name?: string): void;
export function rerun(b: Batch): Promise<void>;   // loads b.rerun's files that still exist (missing ones logged) and rules
export const archiveFolder: () => string | null;  // the profile's folder when Settings › archive is on
```
- Store changes: split batches use verb `created`; `batchSummary` adds `· N archived` for items with `archived`; `mergeBatch` for `tool: 'split'` replaces earlier items with the same `to`, and drops earlier failed items whose `from` appears in the new items (rename keeps keying by `from`). Undo text: rename `N names restored`, split `N changes undone`.

`runBatch` order, which the tests pin with a fake `ipc` and a fake worker:
```
1. outputs = plan items with an op (or only the fixed ones); busy; island start "Splitting", total = outputs.
2. pending batch recorded (as Rename does), flush().
3. per source: read bytes (failure → every output of that source fails with its reason), writeFile(...), then
   stageWrite(batch, i, bytes) per output (i = its index in this run), filling op.from. Progress per output.
4. applyPlan(batch, copy ops); stageClear(batch) in finally.
5. archive (Settings split.archive on and a profile folder): foldersExist([folder]) false → each qualifying source
   fails with reason 'missing', detail 'The archive folder no longer exists.'; else listDir(folder) and
   planArchive, then applyPlan(batch, rename ops), island label "Archiving". Items get archived: true.
6. readResults per run; failures keyed by item id; recordBatch with rerun = { files, rules, profileId }.
7. island finish with the summary and the attention count.
```

- [ ] **Step 1: Write failing tests:**
  - store: `batchSummary` of a split batch with 3 created, 1 archived, 1 failed → `4 files created · 1 archived · 1 failed` (archived items count as files, as items do today); `mergeBatch` rules above; `withDefaults({})` has `split: { archive: false, favourites: [], folder: '' }`; profiles without `split` load as `split: []`.
  - batches: split undo text `3 changes undone`.
  - session (fake ipc/worker): outputs staged then copied with `from` set to the staged path; `stageClear` runs even when `applyPlan` throws; a source whose output failed is not archived; **Review Focus 3:** an archive rename answered with code `locked` leaves the source listed with reason `locked`, its outputs stay recorded as ok, and `retry('archive:<source>')` runs only the archive op inside the same batch id.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement**, mirroring `src/lib/rename/session.svelte.ts` (generation counter for stale reads, cached reads by `path|size|mtime`, the 300 ms island "Reading" rule, `invalidate` on input changes). A failed archive shows as an extra attention item `{ id: 'archive:<source>', source, status: 'attention', reason }` appended to `plan.items` (it isn't produced by `planSplit`); retrying it runs only the archive step for that source.
- [ ] **Step 4: Run and see them pass**, plus the full `npm test`.
- [ ] **Step 5: Commit.** `feat: split session with staging, archive, retry and re-run`

### Task 10: Split screen

**Files:**
- Modify: `src/lib/split/Split.svelte`
- Create: `src/lib/split/SplitSettings.svelte`, `src/lib/split/SplitPreview.svelte`, `src/lib/split/HeaderPicker.svelte`
- Modify: `src/App.svelte` (island Cancel calls the session of `ui.tool`), `src/lib/rename/DropZone.svelte` (accept `accept` text and a pick handler as props so Split reuses it)

**Interfaces:**
- Consumes: Task 9 exports; `.card`, `.btn`, `.field`, `.seg`, `.pill`, `.hint` classes from `app.css`; `Rename.svelte` layout (left settings column, right preview, footer with count, attention pill, Undo last batch, primary button).

Layout and copy (fixed):
- Header `Split`, hint `Rules on the left, every output file previewed on the right.`
- Left column, top to bottom: Profile select plus `Save` and `Save as new profile`; Mode as a segmented control `By value | People | Rows | Parts | Sheets`; Sheet select (when the first file has more than one); Header row `Default (1st row) | Manual`, Manual opens `HeaderPicker` (the first 15 rows of the selected file as a grid, a file select above it when several files are listed, click a row to choose it, the chosen row highlighted); mode fields (By value: column select with samples, a parameters table `Value | Label | Payable` with add and remove rows and a paste box that takes tab-separated lines, `Keep non-matching rows`; People: names with weights, `Even blocks | Keep groups together`, group column, `One file per person | Assigned to column`, `Summary`; Rows: `Rows per file`; Parts: `Number of parts`); Output: name template field with the piece chips shown as hints and the mode default as placeholder, Folder select `Same as the source | <favourites> | Choose folder…` with a star button to add or remove the current folder from favourites, `Subfolder per group` (value and people files only), Format `Same as input | Always .xlsx | Always .csv`, Existing files `Add (1) | Skip | Replace (Recycle Bin)`.
- Right: drop zone (`Drop .xlsx, .xls or .csv files`) until files are listed; then a card per source file with its output cards (name, row count, groups or people, share), header warnings as a banner with a `Choose header row` button (switches to Manual and opens the picker), and an output card click opening its first 20 rows in a small table.
- Footer: `N files will be created`, attention pill (opens Needs attention), `Undo last batch`, primary `Split N files`. Island labels `Reading`, `Splitting`, `Archiving`.
- Re-read 150 ms after files, sheet, header, mode or column change (as Rename does); other rule changes only re-plan.

- [ ] **Step 1: Build the components.**
- [ ] **Step 2: Verify in the running app** (`npm run tauri dev`) with the synthetic fixtures copied to a scratch folder outside the repo: each mode previews; `formatted.xlsx` shows the header warning and Manual row 3 fixes it; a split, then Undo, leaves the folder as before; reduced motion and keyboard-only use (Tab through every control, Enter/Space activate) work. Take screenshots for the review.
- [ ] **Step 3: Run** `npm test` and `npm run check`.
- [ ] **Step 4: Commit.** `feat: split screen with modes, header picker, output options and preview`

### Task 11: Panels (Needs attention, Profiles, Settings, History)

**Files:**
- Modify: `src/lib/panels/NeedsAttention.svelte`, `Profiles.svelte`, `Settings.svelte`, `History.svelte`
- Modify: `src/lib/migrate/nomina.ts` (`importProfiles` returns `{ rename, split }`)
- Test: `test/migrate.test.ts`

**Interfaces:**
- Consumes: both sessions; `splitProfile`.
- Behaviour:
  - Needs attention follows `ui.tool`. Split reasons: `no-column` → a column select (the file's own columns) and Skip; `unreadable` → Skip; `locked`, `exists`, `internal` → Retry, Retry all, Skip; `permission`, `missing` → Show in folder, Skip. `Apply fixes` calls the split session's `applyFixes`.
  - Profiles: a `Rename | Split` segmented control. Split cards: Use, Rename, Duplicate, Delete, and `Archive folder: <path>` with `Choose…`/`Clear`; a folder another split profile already uses shows `Also used by "<name>".` Export writes both lists; Import accepts a Vellova export (both lists) or Splitify's `splitify_profiles.json` (see Task 12 mapping).
  - Settings: a `Split` card with `Archive originals after splitting` (hint: `Each profile sets its archive folder in Profiles.`).
  - History: split batches show `Run again` when `rerun` is set (calls `rerun(b)`, switches to Split, closes the panel); `Undo` as today.
- [ ] **Step 1: Write failing tests:** `importProfiles` on a Vellova export with both lists returns both; on a Splitify array returns split profiles (mode value) and no rename ones; on Nomina's array returns rename ones as before.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement**, then verify each panel in the running app.
- [ ] **Step 4: Run** `npm test`, `npm run check`.
- [ ] **Step 5: Commit.** `feat: split in Needs attention, Profiles, Settings and History`

### Task 12: Splitify migration

**Files:**
- Create: `src/lib/migrate/splitify.ts`
- Modify: `src/lib/migrate/run.ts`, `src/lib/tour/Welcome.svelte` (copy names both old apps neutrally: `Profiles, history and settings from your previous apps are on this computer. The old apps keep their own copies.`)
- Test: `test/migrate.test.ts`

**Interfaces:**
- Produces:
```ts
export const SPLITIFY_FILES = ['Splitify\\splitify_profiles.json', 'Splitify\\splitify_history.json', 'Splitify\\splitify_favfolders.json', 'Splitify\\splitify_settings.json'];
export function planSplitifyImport(texts: (string | null)[]): { profiles: SplitProfile[]; history: Batch[]; favourites: string[]; settings: Partial<Settings> };
```
  Mapping: profile `{id,name,description,parameters|params,archiveFolder}` → `{ id: 'splitify-<id>', name, desc: description, archiveFolder, rules: { ...DEFAULT_SPLIT_RULES, mode: 'value', params } }` with `value` as `String(value)`, `label` as string, `payable` as boolean (missing = true). History `{id,timestamp,profileName,files:[{name,path}],outputDir,totalCreated}` → read-only batch `splitify-<id>`, tool split, verb `created`, items one per file `{ from: path, to: outputDir, ok: true }`, summary `` `${totalCreated} files created` ``, profile unless `— no profile —`. Favourites: string array, kept in order, duplicates dropped. Settings: `theme` light/dark, `checkUpdatesOnStartup`, `updateIntervalHours` mapped to the nearest of 1, 6, 24, `archiveOriginals` → `split.archive`. Splitify settings win over Nomina's where both set a value (spec "Migration").
- [ ] **Step 1: Write failing tests** with synthetic JSON for each file, including legacy `params`, a missing file (null), and malformed JSON (ignored).
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement**; `findOldData` and `importOldData` cover both apps; the summary line counts both (`Imported 3 profiles and 12 history entries.`).
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit.** `feat: import Splitify profiles, history, favourite folders and settings`

### Task 13: Performance check, version 0.2.0, README, installer

**Files:**
- Create: `test/split-perf.test.ts` (runs only with `PERF=1`)
- Modify: `package.json`, `src-tauri/Cargo.toml` (version `0.2.0`), `README.md` (Split section: modes, header row, archive, undo; plain punctuation)

- [ ] **Step 1: Write the perf test:** build a 50,000-row × 20-column styled .xlsx in memory with ExcelJS, then `loadSource` + `gridOf` + `headerInfo` + `planSplit` (by value, 20 groups) + `writeOutputs` must finish under 10 s. Run `PERF=1 npm test -- test/split-perf.test.ts` and record the time in the commit message. If it fails, profile and fix before continuing.
- [ ] **Step 2: Bump versions and write the README section.**
- [ ] **Step 3: Full verification:** `npm test`, `npm run check`, `cd src-tauri && cargo test`, then `npm run tauri build` and note the installer path.
- [ ] **Step 4: Commit.** `chore: version 0.2.0 with Split`
- [ ] **Step 5: Stop.** Report to the user; tagging, pushing and the release checklist need their explicit OK.
