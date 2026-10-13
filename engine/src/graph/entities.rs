//! A project's entities: the packages and crates its manifests declare, and
//! the modules, apps and services whose index, main or server file is no
//! package's entry. Each is rooted at a directory, which the graph marks with
//! it (`DirNode::entity`). The rules read file names and manifests only.

use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// A file as entity detection reads it: its path, its text when it has one,
/// the part it plays (`source::kind_of`) and its leading comment.
pub(crate) struct Listed<'a> {
    pub path: &'a str,
    pub text: Option<&'a str>,
    pub kind: &'a str,
    pub doc: Option<&'a str>,
}

/// An entity found from a manifest or a directory's files, before its facts are summed.
pub(crate) struct Found {
    pub path: String,
    pub name: String,
    pub form: &'static str,
    pub manifest: Option<String>,
    pub entry: Option<String>,
    pub doc: Option<String>,
    /// For a package: subpath → target file, from package.json's `exports`.
    pub exports_map: BTreeMap<String, String>,
    /// Names (packages) or paths (crates) of the entities its manifest depends on.
    pub manifest_deps: Vec<String>,
}

pub(crate) fn dir_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

pub(crate) fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

/// Joins a relative specifier onto a directory, resolving `.` and `..`.
pub(crate) fn normalize(dir: &str, rel: &str) -> Option<String> {
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
pub(crate) fn within(path: &str, root: &str) -> bool {
    root.is_empty() || path == root || path.starts_with(&format!("{root}/"))
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

pub(crate) fn manifests(files: &[Listed]) -> Vec<Found> {
    let paths: BTreeSet<&str> = files.iter().map(|f| f.path).collect();
    let mut out = Vec::new();
    for f in files {
        let name = f.path.rsplit('/').next().unwrap_or("");
        let dir = dir_of(f.path).to_string();
        let Some(text) = f.text else { continue };
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
                manifest: Some(f.path.to_string()),
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
                manifest: Some(f.path.to_string()),
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
pub(crate) fn directory_entities(files: &[Listed], found: &[Found]) -> Vec<Found> {
    let roots: BTreeSet<&str> = found.iter().map(|e| e.path.as_str()).collect();
    let entries: BTreeSet<&str> = found.iter().filter_map(|e| e.entry.as_deref()).collect();
    let mut out: BTreeMap<String, Found> = BTreeMap::new();
    for f in files {
        let name = f.path.rsplit('/').next().unwrap_or("");
        let dir = dir_of(f.path);
        if dir.is_empty() || roots.contains(dir) || entries.contains(f.path) || f.kind == "test" {
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
                entry: Some(f.path.to_string()),
                doc: f.doc.map(String::from),
                exports_map: BTreeMap::new(),
                manifest_deps: Vec::new(),
            },
        );
    }
    out.into_values().collect()
}
