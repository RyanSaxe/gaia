//! The engine protocol: newline-delimited JSON-RPC 2.0. The TypeScript side of
//! the same contract is `EngineMethods` in `packages/schema/src/engine.ts`.

use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
struct Request {
    #[serde(default)]
    id: Value,
    method: String,
}

const PARSE_ERROR: i64 = -32700;
const METHOD_NOT_FOUND: i64 = -32601;

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
    match request.method.as_str() {
        "engine.ping" => {
            json!({ "jsonrpc": "2.0", "id": request.id, "result": { "version": crate::VERSION } })
        }
        other => failure(
            request.id,
            METHOD_NOT_FOUND,
            &format!("Unknown method {other}"),
        ),
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
}
