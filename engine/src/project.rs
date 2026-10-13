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

use crate::graph::entities::{Found, Listed, dir_of, directory_entities, join, manifests, normalize, within};
use crate::graph::{git, walk::content_hash};
use crate::source::{self, Complexity, Symbol};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileTests {
    pub covered_by: Vec<String>,
    /// The tests among `covered_by` that belong to the file's own entity.
    pub own: Vec<String>,
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
    pub days_since_last_commit: u32,
    pub commits_last14_days: u32,
    /// Every commit that touched it, and how many people wrote them.
    pub commits: u32,
    pub authors: u32,
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


const DAY: i64 = 86_400;
const SOURCE_LANGUAGES: [&str; 5] = ["typescript", "javascript", "rust", "python", "go"];

/// Every file of the project's snapshot (`graph::walk::Snapshot`), with its facts read.
fn walk(root: &Path) -> Vec<Read> {
    crate::graph::walk::Snapshot::of(root)
        .files()
        .into_iter()
        .map(|f| {
            let source = match &f.text {
                Some(t) => source::read(&f.path, t),
                None => source::Source {
                    language: source::language_of(&f.path),
                    kind: "data",
                    ..Default::default()
                },
            };
            Read {
                path: f.path,
                hash: f.hash,
                source,
                text: f.text,
            }
        })
        .collect()
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
    let listed: Vec<Listed> = read
        .iter()
        .map(|f| Listed {
            path: &f.path,
            text: f.text.as_deref(),
            kind: f.source.kind,
            doc: f.source.doc.as_deref(),
        })
        .collect();
    let mut entities = manifests(&listed);
    entities.extend(directory_entities(&listed, &entities));
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
                && f.source.exported() > 0
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
                    own: covered_by[i]
                        .iter()
                        .filter(|&&t| owner[t] == owner[i])
                        .map(|&j| name_of(j))
                        .collect(),
                    failing: Vec::new(),
                },
                complexity: f.source.complexity,
                diagnostics: Diagnostics::default(),
                debt_markers: f.source.debt_markers,
                unused: unused[i],
                git: FileGit {
                    days_since_first_commit: days(h.and_then(|h| h.first)),
                    days_since_last_commit: days(h.and_then(|h| h.commits.iter().max().copied())),
                    commits_last14_days: h.map_or(0, |h| {
                        h.commits.iter().filter(|t| now - **t <= 14 * DAY).count() as u32
                    }),
                    commits: h.map_or(0, |h| h.commits.len() as u32),
                    authors: h.map_or(0, |h| h.authors.len() as u32),
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
            let symbols: usize = sources.iter().map(|&i| read[i].source.exported()).sum();
            let orphaned: usize = sources
                .iter()
                .filter(|&&i| unused[i])
                .map(|&i| read[i].source.exported())
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
    read[i].source.exported() as u32
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
            "/** Adds. */\nexport function add(a: number, b: number) {\n  return a + b;\n}\nexport const ZERO = 0;\nfunction twice(a: number) {\n  return add(a, a);\n}\n",
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
            "packages/app/test/main.test.ts",
            "import \"../src/main.ts\";\n",
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
        assert_eq!(
            core.exports, 2,
            "index.ts passes on math.ts's two exports, not its own helper"
        );
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
            vec![
                "packages/app/test/main.test.ts",
                "packages/core/test/math.test.ts"
            ],
            "core's test reaches math.ts through the package's entry, and app's test through app"
        );
        assert_eq!(
            math.tests.own,
            vec!["packages/core/test/math.test.ts"],
            "only core's own test is math.ts's own"
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

    #[test]
    fn the_walk_never_leaves_the_root() {
        use std::os::unix::fs::symlink;
        let base =
            std::env::temp_dir().join(format!("gaia-engine-test-{}-links", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let (root, outside) = (base.join("root"), base.join("outside"));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(outside.join("dir")).unwrap();
        fs::write(outside.join("secret.ts"), "export const secret = 1;\n").unwrap();
        fs::write(outside.join("dir/leak.ts"), "export const leak = 2;\n").unwrap();
        fs::write(root.join("src/main.ts"), "export const main = 0;\n").unwrap();
        // A file past the size cap stays out, unread.
        fs::write(root.join("dump.json"), vec![b'1'; 3 * 1024 * 1024]).unwrap();
        // Links to a file and to directories outside, absolute and relative.
        symlink(outside.join("secret.ts"), root.join("src/secret.ts")).unwrap();
        symlink(outside.join("dir"), root.join("linked")).unwrap();
        symlink("../outside", root.join("up")).unwrap();

        let opened = open(&root).unwrap();
        let paths: Vec<&str> = opened.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["src/main.ts"]);
        let _ = fs::remove_dir_all(&base);
    }
}
