import { describe, expect, it } from "vitest";
import type { EntityFacts } from "@gaia/schema";
import { landmark, link, structure } from "@gaia/kinds";
import { entityVitalityOf } from "@gaia/world";

/** A package as the engine would describe it: the world package of this repository. */
const WORLD: EntityFacts = {
  path: "packages/world",
  name: "@gaia/world",
  form: "package",
  manifest: "packages/world/package.json",
  entry: "packages/world/src/index.ts",
  doc: "The question planner, answer rules, context gathering, vitality and the world document.",
  files: 9,
  lines: 980,
  languages: ["typescript"],
  exports: 31,
  dependsOn: ["packages/schema"],
  dependents: ["app", "packages/realize"],
  tests: { files: 4, failing: 0, covered: 0.9 },
  diagnostics: { errors: 0, warnings: 0, lint: 2 },
  debtMarkers: 1,
  unusedExports: 0.05,
  git: { daysSinceFirstCommit: 40, commitsLast14Days: 6, contributors: 2 },
};

describe("entities", () => {
  it("declines with the share of an entity's tests that fail, and says why", () => {
    const healthy = entityVitalityOf(WORLD);
    const failing = entityVitalityOf({ ...WORLD, tests: { ...WORLD.tests, failing: 2 } });
    expect(healthy.vitality).toBeGreaterThan(0.85);
    expect(failing.vitality).toBeLessThan(healthy.vitality * 0.5);
    expect(failing.terms.find((t) => t.id === "tests")?.reading).toBe("2 of 4 test files failing");
  });

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
