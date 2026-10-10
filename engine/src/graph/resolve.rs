//! The rules: an import, call or named path becomes an edge when exactly one
//! target fits, and anything with several possible targets goes pending,
//! with every candidate, for Jev. Anything with none is outside the
//! repository and gets neither. The rules read paths, the language table and
//! the parse; no file name means anything to them.

use super::languages::Spec;
use super::model::{Edge, Filled, PendingRef, Span};
use super::parse::{FileParse, RefKind};
use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap, HashSet};

/// One file, as the rules see it.
pub struct Unit<'a> {
    pub path: &'a str,
    pub spec: Option<&'static Spec>,
    pub parse: Option<&'a FileParse>,
    pub def_ids: &'a [String],
    pub text: Option<&'a str>,
}

impl Unit<'_> {
    fn id(&self) -> String {
        format!("file:{}", self.path)
    }

    fn from(&self, def: Option<usize>) -> String {
        def.map_or_else(|| self.id(), |i| self.def_ids[i].clone())
    }
}

pub struct Resolved {
    pub edges: Vec<Edge>,
    pub pending: Vec<PendingRef>,
}

enum Outcome {
    Edge(String),
    Pending(Vec<String>),
    Outside,
}

fn parent(dir: &str) -> &str {
    dir.rsplit_once('/').map_or("", |(d, _)| d)
}

fn dir_of(path: &str) -> &str {
    parent(path)
}

/// Joins a relative path onto a directory, resolving `.` and `..`.
fn normalize(dir: &str, rel: &str) -> Option<String> {
    let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
    for seg in rel.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            s => parts.push(s),
        }
    }
    Some(parts.join("/"))
}

fn stem(path: &str) -> &str {
    let name_start = path.rfind('/').map_or(0, |i| i + 1);
    match path[name_start..].rfind('.') {
        Some(dot) if dot > 0 => &path[..name_start + dot],
        _ => path,
    }
}

/// Every file and directory, and lookups by path and by last name.
struct Paths<'a> {
    files: HashSet<&'a str>,
    dirs: HashSet<String>,
    /// For each extension, every directory with a file of it somewhere below.
    holding: HashMap<String, HashSet<String>>,
    /// File stems and directories by their last segment, for suffix matching.
    by_last: HashMap<String, Vec<String>>,
}

impl<'a> Paths<'a> {
    fn new(units: &'a [Unit<'a>], dirs: &BTreeSet<String>) -> Self {
        let mut by_last: HashMap<String, Vec<String>> = HashMap::new();
        for u in units {
            let s = stem(u.path);
            let last = s.rsplit('/').next().unwrap_or(s).to_string();
            by_last.entry(last).or_default().push(u.path.to_string());
        }
        for d in dirs.iter().filter(|d| !d.is_empty()) {
            let last = d.rsplit('/').next().unwrap_or(d).to_string();
            by_last.entry(last).or_default().push(format!("{d}/"));
        }
        let mut holding: HashMap<String, HashSet<String>> = HashMap::new();
        for u in units {
            let Some((_, ext)) = u.path.rsplit('/').next().and_then(|n| n.rsplit_once('.')) else {
                continue;
            };
            let set = holding.entry(ext.to_string()).or_default();
            let mut d = dir_of(u.path);
            while !d.is_empty() && set.insert(d.to_string()) {
                d = parent(d);
            }
        }
        Paths {
            files: units.iter().map(|u| u.path).collect(),
            dirs: dirs.iter().cloned().collect(),
            holding,
            by_last,
        }
    }

    /// The node ids a path names: the file itself, the file with any of the
    /// family's extensions, or the directory. A file wins over a directory of
    /// the same name, as a Rust module `filter.rs` does over `filter/`.
    fn named(&self, path: &str, extensions: &[&str]) -> Vec<String> {
        let mut files: Vec<String> = Vec::new();
        if self.files.contains(path) {
            files.push(format!("file:{path}"));
        }
        let base = if extensions.iter().any(|e| path.ends_with(&format!(".{e}"))) {
            stem(path)
        } else {
            path
        };
        for e in extensions {
            let p = format!("{base}.{e}");
            if p != path && self.files.contains(p.as_str()) {
                files.push(format!("file:{p}"));
            }
        }
        if !files.is_empty() {
            return files;
        }
        // A directory counts only when it holds code the import could mean,
        // so `crate::config` never names a folder of YAML.
        let holds = extensions.is_empty()
            || extensions
                .iter()
                .any(|e| self.holding.get(*e).is_some_and(|d| d.contains(path)));
        if self.dirs.contains(path) && !path.is_empty() && holds {
            return vec![format!("dir:{path}")];
        }
        Vec::new()
    }

    /// Paths, as node ids, whose last segments are all of `segments`.
    fn ending_with(&self, segments: &[&str]) -> Vec<String> {
        let Some(last) = segments.last() else {
            return Vec::new();
        };
        let tail = segments.join("/");
        let mut out = Vec::new();
        for p in self
            .by_last
            .get(*last)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            let (bare, id) = match p.strip_suffix('/') {
                Some(d) => (d.to_string(), format!("dir:{d}")),
                None => (stem(p).to_string(), format!("file:{p}")),
            };
            if bare == tail || bare.ends_with(&format!("/{tail}")) {
                out.push(id);
            }
        }
        out.sort();
        out
    }
}

/// The specifier as written, cleaned: a Rust `use` list cut at its `{`, a
/// glob or query dropped, angle brackets stripped.
fn clean_specifier(s: &str) -> String {
    let mut s = s.trim().trim_matches(['<', '>', ';']).to_string();
    if let Some(i) = s.find('{') {
        s.truncate(i);
    }
    if let Some(i) = s.find('?') {
        s.truncate(i);
    }
    s.trim_end_matches("::*")
        .trim_end_matches("::")
        .trim_end_matches('/')
        .trim()
        .to_string()
}

fn segments(s: &str) -> Vec<&str> {
    s.split(['/', ':', '.']).filter(|p| !p.is_empty()).collect()
}

/// Where each segment ends in the specifier, so a leading part keeps its separators.
fn segment_ends(s: &str) -> Vec<usize> {
    let mut ends = Vec::new();
    let mut in_segment = false;
    for (i, c) in s.char_indices() {
        let sep = matches!(c, '/' | ':' | '.');
        if in_segment && sep {
            ends.push(i);
        }
        in_segment = !sep;
    }
    if in_segment {
        ends.push(s.len());
    }
    ends
}

/// True when `needle` appears in `hay` as a whole word, not inside a longer name.
fn mentions(hay: &str, needle: &str) -> bool {
    let word = |c: char| c.is_alphanumeric() || c == '-' || c == '_' || c == '@';
    hay.match_indices(needle).any(|(i, _)| {
        let before = hay[..i].chars().next_back();
        let after = hay[i + needle.len()..].chars().next();
        !before.is_some_and(word) && !after.is_some_and(|c| word(c) || c == '/')
    })
}

struct Rules<'a> {
    units: &'a [Unit<'a>],
    paths: Paths<'a>,
    /// Files that hold configuration rather than code, by index.
    configs: Vec<usize>,
    /// Candidates by specifier: a package is often imported from many files.
    candidates_of: RefCell<HashMap<String, Vec<String>>>,
}

impl Rules<'_> {
    fn family_extensions(&self, spec: Option<&Spec>) -> Vec<&'static str> {
        let Some(spec) = spec else { return Vec::new() };
        super::languages::table()
            .values()
            .filter(|s| s.family == spec.family)
            .flat_map(|s| s.extensions.iter().map(String::as_str))
            .collect()
    }

    fn import(&self, k: usize, text: &str) -> Outcome {
        let unit = &self.units[k];
        let spec = unit.spec;
        let s = clean_specifier(text);
        if s.is_empty() {
            return Outcome::Outside;
        }
        let ext = self.family_extensions(spec);
        let here = dir_of(unit.path);

        // Relative forms resolve from where they point.
        for r in spec.map(|s| s.relative.as_slice()).unwrap_or_default() {
            let Some(rest) = s.strip_prefix(r.prefix.as_str()) else {
                continue;
            };
            let starts: Vec<String> = match r.from.as_str() {
                "here" => vec![here.to_string()],
                "parent" => vec![parent(here).to_string()],
                "ancestors" => {
                    let mut out = Vec::new();
                    let mut d = here;
                    loop {
                        out.push(d.to_string());
                        if d.is_empty() {
                            break;
                        }
                        d = parent(d);
                    }
                    out
                }
                "dots" => {
                    let dots = s.chars().take_while(|c| *c == '.').count();
                    let mut d = here;
                    for _ in 1..dots {
                        d = parent(d);
                    }
                    vec![d.to_string()]
                }
                _ => continue,
            };
            let rest = if r.from == "dots" {
                s.trim_start_matches('.').replace('.', "/")
            } else {
                rest.replace("::", "/")
            };
            // JavaScript's `./` and `../` chains are paths already.
            let rel = if r.prefix.ends_with('/') {
                s.clone()
            } else {
                rest
            };
            for start in &starts {
                let base = if r.prefix.ends_with('/') {
                    here
                } else {
                    start.as_str()
                };
                let Some(target) = normalize(base, &rel) else {
                    continue;
                };
                let named = rel
                    .split('/')
                    .filter(|p| !matches!(*p, "" | "." | ".."))
                    .count();
                if let Some(o) = self.with_items_dropped(&target, named, &ext) {
                    return o;
                }
            }
            return self.candidates(k, &s);
        }

        // Other forms: at least two segments, and exactly one path ending with them.
        let segs = segments(&s);
        if segs.len() >= 2 {
            for drop in 0..=2usize.min(segs.len() - 2) {
                let found = self.paths.ending_with(&segs[..segs.len() - drop]);
                if found.len() == 1 {
                    return Outcome::Edge(found[0].clone());
                }
                if found.len() > 1 {
                    break;
                }
            }
        }
        self.candidates(k, &s)
    }

    /// A path, then the same with one and two trailing item names dropped,
    /// as `crate::filter::SizeFilter` names `src/filter/`. `named` is how
    /// many segments the specifier itself gave, and at least one of them
    /// always stays, so an import never resolves to where it started.
    fn with_items_dropped(&self, target: &str, named: usize, ext: &[&str]) -> Option<Outcome> {
        let parts: Vec<&str> = target.split('/').collect();
        for drop in 0..=2usize.min(named.saturating_sub(1)) {
            let t = parts[..parts.len() - drop].join("/");
            let named = self.paths.named(&t, ext);
            match named.len() {
                0 => continue,
                1 => return Some(Outcome::Edge(named[0].clone())),
                _ => return Some(Outcome::Pending(named)),
            }
        }
        None
    }

    /// Every target an import might mean, for Jev: first the directories
    /// whose configuration names the specifier's leading segments, then the
    /// paths ending with its trailing segments.
    fn candidates(&self, k: usize, s: &str) -> Outcome {
        let own = self.units[k].id();
        let known = self.candidates_of.borrow().get(s).cloned();
        let all = known.unwrap_or_else(|| {
            let found = self.find_candidates(s);
            self.candidates_of
                .borrow_mut()
                .insert(s.to_string(), found.clone());
            found
        });
        let out: Vec<String> = all.into_iter().filter(|c| *c != own).collect();
        if out.is_empty() {
            Outcome::Outside
        } else {
            Outcome::Pending(out)
        }
    }

    fn find_candidates(&self, s: &str) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let segs = segments(s);
        let ends = segment_ends(s);
        // The longest leading part of the specifier any configuration names.
        'prefix: for n in (1..=segs.len()).rev() {
            let prefix = &s[..ends[n - 1]];
            let mut found = false;
            for &c in &self.configs {
                if !self.units[c].text.is_some_and(|t| mentions(t, prefix)) {
                    continue;
                }
                found = true;
                let dir = dir_of(self.units[c].path);
                let rest = segs[n..].join("/");
                let target = if rest.is_empty() {
                    dir.to_string()
                } else {
                    normalize(dir, &rest).unwrap_or_default()
                };
                let named = self.paths.named(&target, &[]);
                let id = named
                    .into_iter()
                    .next()
                    .unwrap_or_else(|| format!("dir:{dir}"));
                if !out.contains(&id) {
                    out.push(id);
                }
            }
            if found {
                break 'prefix;
            }
        }
        let tail_len = segs.len().min(2);
        for id in self
            .paths
            .ending_with(&segs[segs.len().saturating_sub(tail_len)..])
        {
            if !out.contains(&id) {
                out.push(id);
            }
        }
        out
    }
}

/// Runs the rules over every file.
pub fn run(units: &[Unit], dirs: &BTreeSet<String>) -> Resolved {
    let rules = Rules {
        units,
        paths: Paths::new(units, dirs),
        configs: units
            .iter()
            .enumerate()
            .filter(|(_, u)| u.text.is_some() && u.spec.is_none_or(|s| s.data))
            .map(|(i, _)| i)
            .collect(),
        candidates_of: RefCell::new(HashMap::new()),
    };
    let mut edges: Vec<Edge> = Vec::new();
    let mut pending: Vec<PendingRef> = Vec::new();
    // One edge per site: two calls from one definition to another are two edges.
    let mut seen: HashSet<(String, String, &'static str, u32)> = HashSet::new();
    let mut push =
        |edges: &mut Vec<Edge>, from: String, to: String, kind: &'static str, at: Span| {
            if from != to && seen.insert((from.clone(), to.clone(), kind, at.start)) {
                edges.push(Edge {
                    from,
                    to,
                    kind,
                    by: Filled::by("rule"),
                    at: Some(at),
                });
            }
        };

    // Imports first: the call rule looks in the files each file imports.
    let mut imported: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); units.len()];
    let index: HashMap<&str, usize> = units.iter().enumerate().map(|(i, u)| (u.path, i)).collect();
    let files_of = |id: &str| -> Vec<usize> {
        if let Some(p) = id.strip_prefix("file:") {
            return index.get(p).copied().into_iter().collect();
        }
        let d = id.strip_prefix("dir:").unwrap_or_default();
        units
            .iter()
            .enumerate()
            .filter(|(_, u)| dir_of(u.path) == d)
            .map(|(i, _)| i)
            .collect()
    };
    for (k, u) in units.iter().enumerate() {
        let Some(p) = u.parse else { continue };
        for r in p.refs.iter().filter(|r| r.kind == RefKind::Import) {
            match rules.import(k, &r.text) {
                Outcome::Edge(to) => {
                    imported[k].extend(files_of(&to));
                    push(&mut edges, u.from(r.from), to, "imports", r.at);
                }
                Outcome::Pending(candidates) => pending.push(PendingRef {
                    from: u.from(r.from),
                    kind: "import",
                    text: r.text.clone(),
                    at: r.at,
                    candidates,
                }),
                Outcome::Outside => {}
            }
        }
    }

    // Calls and references: candidates by name, nearest tier first.
    let mut by_name: HashMap<&str, Vec<(usize, usize)>> = HashMap::new();
    for (k, u) in units.iter().enumerate() {
        for (i, d) in u
            .parse
            .map(|p| p.defs.as_slice())
            .unwrap_or_default()
            .iter()
            .enumerate()
        {
            by_name.entry(d.name.as_str()).or_default().push((k, i));
        }
    }
    for (k, u) in units.iter().enumerate() {
        let (Some(p), Some(spec)) = (u.parse, u.spec) else {
            continue;
        };
        for r in p.refs.iter().filter(|r| r.kind != RefKind::Import) {
            // A definition inside a function is local to it: visible only to
            // code inside that function.
            let visible = |kk: usize, i: usize| -> bool {
                let Some(pp) = units[kk].parse else {
                    return false;
                };
                match pp.defs[i].parent.map(|q| &pp.defs[q]) {
                    Some(parent) if parent.callable => {
                        kk == k && parent.span.start <= r.at.start && r.at.end <= parent.span.end
                    }
                    _ => true,
                }
            };
            let all: Vec<(usize, usize)> = by_name
                .get(r.text.as_str())
                .map(|v| {
                    v.iter()
                        .copied()
                        .filter(|(kk, _)| units[*kk].spec.is_some_and(|s| s.family == spec.family))
                        .filter(|(kk, i)| visible(*kk, *i))
                        .filter(|(kk, i)| {
                            !r.macro_call
                                || units[*kk]
                                    .parse
                                    .is_some_and(|pp| pp.defs[*i].role == "macro")
                        })
                        .collect()
                })
                .unwrap_or_default();
            // What the call names before its name decides how sure the rule can be.
            // `self.push` in Batch or `Batch::new` names its owner; `utils.join` its
            // file or package. An unqualified call reaches no other class's
            // method. A receiver the rule cannot place, such as `err.Error()`,
            // leaves the call to Jev with its candidates.
            let caller = r.from.map(|i| &p.defs[i]);
            let caller_owner = caller.and_then(|d| d.owner.as_deref());
            let owner_of =
                |kk: usize, i: usize| units[kk].parse.and_then(|pp| pp.defs[i].owner.as_deref());
            let self_like = |q: &str| {
                matches!(q, "self" | "this" | "Self" | "cls" | "@")
                    || caller.and_then(|d| d.self_name.as_deref()) == Some(q)
            };
            let (pool, certain): (Vec<(usize, usize)>, bool) = match r.qualifier.as_deref() {
                Some(q) if self_like(q) => {
                    let mine: Vec<_> = all
                        .iter()
                        .copied()
                        .filter(|(kk, i)| {
                            caller_owner.is_some() && owner_of(*kk, *i) == caller_owner
                        })
                        .collect();
                    if mine.is_empty() {
                        (all.clone(), false)
                    } else {
                        (mine, true)
                    }
                }
                Some(q) => {
                    let named: Vec<_> = all
                        .iter()
                        .copied()
                        .filter(|(kk, i)| {
                            let path = units[*kk].path;
                            let file = stem(path).rsplit('/').next().unwrap_or("");
                            let dir = dir_of(path).rsplit('/').next().unwrap_or("");
                            owner_of(*kk, *i) == Some(q) || file == q || dir == q
                        })
                        .collect();
                    if named.is_empty() {
                        (all.clone(), false)
                    } else {
                        (named, true)
                    }
                }
                // Java, C#, Kotlin, Swift, C++ and Ruby reach their own class's
                // methods without `self`; Python, JavaScript, Go and Rust don't.
                None => (
                    all.iter()
                        .copied()
                        .filter(|(kk, i)| {
                            owner_of(*kk, *i).is_none()
                                || (spec.implicit_self && owner_of(*kk, *i) == caller_owner)
                        })
                        .collect(),
                    true,
                ),
            };
            let tiers: [&dyn Fn(usize) -> bool; 3] =
                [&|kk| kk == k, &|kk| imported[k].contains(&kk), &|kk| {
                    dir_of(units[kk].path) == dir_of(u.path)
                }];
            let mut chosen: Vec<(usize, usize)> = Vec::new();
            for tier in tiers {
                chosen = pool.iter().copied().filter(|(kk, _)| tier(*kk)).collect();
                if !chosen.is_empty() {
                    break;
                }
            }
            let kind = match r.kind {
                RefKind::Call => "calls",
                RefKind::Reference => "references",
                RefKind::Implements => "implements",
                RefKind::Import => continue,
            };
            match chosen.as_slice() {
                [] => {}
                [(kk, i)] if certain => push(
                    &mut edges,
                    u.from(r.from),
                    units[*kk].def_ids[*i].clone(),
                    kind,
                    r.at,
                ),
                many if r.kind == RefKind::Call => pending.push(PendingRef {
                    from: u.from(r.from),
                    kind: "call",
                    text: r.text.clone(),
                    at: r.at,
                    candidates: many
                        .iter()
                        .map(|(kk, i)| units[*kk].def_ids[*i].clone())
                        .collect(),
                }),
                // A type or trait named in several places waits for its own rule.
                _ => {}
            }
        }
    }

    // Names: a literal that spells out a path in the repository.
    for u in units {
        let Some(p) = u.parse else { continue };
        let here = dir_of(u.path);
        for l in &p.literals {
            let t = l.text.trim_start_matches("./").trim_end_matches('/');
            if t.is_empty() || t.chars().all(|c| c == '.' || c == '/') || t.contains("://") {
                continue;
            }
            let targets = [normalize(here, t), normalize("", t.trim_start_matches('/'))];
            for target in targets.into_iter().flatten() {
                let id = if rules.paths.files.contains(target.as_str()) {
                    format!("file:{target}")
                } else if rules.paths.dirs.contains(&target) && !target.is_empty() {
                    format!("dir:{target}")
                } else {
                    continue;
                };
                if id != u.id() {
                    push(&mut edges, u.from(l.from), id, "names", l.at);
                }
                break;
            }
        }
    }
    Resolved { edges, pending }
}
