// "This codebase": Gaia's own world, from the engine's snapshot of this
// repository (`fixtures/gaia.json`, written by `pnpm snapshot` through the
// engine's `project.open`). Jev's judgments come from the stand-in judge
// until the reviewer approves live calls; swapping in Jev is the one line
// marked below. Everything else follows from the code: each directory's area
// and land, each file's patch and what grows on it, each entity's building or
// landmark on its lot, and the trails between entities.

import { type CodeModel, type EntityFacts, type FileFacts, type JevClient, rand, seedOf } from "@gaia/schema";
import { FLORA_PRESETS, LANDMARK_PRESETS, TRAIL_PRESETS, WORLD_PRESETS } from "@gaia/realize";
import type { WorldSpec } from "@gaia/terrain";
import { type CodeWorld, judgeWorld, layoutWorld, standInJev } from "@gaia/world";
import snapshot from "./fixtures/gaia.json";
import { LANDS, LOOKS } from "./looks.ts";
import type { SampleEntity } from "./samples.ts";
import type { StandCode, StandLot } from "./stand.ts";

/** Who judges the world. Swap in Jev here once live calls are approved: `engineJev(engine)` from the world service. */
const JEV: JevClient = standInJev(LOOKS);

export interface CodeLab {
  readonly world: CodeWorld;
  /** The terrain's regions: one per directory with land of its own. */
  readonly spec: WorldSpec;
  readonly files: ReadonlyMap<string, FileFacts>;
  /** The entities buildings stand for, each with the building Jev chose, in the order the stand sites them. */
  readonly buildings: readonly SampleEntity[];
  /** The entities landmarks stand for: which landmark preset and its facts. */
  readonly landmarks: readonly { readonly preset: number; readonly facts: EntityFacts }[];
  /** The world preset whose light, sky and air the world takes. */
  readonly sky: (typeof WORLD_PRESETS)[number] | undefined;
  /** What the bake thread needs to stand this world's things, given the request's trail styles. */
  readonly stand: StandCode;
}

/** Trees on a file's patch: more for a longer file. */
export const treesFor = (lines: number): number => Math.min(10, Math.max(1, Math.round(Math.sqrt(lines) / 3)));

/** Gaia's own world: judged, laid out and ready to bake. */
export async function codeWorld(model: CodeModel = snapshot as unknown as CodeModel): Promise<CodeLab> {
  const world = layoutWorld(model, await judgeWorld(model, LOOKS, JEV));
  const fallback = Object.values(LANDS)[0]?.biome;
  if (fallback === undefined) throw new Error("No lands to choose from.");
  const spec: WorldSpec = {
    size: world.size,
    regions: world.regions.map((r) => ({
      id: r.area === "" ? world.name : r.area,
      x: r.x,
      z: r.z,
      base: rand(seedOf(`base:${r.area}`)).range(-2, 2),
      reach: r.reach,
      biome: LANDS[r.land]?.biome ?? fallback,
    })),
  };
  const entities = new Map(model.entities.map((e) => [e.path, e]));
  const lot = (t: CodeWorld["things"][number]): StandLot => ({ id: t.path, x: t.x, z: t.z, radius: t.lot * 0.6 });
  const houses = world.things.filter((t) => t.as === "building");
  const rises = world.things.filter((t) => t.as === "landmark");
  const landmarkIndex = (name: string): number => Math.max(0, LANDMARK_PRESETS.findIndex((p) => p.name === name));
  return {
    world,
    spec,
    files: new Map(model.files.map((f) => [f.path, f])),
    buildings: houses.map((t) => ({ facts: entities.get(t.path) as EntityFacts, building: t.look })),
    landmarks: rises.map((t) => ({ preset: landmarkIndex(t.look), facts: entities.get(t.path) as EntityFacts })),
    sky: WORLD_PRESETS.find((p) => p.name === world.world) ?? WORLD_PRESETS[0],
    stand: {
      lots: houses.map(lot),
      landmarks: rises.map((t) => ({ landmark: landmarkIndex(t.look), lot: lot(t) })),
      patches: world.patches.map((p) => {
        const preset = FLORA_PRESETS.findIndex((f) => f.name === p.vibe);
        return { x: p.x, z: p.z, radius: p.radius, preset, trees: preset < 0 ? 0 : treesFor(p.lines) };
      }),
      trails: world.trails.map((t) => ({ from: t.from, to: t.to, want: t.want, style: Math.max(0, TRAIL_PRESETS.findIndex((p) => p.name === t.look)) })),
    },
  };
}
