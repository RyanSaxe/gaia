//! Jev's calls. Each call asks one kind of question about a file or a
//! directory and the nodes in it: whether it applies, what it adds to the
//! state, and its questions, each naming the node it is about and where
//! its answer goes. A call's words live in its vocabulary file in
//! `engine/vocab/`, and its version is that file's hash and a number bumped
//! when its code changes, so a new word asks again only what that call
//! answered.
//!
//! The passes say what waits for what: `link` (resolve, callee) goes first;
//! `understand` (profile, quality, importance, screen, attention) waits for
//! every link, because importance reads reach; `tests` (checks) waits for a
//! file's kind; `deep` (definition, block) waits for the world's choice;
//! `dirs` (directory) waits for everything under each directory.

use crate::graph::model::{CodeGraph, DefNode, DirNode, FileNode, Node, PendingRef};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::OnceLock;

use super::tokens::tokens;

/// One question, with the node it is about and where its answer goes:
/// a field of the node's `judged` such as "kind" or "quality.readability",
/// "link" for a pending reference, or "checks:<path>" for a test.
pub struct Question {
    pub id: String,
    pub about: String,
    pub field: String,
    pub json: Value,
    /// The line it is about, for a question about a reference rather than a node,
    /// so a long file's piece holding that line carries it.
    pub line: Option<u32>,
}

/// What a request is about: a file, or a directory.
#[derive(Clone, Copy)]
pub enum Unit<'a> {
    File(&'a FileNode),
    Dir(&'a DirNode),
}

/// A block as a request names it: its id, shape, first and last lines, and the definition holding it.
pub type BlockRow<'a> = (&'a str, &'a str, u32, u32, &'a str);

/// The graph and what Jev already answered, indexed for building requests.
pub struct Ctx<'a> {
    pub root: &'a Path,
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
    /// The nodes the world chose to stand.
    pub deep: &'a BTreeSet<String>,
}

fn parent_dir(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

impl<'a> Ctx<'a> {
    pub fn new(
        graph: &'a CodeGraph,
        root: &'a Path,
        held: &Value,
        deep: &'a BTreeSet<String>,
    ) -> Self {
        let mut ctx = Ctx {
            root,
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
            deep,
        };
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

    /// What Jev answered about a node, by field.
    pub fn answers(&self, id: &str) -> Option<&Map<String, Value>> {
        self.held.get(*self.lineage.get(id)?)
    }

    fn reach_words(&self, files: u32, defs: u32) -> String {
        match (files, defs) {
            (0, 0) => "Nothing else in the repository uses it.".into(),
            (f, d) => format!("{d} definitions in {f} other files depend on it, directly or not."),
        }
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

fn version_of(vocab: &str, code: u32) -> String {
    let hash: String = Sha256::digest(vocab.as_bytes())
        .iter()
        .take(4)
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("{hash}-{code}")
}

fn choice(instructions: &str, options: &BTreeMap<String, String>) -> Value {
    json!({ "type": "choice", "instructions": instructions, "criteria": options })
}

fn yes_no(instructions: &str, yes: &str, no: &str) -> Value {
    json!({ "type": "noul", "instructions": instructions, "criteria": { "true": yes, "false": no } })
}

fn score(instructions: &str, levels: &[String]) -> Value {
    json!({ "type": "score", "instructions": instructions, "criteria": levels })
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

/// The words that name a definition in a question: "`Batch.push`, on lines 12 to 30".
fn about_def(d: &DefNode) -> [(&'static str, String); 3] {
    [
        ("{name}", qualified(&d.id).to_string()),
        ("{start}", d.span.start.to_string()),
        ("{end}", d.span.end.to_string()),
    ]
}

fn fill(text: &str, words: &[(&str, String)]) -> String {
    words
        .iter()
        .fold(text.to_string(), |t, (k, v)| t.replace(k, v))
}

#[derive(Deserialize)]
struct Asked {
    instructions: String,
    #[serde(default)]
    options: BTreeMap<String, String>,
    #[serde(default)]
    levels: Vec<String>,
    #[serde(default)]
    yes: String,
    #[serde(default)]
    no: String,
}

fn vocab<T: for<'de> Deserialize<'de>>(
    cell: &'static OnceLock<T>,
    text: &str,
    name: &str,
) -> &'static T {
    cell.get_or_init(|| {
        toml::from_str(text).unwrap_or_else(|e| panic!("engine/vocab/{name}.toml parses: {e}"))
    })
}

// --- profile -------------------------------------------------------------

#[derive(Deserialize)]
struct ProfileVocab {
    kind: Asked,
    does: Asked,
    needs_tests: Asked,
    dead: Asked,
}
const PROFILE: &str = include_str!("../../vocab/profile.toml");
fn profile_vocab() -> &'static ProfileVocab {
    static V: OnceLock<ProfileVocab> = OnceLock::new();
    vocab(&V, PROFILE, "profile")
}

/// What kind of file this is, what it does, whether it needs tests of its
/// own, and, when nothing in the repository reaches it, whether it is dead.
pub struct Profile;

impl Call for Profile {
    fn id(&self) -> &'static str {
        "profile"
    }
    fn version(&self) -> String {
        version_of(PROFILE, 1)
    }
    fn pass(&self) -> &'static str {
        "understand"
    }
    fn applies(&self, _: &Ctx, unit: Unit) -> bool {
        file_of(unit).is_some_and(|f| !f.binary)
    }
    fn part(&self, ctx: &Ctx, unit: Unit, budget: usize) -> Option<Value> {
        let file = file_of(unit)?;
        // Outlines of the files it imports and that import it, until the budget is spent.
        let mut neighbours: Vec<Value> = Vec::new();
        let mut used = 0;
        let near = ctx
            .imports
            .get(file.id.as_str())
            .into_iter()
            .flatten()
            .chain(ctx.importers.get(file.id.as_str()).into_iter().flatten());
        for other in near {
            let entry = json!({ "path": other.trim_start_matches("file:"), "definitions": ctx.outline(other).iter().map(|d| d["signature"].clone()).collect::<Vec<_>>() });
            used += tokens(&entry.to_string());
            if used > budget {
                break;
            }
            neighbours.push(entry);
        }
        Some(json!({ "neighbours": neighbours }))
    }
    fn questions(&self, _: &Ctx, unit: Unit) -> Vec<Question> {
        let Some(file) = file_of(unit) else {
            return Vec::new();
        };
        let v = profile_vocab();
        let about = || file.id.clone();
        let mut out = vec![Question {
            id: "profile:kind".into(),
            about: about(),
            field: "kind".into(),
            json: choice(&v.kind.instructions, &v.kind.options),
            line: None,
        }];
        for (key, what) in &v.does.options {
            out.push(Question {
                id: format!("profile:does:{key}"),
                about: about(),
                field: format!("does.{key}"),
                json: yes_no(
                    &v.does.instructions.replace("{what}", what),
                    &v.does.yes,
                    &v.does.no,
                ),
                line: None,
            });
        }
        out.push(Question {
            id: "profile:needsTests".into(),
            about: about(),
            field: "needsTests".into(),
            json: yes_no(
                &v.needs_tests.instructions,
                &v.needs_tests.yes,
                &v.needs_tests.no,
            ),
            line: None,
        });
        if file
            .measures
            .reach
            .is_some_and(|r| r.files == 0 && r.defs == 0)
        {
            out.push(Question {
                id: "profile:dead".into(),
                about: about(),
                field: "dead".into(),
                json: yes_no(&v.dead.instructions, &v.dead.yes, &v.dead.no),
                line: None,
            });
        }
        out
    }
}

// --- screen --------------------------------------------------------------

#[derive(Deserialize)]
struct ScreenVocab {
    stand: StandVocab,
}
#[derive(Deserialize)]
struct StandVocab {
    file: String,
    dir: String,
    def: String,
    block: String,
    levels: Vec<String>,
}
const SCREEN: &str = include_str!("../../vocab/screen.toml");
fn screen_vocab() -> &'static StandVocab {
    static V: OnceLock<ScreenVocab> = OnceLock::new();
    &vocab(&V, SCREEN, "screen").stand
}

/// How much the file, each definition and each block deserves to stand on its own.
pub struct Screen;

impl Call for Screen {
    fn id(&self) -> &'static str {
        "screen"
    }
    fn version(&self) -> String {
        version_of(SCREEN, 1)
    }
    fn pass(&self) -> &'static str {
        "understand"
    }
    fn applies(&self, _: &Ctx, unit: Unit) -> bool {
        file_of(unit).is_some_and(|f| !f.binary)
    }
    fn part(&self, _: &Ctx, _: Unit, _: usize) -> Option<Value> {
        None
    }
    fn questions(&self, ctx: &Ctx, unit: Unit) -> Vec<Question> {
        let Some(file) = file_of(unit) else {
            return Vec::new();
        };
        let v = screen_vocab();
        let mut out = vec![Question {
            id: "screen:file".into(),
            about: file.id.clone(),
            field: "stand".into(),
            json: score(&v.file, &v.levels),
            line: None,
        }];
        for d in ctx.defs_of.get(file.id.as_str()).into_iter().flatten() {
            out.push(Question {
                id: format!("screen:def:{}", qualified(&d.id)),
                about: d.id.clone(),
                field: "stand".into(),
                json: score(&fill(&v.def, &about_def(d)), &v.levels),
                line: None,
            });
        }
        for (id, shape, start, end, holder) in
            ctx.blocks_of.get(file.id.as_str()).into_iter().flatten()
        {
            out.push(Question {
                id: format!("screen:block:{}", block_local(id)),
                about: id.to_string(),
                field: "stand".into(),
                json: score(
                    &fill(&v.block, &about_block(shape, *start, *end, holder)),
                    &v.levels,
                ),
                line: None,
            });
        }
        out
    }
}

/// A block's id within its file: its holder's qualified name and its place.
fn block_local(id: &str) -> String {
    let rest = id.trim_start_matches("block:");
    match rest.split_once('#') {
        Some((_, q)) => q.to_string(),
        None => format!("file/{}", rest.rsplit('/').next().unwrap_or("0")),
    }
}

fn about_block(shape: &str, start: u32, end: u32, holder: &str) -> [(&'static str, String); 4] {
    [
        ("{shape}", shape.to_string()),
        ("{start}", start.to_string()),
        ("{end}", end.to_string()),
        ("{holder}", holder.to_string()),
    ]
}

// --- quality, importance, attention, roles --------------------------------

#[derive(Deserialize)]
struct QualityVocab {
    file: FileQuality,
    def: DefQuality,
    block: BlockQuality,
}
#[derive(Deserialize)]
struct FileQuality {
    naming: Asked,
    cohesion: Asked,
}
#[derive(Deserialize)]
struct DefQuality {
    readability: Asked,
    naming: Asked,
    doc: Asked,
    errors: Asked,
    change: Asked,
}
#[derive(Deserialize)]
struct BlockQuality {
    readability: Asked,
}
const QUALITY: &str = include_str!("../../vocab/quality.toml");
fn quality_vocab() -> &'static QualityVocab {
    static V: OnceLock<QualityVocab> = OnceLock::new();
    vocab(&V, QUALITY, "quality")
}

#[derive(Deserialize)]
struct ImportanceVocab {
    breaks: Asked,
    central: Asked,
}
const IMPORTANCE: &str = include_str!("../../vocab/importance.toml");
fn importance_vocab() -> &'static ImportanceVocab {
    static V: OnceLock<ImportanceVocab> = OnceLock::new();
    vocab(&V, IMPORTANCE, "importance")
}

const ATTENTION: &str = include_str!("../../vocab/attention.toml");
fn attention_vocab() -> &'static Asked {
    static V: OnceLock<Asked> = OnceLock::new();
    vocab(&V, ATTENTION, "attention")
}

#[derive(Deserialize)]
struct RolesVocab {
    def: Asked,
    block: Asked,
}
const ROLES: &str = include_str!("../../vocab/roles.toml");
fn roles_vocab() -> &'static RolesVocab {
    static V: OnceLock<RolesVocab> = OnceLock::new();
    vocab(&V, ROLES, "roles")
}

/// Breaks and central for one node, named in words.
fn importance_questions(prefix: &str, about: &str, what: &str) -> Vec<Question> {
    let v = importance_vocab();
    vec![
        Question {
            id: format!("{prefix}:breaks"),
            about: about.into(),
            field: "importance.breaks".into(),
            json: score(
                &v.breaks.instructions.replace("{what}", what),
                &v.breaks.levels,
            ),
            line: None,
        },
        Question {
            id: format!("{prefix}:central"),
            about: about.into(),
            field: "importance.central".into(),
            json: score(
                &v.central.instructions.replace("{what}", what),
                &v.central.levels,
            ),
            line: None,
        },
    ]
}

fn attention_question(id: String, about: &str, what: &str) -> Question {
    let v = attention_vocab();
    Question {
        id,
        about: about.into(),
        field: "attention".into(),
        json: choice(&v.instructions.replace("{what}", what), &v.options),
        line: None,
    }
}

/// How well a file is named and how much it holds one concern.
pub struct Quality;

impl Call for Quality {
    fn id(&self) -> &'static str {
        "quality"
    }
    fn version(&self) -> String {
        version_of(QUALITY, 1)
    }
    fn pass(&self) -> &'static str {
        "understand"
    }
    fn applies(&self, _: &Ctx, unit: Unit) -> bool {
        file_of(unit).is_some_and(|f| !f.binary)
    }
    fn part(&self, _: &Ctx, _: Unit, _: usize) -> Option<Value> {
        None
    }
    fn questions(&self, _: &Ctx, unit: Unit) -> Vec<Question> {
        let Some(file) = file_of(unit) else {
            return Vec::new();
        };
        let v = &quality_vocab().file;
        vec![
            Question {
                id: "quality:naming".into(),
                about: file.id.clone(),
                field: "quality.naming".into(),
                json: score(&v.naming.instructions, &v.naming.levels),
                line: None,
            },
            Question {
                id: "quality:cohesion".into(),
                about: file.id.clone(),
                field: "quality.cohesion".into(),
                json: score(&v.cohesion.instructions, &v.cohesion.levels),
                line: None,
            },
        ]
    }
}

/// How much a subtle bug in a file would break, and how central it is, with its reach in words.
pub struct Importance;

impl Call for Importance {
    fn id(&self) -> &'static str {
        "importance"
    }
    fn version(&self) -> String {
        version_of(IMPORTANCE, 1)
    }
    fn pass(&self) -> &'static str {
        "understand"
    }
    fn applies(&self, _: &Ctx, unit: Unit) -> bool {
        file_of(unit).is_some_and(|f| !f.binary)
    }
    fn part(&self, ctx: &Ctx, unit: Unit, budget: usize) -> Option<Value> {
        let file = file_of(unit)?;
        let reach = file.measures.reach.unwrap_or_default();
        let mut importers: Vec<&str> = Vec::new();
        let mut used = 0;
        for i in ctx.importers.get(file.id.as_str()).into_iter().flatten() {
            used += tokens(i) + 1;
            if used > budget {
                break;
            }
            importers.push(i.trim_start_matches("file:"));
        }
        Some(json!({ "reach": ctx.reach_words(reach.files, reach.defs), "importedBy": importers }))
    }
    fn questions(&self, _: &Ctx, unit: Unit) -> Vec<Question> {
        let Some(file) = file_of(unit) else {
            return Vec::new();
        };
        importance_questions("importance", &file.id, "this file")
    }
}

/// Why a person should look at a file, with routine as one option.
pub struct Attention;

impl Call for Attention {
    fn id(&self) -> &'static str {
        "attention"
    }
    fn version(&self) -> String {
        version_of(ATTENTION, 1)
    }
    fn pass(&self) -> &'static str {
        "understand"
    }
    fn applies(&self, _: &Ctx, unit: Unit) -> bool {
        file_of(unit).is_some_and(|f| !f.binary)
    }
    fn part(&self, _: &Ctx, _: Unit, _: usize) -> Option<Value> {
        None
    }
    fn questions(&self, _: &Ctx, unit: Unit) -> Vec<Question> {
        let Some(file) = file_of(unit) else {
            return Vec::new();
        };
        vec![attention_question(
            "attention:file".into(),
            &file.id,
            "this file",
        )]
    }
}

/// Every deep question about the definitions the world chose to stand.
pub struct Definition;

impl Call for Definition {
    fn id(&self) -> &'static str {
        "definition"
    }
    fn version(&self) -> String {
        version_of(&format!("{QUALITY}{IMPORTANCE}{ATTENTION}{ROLES}"), 1)
    }
    fn pass(&self) -> &'static str {
        "deep"
    }
    fn applies(&self, ctx: &Ctx, unit: Unit) -> bool {
        file_of(unit).is_some_and(|f| {
            ctx.defs_of
                .get(f.id.as_str())
                .into_iter()
                .flatten()
                .any(|d| ctx.deep.contains(&d.id))
        })
    }
    fn part(&self, _: &Ctx, _: Unit, _: usize) -> Option<Value> {
        None
    }
    fn questions(&self, ctx: &Ctx, unit: Unit) -> Vec<Question> {
        let Some(file) = file_of(unit) else {
            return Vec::new();
        };
        let q = &quality_vocab().def;
        let roles = &roles_vocab().def;
        let mut out = Vec::new();
        for d in ctx
            .defs_of
            .get(file.id.as_str())
            .into_iter()
            .flatten()
            .filter(|d| ctx.deep.contains(&d.id))
        {
            let words = about_def(d);
            let name = qualified(&d.id);
            let what = format!("`{name}`, on lines {} to {}", d.span.start, d.span.end);
            let p = format!("definition:{name}");
            let mut ask = |key: &str, field: &str, json: Value| {
                out.push(Question {
                    id: format!("{p}:{key}"),
                    about: d.id.clone(),
                    field: field.into(),
                    json,
                    line: None,
                })
            };
            ask(
                "role",
                "role",
                choice(&fill(&roles.instructions, &words), &roles.options),
            );
            ask(
                "readability",
                "quality.readability",
                score(
                    &fill(&q.readability.instructions, &words),
                    &q.readability.levels,
                ),
            );
            ask(
                "naming",
                "quality.naming",
                score(&fill(&q.naming.instructions, &words), &q.naming.levels),
            );
            if d.doc.is_some() {
                ask(
                    "doc",
                    "quality.doc",
                    score(&fill(&q.doc.instructions, &words), &q.doc.levels),
                );
            }
            ask(
                "errors",
                "quality.errors",
                choice(&fill(&q.errors.instructions, &words), &q.errors.options),
            );
            ask(
                "change",
                "quality.change",
                score(&fill(&q.change.instructions, &words), &q.change.levels),
            );
            out.extend(importance_questions(&p, &d.id, &what));
            out.push(attention_question(format!("{p}:attention"), &d.id, &what));
        }
        out
    }
}

/// Every deep question about the blocks the world chose to stand.
pub struct Block;

impl Call for Block {
    fn id(&self) -> &'static str {
        "block"
    }
    fn version(&self) -> String {
        version_of(&format!("{QUALITY}{IMPORTANCE}{ATTENTION}{ROLES}"), 1)
    }
    fn pass(&self) -> &'static str {
        "deep"
    }
    fn applies(&self, ctx: &Ctx, unit: Unit) -> bool {
        file_of(unit).is_some_and(|f| {
            ctx.blocks_of
                .get(f.id.as_str())
                .into_iter()
                .flatten()
                .any(|b| ctx.deep.contains(b.0))
        })
    }
    fn part(&self, _: &Ctx, _: Unit, _: usize) -> Option<Value> {
        None
    }
    fn questions(&self, ctx: &Ctx, unit: Unit) -> Vec<Question> {
        let Some(file) = file_of(unit) else {
            return Vec::new();
        };
        let q = &quality_vocab().block;
        let roles = &roles_vocab().block;
        let mut out = Vec::new();
        for (id, shape, start, end, holder) in ctx
            .blocks_of
            .get(file.id.as_str())
            .into_iter()
            .flatten()
            .filter(|b| ctx.deep.contains(b.0))
        {
            let words = about_block(shape, *start, *end, holder);
            let what = format!("the {shape} block on lines {start} to {end}, inside `{holder}`");
            let p = format!("block:{}", block_local(id));
            out.push(Question {
                id: format!("{p}:role"),
                about: id.to_string(),
                field: "role".into(),
                json: choice(&fill(&roles.instructions, &words), &roles.options),
                line: None,
            });
            out.push(Question {
                id: format!("{p}:readability"),
                about: id.to_string(),
                field: "quality.readability".into(),
                json: score(
                    &fill(&q.readability.instructions, &words),
                    &q.readability.levels,
                ),
                line: None,
            });
            out.extend(importance_questions(&p, id, &what));
            out.push(attention_question(format!("{p}:attention"), id, &what));
        }
        out
    }
}

// --- link and tests ------------------------------------------------------

#[derive(Deserialize)]
struct LinkAsked {
    instructions: String,
    #[serde(default)]
    outside: String,
    #[serde(default)]
    yes: String,
    #[serde(default)]
    no: String,
}
#[derive(Deserialize)]
struct LinkVocab {
    resolve: LinkAsked,
    callee: LinkAsked,
    checks: LinkAsked,
}
const LINK: &str = include_str!("../../vocab/link.toml");
fn link_vocab() -> &'static LinkVocab {
    static V: OnceLock<LinkVocab> = OnceLock::new();
    vocab(&V, LINK, "link")
}

/// A reference's question id within its file: its call, line and place.
fn ref_question(call: &str, r: &PendingRef, n: usize) -> String {
    format!("{call}:{}:{n}", r.at.start)
}

/// Which file a pending import means.
pub struct Resolve;

impl Call for Resolve {
    fn id(&self) -> &'static str {
        "resolve"
    }
    fn version(&self) -> String {
        version_of(LINK, 1)
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
        // The configuration in each candidate directory, which names the package it holds.
        let file = file_of(unit)?;
        let mut dirs: BTreeSet<&str> = BTreeSet::new();
        for r in ctx
            .pending_of
            .get(file.id.as_str())
            .into_iter()
            .flatten()
            .filter(|r| r.kind == "import")
        {
            for c in &r.candidates {
                if let Some(d) = c.strip_prefix("dir:") {
                    dirs.insert(d);
                }
            }
        }
        let mut configs: Vec<Value> = Vec::new();
        let mut used = 0;
        'dirs: for d in dirs {
            for f in ctx.files_in.get(d).into_iter().flatten().filter(|f| {
                matches!(f.language.as_deref(), Some("json" | "toml" | "yaml") | None) && !f.binary
            }) {
                let Ok(text) = std::fs::read_to_string(ctx.root.join(&f.path)) else {
                    continue;
                };
                used += tokens(&text);
                if used > budget {
                    break 'dirs;
                }
                configs.push(json!({ "path": f.path, "text": text }));
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
                let mut options: BTreeMap<String, String> = r
                    .candidates
                    .iter()
                    .map(|c| {
                        (
                            c.clone(),
                            format!(
                                "{} in this repository",
                                c.trim_start_matches("file:").trim_start_matches("dir:")
                            ),
                        )
                    })
                    .collect();
                options.insert("outside".into(), v.outside.clone());
                let text = v
                    .instructions
                    .replace("{text}", &r.text)
                    .replace("{line}", &r.at.start.to_string());
                Question {
                    id: ref_question("resolve", r, n),
                    about: crate::graph::ref_key(r),
                    field: "link".into(),
                    json: choice(&text, &options),
                    line: Some(r.at.start),
                }
            })
            .collect()
    }
}

/// Which definition a pending call reaches.
pub struct Callee;

impl Call for Callee {
    fn id(&self) -> &'static str {
        "callee"
    }
    fn version(&self) -> String {
        version_of(LINK, 1)
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
                let mut options: BTreeMap<String, String> = r
                    .candidates
                    .iter()
                    .map(|c| {
                        let words = ctx.defs.get(c.as_str()).map_or_else(
                            || c.clone(),
                            |d| {
                                format!(
                                    "`{}` in {}: {}",
                                    qualified(&d.id),
                                    d.file.trim_start_matches("file:"),
                                    d.signature
                                )
                            },
                        );
                        (c.clone(), words)
                    })
                    .collect();
                options.insert("outside".into(), v.outside.clone());
                let text = v
                    .instructions
                    .replace("{text}", &r.text)
                    .replace("{line}", &r.at.start.to_string());
                Question {
                    id: ref_question("callee", r, n),
                    about: crate::graph::ref_key(r),
                    field: "link".into(),
                    json: choice(&text, &options),
                    line: Some(r.at.start),
                }
            })
            .collect()
    }
}

/// For a file Jev judged a test, which files it checks.
pub struct Checks;

impl Checks {
    /// Files it imports, files in its directory, and files those import.
    fn candidates<'a>(ctx: &'a Ctx, file: &'a FileNode) -> Vec<&'a str> {
        let mut out: BTreeSet<&str> = BTreeSet::new();
        let near: Vec<&str> = ctx
            .imports
            .get(file.id.as_str())
            .into_iter()
            .flatten()
            .copied()
            .chain(
                ctx.files_in
                    .get(parent_dir(&file.path))
                    .into_iter()
                    .flatten()
                    .map(|f| f.id.as_str()),
            )
            .collect();
        for n in &near {
            out.insert(n);
            for m in ctx.imports.get(n).into_iter().flatten() {
                out.insert(m);
            }
        }
        out.remove(file.id.as_str());
        out.into_iter()
            .filter(|id| {
                ctx.files.get(id).is_some_and(|f| !f.binary) && ctx.defs_of.contains_key(id)
            })
            .collect()
    }
}

impl Call for Checks {
    fn id(&self) -> &'static str {
        "checks"
    }
    fn version(&self) -> String {
        version_of(LINK, 1)
    }
    fn pass(&self) -> &'static str {
        "tests"
    }
    fn applies(&self, ctx: &Ctx, unit: Unit) -> bool {
        file_of(unit).is_some_and(|f| {
            ctx.answers(&f.id)
                .and_then(|a| a.get("kind"))
                .and_then(|k| k["choice"].as_str())
                == Some("test")
        })
    }
    fn part(&self, ctx: &Ctx, unit: Unit, budget: usize) -> Option<Value> {
        let file = file_of(unit)?;
        let mut out: Vec<Value> = Vec::new();
        let mut used = 0;
        for c in Self::candidates(ctx, file) {
            let names: Vec<&str> = ctx
                .defs_of
                .get(c)
                .into_iter()
                .flatten()
                .map(|d| d.name.as_str())
                .collect();
            let entry = json!({ "path": c.trim_start_matches("file:"), "defines": names });
            used += tokens(&entry.to_string());
            if used > budget {
                break;
            }
            out.push(entry);
        }
        Some(json!({ "candidates": out }))
    }
    fn questions(&self, ctx: &Ctx, unit: Unit) -> Vec<Question> {
        let Some(file) = file_of(unit) else {
            return Vec::new();
        };
        let v = &link_vocab().checks;
        Self::candidates(ctx, file)
            .into_iter()
            .map(|c| {
                let path = c.trim_start_matches("file:");
                Question {
                    id: format!("checks:{path}"),
                    about: file.id.clone(),
                    field: format!("checks:{path}"),
                    json: yes_no(&v.instructions.replace("{path}", path), &v.yes, &v.no),
                    line: None,
                }
            })
            .collect()
    }
}

// --- directories ---------------------------------------------------------

#[derive(Deserialize)]
struct DirectoryVocab {
    kind: Asked,
    naming: Asked,
    cohesion: Asked,
    doc: Asked,
}
const DIRECTORY: &str = include_str!("../../vocab/directory.toml");
fn directory_vocab() -> &'static DirectoryVocab {
    static V: OnceLock<DirectoryVocab> = OnceLock::new();
    vocab(&V, DIRECTORY, "directory")
}

/// What a directory is, judged from what its files and subdirectories turned out to be.
pub struct Directory;

impl Directory {
    fn summary(ctx: &Ctx, id: &str) -> Value {
        let a = ctx.answers(id);
        let get = |f: &str| a.and_then(|a| a.get(f)).cloned().unwrap_or(Value::Null);
        let does: Vec<String> = a
            .into_iter()
            .flatten()
            .filter(|(k, v)| k.starts_with("does.") && v["yes"].as_f64().is_some_and(|p| p >= 0.5))
            .map(|(k, _)| k.trim_start_matches("does.").to_string())
            .collect();
        json!({
            "kind": get("kind")["choice"],
            "does": does,
            "breaks": get("importance.breaks")["score"],
            "central": get("importance.central")["score"],
            "stand": get("stand")["score"],
        })
    }
}

impl Call for Directory {
    fn id(&self) -> &'static str {
        "directory"
    }
    fn version(&self) -> String {
        version_of(&format!("{DIRECTORY}{IMPORTANCE}{ATTENTION}{SCREEN}"), 1)
    }
    fn pass(&self) -> &'static str {
        "dirs"
    }
    fn applies(&self, _: &Ctx, unit: Unit) -> bool {
        matches!(unit, Unit::Dir(_))
    }
    fn part(&self, ctx: &Ctx, unit: Unit, budget: usize) -> Option<Value> {
        let Unit::Dir(dir) = unit else { return None };
        let files: Vec<Value> = ctx
            .files_in
            .get(dir.path.as_str())
            .into_iter()
            .flatten()
            .map(|f| {
                let mut s = Self::summary(ctx, &f.id);
                s["path"] = json!(f.path);
                s
            })
            .collect();
        let subdirectories: Vec<Value> = ctx
            .dirs_in
            .get(dir.path.as_str())
            .into_iter()
            .flatten()
            .map(|d| {
                let mut s = Self::summary(ctx, &d.id);
                s["path"] = json!(d.path);
                s["lines"] = json!(d.measures.lines);
                s
            })
            .collect();
        // Configuration and prose directly in it, within the budget.
        let mut texts: Vec<Value> = Vec::new();
        let mut used = tokens(&json!([&files, &subdirectories]).to_string());
        for f in ctx.files_in.get(dir.path.as_str()).into_iter().flatten() {
            if !matches!(
                f.language.as_deref(),
                Some("json" | "toml" | "yaml" | "markdown")
            ) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(ctx.root.join(&f.path)) else {
                continue;
            };
            used += tokens(&text);
            if used > budget {
                break;
            }
            texts.push(json!({ "path": f.path, "text": text }));
        }
        Some(json!({ "files": files, "subdirectories": subdirectories, "documents": texts }))
    }
    fn questions(&self, ctx: &Ctx, unit: Unit) -> Vec<Question> {
        let Unit::Dir(dir) = unit else {
            return Vec::new();
        };
        let v = directory_vocab();
        let about = || dir.id.clone();
        let mut out = vec![
            Question {
                id: "directory:kind".into(),
                about: about(),
                field: "kind".into(),
                json: choice(&v.kind.instructions, &v.kind.options),
                line: None,
            },
            Question {
                id: "directory:naming".into(),
                about: about(),
                field: "quality.naming".into(),
                json: score(&v.naming.instructions, &v.naming.levels),
                line: None,
            },
            Question {
                id: "directory:cohesion".into(),
                about: about(),
                field: "quality.cohesion".into(),
                json: score(&v.cohesion.instructions, &v.cohesion.levels),
                line: None,
            },
        ];
        let has_prose = ctx
            .files_in
            .get(dir.path.as_str())
            .into_iter()
            .flatten()
            .any(|f| f.language.as_deref() == Some("markdown"));
        if has_prose {
            out.push(Question {
                id: "directory:doc".into(),
                about: about(),
                field: "quality.doc".into(),
                json: score(&v.doc.instructions, &v.doc.levels),
                line: None,
            });
        }
        out.extend(importance_questions("directory", &dir.id, "this directory"));
        out.push(attention_question(
            "directory:attention".into(),
            &dir.id,
            "this directory",
        ));
        let s = screen_vocab();
        out.push(Question {
            id: "directory:stand".into(),
            about: about(),
            field: "stand".into(),
            json: score(&s.dir, &s.levels),
            line: None,
        });
        out
    }
}

/// Every call, in the order their parts go into a state.
pub fn registry() -> Vec<&'static dyn Call> {
    vec![
        &Resolve,
        &Callee,
        &Profile,
        &Quality,
        &Importance,
        &Screen,
        &Attention,
        &Checks,
        &Definition,
        &Block,
        &Directory,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every call's vocabulary parses, and every choice it asks names only options from it.
    #[test]
    fn every_call_s_words_parse_and_its_values_map_into_zero_to_one() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/languages");
        let graph = crate::graph::build(&root).unwrap();
        let deep: BTreeSet<String> = graph
            .nodes
            .iter()
            .filter_map(|n| match n {
                Node::Def(d) => Some(d.id.clone()),
                Node::Block(b) => Some(b.id.clone()),
                _ => None,
            })
            .collect();
        let held = json!({});
        let ctx = Ctx::new(&graph, &root, &held, &deep);
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
                        Some("noul") => assert!(
                            q.json["criteria"]["true"].is_string(),
                            "{} has its yes",
                            q.id
                        ),
                        other => panic!("{} has an unknown type {other:?}", q.id),
                    }
                    let known = [
                        "kind",
                        "stand",
                        "role",
                        "attention",
                        "needsTests",
                        "dead",
                        "link",
                    ]
                    .contains(&q.field.as_str())
                        || ["does.", "quality.", "importance.", "checks:"]
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
}
