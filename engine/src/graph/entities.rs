//! A project's entities: the packages and crates its manifests declare. Each
//! is rooted at the directory of its manifest, which the graph marks with it
//! (`DirNode::entity`). Only a manifest makes an entity: no file's name decides
//! what a directory is. The packages those manifests install come from
//! outside, which the import rule reads (`installed`).

use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// A file as entity detection reads it: its path, and its text when it has one.
pub(crate) struct Listed<'a> {
    pub path: &'a str,
    pub text: Option<&'a str>,
}

/// An entity found from its manifest, before its facts are summed.
pub(crate) struct Found {
    pub path: String,
    pub name: String,
    pub form: &'static str,
    pub manifest: String,
    pub entry: Option<String>,
    /// For a package: subpath → target file, from package.json's `exports`.
    pub exports_map: BTreeMap<String, String>,
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
            out.push(Found {
                name: json
                    .get("name")
                    .and_then(Value::as_str)
                    .map(String::from)
                    .unwrap_or_else(|| dir.rsplit('/').next().unwrap_or("").to_string()),
                path: dir,
                form: "package",
                manifest: f.path.to_string(),
                entry,
                exports_map,
            });
        } else if name == "Cargo.toml" && text.lines().any(|l| l.trim() == "[package]") {
            let entry = ["src/lib.rs", "src/main.rs"]
                .iter()
                .map(|c| join(&dir, c))
                .find(|c| paths.contains(c.as_str()));
            out.push(Found {
                name: toml_string(text, "package", "name")
                    .unwrap_or_else(|| dir.rsplit('/').next().unwrap_or("").to_string()),
                path: dir,
                form: "crate",
                manifest: f.path.to_string(),
                entry,
                exports_map: BTreeMap::new(),
            });
        }
    }
    out
}

/// The packages a project's manifests install, by the language family that
/// imports them and spelled as its imports spell them: package.json's
/// dependencies, Cargo.toml's, pyproject.toml's and a requirements file's,
/// go.mod's requirements and a Gemfile's gems. A package installed from a
/// path, or one a manifest here names as its own, is left out, since an
/// import of it means a folder of this project.
pub(crate) fn installed(files: &[Listed]) -> BTreeMap<String, BTreeSet<String>> {
    let mut named = Named::default();
    for f in files {
        let Some(text) = f.text else { continue };
        match f.path.rsplit('/').next().unwrap_or("") {
            "package.json" => package_json(text, &mut named),
            "Cargo.toml" => cargo_toml(text, &mut named),
            "pyproject.toml" => pyproject_toml(text, &mut named),
            "go.mod" => go_mod(text, &mut named),
            "Gemfile" => gemfile(text, &mut named),
            n if n.starts_with("requirements") && n.ends_with(".txt") => {
                for line in text.lines() {
                    requirement(line, &mut named);
                }
            }
            _ => {}
        }
    }
    named
        .installs
        .into_iter()
        .map(|(family, names)| {
            let here = named.here.get(family);
            let outside = names
                .into_iter()
                .filter(|n| !here.is_some_and(|h| h.contains(n)))
                .collect();
            (family.to_string(), outside)
        })
        .collect()
}

/// The packages manifests name, by family.
#[derive(Default)]
struct Named {
    /// Installed from outside.
    installs: BTreeMap<&'static str, BTreeSet<String>>,
    /// A folder of this project: a manifest's own name, or a package installed from a path.
    here: BTreeMap<&'static str, BTreeSet<String>>,
}

impl Named {
    fn add(&mut self, family: &'static str, name: String, here: bool) {
        let into = if here {
            &mut self.here
        } else {
            &mut self.installs
        };
        into.entry(family).or_default().insert(name);
    }
}

fn package_json(text: &str, named: &mut Named) {
    let Ok(json) = serde_json::from_str::<Value>(text) else {
        return;
    };
    if let Some(own) = json.get("name").and_then(Value::as_str) {
        named.add("js", own.to_string(), true);
    }
    for key in [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ] {
        for (dep, version) in json
            .get(key)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let local = version.as_str().is_some_and(|v| {
                ["workspace:", "file:", "link:", "portal:"]
                    .iter()
                    .any(|p| v.starts_with(p))
            });
            named.add("js", dep.clone(), local);
        }
    }
}

fn cargo_toml(text: &str, named: &mut Named) {
    let Ok(toml) = text.parse::<toml::Table>() else {
        return;
    };
    // A `use` spells a crate's name with `_` for `-`.
    let crate_name = |n: &str| n.replace('-', "_");
    if let Some(own) = toml.get("package").and_then(|p| p.get("name")?.as_str()) {
        named.add("rust", crate_name(own), true);
    }
    let kinds = ["dependencies", "dev-dependencies", "build-dependencies"];
    let mut tables = vec![toml.get("workspace").and_then(|w| w.get("dependencies"))];
    tables.extend(kinds.iter().map(|k| toml.get(*k)));
    for (_, target) in toml
        .get("target")
        .and_then(toml::Value::as_table)
        .into_iter()
        .flatten()
    {
        tables.extend(kinds.iter().map(|k| target.get(*k)));
    }
    for (dep, spec) in tables
        .into_iter()
        .flatten()
        .filter_map(toml::Value::as_table)
        .flatten()
    {
        named.add("rust", crate_name(dep), spec.get("path").is_some());
    }
}

fn pyproject_toml(text: &str, named: &mut Named) {
    let Ok(toml) = text.parse::<toml::Table>() else {
        return;
    };
    let project = toml.get("project");
    let poetry = toml.get("tool").and_then(|t| t.get("poetry"));
    for own in [project, poetry].into_iter().flatten() {
        if let Some(name) = own.get("name").and_then(toml::Value::as_str) {
            named.add("python", python_name(name), true);
        }
    }
    // PEP 621's requirement lists: its dependencies, its extras and its dependency groups.
    let mut lists = vec![project.and_then(|p| p.get("dependencies"))];
    for groups in [
        project.and_then(|p| p.get("optional-dependencies")),
        toml.get("dependency-groups"),
    ] {
        lists.extend(
            groups
                .and_then(toml::Value::as_table)
                .into_iter()
                .flat_map(|g| g.values().map(Some)),
        );
    }
    for line in lists
        .into_iter()
        .flatten()
        .filter_map(toml::Value::as_array)
        .flatten()
    {
        if let Some(line) = line.as_str() {
            requirement(line, named);
        }
    }
    // Poetry's tables, by distribution name.
    let mut tables = vec![
        poetry.and_then(|p| p.get("dependencies")),
        poetry.and_then(|p| p.get("dev-dependencies")),
    ];
    for (_, group) in poetry
        .and_then(|p| p.get("group"))
        .and_then(toml::Value::as_table)
        .into_iter()
        .flatten()
    {
        tables.push(group.get("dependencies"));
    }
    for (dep, spec) in tables
        .into_iter()
        .flatten()
        .filter_map(toml::Value::as_table)
        .flatten()
    {
        if dep != "python" {
            named.add("python", python_name(dep), spec.get("path").is_some());
        }
    }
}

/// A Python distribution's name as an import spells it: lowercase, with `_`
/// for `-`. A dot stays, as `ruamel.yaml` imports as written.
fn python_name(name: &str) -> String {
    name.to_lowercase().replace('-', "_")
}

/// The distribution a requirement names (`requests[socks]>=2 ; python_version > "3"`),
/// here when it installs from a path. An option such as `-r` names none.
fn requirement(line: &str, named: &mut Named) {
    let line = line.split('#').next().unwrap_or("").trim();
    if line.starts_with(['-', '.', '/']) {
        return;
    }
    let end = line
        .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')))
        .unwrap_or(line.len());
    if end > 0 {
        named.add("python", python_name(&line[..end]), line.contains("file:"));
    }
}

/// go.mod's own module, its requirements, and a module replaced by a folder here.
fn go_mod(text: &str, named: &mut Named) {
    let mut block: Option<&str> = None;
    for line in text.lines() {
        let l = line.split("//").next().unwrap_or("").trim();
        let (verb, rest) = match block {
            Some(_) if l == ")" => {
                block = None;
                continue;
            }
            Some(verb) => (verb, l),
            None => match l.split_once(char::is_whitespace) {
                Some((verb, "(")) => {
                    block = Some(verb);
                    continue;
                }
                Some((verb, rest)) => (verb, rest.trim()),
                None => continue,
            },
        };
        let Some(path) = rest
            .split_whitespace()
            .next()
            .map(|p| p.trim_matches('"').to_string())
        else {
            continue;
        };
        let to_folder = || {
            rest.split_once("=>")
                .is_some_and(|(_, to)| to.trim().starts_with(['.', '/']))
        };
        match verb {
            "module" => named.add("go", path, true),
            "require" => named.add("go", path, false),
            "replace" if to_folder() => named.add("go", path, true),
            _ => {}
        }
    }
}

fn gemfile(text: &str, named: &mut Named) {
    for line in text.lines() {
        let Some(rest) = line.trim().strip_prefix("gem ") else {
            continue;
        };
        let gem = rest.trim().trim_start_matches(['"', '\'']);
        let gem = gem.split(['"', '\'']).next().unwrap_or("");
        if !gem.is_empty() {
            named.add("ruby", gem.to_string(), rest.contains("path:"));
        }
    }
}
