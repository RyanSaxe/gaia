//! The code graph's types, as `packages/schema/src/graph.ts` declares them.
//! Only what the engine fills today is here; Jev's answers (`judged`) join
//! when the runner exists.

use serde::Serialize;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodeGraph {
    pub project_id: String,
    pub name: String,
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
    pub cognitive: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cyclomatic: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nesting: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calls_out: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reach: Option<Reach>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history: Option<History>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markers: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duplicates: Option<Vec<String>>,
}

#[derive(Serialize, Debug, Clone, Copy, Default)]
pub struct Reach {
    pub files: u32,
    pub defs: u32,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct History {
    pub first_days: u32,
    pub last_days: u32,
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
