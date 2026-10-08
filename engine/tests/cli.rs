//! The binary as the app and a terminal use it.

use std::io::Write;
use std::process::{Command, Stdio};

const BIN: &str = env!("CARGO_BIN_EXE_gaia-engine");

#[test]
fn version_flag_prints_the_version() {
    let out = Command::new(BIN)
        .arg("--version")
        .output()
        .expect("run gaia-engine");
    assert!(out.status.success());
    assert_eq!(
        String::from_utf8_lossy(&out.stdout).trim(),
        format!("gaia-engine {}", env!("CARGO_PKG_VERSION"))
    );
}

#[test]
fn rpc_answers_each_line_and_exits_when_stdin_closes() {
    let mut child = Command::new(BIN)
        .arg("rpc")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn gaia-engine rpc");
    let mut stdin = child.stdin.take().expect("stdin");
    writeln!(
        stdin,
        r#"{{"jsonrpc":"2.0","id":1,"method":"engine.ping","params":{{}}}}"#
    )
    .unwrap();
    writeln!(
        stdin,
        r#"{{"jsonrpc":"2.0","id":2,"method":"engine.ping","params":{{}}}}"#
    )
    .unwrap();
    drop(stdin);
    let out = child.wait_with_output().expect("wait");
    assert!(out.status.success());
    let lines: Vec<serde_json::Value> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[1]["id"], 2);
    assert_eq!(lines[0]["result"]["version"], env!("CARGO_PKG_VERSION"));
}

#[test]
fn project_open_reports_the_engine_s_own_crate() {
    let mut child = Command::new(BIN)
        .arg("rpc")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn gaia-engine rpc");
    let mut stdin = child.stdin.take().expect("stdin");
    let request = serde_json::json!({ "jsonrpc": "2.0", "id": 7, "method": "project.open", "params": { "root": env!("CARGO_MANIFEST_DIR") } });
    writeln!(stdin, "{request}").unwrap();
    drop(stdin);
    let out = child.wait_with_output().expect("wait");
    let response: serde_json::Value = serde_json::from_slice(&out.stdout).expect("one JSON line");
    let result = &response["result"];
    let files: Vec<&str> = result["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["path"].as_str().unwrap())
        .collect();
    assert!(files.contains(&"src/main.rs") && files.contains(&"src/project.rs"));
    let crate_ = &result["entities"][0];
    assert_eq!(crate_["name"], "gaia-engine");
    assert_eq!(crate_["form"], "crate");
    assert_eq!(crate_["entry"], "src/main.rs");
    assert!(crate_["tests"]["files"].as_u64().unwrap() >= 1);
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
