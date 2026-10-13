// Composing a world's buildings and landmarks: each is filled part by part
// through the planner, its structure first, then each stage's details, one
// request a wave, with what was settled before in the next wave's state. Jev
// never names a preset: every blueprint is the parts and settings it chose.

import { type AnyKind, type Blueprint, type CodeGraph, type DefNode, type DirNode, type EntityFacts, type FileNode, type JevAnswer, type JevClient, type Library, stagesOf } from "@gaia/schema";
import { type Target, type Wave, assemble, planDetails, planStructure, readStructure, validate } from "./planner.ts";

/** What composes a world's buildings and landmarks: their kinds and the primitives that fill them. */
export interface Composing {
  readonly building: AnyKind;
  readonly landmark: AnyKind;
  readonly lib: Library;
}

/** One entity to compose: its path, what it stands as, and what Jev may know about it. */
export interface Composed {
  readonly path: string;
  readonly as: "building" | "landmark";
  readonly state: Readonly<Record<string, unknown>>;
}

/** Composes one thing: its structure, then each stage's details, and the blueprint they make. */
export async function composeThing(c: Composing, jev: JevClient, thing: Composed): Promise<Blueprint> {
  const k = thing.as === "building" ? c.building : c.landmark;
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
  if (problems.length > 0) throw new Error(`The ${thing.as} for ${thing.path || "the repository's root"} does not hold together: ${problems.join(" ")}`);
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
 * What the new engine established about an entity, as its composing request carries it: what it is and what it
 * leans on and is leaned on by (its facts, which the world reads from the graph through `factsOf`), how much it
 * matters and each concept of its quality from the understanding pass, its shape from the graph (files, lines,
 * languages, folders and history) and its most important definitions. Nothing from the old code model's signals.
 */
export function composingState(graph: CodeGraph | undefined, entity: Pick<EntityFacts, "path" | "name"> & Partial<EntityFacts>): Record<string, unknown> {
  const path = entity.path;
  const about: Record<string, unknown> = {
    name: entity.name,
    path: path === "" ? "(the repository's root)" : path,
    ...(entity.form === undefined ? {} : { form: entity.form }),
    ...(entity.exports === undefined ? {} : { exports: entity.exports }),
    ...(entity.dependsOn === undefined ? {} : { dependsOn: entity.dependsOn.map((d) => (d === "" ? "(the repository's root)" : d)) }),
    ...(entity.dependents === undefined ? {} : { dependedOnBy: entity.dependents.length }),
  };
  if (graph === undefined) return { entity: about };
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
    entity: {
      ...about,
      ...(share(value?.importance) === undefined ? {} : { importance: share(value?.importance) }),
      ...(share(value?.quality) === undefined ? {} : { quality: share(value?.quality) }),
      ...(concepts.length === 0 ? {} : { concepts: Object.fromEntries(concepts) }),
      files: files.length,
      lines: dir?.measures.lines ?? files.reduce((n, f) => n + f.measures.lines, 0),
      languages: [...new Set(files.flatMap((f) => (f.language === null ? [] : [f.language])))].sort(),
      folders: graph.nodes.filter((n) => n.kind === "dir" && n.path !== path && inside(n.path)).length,
      ...(history === undefined ? {} : { commits: history.commits, recentCommits: history.recent, authors: history.authors }),
      definitions: important,
    },
  };
}

async function answersOf(jev: JevClient, wave: Wave): Promise<Readonly<Record<string, JevAnswer>>> {
  if (Object.keys(wave.request.questions).length === 0) return {};
  return (await jev.ask(wave.request)).answers;
}

/** What earlier stages settled, part by part, as the next stage's state shows it. */
function settledParams(bp: Blueprint): Record<string, Readonly<Record<string, unknown>>> {
  return Object.fromEntries(Object.entries(bp.slots).flatMap(([slot, filled]) => (Object.keys(filled.params).length === 0 ? [] : [[slot, filled.params]])));
}
