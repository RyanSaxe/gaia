import { describe, expect, it } from "vitest";
import type { EntityFacts, ThingFacts } from "@gaia/schema";
import { landmark, link, structure } from "@gaia/kinds";

/** A package as the engine would describe it: the world package of this repository. */
const WORLD: EntityFacts = {
  path: "packages/world",
  name: "@gaia/world",
  form: "package",
  manifest: "packages/world/package.json",
  entry: "packages/world/src/index.ts",
  files: 9,
  lines: 980,
  exports: 31,
  dependsOn: ["packages/schema"],
  dependents: ["app", "packages/realize"],
};

describe("entities", () => {
  it("sizes a building from what it stands for, an entity or any other thing: larger with more code, taller with more depending on it", () => {
    const bind = (e: ThingFacts) => Object.fromEntries(Object.entries(structure.facts).map(([k, f]) => [k, f(e)]));
    const small = bind(WORLD);
    const large = bind({ ...WORLD, lines: 40_000, exports: 120, dependents: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] });
    // A building and a landmark stand for any thing: an entity, a file or a definition, each read by the same numbers.
    expect(structure.subject).toBe("thing");
    const definition = bind({ path: "packages/world/src/code-world.ts#layoutWorld", name: "layoutWorld", lines: 127, exports: 1, dependents: ["a", "b"] });
    expect(definition.size).toBeGreaterThan(0);
    expect(large.size).toBeGreaterThan(small.size as number);
    expect(large.floors).toBeGreaterThan(small.floors as number);
    expect(large.reach).toBe(1);
    expect(small.reach).toBeLessThan(0.5);
  });

  it("stands landmarks for any thing and trails between entities: a landmark rises with what depends on it, a trail joins two", () => {
    expect([landmark.subject, link.subject]).toEqual(["thing", "link"]);
    const lone = landmark.facts.scale?.(WORLD) as number;
    const leaned = landmark.facts.scale?.({ ...WORLD, dependents: Array.from({ length: 12 }, (_, i) => `p${i}`) }) as number;
    expect(leaned).toBeGreaterThan(lone);
  });
});
