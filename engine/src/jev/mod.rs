//! Jev: the client that sends requests to OpenRouter (`client.rs`), and the
//! runner that decides what to ask Jev about the code graph, and when
//! (`runner.rs`), with the calls it asks (`calls.rs`).

mod calls;
pub mod client;
mod hold;
pub mod runner;
pub mod tokens;

pub use client::{batch, dry_run, has_key, live};
