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
