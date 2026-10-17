# Vellova: one app for renaming and splitting files

**Date:** 2026-10-15
**Status:** Design approved in conversation, awaiting written-spec review
**Replaces:** Nomina (reference version 1.4.6) and Splitify (reference version 2.0.1 plus the unreleased archive-originals work)
**Design mockups:** https://claude.ai/artifact/PTecbCL4i5owd76j6MyQfW (look, navigation options, interactive island prototype)

## Goal

Merge Nomina and Splitify into one fast, small Windows app called **Vellova**. It contains two tools, **Rename** and **Split**. The old app names do not appear anywhere in the UI.

### Why

Findings from examining the current apps:

- **Size:** installers are 85–123 MB. Electron ships its own Chromium. Nomina also bundles a 38 MB unused native canvas module and all of `pdfjs-dist`. A local Splitify build packaged `.claude/worktrees` (three copies of the source plus `settings.local.json`) because there is no `files` whitelist.
- **Slow start:** both load Google Fonts through `@import`, and Nomina loads its icons from unpkg. Every launch waits on the network, and offline the icons vanish.
- **Bugs:**
  - Splitify advertises .csv and .xls but reads everything as .xlsx (`Can't find end of central directory`).
  - Nomina pairs companion files in O(PDFs × files), re-parsing each spreadsheet on every comparison.
  - Nomina's force-rename deletes the existing target, and there is no undo.
  - Splitify's 882 px minimum window height doesn't fit on common laptops.
  - Splitify silently overwrites same-day outputs.
- **Nomina 1.6.x regression:** users saw "keyword not found", wrong values, and failed renames. The engine changes between 1.4.6 and 1.6.1 were:
  - pdf.js 3.11 → 5.5;
  - Electron 28 → 41;
  - new before/after/above/below fallbacks.

  The real invoices come from **Microsoft Reporting Services 2019** (SSRS), which writes text in small positioned pieces. The most likely cause is pdf.js 5 grouping those pieces differently from 3.11. The golden test confirms or rules this out.

### Who it's for

A public download on GitHub Releases. Anyone who renames or splits batches of office files: invoices, exports, service lists. The author uses it daily on SSRS-generated debit notes and on spreadsheets shared out among colleagues.

### Success criteria

- Installer under 15 MB; cold start under 1 s on a typical office laptop; fully usable offline.
- On the test invoices, the Rename engine produces exactly the values Nomina 1.4.6 produces.
- Every existing Nomina 1.4.6 and Splitify 2.0.1 workflow can be done in Vellova, and old profiles and history import.
- No operation deletes a user file. Every batch can be undone from History while its files are unchanged.
- Fits a 1366×768 screen at 125% scaling. Usable with keyboard only. Text contrast at least 4.5:1.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Runtime | Tauri 2 (WebView2) | Uses the WebView already on Windows 10/11: a small installer, low memory, always-current Chromium |
| UI framework | Svelte 5 + TypeScript + Vite | Compiles to plain JS; built-in transitions and springs cover the island; small component files instead of a 4,000-line `index.html` |
| Heavy work | Web Workers in the WebView (pdf.js, ExcelJS, SheetJS) | Keeps the island smooth; reuses proven JS libraries; pdf.js keeps parity with 1.4.6 |
| Rust's role | Official plugins plus 4 small commands for file operations | Undo journaling, Recycle Bin and safe swaps need native file access |
| Animation | CSS transitions, Web Animations API, View Transitions, Svelte transitions | WebView2 is evergreen Chromium, so no animation library is needed (Anime.js would be the pick if one ever is) |
| Code signing | None | Author's explicit choice. SmartScreen's warning is accepted, and the download page explains "More info → Run anyway" |
| Update signing | Tauri updater with a self-generated key pair | Free; required by the updater; invisible to users |
| Install | NSIS, per-user (`currentUser`) | No admin rights needed |
| Look | Ledger palette (cobalt; graphite dark, cool-white light) with Geist and Geist Mono, bundled locally | Chosen from three directions on the canvas |
| Navigation | An island capsule centred in the custom title bar | Chosen over a bottom dock and a drawer; doubles as the status surface |
| Delete policy | Never delete. A replaced file goes to the Recycle Bin | Legal and IP documents |
| Real files for testing | Never. Synthetic fixtures, plus an optional local comparison that prints only counts | Client data is confidential, and the repo is public |

## Architecture

### Repository

- `vslnnd/Vellova`, public, stored locally at `%USERPROFILE%\Vellova`.
- The Nomina and Splitify repos stay as they are. Once Vellova ships, their READMEs point to it.

```
src/
  app.css                      design tokens (CSS variables, both themes), fonts
  lib/shell/                   TitleBar, Island (+ states), Panel, Theme, keyboard shortcuts
  lib/panels/                  History (Batches | Log), Profiles, Settings, NeedsAttention, Welcome
  lib/rename/                  Rename screen components
  lib/rename/engine/           pure TS: steps, pdf value finder, pairing, planner
  lib/split/                   Split screen components
  lib/split/engine/            pure TS: modes, distribution, output naming, planner
  lib/shared/                  store (settings/profiles/history), log, plan types, file naming, conflicts
  workers/pdf.worker.ts        pdf.js → words with positions, metadata, page render for click-to-pick
  workers/sheet.worker.ts      ExcelJS (.xlsx read/write with styles), SheetJS (.xls/.csv read, .csv write)
src-tauri/
  src/commands.rs              apply_plan, undo_batch, to_recycle_bin, archive_files
  tauri.conf.json, capabilities/
test/
  fixtures/                    generated synthetic files (committed)
  fixtures-private/            git-ignored; never committed
scripts/
  make-fixtures.mjs            regenerates synthetic fixtures
  golden-146.mjs               runs the original 1.4.6 engine (pdfjs-dist 3.11.174) to record expected values
  compare.mjs                  private local comparison on real files (counts and structure stats only)
```

### The plan principle

Both engines are pure functions that produce a **Plan**: a list of operations. Inputs are the files plus the settings; output is the Plan.

```ts
type Op =
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'copy'; from: string; to: string }
  | { kind: 'move'; from: string; to: string }
  | { kind: 'write'; to: string; payloadId: string }   // split output produced by sheet.worker
  | { kind: 'archive'; from: string; folder: string };
type PlanItem = { id: string; source: string; op: Op | null; status: 'ready' | 'paired' | 'duplicate' | 'unchanged' | 'attention'; reason?: AttentionReason };
```

- The preview renders the Plan. Nothing touches disk until the user presses the main button.
- Rust then executes exactly the Plan's operations in order.
- Engines are unit-tested without the UI.

### Rust commands

- **`apply_plan(batchId, ops)`** executes the operations in order and appends a journal entry after each one. Each entry holds the operation, the result, and the final file's size and modified time. Swap and cycle renames (a→b, b→a) go through temporary names. A case-only rename (`a.pdf` → `A.pdf`) goes through a temporary name. Each operation returns its own result, so one failure doesn't stop the rest. Missing folders are created for `move`, `copy` and `write`.
- **`undo_batch(batchId)`** walks the journal backwards:
  - renames and moves are reversed;
  - copied and written files go to the Recycle Bin;
  - archived originals are moved back.

  Any file whose size or modified time differs from the journal is left alone and reported.
- **`to_recycle_bin(paths)`** uses the `trash` crate.
- **`archive_files(files, folder)`** ports Splitify's approved archive design: move plus rename `<name>_<yyyymmdd>`, a `_2`/`_3` counter, a lock probe, and a cross-volume fallback.

Plugins: `fs`, `dialog`, `updater`, `process`, `opener`, `single-instance`, `window-state`.

### Data

Stored in `%APPDATA%\com.vslnnd.vellova\`:

- `settings.json`: theme (`system` | `dark` | `light`), update checks (on startup; interval), default folders, archive toggle, the per-tool last-used folders, Split favourite folders.
- `profiles.json`: `{ rename: RenameProfile[], split: SplitProfile[] }`.
- `history.json`: the last 200 batches, each with tool, time, summary, the Plan, and the journal.
- `log.jsonl`: the last 1,000 entries or 30 days, whichever is smaller.

All writes are atomic: write a temp file, then rename it over the original.

### Migration (first launch)

The Welcome panel offers to import (skippable; also available later under Settings):

| Source | Becomes |
|---|---|
| `%APPDATA%\Nomina\nomina-profiles.json` (`{id,name,keyword,position,prefix,suffix}`) | A Rename profile: one Value-from-PDF step, plus Add text (prefix/suffix), plus Pair matching files on |
| `%APPDATA%\Nomina\nomina-history.json` and `nomina_history.json` | History entries, read-only (no journal, so no undo) |
| `%APPDATA%\Nomina\nomina-settings.json` (theme, `checkOnStartup`, `checkInterval`) | Settings, used only where Splitify's settings don't already set them |
| `%APPDATA%\Splitify\splitify_profiles.json` (`parameters` or legacy `params`: `[{value,label,payable}]`, `description`, `archiveFolder`) | A Split profile in "By value" mode |
| `splitify_history.json`, `splitify_favfolders.json`, `splitify_settings.json` (theme, update interval, archive toggle) | History (read-only), favourite folders, settings |

### Updates and distribution

- `tauri-plugin-updater` reads `latest.json` from GitHub Releases. Startup check plus a periodic interval, both configurable.
- An update downloads in the background, then the island shows "Update ready".
- A GitHub Actions workflow builds on a version tag and publishes the release.
- The README download section includes the SmartScreen note.

## Shell and look

### Window

- Custom title bar (`decorations: false`, `data-tauri-drag-region` on empty areas), 60 px tall.
- Grid: the Vellova mark on the left, the island in the centre, Windows-style minimise/maximise/close on the right.
- Known trade-off: the hover Snap Layouts flyout is lost. Win+Z and edge snapping still work.
- Minimum window size 900×600. Size and position are remembered.

### Island

The island is a capsule (height 44, radius 999) centred in the title bar. When idle it holds:

- Rename and Split, with a sliding accent pill behind the active one;
- a divider;
- History, Profiles and Settings icons;
- the theme switch;
- any collapsed notice chips.

States and timing:

| State | Content | Behaviour |
|---|---|---|
| Idle | as above | - |
| Reading | "Reading N PDFs…" with an indeterminate sweep, plus Cancel | Shown while totals are unknown |
| Working | "Renaming k of N" / "Splitting k of N" with a determinate bar, a moving sheen, and Cancel | - |
| Done | A check that draws itself, plus a single green ring pulse; "N files renamed" plus Undo | After **4 s** the island springs back to idle and an **undo chip slides in** from the left |
| Attention | Warning icon; "N files need attention" plus Review | Shakes **once** (2–3 px, ~460 ms), then a warm glow pulses **3 times** and stops. After 6 s it collapses to an amber chip |
| Update ready | The download arrow drops in, then **nudges continuously**; "Update ready" plus Restart | After **3.5 s** it collapses to a download chip that nudges 3 times, then rests |
| Restarting / Restored | Spinner "Restarting…" / "N names restored" | Transient |

- **Chips** (undo, attention, update) are 36 px circles. Hover or keyboard focus expands a chip to show its label and action, and it collapses on leave. Chips are ordered attention, undo, update.
- **Priority** when several states compete: working > attention > done > update.
- **Motion:**
  - the island's width morph and content crossfade (opacity, scale 0.92→1, blur 6→0) take about 440 ms on `cubic-bezier(0.34, 1.32, 0.64, 1)`;
  - the tool pill slide takes about 300 ms;
  - hover and press take 150–200 ms;
  - the theme switch rotates sun↔moon, and the new theme is revealed as a circle from the button via the View Transitions API.
- `prefers-reduced-motion` (Windows "Animation effects" off) turns every animation into a ≤1 ms change or a fade.
- **Keyboard:** Ctrl+1 / Ctrl+2 switch tools; Ctrl+Z undoes the last batch when focus is not in a text field; Esc closes panels; every island control is reachable by Tab.
- The prototype on the design canvas is the reference for feel.

### Tokens

| Token | Dark | Light |
|---|---|---|
| bg | #0F1115 | #F5F6F8 |
| chrome | #0B0D10 | #ECEEF2 |
| surface | #161920 | #FFFFFF |
| surface2 / cap | #1E222A | #F0F2F5 / #FFFFFF |
| border / border2 | #2A2F39 / #3A404C | #D8DCE3 / #B9C0CB |
| text / text2 / text3 | #E9ECF1 / #AEB5C1 / #8B93A1 | #12151B / #474E5A / #5E6673 |
| accent / on-accent | #7AA7FF / #0A1430 | #1D5BD8 / #FFFFFF |
| ok / warn / err | #5BC995 / #F0B84D / #FF8A8A | #13784A / #8F5B00 / #BF2A2A |

- Radius 6 for controls and 8 for panels; 999 for the island and pills.
- Geist for UI text, Geist Mono for file names and values.
- The theme defaults to `system`.

### Screens and panels

- **Rename and Split** share one layout:
  - left: settings (steps or mode);
  - right: the live preview;
  - bottom bar: a count ("6 files will be renamed · 1 needs attention"), Undo last batch, and the main button.
- **Empty state:** a large drop zone, "Drop files or folders here", with Add files / Add folder and an "Include subfolders" toggle.
- **Panels** slide in from the right over the current tool. Esc closes them, and the tool keeps its state underneath.
  - **History**, with two tabs:
    - *Batches:* both tools, filterable. Each batch offers Undo, Re-run (Split, while sources exist), Export report (.xlsx/.csv: date, old path, new path, result) and Show files.
    - *Log:* every error and warning from the engines, workers and app, with time, tool, file, a plain-language message and expandable technical details. Filter by tool and severity; Export .txt. Never sent anywhere.
  - **Profiles:** Rename and Split profiles; create, edit, duplicate, delete; JSON import/export, which also accepts old Nomina and Splitify profile files.
  - **Settings:** theme, updates, default folders, archive originals toggle, import old data, feedback (opens a GitHub issue), about.
  - **Needs attention:** see Errors.
  - **Welcome:** first launch only; offers the migration.

## Rename

### Steps

A Rename setup is an ordered list of **steps**. Each step runs on a file's **base name** (the extension is kept unless a step targets it). Steps that fail for a file mark it *attention* with a reason; other files continue. The preview recalculates live, debounced by 150 ms.

**Source steps** replace the name with a value:

- **Value from PDF:** keyword, position (before | after | above | below), and occurrence (1st by default). PDFs only. The value becomes the name and is also exposed as `{value}`.
- **Pattern from PDF:** a preset (invoice-style number, date) or a custom regular expression, plus occurrence. Or a metadata field (Title, CreationDate).
- **From a list:** load .xlsx or .csv, then pick the *match* column and the *new name* column. Match against either the current file name (without extension) or `{value}` from an earlier step. Matching is exact and ignores case and leading/trailing spaces.

**Modifier steps:**

- Find & replace (plain or regex; case toggle; all or first).
- Add text (start | end | at position N).
- Remove (characters at a position range | digits | text between two markers).
- Trim spaces and collapse doubles.
- Case (UPPER, lower, Title, Sentence).
- Numbering (`{n}` with start, step and zero-padding; ordered by the list as shown).
- Date (today | file modified | file created; format such as `yyyy-MM-dd`).

**Click value on PDF** is not a step. It's an editor for Value-from-PDF:

1. Open a file's page (rendered by pdf.js in the worker).
2. Words are shown as hoverable boxes; click the value.
3. Vellova proposes the nearest label word or words, and the position, using the same geometry the engine uses. You can adjust it.
4. The step is filled in and immediately re-run over all files.

**Destination:** rename in place | copy to folder | move to folder. The folder path may contain `{value}`, `{date}` and `{n}` ("Sort into folders"); missing folders are created.

**Name safety:**
- Characters `\ / : * ? " < > |` and control characters become `_`.
- Trailing dots and spaces are removed.
- Reserved names (`CON`, `NUL`, …) get a `_` suffix.
- Paths longer than 260 characters use the long-path prefix.

### The 1.4.6 engine (ported rule for rule)

The worker turns each page into items `{str (trimmed, non-empty), x = transform[4], y = pageHeight − transform[5], w = width, page}`. The engine then:

1. **Find the keyword** (case-insensitive) in three passes, stopping at the first hit:
   1. an item equal to the keyword;
   2. an item containing the keyword;
   3. consecutive items whose texts, joined by single spaces, equal the keyword (the hit is the last item).
2. `LINE_TOL = 8`.
3. **after:** items with |y − kw.y| ≤ 8 and x > kw.x + 2, nearest x first.
4. **before:** items with |y − kw.y| ≤ 8 and x < kw.x − 2, nearest x first.
5. **below / above:** items on the same page with (y − kw.y) × dir > 8, sorted by vertical distance. When two vertical distances are within 3, the smaller |x − kw.x| wins.
6. The value is the winning item's `str`.

1.4.6 had no fallbacks, so there are none here. The 1.6 fallbacks are not carried over.

**The words layer.** Exact 1.4.6 output depends on how pdf.js 3.11 grouped text, so the worker builds items from the current pdf.js and then **normalizes** them. Adjacent pieces on the same baseline (|Δy| ≤ 1) are joined into one item when the horizontal gap is smaller than about 0.25 × font size. This reproduces pdf.js 3.11's grouping for SSRS-style PDFs. The golden tests below are the judge.

**Fallback if parity can't be reached:** pin `pdfjs-dist@3.11.174` in the PDF worker with `isEvalSupported: false` (which mitigates CVE-2024-4367), text extraction only. Rendering for Click-value-on-PDF still uses the current pdf.js.

### Companion files

With **Pair matching files** on, every .xlsx, .csv, .xml and .txt file in the batch is read **once** by the sheet worker into a set of cell and text values:

- .xlsx: every cell, trimmed. The 1.4.6 rule that prefers the column whose header equals the keyword is kept.
- .csv: every field.
- .txt and .xml: the raw text, checked with `includes`.

Each companion file is matched against the set of extracted PDF values in one pass. A match takes the PDF's new name (plus its own extension). An unmatched file becomes *attention: no matching PDF*.

### Duplicates and conflicts

- **Within a batch,** files that end up with the same name get ` (1)`, ` (2)` in list order (1.4.6 behaviour). The status is *duplicate*.
- **Target exists outside the batch:** the per-batch choice is **Add (1)** (default) | **Skip** | **Replace**. Replace sends the existing file to the Recycle Bin first.
- Each preview row's new name is editable (double-click). A manual name overrides the steps for that file.

### Explorer integration

The installer adds classic context-menu entries for files and folders: **Rename with Vellova** and **Split with Vellova**. These start the app (or focus the running instance via single-instance) with the paths loaded.

Unsigned apps can't register in the Windows 11 compact menu, so the entries appear under *Show more options*, or Shift+F10. The installer uses `HKCU`, so no admin is needed.

## Split

### Input

- One or more .xlsx, .xls or .csv files.
- .xlsx: read with ExcelJS, keeping styles.
- .xls and .csv: read with SheetJS as values only. .csv encoding is auto-detected (UTF-8 with or without BOM, or Windows-1250/1252), and so is the delimiter (`,` `;` tab).
- Pick the **sheet** (default: the first).
- Pick the **header row** (default: auto-detected, meaning the first row whose non-empty cells are mostly text and that is followed by data rows; editable).

### Modes

1. **By value** (Splitify 2.0.1, unchanged):
   - a column plus a profile whose parameters are `{value, label, payable}`;
   - matching is trimmed and case-insensitive;
   - `payable` rows are grouped under `label` (or `value` if there is no label);
   - non-payable rows are excluded;
   - optionally, unmatched and excluded rows go to a `NON_MATCHING` output.
2. **Assign to people:**
   - Names come from the profile, each with a weight (default 1).
   - **Even blocks:** in list order, person *i* gets a contiguous run of rows. Targets are the weighted shares of the total, rounded with largest remainders, so the sum is exact. Ties go to earlier names.
   - **Keep groups together:** choose a group column. Groups are assigned largest first, each to the person with the largest remaining weighted deficit (target − assigned). Ties go to the earlier name. Groups are never split. If one group exceeds a share, that person simply gets more, and the preview says so.
   - **Output, chosen per run (remembered in the profile):**
     - one file per person; or
     - the same file with an **Assigned to** column (appended last, header "Assigned to", styled like the header row).
   - **Summary** (on by default, can be switched off):
     - in assigned-column mode, a `Summary` sheet listing person, rows, groups, and share %;
     - in file-per-person mode, a separate `{date}_{file}_summary.xlsx`.
3. **Fixed rows per file:** N rows each; the last file gets the remainder.
4. **N equal parts:** sizes differ by at most one; the earlier parts are larger.
5. **One file per sheet:** each worksheet becomes its own file. For .xlsx, sheet formatting is kept.

Every data output repeats the header row and keeps column widths, hidden columns, cell styles and number formats. Merged cells are remapped when both ends land in the same output. This is a port of the Splitify 2.0.1 `copyRow` and `writeRegionFile` logic. Formulas are copied with their cached results.

### Output

- **Name template** pieces: `{date}` (yyyyMMdd), `{file}`, `{group}`, `{person}`, `{part}`, `{sheet}`. Per-mode defaults:
  - by value: `{date}_{file}_{group}`
  - people: `{date}_{file}_{person}`
  - rows and parts: `{date}_{file}_part{part}`
  - sheets: `{date}_{file}_{sheet}`
  - Assigned to: `{date}_{file}_assigned`
- **Folder:** chosen | same as the source | a favourite. Optional **subfolder per group or person**.
- **Format:** same as the input (default) | always .xlsx | always .csv. .xls inputs default to .xlsx, because writing .xls isn't supported.
- **Collisions:** same rule as Rename, Add (1) | Skip | Replace (Recycle Bin). There are no silent overwrites.
- **Preview:** a card per output file with name, row count, groups or people, and person share. Click a card to see its first 20 rows.

### Archive originals

Ported from Splitify's approved design (`Splitify/docs/superpowers/specs/2026-08-04-archive-originals-design.md`):

- a global toggle in Settings, plus a folder per profile (with clash warnings);
- runs after the whole queue finishes;
- a file qualifies when it had no error and produced at least one group output;
- files are moved and renamed `<name>_<yyyymmdd>`, with `_2`, `_3` on collision;
- a locked file prompts Retry or Skip (in the Needs attention panel);
- a missing destination fails loudly.

### Undo and re-run

- Undo sends created outputs to the Recycle Bin (only those unchanged) and moves archived originals back.
- Re-run from History reloads the same files and settings, while the sources still exist.

## Errors

- Every failure is recorded **per file**, with a reason code, a plain-language message and technical detail. It's written to the Log and shown on the file's preview row. Batches continue past failures.
- The island shows *Attention*. **Review** opens the **Needs attention** panel, grouped by reason, with per-file and bulk actions:

| Reason | Actions |
|---|---|
| Keyword not found | Click value on PDF · Type name · Skip |
| Scanned PDF (no text layer: 0 text items on every page) | Type name · Skip |
| Same value as another file | Keep (1) suffix · Edit name |
| Target name exists | Add (1) · Skip · Replace (Recycle Bin) |
| File locked / in use | Retry · Skip (bulk: Retry all, Skip all) |
| No permission / file missing | Skip · Show in folder |
| Companion file without a match | Pick its PDF from a list · Skip |
| Split: column or header missing in one file | Choose column for this file · Skip |
| Unreadable or corrupt file | Skip |

- **Apply fixes** runs only the fixed files, inside the same batch and journal, so one Undo covers everything.
- Worker crashes are caught, logged, and the batch's remaining files are marked *attention: internal error*. The worker is restarted.
- Update-check failures are logged at info level and retried at the next interval, with nothing shown on the island.
- Atomic JSON writes. A corrupt settings, profiles or history file is renamed to `*.corrupt-<date>.json`, the app starts with defaults, and the Log says so.

## Testing

No real client files are ever used in the repo or shared.

- **Synthetic fixtures** (`scripts/make-fixtures.mjs`, committed to `test/fixtures/`, fake companies, numbers and names, deterministic seed):
  - **Invoices, SSRS style:** A4, one page, fixed-position text boxes, labels split into pieces, "Invoice No.:" with and without the colon, the value on the same line, the value below, two-column blocks, and a keyword that occurs several times.
  - **Invoices, other producers,** to vary how text is split into pieces:
    - an HTML invoice printed with headless Edge (`msedge --headless --print-to-pdf`);
    - pdf-lib with one text-show per glyph;
    - pdf-lib with TJ kerning arrays.
  - A scanned-style PDF (an image only).
  - Companion .xlsx, .csv, .xml and .txt files that match some invoices, plus decoys.
  - **Split workbooks:** formatted .xlsx with merges and a title block above the header; several sheets; .csv in UTF-8 with BOM and `;` delimiters and quoted commas; .csv in Windows-1250; .xls; a 50,000-row × 20-column .xlsx for performance.
- **Golden test:** `scripts/golden-146.mjs` runs the verbatim 1.4.6 `extract-pdf-value` code on `pdfjs-dist@3.11.174` in Node over every fixture × keyword × position, and writes `test/fixtures/golden-146.json`. The new engine must match it exactly (Vitest).
- **Private comparison** (optional, the author runs it locally): `npm run compare -- "<folder>" --keyword "<kw>" --position after`.
  - It runs both engines on real files and prints only the totals ("18 of 18 match").
  - For mismatches it prints anonymous structure statistics: items per page, the distribution of characters per item, how many pieces the keyword is split into, and the PDF producer.
  - It never prints names or values.
- **Unit tests (Vitest):**
  - every rename step and the conflict and duplicate logic;
  - pairing;
  - every split mode (remainders, weights, oversized groups, empty files, header detection, CSV parsing);
  - the name template;
  - migration mapping from the real old JSON shapes, using synthetic examples.
- **Rust tests:** journal written per operation; undo reverses in order and skips changed files; swap and cycle renames; case-only rename; Recycle Bin replace; archive collision counter; cross-volume move.
- **Release checklist** (manual): install on a clean Windows user; run the SmartScreen path; import old data; rename the fixture batch and undo it; split by each mode and undo; update from the previous version; check reduced motion; check keyboard-only use.
- **Performance budget:** cold start under 1 s; preview of 200 PDFs within 10 s; split of 50,000 rows within 10 s, with the island animating smoothly throughout.

## Delivery

One spec, three milestones, each with its own implementation plan and each releasable:

1. **Milestone 1: shell plus Rename at 1.4.6 parity.**
   - Tauri and Svelte scaffold; title bar; island with all states; themes; panels (History with Batches and Log, Profiles, Settings, Needs attention, Welcome).
   - Value-from-PDF (golden parity), Add text (prefix/suffix), Pair matching files, rename in place or copy to folder.
   - Conflicts, undo journal, Nomina migration, updater, installer, CI release.
   - After this, Nomina can be uninstalled.
2. **Milestone 2: Split.**
   - All five modes, output template, subfolders, summaries, archive originals.
   - .csv and .xls input, collisions, undo, re-run, Splitify migration.
   - After this, Splitify can be uninstalled.
3. **Milestone 3: Rename extras.**
   - Click value on PDF, Pattern from PDF, From a list, all modifier steps.
   - Sort into folders, report export, Explorer right-click.

## Out of scope (possible later)

- Watch folder (automatic processing of an inbox folder).
- OCR for scanned PDFs (would add 15–30 MB and slow batches).
- macOS and Linux builds.
- Cloud storage, email sending, scheduling.
- PDF merging and splitting.
- Editing cell contents.
- Code signing.
