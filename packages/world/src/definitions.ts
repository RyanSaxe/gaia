// The definitions that stand in the world. Every definition stands, nested
// ones included: a function, a method, a class or a type. A variable or a
// constant that holds a plain value does not, and neither does a stylesheet
// rule, a document's section or a data file's key. Engine's graph says what
// is defined where, inside what, and how much each matters (Jev's importance,
// from 0 to 1); without a graph, the code model's top-level symbols stand,
// with no importance of their own.

import type { CodeGraph, CodeModel, DefNode, FileFacts, SymbolFact } from "@gaia/schema";

/** A definition that stands on its file's patch. */
export interface StandingDef {
  /** `<file>#<name>`, qualified by what encloses it: `app/x.ts#World.open`. */
  readonly id: string;
  readonly file: string;
  /** The definition it sits inside, by id. */
  readonly parent?: string;
  readonly name: string;
  readonly kind: SymbolFact["kind"];
  readonly exported: boolean;
  /** Where it is declared and how many lines it spans, its nested definitions included. */
  readonly line: number;
  readonly lines: number;
  readonly doc?: string;
  /** How much it matters, 0 to 1: Jev's importance from the understanding pass; absent until Jev has judged it. */
  readonly importance?: number;
}

/** Roles whose definitions hold no code that stands: a plain value, a stylesheet rule, a section, a key, markup. */
const NOT_STANDING = new Set(["rule", "section", "key", "element", "property", "field", "variable", "constant"]);

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

/** Files whose definitions stand: code and its tests. */
const standsIn = (f: FileFacts): boolean => (f.kind ?? "source") === "source" || f.kind === "test";

const exportedOf = (d: DefNode): boolean => /^(export|pub)\b/.test(d.signature) || (/^[A-Z]/.test(d.name) && /^(func|type)\b/.test(d.signature));

/**
 * Each file's standing definitions, by path, in the order they are written,
 * every definition before the ones inside it. With a graph, every definition
 * it holds stands; without one, the code model's top-level symbols, constants
 * left out.
 */
export function definitionsOf(model: CodeModel, graph?: CodeGraph): ReadonlyMap<string, readonly StandingDef[]> {
  const files = new Map(model.files.filter(standsIn).map((f) => [f.path, f]));
  const out = new Map<string, StandingDef[]>();
  if (graph === undefined) {
    for (const f of files.values()) {
      const defs = f.symbols
        .filter((s) => s.kind !== "constant")
        .map((s): StandingDef => ({ id: `${f.path}#${s.name}`, file: f.path, name: s.name, kind: s.kind, exported: s.exported, line: s.line ?? 0, lines: s.lines ?? 1, ...(s.doc === undefined ? {} : { doc: s.doc }) }));
      if (defs.length > 0) out.set(f.path, defs.sort((a, b) => a.line - b.line || (a.id < b.id ? -1 : 1)));
    }
    return out;
  }
  const pathOf = new Map(graph.nodes.flatMap((n) => (n.kind === "file" ? [[n.id, n.path] as const] : [])));
  const every = new Map(graph.nodes.flatMap((n) => (n.kind === "def" ? [[n.id, n] as const] : [])));
  const nodes = [...every.values()].filter((n) => !NOT_STANDING.has(n.role) && files.has(pathOf.get(n.file) ?? ""));
  const kept = new Set(nodes.map((n) => n.id));
  const idOf = (n: DefNode): string => `${pathOf.get(n.file) as string}#${n.id.slice(n.id.indexOf("#") + 1)}`;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes.sort((a, b) => a.span.start - b.span.start || (a.id < b.id ? -1 : 1))) {
    const path = pathOf.get(n.file) as string;
    // A definition inside one that does not stand (a constant's arrow, say) hangs from the nearest that does.
    let parent = n.parent;
    while (parent !== undefined && !kept.has(parent)) parent = every.get(parent)?.parent;
    const importance = n.judged?.value?.importance ?? undefined;
    const def: StandingDef = {
      id: idOf(n),
      file: path,
      ...(parent === undefined ? {} : { parent: idOf(byId.get(parent) as DefNode) }),
      name: n.name,
      kind: KIND_OF_ROLE[n.role] ?? "function",
      exported: exportedOf(n),
      line: n.span.start,
      lines: Math.max(1, n.span.end - n.span.start + 1),
      ...(n.doc === undefined ? {} : { doc: n.doc }),
      ...(importance === undefined ? {} : { importance }),
    };
    const list = out.get(path);
    if (list === undefined) out.set(path, [def]);
    else list.push(def);
  }
  return out;
}
