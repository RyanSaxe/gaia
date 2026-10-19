// The facts the world is laid out from, derived from the engine's code
// graph alone (`factsOf`): each file's size, language, definitions and
// imports both ways, and each entity a manifest declares,
// with its size, public surface and the entities it leans on. These are the
// code's structure; tool signals, test coverage, history and file kinds
// are not facts the world reads.

import type { CodeGraph, CodeFacts, DefNode, DirNode, EntityFacts, FileFacts, FileNode, SymbolFact } from "@gaia/schema";

/** A definition's role, as the kind of symbol the facts name. */
const KIND_OF_ROLE: Readonly<Record<string, SymbolFact["kind"]>> = {
  function: "function",
  method: "function",
  class: "class",
  struct: "class",
  interface: "type",
  type: "type",
  type_alias: "type",
  enum: "type",
  trait: "type",
  module: "module",
  mod: "module",
  namespace: "module",
};

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const pathIn = (path: string, root: string): boolean => root === "" || path === root || path.startsWith(`${root}/`);

/** The innermost entity root that holds a path, if any. */
function ownerOf(entityRoots: readonly string[], path: string): string | undefined {
  let best: string | undefined;
  for (const root of entityRoots) {
    if (!pathIn(path, root)) continue;
    if (best === undefined || root.length > best.length) best = root;
  }
  return best;
}

/**
 * A file's symbols: every definition it exports, and the functions and
 * classes at its top level. A name defined twice is listed once, by its
 * longest definition.
 */
function symbolsOf(defs: readonly DefNode[]): SymbolFact[] {
  const byName = new Map<string, SymbolFact>();
  for (const d of defs) {
    const kind = KIND_OF_ROLE[d.role];
    if (kind === undefined) continue;
    const top = d.parent === undefined && d.owner === undefined;
    if (!d.exported && !(top && (kind === "function" || kind === "class"))) continue;
    const s: SymbolFact = { name: d.name, kind, exported: d.exported, line: d.span.start, lines: Math.max(1, d.span.end - d.span.start + 1) };
    const had = byName.get(d.name);
    if (had === undefined || (s.lines ?? 1) > (had.lines ?? 1)) byName.set(d.name, s);
  }
  return [...byName.values()].sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || byText(a.name, b.name));
}

/** The facts the world reads, from the engine's code graph. The same graph always gives the same facts. */
export function factsOf(graph: CodeGraph): CodeFacts {
  const files = graph.nodes.filter((n): n is FileNode => n.kind === "file").sort((a, b) => byText(a.path, b.path));
  const pathOf = new Map(files.map((f) => [f.id, f.path]));
  const defsIn = new Map<string, DefNode[]>();
  const fileOfDef = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.kind !== "def") continue;
    const path = pathOf.get(n.file);
    if (path === undefined) continue;
    fileOfDef.set(n.id, path);
    const list = defsIn.get(path);
    if (list === undefined) defsIn.set(path, [n]);
    else list.push(n);
  }
  const symbols = new Map(files.map((f) => [f.path, symbolsOf(defsIn.get(f.path) ?? [])]));

  // Imports, both ways: from a file, or from a definition in it, to another file.
  const imports = new Map<string, Set<string>>(files.map((f) => [f.path, new Set<string>()]));
  const importedBy = new Map<string, Set<string>>(files.map((f) => [f.path, new Set<string>()]));
  for (const e of graph.edges) {
    if (e.kind !== "imports") continue;
    const from = pathOf.get(e.from) ?? fileOfDef.get(e.from);
    const to = pathOf.get(e.to);
    if (from === undefined || to === undefined || from === to) continue;
    imports.get(from)?.add(to);
    importedBy.get(to)?.add(from);
  }
  const sorted = (set: ReadonlySet<string> | undefined): string[] => [...(set ?? [])].sort(byText);
  const fileFacts: FileFacts[] = files.map((f) => ({
    path: f.path,
    language: f.language ?? "other",
    lines: f.measures.lines,
    symbols: symbols.get(f.path) ?? [],
    imports: sorted(imports.get(f.path)),
    importedBy: sorted(importedBy.get(f.path)),
  }));

  // Entities, each owning the files under its root that no deeper entity holds, and leaning on the entities its
  // files import from.
  const entityDirs = graph.nodes.filter((n): n is DirNode & { entity: NonNullable<DirNode["entity"]> } => n.kind === "dir" && n.entity !== undefined).sort((a, b) => byText(a.path, b.path));
  const roots = entityDirs.map((d) => d.path);
  const owner = new Map(files.map((f) => [f.path, ownerOf(roots, f.path)]));
  const depends = new Map<string, Set<string>>(roots.map((r) => [r, new Set<string>()]));
  const dependents = new Map<string, Set<string>>(roots.map((r) => [r, new Set<string>()]));
  for (const [from, set] of imports) {
    const a = owner.get(from);
    if (a === undefined) continue;
    for (const to of set) {
      const b = owner.get(to);
      if (b === undefined || b === a) continue;
      depends.get(a)?.add(b);
      dependents.get(b)?.add(a);
    }
  }
  const exportedIn = (path: string): number => (symbols.get(path) ?? []).filter((s) => s.exported).length;
  const entities: EntityFacts[] = entityDirs.map(({ path, entity: e }) => {
    const mine = fileFacts.filter((f) => owner.get(f.path) === path);
    return {
      path,
      name: e.name,
      form: e.form,
      manifest: e.manifest,
      ...(e.entry === undefined ? {} : { entry: e.entry }),
      files: mine.length,
      lines: mine.reduce((n, f) => n + f.lines, 0),
      exports: e.entry === undefined ? 0 : surfaceOf(e.entry, imports, exportedIn),
      dependsOn: sorted(depends.get(path)),
      dependents: sorted(dependents.get(path)),
    };
  });
  return {
    projectId: graph.projectId,
    files: fileFacts,
    entities,
    repository: { name: graph.name, files: fileFacts.length, lines: fileFacts.reduce((n, f) => n + f.lines, 0) },
  };
}

/**
 * How many definitions an entity's entry offers: its own exports, and, for an
 * entry that defines nothing of its own (a barrel), the exports of the files
 * it gathers.
 */
function surfaceOf(entry: string, imports: ReadonlyMap<string, ReadonlySet<string>>, exportedIn: (path: string) => number): number {
  const own = exportedIn(entry);
  if (own > 0) return own;
  return [...(imports.get(entry) ?? [])].reduce((n, p) => n + exportedIn(p), 0);
}
