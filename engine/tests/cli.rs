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
