# Vellova Welcome Card and Guided Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Welcome side panel with a centred card over a blurred app, and add a hands-on first-run tour that renames bundled sample files, then removes everything it made.

**Architecture:**
- **Rust:** a small `tour.rs` copies the bundled samples to a fresh `%TEMP%\vellova-tour-<ms>` folder, and removes only such folders. `files.rs` gains `forget_batch`, which deletes one batch's journals.
- **Front end:**
  - `src/lib/tour/steps.ts` holds the pure parts: the step list, completion predicates, cleanup filters and path checks.
  - `tour.svelte.ts` holds the runtime state and the start/next/end/cleanup flow.
  - `Tour.svelte` draws the card, the spotlight veil (an SVG mask), the pulsing ring, the bobbing arrow and the hint bubble. It blocks every click and Tab outside the target and the bubble, using capture-phase listeners.
  - Rename and Island elements get `data-tour="…"` attributes so the tour can find them.

**Tech Stack:** Tauri 2, Rust std, Svelte 5 runes, TypeScript, vitest, pdf-lib and xlsx (both already dev dependencies, used by the fixture generator).

**Spec:** `docs/superpowers/specs/2026-10-17-vellova-onboarding-tour-design.md` (extends `docs/superpowers/specs/2026-10-15-vellova-design.md`).

## Global Constraints

- The old app names never appear in UI text.
- No new npm or cargo dependencies.
- Sample files are synthetic only (made by `scripts/make-fixtures.mjs`); never use real client files.
- The tour removes only what it made: its own `%TEMP%\vellova-tour-*` folder, its own batch (History entry plus journals), and a profile created during the tour. Nothing else.
- Text contrast is at least 4.5:1 in both themes, using existing theme tokens.
- `prefers-reduced-motion`: the ring and arrow are static, with no glide transitions.
- Everything works by keyboard alone. Esc asks before skipping. Tab stays within the target and the hint.
- The window's own drag region and minimize/maximize/close buttons stay usable during the tour.
- Edit source files with the Edit tool. Shell heredocs halve backslashes in this repo.
- `npx vitest run`, `npm run check` (0 errors) and `cargo test --manifest-path src-tauri/Cargo.toml` all pass after every task.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
  ```
- Never push.
- The dev app shares the real data folder `%APPDATA%\com.vslnnd.vellova`.
  - Never delete or edit that folder.
  - To see the tour in dev, use Settings → **Show the tour again**.
  - Never click Import.

## Review Focus

1. **Real files dropped or picked during the tour.** Explorer drag, Add files or Add folder must never put a non-sample file in the list. If one got in, Apply would rename it and cleanup would delete its undo journal. Pinned by the `inSampleDir` tests (Task 2), plus a manual check (Task 3).
2. **Picking an existing profile in the "Save this setup" step.** It must not count as the tour's profile, so cleanup never deletes it. Pinned by the `tourProfile` tests (Task 2).
3. **A hand-edited or corrupt `tour` marker in settings.json.**
   - A non-object marker is dropped (pinned by the `withDefaults` test, Task 2).
   - A marker pointing anywhere but a tour folder is refused by Rust (pinned by the `is_tour_dir` / `remove_tour_dir` tests, Task 1).
4. **The app closed mid-tour.** The next start removes the sample folder, batch and profile, and offers "Resume the tour?" once. A failed cleanup keeps the marker and retries at the next start. Pinned by the `withoutTour` tests (Task 2) and a manual close-and-restart check (Task 3).
5. **Skip tour pressed while the sample batch is still renaming.** Cleanup waits for the batch to finish (`whenIdle`) before removing anything, so the batch can't reappear in History afterwards. Manual check (Task 3).

---

### Task 1: Sample files, Rust commands and IPC

**Files:**
- Modify: `scripts/make-fixtures.mjs`
- Create: `src-tauri/resources/tour/` (generated: `scan_0011.pdf` … `scan_0015.pdf`, `export_0012.xlsx`)
- Modify: `src-tauri/tauri.conf.json` (`bundle.resources`)
- Create: `src-tauri/src/tour.rs`
- Modify: `src-tauri/src/files.rs` (add `forget_batch`), `src-tauri/src/lib.rs`
- Modify: `src/lib/shared/ipc.ts`
- Modify: `test/golden-helpers.ts` (`fixtureItems` takes a folder)
- Create: `test/tour.test.ts`

**Interfaces:**
- Produces (Rust commands):
  - `tour_prepare() -> String`: the absolute sample folder path.
  - `tour_cleanup(dir: String)`: refuses anything that isn't `<temp>\vellova-tour-*`.
  - `forget_batch(batch: String)`: deletes `journal\<batch>.jsonl` and `.undo.jsonl`, taking the busy guard.
- Produces (TS), in `ipc`:
  - `tourPrepare(): Promise<string>`
  - `tourCleanup(dir: string): Promise<void>`
  - `forgetBatch(batch: string): Promise<void>`
- Produces (samples): `scan_0011.pdf`, `scan_0012.pdf`, `scan_0013.pdf` and `scan_0015.pdf` give `INV-2041`, `INV-2042`, `INV-2043` and `INV-2044` for `Invoice No.:` / after. `scan_0014.pdf` has no `Invoice No.:`. `export_0012.xlsx` holds `INV-2042`.

- [ ] **Step 1: Generate the samples**

In `scripts/make-fixtures.mjs`, change `pdf()` so it can write elsewhere without adding a golden case:

```js
async function pdf(name, keywords, draw, dir = OUT) {
```
and its last two lines to:
```js
  writeFileSync(join(dir, name), await doc.save({ useObjectStreams: false }));
  if (dir === OUT) cases[name] = keywords;
}
```

Then, just before the final `writeFileSync(join(OUT, 'cases.json'), …)` line, add:

```js
// The tour's sample set, bundled with the app: four invoices with a number, one without, one matching export.
const TOUR = resolve('src-tauri/resources/tour');
mkdirSync(TOUR, { recursive: true });
const sampleInvoice = (no) => (c) => {
  letterhead(c, 'INVOICE');
  c.t('Invoice No.:', 330, 140); c.t(no, 430, 140);
  c.t('Date:', 330, 154); c.t('16.10.2026', 430, 154);
  lines(c, 220, [['Sample service', '1', '100,00']]);
};
for (const [file, no] of [['scan_0011.pdf', 'INV-2041'], ['scan_0012.pdf', 'INV-2042'], ['scan_0013.pdf', 'INV-2043'], ['scan_0015.pdf', 'INV-2044']]) {
  await pdf(file, [], sampleInvoice(no), TOUR);
}
await pdf('scan_0014.pdf', [], (c) => {
  letterhead(c, 'DELIVERY NOTE');
  c.t('Delivery date:', 330, 140); c.t('16.10.2026', 430, 140);
  lines(c, 220, [['Sample parcel', '1', '']]);
}, TOUR);
writeFileSync(join(TOUR, 'export_0012.xlsx'), book([['Invoice No.:', 'Amount'], ['INV-2042', 100]]));
```

Run: `npm run fixtures`

Expected: `src-tauri/resources/tour` holds exactly the 6 files. `git status` shows the 6 new files and only cosmetic changes, if any, under `test/fixtures`. If `test/fixtures` files changed bytes, run `git checkout test/fixtures` so only the tour set is new.

- [ ] **Step 2: Write the failing sample test**

In `test/golden-helpers.ts`, change `fixtureItems` to take a folder:

```ts
export async function fixtureItems(build: 'legacy' | 'modern', file: string, dir = 'test/fixtures'): Promise<Item[]> {
```
and the read line to:
```ts
  const data = new Uint8Array(readFileSync(`${dir}/${file}`));
```

Create `test/tour.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { companionData } from '../src/lib/rename/engine/companion';
import { findValue } from '../src/lib/rename/engine/findValue';
import { pairCompanions } from '../src/lib/rename/engine/pairing';
import { FIRST_SAMPLE, NO_NUMBER, PAIRED, SAMPLE_COUNT, WITH_VALUE } from '../src/lib/tour/steps';
import { fixtureItems } from './golden-helpers';

const DIR = 'src-tauri/resources/tour';
const WANT: Record<string, string | null> = {
  'scan_0011.pdf': 'INV-2041',
  'scan_0012.pdf': 'INV-2042',
  'scan_0013.pdf': 'INV-2043',
  [NO_NUMBER]: null,
  'scan_0015.pdf': 'INV-2044',
};

describe('tour samples', () => {
  it('are exactly the set the tour expects', () => {
    expect(readdirSync(DIR).sort()).toEqual([...Object.keys(WANT), PAIRED].sort());
    expect(Object.keys(WANT).length + 1).toBe(SAMPLE_COUNT);
    expect(Object.values(WANT).filter(Boolean).length).toBe(WITH_VALUE);
    expect(WANT[FIRST_SAMPLE]).toBeTruthy();
  });

  it.each(Object.entries(WANT))('%s gives %s after "Invoice No.:"', async (file, want) => {
    const r = findValue(await fixtureItems('modern', file, DIR), 'Invoice No.:', 'after');
    expect(r.ok ? r.value : null).toBe(want);
  });

  it('the export pairs with the second invoice only', () => {
    const data = companionData('.xlsx', new Uint8Array(readFileSync(`${DIR}/${PAIRED}`)));
    const pdfs = [{ path: 'a', value: 'INV-2041' }, { path: 'b', value: 'INV-2042' }];
    expect(pairCompanions(pdfs, [{ path: 'x', data }])).toEqual({ x: 'b' });
  });
});
```

This test imports constants from `src/lib/tour/steps.ts`, which Task 2 fills in. Create that file now with only these constants, and Task 2 extends it:

```ts
/** The sample set bundled in src-tauri/resources/tour (made by scripts/make-fixtures.mjs). */
export const SAMPLE_COUNT = 6;
/** sample PDFs that have an invoice number */
export const WITH_VALUE = 4;
export const NO_NUMBER = 'scan_0014.pdf';
export const PAIRED = 'export_0012.xlsx';
export const FIRST_SAMPLE = 'scan_0011.pdf';
```

- [ ] **Step 3: Run the sample test**

Run: `npx vitest run test/tour.test.ts`

Expected: PASS, 7 tests. If a value test fails, fix the sample drawing in Step 1, not the test.

- [ ] **Step 4: Write the failing Rust tests and the module**

Create `src-tauri/src/tour.rs`:

```rust
//! The tour's sample files: copied from the bundled resources into a fresh temp folder, and removed afterwards.
//! Only folders named `vellova-tour-…` directly inside the temp folder can ever be removed.

use crate::files::err;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const PREFIX: &str = "vellova-tour-";

/// A folder `tour_prepare` made: directly inside `temp`, named `vellova-tour-` plus something.
pub(crate) fn is_tour_dir(temp: &Path, dir: &Path) -> bool {
    dir.parent() == Some(temp)
        && dir.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.len() > PREFIX.len() && n.starts_with(PREFIX))
}

/// Copies every file in `from` into `temp\vellova-tour-<stamp>` and returns that folder.
pub(crate) fn copy_samples(from: &Path, temp: &Path, stamp: u128) -> io::Result<PathBuf> {
    let dir = temp.join(format!("{PREFIX}{stamp}"));
    fs::create_dir_all(&dir)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        if e.file_type()?.is_file() {
            fs::copy(e.path(), dir.join(e.file_name()))?;
        }
    }
    Ok(dir)
}

/// Removes a tour folder (already gone is fine); anything else is refused.
pub(crate) fn remove_tour_dir(temp: &Path, dir: &Path) -> Result<(), String> {
    if !is_tour_dir(temp, dir) {
        return Err(format!("not a tour folder: {}", dir.display()));
    }
    match fs::remove_dir_all(dir) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        r => r.map_err(err),
    }
}

#[tauri::command]
pub async fn tour_prepare(app: AppHandle) -> Result<String, String> {
    let from = app.path().resource_dir().map_err(err)?.join("tour");
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_millis();
    let dir = copy_samples(&from, &std::env::temp_dir(), stamp).map_err(err)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn tour_cleanup(dir: String) -> Result<(), String> {
    remove_tour_dir(&std::env::temp_dir(), Path::new(&dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_the_samples_into_a_fresh_tour_folder() {
        let res = tempfile::tempdir().unwrap();
        let temp = tempfile::tempdir().unwrap();
        fs::write(res.path().join("a.pdf"), b"pdf").unwrap();
        fs::write(res.path().join("b.xlsx"), b"xl").unwrap();
        let dir = copy_samples(res.path(), temp.path(), 42).unwrap();
        assert!(is_tour_dir(temp.path(), &dir));
        assert_eq!(fs::read(dir.join("a.pdf")).unwrap(), b"pdf");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
    }

    #[test]
    fn only_tour_folders_directly_in_temp_qualify() {
        let temp = Path::new(r"C:\Temp");
        assert!(is_tour_dir(temp, Path::new(r"C:\Temp\vellova-tour-1")));
        assert!(is_tour_dir(temp, Path::new(r"C:\Temp\vellova-tour-1\")));
        assert!(!is_tour_dir(temp, Path::new(r"C:\Temp\vellova-tour-")));
        assert!(!is_tour_dir(temp, Path::new(r"C:\Temp\other")));
        assert!(!is_tour_dir(temp, Path::new(r"C:\Temp\x\vellova-tour-1")));
        assert!(!is_tour_dir(temp, Path::new(r"C:\Users\vellova-tour-1")));
        assert!(!is_tour_dir(temp, Path::new(r"C:\Temp\vellova-tour-1\..\..\Windows")));
        assert!(!is_tour_dir(temp, Path::new("vellova-tour-1")));
        assert!(!is_tour_dir(temp, Path::new(r"C:\Temp")));
    }

    #[test]
    fn remove_refuses_other_folders_and_tolerates_a_missing_one() {
        let temp = tempfile::tempdir().unwrap();
        let keep = temp.path().join("keep");
        fs::create_dir(&keep).unwrap();
        assert!(remove_tour_dir(temp.path(), &keep).is_err());
        assert!(keep.exists());
        let dir = temp.path().join("vellova-tour-7");
        fs::create_dir(&dir).unwrap();
        fs::write(dir.join("a.pdf"), b"x").unwrap();
        remove_tour_dir(temp.path(), &dir).unwrap();
        assert!(!dir.exists());
        remove_tour_dir(temp.path(), &dir).unwrap();
    }
}
```

In `src-tauri/src/lib.rs`:
- add `mod tour;` under `mod ops;`;
- add `files::forget_batch,`, `tour::tour_prepare,` and `tour::tour_cleanup,` to `generate_handler!`.

In `src-tauri/src/files.rs`, add after `cancel_apply`:

```rust
/// Deletes a batch's journals (the tour's sample batch, once it has left History). Takes the busy guard, so it
/// never runs during a batch, an undo or recovery; the caller tries again later.
#[tauri::command]
pub async fn forget_batch(app: AppHandle, batch: String) -> Result<(), String> {
    let _busy = Busy::take()?;
    for suffix in [".jsonl", ".undo.jsonl"] {
        if let Err(e) = fs::remove_file(journal(&app, &batch, suffix)?) {
            if e.kind() != io::ErrorKind::NotFound {
                return Err(err(e));
            }
        }
    }
    Ok(())
}
```

In `src-tauri/tauri.conf.json`, inside `bundle`, after `"icon": [...]`, add:

```json
    "resources": { "resources/tour/*": "tour/" },
```

- [ ] **Step 5: Run the Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS, 46 tests (43 before, plus 3).

- [ ] **Step 6: Add the IPC calls**

In `src/lib/shared/ipc.ts`, add inside `ipc` after `recoverAll`:

```ts
  forgetBatch: (batch: string) => invoke<void>('forget_batch', { batch }),
  tourPrepare: () => invoke<string>('tour_prepare'),
  tourCleanup: (dir: string) => invoke<void>('tour_cleanup', { dir }),
```

Run: `npx vitest run` and `npm run check`

Expected: all pass, 0 errors.

- [ ] **Step 7: Check the resources ship**

Run: `npm run tauri dev` in the background and wait for the window. Then run:

```bash
node scripts/cdp.mjs eval "window.__TAURI_INTERNALS__.invoke('tour_prepare').then(async (d) => { const l = await window.__TAURI_INTERNALS__.invoke('list_dir', { dirs: [d] }); await window.__TAURI_INTERNALS__.invoke('tour_cleanup', { dir: d }); return l.length; })"
```

Expected: `6`. Stop the app (kill `vellova.exe` and the dev server).

- [ ] **Step 8: Commit**

```bash
git add scripts/make-fixtures.mjs src-tauri/resources/tour src-tauri/tauri.conf.json src-tauri/src/tour.rs src-tauri/src/files.rs src-tauri/src/lib.rs src/lib/shared/ipc.ts src/lib/tour/steps.ts test/golden-helpers.ts test/tour.test.ts
git commit -F- <<'EOF'
feat: bundled tour samples and commands to prepare and clean them up

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 2: Tour logic (steps, marker, cleanup, add filter)

**Files:**
- Modify: `src/lib/shared/types.ts`, `src/lib/shared/store.ts`
- Modify: `src/lib/tour/steps.ts` (extend Task 1's constants)
- Create: `src/lib/tour/tour.svelte.ts`
- Modify: `src/lib/shell/island.ts` (add `reset`)
- Modify: `src/lib/rename/session.svelte.ts` (add `setAddFilter`)
- Create: `test/steps.test.ts`
- Modify: `test/island.test.ts`, `test/store.test.ts`

**Interfaces:**
- Consumes:
  - from Task 1: `ipc.tourPrepare`, `ipc.tourCleanup`, `ipc.forgetBatch`, and the sample constants;
  - existing: `session`, `addPaths`, `clearFiles`, `whenIdle` (`rename/session.svelte`); `data`, `save`, `log` (`shared/state.svelte`); `island`, `send` (`shell/islandState.svelte`); `ui` (`app.svelte`); `DEFAULT_RULES` (`rename/engine/profile`).
- Produces:
  - `types.ts`: `TourMarker = { dir: string; batch: string | null; profile: string | null }`, and `Settings.tour: TourMarker | null`.
  - `steps.ts`:
    - `TourView`, `TourStep`, `STEPS`, `counted`;
    - `inSampleDir(dir, path): boolean`;
    - `tourProfile(profileId, beforeIds): string | null`;
    - `withoutTour(history, profiles, marker)`.
  - `tour.svelte.ts`:
    - state: `tour` (`{ step, card, dir, since, error }`);
    - queries: `tourActive()`, `current()`, `holdDone()`, `tourRow(path)`, `view()`;
    - actions: `startTour()`, `beginSamples()`, `addSamples()`, `next()`, `endTour()`, `tourOnStart()`.
  - `session.svelte.ts`: `setAddFilter(f: ((path: string) => boolean) | null)`.
  - `island.ts`: event `{ type: 'reset' }`, which clears everything except a ready update.

- [ ] **Step 1: Write the failing tests**

Create `test/steps.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { counted, inSampleDir, STEPS, tourProfile, withoutTour, type TourView } from '../src/lib/tour/steps';
import type { Batch, RenameProfile } from '../src/lib/shared/types';

const base: TourView = { samples: 6, values: 4, reading: false, named: false, batch: null, busy: false, undone: false, profile: null, error: false };
const step = (id: string) => STEPS.find((s) => s.id === id)!;
const done = (id: string, v: Partial<TourView>) => {
  const d = step(id).done;
  return typeof d === 'function' && d({ ...base, ...v });
};

describe('tour steps', () => {
  it('counts 14 pointing steps between the Start and Done cards', () => {
    expect(STEPS[0].id).toBe('start');
    expect(STEPS.at(-1)!.id).toBe('done');
    expect(counted.length).toBe(14);
  });

  it('waits for all six samples, the found values and the finished read', () => {
    expect(done('drop', { samples: 5 })).toBe(false);
    expect(done('drop', { samples: 6 })).toBe(true);
    expect(done('keyword', { values: 3 })).toBe(false);
    expect(done('keyword', { reading: true })).toBe(false);
    expect(done('keyword', {})).toBe(true);
  });

  it('apply and undo finish only once nothing is running', () => {
    expect(done('apply', { batch: 'b', busy: true })).toBe(false);
    expect(done('apply', { batch: 'b' })).toBe(true);
    expect(done('undo', { undone: true, busy: true })).toBe(false);
    expect(done('undo', { undone: true })).toBe(true);
    expect(done('profile', { profile: 'p' })).toBe(true);
  });

  it('says what went missing before the batch, and nothing after it', () => {
    expect(step('keyword').lost!({ ...base, samples: 0 })).toMatch(/left the list/);
    expect(step('preview').lost!({ ...base, values: 1 })).toMatch(/Invoice No/);
    expect(step('preview').lost!({ ...base, values: 1, reading: true })).toBeNull();
    expect(step('apply').lost!({ ...base, samples: 0, values: 0, batch: 'b' })).toBeNull();
  });
});

describe('inSampleDir', () => {
  const dir = 'C:\\Temp\\vellova-tour-17';
  it('accepts files directly in the sample folder, any case or slash', () => {
    expect(inSampleDir(dir, 'C:\\Temp\\vellova-tour-17\\scan_0011.pdf')).toBe(true);
    expect(inSampleDir(dir, 'c:/temp/VELLOVA-TOUR-17/scan_0011.pdf')).toBe(true);
  });
  it('refuses everything else', () => {
    expect(inSampleDir(dir, 'C:\\Users\\me\\Invoices\\real.pdf')).toBe(false);
    expect(inSampleDir(dir, 'C:\\Temp\\vellova-tour-170\\scan_0011.pdf')).toBe(false);
    expect(inSampleDir(dir, 'C:\\Temp\\vellova-tour-17\\sub\\x.pdf')).toBe(false);
    expect(inSampleDir('', 'C:\\x.pdf')).toBe(false);
  });
});

describe('tourProfile', () => {
  it('is the profile saved during the tour, never one that existed before', () => {
    expect(tourProfile(null, ['a'])).toBeNull();
    expect(tourProfile('a', ['a', 'b'])).toBeNull();
    expect(tourProfile('new', ['a', 'b'])).toBe('new');
  });
});

describe('withoutTour', () => {
  const b = (id: string) => ({ id }) as Batch;
  const p = (id: string) => ({ id }) as RenameProfile;
  it('removes only the tour batch and profile', () => {
    const r = withoutTour([b('t'), b('x')], [p('tp'), p('y')], { dir: 'd', batch: 't', profile: 'tp' });
    expect(r.history.map((h) => h.id)).toEqual(['x']);
    expect(r.profiles.map((h) => h.id)).toEqual(['y']);
  });
  it('removes nothing when the tour made nothing', () => {
    const r = withoutTour([b('x')], [p('y')], { dir: 'd', batch: null, profile: null });
    expect(r.history).toHaveLength(1);
    expect(r.profiles).toHaveLength(1);
  });
});
```

Add to `test/island.test.ts`, inside `describe('island', …)`:

```ts
  it('reset clears the tour batch but keeps a ready update', () => {
    const s = run(start, { type: 'finish', text: '6 files renamed', attention: 1 }, { type: 'updateReady', version: '0.1.1' });
    const r = reduce(s, { type: 'reset' });
    expect(r.done).toBeNull();
    expect(r.attention).toBe(0);
    expect(r.update).toBe('0.1.1');
    expect(layer(r)).toBe('tools');
  });
```

Add to `test/store.test.ts`, which already imports `withDefaults`; add the import if missing:

```ts
  it('drops a tour marker that is not a well-formed object', () => {
    expect(withDefaults({ tour: 'C:\\Windows' }).tour).toBeNull();
    expect(withDefaults({ tour: { dir: 5 } }).tour).toBeNull();
    expect(withDefaults({ tour: { dir: 'C:\\Temp\\vellova-tour-1', batch: 'b', profile: null } }).tour).toEqual({ dir: 'C:\\Temp\\vellova-tour-1', batch: 'b', profile: null });
    expect(withDefaults({}).tour).toBeNull();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/steps.test.ts test/island.test.ts test/store.test.ts`

Expected: FAIL. `STEPS`, `inSampleDir` and the rest aren't exported yet, the `reset` event is unknown, and `.tour` is undefined.

- [ ] **Step 3: Types, settings default and island reset**

`src/lib/shared/types.ts`: add before `export type Settings`:

```ts
/** What a running tour has made, kept in settings so a crash mid-tour is cleaned up at the next start. */
export type TourMarker = { dir: string; batch: string | null; profile: string | null };
```

and inside `Settings`, after `welcomed: boolean;`:

```ts
  tour: TourMarker | null;
```

`src/lib/shared/store.ts`:
- in `DEFAULT_SETTINGS`, add `tour: null,` after `welcomed: false,`;
- in `withDefaults`, add after the `rename:` line:

```ts
    tour: isObj(s.tour) && typeof s.tour.dir === 'string' ? (s.tour as Settings['tour']) : null,
```

`src/lib/shell/island.ts`:
- in `IslandEvent`, add `| { type: 'reset' }` after `| { type: 'clearTransient' }`;
- in `reduce`, add before the closing brace of the switch:

```ts
    case 'reset':
      return { ...INITIAL, update: s.update };
```

- [ ] **Step 4: The step list and pure helpers**

Replace `src/lib/tour/steps.ts` with:

```ts
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
const keywordGone = (v: TourView) =>
  filesGone(v) ?? (!v.batch && !v.reading && v.values < WITH_VALUE ? 'Type `Invoice No.:` again to find the numbers.' : null);

export const STEPS: TourStep[] = [
  { id: 'start', title: 'Try it out', text: "Let's rename five sample invoices. Nothing on your computer is touched. They live in a temporary folder.", done: 'card' },
  { id: 'drop', target: 'drop', text: 'Drag the sample files in here.', done: (v) => v.samples === SAMPLE_COUNT },
  { id: 'keyword', target: 'keyword', text: 'Type `Invoice No.:`, the label printed just before each number.', done: (v) => v.values >= WITH_VALUE && !v.reading, lost: filesGone },
  { id: 'position', target: 'position', text: 'The number comes after the label. Pick Below or Above when your invoices put it under or over it.', done: 'next', lost: keywordGone },
  { id: 'preview', target: 'preview', text: 'Every new name, before anything changes.', done: 'next', lost: keywordGone },
  { id: 'name', target: 'name-row', text: 'This invoice has no number, so Vellova asks you. Type a name for it, then press Enter.', done: (v) => v.named, lost: keywordGone },
  { id: 'pair', target: 'pair-row', text: 'The spreadsheet with the same number gets the same new name automatically.', done: 'next', lost: keywordGone },
  { id: 'apply', target: 'apply', text: 'Rename them.', done: (v) => !!v.batch && !v.busy, lost: keywordGone },
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
export const inSampleDir = (dir: string, path: string) => !!dir && pathKey(splitPath(path).dir) === pathKey(dir).replace(/\\+$/, '');

/** The profile the tour may delete: the selected one, but only if it didn't exist when the tour began. */
export const tourProfile = (profileId: string | null, beforeIds: string[]) => (profileId && !beforeIds.includes(profileId) ? profileId : null);

/** History and profiles without what the tour made. */
export function withoutTour(history: Batch[], profiles: RenameProfile[], m: TourMarker) {
  return {
    history: history.filter((b) => !m.batch || b.id !== m.batch),
    profiles: profiles.filter((p) => !m.profile || p.id !== m.profile),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/steps.test.ts test/island.test.ts test/store.test.ts`

Expected: PASS.

If a `splitPath` edge case breaks the slash-variant test, look at `src/lib/shared/names.ts` `splitPath`. It must split on both `\` and `/`. If it doesn't, normalise with `path.replace(/\//g, '\\')` inside `inSampleDir` before calling `splitPath`.

- [ ] **Step 6: The add filter in the Rename session**

In `src/lib/rename/session.svelte.ts`, replace `addPaths` with:

```ts
/** While set, only files it accepts can be added (the tour keeps the list to its samples). */
let addFilter: ((path: string) => boolean) | null = null;
export const setAddFilter = (f: ((path: string) => boolean) | null) => (addFilter = f);

export async function addPaths(paths: string[]) {
  if (!paths.length) return;
  const listed = await ipc.listFiles(paths, data.settings.rename.recursive);
  const keep = addFilter;
  session.files = mergeFiles(session.files, keep ? listed.filter((f) => keep(f.path)) : listed);
}
```

Drag-and-drop, Add files, Add folder and "Add them for me" all go through `addPaths`, so this one guard covers every route.

- [ ] **Step 7: The tour runtime**

Create `src/lib/tour/tour.svelte.ts`:

```ts
import { ui } from '../app.svelte';
import { pathKey } from '../rename/engine/files';
import { DEFAULT_RULES, type RenameRules } from '../rename/engine/profile';
import { addPaths, clearFiles, session, setAddFilter, whenIdle } from '../rename/session.svelte';
import { ipc } from '../shared/ipc';
import { join } from '../shared/names';
import { data, log, save } from '../shared/state.svelte';
import type { TourMarker } from '../shared/types';
import { island, send } from '../shell/islandState.svelte';
import { inSampleDir, NO_NUMBER, PAIRED, STEPS, tourProfile, withoutTour, type TourView } from './steps';

export const tour = $state({
  /** index in STEPS while the tour runs; -1 when it doesn't */
  step: -1,
  /** a card outside the steps */
  card: null as 'welcome' | 'resume' | null,
  /** this run's sample folder */
  dir: '',
  /** when the current step began (errors logged after it offer "Skip this step") */
  since: 0,
  /** why the samples couldn't be prepared */
  error: '',
});

/** What the Rename screen held before the tour, and which profiles already existed. */
let before: { rules: RenameRules; profileId: string | null; ids: string[] } | null = null;

export const tourActive = () => tour.step >= 0 || tour.card !== null;
export const current = () => (tour.step >= 0 ? STEPS[tour.step] : undefined);
/** The island keeps "done · Undo" open while the tour points at it. */
export const holdDone = () => current()?.id === 'undo';

const inDir = (path: string) => inSampleDir(tour.dir, path);

/** Marks the two sample rows the tour points at. */
export function tourRow(path: string): string | undefined {
  if (!tour.dir) return undefined;
  const k = pathKey(path);
  if (k === pathKey(join(tour.dir, NO_NUMBER))) return 'name-row';
  if (k === pathKey(join(tour.dir, PAIRED))) return 'pair-row';
  return undefined;
}

export function view(): TourView {
  const samples = session.files.filter((f) => inDir(f.path));
  const noNumber = samples.find((f) => tourRow(f.path) === 'name-row');
  const batch = session.batch;
  return {
    samples: samples.length,
    values: samples.filter((f) => session.values[f.path]?.ok).length,
    reading: session.loading || session.dirty,
    named: !!noNumber && !!session.overrides[noNumber.path]?.trim(),
    batch,
    busy: session.busy || !!island.activity,
    undone: !!batch && !!data.history.find((h) => h.id === batch)?.undone,
    profile: tourProfile(session.profileId, before?.ids ?? []),
    error: data.log.some((e) => e.t >= tour.since && e.level === 'error'),
  };
}

function go(i: number) {
  tour.step = i;
  tour.since = Date.now();
}

/** Opens the tour at its Start card. The Rename screen is cleared; what was on it comes back afterwards. */
export function startTour() {
  before = { rules: $state.snapshot(session.rules), profileId: session.profileId, ids: data.profiles.rename.map((p) => p.id) };
  clearFiles();
  session.rules = structuredClone(DEFAULT_RULES);
  session.profileId = null;
  ui.panel = null;
  ui.tool = 'rename';
  tour.card = null;
  tour.error = '';
  go(0);
}

/** The Start card's button: copies the samples, then points at the drop zone. */
export async function beginSamples() {
  tour.error = '';
  try {
    tour.dir = await ipc.tourPrepare();
  } catch (e) {
    tour.error = `The sample files couldn't be prepared: ${String(e).replace(/^[a-z]+: /, '')}`;
    return;
  }
  data.settings.tour = { dir: tour.dir, batch: null, profile: null };
  save('settings');
  setAddFilter(inDir);
  next();
}

export const addSamples = () => addPaths([tour.dir]);

/** Moves on. What the tour has made so far is written to the marker first. */
export function next() {
  const m = data.settings.tour;
  if (m) {
    m.batch = session.batch;
    m.profile = tourProfile(session.profileId, before?.ids ?? []);
    save('settings');
  }
  if (tour.step + 1 < STEPS.length) go(tour.step + 1);
  else void endTour();
}

/** Finish or Skip: everything the tour made goes, and the Rename screen is as it was. */
export async function endTour() {
  await whenIdle(); // a sample batch still renaming would otherwise come back into History after the cleanup
  // bring the marker up to date first (clearFiles resets session.batch), so a batch or profile made since the last Next goes too
  const now = data.settings.tour;
  if (now) {
    now.batch = session.batch;
    now.profile = tourProfile(session.profileId, before?.ids ?? []);
  }
  tour.step = -1;
  tour.card = null;
  ui.panel = null;
  setAddFilter(null);
  clearFiles();
  if (before) {
    session.rules = before.rules;
    session.profileId = before.profileId;
    before = null;
  }
  tour.dir = '';
  send({ type: 'reset' });
  const m = data.settings.tour;
  if (m) await cleanUp(m);
}

/** Removes the tour's batch, journals, profile and sample folder. The marker stays until all of it is gone. */
async function cleanUp(m: TourMarker) {
  const left = withoutTour(data.history, data.profiles.rename, m);
  data.history = left.history;
  data.profiles.rename = left.profiles;
  save('history');
  save('profiles');
  try {
    if (m.batch) await ipc.forgetBatch(m.batch);
    if (m.dir) await ipc.tourCleanup(m.dir);
    data.settings.tour = null;
  } catch (e) {
    log({ level: 'warn', tool: 'app', message: 'The tour sample files could not all be removed. Vellova tries again at the next start.', detail: String(e) });
  }
  save('settings');
}

/** At start, after recovery: a tour that a closed app left behind is cleaned up, then offered again once. */
export async function tourOnStart() {
  const m = data.settings.tour;
  if (!m) return;
  await cleanUp(m);
  if (!data.settings.tour && !tourActive()) tour.card = 'resume';
}
```

- [ ] **Step 8: Run everything**

Run: `npx vitest run` and `npm run check`

Expected: all pass, 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/shared/types.ts src/lib/shared/store.ts src/lib/shell/island.ts src/lib/rename/session.svelte.ts src/lib/tour test/steps.test.ts test/island.test.ts test/store.test.ts
git commit -F- <<'EOF'
feat: tour steps, marker and cleanup that removes only what the tour made

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 3: Tour UI, Welcome card and wiring

**Files:**
- Create: `src/lib/tour/Tour.svelte`, `src/lib/tour/Welcome.svelte`
- Delete: `src/lib/panels/Welcome.svelte`
- Modify:
  - `src/App.svelte`, `src/lib/app.svelte.ts`, `src/main.ts`, `src/app.css`
  - `src/lib/shell/Island.svelte`, `src/lib/shell/TitleBar.svelte`
  - `src/lib/rename/Rename.svelte`, `src/lib/rename/DropZone.svelte`, `src/lib/rename/RenameSettings.svelte`, `src/lib/rename/Preview.svelte`
  - `src/lib/panels/Settings.svelte`

**Interfaces:**
- Consumes: everything Task 2 produces from `tour.svelte.ts` and `steps.ts`; `findOldData` and `importOldData(withSettings: boolean)` from `migrate/run`; `motion` from `shell/theme`; `revealItemInDir` from `@tauri-apps/plugin-opener`.
- Produces: `data-tour` ids on the real controls. `Tour.svelte` looks for exactly these:

  | `data-tour` id | Element |
  |---|---|
  | `drop` | the DropZone root |
  | `keyword` | the keyword input |
  | `position` | the position buttons |
  | `preview` | the preview list |
  | `name-row` | the preview row of the PDF with no number |
  | `pair-row` | the preview row of the matching spreadsheet |
  | `apply` | the footer Apply button |
  | `undo` | the Undo button in the island's "done" layer |
  | `profile` | the profile card |
  | `tools` | the island's Rename/Split buttons |
  | `history` | the island History button |
  | `profiles` | the island Profiles button |
  | `settings` | the island Settings button |
  | `theme` | the island theme switch |

  Elements marked `data-tour-free` stay clickable during the tour; these are the window controls.

- [ ] **Step 1: Veil token**

In `src/app.css`, add `--veil: rgba(5, 7, 10, 0.62);` to the dark block, after `--sheen: …;`. Add `--veil: rgba(16, 24, 40, 0.45);` to the light block, after its `--sheen`.

- [ ] **Step 2: The Welcome card body**

Create `src/lib/tour/Welcome.svelte`. It is the old panel's content with the approved wording and two new buttons.

```svelte
<script lang="ts">
  import { tick } from 'svelte';
  import { findOldData, importOldData } from '../migrate/run';

  let { onstart, onskip }: { onstart: () => void; onskip: () => void } = $props();
  let found = $state(false);
  let later = $state(false);
  let busy = $state(false);
  let result = $state('');
  let start = $state<HTMLButtonElement>();

  $effect(() => {
    findOldData().then((f) => (found = f), () => (found = false));
  });

  async function bring() {
    busy = true;
    result = await importOldData(true).catch((e) => `The import failed: ${String(e).replace(/^[a-z]+: /, '')}`);
    busy = false;
    await tick();
    start?.focus(); // the Import button is gone: keep focus inside the card
  }
</script>

<h2 id="tour-title">Welcome to Vellova</h2>
<p>
  Vellova renames files in batches, for example using an invoice number printed in a PDF, with matching spreadsheets renamed along
  with it. Renaming any file type by your own rules is coming in the next updates, along with splitting spreadsheets.
</p>
<p class="hint">Everything stays on this computer. Every batch can be undone from History.</p>

{#if found && !later}
  <div class="card">
    <h3>Bring your earlier setup</h3>
    <p class="hint">Profiles, history and settings from your previous renaming app are on this computer. The old app keeps its own copy.</p>
    {#if result}
      <p role="status">{result}</p>
    {:else}
      <div class="row">
        <button class="btn" disabled={busy} onclick={bring}>Import</button>
        <button class="btn" onclick={() => (later = true)}>Not now</button>
      </div>
    {/if}
  </div>
{/if}

<div class="row">
  <button class="btn primary" data-first bind:this={start} onclick={onstart}>Try it with sample files</button>
  <button class="btn" onclick={onskip}>Skip</button>
</div>
```

Delete `src/lib/panels/Welcome.svelte`.

- [ ] **Step 3: The tour layer**

Create `src/lib/tour/Tour.svelte`:

```svelte
<script lang="ts">
  import { revealItemInDir } from '@tauri-apps/plugin-opener';
  import { tick } from 'svelte';
  import { scale } from 'svelte/transition';
  import { join } from '../shared/names';
  import { data, save } from '../shared/state.svelte';
  import { motion } from '../shell/theme';
  import { counted, FIRST_SAMPLE, STEPS } from './steps';
  import { addSamples, beginSamples, endTour, next, startTour, tour, view } from './tour.svelte';
  import Welcome from './Welcome.svelte';

  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';
  const PAD = 6;
  const BUBBLE = 340;

  let vw = $state(innerWidth);
  let vh = $state(innerHeight);
  let rect = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let stuck = $state(false);
  let confirm = $state(false);
  let box = $state<HTMLElement>(); // the card or the hint bubble

  const step = $derived(tour.step >= 0 ? STEPS[tour.step] : undefined);
  const card = $derived(tour.card ?? (step && !step.target ? step.id : null));
  const on = $derived(tour.card !== null || tour.step >= 0);
  const v = $derived(view());
  const lost = $derived(step?.lost?.(v) ?? null);
  const n = $derived(step ? counted.indexOf(step) + 1 : 0);
  const below = $derived(!rect || rect.y + rect.h + 190 < vh);
  const bubbleLeft = $derived(rect ? Math.min(Math.max(rect.x + rect.w / 2 - BUBBLE / 2, 16), vw - BUBBLE - 16) : vw / 2 - BUBBLE / 2);
  const bubbleTop = $derived(!rect ? vh / 2 : below ? rect.y + rect.h + PAD + 40 : rect.y - PAD - 40);

  const target = () => (step?.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null);

  // a step that waits for something ends when it happens
  $effect(() => {
    if (step && typeof step.done === 'function' && step.done(v)) next();
  });

  // ponytail: follows the target with one rect read per frame instead of Resize/Mutation/scroll observers
  $effect(() => {
    const id = step?.target;
    if (!id || card) {
      rect = null;
      stuck = false;
      return;
    }
    const since = performance.now();
    let raf = 0;
    const loop = () => {
      const el = target();
      const seen = !!el && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      const r = seen ? el!.getBoundingClientRect() : null;
      if (!r) rect = null;
      else if (!rect || rect.x !== r.x || rect.y !== r.y || rect.w !== r.width || rect.h !== r.height) rect = { x: r.x, y: r.y, w: r.width, h: r.height };
      stuck = !seen && performance.now() - since > 5000;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  });

  // each step starts with the focus where the user acts: Next, or the target itself
  $effect(() => {
    void tour.step;
    void tour.card;
    confirm = false;
    void tick().then(() => {
      const t = target();
      const into = card || step?.done === 'next' || !t
        ? box?.querySelector<HTMLElement>('[data-first], .primary')
        : t.matches(FOCUSABLE) ? t : t.querySelector<HTMLElement>(FOCUSABLE);
      into?.focus();
    });
  });

  /** Clicks reach only the card or bubble, the target, the window controls and the drag region itself. */
  function allowed(t: EventTarget | null): boolean {
    if (!(t instanceof Element)) return false;
    if (box?.contains(t) || t.closest('[data-tour-free]') || t.hasAttribute('data-tauri-drag-region')) return true;
    const tg = card ? null : target();
    return !!tg && tg.contains(t);
  }

  function cycle(back: boolean) {
    const tg = card ? null : target();
    const own = tg ? (tg.matches(FOCUSABLE) ? [tg] : [...tg.querySelectorAll<HTMLElement>(FOCUSABLE)]) : [];
    const items = [...own, ...(box ? box.querySelectorAll<HTMLElement>(FOCUSABLE) : [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[i < 0 ? 0 : (i + (back ? -1 : 1) + items.length) % items.length].focus();
  }

  function welcomed() {
    data.settings.welcomed = true;
    save('settings');
  }
  function tryIt() {
    welcomed();
    startTour();
  }
  function skipWelcome() {
    welcomed();
    tour.card = null;
  }
  function escape() {
    if (tour.card === 'welcome') skipWelcome();
    else if (tour.card === 'resume') tour.card = null;
    else confirm = !confirm;
  }

  $effect(() => {
    if (!on) return;
    const block = (e: Event) => {
      if (!allowed(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Tab') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') escape();
      else cycle(e.shiftKey);
    };
    const kinds = ['pointerdown', 'mousedown', 'click', 'dblclick', 'auxclick', 'contextmenu'];
    kinds.forEach((k) => addEventListener(k, block, true));
    addEventListener('keydown', key, true);
    return () => {
      kinds.forEach((k) => removeEventListener(k, block, true));
      removeEventListener('keydown', key, true);
    };
  });
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

{#snippet rich(text: string)}{#each text.split('`') as part, i (i)}{#if i % 2}<code class="mono">{part}</code>{:else}{part}{/if}{/each}{/snippet}

{#if on}
  <div class="tour">
    {#if card}
      <div class="blur" aria-hidden="true"></div>
      <div class="tcard" role="dialog" aria-modal="true" aria-labelledby="tour-title" bind:this={box} transition:scale={{ start: 0.96, duration: motion(220) }}>
        {#if card === 'welcome'}
          <Welcome onstart={tryIt} onskip={skipWelcome} />
        {:else if card === 'resume'}
          <h2 id="tour-title">Resume the tour?</h2>
          <p>The tour stopped when Vellova closed. Its sample files were cleaned up.</p>
          <div class="row">
            <button class="btn primary" onclick={startTour}>Resume</button>
            <button class="btn" onclick={() => (tour.card = null)}>No thanks</button>
          </div>
        {:else if step}
          <h2 id="tour-title">{step.title}</h2>
          <p>{@render rich(step.text)}</p>
          {#if tour.error}<p class="err" role="alert">{tour.error}</p>{/if}
          <div class="row">
            {#if step.id === 'start'}
              <button class="btn primary" onclick={() => void beginSamples()}>Start</button>
              <button class="btn" onclick={() => void endTour()}>Skip tour</button>
            {:else}
              <button class="btn primary" onclick={() => void endTour()}>Finish</button>
            {/if}
          </div>
        {/if}
      </div>
    {:else if step}
      <svg class="veil" aria-hidden="true" width={vw} height={vh}>
        <defs>
          <mask id="tour-hole">
            <rect width={vw} height={vh} fill="white" />
            {#if rect}
              <rect class="hole" rx="12" fill="black" style:x="{rect.x - PAD}px" style:y="{rect.y - PAD}px" style:width="{rect.w + PAD * 2}px" style:height="{rect.h + PAD * 2}px" />
            {/if}
          </mask>
        </defs>
        <rect width={vw} height={vh} fill="var(--veil)" mask="url(#tour-hole)" />
      </svg>
      {#if rect}
        <div class="ring" aria-hidden="true" style:left="{rect.x - PAD}px" style:top="{rect.y - PAD}px" style:width="{rect.w + PAD * 2}px" style:height="{rect.h + PAD * 2}px"></div>
        <svg class="arrow" class:flip={!below} aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" style:left="{rect.x + rect.w / 2 - 12}px" style:top="{below ? rect.y + rect.h + PAD + 8 : rect.y - PAD - 32}px">
          <path d="M12 20V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      {/if}
      <div class="bubble" class:above={!below} role="dialog" aria-label="Tour, step {n} of {counted.length}" bind:this={box} style:left="{bubbleLeft}px" style:top="{bubbleTop}px" style:width="{BUBBLE}px">
        {#if lost}<p class="lost">{@render rich(lost)}</p>{/if}
        <p aria-live="polite">{@render rich(step.text)}</p>
        {#if step.id === 'drop' || (lost && v.samples === 0)}
          <div class="row">
            <button class="btn small" onclick={() => void revealItemInDir(join(tour.dir, FIRST_SAMPLE))}>Open the folder</button>
            <button class="btn small" onclick={() => void addSamples()}>Add them for me</button>
          </div>
        {/if}
        <div class="row">
          {#if confirm}
            <span class="q">Skip the tour?</span>
            <span class="grow"></span>
            <button class="btn small" onclick={() => (confirm = false)}>Keep going</button>
            <button class="btn small primary" onclick={() => void endTour()}>Skip</button>
          {:else}
            <span class="count">{n} of {counted.length}</span>
            <span class="grow"></span>
            <button class="btn small" onclick={() => (confirm = true)}>Skip tour</button>
            {#if stuck || v.error}<button class="btn small" onclick={next}>Skip this step</button>{/if}
            {#if step.done === 'next'}<button class="btn small primary" onclick={next}>Next</button>{/if}
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .tour { position: fixed; inset: 0; z-index: 1000; pointer-events: none; }
  .blur { position: absolute; inset: 0; background: var(--veil); backdrop-filter: blur(6px); }
  .veil { position: absolute; left: 0; top: 0; }
  .hole { transition: x 300ms ease-out, y 300ms ease-out, width 300ms ease-out, height 300ms ease-out; }
  .ring {
    position: absolute; border-radius: 12px; box-shadow: 0 0 0 2px var(--accent), 0 0 10px 2px var(--soft);
    animation: ring 1.6s ease-in-out infinite; transition: left 300ms ease-out, top 300ms ease-out, width 300ms ease-out, height 300ms ease-out;
  }
  .arrow { position: absolute; color: var(--accent); animation: bob 1.2s ease-in-out infinite; transition: left 300ms ease-out, top 300ms ease-out; }
  .arrow.flip { rotate: 180deg; animation-name: bobdown; }
  .tcard, .bubble {
    position: absolute; pointer-events: auto; display: flex; flex-direction: column; gap: 12px;
    background: var(--surface); border: 1px solid var(--border2); border-radius: 14px; box-shadow: var(--shadow);
  }
  .tcard { left: 50%; top: 50%; translate: -50% -50%; width: min(540px, 100vw - 48px); padding: 24px 26px; }
  .tcard :global(h2) { font-size: 20px; }
  .bubble { padding: 14px 16px; gap: 10px; transition: left 300ms ease-out, top 300ms ease-out; }
  .bubble.above { translate: 0 -100%; }
  p { margin: 0; }
  code { padding: 1px 5px; border-radius: 5px; background: var(--soft); color: var(--accent); font-size: 0.95em; }
  .lost { color: var(--warnink); }
  .err { color: var(--errink); }
  .count, .q { font-size: 12.5px; color: var(--text2); font-variant-numeric: tabular-nums; }
  .grow { flex: 1; }
  @keyframes ring {
    0%, 100% { box-shadow: 0 0 0 2px var(--accent), 0 0 10px 2px var(--soft); }
    50% { box-shadow: 0 0 0 3px var(--accent), 0 0 26px 8px var(--soft); }
  }
  @keyframes bob { 0%, 100% { translate: 0 0; } 50% { translate: 0 -6px; } }
  @keyframes bobdown { 0%, 100% { translate: 0 0; } 50% { translate: 0 6px; } }
  @media (prefers-reduced-motion: reduce) {
    .ring, .arrow { animation: none; }
    .hole, .ring, .arrow, .bubble { transition: none; }
  }
</style>
```

- [ ] **Step 4: Wire App, panels, main and Settings**

`src/lib/app.svelte.ts`:
- `PanelName` becomes `'history' | 'profiles' | 'settings' | 'attention'`;
- remove the `welcome:` line from `PANEL_TITLES`.

`src/App.svelte`:
- Remove the `Welcome` import, and `save` from the state import (keep `data`).
- Add:
  ```ts
  import Tour from './lib/tour/Tour.svelte';
  import { tour, tourActive } from './lib/tour/tour.svelte';
  ```
- Replace `if (!data.settings.welcomed) ui.panel = 'welcome';` with `if (!data.settings.welcomed) tour.card = 'welcome';`.
- Replace the whole `closePanel` function with `const closePanel = () => (ui.panel = null);`.
- Make the first line of `onkeydown` `if (tourActive()) return;`.
- In the panel block, delete `{:else if ui.panel === 'attention'}<NeedsAttention />` and change `{:else}<Welcome onclose={closePanel} />{/if}` to `{:else}<NeedsAttention />{/if}`.
- Add `<Tour />` on the line after the panel block's closing `{/if}`, still inside `<div class="app">`.

`src/main.ts`:
- add `import { tourOnStart } from './lib/tour/tour.svelte';`;
- append `.finally(() => void tourOnStart())` to the end of the `ipc.recoverAll()…catch(…)` chain, before its semicolon.

`src/lib/panels/Settings.svelte`:
- add `import { startTour } from '../tour/tour.svelte';`;
- add after the About section:

```svelte
<section class="card">
  <h3>Help</h3>
  <div class="row"><button class="btn small" onclick={startTour}>Show the tour again</button></div>
</section>
```

Run: `grep -rn "'welcome'" src`

Expected: only matches in `src/lib/tour/`.

- [ ] **Step 5: Mark the targets**

Make each edit with the Edit tool. Each is one exact string replaced.

`src/lib/rename/DropZone.svelte`: `<div class="drop">` → `<div class="drop" data-tour="drop">`

`src/lib/rename/RenameSettings.svelte`:
- `<input id="rn-kw" class="field mono"` → `<input id="rn-kw" data-tour="keyword" class="field mono"`
- `<div class="seg" role="group" aria-labelledby="rn-pos">` → `<div class="seg" role="group" aria-labelledby="rn-pos" data-tour="position">`
- the first `<div class="card">` (the one holding `rn-profile`) → `<div class="card" data-tour="profile">`. Match it together with the next line, `<label class="label" for="rn-profile">Profile</label>`, so the replacement is unique.

`src/lib/rename/Preview.svelte`:
- add `import { tourRow } from '../tour/tour.svelte';` to the script;
- `<ul>` → `<ul data-tour="preview">`
- `<li class:dim={it.status === 'skipped' || it.status === 'unchanged'}>` → `<li class:dim={it.status === 'skipped' || it.status === 'unchanged'} data-tour={tourRow(it.source)}>`

`src/lib/rename/Rename.svelte`: `<button class="btn primary" disabled={!sum.ops` → `<button class="btn primary" data-tour="apply" disabled={!sum.ops`

`src/lib/shell/TitleBar.svelte`: `<div class="win">` → `<div class="win" data-tour-free>`

`src/lib/shell/Island.svelte`:
- `<div class="tools" role="group" aria-label="Tool">` → `<div class="tools" role="group" aria-label="Tool" data-tour="tools">`
- `<button class="ib" aria-label="History"` → `<button class="ib" data-tour="history" aria-label="History"`
- `<button class="ib" aria-label="Profiles"` → `<button class="ib" data-tour="profiles" aria-label="Profiles"`
- `<button class="ib" aria-label="Settings"` → `<button class="ib" data-tour="settings" aria-label="Settings"`
- `<button class="ib theme"` → `<button class="ib theme" data-tour="theme"`
- `<button class="act" onclick={onundo}>Undo</button>` → `<button class="act" data-tour="undo" onclick={onundo}>Undo</button>`
- add `import { holdDone } from '../tour/tour.svelte';` to the script;
- in the timeout effect, change `if (!ms) return;` to `if (!ms || (active === 'done' && holdDone())) return;`

- [ ] **Step 6: Check, test and build**

Run: `npx vitest run && npm run check && npm run build`

Expected: all pass, 0 errors, and the build succeeds.

- [ ] **Step 7: Walk the tour in the dev app (synthetic samples only)**

Start `npm run tauri dev` in the background. Open the tour with Settings → **Show the tour again**. Don't delete or edit `%APPDATA%\com.vslnnd.vellova`, and don't click Import. Drive it with `node scripts/cdp.mjs eval "…"`, clicking with `document.querySelector(…).click()` and typing with `__rename.session.rules.keyword = 'Invoice No.:'`. Take a screenshot with `node scripts/cdp.mjs shot` at the Start card, the drop step, the name step, the undo step and an island step. Look at each, then delete it.

Check:
1. Start → the drop step shows the cut-out around the drop zone, the pulsing ring, the arrow and the bubble ("1 of 14").
2. "Add them for me" adds exactly 6 files.
3. Blocking: on the drop step, run `document.querySelector('[data-tour="history"]').click()`. A synthetic click still passes the capture listener, so it must be blocked. Then `document.querySelector('[aria-labelledby="panel-title"]')` must be `null`, because no panel opened.
4. Run `__rename.addPaths(['C:\\Windows\\win.ini'])`. `session.files.length` must stay 6.
5. Set the keyword → the name step → set a name through the row input and dispatch `change` → the pair step → Next → Apply → the undo step. The island stays on "done · Undo" longer than 4 s. Undo → the profile step → save a profile named `Tour test` → the island hops → Done → Finish.
6. Check that History no longer has the sample batch and Profiles no longer has `Tour test`. `%TEMP%` has no `vellova-tour-*` folder (`ls "$TEMP" | grep vellova-tour`). The Rename rules are back to what they were.
7. Run the tour again to the apply step, then kill `vellova.exe` and start dev again. The "Resume the tour?" card appears, and no `vellova-tour-*` folder or sample batch is left.
8. Run the tour again and press Esc. "Skip the tour?" appears. Choose Skip, and everything is cleaned up.

Stop the app (kill `vellova.exe` and the dev server).

- [ ] **Step 8: Commit**

```bash
git add -A src
git commit -F- <<'EOF'
feat: welcome card and hands-on first-run tour with spotlight, ring and arrow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```
