//! Reads a project's history and names from git: each commit's time, author
//! and changed files, the root commit, renames and commit counts. Every call
//! sets `GIT_NO_LAZY_FETCH`, so git fails rather than fetch a missing object
//! and never reaches the network. A copy cloned without file contents
//! (`clone.rs`) still has every commit and tree.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

/// One commit's Unix time in seconds, its author's email and the files it changed.
pub struct Commit {
    pub at: i64,
    pub author: String,
    pub files: Vec<String>,
}

/// The history of the files under `root`, newest commit first, with paths
/// relative to `root`. One `git log` call reads it all. Empty when git fails,
/// as for a directory outside git.
pub fn history(root: &Path) -> Vec<Commit> {
    let out = Command::new("git")
        .env("GIT_NO_LAZY_FETCH", "1")
        .arg("-C")
        .arg(root)
        .args([
            "log",
            "--relative",
            "--no-renames",
            "--name-only",
            "--format=%x1e%at%x1f%ae",
        ])
        .output();
    match out {
        Ok(out) if out.status.success() => parse(&String::from_utf8_lossy(&out.stdout)),
        _ => Vec::new(),
    }
}

/// Parses `git log --name-only --format=%x1e%at%x1f%ae`.
pub fn parse(log: &str) -> Vec<Commit> {
    log.split('\u{1e}')
        .filter_map(|record| {
            let mut lines = record.lines();
            let (at, author) = lines.next()?.split_once('\u{1f}')?;
            let files = lines
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .map(String::from)
                .collect();
            Some(Commit {
                at: at.parse().ok()?,
                author: author.to_string(),
                files,
            })
        })
        .collect()
}

/// The first 12 characters of the history's root commit. `project_id` uses it,
/// so a project keeps its ID wherever it is cloned.
pub fn root_commit(root: &Path) -> Option<String> {
    let out = Command::new("git")
        .env("GIT_NO_LAZY_FETCH", "1")
        .arg("-C")
        .arg(root)
        .args(["rev-list", "--max-parents=0", "HEAD"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .last()
        .map(|l| l.trim().chars().take(12).collect())
}

/// The canonical top-level folder of the git working tree that contains `root`,
/// or None outside git.
pub fn toplevel(root: &Path) -> Option<std::path::PathBuf> {
    let out = Command::new("git")
        .env("GIT_NO_LAZY_FETCH", "1")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let top = String::from_utf8_lossy(&out.stdout).trim().to_string();
    std::path::Path::new(&top).canonicalize().ok()
}

/// The repository's name. It is the last part of the `origin` remote's
/// address, without `.git`. With no remote, it is the folder name of the main
/// checkout, which all its worktrees share, so a worktree's folder or a branch
/// never changes it.
pub fn name(root: &Path) -> Option<String> {
    let git = |args: &[&str]| {
        let out = Command::new("git")
            .env("GIT_NO_LAZY_FETCH", "1")
            .arg("-C")
            .arg(root)
            .args(args)
            .output()
            .ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
    };
    if let Some(url) = git(&["config", "--get", "remote.origin.url"]) {
        let last = url.trim_end_matches('/').rsplit(['/', ':']).next()?;
        let name = last.strip_suffix(".git").unwrap_or(last);
        if !name.is_empty() {
            return Some(name.to_string());
        }
    }
    let common = std::path::PathBuf::from(git(&[
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
    ])?);
    // A submodule's git directory is not named `.git`, so its own top-level folder gives the name.
    let checkout = if common.file_name()? == ".git" {
        common.parent()?.to_path_buf()
    } else {
        std::path::PathBuf::from(git(&["rev-parse", "--show-toplevel"])?)
    };
    Some(checkout.file_name()?.to_string_lossy().into_owned())
}

/// Runs git in `root` with `GIT_NO_LAZY_FETCH`, so it never reaches the network.
fn git_in(root: &Path, args: &[&str]) -> Option<std::process::Output> {
    Command::new("git")
        .env("GIT_NO_LAZY_FETCH", "1")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .ok()
}

/// Whether `from` is `to` or an ancestor of it. It accepts only hex commit ids
/// of 4 to 64 characters, so git can't read either argument as an option.
fn is_ancestor(root: &Path, from: &str, to: &str) -> bool {
    let id = |c: &str| (4..=64).contains(&c.len()) && c.chars().all(|ch| ch.is_ascii_hexdigit());
    id(from)
        && id(to)
        && git_in(root, &["merge-base", "--is-ancestor", from, to])
            .is_some_and(|out| out.status.success())
}

/// How many commits after `from` up to `to` changed a file under `root`.
/// None when `from` is not in `to`'s history, as after a rebase or a switch
/// to another branch, or when either is not a commit git knows.
pub fn commits_between(root: &Path, from: &str, to: &str) -> Option<u64> {
    if !is_ancestor(root, from, to) {
        return None;
    }
    let out = git_in(
        root,
        &["rev-list", "--count", &format!("{from}..{to}"), "--", "."],
    )?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

/// Maps each renamed file's path at `from` to its path at `to`. It follows
/// git's renames commit by commit at 50% similarity, git's default, and drops
/// a renamed file that is later deleted. None when `from` is not an ancestor
/// of `to`.
pub fn renames(root: &Path, from: &str, to: &str) -> Option<BTreeMap<String, String>> {
    if !is_ancestor(root, from, to) {
        return None;
    }
    let range = format!("{from}..{to}");
    let out = git_in(
        root,
        &[
            "log",
            "--reverse",
            "--relative",
            "-M50%",
            "--name-status",
            "--format=%x1e",
            &range,
        ],
    )?;
    if !out.status.success() {
        return None;
    }
    // `now` maps a path at `from` to its current path, and `origin` maps it back.
    let mut now: BTreeMap<String, String> = BTreeMap::new();
    let mut origin: BTreeMap<String, String> = BTreeMap::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        match parts.as_slice() {
            [status, old, new] if status.starts_with('R') => {
                let first = origin.remove(*old).unwrap_or_else(|| old.to_string());
                now.insert(first.clone(), new.to_string());
                origin.insert(new.to_string(), first);
            }
            [status, gone] if status.starts_with('D') => {
                if let Some(first) = origin.remove(*gone) {
                    now.remove(&first);
                }
            }
            _ => {}
        }
    }
    Some(now)
}
