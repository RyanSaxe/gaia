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
        "project.graph" => match p["root"].as_str() {
            Some(root) => if p["judged"].as_bool() == Some(true) {
                crate::jev::runner::judged_graph(Path::new(root))
            } else {
                crate::graph::build(Path::new(root))
            }
            .map_err(|e| (FAILED, e))
            .and_then(|graph| serde_json::to_value(graph).map_err(|e| (FAILED, e.to_string()))),
            None => Err((INVALID_PARAMS, "project.graph needs a root.".into())),
        },
        "project.source" => match (p["root"].as_str(), p["path"].as_str()) {
            (Some(root), Some(path)) => {
                // With `commit`, the commit the world was built from, it reads the file at that commit, so the journal shows the code the graph read.
                let root = Path::new(root);
                let snapshot = match p["commit"].as_str() {
                    Some(commit) => crate::graph::walk::Snapshot::at(root, commit),
                    None => Some(crate::graph::walk::Snapshot::of(root)),
                };
                let lines = snapshot.and_then(|s| s.text(path)).map(|text| {
                    text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l).to_string()).collect::<Vec<_>>()
                });
                Ok(json!({ "lines": lines }))
            }
            _ => Err((INVALID_PARAMS, "project.source needs a root and a path.".into())),
        },
        "project.commit" => match p["root"].as_str() {
            // The commit that `project.graph` would read the root at now.
            Some(root) => Ok(json!({ "commit": crate::graph::walk::Snapshot::of(Path::new(root)).commit() })),
            None => Err((INVALID_PARAMS, "project.commit needs a root.".into())),
        },
        "project.commits" => match (p["root"].as_str(), p["from"].as_str(), p["to"].as_str()) {
            // How many commits after `from` up to `to` changed a file under the root, or null when `from` is not in `to`'s history.
            (Some(root), Some(from), Some(to)) => Ok(json!({ "commits": crate::graph::git::commits_between(Path::new(root), from, to) })),
            _ => Err((INVALID_PARAMS, "project.commits needs a root, a from and a to.".into())),
        },
        "understanding.plan" => match p["root"].as_str() {
            Some(root) => crate::jev::runner::plan(Path::new(root)).map_err(|e| (FAILED, e)),
            None => Err((INVALID_PARAMS, "understanding.plan needs a root.".into())),
        },
        "understanding.next" => match p["root"].as_str() {
            Some(root) => {
                crate::jev::runner::next(Path::new(root), p["max"].as_u64().map(|m| m as usize))
                    .map_err(|e| (FAILED, e))
            }
            None => Err((INVALID_PARAMS, "understanding.next needs a root.".into())),
        },
        "project.locate" => match p["address"].as_str() {
            Some(address) => crate::clone::locate(address).map_err(|e| (FAILED, e)),
            None => Err((INVALID_PARAMS, "project.locate needs an address.".into())),
        },
        "project.clone" => match p["address"].as_str() {
            Some(address) => crate::clone::clone(address).map_err(|e| (FAILED, e)),
            None => Err((INVALID_PARAMS, "project.clone needs an address.".into())),
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
    fn project_graph_needs_a_real_directory() {
        assert_eq!(
            handle(r#"{"jsonrpc":"2.0","id":8,"method":"project.graph","params":{}}"#)["error"]["code"],
            INVALID_PARAMS
        );
        assert_eq!(
            handle(
                r#"{"jsonrpc":"2.0","id":9,"method":"project.graph","params":{"root":"/no/such/dir"}}"#
            )["error"]["code"],
            FAILED
        );
    }

    #[test]
    fn a_world_read_from_disk_has_no_commit() {
        assert_eq!(
            handle(r#"{"jsonrpc":"2.0","id":10,"method":"project.commit","params":{}}"#)["error"]["code"],
            INVALID_PARAMS
        );
        let commit = handle(
            r#"{"jsonrpc":"2.0","id":11,"method":"project.commit","params":{"root":"/no/such/dir"}}"#,
        );
        assert_eq!(commit["result"], json!({ "commit": null }));
    }

    #[test]
    fn counts_the_commits_to_a_folder_since_one_in_its_history_and_no_others() {
        let repo = std::env::temp_dir().join(format!("gaia-rpc-commits-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&repo);
        std::fs::create_dir_all(repo.join("sub")).unwrap();
        let git = |args: &[&str]| {
            let out = std::process::Command::new("git").arg("-C").arg(&repo).args(["-c", "user.name=Gaia", "-c", "user.email=gaia@example.com"]).args(args).output().unwrap();
            assert!(out.status.success(), "git {args:?}");
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        git(&["init", "-q"]);
        let mut commits = Vec::new();
        // Three commits change `sub` and one changes only a file outside it.
        for (file, text) in [("sub/a.ts", "1"), ("sub/a.ts", "2"), ("outside.txt", "3"), ("sub/b.ts", "4")] {
            std::fs::write(repo.join(file), text).unwrap();
            git(&["add", "."]);
            git(&["commit", "-q", "-m", text]);
            commits.push(git(&["rev-parse", "HEAD"]));
        }
        let ask = |from: &str, to: &str| {
            let request = json!({ "jsonrpc": "2.0", "id": 12, "method": "project.commits", "params": { "root": repo.join("sub"), "from": from, "to": to } });
            handle(&request.to_string())
        };
        assert_eq!(ask(&commits[0], &commits[3])["result"], json!({ "commits": 2 }));
        assert_eq!(ask(&commits[3], &commits[3])["result"], json!({ "commits": 0 }));
        // A `from` that is not in the history, as after a rebase, a hash git does not know, or not a commit at all gives null.
        assert_eq!(ask(&commits[3], &commits[0])["result"], json!({ "commits": null }));
        assert_eq!(ask("0123456789abcdef0123456789abcdef01234567", &commits[3])["result"], json!({ "commits": null }));
        assert_eq!(ask("--all", &commits[3])["result"], json!({ "commits": null }));
        assert_eq!(
            handle(r#"{"jsonrpc":"2.0","id":13,"method":"project.commits","params":{"root":"/tmp"}}"#)["error"]["code"],
            INVALID_PARAMS
        );
        std::fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn an_address_that_is_not_a_github_repository_goes_nowhere() {
        let locate = handle(
            r#"{"jsonrpc":"2.0","id":5,"method":"project.locate","params":{"address":"https://gitlab.com/a/b"}}"#,
        );
        assert_eq!(
            locate["result"],
            json!({ "found": false, "why": "address" })
        );
        let clone = handle(
            r#"{"jsonrpc":"2.0","id":6,"method":"project.clone","params":{"address":"git@github.com:a/b.git"}}"#,
        );
        assert_eq!(
            clone["result"],
            json!({ "cloned": false, "why": "address" })
        );
        assert_eq!(
            handle(r#"{"jsonrpc":"2.0","id":7,"method":"project.clone","params":{}}"#)["error"]["code"],
            INVALID_PARAMS
        );
    }
}
