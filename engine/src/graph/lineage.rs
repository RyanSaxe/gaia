//! Gives each directory, file and definition a lineage, an identity that
//! survives renames and moves, so the world stays recognizable as the code
//! changes. The project's store keeps the last graph's lineage and fingerprints
//! in its `lineage` table under the key `graph`, and `assign` matches each new
//! graph against them.

use super::parse::similarity;
use super::walk::content_hash;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write as _;

const BODY: f64 = 0.85;
const BODY_SAME_NAME: f64 = 0.6;
const TEXT: f64 = 0.85;

/// What the store keeps of a graph for the next open to match against.
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Record {
    /// The commit the graph was built at, when the project is in git.
    pub commit: Option<String>,
    /// Lineage by id, for directories, files and definitions.
    pub nodes: BTreeMap<String, String>,
    pub defs: BTreeMap<String, DefPrint>,
    /// Each file's text fingerprint, by path.
    pub files: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DefPrint {
    pub name: String,
    pub file: String,
    pub lines: u32,
    pub fingerprint: String,
}

/// A definition of the new graph, with the fields matching needs.
pub struct Def<'a> {
    pub id: &'a str,
    pub file: &'a str,
    pub name: &'a str,
    pub lines: u32,
    pub fingerprint: &'a [u16],
}

pub struct File<'a> {
    pub path: &'a str,
    pub lines: u32,
    pub fingerprint: Vec<u16>,
}

pub struct Current<'a> {
    pub commit: Option<String>,
    pub dirs: Vec<&'a str>,
    pub files: Vec<File<'a>>,
    pub defs: Vec<Def<'a>>,
}

pub fn encode(fingerprint: &[u16]) -> String {
    let mut out = String::with_capacity(fingerprint.len() * 4);
    for h in fingerprint {
        let _ = write!(out, "{h:04x}");
    }
    out
}

fn decode(s: &str) -> Vec<u16> {
    (0..s.len() / 4)
        .filter_map(|i| u16::from_str_radix(&s[i * 4..i * 4 + 4], 16).ok())
        .collect()
}

fn dir_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

struct Matcher<'a> {
    prev: &'a Record,
    out: HashMap<String, String>,
    taken: HashSet<String>,
}

impl<'a> Matcher<'a> {
    fn new(prev: &'a Record) -> Self {
        Self {
            prev,
            out: HashMap::new(),
            taken: HashSet::new(),
        }
    }

    fn give(&mut self, id: &str, lineage: &str) -> bool {
        if self.out.contains_key(id) || self.taken.contains(lineage) {
            return false;
        }
        self.out.insert(id.to_string(), lineage.to_string());
        self.taken.insert(lineage.to_string());
        true
    }

    fn match_same_ids(&mut self, ids: &[String]) {
        for id in ids {
            if let Some(l) = self.prev.nodes.get(id) {
                self.give(id, l);
            }
        }
    }

    fn match_git_renames(&mut self, renames: &BTreeMap<String, String>, current: &Current) {
        let back: HashMap<&str, &str> = renames
            .iter()
            .map(|(old, new)| (new.as_str(), old.as_str()))
            .collect();
        for f in &current.files {
            if let Some(old) = back.get(f.path)
                && let Some(l) = self.prev.nodes.get(&format!("file:{old}"))
            {
                self.give(&format!("file:{}", f.path), l);
            }
        }
        for d in &current.defs {
            let Some(old) = back.get(d.file) else {
                continue;
            };
            let qualified = d.id.split_once('#').map_or("", |(_, q)| q);
            if let Some(l) = self.prev.nodes.get(&format!("def:{old}#{qualified}")) {
                self.give(d.id, l);
            }
        }
    }

    fn match_defs_by_body(&mut self, current: &Current) {
        let open_old: Vec<(&String, &DefPrint, Vec<u16>)> = self
            .prev
            .defs
            .iter()
            .filter(|(id, _)| {
                self.prev
                    .nodes
                    .get(*id)
                    .is_some_and(|l| !self.taken.contains(l))
            })
            .map(|(id, p)| (id, p, decode(&p.fingerprint)))
            .collect();
        let mut pairs: Vec<(f64, usize, usize)> = Vec::new();
        for (i, d) in current.defs.iter().enumerate() {
            if self.out.contains_key(d.id) {
                continue;
            }
            for (j, (_, p, fp)) in open_old.iter().enumerate() {
                let s = similarity(d.fingerprint, fp);
                if s >= BODY || (s >= BODY_SAME_NAME && p.name == d.name) {
                    pairs.push((s, i, j));
                }
            }
        }
        pairs.sort_by(|a, b| b.0.total_cmp(&a.0));
        for (_, i, j) in pairs {
            if let Some(l) = self.prev.nodes.get(open_old[j].0) {
                self.give(current.defs[i].id, l);
            }
        }
    }

    fn match_files_by_text(&mut self, current: &Current) {
        let mut pairs: Vec<(f64, usize, &String)> = Vec::new();
        for (i, f) in current.files.iter().enumerate() {
            if self.out.contains_key(&format!("file:{}", f.path)) {
                continue;
            }
            for (path, fp) in &self.prev.files {
                let Some(l) = self.prev.nodes.get(&format!("file:{path}")) else {
                    continue;
                };
                if self.taken.contains(l) {
                    continue;
                }
                let s = similarity(&f.fingerprint, &decode(fp));
                if s >= TEXT {
                    pairs.push((s, i, path));
                }
            }
        }
        pairs.sort_by(|a, b| b.0.total_cmp(&a.0));
        for (_, i, path) in pairs {
            if let Some(l) = self.prev.nodes.get(&format!("file:{path}")) {
                self.give(&format!("file:{}", current.files[i].path), l);
            }
        }
    }

    fn match_files_by_defs(&mut self, current: &Current, old_of_lineage: &HashMap<&str, &str>) {
        for f in &current.files {
            let id = format!("file:{}", f.path);
            if self.out.contains_key(&id) || f.lines == 0 {
                continue;
            }
            let mut from: HashMap<&str, u32> = HashMap::new();
            for d in current.defs.iter().filter(|d| d.file == f.path) {
                let Some(old) = self
                    .out
                    .get(d.id)
                    .and_then(|l| old_of_lineage.get(l.as_str()))
                else {
                    continue;
                };
                if let Some(p) = self.prev.defs.get(*old) {
                    *from.entry(p.file.as_str()).or_insert(0) += d.lines;
                }
            }
            if let Some((old_file, lines)) = from.into_iter().max_by_key(|(_, n)| *n)
                && lines * 2 >= f.lines
                && let Some(l) = self.prev.nodes.get(&format!("file:{old_file}"))
            {
                self.give(&id, l);
            }
        }
    }

    fn match_moved_dirs(&mut self, current: &Current, old_of_lineage: &HashMap<&str, &str>) {
        let mut moved: HashMap<&str, HashMap<String, u32>> = HashMap::new();
        let mut held: HashMap<&str, u32> = HashMap::new();
        for old in self
            .prev
            .nodes
            .keys()
            .filter_map(|id| id.strip_prefix("file:"))
        {
            held.entry(dir_of(old)).and_modify(|n| *n += 1).or_insert(1);
            let Some(l) = self.prev.nodes.get(&format!("file:{old}")) else {
                continue;
            };
            let now = current
                .files
                .iter()
                .find(|f| self.out.get(&format!("file:{}", f.path)) == Some(l));
            if let Some(f) = now {
                *moved
                    .entry(dir_of(old))
                    .or_default()
                    .entry(dir_of(f.path).to_string())
                    .or_insert(0) += 1;
            }
        }
        for (old_dir, targets) in moved {
            if let Some((new_dir, n)) = targets.into_iter().max_by_key(|(_, n)| *n)
                && n * 2 >= held[old_dir]
                && let Some(l) = self.prev.nodes.get(&format!("dir:{old_dir}"))
            {
                self.give(&format!("dir:{new_dir}"), l);
            }
        }

        // A file in a moved directory takes the lineage of the old file with the same name.
        for f in &current.files {
            let id = format!("file:{}", f.path);
            if self.out.contains_key(&id) {
                continue;
            }
            let dir = dir_of(f.path);
            let Some(old_dir) = self
                .out
                .get(&format!("dir:{dir}"))
                .and_then(|l| old_of_lineage.get(l.as_str()))
                .and_then(|id| id.strip_prefix("dir:"))
                .filter(|old| *old != dir)
            else {
                continue;
            };
            let name = f.path.rsplit('/').next().unwrap_or(f.path);
            let old = if old_dir.is_empty() {
                name.to_string()
            } else {
                format!("{old_dir}/{name}")
            };
            if let Some(l) = self.prev.nodes.get(&format!("file:{old}")) {
                self.give(&id, l);
            }
        }
    }

    fn assign_fresh(&mut self, ids: &[String]) {
        for id in ids {
            if self.out.contains_key(id) {
                continue;
            }
            let mut fresh = content_hash(id.as_bytes());
            let mut n = 1;
            while self.taken.contains(&fresh) {
                n += 1;
                fresh = content_hash(format!("{id}~{n}").as_bytes());
            }
            self.give(id, &fresh);
        }
    }
}

fn build_record(current: &Current, ids: &[String], out: &HashMap<String, String>) -> Record {
    Record {
        commit: current.commit.clone(),
        nodes: ids
            .iter()
            .filter_map(|id| out.get(id).map(|l| (id.clone(), l.clone())))
            .collect(),
        defs: current
            .defs
            .iter()
            .map(|d| {
                let print = DefPrint {
                    name: d.name.to_string(),
                    file: d.file.to_string(),
                    lines: d.lines,
                    fingerprint: encode(d.fingerprint),
                };
                (d.id.to_string(), print)
            })
            .collect(),
        files: current
            .files
            .iter()
            .map(|f| (f.path.to_string(), encode(&f.fingerprint)))
            .collect(),
    }
}

/// Lineage for every directory, file and definition id of the new graph,
/// and the record to keep for the next open. `renames` maps a path at the
/// last commit to its path now. It matches in this order:
///
/// 1. The same id keeps its lineage.
/// 2. A file git renamed keeps its lineage, and so does each definition in it
///    whose qualified name is unchanged.
/// 3. A definition still unmatched takes the lineage of an unmatched old one
///    whose body is at least `BODY` similar, or `BODY_SAME_NAME` with the same
///    name.
/// 4. A file still unmatched takes the lineage of an old one whose text is at
///    least `TEXT` similar. This covers copies and renames git never saw.
/// 5. A file still unmatched takes the lineage of the old file its definitions
///    came from, when those definitions hold at least half its lines.
/// 6. A directory takes the lineage of the old directory when at least half of
///    the old directory's files moved into it together. A file still unmatched
///    in it then takes the lineage of the old file with the same name there,
///    however much it changed.
/// 7. Anything else gets a new lineage.
pub fn assign(
    previous: Option<&Record>,
    renames: Option<&BTreeMap<String, String>>,
    current: &Current,
) -> (HashMap<String, String>, Record) {
    let empty = Record::default();
    let prev = previous.unwrap_or(&empty);
    let ids: Vec<String> = current
        .dirs
        .iter()
        .map(|d| format!("dir:{d}"))
        .chain(current.files.iter().map(|f| format!("file:{}", f.path)))
        .chain(current.defs.iter().map(|d| d.id.to_string()))
        .collect();
    let old_of_lineage: HashMap<&str, &str> = prev
        .nodes
        .iter()
        .map(|(id, l)| (l.as_str(), id.as_str()))
        .collect();

    let mut matcher = Matcher::new(prev);
    matcher.match_same_ids(&ids);
    if let Some(renames) = renames {
        matcher.match_git_renames(renames, current);
    }
    matcher.match_defs_by_body(current);
    matcher.match_files_by_text(current);
    matcher.match_files_by_defs(current, &old_of_lineage);
    matcher.match_moved_dirs(current, &old_of_lineage);
    matcher.assign_fresh(&ids);

    let record = build_record(current, &ids, &matcher.out);
    (matcher.out, record)
}

/// Loads and saves the last graph's record. The engine uses the project's
/// store (`Store`), and tests keep it in memory.
pub trait Keeper {
    fn load(&self, project: &str) -> Option<Record>;
    fn save(&self, project: &str, record: &Record);
}

/// The project's app-data store.
pub struct Store;

impl Keeper for Store {
    fn load(&self, project: &str) -> Option<Record> {
        let value = crate::store::get(project, "lineage", "graph").ok()??;
        serde_json::from_value(value).ok()
    }

    fn save(&self, project: &str, record: &Record) {
        let Ok(value) = serde_json::to_value(record) else {
            return;
        };
        let write = serde_json::json!({ "table": "lineage", "key": "graph", "value": value });
        if let Err(e) = crate::store::put(project, &[write]) {
            eprintln!("gaia-engine: could not keep the graph's lineage: {e}");
        }
    }
}
