//! Reads a project's files as a `Snapshot`, which `project.graph`, the requests
//! sent to Jev and the journal's code (`project.source`) all read through. In
//! a git folder with a commit, the snapshot is the checked-out commit's tree, so
//! untracked and ignored files and uncommitted edits never reach the world, and
//! a submodule is only a pointer. Outside git, in a repository with no commits,
//! or in a folder with nothing committed, it is every file on disk that
//! .gitignore keeps.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};

/// A file in a snapshot.
pub struct Walked {
    /// Relative to the root, with `/` between parts.
    pub path: String,
    pub bytes: u64,
    pub hash: String,
    /// None when the file is binary, which means a zero byte in its first 8,000 bytes.
    pub text: Option<String>,
}

/// The snapshot leaves out larger files unread. They are bundles, data dumps
/// and vendored blobs, not code a person writes by hand.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// FNV-1a over the bytes. It identifies content and is not a security hash.
pub fn content_hash(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// The project's files at one commit, or on disk.
pub struct Snapshot {
    root: PathBuf,
    at: Option<At>,
}

/// A commit's tree under the root. `blobs` holds each blob's path relative to
/// the root, its object id and its size.
struct At {
    commit: String,
    blobs: Vec<(String, String, u64)>,
}

impl Snapshot {
    /// The snapshot of `root` now. It is the checked-out commit, or the disk when
    /// there is no commit or the commit has nothing under `root`.
    pub fn of(root: &Path) -> Snapshot {
        let at = head_of(root).and_then(|commit| At::read(root, commit));
        Snapshot { root: root.to_path_buf(), at }
    }

    /// `root` as it was at `commit`, when that commit has anything under it.
    pub fn at(root: &Path, commit: &str) -> Option<Snapshot> {
        let at = At::read(root, commit.to_string())?;
        Some(Snapshot { root: root.to_path_buf(), at: Some(at) })
    }

    /// The commit read, or None when the snapshot is the disk.
    pub fn commit(&self) -> Option<&str> {
        self.at.as_ref().map(|a| a.commit.as_str())
    }

    /// Every file with its contents read, in path order.
    pub fn files(&self) -> Vec<Walked> {
        match &self.at {
            Some(at) => {
                let files = at.files(&self.root);
                let texts = files.iter().map(|f| (f.path.clone(), f.text.as_deref().map(Arc::from))).collect();
                if let Ok(mut cache) = texts_cache().lock() {
                    cache.insert(self.root.clone(), (at.commit.clone(), Arc::new(texts)));
                }
                files
            }
            None => disk(&self.root),
        }
    }

    /// One file's text by its path relative to the root, or None when the
    /// snapshot has no such file or it is binary. Each slice of the
    /// understanding pass plans every request again, so the snapshot caches
    /// texts per commit, or per change on disk.
    pub fn text(&self, path: &str) -> Option<Arc<str>> {
        let relative = Path::new(path);
        if path.is_empty() || !relative.components().all(|c| matches!(c, Component::Normal(_))) {
            return None;
        }
        let Some(at) = &self.at else {
            return disk_text(&self.root, relative);
        };
        let cached = |cache: &Texts| cache.get(&self.root).filter(|(c, _)| *c == at.commit).map(|(_, t)| t.clone());
        let texts = match texts_cache().lock().ok().and_then(|c| cached(&c)) {
            Some(t) => t,
            None => {
                self.files();
                texts_cache().lock().ok().and_then(|c| cached(&c))?
            }
        };
        texts.get(path).cloned().flatten()
    }
}

type Texts = HashMap<PathBuf, (String, Arc<HashMap<String, Option<Arc<str>>>>)>;

/// The last commit's texts read for each root.
fn texts_cache() -> &'static Mutex<Texts> {
    static CACHE: OnceLock<Mutex<Texts>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn git(root: &Path) -> Command {
    let mut c = Command::new("git");
    c.env("GIT_NO_LAZY_FETCH", "1").arg("-C").arg(root);
    c
}

/// The commit checked out, when `root` is in git and has one.
fn head_of(root: &Path) -> Option<String> {
    let out = git(root).args(["rev-parse", "--verify", "-q", "HEAD"]).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string()).filter(|c| !c.is_empty())
}

impl At {
    /// The blobs of `commit`'s tree under `root`, or None when it has none there.
    fn read(root: &Path, commit: String) -> Option<At> {
        // Run in the root, `ls-tree` lists only the blobs under it, with paths relative to it.
        let out = git(root).args(["ls-tree", "-r", "-z", "-l", &commit]).output().ok()?;
        if !out.status.success() {
            return None;
        }
        let mut blobs = Vec::new();
        for entry in out.stdout.split(|b| *b == 0).filter(|e| !e.is_empty()) {
            let entry = String::from_utf8_lossy(entry);
            let Some((meta, path)) = entry.split_once('\t') else {
                continue;
            };
            let mut meta = meta.split_whitespace();
            let (Some(mode), Some(kind), Some(object), Some(size)) = (meta.next(), meta.next(), meta.next(), meta.next()) else {
                continue;
            };
            // Skip submodules, which point to another project, and symlinks, which could point anywhere.
            if kind != "blob" || mode == "120000" {
                continue;
            }
            let Ok(size) = size.parse::<u64>() else {
                continue;
            };
            if size <= MAX_FILE_BYTES {
                blobs.push((path.to_string(), object.to_string(), size));
            }
        }
        (!blobs.is_empty()).then_some(At { commit, blobs })
    }

    /// Every blob's bytes, from one `git cat-file --batch`. It leaves out a blob that a partial clone never fetched.
    fn files(&self, root: &Path) -> Vec<Walked> {
        let Ok(mut child) = git(root).args(["cat-file", "--batch"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else {
            return Vec::new();
        };
        let ids: String = self.blobs.iter().map(|(_, id, _)| format!("{id}\n")).collect();
        let mut stdin = child.stdin.take();
        let writer = std::thread::spawn(move || {
            if let Some(s) = stdin.as_mut() {
                let _ = s.write_all(ids.as_bytes());
            }
        });
        let mut out = Vec::new();
        if let Some(stdout) = child.stdout.take() {
            let mut reader = BufReader::new(stdout);
            for (path, _, _) in &self.blobs {
                let mut header = String::new();
                if reader.read_line(&mut header).unwrap_or(0) == 0 {
                    break;
                }
                let Some(size) = header.split_whitespace().nth(2).and_then(|s| s.parse::<usize>().ok()) else {
                    continue;
                };
                let mut bytes = vec![0; size + 1];
                if reader.read_exact(&mut bytes).is_err() {
                    break;
                }
                bytes.pop();
                out.push(walked(path.clone(), bytes));
            }
        }
        let _ = writer.join();
        let _ = child.wait();
        out.sort_by(|a, b| a.path.cmp(&b.path));
        out
    }
}

fn walked(path: String, bytes: Vec<u8>) -> Walked {
    let binary = bytes.iter().take(8000).any(|b| *b == 0);
    Walked {
        path,
        bytes: bytes.len() as u64,
        hash: content_hash(&bytes),
        text: (!binary).then(|| String::from_utf8_lossy(&bytes).into_owned()),
    }
}

/// A file's text on disk, or None when the file is outside the root. It rereads
/// the file only when its modified time or size changes.
fn disk_text(root: &Path, relative: &Path) -> Option<Arc<str>> {
    type Cache = HashMap<PathBuf, (std::time::SystemTime, u64, Arc<str>)>;
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    let base = root.canonicalize().ok()?;
    let full = base.join(relative).canonicalize().ok()?;
    if !full.starts_with(&base) {
        return None;
    }
    let meta = std::fs::metadata(&full).ok()?;
    let stamp = (meta.modified().ok()?, meta.len());
    let mut cache = CACHE.get_or_init(|| Mutex::new(HashMap::new())).lock().ok()?;
    if let Some((m, l, text)) = cache.get(&full)
        && (*m, *l) == stamp
    {
        return Some(text.clone());
    }
    let text: Arc<str> = std::fs::read_to_string(&full).ok()?.into();
    cache.insert(full, (stamp.0, stamp.1, text.clone()));
    Some(text)
}

/// Every regular file under `root` that .gitignore keeps, in path order. It
/// never reads outside the root. It skips symlinks to files or directories
/// without following them. It also skips any folder below the root that is a
/// git checkout of its own, such as a worktree, a nested repository or a
/// submodule, since that is another project.
fn disk(root: &Path) -> Vec<Walked> {
    let mut out = Vec::new();
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_global(false)
        .require_git(false)
        // A symlink could point anywhere on the disk, and a cloned repository's author chooses its targets.
        .follow_links(false)
        .filter_entry(|e| e.file_name() != ".git" && !(e.depth() > 0 && e.file_type().is_some_and(|t| t.is_dir()) && e.path().join(".git").exists()))
        .build();
    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        if entry.metadata().map_or(true, |m| m.len() > MAX_FILE_BYTES) {
            continue;
        }
        let Ok(rel) = entry.path().strip_prefix(root) else {
            continue;
        };
        let path = rel.to_string_lossy().replace('\\', "/");
        let Ok(bytes) = std::fs::read(entry.path()) else {
            continue;
        };
        out.push(walked(path, bytes));
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder for one test, and a function that runs git in it.
    fn repo(name: &str) -> (PathBuf, impl Fn(&[&str]) -> String) {
        let root = std::env::temp_dir().join(format!("gaia-snapshot-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let at = root.clone();
        let git = move |args: &[&str]| {
            let out = Command::new("git")
                .arg("-C")
                .arg(&at)
                .args(["-c", "user.name=Gaia", "-c", "user.email=gaia@example.com"])
                .args(args)
                .output()
                .unwrap();
            assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        (root, git)
    }

    #[test]
    fn a_world_in_git_is_its_commit_and_never_what_is_uncommitted() {
        let (root, git) = repo("commit");
        git(&["init", "-q"]);
        std::fs::write(root.join(".gitignore"), "ignored.ts\n").unwrap();
        std::fs::write(root.join("a.ts"), "export const a = 1;\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-q", "-m", "one"]);
        // A submodule is only a pointer to another project's commit.
        let one = git(&["rev-parse", "HEAD"]);
        git(&["update-index", "--add", "--cacheinfo", &format!("160000,{one},vendor/lib")]);
        git(&["commit", "-q", "-m", "a submodule"]);
        let head = git(&["rev-parse", "HEAD"]);
        std::fs::write(root.join("a.ts"), "export const a = 2;\n").unwrap();
        std::fs::write(root.join("new.ts"), "export const n = 3;\n").unwrap();
        std::fs::write(root.join("ignored.ts"), "export const i = 4;\n").unwrap();

        let snapshot = Snapshot::of(&root);
        assert_eq!(snapshot.commit(), Some(head.as_str()));
        let paths: Vec<String> = snapshot.files().into_iter().map(|w| w.path).collect();
        assert_eq!(paths, vec![".gitignore".to_string(), "a.ts".to_string()]);
        assert_eq!(snapshot.text("a.ts").as_deref(), Some("export const a = 1;\n"));
        assert_eq!(snapshot.text("new.ts"), None);
        assert_eq!(snapshot.text("ignored.ts"), None);
        assert_eq!(snapshot.text("../a.ts"), None);
        // The graph records which commit it read.
        assert_eq!(crate::graph::build(&root).unwrap().commit, Some(head));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_folder_inside_a_repository_is_read_from_its_own_part_of_the_commit() {
        let (root, git) = repo("inside");
        git(&["init", "-q"]);
        std::fs::create_dir_all(root.join("sub/src")).unwrap();
        std::fs::write(root.join("top.ts"), "export const t = 1;\n").unwrap();
        std::fs::write(root.join("sub/src/b.ts"), "export const b = 2;\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-q", "-m", "one"]);
        let snapshot = Snapshot::of(&root.join("sub"));
        let paths: Vec<String> = snapshot.files().into_iter().map(|w| w.path).collect();
        assert_eq!(paths, vec!["src/b.ts".to_string()]);
        assert_eq!(snapshot.text("src/b.ts").as_deref(), Some("export const b = 2;\n"));
        // A folder with nothing committed reads from the disk.
        std::fs::create_dir_all(root.join("fresh")).unwrap();
        std::fs::write(root.join("fresh/c.ts"), "export const c = 3;\n").unwrap();
        let fresh = Snapshot::of(&root.join("fresh"));
        assert_eq!(fresh.commit(), None);
        assert_eq!(fresh.text("c.ts").as_deref(), Some("export const c = 3;\n"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_repository_with_no_commit_yet_is_read_from_the_disk() {
        let (root, git) = repo("empty");
        git(&["init", "-q"]);
        std::fs::write(root.join(".gitignore"), "ignored.ts\n").unwrap();
        std::fs::write(root.join("a.ts"), "export const a = 1;\n").unwrap();
        std::fs::write(root.join("ignored.ts"), "export const i = 4;\n").unwrap();
        let snapshot = Snapshot::of(&root);
        assert_eq!(snapshot.commit(), None);
        let paths: Vec<String> = snapshot.files().into_iter().map(|w| w.path).collect();
        assert_eq!(paths, vec![".gitignore".to_string(), "a.ts".to_string()]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_folder_that_is_a_checkout_of_its_own_is_another_project() {
        let root = std::env::temp_dir().join(format!("gaia-walk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join(".claude/worktrees/agent/src")).unwrap();
        std::fs::create_dir_all(root.join("vendor/lib")).unwrap();
        std::fs::write(root.join("src/a.ts"), "export const a = 1;\n").unwrap();
        // A worktree's .git is a file that points at its repository. A nested repository's .git is a folder.
        std::fs::write(root.join(".claude/worktrees/agent/.git"), "gitdir: /elsewhere\n").unwrap();
        std::fs::write(root.join(".claude/worktrees/agent/src/a.ts"), "export const a = 1;\n").unwrap();
        std::fs::create_dir_all(root.join("vendor/lib/.git")).unwrap();
        std::fs::write(root.join("vendor/lib/b.ts"), "export const b = 2;\n").unwrap();
        let paths: Vec<String> = Snapshot::of(&root).files().into_iter().map(|w| w.path).collect();
        assert_eq!(paths, vec!["src/a.ts".to_string()]);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
