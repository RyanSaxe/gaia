// Pools vitality over the land. `layoutWorld` sets a thing's own vitality to
// Jev's quality from the understanding pass. A folder's vitality, which the
// field map and minimap shade with, pools its files' vitality weighted by size.
// `withVitality` updates vitality when the code changes while a world is open,
// and changes nothing else.

import type { CodeWorld } from "./code-world.ts";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** A file as input to pooling: its directory, its vitality, and its size in lines or in square meters of patch. */
export interface VitalPart {
  readonly area: string;
  readonly vitality: number;
  readonly size: number;
}

/**
 * The size-weighted mean of the parts' vitality, each clamped to 0 to 1. A
 * large file at vitality 0.3 outweighs a small one at 0.9. Parts with a total
 * size of 0 give 1.
 */
export function pooledVitality(parts: Iterable<Pick<VitalPart, "vitality" | "size">>): number {
  let sum = 0;
  let weight = 0;
  for (const p of parts) {
    const w = Math.max(0, p.size);
    sum += clamp01(p.vitality) * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : 1;
}

/**
 * Each directory's vitality by path, with "" for the whole world. It pools
 * every file at or below the directory by size, as `pooledVitality` does. A
 * directory with no files at or below it is absent.
 */
export function areaVitality(parts: readonly VitalPart[]): ReadonlyMap<string, number> {
  const sums = new Map<string, { sum: number; weight: number }>();
  for (const p of parts) {
    const w = Math.max(0, p.size);
    const dirs = p.area.split("/").filter(Boolean);
    for (let k = 0; k <= dirs.length; k++) {
      const path = dirs.slice(0, k).join("/");
      const s = sums.get(path) ?? { sum: 0, weight: 0 };
      s.sum += clamp01(p.vitality) * w;
      s.weight += w;
      sums.set(path, s);
    }
  }
  return new Map([...sums].map(([path, s]) => [path, s.weight > 0 ? s.sum / s.weight : 1]));
}

/**
 * The vitality of each directory's own ground by path, pooled from the files
 * directly in it. A directory with no files of its own uses its
 * `areaVitality`. Maps shade each area's own ground with this value.
 */
export function groundVitality(parts: readonly VitalPart[]): ReadonlyMap<string, number> {
  const whole = areaVitality(parts);
  const own = new Map<string, VitalPart[]>();
  for (const p of parts) own.set(p.area, [...(own.get(p.area) ?? []), p]);
  return new Map([...whole].map(([path, v]) => [path, own.has(path) ? pooledVitality(own.get(path) ?? []) : v]));
}

/**
 * Each thing's own vitality, keyed by a file's path, a definition's id
 * `<file>#<name>` or an entity's root path. A file's patch, its building or
 * landmark and its small form share one key, and so do a definition's.
 */
export function vitalityOf(world: CodeWorld): Map<string, number> {
  return new Map([
    ...world.patches.map((p) => [p.path, p.vitality] as const),
    ...world.symbols.map((s) => [s.id, s.vitality] as const),
    ...world.things.map((t) => [t.path, t.vitality] as const),
    ...world.standing.map((s) => [s.path, s.vitality] as const),
  ]);
}

/**
 * Returns the world with the new vitality for each id in `changes`, keyed as
 * in `vitalityOf`. It updates every place the id appears: the patch, the
 * building or landmark, the small form and the definition's symbol. No
 * position or form changes.
 */
export function withVitality(world: CodeWorld, changes: ReadonlyMap<string, number>): CodeWorld {
  const changed = <T extends { readonly vitality: number }>(id: string, of: T): T => {
    const vitality = changes.get(id);
    return vitality === undefined ? of : { ...of, vitality };
  };
  return {
    ...world,
    patches: world.patches.map((p) => changed(p.path, p)),
    symbols: world.symbols.map((s) => changed(s.id, s)),
    things: world.things.map((t) => changed(t.path, t)),
    standing: world.standing.map((s) => changed(s.path, s)),
  };
}

/** A definition's first line in its file and how many lines it spans. */
export interface DefinitionLines {
  readonly line: number;
  readonly lines: number;
}

/**
 * Returns the world with each definition in `moved` at its new lines, by id,
 * so the journal shows the right code. Nothing moves on the land.
 */
export function withLines(world: CodeWorld, moved: Readonly<Record<string, DefinitionLines>>): CodeWorld {
  return { ...world, symbols: world.symbols.map((s) => (moved[s.id] === undefined ? s : { ...s, ...moved[s.id] })) };
}
