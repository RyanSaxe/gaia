//! The understanding pass: importance and quality at every level.
//!
//! A request is about one container and its parts. A folder's request
//! scores how much each of its files and subfolders matters, and the
//! folder's own organization. A file's request scores how much each of its
//! definitions matters and each one's quality concepts, picks which
//! definitions (and which blocks of each definition) stand out, and scores
//! the file's own arrangement. Folders go top-down, each in its parent's
//! light, and each file after its folder, so every request carries the
//! project's own description and what was found above it. The engine then
//! gathers quality upward by arithmetic (`values`). Every word, level,
//! weight and pick is in `engine/vocab/understanding.toml`.

use super::calls::{Call, Ctx, Question, Unit};
use super::tokens::tokens;
use crate::graph::model::{CodeGraph, DefNode, DirNode, FileNode, Node};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

const VOCAB: &str = include_str!("../../vocab/understanding.toml");

/// A file's text, read once per process and again only when it changes on
/// disk: every slice plans every request again, and the readings and the
/// project's own words read the same files each time.
fn read_text(ctx: &Ctx, path: &str) -> Option<std::sync::Arc<str>> {
    use std::sync::{Arc, Mutex};
    type Cache = HashMap<std::path::PathBuf, (std::time::SystemTime, u64, Arc<str>)>;
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    let full = ctx.root.join(path);
    let meta = std::fs::metadata(&full).ok()?;
    let stamp = (meta.modified().ok()?, meta.len());
    let mut cache = CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .ok()?;
    if let Some((m, l, text)) = cache.get(&full)
        && (*m, *l) == stamp
    {
        return Some(text.clone());
    }
    let text: Arc<str> = std::fs::read_to_string(&full).ok()?.into();
    cache.insert(full, (stamp.0, stamp.1, text.clone()));
    Some(text)
}

#[derive(Deserialize)]
struct Parts {
    skip_roles: Vec<String>,
}

#[derive(Deserialize)]
struct Scale {
    instructions: String,
    levels: Vec<String>,
}

/// One quality concept: a scale of levels, or a choice whose options are
/// worth `values` (an option left out doesn't count).
#[derive(Deserialize)]
struct Concept {
    weight: f64,
    instructions: String,
    #[serde(default)]
    levels: Vec<String>,
    #[serde(default)]
    options: BTreeMap<String, String>,
    #[serde(default)]
    values: BTreeMap<String, f64>,
}

#[derive(Deserialize)]
struct Pick {
    instructions: String,
    none: String,
}

#[derive(Deserialize)]
struct Gather {
    parts: f64,
    own: f64,
}

#[derive(Deserialize)]
struct More {
    threshold: f64,
    rounds: usize,
    instructions: String,
    options: BTreeMap<String, String>,
}

#[derive(Deserialize)]
struct Vocab {
    parts: Parts,
    importance: Scale,
    definition: BTreeMap<String, Concept>,
    file: BTreeMap<String, Concept>,
    folder: BTreeMap<String, Concept>,
    picks: BTreeMap<String, Pick>,
    gather: Gather,
    more: More,
}

fn vocab() -> &'static Vocab {
    static V: OnceLock<Vocab> = OnceLock::new();
    V.get_or_init(|| {
        toml::from_str(VOCAB)
            .unwrap_or_else(|e| panic!("engine/vocab/understanding.toml parses: {e}"))
    })
}

fn version(code: u32) -> String {
    let hash: String = Sha256::digest(VOCAB.as_bytes())
        .iter()
        .take(4)
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("{hash}-{code}")
}

fn qualified(id: &str) -> &str {
    id.split_once('#').map_or(id, |(_, q)| q)
}

fn parent_dir(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

fn fill(text: &str, words: &[(&str, String)]) -> String {
    words
        .iter()
        .fold(text.to_string(), |t, (k, v)| t.replace(k, v))
}

fn about_def(d: &DefNode) -> [(&'static str, String); 3] {
    [
        ("{name}", qualified(&d.id).to_string()),
        ("{start}", d.span.start.to_string()),
        ("{end}", d.span.end.to_string()),
    ]
}

fn scale_json(instructions: String, levels: &[String]) -> Value {
    json!({ "type": "score", "instructions": instructions, "criteria": levels })
}

fn concept_json(c: &Concept, instructions: String) -> Value {
    if c.options.is_empty() {
        scale_json(instructions, &c.levels)
    } else {
        json!({ "type": "choice", "instructions": instructions, "criteria": c.options })
    }
}

/// A definition that is code rather than data or markup.
fn is_code(d: &DefNode) -> bool {
    !vocab().parts.skip_roles.iter().any(|r| r == &d.role)
}

/// The project's own description: the opening of the largest prose file at
/// its root, in its own words, up to `budget` tokens.
fn project_words(ctx: &Ctx, budget: usize) -> Option<String> {
    prose(ctx, "", budget)
}

/// The opening of a folder's largest prose file, up to `budget` tokens.
fn prose(ctx: &Ctx, dir: &str, budget: usize) -> Option<String> {
    let file = ctx
        .files_in
        .get(dir)
        .into_iter()
        .flatten()
        .filter(|f| f.language.as_deref() == Some("markdown") && !f.binary)
        .max_by_key(|f| f.bytes)?;
    let text = read_text(ctx, &file.path)?;
    let mut out = String::new();
    for line in text.lines() {
        if tokens(&out) + tokens(line) > budget {
            break;
        }
        out.push_str(line);
        out.push('\n');
    }
    (!out.trim().is_empty()).then_some(out)
}

/// What was found above a folder or file: each enclosing folder's
/// importance and organization, from the root down, as typed answers.
fn above(ctx: &Ctx, dir: &str) -> Vec<Value> {
    let mut chain: Vec<&str> = Vec::new();
    let mut d = dir;
    loop {
        chain.push(d);
        if d.is_empty() {
            break;
        }
        d = parent_dir(d);
    }
    chain
        .into_iter()
        .rev()
        .map(|p| {
            let id = format!("dir:{p}");
            let a = ctx.answers(&id);
            let score = |f: &str| a.and_then(|m| m.get(f)).and_then(|v| v["score"].as_f64());
            json!({
                "path": if p.is_empty() { "(the repository's root)" } else { p },
                "importance": score("axes.importance"),
                "organization": score("axes.organization"),
            })
        })
        .collect()
}

fn importance_question(id: &str, about: &str, what: &str, line: Option<u32>) -> Question {
    let v = vocab();
    Question {
        id: id.to_string(),
        about: about.to_string(),
        field: "axes.importance".into(),
        json: scale_json(
            fill(&v.importance.instructions, &[("{what}", what.to_string())]),
            &v.importance.levels,
        ),
        line,
    }
}

fn pick_questions(
    out: &mut Vec<Question>,
    prefix: &str,
    about: &str,
    what: &str,
    options: &BTreeMap<String, String>,
) {
    for (name, pick) in &vocab().picks {
        let mut criteria = options.clone();
        criteria.insert("none".into(), pick.none.clone());
        out.push(Question {
            id: format!("pick-{name}:{prefix}"),
            about: about.to_string(),
            field: format!("picks.{name}"),
            json: json!({
                "type": "choice",
                "instructions": fill(&pick.instructions, &[("{what}", what.to_string())]),
                "criteria": criteria,
            }),
            line: None,
        });
    }
}

/// The readings Jev asked for in earlier rounds about a node, and which
/// round's "more" question to ask now, if any. A round whose answer was
/// "nothing" is asked again as it was, so the request stays the same and
/// nothing is sent twice; a round that chose readings adds them, and the
/// next round is asked only while rounds remain.
fn more_state(ctx: &Ctx, id: &str) -> (Vec<String>, Option<usize>) {
    let m = &vocab().more;
    let held = ctx.answers(id);
    let chosen = |r: usize| -> Option<Vec<String>> {
        let a = held?.get(&format!("more.{r}"))?;
        if a["choice"].as_str() == Some("nothing") {
            return Some(Vec::new());
        }
        Some(
            a["p"]
                .as_object()
                .into_iter()
                .flatten()
                .filter(|(k, p)| {
                    k.as_str() != "nothing" && p.as_f64().unwrap_or(0.0) >= m.threshold
                })
                .map(|(k, _)| k.clone())
                .collect(),
        )
    };
    let mut readings: Vec<String> = Vec::new();
    let mut round = 1;
    while let Some(r) = chosen(round) {
        if r.is_empty() {
            return (readings, Some(round));
        }
        readings.extend(r);
        round += 1;
    }
    readings.sort();
    readings.dedup();
    (readings, (round <= m.rounds).then_some(round))
}

fn more_question(out: &mut Vec<Question>, ctx: &Ctx, id: &str) {
    let m = &vocab().more;
    if let (_, Some(round)) = more_state(ctx, id) {
        out.push(Question {
            id: format!("more:{round}"),
            about: id.to_string(),
            field: format!("more.{round}"),
            json: json!({ "type": "choice", "instructions": m.instructions, "criteria": m.options }),
            line: None,
        });
    }
}

/// The lines around `line` in a file, numbered, `around` on each side.
fn lines_around(ctx: &Ctx, path: &str, line: u32, around: u32) -> Option<String> {
    let text = read_text(ctx, path)?;
    let (from, to) = (line.saturating_sub(around).max(1), line + around);
    Some(
        text.lines()
            .enumerate()
            .map(|(i, l)| (i as u32 + 1, l))
            .filter(|(n, _)| (from..=to).contains(n))
            .map(|(n, l)| format!("{n}: {l}"))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

/// Adds the readings Jev asked for, each within `budget` tokens.
fn add_readings(out: &mut Map<String, Value>, ctx: &Ctx, unit: Unit, budget: usize) {
    let (id, dir) = match unit {
        Unit::File(f) => (f.id.as_str(), parent_dir(&f.path)),
        Unit::Dir(d) => (d.id.as_str(), d.path.as_str()),
    };
    let (readings, _) = more_state(ctx, id);
    if readings.is_empty() {
        return;
    }
    let defs: Vec<&DefNode> = match unit {
        Unit::File(f) => ctx.defs_of.get(f.id.as_str()).cloned().unwrap_or_default(),
        Unit::Dir(_) => Vec::new(),
    };
    let fits = |items: Vec<Value>| -> Value {
        let mut used = 0;
        Value::Array(
            items
                .into_iter()
                .take_while(|v| {
                    used += tokens(&v.to_string());
                    used <= budget
                })
                .collect(),
        )
    };
    let mut got = Map::new();
    for r in &readings {
        let value = match r.as_str() {
            "usages" => {
                let mut items = Vec::new();
                for d in &defs {
                    for (from, line) in ctx.uses_of.get(d.id.as_str()).into_iter().flatten() {
                        let path = from.split_once(':').map_or(*from, |(_, p)| p);
                        let path = path.split_once('#').map_or(path, |(f, _)| f);
                        if let Some(text) = lines_around(ctx, path, *line, 2) {
                            items.push(
                                json!({ "uses": qualified(&d.id), "in": path, "lines": text }),
                            );
                        }
                    }
                }
                if let Unit::Dir(d) = unit {
                    for f in ctx.files_in.get(d.path.as_str()).into_iter().flatten() {
                        for from in ctx.importers.get(f.id.as_str()).into_iter().flatten() {
                            if parent_dir(from.trim_start_matches("file:")) != d.path {
                                items.push(json!({ "imports": f.path, "from": from.trim_start_matches("file:") }));
                            }
                        }
                    }
                }
                fits(items)
            }
            "related" => {
                let mut items = Vec::new();
                for d in &defs {
                    for callee in ctx.calls_out.get(d.id.as_str()).into_iter().flatten() {
                        let Some(c) = ctx.defs.get(callee) else {
                            continue;
                        };
                        let path = c.file.trim_start_matches("file:");
                        let Some(text) = read_text(ctx, path) else {
                            continue;
                        };
                        let body: Vec<&str> = text
                            .lines()
                            .skip(c.span.start as usize - 1)
                            .take((c.span.end - c.span.start + 1) as usize)
                            .collect();
                        items.push(json!({ "called by": qualified(&d.id), "definition": qualified(&c.id), "in": path, "source": body.join("\n") }));
                    }
                }
                fits(items)
            }
            "tests" => {
                let tests: Vec<Value> = ctx
                    .importers
                    .get(id)
                    .into_iter()
                    .flatten()
                    .filter_map(|t| ctx.files.get(t))
                    .filter(|t| t.conventions.iter().any(|c| c.contains("test")))
                    .filter_map(|t| {
                        let text = read_text(ctx, &t.path)?;
                        Some(json!({ "test": t.path, "source": &*text }))
                    })
                    .collect();
                fits(tests)
            }
            "docs" => prose(ctx, dir, budget).map_or(Value::Null, Value::String),
            _ => continue,
        };
        got.insert(r.clone(), value);
    }
    out.insert("readings".into(), Value::Object(got));
}

fn dir_of<'a>(unit: Unit<'a>) -> Option<&'a DirNode> {
    match unit {
        Unit::Dir(d) => Some(d),
        Unit::File(_) => None,
    }
}

fn file_of<'a>(unit: Unit<'a>) -> Option<&'a FileNode> {
    match unit {
        Unit::File(f) => Some(f),
        Unit::Dir(_) => None,
    }
}

/// A folder's request: how much each of its parts matters, and its own
/// organization.
pub struct FolderAxes;

impl Call for FolderAxes {
    fn id(&self) -> &'static str {
        "folder-axes"
    }
    fn version(&self) -> String {
        version(1)
    }
    fn pass(&self) -> &'static str {
        "folders"
    }
    fn applies(&self, _: &Ctx, unit: Unit) -> bool {
        dir_of(unit).is_some()
    }
    fn part(&self, ctx: &Ctx, unit: Unit, budget: usize) -> Option<Value> {
        let dir = dir_of(unit)?;
        let mut parts: Vec<Value> = Vec::new();
        let mut used = 0;
        for f in ctx.files_in.get(dir.path.as_str()).into_iter().flatten() {
            let signatures: Vec<Value> = ctx
                .outline(&f.id)
                .into_iter()
                .map(|d| d["signature"].clone())
                .collect();
            let entry =
                json!({ "part": f.id, "lines": f.measures.lines, "definitions": signatures });
            used += tokens(&entry.to_string());
            if used > budget / 2 {
                parts.push(json!({ "part": f.id, "lines": f.measures.lines }));
                continue;
            }
            parts.push(entry);
        }
        for s in ctx.dirs_in.get(dir.path.as_str()).into_iter().flatten() {
            let files: Vec<&str> = ctx
                .files_in
                .get(s.path.as_str())
                .into_iter()
                .flatten()
                .map(|f| f.path.rsplit('/').next().unwrap_or(&f.path))
                .collect();
            parts.push(json!({ "part": s.id, "lines": s.measures.lines, "files": files }));
        }
        let mut out = Map::new();
        if let Some(words) = project_words(ctx, budget / 6) {
            out.insert("project".into(), json!(words));
        }
        out.insert("above".into(), json!(above(ctx, parent_dir(&dir.path))));
        if !dir.path.is_empty()
            && let Some(docs) = prose(ctx, &dir.path, budget / 6)
        {
            out.insert("docs".into(), json!(docs));
        }
        out.insert("parts".into(), json!(parts));
        add_readings(&mut out, ctx, Unit::Dir(dir), budget / 4);
        Some(Value::Object(out))
    }
    fn questions(&self, ctx: &Ctx, unit: Unit) -> Vec<Question> {
        let Some(dir) = dir_of(unit) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let what_dir = if dir.path.is_empty() {
            "the repository's root".to_string()
        } else {
            format!("the folder {}", dir.path)
        };
        for f in ctx.files_in.get(dir.path.as_str()).into_iter().flatten() {
            out.push(importance_question(
                &format!("importance:{}", f.path),
                &f.id,
                &format!("the file {}, in {what_dir}", f.path),
                None,
            ));
        }
        for s in ctx.dirs_in.get(dir.path.as_str()).into_iter().flatten() {
            out.push(importance_question(
                &format!("importance:{}/", s.path),
                &s.id,
                &format!("the folder {}, in {what_dir}", s.path),
                None,
            ));
        }
        for (name, c) in &vocab().folder {
            out.push(Question {
                id: format!("own:{name}"),
                about: dir.id.clone(),
                field: format!("axes.{name}"),
                json: concept_json(c, c.instructions.clone()),
                line: None,
            });
        }
        more_question(&mut out, ctx, &dir.id);
        out
    }
}

/// A file's request: how much each definition matters and its quality, which
/// definitions and blocks stand out, and the file's own arrangement.
pub struct FileAxes;

impl Call for FileAxes {
    fn id(&self) -> &'static str {
        "file-axes"
    }
    fn version(&self) -> String {
        version(1)
    }
    fn pass(&self) -> &'static str {
        "files"
    }
    fn applies(&self, _: &Ctx, unit: Unit) -> bool {
        file_of(unit).is_some_and(|f| !f.binary)
    }
    fn part(&self, ctx: &Ctx, unit: Unit, budget: usize) -> Option<Value> {
        let file = file_of(unit)?;
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
            if used > budget / 2 {
                break;
            }
            neighbours.push(entry);
        }
        let own = ctx
            .answers(&file.id)
            .and_then(|m| m.get("axes.importance"))
            .and_then(|v| v["score"].as_f64());
        let mut out = Map::new();
        if let Some(words) = project_words(ctx, budget / 6) {
            out.insert("project".into(), json!(words));
        }
        out.insert("above".into(), json!(above(ctx, parent_dir(&file.path))));
        out.insert("importance".into(), json!(own));
        out.insert("neighbours".into(), json!(neighbours));
        add_readings(&mut out, ctx, Unit::File(file), budget / 4);
        Some(Value::Object(out))
    }
    fn questions(&self, ctx: &Ctx, unit: Unit) -> Vec<Question> {
        let Some(file) = file_of(unit) else {
            return Vec::new();
        };
        let v = vocab();
        let defs: Vec<&DefNode> = ctx
            .defs_of
            .get(file.id.as_str())
            .into_iter()
            .flatten()
            .copied()
            .filter(|d| is_code(d))
            .collect();
        let mut out = Vec::new();
        for d in &defs {
            let words = about_def(d);
            let name = qualified(&d.id);
            out.push(importance_question(
                &format!("importance:{name}"),
                &d.id,
                &format!("`{name}`, on lines {} to {}", d.span.start, d.span.end),
                None,
            ));
            for (concept, c) in &v.definition {
                out.push(Question {
                    id: format!("{concept}:{name}"),
                    about: d.id.clone(),
                    field: format!("axes.{concept}"),
                    json: concept_json(c, fill(&c.instructions, &words)),
                    line: None,
                });
            }
            // A definition with one block has nothing to choose among.
            let blocks: BTreeMap<String, String> = ctx
                .blocks_of
                .get(file.id.as_str())
                .into_iter()
                .flatten()
                .filter(|(_, _, _, _, holder)| *holder == name)
                .map(|(id, shape, s, e, _)| {
                    (id.to_string(), format!("The {shape} on lines {s} to {e}."))
                })
                .collect();
            if blocks.len() >= 2 {
                pick_questions(
                    &mut out,
                    name,
                    &d.id,
                    &format!("`{name}`, on lines {} to {}", d.span.start, d.span.end),
                    &blocks,
                );
            }
        }
        if defs.len() >= 2 {
            let options: BTreeMap<String, String> = defs
                .iter()
                .map(|d| {
                    (
                        d.id.clone(),
                        format!(
                            "`{}`, on lines {} to {}.",
                            qualified(&d.id),
                            d.span.start,
                            d.span.end
                        ),
                    )
                })
                .collect();
            pick_questions(&mut out, "file", &file.id, "this file", &options);
        }
        for (name, c) in &v.file {
            out.push(Question {
                id: format!("own:{name}"),
                about: file.id.clone(),
                field: format!("axes.{name}"),
                json: concept_json(c, c.instructions.clone()),
                line: None,
            });
        }
        more_question(&mut out, ctx, &file.id);
        out
    }
}

/// A concept's answer as a value from 0 to 1, or nothing when it doesn't count.
fn concept_value(c: &Concept, answer: &Value) -> Option<f64> {
    if let Some(choice) = answer["choice"].as_str() {
        return c.values.get(choice).copied();
    }
    let score = answer["score"].as_f64()?;
    Some((score / (c.levels.len().max(2) - 1) as f64).clamp(0.0, 1.0))
}

/// The weighted mean of the concepts answered about a node, from its `judged.axes`.
fn own_quality(concepts: &BTreeMap<String, Concept>, axes: &Value) -> Option<f64> {
    let (mut sum, mut weight) = (0.0, 0.0);
    for (name, c) in concepts {
        if let Some(v) = concept_value(c, &axes[name]) {
            sum += v * c.weight;
            weight += c.weight;
        }
    }
    (weight > 0.0).then(|| sum / weight)
}

fn blend(parts: Option<f64>, own: Option<f64>) -> Option<f64> {
    let g = &vocab().gather;
    match (parts, own) {
        (Some(p), Some(o)) => Some((p * g.parts + o * g.own) / (g.parts + g.own)),
        (p, o) => p.or(o),
    }
}

/// Fills each node's `judged.value` with its importance and quality from 0
/// to 1: importance as its container judged it (the root is 1), and quality
/// gathered upward, each container's parts weighted by their lines and
/// blended with its own.
pub fn values(graph: &mut CodeGraph) {
    let v = vocab();
    let importance_top = (v.importance.levels.len().max(2) - 1) as f64;
    let mut quality: HashMap<String, (f64, u32)> = HashMap::new();
    let mut own: HashMap<String, Option<f64>> = HashMap::new();
    let mut importance: HashMap<String, f64> = HashMap::new();
    let mut parent: HashMap<String, String> = HashMap::new();
    let mut depth: HashMap<String, usize> = HashMap::new();
    let mut lines: HashMap<String, u32> = HashMap::new();
    for n in &graph.nodes {
        let (id, judged, concepts, up, size) = match n {
            Node::Def(d) if is_code(d) => (
                &d.id,
                &d.judged,
                Some(&v.definition),
                // Only top-level definitions gather into their file, so nested code isn't counted twice.
                if d.parent.is_none() {
                    d.file.clone()
                } else {
                    String::new()
                },
                d.span.end.saturating_sub(d.span.start) + 1,
            ),
            Node::File(f) => (
                &f.id,
                &f.judged,
                Some(&v.file),
                format!("dir:{}", parent_dir(&f.path)),
                f.measures.lines,
            ),
            Node::Dir(d) => (
                &d.id,
                &d.judged,
                Some(&v.folder),
                if d.path.is_empty() {
                    String::new()
                } else {
                    format!("dir:{}", parent_dir(&d.path))
                },
                d.measures.lines,
            ),
            _ => continue,
        };
        let axes = judged.as_ref().map(|j| &j["axes"]).unwrap_or(&Value::Null);
        if let Some(s) = axes["importance"]["score"].as_f64() {
            importance.insert(id.clone(), (s / importance_top).clamp(0.0, 1.0));
        }
        own.insert(id.clone(), concepts.and_then(|c| own_quality(c, axes)));
        if !up.is_empty() {
            parent.insert(id.clone(), up);
        }
        lines.insert(id.clone(), size.max(1));
        // Definitions first, then files and folders from the deepest path up.
        let path = id.split_once(':').map_or("", |(_, p)| p);
        let segments = if path.is_empty() {
            0
        } else {
            path.matches('/').count() + 1
        };
        depth.insert(
            id.clone(),
            if id.starts_with("def:") {
                usize::MAX
            } else {
                segments
            },
        );
    }
    importance.insert("dir:".into(), 1.0);
    // Deepest first, so every part is settled before what holds it.
    let mut order: Vec<&String> = own.keys().collect();
    order.sort_by_key(|id| std::cmp::Reverse(depth[*id]));
    let mut gathered: HashMap<String, (f64, f64)> = HashMap::new();
    for id in order {
        let parts = gathered.get(id).map(|(sum, w)| sum / w);
        let q = if id.starts_with("def:") {
            own[id]
        } else {
            blend(parts, own[id])
        };
        if let Some(q) = q {
            quality.insert(id.clone(), (q, lines[id]));
            if let Some(up) = parent.get(id) {
                let e = gathered.entry(up.clone()).or_insert((0.0, 0.0));
                e.0 += q * f64::from(lines[id]);
                e.1 += f64::from(lines[id]);
            }
        }
    }
    for n in &mut graph.nodes {
        let (id, judged) = match n {
            Node::Def(d) => (&d.id, &mut d.judged),
            Node::File(f) => (&f.id, &mut f.judged),
            Node::Dir(d) => (&d.id, &mut d.judged),
            Node::Block(_) => continue,
        };
        let (i, q) = (importance.get(id), quality.get(id).map(|(q, _)| *q));
        if i.is_none() && q.is_none() {
            continue;
        }
        let j = judged.get_or_insert_with(|| json!({}));
        j["value"] = json!({ "importance": i, "quality": q });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(graph: &mut CodeGraph, id: &str, judged: Value) {
        for n in &mut graph.nodes {
            match n {
                Node::Def(d) if d.id == id => d.judged = Some(judged.clone()),
                Node::File(f) if f.id == id => f.judged = Some(judged.clone()),
                Node::Dir(d) if d.id == id => d.judged = Some(judged.clone()),
                _ => {}
            }
        }
    }

    fn value(graph: &CodeGraph, id: &str) -> Value {
        graph
            .nodes
            .iter()
            .find_map(|n| match n {
                Node::Def(d) if d.id == id => d.judged.clone(),
                Node::File(f) if f.id == id => f.judged.clone(),
                Node::Dir(d) if d.id == id => d.judged.clone(),
                _ => None,
            })
            .map(|j| j["value"].clone())
            .unwrap_or(Value::Null)
    }

    /// A definition's quality is its concepts' weighted mean; a file's is its
    /// top-level definitions' weighted by their lines, blended with its own;
    /// importance is as the container judged it, and the root's is 1.
    #[test]
    fn quality_gathers_upward_by_lines_and_importance_is_the_container_s_judgment() {
        let root = std::env::temp_dir().join(format!("gaia-axes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        let short = "export function a(x: number): number {\n  return x;\n}\n";
        let long = format!(
            "export function b(x: number): number {{\n{}  return x;\n}}\n",
            "  x += 1;\n".repeat(6)
        );
        std::fs::write(root.join("src/m.ts"), format!("{short}{long}")).unwrap();
        let mut graph = crate::graph::build(&root).unwrap();
        // Readability and simplicity 3 of 3 for `a`; 0 of 3 for both on `b`.
        let top = json!({ "readability": { "score": 3.0 }, "simplicity": { "score": 3.0 }, "importance": { "score": 2.0 } });
        let bottom = json!({ "readability": { "score": 0.0 }, "simplicity": { "score": 0.0 }, "importance": { "score": 4.0 } });
        set(&mut graph, "def:src/m.ts#a", json!({ "axes": top }));
        set(&mut graph, "def:src/m.ts#b", json!({ "axes": bottom }));
        set(
            &mut graph,
            "file:src/m.ts",
            json!({ "axes": { "cohesion": { "score": 3.0 }, "importance": { "score": 4.0 } } }),
        );
        values(&mut graph);
        let (a, b, f) = (
            value(&graph, "def:src/m.ts#a"),
            value(&graph, "def:src/m.ts#b"),
            value(&graph, "file:src/m.ts"),
        );
        assert_eq!(a["quality"], json!(1.0));
        assert_eq!(b["quality"], json!(0.0));
        assert_eq!(a["importance"], json!(0.5));
        // `a` is 3 lines and `b` 9, so the parts come to 3/12; the file's own is 1.
        let parts = 3.0 / 12.0;
        let g = &vocab().gather;
        let expected = (parts * g.parts + g.own) / (g.parts + g.own);
        assert!(
            (f["quality"].as_f64().unwrap() - expected).abs() < 1e-9,
            "{f}"
        );
        assert_eq!(value(&graph, "dir:")["importance"], json!(1.0));
        std::fs::remove_dir_all(root).unwrap();
    }
}
