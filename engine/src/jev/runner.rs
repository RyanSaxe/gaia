//! The Jev runner: the one part of the engine that decides what to ask Jev
//! about the code graph, and when. For each file it gathers every call of a
//! pass that applies and builds one request: the file's source, an outline
//! of its definitions, each call's part, and every call's questions; a
//! directory's request holds its files' and subdirectories' answers
//! instead of source. A request too big for Jev's window is cut at the
//! file's top-level definitions into pieces sized by source and questions
//! together. A request already answered (the store's `calls` table, by the
//! request's hash) is never sent again, and a fresh answer replaces a held
//! one (the `held` table, by lineage) only when it clearly differs
//! (`hold.rs`).
//!
//! Every slice rebuilds what it wants from what is answered, so the passes
//! wait for each other: understand waits for every link, a test's checks
//! for its kind, the deep questions for the world's choice and its file's
//! understanding, and a directory for everything under it, deepest first.
//!
//! The world drives it in slices: `plan` says what is wanted and what is
//! already answered, `next` sends what is ready and returns the nodes that
//! settled, `deepen` records the world's chosen nodes, and `ask` answers
//! one follow-up at once.

use super::calls::{self, Call, Ctx, Question, Unit};
use super::tokens::tokens;
use super::{client, hold};
use crate::graph::model::{CodeGraph, DirNode, Edge, FileNode, Filled, Node};
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
/// Held link answers are kept under this prefix and the reference's key.
const LINK: &str = "link";

/// One request, and what each of its questions is about.
struct Planned {
    pass: &'static str,
    /// The file or directory the request is about.
    unit: String,
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
    line: Option<u32>,
}

/// What the world chose, and how many requests Jev takes at once, for one project root.
struct Session {
    deep: BTreeSet<String>,
    concurrency: usize,
}

fn sessions() -> &'static Mutex<HashMap<PathBuf, Session>> {
    static S: OnceLock<Mutex<HashMap<PathBuf, Session>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

fn session_of(root: &Path) -> Result<(BTreeSet<String>, usize), String> {
    let all = sessions().lock().map_err(|e| e.to_string())?;
    Ok(all
        .get(root)
        .map_or((BTreeSet::new(), client::CONCURRENCY), |s| {
            (s.deep.clone(), s.concurrency)
        }))
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

/// The references Jev resolved, from the held answers, by reference key.
/// An answer from an earlier version of its call no longer holds.
fn links(held: &Value) -> crate::graph::Links {
    let current: HashSet<String> = calls::registry()
        .into_iter()
        .filter(|c| c.pass() == LINK)
        .map(|c| format!("{}@{}", c.id(), c.version()))
        .collect();
    held.as_object()
        .into_iter()
        .flatten()
        .filter_map(|(key, v)| {
            let r = key.strip_prefix(&format!("{LINK}|"))?;
            if !current.contains(v["call"].as_str()?) {
                return None;
            }
            let target = v["answer"]["choice"].as_str()?.to_string();
            let link = crate::graph::Link {
                p: v["answer"]["p"][&target].as_f64().unwrap_or(0.0),
                target,
                call: v["call"].as_str().unwrap_or("").to_string(),
                candidates: v["candidates"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|c| c.as_str().map(str::to_string))
                    .collect(),
            };
            Some((r.to_string(), link))
        })
        .collect()
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

fn questions_of(ctx: &Ctx, unit: Unit, calls: &[&dyn Call]) -> Vec<Asked> {
    calls
        .iter()
        .flat_map(|c| {
            let call = format!("{}@{}", c.id(), c.version());
            c.questions(ctx, unit).into_iter().map(
                move |Question {
                          id,
                          about,
                          field,
                          json,
                          line,
                      }| Asked {
                    id,
                    about,
                    field,
                    call: call.clone(),
                    json,
                    line,
                },
            )
        })
        .collect()
}

/// Questions that don't fit beside a state go in more requests that share it.
fn pack(
    pass: &'static str,
    unit: &str,
    state: Value,
    weight: f64,
    questions: &[&Asked],
    out: &mut Vec<Planned>,
) {
    let size_of = |q: &Asked| tokens(&q.id) + tokens(&q.json.to_string()) + 3;
    let state_size = tokens(&state.to_string());
    let mut batch: Vec<&Asked> = Vec::new();
    let mut size = state_size;
    let mut flush = |batch: &mut Vec<&Asked>| {
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
            unit: unit.to_string(),
            hash: hash(&request),
            request,
            weight,
            questions: batch.iter().map(|q| (*q).clone()).collect(),
        });
        batch.clear();
    };
    for q in questions {
        let q_size = size_of(q);
        if !batch.is_empty() && size + q_size > BUDGET {
            flush(&mut batch);
            size = state_size;
        }
        batch.push(q);
        size += q_size;
    }
    flush(&mut batch);
}

/// The requests one pass makes about a directory: its parts and questions, no source.
fn dir_requests(ctx: &Ctx, repository: &str, dir: &DirNode, calls: &[&dyn Call]) -> Vec<Planned> {
    let unit = Unit::Dir(dir);
    let calls: Vec<&dyn Call> = calls
        .iter()
        .copied()
        .filter(|c| c.applies(ctx, unit))
        .collect();
    let Some(first) = calls.first() else {
        return Vec::new();
    };
    let mut state = Map::new();
    state.insert("repository".into(), json!(repository));
    // The directory call's part goes under its own id, "directory".
    state.insert(
        "path".into(),
        json!(if dir.path.is_empty() {
            "(the repository's root)"
        } else {
            dir.path.as_str()
        }),
    );
    for c in &calls {
        if let Some(part) = c.part(ctx, unit, BUDGET / 2) {
            state.insert(c.id().into(), part);
        }
    }
    let questions = questions_of(ctx, unit, &calls);
    let mut out = Vec::new();
    pack(
        first.pass(),
        &dir.id,
        Value::Object(state),
        1.0,
        &questions.iter().collect::<Vec<_>>(),
        &mut out,
    );
    out
}

/// The requests one pass makes about a file: every applicable call's part
/// and questions, cut to fit the window.
fn file_requests(
    ctx: &Ctx,
    root: &Path,
    repository: &str,
    file: &FileNode,
    calls: &[&dyn Call],
) -> Vec<Planned> {
    let unit = Unit::File(file);
    let calls: Vec<&dyn Call> = calls
        .iter()
        .copied()
        .filter(|c| c.applies(ctx, unit))
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
        if let Some(part) = c.part(ctx, unit, budget / 8) {
            base.insert(c.id().into(), part);
        }
    }
    let questions = questions_of(ctx, unit, &calls);
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
    // The line a question is about: its node's first line, or a reference's own line.
    let line_of = |q: &Asked| spans.get(q.about.as_str()).map(|(s, _)| *s).or(q.line);
    let line_count = text.lines().count().max(1);
    let mut load = vec![0usize; line_count];
    let mut whole_file = 0usize;
    for q in &questions {
        match line_of(q) {
            Some(s) => load[(s as usize).clamp(1, line_count) - 1] += size_of(q),
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
    // Each question about a line goes to the first piece that holds it.
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
        // A question about a line goes in the piece that holds it; one about
        // the whole file in the first piece, which has the file's whole outline.
        let mine: Vec<&Asked> = questions
            .iter()
            .filter(|q| match line_of(q) {
                Some(s) => home(s).is_none_or(|h| h == index),
                None => index == 0,
            })
            .collect();
        // A piece carries only the parts of the calls it asks.
        if pieces.len() > 1 {
            let asking: HashSet<&str> = mine
                .iter()
                .map(|q| q.call.split('@').next().unwrap_or(""))
                .collect();
            for c in &calls {
                if !asking.contains(c.id()) {
                    state.remove(c.id());
                }
            }
        }
        pack(
            pass,
            &file.id,
            Value::Object(state),
            weight,
            &mine,
            &mut out,
        );
    }
    out
}

/// Everything a project wants asked now, given what is answered: the graph
/// with Jev's links, every request whose waits are met, and the hashes the
/// store already answered.
struct Wanted {
    project: String,
    graph: CodeGraph,
    planned: Vec<Planned>,
    answered: HashSet<String>,
}

fn wanted(root: &Path, deep: &BTreeSet<String>) -> Result<Wanted, String> {
    let project = crate::graph::project_id(root);
    let held = store::read(&project, "held")?;
    let graph = crate::graph::build_linked(root, &links(&held))?;
    let answered: HashSet<String> = store::read(&project, "calls")?
        .as_object()
        .into_iter()
        .flatten()
        .map(|(k, _)| k.clone())
        .collect();
    let mut planned: Vec<Planned> = Vec::new();
    {
        let ctx = Ctx::new(&graph, root, &held, deep);
        let calls = calls::registry();
        let of = |pass: &str| -> Vec<&dyn Call> {
            calls.iter().copied().filter(|c| c.pass() == pass).collect()
        };
        let files: Vec<&FileNode> = graph
            .nodes
            .iter()
            .filter_map(|n| if let Node::File(f) = n { Some(f) } else { None })
            .collect();
        let done =
            |reqs: &[Planned]| !reqs.is_empty() && reqs.iter().all(|p| answered.contains(&p.hash));
        let link: Vec<Planned> = files
            .iter()
            .flat_map(|f| file_requests(&ctx, root, &graph.name, f, &of("link")))
            .collect();
        let links_done = link.iter().all(|p| answered.contains(&p.hash));
        planned.extend(link);
        if links_done {
            // Understanding, and what waits on a file's understanding.
            let mut understood: HashSet<&str> = HashSet::new();
            for f in &files {
                let reqs = file_requests(&ctx, root, &graph.name, f, &of("understand"));
                if done(&reqs) {
                    understood.insert(f.id.as_str());
                }
                planned.extend(reqs);
            }
            for f in files.iter().filter(|f| understood.contains(f.id.as_str())) {
                planned.extend(file_requests(&ctx, root, &graph.name, f, &of("tests")));
                planned.extend(file_requests(&ctx, root, &graph.name, f, &of("deep")));
            }
            // Directories, deepest first: each waits for its files and its subdirectories.
            let mut dirs: Vec<&DirNode> = graph
                .nodes
                .iter()
                .filter_map(|n| if let Node::Dir(d) = n { Some(d) } else { None })
                .collect();
            dirs.sort_by_key(|d| {
                std::cmp::Reverse(if d.path.is_empty() {
                    0
                } else {
                    d.path.matches('/').count() + 1
                })
            });
            let mut dir_done: HashSet<&str> = HashSet::new();
            for d in dirs {
                let files_ready = ctx
                    .files_in
                    .get(d.path.as_str())
                    .into_iter()
                    .flatten()
                    .all(|f| f.binary || understood.contains(f.id.as_str()));
                let subdirs_ready = ctx
                    .dirs_in
                    .get(d.path.as_str())
                    .into_iter()
                    .flatten()
                    .all(|s| dir_done.contains(s.id.as_str()));
                if !(files_ready && subdirs_ready) {
                    continue;
                }
                let reqs = dir_requests(&ctx, &graph.name, d, &of("dirs"));
                if done(&reqs) {
                    dir_done.insert(d.id.as_str());
                }
                planned.extend(reqs);
            }
        }
    }
    Ok(Wanted {
        project,
        graph,
        planned,
        answered,
    })
}

fn summary(w: &Wanted) -> Value {
    let mut by_pass: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
    let mut pending: Vec<Value> = Vec::new();
    for p in &w.planned {
        let e = by_pass.entry(p.pass).or_default();
        if w.answered.contains(&p.hash) {
            e.1 += 1;
        } else {
            e.0 += 1;
            pending.push(p.request.clone());
        }
    }
    // The estimate counts tokens as `tokens.rs` does, scaled by what Jev billed this project so far.
    let mut estimate = client::dry_run(&pending);
    let estimated: usize = pending.iter().map(|r| tokens(&r.to_string())).sum();
    let billed = (estimated as f64 * billed_per_estimated(&w.project)).round();
    estimate["estimatedTokens"] = json!(billed as u64);
    estimate["estimatedUsd"] = json!(billed * client::USD_PER_MILLION_INPUT / 1e6);
    json!({
        "pending": by_pass.iter().map(|(pass, (requests, kept))| json!({ "pass": pass, "requests": requests, "kept": kept })).collect::<Vec<_>>(),
        "estimate": estimate,
    })
}

/// Says what the project wants asked now and what is already answered. Sends nothing.
pub fn plan(root: &Path) -> Result<Value, String> {
    let (deep, _) = session_of(root)?;
    Ok(summary(&wanted(root, &deep)?))
}

/// Sends up to `max` requests that are ready, and holds the answers of every
/// file or directory a pass has now fully answered.
pub fn next(root: &Path, max: Option<usize>) -> Result<Value, String> {
    let (deep, concurrency) = session_of(root)?;
    let w = wanted(root, &deep)?;
    let ready: Vec<usize> = (0..w.planned.len())
        .filter(|&i| !w.answered.contains(&w.planned[i].hash))
        .take(max.unwrap_or(DEFAULT_SLICE))
        .collect();
    let unsettled = unsettled(
        &w,
        &store::read(&w.project, "held")?,
        &store::read(&w.project, "calls")?,
    );
    if ready.is_empty() && unsettled.is_empty() {
        return Ok(json!({ "sent": 0, "failed": 0, "left": 0, "settled": [] }));
    }
    // A link held anew changes the graph every other request is built on,
    // so this slice only holds; the next builds on the graph it leaves.
    let ready = if unsettled.iter().any(|(_, pass)| *pass == LINK) {
        Vec::new()
    } else {
        ready
    };
    let requests: Vec<Value> = ready
        .iter()
        .map(|&i| w.planned[i].request.clone())
        .collect();
    let (answers, overloaded) = if requests.is_empty() {
        (Vec::new(), false)
    } else {
        client::send_all(requests, concurrency)?
    };
    let concurrency = if overloaded {
        (concurrency / 2).max(1)
    } else if ready.is_empty() {
        concurrency
    } else {
        (concurrency + CONCURRENCY_STEP).min(client::CONCURRENCY)
    };
    sessions()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(root.to_path_buf(), Session { deep, concurrency });

    let mut writes: Vec<Value> = Vec::new();
    let mut fresh: HashMap<String, Value> = HashMap::new();
    let (mut failed, mut estimated, mut billed) = (0usize, 0usize, 0u64);
    let mut touched: BTreeSet<(&str, &str)> = BTreeSet::new();
    for (&i, answer) in ready.iter().zip(&answers) {
        let p = &w.planned[i];
        if let Some(e) = answer.get("error") {
            if failed < 3 {
                eprintln!(
                    "gaia-engine: a request about {} failed: {}",
                    p.unit,
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
        let kept = json!({ "answers": answer["answers"], "calls": calls, "unit": p.unit, "at": now(), "inputTokens": answer["inputTokens"], "costUsd": answer["costUsd"] });
        writes.push(json!({ "table": "calls", "key": p.hash, "value": kept }));
        fresh.insert(p.hash.clone(), answer["answers"].clone());
        estimated += tokens(&p.request.to_string());
        billed += answer["inputTokens"].as_u64().unwrap_or(0);
        touched.insert((p.unit.as_str(), p.pass));
    }
    if billed > 0 && estimated > 0 {
        writes.push(json!({ "table": "settings", "key": "jev.billedPerEstimated", "value": billed as f64 / estimated as f64 }));
    }

    // Hold the answers of every unit whose requests in a pass are now all answered.
    let lineage: HashMap<&str, &str> = w
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
    let stored = store::read(&w.project, "calls")?;
    let held = store::read(&w.project, "held")?;
    let answered = |h: &str| w.answered.contains(h) || fresh.contains_key(h);
    let mut settled: BTreeSet<String> = BTreeSet::new();
    touched.extend(unsettled);
    for (unit, pass) in touched {
        let mine: Vec<&Planned> = w
            .planned
            .iter()
            .filter(|p| p.unit == unit && p.pass == pass)
            .collect();
        if !mine.iter().all(|p| answered(&p.hash)) {
            continue;
        }
        let mut gathered: BTreeMap<(String, String, String), Vec<(f64, Value)>> = BTreeMap::new();
        // The candidates each link question offered, sorted, held with its answer.
        let mut offered: HashMap<String, Vec<&str>> = HashMap::new();
        for p in &mine {
            let answers = fresh
                .get(&p.hash)
                .cloned()
                .or_else(|| stored.get(&p.hash).map(|k| k["answers"].clone()))
                .unwrap_or(Value::Null);
            for q in &p.questions {
                if q.field == "link" {
                    let options = q.json["criteria"].as_object().into_iter().flatten();
                    let mut c: Vec<&str> = options
                        .map(|(k, _)| k.as_str())
                        .filter(|k| *k != "outside")
                        .collect();
                    c.sort_unstable();
                    offered.insert(q.about.clone(), c);
                }
                if let Some(a) = hold::normalize(&q.json, &answers[&q.id]) {
                    gathered
                        .entry((q.about.clone(), q.call.clone(), q.field.clone()))
                        .or_default()
                        .push((p.weight, a));
                }
            }
        }
        for ((node, call, field), answers) in gathered {
            let Some(fresh) = hold::combine(&answers) else {
                continue;
            };
            let call_id = call.split('@').next().unwrap_or(&call);
            let key = if field == "link" {
                format!("{LINK}|{node}")
            } else {
                let Some(l) = lineage.get(node.as_str()) else {
                    continue;
                };
                format!("{l}|{call_id}|{field}")
            };
            let mut value = json!({ "answer": fresh, "call": call });
            if field == "link" {
                value["candidates"] = json!(offered.get(&node));
            }
            // A link answer chosen among other candidates, or by an earlier
            // version of its call, never holds: the graph reads only current ones.
            let keep = held.get(&key).is_some_and(|h| {
                h["candidates"] == value["candidates"]
                    && (field != "link" || h["call"] == value["call"])
                    && !hold::replaces(&h["answer"], &fresh)
            });
            if !keep {
                writes.push(json!({ "table": "held", "key": key, "value": value }));
            }
            if field != "link" {
                settled.insert(node);
            }
        }
        settled.insert(unit.to_string());
    }
    let held_anew = writes.iter().any(|w| w["table"] == "held");
    store::put(&w.project, &writes)?;
    let sent = ready.len() - failed;
    // What is left counts only requests already known; answers can open
    // more, such as a directory's, and so can answers newly held.
    let left = w.planned.iter().filter(|p| !answered(&p.hash)).count()
        + usize::from(sent > 0 || held_anew);
    Ok(json!({ "sent": sent, "failed": failed, "left": left, "settled": settled }))
}

/// Units whose requests are all answered but whose answers aren't held as
/// they are asked now: a link answer held under other candidates or an
/// older call, or a node's answer never held. They settle without asking.
fn unsettled<'a>(w: &'a Wanted, held: &Value, calls: &Value) -> BTreeSet<(&'a str, &'static str)> {
    let lineage: HashMap<&str, &str> = w
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
    let mut out = BTreeSet::new();
    for p in w.planned.iter().filter(|p| w.answered.contains(&p.hash)) {
        let stale = p.questions.iter().any(|q| {
            if q.field == "link" {
                let h = &held[format!("{LINK}|{}", q.about)];
                let options = q.json["criteria"].as_object().into_iter().flatten();
                let mut offered: Vec<&str> = options
                    .map(|(k, _)| k.as_str())
                    .filter(|k| *k != "outside")
                    .collect();
                offered.sort_unstable();
                // Only an answer that can be held counts, so a bad one never blocks sending.
                let holdable =
                    hold::normalize(&q.json, &calls[&p.hash]["answers"][&q.id]).is_some();
                holdable
                    && (h.is_null()
                        || h["call"] != json!(q.call)
                        || h["candidates"] != json!(offered))
            } else {
                let call_id = q.call.split('@').next().unwrap_or(&q.call);
                lineage
                    .get(q.about.as_str())
                    .is_some_and(|l| held[format!("{l}|{call_id}|{}", q.field)].is_null())
            }
        });
        if stale {
            out.insert((p.unit.as_str(), p.pass));
        }
    }
    out
}

/// Records the nodes the world chose to stand, whose deep questions go once their file is understood.
pub fn deepen(root: &Path, nodes: &[String]) -> Result<Value, String> {
    let (mut deep, concurrency) = session_of(root)?;
    deep.extend(nodes.iter().cloned());
    sessions().lock().map_err(|e| e.to_string())?.insert(
        root.to_path_buf(),
        Session {
            deep: deep.clone(),
            concurrency,
        },
    );
    Ok(summary(&wanted(root, &deep)?))
}

/// Asks one call about one node's file or directory straight away, and returns its answers.
pub fn ask(root: &Path, node: &str, call_id: &str) -> Result<Value, String> {
    let project = crate::graph::project_id(root);
    let held = store::read(&project, "held")?;
    let graph = crate::graph::build_linked(root, &links(&held))?;
    let call = calls::registry()
        .into_iter()
        .find(|c| c.id() == call_id)
        .ok_or_else(|| format!("No call named {call_id}."))?;
    // Deep calls ask about the node itself.
    let deep: BTreeSet<String> = std::iter::once(node.to_string()).collect();
    let ctx = Ctx::new(&graph, root, &held, &deep);
    let unit_id = graph
        .nodes
        .iter()
        .find_map(|n| match n {
            Node::File(f) if f.id == node => Some(f.id.as_str()),
            Node::Dir(d) if d.id == node => Some(d.id.as_str()),
            Node::Def(d) if d.id == node => Some(d.file.as_str()),
            Node::Block(b) if b.id == node => Some(
                ctx.defs
                    .get(b.def.as_str())
                    .map_or(b.def.as_str(), |d| d.file.as_str()),
            ),
            _ => None,
        })
        .ok_or_else(|| format!("No node {node} in this project."))?;
    let planned = match (
        ctx.files.get(unit_id),
        graph.nodes.iter().find_map(|n| {
            if let Node::Dir(d) = n {
                (d.id == unit_id).then_some(d)
            } else {
                None
            }
        }),
    ) {
        (Some(f), _) => file_requests(&ctx, root, &graph.name, f, &[call]),
        (None, Some(d)) => dir_requests(&ctx, &graph.name, d, &[call]),
        _ => return Err(format!("Nothing holds {node}.")),
    };
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

/// The project's graph with Jev's links as edges and every node's held answers as its `judged`.
pub fn judged_graph(root: &Path) -> Result<CodeGraph, String> {
    let project = crate::graph::project_id(root);
    let held = store::read(&project, "held")?;
    let mut graph = crate::graph::build_linked(root, &links(&held))?;
    judge(&mut graph, &held);
    Ok(graph)
}

/// Fills every node's `judged` from held answers, and adds the files each test checks as edges.
fn judge(graph: &mut CodeGraph, held: &Value) {
    let mut by_lineage: HashMap<&str, Vec<(&str, &Value)>> = HashMap::new();
    for (key, value) in held.as_object().into_iter().flatten() {
        let mut parts = key.splitn(3, '|');
        if let (Some(l), Some(_call), Some(field)) = (parts.next(), parts.next(), parts.next())
            && l != LINK
        {
            by_lineage.entry(l).or_default().push((field, value));
        }
    }
    let mut checks: Vec<Edge> = Vec::new();
    for n in &mut graph.nodes {
        let (id, lineage, judged) = match n {
            Node::Dir(d) => (d.id.clone(), d.lineage.clone(), &mut d.judged),
            Node::File(f) => (f.id.clone(), f.lineage.clone(), &mut f.judged),
            Node::Def(d) => (d.id.clone(), d.lineage.clone(), &mut d.judged),
            Node::Block(b) => (b.id.clone(), b.lineage.clone(), &mut b.judged),
        };
        let Some(entries) = by_lineage.get(lineage.as_str()) else {
            continue;
        };
        let mut j = Map::new();
        for (field, value) in entries {
            let a = &value["answer"];
            let call = value["call"].clone();
            if let Some(path) = field.strip_prefix("checks:") {
                let p = a["yes"].as_f64().unwrap_or(0.0);
                if p >= 0.5 {
                    checks.push(Edge {
                        from: id.clone(),
                        to: format!("file:{path}"),
                        kind: "checks",
                        by: Filled {
                            by: "jev",
                            call: call.as_str().map(String::from),
                            p: Some(p),
                        },
                        at: None,
                    });
                }
                continue;
            }
            let filled = if let Some(choice) = a["choice"].as_str() {
                json!({ "choice": choice, "p": a["p"], "call": call })
            } else if let Some(score) = a["score"].as_f64() {
                // Until the calibration set fits each question's curve, a score's value is its share of the scale.
                let top = (a["levels"].as_f64().unwrap_or(2.0) - 1.0).max(1.0);
                json!({ "score": score, "value": (score / top).clamp(0.0, 1.0), "call": call })
            } else {
                json!({ "p": a["yes"], "call": call })
            };
            // "quality.readability" goes under quality, "does.parse" under does, and so on.
            match field.split_once('.') {
                Some((group, key)) => {
                    let g = j.entry(group.to_string()).or_insert_with(|| json!({}));
                    g[key] = filled;
                }
                None => {
                    j.insert(field.to_string(), filled);
                }
            }
        }
        *judged = Some(Value::Object(j));
    }
    graph.edges.extend(checks);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_link_answer_holds_only_for_its_call_s_current_version() {
        let resolve = calls::registry()
            .into_iter()
            .find(|c| c.id() == "resolve")
            .unwrap();
        let answer = json!({ "choice": "file:x.ts", "p": { "file:x.ts": 0.9 } });
        let held = json!({
            "link|now": { "answer": answer, "call": format!("resolve@{}", resolve.version()), "candidates": ["file:x.ts"] },
            "link|before": { "answer": answer, "call": "resolve@00000000-1", "candidates": ["file:x.ts"] },
        });
        let l = links(&held);
        assert!(l.contains_key("now"));
        assert!(!l.contains_key("before"));
    }
}
