//! Answers that hold. Jev's answers move a little when asked again, and a
//! renamed file's request is new because its path changed, so a fresh
//! answer replaces the one held only when it clearly differs:
//! - a choice, when the fresh top option beats the held option's fresh
//!   probability by 0.2;
//! - a score, when it moves at least half a level;
//! - a yes-or-no, when it crosses 0.5 by at least 0.15.
//!
//! Each fresh answer is compared with the held one, never with the previous
//! fresh one, so small changes add up and show once they pass the margin.

use serde_json::{Map, Value, json};

const CHOICE: f64 = 0.2;
const SCORE: f64 = 0.5;
const YES_NO: f64 = 0.15;

/// Jev's answer to one question, in one shape: `{ choice, p }`,
/// `{ score, levels }` or `{ yes }`.
pub fn normalize(question: &Value, answer: &Value) -> Option<Value> {
    match answer["type"].as_str()? {
        "choice" => Some(
            json!({ "choice": answer["choice"].as_str()?, "p": answer["probabilities"].clone() }),
        ),
        "score" => Some(json!({
            "score": answer["score"].as_f64()?,
            "levels": question["criteria"].as_array().map_or(0, Vec::len),
        })),
        "noul" => Some(json!({ "yes": answer["noul"].as_f64()? })),
        _ => None,
    }
}

/// Answers to one question from several requests, such as a long file's
/// chunks, as one, each weighted by how much of the file its request read.
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
    if first.get("score").is_some() {
        let score: f64 = answers
            .iter()
            .map(|(w, a)| a["score"].as_f64().unwrap_or(0.0) * w / total)
            .sum();
        return Some(json!({ "score": score, "levels": first["levels"] }));
    }
    let yes: f64 = answers
        .iter()
        .map(|(w, a)| a["yes"].as_f64().unwrap_or(0.0) * w / total)
        .sum();
    Some(json!({ "yes": yes }))
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
    if let (Some(a), Some(b)) = (held["yes"].as_f64(), fresh["yes"].as_f64()) {
        return (a - 0.5).signum() != (b - 0.5).signum() && (b - 0.5).abs() >= YES_NO;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_answer_replaces_the_held_one_only_when_it_clearly_differs() {
        let held = json!({ "choice": "utility", "p": { "utility": 0.6, "core logic": 0.4 } });
        let close = json!({ "choice": "core logic", "p": { "utility": 0.45, "core logic": 0.55 } });
        let clear = json!({ "choice": "core logic", "p": { "utility": 0.2, "core logic": 0.8 } });
        assert!(!replaces(&held, &close));
        assert!(replaces(&held, &clear));
        assert!(!replaces(
            &json!({ "score": 2.1 }),
            &json!({ "score": 2.4 })
        ));
        assert!(replaces(&json!({ "score": 2.1 }), &json!({ "score": 2.6 })));
        assert!(!replaces(&json!({ "yes": 0.6 }), &json!({ "yes": 0.45 })));
        assert!(replaces(&json!({ "yes": 0.6 }), &json!({ "yes": 0.3 })));
        assert!(
            !replaces(&json!({ "yes": 0.6 }), &json!({ "yes": 0.95 })),
            "a yes-or-no that stays on its side holds"
        );
    }

    #[test]
    fn a_long_file_s_chunks_combine_by_how_much_each_read() {
        let a = json!({ "choice": "utility", "p": { "utility": 0.9, "core logic": 0.1 } });
        let b = json!({ "choice": "core logic", "p": { "utility": 0.3, "core logic": 0.7 } });
        let combined = combine(&[(3.0, a), (1.0, b)]).unwrap();
        assert_eq!(combined["choice"], "utility");
        assert!((combined["p"]["utility"].as_f64().unwrap() - 0.75).abs() < 1e-9);
        let s = combine(&[
            (1.0, json!({ "score": 1.0, "levels": 5 })),
            (1.0, json!({ "score": 3.0, "levels": 5 })),
        ])
        .unwrap();
        assert_eq!(s["score"], 2.0);
    }
}
