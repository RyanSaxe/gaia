// The code graph: everything the engine knows about a codebase, as one
// graph. A node stands for each directory, file, definition and block the
// parse finds, and an edge for each import, call, reference or
// implementation between them. Measures are what the engine counts; `judged`
// holds Jev's answers. Every edge says who filled it, and an edge Jev filled
// carries its probability. `project.graph` returns it
// (`engine/src/graph/model.rs` mirrors these types).

export interface CodeGraph {
  readonly projectId: string;
  readonly name: string;
  /** The commit the graph was read from: in git, the tree of the commit checked out, never uncommitted files. Absent when it read the disk. */
  readonly commit?: string;
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
  /** The package or crate rooted here. */
  readonly entity?: Entity;
}

/** What a directory is the root of, as its manifest says. */
export interface Entity {
  /** The manifest's name, else the directory's. */
  readonly name: string;
  readonly form: "package" | "crate";
  /** The file that declares it, such as package.json. */
  readonly manifest: string;
  /** The file that defines its public surface, such as src/index.ts. */
  readonly entry?: string;
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
  /** Its file exports it: `export` in TypeScript and JavaScript, `pub` in Rust. */
  readonly exported: boolean;
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

/** What the engine counts: every node's lines, and a file's or directory's history from git. */
export interface Measures {
  readonly lines: number;
  readonly history?: History;
}

/** Jev's answers as held: a fresh answer replaces a held one only when it clearly differs. */
export interface Judged {
  /**
   * The understanding pass's answers, keyed by concept: "importance" (as its
   * container judged it), and quality concepts such as "readability",
   * "cohesion" or "robustness" (`engine/vocab/understanding.toml`).
   */
  readonly axes?: Readonly<Record<string, Score | Choice>>;
  /** Which of a definition's blocks stand out, as choices over their ids: "key" and "weak". */
  readonly picks?: Readonly<Record<string, Choice>>;
  /** What more Jev asked to read, by round: "usages", "related", "tests", "docs" or "nothing". */
  readonly more?: Readonly<Record<string, Choice>>;
  /**
   * What the engine works out from the understanding pass, each from 0 to 1:
   * importance as the item's container judged it (the root is 1), and
   * quality gathered upward, each container's parts weighted by their lines
   * and blended with its own. Null where nothing was answered.
   */
  readonly value?: {
    readonly importance: number | null;
    readonly quality: number | null;
    /** Each concept Jev answered, from 0 to 1; null where the answer doesn't count, such as robustness's "nothing here can fail". */
    readonly concepts: Readonly<Record<string, number | null>>;
  };
}

export interface GraphEdge {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly kind: EdgeKind;
  readonly by: Filled;
  readonly at?: Span;
}

export type EdgeKind = "imports" | "calls" | "references" | "implements";

/** The rules are certain; Jev's answers carry its probability. */
export type Filled = { readonly by: "rule" } | { readonly by: "jev"; readonly call: string; readonly p: number };

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
  readonly commits: number;
  /** Commits in the last 14 days. */
  readonly recent: number;
  readonly authors: number;
}

export interface Choice {
  readonly choice: string;
  readonly p: Readonly<Record<string, number>>;
  readonly call: string;
}

/** Jev's score, and its share of the question's scale, from 0 to 1, which the world reads. */
export interface Score {
  readonly score: number;
  readonly value: number;
  readonly call: string;
}
