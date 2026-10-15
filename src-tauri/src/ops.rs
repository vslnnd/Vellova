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

/// Renames `tmp` to `to` only while nothing is there: `fs::rename` would replace a file on Windows.
fn move_free(tmp: &Path, to: &str) -> bool {
    !exists(Path::new(to)) && fs::rename(tmp, to).is_ok()
}

/// The failure of an op whose file stepped aside: the file goes back to its old name, or, if something
/// took that name meanwhile, keeps its temporary name and the message says where it is.
fn step_back(j: &mut Journal, i: usize, e: &io::Error, tmp: &Path, from: &str) -> OpResult {
    if move_free(tmp, from) {
        j.add(&Entry::Restored { tmp: s(tmp), to: from.to_string() });
        return fail(i, e);
    }
    OpResult { message: Some(format!("{e}; the file was left at {}", tmp.display())), ..fail(i, e) }
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

    // Phase 1: every rename source steps aside to a temporary name next to it. Its target is cleared only
    // then, so a source that can't move (locked) never costs the file it would replace.
    let mut staged: Vec<(usize, PathBuf)> = Vec::new();
    for (i, op) in ops.iter().enumerate().filter(|(_, o)| o.kind == Kind::Rename) {
        if stop() {
            report(&mut out, cancelled(i));
            continue;
        }
        let tmp = Path::new(&op.from).with_file_name(format!(".~vellova-{tag}-{stamp}-{i}.tmp"));
        if let Err(e) = fs::rename(&op.from, &tmp) {
            report(&mut out, fail(i, &e));
            continue;
        }
        j.add(&Entry::Temp { from: op.from.clone(), tmp: s(&tmp), to: op.to.clone() });
        match clear_target(&mut j, ctx.bin, op, Path::new(&op.to), &leaving) {
            Ok(()) => staged.push((i, tmp)),
            Err(e) => report(&mut out, step_back(&mut j, i, &e, &tmp, &op.from)),
        }
    }

    // A target still taken now (its file could not step aside) sends its op back to the old name, which
    // keeps that name taken in turn, down the whole chain. So no op ever lands on a name another op needs.
    let mut taken: HashSet<String> = HashSet::new();
    loop {
        let before = taken.len();
        for (i, _) in &staged {
            let op = &ops[*i];
            if exists(Path::new(&op.to)) || taken.contains(&key(&op.to)) {
                taken.insert(key(&op.from));
            }
        }
        if taken.len() == before {
            break;
        }
    }

    // Phase 2: temporary names become final names (always finished, even after Cancel).
    for (i, tmp) in staged {
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
                j.add(&Entry::Final { from: op.from.clone(), tmp: s(&tmp), to: op.to.clone(), size, mtime });
                report(&mut out, ok(i));
            }
            Err(e) => report(&mut out, step_back(&mut j, i, &e, &tmp, &op.from)),
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

/// Puts back files left under a temporary name by an interrupted run, under their old name or, when another
/// file of the batch already took it (a swap stopped half-way), their new one. Returns how many.
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
        if let Entry::Temp { from, tmp, to } = e {
            let tmp_p = Path::new(tmp);
            if settled.contains(tmp.as_str()) || !exists(tmp_p) {
                continue;
            }
            if move_free(tmp_p, from) {
                j.add(&Entry::Restored { tmp: tmp.clone(), to: from.clone() });
                n += 1;
            } else if move_free(tmp_p, to) {
                let (size, mtime) = stat(Path::new(to)).unwrap_or((0, 0));
                j.add(&Entry::Final { from: from.clone(), tmp: tmp.clone(), to: to.clone(), size, mtime });
                n += 1;
            }
        }
    }
    Ok(n)
}

/// Undoes a batch: copies go to the Recycle Bin, renames are reversed, replaced files come back.
/// Files that changed since the batch are left alone and reported. Safe to run again.
pub fn undo(ctx: &Ctx, undo_journal: &Path) -> io::Result<UndoReport> {
    let started = SystemTime::now();
    recover(ctx.journal)?;
    recover(undo_journal)?;
    let entries = read_journal(ctx.journal)?;
    let mut rep = UndoReport::default();
    let same = |p: &str, size: u64, mtime: u64| stat(Path::new(p)).is_ok_and(|st| st == (size, mtime));
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
            match ctx.bin.trash(Path::new(to)) {
                Ok(()) => {
                    rep.restored += 1;
                    binned.insert(key(to));
                }
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
    use std::cell::RefCell;

    /// Test double for the Recycle Bin: moves files into `_bin` and back.
    struct FakeBin {
        dir: PathBuf,
        items: RefCell<Vec<(PathBuf, PathBuf, SystemTime)>>,
    }
    impl Bin for FakeBin {
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
        Journal::open(&t.journal()).unwrap().add(&Entry::Temp { from: a.clone(), tmp, to: t.p("x.pdf") });
        assert_eq!(recover(&t.journal()).unwrap(), 1);
        assert_eq!(t.names(), ["a.pdf"]);
        assert_eq!(recover(&t.journal()).unwrap(), 0);
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
            j.add(&Entry::Temp { from: a.clone(), tmp: ta.clone(), to: b.clone() });
            j.add(&Entry::Temp { from: b.clone(), tmp: tb, to: a.clone() });
            j.add(&Entry::Final { from: a, tmp: ta, to: b, size: 1, mtime: 0 });
        }
        assert_eq!(recover(&t.journal()).unwrap(), 1);
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
}
