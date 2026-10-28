//! Gives each directory, file and definition a lineage, an identity that
//! survives renames and moves, so the world stays recognizable as the code
//! changes. The project's store keeps the last graph's lineage and fingerprints
//! in its `lineage` table under the key `graph`, and `assign` matches each new
//! graph against them.

use super::parse::similarity;
use super::walk::content_hash;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

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
    fingerprint.iter().map(|h| format!("{h:04x}")).collect()
}

fn decode(s: &str) -> Vec<u16> {
    (0..s.len() / 4)
        .filter_map(|i| u16::from_str_radix(&s[i * 4..i * 4 + 4], 16).ok())
        .collect()
}

fn dir_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
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
    let mut out: HashMap<String, String> = HashMap::new();
    let mut taken: HashSet<String> = HashSet::new();
    let give = |out: &mut HashMap<String, String>,
                taken: &mut HashSet<String>,
                id: &str,
                lineage: &str|
     -> bool {
        if out.contains_key(id) || taken.contains(lineage) {
            return false;
        }
        out.insert(id.to_string(), lineage.to_string());
        taken.insert(lineage.to_string());
        true
    };
    let ids: Vec<String> = current
        .dirs
        .iter()
        .map(|d| format!("dir:{d}"))
        .chain(current.files.iter().map(|f| format!("file:{}", f.path)))
        .chain(current.defs.iter().map(|d| d.id.to_string()))
        .collect();

    // 1. The same id.
    for id in &ids {
        if let Some(l) = prev.nodes.get(id) {
            give(&mut out, &mut taken, id, l);
        }
    }

    // 2. Files git renamed, and their definitions by qualified name.
    if let Some(renames) = renames {
        let back: HashMap<&str, &str> = renames
            .iter()
            .map(|(old, new)| (new.as_str(), old.as_str()))
            .collect();
        for f in &current.files {
            let Some(old) = back.get(f.path) else {
                continue;
            };
            if let Some(l) = prev.nodes.get(&format!("file:{old}")) {
                give(&mut out, &mut taken, &format!("file:{}", f.path), l);
            }
        }
        for d in &current.defs {
            let Some(old) = back.get(d.file) else {
                continue;
            };
            let qualified = d.id.split_once('#').map_or("", |(_, q)| q);
            if let Some(l) = prev.nodes.get(&format!("def:{old}#{qualified}")) {
                give(&mut out, &mut taken, d.id, l);
            }
        }
    }

    // 3. Definitions moved by body, the closest pairs first.
    let open_old: Vec<(&String, &DefPrint, Vec<u16>)> = prev
        .defs
        .iter()
        .filter(|(id, _)| prev.nodes.get(*id).is_some_and(|l| !taken.contains(l)))
        .map(|(id, p)| (id, p, decode(&p.fingerprint)))
        .collect();
    let mut pairs: Vec<(f64, usize, usize)> = Vec::new();
    for (i, d) in current.defs.iter().enumerate() {
        if out.contains_key(d.id) {
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
        if let Some(l) = prev.nodes.get(open_old[j].0) {
            give(&mut out, &mut taken, current.defs[i].id, l);
        }
    }

    // 4. Files by their text.
    let mut pairs: Vec<(f64, usize, &String)> = Vec::new();
    for (i, f) in current.files.iter().enumerate() {
        if out.contains_key(&format!("file:{}", f.path)) {
            continue;
        }
        for (path, fp) in &prev.files {
            let Some(l) = prev.nodes.get(&format!("file:{path}")) else {
                continue;
            };
            if taken.contains(l) {
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
        if let Some(l) = prev.nodes.get(&format!("file:{path}")) {
            give(
                &mut out,
                &mut taken,
                &format!("file:{}", current.files[i].path),
                l,
            );
        }
    }

    // 5. A file takes the lineage of the old file its definitions came from.
    let old_of_lineage: HashMap<&str, &str> = prev
        .nodes
        .iter()
        .map(|(id, l)| (l.as_str(), id.as_str()))
        .collect();
    for f in &current.files {
        let id = format!("file:{}", f.path);
        if out.contains_key(&id) || f.lines == 0 {
            continue;
        }
        let mut from: HashMap<&str, u32> = HashMap::new();
        for d in current.defs.iter().filter(|d| d.file == f.path) {
            let Some(old) = out.get(d.id).and_then(|l| old_of_lineage.get(l.as_str())) else {
                continue;
            };
            if let Some(p) = prev.defs.get(*old) {
                *from.entry(p.file.as_str()).or_insert(0) += d.lines;
            }
        }
        if let Some((old_file, lines)) = from.into_iter().max_by_key(|(_, n)| *n)
            && lines * 2 >= f.lines
            && let Some(l) = prev.nodes.get(&format!("file:{old_file}"))
        {
            give(&mut out, &mut taken, &id, l);
        }
    }

    // 6. A directory takes the lineage of the old directory its files moved from.
    let mut moved: HashMap<&str, HashMap<String, u32>> = HashMap::new();
    let mut held: HashMap<&str, u32> = HashMap::new();
    for old in prev.nodes.keys().filter_map(|id| id.strip_prefix("file:")) {
        held.entry(dir_of(old)).and_modify(|n| *n += 1).or_insert(1);
        let Some(l) = prev.nodes.get(&format!("file:{old}")) else {
            continue;
        };
        let now = current
            .files
            .iter()
            .find(|f| out.get(&format!("file:{}", f.path)) == Some(l));
        if let Some(f) = now {
            *moved
                .entry(dir_of(old))
                .or_default()
                .entry(dir_of(f.path).to_string())
                .or_insert(0) += 1;
        }
    }
    for (old_dir, targets) in moved {
        let Some((new_dir, n)) = targets.into_iter().max_by_key(|(_, n)| *n) else {
            continue;
        };
        if n * 2 >= held[old_dir]
            && let Some(l) = prev.nodes.get(&format!("dir:{old_dir}"))
        {
            give(&mut out, &mut taken, &format!("dir:{new_dir}"), l);
        }
    }

    // A file in a moved directory takes the lineage of the old file with the same name.
    for f in &current.files {
        let id = format!("file:{}", f.path);
        if out.contains_key(&id) {
            continue;
        }
        let dir = dir_of(f.path);
        let Some(old_dir) = out
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
        if let Some(l) = prev.nodes.get(&format!("file:{old}")) {
            give(&mut out, &mut taken, &id, l);
        }
    }

    // 7. Everything else is new.
    for id in &ids {
        if out.contains_key(id) {
            continue;
        }
        let mut fresh = content_hash(id.as_bytes());
        let mut n = 1;
        while taken.contains(&fresh) {
            n += 1;
            fresh = content_hash(format!("{id}~{n}").as_bytes());
        }
        give(&mut out, &mut taken, id, &fresh);
    }

    let record = Record {
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
    };
    (out, record)
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
