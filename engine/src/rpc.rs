//! Handles the engine protocol, newline-delimited JSON-RPC 2.0.
//! `EngineMethods` in `packages/schema/src/engine.ts` defines the same contract
//! in TypeScript. When a GitHub address leads to no repository Gaia can clone,
//! such as no public repository, GitHub unreachable or a repository past a cap,
//! `project.locate` and `project.clone` return an ordinary result that names
//! the reason, not an error.

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
/// Error code for a method that ran and failed, such as on a root that is not a directory or with Jev off.
const FAILED: i64 = -32000;

/// Turns one request line into one response line.
pub fn handle(line: &str) -> Value {
    let request: Request = match serde_json::from_str(line) {
        Ok(request) => request,
        Err(error) => {
            return failure(
                &Value::Null,
                PARSE_ERROR,
                &format!("Not a JSON-RPC request: {error}"),
            );
        }
    };
    let id = request.id;
    let outcome = dispatch(request.method.as_str(), &request.params);
    match outcome {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => failure(&id, code, &message),
    }
}

fn dispatch(method: &str, p: &Value) -> Result<Value, (i64, String)> {
    match method {
        "engine.ping" => Ok(json!({ "version": crate::VERSION })),
        "project.graph" | "project.source" | "project.commit" | "project.commits"
        | "project.locate" | "project.clone" => dispatch_project(method, p),
        "understanding.plan" | "understanding.next" => dispatch_understanding(method, p),
        "jev.status" | "jev.estimate" | "jev.batch" => dispatch_jev(method, p),
        "store.get" | "store.read" | "store.put" => dispatch_store(method, p),
        other => Err((METHOD_NOT_FOUND, format!("Unknown method {other}"))),
    }
}

fn dispatch_project(method: &str, p: &Value) -> Result<Value, (i64, String)> {
    match method {
        "project.graph" => {
            let root = req_str(p, "root", "project.graph needs a root.")?;
            let graph = if p["judged"].as_bool() == Some(true) {
                crate::jev::runner::judged_graph(Path::new(root))
            } else {
                crate::graph::build(Path::new(root))
            }
            .map_err(|e| (FAILED, e))?;
            serde_json::to_value(graph).map_err(|e| (FAILED, e.to_string()))
        }
        "project.source" => {
            let (Some(root), Some(path)) = (p["root"].as_str(), p["path"].as_str()) else {
                return Err((
                    INVALID_PARAMS,
                    "project.source needs a root and a path.".into(),
                ));
            };
            // With `commit`, the commit the world was built from, it reads the file at that commit, so the journal shows the code the graph read.
            let root = Path::new(root);
            let snapshot = match p["commit"].as_str() {
                Some(commit) => crate::graph::walk::Snapshot::at(root, commit),
                None => Some(crate::graph::walk::Snapshot::of(root)),
            };
            let lines = snapshot.and_then(|s| s.text(path)).map(|text| {
                text.split('\n')
                    .map(|l| l.strip_suffix('\r').unwrap_or(l).to_string())
                    .collect::<Vec<_>>()
            });
            Ok(json!({ "lines": lines }))
        }
        "project.commit" => {
            // The commit that `project.graph` would read the root at now.
            let root = req_str(p, "root", "project.commit needs a root.")?;
            Ok(json!({ "commit": crate::graph::walk::Snapshot::of(Path::new(root)).commit() }))
        }
        "project.commits" => {
            // How many commits after `from` up to `to` changed a file under the root, or null when `from` is not in `to`'s history.
            let (Some(root), Some(from), Some(to)) =
                (p["root"].as_str(), p["from"].as_str(), p["to"].as_str())
            else {
                return Err((
                    INVALID_PARAMS,
                    "project.commits needs a root, a from and a to.".into(),
                ));
            };
            Ok(json!({ "commits": crate::graph::git::commits_between(Path::new(root), from, to) }))
        }
        "project.locate" => {
            let address = req_str(p, "address", "project.locate needs an address.")?;
            crate::clone::locate(address).map_err(|e| (FAILED, e))
        }
        "project.clone" => {
            let address = req_str(p, "address", "project.clone needs an address.")?;
            crate::clone::clone(address).map_err(|e| (FAILED, e))
        }
        other => Err((METHOD_NOT_FOUND, format!("Unknown method {other}"))),
    }
}

fn dispatch_understanding(method: &str, p: &Value) -> Result<Value, (i64, String)> {
    match method {
        "understanding.plan" => {
            let root = req_str(p, "root", "understanding.plan needs a root.")?;
            crate::jev::runner::plan(Path::new(root)).map_err(|e| (FAILED, e))
        }
        "understanding.next" => {
            let root = req_str(p, "root", "understanding.next needs a root.")?;
            let max = p["max"]
                .as_u64()
                .map(|m| usize::try_from(m).unwrap_or(usize::MAX));
            crate::jev::runner::next(Path::new(root), max).map_err(|e| (FAILED, e))
        }
        other => Err((METHOD_NOT_FOUND, format!("Unknown method {other}"))),
    }
}

fn dispatch_jev(method: &str, p: &Value) -> Result<Value, (i64, String)> {
    match method {
        "jev.status" => Ok(json!({ "key": crate::jev::has_key(), "live": crate::jev::live() })),
        "jev.estimate" => {
            let requests = p["requests"]
                .as_array()
                .ok_or_else(|| (INVALID_PARAMS, "jev.estimate needs requests.".into()))?;
            Ok(crate::jev::dry_run(requests))
        }
        "jev.batch" => {
            let requests = p["requests"]
                .as_array()
                .ok_or_else(|| (INVALID_PARAMS, "jev.batch needs requests.".into()))?;
            crate::jev::batch(requests.clone())
                .map(|responses| json!({ "responses": responses }))
                .map_err(|e| (FAILED, e))
        }
        other => Err((METHOD_NOT_FOUND, format!("Unknown method {other}"))),
    }
}

fn dispatch_store(method: &str, p: &Value) -> Result<Value, (i64, String)> {
    match method {
        "store.get" => {
            let (Some(project), Some(table), Some(key)) = (
                p["project"].as_str(),
                p["table"].as_str(),
                p["key"].as_str(),
            ) else {
                return Err((
                    INVALID_PARAMS,
                    "store.get needs a project, a table and a key.".into(),
                ));
            };
            crate::store::get(project, table, key)
                .map(|v| v.map_or(Value::Null, |value| json!({ "value": value })))
                .map_err(|e| (FAILED, e))
        }
        "store.read" => {
            let (Some(project), Some(table)) = (p["project"].as_str(), p["table"].as_str()) else {
                return Err((
                    INVALID_PARAMS,
                    "store.read needs a project and a table.".into(),
                ));
            };
            crate::store::read(project, table)
                .map(|records| json!({ "records": records }))
                .map_err(|e| (FAILED, e))
        }
        "store.put" => {
            let (Some(project), Some(writes)) = (p["project"].as_str(), p["writes"].as_array())
            else {
                return Err((
                    INVALID_PARAMS,
                    "store.put needs a project and writes.".into(),
                ));
            };
            crate::store::put(project, writes)
                .map(|()| json!({ "ok": true }))
                .map_err(|e| (FAILED, e))
        }
        other => Err((METHOD_NOT_FOUND, format!("Unknown method {other}"))),
    }
}

fn req_str<'a>(p: &'a Value, key: &str, missing: &str) -> Result<&'a str, (i64, String)> {
    p[key]
        .as_str()
        .ok_or_else(|| (INVALID_PARAMS, missing.into()))
}

fn failure(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}
