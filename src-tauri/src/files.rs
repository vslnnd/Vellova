//! Commands the front end uses for its own data files and for reading old app data.

use crate::ops::{self, Op, OpResult, UndoReport};
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};

pub(crate) fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// `%APPDATA%\com.vslnnd.vellova`, created on first use.
pub(crate) fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

/// File names the front end may use inside the data folder: start with a letter or digit, then letters,
/// digits, `.`, `-`, `_`, and no `..`.
pub(crate) fn safe_name(name: &str) -> Result<&str, String> {
    let ok = name.starts_with(|c: char| c.is_ascii_alphanumeric())
        && !name.contains("..")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if ok { Ok(name) } else { Err(format!("invalid data file name: {name}")) }
}

/// Reads a data file as text. Missing gives `None`. Bad encoding is replaced, never an error: the JSON
/// then fails to parse and the front end sets the file aside instead of failing the whole load.
pub(crate) fn read_data(path: &Path) -> Result<Option<String>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

/// An export path from a save dialog: on a local drive (`C:\` or `\\?\C:\`; never UNC, device or other verbatim
/// paths, which could reach a network share), absolute, and a `.txt` or `.json` file (the only kinds the app writes).
pub(crate) fn export_path(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    let ext_ok = p
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("txt") || e.eq_ignore_ascii_case("json"));
    let drive = matches!(
        p.components().next(),
        Some(Component::Prefix(pre)) if matches!(pre.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
    );
    if drive && p.is_absolute() && ext_ok { Ok(p) } else { Err(format!("cannot save to {path}")) }
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
    read_data(&path)
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
    fs::write(export_path(&path)?, text).map_err(err)
}

static CANCEL: AtomicBool = AtomicBool::new(false);
static BUSY: AtomicBool = AtomicBool::new(false);

/// Only one apply, undo or recovery runs at a time. Released when dropped.
#[derive(Debug)]
struct Busy;
impl Busy {
    fn take() -> Result<Busy, String> {
        BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| Busy)
            .map_err(|_| "internal: Another batch is still running.".to_string())
    }
}
impl Drop for Busy {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
    }
}

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
                // a linked folder (junction, symlink) is not entered: it can loop back or lead elsewhere
                let link = e.file_type().is_ok_and(|t| t.is_symlink());
                walk(&e.path(), recursive && !link, false, out);
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
    let _busy = Busy::take()?;
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
    let _busy = Busy::take()?;
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

/// Repairs every run that was interrupted (crash or forced close): see `ops::recover`. Runs at each start, so a file
/// that could not be repaired is reported again until it is.
#[tauri::command]
pub async fn recover_all(app: AppHandle) -> Result<UndoReport, String> {
    let _busy = Busy::take()?;
    let mut rep = UndoReport::default();
    let Ok(rd) = fs::read_dir(data_dir(&app)?.join("journal")) else { return Ok(rep) };
    for p in rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "jsonl")) {
        match ops::recover(&p, &ops::RecycleBin) {
            Ok(r) => {
                rep.restored += r.restored;
                rep.skipped.extend(r.skipped);
            }
            Err(e) => rep.skipped.push(ops::Skipped { path: p.to_string_lossy().into_owned(), reason: e.to_string() }),
        }
    }
    Ok(rep)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busy_guard_allows_one_at_a_time_and_releases_on_drop() {
        let first = Busy::take().unwrap();
        assert!(Busy::take().unwrap_err().starts_with("internal:"));
        drop(first);
        assert!(Busy::take().is_ok());
    }

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
        for bad in ["", ".", "..", ".x.json", "../x.json", "a/b.json", "a\\b.json", "C:x.json"] {
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

    #[test]
    fn read_data_gives_none_for_missing_and_survives_bad_encoding() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        assert_eq!(read_data(&p).unwrap(), None);
        fs::write(&p, [b'{', 0xff, 0xfe, b'}']).unwrap();
        let text = read_data(&p).unwrap().unwrap();
        assert!(text.starts_with('{') && text.ends_with('}'));
        assert!(serde_json::from_str::<serde_json::Value>(&text).is_err());
    }

    #[test]
    fn export_path_must_be_absolute_txt_or_json() {
        for good in ["C:/out/log.txt", "C:/out/Log.TXT", "C:/out/profiles.json", "C:\\out\\log.txt", "\\\\?\\C:\\out\\log.txt"] {
            assert!(export_path(good).is_ok(), "{good}");
        }
        for bad in ["log.txt", "out/log.txt", "\\log.txt", "C:log.txt", "C:/out/app.exe", "C:/out/run.bat", "C:/out/noext", "C:/out/log.txt.exe", "C:/out/", ""] {
            assert!(export_path(bad).is_err(), "{bad}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn walk_does_not_follow_folder_links() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.pdf");
        fs::write(&a, "A").unwrap();
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(dir.path().join("loop"))
            .arg(dir.path())
            .output()
            .unwrap();
        assert!(made.status.success(), "{made:?}");
        let mut out = Vec::new();
        walk(dir.path(), true, true, &mut out);
        assert_eq!(out.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), [a.to_string_lossy()]);
    }

    #[test]
    fn export_path_rejects_network_and_device_paths() {
        for bad in [
            "\\\\server\\share\\x.txt",
            "//server/share/x.txt",
            "\\\\?\\UNC\\server\\share\\x.txt",
            "\\\\.\\C:\\x.txt",
            "\\\\.\\pipe\\x.txt",
            "\\\\?\\GLOBALROOT\\x.txt",
        ] {
            assert!(export_path(bad).is_err(), "{bad}");
        }
    }
}
