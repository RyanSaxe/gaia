//! Every file under a project's root that .gitignore keeps, read. Both
//! `project.open` and `project.graph` walk through this.

use std::path::Path;

/// A file as read from disk.
pub struct Walked {
    /// Relative to the root, with `/` between parts.
    pub path: String,
    pub bytes: u64,
    pub hash: String,
    /// None when the file is binary: a zero byte in its first 8,000.
    pub text: Option<String>,
}

/// Files larger than this are left out of the world unread: bundles, data
/// dumps and vendored blobs, never code a person keeps by hand.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// FNV-1a over the file's bytes: a content identity, not a security hash.
pub fn content_hash(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Every regular file under `root` that .gitignore keeps, in path order.
/// Nothing outside the root is ever read: symlinks, to files or
/// directories, are skipped, never followed.
pub fn walk(root: &Path) -> Vec<Walked> {
    let mut out = Vec::new();
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_global(false)
        .require_git(false)
        // A link could lead anywhere on the disk, and a cloned repository chooses its own.
        .follow_links(false)
        .filter_entry(|e| e.file_name() != ".git")
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
        let binary = bytes.iter().take(8000).any(|b| *b == 0);
        out.push(Walked {
            path,
            bytes: bytes.len() as u64,
            hash: content_hash(&bytes),
            text: (!binary).then(|| String::from_utf8_lossy(&bytes).into_owned()),
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}
