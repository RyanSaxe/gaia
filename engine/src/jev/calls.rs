//! Jev's calls. A `Call` builds one kind of request about a file or a directory
//! and its nodes: whether it applies, its part of the state, and its questions,
//! each naming its node and the field its answer fills. The link calls here,
//! `Resolve` and `Callee`, go first, and the understanding pass in `axes.rs`
//! runs after every link, sending `folders` top-down and then `files`, each
//! after its folder.

use crate::graph::model::{CodeGraph, DefNode, DirNode, FileNode, Node, PendingRef};
use crate::graph::walk::Snapshot;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::OnceLock;

use super::tokens::tokens;

/// One question, with the node it is about and where its answer goes:
/// a field of the node's `judged` such as "axes.readability", or "link"
/// for a pending reference.
pub struct Question {
    pub id: String,
    pub about: String,
    pub field: String,
    pub json: Value,
    /// The line it is about, for a question about a reference rather than a node,
    /// so the question goes with the piece of a long file that contains that line.
    pub line: Option<u32>,
}

/// What a request is about: a file, or a directory.
#[derive(Clone, Copy)]
pub enum Unit<'a> {
    File(&'a FileNode),
    Dir(&'a DirNode),
}

/// A block as a request lists it: its id, shape, first and last lines, and its definition's id.
pub type BlockRow<'a> = (&'a str, &'a str, u32, u32, &'a str);

/// The graph and what Jev already answered, indexed for building requests.
pub struct Ctx<'a> {
    /// The snapshot the graph was built from, so every request uses the same commit.
    pub snapshot: Snapshot,
    pub defs_of: HashMap<&'a str, Vec<&'a DefNode>>,
    pub blocks_of: HashMap<&'a str, Vec<BlockRow<'a>>>,
    /// Files each file imports, and files that import it.
    pub imports: HashMap<&'a str, Vec<&'a str>>,
    pub importers: HashMap<&'a str, Vec<&'a str>>,
    pub pending_of: HashMap<&'a str, Vec<&'a PendingRef>>,
    pub files_in: HashMap<&'a str, Vec<&'a FileNode>>,
    pub dirs_in: HashMap<&'a str, Vec<&'a DirNode>>,
    pub defs: HashMap<&'a str, &'a DefNode>,
    pub files: HashMap<&'a str, &'a FileNode>,
    pub lineage: HashMap<&'a str, &'a str>,
    /// Held answers by lineage, then field.
    pub held: HashMap<String, Map<String, Value>>,
    /// Where each definition is called or referenced from another file:
    /// the calling node and the line it's on.
    pub uses_of: HashMap<&'a str, Vec<(&'a str, u32)>>,
    /// The definitions in other files each definition calls.
    pub calls_out: HashMap<&'a str, Vec<&'a str>>,
}

/// The file a node id names or is in: `src/a.ts` for `file:src/a.ts` or `def:src/a.ts#f`.
fn file_part(id: &str) -> &str {
    let rest = id.split_once(':').map_or(id, |(_, r)| r);
    rest.split_once('#').map_or(rest, |(f, _)| f)
}

fn parent_dir(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

impl<'a> Ctx<'a> {
    pub fn new(graph: &'a CodeGraph, root: &'a Path, held: &Value) -> Self {
        let mut ctx = Ctx {
            snapshot: Snapshot::of(root),
            defs_of: HashMap::new(),
            blocks_of: HashMap::new(),
            imports: HashMap::new(),
            importers: HashMap::new(),
            pending_of: HashMap::new(),
            files_in: HashMap::new(),
            dirs_in: HashMap::new(),
            defs: HashMap::new(),
            files: HashMap::new(),
            lineage: HashMap::new(),
            held: HashMap::new(),
            uses_of: HashMap::new(),
            calls_out: HashMap::new(),
        };
        for e in graph.edges.iter().filter(|e| {
            matches!(e.kind, "calls" | "references" | "implements")
                && e.to.starts_with("def:")
                && file_part(&e.from) != file_part(&e.to)
        }) {
            if let Some(at) = &e.at {
                ctx.uses_of
                    .entry(e.to.as_str())
                    .or_default()
                    .push((e.from.as_str(), at.start));
            }
            if e.kind == "calls" {
                ctx.calls_out
                    .entry(e.from.as_str())
                    .or_default()
                    .push(e.to.as_str());
            }
        }
        for n in &graph.nodes {
            match n {
                Node::Def(d) => {
                    ctx.defs_of.entry(d.file.as_str()).or_default().push(d);
                    ctx.defs.insert(d.id.as_str(), d);
                    ctx.lineage.insert(d.id.as_str(), d.lineage.as_str());
                }
                Node::File(f) => {
                    ctx.files_in.entry(parent_dir(&f.path)).or_default().push(f);
                    ctx.files.insert(f.id.as_str(), f);
                    ctx.lineage.insert(f.id.as_str(), f.lineage.as_str());
                }
                Node::Dir(d) => {
                    if !d.path.is_empty() {
                        ctx.dirs_in.entry(parent_dir(&d.path)).or_default().push(d);
                    }
                    ctx.lineage.insert(d.id.as_str(), d.lineage.as_str());
                }
                Node::Block(b) => {
                    ctx.lineage.insert(b.id.as_str(), b.lineage.as_str());
                }
            }
        }
        for n in &graph.nodes {
            if let Node::Block(b) = n {
                let file = ctx
                    .defs
                    .get(b.def.as_str())
                    .map_or(b.def.as_str(), |d| d.file.as_str());
                let holder = b.def.split_once('#').map_or(b.def.as_str(), |(_, q)| q);
                ctx.blocks_of.entry(file).or_default().push((
                    b.id.as_str(),
                    b.shape.as_str(),
                    b.span.start,
                    b.span.end,
                    holder,
                ));
            }
        }
        let file_of = |defs: &HashMap<&'a str, &'a DefNode>, id: &'a str| -> &'a str {
            defs.get(id).map_or(id, |d| d.file.as_str())
        };
        for e in graph
            .edges
            .iter()
            .filter(|e| e.kind == "imports" && e.to.starts_with("file:"))
        {
            let from = file_of(&ctx.defs, e.from.as_str());
            if from != e.to {
                ctx.imports.entry(from).or_default().push(e.to.as_str());
                ctx.importers.entry(e.to.as_str()).or_default().push(from);
            }
        }
        for v in ctx.imports.values_mut().chain(ctx.importers.values_mut()) {
            v.sort_unstable();
            v.dedup();
        }
        for r in &graph.pending {
            let file = file_of(&ctx.defs, r.from.as_str());
            ctx.pending_of.entry(file).or_default().push(r);
        }
        for (key, value) in held.as_object().into_iter().flatten() {
            let mut parts = key.splitn(3, '|');
            if let (Some(l), Some(_), Some(field)) = (parts.next(), parts.next(), parts.next()) {
                ctx.held
                    .entry(l.to_string())
                    .or_default()
                    .insert(field.to_string(), value["answer"].clone());
            }
        }
        ctx
    }

    /// A file's definitions as an outline: their signatures, in source order.
    pub fn outline(&self, file: &str) -> Vec<Value> {
        self.defs_of
            .get(file)
            .map(|defs| defs.iter().map(|d| json!({ "name": d.name, "role": d.role, "lines": [d.span.start, d.span.end], "signature": d.signature })).collect())
            .unwrap_or_default()
    }

    /// A file's text from the snapshot, by its path.
    pub fn text(&self, path: &str) -> Option<std::sync::Arc<str>> {
        self.snapshot.text(path)
    }

    /// What Jev answered about a node, by field.
    pub fn answers(&self, id: &str) -> Option<&Map<String, Value>> {
        self.held.get(*self.lineage.get(id)?)
    }
}

pub trait Call: Sync {
    fn id(&self) -> &'static str;
    fn version(&self) -> String;
    fn pass(&self) -> &'static str;
    fn applies(&self, ctx: &Ctx, unit: Unit) -> bool;
    /// What it adds to the state, under its own id, within `budget` tokens.
    fn part(&self, ctx: &Ctx, unit: Unit, budget: usize) -> Option<Value>;
    fn questions(&self, ctx: &Ctx, unit: Unit) -> Vec<Question>;
}

/// A call's version: the first 4 bytes of the SHA-256 of its words in
/// `engine/vocab/`, and `code`, a number raised when the call's code changes. A
/// change to a call's words or code sends only that call's questions again.
fn version_of(vocab: &str, code: u32) -> String {
    let hash: String = Sha256::digest(vocab.as_bytes())
        .iter()
        .take(4)
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("{hash}-{code}")
}

/// A version from a vocabulary file's parsed words, so a change to its
/// comments or layout keeps every answer.
pub(super) fn vocab_version(vocab: &str, code: u32) -> String {
    let table: toml::Table = toml::from_str(vocab).unwrap_or_default();
    version_of(&toml::Value::Table(table).to_string(), code)
}

/// A version from one section of a vocabulary file, for calls that share the
/// file, so a change to one call's words keeps the other calls' answers.
fn section_version(vocab: &str, section: &str, code: u32) -> String {
    let table: toml::Table = toml::from_str(vocab).unwrap_or_default();
    let words = table
        .get(section)
        .map(ToString::to_string)
        .unwrap_or_default();
    version_of(&words, code)
}

fn choice(instructions: &str, options: &BTreeMap<String, String>) -> Value {
    json!({ "type": "choice", "instructions": instructions, "criteria": options })
}

/// The most tokens one question may take. It is a tenth of a request, so it
/// always fits beside a piece of source, which takes at most nine tenths.
pub const QUESTION_MOST: usize = 3_000;

/// How many leading path segments two node ids share, which measures how near a candidate is to the question's file.
fn nearness(a: &str, b: &str) -> usize {
    let path = |id: &str| -> Vec<String> {
        let rest = id.split_once(':').map_or(id, |(_, r)| r);
        let rest = rest.split('#').next().unwrap_or(rest);
        rest.split('/').map(str::to_string).collect()
    };
    path(a).iter().zip(path(b).iter()).take_while(|(x, y)| x == y).count()
}

/// A link question over `candidates`, each described by `words`, plus "outside". When the candidates don't all
/// fit in `QUESTION_MOST`, it offers as many as fit, nearest to the question's file first, so the question always
/// goes out.
fn link_choice(text: &str, file: &str, candidates: &[String], words: impl Fn(&String) -> String, outside: &str) -> Value {
    let all: BTreeMap<String, String> = candidates
        .iter()
        .map(|c| (c.clone(), words(c)))
        .chain(std::iter::once(("outside".to_string(), outside.to_string())))
        .collect();
    let whole = choice(text, &all);
    if tokens(&whole.to_string()) <= QUESTION_MOST {
        return whole;
    }
    let mut near: Vec<(usize, &String)> = candidates.iter().enumerate().collect();
    near.sort_by(|(i, a), (j, b)| nearness(file, b).cmp(&nearness(file, a)).then(i.cmp(j)));
    let nearest = |n: usize| {
        let options: BTreeMap<String, String> = near[..n]
            .iter()
            .map(|(_, c)| ((*c).clone(), words(c)))
            .chain(std::iter::once(("outside".to_string(), outside.to_string())))
            .collect();
        choice(text, &options)
    };
    // Binary search for how many of the nearest fit. A question with none fits, and one with all does not.
    let (mut fit, mut over) = (0, near.len());
    while fit + 1 < over {
        let n = (fit + over) / 2;
        if tokens(&nearest(n).to_string()) <= QUESTION_MOST {
            fit = n;
        } else {
            over = n;
        }
    }
    nearest(fit)
}

/// The given lines with `around` lines on each side, and "…" where lines are left out.
fn excerpt(lines: &[&str], at: &[usize], around: usize) -> String {
    let mut out: Vec<&str> = Vec::new();
    let mut next = 0;
    for &i in at {
        let start = i.saturating_sub(around).max(next);
        if start > next {
            out.push("…");
        }
        let end = (i + around + 1).min(lines.len());
        out.extend(&lines[start..end.max(start)]);
        next = next.max(end);
    }
    if next < lines.len() {
        out.push("…");
    }
    out.join("\n")
}

fn file_of<'a>(unit: Unit<'a>) -> Option<&'a FileNode> {
    match unit {
        Unit::File(f) => Some(f),
        Unit::Dir(_) => None,
    }
}

fn qualified(id: &str) -> &str {
    id.split_once('#').map_or(id, |(_, q)| q)
}

#[derive(Deserialize)]
struct LinkAsked {
    instructions: String,
    outside: String,
}
#[derive(Deserialize)]
struct LinkVocab {
    resolve: LinkAsked,
    callee: LinkAsked,
}
const LINK: &str = include_str!("../../vocab/link.toml");
fn link_vocab() -> &'static LinkVocab {
    static V: OnceLock<LinkVocab> = OnceLock::new();
    V.get_or_init(|| {
        toml::from_str(LINK).unwrap_or_else(|e| panic!("engine/vocab/link.toml parses: {e}"))
    })
}

/// A reference's question id within its file: its call, line and place.
fn ref_question(call: &str, r: &PendingRef, n: usize) -> String {
    format!("{call}:{}:{n}", r.at.start)
}

/// Which file a pending import resolves to.
pub struct Resolve;

impl Call for Resolve {
    fn id(&self) -> &'static str {
        "resolve"
    }
    fn version(&self) -> String {
        section_version(LINK, "resolve", 1)
    }
    fn pass(&self) -> &'static str {
        "link"
    }
    fn applies(&self, ctx: &Ctx, unit: Unit) -> bool {
        file_of(unit).is_some_and(|f| {
            ctx.pending_of
                .get(f.id.as_str())
                .into_iter()
                .flatten()
                .any(|r| r.kind == "import")
        })
    }
    fn part(&self, ctx: &Ctx, unit: Unit, budget: usize) -> Option<Value> {
        // The configuration in each candidate directory that names an import's
        // package, since it describes what that directory contains. It is whole
        // when it fits, or else only the lines that name the package.
        let file = file_of(unit)?;
        let imports: Vec<&PendingRef> = ctx
            .pending_of
            .get(file.id.as_str())
            .into_iter()
            .flatten()
            .copied()
            .filter(|r| r.kind == "import")
            .collect();
        let dirs: BTreeSet<&str> = imports
            .iter()
            .flat_map(|r| r.candidates.iter().filter_map(|c| c.strip_prefix("dir:")))
            .collect();
        let names: BTreeSet<String> = imports
            .iter()
            .flat_map(|r| crate::graph::leading_names(&r.text))
            .collect();
        let mut configs: Vec<Value> = Vec::new();
        let mut used = 0;
        for d in dirs {
            for f in ctx.files_in.get(d).into_iter().flatten().filter(|f| {
                matches!(f.language.as_deref(), Some("json" | "toml" | "yaml") | None) && !f.binary
            }) {
                let Some(text) = ctx.text(&f.path) else {
                    continue;
                };
                let lines: Vec<&str> = text.lines().collect();
                let naming: Vec<usize> = (0..lines.len())
                    .filter(|&i| names.iter().any(|n| crate::graph::mentions(lines[i], n)))
                    .collect();
                if naming.is_empty() {
                    continue;
                }
                let shown = if used + tokens(&text) <= budget {
                    text.to_string()
                } else {
                    // Each naming line goes with the line that opens its enclosing
                    // key, so a dependency entry reads as a whole.
                    let keys = ctx.defs_of.get(f.id.as_str()).into_iter().flatten();
                    let mut at: BTreeSet<usize> = naming.iter().copied().collect();
                    for d in keys {
                        let (start, end) = (d.span.start as usize - 1, d.span.end as usize - 1);
                        if naming.iter().any(|&i| start < i && i <= end) {
                            at.insert(start);
                        }
                    }
                    excerpt(&lines, &at.into_iter().collect::<Vec<_>>(), 2)
                };
                let size = tokens(&shown);
                if used + size > budget {
                    continue;
                }
                used += size;
                configs.push(json!({ "path": f.path, "text": shown }));
            }
        }
        Some(json!({ "configuration": configs }))
    }
    fn questions(&self, ctx: &Ctx, unit: Unit) -> Vec<Question> {
        let Some(file) = file_of(unit) else {
            return Vec::new();
        };
        let v = &link_vocab().resolve;
        ctx.pending_of
            .get(file.id.as_str())
            .into_iter()
            .flatten()
            .filter(|r| r.kind == "import")
            .enumerate()
            .map(|(n, r)| {
                let words = |c: &String| {
                    let path = c.trim_start_matches("file:").trim_start_matches("dir:");
                    if path.is_empty() {
                        "The repository's root directory".to_string()
                    } else {
                        format!("{path} in this repository")
                    }
                };
                let text = v
                    .instructions
                    .replace("{text}", &r.text)
                    .replace("{line}", &r.at.start.to_string());
                Question {
                    id: ref_question("resolve", r, n),
                    about: crate::graph::ref_key(r),
                    field: "link".into(),
                    json: link_choice(&text, &file.id, &r.candidates, words, &v.outside),
                    line: Some(r.at.start),
                }
            })
            .collect()
    }
}

/// Which definition a pending call resolves to.
pub struct Callee;

impl Call for Callee {
    fn id(&self) -> &'static str {
        "callee"
    }
    fn version(&self) -> String {
        section_version(LINK, "callee", 1)
    }
    fn pass(&self) -> &'static str {
        "link"
    }
    fn applies(&self, ctx: &Ctx, unit: Unit) -> bool {
        file_of(unit).is_some_and(|f| {
            ctx.pending_of
                .get(f.id.as_str())
                .into_iter()
                .flatten()
                .any(|r| r.kind == "call")
        })
    }
    fn part(&self, _: &Ctx, _: Unit, _: usize) -> Option<Value> {
        None
    }
    fn questions(&self, ctx: &Ctx, unit: Unit) -> Vec<Question> {
        let Some(file) = file_of(unit) else {
            return Vec::new();
        };
        let v = &link_vocab().callee;
        ctx.pending_of
            .get(file.id.as_str())
            .into_iter()
            .flatten()
            .filter(|r| r.kind == "call")
            .enumerate()
            .map(|(n, r)| {
                let words = |c: &String| {
                    ctx.defs.get(c.as_str()).map_or_else(
                        || c.clone(),
                        |d| {
                            format!(
                                "`{}` in {}: {}",
                                qualified(&d.id),
                                d.file.trim_start_matches("file:"),
                                d.signature
                            )
                        },
                    )
                };
                let text = v
                    .instructions
                    .replace("{text}", &r.text)
                    .replace("{line}", &r.at.start.to_string());
                Question {
                    id: ref_question("callee", r, n),
                    about: crate::graph::ref_key(r),
                    field: "link".into(),
                    json: link_choice(&text, &file.id, &r.candidates, words, &v.outside),
                    line: Some(r.at.start),
                }
            })
            .collect()
    }
}

/// Every call, in the order their parts go into a state.
pub fn registry() -> Vec<&'static dyn Call> {
    vec![
        &Resolve,
        &Callee,
        &super::axes::FolderAxes,
        &super::axes::FileAxes,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A vocabulary's version follows its words, not its comments or layout.
    #[test]
    fn a_vocabulary_s_version_follows_its_words_not_its_comments() {
        let words = "[a]\nx = \"one\"\n";
        let commented = "# Why a is here.\n[a]\n\n# A note.\nx   =   \"one\" # trailing\n";
        assert_eq!(vocab_version(words, 1), vocab_version(commented, 1));
        assert_ne!(vocab_version(words, 1), vocab_version("[a]\nx = \"two\"\n", 1));
        assert_ne!(vocab_version(words, 1), vocab_version(words, 2));
    }

    /// Every call's vocabulary parses, every question has options or levels,
    /// and every answer goes to a field the graph has.
    #[test]
    fn every_call_s_words_parse_and_its_answers_go_to_fields_the_graph_has() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/languages");
        let graph = crate::graph::build(&root).unwrap();
        let held = json!({});
        let ctx = Ctx::new(&graph, &root, &held);
        let mut asked = 0;
        for call in registry() {
            assert!(!call.version().is_empty(), "{} has a version", call.id());
            for n in &graph.nodes {
                let unit = match n {
                    Node::File(f) => Unit::File(f),
                    Node::Dir(d) => Unit::Dir(d),
                    _ => continue,
                };
                if !call.applies(&ctx, unit) {
                    continue;
                }
                for q in call.questions(&ctx, unit) {
                    asked += 1;
                    match q.json["type"].as_str() {
                        Some("choice") => assert!(
                            !q.json["criteria"].as_object().unwrap().is_empty(),
                            "{} offers options",
                            q.id
                        ),
                        Some("score") => {
                            let levels = q.json["criteria"].as_array().unwrap().len();
                            assert!(
                                (4..=5).contains(&levels),
                                "{} has four or five levels",
                                q.id
                            );
                        }
                        other => panic!("{} has an unknown type {other:?}", q.id),
                    }
                    let known = q.field == "link"
                        || ["axes.", "picks.", "more."]
                            .iter()
                            .any(|p| q.field.starts_with(p));
                    assert!(
                        known,
                        "{}'s answer goes to a field the graph has: {}",
                        q.id, q.field
                    );
                }
            }
        }
        assert!(asked > 0);
    }

    #[test]
    fn a_link_question_with_thousands_of_candidates_offers_the_nearest_that_fit() {
        let candidates: Vec<String> = (0..5000).map(|i| format!("file:packages/p{i}/src/index.ts")).collect();
        let words = |c: &String| format!("{c} in this repository");
        let asked = "Which file does `../index` on line 3 import?";
        let q = link_choice(asked, "file:packages/p4321/src/a.ts", &candidates, words, "Outside this repository");
        assert!(tokens(&q.to_string()) <= QUESTION_MOST);
        let offered = q["criteria"].as_object().unwrap();
        assert!(offered.contains_key("outside"));
        assert!(offered.contains_key("file:packages/p4321/src/index.ts"), "the nearest candidate is offered");
        assert!(offered.len() > 10);
        // A question that fits offers every candidate.
        let few = link_choice(asked, "file:packages/p1/src/a.ts", &candidates[..3], words, "Outside this repository");
        assert_eq!(few["criteria"].as_object().unwrap().len(), 4);
    }
}
