//! Commands the front end uses for its own data files and for reading old app data.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf, Prefix};
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
