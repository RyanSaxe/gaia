// Composes blueprints for the sky, each region's land, each thing and each
// trail through the planner. Each wave is one Jev request. The structure
// comes first, then each stage's details, with earlier answers in the next
// wave's state. A blueprint holds only the parts and settings Jev chose, never a
// preset.

import { type AnyKind, type Blueprint, type CodeGraph, type DefNode, type DirNode, type EntityFacts, type FileNode, type JevAnswer, type JevClient, type Library, stagesOf } from "@gaia/schema";
import { type Target, type Wave, assemble, planDetails, planStructure, readStructure, validate } from "./planner.ts";

/** The kind for each composed thing, and the primitive library that fills them. */
export interface Composing {
  readonly building: AnyKind;
  readonly landmark: AnyKind;
  /** The whole world's light, sky and wind. */
  readonly world: AnyKind;
  /** A region's land. */
  readonly biome: AnyKind;
  /** A trail between two entities. */
  readonly link: AnyKind;
  /** Small forms that represent an entity, file or definition. */
  readonly tree: AnyKind;
  readonly bush: AnyKind;
  readonly stone: AnyKind;
  readonly flowers: AnyKind;
  /** A bush in the wild past the land's edge. It represents no code, and its request describes the wild around it. */
  readonly wildBush: AnyKind;
  readonly lib: Library;
  /** Per kind, a subset of `lib` to offer instead of all of it, so a bush is never offered a tree's frame. */
  readonly offered?: Partial<Readonly<Record<ComposedAs, Library>>>;
}

/** Which of `Composing`'s kinds composes a thing. */
export type ComposedAs = "building" | "landmark" | "world" | "biome" | "link" | "tree" | "bush" | "stone" | "flowers" | "wildBush";

/**
 * One thing to compose. `path` is an entity's path, a file's path, a definition's `<file>#<name>`, or an id that
 * starts with `world:`, `land:`, `trail:` or `wild:`. `state` is what Jev sees about it.
 */
export interface Composed {
  readonly path: string;
  readonly as: ComposedAs;
  readonly state: Readonly<Record<string, unknown>>;
  /** Features its place provides that a part may need, such as running water. */
  readonly has?: readonly string[];
  /** Allowed options per field path, such as its land's native families for "palette.family" (`DetailOptions.narrow`). */
  readonly narrow?: Readonly<Record<string, readonly string[]>>;
  /** Values already set per field path, such as its area's water for "relief.stream". These are filled in, not asked. */
  readonly fixed?: Readonly<Record<string, string | boolean>>;
  /** The part already chosen for each slot, such as the frame its form sets. These are filled in, not asked. */
  readonly uses?: Readonly<Record<string, string>>;
}

/** Requests one thing's structure from Jev, then each stage's details, and returns the validated blueprint. */
export async function composeThing(c: Composing, jev: JevClient, thing: Composed): Promise<Blueprint> {
  const k = c[thing.as];
  const lib = c.offered?.[thing.as] ?? c.lib;
  const target: Target = { id: thing.path, state: thing.state, ...(thing.has === undefined ? {} : { has: thing.has }), ...(thing.uses === undefined ? {} : { uses: thing.uses }) };
  const structureWave = planStructure(k, lib, target);
  const structure = readStructure(k, lib, structureWave, await answersOf(jev, structureWave));
  const waves: Wave[] = [];
  const answers: Record<string, JevAnswer> = {};
  for (let stage = 0; stage < stagesOf(k).length; stage++) {
    // Each stage's state includes the params settled in earlier stages, so openings can match the walls they are in.
    const earlier = waves.length === 0 ? undefined : settledParams(assemble(k, lib, structure, waves, answers));
    const wave = planDetails(k, lib, structure, target, { stage, ...(thing.narrow === undefined ? {} : { narrow: thing.narrow }), ...(thing.fixed === undefined ? {} : { fixed: thing.fixed }), ...(earlier === undefined ? {} : { earlier }) });
    // Skip a stage with no questions and no fixed values. A stage with only fixed values still adds its wave, so
    // `assemble` fills them in.
    if (Object.keys(wave.refs).length === 0) continue;
    Object.assign(answers, await answersOf(jev, wave));
    waves.push(wave);
  }
  const blueprint = assemble(k, lib, structure, waves, answers);
  const problems = validate(blueprint, k, lib);
  if (problems.length > 0) throw new Error(`The ${thing.as} composed for ${thing.path || "the repository's root"} does not hold together: ${problems.join(" ")}`);
  return blueprint;
}

/** Composes each thing independently, `concurrency` at a time, and returns the blueprints by path. */
export async function composeThings(c: Composing, jev: JevClient, things: readonly Composed[], concurrency: number): Promise<Record<string, Blueprint>> {
  const out: Record<string, Blueprint> = {};
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), things.length) }, async () => {
      while (next < things.length) {
        const thing = things[next++] as Composed;
        out[thing.path] = await composeThing(c, jev, thing);
      }
    }),
  );
  return out;
}

/** Most definitions `partOf` lists, most important first. */
const DEFINITIONS = 8;

/** Rounds a score to two decimals for a request, so tiny changes in Jev's judgment leave the request unchanged. */
export const share = (v: number | null | undefined): number | undefined => (v === null || v === undefined ? undefined : Math.round(v * 100) / 100);
/** Cuts a signature or doc to at most `n` characters for a request, ending in an ellipsis when cut. */
export const trim = (text: string, n: number): string => (text.length <= n ? text : `${text.slice(0, n - 1)}…`);

/**
 * What the engine graph records about a directory, file or repository. It
 * includes the understanding pass's importance, quality and concept scores,
 * the counts of files, lines, languages, folders and commits, and the most
 * important definitions.
 */
function partOf(graph: CodeGraph, path: string): Record<string, unknown> {
  const inside = (p: string): boolean => path === "" || p === path || p.startsWith(`${path}/`);
  const node = graph.nodes.find((n): n is DirNode | FileNode => (n.kind === "dir" || n.kind === "file") && n.path === path);
  const files = graph.nodes.filter((n): n is FileNode => n.kind === "file" && inside(n.path));
  const fileIds = new Set(files.map((f) => f.id));
  const defs = graph.nodes.filter((n): n is DefNode => n.kind === "def" && fileIds.has(n.file));
  const value = node?.judged?.value;
  const concepts = Object.entries(value?.concepts ?? {}).flatMap(([k, v]) => (share(v) === undefined ? [] : [[k, share(v)] as const]));
  const history = node?.measures.history;
  const important = [...defs]
    .sort((a, b) => (b.judged?.value?.importance ?? 0) - (a.judged?.value?.importance ?? 0) || a.id.localeCompare(b.id))
    .slice(0, DEFINITIONS)
    .map((d) => ({ name: d.name, role: d.role, signature: trim(d.signature, 120), ...(d.doc === undefined ? {} : { doc: trim(d.doc, 100) }), ...(share(d.judged?.value?.importance) === undefined ? {} : { importance: share(d.judged?.value?.importance) }) }));
  return {
    ...(share(value?.importance) === undefined ? {} : { importance: share(value?.importance) }),
    ...(share(value?.quality) === undefined ? {} : { quality: share(value?.quality) }),
    ...(concepts.length === 0 ? {} : { concepts: Object.fromEntries(concepts) }),
    files: files.length,
    lines: node?.measures.lines ?? files.reduce((n, f) => n + f.measures.lines, 0),
    languages: [...new Set(files.flatMap((f) => (f.language === null ? [] : [f.language])))].sort(),
    folders: graph.nodes.filter((n) => n.kind === "dir" && n.path !== path && inside(n.path)).length,
    ...(history === undefined ? {} : { commits: history.commits, recentCommits: history.recent, authors: history.authors }),
    definitions: important,
  };
}

const named = (path: string): string => (path === "" ? "(the repository's root)" : path);

/**
 * The state for composing an entity: its facts from `factsOf`, including what it depends on and how many entities
 * depend on it, plus `partOf` for its directory.
 */
export function composingState(graph: CodeGraph | undefined, entity: Pick<EntityFacts, "path" | "name"> & Partial<EntityFacts>): Record<string, unknown> {
  const path = entity.path;
  const about: Record<string, unknown> = {
    name: entity.name,
    path: named(path),
    ...(entity.form === undefined ? {} : { form: entity.form }),
    ...(entity.exports === undefined ? {} : { exports: entity.exports }),
    ...(entity.dependsOn === undefined ? {} : { dependsOn: entity.dependsOn.map(named) }),
    ...(entity.dependents === undefined ? {} : { dependedOnBy: entity.dependents.length }),
  };
  return graph === undefined ? { entity: about } : { entity: { ...about, ...partOf(graph, path) } };
}

/** The state for composing a file's form, which is the file's `partOf`. */
export function fileState(graph: CodeGraph | undefined, path: string): Record<string, unknown> {
  return { file: { path, ...(graph === undefined ? {} : partOf(graph, path)) } };
}

/**
 * The state for composing a definition's form: its role, signature, doc, file and line count, and the
 * understanding pass's importance, quality and concept scores.
 */
export function definitionState(graph: CodeGraph | undefined, id: string): Record<string, unknown> {
  const file = id.slice(0, id.indexOf("#"));
  const node = graph?.nodes.find((n): n is DefNode => n.kind === "def" && n.id === `def:${id}`);
  if (node === undefined) return { definition: { name: id.slice(id.indexOf("#") + 1), file } };
  const value = node.judged?.value;
  const concepts = Object.entries(value?.concepts ?? {}).flatMap(([k, v]) => (share(v) === undefined ? [] : [[k, share(v)] as const]));
  return {
    definition: {
      name: node.name,
      role: node.role,
      file,
      signature: trim(node.signature, 120),
      ...(node.doc === undefined ? {} : { doc: trim(node.doc, 100) }),
      lines: Math.max(1, node.span.end - node.span.start + 1),
      exported: node.exported,
      ...(share(value?.importance) === undefined ? {} : { importance: share(value?.importance) }),
      ...(share(value?.quality) === undefined ? {} : { quality: share(value?.quality) }),
      ...(concepts.length === 0 ? {} : { concepts: Object.fromEntries(concepts) }),
    },
  };
}

/** The state for composing the world's light, sky and wind, which is the repository root's `partOf`. */
export function repositoryState(graph: CodeGraph | undefined, name: string): Record<string, unknown> {
  return { repository: { name, ...(graph === undefined ? {} : partOf(graph, "")) } };
}

/** The state for composing a region's land: the directory's `partOf` and the water Jev chose for it. */
export function areaState(graph: CodeGraph | undefined, path: string, water: string | undefined): Record<string, unknown> {
  return { directory: { path: named(path), ...(graph === undefined ? {} : partOf(graph, path)), ...(water === undefined ? {} : { water }) } };
}

/**
 * The state for composing a trail: each entity's name, path, importance and quality, and how many files in `from`
 * import files in `to`, counted from the graph's import edges.
 */
export function trailState(graph: CodeGraph | undefined, from: Pick<EntityFacts, "path" | "name">, to: Pick<EntityFacts, "path" | "name">): Record<string, unknown> {
  const end = (e: Pick<EntityFacts, "path" | "name">): Record<string, unknown> => {
    const value = graph?.nodes.find((n): n is DirNode => n.kind === "dir" && n.path === e.path)?.judged?.value;
    return { name: e.name, path: named(e.path), ...(share(value?.importance) === undefined ? {} : { importance: share(value?.importance) }), ...(share(value?.quality) === undefined ? {} : { quality: share(value?.quality) }) };
  };
  const within = (path: string, p: string): boolean => path === "" || p === path || p.startsWith(`${path}/`);
  const fileOf = (id: string): string => (id.startsWith("file:") ? id.slice(5) : (id.slice(4).split("#")[0] ?? ""));
  const importing = graph === undefined ? undefined : new Set(graph.edges.filter((e) => e.kind === "imports" && within(from.path, fileOf(e.from)) && within(to.path, fileOf(e.to)) && !within(to.path, fileOf(e.from))).map((e) => fileOf(e.from))).size;
  return { trail: { from: end(from), to: end(to), ...(importing === undefined ? {} : { filesImporting: importing }) } };
}

/**
 * The state for composing a wild bush, which represents no code. It holds the wild ground's cover settings in
 * words, the composed sky, and each composed land without its relief, since the terrain past the land's edge has
 * its own landform. Lands with the same settled params appear once.
 */
export function wildState(ground: Readonly<Record<string, string>>, sky: Blueprint, lands: readonly Blueprint[], land: AnyKind): Record<string, unknown> {
  const around = new Map<string, Record<string, unknown>>();
  for (const bp of lands) {
    const settled = Object.fromEntries(Object.entries(settledParams(bp)).filter(([slot]) => land.slots[slot]?.role !== "Relief"));
    around.set(JSON.stringify(settled), settled);
  }
  return { wild: { ground }, sky: settledParams(sky), lands: [...around.values()] };
}

async function answersOf(jev: JevClient, wave: Wave): Promise<Readonly<Record<string, JevAnswer>>> {
  if (Object.keys(wave.request.questions).length === 0) return {};
  return (await jev.ask(wave.request)).answers;
}

/** A blueprint's non-empty params by slot, as a later stage's state shows them. */
function settledParams(bp: Blueprint): Record<string, Readonly<Record<string, unknown>>> {
  return Object.fromEntries(Object.entries(bp.slots).flatMap(([slot, filled]) => (Object.keys(filled.params).length === 0 ? [] : [[slot, filled.params]])));
}
