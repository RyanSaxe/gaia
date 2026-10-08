// The code graph: one explicit graph built from the engine's facts, which
// the world is laid out from. Directories contain directories and files;
// files contain their finer entities (functions, classes and exported
// symbols, with their size and doc comments); entities (packages, crates,
// modules, apps) are rooted at a directory. Edges say what contains what,
// which file imports which, and which entity depends on which and how
// heavily. Everything a world shows is a node or an edge here.

import type { CodeModel, EntityForm, FileFacts, FileKind, SymbolFact } from "@gaia/schema";

export type GraphNodeKind = "directory" | "file" | "entity" | "symbol";

/** One thing in the code. Its id is unique across kinds; its path is the code's own name for it. */
export interface GraphNode {
  /** `dir:<path>`, `file:<path>`, `entity:<root>` or `symbol:<file>#<name>`. */
  readonly id: string;
  readonly kind: GraphNodeKind;
  /** A directory's, file's or entity root's path; a symbol's file. */
  readonly path: string;
  readonly name: string;
  /** The node that contains it: a directory's parent, a file's directory, a symbol's file, an entity's root directory. */
  readonly parent: string | null;
  /** Lines of code it holds: a directory's are its files' summed. */
  readonly lines: number;
  readonly doc?: string;
  /** A file's part, such as source or test. */
  readonly fileKind?: FileKind;
  /** An entity's form. */
  readonly form?: EntityForm;
  /** A symbol's own facts. */
  readonly symbol?: { readonly kind: SymbolFact["kind"]; readonly exported: boolean; readonly line: number };
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  /** `contains`: a directory holds a directory or file, a file a symbol. `imports`: one file imports another. `depends`: one entity leans on another. */
  readonly kind: "contains" | "imports" | "depends";
  /** For `depends`, how many of `from`'s files import from `to`; 1 otherwise. */
  readonly weight: number;
}

export interface CodeGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export const dirId = (path: string): string => `dir:${path}`;
export const fileId = (path: string): string => `file:${path}`;
export const entityId = (path: string): string => `entity:${path}`;
export const symbolId = (file: string, name: string): string => `symbol:${file}#${name}`;

const parentOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const baseName = (path: string): string => path.split("/").pop() ?? path;
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The innermost entity whose root holds a path, if any. */
export function ownerOf(entityRoots: readonly string[], path: string): string | undefined {
  let best: string | undefined;
  for (const root of entityRoots) {
    if (root !== "" && path !== root && !path.startsWith(`${root}/`)) continue;
    if (best === undefined || root.length > best.length) best = root;
  }
  return best;
}

/** A file's finer entities: each named symbol once, the longest declaration of a name winning. */
export function symbolsOf(f: FileFacts): SymbolFact[] {
  const byName = new Map<string, SymbolFact>();
  for (const s of f.symbols) {
    const had = byName.get(s.name);
    if (had === undefined || (s.lines ?? 1) > (had.lines ?? 1)) byName.set(s.name, s);
  }
  return [...byName.values()].sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || byText(a.name, b.name));
}

/** Builds the code graph from a code model. The same model always gives the same graph, in the same order. */
export function codeGraph(model: CodeModel): CodeGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const dirLines = new Map<string, number>();
  const files = [...model.files].sort((a, b) => byText(a.path, b.path));
  const ensureDir = (path: string): void => {
    if (nodes.has(dirId(path))) return;
    const parent = path === "" ? null : parentOf(path);
    if (parent !== null) ensureDir(parent);
    nodes.set(dirId(path), { id: dirId(path), kind: "directory", path, name: path === "" ? model.repository.name : baseName(path), parent: parent === null ? null : dirId(parent), lines: 0 });
    if (parent !== null) edges.push({ from: dirId(parent), to: dirId(path), kind: "contains", weight: 1 });
  };
  ensureDir("");
  for (const f of files) {
    const dir = parentOf(f.path);
    ensureDir(dir);
    for (let p: string | null = dir; p !== null; p = p === "" ? null : parentOf(p)) dirLines.set(p, (dirLines.get(p) ?? 0) + f.lines);
    nodes.set(fileId(f.path), { id: fileId(f.path), kind: "file", path: f.path, name: baseName(f.path), parent: dirId(dir), lines: f.lines, fileKind: f.kind ?? "source", ...(f.doc === undefined ? {} : { doc: f.doc }) });
    edges.push({ from: dirId(dir), to: fileId(f.path), kind: "contains", weight: 1 });
    for (const s of symbolsOf(f)) {
      const id = symbolId(f.path, s.name);
      nodes.set(id, {
        id,
        kind: "symbol",
        path: f.path,
        name: s.name,
        parent: fileId(f.path),
        lines: s.lines ?? 1,
        symbol: { kind: s.kind, exported: s.exported, line: s.line ?? 0 },
        ...(s.doc === undefined ? {} : { doc: s.doc }),
      });
      edges.push({ from: fileId(f.path), to: id, kind: "contains", weight: 1 });
    }
  }
  for (const [path, lines] of dirLines) {
    const n = nodes.get(dirId(path)) as GraphNode;
    nodes.set(n.id, { ...n, lines });
  }
  const known = new Set(files.map((f) => f.path));
  for (const f of files) {
    for (const to of [...f.imports].sort(byText)) if (known.has(to) && to !== f.path) edges.push({ from: fileId(f.path), to: fileId(to), kind: "imports", weight: 1 });
  }
  const roots = model.entities.map((e) => e.path);
  for (const e of [...model.entities].sort((a, b) => byText(a.path, b.path))) {
    ensureDir(e.path);
    nodes.set(entityId(e.path), { id: entityId(e.path), kind: "entity", path: e.path, name: e.name, parent: dirId(e.path), lines: e.lines, form: e.form, ...(e.doc === undefined ? {} : { doc: e.doc }) });
  }
  // An entity's dependency weighs as many of its files as import from the other.
  const importers = new Map<string, Set<string>>();
  for (const f of files) {
    const from = ownerOf(roots, f.path);
    if (from === undefined) continue;
    for (const to of f.imports) {
      const owner = ownerOf(roots, to);
      if (owner === undefined || owner === from) continue;
      const key = `${from}\n${owner}`;
      const set = importers.get(key) ?? new Set<string>();
      set.add(f.path);
      importers.set(key, set);
    }
  }
  for (const e of [...model.entities].sort((a, b) => byText(a.path, b.path))) {
    for (const dep of [...e.dependsOn].sort(byText)) {
      if (!nodes.has(entityId(dep))) continue;
      edges.push({ from: entityId(e.path), to: entityId(dep), kind: "depends", weight: Math.max(1, importers.get(`${e.path}\n${dep}`)?.size ?? 0) });
    }
  }
  return { nodes: [...nodes.values()], edges };
}
