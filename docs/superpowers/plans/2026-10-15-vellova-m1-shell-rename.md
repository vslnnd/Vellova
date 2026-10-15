# Vellova Milestone 1 (Shell + Rename at 1.4.6 Parity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Vellova 0.1.0, a Tauri 2 Windows app with the title-bar island, themes, the five panels and a Rename tool whose PDF values match Nomina 1.4.6 exactly. It adds undo, Nomina import, auto-update and a CI-built unsigned installer.

**Architecture:** A Svelte 5 + TypeScript front end (Vite) whose pure, unit-tested engines (`src/lib/rename/engine/`) turn files plus settings into a Plan of operations. A small Rust module (`src-tauri/src/ops.rs`) executes the Plan with a per-batch journal, two-phase renames, Recycle Bin replace and undo. Text extraction uses pdf.js **3.11.174**, the exact version 1.4.6 used, which parses in its own worker. SheetJS reads companion files in a Web Worker.

**Tech Stack:** Tauri 2.12 (Rust 1.97; plugins dialog, opener, process, updater, single-instance, window-state), Svelte 5.57, Vite 8.3, Vitest 5, TypeScript 6, pdfjs-dist 3.11.174, SheetJS 0.20.3, trash 5, Fontsource Geist / Geist Mono, pdf-lib 1.17.1 (fixtures only).

**Spec:** `docs/superpowers/specs/2026-10-15-vellova-design.md`

### Where this plan departs from the spec (on purpose)

1. **pdf.js 3.11.174 is pinned from day one.** The spec treated this as the fallback. Before writing the plan I checked that 3.11.174 returns identical items in Node (legacy build), Node (browser build) and headless Chromium (the Vite bundle). Parity is therefore guaranteed by construction, and the words-layer normalization is dropped. `isEvalSupported: false` plus a CSP without `unsafe-eval` closes CVE-2024-4367.
2. **No `fs` plugin.** Small Rust commands do all file I/O, which keeps the surface narrow.
3. **No `workers/pdf.worker.ts`.** pdf.js already parses in its own worker, and the value finder runs in microseconds on the main thread.
4. **M1 Rust commands:**
   - `apply_plan`, `undo_batch`, `recover_all`, `cancel_apply`
   - `read_file`, `list_files`, `list_dir`
   - `data_*`, `read_legacy`, `save_text`

   The Recycle Bin is used inside apply/undo instead of through a separate `to_recycle_bin` command. `archive_files` belongs to M2.
5. **M1 op kinds are `rename` and `copy`.** `move` arrives in M3 with Sort into folders; `write` and `archive` arrive in M2.
6. **Needs attention → "Target name exists" offers Retry · Skip.** The planner already applies the batch's Add (1) / Skip / Replace choice, so this reason only appears when a file shows up between preview and apply.
7. **Fixtures use whatever browser is available.** Edge isn't installed on this machine, so the fixture printer uses the first of Edge, Chrome or the Playwright headless shell it finds. `html-print.pdf` is committed, so CI never needs a browser.
8. **A duplicate value is not *attention*.** As in 1.4.6, it gets ` (1)`, ` (2)` automatically and shows a *Duplicate* pill, and the preview row's name is editable. So the Errors table's "Same value as another file" row needs no panel actions.

## Global Constraints

- Windows 10/11 only. Tauri 2 on WebView2. NSIS per-user installer (`installMode: "currentUser"`). Identifier `com.vslnnd.vellova`; data in `%APPDATA%\com.vslnnd.vellova\`.
- Installer under 15 MB; cold start under 1 s; fully usable offline. No network fonts, icons or scripts: fonts are bundled through Fontsource and icons are inline SVG.
- The old app names (Nomina, Splitify) never appear in the UI.
- No operation deletes a user file. A replaced file goes to the Recycle Bin. Every batch can be undone from History while its files are unchanged.
- No code signing and no paid services. The updater uses a free, self-generated key pair.
- Never use real client files. Tests use synthetic fixtures. `test/fixtures-private/` is git-ignored. The compare script prints only counts and anonymous structure statistics.
- Fits 1366×768 at 125% scaling (minimum window 900×600). Usable with the keyboard only. Text contrast at least 4.5:1.
- **Tokens:**

  | Token | Dark | Light |
  |---|---|---|
  | bg | `#0F1115` | `#F5F6F8` |
  | chrome | `#0B0D10` | `#ECEEF2` |
  | surface | `#161920` | `#FFFFFF` |
  | surface2 / cap | `#1E222A` | `#F0F2F5` / `#FFFFFF` |
  | border / border2 | `#2A2F39` / `#3A404C` | `#D8DCE3` / `#B9C0CB` |
  | text / text2 / text3 | `#E9ECF1` / `#AEB5C1` / `#8B93A1` | `#12151B` / `#474E5A` / `#5E6673` |
  | accent / on-accent | `#7AA7FF` / `#0A1430` | `#1D5BD8` / `#FFFFFF` |
  | ok / warn / err | `#5BC995` / `#F0B84D` / `#FF8A8A` | `#13784A` / `#8F5B00` / `#BF2A2A` |

  Radius 6 for controls, 8 for panels, 999 for the island and pills. Geist for UI text, Geist Mono for file names and values. The theme defaults to `system`.
- **Motion and island behaviour:**
  - The island width morph and content crossfade take ~440 ms on `cubic-bezier(0.34, 1.32, 0.64, 1)`. The tool pill slides in ~300 ms. Hover and press take 150–200 ms.
  - Done collapses after 4 s. Attention shakes once, glows 3 times, and collapses after 6 s. Update ready collapses after 3.5 s, and its chip nudges 3 times.
  - Priority: working > attention > done > update. Chip order: attention, undo, update.
  - `prefers-reduced-motion` turns every animation into a ≤1 ms change or a fade.
- **Keyboard:** Ctrl+1 / Ctrl+2 switch tools. Ctrl+Z undoes the last batch when focus is not in a text field. Esc closes panels. Every island control is reachable with Tab.
- No animation library. Never add a dependency for what a few lines do.
- **The Rename engine is Nomina 1.4.6, rule for rule:**
  - `LINE_TOL = 8`; three keyword passes; no fallbacks.
  - `sanitize` replaces `\ / : * ? " < > |` (plus control characters) with `_` and trims. Reserved device names get a `_` suffix.
  - Extensions are lower-cased.
  - Duplicates get ` (1)`, ` (2)` in list order.
- All JSON writes are atomic (temp file, then rename). A corrupt file is renamed `*.corrupt-<date>.json`, and the app starts with defaults.
- Every commit message ends with these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
  ```
- Never push, and never create the GitHub repo, without the user's explicit OK. Steps marked **USER STEP** need a person.
- Shell: commands are written for Git Bash on Windows (`<repo>`). Run everything from the repo root.

## Review Focus

1. **A PDF that is open in Acrobat (locked) in the middle of a batch, including inside a swap.** Expected: that file gets *locked* and keeps its name; every other file still renames; no `.~vellova-*.tmp` file is left behind. → Task 5, test `locked_file_fails_alone_and_keeps_its_name`.
2. **Extracted values that Windows can't use as names.** This covers characters like `/ : * ?`, reserved names (`CON`), and values that differ only by letter case (`inv-17` / `INV-17`). Expected: valid, unique names (`_`, ` (1)`), never a failed rename. → Task 3 (`sanitize` tests) and Task 9 (test `values that differ only by letter case still get unique names`).
3. **Corrupt, empty or password-protected PDFs in the batch.** Expected: *unreadable* with a plain message; the rest of the batch is unaffected. → Task 6 (`classifyPdfError` tests) and Task 7 (`broken.pdf` / `empty.pdf` tests).
4. **The app is killed between the two rename phases, or Undo is pressed twice.** Expected: leftover temporary files go back to their original names at the next start, and a second Undo is harmless. → Task 5, tests `recover_puts_back_files_left_mid_batch` and `undo_skips_changed_files_and_is_repeatable`.
5. **The same file added twice.** This happens when a file is dropped directly and via its folder, or with different letter case or slashes. Expected: it is listed once. → Task 9, `mergeFiles` tests.

---

## File map

```
package.json, vite.config.ts, svelte.config.js, tsconfig.json, index.html, .gitignore, app-icon.svg, README.md
.github/workflows/release.yml                    CI: test, build, publish release + latest.json
src/
  main.ts                                        boot: fonts, CSS, load data, theme, mount, show window
  app.css                                        tokens (both themes), base controls, reduced motion
  App.svelte                                     shell: title bar, screens, panels, shortcuts, updater wiring
  lib/app.svelte.ts                              ui state: tool, open panel, resolved theme
  lib/updater.ts                                 check → download → island "Update ready" → install + relaunch
  lib/shell/theme.ts                             resolve/apply theme, View Transition circle reveal, motion()
  lib/shell/island.ts                            pure island reducer: layers, chips, priority, timings
  lib/shell/island.svelte.ts                     island state + send()
  lib/shell/Island.svelte, TitleBar.svelte, Panel.svelte
  lib/shell/shortcuts.ts                         key → action
  lib/shared/types.ts                            Plan, Op, Reason, profiles, history, settings types
  lib/shared/names.ts                            path split/join, extension, sanitize
  lib/shared/ipc.ts                              typed invoke wrappers + error → reason
  lib/shared/store.ts                            pure: defaults, loadJson, log pruning, history merge
  lib/shared/state.svelte.ts                     settings/profiles/history/log state, debounced atomic saves
  lib/shared/batches.ts                          record batch, undo batch, undo last
  lib/rename/engine/pdfItems.ts                  pdf.js page → items (1.4.6), error classification
  lib/rename/engine/findValue.ts                 the 1.4.6 keyword/position finder (+ occurrence)
  lib/rename/engine/companion.ts                 .xlsx/.csv cells, .txt/.xml text (worker side, SheetJS)
  lib/rename/engine/pairing.ts                   companion → PDF, first PDF in list order wins
  lib/rename/engine/files.ts                     supported extensions, mergeFiles
  lib/rename/engine/profile.ts                   RenameRules ⇄ RenameProfile steps
  lib/rename/engine/planner.ts                   planRename + summary
  lib/rename/pdf.ts, companions.ts               browser glue: pdf.js worker, sheet worker client
  lib/rename/session.svelte.ts                   Rename screen state, refresh, runBatch, fixes
  lib/rename/Rename.svelte, RenameSettings.svelte, Preview.svelte, DropZone.svelte
  lib/split/Split.svelte                         "coming next" screen
  lib/panels/History.svelte, Profiles.svelte, Settings.svelte, NeedsAttention.svelte, Welcome.svelte
  lib/migrate/nomina.ts                          old profiles/history/settings → Vellova (pure)
  lib/migrate/run.ts                             read the old files and merge them into the live data
  workers/sheet.worker.ts
src-tauri/
  Cargo.toml, build.rs, tauri.conf.json, capabilities/default.json, icons/
  src/main.rs, src/lib.rs                        app + plugins + command list
  src/files.rs                                   commands: data, legacy, file listing/reading, apply/undo glue
  src/ops.rs                                     journal, two-phase apply, undo, recovery (+ tests)
scripts/
  cdp.mjs                                        dev helper: eval/screenshot the running WebView2
  make-fixtures.mjs, fixtures/invoice.html       synthetic PDFs + companions + cases.json
  golden-146.mjs                                 verbatim 1.4.6 engine → test/fixtures/golden-146.json
  compare.mjs                                    private: 1.4.6 vs Vellova on a real folder, counts only
test/
  *.test.ts, golden-helpers.ts
  fixtures/                                      generated, committed
  fixtures-private/                              git-ignored, never committed
```

---

### Task 1: Scaffold Tauri 2 + Svelte 5 + Vite + Vitest

**Files:**
- Create: `package.json`, `vite.config.ts`, `svelte.config.js`, `tsconfig.json`, `index.html`, `.gitignore`, `app-icon.svg`, `src/main.ts`, `src/App.svelte`, `scripts/cdp.mjs`, `test/setup.test.ts`
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/icons/*` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - npm scripts `dev`, `build`, `check`, `test`, `tauri`, `fixtures`, `compare`.
  - The window labelled `main` starts hidden (`visible: false`); `src/main.ts` shows it after mounting.
  - Rust crate `vellova_lib` with `pub fn run()`.
  - `node scripts/cdp.mjs eval "<js>" | shot <file.png>` against a dev app started with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`.

- [ ] **Step 1: Write the front-end config files**

`package.json`:

```json
{
  "name": "vellova",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run",
    "tauri": "tauri",
    "fixtures": "node scripts/make-fixtures.mjs && node scripts/golden-146.mjs",
    "compare": "node scripts/compare.mjs"
  },
  "dependencies": {
    "@fontsource-variable/geist": "^5.3.0",
    "@fontsource-variable/geist-mono": "^5.3.0",
    "@tauri-apps/api": "~2.12.4",
    "@tauri-apps/plugin-dialog": "~2.8.3",
    "@tauri-apps/plugin-opener": "~2.7.2",
    "@tauri-apps/plugin-process": "~2.4.0",
    "pdfjs-dist": "3.11.174",
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^7.3.1",
    "@tauri-apps/cli": "~2.12.3",
    "@types/node": "^24.19.2",
    "pdf-lib": "1.17.1",
    "svelte": "^5.57.2",
    "svelte-check": "^4.7.6",
    "typescript": "~6.0.3",
    "vite": "^8.3.4",
    "vitest": "^5.0.4"
  }
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'chrome120', chunkSizeWarningLimit: 2500 },
  worker: { format: 'es' },
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 20000 },
});
```

`svelte.config.js`:

```js
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default { preprocess: vitePreprocess() };
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "node"],
    "strict": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "src/**/*.svelte", "test/**/*.ts", "vite.config.ts"]
}
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vellova</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`.gitignore`:

```
node_modules/
dist/
src-tauri/target/
src-tauri/gen/schemas/
test/fixtures-private/
*.log
.claude/
```

`app-icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="224" fill="#1D5BD8"/><path d="M300 330l212 364 212-364" fill="none" stroke="#fff" stroke-width="92" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

`src/main.ts`:

```ts
import { mount } from 'svelte';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
void getCurrentWindow().show();
```

`src/App.svelte`:

```svelte
<h1>Vellova</h1>
```

- [ ] **Step 2: Write the Tauri side**

`src-tauri/Cargo.toml`:

```toml
[package]
name = "vellova"
version = "0.1.0"
description = "Rename and split office files in batches"
authors = ["vslnnd"]
edition = "2021"

[lib]
name = "vellova_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.7", features = [] }

[dependencies]
tauri = { version = "2.12", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri-plugin-dialog = "2.8"
tauri-plugin-opener = "2.7"
tauri-plugin-process = "2.4"
tauri-plugin-single-instance = "2.5"
tauri-plugin-window-state = "2.5"

[profile.release]
codegen-units = 1
lto = true
opt-level = "s"
panic = "abort"
strip = true
```

`src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

`src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vellova_lib::run()
}
```

`src-tauri/src/lib.rs`:

```rust
use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // must be first: a second launch focuses the running window instead
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        // the front end shows the window after its first paint, so don't restore visibility
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .run(tauri::generate_context!())
        .expect("error while running Vellova");
}
```

`src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Vellova",
  "version": "../package.json",
  "identifier": "com.vslnnd.vellova",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Vellova",
        "width": 1180,
        "height": 760,
        "minWidth": 900,
        "minHeight": 600,
        "center": true,
        "decorations": false,
        "visible": false
      }
    ],
    "security": {
      "csp": "default-src 'self' ipc: http://ipc.localhost; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:",
      "dangerousDisableAssetCspModification": ["style-src"]
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"],
    "windows": { "nsis": { "installMode": "currentUser" } }
  }
}
```

(`dangerousDisableAssetCspModification: ["style-src"]` stops Tauri adding nonces to `style-src`. A nonce would make the browser ignore `'unsafe-inline'` and block Svelte's style attributes. Scripts keep Tauri's protection.)

`src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-show",
    "core:window:allow-start-dragging",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "dialog:default",
    "opener:default",
    "opener:allow-reveal-item-in-dir",
    "process:default"
  ]
}
```

- [ ] **Step 3: Write the dev helper `scripts/cdp.mjs`**

```js
// Dev helper: talk to the running app's WebView2 over the DevTools protocol.
// Start the app with:  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev
// Then:  node scripts/cdp.mjs eval "document.title"   |   node scripts/cdp.mjs shot shot.png
import { writeFileSync } from 'node:fs';

const [cmd, arg] = process.argv.slice(2);
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('No page target. Is the app running with the debug port?');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => (ws.onopen = resolve));
let id = 0;
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mine = ++id;
    ws.addEventListener('message', function on(e) {
      const m = JSON.parse(e.data);
      if (m.id === mine) {
        ws.removeEventListener('message', on);
        resolve(m.result);
      }
    });
    ws.send(JSON.stringify({ id: mine, method, params }));
  });

if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.exceptionDetails ? r.exceptionDetails.text : r.result.value, null, 2));
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg ?? 'shot.png', Buffer.from(r.data, 'base64'));
  console.log('saved', arg ?? 'shot.png');
} else {
  console.log('usage: node scripts/cdp.mjs eval "<js>" | shot <file.png>');
}
ws.close();
```

- [ ] **Step 4: Install, generate icons, build Rust once**

Run:
```bash
cd <repo>
npm install
npx tauri icon app-icon.svg
rm -rf src-tauri/icons/android src-tauri/icons/ios
cargo build --manifest-path src-tauri/Cargo.toml
```
Expected:
- npm finishes. A warning that the optional `canvas` dependency of pdfjs-dist failed to build is fine.
- `src-tauri/icons/icon.ico` exists.
- cargo finishes with `Finished`.

- [ ] **Step 5: Write the setup test**

`test/setup.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('project setup', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

  it('pins pdf.js to the exact version Nomina 1.4.6 used', () => {
    expect(pkg.dependencies['pdfjs-dist']).toBe('3.11.174');
  });

  it('loads nothing from the network at startup', () => {
    expect(readFileSync('index.html', 'utf8')).not.toMatch(/https?:\/\//);
  });
});
```

- [ ] **Step 6: Run checks**

Run: `npm test && npm run check`
Expected: `2 passed`, then `svelte-check found 0 errors`.

- [ ] **Step 7: Run the app and look at it**

Run (background): `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev`
Then: `node scripts/cdp.mjs eval "document.querySelector('h1').textContent"`
Expected:
- The output is `"Vellova"`.
- A borderless 1180×760 window shows "Vellova".

Stop it with `taskkill //F //IM vellova.exe` and stop the background task.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -F- <<'EOF'
chore: scaffold Tauri 2 + Svelte 5 + Vite app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 2: Theme tokens, base controls and the theme switch

**Files:**
- Create: `src/app.css`, `src/lib/shell/theme.ts`, `src/lib/app.svelte.ts`, `test/theme.test.ts`
- Modify: `src/main.ts`, `src/App.svelte`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `theme.ts`:
    - `type ThemePref = 'system' | 'dark' | 'light'`
    - `resolveTheme(pref, systemDark: boolean): 'dark' | 'light'`
    - `applyTheme(pref): 'dark' | 'light'` sets `<html data-theme>`.
    - `watchSystemTheme(onChange: () => void)`
    - `switchTheme(apply: () => void, from?: HTMLElement)` runs the View Transition circle reveal.
    - `motion(ms: number): number` returns 0 when reduced motion is on.
  - `app.svelte.ts`:
    - `ui = $state({ tool: 'rename' | 'split', panel: PanelName | null, dark: boolean })`
    - `type Tool`, `type PanelName = 'history' | 'profiles' | 'settings' | 'attention' | 'welcome'`
    - `PANEL_TITLES`
    - `setTheme(pref)` applies the theme and sets `ui.dark`.
  - CSS variables `--bg … --err`, `--spring`, `--press`, plus soft/glow variants. Global classes: `.btn`, `.btn.primary`, `.btn.small`, `.field`, `.seg`, `.card`, `.label`, `.hint`, `.pill` (`.ok .warn .err .muted`), `.ib`, `.mono`, `.sr`, `.inline`, `.row`.

- [ ] **Step 1: Write the failing test**

`test/theme.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../src/lib/shell/theme';

const css = readFileSync('src/app.css', 'utf8');
function tokens(theme: 'dark' | 'light'): Record<string, string> {
  const start = css.indexOf(`[data-theme='${theme}'] {`);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
}
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe('theme', () => {
  it('follows the system unless a theme is chosen', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it.each(['dark', 'light'] as const)('%s tokens match the spec and keep text contrast >= 4.5', (theme) => {
    const t = tokens(theme);
    const spec = theme === 'dark'
      ? { bg: '#0F1115', surface: '#161920', text: '#E9ECF1', accent: '#7AA7FF', err: '#FF8A8A' }
      : { bg: '#F5F6F8', surface: '#FFFFFF', text: '#12151B', accent: '#1D5BD8', err: '#BF2A2A' };
    for (const [k, v] of Object.entries(spec)) expect(t[k], k).toBe(v);
    for (const fg of ['text', 'text2', 'text3', 'accent', 'ok', 'warn', 'err'])
      for (const bg of ['bg', 'chrome', 'surface', 'surface2'])
        expect(contrast(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['on-accent'], t.accent)).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/theme.test.ts`
Expected: FAIL, `Failed to load url ../src/lib/shell/theme` (and `ENOENT src/app.css`).

- [ ] **Step 3: Write `src/app.css`**

```css
:root {
  --spring: cubic-bezier(0.34, 1.32, 0.64, 1);
  --press: cubic-bezier(0.3, 1.4, 0.6, 1);
  interpolate-size: allow-keywords;
}
:root, :root[data-theme='dark'] {
  color-scheme: dark;
  --bg: #0F1115; --chrome: #0B0D10; --surface: #161920; --surface2: #1E222A; --cap: #1E222A; --cap2: #262B35;
  --border: #2A2F39; --border2: #3A404C;
  --text: #E9ECF1; --text2: #AEB5C1; --text3: #8B93A1;
  --accent: #7AA7FF; --on-accent: #0A1430; --soft: rgba(122, 167, 255, 0.14);
  --ok: #5BC995; --okring: rgba(91, 201, 149, 0.45);
  --warn: #F0B84D; --warnsoft: rgba(240, 184, 77, 0.16); --glow1: rgba(240, 184, 77, 0.32); --glow2: rgba(240, 184, 77, 0.38);
  --err: #FF8A8A; --errsoft: rgba(255, 138, 138, 0.12);
  --track: #2A2F39; --hover: rgba(255, 255, 255, 0.08); --shadow: 0 8px 24px rgba(0, 0, 0, 0.38); --sheen: rgba(255, 255, 255, 0.55);
}
:root[data-theme='light'] {
  color-scheme: light;
  --bg: #F5F6F8; --chrome: #ECEEF2; --surface: #FFFFFF; --surface2: #F0F2F5; --cap: #FFFFFF; --cap2: #F0F2F5;
  --border: #D8DCE3; --border2: #B9C0CB;
  --text: #12151B; --text2: #474E5A; --text3: #5E6673;
  --accent: #1D5BD8; --on-accent: #FFFFFF; --soft: rgba(29, 91, 216, 0.1);
  --ok: #13784A; --okring: rgba(19, 120, 74, 0.35);
  --warn: #8F5B00; --warnsoft: rgba(143, 91, 0, 0.1); --glow1: rgba(200, 140, 20, 0.25); --glow2: rgba(214, 150, 20, 0.32);
  --err: #BF2A2A; --errsoft: rgba(191, 42, 42, 0.08);
  --track: #D8DCE3; --hover: rgba(18, 21, 27, 0.06); --shadow: 0 8px 24px rgba(16, 24, 40, 0.12); --sheen: rgba(255, 255, 255, 0.6);
}

* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--bg); color: var(--text);
  font: 14px/1.45 'Geist Variable', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; overflow: hidden; user-select: none;
}
#app { height: 100%; }
input, textarea, select, button { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
h1, h2, h3 { margin: 0; font-weight: 600; letter-spacing: -0.01em; }
h2 { font-size: 16px; } h3 { font-size: 13px; }
.mono { font-family: 'Geist Mono Variable', ui-monospace, monospace; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.inline { display: inline-flex; gap: 8px; align-items: center; font-size: 13px; color: var(--text2); }

.btn {
  height: 32px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--border2); background: var(--surface);
  white-space: nowrap; transition: background 160ms ease, border-color 160ms ease, transform 160ms var(--press);
}
.btn:hover { background: var(--cap2); }
.btn:active { transform: scale(0.97); }
.btn.primary { background: var(--accent); color: var(--on-accent); border-color: transparent; font-weight: 600; }
.btn.primary:hover { filter: brightness(1.08); }
.btn.small { height: 28px; padding: 0 10px; font-size: 12.5px; }
.btn:disabled { opacity: 0.5; cursor: default; transform: none; filter: none; }
.field { height: 32px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border2); background: var(--bg); width: 100%; }
.field:focus { border-color: var(--accent); outline: none; }
.seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: 8px; background: var(--surface2); border: 1px solid var(--border); }
.seg button { height: 28px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--text2); transition: background 160ms ease, color 160ms ease; }
.seg button[aria-pressed='true'] { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.label { font-size: 12px; font-weight: 500; color: var(--text2); }
.hint { font-size: 12px; color: var(--text3); margin: 0; }
.pill { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px; font-size: 11.5px; font-weight: 500; }
.pill.ok { color: var(--ok); background: var(--soft); }
.pill.warn { color: var(--warn); background: var(--warnsoft); }
.pill.err { color: var(--err); background: var(--errsoft); }
.pill.muted { color: var(--text3); background: var(--surface2); }
.ib {
  width: 32px; height: 32px; border: 0; border-radius: 999px; background: transparent; color: var(--text2);
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: background 160ms ease, color 160ms ease, transform 160ms var(--press);
}
.ib:hover { background: var(--hover); color: var(--text); }
.ib:active { transform: scale(0.9); }

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 999px; border: 3px solid transparent; background-clip: content-box; }
::view-transition-old(root), ::view-transition-new(root) { animation: none; mix-blend-mode: normal; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important; animation-iteration-count: 1 !important;
    transition-duration: 1ms !important; scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 4: Write `src/lib/shell/theme.ts`**

```ts
export type ThemePref = 'system' | 'dark' | 'light';

export function resolveTheme(pref: ThemePref, systemDark: boolean): 'dark' | 'light' {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

const systemQuery = () => matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Sets `<html data-theme>`; returns the theme in effect. */
export function applyTheme(pref: ThemePref): 'dark' | 'light' {
  const theme = resolveTheme(pref, systemQuery().matches);
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function watchSystemTheme(onChange: () => void) {
  systemQuery().addEventListener('change', onChange);
}

/** Animation length for Svelte transitions (they use the Web Animations API, which CSS can't silence). */
export const motion = (ms: number) => (reducedMotion() ? 0 : ms);

/** Runs `apply` (which must update the DOM synchronously) and reveals the new theme as a circle from `from`. */
export function switchTheme(apply: () => void, from?: HTMLElement) {
  if (!document.startViewTransition || reducedMotion() || !from) return apply();
  const r = from.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const vt = document.startViewTransition(apply);
  vt.ready
    .then(() =>
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
        { duration: 560, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      ),
    )
    .catch(() => {});
}
```

- [ ] **Step 5: Write `src/lib/app.svelte.ts`**

```ts
import { applyTheme, type ThemePref } from './shell/theme';

export type Tool = 'rename' | 'split';
export type PanelName = 'history' | 'profiles' | 'settings' | 'attention' | 'welcome';

export const PANEL_TITLES: Record<PanelName, string> = {
  history: 'History',
  profiles: 'Profiles',
  settings: 'Settings',
  attention: 'Needs attention',
  welcome: 'Welcome to Vellova',
};

export const ui = $state({ tool: 'rename' as Tool, panel: null as PanelName | null, dark: true });

export function setTheme(pref: ThemePref) {
  ui.dark = applyTheme(pref) === 'dark';
}
```

- [ ] **Step 6: Run the test to make sure it passes**

Run: `npx vitest run test/theme.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Use the fonts and tokens in the app**

`src/main.ts`:

```ts
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './app.css';
import { mount } from 'svelte';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App.svelte';
import { setTheme } from './lib/app.svelte';
import { watchSystemTheme } from './lib/shell/theme';

setTheme('system');
watchSystemTheme(() => setTheme('system'));
mount(App, { target: document.getElementById('app')! });
void getCurrentWindow().show();
```

`src/App.svelte` (a temporary token check, replaced in Task 11):

```svelte
<script lang="ts">
  import { flushSync } from 'svelte';
  import { setTheme, ui } from './lib/app.svelte';
  import { switchTheme } from './lib/shell/theme';
</script>

<main style="padding: 24px; display: grid; gap: 12px; max-width: 420px">
  <h1>Vellova</h1>
  <p class="hint">Tokens, fonts and the circle reveal.</p>
  <div class="card"><span class="mono">INV-2026-00017.pdf</span><span class="pill ok">Ready</span></div>
  <button class="btn primary" onclick={(e) => switchTheme(() => { setTheme(ui.dark ? 'light' : 'dark'); flushSync(); }, e.currentTarget)}>
    Switch theme
  </button>
</main>
```

- [ ] **Step 8: Check and look**

Run:
```bash
npm run check
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev   # background
node scripts/cdp.mjs eval "getComputedStyle(document.body).fontFamily + ' | ' + document.documentElement.dataset.theme"
node scripts/cdp.mjs shot task2.png
```
Expected:
- `0 errors`.
- The eval prints `"\"Geist Variable\", system-ui, sans-serif | dark"` (or `light`, following Windows).
- `task2.png` shows Geist text on the graphite or cool-white background.

Click Switch theme: the new theme grows as a circle from the button. Stop the app afterwards and delete `task2.png`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -F- <<'EOF'
feat: Ledger tokens, Geist fonts and theme switch with circle reveal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 3: Shared types and name safety

**Files:**
- Create: `src/lib/shared/types.ts`, `src/lib/shared/names.ts`, `test/names.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`types.ts`, used by every later task):

```ts
export type Position = 'after' | 'before' | 'above' | 'below';
export type Conflict = 'add' | 'skip' | 'replace';
export type Destination = { mode: 'inplace' } | { mode: 'copy'; folder: string };
export type Reason = 'keyword-not-found' | 'no-value' | 'no-text' | 'unreadable' | 'no-match' | 'exists' | 'locked' | 'permission' | 'missing' | 'internal';
export type Op = { kind: 'rename' | 'copy'; from: string; to: string; replace?: boolean };
export type Status = 'ready' | 'paired' | 'duplicate' | 'unchanged' | 'attention' | 'skipped' | 'pending';
export type PlanItem = { id: string; source: string; op: Op | null; status: Status; name?: string; reason?: Reason; detail?: string };
export type FileInfo = { path: string; size: number; mtime: number };
export type Step = { type: 'pdfValue'; keyword: string; position: Position; occurrence: number } | { type: 'addText'; prefix: string; suffix: string };
export type RenameProfile = { id: string; name: string; desc: string; steps: Step[]; pair: boolean; destination: Destination; conflict: Conflict };
export type BatchItem = { from: string; to: string; ok: boolean; reason?: Reason };
export type Batch = { id: string; tool: 'rename' | 'split'; time: number; verb: string; summary: string; profile?: string; items: BatchItem[]; undoable: boolean; undone?: boolean };
export type Settings = { theme: 'system' | 'dark' | 'light'; updates: { onStartup: boolean; everyHours: number }; rename: { folder: string; recursive: boolean }; welcomed: boolean };
```

- `names.ts`:
  - `splitPath(p): { dir, name }`
  - `splitExt(name): { base, ext }` keeps the extension's case.
  - `extOf(p): string` returns the lower-cased extension with its dot, or `''`.
  - `join(dir, name): string` uses `\`.
  - `sanitize(base): string`

- [ ] **Step 1: Write the failing test**

`test/names.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extOf, join, sanitize, splitExt, splitPath } from '../src/lib/shared/names';

describe('names', () => {
  it('splits Windows and forward-slash paths', () => {
    expect(splitPath('C:\\Docs\\in\\INV-1.pdf')).toEqual({ dir: 'C:\\Docs\\in', name: 'INV-1.pdf' });
    expect(splitPath('C:/Docs/in/INV-1.pdf')).toEqual({ dir: 'C:/Docs/in', name: 'INV-1.pdf' });
  });

  it('lower-cases extensions like 1.4.6 and keeps names without one', () => {
    expect(extOf('C:\\a\\Scan.PDF')).toBe('.pdf');
    expect(extOf('C:\\a\\README')).toBe('');
    expect(extOf('C:\\a.b\\file')).toBe('');
    expect(splitExt('report.final.XLSX')).toEqual({ base: 'report.final', ext: '.XLSX' });
    expect(splitExt('.hidden')).toEqual({ base: '.hidden', ext: '' });
  });

  it('joins with a single backslash', () => {
    expect(join('C:\\out', 'a.pdf')).toBe('C:\\out\\a.pdf');
    expect(join('C:\\out\\', 'a.pdf')).toBe('C:\\out\\a.pdf');
    expect(join('D:/', 'a.pdf')).toBe('D:/a.pdf');
  });

  it('sanitizes exactly like 1.4.6 for its characters', () => {
    expect(sanitize('INV/2026/17')).toBe('INV_2026_17');
    expect(sanitize('a\\b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i');
    expect(sanitize('  DN-17  ')).toBe('DN-17');
  });

  it('also makes control characters and reserved device names safe', () => {
    expect(sanitize('DN\t17\u0001')).toBe('DN_17_');
    expect(sanitize('CON')).toBe('CON_');
    expect(sanitize('nul')).toBe('nul_');
    expect(sanitize('COM1')).toBe('COM1_');
    expect(sanitize('CON.backup')).toBe('CON_.backup');
    expect(sanitize('CONTOSO')).toBe('CONTOSO');
  });

  it('keeps a trailing dot when an extension follows (1.4.6 behaviour)', () => {
    expect(sanitize('No. 17.')).toBe('No. 17.');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/names.test.ts`
Expected: FAIL, `Failed to load url ../src/lib/shared/names`.

- [ ] **Step 3: Write `src/lib/shared/types.ts`**

```ts
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

export type BatchItem = { from: string; to: string; ok: boolean; reason?: Reason };

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
};

export type Settings = {
  theme: 'system' | 'dark' | 'light';
  updates: { onStartup: boolean; everyHours: number };
  rename: { folder: string; recursive: boolean };
  welcomed: boolean;
};
```

- [ ] **Step 4: Write `src/lib/shared/names.ts`**

```ts
export function splitPath(p: string): { dir: string; name: string } {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return { dir: p.slice(0, Math.max(i, 0)), name: p.slice(i + 1) };
}

export function splitExt(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf('.');
  return i > 0 ? { base: name.slice(0, i), ext: name.slice(i) } : { base: name, ext: '' };
}

/** Lower-cased extension with its dot ("" if none), as Nomina 1.4.6 computed it. */
export const extOf = (p: string) => splitExt(splitPath(p).name).ext.toLowerCase();

export function join(dir: string, name: string): string {
  return /[\\/]$/.test(dir) ? dir + name : `${dir}\\${name}`;
}

const ILLEGAL = /[\\/:*?"<>|\x00-\x1f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Makes a base name safe for Windows. Nomina 1.4.6 replaced `\ / : * ? " < > |` with `_` and trimmed;
 * control characters and reserved device names (CON, NUL, COM1…) are handled too, because they fail on Windows.
 */
export function sanitize(base: string): string {
  const s = base.replace(ILLEGAL, '_').trim();
  return s.replace(RESERVED, '$1_$2');
}
```

- [ ] **Step 5: Run the test to make sure it passes**

Run: `npx vitest run test/names.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/shared test/names.test.ts
git commit -F- <<'EOF'
feat: shared plan types and Windows-safe names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 4: Data store, log and atomic writes

**Files:**
- Create: `src-tauri/src/files.rs`, `src/lib/shared/ipc.ts`, `src/lib/shared/store.ts`, `src/lib/shared/state.svelte.ts`, `test/store.test.ts`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src/main.ts`

**Interfaces:**
- Consumes: `Batch`, `RenameProfile`, `Settings` from `types.ts`.
- Produces:
  - Rust commands:
    - `data_read(name) -> Option<String>`
    - `data_write(name, text)` (atomic)
    - `data_rename(from, to)`
    - `read_legacy(files: Vec<String>) -> Vec<Option<String>>`, with paths relative to `%APPDATA%`
    - `save_text(path, text)`
  - Rust helpers: `files::err`, `files::data_dir(&AppHandle)`, `files::safe_name`, `files::write_atomic`, `files::legacy_path`.
  - `ipc.ts`: `ipc.dataRead`, `ipc.dataWrite`, `ipc.dataRename`, `ipc.readLegacy`, `ipc.saveText`.
  - `store.ts` (pure):
    - `type LogEntry = { t; level: 'error' | 'warn' | 'info'; tool: 'rename' | 'split' | 'app'; file?; message; detail? }`
    - `type ProfilesFile = { rename: RenameProfile[]; split: unknown[] }`, `type DataIO`
    - `DEFAULT_SETTINGS`, `withDefaults(v)`, `loadJson(io, name, fallback, valid, onCorrupt, now?)`
    - `isProfiles`, `isHistory`, `parseLog`, `pruneLog(entries, now)`, `logToText(entries)`
    - `capHistory`, `batchSummary(b)`, `mergeBatch(history, b)`, `lastUndoable(history)`
  - `state.svelte.ts`:
    - `data = $state({ settings, profiles, history, log, loaded })`
    - `loadAll()`, `save(kind)` (debounced 250 ms), `flush()`, `log(entry)`

- [ ] **Step 1: Write the failing TypeScript test**

`test/store.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS, lastUndoable, loadJson, logToText, mergeBatch, parseLog, pruneLog, withDefaults,
  type DataIO, type LogEntry,
} from '../src/lib/shared/store';
import type { Batch } from '../src/lib/shared/types';

function fakeIO(files: Record<string, string>): DataIO & { renamed: [string, string][] } {
  const renamed: [string, string][] = [];
  return {
    renamed,
    read: async (n) => files[n] ?? null,
    write: async (n, t) => void (files[n] = t),
    rename: async (from, to) => void renamed.push([from, to]),
  };
}
const NOW = new Date('2026-10-15T12:00:00.000Z');
const isObj = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);

describe('loadJson', () => {
  it('returns the fallback when the file does not exist', async () => {
    const io = fakeIO({});
    expect(await loadJson(io, 'settings.json', { a: 1 }, isObj, vi.fn())).toEqual({ a: 1 });
    expect(io.renamed).toEqual([]);
  });

  it('returns the saved value', async () => {
    expect(await loadJson(fakeIO({ 'settings.json': '{"a":2}' }), 'settings.json', { a: 1 }, isObj, vi.fn())).toEqual({ a: 2 });
  });

  it.each([['broken JSON', '{"a":'], ['wrong shape', '[1,2]']])('sets aside %s and starts with defaults', async (_, text) => {
    const io = fakeIO({ 'settings.json': text });
    const onCorrupt = vi.fn();
    expect(await loadJson(io, 'settings.json', { a: 1 }, isObj, onCorrupt, NOW)).toEqual({ a: 1 });
    expect(io.renamed).toEqual([['settings.json', 'settings.corrupt-2026-10-15T12-00-00-000Z.json']]);
    expect(onCorrupt).toHaveBeenCalledWith('settings.json', 'settings.corrupt-2026-10-15T12-00-00-000Z.json');
  });
});

describe('settings defaults', () => {
  it('fills missing and nested values', () => {
    expect(withDefaults({ theme: 'light', updates: { everyHours: 24 } })).toEqual({
      ...DEFAULT_SETTINGS, theme: 'light', updates: { onStartup: true, everyHours: 24 },
    });
    expect(withDefaults('nonsense')).toEqual(DEFAULT_SETTINGS);
  });
});

describe('log', () => {
  const e = (t: number, message = 'm'): LogEntry => ({ t, level: 'warn', tool: 'rename', message });

  it('keeps 30 days and at most 1000 entries', () => {
    const now = NOW.getTime();
    const old = e(now - 31 * 86_400_000, 'old');
    const many = Array.from({ length: 1200 }, (_, i) => e(now - i));
    const kept = pruneLog([old, ...many], now);
    expect(kept).toHaveLength(1000);
    expect(kept.some((x) => x.message === 'old')).toBe(false);
    expect(kept.at(-1)).toEqual(many.at(-1));
  });

  it('skips damaged lines', () => {
    expect(parseLog('{"t":1,"level":"info","tool":"app","message":"a"}\nnot json\n{"x":1}')).toEqual([
      { t: 1, level: 'info', tool: 'app', message: 'a' },
    ]);
    expect(parseLog(null)).toEqual([]);
  });

  it('exports tab-separated lines', () => {
    expect(logToText([{ t: NOW.getTime(), level: 'error', tool: 'rename', file: 'C:\\a.pdf', message: 'locked', detail: 'os error 32' }]))
      .toBe('2026-10-15T12:00:00.000Z\tERROR\trename\tC:\\a.pdf\tlocked\tos error 32');
  });
});

describe('history', () => {
  const batch = (id: string, items: Batch['items'], extra: Partial<Batch> = {}): Batch =>
    ({ id, tool: 'rename', time: 1, verb: 'renamed', summary: '', items, undoable: true, ...extra });

  it('adds a batch on top with a summary', () => {
    const h = mergeBatch([], batch('b1', [{ from: 'a', to: 'A', ok: true }, { from: 'b', to: 'B', ok: false, reason: 'locked' }]));
    expect(h[0].summary).toBe('1 file renamed · 1 failed');
  });

  it('merges fixes into the same batch, later results win', () => {
    let h = mergeBatch([], batch('b1', [{ from: 'b', to: 'B', ok: false, reason: 'locked' }], { undoable: false }));
    h = mergeBatch(mergeBatch(h, batch('b0', [])), batch('b1', [{ from: 'b', to: 'B', ok: true }]));
    expect(h.map((b) => b.id)).toEqual(['b1', 'b0']);
    expect(h[0].items).toEqual([{ from: 'b', to: 'B', ok: true }]);
    expect(h[0].undoable).toBe(true);
    expect(h[0].summary).toBe('1 file renamed');
  });

  it('keeps the last 200 batches', () => {
    let h: Batch[] = [];
    for (let i = 0; i < 205; i++) h = mergeBatch(h, batch(`b${i}`, []));
    expect(h).toHaveLength(200);
    expect(h[0].id).toBe('b204');
  });

  it('finds the newest batch that can still be undone', () => {
    const h = [batch('b3', [], { undoable: false }), batch('b2', [], { undone: true }), batch('b1', [])];
    expect(lastUndoable(h)?.id).toBe('b1');
    expect(lastUndoable([])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/store.test.ts`
Expected: FAIL, `Failed to load url ../src/lib/shared/store`.

- [ ] **Step 3: Write `src/lib/shared/store.ts`**

```ts
import type { Batch, RenameProfile, Settings } from './types';

export type LogEntry = { t: number; level: 'error' | 'warn' | 'info'; tool: 'rename' | 'split' | 'app'; file?: string; message: string; detail?: string };
export type ProfilesFile = { rename: RenameProfile[]; split: unknown[] };
export type DataIO = {
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  updates: { onStartup: true, everyHours: 6 },
  rename: { folder: '', recursive: false },
  welcomed: false,
};
export const LOG_MAX = 1000;
export const LOG_DAYS = 30;
export const HISTORY_MAX = 200;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function withDefaults(v: unknown): Settings {
  const s = isObj(v) ? v : {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    updates: { ...DEFAULT_SETTINGS.updates, ...(isObj(s.updates) ? s.updates : {}) },
    rename: { ...DEFAULT_SETTINGS.rename, ...(isObj(s.rename) ? s.rename : {}) },
  };
}

/**
 * Reads a JSON data file. Missing → fallback. Unparseable or the wrong shape → the file is renamed
 * `<name>.corrupt-<date>.json`, `onCorrupt` is told, and the fallback is used.
 */
export async function loadJson<T>(
  io: DataIO,
  name: string,
  fallback: T,
  valid: (v: unknown) => boolean,
  onCorrupt: (name: string, backup: string) => void,
  now = new Date(),
): Promise<T> {
  const text = await io.read(name);
  if (text === null) return fallback;
  try {
    const v: unknown = JSON.parse(text);
    if (valid(v)) return v as T;
  } catch {
    // fall through: set the file aside
  }
  const backup = `${name.replace(/\.json$/, '')}.corrupt-${now.toISOString().replace(/[:.]/g, '-')}.json`;
  await io.rename(name, backup);
  onCorrupt(name, backup);
  return fallback;
}

export const isProfiles = (v: unknown) => isObj(v) && Array.isArray(v.rename);
export const isHistory = (v: unknown) => Array.isArray(v);

export function parseLog(text: string | null): LogEntry[] {
  if (!text) return [];
  return text.split('\n').flatMap((line) => {
    try {
      const e: unknown = JSON.parse(line);
      return isObj(e) && typeof e.t === 'number' && typeof e.message === 'string' ? [e as LogEntry] : [];
    } catch {
      return [];
    }
  });
}

export function pruneLog(entries: LogEntry[], now: number): LogEntry[] {
  const cutoff = now - LOG_DAYS * 86_400_000;
  return entries.filter((e) => e.t >= cutoff).slice(-LOG_MAX);
}

export function logToText(entries: LogEntry[]): string {
  return entries
    .map((e) => [new Date(e.t).toISOString(), e.level.toUpperCase(), e.tool, e.file ?? '-', e.message, e.detail ?? ''].join('\t').trimEnd())
    .join('\r\n');
}

export const capHistory = (h: Batch[]) => h.slice(0, HISTORY_MAX);

export function batchSummary(b: Batch): string {
  const ok = b.items.filter((i) => i.ok).length;
  const failed = b.items.length - ok;
  return `${ok} ${ok === 1 ? 'file' : 'files'} ${b.verb}${failed ? ` · ${failed} failed` : ''}`;
}

/** Puts `b` on top of the history. A batch with the same id (Apply fixes) is merged: later results win per source. */
export function mergeBatch(history: Batch[], b: Batch): Batch[] {
  const prev = history.find((h) => h.id === b.id);
  const merged: Batch = prev
    ? {
        ...prev,
        time: b.time,
        items: [...prev.items.filter((i) => !b.items.some((n) => n.from === i.from)), ...b.items],
        undoable: prev.undoable || b.undoable,
      }
    : { ...b };
  merged.summary = batchSummary(merged);
  return capHistory([merged, ...history.filter((h) => h.id !== b.id)]);
}

export const lastUndoable = (history: Batch[]) => history.find((b) => b.undoable && !b.undone);
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npx vitest run test/store.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Write the Rust data commands with their tests**

Add to `src-tauri/Cargo.toml`:

```toml
[dev-dependencies]
tempfile = "3"
```

`src-tauri/src/files.rs`:

```rust
//! Commands the front end uses for its own data files and for reading old app data.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

pub(crate) fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// `%APPDATA%\com.vslnnd.vellova`, created on first use.
pub(crate) fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

/// File names the front end may use inside the data folder: letters, digits, `.`, `-`, `_`, and no `..`.
pub(crate) fn safe_name(name: &str) -> Result<&str, String> {
    let ok = !name.is_empty()
        && !name.contains("..")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if ok { Ok(name) } else { Err(format!("invalid data file name: {name}")) }
}

/// Writes a temp file next to `path`, then renames it over `path` (Windows replaces the old file).
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("data");
    let tmp = path.with_file_name(format!("{name}.tmp"));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

/// `base\rel` when `rel` is a plain relative path (no drive, root or `..`).
pub(crate) fn legacy_path(base: &Path, rel: &str) -> Option<PathBuf> {
    let rel = Path::new(rel);
    rel.components().all(|c| matches!(c, Component::Normal(_))).then(|| base.join(rel))
}

#[tauri::command]
pub async fn data_read(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let path = data_dir(&app)?.join(safe_name(&name)?);
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

#[tauri::command]
pub async fn data_write(app: AppHandle, name: String, text: String) -> Result<(), String> {
    let path = data_dir(&app)?.join(safe_name(&name)?);
    write_atomic(&path, text.as_bytes()).map_err(err)
}

#[tauri::command]
pub async fn data_rename(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    fs::rename(dir.join(safe_name(&from)?), dir.join(safe_name(&to)?)).map_err(err)
}

/// Reads files of earlier apps under `%APPDATA%` (Roaming); missing or unreadable files give `None`.
#[tauri::command]
pub async fn read_legacy(app: AppHandle, files: Vec<String>) -> Result<Vec<Option<String>>, String> {
    let base = app.path().config_dir().map_err(err)?;
    Ok(files
        .iter()
        .map(|f| legacy_path(&base, f).and_then(|p| fs::read_to_string(p).ok()))
        .collect())
}

/// Writes an export the user asked for (path chosen in a save dialog).
#[tauri::command]
pub async fn save_text(path: String, text: String) -> Result<(), String> {
    fs::write(path, text).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_atomic_replaces_and_leaves_no_temp() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        write_atomic(&p, b"one").unwrap();
        write_atomic(&p, b"two").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "two");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn safe_name_rejects_paths() {
        for bad in ["", "..", "../x.json", "a/b.json", "a\\b.json", "C:x.json"] {
            assert!(safe_name(bad).is_err(), "{bad}");
        }
        for good in ["settings.json", "log.jsonl", "history.corrupt-2026-10-15T12-00-00-000Z.json"] {
            assert!(safe_name(good).is_ok(), "{good}");
        }
    }

    #[test]
    fn legacy_path_stays_under_base() {
        let base = Path::new("C:\\Users\\x\\AppData\\Roaming");
        assert_eq!(legacy_path(base, "Nomina/nomina-profiles.json"), Some(base.join("Nomina/nomina-profiles.json")));
        for bad in ["../secret.json", "C:\\x.json", "\\x.json", "Nomina/../../x"] {
            assert_eq!(legacy_path(base, bad), None, "{bad}");
        }
    }
}
```

`src-tauri/src/lib.rs` (full file):

```rust
mod files;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // must be first: a second launch focuses the running window instead
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        // the front end shows the window after its first paint, so don't restore visibility
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            files::data_read,
            files::data_write,
            files::data_rename,
            files::read_legacy,
            files::save_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vellova");
}
```

- [ ] **Step 6: Run the Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: `test result: ok. 3 passed`.

- [ ] **Step 7: Write `src/lib/shared/ipc.ts`**

```ts
import { invoke } from '@tauri-apps/api/core';

export const ipc = {
  dataRead: (name: string) => invoke<string | null>('data_read', { name }),
  dataWrite: (name: string, text: string) => invoke<void>('data_write', { name, text }),
  dataRename: (from: string, to: string) => invoke<void>('data_rename', { from, to }),
  readLegacy: (files: string[]) => invoke<(string | null)[]>('read_legacy', { files }),
  saveText: (path: string, text: string) => invoke<void>('save_text', { path, text }),
};
```

- [ ] **Step 8: Write `src/lib/shared/state.svelte.ts`**

```ts
import { ipc } from './ipc';
import {
  capHistory, isHistory, isObj, isProfiles, loadJson, parseLog, pruneLog, withDefaults,
  type LogEntry, type ProfilesFile,
} from './store';
import type { Batch, Settings } from './types';

export const data = $state({
  settings: withDefaults({}) as Settings,
  profiles: { rename: [], split: [] } as ProfilesFile,
  history: [] as Batch[],
  log: [] as LogEntry[],
  loaded: false,
});

type Kind = 'settings' | 'profiles' | 'history' | 'log';
const FILE: Record<Kind, string> = { settings: 'settings.json', profiles: 'profiles.json', history: 'history.json', log: 'log.jsonl' };
const io = { read: ipc.dataRead, write: ipc.dataWrite, rename: ipc.dataRename };
const timers = new Map<Kind, ReturnType<typeof setTimeout>>();

export function log(e: Omit<LogEntry, 't'>) {
  data.log = pruneLog([...data.log, { t: Date.now(), ...e }], Date.now());
  save('log');
}

export async function loadAll() {
  const corrupt = (name: string, backup: string) =>
    log({ level: 'warn', tool: 'app', message: `${name} could not be read. It was set aside as ${backup} and defaults are used.` });
  data.log = pruneLog(parseLog(await ipc.dataRead(FILE.log).catch(() => null)), Date.now());
  data.settings = withDefaults(await loadJson<unknown>(io, FILE.settings, {}, isObj, corrupt));
  data.profiles = await loadJson<ProfilesFile>(io, FILE.profiles, { rename: [], split: [] }, isProfiles, corrupt);
  data.history = capHistory(await loadJson<Batch[]>(io, FILE.history, [], isHistory, corrupt));
  data.loaded = true;
}

function write(kind: Kind) {
  timers.delete(kind);
  const text = kind === 'log'
    ? data.log.map((e) => JSON.stringify(e)).join('\n')
    : JSON.stringify($state.snapshot(data[kind]), null, 2);
  return ipc.dataWrite(FILE[kind], text).catch((e) => console.error(`saving ${FILE[kind]} failed`, e));
}

/** Saves one data file atomically, 250 ms after the last change. */
export function save(kind: Kind) {
  clearTimeout(timers.get(kind));
  timers.set(kind, setTimeout(() => void write(kind), 250));
}

/** Writes pending saves now (before closing or restarting). */
export async function flush() {
  const kinds = [...timers.keys()];
  kinds.forEach((k) => clearTimeout(timers.get(k)));
  await Promise.all(kinds.map(write));
}
```

- [ ] **Step 9: Load data before mounting**

`src/main.ts` (full file):

```ts
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './app.css';
import { mount } from 'svelte';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App.svelte';
import { setTheme } from './lib/app.svelte';
import { watchSystemTheme } from './lib/shell/theme';
import { data, loadAll, log } from './lib/shared/state.svelte';

setTheme('system');
loadAll()
  .catch((e) => log({ level: 'error', tool: 'app', message: 'Saved data could not be loaded; using defaults.', detail: String(e) }))
  .finally(() => {
    setTheme(data.settings.theme);
    watchSystemTheme(() => setTheme(data.settings.theme));
    mount(App, { target: document.getElementById('app')! });
    void getCurrentWindow().show();
  });
```

- [ ] **Step 10: Check end to end that a corrupt file is set aside**

Run:
```bash
npm run check
mkdir -p "$APPDATA/com.vslnnd.vellova" && printf '{"theme":' > "$APPDATA/com.vslnnd.vellova/settings.json"
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev   # background
ls "$APPDATA/com.vslnnd.vellova"
```
Expected:
- `0 errors`.
- The folder lists `settings.corrupt-<date>.json` and `log.jsonl`.
- `log.jsonl` contains `settings.json could not be read`.

Stop the app. Then delete the test files with `rm "$APPDATA"/com.vslnnd.vellova/settings.corrupt-*.json "$APPDATA/com.vslnnd.vellova/log.jsonl"`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -F- <<'EOF'
feat: atomic data store, log and corrupt-file recovery

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 5: Plan executor in Rust (journal, two-phase renames, Recycle Bin, undo, recovery)

**Files:**
- Create: `src-tauri/src/ops.rs`, `test/ipc.test.ts`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/files.rs`, `src-tauri/src/lib.rs`, `src/lib/shared/ipc.ts`, `src/main.ts`

**Interfaces:**
- Consumes: `files::{err, data_dir}` (Task 4); `Op`, `Reason`, `FileInfo` from `types.ts`.
- Produces:
  - Rust `ops`:
    - `Op { kind: Kind::{Rename, Copy}, from, to, replace }`
    - `OpResult { i, ok, code: Option<"missing" | "permission" | "locked" | "exists" | "internal" | "cancelled">, message }`
    - `Entry` journal lines, tagged `t`: `temp | final | copy | trash | restored`
    - `UndoReport { restored, skipped: [{ path, reason }] }`
    - `trait Bin`, `RecycleBin`, `Ctx { journal, bin, progress, cancel }`
    - `apply(ctx, batch, ops)`, `undo(ctx, undo_journal)`, `recover(journal)`, `code(&io::Error)`, `mtime_ms`
  - Commands:
    - `read_file(path)` returns raw bytes; errors as `"<code>: <message>"`.
    - `list_files(paths, recursive) -> FileInfo[]`
    - `list_dir(dirs) -> string[]`
    - `apply_plan(batch, ops) -> OpResult[]`, which emits `plan-progress` with `[done, total]`.
    - `undo_batch(batch) -> UndoReport`
    - `cancel_apply()`
    - `recover_all() -> number`
  - Journals live at `%APPDATA%\com.vslnnd.vellova\journal\<batch>.jsonl`, with `<batch>.undo.jsonl` for undo runs.
  - `ipc.ts` additions: `type OpResult`, `type UndoReport`, `ipc.readFile`, `ipc.listFiles`, `ipc.listDir`, `ipc.applyPlan`, `ipc.undoBatch`, `ipc.cancelApply`, `ipc.recoverAll`, and `ipcReason(e): { reason: Reason; detail: string }`.

- [ ] **Step 1: Add the `trash` crate**

In `src-tauri/Cargo.toml` `[dependencies]` add:

```toml
trash = "5"
```

- [ ] **Step 2: Write `src-tauri/src/ops.rs` with its tests first (types and function signatures only, bodies `todo!()`)**

The tests below are the contract. Write the whole file as given in Step 4, but start with every function body that is not a one-liner replaced by `todo!()`. Then run the tests to watch them fail. (In Rust a test module can't compile without the items it uses, so failing via `todo!()` is the TDD red step.)

- [ ] **Step 3: Run the Rust tests to make sure they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml ops::`
Expected: FAIL, with tests panicking at `not yet implemented`.

- [ ] **Step 4: Write the full `src-tauri/src/ops.rs`**

```rust
//! Executes a Plan with a per-batch journal so every batch can be undone.
//! Renames go through temporary names (two phases), so swaps, cycles and case-only
//! renames work. Nothing is deleted: a replaced file goes to the Recycle Bin.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Rename,
    Copy,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct Op {
    pub kind: Kind,
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub replace: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct OpResult {
    pub i: usize,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum Entry {
    /// `from` stepped aside to `tmp` (phase 1).
    Temp { from: String, tmp: String },
    /// `tmp` reached its final name `to` (phase 2); `from` is the original path.
    Final { from: String, tmp: String, to: String, size: u64, mtime: u64 },
    /// A copy of `from` was written to `to`.
    Copy { from: String, to: String, size: u64, mtime: u64 },
    /// The file at `path` was sent to the Recycle Bin (Replace).
    Trash { path: String },
    /// `tmp` was put back at `to` after a failure or a crash.
    Restored { tmp: String, to: String },
}

#[derive(Serialize, Debug, Default, PartialEq)]
pub struct Skipped {
    pub path: String,
    pub reason: String,
}

#[derive(Serialize, Debug, Default)]
pub struct UndoReport {
    pub restored: usize,
    pub skipped: Vec<Skipped>,
}

pub trait Bin {
    fn trash(&self, path: &Path) -> io::Result<()>;
    fn restore(&self, path: &Path) -> io::Result<()>;
}

/// The Windows Recycle Bin.
pub struct RecycleBin;

impl Bin for RecycleBin {
    fn trash(&self, path: &Path) -> io::Result<()> {
        trash::delete(path).map_err(|e| io::Error::other(e.to_string()))
    }
    fn restore(&self, path: &Path) -> io::Result<()> {
        let want = key(path);
        let newest = trash::os_limited::list()
            .map_err(|e| io::Error::other(e.to_string()))?
            .into_iter()
            .filter(|it| key(it.original_path()) == want)
            .max_by_key(|it| it.time_deleted);
        match newest {
            Some(item) => trash::os_limited::restore_all([item]).map_err(|e| io::Error::other(e.to_string())),
            None => Err(io::Error::new(io::ErrorKind::NotFound, "not found in the Recycle Bin")),
        }
    }
}

pub struct Ctx<'a> {
    pub journal: &'a Path,
    pub bin: &'a dyn Bin,
    pub progress: &'a dyn Fn(usize, usize),
    pub cancel: &'a AtomicBool,
}

/// Case-insensitive identity of a path, as NTFS sees it.
fn key(p: impl AsRef<Path>) -> String {
    p.as_ref().to_string_lossy().replace('/', "\\").to_lowercase()
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn exists(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok()
}

pub fn mtime_ms(md: &fs::Metadata) -> u64 {
    md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64)
}

fn stat(p: &Path) -> io::Result<(u64, u64)> {
    let md = fs::metadata(p)?;
    Ok((md.len(), mtime_ms(&md)))
}

/// Maps an OS error to the reason the front end shows.
pub fn code(e: &io::Error) -> &'static str {
    match e.raw_os_error() {
        Some(2 | 3) => "missing",
        Some(5) => "permission",
        Some(32 | 33) => "locked",
        Some(80 | 183) => "exists",
        _ => match e.kind() {
            io::ErrorKind::NotFound => "missing",
            io::ErrorKind::PermissionDenied => "permission",
            io::ErrorKind::AlreadyExists => "exists",
            _ => "internal",
        },
    }
}

fn ok(i: usize) -> OpResult {
    OpResult { i, ok: true, code: None, message: None }
}
fn fail(i: usize, e: &io::Error) -> OpResult {
    OpResult { i, ok: false, code: Some(code(e)), message: Some(e.to_string()) }
}
fn cancelled(i: usize) -> OpResult {
    OpResult { i, ok: false, code: Some("cancelled"), message: None }
}
fn exists_err(p: &Path) -> io::Error {
    io::Error::new(io::ErrorKind::AlreadyExists, format!("{} already exists", p.display()))
}

fn ensure_parent(p: &Path) -> io::Result<()> {
    match p.parent() {
        Some(d) if !d.as_os_str().is_empty() => fs::create_dir_all(d),
        _ => Ok(()),
    }
}

/// Moves a file; across volumes (ERROR_NOT_SAME_DEVICE = 17) it copies, then removes the source.
fn move_file(from: &Path, to: &Path) -> io::Result<()> {
    match fs::rename(from, to) {
        Err(e) if e.raw_os_error() == Some(17) => {
            fs::copy(from, to)?;
            fs::remove_file(from)
        }
        r => r,
    }
}

struct Journal(fs::File);

impl Journal {
    fn open(path: &Path) -> io::Result<Self> {
        ensure_parent(path)?;
        Ok(Self(OpenOptions::new().create(true).append(true).open(path)?))
    }
    // ponytail: no fsync per line; survives an app crash, not a power cut. A failed write only costs undo
    // for that file, so it never stops a batch half-way.
    fn add(&mut self, e: &Entry) {
        if let Ok(mut line) = serde_json::to_string(e) {
            line.push('\n');
            let _ = self.0.write_all(line.as_bytes());
        }
    }
}

pub fn read_journal(path: &Path) -> io::Result<Vec<Entry>> {
    Ok(fs::read_to_string(path)?.lines().filter_map(|l| serde_json::from_str(l).ok()).collect())
}

/// Makes room at `to`. Free, or taken by a file this batch moves away: fine. With `replace`, an existing
/// file goes to the Recycle Bin first. Otherwise: "exists". Never trashes a folder or the source itself.
fn clear_target(j: &mut Journal, bin: &dyn Bin, op: &Op, to: &Path, leaving: &HashSet<String>) -> io::Result<()> {
    if !exists(to) || leaving.contains(&key(to)) {
        return Ok(());
    }
    if !op.replace || key(to) == key(&op.from) || fs::metadata(to)?.is_dir() {
        return Err(exists_err(to));
    }
    bin.trash(to)?;
    j.add(&Entry::Trash { path: op.to.clone() });
    Ok(())
}

/// Runs the operations. Each one gets its own result; a failure never stops the others.
pub fn apply(ctx: &Ctx, batch: &str, ops: &[Op]) -> io::Result<Vec<OpResult>> {
    let mut j = Journal::open(ctx.journal)?;
    let total = ops.len();
    let mut out: Vec<OpResult> = Vec::with_capacity(total);
    let report = |out: &mut Vec<OpResult>, r: OpResult| {
        out.push(r);
        (ctx.progress)(out.len(), total);
    };
    let stop = || ctx.cancel.load(Ordering::SeqCst);
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() % 1_000_000);
    let tag: String = batch.chars().take(8).collect();
    let leaving: HashSet<String> = ops.iter().filter(|o| o.kind == Kind::Rename).map(|o| key(&o.from)).collect();

    // Phase 1: every rename source steps aside to a temporary name next to it.
    let mut staged: Vec<(usize, PathBuf)> = Vec::new();
    for (i, op) in ops.iter().enumerate().filter(|(_, o)| o.kind == Kind::Rename) {
        if stop() {
            report(&mut out, cancelled(i));
            continue;
        }
        let from = Path::new(&op.from);
        if let Err(e) = clear_target(&mut j, ctx.bin, op, Path::new(&op.to), &leaving) {
            report(&mut out, fail(i, &e));
            continue;
        }
        let tmp = from.with_file_name(format!(".~vellova-{tag}-{stamp}-{i}.tmp"));
        match fs::rename(from, &tmp) {
            Ok(()) => {
                j.add(&Entry::Temp { from: op.from.clone(), tmp: s(&tmp) });
                staged.push((i, tmp));
            }
            Err(e) => report(&mut out, fail(i, &e)),
        }
    }

    // Phase 2: temporary names become final names (always finished, even after Cancel).
    for (i, tmp) in staged {
        let op = &ops[i];
        let to = Path::new(&op.to);
        let moved = if exists(to) { Err(exists_err(to)) } else { ensure_parent(to).and_then(|_| move_file(&tmp, to)) };
        match moved {
            Ok(()) => {
                let (size, mtime) = stat(to).unwrap_or((0, 0));
                j.add(&Entry::Final { from: op.from.clone(), tmp: s(&tmp), to: op.to.clone(), size, mtime });
                report(&mut out, ok(i));
            }
            Err(e) => {
                if fs::rename(&tmp, &op.from).is_ok() {
                    j.add(&Entry::Restored { tmp: s(&tmp), to: op.from.clone() });
                }
                report(&mut out, fail(i, &e));
            }
        }
    }

    // Copies, in order.
    let none = HashSet::new();
    for (i, op) in ops.iter().enumerate().filter(|(_, o)| o.kind == Kind::Copy) {
        if stop() {
            report(&mut out, cancelled(i));
            continue;
        }
        let to = Path::new(&op.to);
        let copied = clear_target(&mut j, ctx.bin, op, to, &none)
            .and_then(|_| ensure_parent(to))
            .and_then(|_| fs::copy(&op.from, to).map(|_| ()));
        match copied {
            Ok(()) => {
                let (size, mtime) = stat(to).unwrap_or((0, 0));
                j.add(&Entry::Copy { from: op.from.clone(), to: op.to.clone(), size, mtime });
                report(&mut out, ok(i));
            }
            Err(e) => report(&mut out, fail(i, &e)),
        }
    }

    out.sort_by_key(|r| r.i);
    Ok(out)
}

/// Puts back files left under a temporary name by an interrupted run. Returns how many.
pub fn recover(journal: &Path) -> io::Result<usize> {
    let entries = match read_journal(journal) {
        Ok(e) => e,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e),
    };
    let settled: HashSet<&str> = entries
        .iter()
        .filter_map(|e| match e {
            Entry::Final { tmp, .. } | Entry::Restored { tmp, .. } => Some(tmp.as_str()),
            _ => None,
        })
        .collect();
    let mut j = Journal::open(journal)?;
    let mut n = 0;
    for e in &entries {
        if let Entry::Temp { from, tmp } = e {
            let (tmp_p, from_p) = (Path::new(tmp), Path::new(from));
            if settled.contains(tmp.as_str()) || !exists(tmp_p) || exists(from_p) {
                continue;
            }
            if fs::rename(tmp_p, from_p).is_ok() {
                j.add(&Entry::Restored { tmp: tmp.clone(), to: from.clone() });
                n += 1;
            }
        }
    }
    Ok(n)
}

/// Undoes a batch: copies go to the Recycle Bin, renames are reversed, replaced files come back.
/// Files that changed since the batch are left alone and reported. Safe to run again.
pub fn undo(ctx: &Ctx, undo_journal: &Path) -> io::Result<UndoReport> {
    recover(ctx.journal)?;
    recover(undo_journal)?;
    let entries = read_journal(ctx.journal)?;
    let mut rep = UndoReport::default();
    let same = |p: &str, size: u64, mtime: u64| stat(Path::new(p)).is_ok_and(|st| st == (size, mtime));

    for e in entries.iter().rev() {
        if let Entry::Copy { to, size, mtime, .. } = e {
            if !exists(Path::new(to)) {
                continue; // already gone
            }
            if !same(to, *size, *mtime) {
                rep.skipped.push(Skipped { path: to.clone(), reason: "changed since it was copied".into() });
                continue;
            }
            match ctx.bin.trash(Path::new(to)) {
                Ok(()) => rep.restored += 1,
                Err(err) => rep.skipped.push(Skipped { path: to.clone(), reason: err.to_string() }),
            }
        }
    }

    let mut back: Vec<Op> = Vec::new();
    for e in entries.iter().rev() {
        if let Entry::Final { from, to, size, mtime, .. } = e {
            if same(to, *size, *mtime) {
                back.push(Op { kind: Kind::Rename, from: to.clone(), to: from.clone(), replace: false });
            } else if !same(from, *size, *mtime) {
                rep.skipped.push(Skipped { path: to.clone(), reason: "changed or moved since it was renamed".into() });
            } // else: already back under its old name
        }
    }
    let ctx2 = Ctx { journal: undo_journal, bin: ctx.bin, progress: ctx.progress, cancel: ctx.cancel };
    for (op, r) in back.iter().zip(apply(&ctx2, "undo", &back)?) {
        if r.ok {
            rep.restored += 1;
        } else {
            rep.skipped.push(Skipped { path: op.from.clone(), reason: r.message.unwrap_or_else(|| "could not be restored".into()) });
        }
    }

    for e in entries.iter().rev() {
        if let Entry::Trash { path } = e {
            if exists(Path::new(path)) {
                continue; // already back, or its rename could not be reversed (reported above)
            }
            if let Err(err) = ctx.bin.restore(Path::new(path)) {
                rep.skipped.push(Skipped { path: path.clone(), reason: format!("restore it from the Recycle Bin ({err})") });
            }
        }
    }
    Ok(rep)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// Test double for the Recycle Bin: moves files into `_bin` and back.
    struct FakeBin {
        dir: PathBuf,
        items: RefCell<Vec<(PathBuf, PathBuf)>>,
    }
    impl Bin for FakeBin {
        fn trash(&self, p: &Path) -> io::Result<()> {
            let mut items = self.items.borrow_mut();
            let dest = self.dir.join(items.len().to_string());
            fs::rename(p, &dest)?;
            items.push((p.to_path_buf(), dest));
            Ok(())
        }
        fn restore(&self, p: &Path) -> io::Result<()> {
            let mut items = self.items.borrow_mut();
            let i = items.iter().rposition(|(orig, _)| key(orig) == key(p)).ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))?;
            let (orig, dest) = items.remove(i);
            fs::rename(dest, orig)
        }
    }

    struct T {
        _dir: tempfile::TempDir,
        root: PathBuf,
        bin: FakeBin,
    }
    impl T {
        fn new() -> Self {
            let d = tempfile::tempdir().unwrap();
            let root = d.path().to_path_buf();
            let dir = root.join("_bin");
            fs::create_dir_all(&dir).unwrap();
            Self { bin: FakeBin { dir, items: RefCell::new(vec![]) }, root, _dir: d }
        }
        fn p(&self, name: &str) -> String {
            s(&self.root.join(name))
        }
        fn write(&self, name: &str, text: &str) -> String {
            let p = self.p(name);
            fs::write(&p, text).unwrap();
            p
        }
        fn read(&self, name: &str) -> String {
            fs::read_to_string(self.root.join(name)).unwrap()
        }
        /// File names in the test folder, without the `_bin` / `_journal` helpers.
        fn names(&self) -> Vec<String> {
            let mut v: Vec<String> = fs::read_dir(&self.root)
                .unwrap()
                .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .filter(|n| !n.starts_with('_'))
                .collect();
            v.sort();
            v
        }
        fn journal(&self) -> PathBuf {
            self.root.join("_journal").join("b1.jsonl")
        }
        fn apply(&self, ops: &[Op]) -> Vec<OpResult> {
            let (j, cancel, noop) = (self.journal(), AtomicBool::new(false), |_: usize, _: usize| {});
            apply(&Ctx { journal: &j, bin: &self.bin, progress: &noop, cancel: &cancel }, "b1", ops).unwrap()
        }
        fn undo(&self) -> UndoReport {
            let (j, uj, cancel, noop) = (self.journal(), self.root.join("_journal").join("b1.undo.jsonl"), AtomicBool::new(false), |_: usize, _: usize| {});
            undo(&Ctx { journal: &j, bin: &self.bin, progress: &noop, cancel: &cancel }, &uj).unwrap()
        }
    }
    fn rn(from: &str, to: &str) -> Op {
        Op { kind: Kind::Rename, from: from.into(), to: to.into(), replace: false }
    }
    fn cp(from: &str, to: &str) -> Op {
        Op { kind: Kind::Copy, from: from.into(), to: to.into(), replace: false }
    }

    #[test]
    fn renames_and_journals_each_op() {
        let t = T::new();
        let (a, b) = (t.write("a.pdf", "A"), t.write("b.pdf", "B"));
        let r = t.apply(&[rn(&a, &t.p("x.pdf")), rn(&b, &t.p("y.pdf"))]);
        assert!(r.iter().all(|r| r.ok), "{r:?}");
        assert_eq!(t.names(), ["x.pdf", "y.pdf"]);
        let finals = read_journal(&t.journal()).unwrap().into_iter().filter(|e| matches!(e, Entry::Final { .. })).count();
        assert_eq!(finals, 2);
    }

    #[test]
    fn swaps_and_cycles() {
        let t = T::new();
        let (a, b, c) = (t.write("a.pdf", "A"), t.write("b.pdf", "B"), t.write("c.pdf", "C"));
        let r = t.apply(&[rn(&a, &b), rn(&b, &c), rn(&c, &a)]);
        assert!(r.iter().all(|r| r.ok), "{r:?}");
        assert_eq!((t.read("a.pdf"), t.read("b.pdf"), t.read("c.pdf")), ("C".into(), "A".into(), "B".into()));
    }

    #[test]
    fn case_only_rename() {
        let t = T::new();
        let a = t.write("inv.pdf", "A");
        assert!(t.apply(&[rn(&a, &t.p("INV.pdf"))])[0].ok);
        assert_eq!(t.names(), ["INV.pdf"]);
    }

    #[test]
    fn existing_target_is_not_overwritten() {
        let t = T::new();
        let (a, x) = (t.write("a.pdf", "A"), t.write("x.pdf", "X"));
        let r = t.apply(&[rn(&a, &x)]);
        assert_eq!(r[0].code, Some("exists"));
        assert_eq!((t.read("a.pdf"), t.read("x.pdf")), ("A".into(), "X".into()));
    }

    #[test]
    fn replace_sends_old_file_to_bin_and_undo_brings_it_back() {
        let t = T::new();
        let (a, x) = (t.write("a.pdf", "A"), t.write("x.pdf", "OLD"));
        let mut op = rn(&a, &x);
        op.replace = true;
        assert!(t.apply(&[op])[0].ok);
        assert_eq!(t.read("x.pdf"), "A");
        let rep = t.undo();
        assert_eq!(rep.skipped, vec![]);
        assert_eq!((t.read("a.pdf"), t.read("x.pdf")), ("A".into(), "OLD".into()));
    }

    #[cfg(windows)]
    #[test]
    fn locked_file_fails_alone_and_keeps_its_name() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = T::new();
        let (a, b, c) = (t.write("a.pdf", "A"), t.write("b.pdf", "B"), t.write("c.pdf", "C"));
        let lock = OpenOptions::new().read(true).share_mode(0).open(&b).unwrap();
        let r = t.apply(&[rn(&a, &b), rn(&b, &a), rn(&c, &t.p("z.pdf"))]);
        assert_eq!(r[1].code, Some("locked"));
        assert_eq!(r[0].code, Some("exists")); // b never stepped aside, so a goes back to its own name
        assert!(r[2].ok);
        drop(lock);
        assert_eq!((t.read("a.pdf"), t.read("b.pdf"), t.read("z.pdf")), ("A".into(), "B".into(), "C".into()));
        assert!(!t.names().iter().any(|n| n.contains(".~vellova-")));
    }

    #[test]
    fn copies_create_folders_and_undo_sends_them_to_the_bin() {
        let t = T::new();
        let a = t.write("a.pdf", "A");
        let to = s(&t.root.join("out").join("X.pdf"));
        assert!(t.apply(&[cp(&a, &to)])[0].ok);
        assert_eq!(fs::read_to_string(&to).unwrap(), "A");
        let rep = t.undo();
        assert_eq!(rep.restored, 1);
        assert!(!Path::new(&to).exists());
        assert_eq!(t.read("a.pdf"), "A");
    }

    #[test]
    fn undo_skips_changed_files_and_is_repeatable() {
        let t = T::new();
        let (a, b) = (t.write("a.pdf", "A"), t.write("b.pdf", "B"));
        t.apply(&[rn(&a, &t.p("x.pdf")), rn(&b, &t.p("y.pdf"))]);
        fs::write(t.root.join("y.pdf"), "edited by the user").unwrap();
        let rep = t.undo();
        assert_eq!((rep.restored, rep.skipped.len()), (1, 1));
        assert_eq!(t.names(), ["a.pdf", "y.pdf"]);
        let again = t.undo();
        assert_eq!((again.restored, again.skipped.len()), (0, 1));
        assert_eq!(t.names(), ["a.pdf", "y.pdf"]);
    }

    #[test]
    fn recover_puts_back_files_left_mid_batch() {
        let t = T::new();
        let a = t.write("a.pdf", "A");
        let tmp = t.p(".~vellova-b1-1-0.tmp");
        fs::rename(&a, &tmp).unwrap();
        Journal::open(&t.journal()).unwrap().add(&Entry::Temp { from: a.clone(), tmp });
        assert_eq!(recover(&t.journal()).unwrap(), 1);
        assert_eq!(t.names(), ["a.pdf"]);
        assert_eq!(recover(&t.journal()).unwrap(), 0);
    }

    #[test]
    fn cancel_leaves_remaining_files_alone() {
        let t = T::new();
        let a = t.write("a.pdf", "A");
        let (j, cancel, noop) = (t.journal(), AtomicBool::new(true), |_: usize, _: usize| {});
        let r = apply(&Ctx { journal: &j, bin: &t.bin, progress: &noop, cancel: &cancel }, "b1", &[rn(&a, &t.p("x.pdf"))]).unwrap();
        assert_eq!(r[0].code, Some("cancelled"));
        assert_eq!(t.names(), ["a.pdf"]);
    }

    #[test]
    fn error_codes() {
        assert_eq!(code(&io::Error::from_raw_os_error(2)), "missing");
        assert_eq!(code(&io::Error::from_raw_os_error(5)), "permission");
        assert_eq!(code(&io::Error::from_raw_os_error(32)), "locked");
        assert_eq!(code(&io::Error::from_raw_os_error(183)), "exists");
        assert_eq!(code(&io::Error::other("x")), "internal");
    }
}
```

- [ ] **Step 5: Run the Rust tests to make sure they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: `test result: ok. 14 passed` (11 in `ops`, 3 in `files`).

- [ ] **Step 6: Add the file commands to `src-tauri/src/files.rs`**

Change the `use` lines at the top of `files.rs` to:

```rust
use crate::ops::{self, Op, OpResult, UndoReport};
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
```

Append above `#[cfg(test)]`:

```rust
static CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(serde::Serialize)]
pub struct FileInfo {
    path: String,
    size: u64,
    mtime: u64,
}

/// Raw bytes of a file, sent to the WebView without JSON encoding. Errors read "<code>: <message>".
#[tauri::command]
pub async fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| format!("{}: {e}", ops::code(&e)))
}

/// Files under the given paths. Folders are listed one level deep, or fully with `recursive`.
#[tauri::command]
pub async fn list_files(paths: Vec<String>, recursive: bool) -> Vec<FileInfo> {
    let mut out = Vec::new();
    for p in paths {
        walk(Path::new(&p), recursive, true, &mut out);
    }
    out
}

fn walk(p: &Path, recursive: bool, top: bool, out: &mut Vec<FileInfo>) {
    let Ok(md) = fs::metadata(p) else { return };
    if md.is_file() {
        let ours = p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(".~vellova-"));
        if !ours {
            out.push(FileInfo { path: p.to_string_lossy().into_owned(), size: md.len(), mtime: ops::mtime_ms(&md) });
        }
    } else if md.is_dir() && (top || recursive) {
        // ponytail: read_dir order (NTFS name order) is what Nomina 1.4.6 saw, and it decides who gets " (1)"
        if let Ok(rd) = fs::read_dir(p) {
            for e in rd.flatten() {
                walk(&e.path(), recursive, false, out);
            }
        }
    }
}

/// Every entry in the given folders (missing folders give nothing), for conflict checks.
#[tauri::command]
pub async fn list_dir(dirs: Vec<String>) -> Vec<String> {
    dirs.iter()
        .filter_map(|d| fs::read_dir(d).ok())
        .flat_map(|rd| rd.flatten().map(|e| e.path().to_string_lossy().into_owned()))
        .collect()
}

fn journal(app: &AppHandle, batch: &str, suffix: &str) -> Result<PathBuf, String> {
    if batch.is_empty() || !batch.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("invalid batch id".into());
    }
    Ok(data_dir(app)?.join("journal").join(format!("{batch}{suffix}")))
}

#[tauri::command]
pub async fn apply_plan(app: AppHandle, batch: String, ops: Vec<Op>) -> Result<Vec<OpResult>, String> {
    let path = journal(&app, &batch, ".jsonl")?;
    CANCEL.store(false, Ordering::SeqCst);
    let progress = |done: usize, total: usize| {
        let _ = app.emit("plan-progress", (done, total));
    };
    let ctx = ops::Ctx { journal: &path, bin: &ops::RecycleBin, progress: &progress, cancel: &CANCEL };
    ops::apply(&ctx, &batch, &ops).map_err(err)
}

#[tauri::command]
pub async fn undo_batch(app: AppHandle, batch: String) -> Result<UndoReport, String> {
    let path = journal(&app, &batch, ".jsonl")?;
    let undo_path = journal(&app, &batch, ".undo.jsonl")?;
    CANCEL.store(false, Ordering::SeqCst);
    let progress = |_: usize, _: usize| {};
    let ctx = ops::Ctx { journal: &path, bin: &ops::RecycleBin, progress: &progress, cancel: &CANCEL };
    ops::undo(&ctx, &undo_path).map_err(err)
}

/// Stops a running batch before its next file; files already moved aside still reach their names.
#[tauri::command]
pub fn cancel_apply() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Puts back files left under temporary names by a run that was interrupted (crash, power cut).
#[tauri::command]
pub async fn recover_all(app: AppHandle) -> Result<usize, String> {
    let Ok(rd) = fs::read_dir(data_dir(&app)?.join("journal")) else { return Ok(0) };
    Ok(rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
        .map(|p| ops::recover(&p).unwrap_or(0))
        .sum())
}
```

`src-tauri/src/lib.rs`: add `mod ops;` under `mod files;`, and replace the `generate_handler!` list with:

```rust
        .invoke_handler(tauri::generate_handler![
            files::data_read,
            files::data_write,
            files::data_rename,
            files::read_legacy,
            files::save_text,
            files::read_file,
            files::list_files,
            files::list_dir,
            files::apply_plan,
            files::undo_batch,
            files::cancel_apply,
            files::recover_all,
        ])
```

- [ ] **Step 7: Write the failing TypeScript test for error mapping**

`test/ipc.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ipcReason } from '../src/lib/shared/ipc';

describe('ipcReason', () => {
  it('reads the reason code Rust puts in front of the message', () => {
    expect(ipcReason('locked: The process cannot access the file (os error 32)')).toEqual({
      reason: 'locked', detail: 'The process cannot access the file (os error 32)',
    });
    expect(ipcReason('missing: not found')).toEqual({ reason: 'missing', detail: 'not found' });
  });

  it('treats anything else as unreadable', () => {
    expect(ipcReason('internal: weird')).toEqual({ reason: 'unreadable', detail: 'internal: weird' });
    expect(ipcReason(new Error('boom'))).toEqual({ reason: 'unreadable', detail: 'Error: boom' });
  });
});
```

Run: `npx vitest run test/ipc.test.ts`
Expected: FAIL, `ipcReason is not a function` (or `does not provide an export named 'ipcReason'`).

- [ ] **Step 8: Write the full `src/lib/shared/ipc.ts`**

```ts
import { invoke } from '@tauri-apps/api/core';
import type { FileInfo, Op, Reason } from './types';

export type OpResult = { i: number; ok: boolean; code?: Reason | 'cancelled'; message?: string };
export type UndoReport = { restored: number; skipped: { path: string; reason: string }[] };

export const ipc = {
  dataRead: (name: string) => invoke<string | null>('data_read', { name }),
  dataWrite: (name: string, text: string) => invoke<void>('data_write', { name, text }),
  dataRename: (from: string, to: string) => invoke<void>('data_rename', { from, to }),
  readLegacy: (files: string[]) => invoke<(string | null)[]>('read_legacy', { files }),
  saveText: (path: string, text: string) => invoke<void>('save_text', { path, text }),
  readFile: async (path: string) => new Uint8Array(await invoke<ArrayBuffer>('read_file', { path })),
  listFiles: (paths: string[], recursive: boolean) => invoke<FileInfo[]>('list_files', { paths, recursive }),
  listDir: (dirs: string[]) => invoke<string[]>('list_dir', { dirs }),
  applyPlan: (batch: string, ops: Op[]) => invoke<OpResult[]>('apply_plan', { batch, ops }),
  undoBatch: (batch: string) => invoke<UndoReport>('undo_batch', { batch }),
  cancelApply: () => invoke<void>('cancel_apply'),
  recoverAll: () => invoke<number>('recover_all'),
};

const FILE_REASONS: Reason[] = ['missing', 'permission', 'locked'];

/** Turns a `read_file` rejection ("locked: …") into a reason for the preview. */
export function ipcReason(e: unknown): { reason: Reason; detail: string } {
  const msg = String(e);
  const code = msg.slice(0, msg.indexOf(':')) as Reason;
  return FILE_REASONS.includes(code) ? { reason: code, detail: msg.slice(code.length + 1).trim() } : { reason: 'unreadable', detail: msg };
}
```

Run: `npx vitest run test/ipc.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Recover interrupted batches at startup**

In `src/main.ts`, add `import { ipc } from './lib/shared/ipc';` and, inside `.finally(() => { … })` after `void getCurrentWindow().show();`, add:

```ts
    void ipc.recoverAll().then((n) => {
      if (n) log({ level: 'warn', tool: 'app', message: `${n} file(s) from an interrupted batch were put back under their original names.` });
    });
```

- [ ] **Step 10: Check**

Run: `npm test && npm run check && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: every suite passes, `0 errors`, and cargo shows `Finished`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -F- <<'EOF'
feat: journaled plan executor with two-phase renames, Recycle Bin replace, undo and crash recovery

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 6: PDF items and the 1.4.6 value finder

**Files:**
- Create: `src/lib/rename/engine/pdfItems.ts`, `src/lib/rename/engine/findValue.ts`, `test/findValue.test.ts`

**Interfaces:**
- Consumes: `Position` from `types.ts`.
- Produces:
  - `pdfItems.ts`:
    - `type Item = { str: string; x: number; y: number; page: number }`
    - `type DocLike` (structural subset of a pdf.js document)
    - `extractItems(doc: DocLike): Promise<Item[]>`
    - `classifyPdfError(e): { reason: 'unreadable' | 'internal'; detail: string }`
  - `findValue.ts`:
    - `type FindResult = { ok: true; value } | { ok: false; reason: 'keyword-not-found' | 'no-value' | 'no-text'; detail }`
    - `keywordHits(items, keyword): number[]`
    - `findValue(items, keyword, position, occurrence = 1): FindResult`
  - Both files use **only `import type`**, so Node can run them directly in `scripts/compare.mjs`.

- [ ] **Step 1: Write the failing test**

`test/findValue.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyPdfError, extractItems, type DocLike, type Item } from '../src/lib/rename/engine/pdfItems';
import { findValue, keywordHits } from '../src/lib/rename/engine/findValue';

const item = (str: string, x: number, y: number, page = 1): Item => ({ str, x, y, page });

describe('extractItems', () => {
  it('builds trimmed, non-empty items with y measured from the top (1.4.6)', async () => {
    const doc: DocLike = {
      numPages: 2,
      getPage: async (n) => ({
        getViewport: () => ({ height: 800 }),
        getTextContent: async () => ({
          items: n === 1
            ? [{ str: ' Invoice ', transform: [1, 0, 0, 1, 10, 700] }, { str: '   ', transform: [1, 0, 0, 1, 50, 700] }]
            : [{ str: 'X', transform: [1, 0, 0, 1, 5, 100] }],
        }),
      }),
    };
    expect(await extractItems(doc)).toEqual([item('Invoice', 10, 100, 1), item('X', 5, 700, 2)]);
  });

  it('explains unreadable PDFs and flags unknown failures as internal', () => {
    expect(classifyPdfError({ name: 'PasswordException', message: 'No password given' })).toEqual({ reason: 'unreadable', detail: 'This PDF is password-protected.' });
    expect(classifyPdfError({ name: 'InvalidPDFException', message: 'Invalid PDF structure.' }).reason).toBe('unreadable');
    expect(classifyPdfError(new Error('worker died'))).toEqual({ reason: 'internal', detail: 'worker died' });
  });
});

describe('keyword search (the three 1.4.6 passes)', () => {
  const items = [item('Total Invoice No.: x', 10, 10), item('Invoice No.:', 100, 50), item('Invoice', 100, 90), item('No:', 140, 90)];

  it('prefers an item equal to the keyword', () => expect(keywordHits(items, 'invoice no.:')).toEqual([1]));
  it('falls back to items containing it', () => expect(keywordHits(items, 'Total Invoice')).toEqual([0]));
  it('then joins consecutive items with single spaces; the hit is the last piece', () => {
    expect(keywordHits(items, 'Invoice No:')).toEqual([3]);
  });
  it('ignores case and surrounding spaces; an empty keyword finds nothing', () => {
    expect(keywordHits(items, '  INVOICE NO.:  ')).toEqual([1]);
    expect(keywordHits(items, '   ')).toEqual([]);
  });
});

describe('value position', () => {
  const line = [
    item('Header', 100, 20),
    item('Invoice No.:', 100, 100),
    item('far right', 400, 100),
    item('INV-1', 200, 101),
    item('off the line', 150, 109),
    item('left', 20, 100),
    item('nearer left', 60, 99),
    item('touching', 101, 100),
  ];
  const grid = [
    item('Due date', 100, 100),
    item('same line', 300, 104),
    item('next row, far', 160, 115),
    item('next row, near', 101, 117),
    item('two rows down', 100, 140),
    item('row above', 100, 80),
    item('other page', 100, 115, 2),
  ];

  it('after: same line (|dy| <= 8), nearest to the right, more than 2 units away', () => {
    expect(findValue(line, 'Invoice No.:', 'after')).toEqual({ ok: true, value: 'INV-1' });
  });
  it('before: same line, nearest to the left', () => {
    expect(findValue(line, 'Invoice No.:', 'before')).toEqual({ ok: true, value: 'nearer left' });
  });
  it('below: nearest row down on the same page; within 3 units the one closer in x wins', () => {
    expect(findValue(grid, 'Due date', 'below')).toEqual({ ok: true, value: 'next row, near' });
  });
  it('above: nearest row up', () => {
    expect(findValue(grid, 'Due date', 'above')).toEqual({ ok: true, value: 'row above' });
  });
  it('after/before look at every page, as 1.4.6 did', () => {
    expect(findValue([item('Total', 100, 500, 1), item('42,00', 300, 500, 2)], 'Total', 'after')).toEqual({ ok: true, value: '42,00' });
  });
  it('reports no text layer, a missing keyword and a missing value', () => {
    expect(findValue([], 'x', 'after')).toMatchObject({ ok: false, reason: 'no-text' });
    expect(findValue(line, 'Order No', 'after')).toMatchObject({ ok: false, reason: 'keyword-not-found' });
    expect(findValue(line, 'far right', 'after')).toMatchObject({ ok: false, reason: 'no-value' });
  });
  it('occurrence picks the n-th hit', () => {
    const items = [item('No.:', 10, 10), item('A-1', 50, 10), item('No.:', 10, 30), item('B-2', 50, 30)];
    expect(findValue(items, 'No.:', 'after')).toEqual({ ok: true, value: 'A-1' });
    expect(findValue(items, 'No.:', 'after', 2)).toEqual({ ok: true, value: 'B-2' });
    expect(findValue(items, 'No.:', 'after', 3)).toMatchObject({ ok: false, reason: 'keyword-not-found' });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/findValue.test.ts`
Expected: FAIL, `Failed to load url ../src/lib/rename/engine/pdfItems`.

- [ ] **Step 3: Write `src/lib/rename/engine/pdfItems.ts`**

```ts
export type Item = { str: string; x: number; y: number; page: number };

type PageLike = {
  getViewport(o: { scale: number }): { height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
};
/** The part of a pdf.js document this module needs (lets tests pass a fake). */
export type DocLike = { numPages: number; getPage(n: number): Promise<PageLike> };

/** Text pieces with positions, built exactly like Nomina 1.4.6: trimmed, non-empty, y measured from the top. */
export async function extractItems(doc: DocLike): Promise<Item[]> {
  const items: Item[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const height = page.getViewport({ scale: 1 }).height;
    const tc = await page.getTextContent();
    for (const raw of tc.items as { str?: string; transform: number[] }[]) {
      const str = (raw.str ?? '').trim();
      if (!str) continue;
      items.push({ str, x: raw.transform[4], y: height - raw.transform[5], page: p });
    }
  }
  return items;
}

/** A plain-language reason for a PDF that pdf.js could not open. Unknown failures are 'internal' (e.g. a dead worker). */
export function classifyPdfError(e: unknown): { reason: 'unreadable' | 'internal'; detail: string } {
  const err = e as { name?: string; message?: string } | null;
  if (err?.name === 'PasswordException') return { reason: 'unreadable', detail: 'This PDF is password-protected.' };
  if (err?.name === 'InvalidPDFException' || err?.name === 'MissingPDFException') {
    return { reason: 'unreadable', detail: "This file isn't a readable PDF (it is damaged or empty)." };
  }
  return { reason: 'internal', detail: String(err?.message ?? e) };
}
```

- [ ] **Step 4: Write `src/lib/rename/engine/findValue.ts`**

```ts
import type { Position } from '../../shared/types';
import type { Item } from './pdfItems';

export type FindResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'keyword-not-found' | 'no-value' | 'no-text'; detail: string };

/** Nomina 1.4.6: items within 8 units vertically are on the same line. */
const LINE_TOL = 8;

// Port of Nomina 1.4.6 `extract-pdf-value` (main.js), rule for rule. The golden tests are the judge: don't improve it.

/**
 * Keyword hits, case-insensitive, first pass that finds anything wins:
 * items equal to the keyword; else items containing it; else runs of consecutive items that,
 * joined by single spaces, equal it (the hit is the run's last item).
 */
export function keywordHits(items: Item[], keyword: string): number[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];
  const lower = items.map((it) => it.str.toLowerCase());
  let hits = lower.flatMap((s, i) => (s === kw ? [i] : []));
  if (!hits.length) hits = lower.flatMap((s, i) => (s.includes(kw) ? [i] : []));
  if (!hits.length) {
    const words = kw.split(/\s+/);
    for (let i = 0; i <= items.length - words.length; i++) {
      if (lower.slice(i, i + words.length).join(' ') === kw) hits.push(i + words.length - 1);
    }
  }
  return hits;
}

/** The value next to the `occurrence`-th keyword hit (1 = what 1.4.6 returned). */
export function findValue(items: Item[], keyword: string, position: Position, occurrence = 1): FindResult {
  if (!items.length) return { ok: false, reason: 'no-text', detail: 'This PDF has no text layer (it may be a scan).' };
  const hits = keywordHits(items, keyword);
  const kwIndex = hits[occurrence - 1];
  if (kwIndex === undefined) {
    const detail = hits.length
      ? `"${keyword.trim()}" appears only ${hits.length} time(s) in this PDF.`
      : `Keyword "${keyword.trim()}" not found in this PDF.`;
    return { ok: false, reason: 'keyword-not-found', detail };
  }
  const kw = items[kwIndex];
  const others = items.filter((_, i) => i !== kwIndex);
  let cands: Item[];
  if (position === 'after') {
    // 1.4.6 did not check the page for after/before; neither do we
    cands = others.filter((it) => Math.abs(it.y - kw.y) <= LINE_TOL && it.x > kw.x + 2).sort((a, b) => a.x - b.x);
  } else if (position === 'before') {
    cands = others.filter((it) => Math.abs(it.y - kw.y) <= LINE_TOL && it.x < kw.x - 2).sort((a, b) => b.x - a.x);
  } else {
    const dir = position === 'below' ? 1 : -1;
    cands = others
      .filter((it) => it.page === kw.page && (it.y - kw.y) * dir > LINE_TOL)
      .sort((a, b) => {
        const dy = (a.y - b.y) * dir;
        return Math.abs(dy) > 3 ? dy : Math.abs(a.x - kw.x) - Math.abs(b.x - kw.x);
      });
  }
  return cands.length
    ? { ok: true, value: cands[0].str }
    : { ok: false, reason: 'no-value', detail: `Nothing found ${position} "${keyword.trim()}".` };
}
```

- [ ] **Step 5: Run the test to make sure it passes**

Run: `npx vitest run test/findValue.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/rename/engine test/findValue.test.ts
git commit -F- <<'EOF'
feat: port the Nomina 1.4.6 PDF value finder rule for rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 7: Synthetic fixtures, golden parity test, private compare

**Files:**
- Create: `scripts/make-fixtures.mjs`, `scripts/fixtures/invoice.html`, `scripts/golden-146.mjs`, `scripts/compare.mjs`
- Create: `test/golden-helpers.ts`, `test/golden.legacy.test.ts`, `test/golden.modern.test.ts`
- Create (generated, committed): `test/fixtures/*.pdf`, `test/fixtures/pair/*`, `test/fixtures/cases.json`, `test/fixtures/golden-146.json`

**Interfaces:**
- Consumes: `extractItems`, `findValue`, `classifyPdfError` (Task 6).
- Produces:
  - `test/fixtures/cases.json`: `{ "<file>.pdf": ["<keyword>", …] }`.
  - `test/fixtures/golden-146.json`: `{ "<file>.pdf": { "<keyword>|<position>": "<value>" | null } }`.
  - Companion fixtures in `test/fixtures/pair/` (used by Task 8): `export-17.xlsx`, `numbers.xlsx`, `decoy.xlsx`, `list-18.csv`, `remit-19.xml`, `note-17.txt`.
  - `scripts/golden-146.mjs` exports `extract146(bytes, keyword, position)`.

- [ ] **Step 1: Write the golden tests first**

`test/golden-helpers.ts`:

```ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { extractItems, type DocLike, type Item } from '../src/lib/rename/engine/pdfItems';
import { findValue } from '../src/lib/rename/engine/findValue';
import type { Position } from '../src/lib/shared/types';

const require = createRequire(import.meta.url);
export const golden: Record<string, Record<string, string | null>> = JSON.parse(readFileSync('test/fixtures/golden-146.json', 'utf8'));
export const cases: Record<string, string[]> = JSON.parse(readFileSync('test/fixtures/cases.json', 'utf8'));

/** Reads a fixture with pdf.js 3.11.174: 'legacy' is what Nomina 1.4.6 ran in Node, 'modern' is what the app runs in WebView2. */
export async function fixtureItems(build: 'legacy' | 'modern', file: string): Promise<Item[]> {
  const lib = require(build === 'legacy' ? 'pdfjs-dist/legacy/build/pdf.js' : 'pdfjs-dist/build/pdf.js');
  lib.GlobalWorkerOptions.workerSrc = false;
  const data = new Uint8Array(readFileSync(`test/fixtures/${file}`));
  const doc = await lib.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  try {
    return await extractItems(doc as DocLike);
  } finally {
    await doc.destroy();
  }
}

export async function expectParity(build: 'legacy' | 'modern', file: string) {
  const items = await fixtureItems(build, file);
  for (const [key, expected] of Object.entries(golden[file])) {
    const [keyword, position] = key.split('|');
    const r = findValue(items, keyword, position as Position);
    expect(r.ok ? r.value : null, `${file} ${key}`).toBe(expected);
  }
}
```

`test/golden.legacy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findValue } from '../src/lib/rename/engine/findValue';
import { classifyPdfError } from '../src/lib/rename/engine/pdfItems';
import { cases, expectParity, fixtureItems, golden } from './golden-helpers';

describe('parity with Nomina 1.4.6 (legacy build)', () => {
  it.each(Object.keys(golden))('%s', (file) => expectParity('legacy', file));
});

describe('fixtures', () => {
  it('golden covers every case and finds plenty of values', () => {
    expect(Object.keys(golden).sort()).toEqual(Object.keys(cases).sort());
    const values = Object.values(golden).flatMap((g) => Object.values(g));
    expect(values.filter((v) => v !== null).length).toBeGreaterThan(30);
  });

  it('known values come out as designed', async () => {
    const items = await fixtureItems('legacy', 'ssrs-same-line.pdf');
    expect(findValue(items, 'Invoice No.:', 'after')).toEqual({ ok: true, value: 'DN-2026-00017' });
    expect(findValue(items, 'Customer', 'below')).toEqual({ ok: true, value: 'Contoso Fake GmbH' });
  });

  it('occurrence 2 finds the second keyword', async () => {
    const items = await fixtureItems('legacy', 'ssrs-repeat.pdf');
    expect(findValue(items, 'Invoice No.:', 'after')).toEqual({ ok: true, value: 'CN-2026-00019' });
    expect(findValue(items, 'Invoice No.:', 'after', 2)).toEqual({ ok: true, value: 'DN-2026-00011' });
  });

  it('a scan reports no text layer', async () => {
    expect(findValue(await fixtureItems('legacy', 'scanned.pdf'), 'Invoice No.:', 'after')).toMatchObject({ ok: false, reason: 'no-text' });
  });

  it.each(['broken.pdf', 'empty.pdf'])('%s is reported as unreadable, not a crash', async (file) => {
    const err = await fixtureItems('legacy', file).then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    expect(classifyPdfError(err).reason).toBe('unreadable');
  });
});
```

`test/golden.modern.test.ts` (a separate file, so the two pdf.js builds never share a process):

```ts
import { describe, it } from 'vitest';
import { expectParity, golden } from './golden-helpers';

// The app runs pdf.js's browser build in WebView2; it must agree with the 1.4.6 reference too.
describe('parity with Nomina 1.4.6 (browser build, as in the app)', () => {
  it.each(Object.keys(golden))('%s', (file) => expectParity('modern', file));
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run test/golden.legacy.test.ts`
Expected: FAIL, `ENOENT: no such file or directory, open 'test/fixtures/golden-146.json'`.

- [ ] **Step 3: Write `scripts/fixtures/invoice.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Invoice</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font: 10pt Arial, sans-serif; color: #111; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  h1 { font-size: 16pt; margin: 0 0 4mm; }
  table.meta td { padding: 1mm 4mm 1mm 0; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 12mm; }
  table.lines th, table.lines td { border-bottom: 1px solid #999; padding: 2mm; text-align: left; }
  .total { margin-top: 6mm; text-align: right; font-weight: bold; }
</style>
</head>
<body>
  <div class="head">
    <div><h1>Litware Example AG</h1><div>Musterweg 9<br>8000 Beispielstadt</div></div>
    <table class="meta">
      <tr><td>Invoice No.:</td><td>LW-2026-0420</td></tr>
      <tr><td>Date</td><td>05.10.2026</td></tr>
      <tr><td>Customer No.</td><td>C-0031</td></tr>
    </table>
  </div>
  <table class="lines">
    <tr><th>Item</th><th>Qty</th><th>Amount</th></tr>
    <tr><td>Support hours</td><td>5</td><td>EUR 650.00</td></tr>
    <tr><td>Setup</td><td>1</td><td>EUR 195.00</td></tr>
  </table>
  <p class="total">Total EUR 845.00</p>
</body>
</html>
```

- [ ] **Step 4: Write `scripts/make-fixtures.mjs`**

```js
// Regenerates the synthetic test files in test/fixtures (fake companies, numbers and names only).
// Run: npm run fixtures   (then commit test/fixtures)
import {
  PDFDocument, PDFOperator, PDFOperatorNames, StandardFonts, beginText, endText, moveText, setFontAndSize,
} from 'pdf-lib';
import * as XLSX from 'xlsx';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = resolve('test/fixtures');
const PAIR = join(OUT, 'pair');
mkdirSync(PAIR, { recursive: true });
const A4 = [595.28, 841.89];
const FIXED = new Date(Date.UTC(2026, 0, 1));
/** keywords the golden script tries on each PDF (with every position) */
const cases = {};

async function pdf(name, keywords, draw) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(FIXED);
  doc.setModificationDate(FIXED);
  doc.setProducer('Vellova fixtures');
  doc.setCreator('make-fixtures.mjs');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage(A4);
  // t(): draw text with y measured from the top, like a report designer
  const t = (text, x, y, size = 9, f = font) => page.drawText(text, { x, y: A4[1] - y, size, font: f });
  await draw({ doc, page, font, bold, t });
  writeFileSync(join(OUT, name), await doc.save({ useObjectStreams: false }));
  cases[name] = keywords;
}

function letterhead({ t, bold }, title) {
  t('Northwind Testing Ltd', 40, 50, 14, bold);
  t('12 Example Street', 40, 66);
  t('1000 Sampletown', 40, 78);
  t(title, 40, 110, 12, bold);
}

function lines({ t }, y, rows) {
  t('Item', 40, y);
  t('Qty', 330, y);
  t('Amount', 470, y);
  rows.forEach(([what, qty, amount], i) => {
    t(what, 40, y + 16 * (i + 1));
    t(qty, 330, y + 16 * (i + 1));
    t(amount, 470, y + 16 * (i + 1));
  });
}

// SSRS writes each label and value as its own positioned box, and often splits labels in two.
await pdf('ssrs-same-line.pdf', ['Invoice No.:', 'Invoice No', 'No.:', 'Date:', 'Customer', 'Total'], (c) => {
  letterhead(c, 'DEBIT NOTE');
  const { t } = c;
  t('Invoice', 330, 140); t('No.:', 363, 140); t('DN-2026-00017', 430, 140);
  t('Date:', 330, 154); t('15.10.2026', 430, 154);
  t('Customer', 40, 140); t('Contoso Fake GmbH', 40, 154);
  lines(c, 220, [['Consulting', '3', '900,00'], ['Travel', '1', '334,50']]);
  t('Total', 330, 300, 9, c.bold); t('1.234,50', 470, 300, 9, c.bold);
});

await pdf('ssrs-no-colon.pdf', ['Invoice No', 'invoice no', 'Invoice Date', 'No', 'Amount due'], (c) => {
  letterhead(c, 'INVOICE');
  const { t } = c;
  t('Invoice No', 330, 140); t('INV 2026 00118', 430, 140);
  t('Invoice Date', 330, 154); t('01.10.2026', 430, 154);
  t('Amount due', 330, 168); t('EUR 2.500,00', 430, 168);
  t('Bill to', 40, 140); t('Fabrikam Example d.o.o.', 40, 154);
  lines(c, 220, [['Licence', '1', '2.500,00']]);
});

await pdf('ssrs-below.pdf', ['Debit note number', 'Due date', 'DN-2026-00018', 'Reference'], (c) => {
  letterhead(c, 'DEBIT NOTE');
  const { t } = c;
  t('Debit note number', 330, 140); t('Due date', 470, 140);
  t('DN-2026-00018', 331, 154); t('30.10.2026', 471, 154); // values one row below, nudged 1 pt like SSRS cells
  t('Reference', 40, 140); t('PO-55-0912', 40, 154);
  lines(c, 220, [['Service fee', '12', '1.200,00']]);
});

await pdf('ssrs-two-column.pdf', ['Invoice No.:', 'Order No.:', 'No.:', 'Date:', 'Bill to'], (c) => {
  letterhead(c, 'INVOICE');
  const { t } = c;
  t('Bill to', 40, 140); t('Tailspin Sample Inc.', 40, 154); t('Anystreet 5', 40, 166);
  t('Invoice', 330, 140); t('No.:', 363, 140); t('INV-2026-00119', 430, 140);
  t('Order', 330, 154); t('No.:', 357, 154); t('PO-2026-7781', 430, 154);
  t('Date:', 330, 168); t('02.10.2026', 430, 168);
  lines(c, 220, [['Hardware', '2', '640,00']]);
});

await pdf('ssrs-repeat.pdf', ['Invoice No.:', 'Total'], (c) => {
  letterhead(c, 'CREDIT NOTE');
  const { t } = c;
  t('Invoice No.:', 330, 140); t('CN-2026-00019', 430, 140);
  lines(c, 220, [['Refund', '1', '-120,00']]);
  t('Total', 330, 300); t('-120,00', 470, 300);
  t('Invoice No.:', 40, 700); t('DN-2026-00011', 120, 700); // second occurrence: the note this credit refers to
});

// One text-show per glyph, as some producers write.
await pdf('perglyph.pdf', ['Invoice No.:', 'Date:'], (c) => {
  const glyphs = (text, x, y, size = 9) => {
    for (const ch of text) {
      c.t(ch, x, y, size);
      x += c.font.widthOfTextAtSize(ch, size);
    }
  };
  glyphs('Invoice No.:', 330, 140); glyphs('INV-77120', 430, 140);
  glyphs('Date:', 330, 154); glyphs('03.10.2026', 430, 154);
});

// TJ arrays with kerning; a large gap splits the value the way some producers do.
await pdf('tj-kerning.pdf', ['Invoice No.:', 'Invoice', 'Date:'], ({ doc, page, font }) => {
  const F = page.node.newFontDictionary('FK', font.ref);
  const tj = (parts, x, y) =>
    page.pushOperators(
      beginText(),
      setFontAndSize(F, 9),
      moveText(x, A4[1] - y),
      PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [doc.context.obj(parts.map((p) => (typeof p === 'string' ? font.encodeText(p) : p)))]),
      endText(),
    );
  tj(['Invoice', -250, 'No.:'], 330, 140);
  tj(['INV', -20, '-2026', 300, '-0042'], 430, 140);
  tj(['Date:'], 330, 154);
  tj(['04.10.2026'], 430, 154);
});

// A scan: shapes only, no text layer.
await pdf('scanned.pdf', ['Invoice No.:'], ({ page }) => {
  for (let i = 0; i < 12; i++) page.drawRectangle({ x: 40, y: 760 - i * 40, width: 300 + (i % 3) * 60, height: 10 });
});

// Not PDFs at all: must be reported as unreadable.
writeFileSync(join(OUT, 'broken.pdf'), '%PDF-1.7\nthis is not really a pdf\n');
writeFileSync(join(OUT, 'empty.pdf'), '');

// An HTML invoice printed by a Chromium browser (Edge, Chrome or Playwright's headless shell).
function findBrowser() {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean);
  const candidates = [
    ...roots.map((r) => join(r, 'Microsoft/Edge/Application/msedge.exe')),
    ...roots.map((r) => join(r, 'Google/Chrome/Application/chrome.exe')),
  ];
  const pw = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).filter((d) => d.startsWith('chromium')).sort().reverse()) {
      candidates.push(join(pw, d, 'chrome-headless-shell-win64/chrome-headless-shell.exe'), join(pw, d, 'chrome-win64/chrome.exe'), join(pw, d, 'chrome-win/chrome.exe'));
    }
  }
  return candidates.find((c) => existsSync(c));
}
const HTML_KEYWORDS = ['Invoice No.:', 'Date', 'Customer No.', 'Total'];
const browser = findBrowser();
if (browser) {
  execFileSync(browser, ['--headless', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${join(OUT, 'html-print.pdf')}`, pathToFileURL(resolve('scripts/fixtures/invoice.html')).href], { stdio: 'ignore' });
}
if (existsSync(join(OUT, 'html-print.pdf'))) cases['html-print.pdf'] = HTML_KEYWORDS;
else console.warn('No Chromium browser found: html-print.pdf skipped');

// Companion files for pairing.
const book = (rows) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};
writeFileSync(join(PAIR, 'export-17.xlsx'), book([['Invoice No.:', 'Amount'], ['DN-2026-00017', 1234.5]]));
writeFileSync(join(PAIR, 'numbers.xlsx'), book([['Ref', 'Amount'], [12345, 10], ['  DN-2026-00011  ', 5]]));
writeFileSync(join(PAIR, 'decoy.xlsx'), book([['Invoice No.:'], ['DN-2026-99999']]));
writeFileSync(join(PAIR, 'list-18.csv'), '﻿Ref;Customer;Amount\r\n"DN-2026-00018";"Fabrikam; Example";"1.200,00"\r\n');
writeFileSync(join(PAIR, 'remit-19.xml'), '<?xml version="1.0"?>\n<remittance><ref>CN-2026-00019</ref></remittance>\n');
writeFileSync(join(PAIR, 'note-17.txt'), 'Payment for DN-2026-00017 received.\r\n');

writeFileSync(join(OUT, 'cases.json'), `${JSON.stringify(cases, null, 2)}\n`);
console.log(`wrote ${Object.keys(cases).length} PDFs with cases, plus broken.pdf, empty.pdf and ${PAIR}`);
```

- [ ] **Step 5: Write `scripts/golden-146.mjs` (the 1.4.6 handler verbatim)**

```js
// Records what Nomina 1.4.6's engine returns for every fixture × keyword × position.
// extract146 is the 1.4.6 `extract-pdf-value` handler from main.js, verbatim except that it takes
// bytes instead of a path. Do not "fix" it: it is the reference.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const POSITIONS = ['after', 'before', 'above', 'below'];

export async function extract146(bytes, keyword, position) {
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = false;

    const data = new Uint8Array(bytes);
    const doc = await pdfjsLib.getDocument({ data, verbosity: 0 }).promise;
    const allItems = [];

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      for (const item of tc.items) {
        const str = item.str.trim();
        if (!str) continue;
        allItems.push({
          str,
          x: item.transform[4],
          y: vp.height - item.transform[5], // flip Y: higher = lower on page
          page: p,
        });
      }
    }

    // Find keyword (case-insensitive, single or multi-word)
    const kwLower = keyword.trim().toLowerCase();
    let kwIndex = -1;

    // Exact match
    for (let i = 0; i < allItems.length; i++) {
      if (allItems[i].str.toLowerCase() === kwLower) { kwIndex = i; break; }
    }
    // Contains match
    if (kwIndex === -1) {
      for (let i = 0; i < allItems.length; i++) {
        if (allItems[i].str.toLowerCase().includes(kwLower)) { kwIndex = i; break; }
      }
    }
    // Multi-word consecutive match
    if (kwIndex === -1) {
      const words = kwLower.split(/\s+/);
      for (let i = 0; i <= allItems.length - words.length; i++) {
        const chunk = allItems.slice(i, i + words.length).map(x => x.str.toLowerCase()).join(' ');
        if (chunk === kwLower) { kwIndex = i + words.length - 1; break; }
      }
    }

    if (kwIndex === -1) return { success: false, error: `Keyword "${keyword}" not found in PDF` };

    const kw = allItems[kwIndex];
    const LINE_TOL = 8;
    let value = null;

    if (position === 'after') {
      const cands = allItems
        .filter((item, i) => i !== kwIndex && Math.abs(item.y - kw.y) <= LINE_TOL && item.x > kw.x + 2)
        .sort((a, b) => a.x - b.x);
      if (cands.length) value = cands[0].str;

    } else if (position === 'before') {
      const cands = allItems
        .filter((item, i) => i !== kwIndex && Math.abs(item.y - kw.y) <= LINE_TOL && item.x < kw.x - 2)
        .sort((a, b) => b.x - a.x);
      if (cands.length) value = cands[0].str;

    } else if (position === 'below') {
      const below = allItems
        .filter((item, i) => i !== kwIndex && item.y > kw.y + LINE_TOL && item.page === kw.page)
        .sort((a, b) => {
          const dy = a.y - b.y;
          if (Math.abs(dy) > 3) return dy;
          return Math.abs(a.x - kw.x) - Math.abs(b.x - kw.x);
        });
      if (below.length) value = below[0].str;

    } else if (position === 'above') {
      const above = allItems
        .filter((item, i) => i !== kwIndex && item.y < kw.y - LINE_TOL && item.page === kw.page)
        .sort((a, b) => {
          const dy = b.y - a.y;
          if (Math.abs(dy) > 3) return dy;
          return Math.abs(a.x - kw.x) - Math.abs(b.x - kw.x);
        });
      if (above.length) value = above[0].str;
    }

    if (!value) return { success: false, error: `No value found ${position} keyword "${keyword}"` };
    return { success: true, value };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = resolve('test/fixtures');
  const cases = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'));
  const golden = {};
  for (const [file, keywords] of Object.entries(cases)) {
    const bytes = readFileSync(join(dir, file));
    golden[file] = {};
    for (const keyword of keywords) {
      for (const position of POSITIONS) {
        const r = await extract146(bytes, keyword, position);
        golden[file][`${keyword}|${position}`] = r.success ? r.value : null;
      }
    }
  }
  writeFileSync(join(dir, 'golden-146.json'), `${JSON.stringify(golden, null, 2)}\n`);
  console.log('wrote test/fixtures/golden-146.json');
}
```

- [ ] **Step 6: Generate the fixtures and the golden file**

Run: `npm run fixtures`
Expected:
- `wrote 9 PDFs with cases, …` (8 if no browser was found).
- `wrote test/fixtures/golden-146.json`.

Open `test/fixtures/golden-146.json` and confirm `"ssrs-same-line.pdf"` has `"Invoice No.:|after": "DN-2026-00017"`.

- [ ] **Step 7: Run the golden tests to make sure they pass**

Run: `npx vitest run test/golden.legacy.test.ts test/golden.modern.test.ts`
Expected: PASS, in both files.

If a "known values come out as designed" assertion fails, the fixture layout doesn't produce the item it was meant to; adjust that fixture's coordinates, regenerate, and rerun. Never edit `golden-146.json` by hand.

- [ ] **Step 8: Write the private comparison `scripts/compare.mjs`**

```js
// Private check on real files: runs Nomina 1.4.6's engine and Vellova's engine on every PDF in a folder.
// Prints only counts and anonymous structure statistics, never file names or values.
// usage: npm run compare -- "<folder>" --keyword "<kw>" [--position after|before|above|below]
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { extract146 } from './golden-146.mjs';
import { extractItems } from '../src/lib/rename/engine/pdfItems.ts';
import { findValue } from '../src/lib/rename/engine/findValue.ts';

const require = createRequire(import.meta.url);
const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { keyword: { type: 'string' }, position: { type: 'string', default: 'after' } },
});
const folder = positionals[0];
if (!folder || !opts.keyword) {
  console.error('usage: npm run compare -- "<folder>" --keyword "<kw>" [--position after|before|above|below]');
  process.exit(2);
}

const lib = require('pdfjs-dist/build/pdf.js'); // the build the app runs
lib.GlobalWorkerOptions.workerSrc = false;

/** How many text items the keyword is spread over (1 = one item, 0 = not found). */
function pieces(items, keyword) {
  const kw = keyword.trim().toLowerCase();
  if (items.some((i) => i.str.toLowerCase().includes(kw))) return 1;
  const n = kw.split(/\s+/).length;
  for (let i = 0; i + n <= items.length; i++) {
    if (items.slice(i, i + n).map((x) => x.str.toLowerCase()).join(' ') === kw) return n;
  }
  return 0;
}

const files = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.pdf'));
let match = 0;
const mismatches = [];
for (const f of files) {
  const bytes = readFileSync(join(folder, f));
  const ref = await extract146(bytes, opts.keyword, opts.position);
  let mine;
  let stats = {};
  try {
    const doc = await lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
    const items = await extractItems(doc);
    mine = findValue(items, opts.keyword, opts.position);
    const lens = items.map((i) => i.str.length).sort((a, b) => a - b);
    const info = (await doc.getMetadata()).info ?? {};
    stats = {
      pages: doc.numPages,
      items: items.length,
      charsPerItem: { min: lens[0] ?? 0, median: lens[lens.length >> 1] ?? 0, max: lens.at(-1) ?? 0 },
      keywordPieces: pieces(items, opts.keyword),
      producer: String(info.Producer ?? 'unknown').replace(/[^\w .()-]/g, '').slice(0, 80),
    };
    await doc.destroy();
  } catch {
    mine = { ok: false, reason: 'unreadable' };
  }
  if ((ref.success ? ref.value : null) === (mine.ok ? mine.value : null)) match++;
  else mismatches.push({ ...stats, outcome: `1.4.6 ${ref.success ? 'value' : 'none'} / Vellova ${mine.ok ? 'value' : mine.reason}` });
}
console.log(`${match} of ${files.length} match`);
for (const m of mismatches) console.log(JSON.stringify(m));
```

- [ ] **Step 9: Run the compare script on the fixtures (they are not private, so this is a safe smoke test)**

Run: `npm run compare -- test/fixtures --keyword "Invoice No.:" --position after`
Expected: `11 of 11 match` (10 without `html-print.pdf`). `broken.pdf` and `empty.pdf` count as matches: both engines return no value. No lines with file names or values.

- [ ] **Step 10: Commit**

```bash
git add scripts test/golden-helpers.ts test/golden.legacy.test.ts test/golden.modern.test.ts test/fixtures
git commit -F- <<'EOF'
test: synthetic SSRS-style fixtures, golden parity with Nomina 1.4.6, private compare script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 8: Companion files and pairing

**Files:**
- Create: `src/lib/rename/engine/companion.ts`, `src/lib/rename/engine/pairing.ts`, `src/workers/sheet.worker.ts`, `src/lib/rename/companions.ts`, `test/pairing.test.ts`

**Interfaces:**
- Consumes: fixtures in `test/fixtures/pair/` (Task 7).
- Produces:
  - `companion.ts` (worker side, imports SheetJS):
    - `type CompanionData = { cells: string[] } | { text: string }`
    - `companionData(ext: string, bytes: Uint8Array): CompanionData`
  - `pairing.ts` (pure, no SheetJS): `pairCompanions(pdfs: { path; value }[], companions: { path; data: CompanionData }[]): Record<string, string>`, mapping companion path → PDF path.
  - `companions.ts` (browser): `readCompanion(ext, bytes): Promise<CompanionData>`, which runs in `sheet.worker.ts`. If the worker dies, pending calls reject with an `Error` carrying `internal: true`, and a fresh worker starts on the next call.

- [ ] **Step 1: Write the failing test**

`test/pairing.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { companionData, type CompanionData } from '../src/lib/rename/engine/companion';
import { pairCompanions } from '../src/lib/rename/engine/pairing';

const read = (f: string) => companionData(f.slice(f.lastIndexOf('.')), new Uint8Array(readFileSync(`test/fixtures/pair/${f}`)));
const cells = (d: CompanionData) => ('cells' in d ? d.cells : []);
const text = (d: CompanionData) => ('text' in d ? d.text : '');

describe('companion files are read once into values', () => {
  it('xlsx: every cell, trimmed, numbers as text', () => {
    expect(cells(read('numbers.xlsx'))).toEqual(expect.arrayContaining(['Ref', '12345', 'DN-2026-00011', '10', '5']));
  });
  it('csv: every field, with ; delimiters, quotes and a BOM', () => {
    expect(cells(read('list-18.csv'))).toEqual(expect.arrayContaining(['Ref', 'DN-2026-00018', 'Fabrikam; Example', '1.200,00']));
  });
  it('xml and txt: the raw text', () => {
    expect(text(read('remit-19.xml'))).toContain('<ref>CN-2026-00019</ref>');
    expect(text(read('note-17.txt'))).toContain('DN-2026-00017');
  });
});

describe('pairCompanions', () => {
  const pdfs = [
    { path: 'A.pdf', value: 'DN-2026-00017' },
    { path: 'B.pdf', value: 'DN-2026-00018' },
    { path: 'C.pdf', value: 'CN-2026-00019' },
  ];
  const comp = (path: string, data: CompanionData) => ({ path, data });

  it('pairs each companion with the PDF whose value it contains; decoys stay unpaired', () => {
    const got = pairCompanions(pdfs, [
      comp('x.xlsx', read('export-17.xlsx')), comp('l.csv', read('list-18.csv')),
      comp('r.xml', read('remit-19.xml')), comp('d.xlsx', read('decoy.xlsx')),
    ]);
    expect(got).toEqual({ 'x.xlsx': 'A.pdf', 'l.csv': 'B.pdf', 'r.xml': 'C.pdf' });
  });

  it('the first PDF in list order wins, like 1.4.6', () => {
    expect(pairCompanions([{ path: 'B.pdf', value: 'X' }, { path: 'A.pdf', value: 'Y' }], [comp('t.txt', { text: 'Y and X' })])).toEqual({ 't.txt': 'B.pdf' });
  });

  it('cells must match exactly; text matches anywhere (1.4.6)', () => {
    const short = [{ path: 'S.pdf', value: 'DN-2026-0001' }];
    expect(pairCompanions(short, [comp('x.xlsx', read('export-17.xlsx'))])).toEqual({});
    expect(pairCompanions(short, [comp('n.txt', read('note-17.txt'))])).toEqual({ 'n.txt': 'S.pdf' });
  });

  it('trims values and cells', () => {
    expect(pairCompanions([{ path: 'P.pdf', value: ' DN-2026-00011 ' }], [comp('n.xlsx', read('numbers.xlsx'))])).toEqual({ 'n.xlsx': 'P.pdf' });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/pairing.test.ts`
Expected: FAIL, `Failed to load url ../src/lib/rename/engine/companion`.

- [ ] **Step 3: Write `src/lib/rename/engine/companion.ts`**

```ts
import * as XLSX from 'xlsx';

/** What a companion file offers for matching: its cell values, or its raw text. */
export type CompanionData = { cells: string[] } | { text: string };

function cellsOf(wb: XLSX.WorkBook): string[] {
  const out = new Set<string>();
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '' });
    for (const row of rows) for (const cell of row) out.add(String(cell).trim());
  }
  out.delete('');
  return [...out];
}

/**
 * Reads a companion once. .xlsx: every cell, trimmed (as 1.4.6). .csv: every field, kept as text.
 * .txt / .xml: the raw text (1.4.6 matched with `includes`).
 */
export function companionData(ext: string, bytes: Uint8Array): CompanionData {
  if (ext === '.xlsx') return { cells: cellsOf(XLSX.read(bytes, { type: 'array' })) };
  const text = new TextDecoder().decode(bytes);
  if (ext === '.csv') return { cells: cellsOf(XLSX.read(text, { type: 'string', raw: true })) };
  return { text };
}
```

- [ ] **Step 4: Write `src/lib/rename/engine/pairing.ts`**

```ts
import type { CompanionData } from './companion';

/**
 * Companion path → PDF path. As in Nomina 1.4.6, the first PDF in list order whose value the companion
 * contains wins. Each companion is read once instead of once per PDF.
 */
export function pairCompanions(
  pdfs: { path: string; value: string }[],
  companions: { path: string; data: CompanionData }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of companions) {
    const cells = 'cells' in c.data ? new Set(c.data.cells) : null;
    const text = 'text' in c.data ? c.data.text : '';
    // ponytail: 1.4.6 searched a header==keyword column first, then every cell; both give the same yes/no, so one lookup is enough
    const hit = pdfs.find((p) => (cells ? cells.has(p.value.trim()) : text.includes(p.value.trim())));
    if (hit) out[c.path] = hit.path;
  }
  return out;
}
```

- [ ] **Step 5: Run the test to make sure it passes**

Run: `npx vitest run test/pairing.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Write the worker and its client**

`src/workers/sheet.worker.ts`:

```ts
import { companionData } from '../lib/rename/engine/companion';

type Req = { id: number; ext: string; bytes: Uint8Array };
const post = (m: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m);

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, ext, bytes } = e.data;
  try {
    post({ id, data: companionData(ext, bytes) });
  } catch (err) {
    post({ id, error: String((err as Error)?.message ?? err) });
  }
};
```

`src/lib/rename/companions.ts`:

```ts
import type { CompanionData } from './engine/companion';

type Waiting = { resolve: (d: CompanionData) => void; reject: (e: Error) => void };
let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, Waiting>();

function start(): Worker {
  const w = new Worker(new URL('../../workers/sheet.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number; data?: CompanionData; error?: string }>) => {
    const p = waiting.get(e.data.id);
    if (!p) return;
    waiting.delete(e.data.id);
    if (e.data.error !== undefined) p.reject(new Error(e.data.error));
    else p.resolve(e.data.data!);
  };
  // the worker died: fail what is pending as an internal error and start a fresh one next time
  w.onerror = (e) => {
    for (const p of waiting.values()) p.reject(Object.assign(new Error(e.message || 'The spreadsheet reader stopped.'), { internal: true }));
    waiting.clear();
    w.terminate();
    worker = null;
  };
  return w;
}

/** Reads a companion file (.xlsx/.csv/.xml/.txt) in the sheet worker. */
export function readCompanion(ext: string, bytes: Uint8Array): Promise<CompanionData> {
  const w = (worker ??= start());
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage({ id, ext, bytes }, [bytes.buffer]);
  });
}
```

- [ ] **Step 7: Check that the worker bundles**

Run: `npm run check && npm run build`
Expected: `0 errors`. The build lists `dist/assets/sheet.worker-*.js`. The main `index-*.js` must not contain SheetJS: `grep -c "SheetJS" dist/assets/index-*.js` prints `0`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/rename src/workers test/pairing.test.ts
git commit -F- <<'EOF'
feat: read companion files once in a worker and pair them with PDFs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 9: The Rename planner (duplicates, conflicts, copy mode, typed names)

**Files:**
- Create: `src/lib/rename/engine/files.ts`, `src/lib/rename/engine/profile.ts`, `src/lib/rename/engine/planner.ts`, `test/planner.test.ts`

**Interfaces:**
- Consumes:
  - `extOf`, `join`, `sanitize`, `splitExt`, `splitPath` (Task 3).
  - `Conflict`, `Destination`, `FileInfo`, `Op`, `PlanItem`, `Position`, `Reason`, `RenameProfile`, `Status` (Task 3).
- Produces:
  - `files.ts`:
    - `PDF = '.pdf'`
    - `COMPANIONS = ['.xlsx', '.txt', '.xml', '.csv']`, the companion types 1.4.6 accepted.
    - `SUPPORTED`
    - `pathKey(p): string`, a lower-case, backslash form used as a path's identity.
    - `mergeFiles(list: FileInfo[], add: FileInfo[]): FileInfo[]`
  - `profile.ts`:
    - `type RenameRules = { keyword; position; occurrence; prefix; suffix; pair: boolean; destination; conflict }`
    - `DEFAULT_RULES`
    - `rulesFromProfile(p): RenameRules`
    - `profileFromRules(r, name, id, desc = ''): RenameProfile`
  - `planner.ts`:
    - `type ValueResult = { ok: true; value } | { ok: false; reason: Reason; detail }`
    - `type PlanInput` (fields below)
    - `planRename(input): PlanItem[]`, one item per file, in list order, with `id === source`.
    - `summary(items, destination): { ops; attention; pending; label }`

`PlanInput`:

| Field | Meaning |
|---|---|
| `files: string[]` | paths in list order (the order decides who gets ` (1)`) |
| `values: Record<string, ValueResult>` | per PDF: the value, or why there is none; missing = still reading. Companions that can't be read appear here too, with `ok: false`. |
| `pairs: Record<string, string> \| null` | companion path → PDF path; `null` while files are still being read |
| `pairEnabled`, `prefix`, `suffix`, `destination`, `conflict` | the rules |
| `existing: Set<string>` | `pathKey` of every entry in the target folders |
| `overrides: Record<string, string>` | path → name typed in the preview (without extension) |
| `skipped: Set<string>` | paths the user skipped |

- [ ] **Step 1: Write the failing test**

`test/planner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mergeFiles } from '../src/lib/rename/engine/files';
import { planRename, summary, type PlanInput, type ValueResult } from '../src/lib/rename/engine/planner';
import { DEFAULT_RULES, profileFromRules, rulesFromProfile, type RenameRules } from '../src/lib/rename/engine/profile';
import type { PlanItem } from '../src/lib/shared/types';

const ok = (value: string): ValueResult => ({ ok: true, value });
const plan = (over: Partial<PlanInput>) =>
  planRename({
    files: [], values: {}, pairs: {}, pairEnabled: true, prefix: '', suffix: '',
    destination: { mode: 'inplace' }, conflict: 'add', existing: new Set(), overrides: {}, skipped: new Set(),
    ...over,
  });
const brief = (items: PlanItem[]) => items.map((i) => [i.status, i.name ?? null]);
const A = 'C:\\in\\a.pdf', B = 'C:\\in\\b.pdf', C = 'C:\\in\\c.pdf';

describe('planRename', () => {
  it('renames a PDF to prefix + value + suffix, extension lower-cased', () => {
    const [item] = plan({ files: ['C:\\in\\scan.PDF'], values: { 'C:\\in\\scan.PDF': ok('DN-2026-00017') }, prefix: 'CN_', suffix: '_x' });
    expect(item).toEqual({
      id: 'C:\\in\\scan.PDF', source: 'C:\\in\\scan.PDF', status: 'ready', name: 'CN_DN-2026-00017_x.pdf',
      op: { kind: 'rename', from: 'C:\\in\\scan.PDF', to: 'C:\\in\\CN_DN-2026-00017_x.pdf' },
    });
  });

  it('sanitizes the whole name, as 1.4.6 did', () => {
    expect(brief(plan({ files: [A, B], values: { [A]: ok('INV/17'), [B]: ok('CON') }, prefix: 'A:' }))).toEqual([
      ['ready', 'A_INV_17.pdf'], ['ready', 'A_CON.pdf'],
    ]);
    expect(plan({ files: [A], values: { [A]: ok('CON') } })[0].name).toBe('CON_.pdf');
  });

  it('equal values get (1), (2) in list order, and companions follow their PDF', () => {
    const X = 'C:\\in\\b.xlsx';
    const items = plan({ files: [A, B, C, X], values: { [A]: ok('DN-17'), [B]: ok('DN-17'), [C]: ok('DN-17') }, pairs: { [X]: B } });
    expect(brief(items)).toEqual([
      ['ready', 'DN-17.pdf'], ['duplicate', 'DN-17 (1).pdf'], ['duplicate', 'DN-17 (2).pdf'], ['paired', 'DN-17 (1).xlsx'],
    ]);
  });

  it('values that differ only by letter case still get unique names', () => {
    expect(brief(plan({ files: [A, B], values: { [A]: ok('inv-17'), [B]: ok('INV-17') } }))).toEqual([
      ['ready', 'inv-17.pdf'], ['duplicate', 'INV-17 (1).pdf'],
    ]);
  });

  it('a file that already has its name is unchanged; a case-only change is a rename', () => {
    const same = plan({ files: ['C:\\in\\DN-17.pdf'], values: { 'C:\\in\\DN-17.pdf': ok('DN-17') }, existing: new Set(['c:\\in\\dn-17.pdf']) });
    expect(same[0]).toMatchObject({ status: 'unchanged', op: null });
    const caseOnly = plan({ files: ['C:\\in\\dn-17.pdf'], values: { 'C:\\in\\dn-17.pdf': ok('DN-17') }, existing: new Set(['c:\\in\\dn-17.pdf']) });
    expect(caseOnly[0]).toMatchObject({ status: 'ready', op: { kind: 'rename', from: 'C:\\in\\dn-17.pdf', to: 'C:\\in\\DN-17.pdf' } });
  });

  it('a name already taken on disk follows Add (1) / Skip / Replace', () => {
    const base = { files: [A], values: { [A]: ok('DN-17') }, existing: new Set(['c:\\in\\a.pdf', 'c:\\in\\dn-17.pdf']) };
    expect(plan({ ...base, conflict: 'add' })[0]).toMatchObject({ status: 'ready', name: 'DN-17 (1).pdf' });
    expect(plan({ ...base, conflict: 'skip' })[0]).toMatchObject({ status: 'skipped', op: null, detail: 'DN-17.pdf already exists.' });
    expect(plan({ ...base, conflict: 'replace' })[0].op).toEqual({ kind: 'rename', from: A, to: 'C:\\in\\DN-17.pdf', replace: true });
  });

  it('a name freed by another file in the same batch is not a conflict, so swaps work', () => {
    const items = plan({ files: [A, B], values: { [A]: ok('b'), [B]: ok('a') }, existing: new Set(['c:\\in\\a.pdf', 'c:\\in\\b.pdf']), conflict: 'skip' });
    expect(items.map((i) => i.op)).toEqual([
      { kind: 'rename', from: A, to: 'C:\\in\\b.pdf' },
      { kind: 'rename', from: B, to: 'C:\\in\\a.pdf' },
    ]);
  });

  it('a name held by a file that stays put is a conflict', () => {
    const X = 'C:\\in\\x.pdf', Y = 'C:\\in\\y.pdf';
    const items = plan({
      files: [X, Y],
      values: { [X]: ok('y'), [Y]: { ok: false, reason: 'keyword-not-found', detail: 'Keyword "No." not found in this PDF.' } },
      existing: new Set(['c:\\in\\x.pdf', 'c:\\in\\y.pdf']),
    });
    expect(items[0]).toMatchObject({ status: 'ready', name: 'y (1).pdf' });
    expect(items[1]).toMatchObject({ status: 'attention', reason: 'keyword-not-found', op: null });
  });

  it('copy mode: waits for a folder, copies into it, and skips a copy onto itself', () => {
    const values = { [A]: ok('DN-17') };
    expect(plan({ files: [A], values, destination: { mode: 'copy', folder: '' } })[0]).toMatchObject({ status: 'pending', name: 'DN-17.pdf', op: null });
    expect(plan({ files: [A], values, destination: { mode: 'copy', folder: 'D:\\out' } })[0].op).toEqual({ kind: 'copy', from: A, to: 'D:\\out\\DN-17.pdf' });
    const self = plan({ files: ['C:\\in\\DN-17.pdf'], values: { 'C:\\in\\DN-17.pdf': ok('DN-17') }, destination: { mode: 'copy', folder: 'C:\\in' }, existing: new Set(['c:\\in\\dn-17.pdf']) });
    expect(self[0].status).toBe('unchanged');
  });

  it('PDFs still being read are pending; failures pass their reason through', () => {
    const items = plan({ files: [A, B], values: { [B]: { ok: false, reason: 'no-text', detail: 'This PDF has no text layer (it may be a scan).' } } });
    expect(items[0]).toMatchObject({ status: 'pending', op: null });
    expect(items[1]).toMatchObject({ status: 'attention', reason: 'no-text', detail: 'This PDF has no text layer (it may be a scan).' });
  });

  it('a typed name wins and is sanitized; an empty one needs attention', () => {
    expect(plan({ files: [A], values: {}, overrides: { [A]: 'Mine?' } })[0]).toMatchObject({ status: 'ready', name: 'Mine_.pdf' });
    expect(plan({ files: [A], values: { [A]: ok('x') }, overrides: { [A]: '   ' } })[0]).toMatchObject({ status: 'attention', reason: 'no-value' });
  });

  it('companions: unmatched, unreadable, waiting, pairing off, and following a skipped PDF', () => {
    const X = 'C:\\in\\x.xlsx', T = 'C:\\in\\t.txt';
    const values = { [A]: ok('DN-17'), [T]: { ok: false, reason: 'locked', detail: 'in use' } as ValueResult };
    expect(brief(plan({ files: [A, X, T], values, pairs: {} })).slice(1)).toEqual([['attention', null], ['attention', null]]);
    expect(plan({ files: [A, X], values, pairs: {} })[1].reason).toBe('no-match');
    expect(plan({ files: [A, X], values, pairs: null })[1].status).toBe('pending');
    expect(plan({ files: [A, X], values, pairs: { [X]: A }, pairEnabled: false })[1].status).toBe('unchanged');
    expect(plan({ files: [A, X], values, pairs: { [X]: A }, skipped: new Set([A]) }).map((i) => i.status)).toEqual(['skipped', 'skipped']);
  });

  it('summary counts what will happen', () => {
    const items = plan({ files: [A, B, C], values: { [A]: ok('1'), [B]: ok('2'), [C]: { ok: false, reason: 'no-value', detail: '' } } });
    expect(summary(items, { mode: 'inplace' })).toEqual({ ops: 2, attention: 1, pending: 0, label: 'Rename 2 files' });
    expect(summary(items.slice(0, 1), { mode: 'copy', folder: 'D:\\' }).label).toBe('Copy 1 file');
  });
});

describe('mergeFiles', () => {
  const f = (path: string) => ({ path, size: 1, mtime: 1 });
  it('lists a file once, however it was added, and keeps only supported types', () => {
    const list = mergeFiles([f('C:\\In\\a.pdf')], [f('c:/in/A.PDF'), f('C:\\In\\b.xlsx'), f('C:\\In\\notes.docx'), f('C:/In/b.xlsx')]);
    expect(list.map((x) => x.path)).toEqual(['C:\\In\\a.pdf', 'C:\\In\\b.xlsx']);
  });
});

describe('profiles', () => {
  it('rules round-trip through a profile', () => {
    const rules: RenameRules = {
      ...DEFAULT_RULES, keyword: 'Invoice No.:', position: 'below', occurrence: 2, prefix: 'CN_',
      destination: { mode: 'copy', folder: 'D:\\out' }, conflict: 'replace',
    };
    const p = profileFromRules(rules, 'Debit notes', 'p1');
    expect(p.steps).toEqual([
      { type: 'pdfValue', keyword: 'Invoice No.:', position: 'below', occurrence: 2 },
      { type: 'addText', prefix: 'CN_', suffix: '' },
    ]);
    expect(rulesFromProfile(p)).toEqual(rules);
  });

  it('a profile without steps gives the defaults', () => {
    expect(rulesFromProfile({ id: 'x', name: 'x', desc: '', steps: [], pair: true, destination: { mode: 'inplace' }, conflict: 'add' })).toEqual(DEFAULT_RULES);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/planner.test.ts`
Expected: FAIL, `Failed to load url ../src/lib/rename/engine/files`.

- [ ] **Step 3: Write `src/lib/rename/engine/files.ts`**

```ts
import { extOf } from '../../shared/names';
import type { FileInfo } from '../../shared/types';

export const PDF = '.pdf';
/** Files that take a PDF's name when they contain its value (the types Nomina 1.4.6 accepted). */
export const COMPANIONS = ['.xlsx', '.txt', '.xml', '.csv'];
export const SUPPORTED = [PDF, ...COMPANIONS];

/** A path's identity on Windows: case-insensitive, either slash. */
export const pathKey = (p: string) => p.replace(/\//g, '\\').toLowerCase();

/** Adds the supported files that aren't listed yet, keeping list order. */
export function mergeFiles(list: FileInfo[], add: FileInfo[]): FileInfo[] {
  const seen = new Set(list.map((f) => pathKey(f.path)));
  const out = [...list];
  for (const f of add) {
    const key = pathKey(f.path);
    if (seen.has(key) || !SUPPORTED.includes(extOf(f.path))) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
```

- [ ] **Step 4: Write `src/lib/rename/engine/profile.ts`**

```ts
import type { Conflict, Destination, Position, RenameProfile, Step } from '../../shared/types';

type ValueStep = Extract<Step, { type: 'pdfValue' }>;
type TextStep = Extract<Step, { type: 'addText' }>;

/** What the Rename screen edits; a profile stores the same as steps. */
export type RenameRules = {
  keyword: string;
  position: Position;
  occurrence: number;
  prefix: string;
  suffix: string;
  pair: boolean;
  destination: Destination;
  conflict: Conflict;
};

export const DEFAULT_RULES: RenameRules = {
  keyword: '',
  position: 'after',
  occurrence: 1,
  prefix: '',
  suffix: '',
  pair: true,
  destination: { mode: 'inplace' },
  conflict: 'add',
};

export function rulesFromProfile(p: RenameProfile): RenameRules {
  const value = p.steps.find((s): s is ValueStep => s.type === 'pdfValue');
  const text = p.steps.find((s): s is TextStep => s.type === 'addText');
  return {
    keyword: value?.keyword ?? '',
    position: value?.position ?? 'after',
    occurrence: value?.occurrence ?? 1,
    prefix: text?.prefix ?? '',
    suffix: text?.suffix ?? '',
    pair: p.pair,
    destination: { ...p.destination },
    conflict: p.conflict,
  };
}

export function profileFromRules(r: RenameRules, name: string, id: string, desc = ''): RenameProfile {
  return {
    id,
    name,
    desc,
    steps: [
      { type: 'pdfValue', keyword: r.keyword, position: r.position, occurrence: r.occurrence },
      { type: 'addText', prefix: r.prefix, suffix: r.suffix },
    ],
    pair: r.pair,
    destination: { ...r.destination },
    conflict: r.conflict,
  };
}
```

- [ ] **Step 5: Write `src/lib/rename/engine/planner.ts`**

```ts
import { extOf, join, sanitize, splitExt, splitPath } from '../../shared/names';
import type { Conflict, Destination, Op, PlanItem, Reason, Status } from '../../shared/types';
import { PDF, pathKey } from './files';

export type ValueResult = { ok: true; value: string } | { ok: false; reason: Reason; detail: string };

export type PlanInput = {
  /** paths in list order; the order decides who gets " (1)" */
  files: string[];
  /** PDF → value or why there is none (missing = still reading); unreadable companions too */
  values: Record<string, ValueResult>;
  /** companion → PDF; null while files are still being read */
  pairs: Record<string, string> | null;
  pairEnabled: boolean;
  prefix: string;
  suffix: string;
  destination: Destination;
  conflict: Conflict;
  /** pathKey of every entry in the target folders */
  existing: Set<string>;
  /** path → name typed in the preview, without extension */
  overrides: Record<string, string>;
  skipped: Set<string>;
};

const item = (source: string, status: Status, extra: Partial<PlanItem> = {}): PlanItem => ({ id: source, source, op: null, status, ...extra });

/** The preview: one item per file, in list order. */
export function planRename(input: PlanInput): PlanItem[] {
  // A name is free when its file moves away in this batch. Assume every file moves, then plan again with the
  // files that really do until nothing changes. A pass can only drop files, so this ends.
  let leaving = new Set(input.destination.mode === 'inplace' ? input.files.map(pathKey) : []);
  for (;;) {
    const items = planOnce(input, leaving);
    const next = new Set(items.filter((i) => i.op?.kind === 'rename').map((i) => pathKey(i.source)));
    if (next.size === leaving.size) return items;
    leaving = next;
  }
}

function planOnce(input: PlanInput, leaving: Set<string>): PlanItem[] {
  const { destination: dest, conflict, existing } = input;
  const used = new Set<string>();

  /** Gives `source` the first free name of `base`, `base (1)`, `base (2)`… in its target folder. */
  const place = (source: string, base: string, status: Status): PlanItem => {
    const ext = extOf(source);
    if (!base) return item(source, 'attention', { reason: 'no-value', detail: 'The new name would be empty.' });
    if (dest.mode === 'copy' && !dest.folder) return item(source, 'pending', { name: base + ext, detail: 'Choose a folder to copy into.' });
    const dir = dest.mode === 'copy' ? dest.folder : splitPath(source).dir;
    let dup = false;
    for (let k = 0; ; k++) {
      const name = `${k ? `${base} (${k})` : base}${ext}`;
      const to = join(dir, name);
      const key = pathKey(to);
      if (used.has(key)) {
        dup = true;
        continue;
      }
      const self = key === pathKey(source);
      const taken = !self && existing.has(key) && !leaving.has(key);
      if (taken && conflict === 'add') continue;
      if (taken && conflict === 'skip') return item(source, 'skipped', { name, detail: `${name} already exists.` });
      used.add(key);
      if (self && (dest.mode === 'copy' || splitPath(source).name === name)) return item(source, 'unchanged', { name });
      const op: Op = { kind: dest.mode === 'copy' ? 'copy' : 'rename', from: source, to, ...(taken ? { replace: true } : {}) };
      return item(source, dup ? 'duplicate' : status, { name, op });
    }
  };

  const out = new Map<string, PlanItem>();
  // PDFs and typed names claim names first; companions then take their PDF's final name.
  for (const f of input.files) {
    if (input.skipped.has(f)) out.set(f, item(f, 'skipped'));
    else if (f in input.overrides) out.set(f, place(f, sanitize(input.overrides[f]), 'ready'));
    else if (extOf(f) === PDF) {
      const v = input.values[f];
      if (!v) out.set(f, item(f, 'pending', { detail: 'Waiting for its value…' }));
      else if (!v.ok) out.set(f, item(f, 'attention', { reason: v.reason, detail: v.detail }));
      else out.set(f, place(f, sanitize(input.prefix + v.value + input.suffix), 'ready'));
    }
  }
  for (const f of input.files) {
    if (out.has(f)) continue;
    const v = input.values[f];
    const pdf = input.pairs?.[f];
    const pdfName = pdf ? out.get(pdf)?.name : undefined;
    if (!input.pairEnabled) out.set(f, item(f, 'unchanged', { detail: 'Pairing with PDFs is off.' }));
    else if (v && !v.ok) out.set(f, item(f, 'attention', { reason: v.reason, detail: v.detail }));
    else if (!input.pairs) out.set(f, item(f, 'pending', { detail: 'Waiting for the PDFs…' }));
    else if (!pdf) out.set(f, item(f, 'attention', { reason: 'no-match', detail: 'None of the PDF values appears in this file.' }));
    else if (!pdfName) out.set(f, item(f, 'skipped', { detail: 'Its PDF is not being renamed.' }));
    else out.set(f, place(f, splitExt(pdfName).base, 'paired'));
  }
  return input.files.map((f) => out.get(f)!);
}

export function summary(items: PlanItem[], destination: Destination) {
  const ops = items.filter((i) => i.op).length;
  const verb = destination.mode === 'copy' ? 'Copy' : 'Rename';
  return {
    ops,
    attention: items.filter((i) => i.status === 'attention').length,
    pending: items.filter((i) => i.status === 'pending').length,
    label: `${verb} ${ops} ${ops === 1 ? 'file' : 'files'}`,
  };
}
```

- [ ] **Step 6: Run the test to make sure it passes**

Run: `npx vitest run test/planner.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/rename/engine test/planner.test.ts
git commit -F- <<'EOF'
feat: rename planner with 1.4.6 duplicates, Add/Skip/Replace conflicts, swaps, copy mode and typed names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 10: The island

**Files:**
- Create: `src/lib/shell/island.ts`, `src/lib/shell/island.svelte.ts`, `src/lib/shell/Island.svelte`, `test/island.test.ts`
- Modify: `src/App.svelte` (temporary island check, replaced in Task 11)

**Interfaces:**
- Consumes:
  - `ui`, `setTheme`, `PanelName` (Task 2).
  - `switchTheme` (Task 2).
  - `data`, `save` (Task 4).
- Produces:
  - `island.ts` (pure):
    - `type Notice = 'attention' | 'done' | 'update'`
    - `type Layer = 'tools' | 'working' | Notice | 'restarting' | 'restored'`
    - `type IslandState`, `type IslandEvent`, `INITIAL`
    - `reduce(s, e): IslandState`
    - `layer(s): Layer`
    - `chips(s): Notice[]`
    - `noticeText(s, n)`
    - `layerText(s)`
    - `TIMEOUT_MS: Partial<Record<Layer, number>>`
  - `island.svelte.ts`: `island` (reactive `IslandState`), `send(e: IslandEvent)`. In dev, `window.__send` is exposed for CDP checks.
  - `Island.svelte`, with props `{ oncancel, onundo, onrestart }: () => void`.

Events:

| Event | Effect |
|---|---|
| `{ type: 'start', label, total, cancellable }` | Show *working* ("Renaming 3 of 12"). An open notice folds into its chip. `total: 0` gives the indeterminate sweep. |
| `{ type: 'progress', done, total }` | Move the bar. |
| `{ type: 'finish', text, attention }` | A batch ended. `text` (or null) becomes the Undo chip. Opens *attention* when `attention > 0`, else *done*. |
| `{ type: 'stop' }` | Activity ended without a batch (reading done, or cancelled). |
| `{ type: 'collapse' }` | The open notice folds into its chip; *restored* goes away. |
| `{ type: 'attention', count }` | Keeps the attention count in sync with the Rename screen. |
| `{ type: 'updateReady', version }` | Opens *update* unless another notice is open. |
| `{ type: 'restarting' }` / `{ type: 'restored', text }` / `{ type: 'clearTransient' }` | Short-lived layers. `restored` also removes the Undo chip. |

- [ ] **Step 1: Write the failing test**

`test/island.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chips, INITIAL, layer, layerText, reduce, TIMEOUT_MS, type IslandEvent, type IslandState } from '../src/lib/shell/island';

const run = (...events: IslandEvent[]) => events.reduce(reduce, INITIAL);
const start: IslandEvent = { type: 'start', label: 'Renaming', total: 12, cancellable: true };

describe('island', () => {
  it('idles on the tools with no chips', () => {
    expect(layer(INITIAL)).toBe('tools');
    expect(chips(INITIAL)).toEqual([]);
  });

  it('shows progress while working', () => {
    const s = run(start, { type: 'progress', done: 2, total: 12 });
    expect(layer(s)).toBe('working');
    expect(layerText(s)).toBe('Renaming 3 of 12');
    expect(layerText(run({ type: 'start', label: 'Undoing', total: 0, cancellable: false }))).toBe('Undoing…');
  });

  it('a clean batch shows done, then folds into the Undo chip', () => {
    const done = run(start, { type: 'finish', text: '12 files renamed', attention: 0 });
    expect(layer(done)).toBe('done');
    expect(layerText(done)).toBe('12 files renamed');
    const folded = reduce(done, { type: 'collapse' });
    expect(layer(folded)).toBe('tools');
    expect(chips(folded)).toEqual(['done']);
  });

  it('attention outranks done; chips are ordered attention, undo, update', () => {
    let s = run(start, { type: 'finish', text: '9 files renamed', attention: 3 });
    expect(layer(s)).toBe('attention');
    expect(layerText(s)).toBe('3 files need attention');
    s = reduce(s, { type: 'updateReady', version: '0.2.0' });
    expect(layer(s)).toBe('attention');
    s = reduce(s, { type: 'collapse' });
    expect(chips(s)).toEqual(['attention', 'done', 'update']);
  });

  it('working outranks every notice, and starting folds the open one', () => {
    const s = run({ type: 'updateReady', version: '0.2.0' }, start);
    expect(layer(s)).toBe('working');
    expect(layer(reduce(s, { type: 'stop' }))).toBe('tools');
    expect(chips(reduce(s, { type: 'stop' }))).toEqual(['update']);
  });

  it('fixing every file clears the attention notice', () => {
    const s = run(start, { type: 'finish', text: null, attention: 1 }, { type: 'attention', count: 0 });
    expect(layer(s)).toBe('tools');
    expect(chips(s)).toEqual([]);
  });

  it('undo shows restored briefly and removes the Undo chip', () => {
    const s = run(start, { type: 'finish', text: '2 files renamed', attention: 0 }, { type: 'collapse' }, { type: 'restored', text: '2 names restored' });
    expect(layer(s)).toBe('restored');
    expect(layerText(s)).toBe('2 names restored');
    expect(chips(reduce(s, { type: 'collapse' }))).toEqual([]);
  });

  it('restarting wins over everything', () => {
    const s: IslandState = run(start, { type: 'restarting' });
    expect(layer(s)).toBe('restarting');
  });

  it('uses the spec timings', () => {
    expect(TIMEOUT_MS).toEqual({ done: 4000, attention: 6000, update: 3500, restored: 2200 });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/island.test.ts`
Expected: FAIL, `Failed to load url ../src/lib/shell/island`.

- [ ] **Step 3: Write `src/lib/shell/island.ts`**

```ts
export type Notice = 'attention' | 'done' | 'update';
export type Layer = 'tools' | 'working' | Notice | 'restarting' | 'restored';

export type IslandState = {
  /** a running job: reading files, applying or undoing a batch */
  activity: { label: string; done: number; total: number; cancellable: boolean } | null;
  /** the last batch ("12 files renamed"); shown as the Undo chip */
  done: string | null;
  /** how many files need attention */
  attention: number;
  /** version of a downloaded update */
  update: string | null;
  transient: { kind: 'restarting' | 'restored'; text: string } | null;
  /** the notice shown full size; null = folded into chips */
  open: Notice | null;
};

export type IslandEvent =
  | { type: 'start'; label: string; total: number; cancellable: boolean }
  | { type: 'progress'; done: number; total: number }
  | { type: 'finish'; text: string | null; attention: number }
  | { type: 'stop' }
  | { type: 'collapse' }
  | { type: 'attention'; count: number }
  | { type: 'updateReady'; version: string }
  | { type: 'restarting' }
  | { type: 'restored'; text: string }
  | { type: 'clearTransient' };

export const INITIAL: IslandState = { activity: null, done: null, attention: 0, update: null, transient: null, open: null };

/** How long each layer stays before it folds (spec: done 4 s, attention 6 s, update 3.5 s). */
export const TIMEOUT_MS: Partial<Record<Layer, number>> = { done: 4000, attention: 6000, update: 3500, restored: 2200 };

export function reduce(s: IslandState, e: IslandEvent): IslandState {
  switch (e.type) {
    case 'start':
      return { ...s, activity: { label: e.label, done: 0, total: e.total, cancellable: e.cancellable }, open: null };
    case 'progress':
      return s.activity ? { ...s, activity: { ...s.activity, done: e.done, total: e.total } } : s;
    case 'finish':
      return { ...s, activity: null, done: e.text ?? s.done, attention: e.attention, open: e.attention ? 'attention' : e.text ? 'done' : null };
    case 'stop':
      return { ...s, activity: null };
    case 'collapse':
      return { ...s, open: null, transient: s.transient?.kind === 'restored' ? null : s.transient };
    case 'attention':
      return { ...s, attention: e.count, open: !e.count && s.open === 'attention' ? null : s.open };
    case 'updateReady':
      return { ...s, update: e.version, open: s.open ?? 'update' };
    case 'restarting':
      return { ...s, transient: { kind: 'restarting', text: 'Restarting…' } };
    case 'restored':
      return { ...s, done: null, open: null, transient: { kind: 'restored', text: e.text } };
    case 'clearTransient':
      return { ...s, transient: null };
  }
}

const has = (s: IslandState, n: Notice) => (n === 'attention' ? s.attention > 0 : n === 'done' ? !!s.done : !!s.update);

/** Priority: transient > working > attention > done > update (only one notice is open at a time). */
export function layer(s: IslandState): Layer {
  if (s.transient) return s.transient.kind;
  if (s.activity) return 'working';
  if (s.open && has(s, s.open)) return s.open;
  return 'tools';
}

export function chips(s: IslandState): Notice[] {
  return layer(s) === 'tools' ? (['attention', 'done', 'update'] as const).filter((n) => has(s, n)) : [];
}

export function noticeText(s: IslandState, n: Notice): string {
  if (n === 'attention') return `${s.attention} ${s.attention === 1 ? 'file needs' : 'files need'} attention`;
  return n === 'done' ? (s.done ?? '') : 'Update ready';
}

/** What the island says (also announced to screen readers). */
export function layerText(s: IslandState): string {
  const l = layer(s);
  if (l === 'working') {
    const a = s.activity!;
    return a.total ? `${a.label} ${Math.min(a.done + 1, a.total)} of ${a.total}` : `${a.label}…`;
  }
  if (l === 'restarting' || l === 'restored') return s.transient!.text;
  return l === 'tools' ? '' : noticeText(s, l);
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npx vitest run test/island.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Write `src/lib/shell/island.svelte.ts`**

```ts
import { INITIAL, reduce, type IslandEvent } from './island';

export const island = $state({ ...INITIAL });

export function send(e: IslandEvent) {
  Object.assign(island, reduce($state.snapshot(island), e));
}

// dev only: lets scripts/cdp.mjs drive the island (`__send({ type: 'finish', text: '6 files renamed', attention: 0 })`)
if (import.meta.env.DEV) Object.assign(window, { __send: send });
```

- [ ] **Step 6: Write `src/lib/shell/Island.svelte`**

Layers sit on top of each other and crossfade (opacity, scale 0.92→1, blur 6→0). The capsule's width springs to the measured width of the active layer. Chips are 36 px circles that grow to `max-content` on hover or keyboard focus. `interpolate-size: allow-keywords` from `app.css` lets that width animate.

```svelte
<script lang="ts">
  import { flushSync } from 'svelte';
  import { setTheme, ui, type PanelName } from '../app.svelte';
  import { data, save } from '../shared/state.svelte';
  import { chips, layer, layerText, noticeText, TIMEOUT_MS, type Layer, type Notice } from './island';
  import { island, send } from './island.svelte';
  import { switchTheme } from './theme';

  let { oncancel, onundo, onrestart }: { oncancel: () => void; onundo: () => void; onrestart: () => void } = $props();

  const active = $derived(layer(island));
  const text = $derived(layerText(island));
  const shown = $derived(chips(island));
  const pct = $derived(island.activity?.total ? (100 * island.activity.done) / island.activity.total : 0);
  const w: Partial<Record<Layer, number>> = $state({});

  // notices fold into their chip after a while; "restored" just goes away
  $effect(() => {
    const ms = TIMEOUT_MS[active];
    if (!ms) return;
    const t = setTimeout(() => send({ type: 'collapse' }), ms);
    return () => clearTimeout(t);
  });

  const toggle = (p: PanelName) => (ui.panel = ui.panel === p ? null : p);
  function review() {
    ui.panel = 'attention';
    send({ type: 'collapse' });
  }
  function toggleTheme(e: MouseEvent) {
    const next = ui.dark ? 'light' : 'dark';
    data.settings.theme = next;
    save('settings');
    switchTheme(() => {
      setTheme(next);
      flushSync();
    }, e.currentTarget as HTMLElement);
  }
  const CHIP: Record<Notice, { action: string; run: () => void }> = {
    attention: { action: 'Review', run: review },
    done: { action: 'Undo', run: () => onundo() },
    update: { action: 'Restart', run: () => onrestart() },
  };
</script>

<nav class="island" class:attn={active === 'attention'} class:okpulse={active === 'done'} aria-label="Main" style:width="{(w[active] ?? 380) + 2}px">
  <span class="sr" aria-live="polite">{text}</span>

  <div class="layer" class:on={active === 'tools'} bind:offsetWidth={w.tools}>
    <div class="tools" role="group" aria-label="Tool">
      <span class="pill" aria-hidden="true" style:left="{ui.tool === 'rename' ? 0 : 108}px" style:width="{ui.tool === 'rename' ? 108 : 92}px"></span>
      <button class="tool" class:on={ui.tool === 'rename'} aria-pressed={ui.tool === 'rename'} style:width="108px" title="Rename (Ctrl+1)" onclick={() => (ui.tool = 'rename')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7V5h16v2" /><path d="M12 5v14" /><path d="M9 19h6" /></svg>Rename
      </button>
      <button class="tool" class:on={ui.tool === 'split'} aria-pressed={ui.tool === 'split'} style:width="92px" title="Split (Ctrl+2)" onclick={() => (ui.tool = 'split')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" /></svg>Split
      </button>
    </div>
    <span class="divider" aria-hidden="true"></span>
    <button class="ib" aria-label="History" aria-pressed={ui.panel === 'history'} onclick={() => toggle('history')}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    </button>
    <button class="ib" aria-label="Profiles" aria-pressed={ui.panel === 'profiles'} onclick={() => toggle('profiles')}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg>
    </button>
    <button class="ib" aria-label="Settings" aria-pressed={ui.panel === 'settings'} onclick={() => toggle('settings')}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
    </button>
    <button class="ib theme" class:dark={ui.dark} aria-label={ui.dark ? 'Switch to light theme' : 'Switch to dark theme'} onclick={toggleTheme}>
      <svg class="sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      <svg class="moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
    </button>
    {#each shown as c (c)}
      <div class="chip {c}">
        <span class="chip-icon" class:nudge3={c === 'update'} aria-hidden="true">
          {#if c === 'done'}
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
          {:else if c === 'attention'}
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></svg>
          {:else}
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
          {/if}
        </span>
        <span class="chip-text">{noticeText(island, c)}</span>
        <button class={c === 'done' ? 'act' : 'out'} onclick={CHIP[c].run}>{CHIP[c].action}</button>
      </div>
    {/each}
  </div>

  <div class="layer note" class:on={active === 'working'} bind:offsetWidth={w.working}>
    <span class="wtext">{active === 'working' ? text : ''}</span>
    <span class="bar" aria-hidden="true">
      {#if !island.activity?.total}<span class="indet"></span>{/if}
      <span class="fill" style:width="{pct}%"><span class="sheen"></span></span>
    </span>
    {#if island.activity?.cancellable}<button class="out quiet" onclick={oncancel}>Cancel</button>{/if}
  </div>

  <div class="layer note" class:on={active === 'done'} bind:offsetWidth={w.done}>
    <span class="icon">
      {#if active === 'done'}<svg class="check" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{/if}
    </span>
    <span class="msg">{island.done}</span>
    <button class="act" onclick={onundo}>Undo</button>
  </div>

  <div class="layer note" class:on={active === 'attention'} bind:offsetWidth={w.attention}>
    <span class="icon warn">
      {#if active === 'attention'}<svg class="pop" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></svg>{/if}
    </span>
    <span class="msg">{noticeText(island, 'attention')}</span>
    <button class="out" onclick={review}>Review</button>
  </div>

  <div class="layer note" class:on={active === 'update'} bind:offsetWidth={w.update}>
    <span class="icon accent">
      {#if active === 'update'}<svg class="dropnudge" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>{/if}
    </span>
    <span class="msg">Update ready</span>
    <button class="out" onclick={onrestart}>Restart</button>
  </div>

  <div class="layer note" class:on={active === 'restarting'} bind:offsetWidth={w.restarting}>
    <svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>
    <span class="msg">{active === 'restarting' ? text : ''}</span>
  </div>

  <div class="layer note" class:on={active === 'restored'} bind:offsetWidth={w.restored}>
    <span class="icon muted">
      {#if active === 'restored'}<svg class="pop" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>{/if}
    </span>
    <span class="msg">{active === 'restored' ? text : ''}</span>
  </div>
</nav>

<style>
  .island {
    position: relative; height: 44px; border-radius: 999px; background: var(--cap); border: 1px solid var(--border);
    box-shadow: var(--shadow); overflow: hidden; transition: width 440ms var(--spring);
  }
  .island.attn { animation: shake 460ms cubic-bezier(0.36, 0.07, 0.19, 0.97) 1, glow 1.3s ease-in-out 460ms 3; }
  .island.okpulse { animation: okring 900ms ease-out 1; }

  .layer {
    position: absolute; top: 0; bottom: 0; left: 50%; display: flex; align-items: center; gap: 2px; padding: 0 3px;
    white-space: nowrap; transform: translateX(-50%) scale(0.92); opacity: 0; filter: blur(6px); pointer-events: none; visibility: hidden;
    transition: opacity 240ms ease, transform 440ms var(--spring), filter 240ms ease, visibility 0s linear 260ms;
  }
  .layer.on {
    transform: translateX(-50%); opacity: 1; filter: none; pointer-events: auto; visibility: visible;
    transition: opacity 240ms ease, transform 440ms var(--spring), filter 240ms ease, visibility 0s linear 0s;
  }
  .layer.note { gap: 10px; padding: 0 6px 0 14px; }
  .layer .ib { width: 36px; height: 36px; }
  .msg, .wtext { font-size: 13.5px; font-weight: 500; }
  .wtext { min-width: 140px; font-variant-numeric: tabular-nums; }
  .icon { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; }
  .icon.warn { color: var(--warn); } .icon.accent { color: var(--accent); } .icon.muted { color: var(--text2); }

  .tools { position: relative; display: flex; }
  .pill { position: absolute; top: 0; bottom: 0; border-radius: 999px; background: var(--accent); transition: left 300ms cubic-bezier(0.3, 1.3, 0.5, 1), width 300ms cubic-bezier(0.3, 1.3, 0.5, 1); }
  .tool {
    position: relative; height: 36px; border: 0; border-radius: 999px; background: transparent; color: var(--text2);
    display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-size: 13.5px; font-weight: 500;
    transition: color 220ms ease, transform 160ms var(--press);
  }
  .tool:hover { color: var(--text); }
  .tool:active { transform: scale(0.95); }
  .tool.on, .tool.on:hover { color: var(--on-accent); font-weight: 600; }
  .divider { width: 1px; height: 20px; margin: 0 4px; background: var(--border2); }

  .theme { position: relative; }
  .theme svg { position: absolute; transition: opacity 260ms ease, transform 460ms cubic-bezier(0.34, 1.4, 0.64, 1); }
  .theme .sun { opacity: 0; transform: rotate(90deg) scale(0.4); }
  .theme .moon { opacity: 1; transform: none; }
  .theme.dark .sun { opacity: 1; transform: none; }
  .theme.dark .moon { opacity: 0; transform: rotate(-90deg) scale(0.4); }

  .act, .out {
    height: 30px; padding: 0 13px; border-radius: 999px; font-size: 12.5px; transition: filter 160ms ease, background 160ms ease, transform 160ms var(--press);
  }
  .act { border: 0; background: var(--accent); color: var(--on-accent); font-weight: 600; }
  .act:hover { filter: brightness(1.1); }
  .out { border: 1px solid var(--border2); background: transparent; color: var(--text); font-weight: 500; }
  .out:hover { background: var(--hover); }
  .out.quiet { border-color: transparent; }
  .act:active, .out:active { transform: scale(0.94); }

  .chip {
    display: flex; align-items: center; height: 36px; width: 36px; flex-shrink: 0; margin-left: 2px; border-radius: 999px; overflow: hidden;
    transition: width 400ms var(--spring), background 200ms ease; animation: pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  .chip.done { background: var(--cap2); color: var(--text2); animation: slidein 560ms cubic-bezier(0.34, 1.4, 0.64, 1) both; }
  .chip.attention { background: var(--warnsoft); color: var(--warn); }
  .chip.update { background: var(--soft); color: var(--accent); }
  .chip:hover, .chip:focus-within { width: max-content; }
  .chip-icon { width: 36px; height: 36px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; }
  .chip-icon.nudge3 svg { animation: nudge 2.2s ease-in-out 700ms 3; }
  .chip:hover .chip-icon.nudge3 svg { animation: nudge 2.2s ease-in-out infinite; }
  .chip-text { font-size: 13px; font-weight: 500; color: var(--text); }
  .chip button { margin: 0 3px 0 10px; }
  .chip-text, .chip button { opacity: 0; transition: opacity 200ms ease; }
  .chip:hover .chip-text, .chip:focus-within .chip-text, .chip:hover button, .chip:focus-within button { opacity: 1; transition-delay: 120ms; }

  .bar { position: relative; width: 140px; height: 6px; border-radius: 999px; background: var(--track); overflow: hidden; }
  .fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: var(--accent); overflow: hidden; transition: width 420ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  .indet { position: absolute; top: 0; bottom: 0; width: 40%; border-radius: 999px; background: var(--accent); animation: indet 1.15s cubic-bezier(0.45, 0, 0.25, 1) infinite; }
  .sheen { position: absolute; inset: 0; background: linear-gradient(100deg, transparent 25%, var(--sheen) 50%, transparent 75%); background-size: 220% 100%; animation: sheen 1.5s linear infinite; }

  .check { animation: pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  .check path { stroke-dasharray: 24; stroke-dashoffset: 24; animation: draw 420ms cubic-bezier(0.65, 0, 0.35, 1) 180ms forwards; }
  .pop { animation: pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  .dropnudge { animation: drop 620ms cubic-bezier(0.34, 1.56, 0.64, 1) both, nudge 2.2s ease-in-out 900ms infinite; }
  .spin { animation: spin 900ms linear infinite; }

  @keyframes shake { 0%, 100% { transform: translateX(0); } 18% { transform: translateX(-3px); } 36% { transform: translateX(3px); } 54% { transform: translateX(-2px); } 72% { transform: translateX(2px); } 88% { transform: translateX(-1px); } }
  @keyframes glow { 0%, 100% { box-shadow: var(--shadow); } 50% { box-shadow: 0 0 0 3px var(--glow1), 0 0 30px 6px var(--glow2); } }
  @keyframes okring { 0% { box-shadow: var(--shadow), 0 0 0 0 var(--okring); } 100% { box-shadow: var(--shadow), 0 0 0 12px transparent; } }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  @keyframes pop { 0% { transform: scale(0.3); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
  @keyframes drop { 0% { transform: translateY(-8px); opacity: 0; } 55% { transform: translateY(1px); opacity: 1; } 100% { transform: translateY(0); opacity: 1; } }
  @keyframes nudge { 0%, 55%, 100% { transform: translateY(0); } 64% { transform: translateY(3px); } 73% { transform: translateY(-1px); } 82% { transform: translateY(2px); } 90% { transform: translateY(0); } }
  @keyframes slidein { 0% { transform: translateX(-28px) scale(0.5); opacity: 0; } 100% { transform: translateX(0) scale(1); opacity: 1; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes indet { 0% { left: -40%; } 100% { left: 100%; } }
  @keyframes sheen { from { background-position: 160% 0; } to { background-position: -60% 0; } }
</style>
```

- [ ] **Step 7: Mount it for a visual check**

`src/App.svelte` (temporary, replaced in Task 11):

```svelte
<script lang="ts">
  import Island from './lib/shell/Island.svelte';
</script>

<div style="display: grid; place-items: center; height: 60px; background: var(--chrome)">
  <Island oncancel={() => {}} onundo={() => {}} onrestart={() => {}} />
</div>
```

- [ ] **Step 8: Check every state**

Run:
```bash
npm test && npm run check
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev   # background
node scripts/cdp.mjs shot island-tools.png
node scripts/cdp.mjs eval "__send({ type: 'start', label: 'Renaming', total: 6, cancellable: true }); __send({ type: 'progress', done: 2, total: 6 })"
node scripts/cdp.mjs shot island-working.png
node scripts/cdp.mjs eval "__send({ type: 'finish', text: '6 files renamed', attention: 1 })"
node scripts/cdp.mjs shot island-attention.png
```
Wait 7 s, then:
```bash
node scripts/cdp.mjs eval "__send({ type: 'updateReady', version: '0.2.0' }); document.querySelectorAll('.chip').length"
node scripts/cdp.mjs shot island-chips.png
```
Expected:
- Tests pass and check shows `0 errors`.
- The screenshots show, in order: tools; "Renaming 3 of 6" with a bar and Cancel; the amber attention layer; the tools with an amber chip, a grey Undo chip and an update notice.
- The eval returns `2` while the update notice is open, then `3` once it folds after 3.5 s.

Hover a chip in the app window: it grows to show its text and button. Tab through the island: every control gets a focus ring, and focusing a chip expands it. Stop the app, then delete the screenshots.

- [ ] **Step 9: Commit**

```bash
git add src/lib/shell src/App.svelte test/island.test.ts
git commit -F- <<'EOF'
feat: title-bar island with working, done, attention, update and chip states

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 11: Shell: title bar, panels, shortcuts, batches and undo

**Files:**
- Create: `src/lib/shell/TitleBar.svelte`, `src/lib/shell/Panel.svelte`, `src/lib/shell/shortcuts.ts`, `src/lib/split/Split.svelte`, `src/lib/shared/batches.ts`, `test/shortcuts.test.ts`
- Modify: `src/App.svelte` (full shell)

**Interfaces:**
- Consumes:
  - `ui`, `PANEL_TITLES` (Task 2); `motion` (Task 2).
  - `data`, `save`, `log`, `flush` (Task 4); `ipc.undoBatch`, `ipc.cancelApply` (Task 5).
  - `mergeBatch`, `lastUndoable` (Task 4).
  - `island`, `send`, `Island.svelte` (Task 10).
- Produces:
  - `shortcuts.ts`:
    - `type Action = 'tool-rename' | 'tool-split' | 'undo' | 'close-panel'`
    - `shortcut(e: { key; ctrlKey; shiftKey; altKey }, inText: boolean): Action | null`
  - `batches.ts`:
    - `recordBatch(b: Omit<Batch, 'summary'>): Batch` merges by id, saves, and returns the stored batch with its summary.
    - `undoBatch(id): Promise<void>`
    - `undoLast(): Promise<void>`
    - Undo does nothing while the island shows activity.
  - `Panel.svelte`, with props `{ title: string; onclose: () => void; children: Snippet }`.
  - `TitleBar.svelte`, with props `{ oncancel, onundo, onrestart }`, passed to the island.
  - `App.svelte` layout:
    - Screens are `.screen` elements, kept mounted. The inactive one is `inert`.
    - `<main>` is `inert` while a panel is open.

- [ ] **Step 1: Write the failing test**

`test/shortcuts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shortcut } from '../src/lib/shell/shortcuts';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key: k, ctrlKey: false, shiftKey: false, altKey: false, ...mods,
});

describe('shortcuts', () => {
  it('Ctrl+1 / Ctrl+2 switch tools, Esc closes panels', () => {
    expect(shortcut(key('1', { ctrlKey: true }), false)).toBe('tool-rename');
    expect(shortcut(key('2', { ctrlKey: true }), true)).toBe('tool-split');
    expect(shortcut(key('Escape'), true)).toBe('close-panel');
  });

  it('Ctrl+Z undoes only outside text fields', () => {
    expect(shortcut(key('z', { ctrlKey: true }), false)).toBe('undo');
    expect(shortcut(key('Z', { ctrlKey: true }), false)).toBe('undo');
    expect(shortcut(key('z', { ctrlKey: true }), true)).toBeNull();
  });

  it('ignores other keys and modifier mixes', () => {
    expect(shortcut(key('1'), false)).toBeNull();
    expect(shortcut(key('z', { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(shortcut(key('1', { ctrlKey: true, altKey: true }), false)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/shortcuts.test.ts`
Expected: FAIL, `Failed to load url ../src/lib/shell/shortcuts`.

- [ ] **Step 3: Write `src/lib/shell/shortcuts.ts`**

```ts
export type Action = 'tool-rename' | 'tool-split' | 'undo' | 'close-panel';

/** The app's keyboard shortcuts. `inText`: focus is in a text field, where Ctrl+Z belongs to the field. */
export function shortcut(e: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, inText: boolean): Action | null {
  if (e.key === 'Escape') return 'close-panel';
  if (!e.ctrlKey || e.shiftKey || e.altKey) return null;
  if (e.key === '1') return 'tool-rename';
  if (e.key === '2') return 'tool-split';
  if (e.key.toLowerCase() === 'z' && !inText) return 'undo';
  return null;
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npx vitest run test/shortcuts.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write `src/lib/shared/batches.ts`**

```ts
import { island, send } from '../shell/island.svelte';
import { ipc } from './ipc';
import { data, log, save } from './state.svelte';
import { lastUndoable, mergeBatch } from './store';
import type { Batch } from './types';

/** Stores a finished batch (or merges Apply-fixes results into it) and returns it with its summary. */
export function recordBatch(b: Omit<Batch, 'summary'>): Batch {
  data.history = mergeBatch(data.history, { ...b, summary: '' });
  save('history');
  return data.history[0];
}

/** Undoes a batch from its journal. Files changed since are left alone and logged; undo can be repeated. */
export async function undoBatch(id: string): Promise<void> {
  const b = data.history.find((h) => h.id === id);
  if (!b || !b.undoable || b.undone || island.activity) return;
  send({ type: 'start', label: 'Undoing', total: 0, cancellable: false });
  try {
    const r = await ipc.undoBatch(id);
    for (const s of r.skipped) {
      log({ level: 'warn', tool: b.tool, file: s.path, message: 'Not restored: the file changed after the batch, or is in use.', detail: s.reason });
    }
    b.undone = r.skipped.length === 0;
    save('history');
    send({ type: 'stop' });
    const text = `${r.restored} ${r.restored === 1 ? 'name' : 'names'} restored${r.skipped.length ? ` · ${r.skipped.length} skipped` : ''}`;
    send({ type: 'restored', text });
    log({ level: 'info', tool: b.tool, message: `Undo: ${text}.` });
  } catch (e) {
    send({ type: 'stop' });
    log({ level: 'error', tool: b.tool, message: 'Undo failed.', detail: String(e) });
    send({ type: 'restored', text: 'Undo failed · see History › Log' });
  }
}

export async function undoLast(): Promise<void> {
  const b = lastUndoable(data.history);
  if (b) await undoBatch(b.id);
}
```

- [ ] **Step 6: Write `src/lib/shell/Panel.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { fade, fly } from 'svelte/transition';
  import { motion } from './theme';

  let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();
  let box: HTMLElement;
  $effect(() => box.focus());
</script>

<button class="scrim" tabindex="-1" aria-label="Close {title}" onclick={onclose} transition:fade={{ duration: motion(180) }}></button>
<section
  class="panel"
  role="dialog"
  aria-modal="true"
  aria-labelledby="panel-title"
  tabindex="-1"
  bind:this={box}
  transition:fly={{ x: 48, duration: motion(280), easing: cubicOut }}
>
  <header>
    <h2 id="panel-title">{title}</h2>
    <button class="ib" aria-label="Close" onclick={onclose}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </header>
  <div class="body">{@render children()}</div>
</section>

<style>
  .scrim { position: fixed; inset: 60px 0 0 0; border: 0; padding: 0; background: rgba(0, 0, 0, 0.28); cursor: default; }
  .panel {
    position: fixed; top: 60px; right: 0; bottom: 0; width: min(520px, 100vw - 120px); display: flex; flex-direction: column;
    background: var(--surface); border-left: 1px solid var(--border); box-shadow: var(--shadow); outline: none;
  }
  header { display: flex; align-items: center; justify-content: space-between; padding: 14px 14px 10px 20px; border-bottom: 1px solid var(--border); }
  .body { flex: 1; overflow: auto; padding: 16px 20px 24px; display: flex; flex-direction: column; gap: 14px; user-select: text; }
</style>
```

- [ ] **Step 7: Write `src/lib/shell/TitleBar.svelte`**

```svelte
<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { flush } from '../shared/state.svelte';
  import Island from './Island.svelte';

  let { oncancel, onundo, onrestart }: { oncancel: () => void; onundo: () => void; onrestart: () => void } = $props();
  const win = getCurrentWindow();

  async function close() {
    await flush();
    await win.close();
  }
</script>

<header class="bar" data-tauri-drag-region>
  <div class="brand" data-tauri-drag-region>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6l7 12 7-12" /></svg>
    <span data-tauri-drag-region>Vellova</span>
  </div>
  <Island {oncancel} {onundo} {onrestart} />
  <div class="win">
    <button class="wb" aria-label="Minimize" onclick={() => win.minimize()}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 12h14" /></svg>
    </button>
    <button class="wb" aria-label="Maximize" onclick={() => win.toggleMaximize()}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1" /></svg>
    </button>
    <button class="wb close" aria-label="Close" onclick={close}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </div>
</header>

<style>
  .bar { height: 60px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; background: var(--chrome); border-bottom: 1px solid var(--border); }
  .brand { display: flex; align-items: center; gap: 10px; padding-left: 18px; font-weight: 600; letter-spacing: -0.01em; }
  .win { justify-self: end; display: flex; height: 100%; }
  .wb { width: 46px; height: 60px; border: 0; background: transparent; color: var(--text3); display: inline-flex; align-items: center; justify-content: center; transition: background 160ms ease, color 160ms ease; }
  .wb:hover { background: var(--hover); color: var(--text); }
  .wb.close:hover { background: #C42B1C; color: #FFFFFF; }
</style>
```

- [ ] **Step 8: Write `src/lib/split/Split.svelte`**

```svelte
<section class="split">
  <h1>Split</h1>
  <p class="hint">Split spreadsheets into one file per value, person, row count or part.</p>
  <div class="card">
    <h3>Coming in the next update</h3>
    <p class="hint">Split arrives in the next version of Vellova. It will reach you through the automatic update.</p>
  </div>
</section>

<style>
  .split { display: flex; flex-direction: column; gap: 6px; max-width: 560px; }
  h1 { font-size: 22px; }
  .card { margin-top: 12px; }
</style>
```

- [ ] **Step 9: Write `src/App.svelte` (the shell)**

```svelte
<script lang="ts">
  import { PANEL_TITLES, ui } from './lib/app.svelte';
  import { undoLast } from './lib/shared/batches';
  import { ipc } from './lib/shared/ipc';
  import Panel from './lib/shell/Panel.svelte';
  import { shortcut } from './lib/shell/shortcuts';
  import TitleBar from './lib/shell/TitleBar.svelte';
  import Split from './lib/split/Split.svelte';

  const inText = () => !!document.activeElement?.matches('input:not([type=checkbox]):not([type=radio]), textarea, select');

  function onkeydown(e: KeyboardEvent) {
    const action = shortcut(e, inText());
    if (!action || (action === 'close-panel' && !ui.panel)) return;
    e.preventDefault();
    if (action === 'close-panel') ui.panel = null;
    else if (action === 'tool-rename') ui.tool = 'rename';
    else if (action === 'tool-split') ui.tool = 'split';
    else void undoLast();
  }
</script>

<svelte:window {onkeydown} />

<div class="app">
  <TitleBar oncancel={() => void ipc.cancelApply()} onundo={() => void undoLast()} onrestart={() => {}} />
  <main inert={!!ui.panel}>
    <div class="screen" class:on={ui.tool === 'rename'} inert={ui.tool !== 'rename'}>
      <h1>Rename</h1>
    </div>
    <div class="screen" class:on={ui.tool === 'split'} inert={ui.tool !== 'split'}>
      <Split />
    </div>
  </main>
  {#if ui.panel}
    <Panel title={PANEL_TITLES[ui.panel]} onclose={() => (ui.panel = null)}>
      <p class="hint">{PANEL_TITLES[ui.panel]}</p>
    </Panel>
  {/if}
</div>

<style>
  .app { height: 100%; display: flex; flex-direction: column; }
  main { position: relative; flex: 1; min-height: 0; }
  .screen {
    position: absolute; inset: 0; padding: 20px 24px 0; display: flex; flex-direction: column; opacity: 0; transform: translateY(8px); visibility: hidden;
    transition: opacity 260ms ease, transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s linear 260ms;
  }
  .screen.on { opacity: 1; transform: none; visibility: visible; transition-delay: 0s; }
</style>
```

The Rename heading and the panel bodies are stand-ins. Task 12 fills the Rename screen, and Task 14 fills the panels.

- [ ] **Step 10: Check the shell**

Run:
```bash
npm test && npm run check
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev   # background
node scripts/cdp.mjs shot shell.png
```
Expected: tests pass, `0 errors`, and `shell.png` shows the title bar (mark, centred island, window buttons) above the Rename screen.

By hand in the app window:
1. Drag the window by the empty title bar, and double-click it to maximize.
2. Ctrl+2 slides to Split and the pill follows; Ctrl+1 goes back.
3. Click History: the panel slides in from the right with focus inside. Esc closes it; Tab can't reach the screen underneath while it's open.
4. Turn Windows Settings › Accessibility › Visual effects › Animation effects off, restart the app, and open a panel: it appears without sliding.
5. Close the window, run `npm run tauri dev` again, and confirm the window comes back at the same size and position.

Stop the app afterwards and delete `shell.png`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -F- <<'EOF'
feat: app shell with custom title bar, sliding panels, shortcuts and batch undo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 12: The Rename screen

**Files:**
- Create: `src/lib/rename/pdf.ts`, `src/lib/rename/session.svelte.ts`, `src/lib/rename/Rename.svelte`, `src/lib/rename/RenameSettings.svelte`, `src/lib/rename/Preview.svelte`, `src/lib/rename/DropZone.svelte`
- Modify: `src/lib/rename/engine/planner.ts`, `test/planner.test.ts`, `src/App.svelte`

**Interfaces:**
- Consumes:
  - From Tasks 4–5: `ipc.readFile`, `ipc.listFiles`, `ipc.listDir`, `ipc.applyPlan`, `ipc.cancelApply`, `ipcReason`, `OpResult`; `data`, `save`, `log`.
  - Engines: `extractItems`, `classifyPdfError` (6); `findValue` (6); `readCompanion`, `pairCompanions` (8); `planRename`, `summary`, `mergeFiles`, `pathKey`, `RenameRules`, `rulesFromProfile`, `profileFromRules` (9).
  - Shell: `island`, `send` (10); `recordBatch`, `undoLast` (11).
- Produces:
  - `planner.ts` adds `readResults(items, results): { batch: BatchItem[]; failed: { source; reason; message }[]; done: string[] }`.
  - `pdf.ts`: `readPdfItems(bytes): Promise<Item[]>`. It uses one shared pdf.js worker, which is replaced after a crash.
  - `session.svelte.ts`:
    - `REASONS: Record<Reason, { title; hint }>`
    - `session` (reactive):
      - inputs: `files`, `rules`, `profileId`
      - read results: `values`, `pairs`, `manualPairs`, `existing`
      - user decisions: `overrides`, `skipped`, `failures`, `fixed`
      - status: `loading`, `busy`, `batch`
    - `plan.items`, the live preview as a getter.
    - File list: `refresh()`, `addPaths(paths)`, `pickFiles()`, `pickFolder()`, `pickCopyFolder()`, `removeFile(p)`, `clearFiles()`.
    - Fixes: `skip(p)`, `setName(p, name, fix?)`, `retry(p)`, `pickPdf(companion, pdf)`.
    - Running: `cancelActivity()`, `runBatch(only?)`, `applyFixes()`.
    - Profiles: `useProfile(p)`, `saveProfile(name?)`.
  - In dev, `window.__rename = { session, plan, addPaths, runBatch, undoLast }` is exposed for CDP checks.

- [ ] **Step 1: Write the failing test for reading apply results**

In `test/planner.test.ts`, change the planner import to:

```ts
import { planRename, readResults, summary, type PlanInput, type ValueResult } from '../src/lib/rename/engine/planner';
```

and append:

```ts
describe('readResults', () => {
  it('failures keep their reason, cancelled files stay untouched, a missing result is internal', () => {
    const D = 'C:\\in\\d.pdf';
    const items: PlanItem[] = [A, B, C, D].map((source, n) => ({
      id: source, source, status: 'ready' as const, op: { kind: 'rename' as const, from: source, to: `C:\\in\\N${n}.pdf` },
    }));
    const r = readResults(items, [
      { i: 1, ok: false, code: 'locked', message: 'os error 32' },
      { i: 0, ok: true },
      { i: 2, ok: false, code: 'cancelled' },
    ]);
    expect(r.done).toEqual([A]);
    expect(r.batch).toEqual([
      { from: A, to: 'C:\\in\\N0.pdf', ok: true },
      { from: B, to: 'C:\\in\\N1.pdf', ok: false, reason: 'locked' },
      { from: D, to: 'C:\\in\\N3.pdf', ok: false, reason: 'internal' },
    ]);
    expect(r.failed.map((f) => [f.source, f.reason, f.message])).toEqual([
      [B, 'locked', 'os error 32'],
      [D, 'internal', 'No result came back for this file.'],
    ]);
  });
});
```

Run: `npx vitest run test/planner.test.ts`
Expected: FAIL, `readResults is not a function`.

- [ ] **Step 2: Add `readResults` to `src/lib/rename/engine/planner.ts`**

Replace the type import line with:

```ts
import type { OpResult } from '../../shared/ipc';
import type { BatchItem, Conflict, Destination, Op, PlanItem, Reason, Status } from '../../shared/types';
```

and append:

```ts
/** Matches apply results to the items that ran. Cancelled items are neither done nor failed, so they stay listed. */
export function readResults(items: PlanItem[], results: OpResult[]) {
  const byIndex = new Map(results.map((r) => [r.i, r]));
  const batch: BatchItem[] = [];
  const failed: { source: string; reason: Reason; message: string }[] = [];
  items.forEach((it, i) => {
    const r = byIndex.get(i);
    if (r?.code === 'cancelled') return;
    const to = it.op!.to;
    if (r?.ok) {
      batch.push({ from: it.source, to, ok: true });
      return;
    }
    const reason = (r?.code ?? 'internal') as Reason;
    batch.push({ from: it.source, to, ok: false, reason });
    failed.push({ source: it.source, reason, message: r?.message ?? 'No result came back for this file.' });
  });
  return { batch, failed, done: batch.filter((b) => b.ok).map((b) => b.from) };
}
```

Run: `npx vitest run test/planner.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 3: Write `src/lib/rename/pdf.ts`**

```ts
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { classifyPdfError, extractItems, type DocLike, type Item } from './engine/pdfItems';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
let worker: pdfjsLib.PDFWorker | null = null;

/** Text items of a PDF, read by pdf.js 3.11.174 (Nomina 1.4.6's version) in one shared worker. */
export async function readPdfItems(bytes: Uint8Array): Promise<Item[]> {
  worker ??= new pdfjsLib.PDFWorker();
  try {
    const doc = await pdfjsLib.getDocument({ data: bytes, worker, isEvalSupported: false, verbosity: 0 }).promise;
    try {
      return await extractItems(doc as unknown as DocLike);
    } finally {
      void doc.destroy();
    }
  } catch (e) {
    // a crashed worker would fail every later file: start a fresh one next time
    if (classifyPdfError(e).reason === 'internal') {
      worker?.destroy();
      worker = null;
    }
    throw e;
  }
}
```

- [ ] **Step 4: Write `src/lib/rename/session.svelte.ts`**

```ts
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { recordBatch, undoLast } from '../shared/batches';
import { ipc, ipcReason, type OpResult } from '../shared/ipc';
import { extOf, splitPath } from '../shared/names';
import { data, log, save } from '../shared/state.svelte';
import type { FileInfo, Reason, RenameProfile } from '../shared/types';
import { island, send } from '../shell/island.svelte';
import { readCompanion } from './companions';
import type { CompanionData } from './engine/companion';
import { mergeFiles, PDF, pathKey } from './engine/files';
import { findValue } from './engine/findValue';
import { pairCompanions } from './engine/pairing';
import { classifyPdfError, type Item } from './engine/pdfItems';
import { planRename, readResults, type ValueResult } from './engine/planner';
import { DEFAULT_RULES, profileFromRules, rulesFromProfile, type RenameRules } from './engine/profile';
import { readPdfItems } from './pdf';

/** Plain-language title and advice for every reason a file needs attention. */
export const REASONS: Record<Reason, { title: string; hint: string }> = {
  'keyword-not-found': { title: 'Keyword not found', hint: 'Check the keyword, or type a name for this file.' },
  'no-value': { title: 'No value next to the keyword', hint: 'Try another position, or type a name for this file.' },
  'no-text': { title: 'Scanned PDF (no text layer)', hint: 'This PDF is an image. Type a name for it.' },
  unreadable: { title: 'Unreadable or damaged file', hint: "This file can't be read. Skip it." },
  'no-match': { title: 'Companion file without a match', hint: 'Pick its PDF, or skip it.' },
  exists: { title: 'Target name exists', hint: 'A file with the new name appeared after the preview. Retry to pick a free name.' },
  locked: { title: 'File locked or in use', hint: 'The file is open in another program. Close it, then Retry.' },
  permission: { title: 'No permission', hint: 'Windows refused access to this file or its folder.' },
  missing: { title: 'File missing', hint: 'The file is no longer where it was.' },
  internal: { title: 'Internal error', hint: 'Something went wrong. Retry; the details are in History › Log.' },
};

export const session = $state({
  files: [] as FileInfo[],
  rules: structuredClone(DEFAULT_RULES) as RenameRules,
  profileId: null as string | null,
  /** per PDF: the value or why there is none; per companion: only read failures */
  values: {} as Record<string, ValueResult>,
  /** companion → PDF, null while reading */
  pairs: null as Record<string, string> | null,
  /** companions paired by hand in Needs attention */
  manualPairs: {} as Record<string, string>,
  existing: [] as string[],
  overrides: {} as Record<string, string>,
  skipped: [] as string[],
  /** files whose operation failed when applied */
  failures: {} as Record<string, { reason: Reason; detail: string }>,
  /** files fixed in Needs attention, for Apply fixes */
  fixed: [] as string[],
  loading: false,
  busy: false,
  /** the last batch, which Apply fixes adds to */
  batch: null as string | null,
});

const items = $derived.by(() => {
  const r = session.rules;
  const planned = planRename({
    files: session.files.map((f) => f.path),
    values: session.values,
    pairs: session.pairs && { ...session.pairs, ...session.manualPairs },
    pairEnabled: r.pair,
    prefix: r.prefix,
    suffix: r.suffix,
    destination: r.destination,
    conflict: r.conflict,
    existing: new Set(session.existing),
    overrides: session.overrides,
    skipped: new Set(session.skipped),
  });
  // a file whose operation failed keeps it (for Retry) but shows as attention
  return planned.map((it) => {
    const f = session.failures[it.source];
    return f && it.op ? { ...it, status: 'attention' as const, reason: f.reason, detail: f.detail } : it;
  });
});

/** The live preview (a getter: derived state can't be exported directly). */
export const plan = {
  get items() {
    return items;
  },
};

type Read<T> = { ok: true; data: T } | { ok: false; reason: Reason; detail: string };
const pdfCache = new Map<string, Item[]>();
const sheetCache = new Map<string, CompanionData>();

/** Reads and parses a file once per path, size and modified time. Failures aren't cached, so Retry reads again. */
async function readCached<T>(
  cache: Map<string, T>,
  f: FileInfo,
  parse: (bytes: Uint8Array) => Promise<T>,
  why: (e: unknown) => { reason: Reason; detail: string },
): Promise<Read<T>> {
  const key = `${f.path}|${f.size}|${f.mtime}`;
  const hit = cache.get(key);
  if (hit) return { ok: true, data: hit };
  let bytes: Uint8Array;
  try {
    bytes = await ipc.readFile(f.path);
  } catch (e) {
    return { ok: false, ...ipcReason(e) };
  }
  try {
    const data = await parse(bytes);
    cache.set(key, data);
    return { ok: true, data };
  } catch (e) {
    const r = why(e);
    if (r.reason === 'internal') log({ level: 'error', tool: 'rename', file: f.path, message: 'A reader stopped on this file and was restarted.', detail: r.detail });
    return { ok: false, ...r };
  }
}

const sheetError = (e: unknown) =>
  (e as { internal?: boolean })?.internal
    ? { reason: 'internal' as const, detail: String((e as Error).message) }
    : { reason: 'unreadable' as const, detail: `This file can't be read (${String((e as Error)?.message ?? e)}).` };

let generation = 0;

/** Reads what the preview needs and pairs companions. A newer call makes an older one stop. */
export async function refresh() {
  const gen = ++generation;
  const stale = () => gen !== generation;
  const files = $state.snapshot(session.files);
  const rules = $state.snapshot(session.rules);
  const keyword = rules.keyword.trim();
  const occurrence = Math.max(1, Math.floor(rules.occurrence) || 1);
  session.loading = true;
  session.pairs = null;
  let shown = false;
  // the island only shows reading that takes a while
  const timer = setTimeout(() => {
    if (stale() || island.activity) return;
    shown = true;
    send({ type: 'start', label: 'Reading', total: files.length, cancellable: true });
  }, 300);
  try {
    const dest = rules.destination;
    const dirs = dest.mode === 'copy' ? [dest.folder].filter(Boolean) : [...new Set(files.map((f) => splitPath(f.path).dir))];
    const existing = await ipc.listDir(dirs).catch(() => [] as string[]);
    if (stale()) return;
    session.existing = existing.map(pathKey);
    const values: Record<string, ValueResult> = {};
    const sheets: { path: string; data: CompanionData }[] = [];
    session.values = {};
    let n = 0;
    for (const f of files) {
      if (extOf(f.path) === PDF) {
        if (keyword) {
          const r = await readCached(pdfCache, f, readPdfItems, classifyPdfError);
          if (stale()) return;
          values[f.path] = r.ok ? findValue(r.data, keyword, rules.position, occurrence) : r;
        }
      } else if (rules.pair) {
        const r = await readCached(sheetCache, f, (b) => readCompanion(extOf(f.path), b), sheetError);
        if (stale()) return;
        if (r.ok) sheets.push({ path: f.path, data: r.data });
        else values[f.path] = r;
      }
      session.values = { ...values };
      if (shown) send({ type: 'progress', done: ++n, total: files.length });
    }
    const pdfs = files.flatMap((f) => {
      const v = values[f.path];
      return extOf(f.path) === PDF && v?.ok ? [{ path: f.path, value: v.value }] : [];
    });
    session.pairs = pairCompanions(pdfs, sheets);
  } finally {
    clearTimeout(timer);
    if (shown) send({ type: 'stop' });
    if (!stale()) session.loading = false;
  }
}

export async function addPaths(paths: string[]) {
  if (!paths.length) return;
  session.files = mergeFiles(session.files, await ipc.listFiles(paths, data.settings.rename.recursive));
}

export async function pickFiles() {
  const picked = await open({ multiple: true, filters: [{ name: 'PDFs and companion files', extensions: ['pdf', 'xlsx', 'txt', 'xml', 'csv'] }] });
  if (picked) await addPaths(picked);
}

export async function pickFolder() {
  const picked = await open({ directory: true, multiple: true });
  if (picked) await addPaths(picked);
}

export async function pickCopyFolder() {
  const folder = await open({ directory: true, defaultPath: data.settings.rename.folder || undefined });
  if (!folder) return;
  session.rules.destination = { mode: 'copy', folder };
  data.settings.rename.folder = folder;
  save('settings');
}

function forget(paths: string[]) {
  const gone = new Set(paths);
  session.files = session.files.filter((f) => !gone.has(f.path));
  session.skipped = session.skipped.filter((p) => !gone.has(p));
  session.fixed = session.fixed.filter((p) => !gone.has(p));
  for (const p of paths) {
    delete session.overrides[p];
    delete session.failures[p];
    delete session.manualPairs[p];
  }
}

export const removeFile = (path: string) => forget([path]);

export function clearFiles() {
  forget(session.files.map((f) => f.path));
  session.batch = null;
}

const markFixed = (path: string) => {
  if (!session.fixed.includes(path)) session.fixed.push(path);
};

/** Skips a file, or includes it again. */
export function skip(path: string) {
  session.skipped = session.skipped.includes(path) ? session.skipped.filter((p) => p !== path) : [...session.skipped, path];
  delete session.failures[path];
}

/** A name typed in the preview (without extension); empty goes back to the rules. */
export function setName(path: string, name: string, fix = false) {
  if (name.trim()) session.overrides[path] = name;
  else delete session.overrides[path];
  if (fix) markFixed(path);
}

/** Tries a failed file again: reads it afresh and re-plans it (a name taken meanwhile gets the conflict rule). */
export async function retry(path: string) {
  delete session.failures[path];
  const [fresh] = await ipc.listFiles([path], false);
  if (!fresh) {
    session.failures[path] = { reason: 'missing', detail: REASONS.missing.hint };
    return;
  }
  session.files = session.files.map((f) => (f.path === path ? fresh : f));
  markFixed(path);
}

export function pickPdf(companion: string, pdf: string) {
  session.manualPairs[companion] = pdf;
  markFixed(companion);
}

/** The island's Cancel: stops a running batch before its next file, or stops reading. */
export function cancelActivity() {
  if (session.busy) return void ipc.cancelApply();
  generation++;
  session.loading = false;
  send({ type: 'stop' });
}

const profileName = () => data.profiles.rename.find((p) => p.id === session.profileId)?.name;

/** Applies the preview (or only `only`, inside the last batch). Done files leave the list; failures stay with a reason. */
export async function runBatch(only?: string[]) {
  if (session.busy || session.loading || island.activity) return;
  const pick = only && new Set(only);
  const run = plan.items.filter((i) => i.op && (pick ? pick.has(i.source) : i.status !== 'attention'));
  if (!run.length) return;
  const copy = session.rules.destination.mode === 'copy';
  const id = pick && session.batch ? session.batch : crypto.randomUUID();
  session.busy = true;
  send({ type: 'start', label: copy ? 'Copying' : 'Renaming', total: run.length, cancellable: true });
  const unlisten = await listen<[number, number]>('plan-progress', (e) => send({ type: 'progress', done: e.payload[0], total: e.payload[1] }));
  let results: OpResult[];
  try {
    results = await ipc.applyPlan(id, run.map((i) => i.op!));
  } catch (e) {
    log({ level: 'error', tool: 'rename', message: 'The batch could not run.', detail: String(e) });
    send({ type: 'stop' });
    return;
  } finally {
    unlisten();
    session.busy = false;
  }
  const { batch, failed, done } = readResults(run, results);
  for (const f of failed) {
    session.failures[f.source] = { reason: f.reason, detail: REASONS[f.reason].hint };
    log({ level: 'error', tool: 'rename', file: f.source, message: REASONS[f.reason].title, detail: f.message });
  }
  forget(done);
  if (!batch.length) return void send({ type: 'stop' }); // everything was cancelled
  session.batch = id;
  const b = recordBatch({ id, tool: 'rename', time: Date.now(), verb: copy ? 'copied' : 'renamed', profile: profileName(), items: batch, undoable: batch.some((x) => x.ok) });
  log({ level: 'info', tool: 'rename', message: b.summary });
  send({ type: 'finish', text: b.summary, attention: plan.items.filter((i) => i.status === 'attention').length });
}

export const applyFixes = () => runBatch([...session.fixed]);

export function useProfile(p: RenameProfile) {
  session.rules = rulesFromProfile(p);
  session.profileId = p.id;
}

/** Saves the rules into the current profile, or as a new profile when `name` is given. */
export function saveProfile(name?: string) {
  const list = data.profiles.rename;
  const current = list.find((p) => p.id === session.profileId);
  if (current && !name) {
    Object.assign(current, profileFromRules($state.snapshot(session.rules), current.name, current.id, current.desc));
  } else {
    const p = profileFromRules($state.snapshot(session.rules), name ?? 'New profile', crypto.randomUUID());
    list.push(p);
    session.profileId = p.id;
  }
  save('profiles');
}

// dev only: lets scripts/cdp.mjs drive the screen
if (import.meta.env.DEV) Object.assign(window, { __rename: { session, plan, addPaths, runBatch, undoLast } });
```

- [ ] **Step 5: Write `src/lib/rename/RenameSettings.svelte`**

```svelte
<script lang="ts">
  import { data } from '../shared/state.svelte';
  import type { Conflict, Position } from '../shared/types';
  import { pickCopyFolder, saveProfile, session, useProfile } from './session.svelte';

  const POSITIONS: [Position, string][] = [['after', 'After'], ['before', 'Before'], ['below', 'Below'], ['above', 'Above']];
  const CONFLICTS: [Conflict, string][] = [['add', 'Add (1)'], ['skip', 'Skip'], ['replace', 'Replace']];
  const rules = $derived(session.rules);
  const current = $derived(data.profiles.rename.find((p) => p.id === session.profileId));
  let naming = $state(false);
  let newName = $state('');

  function pick(id: string) {
    const p = data.profiles.rename.find((x) => x.id === id);
    if (p) useProfile(p);
    else session.profileId = null;
  }
  function saveNew() {
    if (!newName.trim()) return;
    saveProfile(newName.trim());
    naming = false;
    newName = '';
  }
  function setCopy(copy: boolean) {
    session.rules.destination = copy ? { mode: 'copy', folder: data.settings.rename.folder } : { mode: 'inplace' };
  }
</script>

<div class="settings">
  <div class="card">
    <label class="label" for="rn-profile">Profile</label>
    <select id="rn-profile" class="field" value={session.profileId ?? ''} onchange={(e) => pick(e.currentTarget.value)}>
      <option value="">No profile</option>
      {#each data.profiles.rename as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
    </select>
    <div class="row">
      {#if current}<button class="btn small" onclick={() => saveProfile()}>Save changes</button>{/if}
      {#if naming}
        <input class="field grow" aria-label="New profile name" placeholder="Profile name" bind:value={newName} onkeydown={(e) => e.key === 'Enter' && saveNew()} />
        <button class="btn small primary" disabled={!newName.trim()} onclick={saveNew}>Save</button>
      {:else}
        <button class="btn small" onclick={() => (naming = true)}>Save as new profile</button>
      {/if}
    </div>
  </div>

  <div class="card">
    <h3>Value from PDF</h3>
    <label class="label" for="rn-kw">Keyword</label>
    <input id="rn-kw" class="field mono" placeholder="Invoice No.:" spellcheck="false" bind:value={session.rules.keyword} />
    <span class="label" id="rn-pos">The value is … the keyword</span>
    <div class="seg" role="group" aria-labelledby="rn-pos">
      {#each POSITIONS as [v, label] (v)}
        <button aria-pressed={rules.position === v} onclick={() => (session.rules.position = v)}>{label}</button>
      {/each}
    </div>
    <label class="inline">Use match number <input class="field num" type="number" min="1" max="99" bind:value={session.rules.occurrence} /></label>
  </div>

  <div class="card">
    <h3>Add text</h3>
    <div class="two">
      <label class="label">Before the value <input class="field mono" spellcheck="false" placeholder="CN_" bind:value={session.rules.prefix} /></label>
      <label class="label">After the value <input class="field mono" spellcheck="false" placeholder="_final" bind:value={session.rules.suffix} /></label>
    </div>
    <p class="hint mono">{rules.prefix}<span class="v">value</span>{rules.suffix}.pdf</p>
  </div>

  <div class="card">
    <label class="inline"><input type="checkbox" bind:checked={session.rules.pair} /> Rename matching .xlsx, .csv, .xml and .txt files with their PDF</label>
  </div>

  <div class="card">
    <h3>Output</h3>
    <div class="seg" role="group" aria-label="Where the files go">
      <button aria-pressed={rules.destination.mode === 'inplace'} onclick={() => setCopy(false)}>Rename in place</button>
      <button aria-pressed={rules.destination.mode === 'copy'} onclick={() => setCopy(true)}>Copy to folder</button>
    </div>
    {#if rules.destination.mode === 'copy'}
      <div class="row">
        <span class="folder mono" title={rules.destination.folder}>{rules.destination.folder || 'No folder chosen'}</span>
        <button class="btn small" onclick={() => void pickCopyFolder()}>Choose…</button>
      </div>
    {/if}
    <span class="label" id="rn-conf">If the name is taken</span>
    <div class="seg" role="group" aria-labelledby="rn-conf">
      {#each CONFLICTS as [v, label] (v)}
        <button aria-pressed={rules.conflict === v} onclick={() => (session.rules.conflict = v)}>{label}</button>
      {/each}
    </div>
    {#if rules.conflict === 'replace'}<p class="hint">Replaced files go to the Recycle Bin.</p>{/if}
  </div>
</div>

<style>
  .settings { flex: 0 0 300px; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 0 2px 12px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .two .label { display: flex; flex-direction: column; gap: 4px; }
  .num { width: 64px; }
  .v { color: var(--accent); }
  .grow { flex: 1; min-width: 0; }
  .folder { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text2); }
</style>
```

- [ ] **Step 6: Write `src/lib/rename/Preview.svelte`**

```svelte
<script lang="ts">
  import { extOf, splitExt, splitPath } from '../shared/names';
  import type { PlanItem, Status } from '../shared/types';
  import { clearFiles, pickFiles, pickFolder, plan, removeFile, session, setName, skip } from './session.svelte';

  const PILL: Record<Status, [string, string]> = {
    ready: ['ok', 'Ready'],
    paired: ['ok', 'Paired'],
    duplicate: ['warn', 'Duplicate'],
    unchanged: ['muted', 'Unchanged'],
    attention: ['err', 'Attention'],
    skipped: ['muted', 'Skipped'],
    pending: ['muted', 'Waiting'],
  };
  const nameOf = (p: string) => splitPath(p).name;
  const shownName = (it: PlanItem) => session.overrides[it.source] ?? (it.name ? splitExt(it.name).base : '');
</script>

<div class="card preview">
  <div class="row head">
    <h3>{session.files.length} {session.files.length === 1 ? 'file' : 'files'}</h3>
    {#if session.loading}<span class="hint">reading…</span>{/if}
    <span class="grow"></span>
    <button class="btn small" onclick={() => void pickFiles()}>Add files</button>
    <button class="btn small" onclick={() => void pickFolder()}>Add folder</button>
    <button class="btn small" onclick={clearFiles}>Clear</button>
  </div>
  {#if !session.rules.keyword.trim()}
    <p class="hint banner">Type the keyword that comes before the value to see the new names.</p>
  {/if}
  <ul>
    {#each plan.items as it (it.id)}
      {@const [tone, label] = PILL[it.status]}
      <li class:dim={it.status === 'skipped' || it.status === 'unchanged'}>
        <span class="from mono" title={it.source}>{nameOf(it.source)}</span>
        <span class="to">
          <input
            class="mono"
            spellcheck="false"
            aria-label="New name for {nameOf(it.source)}"
            placeholder="Type a name"
            value={shownName(it)}
            disabled={it.status === 'skipped'}
            onchange={(e) => setName(it.source, e.currentTarget.value)}
          />
          <span class="ext mono">{extOf(it.source)}</span>
        </span>
        <span class="pill {tone}">{label}</span>
        <button class="ib" title={it.status === 'skipped' ? 'Include' : 'Skip'} aria-label="{it.status === 'skipped' ? 'Include' : 'Skip'} {nameOf(it.source)}" onclick={() => skip(it.source)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>
        </button>
        <button class="ib" title="Remove from the list" aria-label="Remove {nameOf(it.source)}" onclick={() => removeFile(it.source)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        {#if it.detail && it.status !== 'ready'}<span class="why">{it.detail}</span>{/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .preview { flex: 1; min-height: 0; padding: 0; gap: 0; }
  .head { padding: 12px 14px; border-bottom: 1px solid var(--border); }
  .banner { padding: 10px 14px 0; }
  .grow { flex: 1; }
  ul { list-style: none; margin: 0; padding: 4px 0; overflow: auto; flex: 1; }
  li { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto auto auto; align-items: center; gap: 8px; padding: 3px 8px 3px 14px; }
  li:hover { background: var(--hover); }
  li.dim { opacity: 0.65; }
  .from { font-size: 12.5px; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .to { display: flex; align-items: center; min-width: 0; }
  .to input { flex: 1; min-width: 0; height: 28px; padding: 0 6px; border: 1px solid transparent; border-radius: 6px; background: transparent; font-size: 12.5px; }
  .to input:hover { border-color: var(--border); }
  .to input:focus { border-color: var(--accent); outline: none; background: var(--bg); }
  .ext { font-size: 12.5px; color: var(--text3); }
  .why { grid-column: 1 / -1; font-size: 12px; color: var(--text3); }
  .ib { width: 28px; height: 28px; }
</style>
```

- [ ] **Step 7: Write `src/lib/rename/DropZone.svelte`**

```svelte
<script lang="ts">
  import { data, save } from '../shared/state.svelte';
  import { pickFiles, pickFolder } from './session.svelte';
</script>

<div class="drop">
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
  <p class="big">Drop files or folders here</p>
  <p class="hint">PDFs, plus the .xlsx, .csv, .xml and .txt files that belong to them</p>
  <div class="row">
    <button class="btn primary" onclick={() => void pickFiles()}>Add files</button>
    <button class="btn" onclick={() => void pickFolder()}>Add folder</button>
  </div>
  <label class="inline"><input type="checkbox" bind:checked={data.settings.rename.recursive} onchange={() => save('settings')} /> Include subfolders</label>
</div>

<style>
  .drop {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
    border: 1.5px dashed var(--border2); border-radius: 8px; background: var(--surface); padding: 32px;
  }
  .big { margin: 4px 0 0; font-size: 16px; font-weight: 600; }
  .hint { text-align: center; }
</style>
```

- [ ] **Step 8: Write `src/lib/rename/Rename.svelte`**

```svelte
<script lang="ts">
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { onMount } from 'svelte';
  import { ui } from '../app.svelte';
  import { undoLast } from '../shared/batches';
  import { data } from '../shared/state.svelte';
  import { lastUndoable } from '../shared/store';
  import { island, send } from '../shell/island.svelte';
  import DropZone from './DropZone.svelte';
  import { summary } from './engine/planner';
  import Preview from './Preview.svelte';
  import RenameSettings from './RenameSettings.svelte';
  import { addPaths, plan, refresh, runBatch, session } from './session.svelte';

  let dragging = $state(false);
  const sum = $derived(summary(plan.items, session.rules.destination));
  const copy = $derived(session.rules.destination.mode === 'copy');

  // re-read 150 ms after the files or the reading rules change; prefix, suffix and conflicts only re-plan
  $effect(() => {
    const r = session.rules;
    JSON.stringify([session.files, r.keyword, r.position, r.occurrence, r.pair, r.destination]);
    const t = setTimeout(() => void refresh(), 150);
    return () => clearTimeout(t);
  });

  // after a batch, the island's attention count follows the fixes made here
  $effect(() => {
    const n = sum.attention;
    if (island.attention && island.attention !== n) send({ type: 'attention', count: n });
  });

  onMount(() => {
    const off = getCurrentWebview().onDragDropEvent(({ payload: p }) => {
      if (ui.tool !== 'rename' || ui.panel) return;
      if (p.type === 'enter' || p.type === 'over') dragging = true;
      else if (p.type === 'leave') dragging = false;
      else {
        dragging = false;
        void addPaths(p.paths);
      }
    });
    return () => void off.then((f) => f());
  });
</script>

<section class="rename">
  <header>
    <h1>Rename</h1>
    <p class="hint">Rules on the left, every new name previewed on the right.</p>
  </header>
  <div class="cols">
    <RenameSettings />
    <div class="right">
      {#if session.files.length}<Preview />{:else}<DropZone />{/if}
    </div>
  </div>
  <footer>
    <span class="count">
      {#if session.files.length}{sum.ops} {sum.ops === 1 ? 'file' : 'files'} will be {copy ? 'copied' : 'renamed'}{:else}No files yet{/if}
    </span>
    {#if sum.attention}
      <button class="attn" onclick={() => (ui.panel = 'attention')}>{sum.attention} {sum.attention === 1 ? 'needs' : 'need'} attention</button>
    {/if}
    <span class="grow"></span>
    <button class="btn" disabled={!lastUndoable(data.history) || !!island.activity} onclick={() => void undoLast()}>Undo last batch</button>
    <button class="btn primary" disabled={!sum.ops || session.loading || session.busy} onclick={() => void runBatch()}>{sum.label}</button>
  </footer>
  {#if dragging}<div class="drop" aria-hidden="true">Drop to add</div>{/if}
</section>

<style>
  .rename { height: 100%; display: flex; flex-direction: column; gap: 14px; }
  h1 { font-size: 22px; }
  .cols { flex: 1; min-height: 0; display: flex; gap: 16px; }
  .right { flex: 1 1 420px; min-width: 0; display: flex; flex-direction: column; }
  footer { display: flex; align-items: center; gap: 10px; padding: 12px 0 16px; border-top: 1px solid var(--border); }
  .count { font-size: 13px; color: var(--text2); font-variant-numeric: tabular-nums; }
  .attn { height: 24px; padding: 0 10px; border: 0; border-radius: 999px; background: var(--warnsoft); color: var(--warn); font-size: 12px; font-weight: 600; }
  .grow { flex: 1; }
  .drop {
    position: fixed; inset: 72px 12px 12px; display: grid; place-items: center; pointer-events: none;
    border: 2px dashed var(--accent); border-radius: 12px; background: var(--soft); color: var(--accent); font-weight: 600;
  }
</style>
```

- [ ] **Step 9: Put the screen in the shell**

In `src/App.svelte`:
- Replace `import { ipc } from './lib/shared/ipc';` with `import Rename from './lib/rename/Rename.svelte';` and `import { cancelActivity } from './lib/rename/session.svelte';`.
- Replace `oncancel={() => void ipc.cancelApply()}` with `oncancel={cancelActivity}`.
- Replace `<h1>Rename</h1>` with `<Rename />`.

- [ ] **Step 10: Check the whole flow on fixture copies**

Run:
```bash
npm test && npm run check && npm run build
TRY=$(node -p "require('path').join(require('os').tmpdir(), 'vellova-try')")
rm -rf "$TRY" && mkdir -p "$TRY"
cp test/fixtures/ssrs-same-line.pdf test/fixtures/ssrs-two-column.pdf test/fixtures/ssrs-no-colon.pdf test/fixtures/pair/export-17.xlsx test/fixtures/pair/decoy.xlsx "$TRY"
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev   # background
node scripts/cdp.mjs eval "__rename.session.rules.keyword = 'Invoice No.:'; __rename.addPaths([$(node -p 'JSON.stringify(process.argv[1])' "$TRY")])"
node scripts/cdp.mjs eval "JSON.stringify(__rename.plan.items.map((i) => [i.status, i.name ?? i.reason]))"
```
Expected:
- Tests pass, check shows `0 errors`, and the build lists `pdf.worker.min-*.js` and `sheet.worker-*.js`.
- About a second after `addPaths`, the second eval prints these five, in the folder's (alphabetical) order:
  - `["attention","no-match"]` for `decoy.xlsx`
  - `["paired","DN-2026-00017.xlsx"]` for `export-17.xlsx`
  - `["attention","keyword-not-found"]` for `ssrs-no-colon.pdf`
  - `["ready","DN-2026-00017.pdf"]`
  - `["ready","INV-2026-00119.pdf"]`

Then:
```bash
node scripts/cdp.mjs eval "__rename.runBatch()"
ls "$TRY"                                   # once the island shows the result
node scripts/cdp.mjs shot rename-done.png
node scripts/cdp.mjs eval "__rename.undoLast()"
ls "$TRY"                                   # once the island shows "names restored"
```
Expected:
- The first `ls` lists `DN-2026-00017.pdf`, `DN-2026-00017.xlsx`, `INV-2026-00119.pdf`, `decoy.xlsx` and `ssrs-no-colon.pdf`.
- `rename-done.png` shows the island's amber "2 files need attention" layer. The preview now lists only the two attention files.
- The second `ls` lists the five original names again.

By hand:
1. Drag a fixture PDF from Explorer onto the window: the dashed "Drop to add" frame appears and the file is added.
2. Open a fixture copy in a PDF viewer that locks files (Acrobat or Edge), then rename. That file shows *Attention · File locked or in use*, and the rest are renamed.

Stop the app, delete `rename-done.png`, and run `rm -rf "$TRY"`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -F- <<'EOF'
feat: Rename screen with live preview, drag and drop, profiles, pairing, apply and undo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 13: Import from the previous rename app, and Welcome

**Files:**
- Create: `src/lib/migrate/nomina.ts`, `src/lib/migrate/run.ts`, `src/lib/panels/Welcome.svelte`, `test/migrate.test.ts`
- Modify: `src/App.svelte`

**Interfaces:**
- Consumes: `ipc.readLegacy` (Task 4); `DEFAULT_RULES`, `profileFromRules` (Task 9); `batchSummary`, `capHistory`, `withDefaults` (Task 4); `data`, `save`, `log`; `setTheme`.
- Produces:
  - `nomina.ts` (pure):
    - `NOMINA_FILES`
    - `mapProfiles(v): RenameProfile[]`; ids are `nomina-<old id>`, so importing twice adds nothing.
    - `mapHistory(current, old): Batch[]`, read-only and newest first.
    - `mapSettings(v): Partial<Settings>`
    - `type ImportPlan`, `planImport(texts): ImportPlan`, `isEmpty(plan)`
    - `mergeImport(current, plan): { profiles; history; added }`
    - `importProfiles(text): RenameProfile[]` accepts Vellova's export or the old profiles file.
  - `run.ts`:
    - `findOldData(): Promise<boolean>`
    - `importOldData(withSettings: boolean): Promise<string>` returns a sentence for the UI.
  - `Welcome.svelte`, with props `{ onclose: () => void }`.

The old app's files are in `%APPDATA%\Nomina\`:

| File | Shape |
|---|---|
| `nomina-profiles.json` | `[{ id, name, keyword, position, prefix, suffix, description? }]` |
| `nomina-history.json` | `[{ id, timestamp: ISO, profileName ('—' = none), files: [{ name, path }], totalRenamed, outputDir }]`. `files` holds the new names and paths only. |
| `nomina_history.json` (older) | `[{ id, timestamp: ISO or ms, anchorText, totalRenamed, files: [{ newName, originalName }] }]` |
| `nomina-settings.json` | `{ theme: 'light' \| 'dark', checkOnStartup, checkInterval: '30min' \| 'hourly' \| '6h' \| 'daily' }` |

- [ ] **Step 1: Write the failing test**

`test/migrate.test.ts` (synthetic examples of the real shapes):

```ts
import { describe, expect, it } from 'vitest';
import { importProfiles, isEmpty, mapHistory, mapProfiles, mapSettings, mergeImport, planImport } from '../src/lib/migrate/nomina';

const PROFILES = [
  { id: 'p_1', name: 'Debit notes', keyword: 'Invoice No.:', position: 'below', prefix: 'CN_', suffix: '', description: 'monthly' },
  { id: 'p_2', name: 'Odd', keyword: 'Ref', position: 'sideways' },
  { nope: true },
];
const HISTORY = [
  {
    id: 'h_1', timestamp: '2026-10-01T08:00:00.000Z', profileName: 'Debit notes', totalRenamed: 2, outputDir: 'C:\\in',
    files: [{ name: 'DN-1.pdf', path: 'C:\\in\\DN-1.pdf' }, { name: 'DN-1.xlsx', path: 'C:\\in\\DN-1.xlsx' }],
  },
  { id: 'h_2', timestamp: '2026-10-02T08:00:00.000Z', profileName: '—', files: [], totalRenamed: 0 },
];
const OLD_HISTORY = [{ id: 1700000000000, timestamp: 1700000000000, anchorText: 'No.', totalRenamed: 1, files: [{ newName: 'A.pdf', originalName: 'scan.pdf' }] }];
const SETTINGS = { theme: 'light', checkOnStartup: false, checkInterval: '30min' };

describe('importing the previous rename app', () => {
  it('profiles become one value step plus add text, with pairing on', () => {
    const [a, b, ...rest] = mapProfiles(PROFILES);
    expect(rest).toEqual([]);
    expect(a).toEqual({
      id: 'nomina-p_1', name: 'Debit notes', desc: 'monthly',
      steps: [{ type: 'pdfValue', keyword: 'Invoice No.:', position: 'below', occurrence: 1 }, { type: 'addText', prefix: 'CN_', suffix: '' }],
      pair: true, destination: { mode: 'inplace' }, conflict: 'add',
    });
    expect(b.steps[0]).toEqual({ type: 'pdfValue', keyword: 'Ref', position: 'after', occurrence: 1 });
  });

  it('both history files become read-only batches, newest first', () => {
    const h = mapHistory(HISTORY, OLD_HISTORY);
    expect(h.map((b) => [b.id, b.summary, b.undoable])).toEqual([
      ['nomina-h_2', '0 files renamed', false],
      ['nomina-h_1', '2 files renamed', false],
      ['nomina-old-1700000000000', '1 file renamed', false],
    ]);
    expect(h[1]).toMatchObject({ tool: 'rename', profile: 'Debit notes', time: Date.parse('2026-10-01T08:00:00.000Z') });
    expect(h[1].items[0]).toEqual({ from: '', to: 'C:\\in\\DN-1.pdf', ok: true });
    expect(h[0].profile).toBeUndefined();
    expect(h[2].items).toEqual([{ from: 'scan.pdf', to: 'A.pdf', ok: true }]);
  });

  it('settings map theme and update checks', () => {
    expect(mapSettings(SETTINGS)).toEqual({ theme: 'light', updates: { onStartup: false, everyHours: 1 } });
    expect(mapSettings({ checkInterval: '6h' }).updates).toEqual({ onStartup: true, everyHours: 6 });
    expect(mapSettings({ checkInterval: 'daily' }).updates?.everyHours).toBe(24);
    expect(mapSettings({ theme: 'purple' })).toEqual({});
  });

  it('missing or corrupt files import nothing', () => {
    expect(isEmpty(planImport([null, null, null, null]))).toBe(true);
    expect(isEmpty(planImport(['{oops', 'null', '', '[]']))).toBe(true);
    const plan = planImport([JSON.stringify(PROFILES), JSON.stringify(HISTORY), JSON.stringify(OLD_HISTORY), JSON.stringify(SETTINGS)]);
    expect([plan.profiles.length, plan.history.length, plan.settings.theme]).toEqual([2, 3, 'light']);
  });

  it('importing twice adds nothing the second time', () => {
    const plan = planImport([JSON.stringify(PROFILES), JSON.stringify(HISTORY), null, null]);
    const once = mergeImport({ profiles: [], history: [] }, plan);
    expect(once.added).toEqual({ profiles: 2, history: 2 });
    const twice = mergeImport({ profiles: once.profiles, history: once.history }, plan);
    expect(twice.added).toEqual({ profiles: 0, history: 0 });
    expect(twice.profiles).toHaveLength(2);
  });

  it('profile files: Vellova exports pass through, old files are mapped', () => {
    const ours = mapProfiles(PROFILES);
    expect(importProfiles(JSON.stringify({ rename: ours, split: [] }))).toEqual(ours);
    expect(importProfiles(JSON.stringify(PROFILES)).map((p) => p.name)).toEqual(['Debit notes', 'Odd']);
    expect(importProfiles('not json')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/migrate.test.ts`
Expected: FAIL, `Failed to load url ../src/lib/migrate/nomina`.

- [ ] **Step 3: Write `src/lib/migrate/nomina.ts`**

```ts
import { DEFAULT_RULES, profileFromRules } from '../rename/engine/profile';
import { batchSummary, capHistory } from '../shared/store';
import type { Batch, BatchItem, Position, RenameProfile, Settings } from '../shared/types';

/** Where the previous rename app kept its data, relative to %APPDATA%. Order matters for planImport. */
export const NOMINA_FILES = ['Nomina\\nomina-profiles.json', 'Nomina\\nomina-history.json', 'Nomina\\nomina_history.json', 'Nomina\\nomina-settings.json'];

const POSITIONS: Position[] = ['after', 'before', 'above', 'below'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const obj = (v: unknown): Record<string, any> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {});
const list = (v: unknown) => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
function parse(text: string | null): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Old profiles → one Value-from-PDF step plus Add text, with pairing on. */
export function mapProfiles(v: unknown): RenameProfile[] {
  return list(v)
    .filter((p) => str(p.name))
    .map((p) =>
      profileFromRules(
        { ...DEFAULT_RULES, keyword: str(p.keyword), position: POSITIONS.includes(p.position) ? p.position : 'after', prefix: str(p.prefix), suffix: str(p.suffix), pair: true },
        str(p.name),
        `nomina-${str(p.id) || str(p.name)}`,
        str(p.description),
      ),
    );
}

function batch(id: string, time: number, items: BatchItem[], profile?: string): Batch {
  const b: Batch = { id, tool: 'rename', time, verb: 'renamed', summary: '', items, undoable: false, ...(profile ? { profile } : {}) };
  b.summary = batchSummary(b);
  return b;
}

/** Both old history files → read-only batches (there is no journal, so no undo), newest first. */
export function mapHistory(current: unknown, old: unknown): Batch[] {
  const time = (t: unknown) => (typeof t === 'number' ? t : Date.parse(str(t)));
  const a = list(current).map((h) =>
    batch(
      `nomina-${h.id}`,
      time(h.timestamp),
      list(h.files).map((f) => ({ from: '', to: str(f.path) || str(f.name), ok: true })),
      h.profileName && h.profileName !== '—' ? str(h.profileName) : undefined,
    ),
  );
  const b = list(old).map((h) => batch(`nomina-old-${h.id}`, time(h.timestamp), list(h.files).map((f) => ({ from: str(f.originalName), to: str(f.newName), ok: true }))));
  return [...a, ...b].filter((x) => !Number.isNaN(x.time)).sort((x, y) => y.time - x.time);
}

const HOURS: Record<string, number> = { '30min': 1, hourly: 1, '6h': 6, daily: 24 };

/** Old settings → theme and update checks (the old default interval was hourly). */
export function mapSettings(v: unknown): Partial<Settings> {
  const s = obj(v);
  const out: Partial<Settings> = {};
  if (s.theme === 'light' || s.theme === 'dark') out.theme = s.theme;
  if (typeof s.checkOnStartup === 'boolean' || s.checkInterval in HOURS) {
    out.updates = { onStartup: s.checkOnStartup !== false, everyHours: HOURS[s.checkInterval] ?? 1 };
  }
  return out;
}

export type ImportPlan = { profiles: RenameProfile[]; history: Batch[]; settings: Partial<Settings> };

/** The old files' texts, in NOMINA_FILES order (null = missing), → what Vellova can import. */
export function planImport(texts: (string | null)[]): ImportPlan {
  const [profiles, history, oldHistory, settings] = texts.map(parse);
  return { profiles: mapProfiles(profiles), history: mapHistory(history, oldHistory), settings: mapSettings(settings) };
}

export const isEmpty = (p: ImportPlan) => !p.profiles.length && !p.history.length && !Object.keys(p.settings).length;

/** Adds what isn't there yet (same id = imported before). */
export function mergeImport(current: { profiles: RenameProfile[]; history: Batch[] }, plan: ImportPlan) {
  const pids = new Set(current.profiles.map((p) => p.id));
  const hids = new Set(current.history.map((b) => b.id));
  const profiles = plan.profiles.filter((p) => !pids.has(p.id));
  const history = plan.history.filter((b) => !hids.has(b.id));
  return {
    profiles: [...current.profiles, ...profiles],
    history: capHistory([...current.history, ...history].sort((x, y) => y.time - x.time)),
    added: { profiles: profiles.length, history: history.length },
  };
}

/** A profiles file chosen in Profiles › Import: Vellova's own export, or the previous app's profiles file. */
export function importProfiles(text: string): RenameProfile[] {
  const v = parse(text);
  const items = Array.isArray(v) ? v : obj(v).rename;
  const ours = list(items).filter((p) => Array.isArray(p.steps) && str(p.name) && str(p.id));
  return ours.length ? (ours as RenameProfile[]) : mapProfiles(items);
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npx vitest run test/migrate.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write `src/lib/migrate/run.ts`**

```ts
import { setTheme } from '../app.svelte';
import { ipc } from '../shared/ipc';
import { data, log, save } from '../shared/state.svelte';
import { withDefaults } from '../shared/store';
import { isEmpty, mergeImport, NOMINA_FILES, planImport } from './nomina';

const readPlan = async () => planImport(await ipc.readLegacy(NOMINA_FILES));

export const findOldData = async () => !isEmpty(await readPlan());

/** Imports profiles and history from the previous rename app; its settings only on first launch. */
export async function importOldData(withSettings: boolean): Promise<string> {
  const plan = await readPlan();
  const m = mergeImport({ profiles: data.profiles.rename, history: data.history }, plan);
  data.profiles.rename = m.profiles;
  data.history = m.history;
  save('profiles');
  save('history');
  if (withSettings) {
    data.settings = withDefaults({ ...data.settings, ...plan.settings });
    setTheme(data.settings.theme);
    save('settings');
  }
  const { profiles: p, history: h } = m.added;
  const text = `Imported ${p} ${p === 1 ? 'profile' : 'profiles'} and ${h} history ${h === 1 ? 'entry' : 'entries'}.`;
  log({ level: 'info', tool: 'app', message: text });
  return text;
}
```

- [ ] **Step 6: Write `src/lib/panels/Welcome.svelte`**

The UI never names the old apps.

```svelte
<script lang="ts">
  import { findOldData, importOldData } from '../migrate/run';

  let { onclose }: { onclose: () => void } = $props();
  let found = $state(false);
  let busy = $state(false);
  let result = $state('');

  $effect(() => {
    findOldData().then((f) => (found = f), () => (found = false));
  });

  async function bring() {
    busy = true;
    result = await importOldData(true).catch((e) => `The import failed: ${e}`);
    busy = false;
  }
</script>

<p>Vellova renames PDFs using a value found inside them, and renames their matching spreadsheets and text files with them. Splitting spreadsheets comes in the next update.</p>
<p class="hint">Everything stays on this computer. Every batch can be undone from History.</p>

{#if found}
  <div class="card">
    <h3>Bring your earlier setup</h3>
    <p class="hint">Profiles, history and settings from your previous renaming app are on this computer. The old app keeps its own copy.</p>
    {#if result}
      <p role="status">{result}</p>
    {:else}
      <div class="row">
        <button class="btn primary" disabled={busy} onclick={bring}>Import</button>
        <button class="btn" onclick={onclose}>Not now</button>
      </div>
    {/if}
  </div>
{/if}

<div class="row"><button class="btn primary" onclick={onclose}>Get started</button></div>
```

- [ ] **Step 7: Show it on first launch**

In `src/App.svelte`:

1. Add these imports:
   ```ts
   import Welcome from './lib/panels/Welcome.svelte';
   import { data, save } from './lib/shared/state.svelte';
   ```
2. Add this below the imports:
   ```ts
   if (!data.settings.welcomed) ui.panel = 'welcome';

   function closePanel() {
     if (ui.panel === 'welcome') {
       data.settings.welcomed = true;
       save('settings');
     }
     ui.panel = null;
   }
   ```
3. In `onkeydown`, replace `if (action === 'close-panel') ui.panel = null;` with `if (action === 'close-panel') closePanel();`.
4. Replace the `{#if ui.panel}` block with:
   ```svelte
   {#if ui.panel}
     <Panel title={PANEL_TITLES[ui.panel]} onclose={closePanel}>
       {#if ui.panel === 'welcome'}<Welcome onclose={closePanel} />{:else}<p class="hint">{PANEL_TITLES[ui.panel]}</p>{/if}
     </Panel>
   {/if}
   ```

- [ ] **Step 8: Check**

Run:
```bash
npm test && npm run check
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev   # background
node scripts/cdp.mjs eval "document.querySelector('#panel-title')?.textContent"
```
Expected: tests pass, `0 errors`, and the eval prints `"Welcome to Vellova"`. On this machine the old app's data exists, so the Import card is shown.

Do **not** click Import here, because it would copy real profile names into the dev data folder. Click *Get started* instead, restart the app, and confirm Welcome no longer opens. To see Welcome again, delete `%APPDATA%\com.vslnnd.vellova\settings.json`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -F- <<'EOF'
feat: import profiles, history and settings from the previous rename app; Welcome panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 14: Panels: History, Profiles, Settings, Needs attention

**Files:**
- Create: `src/lib/panels/History.svelte`, `src/lib/panels/Profiles.svelte`, `src/lib/panels/Settings.svelte`, `src/lib/panels/NeedsAttention.svelte`
- Modify: `src/App.svelte` (full file)

**Interfaces:**
- Consumes:
  - `data`, `save` (4); `logToText` (4); `ipc.saveText`, `ipc.readFile` (4–5).
  - `undoBatch` (11); `island` (10); `switchTheme` (2); `setTheme`, `ui` (2).
  - `REASONS`, `plan`, `session`, `skip`, `setName`, `retry`, `pickPdf`, `applyFixes`, `useProfile` (12).
  - `rulesFromProfile` (9); `PDF` (9); `importProfiles` (13); `findOldData`, `importOldData` (13).
- Produces: the four panel components, each without props. `App.svelte` is final except for the updater wiring in Task 15.

The panels are thin views over tested state, so they have no unit tests. Each step ends with a check in the running app.

- [ ] **Step 1: Write `src/lib/panels/History.svelte`**

```svelte
<script lang="ts">
  import { save as saveDialog } from '@tauri-apps/plugin-dialog';
  import { revealItemInDir } from '@tauri-apps/plugin-opener';
  import { REASONS } from '../rename/session.svelte';
  import { undoBatch } from '../shared/batches';
  import { ipc } from '../shared/ipc';
  import { splitPath } from '../shared/names';
  import { data } from '../shared/state.svelte';
  import { logToText } from '../shared/store';
  import type { Batch } from '../shared/types';
  import { island } from '../shell/island.svelte';

  let tab = $state<'batches' | 'log'>('batches');
  let tool = $state<'all' | 'rename' | 'split' | 'app'>('all');
  let level = $state<'all' | 'warn' | 'error'>('all');

  const batches = $derived(data.history.filter((b) => tool === 'all' || b.tool === tool));
  // newest first; "warn" means warnings and errors
  const entries = $derived(
    data.log.filter((e) => (tool === 'all' || e.tool === tool) && (level === 'all' || e.level === 'error' || e.level === level)).slice().reverse(),
  );
  const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const name = (p: string) => splitPath(p).name;

  function show(b: Batch) {
    const it = b.items.find((i) => i.ok) ?? b.items[0];
    if (it) void revealItemInDir(b.undone && it.from ? it.from : it.to).catch(() => {});
  }
  async function exportLog() {
    const path = await saveDialog({ defaultPath: `vellova-log-${new Date().toISOString().slice(0, 10)}.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] });
    if (path) await ipc.saveText(path, logToText(entries.slice().reverse()));
  }
</script>

<div class="row">
  <div class="seg" role="group" aria-label="Show">
    <button aria-pressed={tab === 'batches'} onclick={() => (tab = 'batches')}>Batches</button>
    <button aria-pressed={tab === 'log'} onclick={() => (tab = 'log')}>Log</button>
  </div>
  <select class="field auto" aria-label="Tool" bind:value={tool}>
    <option value="all">All tools</option>
    <option value="rename">Rename</option>
    <option value="split">Split</option>
    {#if tab === 'log'}<option value="app">App</option>{/if}
  </select>
  {#if tab === 'log'}
    <select class="field auto" aria-label="Severity" bind:value={level}>
      <option value="all">Everything</option>
      <option value="warn">Warnings and errors</option>
      <option value="error">Errors</option>
    </select>
    <button class="btn small" disabled={!entries.length} onclick={() => void exportLog()}>Export .txt</button>
  {/if}
</div>

{#if tab === 'batches'}
  {#each batches as b (b.id)}
    <details class="item">
      <summary>
        <span class="what">{b.summary}</span>
        {#if b.undone}<span class="pill muted">Undone</span>{/if}
        <span class="meta">{when(b.time)}{b.profile ? ` · ${b.profile}` : ''}</span>
      </summary>
      <div class="row">
        {#if b.undoable && !b.undone}<button class="btn small" disabled={!!island.activity} onclick={() => void undoBatch(b.id)}>Undo</button>{/if}
        <button class="btn small" onclick={() => show(b)}>Show files</button>
      </div>
      <ul>
        {#each b.items as it, i (i)}
          <li>
            <span class="mono">{it.from ? name(it.from) : '—'}</span> → <span class="mono">{name(it.to)}</span>
            {#if !it.ok}<span class="pill err">{it.reason ? REASONS[it.reason].title : 'Failed'}</span>{/if}
          </li>
        {/each}
      </ul>
    </details>
  {:else}
    <p class="hint">No batches yet.</p>
  {/each}
{:else}
  {#each entries as e, i (i)}
    <details class="item">
      <summary>
        <span class="pill {e.level === 'error' ? 'err' : e.level === 'warn' ? 'warn' : 'muted'}">{e.level}</span>
        <span class="what">{e.message}</span>
        <span class="meta">{when(e.t)} · {e.tool}{e.file ? ` · ${name(e.file)}` : ''}</span>
      </summary>
      {#if e.file}<p class="mono small">{e.file}</p>{/if}
      {#if e.detail}<pre class="mono small">{e.detail}</pre>{:else}<p class="hint">No technical details.</p>{/if}
    </details>
  {:else}
    <p class="hint">Nothing logged.</p>
  {/each}
{/if}

<style>
  .auto { width: auto; }
  .item { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  summary { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; cursor: pointer; }
  .what { font-weight: 500; }
  .meta { flex-basis: 100%; font-size: 12px; color: var(--text3); }
  ul { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
  .small { font-size: 12px; margin: 6px 0 0; white-space: pre-wrap; word-break: break-all; color: var(--text2); }
</style>
```

- [ ] **Step 2: Write `src/lib/panels/Profiles.svelte`**

```svelte
<script lang="ts">
  import { ask, open, save as saveDialog } from '@tauri-apps/plugin-dialog';
  import { ui } from '../app.svelte';
  import { importProfiles } from '../migrate/nomina';
  import { rulesFromProfile } from '../rename/engine/profile';
  import { useProfile } from '../rename/session.svelte';
  import { ipc } from '../shared/ipc';
  import { data, save } from '../shared/state.svelte';
  import type { RenameProfile } from '../shared/types';

  let editing = $state<string | null>(null);
  let message = $state('');

  function describe(p: RenameProfile) {
    const r = rulesFromProfile(p);
    const text = r.prefix || r.suffix ? ` · ${r.prefix}value${r.suffix}` : '';
    return `${r.keyword || 'no keyword'} · ${r.position}${text}${r.destination.mode === 'copy' ? ' · copy to folder' : ''}`;
  }
  function use(p: RenameProfile) {
    useProfile(p);
    ui.tool = 'rename';
    ui.panel = null;
  }
  function rename(p: RenameProfile, name: string) {
    if (name.trim()) {
      p.name = name.trim();
      save('profiles');
    }
    editing = null;
  }
  function duplicate(p: RenameProfile) {
    const list = data.profiles.rename;
    list.splice(list.indexOf(p) + 1, 0, { ...$state.snapshot(p), id: crypto.randomUUID(), name: `${p.name} (copy)` });
    save('profiles');
  }
  async function remove(p: RenameProfile) {
    if (!(await ask(`Delete the profile "${p.name}"?`, { title: 'Delete profile', kind: 'warning' }))) return;
    data.profiles.rename = data.profiles.rename.filter((x) => x.id !== p.id);
    save('profiles');
  }
  async function exportAll() {
    const path = await saveDialog({ defaultPath: 'vellova-profiles.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!path) return;
    await ipc.saveText(path, JSON.stringify({ rename: $state.snapshot(data.profiles.rename), split: [] }, null, 2));
    message = `Exported ${data.profiles.rename.length} ${data.profiles.rename.length === 1 ? 'profile' : 'profiles'}.`;
  }
  async function importFile() {
    const path = await open({ filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!path) return;
    try {
      const ids = new Set(data.profiles.rename.map((p) => p.id));
      const fresh = importProfiles(new TextDecoder().decode(await ipc.readFile(path))).filter((p) => !ids.has(p.id));
      data.profiles.rename = [...data.profiles.rename, ...fresh];
      save('profiles');
      message = fresh.length ? `Imported ${fresh.length} ${fresh.length === 1 ? 'profile' : 'profiles'}.` : 'No new profiles in that file.';
    } catch (e) {
      message = `That file couldn't be read: ${e}`;
    }
  }
</script>

<div class="row">
  <button class="btn small" onclick={() => void importFile()}>Import…</button>
  <button class="btn small" disabled={!data.profiles.rename.length} onclick={() => void exportAll()}>Export all…</button>
</div>
{#if message}<p class="hint" role="status">{message}</p>{/if}
<p class="hint">To create a profile, set up Rename and choose "Save as new profile".</p>

{#each data.profiles.rename as p (p.id)}
  <div class="card">
    {#if editing === p.id}
      <input
        class="field"
        aria-label="Profile name"
        value={p.name}
        {@attach (el) => el.focus()}
        onkeydown={(e) => {
          if (e.key === 'Enter') rename(p, e.currentTarget.value);
          if (e.key === 'Escape') {
            e.stopPropagation();
            editing = null;
          }
        }}
        onblur={(e) => rename(p, e.currentTarget.value)}
      />
    {:else}
      <h3>{p.name}</h3>
    {/if}
    <p class="hint mono">{describe(p)}</p>
    {#if p.desc}<p class="hint">{p.desc}</p>{/if}
    <div class="row">
      <button class="btn small primary" onclick={() => use(p)}>Use</button>
      <button class="btn small" onclick={() => (editing = p.id)}>Rename</button>
      <button class="btn small" onclick={() => duplicate(p)}>Duplicate</button>
      <button class="btn small" onclick={() => void remove(p)}>Delete</button>
    </div>
  </div>
{:else}
  <p class="hint">No profiles yet.</p>
{/each}
```

- [ ] **Step 3: Write `src/lib/panels/Settings.svelte`**

```svelte
<script lang="ts">
  import { getVersion } from '@tauri-apps/api/app';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { flushSync } from 'svelte';
  import { setTheme } from '../app.svelte';
  import { findOldData, importOldData } from '../migrate/run';
  import { data, save } from '../shared/state.svelte';
  import { switchTheme, type ThemePref } from '../shell/theme';

  const THEMES: [ThemePref, string][] = [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']];
  const EVERY: [number, string][] = [[1, 'every hour'], [6, 'every 6 hours'], [24, 'once a day'], [0, 'never']];
  let version = $state('');
  let old = $state(false);
  let imported = $state('');

  $effect(() => {
    getVersion().then((v) => (version = v));
    findOldData().then((f) => (old = f), () => {});
  });

  function theme(t: ThemePref, el: HTMLElement) {
    data.settings.theme = t;
    save('settings');
    switchTheme(() => {
      setTheme(t);
      flushSync();
    }, el);
  }
  const updatesChanged = () => save('settings');
  async function bring() {
    imported = await importOldData(false).catch((e) => `The import failed: ${e}`);
  }
</script>

<section class="card">
  <h3>Appearance</h3>
  <div class="seg" role="group" aria-label="Theme">
    {#each THEMES as [v, label] (v)}
      <button aria-pressed={data.settings.theme === v} onclick={(e) => theme(v, e.currentTarget)}>{label}</button>
    {/each}
  </div>
</section>

<section class="card">
  <h3>Updates</h3>
  <label class="inline"><input type="checkbox" bind:checked={data.settings.updates.onStartup} onchange={updatesChanged} /> Check when Vellova starts</label>
  <label class="inline">
    Check
    <select class="field auto" bind:value={data.settings.updates.everyHours} onchange={updatesChanged}>
      {#each EVERY as [v, label] (v)}<option value={v}>{label}</option>{/each}
    </select>
  </label>
</section>

<section class="card">
  <h3>Rename</h3>
  <label class="inline"><input type="checkbox" bind:checked={data.settings.rename.recursive} onchange={() => save('settings')} /> Include subfolders when adding a folder</label>
  <p class="hint">Copy-to folder: <span class="mono">{data.settings.rename.folder || 'none yet'}</span></p>
</section>

{#if old}
  <section class="card">
    <h3>Earlier data</h3>
    <p class="hint">Import profiles and history from your previous renaming app. Anything imported before is skipped.</p>
    <div class="row"><button class="btn small" onclick={() => void bring()}>Import</button></div>
    {#if imported}<p class="hint" role="status">{imported}</p>{/if}
  </section>
{/if}

<section class="card">
  <h3>About</h3>
  <p class="hint">Vellova {version}. Your files, history and log never leave this computer.</p>
  <div class="row">
    <button class="btn small" onclick={() => void openUrl('https://github.com/vslnnd/Vellova/issues/new')}>Send feedback</button>
  </div>
</section>

<style>
  .auto { width: auto; }
</style>
```

- [ ] **Step 4: Write `src/lib/panels/NeedsAttention.svelte`**

Actions per reason, following the spec's Errors table:

| Reason | Actions |
|---|---|
| keyword-not-found, no-value, no-text | Type a name · Skip |
| unreadable | Skip |
| no-match | Pick its PDF · Skip |
| locked, exists, internal | Retry · Skip, with bulk Retry all |
| permission, missing | Show in folder · Skip |

Every group also has Skip all.

```svelte
<script lang="ts">
  import { revealItemInDir } from '@tauri-apps/plugin-opener';
  import { ui } from '../app.svelte';
  import { PDF } from '../rename/engine/files';
  import { applyFixes, pickPdf, plan, REASONS, retry, session, setName, skip } from '../rename/session.svelte';
  import { extOf, splitPath } from '../shared/names';
  import type { PlanItem, Reason } from '../shared/types';
  import { island } from '../shell/island.svelte';

  const TYPE: Reason[] = ['keyword-not-found', 'no-value', 'no-text'];
  const RETRY: Reason[] = ['locked', 'exists', 'internal'];
  const SHOW: Reason[] = ['permission', 'missing'];

  const groups = $derived.by(() => {
    const m = new Map<Reason, PlanItem[]>();
    for (const it of plan.items) if (it.status === 'attention' && it.reason) m.set(it.reason, [...(m.get(it.reason) ?? []), it]);
    return [...m];
  });
  const pdfs = $derived(plan.items.filter((i) => extOf(i.source) === PDF && i.name));
  const ready = $derived(plan.items.filter((i) => i.op && i.status !== 'attention' && session.fixed.includes(i.source)).length);
  const name = (p: string) => splitPath(p).name;

  function apply() {
    ui.panel = null;
    void applyFixes();
  }
</script>

{#if !groups.length}<p class="hint">Nothing needs attention.</p>{/if}

{#each groups as [reason, items] (reason)}
  <section class="card">
    <div class="row">
      <h3>{REASONS[reason].title} · {items.length}</h3>
      <span class="grow"></span>
      {#if RETRY.includes(reason)}<button class="btn small" onclick={() => items.forEach((i) => void retry(i.source))}>Retry all</button>{/if}
      <button class="btn small" onclick={() => items.forEach((i) => skip(i.source))}>Skip all</button>
    </div>
    <p class="hint">{REASONS[reason].hint}</p>
    <ul>
      {#each items as it (it.id)}
        <li>
          <span class="mono file" title={it.source}>{name(it.source)}</span>
          {#if it.detail && it.detail !== REASONS[reason].hint}<span class="hint">{it.detail}</span>{/if}
          <div class="row">
            {#if TYPE.includes(reason)}
              <input class="field mono grow" placeholder="Type a name" aria-label="New name for {name(it.source)}" onchange={(e) => setName(it.source, e.currentTarget.value, true)} />
            {:else if reason === 'no-match'}
              <select class="field grow" aria-label="PDF for {name(it.source)}" onchange={(e) => e.currentTarget.value && pickPdf(it.source, e.currentTarget.value)}>
                <option value="">Pick its PDF…</option>
                {#each pdfs as p (p.id)}<option value={p.source}>{name(p.source)} → {p.name}</option>{/each}
              </select>
            {:else if RETRY.includes(reason)}
              <button class="btn small" onclick={() => void retry(it.source)}>Retry</button>
            {:else if SHOW.includes(reason)}
              <button class="btn small" onclick={() => void revealItemInDir(reason === 'missing' ? splitPath(it.source).dir : it.source).catch(() => {})}>Show in folder</button>
            {/if}
            <button class="btn small" onclick={() => skip(it.source)}>Skip</button>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/each}

<div class="row foot">
  <span class="hint">{ready ? `${ready} fixed ${ready === 1 ? 'file is' : 'files are'} ready.` : 'Fix files above, then apply them.'}</span>
  <span class="grow"></span>
  <button class="btn primary" disabled={!ready || session.busy || session.loading || !!island.activity} onclick={apply}>Apply fixes</button>
</div>

<style>
  ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
  li { display: flex; flex-direction: column; gap: 4px; }
  .file { font-size: 12.5px; }
  .grow { flex: 1; min-width: 0; }
  .foot { position: sticky; bottom: -24px; padding: 12px 0; background: var(--surface); border-top: 1px solid var(--border); }
</style>
```

- [ ] **Step 5: Write the final `src/App.svelte`**

```svelte
<script lang="ts">
  import { PANEL_TITLES, ui } from './lib/app.svelte';
  import History from './lib/panels/History.svelte';
  import NeedsAttention from './lib/panels/NeedsAttention.svelte';
  import Profiles from './lib/panels/Profiles.svelte';
  import Settings from './lib/panels/Settings.svelte';
  import Welcome from './lib/panels/Welcome.svelte';
  import Rename from './lib/rename/Rename.svelte';
  import { cancelActivity } from './lib/rename/session.svelte';
  import { undoLast } from './lib/shared/batches';
  import { data, save } from './lib/shared/state.svelte';
  import Panel from './lib/shell/Panel.svelte';
  import { shortcut } from './lib/shell/shortcuts';
  import TitleBar from './lib/shell/TitleBar.svelte';
  import Split from './lib/split/Split.svelte';

  if (!data.settings.welcomed) ui.panel = 'welcome';

  function closePanel() {
    if (ui.panel === 'welcome') {
      data.settings.welcomed = true;
      save('settings');
    }
    ui.panel = null;
  }

  const inText = () => !!document.activeElement?.matches('input:not([type=checkbox]):not([type=radio]), textarea, select');

  function onkeydown(e: KeyboardEvent) {
    const action = shortcut(e, inText());
    if (!action || (action === 'close-panel' && !ui.panel)) return;
    e.preventDefault();
    if (action === 'close-panel') closePanel();
    else if (action === 'tool-rename') ui.tool = 'rename';
    else if (action === 'tool-split') ui.tool = 'split';
    else void undoLast();
  }
</script>

<svelte:window {onkeydown} />

<div class="app">
  <TitleBar oncancel={cancelActivity} onundo={() => void undoLast()} onrestart={() => {}} />
  <main inert={!!ui.panel}>
    <div class="screen" class:on={ui.tool === 'rename'} inert={ui.tool !== 'rename'}><Rename /></div>
    <div class="screen" class:on={ui.tool === 'split'} inert={ui.tool !== 'split'}><Split /></div>
  </main>
  {#if ui.panel}
    <Panel title={PANEL_TITLES[ui.panel]} onclose={closePanel}>
      {#if ui.panel === 'history'}<History />
      {:else if ui.panel === 'profiles'}<Profiles />
      {:else if ui.panel === 'settings'}<Settings />
      {:else if ui.panel === 'attention'}<NeedsAttention />
      {:else}<Welcome onclose={closePanel} />{/if}
    </Panel>
  {/if}
</div>

<style>
  .app { height: 100%; display: flex; flex-direction: column; }
  main { position: relative; flex: 1; min-height: 0; }
  .screen {
    position: absolute; inset: 0; padding: 20px 24px 0; display: flex; flex-direction: column; opacity: 0; transform: translateY(8px); visibility: hidden;
    transition: opacity 260ms ease, transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s linear 260ms;
  }
  .screen.on { opacity: 1; transform: none; visibility: visible; transition-delay: 0s; }
</style>
```

- [ ] **Step 6: Check every panel**

Run:
```bash
npm test && npm run check
TRY=$(node -p "require('path').join(require('os').tmpdir(), 'vellova-try')")
rm -rf "$TRY" && mkdir -p "$TRY" && cp test/fixtures/ssrs-same-line.pdf test/fixtures/ssrs-no-colon.pdf test/fixtures/scanned.pdf test/fixtures/pair/decoy.xlsx "$TRY"
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev   # background
node scripts/cdp.mjs eval "__rename.session.rules.keyword = 'Invoice No.:'; __rename.addPaths([$(node -p 'JSON.stringify(process.argv[1])' "$TRY")])"
node scripts/cdp.mjs eval "__rename.runBatch()"
node scripts/cdp.mjs eval "document.querySelector('footer .attn').click(); [...document.querySelectorAll('.panel h3')].map((h) => h.textContent)"
node scripts/cdp.mjs shot attention.png
```
Expected:
- Tests pass and check shows `0 errors`.
- The last eval lists three groups, in list order: `"Companion file without a match · 1"`, `"Scanned PDF (no text layer) · 1"` and `"Keyword not found · 1"`.
- `attention.png` shows the Needs attention panel.

In the app window:
1. In Needs attention, type `Typed-name` for the scanned PDF, then click **Apply fixes**. The island shows the result.
2. Open History. One batch reads `2 files renamed`, because the fix joined the same batch. Click **Undo**: both files get their old names back (`ls "$TRY"`).
3. On the Log tab, choose *Warnings and errors*, then **Export .txt** to a file in `$TRY`, and open it. It has tab-separated lines.
4. Profiles: save the current rules as "Test", then Duplicate, Rename, Export all and Delete it. Import the exported file again: one profile is imported (the deleted one).
5. Settings: switch theme to Light (the circle reveal plays), then System. Toggle "Check when Vellova starts" and restart: the choice is kept.

Stop the app, run `rm -rf "$TRY"`, and delete `attention.png`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -F- <<'EOF'
feat: History, Profiles, Settings and Needs attention panels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

---

### Task 15: Updater, release workflow, README and release checks

**Files:**
- Create: `src/lib/updater.ts`, `.github/workflows/release.yml`, `README.md`
- Modify: `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src/App.svelte`, `src/lib/panels/Settings.svelte`

**Interfaces:**
- Consumes: `send` (10); `data`, `flush`, `log` (4).
- Produces: `updater.ts` with:
  - `checkForUpdate(manual?: boolean): Promise<string>`
  - `scheduleUpdates(startup: boolean)`
  - `restartToUpdate(): Promise<void>`

- [ ] **Step 1: Make the update key pair (free, self-generated, kept outside the repo)**

Run:
```bash
mkdir -p ~/.tauri
node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64url'))" > ~/.tauri/vellova.password.txt
npx tauri signer generate --ci -p "$(cat ~/.tauri/vellova.password.txt)" -w ~/.tauri/vellova.key
cat ~/.tauri/vellova.key.pub
```
Expected: `~/.tauri/vellova.key` and `~/.tauri/vellova.key.pub` exist, and the last command prints one long base64 line (the public key).

**USER STEP:** Back up `~/.tauri/vellova.key` and `~/.tauri/vellova.password.txt` somewhere safe, such as a password manager. Without them, installed copies can never be updated again.

- [ ] **Step 2: Add the updater plugin**

Run: `npm install @tauri-apps/plugin-updater@~2.14.0`

`src-tauri/Cargo.toml`, `[dependencies]`: add `tauri-plugin-updater = "2.14"`.

`src-tauri/src/lib.rs`: add `.plugin(tauri_plugin_updater::Builder::new().build())` after `.plugin(tauri_plugin_process::init())`.

`src-tauri/capabilities/default.json`: add `"updater:default"` to `permissions`.

`src-tauri/tauri.conf.json`:
- Add `"createUpdaterArtifacts": true` inside `bundle`.
- Add a top-level `plugins` block. Paste the line printed in Step 1 as `pubkey`:

```json
  "plugins": {
    "updater": {
      "pubkey": "<the line printed by cat ~/.tauri/vellova.key.pub>",
      "endpoints": ["https://github.com/vslnnd/Vellova/releases/latest/download/latest.json"],
      "windows": { "installMode": "passive" }
    }
  }
```

The public key is safe to commit. The private key never enters the repo.

- [ ] **Step 3: Write `src/lib/updater.ts`**

```ts
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { data, flush, log } from './shared/state.svelte';
import { send } from './shell/island.svelte';

let ready: Update | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

/** Looks for a newer release; one is downloaded in the background, then the island offers Restart. */
export async function checkForUpdate(manual = false): Promise<string> {
  if (ready) return `Version ${ready.version} is ready. Restart to install it.`;
  try {
    const update = await check();
    if (!update) return 'Vellova is up to date.';
    await update.download();
    ready = update;
    send({ type: 'updateReady', version: update.version });
    return `Version ${update.version} is ready. Restart to install it.`;
  } catch (e) {
    // spec: update-check failures are logged at info level and retried at the next interval
    log({ level: 'info', tool: 'app', message: 'Checking for updates failed; will try again later.', detail: String(e) });
    return manual ? "Couldn't reach the update server. Are you online?" : '';
  }
}

/** Starts (or restarts, after a settings change) the periodic check. */
export function scheduleUpdates(startup: boolean) {
  clearInterval(timer);
  const { onStartup, everyHours } = data.settings.updates;
  if (startup && onStartup) void checkForUpdate();
  if (everyHours > 0) timer = setInterval(() => void checkForUpdate(), everyHours * 3_600_000);
}

/** Saves pending data, installs the downloaded update (the installer closes the app) and relaunches. */
export async function restartToUpdate() {
  if (!ready) return;
  send({ type: 'restarting' });
  try {
    await flush();
    await ready.install();
    await relaunch();
  } catch (e) {
    log({ level: 'error', tool: 'app', message: 'The update could not be installed.', detail: String(e) });
    send({ type: 'clearTransient' });
  }
}
```

- [ ] **Step 4: Wire it in**

`src/App.svelte`:
- Add `import { restartToUpdate, scheduleUpdates } from './lib/updater';`.
- Below `if (!data.settings.welcomed) ui.panel = 'welcome';`, add `if (import.meta.env.PROD) scheduleUpdates(true);`.
- Replace `onrestart={() => {}}` with `onrestart={() => void restartToUpdate()}`.

`src/lib/panels/Settings.svelte`:
- Add `import { checkForUpdate, scheduleUpdates } from '../updater';`.
- Add `let checking = $state(false);` and `let updateText = $state('');`.
- Replace `const updatesChanged = () => save('settings');` with:

```ts
  function updatesChanged() {
    save('settings');
    scheduleUpdates(false);
  }
  async function checkNow() {
    checking = true;
    updateText = await checkForUpdate(true);
    checking = false;
  }
```

Then, in the Updates card, after the `<select>` label, add:

```svelte
  <div class="row">
    <button class="btn small" disabled={checking} onclick={() => void checkNow()}>{checking ? 'Checking…' : 'Check now'}</button>
    {#if updateText}<span class="hint" role="status">{updateText}</span>{/if}
  </div>
```

- [ ] **Step 5: Write `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - uses: dtolnay/rust-toolchain@stable
      - uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri -> target
      - run: npm ci
      - run: npm test
      - run: npm run check
      - run: cargo test --manifest-path src-tauri/Cargo.toml
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: Vellova __VERSION__
          releaseBody: |
            Download the `_x64-setup.exe` file below and run it. It installs for your user only.
            Windows SmartScreen may warn because Vellova isn't code-signed: choose **More info → Run anyway**.
            Installed copies update themselves.
          releaseDraft: false
          prerelease: false
          includeUpdaterJson: true
```

- [ ] **Step 6: Write `README.md`**

````markdown
# Vellova

Rename PDFs using a value found inside them, such as an invoice number, and rename their matching spreadsheets and text files with them. Splitting spreadsheets comes in the next update.

## Download

Get **`Vellova_<version>_x64-setup.exe`** from the [latest release](https://github.com/vslnnd/Vellova/releases/latest). It installs for your Windows user only, so no administrator rights are needed. Vellova updates itself.

### "Windows protected your PC"

Vellova isn't code-signed: a certificate costs money every year. Windows SmartScreen therefore warns the first time you run the installer. Click **More info**, then **Run anyway**.

GitHub Actions builds every installer from this repository. Updates are checked against Vellova's update key before they install.

## What it does

- **Rename:** finds a keyword in each PDF (for example `Invoice No.:`) and uses the value next to it (after, before, above or below) as the new name. It can add text before or after the value.
- **Matching files:** `.xlsx`, `.csv`, `.xml` and `.txt` files that contain a PDF's value get the same name.
- **Safe by design:** you see every new name before anything changes. Names that clash get ` (1)`, or you can choose Skip or Replace. Replaced files go to the Recycle Bin. Every batch can be undone from History.
- **Needs attention:** files without a value, scanned PDFs and locked files are listed with a reason, so you can fix them and apply only those.

Your files, history and log stay on your computer, in `%APPDATA%\com.vslnnd.vellova\`.

## Develop

Requirements: Windows 10/11, Node 24, Rust stable (MSVC) and WebView2.

```bash
npm install
npm run tauri dev        # run the app
npm test                 # unit and parity tests
cargo test --manifest-path src-tauri/Cargo.toml
npm run fixtures         # regenerate the synthetic test files
npm run compare -- "<folder>" --keyword "<keyword>"   # private check on your own PDFs (prints counts only)
```

## Release

Bump `version` in `package.json`, commit, then tag and push: `git tag v0.1.1 && git push origin v0.1.1`. The workflow tests, builds, signs the update and publishes the release.
````

- [ ] **Step 7: Build the installer locally and check size, start time and speed**

Run:
```bash
npm test && npm run check && cargo test --manifest-path src-tauri/Cargo.toml
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/vellova.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.tauri/vellova.password.txt)" npm run tauri build
ls -l src-tauri/target/release/bundle/nsis/
```
Expected:
- Everything passes.
- The folder holds `Vellova_0.1.0_x64-setup.exe` (**under 15 MB**) and `Vellova_0.1.0_x64-setup.exe.sig`.

Start time: run `src-tauri/target/release/vellova.exe`. The window appears in under a second. Close it.

Preview speed, with 200 PDFs within 10 s (spec budget):
```bash
TRY=$(node -p "require('path').join(require('os').tmpdir(), 'vellova-perf')")
rm -rf "$TRY" && mkdir -p "$TRY"
for i in $(seq 1 50); do for f in ssrs-same-line ssrs-two-column ssrs-repeat tj-kerning; do cp "test/fixtures/$f.pdf" "$TRY/$f-$i.pdf"; done; done
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev   # background
node scripts/cdp.mjs eval "(async () => { const t = performance.now(); __rename.session.rules.keyword = 'Invoice No.:'; await __rename.addPaths([$(node -p 'JSON.stringify(process.argv[1])' "$TRY")]); while (__rename.plan.items.length < 200 || __rename.plan.items.some((i) => i.status === 'pending')) await new Promise((r) => setTimeout(r, 50)); return Math.round(performance.now() - t); })()"
```
Expected: the number printed (milliseconds) is below `10000`, and the island's reading bar moves smoothly. Stop the app and run `rm -rf "$TRY"`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -F- <<'EOF'
feat: auto-update from GitHub Releases, release workflow and README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NBLETM2Jv8YtmdsXKStTs2
EOF
```

- [ ] **Step 9: USER STEPS: publish v0.1.0 (nothing here runs without the user's explicit OK)**

1. **Create the public repo and push.** Ask the user first. Once they say yes: `gh repo create vslnnd/Vellova --public --source . --push`.
2. **Add the two secrets.** Ask first. Once they say yes:
   ```bash
   gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/vellova.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < ~/.tauri/vellova.password.txt
   ```
3. **Tag.** Ask first: `git tag v0.1.0 && git push origin v0.1.0`. Then watch the run with `gh run watch`. Expected: a release `Vellova 0.1.0` with the setup `.exe`, its `.sig` and `latest.json`.
4. **Release checklist (by hand, from the spec):**
   - Install on a clean Windows user and go through the SmartScreen path.
   - Import old data in Welcome.
   - Rename the fixture batch and undo it.
   - Check with Animation effects off.
   - Use the app by keyboard only.

   The "update from the previous version" check happens with v0.1.1.

