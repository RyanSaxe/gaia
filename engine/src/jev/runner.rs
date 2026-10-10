//! The Jev runner: the one part of the engine that decides what to ask Jev
//! about the code graph, and when. For each file it gathers every call that
//! applies and builds one request: the file's source, its definitions and
//! blocks, each call's part, and every call's questions. A request too big
//! for Jev's window is split, first at the file's top-level definitions,
//! then by its questions, which share the state. A request already answered
//! (the store's `calls` table, by the request's hash) is never sent again,
//! and a fresh answer replaces a held one (the `held` table, by lineage)
//! only when it clearly differs (`hold.rs`).
//!
//! The world drives it in slices: `plan` builds every request and says what
//! is already answered, `next` sends what is ready and returns the nodes
//! that settled, `deepen` queues deep questions for chosen nodes, and `ask`
//! answers one follow-up at once.

use super::calls::{self, Call, Ctx, Question};
use super::tokens::tokens;
use super::{client, hold};
use crate::graph::model::{CodeGraph, FileNode, Node};
use crate::store;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MODEL: &str = "typesafe/jev-1.13";
/// Jev reads 32,000 tokens. A request stops at 30,000 estimated tokens
/// (`tokens.rs`), which Jev bills at about 30,800 for the densest text and
/// 22,000 for the median.
const BUDGET: usize = 30_000;
/// Billed tokens per estimated token before a project's first answers say
/// otherwise: the median of the bench's first 720 requests.
const START_BILLED_PER_ESTIMATED: f64 = 0.73;
/// How much of a request the outline of a file's definitions may take.
const OUTLINE_SHARE: f64 = 0.2;
/// After a slice Jev took without complaint, this many more requests go at once.
const CONCURRENCY_STEP: usize = 8;
const DEFAULT_SLICE: usize = 256;

/// One request, and what each of its questions is about.
struct Planned {
    pass: &'static str,
    file: String,
    request: Value,
    hash: String,
    /// Bytes of source it read, which weigh a chunk's answers.
    weight: f64,
    questions: Vec<Asked>,
}

#[derive(Clone)]
struct Asked {
    id: String,
    about: String,
    field: String,
    call: String,
    json: Value,
}

struct Session {
    project: String,
    graph: CodeGraph,
    planned: Vec<Planned>,
    answered: HashSet<String>,
    deep: BTreeSet<String>,
    concurrency: usize,
}

fn sessions() -> &'static Mutex<HashMap<PathBuf, Session>> {
    static S: OnceLock<Mutex<HashMap<PathBuf, Session>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

fn hash(request: &Value) -> String {
    Sha256::digest(request.to_string().as_bytes())
        .iter()
        .take(16)
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// How many tokens Jev bills for each estimated one, as this project's
/// answers taught it. It prices requests; it never lays them out, so a
/// stored answer is always found again.
fn billed_per_estimated(project: &str) -> f64 {
    store::get(project, "settings", "jev.billedPerEstimated")
        .ok()
        .flatten()
        .and_then(|v| v.as_f64())
        .filter(|r| *r > 0.1)
        .unwrap_or(START_BILLED_PER_ESTIMATED)
}

/// The lines of a file split at its top-level definitions into pieces
/// whose source and questions together stay within `limit` tokens, as
/// 1-based line ranges. `load[i]` is the size of the questions about nodes
/// that start on line `i + 1`, so a piece carries only its own source and
/// its own questions, and the source goes out once.
fn chunks(text: &str, starts: &[u32], load: &[usize], limit: usize) -> Vec<(u32, u32)> {
    let lines: Vec<&str> = text.lines().collect();
    let total = lines.len() as u32;
    let mut cuts: Vec<u32> = starts
        .iter()
        .copied()
        .filter(|s| *s > 1 && *s <= total)
        .collect();
    cuts.sort_unstable();
    cuts.dedup();
    let mut out: Vec<(u32, u32)> = Vec::new();
    let mut start = 1u32;
    let mut size = 0usize;
    for line in 1..=total {
        let len = tokens(lines[(line - 1) as usize])
            + 1
            + load.get((line - 1) as usize).copied().unwrap_or(0);
        let at_cut = cuts.binary_search(&line).is_ok();
        // A piece ends at a definition's start once it is full, or anywhere when one definition alone is too big.
        if line > start && size + len > limit && (at_cut || size > limit) {
            out.push((start, line - 1));
            start = line;
            size = 0;
        }
        size += len;
    }
    if start <= total {
        out.push((start, total));
    }
    if out.is_empty() {
        out.push((1, total.max(1)));
    }
    out
}

/// A file's definitions for a request's state, within `limit` tokens: names
/// and lines beside the whole source, which shows the rest, or full
/// signatures beside one piece, the piece's own first.
fn outline(ctx: &Ctx, file: &str, (start, end): (u32, u32), piece: bool, limit: usize) -> Value {
    let all = ctx.outline(file);
    let inside = |d: &Value| {
        d["lines"][0]
            .as_u64()
            .is_some_and(|l| (start as u64..=end as u64).contains(&l))
    };
    let ordered: Vec<&Value> = all
        .iter()
        .filter(|d| inside(d))
        .chain(all.iter().filter(|d| piece && !inside(d)))
        .collect();
    let mut out: Vec<Value> = Vec::new();
    let mut used = 0;
    for d in ordered {
        let entry = if piece {
            d.clone()
        } else {
            json!({ "name": d["name"], "role": d["role"], "lines": d["lines"] })
        };
        used += tokens(&entry.to_string()) + 1;
        if used > limit {
            break;
        }
        out.push(entry);
    }
    Value::Array(out)
}

/// A piece of a file: its first and last lines, and the bytes it holds.
#[derive(Clone, Copy)]
struct Piece {
    first: u32,
    last: u32,
    start: usize,
    end: usize,
}

/// Line ranges as byte ranges, with a range longer than `limit` tokens,
/// such as a minified file's one line, cut at character boundaries.
fn pieces_of(text: &str, ranges: &[(u32, u32)], limit: usize) -> Vec<Piece> {
    let mut starts: Vec<usize> = vec![0];
    starts.extend(text.match_indices('\n').map(|(i, _)| i + 1));
    let byte_of = |line: u32| {
        starts
            .get((line - 1) as usize)
            .copied()
            .unwrap_or(text.len())
    };
    let mut out = Vec::new();
    for &(first, last) in ranges {
        let (start, end) = (
            byte_of(first),
            if (last as usize) < starts.len() {
                byte_of(last + 1)
            } else {
                text.len()
            },
        );
        // A range over `limit` tokens, such as one minified line, is cut into
        // even slices of bytes that each come to about `limit` tokens.
        let count = tokens(&text[start..end]).div_ceil(limit.max(1)).max(1);
        let step = (end - start).div_ceil(count).max(1);
        let mut at = start;
        while at < end {
            let mut cut = (at + step).min(end);
            while !text.is_char_boundary(cut) {
                cut += 1;
            }
            out.push(Piece {
                first,
                last,
                start: at,
                end: cut,
            });
            at = cut;
        }
        if start == end {
            out.push(Piece {
                first,
                last,
                start,
                end,
            });
        }
    }
    out
}

/// The requests for one file: every applicable call's part and questions,
/// split to fit the window.
fn requests_for(
    ctx: &Ctx,
    root: &Path,
    repository: &str,
    file: &FileNode,
    calls: &[&dyn Call],
) -> Vec<Planned> {
    let calls: Vec<&dyn Call> = calls
        .iter()
        .copied()
        .filter(|c| c.applies(ctx, file))
        .collect();
    if calls.is_empty() {
        return Vec::new();
    }
    let Ok(text) = std::fs::read_to_string(root.join(&file.path)) else {
        return Vec::new();
    };
    let budget = BUDGET;
    let mut base = Map::new();
    base.insert("repository".into(), json!(repository));
    base.insert("path".into(), json!(file.path));
    base.insert("language".into(), json!(file.language));
    if !file.conventions.is_empty() {
        base.insert("conventions".into(), json!(file.conventions));
    }
    // Blocks are named by their own questions, with their shape, lines and holder.
    for c in &calls {
        if let Some(part) = c.part(ctx, file, budget / 8) {
            base.insert(c.id().into(), part);
        }
    }
    let questions: Vec<Asked> = calls
        .iter()
        .flat_map(|c| {
            let call = format!("{}@{}", c.id(), c.version());
            c.questions(ctx, file).into_iter().map(
                move |Question {
                          id,
                          about,
                          field,
                          json,
                      }| Asked {
                    id,
                    about,
                    field,
                    call: call.clone(),
                    json,
                },
            )
        })
        .collect();
    let pass = calls[0].pass();

    // The source, whole or in pieces at its top-level definitions, sized by
    // the source and the questions together.
    let fixed =
        tokens(&Value::Object(base.clone()).to_string()) + (budget as f64 * OUTLINE_SHARE) as usize;
    let spans: HashMap<&str, (u32, u32)> = ctx
        .defs_of
        .get(file.id.as_str())
        .into_iter()
        .flatten()
        .map(|d| (d.id.as_str(), (d.span.start, d.span.end)))
        .chain(
            ctx.blocks_of
                .get(file.id.as_str())
                .into_iter()
                .flatten()
                .map(|(id, _, s, e, _)| (*id, (*s, *e))),
        )
        .collect();
    let size_of = |q: &Asked| tokens(&q.id) + tokens(&q.json.to_string()) + 3;
    let line_count = text.lines().count().max(1);
    let mut load = vec![0usize; line_count];
    let mut whole_file = 0usize;
    for q in &questions {
        match spans.get(q.about.as_str()) {
            Some((s, _)) => load[(*s as usize).clamp(1, line_count) - 1] += size_of(q),
            None => whole_file += size_of(q),
        }
    }
    let all_questions: usize = load.iter().sum::<usize>() + whole_file;
    let limit = ((budget as f64 * 0.9) as usize)
        .saturating_sub(fixed + whole_file)
        .max(2048);
    let ranges = if fixed + tokens(&text) + all_questions <= budget {
        vec![(1, line_count as u32)]
    } else {
        let starts: Vec<u32> = ctx
            .defs_of
            .get(file.id.as_str())
            .into_iter()
            .flatten()
            .filter(|d| d.parent.is_none())
            .map(|d| d.span.start)
            .collect();
        chunks(&text, &starts, &load, limit)
    };
    let pieces = pieces_of(&text, &ranges, limit);
    let total_lines = text.lines().count() as u32;
    let mut out = Vec::new();
    // Each question about a node goes to the first piece that holds the node's first line.
    let home = |line: u32| {
        pieces
            .iter()
            .position(|p| p.first <= line && line <= p.last)
    };
    for (index, piece) in pieces.iter().enumerate() {
        let mut state = base.clone();
        state.insert(
            "definitions".into(),
            outline(
                ctx,
                &file.id,
                (piece.first, piece.last),
                pieces.len() > 1,
                (budget as f64 * OUTLINE_SHARE) as usize,
            ),
        );
        if pieces.len() == 1 {
            state.insert("source".into(), json!(text));
        } else {
            state.insert("source".into(), json!(&text[piece.start..piece.end]));
            state.insert(
                "chunk".into(),
                json!({ "lines": [piece.first, piece.last], "of": total_lines }),
            );
        }
        let weight = state["source"].as_str().map_or(0, str::len) as f64;
        // A question about the whole file goes in every piece; one about a definition or block, in the piece that holds it.
        let mine: Vec<&Asked> = questions
            .iter()
            .filter(|q| match spans.get(q.about.as_str()) {
                Some((s, _)) => home(*s).is_none_or(|h| h == index),
                None => true,
            })
            .collect();
        let state = Value::Object(state);
        let state_size = tokens(&state.to_string());
        // Questions that don't fit beside the state go in more requests that share it.
        let mut batch: Vec<&Asked> = Vec::new();
        let mut size = state_size;
        let flush = |batch: &mut Vec<&Asked>, out: &mut Vec<Planned>| {
            if batch.is_empty() {
                return;
            }
            let qs: Map<String, Value> = batch
                .iter()
                .map(|q| (q.id.clone(), q.json.clone()))
                .collect();
            let request = json!({ "model": MODEL, "state": state, "questions": qs });
            out.push(Planned {
                pass,
                file: file.id.clone(),
                hash: hash(&request),
                request,
                weight,
                questions: batch.iter().map(|q| (*q).clone()).collect(),
            });
            batch.clear();
        };
        for q in mine {
            let q_size = size_of(q);
            if !batch.is_empty() && size + q_size > budget {
                flush(&mut batch, &mut out);
                size = state_size;
            }
            batch.push(q);
            size += q_size;
        }
        flush(&mut batch, &mut out);
    }
    out
}

fn summary(s: &Session) -> Value {
    let mut by_pass: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
    let mut pending: Vec<Value> = Vec::new();
    for p in &s.planned {
        let e = by_pass.entry(p.pass).or_default();
        if s.answered.contains(&p.hash) {
            e.1 += 1;
        } else {
            e.0 += 1;
            pending.push(p.request.clone());
        }
    }
    // The estimate counts tokens as `tokens.rs` does, scaled by what Jev billed this project so far.
    let mut estimate = client::dry_run(&pending);
    let estimated: usize = pending.iter().map(|r| tokens(&r.to_string())).sum();
    let billed = (estimated as f64 * billed_per_estimated(&s.project)).round();
    estimate["estimatedTokens"] = json!(billed as u64);
    estimate["estimatedUsd"] = json!(billed * client::USD_PER_MILLION_INPUT / 1e6);
    json!({
        "pending": by_pass.iter().map(|(pass, (requests, kept))| json!({ "pass": pass, "requests": requests, "kept": kept })).collect::<Vec<_>>(),
        "estimate": estimate,
    })
}

/// Builds the project's graph and every request about it, and says what
/// is already answered. Sends nothing.
pub fn plan(root: &Path) -> Result<Value, String> {
    let graph = crate::graph::build(root)?;
    let project = graph.project_id.clone();
    let planned: Vec<Planned> = {
        let ctx = Ctx::new(&graph);
        let calls = calls::registry();
        graph
            .nodes
            .iter()
            .filter_map(|n| match n {
                Node::File(f) => Some(f),
                _ => None,
            })
            .flat_map(|f| requests_for(&ctx, root, &graph.name, f, &calls))
            .collect()
    };
    let kept = store::read(&project, "calls")?;
    let answered: HashSet<String> = planned
        .iter()
        .filter(|p| kept.get(&p.hash).is_some())
        .map(|p| p.hash.clone())
        .collect();
    let mut all = sessions().lock().map_err(|e| e.to_string())?;
    let deep = all.get(root).map(|s| s.deep.clone()).unwrap_or_default();
    let concurrency = all.get(root).map_or(client::CONCURRENCY, |s| s.concurrency);
    let session = Session {
        project,
        graph,
        planned,
        answered,
        deep,
        concurrency,
    };
    let out = summary(&session);
    all.insert(root.to_path_buf(), session);
    Ok(out)
}

/// Sends up to `max` requests that are ready, and holds their answers.
pub fn next(root: &Path, max: Option<usize>) -> Result<Value, String> {
    if !sessions()
        .lock()
        .map_err(|e| e.to_string())?
        .contains_key(root)
    {
        plan(root)?;
    }
    let mut all = sessions().lock().map_err(|e| e.to_string())?;
    let s = all.get_mut(root).ok_or("No plan for this root.")?;
    let ready: Vec<usize> = (0..s.planned.len())
        .filter(|&i| !s.answered.contains(&s.planned[i].hash))
        .take(max.unwrap_or(DEFAULT_SLICE))
        .collect();
    if ready.is_empty() {
        return Ok(json!({ "sent": 0, "failed": 0, "left": 0, "settled": [] }));
    }
    let requests: Vec<Value> = ready
        .iter()
        .map(|&i| s.planned[i].request.clone())
        .collect();
    let (answers, overloaded) = client::send_all(requests, s.concurrency)?;
    s.concurrency = if overloaded {
        (s.concurrency / 2).max(1)
    } else {
        (s.concurrency + CONCURRENCY_STEP).min(client::CONCURRENCY)
    };

    let mut writes: Vec<Value> = Vec::new();
    let mut fresh: HashMap<String, Value> = HashMap::new();
    let (mut failed, mut estimated, mut billed) = (0usize, 0usize, 0u64);
    let mut touched: BTreeSet<String> = BTreeSet::new();
    for (&i, answer) in ready.iter().zip(&answers) {
        let p = &s.planned[i];
        if let Some(e) = answer.get("error") {
            if failed < 3 {
                eprintln!(
                    "gaia-engine: a request about {} failed: {}",
                    p.file,
                    e.as_str()
                        .unwrap_or("")
                        .chars()
                        .take(300)
                        .collect::<String>()
                );
            }
            failed += 1;
            continue;
        }
        let calls: BTreeSet<&str> = p.questions.iter().map(|q| q.call.as_str()).collect();
        let kept = json!({ "answers": answer["answers"], "calls": calls, "file": p.file, "at": now(), "inputTokens": answer["inputTokens"], "costUsd": answer["costUsd"] });
        writes.push(json!({ "table": "calls", "key": p.hash, "value": kept }));
        fresh.insert(p.hash.clone(), answer["answers"].clone());
        estimated += tokens(&p.request.to_string());
        billed += answer["inputTokens"].as_u64().unwrap_or(0);
        touched.insert(p.file.clone());
        s.answered.insert(p.hash.clone());
    }
    if billed > 0 && estimated > 0 {
        writes.push(json!({ "table": "settings", "key": "jev.billedPerEstimated", "value": billed as f64 / estimated as f64 }));
    }

    // Hold the answers of every file now fully answered.
    let lineage: HashMap<&str, &str> = s
        .graph
        .nodes
        .iter()
        .map(|n| match n {
            Node::Dir(d) => (d.id.as_str(), d.lineage.as_str()),
            Node::File(f) => (f.id.as_str(), f.lineage.as_str()),
            Node::Def(d) => (d.id.as_str(), d.lineage.as_str()),
            Node::Block(b) => (b.id.as_str(), b.lineage.as_str()),
        })
        .collect();
    let stored = store::read(&s.project, "calls")?;
    let held = store::read(&s.project, "held")?;
    let mut settled: Vec<String> = Vec::new();
    for file in &touched {
        let mine: Vec<&Planned> = s.planned.iter().filter(|p| &p.file == file).collect();
        if !mine.iter().all(|p| s.answered.contains(&p.hash)) {
            continue;
        }
        let mut gathered: BTreeMap<(String, String, String), Vec<(f64, Value)>> = BTreeMap::new();
        for p in &mine {
            let answers = fresh
                .get(&p.hash)
                .cloned()
                .or_else(|| stored.get(&p.hash).map(|k| k["answers"].clone()))
                .unwrap_or(Value::Null);
            for q in &p.questions {
                if let Some(a) = hold::normalize(&q.json, &answers[&q.id]) {
                    gathered
                        .entry((q.about.clone(), q.call.clone(), q.field.clone()))
                        .or_default()
                        .push((p.weight, a));
                }
            }
        }
        let mut about: BTreeSet<String> = BTreeSet::new();
        for ((node, call, field), answers) in gathered {
            let Some(fresh) = hold::combine(&answers) else {
                continue;
            };
            let Some(l) = lineage.get(node.as_str()) else {
                continue;
            };
            let call_id = call.split('@').next().unwrap_or(&call);
            let key = format!("{l}|{call_id}|{field}");
            let keep = held
                .get(&key)
                .is_some_and(|h| !hold::replaces(&h["answer"], &fresh));
            if !keep {
                writes.push(json!({ "table": "held", "key": key, "value": { "answer": fresh, "call": call } }));
            }
            about.insert(node);
        }
        settled.extend(about);
    }
    store::put(&s.project, &writes)?;
    let left = s
        .planned
        .iter()
        .filter(|p| !s.answered.contains(&p.hash))
        .count();
    Ok(json!({ "sent": ready.len() - failed, "failed": failed, "left": left, "settled": settled }))
}

/// Queues deep questions for the nodes the world chose to stand. The deep
/// calls come with the rest of Jev's calls; until then this only records
/// the choice.
pub fn deepen(root: &Path, nodes: &[String]) -> Result<Value, String> {
    let mut all = sessions().lock().map_err(|e| e.to_string())?;
    if !all.contains_key(root) {
        drop(all);
        plan(root)?;
        all = sessions().lock().map_err(|e| e.to_string())?;
    }
    let s = all.get_mut(root).ok_or("No plan for this root.")?;
    s.deep.extend(nodes.iter().cloned());
    Ok(summary(s))
}

/// Asks one call about one node's file straight away, and returns its answers.
pub fn ask(root: &Path, node: &str, call_id: &str) -> Result<Value, String> {
    let graph = crate::graph::build(root)?;
    let call = calls::registry()
        .into_iter()
        .find(|c| c.id() == call_id)
        .ok_or_else(|| format!("No call named {call_id}."))?;
    // The file the node lies in: a file is its own; a definition names its file; a block, its holder.
    let def_file: HashMap<&str, &str> = graph
        .nodes
        .iter()
        .filter_map(|n| match n {
            Node::Def(d) => Some((d.id.as_str(), d.file.as_str())),
            _ => None,
        })
        .collect();
    let file_id = graph
        .nodes
        .iter()
        .find_map(|n| match n {
            Node::File(f) if f.id == node => Some(f.id.as_str()),
            Node::Def(d) if d.id == node => Some(d.file.as_str()),
            Node::Block(b) if b.id == node => Some(
                def_file
                    .get(b.def.as_str())
                    .copied()
                    .unwrap_or(b.def.as_str()),
            ),
            _ => None,
        })
        .ok_or_else(|| format!("No node {node} in this project."))?;
    let file = graph
        .nodes
        .iter()
        .find_map(|n| match n {
            Node::File(f) if f.id == file_id => Some(f),
            _ => None,
        })
        .ok_or_else(|| format!("No file holds {node}."))?;
    let ctx = Ctx::new(&graph);
    let planned = requests_for(&ctx, root, &graph.name, file, &[call]);
    let (answers, _) = client::send_all(
        planned.iter().map(|p| p.request.clone()).collect(),
        client::CONCURRENCY,
    )?;
    let mut out = Map::new();
    for (p, a) in planned.iter().zip(&answers) {
        if let Some(e) = a.get("error") {
            return Err(e.as_str().unwrap_or("Jev failed.").to_string());
        }
        for q in &p.questions {
            if let Some(n) = hold::normalize(&q.json, &a["answers"][&q.id]) {
                out.insert(q.id.clone(), n);
            }
        }
    }
    Ok(json!({ "answers": out }))
}

/// Fills every node's `judged` from the answers its project's store holds.
pub fn judge(graph: &mut CodeGraph) -> Result<(), String> {
    let held = store::read(&graph.project_id, "held")?;
    let mut by_lineage: HashMap<&str, Vec<(&str, &Value)>> = HashMap::new();
    for (key, value) in held.as_object().into_iter().flatten() {
        let mut parts = key.splitn(3, '|');
        if let (Some(l), Some(_call), Some(field)) = (parts.next(), parts.next(), parts.next()) {
            by_lineage.entry(l).or_default().push((field, value));
        }
    }
    for n in &mut graph.nodes {
        let (lineage, judged) = match n {
            Node::Dir(d) => (d.lineage.clone(), &mut d.judged),
            Node::File(f) => (f.lineage.clone(), &mut f.judged),
            Node::Def(d) => (d.lineage.clone(), &mut d.judged),
            Node::Block(b) => (b.lineage.clone(), &mut b.judged),
        };
        let Some(entries) = by_lineage.get(lineage.as_str()) else {
            continue;
        };
        let mut j = Map::new();
        let mut does = Map::new();
        for (field, value) in entries {
            let a = &value["answer"];
            let call = value["call"].clone();
            let filled = if let Some(choice) = a["choice"].as_str() {
                json!({ "choice": choice, "p": a["p"], "call": call })
            } else if let Some(score) = a["score"].as_f64() {
                // Until the calibration set fits each question's curve, a score's value is its share of the scale.
                let top = (a["levels"].as_f64().unwrap_or(2.0) - 1.0).max(1.0);
                json!({ "score": score, "value": (score / top).clamp(0.0, 1.0), "call": call })
            } else {
                json!({ "p": a["yes"], "call": call })
            };
            match field.strip_prefix("does.") {
                Some(key) => {
                    does.insert(key.to_string(), filled);
                }
                None => {
                    j.insert(field.to_string(), filled);
                }
            }
        }
        if !does.is_empty() {
            j.insert("does".into(), Value::Object(does));
        }
        *judged = Some(Value::Object(j));
    }
    Ok(())
}
