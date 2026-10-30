//! Builds the code graph for `project.graph` (`packages/schema/src/graph.ts`).
//! It walks a project, parses every file in the language table with
//! tree-sitter, counts lines and reads history from git. The rules in
//! `resolve.rs` turn imports and calls into edges, and send the ones they
//! cannot resolve to Jev as pending references.

pub mod entities;
pub mod git;
mod languages;
mod lineage;
pub mod model;
mod parse;
mod resolve;
pub(crate) use resolve::{leading_names, mentions};
pub mod walk;

use model::{
    BlockNode, CodeGraph, DefNode, DirNode, Edge, Entity, FileNode, Filled, History, Measures,
    Node, PendingRef,
};
use parse::FileParse;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const DAY: i64 = 86_400;
/// The history window used to count recent commits, in days.
const RECENT_DAYS: i64 = 14;

/// Parses keyed by language and content hash, so the engine parses a file
/// again only when it changes, for as long as it runs.
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

/// Parses every file with a grammar, on every core. A grammar from a
/// release that cannot be fetched leaves its files without a grammar.
fn parse_all(files: &[walk::Walked]) -> Result<Vec<Option<Arc<FileParse>>>, String> {
    let mut available: HashMap<&str, bool> = HashMap::new();
    for f in files.iter().filter(|f| f.text.is_some()) {
        let Some(spec) = languages::of_path(&f.path) else {
            continue;
        };
        if available.contains_key(spec.name.as_str()) {
            continue;
        }
        let ok = match languages::load(&spec.name) {
            Ok(_) => true,
            Err(e) if matches!(spec.grammar, languages::Grammar::Wasm { .. }) => {
                eprintln!("gaia-engine: {e}");
                false
            }
            Err(e) => return Err(e),
        };
        available.insert(spec.name.as_str(), ok);
    }
    let jobs: Vec<(usize, &str, &str, &str)> = files
        .iter()
        .enumerate()
        .filter_map(|(i, f)| {
            let language = languages::of_path(&f.path)?;
            available
                .get(language.name.as_str())
                .copied()
                .filter(|ok| *ok)?;
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

/// A placeholder lineage until `lineage::assign` gives every node its own.
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
        if self.times.is_empty() {
            return None;
        }
        Some(History {
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

pub fn build(root: &Path) -> Result<CodeGraph, String> {
    build_with(root, &lineage::Store, &Links::new())
}

/// The target Jev chose for a pending reference.
pub struct Link {
    /// The target's id, or "outside".
    pub target: String,
    /// The call that chose it, with its version.
    pub call: String,
    pub p: f64,
    /// The candidates it chose among, sorted. The answer applies only while
    /// they are still the reference's candidates.
    pub candidates: Vec<String>,
}

/// Jev's links, by `ref_key`. A reference has one link for each set of
/// candidates it has had, because the links applied elsewhere can change its
/// candidates, and each set keeps its own answer.
pub type Links = HashMap<String, Vec<Link>>;

/// The key a pending reference's link answer is stored under.
pub fn ref_key(r: &PendingRef) -> String {
    format!("{}|{}|{}|{}", r.from, r.kind, r.text, r.at.start)
}

/// The project's id. For a repository's top level it is the root commit, so
/// the id is the same wherever the repository is cloned. A folder inside a
/// repository is a project of its own, with an id hashed from the root commit
/// and the folder's path in the repository. A folder outside git gets a hash
/// of its path.
pub fn project_id(root: &Path) -> String {
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    match (git::root_commit(root), git::toplevel(root)) {
        (Some(commit), Some(top)) if top == canonical => commit,
        (Some(commit), Some(top)) => {
            let inside = canonical.strip_prefix(&top).unwrap_or(&canonical);
            walk::content_hash(format!("{commit}/{}", inside.display()).as_bytes())
        }
        _ => walk::content_hash(canonical.to_string_lossy().as_bytes()),
    }
}

/// Builds the graph with the references Jev resolved as edges.
pub fn build_linked(root: &Path, links: &Links) -> Result<CodeGraph, String> {
    build_with(root, &lineage::Store, links)
}

/// Builds the graph, matching lineage against the record `keeper` loads.
fn build_with(
    root: &Path,
    keeper: &dyn lineage::Keeper,
    links: &Links,
) -> Result<CodeGraph, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a directory.", root.display()));
    }
    let snapshot = walk::Snapshot::of(root);
    let files = snapshot.files();
    let parsed = parse_all(&files)?;

    // History, per file and per directory.
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    let mut file_touches: HashMap<String, Touches> = HashMap::new();
    let mut dir_touches: HashMap<String, Touches> = HashMap::new();
    let commits = git::history(root);
    for c in &commits {
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
            (Some(p), _) => p.lines,
            (None, Some(t)) => t.lines().count() as u32,
            (None, None) => 0,
        };
        file_lines.push(lines);
        for d in ancestors(parent_dir(&f.path)) {
            *dir_lines.entry(d).or_insert(0) += lines;
        }
    }

    // The entities rooted in its directories (`entities.rs`).
    let listed: Vec<entities::Listed> = files
        .iter()
        .map(|f| entities::Listed {
            path: &f.path,
            text: f.text.as_deref(),
        })
        .collect();
    let found = entities::manifests(&listed);
    let entity_at: BTreeMap<String, Entity> = found
        .iter()
        .map(|e| {
            (
                e.path.clone(),
                Entity {
                    name: e.name.clone(),
                    form: e.form,
                    manifest: e.manifest.clone(),
                    entry: e.entry.clone(),
                },
            )
        })
        .collect();

    let mut nodes: Vec<Node> = Vec::new();
    let mut all_def_ids: Vec<Vec<String>> = vec![Vec::new(); files.len()];
    for (dir, lines) in &dir_lines {
        let id = format!("dir:{dir}");
        nodes.push(Node::Dir(DirNode {
            lineage: fresh_lineage(&id),
            judged: None,
            id,
            measures: Measures {
                lines: *lines,
                history: dir_touches.get(dir).and_then(|t| t.history(now)),
            },
            path: dir.clone(),
            entity: entity_at.get(dir).cloned(),
        }));
    }

    for (k, (f, p)) in files.iter().zip(&parsed).enumerate() {
        let spec = languages::of_path(&f.path);
        let file_id = format!("file:{}", f.path);
        nodes.push(Node::File(FileNode {
            lineage: fresh_lineage(&file_id),
            judged: None,
            id: file_id.clone(),
            measures: Measures {
                lines: file_lines[k],
                history: file_touches.get(&f.path).and_then(|t| t.history(now)),
            },
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
            nodes.push(Node::Def(DefNode {
                lineage: fresh_lineage(id),
                judged: None,
                id: id.clone(),
                measures: Measures {
                    lines: d.span.end - d.span.start + 1,
                    ..Default::default()
                },
                file: file_id.clone(),
                parent,
                name: d.name.clone(),
                role: d.role.clone(),
                owner: d.owner.clone(),
                span: d.span,
                signature: d.signature.clone(),
                doc: d.doc.clone(),
                exported: d.exported,
            }));
        }
        for b in &p.blocks {
            let holder = b.def.map_or(&file_id, |i| &def_ids[i]);
            let base = b
                .def
                .map_or(f.path.as_str(), |i| &def_ids[i]["def:".len()..]);
            let id = format!("block:{base}/{}", b.index);
            nodes.push(Node::Block(BlockNode {
                lineage: fresh_lineage(&id),
                judged: None,
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
        all_def_ids[k] = def_ids;
    }

    // Resolve imports, calls and references by rule, or leave them pending.
    let dirs: BTreeSet<String> = dir_lines.keys().cloned().collect();
    let units: Vec<resolve::Unit> = files
        .iter()
        .zip(&parsed)
        .zip(&all_def_ids)
        .map(|((f, p), ids)| resolve::Unit {
            path: &f.path,
            spec: languages::of_path(&f.path),
            parse: p.as_deref(),
            def_ids: ids,
            text: f.text.as_deref(),
        })
        .collect();
    let packages: Vec<resolve::Package> = found
        .iter()
        .filter(|e| e.form == "package")
        .map(|e| resolve::Package {
            name: &e.name,
            root: &e.path,
            entry: e.entry.as_deref(),
            exports: &e.exports_map,
        })
        .collect();
    let resolved = resolve::run(&units, &dirs, &packages, &entities::installed(&listed));
    let mut edges = resolved.edges;
    // References Jev resolved become edges, and ones it placed outside the
    // repository leave the pending list. A reference whose candidates changed
    // since Jev answered is pending again.
    let mut pending: Vec<PendingRef> = Vec::new();
    for r in resolved.pending {
        let mut offered = r.candidates.clone();
        offered.sort();
        match links
            .get(&ref_key(&r))
            .and_then(|ls| ls.iter().find(|l| l.candidates == offered))
        {
            Some(l) if l.target == "outside" => {}
            Some(l) => edges.push(Edge {
                from: r.from.clone(),
                to: l.target.clone(),
                kind: if r.kind == "import" {
                    "imports"
                } else {
                    "calls"
                },
                by: Filled {
                    by: "jev",
                    call: Some(l.call.clone()),
                    p: Some(l.p),
                },
                at: Some(r.at),
            }),
            None => pending.push(r),
        }
    }

    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let project_id = project_id(root);

    // Lineage, matched against the store's record of this project's last graph.
    let commit = snapshot.commit().map(String::from);
    let previous = keeper.load(&project_id);
    let renames = match (
        previous.as_ref().and_then(|p| p.commit.as_deref()),
        commit.as_deref(),
    ) {
        (Some(from), Some(to)) if from != to => git::renames(root, from, to),
        _ => None,
    };
    let current = lineage::Current {
        commit: commit.clone(),
        dirs: dirs.iter().map(String::as_str).collect(),
        files: files
            .iter()
            .enumerate()
            .map(|(k, f)| lineage::File {
                path: &f.path,
                lines: file_lines[k],
                fingerprint: f
                    .text
                    .as_deref()
                    .map(parse::fingerprint)
                    .unwrap_or_default(),
            })
            .collect(),
        defs: files
            .iter()
            .zip(&parsed)
            .zip(&all_def_ids)
            .flat_map(|((f, p), ids)| {
                p.iter().flat_map(move |p| {
                    p.defs.iter().zip(ids).map(move |(d, id)| lineage::Def {
                        id,
                        file: &f.path,
                        name: &d.name,
                        lines: d.span.end - d.span.start + 1,
                        fingerprint: &d.fingerprint,
                    })
                })
            })
            .collect(),
    };
    let (lineages, record) = lineage::assign(previous.as_ref(), renames.as_ref(), &current);
    keeper.save(&project_id, &record);
    let lineage_of = |id: &str| {
        lineages
            .get(id)
            .cloned()
            .unwrap_or_else(|| fresh_lineage(id))
    };
    for n in &mut nodes {
        match n {
            Node::Dir(d) => d.lineage = lineage_of(&d.id),
            Node::File(f) => f.lineage = lineage_of(&f.id),
            Node::Def(d) => d.lineage = lineage_of(&d.id),
            // A block's lineage is a hash of its definition's or file's lineage and its index there.
            Node::Block(b) => {
                let index = b.id.rsplit('/').next().unwrap_or("0");
                b.lineage =
                    walk::content_hash(format!("{}/{index}", lineage_of(&b.def)).as_bytes());
            }
        }
    }
    let name = git::name(root).unwrap_or_else(|| {
        canonical
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
    });
    Ok(CodeGraph {
        project_id,
        name,
        commit,
        nodes,
        edges,
        pending,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::path::PathBuf;

    /// A keeper in memory, so tests never touch the app's store.
    #[derive(Default)]
    struct Memory(std::cell::RefCell<HashMap<String, lineage::Record>>);

    impl lineage::Keeper for Memory {
        fn load(&self, project: &str) -> Option<lineage::Record> {
            self.0.borrow().get(project).cloned()
        }
        fn save(&self, project: &str, record: &lineage::Record) {
            self.0
                .borrow_mut()
                .insert(project.to_string(), record.clone());
        }
    }

    fn graph(root: &Path) -> Result<CodeGraph, String> {
        build_with(root, &Memory::default(), &Links::new())
    }

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
        let g = graph(&fixtures()).unwrap();
        let defs = defs(&g);
        let compiled = languages::table()
            .values()
            .filter(|s| matches!(s.grammar, languages::Grammar::Compiled { .. }));
        for spec in compiled {
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
            let mut captures: Vec<&str> = loaded.ours.as_ref().unwrap().capture_names().to_vec();
            if let Some(t) = &loaded.tags {
                captures.extend(t.capture_names());
            }
            let text = std::fs::read_to_string(fixtures().join(&file.path)).unwrap();
            let parsed = parse::parse(&loaded, &text).unwrap();
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
                // An alias attaches to the import that contains it, and a default export names its definition.
                if let Some(kind) = capture.strip_prefix("alias.") {
                    let found = parsed.refs.iter().flat_map(|r| &r.aliases).any(|a| {
                        matches!(
                            (&a.of, kind),
                            (parse::Aliased::Item(_), "renamed")
                                | (parse::Aliased::Module, "module")
                                | (parse::Aliased::Default, "default")
                        )
                    });
                    assert!(
                        found,
                        "{}'s @{capture} makes an alias in {}",
                        spec.name, file.path
                    );
                }
                // A re-export attaches to the import that contains it.
                if let Some(kind) = capture.strip_prefix("reexport.") {
                    let found = parsed.refs.iter().any(|r| {
                        (kind == "all" && r.passes_all)
                            || r.passes.iter().any(|a| {
                                matches!(
                                    (&a.of, kind),
                                    (parse::Aliased::Item(_), "named" | "renamed")
                                        | (parse::Aliased::Module, "module")
                                )
                            })
                    });
                    assert!(
                        found,
                        "{}'s @{capture} passes a name on in {}",
                        spec.name, file.path
                    );
                }
                if capture == "export.default" {
                    assert!(
                        parsed.default_export.is_some(),
                        "{}'s @{capture} names a default in {}",
                        spec.name,
                        file.path
                    );
                }
                // An import or call may resolve, become pending or point outside, so the test checks the parse.
                let kind = match capture {
                    "reference.import" => parse::RefKind::Import,
                    "reference.call" | "reference.send" => parse::RefKind::Call,
                    _ => continue,
                };
                assert!(
                    parsed.refs.iter().any(|r| r.kind == kind),
                    "{}'s @{capture} makes a reference in {}",
                    spec.name,
                    file.path
                );
            }
        }
    }

    #[test]
    fn a_grammar_from_its_release_reads_lua_with_or_without_its_tags_query() {
        let wasm = std::fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/wasm/tree-sitter-lua.wasm"),
        )
        .unwrap();
        let tags = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/wasm/lua-tags.scm"),
        )
        .unwrap();
        let src = "local M = {}\n\n-- Walks names.\nfunction M.walk(root, depth)\n  local out = {}\n  for i = 1, depth do\n    if i > 3 and depth > 0 then\n      out[#out + 1] = root\n    elseif i > 5 then\n      print(i)\n    else\n      helper(i)\n    end\n  end\n  return out\nend\n\nfunction M:size()\n  return #self\nend\n\nreturn M\n";
        // With its tags query, definitions come from the query. Without it, they come from node kinds.
        for tags in [Some(tags.as_str()), None] {
            let loaded = languages::from_wasm("lua", &wasm, tags).unwrap();
            let p = parse::parse(&loaded, src).unwrap();
            assert_eq!(p.unparsed, 0, "parses cleanly with tags {}", tags.is_some());
            assert!(!p.defs.is_empty(), "finds definitions with tags {}", tags.is_some());
        }
    }

    #[test]
    fn every_language_from_a_release_names_a_https_file_and_its_hash() {
        let mut extensions: BTreeSet<&str> = BTreeSet::new();
        for spec in languages::table().values() {
            for e in &spec.extensions {
                assert!(
                    extensions.insert(e.as_str()),
                    ".{e} belongs to one language only"
                );
            }
            let remotes: Vec<(&str, &str)> = match &spec.grammar {
                languages::Grammar::Compiled { .. } => continue,
                languages::Grammar::Wasm { wasm, sha256 } => {
                    std::iter::once((wasm.as_str(), sha256.as_str()))
                        .chain(
                            spec.tags
                                .iter()
                                .map(|t| (t.url.as_str(), t.sha256.as_str())),
                        )
                        .collect()
                }
            };
            for (url, sha) in remotes {
                assert!(url.starts_with("https://"), "{}: {url}", spec.name);
                assert!(
                    sha.len() == 64 && sha.chars().all(|c| c.is_ascii_hexdigit()),
                    "{}: {sha}",
                    spec.name
                );
            }
        }
    }

    #[test]
    fn the_rules_resolve_what_has_one_target_and_leave_the_rest_to_jev() {
        let dir = project(
            "rules",
            &[
                ("package.json", r#"{ "name": "demo", "dependencies": { "react": "19" } }"#),
                ("aliases.json", r#"{ "@lib": "./lib" }"#),
                ("lib/a.ts", "export const a = 1;\n"),
                (
                    "src/a.ts",
                    "import { helper } from \"./b\";\nimport React from \"react\";\nimport { join } from \"node:path\";\nimport { a } from \"@lib/a\";\n\nexport function caller(obj: unknown) {\n  helper();\n  obj.render();\n}\n",
                ),
                (
                    "src/b.ts",
                    "export function helper() {\n  return 1;\n}\n\nexport class Tool {\n  render() {\n    return 2;\n  }\n}\n\nexport class Panel {\n  render() {\n    return 3;\n  }\n}\n",
                ),
            ],
        );
        let g = graph(&dir).unwrap();
        let edge = |from: &str, to: &str| g.edges.iter().any(|e| e.from == from && e.to == to);
        let pending = |text: &str| g.pending.iter().find(|p| p.text == text);
        // A link with one possible target resolves by rule.
        assert!(edge("file:src/a.ts", "file:src/b.ts"));
        assert!(edge("def:src/a.ts#caller", "def:src/b.ts#helper"));
        assert!(pending("./b").is_none() && pending("helper").is_none());
        // A link with several goes to Jev with only those as its candidates. A local alias a configuration names
        // could mean a folder here, so it goes to Jev too.
        let render: BTreeSet<&str> = pending("render").expect("obj.render goes to Jev").candidates.iter().map(String::as_str).collect();
        assert_eq!(render, BTreeSet::from(["def:src/b.ts#Panel.render", "def:src/b.ts#Tool.render"]));
        assert!(pending("@lib/a").expect("@lib/a goes to Jev").candidates.contains(&"file:lib/a.ts".to_string()));
        // An installed package and the standard library are outside, so they never go to Jev.
        assert!(pending("react").is_none() && pending("node:path").is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn each_language_s_import_and_re_export_forms_reach_what_they_name() {
        let dir = project(
            "forms",
            &[
                // TypeScript and JavaScript imports. The command line defines the very name it renames.
                (
                    "src/v1/index.ts",
                    "export function buildSite() {\n  return 1;\n}\n\nexport default function legacy() {\n  return 2;\n}\n",
                ),
                ("src/walk.ts", "export function walk() {\n  return 3;\n}\n"),
                ("src/make.ts", "function make() {\n  return 4;\n}\n\nexport default make;\n"),
                ("src/strings.ts", "export function join() {\n  return 5;\n}\n"),
                (
                    "src/cli.ts",
                    "import { buildSite as buildV1 } from \"./v1/index\";\nimport * as walker from \"./walk\";\nimport legacyBuild from \"./v1/index\";\nimport made from \"./make\";\nimport * as path from \"node:path\";\n\nexport function buildSite() {\n  buildV1();\n  walker.walk();\n  legacyBuild();\n  made();\n  path.join(\"a\", \"b\");\n}\n",
                ),
                ("lib/tools.js", "export function helper() {\n  return 6;\n}\n\nexport function other() {\n  return 7;\n}\n"),
                (
                    "lib/main.js",
                    "import { helper as assist } from \"./tools.js\";\nimport * as tools from \"./tools.js\";\n\nexport function main() {\n  assist();\n  tools.other();\n}\n",
                ),
                // A package's index that re-exports, with a cycle and a chain longer than `HOPS`.
                ("packages/geo/package.json", r#"{ "name": "@demo/geo", "main": "src/index.ts" }"#),
                (
                    "packages/geo/src/index.ts",
                    "export { area } from \"./shapes/area\";\nexport { perimeter as edge } from \"./shapes/perimeter\";\nexport * from \"./more\";\nexport * as units from \"./units/convert\";\nexport * from \"./loop/a\";\nexport * from \"./far/f1\";\nexport * from \"./hidden\";\n",
                ),
                ("packages/geo/src/shapes/area.ts", "export function area() {\n  return 1;\n}\n"),
                ("packages/geo/src/shapes/perimeter.ts", "export function perimeter() {\n  return 2;\n}\n"),
                ("packages/geo/src/more.js", "export * from \"./deep/scale\";\n"),
                ("packages/geo/src/deep/scale.ts", "export function scale() {\n  return 3;\n}\n"),
                ("packages/geo/src/units/convert.ts", "export function toMeters() {\n  return 4;\n}\n"),
                ("packages/geo/src/hidden.ts", "function tidy() {\n  return 7;\n}\n\nexport const kept = tidy();\n"),
                ("packages/geo/src/loop/a.ts", "export * from \"./b\";\n"),
                ("packages/geo/src/loop/b.ts", "export * from \"./a\";\n"),
                ("packages/geo/src/far/f1.ts", "export * from \"./f2\";\n"),
                ("packages/geo/src/far/f2.ts", "export * from \"./f3\";\n"),
                ("packages/geo/src/far/f3.ts", "export * from \"./f4\";\n"),
                ("packages/geo/src/far/f4.ts", "export * from \"./f5\";\n"),
                ("packages/geo/src/far/f5.ts", "export function distant() {\n  return 5;\n}\n"),
                ("apps/web/scale.ts", "export function scale() {\n  return 6;\n}\n"),
                (
                    "apps/web/app.ts",
                    "import { area, edge, scale, units, missing, distant } from \"@demo/geo\";\nimport * as geo from \"@demo/geo\";\n\nexport function draw() {\n  area();\n  edge();\n  scale();\n  units.toMeters();\n  missing();\n  distant();\n  tidy();\n}\n\nexport function drawAll() {\n  geo.area();\n}\n",
                ),
                // Python imports, and a package's `__init__` that re-exports.
                (
                    "pkg/core.py",
                    "def run():\n    return 1\n\n\ndef stop():\n    return 3\n\n\nclass Loader:\n    def load(self):\n        return 2\n",
                ),
                (
                    "pkg/app.py",
                    "from .core import run as start\nfrom . import core as c\nimport pkg.core as engine\nimport numpy as np\n\n\ndef run():\n    return 0\n\n\ndef renamed():\n    start()\n\n\ndef module():\n    c.run()\n\n\ndef dotted():\n    engine.run()\n\n\ndef outside():\n    np.load()\n\n\ndef begin():\n    from .core import run as f\n    return f()\n\n\ndef end():\n    from .core import stop as f\n    return f()\n",
                ),
                (
                    "shop/__init__.py",
                    "from .billing.invoice import total\nfrom .billing.tax import rate as tax_rate\nfrom .catalog import *\n",
                ),
                ("shop/billing/invoice.py", "def total():\n    return 1\n"),
                ("shop/billing/tax.py", "def rate():\n    return 2\n"),
                ("shop/catalog/__init__.py", "from .store.items import find\n"),
                ("shop/catalog/store/items.py", "def find():\n    return 3\n"),
                ("shop/cli/helpers.py", "def find():\n    return 4\n"),
                (
                    "shop/cli/main.py",
                    "from .. import total, tax_rate, find\n\n\ndef run():\n    total()\n    tax_rate()\n    find()\n",
                ),
                // Rust's `use … as` and `pub use`.
                (
                    "src/util.rs",
                    "pub struct Tool;\n\nimpl Tool {\n    pub fn new() -> Self {\n        Tool\n    }\n}\n\npub fn format(x: u8) -> u8 {\n    x\n}\n",
                ),
                ("src/graph/mod.rs", "pub mod resolve;\n"),
                ("src/graph/resolve.rs", "pub fn run() {}\n"),
                (
                    "src/geo/mod.rs",
                    "pub mod shapes;\npub use self::shapes::flat::area;\npub use self::shapes::flat::perimeter as edge;\npub use self::shapes::flat::{span, mass as weight};\npub use self::shapes::solid::*;\nuse self::shapes::flat::hidden;\n",
                ),
                ("src/geo/shapes/mod.rs", "pub mod flat;\npub mod solid;\n"),
                (
                    "src/geo/shapes/flat.rs",
                    "pub fn area() {}\npub fn perimeter() {}\npub fn span() {}\npub fn mass() {}\npub fn hidden() {}\n",
                ),
                ("src/geo/shapes/solid.rs", "pub fn volume() {}\n"),
                (
                    "src/main.rs",
                    "mod geo;\nuse crate::util::format as fmt_u8;\nuse crate::util::Tool as T;\nuse crate::graph::resolve as res;\nuse crate::geo::{area, edge, span, weight, volume, hidden};\n\nfn main() {\n    let t = T::new();\n    let x = fmt_u8(1);\n    res::run();\n}\n\nfn format() {}\n\nfn shapes() {\n    area();\n    edge();\n    span();\n    weight();\n    volume();\n    hidden();\n}\n",
                ),
            ],
        );
        let g = graph(&dir).unwrap();
        // Each row is a language, a form, where it is used, the target it names and whether the link reaches it. From
        // a definition the link is a call, and from a file it is an import.
        let forms = [
            ("TypeScript", "a renamed import of a name the file also defines", "def:src/cli.ts#buildSite", "def:src/v1/index.ts#buildSite", true),
            ("TypeScript", "a namespace import", "def:src/cli.ts#buildSite", "def:src/walk.ts#walk", true),
            ("TypeScript", "a default import of `export default function`", "def:src/cli.ts#buildSite", "def:src/v1/index.ts#legacy", true),
            ("TypeScript", "a default import of `export default name`", "def:src/cli.ts#buildSite", "def:src/make.ts#make", true),
            ("TypeScript", "a namespace from outside the repository", "def:src/cli.ts#buildSite", "def:src/strings.ts#join", false),
            ("JavaScript", "a renamed import", "def:lib/main.js#main", "def:lib/tools.js#helper", true),
            ("JavaScript", "a namespace import", "def:lib/main.js#main", "def:lib/tools.js#other", true),
            ("TypeScript", "`export { a }` in a package's index", "def:apps/web/app.ts#draw", "def:packages/geo/src/shapes/area.ts#area", true),
            ("TypeScript", "a namespace import of a package's index", "def:apps/web/app.ts#drawAll", "def:packages/geo/src/shapes/area.ts#area", true),
            ("TypeScript", "`export { a as b }`", "def:apps/web/app.ts#draw", "def:packages/geo/src/shapes/perimeter.ts#perimeter", true),
            ("TypeScript", "two `export *`, one in JavaScript", "def:apps/web/app.ts#draw", "def:packages/geo/src/deep/scale.ts#scale", true),
            ("TypeScript", "`export * as ns`", "def:apps/web/app.ts#draw", "def:packages/geo/src/units/convert.ts#toMeters", true),
            ("TypeScript", "a neighbour that shares a re-exported name", "def:apps/web/app.ts#draw", "def:apps/web/scale.ts#scale", false),
            ("TypeScript", "`export *` of a module that does not export the name", "def:apps/web/app.ts#draw", "def:packages/geo/src/hidden.ts#tidy", false),
            ("TypeScript", "a chain of re-exports longer than `HOPS`", "def:apps/web/app.ts#draw", "def:packages/geo/src/far/f5.ts#distant", false),
            ("Python", "`from .x import a as b`", "def:pkg/app.py#renamed", "def:pkg/core.py#run", true),
            ("Python", "`from . import x as y`", "def:pkg/app.py#module", "def:pkg/core.py#run", true),
            ("Python", "`import a.x as y`", "def:pkg/app.py#dotted", "def:pkg/core.py#run", true),
            ("Python", "a module from outside the repository", "def:pkg/app.py#outside", "def:pkg/core.py#Loader.load", false),
            ("Python", "an import inside a function", "def:pkg/app.py#begin", "def:pkg/core.py#run", true),
            ("Python", "an import inside another function", "def:pkg/app.py#end", "def:pkg/core.py#stop", true),
            ("Python", "a name another function imports", "def:pkg/app.py#end", "def:pkg/core.py#run", false),
            ("Python", "`from .x import a` in a package's `__init__`", "def:shop/cli/main.py#run", "def:shop/billing/invoice.py#total", true),
            ("Python", "`from .x import a as b` in a package's `__init__`", "def:shop/cli/main.py#run", "def:shop/billing/tax.py#rate", true),
            ("Python", "`from .x import *`, then `from .x import a`", "def:shop/cli/main.py#run", "def:shop/catalog/store/items.py#find", true),
            ("Python", "a neighbour that shares a re-exported name", "def:shop/cli/main.py#run", "def:shop/cli/helpers.py#find", false),
            ("Rust", "`use x::a as b` of a name the file also defines", "def:src/main.rs#main", "def:src/util.rs#format", true),
            ("Rust", "`use x::T as U`", "def:src/main.rs#main", "def:src/util.rs#Tool.new", true),
            ("Rust", "`use x::module as m`", "def:src/main.rs#main", "def:src/graph/resolve.rs#run", true),
            ("Rust", "`use x::module as m` names the module, not the folder above it", "file:src/main.rs", "file:src/graph/resolve.rs", true),
            ("Rust", "`pub use x::a`", "def:src/main.rs#shapes", "def:src/geo/shapes/flat.rs#area", true),
            ("Rust", "`pub use x::a as b`", "def:src/main.rs#shapes", "def:src/geo/shapes/flat.rs#perimeter", true),
            ("Rust", "`pub use x::{a}`", "def:src/main.rs#shapes", "def:src/geo/shapes/flat.rs#span", true),
            ("Rust", "`pub use x::{a as b}`", "def:src/main.rs#shapes", "def:src/geo/shapes/flat.rs#mass", true),
            ("Rust", "`pub use x::*`", "def:src/main.rs#shapes", "def:src/geo/shapes/solid.rs#volume", true),
            ("Rust", "a private `use`", "def:src/main.rs#shapes", "def:src/geo/shapes/flat.rs#hidden", false),
        ];
        let wrong: Vec<String> = forms
            .iter()
            .filter(|(_, _, from, to, reaches)| {
                let kind = if from.starts_with("file:") { "imports" } else { "calls" };
                g.edges.iter().any(|e| e.from == *from && e.to == *to && e.kind == kind) != *reaches
            })
            .map(|(language, form, _, to, reaches)| {
                format!("{language}: {form} {} {to}", if *reaches { "should reach" } else { "should not reach" })
            })
            .collect();
        assert!(wrong.is_empty(), "{wrong:#?}");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_folder_inside_a_repository_is_a_project_of_its_own() {
        let dir = project("inside", &[("sub/a.ts", "export const a = 1;\n")]);
        let beside = |suffix: &str| dir.with_file_name(format!("{}-{suffix}", dir.file_name().unwrap().to_string_lossy()));
        let (worktree, clone) = (beside("worktree"), beside("clone"));
        let _ = std::fs::remove_dir_all(&worktree);
        let _ = std::fs::remove_dir_all(&clone);
        let git = |args: &[&str]| {
            let ok = std::process::Command::new("git")
                .arg("-C")
                .arg(&dir)
                .args(["-c", "user.name=Gaia", "-c", "user.email=gaia@example.com"])
                .args(args)
                .status()
                .unwrap()
                .success();
            assert!(ok, "git {args:?}");
        };
        git(&["init", "-q"]);
        git(&["add", "."]);
        git(&["commit", "-q", "-m", "one"]);
        git(&["worktree", "add", "-q", "-b", "other", worktree.to_str().unwrap()]);
        git(&["clone", "-q", ".", clone.to_str().unwrap()]);
        assert_ne!(project_id(&dir.join("sub")), project_id(&dir));
        // A clone elsewhere and a worktree are the same projects, so their saved answers apply.
        for other in [&clone, &worktree] {
            assert_eq!(project_id(other), project_id(&dir), "{}", other.display());
            assert_eq!(project_id(&other.join("sub")), project_id(&dir.join("sub")), "{}", other.display());
        }
        // The name enters every request, so a worktree takes its main checkout's.
        assert_eq!(graph(&worktree).unwrap().name, graph(&dir).unwrap().name);
        std::fs::remove_dir_all(worktree).unwrap();
        std::fs::remove_dir_all(clone).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn lineage_survives_a_directory_rename_a_moved_function_and_a_split_file() {
        let walk = "export function walk(root: string, depth: number): string[] {\n  const out: string[] = [];\n  for (const name of list(root)) {\n    if (name.length > depth) {\n      out.push(name.toUpperCase());\n    }\n  }\n  return out;\n}\n";
        let helper = "export function helper(text: string): string {\n  const parts = text.split(\"/\").filter((p) => p.length > 0);\n  return parts.map((p) => p.trim().toLowerCase()).join(\"-\");\n}\n";
        let list = "export function list(root: string): string[] {\n  const seen = new Set<string>();\n  for (const part of root.split(\"/\")) {\n    seen.add(part.trim());\n  }\n  return [...seen].sort();\n}\n";
        let main = "import { walk } from \"./lib/walk\";\n\nexport function main(): void {\n  console.log(walk(\".\", 1));\n}\n";
        let dir = project(
            "lineage",
            &[
                ("lib/walk.ts", &format!("{walk}\n{helper}\n{list}")),
                (
                    "lib/util.ts",
                    "export function format(x: number): string {\n  return String(x);\n}\n",
                ),
                ("main.ts", main),
            ],
        );
        let git = |args: &[&str]| {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(&dir)
                .args(["-c", "user.name=Gaia", "-c", "user.email=gaia@example.com"])
                .args(args)
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        };
        git(&["init", "-q"]);
        git(&["add", "."]);
        git(&["commit", "-q", "-m", "one"]);
        let keeper = Memory::default();
        let lineage = |g: &CodeGraph| -> HashMap<String, String> {
            g.nodes
                .iter()
                .filter_map(|n| match n {
                    Node::Dir(d) => Some((d.id.clone(), d.lineage.clone())),
                    Node::File(f) => Some((f.id.clone(), f.lineage.clone())),
                    Node::Def(d) => Some((d.id.clone(), d.lineage.clone())),
                    Node::Block(_) => None,
                })
                .collect()
        };
        let first = lineage(&build_with(&dir, &keeper, &Links::new()).unwrap());

        // A directory renamed, a function moved to another file, another file edited.
        git(&["mv", "lib", "src"]);
        std::fs::write(dir.join("src/walk.ts"), format!("{walk}\n{list}")).unwrap();
        std::fs::write(
            dir.join("src/util.ts"),
            format!(
                "export function format(x: number): string {{\n  return String(x);\n}}\n\n{helper}"
            ),
        )
        .unwrap();
        std::fs::write(
            dir.join("main.ts"),
            main.replace("./lib/walk", "./src/walk")
                .replace("1));", "2));"),
        )
        .unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-q", "-m", "two"]);
        let second = lineage(&build_with(&dir, &keeper, &Links::new()).unwrap());
        for (now, then) in [
            ("dir:src", "dir:lib"),
            ("file:src/walk.ts", "file:lib/walk.ts"),
            ("file:src/util.ts", "file:lib/util.ts"),
            ("def:src/walk.ts#walk", "def:lib/walk.ts#walk"),
            ("def:src/util.ts#helper", "def:lib/walk.ts#helper"),
            ("def:main.ts#main", "def:main.ts#main"),
        ] {
            assert_eq!(
                second.get(now),
                first.get(then),
                "{now} keeps {then}'s lineage"
            );
        }

        // When a file splits in two, its definitions keep their lineage.
        std::fs::remove_file(dir.join("src/walk.ts")).unwrap();
        std::fs::create_dir_all(dir.join("src/walk")).unwrap();
        std::fs::write(dir.join("src/walk/core.ts"), walk).unwrap();
        std::fs::write(dir.join("src/walk/list.ts"), list).unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-q", "-m", "three"]);
        let third = lineage(&build_with(&dir, &keeper, &Links::new()).unwrap());
        assert_eq!(
            third.get("def:src/walk/core.ts#walk"),
            first.get("def:lib/walk.ts#walk")
        );
        assert_eq!(
            third.get("def:src/walk/list.ts#list"),
            first.get("def:lib/walk.ts#list")
        );
        let distinct: HashSet<&String> = third.values().collect();
        assert_eq!(distinct.len(), third.len(), "no two nodes share a lineage");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn ids_survive_an_edit_above() {
        let source = std::fs::read_to_string(fixtures().join("sample.rs")).unwrap();
        let dir = project("ids", &[("src/sample.rs", &source)]);
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
        let before = ids(&graph(&dir).unwrap());
        std::fs::write(
            dir.join("src/sample.rs"),
            format!("// A new first line.\n\n{source}"),
        )
        .unwrap();
        assert_eq!(before, ids(&graph(&dir).unwrap()));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
