// "This codebase": Gaia's own world, from the engine's snapshot of this
// repository (`fixtures/gaia.json`, written by `pnpm snapshot` through the
// engine's `project.open`). Jev's judgments come from the stand-in judge
// until the reviewer approves live calls; swapping in Jev is the one line
// marked below. Everything else follows from the code: each directory's area
// and land, each file's patch and what grows on it, each entity's building or
// landmark on its lot, and the trails between entities.

import { type Blueprint, type CodeModel, type EntityFacts, type FileFacts, type JevClient, type SymbolFact, rand, seedOf } from "@gaia/schema";
import { FLORA_PRESETS, LANDMARK_PRESETS, TRAIL_PRESETS, WORLD_PRESETS } from "@gaia/realize";
import { type WorldSpec, outlinesOf } from "@gaia/terrain";
import { type CodeWorld, judgeWorld, layoutWorld, standInJev } from "@gaia/world";
import snapshot from "./fixtures/gaia.json";
import { FORMS, LANDS, LOOKS } from "./looks.ts";
import type { Represented, SampleEntity } from "./samples.ts";
import { vitalityOf } from "@gaia/world";
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

/**
 * A region's land with its water as Jev chose it: a brook or a trickle runs
 * along a valley's floor, a pond fills a basin, and an area with water whose
 * landform holds none takes the valley or the basin that can, in its own
 * cover. The water's words say why it is there.
 */
export function withWater(biome: Blueprint, water: string): Blueprint {
  const relief = biome.slots.relief;
  const cover = biome.slots.cover;
  if (relief === undefined) return biome;
  const stream = water === "A brook" ? "brook" : water === "A trickle" ? "trickle" : "dry bed";
  const pond = water === "A still pond";
  const swap = (use: string, params: Record<string, string | boolean>): Blueprint => ({ ...biome, slots: { ...biome.slots, relief: { use: use as typeof relief.use, params } } });
  if (relief.use === "valley@1") return pond ? swap("basin@1", { depth: "a shallow dip", size: "wide", rim: "melting into the land", pond: true }) : swap("valley@1", { ...relief.params, stream } as Record<string, string>);
  if (relief.use === "basin@1") return stream !== "dry bed" ? swap("valley@1", { depth: "shallow", width: "broad", run: "east-west", fall: "gentle", meander: "winding", stream }) : swap("basin@1", { ...relief.params, pond } as Record<string, string | boolean>);
  if (stream !== "dry bed") return swap("valley@1", { depth: "shallow", width: "broad", run: "north-south", fall: "gentle", meander: "winding", stream });
  if (pond) return swap("basin@1", { depth: "a shallow dip", size: "wide", rim: "melting into the land", pond: true });
  void cover;
  return biome;
}

const KIND_NAMES: Readonly<Record<SymbolFact["kind"], string>> = { function: "Function", class: "Class", type: "Type", constant: "Constant", module: "Module" };
const LANGUAGE_NAMES: Readonly<Record<string, string>> = { typescript: "TypeScript", javascript: "JavaScript", rust: "Rust" };

/** What a card says about a file's finer entity: its name, kind, doc comment, where it is declared and its file's health. */
export function representSymbol(s: CodeWorld["symbols"][number], file: FileFacts): Represented {
  return {
    id: s.id,
    name: s.name,
    what: [KIND_NAMES[s.kind], s.exported ? "exported" : "inside its file", LANGUAGE_NAMES[file.language] ?? file.language].join(" · "),
    doc: s.doc ?? "",
    where: `${s.file}:${s.line}`,
    size: `${s.lines.toLocaleString()} ${s.lines === 1 ? "line" : "lines"} of ${file.lines.toLocaleString()} in its file`,
    dependsOn: [],
    dependents: [],
    report: vitalityOf(file),
  };
}

/** A symbol's size where it stands: larger for a longer one, within what its blueprint looks right at. */
export const symbolScale = (lines: SymbolFact["lines"], rule: string): number => {
  const t = Math.min(1, Math.log2(1 + (lines ?? 1)) / 8);
  return rule === "rocks" ? 0.45 + 0.75 * t : rule === "shrubs" ? 0.6 + 0.6 * t : 0.8 + 0.4 * t;
};

/** Trees on a file's patch: more for a longer file. */
export const treesFor = (lines: number): number => Math.min(6, Math.max(1, Math.round(Math.sqrt(lines) / 5)));

/** Gaia's own world: judged, laid out and ready to bake. */
export async function codeWorld(model: CodeModel = snapshot as unknown as CodeModel): Promise<CodeLab> {
  const world = layoutWorld(model, await judgeWorld(model, LOOKS, JEV));
  // Traced once now, while the world loads, so the field map never traces them mid-walk.
  outlinesOf(world);
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
      sites: r.sites,
      biome: withWater(LANDS[r.land]?.biome ?? fallback, r.water),
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
      cells: (() => {
        const patchOf = new Map(world.patches.map((p, i) => [p.path, i]));
        return world.cells.map((c) => ({ x: c.x, z: c.z, patch: c.file === null || c.file === undefined ? -1 : (patchOf.get(c.file) ?? -1) }));
      })(),
      symbols: world.symbols.map((s) => {
        const form = FORMS[s.form] ?? (Object.values(FORMS)[0] as (typeof FORMS)[string]);
        const variant = form.preset;
        return { x: s.x, z: s.z, rule: form.rule, variant, radius: form.rule === "flowers" ? 0.8 : 1, scale: symbolScale(s.lines, form.rule), vitality: s.vitality };
      }),
      // Trails joining parts of the code no other trail joins route first, then the most wanted.
      trails: world.trails.map((t) => ({ from: t.from, to: t.to, want: (t.spans === true ? 1 : 0) + t.want, style: Math.max(0, TRAIL_PRESETS.findIndex((p) => p.name === t.look)) })),
    },
  };
}
