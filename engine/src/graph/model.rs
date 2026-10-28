//! The code graph's types, matching `packages/schema/src/graph.ts`.
//! `graph::build` fills the structural facts, and `jev::runner::judged_graph`
//! adds Jev's answers as `judged`.

use serde::Serialize;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodeGraph {
    pub project_id: String,
    pub name: String,
    /// The commit the graph was read from (`walk::Snapshot`), or none when it read the disk.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub pending: Vec<PendingRef>,
}

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Node {
    Dir(DirNode),
    File(FileNode),
    Def(DefNode),
    Block(BlockNode),
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DirNode {
    pub id: String,
    pub lineage: String,
    pub measures: Measures,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub judged: Option<serde_json::Value>,
    pub path: String,
    /// The package or crate whose manifest is in this directory (`entities.rs`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity: Option<Entity>,
}

/// The package or crate a directory is the root of, from its manifest.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    /// The manifest's name, else the directory's.
    pub name: String,
    /// "package" or "crate".
    pub form: &'static str,
    /// The file that declares it, such as package.json.
    pub manifest: String,
    /// The file that defines its public surface, such as src/index.ts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub id: String,
    pub lineage: String,
    pub measures: Measures,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub judged: Option<serde_json::Value>,
    pub path: String,
    pub language: Option<String>,
    pub bytes: u64,
    pub hash: String,
    pub binary: bool,
    pub unparsed: u32,
    pub conventions: Vec<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DefNode {
    pub id: String,
    pub lineage: String,
    pub measures: Measures,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub judged: Option<serde_json::Value>,
    pub file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub name: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    pub span: Span,
    pub signature: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    /// Its file exports it: `export` in TypeScript and JavaScript, `pub` in Rust.
    pub exported: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BlockNode {
    pub id: String,
    pub lineage: String,
    pub measures: Measures,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub judged: Option<serde_json::Value>,
    /// The innermost definition holding the block, or its file when no definition does.
    pub def: String,
    pub shape: String,
    pub span: Span,
    pub depth: u32,
}

#[derive(Serialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Measures {
    pub lines: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history: Option<History>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct History {
    pub commits: u32,
    pub recent: u32,
    pub authors: u32,
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub start: u32,
    pub end: u32,
}

#[derive(Serialize, Debug)]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub kind: &'static str,
    pub by: Filled,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<Span>,
}

#[derive(Serialize, Debug)]
pub struct Filled {
    pub by: &'static str,
    /// The Jev call that filled it, with its version.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call: Option<String>,
    /// Jev's probability for its answer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p: Option<f64>,
}

impl Filled {
    pub fn by(by: &'static str) -> Self {
        Filled {
            by,
            call: None,
            p: None,
        }
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PendingRef {
    pub from: String,
    pub kind: &'static str,
    pub text: String,
    pub at: Span,
    pub candidates: Vec<String>,
}
