//! `project.open`: walks a project (respecting .gitignore), reads every
//! file's facts, finds its entities, links imports both ways, works out
//! which tests reach which files, and reads its history from git. The shapes
//! are `FileFacts`, `EntityFacts` and `RepositoryFacts` in
//! `packages/schema/src/facts.ts`.
//!
//! Entities: a package (package.json), a crate (Cargo.toml with a
//! `[package]`), a module (a directory with an index file that is not some
//! package's entry), and an app or service (a directory with a main or
//! server file that is not some package's entry). Entities nest; each file
//! belongs to its innermost one.

use crate::git;
use crate::source::{self, Complexity, Symbol};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileTests {
    pub covered_by: Vec<String>,
    pub failing: Vec<String>,
}

#[derive(Serialize, Debug, Default, Clone, Copy)]
pub struct Diagnostics {
    pub errors: u32,
    pub warnings: u32,
    pub lint: u32,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileGit {
    pub days_since_first_commit: u32,
    pub commits_last14_days: u32,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileFacts {
    pub path: String,
    pub language: &'static str,
    pub kind: &'static str,
    pub content_hash: String,
    pub lines: u32,
    pub symbols: Vec<Symbol>,
    pub imports: Vec<String>,
    pub imported_by: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    pub tests: FileTests,
    pub complexity: Complexity,
    pub diagnostics: Diagnostics,
    pub debt_markers: u32,
    pub unused: bool,
    pub git: FileGit,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EntityTests {
    pub files: u32,
    pub failing: u32,
    pub covered: f64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EntityGit {
    pub days_since_first_commit: u32,
    pub commits_last14_days: u32,
    pub contributors: u32,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EntityFacts {
    pub path: String,
    pub name: String,
    pub form: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    pub files: u32,
    pub lines: u32,
    pub languages: Vec<String>,
    pub exports: u32,
    pub depends_on: Vec<String>,
    pub dependents: Vec<String>,
    pub tests: EntityTests,
    pub diagnostics: Diagnostics,
    pub debt_markers: u32,
    pub unused_exports: f64,
    pub git: EntityGit,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryFacts {
    pub name: String,
    pub files: u32,
    pub lines: u32,
    pub languages: BTreeMap<String, u32>,
    pub age_days: u32,
    pub commits_last30_days: u32,
    pub contributors: u32,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub project_id: String,
    pub files: Vec<FileFacts>,
    pub entities: Vec<EntityFacts>,
    pub repository: RepositoryFacts,
}

/// A file as read from disk, before files are linked together.
struct Read {
    path: String,
    hash: String,
    source: source::Source,
    text: Option<String>,
}

/// An entity found from a manifest or a directory's files, before its facts are summed.
struct Found {
    path: String,
    name: String,
    form: &'static str,
    manifest: Option<String>,
    entry: Option<String>,
    doc: Option<String>,
    /// For a package: subpath → target file, from package.json's `exports`.
    exports_map: BTreeMap<String, String>,
    /// Names (packages) or paths (crates) of the entities its manifest depends on.
    manifest_deps: Vec<String>,
}

const DAY: i64 = 86_400;
const SOURCE_LANGUAGES: [&str; 5] = ["typescript", "javascript", "rust", "python", "go"];

/// FNV-1a over the file's bytes: a content identity, not a security hash.
fn content_hash(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

fn dir_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

/// Joins a relative specifier onto a directory, resolving `.` and `..`.
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

/// True when `path` lies in the directory `root` ("" is the project's root).
fn within(path: &str, root: &str) -> bool {
    root.is_empty() || path == root || path.starts_with(&format!("{root}/"))
}

fn walk(root: &Path) -> Vec<Read> {
    let mut out = Vec::new();
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_global(false)
        .require_git(false)
        .filter_entry(|e| e.file_name() != ".git")
        .build();
    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
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
        let text = if binary {
            None
        } else {
            Some(String::from_utf8_lossy(&bytes).into_owned())
        };
        let source = match &text {
            Some(t) => source::read(&path, t),
            None => source::Source {
                language: source::language_of(&path),
                kind: "data",
                ..Default::default()
            },
        };
        out.push(Read {
            path,
            hash: content_hash(&bytes),
            source,
            text,
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// A value from a TOML section, read line by line: enough for a Cargo.toml's name and description.
fn toml_string(text: &str, section: &str, key: &str) -> Option<String> {
    let mut inside = false;
    for line in text.lines() {
        let l = line.trim();
        if l.starts_with('[') {
            inside = l == format!("[{section}]");
            continue;
        }
        if !inside {
            continue;
        }
        if let Some((k, v)) = l.split_once('=')
            && k.trim() == key
        {
            return Some(v.trim().trim_matches('"').to_string());
        }
    }
    None
}

/// A Cargo.toml's path dependencies, as directories relative to it.
fn cargo_path_deps(text: &str) -> Vec<String> {
    let mut inside = false;
    let mut out = Vec::new();
    for line in text.lines() {
        let l = line.trim();
        if l.starts_with('[') {
            inside = l.ends_with("dependencies]");
            continue;
        }
        if inside && let Some(at) = l.find("path") {
            let rest = &l[at + 4..];
            if let Some(v) = rest.split('"').nth(1) {
                out.push(v.to_string());
            }
        }
    }
    out
}

fn manifests(files: &[Read]) -> Vec<Found> {
    let paths: BTreeSet<&str> = files.iter().map(|f| f.path.as_str()).collect();
    let mut out = Vec::new();
    for f in files {
        let name = f.path.rsplit('/').next().unwrap_or("");
        let dir = dir_of(&f.path).to_string();
        let Some(text) = &f.text else { continue };
        if name == "package.json" {
            let Ok(json) = serde_json::from_str::<Value>(text) else {
                continue;
            };
            let mut exports_map = BTreeMap::new();
            let target = |v: &Value| -> Option<String> {
                match v {
                    Value::String(s) => Some(s.clone()),
                    Value::Object(o) => ["import", "default", "types"]
                        .iter()
                        .find_map(|k| o.get(*k).and_then(Value::as_str))
                        .map(String::from),
                    _ => None,
                }
            };
            match json.get("exports") {
                Some(Value::Object(map)) if map.keys().all(|k| k.starts_with('.')) => {
                    for (k, v) in map {
                        if let Some(t) = target(v).and_then(|t| normalize(&dir, &t)) {
                            exports_map.insert(k.clone(), t);
                        }
                    }
                }
                Some(v) => {
                    if let Some(t) = target(v).and_then(|t| normalize(&dir, &t)) {
                        exports_map.insert(".".into(), t);
                    }
                }
                None => {}
            }
            let entry = exports_map
                .get(".")
                .cloned()
                .or_else(|| {
                    json.get("main")
                        .and_then(Value::as_str)
                        .and_then(|m| normalize(&dir, m))
                })
                .filter(|e| paths.contains(e.as_str()))
                .or_else(|| {
                    [
                        "src/index.ts",
                        "src/index.tsx",
                        "index.ts",
                        "src/index.js",
                        "index.js",
                        "src/main.ts",
                        "src/main.tsx",
                        "main.ts",
                    ]
                    .iter()
                    .map(|c| join(&dir, c))
                    .find(|c| paths.contains(c.as_str()))
                });
            let mut deps = Vec::new();
            for field in [
                "dependencies",
                "devDependencies",
                "peerDependencies",
                "optionalDependencies",
            ] {
                if let Some(Value::Object(m)) = json.get(field) {
                    deps.extend(m.keys().cloned());
                }
            }
            out.push(Found {
                name: json
                    .get("name")
                    .and_then(Value::as_str)
                    .map(String::from)
                    .unwrap_or_else(|| dir.rsplit('/').next().unwrap_or("").to_string()),
                doc: json
                    .get("description")
                    .and_then(Value::as_str)
                    .map(String::from),
                path: dir,
                form: "package",
                manifest: Some(f.path.clone()),
                entry,
                exports_map,
                manifest_deps: deps,
            });
        } else if name == "Cargo.toml" && text.lines().any(|l| l.trim() == "[package]") {
            let entry = ["src/lib.rs", "src/main.rs"]
                .iter()
                .map(|c| join(&dir, c))
                .find(|c| paths.contains(c.as_str()));
            let deps = cargo_path_deps(text)
                .iter()
                .filter_map(|p| normalize(&dir, p))
                .collect();
            out.push(Found {
                name: toml_string(text, "package", "name")
                    .unwrap_or_else(|| dir.rsplit('/').next().unwrap_or("").to_string()),
                doc: toml_string(text, "package", "description"),
                path: dir,
                form: "crate",
                manifest: Some(f.path.clone()),
                entry,
                exports_map: BTreeMap::new(),
                manifest_deps: deps,
            });
        }
    }
    out
}

const INDEX_FILES: [&str; 6] = [
    "index.ts",
    "index.tsx",
    "index.js",
    "mod.rs",
    "__init__.py",
    "index.mjs",
];
const MAIN_FILES: [(&str, &str); 6] = [
    ("main.ts", "app"),
    ("main.tsx", "app"),
    ("main.rs", "app"),
    ("main.py", "app"),
    ("server.ts", "service"),
    ("server.js", "service"),
];

/// Modules, apps and services: directories whose index, main or server file is no package's entry.
fn directory_entities(files: &[Read], found: &[Found]) -> Vec<Found> {
    let roots: BTreeSet<&str> = found.iter().map(|e| e.path.as_str()).collect();
    let entries: BTreeSet<&str> = found.iter().filter_map(|e| e.entry.as_deref()).collect();
    let mut out: BTreeMap<String, Found> = BTreeMap::new();
    for f in files {
        let name = f.path.rsplit('/').next().unwrap_or("");
        let dir = dir_of(&f.path);
        if dir.is_empty()
            || roots.contains(dir)
            || entries.contains(f.path.as_str())
            || f.source.kind == "test"
        {
            continue;
        }
        let form = if INDEX_FILES.contains(&name) {
            "module"
        } else if let Some((_, form)) = MAIN_FILES.iter().find(|(n, _)| *n == name) {
            form
        } else {
            continue;
        };
        // A module's index wins over a main file in the same directory.
        if out.get(dir).is_some_and(|e| e.form == "module") {
            continue;
        }
        out.insert(
            dir.to_string(),
            Found {
                path: dir.to_string(),
                name: dir.rsplit('/').next().unwrap_or(dir).to_string(),
                form,
                manifest: None,
                entry: Some(f.path.clone()),
                doc: f.source.doc.clone(),
                exports_map: BTreeMap::new(),
                manifest_deps: Vec::new(),
            },
        );
    }
    out.into_values().collect()
}

/// Resolves one import specifier written in `from` to a project file.
fn resolve(
    spec: &str,
    from: &str,
    rust: bool,
    paths: &BTreeSet<&str>,
    packages: &[&Found],
) -> Option<String> {
    let dir = dir_of(from);
    if rust {
        let name = from.rsplit('/').next().unwrap_or("");
        let base = if ["main.rs", "lib.rs", "mod.rs"].contains(&name) {
            dir.to_string()
        } else {
            join(dir, name.trim_end_matches(".rs"))
        };
        return [format!("{spec}.rs"), format!("{spec}/mod.rs")]
            .iter()
            .map(|c| join(&base, c))
            .find(|c| paths.contains(c.as_str()));
    }
    let candidates = |base: String| -> Option<String> {
        let mut options = vec![base.clone()];
        if let Some(stem) = base.strip_suffix(".js") {
            options.push(format!("{stem}.ts"));
            options.push(format!("{stem}.tsx"));
        }
        for ext in [
            ".ts",
            ".tsx",
            ".js",
            ".mjs",
            "/index.ts",
            "/index.tsx",
            "/index.js",
        ] {
            options.push(format!("{base}{ext}"));
        }
        options.into_iter().find(|c| paths.contains(c.as_str()))
    };
    if spec.starts_with("./") || spec.starts_with("../") {
        return candidates(normalize(dir, spec)?);
    }
    // A workspace package by name, and a subpath through its exports.
    let pkg = packages
        .iter()
        .filter(|p| spec == p.name || spec.starts_with(&format!("{}/", p.name)))
        .max_by_key(|p| p.name.len())?;
    let sub = spec[pkg.name.len()..].trim_start_matches('/');
    let key = if sub.is_empty() {
        ".".to_string()
    } else {
        format!("./{sub}")
    };
    if let Some(target) = pkg.exports_map.get(&key) {
        return candidates(target.clone());
    }
    if sub.is_empty() {
        pkg.entry.clone()
    } else {
        candidates(join(&pkg.path, sub))
    }
}

/// The innermost entity a path lies in, by index into `entities` (sorted so that deeper roots come later).
fn innermost(path: &str, entities: &[Found]) -> Option<usize> {
    entities
        .iter()
        .enumerate()
        .filter(|(_, e)| within(path, &e.path))
        .max_by_key(|(_, e)| {
            if e.path.is_empty() {
                0
            } else {
                e.path.len() + 1
            }
        })
        .map(|(i, _)| i)
}

pub fn open(root: &Path) -> Result<Opened, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a directory.", root.display()));
    }
    let read = walk(root);
    let paths: BTreeSet<&str> = read.iter().map(|f| f.path.as_str()).collect();

    // Entities.
    let mut entities = manifests(&read);
    entities.extend(directory_entities(&read, &entities));
    entities.sort_by(|a, b| a.path.cmp(&b.path));
    let packages: Vec<&Found> = entities.iter().filter(|e| e.form == "package").collect();
    let owner: Vec<Option<usize>> = read.iter().map(|f| innermost(&f.path, &entities)).collect();
    let index: HashMap<&str, usize> = read
        .iter()
        .enumerate()
        .map(|(i, f)| (f.path.as_str(), i))
        .collect();

    // Imports, both ways.
    let mut imports: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); read.len()];
    let mut reexports: Vec<Vec<usize>> = vec![Vec::new(); read.len()];
    for (i, f) in read.iter().enumerate() {
        let rust = f.source.language == "rust";
        for spec in &f.source.specifiers {
            if let Some(j) = resolve(spec, &f.path, rust, &paths, &packages)
                .and_then(|p| index.get(p.as_str()).copied())
                && j != i
            {
                imports[i].insert(j);
            }
        }
        for spec in &f.source.reexports {
            if let Some(j) = resolve(spec, &f.path, false, &paths, &packages)
                .and_then(|p| index.get(p.as_str()).copied())
            {
                reexports[i].push(j);
            }
        }
    }
    // A crate's integration tests run its entry.
    for (i, f) in read.iter().enumerate() {
        if f.source.kind != "test" || f.source.language != "rust" {
            continue;
        }
        if let Some(entry) = owner[i]
            .and_then(|e| entities[e].entry.as_deref())
            .and_then(|p| index.get(p).copied())
        {
            imports[i].insert(entry);
        }
    }
    let mut imported_by: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); read.len()];
    for (i, set) in imports.iter().enumerate() {
        for &j in set {
            imported_by[j].insert(i);
        }
    }

    // Tests: every file a test reaches through imports, directly or through others.
    let mut covered_by: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); read.len()];
    for (t, f) in read.iter().enumerate() {
        if f.source.inline_tests {
            covered_by[t].insert(t);
        }
        if f.source.kind != "test" {
            continue;
        }
        let mut stack: Vec<usize> = imports[t].iter().copied().collect();
        let mut seen = BTreeSet::new();
        while let Some(k) = stack.pop() {
            if !seen.insert(k) {
                continue;
            }
            covered_by[k].insert(t);
            stack.extend(imports[k].iter().copied());
        }
    }

    // History.
    let commits = git::history(root);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    let history = git::by_file(&commits);
    let days = |t: Option<i64>| t.map_or(0, |t| ((now - t).max(0) / DAY) as u32);

    let entries: BTreeSet<&str> = entities.iter().filter_map(|e| e.entry.as_deref()).collect();
    let is_source =
        |f: &Read| f.source.kind == "source" && SOURCE_LANGUAGES.contains(&f.source.language);
    let unused: Vec<bool> = read
        .iter()
        .enumerate()
        .map(|(i, f)| {
            is_source(f)
                && !f.source.symbols.is_empty()
                && imported_by[i].is_empty()
                && !entries.contains(f.path.as_str())
        })
        .collect();
    let name_of = |i: usize| read[i].path.clone();
    let files: Vec<FileFacts> = read
        .iter()
        .enumerate()
        .map(|(i, f)| {
            let h = history.get(&f.path);
            FileFacts {
                path: f.path.clone(),
                language: f.source.language,
                kind: f.source.kind,
                content_hash: f.hash.clone(),
                lines: f.source.lines,
                symbols: f.source.symbols.clone(),
                imports: imports[i].iter().map(|&j| name_of(j)).collect(),
                imported_by: imported_by[i].iter().map(|&j| name_of(j)).collect(),
                doc: f.source.doc.clone(),
                tests: FileTests {
                    covered_by: covered_by[i].iter().map(|&j| name_of(j)).collect(),
                    failing: Vec::new(),
                },
                complexity: f.source.complexity,
                diagnostics: Diagnostics::default(),
                debt_markers: f.source.debt_markers,
                unused: unused[i],
                git: FileGit {
                    days_since_first_commit: days(h.and_then(|h| h.first)),
                    commits_last14_days: h.map_or(0, |h| {
                        h.commits.iter().filter(|t| now - **t <= 14 * DAY).count() as u32
                    }),
                },
            }
        })
        .collect();

    // Each entity's facts, summed over the files it holds.
    let mut depends: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); entities.len()];
    for (e, found) in entities.iter().enumerate() {
        for dep in &found.manifest_deps {
            if let Some(d) = entities.iter().position(|o| {
                (o.form == "package" && &o.name == dep) || (o.form == "crate" && &o.path == dep)
            }) && d != e
            {
                depends[e].insert(d);
            }
        }
    }
    for (i, set) in imports.iter().enumerate() {
        let Some(from) = owner[i] else { continue };
        for &j in set {
            if let Some(to) = owner[j].filter(|to| *to != from) {
                depends[from].insert(to);
            }
        }
    }
    let mut dependents: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); entities.len()];
    for (e, set) in depends.iter().enumerate() {
        for &d in set {
            dependents[d].insert(e);
        }
    }
    let commit_entities: Vec<BTreeSet<usize>> = commits
        .iter()
        .map(|c| {
            c.files
                .iter()
                .filter_map(|p| index.get(p.as_str()).and_then(|&i| owner[i]))
                .collect()
        })
        .collect();

    let out_entities: Vec<EntityFacts> = entities
        .iter()
        .enumerate()
        .map(|(e, found)| {
            let mine: Vec<usize> = (0..read.len()).filter(|&i| owner[i] == Some(e)).collect();
            let mut by_language: BTreeMap<&str, u32> = BTreeMap::new();
            for &i in &mine {
                *by_language.entry(read[i].source.language).or_default() += read[i].source.lines;
            }
            let mut languages: Vec<(&str, u32)> = by_language
                .into_iter()
                .filter(|(l, _)| SOURCE_LANGUAGES.contains(l))
                .collect();
            languages.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
            let sources: Vec<usize> = mine
                .iter()
                .copied()
                .filter(|&i| is_source(&read[i]))
                .collect();
            let tested = sources
                .iter()
                .filter(|&&i| !covered_by[i].is_empty())
                .count();
            let symbols: usize = sources.iter().map(|&i| read[i].source.symbols.len()).sum();
            let orphaned: usize = sources
                .iter()
                .filter(|&&i| unused[i])
                .map(|&i| read[i].source.symbols.len())
                .sum();
            let touching: Vec<&git::Commit> = commits
                .iter()
                .zip(&commit_entities)
                .filter(|(_, es)| es.contains(&e))
                .map(|(c, _)| c)
                .collect();
            let entry = found.entry.as_deref().and_then(|p| index.get(p).copied());
            EntityFacts {
                path: found.path.clone(),
                name: found.name.clone(),
                form: found.form,
                manifest: found.manifest.clone(),
                entry: found.entry.clone(),
                doc: found
                    .doc
                    .clone()
                    .or_else(|| entry.and_then(|i| read[i].source.doc.clone())),
                files: mine.len() as u32,
                lines: mine.iter().map(|&i| read[i].source.lines).sum(),
                languages: languages.into_iter().map(|(l, _)| l.to_string()).collect(),
                exports: entry.map_or(0, |i| surface(i, &read, &reexports, &mut BTreeSet::new())),
                depends_on: depends[e]
                    .iter()
                    .map(|&d| entities[d].path.clone())
                    .collect(),
                dependents: dependents[e]
                    .iter()
                    .map(|&d| entities[d].path.clone())
                    .collect(),
                tests: EntityTests {
                    files: mine
                        .iter()
                        .filter(|&&i| read[i].source.kind == "test" || read[i].source.inline_tests)
                        .count() as u32,
                    failing: 0,
                    covered: if sources.is_empty() {
                        1.0
                    } else {
                        tested as f64 / sources.len() as f64
                    },
                },
                diagnostics: Diagnostics::default(),
                debt_markers: mine.iter().map(|&i| read[i].source.debt_markers).sum(),
                unused_exports: if symbols == 0 {
                    0.0
                } else {
                    orphaned as f64 / symbols as f64
                },
                git: EntityGit {
                    days_since_first_commit: mine
                        .iter()
                        .map(|&i| days(history.get(&read[i].path).and_then(|h| h.first)))
                        .max()
                        .unwrap_or(0),
                    commits_last14_days: touching.iter().filter(|c| now - c.at <= 14 * DAY).count()
                        as u32,
                    contributors: touching
                        .iter()
                        .map(|c| c.author.as_str())
                        .collect::<BTreeSet<_>>()
                        .len() as u32,
                },
            }
        })
        .collect();

    let mut languages: BTreeMap<String, u32> = BTreeMap::new();
    for f in &read {
        *languages.entry(f.source.language.to_string()).or_default() += f.source.lines;
    }
    let repository = RepositoryFacts {
        name: entities
            .iter()
            .find(|e| e.path.is_empty())
            .map(|e| e.name.clone())
            .unwrap_or_else(|| {
                root.canonicalize()
                    .ok()
                    .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
                    .unwrap_or_default()
            }),
        files: read.len() as u32,
        lines: read.iter().map(|f| f.source.lines).sum(),
        languages,
        age_days: days(commits.iter().map(|c| c.at).min()),
        commits_last30_days: commits.iter().filter(|c| now - c.at <= 30 * DAY).count() as u32,
        contributors: commits
            .iter()
            .map(|c| c.author.as_str())
            .collect::<BTreeSet<_>>()
            .len() as u32,
    };
    let project_id = git::root_commit(root).unwrap_or_else(|| {
        content_hash(
            root.canonicalize()
                .unwrap_or_default()
                .to_string_lossy()
                .as_bytes(),
        )
    });
    Ok(Opened {
        project_id,
        files,
        entities: out_entities,
        repository,
    })
}

/// How many symbols a file exports, counting what it passes on through `export * from`.
fn surface(i: usize, read: &[Read], reexports: &[Vec<usize>], seen: &mut BTreeSet<usize>) -> u32 {
    if !seen.insert(i) {
        return 0;
    }
    read[i].source.symbols.len() as u32
        + reexports[i]
            .iter()
            .map(|&j| surface(j, read, reexports, seen))
            .sum::<u32>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A small workspace on disk: two packages, a crate, a module, an app, tests and an ignored folder.
    fn workspace(name: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("gaia-engine-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let write = |p: &str, text: &str| {
            let path = root.join(p);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        };
        write(".gitignore", "node_modules\nout/\n");
        write("node_modules/x/index.js", "export const x = 1;\n");
        write("out/bundle.js", "export const y = 2;\n");
        write("package.json", r#"{ "name": "demo", "private": true }"#);
        write(
            "packages/core/package.json",
            r#"{ "name": "@demo/core", "description": "The core.", "exports": { ".": "./src/index.ts" } }"#,
        );
        write(
            "packages/core/src/index.ts",
            "// The core's surface.\nexport * from \"./math.ts\";\n",
        );
        write(
            "packages/core/src/math.ts",
            "/** Adds. */\nexport function add(a: number, b: number) {\n  return a + b;\n}\nexport const ZERO = 0;\n",
        );
        write(
            "packages/core/test/math.test.ts",
            "import { add } from \"@demo/core\";\nadd(1, 2);\n",
        );
        write(
            "packages/app/package.json",
            r#"{ "name": "@demo/app", "dependencies": { "@demo/core": "workspace:*" } }"#,
        );
        write(
            "packages/app/src/main.ts",
            "import { add } from \"@demo/core\";\nimport { greet } from \"./greet/index.ts\";\nadd(1, greet());\n",
        );
        write(
            "packages/app/src/greet/index.ts",
            "// Says hello.\nexport function greet() { return 1; }\n",
        );
        write(
            "packages/app/src/greet/unused.ts",
            "export const nobody = 1; // TODO remove\n",
        );
        write(
            "engine/Cargo.toml",
            "[package]\nname = \"demo-engine\"\ndescription = \"The engine.\"\n\n[dependencies]\nserde = \"1\"\n",
        );
        write(
            "engine/src/main.rs",
            "//! The binary.\nmod rpc;\nfn main() {}\n",
        );
        write(
            "engine/src/rpc.rs",
            "pub fn handle() {}\n#[cfg(test)]\nmod tests {}\n",
        );
        write("engine/tests/cli.rs", "#[test]\nfn runs() {}\n");
        write("docs/guide.md", "# Guide\n\nRead me.\n");
        root
    }

    #[test]
    fn walks_the_project_and_finds_its_entities() {
        let root = workspace("entities");
        let opened = open(&root).unwrap();
        let paths: Vec<&str> = opened.files.iter().map(|f| f.path.as_str()).collect();
        // .gitignore is honored: nothing from node_modules or out.
        assert!(
            !paths
                .iter()
                .any(|p| p.starts_with("node_modules") || p.starts_with("out/"))
        );
        assert!(paths.contains(&"docs/guide.md"));

        let entity = |p: &str| {
            opened
                .entities
                .iter()
                .find(|e| e.path == p)
                .unwrap_or_else(|| panic!("no entity at {p}"))
        };
        let forms: Vec<(&str, &str)> = opened
            .entities
            .iter()
            .map(|e| (e.path.as_str(), e.form))
            .collect();
        assert_eq!(
            forms,
            vec![
                ("", "package"),
                ("engine", "crate"),
                ("packages/app", "package"),
                ("packages/app/src/greet", "module"),
                ("packages/core", "package")
            ]
        );
        let core = entity("packages/core");
        assert_eq!(core.name, "@demo/core");
        assert_eq!(core.doc.as_deref(), Some("The core."));
        assert_eq!(core.entry.as_deref(), Some("packages/core/src/index.ts"));
        assert_eq!(core.exports, 2, "index.ts passes on math.ts's two exports");
        assert_eq!(core.dependents, vec!["packages/app"]);
        assert_eq!(core.tests.files, 1);
        assert_eq!(core.tests.covered, 1.0);
        // The app depends on core by manifest and by import, and on its own module by import.
        assert_eq!(
            entity("packages/app").depends_on,
            vec!["packages/app/src/greet", "packages/core"]
        );
        assert_eq!(entity("engine").name, "demo-engine");
        assert_eq!(opened.repository.name, "demo");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn links_imports_both_ways_and_follows_tests_through_them() {
        let root = workspace("imports");
        let opened = open(&root).unwrap();
        let file = |p: &str| {
            opened
                .files
                .iter()
                .find(|f| f.path == p)
                .unwrap_or_else(|| panic!("no file {p}"))
        };
        let math = file("packages/core/src/math.ts");
        assert_eq!(math.imported_by, vec!["packages/core/src/index.ts"]);
        assert_eq!(
            math.tests.covered_by,
            vec!["packages/core/test/math.test.ts"],
            "the test reaches math.ts through the package's entry"
        );
        assert_eq!(math.symbols[0].doc.as_deref(), Some("Adds."));
        assert_eq!(
            file("packages/app/src/main.ts").imports,
            vec![
                "packages/app/src/greet/index.ts",
                "packages/core/src/index.ts"
            ]
        );
        let unused = file("packages/app/src/greet/unused.ts");
        assert!(unused.unused);
        assert_eq!(unused.debt_markers, 1);
        assert!(!file("packages/app/src/greet/index.ts").unused);
        // Rust: `mod rpc;` links main.rs to rpc.rs; the crate's integration test and rpc's own tests cover it.
        assert_eq!(
            file("engine/src/main.rs").imports,
            vec!["engine/src/rpc.rs"]
        );
        assert_eq!(
            file("engine/src/rpc.rs").tests.covered_by,
            vec!["engine/src/rpc.rs", "engine/tests/cli.rs"]
        );
        assert_eq!(file("docs/guide.md").kind, "docs");
        let _ = fs::remove_dir_all(&root);
    }
}
