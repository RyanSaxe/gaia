//! The Jev connector: sends the planner's requests to Jev through
//! OpenRouter's Decisions API with the key from the macOS Keychain. It is
//! off unless the engine runs with `GAIA_JEV=live`, which the reviewer turns
//! on only after approving the spend. A dry run returns exactly what would be
//! sent (never the key) and what it would cost, and touches neither the
//! network nor the Keychain. The key never leaves this process: it goes to
//! curl on stdin, never on a command line and never back over the protocol.
//!
//! Tests point the connector at a local stand-in for OpenRouter with
//! `GAIA_JEV_ENDPOINT`, which accepts only a loopback address. A local
//! endpoint is sent a placeholder key and the Keychain is never read, so the
//! person's key can only ever go to OpenRouter.

use serde_json::{Value, json};
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub const ENDPOINT: &str = "https://openrouter.ai/api/alpha/decisions";
/// USD per million input tokens for typesafe/jev-1.13; output tokens are free.
/// From OpenRouter's model page as recorded on 2026-10-06.
pub const USD_PER_MILLION_INPUT: f64 = 0.042;
/// Concurrent requests: OpenRouter's Jev cookbook ran 8 workers without a 429.
pub const CONCURRENCY: usize = 8;
/// OpenRouter's own example request is 858 bytes of JSON billed as 476 input
/// tokens, so Jev counts about 1.8 bytes per token. An estimate until a live
/// run reports `usage.input_tokens`.
pub const BYTES_PER_TOKEN: f64 = 1.8;
/// Where the key lives: `security add-generic-password -s gaia-openrouter -a openrouter -w <key>`.
pub const KEYCHAIN_SERVICE: &str = "gaia-openrouter";
pub const KEYCHAIN_ACCOUNT: &str = "openrouter";

/// The key a local stand-in for OpenRouter receives in place of the person's.
pub const LOCAL_KEY: &str = "local-stand-in";

/// True when the person turned live Jev calls on for this engine.
pub fn live() -> bool {
    std::env::var("GAIA_JEV").is_ok_and(|v| v == "live")
}

/// Where requests go: OpenRouter, or a local stand-in for it (tests only).
enum Endpoint {
    OpenRouter,
    Local(String),
}

impl Endpoint {
    fn url(&self) -> &str {
        match self {
            Endpoint::OpenRouter => ENDPOINT,
            Endpoint::Local(url) => url,
        }
    }
}

/// OpenRouter, unless `GAIA_JEV_ENDPOINT` names a loopback address.
fn endpoint() -> Result<Endpoint, String> {
    match std::env::var("GAIA_JEV_ENDPOINT") {
        Err(_) => Ok(Endpoint::OpenRouter),
        Ok(url) if is_loopback(&url) => Ok(Endpoint::Local(url)),
        Ok(url) => Err(format!(
            "GAIA_JEV_ENDPOINT is only for a local stand-in of OpenRouter, at http://127.0.0.1:<port>/…; {url} is not one."
        )),
    }
}

fn is_loopback(url: &str) -> bool {
    ["http://127.0.0.1:", "http://localhost:", "http://[::1]:"]
        .iter()
        .any(|prefix| url.starts_with(prefix))
}

/// Whether a key is configured, without reading it: the Keychain is asked
/// only whether the item exists. A local stand-in needs no key.
pub fn has_key() -> bool {
    match endpoint() {
        Ok(Endpoint::Local(_)) => true,
        Ok(Endpoint::OpenRouter) => Command::new("security")
            .args([
                "find-generic-password",
                "-s",
                KEYCHAIN_SERVICE,
                "-a",
                KEYCHAIN_ACCOUNT,
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success()),
        Err(_) => false,
    }
}

/// One request's body exactly as it would be posted, and its estimated cost.
pub fn price(request: &Value) -> (String, u64, f64) {
    let body = request.to_string();
    let tokens = (body.len() as f64 / BYTES_PER_TOKEN).ceil() as u64;
    (body, tokens, tokens as f64 * USD_PER_MILLION_INPUT / 1e6)
}

/// What a batch would send: its endpoint, each body's size and tokens, and the totals.
pub fn dry_run(requests: &[Value]) -> Value {
    let priced: Vec<(String, u64, f64)> = requests.iter().map(price).collect();
    json!({
        "endpoint": endpoint().map_or(ENDPOINT.to_string(), |e| e.url().to_string()),
        "requests": requests.len(),
        "questions": requests.iter().map(|r| r["questions"].as_object().map_or(0, |q| q.len())).sum::<usize>(),
        "bytes": priced.iter().map(|p| p.0.len()).sum::<usize>(),
        "estimatedTokens": priced.iter().map(|p| p.1).sum::<u64>(),
        "estimatedUsd": priced.iter().map(|p| p.2).sum::<f64>(),
        "usdPerMillionInputTokens": USD_PER_MILLION_INPUT,
        "concurrency": CONCURRENCY,
        "live": live(),
    })
}

fn key(endpoint: &Endpoint) -> Result<String, String> {
    if let Endpoint::Local(_) = endpoint {
        return Ok(LOCAL_KEY.to_string());
    }
    let out = Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            KEYCHAIN_ACCOUNT,
            "-w",
        ])
        .output()
        .map_err(|e| format!("Could not read the Keychain: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "No OpenRouter key in the Keychain under {KEYCHAIN_SERVICE}."
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Posts one request with curl, the key passed on stdin as a header. curl
/// retries a transient failure (a timeout, 429 or 5xx) twice, and gives up on
/// one request after 90 seconds.
fn send(url: &str, key: &str, request: &Value) -> Result<Value, String> {
    let started = Instant::now();
    let mut child = Command::new("curl")
        .args([
            "-sS",
            "--fail-with-body",
            "--connect-timeout",
            "10",
            "--max-time",
            "90",
            "--retry",
            "2",
            "-X",
            "POST",
            url,
            "-H",
            "Content-Type: application/json",
            "-H",
            "@-",
            "--data-binary",
        ])
        .arg(request.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start curl: {e}"))?;
    child
        .stdin
        .take()
        .ok_or("curl has no stdin")?
        .write_all(format!("Authorization: Bearer {key}\n").as_bytes())
        .map_err(|e| format!("Could not hand curl the key: {e}"))?;
    let out = child
        .wait_with_output()
        .map_err(|e| format!("curl failed: {e}"))?;
    let body: Value = serde_json::from_slice(&out.stdout).map_err(|_| {
        format!(
            "Jev answered with no JSON: {}",
            String::from_utf8_lossy(&out.stderr)
        )
    })?;
    if !out.status.success() {
        return Err(format!("Jev refused the request: {body}"));
    }
    // The shape of `JevResponse` in packages/schema/src/jev.ts.
    Ok(json!({
        "answers": body["answers"],
        "model": body["model"],
        "costUsd": body["usage"]["cost"].as_f64().unwrap_or(0.0),
        "ms": started.elapsed().as_millis() as u64,
    }))
}

/// Sends every request, CONCURRENCY at a time, answering in the order asked.
/// Each answer is a `JevResponse`, or `{ "error": … }` for a request that
/// failed on its own; the whole batch fails only when nothing can be sent.
pub fn batch(requests: Vec<Value>) -> Result<Vec<Value>, String> {
    if !live() {
        return Err(
            "Jev is off: the engine sends nothing until it runs with GAIA_JEV=live.".into(),
        );
    }
    let endpoint = endpoint()?;
    let key = Arc::new(key(&endpoint)?);
    let url = Arc::new(endpoint.url().to_string());
    let jobs = Arc::new(Mutex::new(
        requests.into_iter().enumerate().collect::<Vec<_>>(),
    ));
    let results = Arc::new(Mutex::new(Vec::new()));
    let workers: Vec<_> = (0..CONCURRENCY)
        .map(|_| {
            let (url, key, jobs, results) = (
                Arc::clone(&url),
                Arc::clone(&key),
                Arc::clone(&jobs),
                Arc::clone(&results),
            );
            std::thread::spawn(move || {
                while let Some((i, request)) = jobs.lock().map(|mut j| j.pop()).ok().flatten() {
                    let answer =
                        send(&url, &key, &request).unwrap_or_else(|e| json!({ "error": e }));
                    if let Ok(mut r) = results.lock() {
                        r.push((i, answer));
                    }
                }
            })
        })
        .collect();
    for w in workers {
        w.join().map_err(|_| "A Jev worker panicked.".to_string())?;
    }
    let mut results = Arc::try_unwrap(results)
        .map_err(|_| "Jev workers still running.")?
        .into_inner()
        .map_err(|e| e.to_string())?;
    results.sort_by_key(|(i, _)| *i);
    Ok(results.into_iter().map(|(_, r)| r).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dry_run_prices_requests_and_sends_nothing() {
        let request = json!({ "model": "typesafe/jev-1.13", "state": { "file": "a.ts" }, "questions": { "vibe": { "type": "noul", "instructions": "Is it?" } } });
        let plan = dry_run(&[request.clone(), request]);
        assert_eq!(plan["requests"], 2);
        assert_eq!(plan["questions"], 2);
        assert_eq!(plan["endpoint"], ENDPOINT);
        let tokens = plan["estimatedTokens"].as_u64().unwrap();
        assert!(tokens > 0);
        assert!(
            (plan["estimatedUsd"].as_f64().unwrap() - tokens as f64 * USD_PER_MILLION_INPUT / 1e6)
                .abs()
                < 1e-12
        );
    }

    #[test]
    fn nothing_is_sent_while_jev_is_off() {
        // SAFETY of intent: tests never run live; the flag is off unless set.
        if live() {
            return;
        }
        let err = batch(vec![json!({})]).unwrap_err();
        assert!(err.contains("GAIA_JEV=live"));
    }
}
