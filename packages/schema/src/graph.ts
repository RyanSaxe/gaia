// The code graph: everything the engine knows about a codebase, as one
// graph. A node stands for each directory, file, definition and block the
// parse finds, and an edge for each link between them. Measures are what the
// engine counts; `judged` holds Jev's answers. Every edge says who filled it,
// and an edge Jev filled carries its probability. `project.graph` returns it
// (`engine/src/graph/model.rs` mirrors these types).

export interface CodeGraph {
  readonly projectId: string;
  readonly name: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** Imports and calls that neither a rule nor Jev has resolved yet. */
  readonly pending: readonly PendingRef[];
}

/**
 * Built from paths and names, never line numbers, so it changes on a rename
 * but not on an edit above the node: `dir:src/filter`, `file:src/walk.rs`,
 * `def:src/walk.rs#BatchSender.send`, `block:src/walk.rs#BatchSender.send/1`.
 * A second definition with the same name in the same scope gets `~2`.
 */
export type NodeId = string;

export type GraphNode = DirNode | FileNode | DefNode | BlockNode;

interface NodeBase {
  readonly id: NodeId;
  /** Unchanged through renames and moves; the world seeds geometry from it. */
  readonly lineage: string;
  readonly measures: Measures;
  readonly judged?: Judged;
}

export interface DirNode extends NodeBase {
  readonly kind: "dir";
  /** "" for the root. */
  readonly path: string;
}

export interface FileNode extends NodeBase {
  readonly kind: "file";
  readonly path: string;
  /** Null when no grammar reads the file. Jev reads its source either way. */
  readonly language: string | null;
  readonly bytes: number;
  readonly hash: string;
  readonly binary: boolean;
  /** Tree-sitter's ERROR and MISSING nodes: code the grammar could not read, which is not the same as broken code. */
  readonly unparsed: number;
  /** Language conventions its path matches, such as "go:test-file". Evidence in Jev's state, never a rule. */
  readonly conventions: readonly string[];
}

export interface DefNode extends NodeBase {
  readonly kind: "def";
  readonly file: NodeId;
  /** The enclosing definition, such as a method's class. */
  readonly parent?: NodeId;
  readonly name: string;
  /** The capture's suffix in the grammar's query: "function", "method", "class", "section" and so on. */
  readonly role: string;
  /** A method's receiver or impl type. */
  readonly owner?: string;
  readonly span: Span;
  /** Text up to the body, whitespace collapsed, cut at 240 characters. */
  readonly signature: string;
  readonly doc?: string;
}

export interface BlockNode extends NodeBase {
  readonly kind: "block";
  readonly def: NodeId;
  readonly shape: BlockShape;
  readonly span: Span;
  /** Enclosing blocks within the same definition. */
  readonly depth: number;
}

export type BlockShape = "branch" | "loop" | "match" | "try" | "closure" | "scope" | "concurrent" | "unsafe" | "data" | "markup";

/** What the engine counts. A field that doesn't apply to a node's kind is absent. */
export interface Measures {
  readonly lines: number;
  /** SonarSource's cognitive complexity. */
  readonly cognitive?: number;
  /** McCabe's cyclomatic complexity: the paths a test must cover. */
  readonly cyclomatic?: number;
  readonly nesting?: number;
  readonly params?: number;
  readonly callsOut?: number;
  readonly reach?: { readonly files: number; readonly defs: number };
  readonly history?: History;
  /** Comments that contain TODO, FIXME, XXX or HACK. */
  readonly markers?: number;
  /** Definitions elsewhere whose fingerprints nearly match this one's. */
  readonly duplicates?: readonly NodeId[];
}

/** Jev's answers as held: a fresh answer replaces a held one only when it clearly differs. */
export interface Judged {
  readonly stand?: Score;
  readonly kind?: Choice;
  readonly does?: Readonly<Record<string, YesNo>>;
  readonly role?: Choice;
  /** Keyed by question, such as "readability" or "errors". */
  readonly quality?: Readonly<Record<string, Score | Choice>>;
  readonly importance?: { readonly breaks: Score; readonly central: Score };
  /** Why a person should look; "routine" is one of the options. */
  readonly attention?: Choice;
  /** Whether it holds behavior a test should check. */
  readonly needsTests?: YesNo;
  /** Asked only when nothing in the repository reaches it. */
  readonly dead?: YesNo;
}

export interface GraphEdge {
  readonly from: NodeId;
  readonly to: NodeId;
  /** "names" joins code to a file or directory whose path a string literal in it spells out. */
  readonly kind: EdgeKind;
  readonly by: Filled;
  readonly at?: Span;
}

export type EdgeKind = "contains" | "imports" | "calls" | "references" | "inherits" | "implements" | "names" | "changes-with" | "checks";

/** The parser, the rules and git are certain; Jev's answers carry its probability. */
export type Filled = { readonly by: "parser" | "rule" | "git" } | { readonly by: "jev"; readonly call: string; readonly p: number };

export interface PendingRef {
  readonly from: NodeId;
  readonly kind: "import" | "call";
  /** As written in the source, such as "@/components/ui/button". */
  readonly text: string;
  readonly at: Span;
  /** Empty when the only possible answer is outside the repository. */
  readonly candidates: readonly NodeId[];
}

/** 1-based lines, both included. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface History {
  readonly firstDays: number;
  readonly lastDays: number;
  readonly commits: number;
  /** Commits in the last 14 days. */
  readonly recent: number;
  readonly authors: number;
}

export interface YesNo {
  readonly p: number;
  readonly call: string;
}

export interface Choice {
  readonly choice: string;
  readonly p: Readonly<Record<string, number>>;
  readonly call: string;
}

/** Jev's score, and the value from 0 to 1 that the world reads, through the question's calibration curve. */
export interface Score {
  readonly score: number;
  readonly value: number;
  readonly call: string;
}
