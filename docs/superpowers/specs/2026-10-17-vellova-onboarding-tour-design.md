# Vellova first-run welcome and guided tour

Date: 2026-10-17. Ships in 0.1.0, before the first public release. Extends `2026-10-15-vellova-design.md` (Welcome panel, Shell and look).

## Goal

A new user goes from first launch to a first renamed batch without guessing, and knows where Undo, History, Profiles and Settings are. They learn by doing it once, on safe sample files.

## Decisions

- Welcome is a centred card over the app, which is blurred and dimmed behind it. It replaces the Welcome side panel.
- The tour is hands-on. Steps wait for the real action, and the user's actions are real app actions on sample files.
- It is built into the app (approach A). There is no tour library and no new dependency.
- Sample files ship with the app: five synthetic invoice PDFs, one with no invoice number, plus one matching `.xlsx`. They are made by `scripts/make-fixtures.mjs` and contain no real data.
- While the tour runs, only the highlighted control and the hint's own buttons can be clicked or reached by keyboard. The rest of the app is blocked, except the window's own controls (drag, minimize, maximize, close).
- The tour leaves nothing behind. The sample folder, the sample profile and the sample batch in History are all removed when it ends, is skipped, or on the next start after a crash.
- It can be replayed from Settings via **Show the tour again**.
- Old app names never appear (global constraint).

## Welcome card

Text (approved wording):

> Vellova renames files in batches, for example using an invoice number printed in a PDF, with matching spreadsheets renamed along with it. Renaming any file type by your own rules is coming in the next updates, along with splitting spreadsheets.

Below the text:
- The import offer ("Bring your earlier setup", with **Import** / **Not now**), shown only when old data is found. The behaviour and import code are unchanged from Task 13.
- **Try it with sample files**, the primary button, which starts the tour.
- **Skip**, which goes straight to the app.

Both buttons set `welcomed` to true. Esc acts like **Skip**.

## Tour layer

`Tour.svelte` is one full-window layer above everything, including the title-bar island. It has three looks:

1. **Card:** the app is blurred (backdrop-filter) and dimmed, with a centred card. Used for Welcome, Start and Done.
2. **Spotlight:** a dark veil with a rounded cut-out around the target (an SVG mask). Around it:
   - a pulsing glow ring;
   - a small curved arrow that bobs toward the target from the hint bubble;
   - the hint bubble itself, holding one line of text, a step counter ("4 of 14"), **Skip tour**, and **Next** on steps that wait for Next.

   The veil swallows pointer events everywhere except the cut-out.
3. **Hidden:** while a real action runs (reading files, applying, undoing), the layer stays visible but only the veil remains. The cut-out follows the island, which shows the progress.

### Targets

Elements carry `data-tour="<id>"`. The spotlight measures the target with `getBoundingClientRect` and re-measures it every animation frame, which also covers resize, scroll and layout changes. If the target isn't visible, the step waits; it never points at empty space.

### Steps

Steps are a plain array: `{ target, text, advance }`. `advance` is either `'next'` (the user presses Next or Enter) or a predicate over existing app state, such as files added, keyword set with the preview ready, batch finished, or undo finished. The tour only observes app state. It never clicks for the user, except **Add them for me** in step 3, which calls the same function as the drop zone.

### Island during the tour

The island's "done · Undo" state normally folds after a timeout. During step 10 it doesn't, so the user can always reach Undo.

### Blocking

- Pointer events outside the cut-out and the hint bubble do nothing.
- Tab cycles only between the target's focusables and the hint's buttons.
- Global shortcuts such as Ctrl+Z only work when the current step targets them.
- Esc asks "Skip the tour?" with **Skip** / **Keep going**.

### Motion

- The ring pulses (about 1.6 s), the arrow bobs (about 1.2 s), and the cut-out glides between targets (about 300 ms ease-out).
- With `prefers-reduced-motion`, the ring and arrow are static and the cut-out jumps.
- The colours use the existing theme tokens in both themes, and the hint text meets 4.5:1 contrast.

## Steps

The counter covers steps 3–16, shown as 1–14.

| # | Target | Hint | Advances when |
|---|---|---|---|
| 1 | Welcome card | (Welcome text above) | **Try it with sample files** / **Skip** |
| 2 | Start card | "Let's rename five sample invoices. Nothing on your computer is touched. They live in a temporary folder." | **Start** |
| 3 | Drop zone | "Drag the sample files in here." Buttons: **Open the folder** (Explorer, via opener reveal) and **Add them for me** | the six sample files are in the list |
| 4 | Keyword field | "Type `Invoice No.:`, the label printed just before each number." | the keyword is set and no file is pending |
| 5 | Position buttons | "The number comes *after* the label. Pick Below or Above when your invoices put it under or over it." | Next |
| 6 | Preview list | "Every new name, before anything changes." | Next |
| 7 | Row of the PDF with no number | "This invoice has no number, so Vellova asks you. Type a name for it, then press Enter." | that row has a typed name |
| 8 | The matching `.xlsx` row | "The spreadsheet with the same number gets the same new name automatically." | Next |
| 9 | Apply button | "Rename them." | the batch has finished |
| 10 | Island Undo | "Changed your mind? Undo puts every name back. It's also in History any time later." | the undo has finished |
| 11 | Save as new profile | "Save this setup. Next time, pick the profile and drop files." | a profile has been saved during the tour |
| 12 | Island Rename/Split | "Switch tools here. Split arrives in the next update." | Next |
| 13 | Island History | "History: every batch, undoable, plus the log." | Next |
| 14 | Island Profiles | "Profiles: your saved setups." | Next |
| 15 | Island Settings | "Settings: theme, updates, and this tour again." | Next |
| 16 | Theme switch | "Light or dark." | Next |
| 17 | Done card | "You're set. You can replay this tour from Settings." | **Finish** (then cleanup) |

## Going off-script

- **The state moves backwards** (files cleared, keyword changed after step 4, the needs-attention row has gone): the current step stays, and the hint says what to do to get back on track.
- **A step can't be completed** (a sample can't be read, Apply or Undo fails, or the target never appears within 5 s): the hint shows the reason and **Skip this step**.
- **Closing mid-tour:**
  - A marker `tour: { active, sampleDir, profileId, batchId }` is kept in settings.
  - On the next start, a marker that is still active triggers cleanup, and then a one-time "Resume the tour?" offer.
  - Resuming starts again at step 2 with fresh samples.

## Cleanup

Cleanup runs on Finish, Skip, and on start when the marker is still active:

1. Remove the sample folder (`%TEMP%\vellova-tour-<id>`) with a Rust command that refuses any path outside the temp dir.
2. Remove the profile with the recorded id.
3. Remove the batch with the recorded id from History, along with its journal files.
4. Clear the file list and reset the rename rules to what they were before the tour (keyword, position and text are saved at step 2).
5. Clear the marker.

## Settings

A new Help card at the end of Settings holds **Show the tour again**. It starts at step 2, and the Welcome card is not shown again.

## Sample files

`scripts/make-fixtures.mjs` gets a `tour` set written to `src-tauri/resources/tour/`, bundled as a Tauri resource:

- four PDFs in the same-line style, `Invoice No.: INV-2041` … `INV-2044`;
- one PDF with no invoice number;
- `export_0012.xlsx`, whose cell `INV-2042` matches the second PDF. It needs a neutral name: a file already called `INV-2042.xlsx` would show as unchanged.

The PDFs have neutral names (`scan_0011.pdf` … `scan_0015.pdf`; `scan_0014.pdf` is the one without a number). The resources add under 100 KB.

## Testing

- **Unit (vitest):**
  - the step predicates against fake session states;
  - the cleanup order and the marker lifecycle;
  - a resumed start runs cleanup first;
  - the sample profile and batch are removed and no other profile or batch is touched.
- **Rust:** the tour-folder removal refuses paths outside the temp dir and refuses paths that aren't tour folders.
- **Fixture test:** the bundled samples produce the expected preview, with 4 values, 1 needing attention and 1 paired `.xlsx`.
- **Manual (CDP plus a look):**
  - the whole tour in both themes and with reduced motion;
  - clicks outside the cut-out do nothing;
  - a keyboard-only run-through;
  - closing at step 9, then the resume offer, with nothing left behind.

## Out of scope

- Tours for Split and the Rename extras (added with those milestones).
- Localisation.
