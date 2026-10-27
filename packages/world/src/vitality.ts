// Vitality pooled over the land. A thing's own vitality is Jev's quality from
// the understanding pass (`layoutWorld`); a folder's, as the field map and the
// minimap wash it, pools its files' by the ground each holds. A world's things
// take a new vitality in place (`withVitality`), as when its code moves on
// while it stands, and nothing else about them changes.

import type { CodeWorld } from "./code-world.ts";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** A file as a part of the land: the directory it lies in, its vitality, and its size (its lines, or the ground its patch holds). */
export interface VitalPart {
  readonly area: string;
  readonly vitality: number;
  readonly size: number;
}

/**
 * The vitality of a whole made of parts: their vitality weighted by size, so
 * a large tired file weighs more than a small thriving one and the whole
 * reads as the share of it that thrives. A whole with nothing in it is 1.
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
 * Every directory's vitality, by its path ("" for the whole world): its
 * files' and its subdirectories' files' vitality, pooled by size
 * (`pooledVitality`). A directory with no files of its own or below it is
 * absent.
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
 * Every directory's own ground's vitality, by its path: the files directly
 * in it, pooled by size; a directory with no files of its own takes all of
 * its subdirectories' (`areaVitality`). What a map washes each area's own
 * ground with.
 */
export function groundVitality(parts: readonly VitalPart[]): ReadonlyMap<string, number> {
  const whole = areaVitality(parts);
  const own = new Map<string, VitalPart[]>();
  for (const p of parts) own.set(p.area, [...(own.get(p.area) ?? []), p]);
  return new Map([...whole].map(([path, v]) => [path, own.has(path) ? pooledVitality(own.get(path) ?? []) : v]));
}

/**
 * Every thing's own vitality in a world, by what it stands for: a file's path,
 * a definition's id (`<file>#<name>`) and an entity's root path. A file's
 * patch, its building or landmark and what it stands as share its vitality,
 * as a definition's do.
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
 * The same world with each thing in `changes` at its new vitality, by what it
 * stands for (as `vitalityOf` names it), everywhere it shows: its patch, its
 * building or landmark, what it stands as and its definitions' own slots.
 * Nothing moves, and every form stays.
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

/** Where a definition's code lies in its file: its first line and how many it spans. */
export interface DefinitionLines {
  readonly line: number;
  readonly lines: number;
}

/**
 * The same world with each definition in `moved` on its new lines of its
 * file, by its id, so the journal reads its code where it now lies. Nothing
 * moves on the land.
 */
export function withLines(world: CodeWorld, moved: Readonly<Record<string, DefinitionLines>>): CodeWorld {
  return { ...world, symbols: world.symbols.map((s) => (moved[s.id] === undefined ? s : { ...s, ...moved[s.id] })) };
}
