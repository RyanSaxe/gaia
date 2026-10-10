//! `project.graph`: walks a project, parses every file its language table
//! knows through tree-sitter, measures what the parse can count, reads
//! history from git, and returns the code graph
//! (`packages/schema/src/graph.ts`). Imports and calls go out pending;
//! the rules that resolve them come next.

pub mod git;
mod languages;
mod model;
mod parse;
pub mod walk;

use model::{
    BlockNode, CodeGraph, DefNode, DirNode, Edge, FileNode, Filled, History, Measures, Node,
    PendingRef,
};
use parse::{FileParse, RefKind};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const DAY: i64 = 86_400;
/// How far back a commit counts as recent, as today's activity channel reads it.
const RECENT_DAYS: i64 = 14;

/// Parses keyed by language and content hash, so a file is parsed again
/// only when it changes, for as long as the engine runs.
type ParseCache = Mutex<HashMap<(String, String), Arc<FileParse>>>;

fn cache() -> &'static ParseCache {
    static CACHE: OnceLock<ParseCache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn parse_cached(language: &str, hash: &str, text: &str) -> Result<Arc<FileParse>, String> {
    let key = (language.to_string(), hash.to_string());
    if let Some(p) = cache().lock().map_err(|e| e.to_string())?.get(&key) {
        return Ok(p.clone());
    }
    let loaded = languages::load(language)?;
    let parsed = Arc::new(parse::parse(&loaded, text)?);
    cache()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(key, parsed.clone());
    Ok(parsed)
}

/// Parses every file with a grammar, on every core.
fn parse_all(files: &[walk::Walked]) -> Result<Vec<Option<Arc<FileParse>>>, String> {
    let jobs: Vec<(usize, &str, &str, &str)> = files
        .iter()
        .enumerate()
        .filter_map(|(i, f)| {
            let language = languages::of_path(&f.path)?;
            Some((
                i,
                language.name.as_str(),
                f.hash.as_str(),
                f.text.as_deref()?,
            ))
        })
        .collect();
    let workers = std::thread::available_parallelism()
        .map_or(4, |n| n.get())
        .min(jobs.len().max(1));
    let next = Mutex::new(0usize);
    type Parsed = (usize, Result<Arc<FileParse>, String>);
    let results: Mutex<Vec<Parsed>> = Mutex::new(Vec::new());
    std::thread::scope(|s| {
        for _ in 0..workers {
            s.spawn(|| {
                loop {
                    let job = {
                        let mut n = next.lock().expect("the job counter");
                        let j = jobs.get(*n).copied();
                        *n += 1;
                        j
                    };
                    let Some((i, language, hash, text)) = job else {
                        break;
                    };
                    let parsed = parse_cached(language, hash, text);
                    results.lock().expect("the results").push((i, parsed));
                }
            });
        }
    });
    let mut out: Vec<Option<Arc<FileParse>>> = vec![None; files.len()];
    for (i, parsed) in results.into_inner().map_err(|e| e.to_string())? {
        out[i] = Some(parsed.map_err(|e| format!("{}: {e}", files[i].path))?);
    }
    Ok(out)
}

fn parent_dir(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

/// The directory and every one above it, ending with the root ("").
fn ancestors(dir: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut d = dir;
    loop {
        out.push(d.to_string());
        if d.is_empty() {
            break;
        }
        d = parent_dir(d);
    }
    out
}

/// A lineage for a node seen for the first time. Matching nodes across
/// opens, so a moved file keeps its lineage, comes with the rules.
fn fresh_lineage(id: &str) -> String {
    walk::content_hash(id.as_bytes())
}

#[derive(Default)]
struct Touches {
    times: Vec<i64>,
    authors: BTreeSet<String>,
}

impl Touches {
    fn history(&self, now: i64) -> Option<History> {
        let first = *self.times.iter().min()?;
        let last = *self.times.iter().max()?;
        let days = |t: i64| ((now - t).max(0) / DAY) as u32;
        Some(History {
            first_days: days(first),
            last_days: days(last),
            commits: self.times.len() as u32,
            recent: self
                .times
                .iter()
                .filter(|t| now - **t <= RECENT_DAYS * DAY)
                .count() as u32,
            authors: self.authors.len() as u32,
        })
    }
}

fn contains_edge(from: &str, to: &str) -> Edge {
    Edge {
        from: from.to_string(),
        to: to.to_string(),
        kind: "contains",
        by: Filled { by: "parser" },
    }
}

/// Builds the code graph of the project at `root`.
pub fn build(root: &Path) -> Result<CodeGraph, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a directory.", root.display()));
    }
    let files = walk::walk(root);
    let parsed = parse_all(&files)?;

    // History, per file and per directory.
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    let mut file_touches: HashMap<String, Touches> = HashMap::new();
    let mut dir_touches: HashMap<String, Touches> = HashMap::new();
    for c in git::history(root) {
        let mut dirs: BTreeSet<String> = BTreeSet::new();
        for f in &c.files {
            let t = file_touches.entry(f.clone()).or_default();
            t.times.push(c.at);
            t.authors.insert(c.author.clone());
            dirs.extend(ancestors(parent_dir(f)));
        }
        for d in dirs {
            let t = dir_touches.entry(d).or_default();
            t.times.push(c.at);
            t.authors.insert(c.author.clone());
        }
    }

    // Directories: every one holding a file, and each above it.
    let mut dir_lines: BTreeMap<String, u32> = BTreeMap::new();
    let mut file_lines: Vec<u32> = Vec::new();
    for (f, p) in files.iter().zip(&parsed) {
        let lines = match (p, &f.text) {
            (Some(p), _) => p.measures.lines,
            (None, Some(t)) => t.lines().count() as u32,
            (None, None) => 0,
        };
        file_lines.push(lines);
        for d in ancestors(parent_dir(&f.path)) {
            *dir_lines.entry(d).or_insert(0) += lines;
        }
    }

    let mut nodes: Vec<Node> = Vec::new();
    let mut edges: Vec<Edge> = Vec::new();
    let mut pending: Vec<PendingRef> = Vec::new();
    for (dir, lines) in &dir_lines {
        let id = format!("dir:{dir}");
        if !dir.is_empty() {
            edges.push(contains_edge(&format!("dir:{}", parent_dir(dir)), &id));
        }
        nodes.push(Node::Dir(DirNode {
            lineage: fresh_lineage(&id),
            id,
            measures: Measures {
                lines: *lines,
                history: dir_touches.get(dir).and_then(|t| t.history(now)),
                ..Default::default()
            },
            path: dir.clone(),
        }));
    }

    for (k, (f, p)) in files.iter().zip(&parsed).enumerate() {
        let spec = languages::of_path(&f.path);
        let file_id = format!("file:{}", f.path);
        edges.push(contains_edge(
            &format!("dir:{}", parent_dir(&f.path)),
            &file_id,
        ));
        let mut measures = match p {
            Some(p) => p.measures.clone(),
            None => Measures {
                lines: file_lines[k],
                markers: f.text.as_ref().map(|t| {
                    t.lines()
                        .filter(|l| {
                            ["TODO", "FIXME", "XXX", "HACK"]
                                .iter()
                                .any(|m| l.contains(m))
                        })
                        .count() as u32
                }),
                ..Default::default()
            },
        };
        measures.history = file_touches.get(&f.path).and_then(|t| t.history(now));
        nodes.push(Node::File(FileNode {
            lineage: fresh_lineage(&file_id),
            id: file_id.clone(),
            measures,
            path: f.path.clone(),
            language: p.as_ref().and(spec).map(|s| s.name.clone()),
            bytes: f.bytes,
            hash: f.hash.clone(),
            binary: f.text.is_none(),
            unparsed: p.as_ref().map_or(0, |p| p.unparsed),
            conventions: spec.map(|s| s.conventions_of(&f.path)).unwrap_or_default(),
        }));
        let Some(p) = p else { continue };

        let def_ids: Vec<String> = p
            .defs
            .iter()
            .map(|d| format!("def:{}#{}", f.path, d.qualified))
            .collect();
        for (d, id) in p.defs.iter().zip(&def_ids) {
            let parent = d.parent.map(|i| def_ids[i].clone());
            edges.push(contains_edge(parent.as_deref().unwrap_or(&file_id), id));
            nodes.push(Node::Def(DefNode {
                lineage: fresh_lineage(id),
                id: id.clone(),
                measures: d.measures.clone(),
                file: file_id.clone(),
                parent,
                name: d.name.clone(),
                role: d.role.clone(),
                owner: d.owner.clone(),
                span: d.span,
                signature: d.signature.clone(),
                doc: d.doc.clone(),
            }));
        }
        for b in &p.blocks {
            let holder = b.def.map_or(&file_id, |i| &def_ids[i]);
            let base = b
                .def
                .map_or(f.path.as_str(), |i| &def_ids[i]["def:".len()..]);
            let id = format!("block:{base}/{}", b.index);
            edges.push(contains_edge(holder, &id));
            nodes.push(Node::Block(BlockNode {
                lineage: fresh_lineage(&id),
                id,
                measures: Measures {
                    lines: b.span.end - b.span.start + 1,
                    ..Default::default()
                },
                def: holder.clone(),
                shape: b.shape.clone(),
                span: b.span,
                depth: b.depth,
            }));
        }
        for r in &p.refs {
            let kind = match r.kind {
                RefKind::Import => "import",
                RefKind::Call => "call",
                // References and implementations resolve with the rules, by name.
                RefKind::Reference | RefKind::Implements => continue,
            };
            pending.push(PendingRef {
                from: r.from.map_or(file_id.clone(), |i| def_ids[i].clone()),
                kind,
                text: r.text.clone(),
                at: r.at,
                candidates: Vec::new(),
            });
        }
    }

    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let project_id = git::root_commit(root)
        .unwrap_or_else(|| walk::content_hash(canonical.to_string_lossy().as_bytes()));
    let name = canonical
        .file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    Ok(CodeGraph {
        project_id,
        name,
        nodes,
        edges,
        pending,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixtures() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/languages")
    }

    /// A fresh directory holding the given files.
    fn project(name: &str, files: &[(&str, &str)]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gaia-graph-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for (path, text) in files {
            let p = dir.join(path);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, text).unwrap();
        }
        dir
    }

    fn defs(g: &CodeGraph) -> HashMap<&str, &DefNode> {
        g.nodes
            .iter()
            .filter_map(|n| match n {
                Node::Def(d) => Some((d.id.as_str(), d)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn every_language_parses_its_sample_and_fires_every_capture_the_graph_shows() {
        let g = build(&fixtures()).unwrap();
        let defs = defs(&g);
        for spec in languages::table().values() {
            let file = g
                .nodes
                .iter()
                .find_map(|n| match n {
                    Node::File(f) if f.language.as_deref() == Some(spec.name.as_str()) => Some(f),
                    _ => None,
                })
                .unwrap_or_else(|| {
                    panic!("{} has a sample in tests/fixtures/languages", spec.name)
                });
            assert_eq!(file.unparsed, 0, "{} parses its sample cleanly", spec.name);
            let in_file =
                |id: &str| id == file.id || defs.get(id).is_some_and(|d| d.file == file.id);
            assert!(
                defs.values().any(|d| d.file == file.id),
                "{} finds a definition in {}",
                spec.name,
                file.path
            );
            let loaded = languages::load(&spec.name).unwrap();
            let mut captures: Vec<&str> = loaded.ours.capture_names().to_vec();
            if let Some(t) = &loaded.tags {
                captures.extend(t.capture_names());
            }
            for capture in captures {
                if let Some(shape) = capture.strip_prefix("block.") {
                    let found = g.nodes.iter().any(
                        |n| matches!(n, Node::Block(b) if b.shape == shape && in_file(&b.def)),
                    );
                    assert!(
                        found,
                        "{}'s @{capture} makes a block in {}",
                        spec.name, file.path
                    );
                }
                let kind = match capture {
                    "reference.import" => "import",
                    "reference.call" | "reference.send" => "call",
                    _ => continue,
                };
                let found = g.pending.iter().any(|r| r.kind == kind && in_file(&r.from));
                assert!(
                    found,
                    "{}'s @{capture} makes a pending {kind} in {}",
                    spec.name, file.path
                );
            }
        }
    }

    #[test]
    fn complexity_follows_mccabe_and_sonarsource() {
        let dir = project(
            "measures",
            &[
                (
                    "a.ts",
                    "function chain(a, b) {\n  if (a && b) { return 1 } else if (a) { return 2 } else { return 3 }\n}\n\nfunction pick(x) {\n  switch (x) { case 1: return 1; case 2: return 2; case 3: return 3; default: return 0 }\n}\n\nfunction nested(xs) {\n  for (const x of xs) { if (x) { for (const y of x) { if (y) { g() } } } }\n}\n",
                ),
                (
                    "b.py",
                    "def guard(x):\n    try:\n        g()\n    except A:\n        pass\n    except B:\n        pass\n\n\ndef logic(a, b, c):\n    if a and b and c:\n        return 1\n    elif a or b:\n        return 2\n    return 3\n",
                ),
                (
                    "c.go",
                    "package p\n\nfunc sign(x int) int {\n\tif x > 0 {\n\t\treturn 1\n\t} else if x < 0 {\n\t\treturn -1\n\t} else {\n\t\treturn 0\n\t}\n}\n",
                ),
                (
                    "d.rs",
                    "fn pick(x: i32) -> i32 {\n    match x {\n        0 => 1,\n        1 => 2,\n        _ => 3,\n    }\n}\n",
                ),
            ],
        );
        let g = build(&dir).unwrap();
        let defs = defs(&g);
        // Worked out by hand from each definition's rules.
        for (id, cyclomatic, cognitive) in [
            ("def:a.ts#chain", 4, 4),
            ("def:a.ts#pick", 4, 1),
            ("def:a.ts#nested", 5, 10),
            ("def:b.py#guard", 3, 2),
            ("def:b.py#logic", 6, 4),
            ("def:c.go#sign", 3, 3),
            ("def:d.rs#pick", 3, 1),
        ] {
            let d = defs
                .get(id)
                .unwrap_or_else(|| panic!("{id} is a definition"));
            assert_eq!(
                d.measures.cyclomatic,
                Some(cyclomatic),
                "{id}'s cyclomatic complexity"
            );
            assert_eq!(
                d.measures.cognitive,
                Some(cognitive),
                "{id}'s cognitive complexity"
            );
        }
        let nested = defs["def:a.ts#nested"];
        assert_eq!(nested.measures.nesting, Some(4));
        assert_eq!(nested.measures.params, Some(1));
        assert_eq!(defs["def:b.py#logic"].measures.params, Some(3));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_definition_records_its_signature_doc_owner_and_parent() {
        let g = build(&fixtures()).unwrap();
        let defs = defs(&g);
        let push = defs["def:sample.rs#Batch.push"];
        assert_eq!(push.owner.as_deref(), Some("Batch"));
        assert_eq!(push.role, "method");
        assert_eq!(
            push.signature,
            "pub fn push(&mut self, item: String, limit: usize) -> bool"
        );
        assert_eq!(
            push.doc.as_deref(),
            Some("Adds an item, flushing when full.")
        );
        let walk = defs["def:sample.go#Walker.Walk"];
        assert_eq!(walk.owner.as_deref(), Some("Walker"));
        assert_eq!(
            walk.doc.as_deref(),
            Some("Walk lists every name under the root.")
        );
        let load = defs["def:sample.py#Loader.load"];
        assert_eq!(load.parent.as_deref(), Some("def:sample.py#Loader"));
        assert_eq!(load.doc.as_deref(), Some("Reads every file under root."));
        let read_all = defs["def:sample.ts#readAll"];
        assert_eq!(
            read_all.signature,
            "function readAll(root: string, depth: number): string[]"
        );
        assert_eq!(
            read_all.doc.as_deref(),
            Some("Reads every entry under a root.")
        );
        assert_eq!(
            defs["def:sample.ts#Walker.walk"].doc.as_deref(),
            Some("Walks once.")
        );
    }

    #[test]
    fn ids_survive_an_edit_above_and_conventions_tag_files() {
        let source = std::fs::read_to_string(fixtures().join("sample.rs")).unwrap();
        let dir = project(
            "ids",
            &[
                ("src/sample.rs", &source),
                ("pkg/walk_test.go", "package pkg\n"),
            ],
        );
        let ids = |g: &CodeGraph| -> BTreeSet<String> {
            g.nodes
                .iter()
                .map(|n| match n {
                    Node::Dir(n) => n.id.clone(),
                    Node::File(n) => n.id.clone(),
                    Node::Def(n) => n.id.clone(),
                    Node::Block(n) => n.id.clone(),
                })
                .collect()
        };
        let before = ids(&build(&dir).unwrap());
        std::fs::write(
            dir.join("src/sample.rs"),
            format!("// A new first line.\n\n{source}"),
        )
        .unwrap();
        let after = build(&dir).unwrap();
        assert_eq!(before, ids(&after));
        let test_file = after.nodes.iter().find_map(|n| match n {
            Node::File(f) if f.path == "pkg/walk_test.go" => Some(f),
            _ => None,
        });
        assert_eq!(
            test_file.unwrap().conventions,
            vec!["go:test-file".to_string()]
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
