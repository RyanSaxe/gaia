//! The engine protocol: newline-delimited JSON-RPC 2.0. The TypeScript side of
//! the same contract is `EngineMethods` in `packages/schema/src/engine.ts`.

use serde::Deserialize;
use serde_json::{Value, json};
use std::path::Path;

#[derive(Deserialize)]
struct Request {
    #[serde(default)]
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

const PARSE_ERROR: i64 = -32700;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;
/// The method ran and failed, such as a root that is not a directory or Jev being off.
const FAILED: i64 = -32000;

/// Turns one request line into one response line.
pub fn handle(line: &str) -> Value {
    let request: Request = match serde_json::from_str(line) {
        Ok(request) => request,
        Err(error) => {
            return failure(
                Value::Null,
                PARSE_ERROR,
                &format!("Not a JSON-RPC request: {error}"),
            );
        }
    };
    let id = request.id;
    let p = &request.params;
    let outcome: Result<Value, (i64, String)> = match request.method.as_str() {
        "engine.ping" => Ok(json!({ "version": crate::VERSION })),
        "project.open" => match p["root"].as_str() {
            Some(root) => crate::project::open(Path::new(root))
                .map_err(|e| (FAILED, e))
                .and_then(|opened| {
                    serde_json::to_value(opened).map_err(|e| (FAILED, e.to_string()))
                }),
            None => Err((INVALID_PARAMS, "project.open needs a root.".into())),
        },
        "jev.ask" => match p.get("request") {
            Some(r) => crate::jev::batch(vec![r.clone()])
                .map_err(|e| (FAILED, e))
                .and_then(|mut answers| match answers.pop() {
                    Some(answer) if answer.get("error").is_none() => Ok(answer),
                    Some(answer) => Err((
                        FAILED,
                        answer["error"]
                            .as_str()
                            .unwrap_or("Jev failed.")
                            .to_string(),
                    )),
                    None => Err((FAILED, "Jev answered nothing.".into())),
                }),
            None => Err((INVALID_PARAMS, "jev.ask needs a request.".into())),
        },
        "jev.status" => Ok(json!({ "key": crate::jev::has_key(), "live": crate::jev::live() })),
        "jev.estimate" => match p["requests"].as_array() {
            Some(requests) => Ok(crate::jev::dry_run(requests)),
            None => Err((INVALID_PARAMS, "jev.estimate needs requests.".into())),
        },
        "jev.batch" => match p["requests"].as_array() {
            Some(requests) => crate::jev::batch(requests.clone())
                .map(|responses| json!({ "responses": responses }))
                .map_err(|e| (FAILED, e)),
            None => Err((INVALID_PARAMS, "jev.batch needs requests.".into())),
        },
        "store.get" => match (
            p["project"].as_str(),
            p["table"].as_str(),
            p["key"].as_str(),
        ) {
            (Some(project), Some(table), Some(key)) => crate::store::get(project, table, key)
                .map(|v| v.map_or(Value::Null, |value| json!({ "value": value })))
                .map_err(|e| (FAILED, e)),
            _ => Err((
                INVALID_PARAMS,
                "store.get needs a project, a table and a key.".into(),
            )),
        },
        "store.read" => match (p["project"].as_str(), p["table"].as_str()) {
            (Some(project), Some(table)) => crate::store::read(project, table)
                .map(|records| json!({ "records": records }))
                .map_err(|e| (FAILED, e)),
            _ => Err((
                INVALID_PARAMS,
                "store.read needs a project and a table.".into(),
            )),
        },
        "store.put" => match (p["project"].as_str(), p["writes"].as_array()) {
            (Some(project), Some(writes)) => crate::store::put(project, writes)
                .map(|()| json!({ "ok": true }))
                .map_err(|e| (FAILED, e)),
            _ => Err((
                INVALID_PARAMS,
                "store.put needs a project and writes.".into(),
            )),
        },
        other => Err((METHOD_NOT_FOUND, format!("Unknown method {other}"))),
    };
    match outcome {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => failure(id, code, &message),
    }
}

fn failure(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_answers_with_the_version() {
        let response = handle(r#"{"jsonrpc":"2.0","id":1,"method":"engine.ping","params":{}}"#);
        assert_eq!(response["id"], 1);
        assert_eq!(response["result"]["version"], crate::VERSION);
    }

    #[test]
    fn unknown_methods_and_bad_json_get_errors() {
        assert_eq!(
            handle(r#"{"jsonrpc":"2.0","id":"a","method":"nope"}"#)["error"]["code"],
            METHOD_NOT_FOUND
        );
        assert_eq!(handle("not json")["error"]["code"], PARSE_ERROR);
    }

    #[test]
    fn project_open_needs_a_real_directory() {
        assert_eq!(
            handle(r#"{"jsonrpc":"2.0","id":3,"method":"project.open","params":{}}"#)["error"]["code"],
            INVALID_PARAMS
        );
        assert_eq!(
            handle(
                r#"{"jsonrpc":"2.0","id":4,"method":"project.open","params":{"root":"/no/such/dir"}}"#
            )["error"]["code"],
            FAILED
        );
    }
}
