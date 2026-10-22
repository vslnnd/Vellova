# Vellova

Rename PDFs using a value found inside them, such as an invoice number, and rename their matching spreadsheets and text files with them. It also splits spreadsheets into several files.

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
- **Split:** cuts `.xlsx`, `.xls` and `.csv` files into several files. Choose a mode:
  - *By value:* one file per value of a column (a list of values you set, with an optional label for each), plus an optional NON_MATCHING file.
  - *Between people:* shares the rows out by weight, in blocks or by whole groups, as one file per person or as one file with an Assigned to column. A summary file or sheet can be added.
  - *By number of rows* or *Into equal parts:* fixed-size or evenly sized pieces.
  - *By sheet:* one file per sheet.
- **Header row:** the first row by default, or pick another row from a grid of the file's first 15 rows. Rows above a manual header are a title block and are copied on top of every output. Columns are matched by header name in each file, so one setup works across several files.
- **Formatting kept:** styles, merged cells, column widths, number formats and formulas carry over for `.xlsx` files. Output can be the same format as the input, always `.xlsx` or always `.csv`.
- **Names and folders:** file names come from a template with `{date}`, `{file}`, `{group}`, `{person}`, `{part}` and `{sheet}`. Outputs go next to each source file, in a chosen folder or in a subfolder, and name clashes are handled as in Rename.
- **Archive:** optionally move each fully split source file into an archive folder after the run. The folder must already exist.
- **Undo:** every split run appears in History and can be undone. Files it replaced come back from the Recycle Bin.
- **Profiles:** save a setup as a profile. Profiles, history and favourite folders can be imported from Splitify.

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
