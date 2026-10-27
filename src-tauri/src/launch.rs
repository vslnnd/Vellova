//! Files sent from Explorer's right-click menu: `Vellova.exe --rename|--split <path>...`.
//! The first launch arrives in this process's own args, later ones through the single-instance callback.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Launch {
    pub tool: String,
    pub paths: Vec<String>,
}

/// Queued launches the front end has not taken yet.
pub type Pending = Mutex<Vec<Launch>>;

/// `--rename` or `--split` followed by paths; whatever comes before the flag is ignored.
pub fn parse(args: &[String]) -> Option<Launch> {
    let i = args.iter().position(|a| a == "--rename" || a == "--split")?;
    let paths = args[i + 1..].to_vec();
    (!paths.is_empty()).then(|| Launch { tool: args[i][2..].to_string(), paths })
}

/// Queues the launch in `args` (if any) and tells the front end to take it.
pub fn push(app: &AppHandle, args: &[String]) {
    if let Some(l) = parse(args) {
        app.state::<Pending>().lock().unwrap().push(l.clone());
        let _ = app.emit("launch", l);
    }
}

#[tauri::command]
pub fn take_launches(pending: State<Pending>) -> Vec<Launch> {
    std::mem::take(&mut *pending.lock().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    fn launch(tool: &str, paths: &[&str]) -> Option<Launch> {
        Some(Launch { tool: tool.into(), paths: args(paths) })
    }

    #[test]
    fn rename_with_one_path() {
        assert_eq!(parse(&args(&["app", "--rename", "C:\\a.pdf"])), launch("rename", &["C:\\a.pdf"]));
    }

    #[test]
    fn no_flag_or_no_paths_is_nothing() {
        assert_eq!(parse(&args(&["app"])), None);
        assert_eq!(parse(&args(&["app", "--split"])), None);
        assert_eq!(parse(&args(&["app", "C:\\a.pdf"])), None);
    }

    #[test]
    fn split_keeps_every_path() {
        assert_eq!(parse(&args(&["app", "--split", "C:\\x.csv", "C:\\y.csv"])), launch("split", &["C:\\x.csv", "C:\\y.csv"]));
    }

    #[test]
    fn args_before_the_flag_are_ignored() {
        assert_eq!(parse(&args(&["app", "extra", "--split", "C:\\x.csv"])), launch("split", &["C:\\x.csv"]));
    }
}
