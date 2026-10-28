//! Jev, the model that answers Gaia's questions about code. `client.rs` sends
//! requests to OpenRouter. `runner.rs` chooses which questions to send about the
//! code graph, and when, using the calls in `calls.rs` and the understanding
//! pass's calls in `axes.rs`.

mod axes;
mod calls;
pub mod client;
mod hold;
pub mod runner;
pub mod tokens;

pub use client::{batch, dry_run, has_key, live};
