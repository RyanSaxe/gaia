//! `project.graph`: walks a project, parses every file its language table
//! knows through tree-sitter, measures what the parse can count, reads
//! history from git, and returns the code graph
//! (`packages/schema/src/graph.ts`). Imports and calls go out pending;
//! the rules that resolve them come next.

pub mod git;
mod languages;
mod lineage;
pub mod model;
mod parse;
mod reach;
mod resolve;
pub mod walk;

use model::{
    BlockNode, CodeGraph, DefNode, DirNode, Edge, FileNode, Filled, History, Measures, Node,
};
use parse::FileParse;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
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

/// A placeholder until lineage matching (`lineage.rs`) gives every node its own.
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
        at: None,
    }
}

/// Builds the code graph of the project at `root`.
pub fn build(root: &Path) -> Result<CodeGraph, String> {
    build_with(root, &lineage::Store)
}

/// Builds the graph, matching lineage against the record `keeper` holds.
fn build_with(root: &Path, keeper: &dyn lineage::Keeper) -> Result<CodeGraph, String> {
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
    let mut all_def_ids: Vec<Vec<String>> = vec![Vec::new(); files.len()];
    for (dir, lines) in &dir_lines {
        let id = format!("dir:{dir}");
        if !dir.is_empty() {
            edges.push(contains_edge(&format!("dir:{}", parent_dir(dir)), &id));
        }
        nodes.push(Node::Dir(DirNode {
            lineage: fresh_lineage(&id),
            judged: None,
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
            judged: None,
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
                judged: None,
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

    // The rules: imports, calls, references and names, by rule or pending.
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
    let resolved = resolve::run(&units, &dirs);
    edges.extend(resolved.edges);
    let walked: HashSet<&str> = files.iter().map(|f| f.path.as_str()).collect();
    let commit_files: Vec<Vec<String>> = commits.into_iter().map(|c| c.files).collect();
    edges.extend(reach::changes_with(&commit_files, &walked));

    // What the edges imply for each node.
    let mut items: Vec<reach::Item> = Vec::new();
    let mut bodies: Vec<reach::Body> = Vec::new();
    for (k, (f, p)) in files.iter().zip(&parsed).enumerate() {
        items.push(reach::Item {
            id: format!("file:{}", f.path),
            file: k,
            is_file: true,
        });
        let Some(p) = p else { continue };
        for (d, id) in p.defs.iter().zip(&all_def_ids[k]) {
            items.push(reach::Item {
                id: id.clone(),
                file: k,
                is_file: false,
            });
            if d.callable && d.shingles >= reach::MIN_SHINGLES {
                bodies.push(reach::Body {
                    id,
                    file: k,
                    start: d.span.start,
                    end: d.span.end,
                    fingerprint: &d.fingerprint,
                });
            }
        }
    }
    let file_dirs: Vec<String> = files
        .iter()
        .map(|f| parent_dir(&f.path).to_string())
        .collect();
    let reaches = reach::reach(&items, &file_dirs, &dirs, &edges);
    let calls_out = reach::calls_out(&edges);
    let mut duplicates = reach::duplicates(&bodies);
    for n in &mut nodes {
        match n {
            Node::Dir(d) => d.measures.reach = reaches.get(&d.id).copied(),
            Node::File(f) => f.measures.reach = reaches.get(&f.id).copied(),
            Node::Def(d) => {
                d.measures.reach = reaches.get(&d.id).copied();
                if d.measures.params.is_some() {
                    d.measures.calls_out = Some(calls_out.get(&d.id).copied().unwrap_or(0));
                }
                d.measures.duplicates = duplicates.remove(&d.id);
            }
            Node::Block(_) => {}
        }
    }
    let pending = resolved.pending;

    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let project_id = git::root_commit(root)
        .unwrap_or_else(|| walk::content_hash(canonical.to_string_lossy().as_bytes()));

    // Lineage, matched against the last graph this project kept.
    let commit = git::head(root);
    let previous = keeper.load(&project_id);
    let renames = match (
        previous.as_ref().and_then(|p| p.commit.as_deref()),
        commit.as_deref(),
    ) {
        (Some(from), Some(to)) if from != to => git::renames(root, from, to),
        _ => None,
    };
    let current = lineage::Current {
        commit,
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
                    .map(|t| parse::fingerprint(t).0)
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
            // A block follows its holder: its lineage is its holder's and its place there.
            Node::Block(b) => {
                let index = b.id.rsplit('/').next().unwrap_or("0");
                b.lineage =
                    walk::content_hash(format!("{}/{index}", lineage_of(&b.def)).as_bytes());
            }
        }
    }
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
        build_with(root, &Memory::default())
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
                // An import or call may resolve, go pending or lie outside, so the parse is checked.
                let kind = match capture {
                    "reference.import" => parse::RefKind::Import,
                    "reference.call" | "reference.send" => parse::RefKind::Call,
                    _ => continue,
                };
                let text = std::fs::read_to_string(fixtures().join(&file.path)).unwrap();
                let parsed = parse::parse(&loaded, &text).unwrap();
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
        // With its tags query, Lua's definitions and calls come from it; without, from node kinds.
        for (tags, walk_name) in [(Some(tags.as_str()), "walk"), (None, "M.walk")] {
            let loaded = languages::from_wasm("lua", &wasm, tags).unwrap();
            let p = parse::parse(&loaded, src).unwrap();
            assert_eq!(p.unparsed, 0);
            let walk = p
                .defs
                .iter()
                .find(|d| d.name == walk_name)
                .unwrap_or_else(|| panic!("{walk_name} is a definition"));
            assert_eq!(walk.doc.as_deref(), Some("Walks names."));
            assert_eq!(walk.measures.params, Some(2));
            // for (1), if nested once (2), `and` (1), elseif (1), else (1).
            assert_eq!(walk.measures.cognitive, Some(6));
            assert_eq!(walk.measures.cyclomatic, Some(5));
            assert_eq!(p.defs.len(), 2, "M.walk and M:size");
            let shapes: BTreeSet<&str> = p.blocks.iter().map(|b| b.shape.as_str()).collect();
            assert!(shapes.contains("loop") && shapes.contains("branch"));
            if tags.is_some() {
                assert!(
                    p.refs
                        .iter()
                        .any(|r| r.kind == parse::RefKind::Call && r.text == "helper")
                );
            }
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
        let body = "  const parts = [];\n  for (const p of input.split(\"/\")) {\n    if (p.length > 0) {\n      parts.push(p.trim());\n    }\n  }\n  return parts.join(\"-\");\n";
        let dir = project(
            "rules",
            &[
                (
                    "package.json",
                    "{ \"name\": \"demo\", \"main\": \"src/a.ts\", \"dependencies\": { \"react\": \"19\" } }\n",
                ),
                (
                    "src/a.ts",
                    &format!(
                        "import {{ helper, Tool }} from \"./b\";\nimport {{ widget }} from \"./widgets\";\nimport React from \"react\";\nimport _ from \"lodash\";\n\nexport function caller(obj: unknown) {{\n  helper();\n  obj.render();\n  widget();\n}}\n\nexport function slugA(input: string) {{\n{body}}}\n"
                    ),
                ),
                (
                    "src/b.ts",
                    &format!(
                        "export function helper() {{\n  return 1;\n}}\n\nexport class Tool {{\n  render() {{\n    return this.size();\n  }}\n  size() {{\n    return 2;\n  }}\n}}\n\nexport function outer() {{\n  const inner = () => 3;\n  return inner();\n}}\n\nexport function slugB(input: string) {{\n{body}}}\n"
                    ),
                ),
                (
                    "src/widgets/index.ts",
                    "export function widget() {\n  return inner();\n}\n",
                ),
                (
                    "src/main.rs",
                    "use crate::util::Tool;\n\nfn main() {\n    let t = Tool::new();\n    let s = format!(\"{}\", 1);\n}\n",
                ),
                (
                    "src/util.rs",
                    "pub struct Tool;\n\nimpl Tool {\n    pub fn new() -> Self {\n        Tool\n    }\n}\n\npub fn format(x: u8) -> u8 {\n    x\n}\n",
                ),
                (
                    "pkg/sub/a.py",
                    "from .b import f\nfrom ..top import g\n\n\ndef run():\n    return f() + g()\n",
                ),
                ("pkg/sub/b.py", "def f():\n    return 1\n"),
                ("pkg/top.py", "def g():\n    return 2\n"),
            ],
        );
        let g = graph(&dir).unwrap();
        let edge = |from: &str, to: &str, kind: &str| {
            g.edges
                .iter()
                .any(|e| e.from == from && e.to == to && e.kind == kind)
        };
        // Imports: relative forms resolve, a directory is its own node, and a
        // package a configuration names goes to Jev with that configuration's directory.
        assert!(edge("file:src/a.ts", "file:src/b.ts", "imports"));
        assert!(edge("file:src/a.ts", "dir:src/widgets", "imports"));
        assert!(edge("file:src/main.rs", "file:src/util.rs", "imports"));
        assert!(edge("file:pkg/sub/a.py", "file:pkg/sub/b.py", "imports"));
        assert!(edge("file:pkg/sub/a.py", "file:pkg/top.py", "imports"));
        let react = g
            .pending
            .iter()
            .find(|p| p.text == "react")
            .expect("react goes to Jev");
        assert_eq!(react.candidates, vec!["dir:".to_string()]);
        assert!(
            !g.pending.iter().any(|p| p.text == "lodash"),
            "nothing names lodash, so it is outside"
        );
        // Calls: one target by rule; an owner or `this` narrows; a receiver
        // the rule cannot place goes to Jev; a function's locals stay local;
        // a macro reaches only a macro.
        assert!(edge("def:src/a.ts#caller", "def:src/b.ts#helper", "calls"));
        assert!(edge(
            "def:src/a.ts#caller",
            "def:src/widgets/index.ts#widget",
            "calls"
        ));
        assert!(edge(
            "def:src/b.ts#Tool.render",
            "def:src/b.ts#Tool.size",
            "calls"
        ));
        assert!(edge(
            "def:src/b.ts#outer",
            "def:src/b.ts#outer.inner",
            "calls"
        ));
        assert!(edge(
            "def:src/main.rs#main",
            "def:src/util.rs#Tool.new",
            "calls"
        ));
        assert!(edge("def:pkg/sub/a.py#run", "def:pkg/sub/b.py#f", "calls"));
        let render = g
            .pending
            .iter()
            .find(|p| p.text == "render")
            .expect("obj.render goes to Jev");
        assert_eq!(
            render.candidates,
            vec!["def:src/b.ts#Tool.render".to_string()]
        );
        assert!(
            !g.edges
                .iter()
                .any(|e| e.from == "def:src/widgets/index.ts#widget" && e.kind == "calls")
        );
        assert!(
            !g.edges
                .iter()
                .any(|e| e.to == "def:src/util.rs#format" && e.kind == "calls")
        );
        // A literal that spells out a path names it, from the key that holds it.
        assert!(edge("def:package.json#main", "file:src/a.ts", "names"));
        // Reach, calls out and near-duplicates follow from the edges.
        let defs = defs(&g);
        assert_eq!(
            defs["def:src/b.ts#helper"]
                .measures
                .reach
                .map(|r| (r.files, r.defs)),
            Some((1, 1))
        );
        assert_eq!(defs["def:src/a.ts#caller"].measures.calls_out, Some(2));
        assert_eq!(
            defs["def:src/a.ts#slugA"].measures.duplicates,
            Some(vec!["def:src/b.ts#slugB".to_string()])
        );
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
        let first = lineage(&build_with(&dir, &keeper).unwrap());

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
        let second = lineage(&build_with(&dir, &keeper).unwrap());
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

        // A file split in two: the larger part keeps the file's lineage.
        std::fs::remove_file(dir.join("src/walk.ts")).unwrap();
        std::fs::create_dir_all(dir.join("src/walk")).unwrap();
        std::fs::write(dir.join("src/walk/core.ts"), walk).unwrap();
        std::fs::write(dir.join("src/walk/list.ts"), list).unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-q", "-m", "three"]);
        let third = lineage(&build_with(&dir, &keeper).unwrap());
        assert_eq!(
            third.get("def:src/walk/core.ts#walk"),
            first.get("def:lib/walk.ts#walk")
        );
        assert_eq!(
            third.get("def:src/walk/list.ts#list"),
            first.get("def:lib/walk.ts#list")
        );
        let kept = [
            third.get("file:src/walk/core.ts"),
            third.get("file:src/walk/list.ts"),
        ];
        assert!(
            kept.contains(&first.get("file:lib/walk.ts")),
            "one part of the split keeps walk.ts's lineage"
        );
        let distinct: HashSet<&String> = third.values().collect();
        assert_eq!(distinct.len(), third.len(), "no two nodes share a lineage");
        std::fs::remove_dir_all(dir).unwrap();
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
        let g = graph(&dir).unwrap();
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
        let g = graph(&fixtures()).unwrap();
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
        let before = ids(&graph(&dir).unwrap());
        std::fs::write(
            dir.join("src/sample.rs"),
            format!("// A new first line.\n\n{source}"),
        )
        .unwrap();
        let after = graph(&dir).unwrap();
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
