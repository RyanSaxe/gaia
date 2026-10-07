// Sample worlds for the lab and tests: named regions with chosen landforms,
// and uniform random draws over every Relief primitive's declared fields.

import { type FilledSlot, type Library, type PrimitiveId, blueprintOf, rand } from "@gaia/schema";
import { layoutSites } from "./layout.ts";
import type { WorldSpec } from "./world.ts";

export const WORLD_SIZE = 320;
const NAMES = ["src/core", "src/ui", "docs", "tests", "tools"];

/** A biome blueprint with the given relief and ground cover; natives empty means every palette family. */
const biome = (use: string, params: FilledSlot["params"], cover = "lush grass") =>
  blueprintOf("biome", {
    relief: { use: use as PrimitiveId, params },
    cover: { use: "ground-cover@1", params: { cover, length: "natural", wildflowers: "a scattering" } },
    natives: { use: "native-families@1", params: { families: [] } },
  });

const COVERS = ["lush grass", "clover meadow", "silver grass", "moss", "heather", "golden steppe", "sand and scrub"];

/** A hand-filled world: the stored words, as Jev would have answered them. */
export function sampleWorld(): WorldSpec {
  const sites = layoutSites(11, 5, WORLD_SIZE);
  const biomes = [
    biome("valley@1", { depth: "moderate", width: "open", run: "north-south", fall: "gentle", meander: "winding", stream: "brook" }, "lush grass"),
    biome("rolling-hills@1", { height: "rolling", breadth: "moderately spaced", roughness: "softly uneven", grain: "round" }, "clover meadow"),
    biome("terraces@1", { form: "terraced hill", rise: "waist-high", climb: "a hillside", facing: "south", edge: "soft and grassy" }, "silver grass"),
    biome("basin@1", { depth: "a bowl", size: "medium", rim: "a soft rim", pond: true }, "moss"),
    biome("meadow@1", { undulation: "softly undulating", tilt: "slightly tilted", facing: "east" }, "heather"),
  ];
  return {
    size: WORLD_SIZE,
    regions: sites.map((s, i) => ({ id: NAMES[i] ?? `region-${i}`, ...s, biome: biomes[i] ?? biomes[0]! })),
  };
}

const pick = <T>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length)] as T;

/** Uniform over every Relief primitive and each of its fields; 3 to 5 regions. */
export function randomWorld(lib: Library, seed: number): WorldSpec {
  const r = rand(seed);
  const random = (): number => r.next();
  const count = 3 + Math.floor(random() * 3);
  const sites = layoutSites(Math.floor(random() * 2 ** 31), count, WORLD_SIZE);
  const reliefs = lib.forRole("Relief");
  return {
    size: WORLD_SIZE,
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
