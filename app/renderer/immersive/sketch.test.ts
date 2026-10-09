import { FLOWER_PRESETS, LANDMARK_PRESETS, ROCK_PRESETS, SHRUB_PRESETS, STRUCTURE_PRESETS } from "@gaia/realize";
import { describe, expect, it } from "vitest";
import type { CardThing } from "../terrain/lab.ts";
import { describe as pageOf, type SketchKind, sketchKindOf } from "./sketch.ts";

/** What each thing stands as in the world, as the terrain lab names it. */
const standsAs = (name: string): string => `A ${name.toLowerCase()}`;
/** The names among `presets` whose sketch is not one of `kinds`. */
const unfitting = (presets: readonly { readonly name: string }[], kinds: readonly SketchKind[]): string[] =>
  presets.map((p) => p.name).filter((name) => !kinds.includes(sketchKindOf(standsAs(name)) as SketchKind));

describe("a thing's sketch", () => {
  it("draws every building, landmark, shrub, stone and flower that can stand for code as a thing of its own kind", () => {
    expect(unfitting(STRUCTURE_PRESETS, ["house", "mill", "tower"])).toEqual([]);
    expect(unfitting(LANDMARK_PRESETS, ["tree", "willow", "tower", "keep", "lantern", "ring", "stone", "stones"])).toEqual([]);
    expect(unfitting(SHRUB_PRESETS, ["bush", "feather"])).toEqual([]);
    expect(unfitting(ROCK_PRESETS, ["stone", "boulder", "stones"])).toEqual([]);
    expect(unfitting(FLOWER_PRESETS, ["flowers"])).toEqual([]);
    expect(sketchKindOf("A tree")).toBe("tree");
  });

  it("draws a stone ring as a ring rather than one stone, a keep as a keep rather than a bush, and lupines as flowers rather than a pine", () => {
    expect(sketchKindOf("A stone ring")).toBe("ring");
    expect(sketchKindOf("A battlemented keep")).toBe("keep");
    expect(sketchKindOf("A lupines")).toBe("flowers");
  });
});

/** A watermill whose vitality's terms carry these penalties, each with its reading. */
function mill(penalties: Readonly<Record<string, readonly [number, string]>>): CardThing {
  const weights: Readonly<Record<string, number>> = { tests: 0.8, errors: 0.7, untested: 0.35, lint: 0.15, unused: 0.15, debt: 0.15 };
  const terms = Object.entries(weights).map(([id, weight]) => {
    const [penalty, reading] = penalties[id] ?? [0, "nothing"];
    return { id, label: id, weight, penalty, reading };
  });
  return {
    represented: {
      id: "pipes/mill",
      name: "mill",
      what: "Package · TypeScript",
      doc: "Turns `facts` into worlds. It runs in a worker.",
      where: "pipes/mill",
      size: "6 files · 2,360 lines",
      dependsOn: ["hollow"],
      dependents: [],
      report: { vitality: terms.reduce((v, t) => v * (1 - t.weight * t.penalty), 1), terms },
    },
    standsAs: "A watermill",
    judge: "stand-in",
  };
}

describe("what a thing's page says", () => {
  it("puts no note on the sketch of a thing with nothing particular wrong, and its rest still says what it is and where it lives", () => {
    const page = pageOf(mill({ lint: [0.1, "1 warning"] }));
    expect(page.notes).toEqual([]);
    expect(page.rest[0]).toEqual({ value: "Turns facts into worlds." });
    expect(page.rest.find((e) => e.label === "Lives in")?.value).toBe("pipes/mill");
    expect(page.rest.find((e) => e.label === "Leans on")?.value).toBe("hollow");
    expect(page.rest.some((e) => e.label === "Leaned on by")).toBe(false);
  });

  it("notes a failing thing's two strongest troubles on the parts that show them, and lists every reading that lowers its health in the rest, strongest first", () => {
    const page = pageOf(mill({ errors: [1, "3 errors"], tests: [0.5, "1 of 2 test files failing"], lint: [1, "16 warnings"] }));
    expect(page.notes.map((n) => n.part)).toEqual(["walls", "roof"]);
    expect(page.rest.find((e) => e.label === "Lowers its health")?.value.split("\n")).toEqual(["3 errors", "1 of 2 test files failing", "16 warnings"]);
  });
});
