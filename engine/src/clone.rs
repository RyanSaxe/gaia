//! Public GitHub repositories, copied into Gaia's own app-data folder so their
//! worlds open like any folder's. Only an address of the form
//! `https://github.com/OWNER/REPO` or `github.com/OWNER/REPO` (with an
//! optional `.git`) is accepted, and the URL git is given is always rebuilt
//! from the owner and the repository's name, never taken from the text.
//!
//! Every git call here speaks only https, never prompts, reads no system or
//! global config and no credentials, runs no hooks, skips LFS content and
//! submodules, and checks symlinks out as plain files. A clone keeps every
//! commit and tree but fetches file contents only for what it checks out
//! (`--filter=blob:none`): the project's ID is its root commit and its
//! history's facts need the first commit, so a shallow copy would rename the
//! project on every fetch and lose Jev's kept answers. A clone past
//! `CLONE_BYTES` on disk or `CLONE_SECONDS` is stopped and removed.

use serde_json::{Value, json};
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// The longest a clone or a fetch may take.
pub const CLONE_SECONDS: u64 = 240;
/// The most a clone may hold on disk, its history and checkout together.
pub const CLONE_BYTES: u64 = 500 * 1024 * 1024;
/// The longest asking GitHub whether a repository is there may take.
pub const LOCATE_SECONDS: u64 = 20;

/// The owner and repository an address names, or None when it is not exactly a GitHub repository's address.
pub fn parse_address(text: &str) -> Option<(String, String)> {
    let t = text.trim();
    let rest = t
        .strip_prefix("https://github.com/")
        .or_else(|| t.strip_prefix("github.com/"))?;
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    let (owner, repo) = rest.split_once('/')?;
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    let owner_ok = (1..=39).contains(&owner.len())
        && owner.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && !owner.starts_with('-')
        && !owner.ends_with('-')
        && !owner.contains("--");
    let repo_ok = (1..=100).contains(&repo.len())
        && repo
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !repo.starts_with('.');
    (owner_ok && repo_ok).then(|| (owner.to_string(), repo.to_string()))
}

/// Where Gaia keeps its copy of a repository under the data folder `data`: GitHub's names ignore case, so the folder's do too.
pub fn folder_in(data: &Path, owner: &str, repo: &str) -> PathBuf {
    data.join("clones")
        .join(owner.to_ascii_lowercase())
        .join(repo.to_ascii_lowercase())
}

fn url_of(owner: &str, repo: &str) -> String {
    format!("https://github.com/{owner}/{repo}.git")
}

/// git, fenced: https only, no prompts, no config but the repository's own, no credentials, no hooks, no LFS content, symlinks as plain files.
fn git() -> Command {
    let mut c = Command::new("git");
    for inherited in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_COMMON_DIR",
        "GIT_NAMESPACE",
    ] {
        c.env_remove(inherited);
    }
    c.env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_LFS_SKIP_SMUDGE", "1")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GCM_INTERACTIVE", "never")
        .args([
            "-c",
            "protocol.allow=never",
            "-c",
            "protocol.https.allow=always",
            "-c",
            "credential.helper=",
            "-c",
            "core.symlinks=false",
            "-c",
            "core.hooksPath=/dev/null",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Its own process group, so stopping it at a cap stops the helpers it started too.
        .process_group(0);
    c
}

/// How a capped git call ended.
enum Ran {
    Done {
        ok: bool,
        stdout: String,
        stderr: String,
    },
    Slow,
    Large,
}

/// The bytes under `dir`, never following a link.
fn size_of(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|e| match e.path().symlink_metadata() {
            Ok(m) if m.is_dir() => size_of(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

/// Runs `cmd`, stopping it (and everything it started) past `seconds`, or once `watch` holds more than `CLONE_BYTES`.
fn run(mut cmd: Command, seconds: u64, watch: Option<&Path>) -> Ran {
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            return Ran::Done {
                ok: false,
                stdout: String::new(),
                stderr: e.to_string(),
            };
        }
    };
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_string(&mut text);
            }
            text
        })
    };
    let out = drain(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let err = drain(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let stop = |child: &mut std::process::Child| {
        let _ = Command::new("kill")
            .args(["-KILL", &format!("-{}", child.id())])
            .status();
        let _ = child.kill();
        let _ = child.wait();
    };
    let started = Instant::now();
    let mut polls: u64 = 0;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Ran::Done {
                    ok: status.success(),
                    stdout: out.join().unwrap_or_default(),
                    stderr: err.join().unwrap_or_default(),
                };
            }
            Ok(None) => {}
            Err(e) => {
                stop(&mut child);
                return Ran::Done {
                    ok: false,
                    stdout: String::new(),
                    stderr: e.to_string(),
                };
            }
        }
        if started.elapsed() > Duration::from_secs(seconds) {
            stop(&mut child);
            return Ran::Slow;
        }
        // The size is summed once a second; the exit is seen four times as often.
        polls += 1;
        if polls.is_multiple_of(4)
            && let Some(dir) = watch
            && size_of(dir) > CLONE_BYTES
        {
            stop(&mut child);
            return Ran::Large;
        }
        thread::sleep(Duration::from_millis(250));
    }
}

/// Why git could not reach a repository, from what it wrote: no public repository there, or no way to reach GitHub.
fn why_failed(stderr: &str) -> &'static str {
    let s = stderr.to_ascii_lowercase();
    const MISSING: [&str; 5] = [
        "repository not found",
        "could not read username",
        "terminal prompts disabled",
        "not found",
        "authentication failed",
    ];
    const OFFLINE: [&str; 6] = [
        "could not resolve host",
        "unable to access",
        "failed to connect",
        "couldn't connect",
        "timed out",
        "network is unreachable",
    ];
    if MISSING.iter().any(|m| s.contains(m)) {
        "missing"
    } else if OFFLINE.iter().any(|m| s.contains(m)) {
        "offline"
    } else {
        "missing"
    }
}

/// `project.locate`: whether an address names a public repository GitHub will hand over, and where Gaia keeps its copy.
pub fn locate(address: &str) -> Result<Value, String> {
    let Some((owner, repo)) = parse_address(address) else {
        return Ok(json!({ "found": false, "why": "address" }));
    };
    let root = folder_in(&crate::store::data_dir()?, &owner, &repo);
    let mut cmd = git();
    cmd.args(["ls-remote", "--symref", &url_of(&owner, &repo), "HEAD"]);
    Ok(match run(cmd, LOCATE_SECONDS, None) {
        // A repository with no commits has nothing to walk through.
        Ran::Done {
            ok: true, stdout, ..
        } if !stdout.trim().is_empty() => json!({
            "found": true,
            "owner": owner,
            "repo": repo,
            "root": root.to_string_lossy(),
            "kept": root.join(".git").is_dir(),
        }),
        Ran::Done { ok: true, .. } => json!({ "found": false, "why": "missing" }),
        Ran::Done { stderr, .. } => json!({ "found": false, "why": why_failed(&stderr) }),
        Ran::Slow | Ran::Large => json!({ "found": false, "why": "offline" }),
    })
}

/// `project.clone`: a fresh copy of the repository in Gaia's data folder, or the copy already there brought up to date.
pub fn clone(address: &str) -> Result<Value, String> {
    let Some((owner, repo)) = parse_address(address) else {
        return Ok(json!({ "cloned": false, "why": "address" }));
    };
    let root = folder_in(&crate::store::data_dir()?, &owner, &repo);
    let url = url_of(&owner, &repo);
    let cloned = |fetched: bool| {
        json!({
            "cloned": true,
            "owner": owner,
            "repo": repo,
            "root": root.to_string_lossy(),
            "fetched": fetched,
        })
    };

    // A copy already here is updated; if GitHub cannot be reached, or the update fails, the copy opens as it was.
    if root.join(".git").is_dir() {
        let mut fetch = git();
        fetch.arg("-C").arg(&root).args([
            "fetch",
            "--filter=blob:none",
            "--no-tags",
            "--quiet",
            "origin",
            "HEAD",
        ]);
        if let Ran::Done { ok: true, .. } = run(fetch, CLONE_SECONDS, Some(&root)) {
            let mut reset = git();
            reset
                .arg("-C")
                .arg(&root)
                .args(["reset", "--hard", "--quiet", "FETCH_HEAD"]);
            if let Ran::Done { ok: true, .. } = run(reset, CLONE_SECONDS, Some(&root)) {
                return Ok(cloned(true));
            }
        }
        return Ok(cloned(false));
    }

    // A fresh clone lands beside its folder and moves in only once it is whole.
    let parent = root.parent().ok_or("A clone's folder has no parent.")?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Could not make {}: {e}", parent.display()))?;
    let name = root
        .file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    let partial = parent.join(format!("{name}.partial-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&partial);
    let mut cmd = git();
    cmd.args([
        "clone",
        "--filter=blob:none",
        "--no-tags",
        "--single-branch",
        "--no-recurse-submodules",
        "--template=",
        "--quiet",
        "-c",
        "core.symlinks=false",
    ])
    .arg(&url)
    .arg(&partial);
    let why = match run(cmd, CLONE_SECONDS, Some(&partial)) {
        Ran::Done { ok: true, .. } => {
            if root.exists() {
                std::fs::remove_dir_all(&root)
                    .map_err(|e| format!("Could not clear {}: {e}", root.display()))?;
            }
            std::fs::rename(&partial, &root).map_err(|e| {
                let _ = std::fs::remove_dir_all(&partial);
                format!("Could not move the clone into {}: {e}", root.display())
            })?;
            return Ok(cloned(false));
        }
        Ran::Done { stderr, .. } => why_failed(&stderr),
        Ran::Slow => "slow",
        Ran::Large => "large",
    };
    let _ = std::fs::remove_dir_all(&partial);
    // The owner's folder goes too when nothing else of theirs is kept.
    let _ = std::fs::remove_dir(parent);
    Ok(json!({ "cloned": false, "why": why }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_github_repository_addresses_are_accepted() {
        let accepted = [
            (
                "https://github.com/sindresorhus/slugify",
                "sindresorhus",
                "slugify",
            ),
            ("github.com/sindresorhus/slugify", "sindresorhus", "slugify"),
            ("https://github.com/rust-lang/rust.git", "rust-lang", "rust"),
            ("github.com/BurntSushi/ripgrep/", "BurntSushi", "ripgrep"),
            ("  https://github.com/a/b.git/  ", "a", "b"),
            ("github.com/a-b/x_y.z-1", "a-b", "x_y.z-1"),
        ];
        for (text, owner, repo) in accepted {
            assert_eq!(
                parse_address(text),
                Some((owner.to_string(), repo.to_string())),
                "{text}"
            );
        }
        let rejected = [
            "",
            "slugify",
            "sindresorhus/slugify",
            "http://github.com/a/b",
            "https://www.github.com/a/b",
            "https://gitlab.com/a/b",
            "https://github.com.evil.example/a/b",
            "https://github.com@evil.example/a/b",
            "https://user:pw@github.com/a/b",
            "https://github.com:443/a/b",
            "git@github.com:a/b.git",
            "ssh://git@github.com/a/b",
            "git://github.com/a/b",
            "file:///etc/passwd",
            "HTTPS://GITHUB.COM/a/b",
            "https://github.com/a",
            "https://github.com/a/",
            "https://github.com/a/b/tree/main",
            "https://github.com/a/b//",
            "https://github.com/a/b?tab=readme",
            "https://github.com/a/b#readme",
            "https://github.com/a/b c",
            "https://github.com/a/b%2Fc",
            "https://github.com/a\\b/c",
            "https://github.com/-a/b",
            "https://github.com/a-/b",
            "https://github.com/a--b/c",
            "https://github.com/a/.git",
            "https://github.com/a/..",
            "https://github.com/a/.hidden",
            "https://github.com/ä/b",
            "https://github.com/a/b\nhttps://github.com/c/d",
            &format!("https://github.com/{}/b", "a".repeat(40)),
            &format!("https://github.com/a/{}", "b".repeat(101)),
        ];
        for text in rejected {
            assert_eq!(parse_address(text), None, "{text:?} should be refused");
        }
        // GitHub's names ignore case, so one repository has one folder however it is written.
        assert_eq!(
            folder_in(Path::new("/data"), "BurntSushi", "RipGrep"),
            Path::new("/data/clones/burntsushi/ripgrep")
        );
    }
}
