//! A project's history from `git log`: when each file was first committed,
//! which commits touched it and who wrote them. One `git log` call reads the
//! whole history; a directory outside git has none.

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
