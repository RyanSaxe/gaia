// Lists the definitions placed in the world. Every function, method, class
// and type is placed, nested ones included. Variables and constants that hold
// plain values are not, and neither are stylesheet rules, document sections
// or data file keys. The engine graph gives each definition's file, parent
// and Jev's importance from 0 to 1. Without a graph, the facts' top-level
// symbols are placed with no importance.

import type { CodeGraph, CodeFacts, DefNode, SymbolFact } from "@gaia/schema";

/** A definition placed on its file's patch. */
export interface StandingDef {
  /** `<file>#<name>`, with the name qualified by its enclosing definitions, such as `app/x.ts#World.open`. */
  readonly id: string;
  readonly file: string;
  /** The id of the enclosing definition. */
  readonly parent?: string;
  readonly name: string;
  readonly kind: SymbolFact["kind"];
  readonly exported: boolean;
  /** Its declaration line, and how many lines it spans including nested definitions. */
  readonly line: number;
  readonly lines: number;
  readonly doc?: string;
  /** Jev's importance from the understanding pass, 0 to 1. Absent until Jev has judged it. */
  readonly importance?: number;
}

/** Roles that are not placed in the world: plain values, stylesheet rules, sections, keys and markup. */
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



/**
 * Each file's placed definitions by path, in source order, with each
 * definition before the ones inside it. With a graph, every definition in it
 * is placed. Without one, the facts' top-level symbols are.
 */
export function definitionsOf(facts: CodeFacts, graph?: CodeGraph): ReadonlyMap<string, readonly StandingDef[]> {
  const files = new Map(facts.files.map((f) => [f.path, f]));
  const out = new Map<string, StandingDef[]>();
  if (graph === undefined) {
    for (const f of files.values()) {
      const defs = f.symbols.map((s): StandingDef => ({ id: `${f.path}#${s.name}`, file: f.path, name: s.name, kind: s.kind, exported: s.exported, line: s.line ?? 0, lines: s.lines ?? 1 }));
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
    // A definition inside an unplaced one, such as an arrow function assigned to a constant, takes the nearest placed ancestor as parent.
    let parent = n.parent;
    while (parent !== undefined && !kept.has(parent)) parent = every.get(parent)?.parent;
    const importance = n.judged?.value?.importance ?? undefined;
    const def: StandingDef = {
      id: idOf(n),
      file: path,
      ...(parent === undefined ? {} : { parent: idOf(byId.get(parent) as DefNode) }),
      name: n.name,
      kind: KIND_OF_ROLE[n.role] ?? "function",
      exported: n.exported,
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
