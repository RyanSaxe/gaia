//! Chooses which requests to send Jev about the code graph, and when, in slices
//! that the world calls: `plan` reports which requests are needed and which are
//! answered, and `next` sends the ready ones. The store's `calls` table keeps
//! each answer by request hash, so no request is sent twice, and the `held`
//! table keeps answers by lineage (`hold.rs`). Each slice rebuilds its requests
//! from the answers so far, so the understanding pass's requests are ready only
//! after every link is held, a folder's after its parent's and a file's after
//! its folder's (`axes.rs`).

use super::calls::{self, Call, Ctx, Question, Unit};
use super::tokens::tokens;
use super::{client, hold};
use crate::graph::model::{CodeGraph, DirNode, FileNode, Node};
use crate::store;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MODEL: &str = "typesafe/jev-1.13";
/// Jev's window is 32,000 tokens. A request stops at 30,000 estimated tokens
/// (`tokens.rs`), which Jev bills at about 30,800 for the densest text and
/// 22,000 for the median.
const BUDGET: usize = 30_000;
/// Billed tokens per estimated token until a project's first answers report
/// billing. It is the median of the bench's first 720 requests.
const START_BILLED_PER_ESTIMATED: f64 = 0.73;
/// How much of a request the outline of a file's definitions may take.
const OUTLINE_SHARE: f64 = 0.2;
/// After a slice with no overload from Jev, the runner sends this many more requests at once.
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
    /// Bytes of source it includes, which weight a chunk's answers (`hold::combine`).
    weight: f64,
    questions: Vec<Asked>,
    /// Built only so `plan` can count it. The answers it depends on aren't in
    /// yet, so it is never sent or held.
    waiting: bool,
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

/// How many requests the runner sends Jev at once, for each project root.
fn concurrencies() -> &'static Mutex<HashMap<PathBuf, usize>> {
    static C: OnceLock<Mutex<HashMap<PathBuf, usize>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

fn concurrency_of(root: &Path) -> Result<usize, String> {
    let all = concurrencies().lock().map_err(|e| e.to_string())?;
    Ok(all.get(root).copied().unwrap_or(client::CONCURRENCY))
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

/// How many tokens Jev bills for each estimated token, from this project's
/// answers so far. It only prices requests and never changes how they are
/// split, so a stored answer is always found again.
fn billed_per_estimated(project: &str) -> f64 {
    store::get(project, "settings", "jev.billedPerEstimated")
        .ok()
        .flatten()
        .and_then(|v| v.as_f64())
        .filter(|r| *r > 0.1)
        .unwrap_or(START_BILLED_PER_ESTIMATED)
}

/// The key a link answer is held under: its reference and the candidates Jev
/// chose among. A reference whose candidates change with other links, such as
/// a call whose receiver's type comes from an import Jev resolved, keeps an
/// answer for each set, so applying one never undoes the other.
fn link_key<S: AsRef<str>>(reference: &str, candidates: &[S]) -> String {
    let joined: Vec<&str> = candidates.iter().map(AsRef::as_ref).collect();
    let digest: String = Sha256::digest(joined.join("\n").as_bytes())
        .iter()
        .take(4)
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("{LINK}|{reference}|~{digest}")
}

/// Every pending reference's candidates, sorted, by its key.
fn candidates_by_ref(graph: &CodeGraph) -> HashMap<String, Vec<&str>> {
    graph
        .pending
        .iter()
        .map(|r| {
            let mut c: Vec<&str> = r.candidates.iter().map(String::as_str).collect();
            c.sort_unstable();
            (crate::graph::ref_key(r), c)
        })
        .collect()
}

/// The candidates a link answer is held under. They are all of its
/// reference's candidates, since a question with thousands offers only the
/// nearest that fit and the graph looks the answer up by all of them. Without
/// the reference, they are the ones the question offered.
fn held_candidates<'a>(by_ref: &HashMap<String, Vec<&'a str>>, q: &'a Asked) -> Vec<&'a str> {
    if let Some(c) = by_ref.get(&q.about) {
        return c.clone();
    }
    let options = q.json["criteria"].as_object().into_iter().flatten();
    let mut c: Vec<&str> = options
        .map(|(k, _)| k.as_str())
        .filter(|k| *k != "outside")
        .collect();
    c.sort_unstable();
    c
}

/// The references Jev resolved, from the held answers, by reference key.
/// An answer from an earlier version of its call no longer applies.
fn links(held: &Value) -> crate::graph::Links {
    let current: HashSet<String> = calls::registry()
        .into_iter()
        .filter(|c| c.pass() == LINK)
        .map(|c| format!("{}@{}", c.id(), c.version()))
        .collect();
    let mut out = crate::graph::Links::new();
    let found = held
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(key, v)| {
            let (r, _) = key.strip_prefix(&format!("{LINK}|"))?.rsplit_once("|~")?;
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
        });
    for (r, link) in found {
        out.entry(r).or_default().push(link);
    }
    out
}

/// Splits a file's lines at its top-level definitions into pieces whose source
/// and questions together stay within `limit` tokens, or `first` for the first
/// piece, and returns them as 1-based line ranges. `load[i]` is the size of the
/// questions about nodes that start on line `i + 1`, so a piece has only its own
/// source and questions, and the source goes out once.
fn chunks(text: &str, starts: &[u32], load: &[usize], limit: usize, first: usize) -> Vec<(u32, u32)> {
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
        let room = if out.is_empty() { first } else { limit };
        // A piece ends at a definition's start once it is full, or anywhere when one definition alone is too big.
        if line > start && size + len > room && (at_cut || size > room) {
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

/// A file's definitions for a request's state, within `limit` tokens. Beside
/// the whole source, it lists names and lines, since the source shows the
/// rest. Beside one piece, it lists full signatures, the piece's own first.
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

/// A piece of a file: its first and last lines, its byte range, and whether it
/// cuts a line by starting after a line's start or ending before its end, as a
/// piece of one minified line does.
#[derive(Clone, Copy)]
struct Piece {
    first: u32,
    last: u32,
    start: usize,
    end: usize,
    cut: bool,
}

/// Converts line ranges to byte ranges. It cuts a range longer than `limit`
/// tokens, such as a definition too long for one request, at lines into pieces
/// of at most `limit` tokens. It cuts a single line longer than that, such as a
/// minified file's one line, at character boundaries, so every character is
/// sent.
fn pieces_of(text: &str, ranges: &[(u32, u32)], limit: usize) -> Vec<Piece> {
    let mut starts: Vec<usize> = vec![0];
    starts.extend(text.match_indices('\n').map(|(i, _)| i + 1));
    let byte_of = |line: u32| {
        starts
            .get((line - 1) as usize)
            .copied()
            .unwrap_or(text.len())
    };
    // The 1-based line a byte is on.
    let line_at = |byte: usize| starts.partition_point(|&s| s <= byte) as u32;
    let limit = limit.max(1);
    let mut out = Vec::new();
    for &(first, last) in ranges {
        let (start, end) = (byte_of(first), byte_of(last + 1));
        if start == end || tokens(&text[start..end]) <= limit {
            out.push(Piece { first, last, start, end, cut: false });
            continue;
        }
        let mut spans: Vec<(usize, usize)> = Vec::new();
        let (mut at, mut size) = (start, 0);
        for line in first..=last {
            let (a, b) = (byte_of(line), byte_of(line + 1));
            let t = tokens(&text[a..b]);
            if t > limit {
                if at < a {
                    spans.push((at, a));
                }
                spans.extend(slices(text, a, b, limit));
                (at, size) = (b, 0);
                continue;
            }
            if size + t > limit && at < a {
                spans.push((at, a));
                (at, size) = (a, 0);
            }
            size += t;
        }
        if at < end {
            spans.push((at, end));
        }
        for (a, b) in spans {
            let (pf, pl) = (line_at(a), line_at(b.saturating_sub(1).max(a)));
            let cut = a != byte_of(pf) || (b < text.len() && b != byte_of(pl + 1));
            out.push(Piece { first: pf, last: pl, start: a, end: b, cut });
        }
    }
    out
}

/// Splits the bytes `start..end` of one line into slices of at most `limit`
/// tokens, at character boundaries. The slices are even when each fits in
/// `limit`. Otherwise, where the text is denser in one part than another, each
/// slice is as long as fits in `limit`.
fn slices(text: &str, start: usize, end: usize, limit: usize) -> Vec<(usize, usize)> {
    let count = tokens(&text[start..end]).div_ceil(limit);
    let step = (end - start).div_ceil(count).max(1);
    let mut even = Vec::new();
    let mut at = start;
    while at < end {
        let mut cut = (at + step).min(end);
        while !text.is_char_boundary(cut) {
            cut += 1;
        }
        even.push((at, cut));
        at = cut;
    }
    if even.iter().all(|&(a, b)| tokens(&text[a..b]) <= limit) {
        return even;
    }
    let mut out = Vec::new();
    let mut at = start;
    while at < end {
        // The longest slice from `at` within `limit`, at least one character.
        let (mut lo, mut hi) = (at, end);
        while lo < hi {
            let mut mid = lo + (hi - lo).div_ceil(2);
            while !text.is_char_boundary(mid) {
                mid += 1;
            }
            if mid > hi {
                break;
            }
            if tokens(&text[at..mid]) <= limit {
                lo = mid;
            } else {
                hi = mid - 1;
                while hi > lo && !text.is_char_boundary(hi) {
                    hi -= 1;
                }
            }
        }
        let mut cut = lo;
        if cut <= at {
            cut = at + 1;
            while !text.is_char_boundary(cut) {
                cut += 1;
            }
        }
        out.push((at, cut));
        at = cut;
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
    // A question's size is its quoted id, its JSON, a colon and a comma. The
    // state's size is the whole request around it with no questions yet.
    let size_of = |q: &Asked| tokens(&json!(q.id).to_string()) + tokens(&q.json.to_string()) + 2;
    let state_size = tokens(&json!({ "model": MODEL, "state": state, "questions": {} }).to_string());
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
            waiting: false,
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

/// The requests one pass makes about a directory: an outline of its parts and its questions, with no source.
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
    let room = (BUDGET as f64 * 0.9) as usize;
    // A folder with more parts than one request fits goes out in several requests. Each has a run of its parts,
    // the questions about them, and which parts the run covers. The folder's own questions go with the first.
    let listed = calls.iter().find_map(|c| {
        let parts = state.get(c.id())?.get("parts")?.as_array()?;
        Some((c.id(), parts.clone()))
    });
    let whole = Value::Object(state.clone());
    let Some((id, parts)) = listed.filter(|_| tokens(&whole.to_string()) > room) else {
        pack(first.pass(), &dir.id, whole, 1.0, &questions.iter().collect::<Vec<_>>(), &mut out);
        return out;
    };
    let mut rest = state.clone();
    rest[id]["parts"] = json!([]);
    let fits = room.saturating_sub(tokens(&Value::Object(rest.clone()).to_string())).max(1024);
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let (mut from, mut size) = (0, 0);
    for (i, entry) in parts.iter().enumerate() {
        let t = tokens(&entry.to_string()) + 1;
        if i > from && size + t > fits {
            runs.push((from, i));
            (from, size) = (i, 0);
        }
        size += t;
    }
    runs.push((from, parts.len()));
    let part_of = |about: &str| parts.iter().position(|e| e["part"].as_str() == Some(about));
    for (n, &(a, b)) in runs.iter().enumerate() {
        let mut held = rest.clone();
        held[id]["parts"] = json!(parts[a..b]);
        held[id]["partsHeld"] = json!({ "from": a + 1, "to": b, "of": parts.len() });
        let mine: Vec<&Asked> = questions
            .iter()
            .filter(|q| part_of(&q.about).map_or(n == 0, |i| a <= i && i < b))
            .collect();
        pack(first.pass(), &dir.id, Value::Object(held), 1.0, &mine, &mut out);
    }
    out
}

/// The requests one pass makes about a file: its source, an outline of its
/// definitions, and every applicable call's part and questions. A request too
/// big for Jev's window is cut at the file's top-level definitions into pieces
/// sized by source and questions together.
fn file_requests(
    ctx: &Ctx,
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
    let Some(text) = ctx.text(&file.path) else {
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
    // Blocks need no part of their own, because their questions name each block's shape, lines and definition.
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
    // The whole-file questions go only in the first piece, so only the first
    // piece makes room for them.
    let limit = ((budget as f64 * 0.9) as usize)
        .saturating_sub(fixed)
        .max(2048);
    let first = limit.saturating_sub(whole_file).max(2048);
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
        chunks(&text, &starts, &load, limit, first)
    };
    let pieces = pieces_of(&text, &ranges, limit);
    let total_lines = text.lines().count() as u32;
    let line_start: Vec<usize> = std::iter::once(0)
        .chain(text.match_indices('\n').map(|(i, _)| i + 1))
        .collect();
    let mut out = Vec::new();
    let pieces = &pieces;
    let holding = |line: u32| (0..pieces.len()).filter(move |&i| pieces[i].first <= line && line <= pieces[i].last);
    // Where each definition on a cut line starts, at its signature. Each search
    // starts after the previous definition on the line, so the line is scanned once.
    let mut signature_at: HashMap<&str, usize> = HashMap::new();
    let mut searched: HashMap<u32, usize> = HashMap::new();
    for d in ctx.defs_of.get(file.id.as_str()).into_iter().flatten() {
        let line = d.span.start;
        if holding(line).nth(1).is_none() {
            continue;
        }
        let end = line_start.get(line as usize).copied().unwrap_or(text.len());
        let from = searched.entry(line).or_insert(line_start[(line - 1) as usize]);
        let anchor: String = d.signature.trim().chars().take(60).collect();
        if let Some(i) = (!anchor.is_empty()).then(|| text[*from..end].find(&anchor)).flatten() {
            *from += i;
            signature_at.insert(d.id.as_str(), *from);
        }
    }
    // Each question about a line goes to the first piece that contains the line,
    // and a question about a definition on a cut line goes to the piece with its
    // signature, so each piece's questions are about the source it shows.
    let question_pieces: Vec<Option<usize>> = questions
        .iter()
        .map(|q| {
            let line = line_of(q)?;
            let at = signature_at.get(q.about.as_str());
            holding(line)
                .find(|&i| at.is_none_or(|&at| pieces[i].start <= at && at < pieces[i].end))
                .or_else(|| holding(line).next())
        })
        .collect();
    // The pieces with at least one question about their own source.
    let pieces_with_questions: HashSet<usize> = question_pieces.iter().flatten().copied().collect();
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
            state.insert("source".into(), json!(&*text));
        } else {
            state.insert("source".into(), json!(&text[piece.start..piece.end]));
            let mut chunk = json!({ "lines": [piece.first, piece.last], "of": total_lines });
            // A piece of a cut line states which characters of the line it
            // contains, from the start of its first line to the end of its last,
            // not counting the line break.
            if piece.cut {
                let first_at = line_start.get((piece.first - 1) as usize).copied().unwrap_or(0);
                let last_at = line_start.get((piece.last - 1) as usize).copied().unwrap_or(0);
                let last = &text[last_at..piece.end];
                let last = last.strip_suffix('\n').map_or(last, |l| l.strip_suffix('\r').unwrap_or(l));
                chunk["characters"] = json!([
                    text[first_at..piece.start].chars().count(),
                    last.chars().count()
                ]);
            }
            state.insert("chunk".into(), chunk);
        }
        let weight = state["source"].as_str().map_or(0, str::len) as f64;
        // A question about a line goes in the piece that contains it. A question
        // about the whole file goes in the first piece, which has the file's
        // whole outline. It also goes in any piece with no other question, such
        // as the middle of a long definition or of a generated file's one line,
        // so Jev reads every character and `hold::combine` weights the answers
        // by each piece's bytes.
        let mine: Vec<&Asked> = questions
            .iter()
            .zip(&question_pieces)
            .filter(|(q, assigned)| match (line_of(q), assigned) {
                (Some(_), Some(h)) => *h == index,
                (Some(_), None) => true,
                (None, _) => index == 0 || !pieces_with_questions.contains(&index),
            })
            .map(|(q, _)| q)
            .collect();
        // A piece includes only the parts of the calls whose questions it has.
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

/// Every request a project needs now, given the answers so far: the graph
/// with Jev's links, every planned request, with those whose dependencies are
/// unanswered marked `waiting`, and the request hashes the store has answers
/// for.
struct Wanted {
    project: String,
    graph: CodeGraph,
    planned: Vec<Planned>,
    answered: HashSet<String>,
}

fn wanted(root: &Path) -> Result<Wanted, String> {
    let project = crate::graph::project_id(root);
    let held = store::read(&project, "held")?;
    let graph = crate::graph::build_linked(root, &links(&held))?;
    let answered: HashSet<String> = store::read(&project, "calls")?
        .as_object()
        .into_iter()
        .flatten()
        .map(|(k, _)| k.clone())
        .collect();
    let planned = {
        let ctx = Ctx::new(&graph, root, &held);
        let link: Vec<&dyn Call> = calls::registry()
            .into_iter()
            .filter(|c| c.pass() == LINK)
            .collect();
        let files: Vec<&FileNode> = graph
            .nodes
            .iter()
            .filter_map(|n| if let Node::File(f) = n { Some(f) } else { None })
            .collect();
        let mut planned: Vec<Planned> = files
            .iter()
            .flat_map(|f| file_requests(&ctx, &graph.name, f, &link))
            .collect();
        let links_done = planned.iter().all(|p| answered.contains(&p.hash));
        planned.extend(understanding(
            &ctx, &graph, &files, links_done, &answered,
        ));
        planned
    };
    Ok(Wanted {
        project,
        graph,
        planned,
        answered,
    })
}

/// The understanding pass's requests. Folders go top-down, each once its
/// parent's request is answered, and each file once its folder's is, so every
/// request includes the answers above it. Before then, the runner builds a
/// request from the answers so far and marks it `waiting`, so `plan` can count
/// it.
fn understanding(
    ctx: &Ctx,
    graph: &CodeGraph,
    files: &[&FileNode],
    links_done: bool,
    answered: &HashSet<String>,
) -> Vec<Planned> {
    let calls = calls::registry();
    let of = |pass: &str| -> Vec<&dyn Call> {
        calls.iter().copied().filter(|c| c.pass() == pass).collect()
    };
    let done = |reqs: &[Planned]| reqs.iter().all(|p| answered.contains(&p.hash));
    let mut dirs: Vec<&DirNode> = graph
        .nodes
        .iter()
        .filter_map(|n| if let Node::Dir(d) = n { Some(d) } else { None })
        .collect();
    dirs.sort_by_key(|d| {
        if d.path.is_empty() {
            0
        } else {
            d.path.matches('/').count() + 1
        }
    });
    let parent = |path: &str| path.rsplit_once('/').map_or("", |(d, _)| d).to_string();
    let mut out = Vec::new();
    let mut dir_done: HashSet<String> = HashSet::new();
    for d in dirs {
        let mut reqs = dir_requests(ctx, &graph.name, d, &of("folders"));
        let ready = links_done && (d.path.is_empty() || dir_done.contains(&parent(&d.path)));
        if !ready {
            reqs.iter_mut().for_each(|p| p.waiting = true);
        } else if done(&reqs) {
            dir_done.insert(d.path.clone());
        }
        out.extend(reqs);
    }
    for f in files {
        let mut reqs = file_requests(ctx, &graph.name, f, &of("files"));
        if !(links_done && dir_done.contains(&parent(&f.path))) {
            reqs.iter_mut().for_each(|p| p.waiting = true);
        }
        out.extend(reqs);
    }
    out
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

/// Reports which requests the project needs now and which are already
/// answered. Sends nothing.
pub fn plan(root: &Path) -> Result<Value, String> {
    Ok(summary(&wanted(root)?))
}

/// Sends up to `max` ready requests, and holds the answers of every file or
/// directory whose requests in a pass are now all answered.
pub fn next(root: &Path, max: Option<usize>) -> Result<Value, String> {
    let concurrency = concurrency_of(root)?;
    let w = wanted(root)?;
    let ready: Vec<usize> = (0..w.planned.len())
        .filter(|&i| !w.planned[i].waiting && !w.answered.contains(&w.planned[i].hash))
        .take(max.unwrap_or(DEFAULT_SLICE))
        .collect();
    let unsettled = unsettled(
        &w,
        &store::read(&w.project, "held")?,
        &store::read(&w.project, "calls")?,
    );
    if ready.is_empty() && unsettled.is_empty() {
        return Ok(json!({ "sent": 0, "failed": 0, "failures": [], "left": 0, "settled": [], "quality": {} }));
    }
    // A newly held link changes the graph every other request is built from, so
    // this slice only holds answers. The next slice builds on the new graph.
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
    concurrencies()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(root.to_path_buf(), concurrency);

    let mut writes: Vec<Value> = Vec::new();
    let mut fresh: HashMap<String, Value> = HashMap::new();
    let (mut failed, mut estimated, mut billed) = (0usize, 0usize, 0u64);
    // Which requests failed after the client's retries, and why. A caller fails the world with them.
    let mut failures: Vec<Value> = Vec::new();
    let mut touched: BTreeSet<(&str, &str)> = BTreeSet::new();
    for (&i, answer) in ready.iter().zip(&answers) {
        let p = &w.planned[i];
        if let Some(e) = answer.get("error") {
            let error: String = e.as_str().unwrap_or("").chars().take(300).collect();
            if failed < 3 {
                eprintln!("gaia-engine: a request about {} failed: {}", p.unit, error);
                failures.push(json!({ "unit": p.unit, "error": error }));
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
    let by_ref = candidates_by_ref(&w.graph);
    let answered = |h: &str| w.answered.contains(h) || fresh.contains_key(h);
    let mut settled: BTreeSet<String> = BTreeSet::new();
    touched.extend(unsettled);
    for (unit, pass) in touched {
        let mine: Vec<&Planned> = w
            .planned
            .iter()
            .filter(|p| p.unit == unit && p.pass == pass && !p.waiting)
            .collect();
        if !mine.iter().all(|p| answered(&p.hash)) {
            continue;
        }
        let mut gathered: BTreeMap<(String, String, String), Vec<(f64, Value)>> = BTreeMap::new();
        // The candidates each link question chose among, sorted, held with its answer.
        let mut offered: HashMap<String, Vec<&str>> = HashMap::new();
        for p in &mine {
            let answers = fresh
                .get(&p.hash)
                .cloned()
                .or_else(|| stored.get(&p.hash).map(|k| k["answers"].clone()))
                .unwrap_or(Value::Null);
            for q in &p.questions {
                if q.field == "link" {
                    offered.insert(q.about.clone(), held_candidates(&by_ref, q));
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
                link_key(&node, offered.get(&node).map_or(&[][..], Vec::as_slice))
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
            // A held link answer chosen among other candidates, or by an earlier
            // version of its call, is never kept, because the graph reads only
            // current ones.
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
    // `left` counts only requests already planned. Answers can add more, such
    // as a request with the readings Jev asked for, and so can newly held
    // answers.
    let left = w.planned.iter().filter(|p| !answered(&p.hash)).count()
        + usize::from(sent > 0 || held_anew);
    // Each file this slice finished has its quality now, so a caller can show it as the file's health at once rather
    // than after the whole pass. A file is finished once no more requests will be sent about it. Its answers can ask
    // for readings, which a further request then sends, so its requests are planned again from what is held now and
    // each must be answered.
    let mut quality = serde_json::Map::new();
    if settled.iter().any(|s| s.starts_with("file:")) {
        let held = store::read(&w.project, "held")?;
        let final_files: HashSet<String> = {
            let ctx = Ctx::new(&w.graph, root, &held);
            let files: Vec<&dyn Call> = calls::registry().into_iter().filter(|c| c.pass() == "files").collect();
            w.graph
                .nodes
                .iter()
                .filter_map(|n| if let Node::File(f) = n { Some(f) } else { None })
                .filter(|f| settled.contains(&f.id))
                .filter(|f| file_requests(&ctx, &w.graph.name, f, &files).iter().all(|p| answered(&p.hash)))
                .map(|f| f.id.clone())
                .collect()
        };
        let mut graph = w.graph;
        judge(&mut graph, &held);
        for n in &graph.nodes {
            if let Node::File(f) = n
                && final_files.contains(&f.id)
                && let Some(q) = f.judged.as_ref().and_then(|j| j["value"]["quality"].as_f64())
            {
                quality.insert(f.path.clone(), json!(q));
            }
        }
    }
    Ok(json!({ "sent": sent, "failed": failed, "failures": failures, "left": left, "settled": settled, "quality": quality }))
}

/// Units whose requests are all answered but whose answers aren't held in
/// their current form: a link answer held under other candidates or an older
/// call, or a node's answer never held. They settle without sending anything.
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
    let by_ref = candidates_by_ref(&w.graph);
    let mut out = BTreeSet::new();
    for p in w
        .planned
        .iter()
        .filter(|p| !p.waiting && w.answered.contains(&p.hash))
    {
        let stale = p.questions.iter().any(|q| {
            if q.field == "link" {
                let offered = held_candidates(&by_ref, q);
                let h = &held[link_key(&q.about, &offered)];
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
    // A unit with a request still unanswered, such as a file whose link
    // requests a slice split in two, settles once its last one is answered.
    // Until then it must not block the rest from being sent.
    out.retain(|&(unit, pass)| {
        w.planned
            .iter()
            .filter(|p| p.unit == unit && p.pass == pass && !p.waiting)
            .all(|p| w.answered.contains(&p.hash))
    });
    out
}

/// The project's graph with Jev's links as edges and every node's held answers as its `judged`.
pub fn judged_graph(root: &Path) -> Result<CodeGraph, String> {
    let project = crate::graph::project_id(root);
    let held = store::read(&project, "held")?;
    let mut graph = crate::graph::build_linked(root, &links(&held))?;
    judge(&mut graph, &held);
    Ok(graph)
}

/// Fills every node's `judged` from the held answers of the registry's
/// calls, then computes its value (`axes::values`). It leaves out held answers
/// from calls no longer in the registry.
fn judge(graph: &mut CodeGraph, held: &Value) {
    let current: HashSet<&str> = calls::registry()
        .into_iter()
        .filter(|c| c.pass() != LINK)
        .map(|c| c.id())
        .collect();
    let mut by_lineage: HashMap<&str, Vec<(&str, &Value)>> = HashMap::new();
    for (key, value) in held.as_object().into_iter().flatten() {
        let mut parts = key.splitn(3, '|');
        if let (Some(l), Some(call), Some(field)) = (parts.next(), parts.next(), parts.next())
            && l != LINK
            && current.contains(call)
        {
            by_lineage.entry(l).or_default().push((field, value));
        }
    }
    for n in &mut graph.nodes {
        let (lineage, judged) = match n {
            Node::Dir(d) => (d.lineage.as_str(), &mut d.judged),
            Node::File(f) => (f.lineage.as_str(), &mut f.judged),
            Node::Def(d) => (d.lineage.as_str(), &mut d.judged),
            Node::Block(b) => (b.lineage.as_str(), &mut b.judged),
        };
        let Some(entries) = by_lineage.get(lineage) else {
            continue;
        };
        let mut j = Map::new();
        for (field, value) in entries {
            let a = &value["answer"];
            let call = value["call"].clone();
            let filled = if let Some(choice) = a["choice"].as_str() {
                json!({ "choice": choice, "p": a["p"], "call": call })
            } else if let Some(score) = a["score"].as_f64() {
                // A score's value is its share of the scale.
                let top = (a["levels"].as_f64().unwrap_or(2.0) - 1.0).max(1.0);
                json!({ "score": score, "value": (score / top).clamp(0.0, 1.0), "call": call })
            } else {
                continue;
            };
            // "axes.readability" goes under axes, "picks.key" under picks, and so on.
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
    super::axes::values(graph);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A repository of `files` in a fresh temporary folder.
    fn repository(name: &str, files: &[(String, String)]) -> PathBuf {
        let root = std::env::temp_dir().join(format!("gaia-runner-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for (path, text) in files {
            let at = root.join(path);
            std::fs::create_dir_all(at.parent().unwrap()).unwrap();
            std::fs::write(at, text).unwrap();
        }
        root
    }

    fn calls_of(pass: &str) -> Vec<&'static dyn Call> {
        calls::registry().into_iter().filter(|c| c.pass() == pass).collect()
    }

    /// Every request a pass plans for the file at `path`.
    fn file_plan(graph: &CodeGraph, root: &Path, path: &str, pass: &str) -> Vec<Planned> {
        let held = json!({});
        let ctx = Ctx::new(graph, root, &held);
        let file = graph
            .nodes
            .iter()
            .find_map(|n| if let Node::File(f) = n && f.path == path { Some(f) } else { None })
            .unwrap();
        file_requests(&ctx, &graph.name, file, &calls_of(pass))
    }

    /// The pieces of source a file's requests included, in order, with each one's `chunk`.
    fn pieces_sent(planned: &[Planned]) -> Vec<(Value, String)> {
        let mut out: Vec<(Value, String)> = Vec::new();
        for p in planned {
            let chunk = p.request["state"]["chunk"].clone();
            if out.last().is_none_or(|(c, _)| *c != chunk) {
                out.push((chunk, p.request["state"]["source"].as_str().unwrap().to_string()));
            }
        }
        out
    }

    #[test]
    fn however_large_a_line_definition_folder_or_candidate_list_every_request_fits_and_asks_each_thing_once() {
        // A minified bundle: one line of 200,000 characters, with a character of two bytes in every function.
        let mut line = String::new();
        let mut i = 0;
        while line.chars().count() < 199_000 {
            line += &format!("function f{i}(x){{return \"é\"+x{}}}", "+1".repeat(400));
            i += 1;
        }
        line += &"/".repeat(200_000 - line.chars().count());
        let body: String = (0..3000).map(|i| format!("  x = x + {i} * 2 + 1;\n")).collect();
        let mut files: Vec<(String, String)> = vec![
            ("bundle.js".into(), format!("{line}\n")),
            ("long.ts".into(), format!("export function long(x: number): number {{\n{body}  return x;\n}}\n")),
            ("wide/caller.ts".into(), "export function go() {\n  return run();\n}\n".into()),
        ];
        // Every other file beside the caller defines `run`, so its call has thousands of candidates.
        files.extend((0..3000).map(|i| (format!("wide/f{i}.ts"), format!("export function run() {{\n  return {i};\n}}\n"))));
        let root = repository("budget", &files);
        let graph = crate::graph::build(&root).unwrap();
        let call = graph.pending.iter().find(|r| r.from.starts_with("def:wide/caller.ts")).expect("the call to run goes to Jev");
        assert_eq!(call.candidates.len(), 3000);
        let held = json!({});
        let ctx = Ctx::new(&graph, &root, &held);
        let fits = |planned: &[Planned], what: &str| {
            for p in planned {
                let size = tokens(&p.request.to_string());
                assert!(size <= BUDGET, "{what}: a request of {size} tokens");
            }
        };
        // Nothing inside a file or folder gets the same question twice, however its requests are cut. A file cut into
        // pieces is asked about itself in each, and those answers combine into one judgment.
        let asked_once = |planned: &[Planned], what: &str| -> HashSet<String> {
            let mut asked = HashSet::new();
            for q in planned.iter().flat_map(|p| p.questions.iter().filter(|q| q.about != p.unit)) {
                assert!(asked.insert((q.about.clone(), q.field.clone())), "{what}: {} is asked {} twice", q.about, q.field);
            }
            asked.into_iter().map(|(about, _)| about).collect()
        };
        let mut linked_in_files = HashSet::new();
        for (what, path) in [
            ("a line of 200,000 characters", "bundle.js"),
            ("a definition of 3,000 lines", "long.ts"),
            ("a call with 3,000 candidates", "wide/caller.ts"),
        ] {
            let source = files.iter().find(|(p, _)| p == path).map(|(_, t)| t.as_str()).unwrap();
            let read = file_plan(&graph, &root, path, "files");
            let linked = file_plan(&graph, &root, path, LINK);
            fits(&read, what);
            fits(&linked, what);
            assert_eq!(pieces_sent(&read).iter().map(|(_, s)| s.as_str()).collect::<String>(), source, "{what}: the pieces carry the whole file");
            let defs: HashSet<String> = graph.nodes.iter().filter_map(|n| match n {
                Node::Def(d) if d.file == format!("file:{path}") => Some(d.id.clone()),
                _ => None,
            }).collect();
            let about = asked_once(&read, what);
            assert!(defs.iter().all(|d| about.contains(d)), "{what}: every definition is asked about");
            linked_in_files.extend(asked_once(&linked, what));
        }
        assert!(linked_in_files.contains(&crate::graph::ref_key(call)), "the call is asked about");
        let dir = |path: &str| {
            graph.nodes.iter().find_map(|n| if let Node::Dir(d) = n && d.path == path { Some(d) } else { None }).unwrap()
        };
        let wide = dir_requests(&ctx, &graph.name, dir("wide"), &calls_of("folders"));
        let above = dir_requests(&ctx, &graph.name, dir(""), &calls_of("folders"));
        fits(&wide, "a folder of 3,001 files");
        fits(&above, "the folder that holds it");
        asked_once(&above, "the folder that holds it");
        let parts = asked_once(&wide, "a folder of 3,001 files");
        let in_wide = files.iter().filter(|(p, _)| p.starts_with("wide/")).count();
        assert_eq!(parts.iter().filter(|p| p.starts_with("file:wide/")).count(), in_wide, "every file of the folder is asked about");
        let _ = std::fs::remove_dir_all(&root);
    }
}
