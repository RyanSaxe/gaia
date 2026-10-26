//! The rules: an import or call becomes an edge when exactly one target
//! fits, and anything with several possible targets goes pending,
//! with every candidate, for Jev. Anything with none is outside the
//! repository and gets neither, as does an import of a module its language
//! provides or a package the project installs. The rules read paths, the
//! language table, the manifests' installs and the parse; no file name means
//! anything to them.

use super::languages::Spec;
use super::model::{Edge, Filled, PendingRef, Span};
use super::parse::{Aliased, FileParse, RefKind};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

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

/// A workspace package, as its manifest declares it: an import that spells
/// its name, or a subpath through its exports, means a file in it.
pub struct Package<'a> {
    pub name: &'a str,
    pub root: &'a str,
    pub entry: Option<&'a str>,
    /// Subpath (`.`, `./sub`) to the file it exports there.
    pub exports: &'a std::collections::BTreeMap<String, String>,
}

pub struct Resolved {
    pub edges: Vec<Edge>,
    pub pending: Vec<PendingRef>,
}

/// What an alias stands for: `name` in `files`, the files its import names.
/// With no name it is the module itself, and with no files its import leads
/// outside the repository, where the alias reaches nothing.
struct Bound<'a> {
    name: Option<&'a str>,
    files: Vec<usize>,
}

/// What a file passes on to the files that import it from the files it
/// imports: each name it re-exports, with what the name stands for there,
/// and the files whose every export it re-exports.
#[derive(Default)]
struct Passes<'a> {
    named: HashMap<&'a str, Vec<Bound<'a>>>,
    every: Vec<usize>,
}

/// How many re-exports deep the call rule follows a name.
const HOPS: usize = 4;

/// Where a name leads from the files `from`, through what they pass on.
struct Followed<'a> {
    /// Each file, with the name it knows it by, that defines it a re-export or more away.
    defined: Vec<(usize, &'a str)>,
    /// The files the name stands for as a whole module, as `ns` does in `export * as ns from './x'`.
    modules: Vec<usize>,
}

/// Follows `name` from the files `from` through what each passes on, stopping
/// at a file that defines it, after `HOPS` re-exports, and at a file and name
/// already seen, so a cycle ends.
fn follow<'a>(
    passes: &[Passes<'a>],
    defines: &HashSet<(usize, &str)>,
    from: impl Iterator<Item = usize>,
    name: &'a str,
) -> Followed<'a> {
    let mut out = Followed {
        defined: Vec::new(),
        modules: Vec::new(),
    };
    let mut seen: HashSet<(usize, &str)> = HashSet::new();
    let mut at: Vec<(usize, &str)> = from.map(|f| (f, name)).collect();
    for hop in 0..=HOPS {
        let mut next = Vec::new();
        for (f, n) in at {
            if !seen.insert((f, n)) {
                continue;
            }
            if defines.contains(&(f, n)) {
                if hop > 0 {
                    out.defined.push((f, n));
                }
                continue;
            }
            for b in passes[f].named.get(n).into_iter().flatten() {
                match b.name {
                    Some(m) => next.extend(b.files.iter().map(|&g| (g, m))),
                    None => out.modules.extend(&b.files),
                }
            }
            next.extend(passes[f].every.iter().map(|&g| (g, n)));
        }
        at = next;
    }
    out.modules.sort_unstable();
    out.modules.dedup();
    out
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

    /// True when a node id is a file with one of `extensions`, or a
    /// directory holding one somewhere below. No extensions admit anything.
    fn of_family(&self, id: &str, extensions: &[&str]) -> bool {
        if extensions.is_empty() {
            return true;
        }
        match id.strip_prefix("dir:") {
            Some(d) => extensions
                .iter()
                .any(|e| self.holding.get(*e).is_some_and(|h| h.contains(d))),
            None => extensions.iter().any(|e| id.ends_with(&format!(".{e}"))),
        }
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

/// The specifier as written, cleaned: a Rust `use` list cut at its `{` and a
/// `use … as b` at its `as`, a glob or query dropped, angle brackets stripped.
fn clean_specifier(s: &str) -> String {
    let mut s = s.trim().trim_matches(['<', '>', ';']).to_string();
    if let Some(i) = s.find('{') {
        s.truncate(i);
    }
    if let Some(i) = s.find(" as ") {
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

/// The leading parts of an import's specifier, longest first: the names a
/// configuration may give the package it comes from.
pub(crate) fn leading_names(text: &str) -> Vec<String> {
    let s = clean_specifier(text);
    segment_ends(&s)
        .iter()
        .rev()
        .map(|&e| s[..e].to_string())
        .collect()
}

/// True when `needle` appears in `hay` as a whole word, not inside a longer name.
pub(crate) fn mentions(hay: &str, needle: &str) -> bool {
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
    packages: &'a [Package<'a>],
    /// The packages the project's manifests install, by family (`entities::installed`).
    installed: &'a BTreeMap<String, BTreeSet<String>>,
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

    /// `in_module` says the import sits inside a module definition.
    fn import(&self, k: usize, text: &str, in_module: bool) -> Outcome {
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
            // A prefix on its own, as Rust's `use super::*` cleans to `super`.
            let bare = r.prefix.trim_end_matches([':', '/']);
            let rest = match s.strip_prefix(r.prefix.as_str()) {
                Some(rest) => rest,
                None if !bare.is_empty() && bare != r.prefix && s == bare => "",
                None => continue,
            };
            if in_module && r.in_module.as_deref() == Some("file") {
                // One step up from a module inside the file is the file; any
                // further step resolves as it would at the file's top level.
                if rest == bare || rest.starts_with(r.prefix.as_str()) {
                    return self.import(k, rest, false);
                }
                return Outcome::Edge(unit.id());
            }
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

        // A workspace package by its manifest's name, and a subpath through its exports.
        if spec.is_some_and(|sp| sp.family == "js")
            && let Some(o) = self.package(&s, &ext)
        {
            return o;
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
        if self.provided(spec, &s, &ext) {
            return Outcome::Outside;
        }
        self.candidates(k, &s)
    }

    /// True when an import names a module its language provides or a
    /// package the project installs, or a module inside one, which no folder
    /// of the project ever is. A name followed by one of the family's
    /// extensions is a file named like it: C++'s `vector` is not `vector.h`.
    fn provided(&self, spec: Option<&Spec>, s: &str, ext: &[&str]) -> bool {
        let Some(spec) = spec else { return false };
        let names = |name: &str| {
            s.strip_prefix(name).is_some_and(|rest| {
                rest.is_empty()
                    || rest.starts_with(['/', ':'])
                    || rest
                        .strip_prefix('.')
                        .is_some_and(|after| !ext.contains(&after))
            })
        };
        super::languages::table()
            .values()
            .filter(|l| l.family == spec.family)
            .flat_map(|l| &l.builtins)
            .chain(self.installed.get(&spec.family).into_iter().flatten())
            .any(|name| names(name))
    }

    /// The file an import naming a workspace package means: the target its
    /// exports give the subpath, else its entry for the package itself, else
    /// the subpath under its root. None when no package has the name.
    fn package(&self, s: &str, ext: &[&str]) -> Option<Outcome> {
        let pkg = self
            .packages
            .iter()
            .filter(|p| s == p.name || s.starts_with(&format!("{}/", p.name)))
            .max_by_key(|p| p.name.len())?;
        let sub = s[pkg.name.len()..].trim_start_matches('/');
        let key = if sub.is_empty() { ".".to_string() } else { format!("./{sub}") };
        let target = match (pkg.exports.get(&key), sub.is_empty()) {
            (Some(t), _) => t.clone(),
            (None, true) => pkg.entry?.to_string(),
            (None, false) => {
                if pkg.root.is_empty() {
                    sub.to_string()
                } else {
                    format!("{}/{sub}", pkg.root)
                }
            }
        };
        let stripped = target.strip_suffix(".js").unwrap_or(&target);
        match self.paths.named(&target, ext).as_slice() {
            [one] => Some(Outcome::Edge(one.clone())),
            [] => match self.paths.named(stripped, ext).as_slice() {
                [one] => Some(Outcome::Edge(one.clone())),
                _ => None,
            },
            _ => None,
        }
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
        let spec = self.units[k].spec;
        let key = format!("{}|{s}", spec.map_or("", |sp| sp.family.as_str()));
        let known = self.candidates_of.borrow().get(&key).cloned();
        let all = known.unwrap_or_else(|| {
            let found = self.find_candidates(s, &self.family_extensions(spec));
            self.candidates_of.borrow_mut().insert(key, found.clone());
            found
        });
        let out: Vec<String> = all.into_iter().filter(|c| *c != own).collect();
        if out.is_empty() {
            Outcome::Outside
        } else {
            Outcome::Pending(out)
        }
    }

    fn find_candidates(&self, s: &str, ext: &[&str]) -> Vec<String> {
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
                if named.is_empty() && !rest.is_empty() {
                    // A sub-path of a package or alias the configuration names,
                    // such as `zustand/vanilla` or `@/utils`, may name a file of
                    // its family below it by its last segment. A file wins over
                    // a directory of the same name beside it, as in `named`.
                    let below = |id: &String| {
                        let p = id.trim_start_matches("file:").trim_start_matches("dir:");
                        dir.is_empty() || p.starts_with(&format!("{dir}/"))
                    };
                    let found: Vec<String> = self
                        .paths
                        .ending_with(&segs[segs.len() - 1..])
                        .into_iter()
                        .filter(|id| below(id) && self.paths.of_family(id, ext))
                        .collect();
                    let shadowed = |id: &String| {
                        id.strip_prefix("dir:").is_some_and(|d| {
                            found
                                .iter()
                                .any(|f| f.starts_with("file:") && stem(&f[5..]) == d)
                        })
                    };
                    for id in found.iter().filter(|id| !shadowed(id)) {
                        if !out.contains(id) {
                            out.push(id.clone());
                        }
                    }
                }
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

/// What an alias stands for, given the files its import names. A default
/// import binds the default of the one file that exports one; with none, or
/// several, the alias keeps its own name.
fn binding<'a>(units: &[Unit<'a>], of: &'a Aliased, files: Vec<usize>) -> Option<Bound<'a>> {
    Some(match of {
        Aliased::Item(name) => Bound {
            name: Some(name),
            files,
        },
        Aliased::Module => Bound { name: None, files },
        Aliased::Default if files.is_empty() => Bound { name: None, files },
        Aliased::Default => {
            let defaults: Vec<(usize, &str)> = files
                .iter()
                .filter_map(|&f| Some((f, units[f].parse?.default_export.as_deref()?)))
                .collect();
            let [(file, name)] = defaults.as_slice() else {
                return None;
            };
            Bound {
                name: Some(name),
                files: vec![*file],
            }
        }
    })
}

/// Runs the rules over every file.
pub fn run(
    units: &[Unit],
    dirs: &BTreeSet<String>,
    packages: &[Package],
    installed: &BTreeMap<String, BTreeSet<String>>,
) -> Resolved {
    let rules = Rules {
        units,
        paths: Paths::new(units, dirs),
        packages,
        installed,
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

    // Imports first: the call rule looks in the files each file imports, and
    // through the names each binds, with the definition each import sits in.
    let mut imported: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); units.len()];
    type Bindings<'a> = HashMap<&'a str, Vec<(Option<usize>, Bound<'a>)>>;
    let mut bound: Vec<Bindings> = units.iter().map(|_| HashMap::new()).collect();
    let mut passes: Vec<Passes> = units.iter().map(|_| Passes::default()).collect();
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
        let in_module = |def: Option<usize>| {
            std::iter::successors(def, |&i| p.defs[i].parent).any(|i| p.defs[i].role == "module")
        };
        for r in p.refs.iter().filter(|r| r.kind == RefKind::Import) {
            let outcome = rules.import(k, &r.text, in_module(r.from));
            // An alias whose import Jev must place keeps its own name.
            let files = match &outcome {
                Outcome::Edge(to) => Some(files_of(to)),
                Outcome::Outside => Some(Vec::new()),
                Outcome::Pending(_) => None,
            };
            if let Some(files) = files {
                for a in &r.aliases {
                    if let Some(b) = binding(units, &a.of, files.clone()) {
                        bound[k]
                            .entry(a.name.as_str())
                            .or_default()
                            .push((r.from, b));
                    }
                }
                for a in &r.passes {
                    if let Some(b) = binding(units, &a.of, files.clone()) {
                        passes[k].named.entry(a.name.as_str()).or_default().push(b);
                    }
                }
                if r.passes_all {
                    passes[k].every.extend(&files);
                }
            }
            match outcome {
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
    // What a file passes on of its own: a definition at its top level that,
    // where its language marks them, it exports. A re-export stops there.
    let own = |k: usize, i: usize| {
        let (Some(p), Some(spec)) = (units[k].parse, units[k].spec) else {
            return false;
        };
        let d = &p.defs[i];
        d.parent.is_none() && d.owner.is_none() && (d.exported || !spec.marks_exports)
    };
    let defines: HashSet<(usize, &str)> = by_name
        .iter()
        .flat_map(|(name, at)| {
            at.iter()
                .filter(|(k, i)| own(*k, *i))
                .map(move |(k, _)| (*k, *name))
        })
        .collect();
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
            let caller = r.from.map(|i| &p.defs[i]);
            let self_like = |q: &str| {
                matches!(q, "self" | "this" | "Self" | "cls" | "@")
                    || caller.and_then(|d| d.self_name.as_deref()) == Some(q)
            };
            // A name an import binds stands for what it binds, in the files the
            // import names: `buildV1()` calls `buildSite` there, and `ns.walk()`
            // calls `walk` in `ns`'s module. An import inside a definition binds
            // only there, as Python's `from m import a as f` inside a function does.
            let alias = |name: &str| {
                let made = bound[k].get(name)?;
                std::iter::successors(r.from, |&i| p.defs[i].parent)
                    .map(Some)
                    .chain([None])
                    .find_map(|scope| made.iter().find(|(s, _)| *s == scope).map(|(_, b)| b))
            };
            let (name, qualifier, within) = match r.qualifier.as_deref() {
                None => match alias(&r.text) {
                    Some(b) => (b.name.unwrap_or(&r.text), None, Some(&b.files)),
                    None => (r.text.as_str(), None, None),
                },
                Some(q) => match alias(q).filter(|_| !self_like(q)) {
                    Some(b) => (r.text.as_str(), b.name, Some(&b.files)),
                    None => (r.text.as_str(), Some(q), None),
                },
            };
            // A file the call looks in may pass a name on from another, as a
            // package's index does: `ns.walk()` looks in the module an
            // `export * as ns from './x'` names, and `walk()` reaches the walk
            // an `export { walk } from './x'` names.
            fn looked<'s>(
                within: Option<&'s Vec<usize>>,
                imported: &'s BTreeSet<usize>,
            ) -> Box<dyn Iterator<Item = usize> + 's> {
                match within {
                    Some(w) => Box::new(w.iter().copied()),
                    None => Box::new(imported.iter().copied()),
                }
            }
            let modules = qualifier
                .filter(|q| !self_like(q))
                .map(|q| follow(&passes, &defines, looked(within, &imported[k]), q).modules)
                .filter(|m| !m.is_empty());
            let (qualifier, within) = match &modules {
                Some(m) => (None, Some(m)),
                None => (qualifier, within),
            };
            let passed: Vec<(usize, usize)> = if qualifier.is_none() {
                follow(&passes, &defines, looked(within, &imported[k]), name)
                    .defined
                    .into_iter()
                    .flat_map(|(f, n)| {
                        let defs = by_name.get(n).map(Vec::as_slice).unwrap_or_default();
                        defs.iter().copied().filter(move |&(kk, i)| kk == f && own(kk, i))
                    })
                    .collect()
            } else {
                Vec::new()
            };
            let mut all: Vec<(usize, usize)> = by_name
                .get(name)
                .map(|v| {
                    v.iter()
                        .copied()
                        .filter(|(kk, _)| within.is_none_or(|w| w.contains(kk)))
                        .collect()
                })
                .unwrap_or_default();
            for d in &passed {
                if !all.contains(d) {
                    all.push(*d);
                }
            }
            all.retain(|(kk, i)| {
                units[*kk].spec.is_some_and(|s| s.family == spec.family)
                    && visible(*kk, *i)
                    && (!r.macro_call
                        || units[*kk]
                            .parse
                            .is_some_and(|pp| pp.defs[*i].role == "macro"))
            });
            // What the call names before its name decides how sure the rule can be.
            // `self.push` in Batch or `Batch::new` names its owner; `utils.join` its
            // file or package. An unqualified call reaches no other class's
            // method. A receiver the rule cannot place, such as `err.Error()`,
            // leaves the call to Jev with its candidates.
            let caller_owner = caller.and_then(|d| d.owner.as_deref());
            let owner_of =
                |kk: usize, i: usize| units[kk].parse.and_then(|pp| pp.defs[i].owner.as_deref());
            let (pool, certain): (Vec<(usize, usize)>, bool) = match qualifier {
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
                    match (named.is_empty(), r.path) {
                        (false, _) => (named, true),
                        // A path that names none of them, as `Vec::new` names
                        // no `new` here, leads outside.
                        (true, true) => (Vec::new(), false),
                        // A value the rule cannot place reaches a method, or,
                        // where functions are values, any of them.
                        (true, false) => (
                            all.iter()
                                .copied()
                                .filter(|(kk, i)| {
                                    spec.functions_as_values || owner_of(*kk, *i).is_some()
                                })
                                .collect(),
                            false,
                        ),
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
            // What a re-export passes on comes after what the imports name
            // themselves, and before a neighbour that merely shares the name.
            let tiers: [&dyn Fn(usize, usize) -> bool; 4] = [
                &|kk, _| kk == k,
                &|kk, _| imported[k].contains(&kk) || within.is_some_and(|w| w.contains(&kk)),
                &|kk, i| passed.contains(&(kk, i)),
                &|kk, _| dir_of(units[kk].path) == dir_of(u.path),
            ];
            let mut chosen: Vec<(usize, usize)> = Vec::new();
            for tier in tiers {
                chosen = pool.iter().copied().filter(|(kk, i)| tier(*kk, *i)).collect();
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

    Resolved { edges, pending }
}
