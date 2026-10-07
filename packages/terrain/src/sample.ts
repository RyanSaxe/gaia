// Sample worlds for the lab and tests: named regions with chosen landforms,
// and uniform random draws over every Relief primitive's declared fields, at
// either of two scales.

import { type FilledSlot, type Library, type PrimitiveId, blueprintOf, rand } from "@gaia/schema";
import { layoutSites } from "./layout.ts";
import type { WorldSpec } from "./world.ts";

/** How big a world is: the side of its walkable square, meters, and how many regions it holds, fewest and most. */
export interface WorldScale {
  readonly size: number;
  readonly regions: readonly [number, number];
}

/** A small world of a few regions, quick to bake: the one the tests walk. */
export const SMALL_WORLD: WorldScale = { size: 320, regions: [3, 5] };
/** A full world to wander: 1.2 km across with a score of regions, each a little wider than a small world's. */
export const FULL_WORLD: WorldScale = { size: 1200, regions: [18, 22] };
export const WORLD_SIZE = SMALL_WORLD.size;

const NAMES = [
  "src/core", "src/ui", "docs", "tests", "tools", "src/render", "src/world", "packages/schema", "packages/kinds", "scripts",
  "src/io", "src/net", "assets", "examples", "bench", "src/store", "src/jobs", "vendor", "config", "src/auth", "src/cli", "migrations",
];

/** A biome blueprint with the given relief and ground cover; natives empty means every palette family. */
const biome = (use: string, params: FilledSlot["params"], cover = "lush grass") =>
  blueprintOf("biome", {
    relief: { use: use as PrimitiveId, params },
    cover: { use: "ground-cover@1", params: { cover, length: "natural", wildflowers: "a scattering" } },
    natives: { use: "native-families@1", params: { families: [] } },
  });

const COVERS = ["lush grass", "clover meadow", "silver grass", "moss", "heather", "golden steppe", "sand and scrub"];

/** The stored words, as Jev would have answered them: the small world's five, then the full world's others. */
const SAMPLE_BIOMES = [
  biome("valley@1", { depth: "moderate", width: "open", run: "north-south", fall: "gentle", meander: "winding", stream: "brook" }, "lush grass"),
  biome("rolling-hills@1", { height: "rolling", breadth: "moderately spaced", roughness: "softly uneven", grain: "round" }, "clover meadow"),
  biome("terraces@1", { form: "terraced hill", rise: "waist-high", climb: "a hillside", facing: "south", edge: "soft and grassy" }, "silver grass"),
  biome("basin@1", { depth: "a bowl", size: "medium", rim: "a soft rim", pond: true }, "moss"),
  biome("meadow@1", { undulation: "softly undulating", tilt: "slightly tilted", facing: "east" }, "heather"),
  biome("valley@1", { depth: "shallow", width: "broad", run: "east-west", fall: "nearly level", meander: "strongly meandering", stream: "trickle" }, "clover meadow"),
  biome("dunes@1", { height: "low dunes", spacing: "even", wind: "from the west", wander: "wavering" }, "golden steppe"),
  biome("basin@1", { depth: "a shallow dip", size: "wide", rim: "melting into the land", pond: true }, "lush grass"),
  biome("rolling-hills@1", { height: "gentle", breadth: "broad and sweeping", roughness: "smooth", grain: "diagonal" }, "silver grass"),
  biome("terraces@1", { form: "hillside", rise: "knee-high", climb: "a low rise", facing: "east", edge: "soft and grassy" }, "lush grass"),
  biome("meadow@1", { undulation: "gently uneven", tilt: "level", facing: "north" }, "clover meadow"),
  biome("valley@1", { depth: "moderate", width: "narrow", run: "northeast-southwest", fall: "steady", meander: "winding", stream: "brook" }, "moss"),
  biome("rolling-hills@1", { height: "barely rolling", breadth: "close and lumpy", roughness: "softly uneven", grain: "north-south" }, "heather"),
  biome("basin@1", { depth: "a bowl", size: "small", rim: "a raised rim", pond: true }, "clover meadow"),
  biome("dunes@1", { height: "ripples", spacing: "wide", wind: "from the north", wander: "broken" }, "sand and scrub"),
  biome("meadow@1", { undulation: "flat as a lawn", tilt: "slightly tilted", facing: "south" }, "lush grass"),
  biome("valley@1", { depth: "shallow", width: "open", run: "northwest-southeast", fall: "gentle", meander: "straight", stream: "trickle" }, "silver grass"),
  biome("terraces@1", { form: "terraced hill", rise: "knee-high", climb: "a low rise", facing: "west", edge: "crisp" }, "golden steppe"),
  biome("rolling-hills@1", { height: "rolling", breadth: "broad and sweeping", roughness: "rugged", grain: "east-west" }, "lush grass"),
  biome("basin@1", { depth: "a deep hollow", size: "medium", rim: "a soft rim", pond: true }, "moss"),
  biome("meadow@1", { undulation: "softly undulating", tilt: "tilted", facing: "west" }, "golden steppe"),
  biome("rolling-hills@1", { height: "gentle", breadth: "moderately spaced", roughness: "smooth", grain: "round" }, "clover meadow"),
];

/** A hand-filled world: the stored words, as Jev would have answered them. As many regions as the scale holds at most. */
export function sampleWorld(scale: WorldScale = SMALL_WORLD): WorldSpec {
  const count = scale.regions[1];
  const sites = layoutSites(11, count, scale.size);
  return {
    size: scale.size,
    regions: sites.map((s, i) => ({ id: NAMES[i] ?? `region-${i}`, ...s, biome: SAMPLE_BIOMES[i % SAMPLE_BIOMES.length]! })),
  };
}

const pick = <T>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length)] as T;

/** Uniform over every Relief primitive and each of its fields, with as many regions as the scale allows. */
export function randomWorld(lib: Library, seed: number, scale: WorldScale = SMALL_WORLD): WorldSpec {
  const r = rand(seed);
  const random = (): number => r.next();
  const [fewest, most] = scale.regions;
  const count = fewest + Math.floor(random() * (most - fewest + 1));
  const sites = layoutSites(Math.floor(random() * 2 ** 31), count, scale.size);
  const reliefs = lib.forRole("Relief");
  return {
    size: scale.size,
    regions: sites.map((s, i) => {
      const p = pick(reliefs, random);
      const params: Record<string, string | boolean | string[]> = {};
      for (const [name, f] of Object.entries(p.params)) {
        if (f.type === "scale") params[name] = pick(f.levels, random).words;
        else if (f.type === "choice") params[name] = pick(Object.keys(f.options), random);
        else if (f.type === "flag") params[name] = random() < 0.5;
        else params[name] = Object.keys(f.members).filter(() => random() < 0.5);
      }
      return { id: NAMES[i] ?? `region-${i}`, ...s, biome: biome(p.id, params, pick(COVERS, random)) };
    }),
  };
}
