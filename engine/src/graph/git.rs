//! A project's history from `git log`: when each file was first committed,
//! which commits touched it and who wrote them. One `git log` call reads the
//! whole history; a directory outside git has none. Neither call ever reaches
//! the network: in a copy cloned without file contents (`clone.rs`), commits
//! and trees are all there, and `GIT_NO_LAZY_FETCH` makes git fail rather
//! than fetch anything missing.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::Command;

/// One commit: when it was made, by whom, and the files it touched.
pub struct Commit {
    pub at: i64,
    pub author: String,
    pub files: Vec<String>,
}

/// The history of the files under `root`, newest commit first, paths relative to `root`.
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

/// The commit that roots the history, which names the project wherever it is cloned.
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

/// The top of the working tree holding `root`, if it is in git.
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

/// The repository's name: the last part of its `origin` remote's address,
/// or with no remote the folder of its main checkout, which its worktrees
/// share. A worktree's folder or a branch never changes it.
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
    // A submodule keeps its history elsewhere, so its own folder names it.
    let checkout = if common.file_name()? == ".git" {
        common.parent()?.to_path_buf()
    } else {
        std::path::PathBuf::from(git(&["rev-parse", "--show-toplevel"])?)
    };
    Some(checkout.file_name()?.to_string_lossy().into_owned())
}

/// The commit checked out, if the root is in git.
pub fn head(root: &Path) -> Option<String> {
    let out = Command::new("git")
        .env("GIT_NO_LAZY_FETCH", "1")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Where each file that existed at `from` lives at `to`, composing git's
/// renames commit by commit, at git's own 50% similarity. Files never
/// renamed are left out. None when `from` is not an ancestor of `to`.
pub fn renames(root: &Path, from: &str, to: &str) -> Option<BTreeMap<String, String>> {
    let git = |args: &[&str]| {
        Command::new("git")
            .env("GIT_NO_LAZY_FETCH", "1")
            .arg("-C")
            .arg(root)
            .args(args)
            .output()
            .ok()
    };
    let ancestor = git(&["merge-base", "--is-ancestor", from, to])?;
    if !ancestor.status.success() {
        return None;
    }
    let range = format!("{from}..{to}");
    let out = git(&[
        "log",
        "--reverse",
        "--relative",
        "-M50%",
        "--name-status",
        "--format=%x1e",
        &range,
    ])?;
    if !out.status.success() {
        return None;
    }
    // From each path as it was at `from` to where it is now, and back.
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

/// Per file: the first commit's time, the times of every commit, and its authors.
#[derive(Default)]
pub struct FileHistory {
    pub first: Option<i64>,
    pub commits: Vec<i64>,
    pub authors: BTreeSet<String>,
}

pub fn by_file(commits: &[Commit]) -> BTreeMap<String, FileHistory> {
    let mut out: BTreeMap<String, FileHistory> = BTreeMap::new();
    for c in commits {
        for f in &c.files {
            let h = out.entry(f.clone()).or_default();
            h.first = Some(h.first.map_or(c.at, |t| t.min(c.at)));
            h.commits.push(c.at);
            h.authors.insert(c.author.clone());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_each_commit_and_the_files_it_touched() {
        let log = "\u{1e}200\u{1f}a@x\n\nsrc/a.ts\nsrc/b.ts\n\u{1e}100\u{1f}b@x\n\nsrc/a.ts\n";
        let commits = parse(log);
        assert_eq!(commits.len(), 2);
        let files = by_file(&commits);
        let a = &files["src/a.ts"];
        assert_eq!(a.first, Some(100));
        assert_eq!(a.commits.len(), 2);
        assert_eq!(a.authors.len(), 2);
        assert_eq!(files["src/b.ts"].first, Some(200));
    }
}
