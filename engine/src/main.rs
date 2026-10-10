//! The gaia-engine binary. `--version` prints its version; `rpc` serves the
//! engine protocol over stdin and stdout until stdin closes; `mutate ROOT
//! OUT [PER_KIND]` writes the calibration set's mutations of a repository.

mod clone;
mod graph;
mod jev;
mod project;
mod rpc;
mod source;
mod store;

use std::io::{self, BufRead, Write};
use std::process::ExitCode;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("--version") => {
            println!("gaia-engine {VERSION}");
            ExitCode::SUCCESS
        }
        Some("rpc") => match serve(io::stdin().lock(), io::stdout().lock()) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("gaia-engine: {error}");
                ExitCode::FAILURE
            }
        },
        Some("mutate") if args.len() >= 3 => {
            let per_kind = args.get(3).and_then(|n| n.parse().ok()).unwrap_or(20);
            let out = std::path::Path::new(&args[2]);
            match graph::mutate::run(std::path::Path::new(&args[1]), out, per_kind) {
                Ok(manifest) => {
                    println!("{manifest}");
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("gaia-engine: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        _ => {
            eprintln!(
                "usage: gaia-engine --version | gaia-engine rpc | gaia-engine mutate ROOT OUT [PER_KIND]"
            );
            ExitCode::from(2)
        }
    }
}

/// Answers one JSON-RPC request per input line, one response per output line.
fn serve(input: impl BufRead, mut output: impl Write) -> io::Result<()> {
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let response = rpc::handle(&line);
        writeln!(output, "{response}")?;
        output.flush()?;
    }
    Ok(())
}
