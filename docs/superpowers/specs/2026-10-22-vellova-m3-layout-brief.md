# Milestone 3 brief: settings layout, Reset, Done island

**Date:** 2026-10-22
**Status:** Layout chosen by the user ("C with A's summary"). Mockups: https://claude.ai/artifact/AGqCiffFx2vQLdaW4HPRib (boards C-Split and C-Rename, plus the summary card from board A).

## Job and audience

The author uses this daily, and so do non-technical colleagues who must manage without help. About half of runs start from a profile; the other half are set up by hand. Today's left column shows too many options at once, has no clear order, makes it hard to see what a setting does, and needs scrolling.

## Selected direction

- **Command bar** above the preview, in a card:
  - Split: Profile (select and Save), Split by (Value, People, Rows, Parts, Sheets), Header (Row 1, or Manual opening the existing picker), Save to (folder, format, if taken), and Reset.
  - Rename: Profile, Name from (Text in the PDF; Milestone 3 adds Click on the PDF and A list), Files go, If taken, Matching files, and Reset.
- **Left column** shows only what the current choice needs:
  - Split: the chosen mode's fields (column, values table, people, and so on). Rare options (file names, subfolders and archive) sit in closed disclosures at the bottom.
  - Rename: "New name" as numbered steps with "+ Add a step". The steps from the spec land here. An example name sits at the bottom.
- **Summary mode (from A):** with a profile loaded and not edited, the left column shows a short summary of the profile: one sentence, plus one line per setting with a Change link. Change, or "Edit", opens that part in place. Without a profile, the full editor shows.
- **Reset:** puts the rules back to the loaded profile, or to the defaults when no profile is loaded, and clears the file list.
- **Done island:** after a batch, the island grows briefly into a message such as "12 files created", with an animation and two buttons, Open folder and Open file. Open file is offered only for a single output. The island then shrinks back to an icon like its other states. With several output folders, Open folder opens the first one; History has the full list. Reduced motion means no animation.

## Boundaries

- Keep every feature, the Ledger look, Geist, and the island and its animations.
- No modals for settings: open them inline or as a popover from the bar.
- The keyboard order follows the reading order: bar, then the left column, then the preview, then the footer.
- No em dashes in the UI text.

## Open for the plan

- Whether the bar wraps to two lines, or shows fewer controls, below a given window width.
- The exact summary wording for each mode.
