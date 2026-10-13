import { describe, expect, it } from "vitest";
import type { EntityFacts } from "@gaia/schema";
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
  it("sizes a building from its entity: larger with more code, taller with more depending on it", () => {
    const bind = (e: EntityFacts) => Object.fromEntries(Object.entries(structure.facts).map(([k, f]) => [k, f(e)]));
    const small = bind(WORLD);
    const large = bind({ ...WORLD, lines: 40_000, exports: 120, dependents: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] });
    expect(structure.subject).toBe("entity");
    expect(large.size).toBeGreaterThan(small.size as number);
    expect(large.floors).toBeGreaterThan(small.floors as number);
    expect(large.reach).toBe(1);
    expect(small.reach).toBeLessThan(0.5);
  });

  it("stands landmarks and trails for entities: a landmark rises with what depends on it, a trail joins two", () => {
    expect([landmark.subject, link.subject]).toEqual(["entity", "link"]);
    const lone = landmark.facts.scale?.(WORLD) as number;
    const leaned = landmark.facts.scale?.({ ...WORLD, dependents: Array.from({ length: 12 }, (_, i) => `p${i}`) }) as number;
    expect(leaned).toBeGreaterThan(lone);
    const busy = link.facts.traffic?.({ from: WORLD, to: { ...WORLD, path: "packages/schema" }, importers: 9 }) as number;
    const quiet = link.facts.traffic?.({ from: WORLD, to: { ...WORLD, path: "packages/schema" }, importers: 1 }) as number;
    expect(busy).toBeGreaterThan(quiet);
    expect(busy).toBeLessThanOrEqual(1);
  });
});
