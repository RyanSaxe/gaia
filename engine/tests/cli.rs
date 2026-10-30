//! Tests the gaia-engine binary through its command line and `rpc` protocol, as
//! the app and a terminal use it.

use std::io::Write;
use std::process::{Command, Stdio};

const BIN: &str = env!("CARGO_BIN_EXE_gaia-engine");

#[test]
fn rpc_answers_each_line_and_exits_when_stdin_closes() {
    let mut child = Command::new(BIN)
        .arg("rpc")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn gaia-engine rpc");
    let mut stdin = child.stdin.take().expect("stdin");
    // A line that is not JSON and an unknown method get errors, and the engine keeps answering.
    for line in [
        r#"{"jsonrpc":"2.0","id":1,"method":"engine.ping","params":{}}"#,
        "not json",
        r#"{"jsonrpc":"2.0","id":3,"method":"nope","params":{}}"#,
        r#"{"jsonrpc":"2.0","id":4,"method":"engine.ping","params":{}}"#,
    ] {
        writeln!(stdin, "{line}").unwrap();
    }
    drop(stdin);
    let out = child.wait_with_output().expect("wait");
    assert!(out.status.success());
    let lines: Vec<serde_json::Value> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(lines.len(), 4);
    assert_eq!(lines[0]["result"]["version"], env!("CARGO_PKG_VERSION"));
    assert!(lines[1]["error"].is_object());
    assert_eq!(lines[2]["id"], 3);
    assert!(lines[2]["error"].is_object());
    assert_eq!(lines[3]["id"], 4);
    assert_eq!(lines[3]["result"]["version"], env!("CARGO_PKG_VERSION"));
}

/// Runs `gaia-engine rpc` with extra environment, sends each request, and returns each response.
fn rpc(env: &[(&str, &str)], requests: &[serde_json::Value]) -> Vec<serde_json::Value> {
    let mut child = Command::new(BIN)
        .arg("rpc")
        .env_remove("GAIA_JEV")
        .env_remove("GAIA_JEV_ENDPOINT")
        .envs(env.iter().copied())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn gaia-engine rpc");
    let mut stdin = child.stdin.take().expect("stdin");
    for r in requests {
        writeln!(stdin, "{r}").unwrap();
    }
    drop(stdin);
    let out = child.wait_with_output().expect("wait");
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

#[test]
fn the_store_keeps_each_project_s_records_across_runs() {
    let dir = std::env::temp_dir().join(format!("gaia-store-test-{}", std::process::id()));
    let data = dir.to_str().unwrap();
    let call = |id: u32, method: &str, params: serde_json::Value| serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
    let wrote = rpc(
        &[("GAIA_DATA_DIR", data)],
        &[call(
            1,
            "store.put",
            serde_json::json!({ "project": "abc123", "writes": [
            { "table": "answers", "key": "k1", "value": { "model": "jev" } },
            { "table": "settings", "key": "jev", "value": { "approved": true } },
        ] }),
        )],
    );
    assert_eq!(wrote[0]["result"]["ok"], true);
    let read = rpc(
        &[("GAIA_DATA_DIR", data)],
        &[
            call(
                2,
                "store.read",
                serde_json::json!({ "project": "abc123", "table": "answers" }),
            ),
            call(
                3,
                "store.get",
                serde_json::json!({ "project": "abc123", "table": "settings", "key": "jev" }),
            ),
            call(
                4,
                "store.get",
                serde_json::json!({ "project": "other", "table": "settings", "key": "jev" }),
            ),
            call(
                5,
                "store.get",
                serde_json::json!({ "project": "../escape", "table": "settings", "key": "jev" }),
            ),
        ],
    );
    assert_eq!(read[0]["result"]["records"]["k1"]["model"], "jev");
    assert_eq!(read[1]["result"]["value"]["approved"], true);
    assert!(read[2]["result"].is_null(), "another project sees nothing");
    assert!(
        read[3]["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Not a project ID")
    );
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn an_endpoint_override_must_be_local_so_the_key_only_goes_to_openrouter() {
    let request = serde_json::json!({ "model": "typesafe/jev-1.13", "state": {}, "questions": {} });
    let call = serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "jev.batch", "params": { "requests": [request] } });
    let refused = rpc(
        &[
            ("GAIA_JEV", "live"),
            (
                "GAIA_JEV_ENDPOINT",
                "https://example.com/api/alpha/decisions",
            ),
        ],
        std::slice::from_ref(&call),
    );
    assert!(
        refused[0]["error"]["message"]
            .as_str()
            .unwrap()
            .contains("only for a local stand-in")
    );
    let status = rpc(
        &[(
            "GAIA_JEV_ENDPOINT",
            "http://127.0.0.1:9/api/alpha/decisions",
        )],
        &[serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "jev.status", "params": {} })],
    );
    assert_eq!(
        status[0]["result"],
        serde_json::json!({ "key": true, "live": false })
    );
}

#[test]
fn nothing_is_sent_while_jev_is_off() {
    // The endpoint is a closed local port, so even an engine that tried to send would reach nothing.
    let request = serde_json::json!({ "model": "typesafe/jev-1.13", "state": {}, "questions": {} });
    let refused = rpc(
        &[("GAIA_JEV_ENDPOINT", "http://127.0.0.1:9/api/alpha/decisions")],
        &[serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "jev.batch", "params": { "requests": [request] } })],
    );
    assert!(refused[0]["result"].is_null(), "the batch is refused whole, not sent and failed");
    assert!(refused[0]["error"]["message"].as_str().unwrap().contains("GAIA_JEV=live"));
}

#[test]
fn the_journal_reads_a_file_as_the_world_s_commit_holds_it() {
    let root = std::env::temp_dir().join(format!("gaia-cli-source-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let git = |args: &[&str]| {
        let out = Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(["-c", "user.name=Gaia", "-c", "user.email=gaia@example.com"])
            .args(args)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}");
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    };
    git(&["init", "-q"]);
    std::fs::write(root.join("a.ts"), "one\ntwo\n").unwrap();
    git(&["add", "."]);
    git(&["commit", "-q", "-m", "one"]);
    let built = git(&["rev-parse", "HEAD"]);
    // A commit after the world was built, and an edit not yet committed.
    std::fs::write(root.join("a.ts"), "three\n").unwrap();
    git(&["commit", "-q", "-am", "two"]);
    std::fs::write(root.join("a.ts"), "four\n").unwrap();
    let r = root.to_str().unwrap();
    let answers = rpc(
        &[],
        &[
            serde_json::json!({ "id": 1, "method": "project.source", "params": { "root": r, "path": "a.ts", "commit": built } }),
            serde_json::json!({ "id": 2, "method": "project.source", "params": { "root": r, "path": "a.ts" } }),
            serde_json::json!({ "id": 3, "method": "project.source", "params": { "root": r, "path": "../a.ts" } }),
        ],
    );
    assert_eq!(answers[0]["result"]["lines"], serde_json::json!(["one", "two", ""]));
    assert_eq!(answers[1]["result"]["lines"], serde_json::json!(["three", ""]));
    assert_eq!(answers[2]["result"]["lines"], serde_json::json!(null));
    std::fs::remove_dir_all(&root).unwrap();
}
