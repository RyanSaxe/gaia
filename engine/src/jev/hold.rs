//! Decides when a fresh answer from Jev replaces the held answer to a question.
//! Jev's answers vary a little between requests, and a renamed file's request
//! is new because its path changed, so a fresh answer replaces the held one
//! only when it clearly differs:
//! - a choice, when the fresh top probability exceeds the held option's fresh
//!   probability by at least `CHOICE`, 0.2
//! - a score, when it moves at least `SCORE`, half a level
//!
//! `replaces` compares each fresh answer with the held one, never with the
//! previous fresh one, so small changes add up until they pass the margin.

use serde_json::{Map, Value, json};

const CHOICE: f64 = 0.2;
const SCORE: f64 = 0.5;

/// Converts Jev's answer to one question to `{ choice, p }` or
/// `{ score, levels }`, the two answer types the calls use. Returns None for
/// any other type.
pub fn normalize(question: &Value, answer: &Value) -> Option<Value> {
    match answer["type"].as_str()? {
        "choice" => Some(
            json!({ "choice": answer["choice"].as_str()?, "p": answer["probabilities"].clone() }),
        ),
        "score" => Some(json!({
            "score": answer["score"].as_f64()?,
            "levels": question["criteria"].as_array().map_or(0, Vec::len),
        })),
        _ => None,
    }
}

/// Combines the answers to one question from several requests, such as a long
/// file's chunks. Each answer's weight is how much of the file its request
/// read. Choices average their probabilities and take the most probable
/// option, and scores average.
pub fn combine(answers: &[(f64, Value)]) -> Option<Value> {
    let total: f64 = answers.iter().map(|(w, _)| w).sum();
    let (_, first) = answers.first()?;
    if answers.len() == 1 || total <= 0.0 {
        return Some(first.clone());
    }
    if first.get("choice").is_some() {
        let mut p: Map<String, Value> = Map::new();
        for (w, a) in answers {
            for (k, v) in a["p"].as_object().into_iter().flatten() {
                let sum = p.get(k).and_then(Value::as_f64).unwrap_or(0.0)
                    + v.as_f64().unwrap_or(0.0) * w / total;
                p.insert(k.clone(), json!(sum));
            }
        }
        let choice = p
            .iter()
            .max_by(|a, b| {
                a.1.as_f64()
                    .unwrap_or(0.0)
                    .total_cmp(&b.1.as_f64().unwrap_or(0.0))
            })
            .map(|(k, _)| k.clone())?;
        return Some(json!({ "choice": choice, "p": p }));
    }
    let score: f64 = answers
        .iter()
        .map(|(w, a)| a["score"].as_f64().unwrap_or(0.0) * w / total)
        .sum();
    Some(json!({ "score": score, "levels": first["levels"] }))
}

/// True when a fresh answer should replace the held one.
pub fn replaces(held: &Value, fresh: &Value) -> bool {
    if let (Some(held_choice), Some(p)) = (held["choice"].as_str(), fresh["p"].as_object()) {
        let top = p.values().filter_map(Value::as_f64).fold(0.0, f64::max);
        let held_now = p.get(held_choice).and_then(Value::as_f64).unwrap_or(0.0);
        return fresh["choice"].as_str() != Some(held_choice) && top - held_now >= CHOICE;
    }
    if let (Some(a), Some(b)) = (held["score"].as_f64(), fresh["score"].as_f64()) {
        return (a - b).abs() >= SCORE;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_answer_replaces_the_held_one_only_when_it_clearly_differs() {
        // A wobble flips the top choice by a hair or moves a score a little. A clear change is most of the scale.
        let held = json!({ "choice": "utility", "p": { "utility": 0.52, "core logic": 0.48 } });
        let wobble = json!({ "choice": "core logic", "p": { "utility": 0.49, "core logic": 0.51 } });
        let clear = json!({ "choice": "core logic", "p": { "utility": 0.05, "core logic": 0.95 } });
        assert!(!replaces(&held, &wobble));
        assert!(replaces(&held, &clear));
        assert!(!replaces(&json!({ "score": 2.0 }), &json!({ "score": 2.05 })));
        assert!(replaces(&json!({ "score": 1.0 }), &json!({ "score": 3.5 })));
    }
}
