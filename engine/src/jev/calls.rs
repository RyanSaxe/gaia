//! Jev's calls. Each call asks one kind of question about a file and the
//! nodes in it: whether it applies, what it adds to the file's state, and
//! its questions, each naming the node it is about and where its answer
//! goes in that node's `judged`. A call's words live in its vocabulary file
//! in `engine/vocab/`, and its version is that file's hash and a number
//! bumped when its code changes, so a new word asks again only what that
//! call answered.

use crate::graph::model::{CodeGraph, DefNode, FileNode, Node};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

/// One question, with the node it is about and where its answer goes:
/// "kind", "stand", "needsTests", "dead", or "does.<responsibility>".
pub struct Question {
    pub id: String,
    pub about: String,
    pub field: String,
    pub json: Value,
}

/// A block as a request names it: its id, shape, first and last lines, and the definition holding it.
pub type BlockRow<'a> = (&'a str, &'a str, u32, u32, &'a str);

/// The graph, indexed for building requests.
pub struct Ctx<'a> {
    pub defs_of: HashMap<&'a str, Vec<&'a DefNode>>,
    pub blocks_of: HashMap<&'a str, Vec<BlockRow<'a>>>,
    /// Files each file imports, and files that import it, by rule.
    pub imports: HashMap<&'a str, Vec<&'a str>>,
    pub importers: HashMap<&'a str, Vec<&'a str>>,
}

impl<'a> Ctx<'a> {
    pub fn new(graph: &'a CodeGraph) -> Self {
        let mut defs_of: HashMap<&str, Vec<&DefNode>> = HashMap::new();
        let mut def_file: HashMap<&str, &str> = HashMap::new();
        for n in &graph.nodes {
            if let Node::Def(d) = n {
                defs_of.entry(d.file.as_str()).or_default().push(d);
                def_file.insert(d.id.as_str(), d.file.as_str());
            }
        }
        let mut blocks_of: HashMap<&str, Vec<BlockRow>> = HashMap::new();
        for n in &graph.nodes {
            if let Node::Block(b) = n {
                let file = def_file
                    .get(b.def.as_str())
                    .copied()
                    .unwrap_or(b.def.as_str());
                let holder = b.def.split_once('#').map_or(b.def.as_str(), |(_, q)| q);
                blocks_of.entry(file).or_default().push((
                    b.id.as_str(),
                    b.shape.as_str(),
                    b.span.start,
                    b.span.end,
                    holder,
                ));
            }
        }
        let file_of = |id: &'a str| -> &'a str { def_file.get(id).copied().unwrap_or(id) };
        let mut imports: HashMap<&str, Vec<&str>> = HashMap::new();
        let mut importers: HashMap<&str, Vec<&str>> = HashMap::new();
        for e in graph
            .edges
            .iter()
            .filter(|e| e.kind == "imports" && e.to.starts_with("file:"))
        {
            let from = file_of(e.from.as_str());
            if from != e.to {
                imports.entry(from).or_default().push(e.to.as_str());
                importers.entry(e.to.as_str()).or_default().push(from);
            }
        }
        for v in imports.values_mut().chain(importers.values_mut()) {
            v.sort_unstable();
            v.dedup();
        }
        Ctx {
            defs_of,
            blocks_of,
            imports,
            importers,
        }
    }

    /// A file's definitions as an outline: their signatures, in source order.
    pub fn outline(&self, file: &str) -> Vec<Value> {
        self.defs_of
            .get(file)
            .map(|defs| defs.iter().map(|d| json!({ "name": d.name, "role": d.role, "lines": [d.span.start, d.span.end], "signature": d.signature })).collect())
            .unwrap_or_default()
    }
}

pub trait Call: Sync {
    fn id(&self) -> &'static str;
    fn version(&self) -> String;
    /// "understand" for every call so far.
    fn pass(&self) -> &'static str;
    fn applies(&self, ctx: &Ctx, file: &FileNode) -> bool;
    /// What it adds to the file's state, under its own id, within `budget` tokens.
    fn part(&self, ctx: &Ctx, file: &FileNode, budget: usize) -> Option<Value>;
    fn questions(&self, ctx: &Ctx, file: &FileNode) -> Vec<Question>;
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

#[derive(Deserialize)]
struct Asked {
    instructions: String,
    #[serde(default)]
    options: BTreeMap<String, String>,
    #[serde(default)]
    yes: String,
    #[serde(default)]
    no: String,
}

#[derive(Deserialize)]
struct ProfileVocab {
    kind: Asked,
    does: Asked,
    needs_tests: Asked,
    dead: Asked,
}

const PROFILE_VOCAB: &str = include_str!("../../vocab/profile.toml");

fn profile_vocab() -> &'static ProfileVocab {
    static V: OnceLock<ProfileVocab> = OnceLock::new();
    V.get_or_init(|| toml::from_str(PROFILE_VOCAB).expect("engine/vocab/profile.toml parses"))
}

/// What kind of file this is, what it does, whether it needs tests of its
/// own, and, when nothing in the repository reaches it, whether it is dead.
pub struct Profile;

impl Call for Profile {
    fn id(&self) -> &'static str {
        "profile"
    }

    fn version(&self) -> String {
        version_of(PROFILE_VOCAB, 1)
    }

    fn pass(&self) -> &'static str {
        "understand"
    }

    fn applies(&self, _: &Ctx, file: &FileNode) -> bool {
        !file.binary
    }

    fn part(&self, ctx: &Ctx, file: &FileNode, budget: usize) -> Option<Value> {
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
            used += super::tokens::tokens(&entry.to_string());
            if used > budget {
                break;
            }
            neighbours.push(entry);
        }
        Some(json!({ "neighbours": neighbours }))
    }

    fn questions(&self, _: &Ctx, file: &FileNode) -> Vec<Question> {
        let v = profile_vocab();
        let about = || file.id.clone();
        let mut out = vec![Question {
            id: "profile:kind".into(),
            about: about(),
            field: "kind".into(),
            json: choice(&v.kind.instructions, &v.kind.options),
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
            });
        }
        out
    }
}

#[derive(Deserialize)]
struct ScreenVocab {
    stand: StandVocab,
}

#[derive(Deserialize)]
struct StandVocab {
    file: String,
    def: String,
    block: String,
    levels: Vec<String>,
}

const SCREEN_VOCAB: &str = include_str!("../../vocab/screen.toml");

fn screen_vocab() -> &'static ScreenVocab {
    static V: OnceLock<ScreenVocab> = OnceLock::new();
    V.get_or_init(|| toml::from_str(SCREEN_VOCAB).expect("engine/vocab/screen.toml parses"))
}

/// How much the file, each definition and each block deserves to stand on its own.
pub struct Screen;

impl Call for Screen {
    fn id(&self) -> &'static str {
        "screen"
    }

    fn version(&self) -> String {
        version_of(SCREEN_VOCAB, 1)
    }

    fn pass(&self) -> &'static str {
        "understand"
    }

    fn applies(&self, _: &Ctx, file: &FileNode) -> bool {
        !file.binary
    }

    fn part(&self, _: &Ctx, _: &FileNode, _: usize) -> Option<Value> {
        None
    }

    fn questions(&self, ctx: &Ctx, file: &FileNode) -> Vec<Question> {
        let v = &screen_vocab().stand;
        let mut out = vec![Question {
            id: "screen:file".into(),
            about: file.id.clone(),
            field: "stand".into(),
            json: score(&v.file, &v.levels),
        }];
        for d in ctx.defs_of.get(file.id.as_str()).into_iter().flatten() {
            let qualified = d.id.split_once('#').map_or(d.name.as_str(), |(_, q)| q);
            let text = v
                .def
                .replace("{name}", qualified)
                .replace("{start}", &d.span.start.to_string())
                .replace("{end}", &d.span.end.to_string());
            out.push(Question {
                id: format!("screen:def:{qualified}"),
                about: d.id.clone(),
                field: "stand".into(),
                json: score(&text, &v.levels),
            });
        }
        for (id, shape, start, end, holder) in
            ctx.blocks_of.get(file.id.as_str()).into_iter().flatten()
        {
            // Unique within the file: its holder's qualified name and its place.
            let rest = id.trim_start_matches("block:");
            let local = match rest.split_once('#') {
                Some((_, q)) => q.to_string(),
                None => format!("file/{}", rest.rsplit('/').next().unwrap_or("0")),
            };
            let text = v
                .block
                .replace("{shape}", shape)
                .replace("{start}", &start.to_string())
                .replace("{end}", &end.to_string())
                .replace("{holder}", holder);
            out.push(Question {
                id: format!("screen:block:{local}"),
                about: id.to_string(),
                field: "stand".into(),
                json: score(&text, &v.levels),
            });
        }
        out
    }
}

/// Every call, in the order their parts go into a state.
pub fn registry() -> Vec<&'static dyn Call> {
    vec![&Profile, &Screen]
}
