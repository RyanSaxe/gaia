// Composing a world: its sky, each region's land, each entity's building or
// landmark and each trail are filled part by part through the planner, their
// structure first, then each stage's details, one request a wave, with what
// was settled before in the next wave's state. Jev never names a preset:
// every blueprint is the parts and settings it chose.

import { type AnyKind, type Blueprint, type CodeGraph, type DefNode, type DirNode, type EntityFacts, type FileNode, type JevAnswer, type JevClient, type Library, stagesOf } from "@gaia/schema";
import { type Target, type Wave, assemble, planDetails, planStructure, readStructure, validate } from "./planner.ts";

/** What composes a world: the kind of each thing in it and the primitives that fill them. */
export interface Composing {
  readonly building: AnyKind;
  readonly landmark: AnyKind;
  /** The whole world's light, sky, season and wind. */
  readonly world: AnyKind;
  /** A region's land. */
  readonly biome: AnyKind;
  /** A trail between two entities. */
  readonly link: AnyKind;
  readonly lib: Library;
}

/** What a composed thing is: which of `Composing`'s kinds fills it. */
export type ComposedAs = "building" | "landmark" | "world" | "biome" | "link";

/** One thing to compose: its id (an entity's path, or `world:`, `land:` or `trail:` and what it is of), its kind, and what Jev may know about it. */
export interface Composed {
  readonly path: string;
  readonly as: ComposedAs;
  readonly state: Readonly<Record<string, unknown>>;
}

/** Composes one thing: its structure, then each stage's details, and the blueprint they make. */
export async function composeThing(c: Composing, jev: JevClient, thing: Composed): Promise<Blueprint> {
  const k = c[thing.as];
  const target: Target = { id: thing.path, state: thing.state };
  const structureWave = planStructure(k, c.lib, target);
  const structure = readStructure(k, c.lib, structureWave, await answersOf(jev, structureWave));
  const waves: Wave[] = [];
  const answers: Record<string, JevAnswer> = {};
  for (let stage = 0; stage < stagesOf(k).length; stage++) {
    // Each stage sees the parts settled in the stages before it, so the openings suit the walls they are set in.
    const earlier = waves.length === 0 ? undefined : settledParams(assemble(k, c.lib, structure, waves, answers));
    const wave = planDetails(k, c.lib, structure, target, { stage, ...(earlier === undefined ? {} : { earlier }) });
    if (Object.keys(wave.request.questions).length === 0) continue;
    Object.assign(answers, await answersOf(jev, wave));
    waves.push(wave);
  }
  const blueprint = assemble(k, c.lib, structure, waves, answers);
  const problems = validate(blueprint, k, c.lib);
  if (problems.length > 0) throw new Error(`The ${thing.as} composed for ${thing.path || "the repository's root"} does not hold together: ${problems.join(" ")}`);
  return blueprint;
}

/** Composes every thing, `concurrency` at a time, each as one thing on its own. */
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

/** How many of an entity's definitions its request names, the most important first. */
const DEFINITIONS = 8;

const share = (v: number | null | undefined): number | undefined => (v === null || v === undefined ? undefined : Math.round(v * 100) / 100);
const trim = (text: string, n: number): string => (text.length <= n ? text : `${text.slice(0, n - 1)}…`);

/**
 * What the new engine established about one part of the code, a directory or the whole repository: how much it
 * matters and each concept of its quality from the understanding pass, and its shape from the graph (files, lines,
 * languages, folders and history) and its most important definitions. Nothing from the old code model's signals.
 */
function partOf(graph: CodeGraph, path: string): Record<string, unknown> {
  const inside = (p: string): boolean => path === "" || p === path || p.startsWith(`${path}/`);
  const dir = graph.nodes.find((n): n is DirNode => n.kind === "dir" && n.path === path);
  const files = graph.nodes.filter((n): n is FileNode => n.kind === "file" && inside(n.path));
  const fileIds = new Set(files.map((f) => f.id));
  const defs = graph.nodes.filter((n): n is DefNode => n.kind === "def" && fileIds.has(n.file));
  const value = dir?.judged?.value;
  const concepts = Object.entries(value?.concepts ?? {}).flatMap(([k, v]) => (share(v) === undefined ? [] : [[k, share(v)] as const]));
  const history = dir?.measures.history;
  const important = [...defs]
    .sort((a, b) => (b.judged?.value?.importance ?? 0) - (a.judged?.value?.importance ?? 0) || a.id.localeCompare(b.id))
    .slice(0, DEFINITIONS)
    .map((d) => ({ name: d.name, role: d.role, signature: trim(d.signature, 120), ...(d.doc === undefined ? {} : { doc: trim(d.doc, 100) }), ...(share(d.judged?.value?.importance) === undefined ? {} : { importance: share(d.judged?.value?.importance) }) }));
  return {
    ...(share(value?.importance) === undefined ? {} : { importance: share(value?.importance) }),
    ...(share(value?.quality) === undefined ? {} : { quality: share(value?.quality) }),
    ...(concepts.length === 0 ? {} : { concepts: Object.fromEntries(concepts) }),
    files: files.length,
    lines: dir?.measures.lines ?? files.reduce((n, f) => n + f.measures.lines, 0),
    languages: [...new Set(files.flatMap((f) => (f.language === null ? [] : [f.language])))].sort(),
    folders: graph.nodes.filter((n) => n.kind === "dir" && n.path !== path && inside(n.path)).length,
    ...(history === undefined ? {} : { commits: history.commits, recentCommits: history.recent, authors: history.authors }),
    definitions: important,
  };
}

const named = (path: string): string => (path === "" ? "(the repository's root)" : path);

/**
 * What the new engine established about an entity, as its composing request carries it: what it is and what it
 * leans on and is leaned on by (its facts, which the world reads from the graph through `factsOf`), and what
 * `partOf` says of its directory.
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

/** What the whole world's composing request carries: the repository, as `partOf` says of its root. */
export function repositoryState(graph: CodeGraph | undefined, name: string): Record<string, unknown> {
  return { repository: { name, ...(graph === undefined ? {} : partOf(graph, "")) } };
}

/** What a region's land is composed from: the directory, as `partOf` says of it, and the water Jev judged its land holds. */
export function areaState(graph: CodeGraph | undefined, path: string, water: string | undefined): Record<string, unknown> {
  return { directory: { path: named(path), ...(graph === undefined ? {} : partOf(graph, path)), ...(water === undefined ? {} : { water }) } };
}

/**
 * What a trail is composed from: the two entities it joins, each as much as matters to walking between them, and
 * how many of the first's files import the second's, from the graph's import edges.
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

async function answersOf(jev: JevClient, wave: Wave): Promise<Readonly<Record<string, JevAnswer>>> {
  if (Object.keys(wave.request.questions).length === 0) return {};
  return (await jev.ask(wave.request)).answers;
}

/** What earlier stages settled, part by part, as the next stage's state shows it. */
function settledParams(bp: Blueprint): Record<string, Readonly<Record<string, unknown>>> {
  return Object.fromEntries(Object.entries(bp.slots).flatMap(([slot, filled]) => (Object.keys(filled.params).length === 0 ? [] : [[slot, filled.params]])));
}
