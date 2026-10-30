// Checks that moss moves with the fallen log it grows on as the log splits and sinks.

import { describe, expect, it } from "vitest";
import { type Built, type Part, rand } from "@gaia/schema";
import { fallenLog, moss } from "@gaia/primitives";
import { applyVitality } from "@gaia/realize";

const log = (ends: "sawn" | "broken" | "one of each"): Built =>
  fallenLog.build({ length: 3, girth: 0.25, ends, boughs: 2, bark: 0.4 }, { rand: rand(7), facts: { scale: 1 } }, null);
const partOf = (b: Built, swatch: string): Part => {
  const part = b.parts.find((p) => p.swatch === swatch);
  if (part === undefined) throw new Error(`no ${swatch}`);
  return part;
};
const highest = (positions: Float32Array): number => positions.filter((_, i) => i % 3 === 1).reduce((m, y) => Math.max(m, y), -Infinity);

describe("fallen log", () => {
  it("carries its moss as it splits and sinks", () => {
    const body = log("one of each");
    const skin = partOf(moss.build({ cover: 0.85, growth: "velvet" }, { rand: rand(3), facts: {} }, body), "moss");
    const bark = partOf(body, "bark");
    expect(skin.indices.length).toBeGreaterThan(0);
    // Each moss vertex moves as the bark under it does, so it keeps its height over the bark's top.
    const lift = (v: number): number => highest(applyVitality(skin, v).positions) - highest(applyVitality(bark, v).positions);
    expect(Math.abs(lift(0) - lift(1))).toBeLessThan(0.05);
  });
});
