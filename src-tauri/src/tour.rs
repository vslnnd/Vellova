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
