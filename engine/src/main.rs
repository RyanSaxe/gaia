//! The gaia-engine binary. `--version` prints its version; `rpc` serves the
//! engine protocol over stdin and stdout until stdin closes.

mod clone;
mod git;
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
        _ => {
            eprintln!("usage: gaia-engine --version | gaia-engine rpc");
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
