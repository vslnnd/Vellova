//! Executes a Plan with a per-batch journal so every batch can be undone.
//! Renames go through temporary names (two phases), so swaps, cycles and case-only
//! renames work. Nothing is deleted: a replaced file goes to the Recycle Bin.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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
    /// `from` stepped aside to `tmp` on its way to `to` (phase 1).
    Temp { from: String, tmp: String, to: String },
    /// `tmp` reached its final name `to` (phase 2); `from` is the original path.
    Final { from: String, tmp: String, to: String, size: u64, mtime: u64 },
    /// A copy of `from` was written to `to`.
    Copy { from: String, to: String, size: u64, mtime: u64 },
    /// The file at `path` was sent to the Recycle Bin (Replace).
    Trash { path: String },
    /// `tmp` was put back at `to` after a failure or a crash.
    Restored { tmp: String, to: String },
    /// Everything journaled so far is settled: nothing is left half-way, by this run or an earlier one.
    /// Recovery reads only what comes after the last one. Undo reads it as usual.
    Done,
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
    /// Puts back the newest item deleted from `path` (before `before`, when given: an undo skips past the
    /// copy it just sent to the bin, to the file that copy had replaced).
    fn restore(&self, path: &Path, before: Option<SystemTime>) -> io::Result<()>;
    /// Whether a file at `path` would really go to a Recycle Bin, rather than be deleted for good.
    fn can_trash(&self, path: &Path) -> bool;
}

/// The Windows Recycle Bin.
pub struct RecycleBin;

impl Bin for RecycleBin {
    fn trash(&self, path: &Path) -> io::Result<()> {
        trash::delete(path).map_err(|e| io::Error::other(e.to_string()))
    }
    fn restore(&self, path: &Path, before: Option<SystemTime>) -> io::Result<()> {
        let want = key(path);
        // ponytail: the trash crate gives whole seconds, so a copy-replace undone in the same second it ran
        // leaves the replaced file in the bin (reported); finer needs the shell's own deletion date.
        let before = before.map_or(i64::MAX, |t| t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64));
        let newest = trash::os_limited::list()
            .map_err(|e| io::Error::other(e.to_string()))?
            .into_iter()
            .filter(|it| it.time_deleted < before && key(it.original_path()) == want)
            .max_by_key(|it| it.time_deleted);
        match newest {
            Some(item) => trash::os_limited::restore_all([item]).map_err(|e| io::Error::other(e.to_string())),
            None => Err(io::Error::new(io::ErrorKind::NotFound, "not found in the Recycle Bin")),
        }
    }
    fn can_trash(&self, path: &Path) -> bool {
        // ponytail: trusts local fixed drives only. A volume mounted in a folder, a bin switched off or a file
        // too big for it are not detected; Windows then asks before it deletes for good.
        drive_type(path) == DRIVE_FIXED
    }
}

const DRIVE_FIXED: u32 = 3;

/// `GetDriveTypeW` for the drive `path` is on; a relative path gives DRIVE_NO_ROOT_DIR.
fn drive_type(path: &Path) -> u32 {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDriveTypeW(root: *const u16) -> u32;
    }
    // `C:\` or `\\server\share\`: the prefix and the root, with the trailing backslash the call needs
    let root: PathBuf = path.components().take(2).collect();
    let wide: Vec<u16> = root.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: `wide` is a NUL-terminated UTF-16 string that outlives the call.
    unsafe { GetDriveTypeW(wide.as_ptr()) }
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

/// Nothing is left at the temporary name `tmp`, seen for sure: its folder is there and the file is not.
/// A volume that went away (share dropped, USB unplugged) hides both, which proves nothing.
fn cleared(tmp: &Path) -> bool {
    !exists(tmp) && tmp.parent().is_some_and(exists)
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
    /// Appends one entry. The newline goes first, so a line cut short (full disk) can't swallow the next one.
    // ponytail: no fsync per line; survives an app crash, not a power cut.
    fn add(&mut self, e: &Entry) -> io::Result<()> {
        let line = format!("\n{}", serde_json::to_string(e).map_err(io::Error::other)?);
        self.0
            .write_all(line.as_bytes())
            .map_err(|e| io::Error::other(format!("the undo journal could not be written ({e})")))
    }
}

pub fn read_journal(path: &Path) -> io::Result<Vec<Entry>> {
    Ok(fs::read_to_string(path)?.lines().filter_map(|l| serde_json::from_str(l).ok()).collect())
}

/// Makes room at `to`. Free, or taken by a file this batch moves away: fine. With `replace`, an existing
/// file goes to the Recycle Bin (journaled first) and the answer is `true`. Otherwise: "exists". Never
/// trashes a folder, the source itself, or a file on a drive where it would be deleted for good.
fn clear_target(j: &mut Journal, bin: &dyn Bin, op: &Op, to: &Path, leaving: &HashSet<String>) -> io::Result<bool> {
    if !exists(to) || leaving.contains(&key(to)) {
        return Ok(false);
    }
    if !op.replace || key(to) == key(&op.from) || fs::metadata(to)?.is_dir() {
        return Err(exists_err(to));
    }
    if !bin.can_trash(to) {
        let why = format!("{} already exists, and its drive has no Recycle Bin to put it in", to.display());
        return Err(io::Error::new(io::ErrorKind::AlreadyExists, why));
    }
    j.add(&Entry::Trash { path: op.to.clone() })?;
    bin.trash(to)?;
    Ok(true)
}

/// Renames `tmp` to `to` only while nothing is there: `fs::rename` would replace a file on Windows.
fn move_free(tmp: &Path, to: &str) -> bool {
    !exists(Path::new(to)) && fs::rename(tmp, to).is_ok()
}

/// The failure of an op whose file stepped aside: the file goes back to its old name, or, if something
/// took that name meanwhile, keeps its temporary name and the message says where it is.
fn step_back(j: &mut Journal, i: usize, e: &io::Error, tmp: &Path, from: &str) -> OpResult {
    if move_free(tmp, from) {
        let _ = j.add(&Entry::Restored { tmp: s(tmp), to: from.to_string() }); // if unwritten: recovery finds no temp file
        return fail(i, e);
    }
    OpResult { message: Some(format!("{e}; the file was left at {}", tmp.display())), ..fail(i, e) }
}

/// A failed op that had sent its target to the Recycle Bin brings it back; if it can't, the message says so.
fn unbin(bin: &dyn Bin, mut r: OpResult, path: &str) -> OpResult {
    if let Err(err) = bin.restore(Path::new(path), None) {
        r.message = Some(format!("{}; {path} is in the Recycle Bin ({err})", r.message.unwrap_or_default()));
    }
    r
}

/// The result of an op that happened. Without its journal line Undo can't reverse it, so it counts as failed.
fn done(i: usize, journaled: io::Result<()>) -> OpResult {
    match journaled {
        Ok(()) => ok(i),
        Err(e) => OpResult { i, ok: false, code: Some("internal"), message: Some(format!("done, but it can't be undone: {e}")) },
    }
}

/// Copies `op.from` to `tmp` next to the target, makes room at the target, then moves the finished copy in.
/// `trashed` tells whether the target went to the Recycle Bin on the way.
fn copy_in(j: &mut Journal, bin: &dyn Bin, op: &Op, tmp: &Path, trashed: &mut bool) -> io::Result<()> {
    let to = Path::new(&op.to);
    ensure_parent(to)?;
    fs::copy(&op.from, tmp)?;
    *trashed = clear_target(j, bin, op, to, &HashSet::new())?;
    if exists(to) {
        return Err(exists_err(to));
    }
    fs::rename(tmp, to)
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

    // Phase 1: every rename source steps aside to a temporary name next to it, journaled first (no line, no
    // move). Its target is cleared only then, so a source that can't move never costs the file it would replace.
    let mut staged: Vec<(usize, PathBuf, bool)> = Vec::new();
    // false once a file may be left under a temporary name, or a binned target could not come back; and from
    // the start when an earlier run in this journal left work for recovery, which a Done would hide
    let mut clean = read_journal(ctx.journal).is_ok_and(|e| e.last().is_none_or(|l| matches!(l, Entry::Done)));
    for (i, op) in ops.iter().enumerate().filter(|(_, o)| o.kind == Kind::Rename) {
        if stop() {
            report(&mut out, cancelled(i));
            continue;
        }
        let tmp = Path::new(&op.from).with_file_name(format!(".~vellova-{tag}-{stamp}-{i}.tmp"));
        // A failure here moved nothing (no line, or the rename did not happen): settled, whatever `tmp` looks
        // like now. Its folder may even be gone (a stale plan), which `cleared` can't tell from a lost volume.
        if let Err(e) = j.add(&Entry::Temp { from: op.from.clone(), tmp: s(&tmp), to: op.to.clone() }) {
            report(&mut out, fail(i, &e));
            continue;
        }
        if let Err(e) = fs::rename(&op.from, &tmp) {
            let _ = j.add(&Entry::Restored { tmp: s(&tmp), to: op.from.clone() }); // so recovery skips it too
            report(&mut out, fail(i, &e));
            continue;
        }
        match clear_target(&mut j, ctx.bin, op, Path::new(&op.to), &leaving) {
            Ok(trashed) => staged.push((i, tmp, trashed)),
            Err(e) => {
                report(&mut out, step_back(&mut j, i, &e, &tmp, &op.from));
                clean &= cleared(&tmp);
            }
        }
    }

    // A target still taken now (its file could not step aside) sends its op back to the old name, which
    // keeps that name taken in turn, down the whole chain. So no op ever lands on a name another op needs.
    let mut taken: HashSet<String> = HashSet::new();
    loop {
        let before = taken.len();
        for (i, _, _) in &staged {
            let op = &ops[*i];
            if exists(Path::new(&op.to)) || taken.contains(&key(&op.to)) {
                taken.insert(key(&op.from));
            }
        }
        if taken.len() == before {
            break;
        }
    }

    // Phase 2: temporary names become final names (always finished, even after Cancel). An op that fails
    // here goes back, and brings back the file it had sent to the Recycle Bin.
    for (i, tmp, trashed) in staged {
        let op = &ops[i];
        let to = Path::new(&op.to);
        let moved = if exists(to) || taken.contains(&key(to)) {
            Err(exists_err(to))
        } else {
            ensure_parent(to).and_then(|_| move_file(&tmp, to))
        };
        match moved {
            Ok(()) => {
                let (size, mtime) = stat(to).unwrap_or((0, 0));
                let line = j.add(&Entry::Final { from: op.from.clone(), tmp: s(&tmp), to: op.to.clone(), size, mtime });
                report(&mut out, done(i, line));
            }
            Err(e) => {
                let r = step_back(&mut j, i, &e, &tmp, &op.from);
                report(&mut out, if trashed { unbin(ctx.bin, r, &op.to) } else { r });
                clean &= cleared(&tmp) && (!trashed || exists(to));
            }
        }
    }

    // Copies, in order. Each is written under a temporary name next to its target first, so the file it
    // replaces goes to the Recycle Bin only once the copy is complete.
    // ponytail: a crash inside one copy can leave its temporary copy behind (not journaled, hidden from the
    // app) and, for a microsecond window, its replaced file in the bin with no copy in its place.
    for (i, op) in ops.iter().enumerate().filter(|(_, o)| o.kind == Kind::Copy) {
        if stop() {
            report(&mut out, cancelled(i));
            continue;
        }
        let tmp = Path::new(&op.to).with_file_name(format!(".~vellova-{tag}-{stamp}-{i}.tmp"));
        let mut trashed = false;
        match copy_in(&mut j, ctx.bin, op, &tmp, &mut trashed) {
            Ok(()) => {
                let (size, mtime) = stat(Path::new(&op.to)).unwrap_or((0, 0));
                let line = j.add(&Entry::Copy { from: op.from.clone(), to: op.to.clone(), size, mtime });
                report(&mut out, done(i, line));
            }
            Err(e) => {
                let _ = fs::remove_file(&tmp); // the unfinished copy is ours
                let r = fail(i, &e);
                report(&mut out, if trashed { unbin(ctx.bin, r, &op.to) } else { r });
                clean &= !trashed || exists(Path::new(&op.to));
            }
        }
    }

    // Every op ran and nothing was left half-way, so recovery can skip this journal from now on.
    if clean {
        let _ = j.add(&Entry::Done);
    }
    out.sort_by_key(|r| r.i);
    Ok(out)
}

/// Journals a file that reached its new name, with what Undo checks later.
fn arrived(j: &mut Journal, from: &str, tmp: &str, to: &str) -> io::Result<()> {
    let (size, mtime) = stat(Path::new(to)).unwrap_or((0, 0));
    j.add(&Entry::Final { from: from.into(), tmp: tmp.into(), to: to.into(), size, mtime })
}

/// Repairs a run that was interrupted (crash or forced close). Files left under a temporary name get a real name
/// again, and a file sent to the Recycle Bin for a replace that never happened comes back. What can't be
/// repaired is reported with the path where the file is.
pub fn recover(journal: &Path, bin: &dyn Bin) -> io::Result<UndoReport> {
    let all = match read_journal(journal) {
        Ok(e) => e,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(UndoReport::default()),
        Err(e) => return Err(e),
    };
    // A Done means nothing before it was left half-way: only the runs after the last one need looking at.
    let entries = &all[all.iter().rposition(|e| matches!(e, Entry::Done)).map_or(0, |i| i + 1)..];
    if entries.is_empty() {
        return Ok(UndoReport::default());
    }
    let settled: HashSet<&str> = entries
        .iter()
        .filter_map(|e| match e {
            Entry::Final { tmp, .. } | Entry::Restored { tmp, .. } => Some(tmp.as_str()),
            _ => None,
        })
        .collect();
    let mut rep = UndoReport::default();
    let mut stranded = false;
    let mut left: Vec<(&String, &String, &String)> = Vec::new();
    for e in entries {
        if let Entry::Temp { from, tmp, to } = e {
            if settled.contains(tmp.as_str()) || cleared(Path::new(tmp)) {
                continue;
            }
            if exists(Path::new(tmp)) {
                left.push((from, tmp, to));
            } else {
                // its folder can't be seen (volume away): the journal stays open for the next start
                let reason = "left under a temporary name in a folder that can't be reached now".into();
                rep.skipped.push(Skipped { path: tmp.clone(), reason });
                stranded = true;
            }
        }
    }
    let mut j = Journal::open(journal)?;
    let unjournaled = |rep: &mut UndoReport, to: &str, e: io::Error| {
        rep.skipped.push(Skipped { path: to.into(), reason: format!("got its new name, but Undo can't reverse it: {e}") });
    };

    // A file whose old name another file of the batch already took was on its way (phase 2): it goes on to
    // its new name. That can free the way for another, so repeat. Then every other file goes back.
    loop {
        let before = left.len();
        left.retain(|&(from, tmp, to)| {
            let on = exists(Path::new(from)) && move_free(Path::new(tmp), to);
            if on {
                rep.restored += 1;
                if let Err(e) = arrived(&mut j, from, tmp, to) {
                    unjournaled(&mut rep, to, e);
                }
            }
            !on
        });
        if left.len() == before {
            break;
        }
    }
    // Targets of files that went back, in this run or an earlier one that may have stopped before restoring
    // what the replace had sent to the Recycle Bin (the restore below is retried until the name is taken).
    let aimed: HashMap<&str, &str> = entries
        .iter()
        .filter_map(|e| match e {
            Entry::Temp { tmp, to, .. } => Some((tmp.as_str(), to.as_str())),
            _ => None,
        })
        .collect();
    let mut back: HashSet<String> = entries
        .iter()
        .filter_map(|e| match e {
            Entry::Restored { tmp, .. } => aimed.get(tmp.as_str()).map(key),
            _ => None,
        })
        .collect();
    for (from, tmp, to) in left {
        if move_free(Path::new(tmp), from) {
            let _ = j.add(&Entry::Restored { tmp: tmp.clone(), to: from.clone() });
            back.insert(key(to));
        } else if move_free(Path::new(tmp), to) {
            if let Err(e) = arrived(&mut j, from, tmp, to) {
                unjournaled(&mut rep, to, e);
            }
        } else {
            let reason = format!("left under a temporary name: {from} and {to} are both taken");
            rep.skipped.push(Skipped { path: tmp.clone(), reason });
            stranded = true;
            continue;
        }
        rep.restored += 1;
    }

    // The replace of a file that went back never happened: what it had sent to the Recycle Bin comes back.
    // An item no longer in the bin is reported this once; any other failure is retried on the next run.
    let mut pending = false;
    for e in entries {
        if let Entry::Trash { path } = e {
            if back.contains(&key(path)) && !exists(Path::new(path)) {
                if let Err(err) = bin.restore(Path::new(path), None) {
                    pending |= err.kind() != io::ErrorKind::NotFound;
                    rep.skipped.push(Skipped { path: path.clone(), reason: format!("restore it from the Recycle Bin ({err})") });
                }
            }
        }
    }
    if !stranded && !pending {
        let _ = j.add(&Entry::Done);
    }
    Ok(rep)
}

/// Undoes a batch: copies go to the Recycle Bin, renames are reversed, replaced files come back.
/// Files that changed since the batch are left alone and reported. Safe to run again.
pub fn undo(ctx: &Ctx, undo_journal: &Path) -> io::Result<UndoReport> {
    let started = SystemTime::now();
    let mut rep = UndoReport::default();
    for journal in [ctx.journal, undo_journal] {
        rep.skipped.extend(recover(journal, ctx.bin)?.skipped);
    }
    let entries = match read_journal(ctx.journal) {
        Ok(e) => e,
        // no journal: the batch never got to its first op, so there is nothing to undo
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(rep),
        Err(e) => return Err(e),
    };
    let same =|p: &str, size: u64, mtime: u64| stat(Path::new(p)).is_ok_and(|st| st == (size, mtime));
    let mut binned: HashSet<String> = HashSet::new();

    for e in entries.iter().rev() {
        if let Entry::Copy { to, size, mtime, .. } = e {
            if !exists(Path::new(to)) {
                continue; // already gone
            }
            if !same(to, *size, *mtime) {
                rep.skipped.push(Skipped { path: to.clone(), reason: "changed since it was copied".into() });
                continue;
            }
            // On a drive without a Recycle Bin the copy is deleted: it is the unchanged file Vellova made
            // (checked just above), so no work of the user's goes with it.
            let p = Path::new(to);
            let gone = if ctx.bin.can_trash(p) {
                binned.insert(key(to));
                ctx.bin.trash(p)
            } else {
                fs::remove_file(p)
            };
            match gone {
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
            let before = binned.contains(&key(path)).then_some(started);
            if let Err(err) = ctx.bin.restore(Path::new(path), before) {
                rep.skipped.push(Skipped { path: path.clone(), reason: format!("restore it from the Recycle Bin ({err})") });
            }
        }
    }
    Ok(rep)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    /// Test double for the Recycle Bin: moves files into `_bin` and back. `missing` plays a drive without one.
    struct FakeBin {
        dir: PathBuf,
        items: RefCell<Vec<(PathBuf, PathBuf, SystemTime)>>,
        missing: Cell<bool>,
    }
    impl Bin for FakeBin {
        fn can_trash(&self, _: &Path) -> bool {
            !self.missing.get()
        }
        fn trash(&self, p: &Path) -> io::Result<()> {
            let mut items = self.items.borrow_mut();
            let dest = self.dir.join(items.len().to_string());
            fs::rename(p, &dest)?;
            items.push((p.to_path_buf(), dest, SystemTime::now()));
            Ok(())
        }
        fn restore(&self, p: &Path, before: Option<SystemTime>) -> io::Result<()> {
            let mut items = self.items.borrow_mut();
            let i = items
                .iter()
                .rposition(|(orig, _, t)| before.is_none_or(|b| *t < b) && key(orig) == key(p))
                .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))?;
            let (orig, dest, _) = items.remove(i);
            fs::rename(dest, orig)
        }
    }

    /// A Recycle Bin that runs `hook` before each file goes in, to stage what other programs might do then.
    struct HookBin<'a, F: Fn(&Path)>(&'a FakeBin, F);
    impl<F: Fn(&Path)> Bin for HookBin<'_, F> {
        fn trash(&self, p: &Path) -> io::Result<()> {
            (self.1)(p);
            self.0.trash(p)
        }
        fn restore(&self, p: &Path, before: Option<SystemTime>) -> io::Result<()> {
            self.0.restore(p, before)
        }
        fn can_trash(&self, p: &Path) -> bool {
            self.0.can_trash(p)
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
            Self { bin: FakeBin { dir, items: RefCell::new(vec![]), missing: Cell::new(false) }, root, _dir: d }
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
            self.apply_with(&self.bin, ops)
        }
        fn apply_with(&self, bin: &dyn Bin, ops: &[Op]) -> Vec<OpResult> {
            let (j, cancel, noop) = (self.journal(), AtomicBool::new(false), |_: usize, _: usize| {});
            apply(&Ctx { journal: &j, bin, progress: &noop, cancel: &cancel }, "b1", ops).unwrap()
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
    fn undo_of_a_batch_that_never_started_is_empty() {
        // the app stopped after History recorded the batch but before its journal existed
        let r = T::new().undo();
        assert_eq!((r.restored, r.skipped.len()), (0, 0));
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
        Journal::open(&t.journal()).unwrap().add(&Entry::Temp { from: a.clone(), tmp, to: t.p("x.pdf") }).unwrap();
        assert_eq!(recover(&t.journal(), &t.bin).unwrap().restored, 1);
        assert_eq!(t.names(), ["a.pdf"]);
        assert_eq!(recover(&t.journal(), &t.bin).unwrap().restored, 0);
    }

    #[test]
    fn recover_finishes_a_swap_stopped_half_way() {
        let t = T::new();
        let (a, b) = (t.write("a.pdf", "A"), t.write("b.pdf", "B"));
        let (ta, tb) = (t.p(".~vellova-b1-1-0.tmp"), t.p(".~vellova-b1-1-1.tmp"));
        fs::rename(&a, &ta).unwrap();
        fs::rename(&b, &tb).unwrap();
        fs::rename(&ta, &b).unwrap(); // killed after the first file reached its new name
        {
            let mut j = Journal::open(&t.journal()).unwrap();
            j.add(&Entry::Temp { from: a.clone(), tmp: ta.clone(), to: b.clone() }).unwrap();
            j.add(&Entry::Temp { from: b.clone(), tmp: tb, to: a.clone() }).unwrap();
            j.add(&Entry::Final { from: a, tmp: ta, to: b, size: 1, mtime: 0 }).unwrap();
        }
        assert_eq!(recover(&t.journal(), &t.bin).unwrap().restored, 1);
        assert_eq!(t.names(), ["a.pdf", "b.pdf"]);
        assert_eq!((t.read("a.pdf"), t.read("b.pdf")), ("B".into(), "A".into()));
    }

    #[cfg(windows)]
    #[test]
    fn a_chain_behind_a_locked_file_never_overwrites_anything() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = T::new();
        let (a, b, c) = (t.write("a.pdf", "A"), t.write("b.pdf", "B"), t.write("c.pdf", "C"));
        let lock = OpenOptions::new().read(true).share_mode(0).open(&b).unwrap();
        let r = t.apply(&[rn(&c, &a), rn(&a, &b), rn(&b, &t.p("d.pdf"))]);
        drop(lock);
        assert_eq!(t.names(), ["a.pdf", "b.pdf", "c.pdf"]);
        assert_eq!((t.read("a.pdf"), t.read("b.pdf"), t.read("c.pdf")), ("A".into(), "B".into(), "C".into()));
        assert_eq!((r[0].code, r[1].code, r[2].code), (Some("exists"), Some("exists"), Some("locked")));
    }

    #[cfg(windows)]
    #[test]
    fn a_locked_source_keeps_the_file_it_would_replace() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = T::new();
        let (a, x) = (t.write("a.pdf", "A"), t.write("x.pdf", "OLD"));
        let lock = OpenOptions::new().read(true).share_mode(0).open(&a).unwrap();
        let mut op = rn(&a, &x);
        op.replace = true;
        let r = t.apply(&[op]);
        drop(lock);
        assert_eq!(r[0].code, Some("locked"));
        assert_eq!((t.read("a.pdf"), t.read("x.pdf")), ("A".into(), "OLD".into()));
    }

    #[test]
    fn undo_of_a_replacing_copy_brings_back_the_replaced_file() {
        let t = T::new();
        let (a, x) = (t.write("a.pdf", "A"), t.write("x.pdf", "OLD"));
        let mut op = cp(&a, &x);
        op.replace = true;
        assert!(t.apply(&[op])[0].ok);
        assert_eq!(t.read("x.pdf"), "A");
        let rep = t.undo();
        assert_eq!((rep.restored, rep.skipped), (1, vec![]));
        assert_eq!((t.read("a.pdf"), t.read("x.pdf")), ("A".into(), "OLD".into()));
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

    #[test]
    fn copy_replace_with_a_missing_source_keeps_the_target() {
        let t = T::new();
        let x = t.write("x.pdf", "OLD");
        let mut op = cp(&t.p("gone.pdf"), &x);
        op.replace = true;
        assert_eq!(t.apply(&[op])[0].code, Some("missing"));
        assert_eq!(t.names(), ["x.pdf"]);
        assert_eq!(t.read("x.pdf"), "OLD");
    }

    #[cfg(windows)]
    #[test]
    fn a_move_that_fails_after_replacing_brings_the_replaced_file_back() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = T::new();
        let (a, x) = (t.write("a.pdf", "A"), t.write("x.pdf", "OLD"));
        // While the source waits under its temporary name, another program opens it (a virus scanner, say).
        let held = RefCell::new(None);
        let bin = HookBin(&t.bin, |_: &Path| {
            let tmp = fs::read_dir(&t.root).unwrap().flatten().map(|e| e.path()).find(|p| s(p).contains(".~vellova-"));
            *held.borrow_mut() = Some(OpenOptions::new().read(true).share_mode(0).open(tmp.unwrap()).unwrap());
        });
        let mut op = rn(&a, &x);
        op.replace = true;
        let r = t.apply_with(&bin, &[op]);
        assert_eq!(r[0].code, Some("locked"));
        assert_eq!(t.read("x.pdf"), "OLD");
        drop(held.take());
        assert_eq!(recover(&t.journal(), &t.bin).unwrap().restored, 1);
        assert_eq!(t.names(), ["a.pdf", "x.pdf"]);
    }

    #[test]
    fn recover_brings_back_the_file_a_stopped_replace_had_binned() {
        let t = T::new();
        let (a, x) = (t.write("a.pdf", "A"), t.write("x.pdf", "OLD"));
        let tmp = t.p(".~vellova-b1-1-0.tmp");
        {
            let mut j = Journal::open(&t.journal()).unwrap();
            j.add(&Entry::Temp { from: a.clone(), tmp: tmp.clone(), to: x.clone() }).unwrap();
            j.add(&Entry::Trash { path: x.clone() }).unwrap();
        }
        fs::rename(&a, &tmp).unwrap();
        t.bin.trash(Path::new(&x)).unwrap(); // killed here, before phase 2
        let rep = recover(&t.journal(), &t.bin).unwrap();
        assert_eq!((rep.restored, rep.skipped), (1, vec![]));
        assert_eq!((t.read("a.pdf"), t.read("x.pdf")), ("A".into(), "OLD".into()));
    }

    #[test]
    fn recover_finishes_a_chain_whatever_order_the_journal_lists_it() {
        // ops [z→x, y→w, x→y], killed right after z reached x
        let t = T::new();
        let (z, x, y, w) = (t.write("z.pdf", "Z"), t.write("x.pdf", "X"), t.write("y.pdf", "Y"), t.p("w.pdf"));
        let tmps: Vec<String> = (0..3).map(|i| t.p(&format!(".~vellova-b1-1-{i}.tmp"))).collect();
        {
            let mut j = Journal::open(&t.journal()).unwrap();
            for ((from, to), tmp) in [(&z, &x), (&y, &w), (&x, &y)].into_iter().zip(&tmps) {
                j.add(&Entry::Temp { from: from.clone(), tmp: tmp.clone(), to: to.clone() }).unwrap();
                fs::rename(from, tmp).unwrap();
            }
            fs::rename(&tmps[0], &x).unwrap();
            j.add(&Entry::Final { from: z, tmp: tmps[0].clone(), to: x, size: 1, mtime: 0 }).unwrap();
        }
        let rep = recover(&t.journal(), &t.bin).unwrap();
        assert_eq!((rep.restored, rep.skipped), (2, vec![]));
        assert_eq!(t.names(), ["w.pdf", "x.pdf", "y.pdf"]);
        assert_eq!((t.read("w.pdf"), t.read("x.pdf"), t.read("y.pdf")), ("Y".into(), "Z".into(), "X".into()));
    }

    #[test]
    fn nothing_moves_while_the_journal_cannot_be_written() {
        let t = T::new();
        let a = t.write("a.pdf", "A");
        Journal::open(&t.journal()).unwrap();
        let lock = fs::File::open(t.journal()).unwrap();
        lock.lock().unwrap();
        let r = t.apply(&[rn(&a, &t.p("x.pdf"))]);
        drop(lock);
        assert_eq!((r[0].ok, r[0].code), (false, Some("internal")));
        assert_eq!(t.names(), ["a.pdf"]);
    }

    #[test]
    fn a_rename_the_journal_missed_is_reported_as_not_undoable() {
        let t = T::new();
        let (a, x) = (t.write("a.pdf", "A"), t.write("x.pdf", "OLD"));
        // The journal stops taking lines (full disk) after phase 1: the rename happens, its line does not.
        let held = RefCell::new(None);
        let bin = HookBin(&t.bin, |_: &Path| {
            let f = fs::File::open(t.journal()).unwrap();
            f.lock().unwrap();
            *held.borrow_mut() = Some(f);
        });
        let mut op = rn(&a, &x);
        op.replace = true;
        let r = t.apply_with(&bin, &[op]);
        drop(held.take());
        assert_eq!((r[0].ok, r[0].code), (false, Some("internal")));
        assert!(r[0].message.as_deref().unwrap_or("").contains("can't be undone"), "{r:?}");
        assert_eq!(t.read("x.pdf"), "A");
    }

    #[test]
    fn replace_on_a_drive_without_a_recycle_bin_leaves_both_files() {
        let t = T::new();
        t.bin.missing.set(true);
        let (a, b, x, y) = (t.write("a.pdf", "A"), t.write("b.pdf", "B"), t.write("x.pdf", "X"), t.write("y.pdf", "Y"));
        let mut ro = fs::metadata(&b).unwrap().permissions();
        ro.set_readonly(true); // its temporary copy comes out read-only too, and must still be cleaned up
        fs::set_permissions(&b, ro).unwrap();
        let (mut op1, mut op2) = (rn(&a, &x), cp(&b, &y));
        op1.replace = true;
        op2.replace = true;
        let r = t.apply(&[op1, op2]);
        assert_eq!((r[0].code, r[1].code), (Some("exists"), Some("exists")));
        assert_eq!(t.names(), ["a.pdf", "b.pdf", "x.pdf", "y.pdf"]);
        assert_eq!((t.read("x.pdf"), t.read("y.pdf")), ("X".into(), "Y".into()));
    }

    #[test]
    fn undo_on_a_drive_without_a_recycle_bin_deletes_only_unchanged_copies() {
        let t = T::new();
        let a = t.write("a.pdf", "A");
        let r = t.apply(&[cp(&a, &t.p("x.pdf")), cp(&a, &t.p("y.pdf"))]);
        assert!(r.iter().all(|r| r.ok), "{r:?}");
        fs::write(t.root.join("y.pdf"), "edited by the user").unwrap();
        t.bin.missing.set(true);
        let rep = t.undo();
        assert_eq!((rep.restored, rep.skipped.len()), (1, 1));
        assert_eq!(t.names(), ["a.pdf", "y.pdf"]);
        assert!(t.bin.items.borrow().is_empty());
    }

    #[test]
    fn recover_retries_bringing_back_a_replaced_file_after_a_crash() {
        let t = T::new();
        let (a, x) = (t.write("a.pdf", "A"), t.write("x.pdf", "OLD"));
        t.bin.trash(Path::new(&x)).unwrap();
        {
            let mut j = Journal::open(&t.journal()).unwrap();
            let tmp = t.p(".~vellova-b1-1-0.tmp");
            j.add(&Entry::Temp { from: a.clone(), tmp: tmp.clone(), to: x.clone() }).unwrap();
            j.add(&Entry::Trash { path: x }).unwrap();
            j.add(&Entry::Restored { tmp, to: a }).unwrap(); // killed after a went back, before x came back
        }
        let rep = recover(&t.journal(), &t.bin).unwrap();
        assert_eq!(rep.skipped, vec![]);
        assert_eq!((t.read("a.pdf"), t.read("x.pdf")), ("A".into(), "OLD".into()));
    }

    #[test]
    fn a_finished_run_ends_its_journal_with_done() {
        let t = T::new();
        let a = t.write("a.pdf", "A");
        let done = |p: &Path| matches!(read_journal(p).unwrap().last(), Some(Entry::Done));
        assert!(t.apply(&[rn(&a, &t.p("x.pdf"))])[0].ok);
        assert!(done(&t.journal()));
        assert_eq!(t.undo().restored, 1);
        assert!(done(&t.root.join("_journal").join("b1.undo.jsonl")));
    }

    #[test]
    fn recovery_leaves_a_finished_journal_alone() {
        // A replace failed and was put right, then the batch finished. The user has since deleted x, so it is
        // in the bin: recovery must not bring it back.
        let t = T::new();
        let (a, x) = (t.write("a.pdf", "A"), t.write("x.pdf", "OLD"));
        t.bin.trash(Path::new(&x)).unwrap();
        {
            let mut j = Journal::open(&t.journal()).unwrap();
            let tmp = t.p(".~vellova-b1-1-0.tmp");
            j.add(&Entry::Temp { from: a.clone(), tmp: tmp.clone(), to: x.clone() }).unwrap();
            j.add(&Entry::Trash { path: x }).unwrap();
            j.add(&Entry::Restored { tmp, to: a }).unwrap();
            j.add(&Entry::Done).unwrap();
        }
        let rep = recover(&t.journal(), &t.bin).unwrap();
        assert_eq!((rep.restored, rep.skipped), (0, vec![]));
        assert_eq!(t.names(), ["a.pdf"]);
    }

    #[test]
    fn recovery_reports_a_binned_file_that_is_gone_once() {
        let t = T::new();
        let (a, x) = (t.write("a.pdf", "A"), t.p("x.pdf")); // x went to the bin, and the bin was emptied since
        let tmp = t.p(".~vellova-b1-1-0.tmp");
        fs::rename(&a, &tmp).unwrap();
        {
            let mut j = Journal::open(&t.journal()).unwrap();
            j.add(&Entry::Temp { from: a, tmp, to: x.clone() }).unwrap();
            j.add(&Entry::Trash { path: x }).unwrap();
        }
        let rep = recover(&t.journal(), &t.bin).unwrap();
        assert_eq!((rep.restored, rep.skipped.len()), (1, 1));
        assert!(matches!(read_journal(&t.journal()).unwrap().last(), Some(Entry::Done)));
        let again = recover(&t.journal(), &t.bin).unwrap();
        assert_eq!((again.restored, again.skipped), (0, vec![]));
    }

    #[test]
    fn a_clean_run_does_not_hide_a_file_an_earlier_run_left_stranded() {
        // Run 1 left a under a temporary name (a and x both taken since); then "Apply fixes" runs cleanly.
        let t = T::new();
        let (a, x, b) = (t.write("a.pdf", "NEW A"), t.write("x.pdf", "X"), t.write("b.pdf", "B"));
        let tmp = t.write(".~vellova-b1-1-0.tmp", "A");
        Journal::open(&t.journal()).unwrap().add(&Entry::Temp { from: a, tmp: tmp.clone(), to: x }).unwrap();
        assert!(t.apply(&[rn(&b, &t.p("y.pdf"))])[0].ok);
        let rep = recover(&t.journal(), &t.bin).unwrap();
        assert_eq!(rep.skipped.iter().map(|s| s.path.clone()).collect::<Vec<_>>(), [tmp]);
    }

    #[test]
    fn a_step_back_lost_with_its_volume_keeps_the_journal_open() {
        // The folder vanishes (share dropped, USB unplugged) while the target goes to the bin.
        let t = T::new();
        let (sub, gone) = (t.root.join("sub"), t.root.join("sub-away"));
        fs::create_dir(&sub).unwrap();
        let (a, x) = (t.write("sub/a.pdf", "A"), t.write("sub/x.pdf", "OLD"));
        let bin = HookBin(&t.bin, |_: &Path| fs::rename(&sub, &gone).unwrap());
        let mut op = rn(&a, &x);
        op.replace = true;
        assert!(!t.apply_with(&bin, &[op])[0].ok);
        fs::rename(&gone, &sub).unwrap(); // the volume is back
        assert_eq!(recover(&t.journal(), &t.bin).unwrap().restored, 1);
        assert_eq!((t.read("sub/a.pdf"), t.read("sub/x.pdf")), ("A".into(), "OLD".into()));
    }

    #[test]
    fn recovery_keeps_a_file_it_cannot_see_for_later() {
        let t = T::new();
        let (sub, gone) = (t.root.join("sub"), t.root.join("sub-away"));
        fs::create_dir(&sub).unwrap();
        let a = t.p("sub/a.pdf");
        let tmp = t.write("sub/.~vellova-b1-1-0.tmp", "A");
        Journal::open(&t.journal()).unwrap().add(&Entry::Temp { from: a, tmp, to: t.p("sub/x.pdf") }).unwrap();
        fs::rename(&sub, &gone).unwrap(); // the volume is away at startup
        let rep = recover(&t.journal(), &t.bin).unwrap();
        assert_eq!((rep.restored, rep.skipped.len()), (0, 1));
        fs::rename(&gone, &sub).unwrap();
        assert_eq!(recover(&t.journal(), &t.bin).unwrap().restored, 1);
        assert_eq!(t.read("sub/a.pdf"), "A");
    }

    #[test]
    fn recovery_ignores_what_a_finished_run_put_right() {
        // Run 1 put x back after a failed replace and finished. The user deleted x since. A later run crashed.
        let t = T::new();
        let (a, x, b) = (t.write("a.pdf", "A"), t.write("x.pdf", "OLD"), t.p("b.pdf"));
        t.bin.trash(Path::new(&x)).unwrap();
        let (t0, t1) = (t.p(".~vellova-b1-1-0.tmp"), t.write(".~vellova-b1-2-0.tmp", "B"));
        {
            let mut j = Journal::open(&t.journal()).unwrap();
            j.add(&Entry::Temp { from: a.clone(), tmp: t0.clone(), to: x.clone() }).unwrap();
            j.add(&Entry::Trash { path: x }).unwrap();
            j.add(&Entry::Restored { tmp: t0, to: a }).unwrap();
            j.add(&Entry::Done).unwrap();
            j.add(&Entry::Temp { from: b, tmp: t1, to: t.p("y.pdf") }).unwrap();
        }
        assert_eq!(recover(&t.journal(), &t.bin).unwrap().restored, 1);
        assert_eq!(t.names(), ["a.pdf", "b.pdf"]);
    }

    #[test]
    fn a_source_whose_folder_is_gone_closes_its_journal() {
        // A stale plan: the source's folder was deleted after the plan was made.
        let t = T::new();
        let sub = t.root.join("sub");
        fs::create_dir(&sub).unwrap();
        let a = t.write("sub/a.pdf", "A");
        fs::remove_dir_all(&sub).unwrap();
        let r = t.apply(&[rn(&a, &t.p("sub/x.pdf"))]);
        assert_eq!(r[0].code, Some("missing"));
        assert!(matches!(read_journal(&t.journal()).unwrap().last(), Some(Entry::Done)));
        let rep = recover(&t.journal(), &t.bin).unwrap();
        assert_eq!((rep.restored, rep.skipped), (0, vec![]));
    }

    #[test]
    fn a_source_whose_folder_is_gone_is_settled_beside_unsettled_work() {
        // Same, in a journal an earlier run left open: recovery must not report the never-moved file.
        let t = T::new();
        let sub = t.root.join("sub");
        fs::create_dir(&sub).unwrap();
        let (a, b) = (t.write("sub/a.pdf", "A"), t.p("b.pdf"));
        let tmp = t.write(".~vellova-b1-1-0.tmp", "B");
        Journal::open(&t.journal()).unwrap().add(&Entry::Temp { from: b, tmp: tmp.clone(), to: t.p("y.pdf") }).unwrap();
        fs::remove_dir_all(&sub).unwrap();
        assert!(!t.apply(&[rn(&a, &t.p("sub/x.pdf"))])[0].ok);
        let rep = recover(&t.journal(), &t.bin).unwrap();
        assert_eq!((rep.restored, rep.skipped), (1, vec![]));
        assert!(matches!(read_journal(&t.journal()).unwrap().last(), Some(Entry::Done)));
    }

    #[cfg(windows)]
    #[test]
    fn the_recycle_bin_is_trusted_on_local_fixed_drives_only() {
        let d = tempfile::tempdir().unwrap();
        assert!(RecycleBin.can_trash(&d.path().join("x.pdf")));
        assert!(RecycleBin.can_trash(Path::new(&format!(r"\\?\{}", d.path().join("x.pdf").display()))));
        assert!(!RecycleBin.can_trash(Path::new("x.pdf")));
    }
}
