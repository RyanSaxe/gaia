//! What the resolved edges and git imply: how much depends on each node
//! (reach), how many definitions each one calls, which files change
//! together, and which definitions are near copies of each other.

use super::model::{Edge, Filled, Reach};
use super::parse::{FINGERPRINT, similarity};
use std::collections::{BTreeSet, HashMap, HashSet};

/// A node of the dependency graph: a definition or a file.
pub struct Item {
    pub id: String,
    /// The file it is, or the file it lies in.
    pub file: usize,
    pub is_file: bool,
}

/// Reach for every definition, file and directory: the definitions and
/// files that depend on it through calls, references, implementations and
/// imports, directly or not. A file depends on whatever its definitions
/// depend on. A directory's reach counts only what lies outside it.
pub fn reach(
    items: &[Item],
    file_dirs: &[String],
    dirs: &BTreeSet<String>,
    edges: &[Edge],
) -> HashMap<String, Reach> {
    let index: HashMap<&str, usize> = items
        .iter()
        .enumerate()
        .map(|(i, it)| (it.id.as_str(), i))
        .collect();
    let file_item: HashMap<usize, usize> = items
        .iter()
        .enumerate()
        .filter(|(_, it)| it.is_file)
        .map(|(i, it)| (it.file, i))
        .collect();
    // Who depends on each item.
    let mut dependents: Vec<Vec<usize>> = vec![Vec::new(); items.len()];
    for e in edges {
        if !matches!(e.kind, "calls" | "references" | "implements" | "imports") {
            continue;
        }
        let Some(&from) = index.get(e.from.as_str()) else {
            continue;
        };
        let targets: Vec<usize> = match index.get(e.to.as_str()) {
            Some(&t) => vec![t],
            // An import of a directory reaches the files directly in it.
            None => match e.to.strip_prefix("dir:") {
                Some(d) => file_dirs
                    .iter()
                    .enumerate()
                    .filter(|(_, fd)| *fd == d)
                    .filter_map(|(f, _)| file_item.get(&f).copied())
                    .collect(),
                None => Vec::new(),
            },
        };
        for t in targets {
            if t != from {
                dependents[t].push(from);
            }
        }
    }
    for (i, it) in items.iter().enumerate() {
        if !it.is_file
            && let Some(&f) = file_item.get(&it.file)
        {
            dependents[i].push(f);
        }
    }

    // `blocked` items are never walked through: a definition's own file
    // holds it, and whatever imports that file need not use the definition.
    let count = |starts: &[usize], inside: &dyn Fn(usize) -> bool, blocked: &[usize]| -> Reach {
        let mut seen: HashSet<usize> = starts.iter().chain(blocked).copied().collect();
        let mut stack: Vec<usize> = starts.to_vec();
        let mut r = Reach::default();
        while let Some(n) = stack.pop() {
            for &d in &dependents[n] {
                if seen.insert(d) {
                    stack.push(d);
                    if !inside(d) {
                        if items[d].is_file {
                            r.files += 1;
                        } else {
                            r.defs += 1;
                        }
                    }
                }
            }
        }
        r
    };

    let mut out: HashMap<String, Reach> = HashMap::new();
    for (i, it) in items.iter().enumerate() {
        if it.is_file {
            let starts: Vec<usize> = items
                .iter()
                .enumerate()
                .filter(|(_, o)| o.file == it.file)
                .map(|(j, _)| j)
                .collect();
            out.insert(
                it.id.clone(),
                count(&starts, &|d| items[d].file == it.file, &[]),
            );
        } else {
            let own: Vec<usize> = file_item.get(&it.file).copied().into_iter().collect();
            out.insert(it.id.clone(), count(&[i], &|d| d == i, &own));
        }
    }
    for dir in dirs {
        let within = |f: usize| {
            dir.is_empty() || file_dirs[f] == *dir || file_dirs[f].starts_with(&format!("{dir}/"))
        };
        let starts: Vec<usize> = items
            .iter()
            .enumerate()
            .filter(|(_, o)| within(o.file))
            .map(|(j, _)| j)
            .collect();
        out.insert(
            format!("dir:{dir}"),
            count(&starts, &|d| within(items[d].file), &[]),
        );
    }
    out
}

/// How many distinct definitions each definition calls, through edges the rules filled.
pub fn calls_out(edges: &[Edge]) -> HashMap<String, u32> {
    let mut called: HashMap<&str, HashSet<&str>> = HashMap::new();
    for e in edges
        .iter()
        .filter(|e| e.kind == "calls" && e.from.starts_with("def:"))
    {
        called
            .entry(e.from.as_str())
            .or_default()
            .insert(e.to.as_str());
    }
    called
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.len() as u32))
        .collect()
}

/// Files committed together in at least 3 commits, which is at least 30%
/// of either file's own commits.
pub fn changes_with(commits: &[Vec<String>], files: &HashSet<&str>) -> Vec<Edge> {
    let mut alone: HashMap<&str, u32> = HashMap::new();
    let mut together: HashMap<(&str, &str), u32> = HashMap::new();
    for c in commits {
        let mut touched: Vec<&str> = c
            .iter()
            .map(String::as_str)
            .filter(|f| files.contains(f))
            .collect();
        touched.sort_unstable();
        touched.dedup();
        for (i, a) in touched.iter().enumerate() {
            *alone.entry(a).or_insert(0) += 1;
            for b in &touched[i + 1..] {
                *together.entry((a, b)).or_insert(0) += 1;
            }
        }
    }
    let mut out: Vec<Edge> = together
        .into_iter()
        .filter(|((a, b), n)| {
            *n >= 3 && (*n as f64 >= 0.3 * alone[a] as f64 || *n as f64 >= 0.3 * alone[b] as f64)
        })
        .map(|((a, b), _)| Edge {
            from: format!("file:{a}"),
            to: format!("file:{b}"),
            kind: "changes-with",
            by: Filled { by: "git" },
            at: None,
        })
        .collect();
    out.sort_by(|x, y| (&x.from, &x.to).cmp(&(&y.from, &y.to)));
    out
}

/// A definition that can be compared for copying.
pub struct Body<'a> {
    pub id: &'a str,
    pub file: usize,
    pub start: u32,
    pub end: u32,
    pub fingerprint: &'a [u16],
}

/// Below this many distinct word 3-grams, a body is too short to tell
/// copying from coincidence: every `return this.x` looks alike.
pub const MIN_SHINGLES: usize = 10;
const SIMILAR: f64 = 0.85;
const BANDS: usize = 16;

/// Definitions whose fingerprints agree on at least 85%, found through
/// locality-sensitive hashing, for each definition that has any. A
/// definition and one nested inside it are never each other's copy.
pub fn duplicates(bodies: &[Body]) -> HashMap<String, Vec<String>> {
    let rows = FINGERPRINT / BANDS;
    let mut pairs: HashSet<(usize, usize)> = HashSet::new();
    for band in 0..BANDS {
        let mut buckets: HashMap<&[u16], Vec<usize>> = HashMap::new();
        for (i, b) in bodies.iter().enumerate() {
            buckets
                .entry(&b.fingerprint[band * rows..(band + 1) * rows])
                .or_default()
                .push(i);
        }
        for members in buckets.values() {
            for (x, &i) in members.iter().enumerate() {
                for &j in &members[x + 1..] {
                    pairs.insert((i, j));
                }
            }
        }
    }
    let mut out: HashMap<String, BTreeSet<String>> = HashMap::new();
    for (i, j) in pairs {
        let (a, b) = (&bodies[i], &bodies[j]);
        let nested = a.file == b.file
            && ((a.start <= b.start && b.end <= a.end) || (b.start <= a.start && a.end <= b.end));
        if nested || similarity(a.fingerprint, b.fingerprint) < SIMILAR {
            continue;
        }
        out.entry(a.id.to_string())
            .or_default()
            .insert(b.id.to_string());
        out.entry(b.id.to_string())
            .or_default()
            .insert(a.id.to_string());
    }
    out.into_iter()
        .map(|(k, v)| (k, v.into_iter().collect()))
        .collect()
}
