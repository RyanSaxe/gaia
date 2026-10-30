//! Sends typed requests through OpenRouter's Decisions API when
//! `GAIA_JEV=live`. The key comes from `OPENROUTER_API_KEY` and reaches curl
//! only through stdin, never through command-line arguments or the engine's
//! JSON-RPC protocol. `endpoint` keeps the key from going anywhere but
//! OpenRouter.

use serde_json::{Value, json};
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub const ENDPOINT: &str = "https://openrouter.ai/api/alpha/decisions";
/// USD per million input tokens for typesafe/jev-1.13. Output tokens are free.
/// From OpenRouter's model page on 2026-10-06.
pub const USD_PER_MILLION_INPUT: f64 = 0.042;
/// Maximum concurrent requests. The runner reduces concurrency on overload.
pub const CONCURRENCY: usize = 64;
/// OpenRouter's own example request is 858 bytes of JSON billed as 476 input
/// tokens, so Jev bills about 1.8 bytes per token. `price` uses it as an
/// estimate until a live run reports `usage.input_tokens`.
pub const BYTES_PER_TOKEN: f64 = 1.8;
/// The key a local stand-in for OpenRouter receives in place of the person's.
pub const LOCAL_KEY: &str = "local-stand-in";

/// True when the person turned live Jev calls on for this engine.
pub fn live() -> bool {
    std::env::var("GAIA_JEV").is_ok_and(|v| v == "live")
}

/// Where requests go: OpenRouter, or a local stand-in for it that only tests use.
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

/// OpenRouter, unless `GAIA_JEV_ENDPOINT` names a loopback address, which tests
/// set for a local stand-in. Any other address is an error. A local endpoint
/// gets `LOCAL_KEY` and the configured key is never read, so the person's key
/// only goes to OpenRouter.
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

/// Whether a nonempty OpenRouter key is configured. A local stand-in needs no key.
pub fn has_key() -> bool {
    match endpoint() {
        Ok(Endpoint::Local(_)) => true,
        Ok(Endpoint::OpenRouter) => {
            std::env::var("OPENROUTER_API_KEY").is_ok_and(|key| !key.trim().is_empty())
        }
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
/// It needs no network or key.
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
    std::env::var("OPENROUTER_API_KEY")
        .map(|key| key.trim().to_string())
        .map_err(|_| "Set OPENROUTER_API_KEY before starting Gaia.".into())
        .and_then(|key| {
            if key.is_empty() {
                Err("OPENROUTER_API_KEY is empty.".into())
            } else {
                Ok(key)
            }
        })
}

/// Why one request failed. `Overloaded` means Jev returned 429 or 503 after
/// curl's own retries. `Other` is any other failure.
pub enum Failure {
    Overloaded(String),
    Other(String),
}

impl Failure {
    fn message(self) -> String {
        match self {
            Failure::Overloaded(m) | Failure::Other(m) => m,
        }
    }
}

/// Posts one request with curl, passing credentials and body on stdin to
/// avoid exposing them in arguments or exceeding command-line limits. curl
/// retries a timeout, 429 or 5xx twice, and gives up on a request after 90
/// seconds.
fn send(url: &str, key: &str, request: &Value) -> Result<Value, Failure> {
    let started = Instant::now();
    let mut child = Command::new("curl")
        .env_remove("OPENROUTER_API_KEY")
        .args([
            "-sS",
            "--fail-with-body",
            "--connect-timeout",
            "10",
            "--max-time",
            "90",
            "--retry",
            "2",
            "--write-out",
            "\n%{http_code}",
            "-X",
            "POST",
            url,
            "-H",
            "Content-Type: application/json",
            "--config",
            "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Failure::Other(format!("Could not start curl: {e}")))?;
    // Quote config values so curl preserves the JSON body's quotes and backslashes.
    let config = format!(
        "header = {}\ndata-binary = {}\n",
        json!(format!("Authorization: Bearer {key}")),
        json!(request.to_string())
    );
    child
        .stdin
        .take()
        .ok_or(Failure::Other("curl has no stdin".into()))?
        .write_all(config.as_bytes())
        .map_err(|e| Failure::Other(format!("Could not hand curl the request: {e}")))?;
    let out = child
        .wait_with_output()
        .map_err(|e| Failure::Other(format!("curl failed: {e}")))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let (body_text, status) = text.rsplit_once('\n').unwrap_or((&text, ""));
    let overloaded = matches!(status.trim(), "429" | "503");
    let body: Value = serde_json::from_str(body_text).map_err(|_| {
        let m = format!(
            "Jev answered with no JSON: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        if overloaded {
            Failure::Overloaded(m)
        } else {
            Failure::Other(m)
        }
    })?;
    if !out.status.success() {
        let m = format!("Jev refused the request: {body}");
        return Err(if overloaded {
            Failure::Overloaded(m)
        } else {
            Failure::Other(m)
        });
    }
    // The shape of `JevResponse` in packages/schema/src/jev.ts.
    Ok(json!({
        "answers": body["answers"],
        "model": body["model"],
        "costUsd": body["usage"]["cost"].as_f64().unwrap_or(0.0),
        "inputTokens": body["usage"]["input_tokens"].as_u64().unwrap_or(0),
        "ms": started.elapsed().as_millis() as u64,
    }))
}

/// Sends every request, `CONCURRENCY` at a time, and returns the answers in
/// request order. Each answer is a `JevResponse`, or `{ "error": … }` for a
/// request that failed on its own. The whole batch fails only when nothing can
/// be sent.
pub fn batch(requests: Vec<Value>) -> Result<Vec<Value>, String> {
    send_all(requests, CONCURRENCY).map(|(answers, _)| answers)
}

/// Sends every request, `concurrency` at a time, and returns the answers in
/// request order with whether Jev reported overload for any of them.
pub fn send_all(requests: Vec<Value>, concurrency: usize) -> Result<(Vec<Value>, bool), String> {
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
    let overloaded = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let workers: Vec<_> = (0..concurrency.max(1))
        .map(|_| {
            let (url, key, jobs, results, overloaded) = (
                Arc::clone(&url),
                Arc::clone(&key),
                Arc::clone(&jobs),
                Arc::clone(&results),
                Arc::clone(&overloaded),
            );
            std::thread::spawn(move || {
                while let Some((i, request)) = jobs.lock().map(|mut j| j.pop()).ok().flatten() {
                    let answer = send(&url, &key, &request).unwrap_or_else(|e| {
                        if let Failure::Overloaded(_) = e {
                            overloaded.store(true, std::sync::atomic::Ordering::Relaxed);
                        }
                        json!({ "error": e.message() })
                    });
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
    let overloaded = overloaded.load(std::sync::atomic::Ordering::Relaxed);
    Ok((results.into_iter().map(|(_, r)| r).collect(), overloaded))
}
