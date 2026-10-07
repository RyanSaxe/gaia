// Sample worlds for the lab and tests: named regions with chosen landforms,
// and uniform random draws over every Relief primitive's declared fields.

import { type FilledSlot, type Library, type PrimitiveId, blueprintOf, rand } from "@gaia/schema";
import { layoutSites } from "./layout.ts";
import type { WorldSpec } from "./world.ts";

export const WORLD_SIZE = 320;
const NAMES = ["src/core", "src/ui", "docs", "tests", "tools"];

const ground = (use: string, params: FilledSlot["params"]) => blueprintOf("ground", { relief: { use: use as PrimitiveId, params } });

/** A hand-filled world: the stored words, as Jev would have answered them. */
export function sampleWorld(): WorldSpec {
  const sites = layoutSites(11, 5, WORLD_SIZE);
  const grounds = [
    ground("valley@1", { depth: "moderate", width: "open", run: "north-south", fall: "gentle", meander: "winding", stream: "brook" }),
    ground("rolling-hills@1", { height: "rolling", breadth: "moderately spaced", roughness: "softly uneven", grain: "round" }),
    ground("terraces@1", { form: "terraced hill", rise: "waist-high", climb: "a hillside", facing: "south", edge: "soft and grassy" }),
    ground("basin@1", { depth: "a bowl", size: "medium", rim: "a soft rim", pond: true }),
    ground("meadow@1", { undulation: "softly undulating", tilt: "slightly tilted", facing: "east" }),
  ];
  return {
    size: WORLD_SIZE,
    regions: sites.map((s, i) => ({ id: NAMES[i] ?? `region-${i}`, ...s, ground: grounds[i] ?? grounds[0]! })),
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
      return { id: NAMES[i] ?? `region-${i}`, ...s, ground: ground(p.id, params) };
    }),
  };
}
