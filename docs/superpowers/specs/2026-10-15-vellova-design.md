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
  src/commands.rs              apply_plan, undo_batch, to_recycle_bin
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
  | { kind: 'rename'; from: string; to: string; replace?: boolean } // a move is a rename whose target is in another folder
  | { kind: 'copy'; from: string; to: string; replace?: boolean };
type PlanItem = { id: string; source: string; op: Op | null; status: 'ready' | 'paired' | 'duplicate' | 'unchanged' | 'attention' | 'skipped' | 'pending'; name?: string; reason?: Reason; detail?: string };
```

- The preview renders the Plan. Nothing touches disk until the user presses the main button.
- `pending` rows wait for an input (a keyword, a list and its columns, a full folder path) and have no operation; `skipped` rows are left out by the user or by the Skip rule. `detail` is a short status or error text.
- Rust then executes exactly the Plan's operations in order.
- Engines are unit-tested without the UI.

### Rust commands

- **`apply_plan(batchId, ops)`** executes the operations in order and appends a journal entry after each one. Each entry holds the operation, the result, and the final file's size and modified time. Swap and cycle renames (a→b, b→a) go through temporary names. A case-only rename (`a.pdf` → `A.pdf`) goes through a temporary name. Before the first operation it refuses the whole plan if any path is not absolute, so nothing can land relative to the program. Each operation returns its own result, so one failure doesn't stop the rest. Missing folders are created for copies and for moves. A move across volumes copies the file, then removes the source. Split outputs are staged by `stage_write` (Vellova's own staging files) and placed by journaled `copy` ops. Archiving is a `rename` op whose name the planner picks.
- **`undo_batch(batchId)`** walks the journal backwards:
  - renames and moves are reversed;
  - copied and written files go to the Recycle Bin;
  - archived originals are moved back.

  Any file whose size or modified time differs from the journal is left alone and reported.
- **`to_recycle_bin(paths)`** uses the `trash` crate.
- **`folders_exist(paths)`** checks the archive folder; a missing archive folder fails loudly and is never created.

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
| Working | "Renaming k of N" (or "Copying", "Moving") / "Splitting k of N" with a determinate bar, a moving sheen, and Cancel | - |
| Done | A check that draws itself, plus a single green ring pulse; "N files renamed" (or copied, moved, created) plus Open folder, Open file and Undo | After **4 s** the island springs back to idle and an **undo chip slides in** from the left |
| Attention | Warning icon; "N files need attention" plus Review | Shakes **once** (2–3 px, ~460 ms), then a warm glow pulses **3 times** and stops. After 6 s it collapses to an amber chip |
| Update ready | The download arrow drops in, then **nudges continuously**; "Update ready" plus Restart | After **3.5 s** it collapses to a download chip that nudges 3 times, then rests |
| Restarting / Restored | Spinner "Restarting…" / "N names restored" | Transient |

- **Open folder and Open file** (Done state):
  - Open folder opens the folder of the batch's first output file in Explorer. Open file opens that file itself and is offered only when the batch made exactly one file. Archived originals are never the target, and a batch that made nothing shows neither button.
  - The Done state stays while the pointer is over the island or keyboard focus is inside it; the 4 s count starts when both end.
  - If Windows refuses to open the target, the island shows "Couldn't open" and points to History › Log, the failure is logged as a warning, and the Undo chip stays.
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
- No screen carries hint lines, subtitles or explanatory text: labels, values and short error or status text stay.

### Screens and panels

- **Rename and Split** share one layout, top to bottom (which is also the keyboard order):
  - the tool's title;
  - the **command bar**: a card with the choices that shape the whole run, each a labelled control. It wraps onto more lines in a narrow window, so no control is ever hidden. A choice with several parts opens from the bar as a native popover, never a modal;
  - two columns: the **left column**, which shows only what the current choice needs, and the live preview;
  - the footer: a count ("6 files will be renamed · 1 needs attention"; "copied" or "moved" for those destinations), Undo last batch, and the main button.
- **Command bar, Rename:**
  - *Profile:* a select with Save and Save as new profile.
  - *Name from:* Text in the PDF | Click on the PDF | A list. Text in the PDF makes step 1 a Value-from-PDF step unless it already is a PDF step (a value or a pattern); A list makes it a From-a-list step unless it already is one, and focuses its Choose list… button; Click on the PDF opens the picker (disabled until a PDF is in the list). If step 1 is a source step of the other kind it is replaced; if step 1 is a modifier, the source step is inserted in front of it.
  - *Files go:* Rename in place | Copy to… | Move to…. The last two open a popover with the folder, Choose… and the chips `{value}`, `{n}` and `{date}`.
  - *If taken:* Add (1) | Skip | Replace (Recycle Bin).
  - *Matching files:* Rename too | Leave alone.
  - *Reset.*
- **Command bar, Split:**
  - *Profile.*
  - *Split by:* Value | People | Rows | Parts | Sheets.
  - *Sheet:* only when the first file has several sheets and the mode is not Sheets.
  - *Header:* Row 1 | Manual…, hidden in Sheets mode. Manual… opens the grid of the file's first rows, and the button then reads "Row N".
  - *Save to:* the folder (with favourites and Choose…), the format (Same type | .xlsx | .csv) and "If taken" (add (1) | skip | replace), each in its own popover.
  - *Reset.*
- **Reset** puts the rules back to the loaded profile (to the defaults when no profile is loaded), returns the left column to its summary and clears the file list. It is unavailable while a batch runs.
- **Left column, Rename:** "New name" as numbered steps.
  - Each step shows a one-line title of what it does, for example `Text after "Invoice No.:"`. A click opens its editor; one editor is open at a time. Arrows move a step up or down, and a cross removes it.
  - "+ Add a step" opens a menu: Add text, Replace, Remove, Trim spaces, Change case, Numbering, Date, Pattern from PDF, Value from PDF, From a list.
  - An Example sits at the bottom: the first ready PDF's new name with the found value marked.
- **Left column, Split:** the chosen mode's own fields under its title.
  - Split by value: the column, the values table (value, label, payable), a paste area for rows from Excel, and Keep non-matching rows.
  - Split among people: the names with weights, Even blocks | Keep groups together (with its group column), One file per person | Assigned to column, and Summary.
  - Rows per file and Equal parts: one number. One file per sheet: nothing more.
  - Rare options sit in two closed disclosures at the bottom, each showing its current value on its summary line: *File names* (the template) and *Subfolders and archive*.
- **Summary mode:** with a saved profile loaded and not edited, the left column shows a card with the profile's name and one line per setting (a label and its value), each with a Change link, plus an Edit button. Rename has one "New name" line per step, then Files go, If taken and Matching files. Split has Split by, Header, Save to, File names, Subfolders and Archive; a setting the mode doesn't use has no line. Change opens the editor and focuses that setting, opening its disclosure if it is in one; Edit opens the editor. Edit, Change or any change to the rules shows the editor; loading a profile or Reset brings the summary back. Without a profile the editor shows. The card holds no sentence or other explanatory text.
- **Empty state:** a large drop zone, "Drop files or folders here", with Add files / Add folder and an "Include subfolders" toggle.
- **Panels** slide in from the right over the current tool. Esc closes them, and the tool keeps its state underneath.
  - **History**, with two tabs:
    - *Batches:* both tools, filterable. Each batch offers Undo, Re-run (Split, while sources exist), Export report and Show files. Export report saves an .xlsx (default) or a .csv with one row per file under the headings Date, Old path, New path and Result (Done, Archived, Not finished, or the failure's reason). The date is the batch's time. The .csv is UTF-8 with a byte-order mark, so Excel reads it correctly.
    - *Log:* every error and warning from the engines, workers and app, with time, tool, file, a plain-language message and expandable technical details. Filter by tool and severity; Export .txt. Never sent anywhere.
  - **Profiles:** Rename and Split profiles; create, edit, duplicate, delete; JSON import/export, which also accepts old Nomina and Splitify profile files.
  - **Settings:** theme, updates, default folders, archive originals toggle, import old data, feedback (opens a GitHub issue), about.
  - **Needs attention:** see Errors.
  - **Welcome:** first launch only; offers the migration.

## Rename

### Steps

A Rename setup is an ordered list of **steps**. Each step runs on a file's **base name** (the extension is kept). A new setup starts with one empty Value-from-PDF step.

- Steps run on PDFs, in the order shown. A paired companion file takes its PDF's final name instead (see Companion files).
- A step that fails for a file marks it *attention* with a reason; other files continue.
- The preview recalculates live, debounced by 150 ms.

**Source steps** replace the name with a value. A value found in the PDF (by Value from PDF or Pattern from PDF) is also exposed as `{value}`; a list lookup is not.

- **Value from PDF:** keyword (empty to start), position (After to start; before | after | above | below), and match number (1 to start). PDFs only. The rules are under "The 1.4.6 engine".
- **Pattern from PDF:** one of five, plus a match number (1 to start) for the first three. Invoice-style number is the default.
  - *Invoice-style number:* one to six capital letters, an optional `-` or `/`, then three or more digits and further `-` or `/` digit groups (`INV-2026-0042`, `A12345`).
  - *Date:* `yyyy-MM-dd`, or day, month and year separated by `.` or `/` (`3.7.2026`, `03/07/26`), as written in the PDF.
  - *Custom pattern:* a regular expression. The first capture group is the value if it has one, otherwise the whole match. An invalid expression, or one that matches empty text, shows its error in the editor, and a file with no non-empty match is *attention: Pattern not found*.
  - *Document title* and *Creation date* (as `yyyy-MM-dd`): from the PDF's document info. A PDF without one is *attention: Pattern not found*.
  - The pattern runs over the PDF's text items joined by single spaces. Empty matches never count.
- **From a list:** choose an .xlsx, .xls or .csv file. Its first row names the columns (any case, trimmed). Pick the *match* column and the *new name* column, and what to match: the current file name without its extension (default) or the value found by an earlier step.
  - Matching is exact and ignores case and leading and trailing spaces. When a match occurs twice the first row wins, and rows with an empty match or name are ignored.
  - A file that is not in the list is *attention: Not in the list*.
  - While no list or either column is chosen, PDFs wait with "Choose a list and its two columns." instead of reporting a missing file or column.
  - A list that cannot be read (moved, open in Excel, a column renamed since the profile was saved) marks every PDF the same way, with the reason. The editor offers Read again, and the rest of the screen keeps working.

**Modifier steps** change the name so far:

| Step | What it does | Starts as |
|---|---|---|
| Replace | Finds text and replaces it: plain text or a regular expression (where the replacement may use `$1`), match case on or off, every match or the first. Does nothing while Find is empty. | Every match on; match case off; regular expression off |
| Add text | Text at the start, text at the end, and optionally text inserted at position N (0 is before the first character). | All empty |
| Remove | Characters N to M (1-based, inclusive), all digits, or the text between two markers, markers included (the first pair only). | Characters 1 to 1; markers `(` and `)` |
| Trim spaces | Removes spaces at both ends and turns every run of spaces into one. | |
| Change case | UPPER, lower, Title or Sentence. Title lower-cases the name, then capitalizes the first character after the start, a space, `_` or `-`. Sentence lower-cases the name, then capitalizes its first character. | UPPER |
| Numbering | Adds a number, start + position × step, zero-padded to the digit count. The position is the PDF's place among the PDFs in the list as shown. The number is also `{n}`. | Start 1; step 1; 3 digits; at the end; separator `_` |
| Date | Adds a date: today, the file's date modified or its date created, in local time. The format uses `yyyy`, `yy`, `MM`, `dd`, `HH` and `mm`; other characters stay as typed. The date is also `{date}`. | Today; `yyyy-MM-dd`; at the start; separator `_` |

**Click on the PDF** is not a step. It is a picker for Value-from-PDF, opened from "Name from" on the bar (it shows the first PDF) or from Needs attention for a file whose keyword was not found:

1. The PDF's page is drawn by pdf.js in the worker, with previous and next buttons for more pages.
2. Words are shown as hoverable boxes; click the value.
3. Vellova proposes the nearest label word and the position, using the same geometry the engine uses. It tries after, below, before, then above, looks at the three nearest words on each side, and keeps the first label for which the engine gives back exactly the clicked text. A word with a digit in it is never proposed as a label, because it is more likely another value; a label such as "Line 2" is typed. When nothing fits, the keyword field is empty and focused.
4. The keyword, position and match number stay editable, and "Gives" shows the value the engine finds with them. **Use this** fills the first Value-from-PDF step (or becomes step 1, replacing a pattern or list source) and the preview is re-run over all files at once.

**Destination:** rename in place | copy to folder | move to folder.

- Move renames each file into the folder, so it leaves its old place. Undo moves it back.
- The folder must be a full path: a drive path (`C:\` or `C:/`) or a network path (`\\server`). Until it is, the files wait with "Choose a folder to copy into." (or "move into." when the folder is empty) or "Use a full folder path.", and no operation is planned.
- The folder path may contain `{value}`, `{n}` and `{date}` ("Sort into folders"); missing folders are created.
  - `{value}` is the value the PDF's last Value-from-PDF or Pattern step found; for a file without one (a failed PDF, steps that find no value, or a typed companion without its PDF) it is `_`.
  - `{n}` is the number a Numbering step gave the file, otherwise the PDF's place among the PDFs in the list (1, 2, …).
  - `{date}` is the date a Date step gave the file, otherwise today as `yyyy-MM-dd`.
  - Each filled-in part is made safe on its own: `\ / : * ? " < > |` and control characters become `_`, trailing dots and spaces are removed, and an empty part becomes `_`. A value can therefore never be `.` or `..` and never leaves the chosen folder. The template's own text stays as typed.
- In a folder, a companion file goes beside its PDF.

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

**Fallback if parity can't be reached:** pin `pdfjs-dist@3.11.174` in the PDF worker with `isEvalSupported: false` (which mitigates CVE-2024-4367), text extraction only. The picker for Click on the PDF renders with the same pinned pdf.js 3.11.174 and `isEvalSupported: false`.

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

The installer adds classic context-menu entries under `HKCU\Software\Classes`, so no admin rights are needed. The uninstaller removes them in the post-uninstall hook (`NSIS_HOOK_POSTUNINSTALL`), after the running-app check, so a cancelled uninstall keeps them:

- **Rename with Vellova** on .pdf, .xlsx, .csv, .xml and .txt files and on folders;
- **Split with Vellova** on .xlsx, .xls and .csv files and on folders.

Each entry runs `Vellova.exe --rename "<path>"` or `--split "<path>"` and has `MultiSelectModel` set to `Player`, so a selection of many files starts one process per file. The first process opens the app; the others pass their path to the running instance (single-instance), which comes to the front. The app collects every launch and adds all the paths to one list on the right tool, closing any open panel. A folder is read as if dropped on the window: Rename follows "Include subfolders when adding a folder" in Settings, and Split reads only the folder's own files. Files the tool doesn't take are left out. While the tour runs, files sent from Explorer are not added, and the Log says so. A pending "Resume the tour?" card gives way to files sent from Explorer, and is not offered when files are already on a screen.

Unsigned apps can't register in the Windows 11 compact menu, so the entries appear under *Show more options*, or Shift+F10.

## Split

### Input

- One or more .xlsx, .xls or .csv files.
- .xlsx: read with ExcelJS, keeping styles.
- .xls and .csv: read with SheetJS as values only. .csv encoding is auto-detected (UTF-8 with or without BOM, or Windows-1250/1252), and so is the delimiter (`,` `;` tab).
- Pick the **sheet** (default: the first).
- Pick the **header row**: **Default (1st row)** or **Manual** (click a row in a grid of the file's first 15 rows). Rows above a manual header are a title block, copied on top of every data output.

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

Every data output repeats the header row and keeps column widths, hidden columns, cell styles and number formats. Merged cells are remapped when both ends land in the same output. This is a port of the Splitify 2.0.1 `copyRow` and `writeRegionFile` logic. Formula cells are written as their last calculated value, not as formulas.

### Output

- **Name template** pieces: `{date}` (yyyyMMdd), `{file}`, `{group}`, `{person}`, `{part}`, `{sheet}`. Per-mode defaults:
  - by value: `{date}_{file}_{group}`
  - people: `{date}_{file}_{person}`
  - rows and parts: `{date}_{file}_part{part}`
  - sheets: `{date}_{file}_{sheet}`
  - Assigned to: `{date}_{file}_assigned`
- **Folder:** chosen | same as the source | a favourite. Optional **subfolder per group or person**.
- **Format:** same as the input (default) | always .xlsx | always .csv. .xls inputs default to .xlsx, because writing .xls isn't supported. When a .csv becomes .xlsx, number-like cells are saved as numbers (decimal comma for `;`-separated files); leading-zero IDs, numbers over 15 digits and dates stay text, and a column holding any leading-zero ID stays text.
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
| Pattern not found | Type name · Skip |
| Not in the list | Type name · Skip |
| Scanned PDF (no text layer: 0 text items on every page) | Type name · Skip |
| Same value as another file | Keep (1) suffix · Edit name |
| Target name exists | Add (1) · Skip · Replace (Recycle Bin) |
| File locked / in use | Retry · Skip (bulk: Retry all, Skip all) |
| No permission / file missing | Skip · Show in folder |
| Companion file without a match | Pick its PDF from a list · Skip |
| Split: column or header missing in one file | Choose column for this file · Skip |
| Unreadable or corrupt file | Skip |

- **Apply fixes** runs only the fixed files, inside the same batch and journal, so one Undo covers everything.
- A group shows its title and count, and under each file only its own detail. There is no hint line. Target name exists with Replace chosen adds one short error: "This drive has no Recycle Bin, so Replace can't be used." The footer shows the number of fixed files that are ready (nothing when there are none) beside Apply fixes.
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
- **Release checklist** (manual): install on a clean Windows user; run the SmartScreen path; import old data; rename the fixture batch and undo it; split by each mode and undo; update from the previous version; check reduced motion; check keyboard-only use of both screens; check 1366×768 at 125% scaling; run the tour from Settings; right-click files and folders in Explorer.
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
   - The command bar and focused left column on both screens, profile summaries, Reset, and the Done island's Open folder and Open file.

## Out of scope (possible later)

- Watch folder (automatic processing of an inbox folder).
- OCR for scanned PDFs (would add 15–30 MB and slow batches).
- macOS and Linux builds.
- Cloud storage, email sending, scheduling.
- PDF merging and splitting.
- Editing cell contents.
- Code signing.
