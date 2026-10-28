// Checks how a fallen log and a stump decline through the standard channels:
// halves that settle apart, bark that sheds from the top, a top that crumbles
// into a hollow, and moss that moves with what it grows on.

import { describe, expect, it } from "vitest";
import { type Built, type Part, rand } from "@gaia/schema";
import { fallenLog, moss, stump } from "@gaia/primitives";
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
  it("settles into the turf as it fails, without rebuilding", () => {
    const bark = partOf(log("sawn"), "bark");
    const wood = partOf(log("sawn"), "wood");
    const top = (v: number): number => Math.max(highest(applyVitality(bark, v).positions), highest(applyVitality(wood, v).positions));
    expect(top(0)).toBeLessThan(top(1) - 0.08);
  });

  it("sheds its bark from the top first, and keeps some low down", () => {
    const bark = partOf(log("broken"), "bark");
    // Bark that has gone has shrunk to nothing, while sagging keeps a surface's size.
    const area = (positions: Float32Array, facing: (ny: number) => boolean): number => {
      let sum = 0;
      for (let t = 0; t < bark.indices.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => bark.indices[t + k] as number) as [number, number, number];
        if (!facing(bark.normals[a * 3 + 1] as number)) continue;
        const e = [0, 1, 2].map((k) => (positions[b * 3 + k] as number) - (positions[a * 3 + k] as number));
        const f = [0, 1, 2].map((k) => (positions[c * 3 + k] as number) - (positions[a * 3 + k] as number));
        sum += Math.hypot((e[1] as number) * (f[2] as number) - (e[2] as number) * (f[1] as number), (e[2] as number) * (f[0] as number) - (e[0] as number) * (f[2] as number), (e[0] as number) * (f[1] as number) - (e[1] as number) * (f[0] as number));
      }
      return sum;
    };
    const kept = (facing: (ny: number) => boolean): number => area(applyVitality(bark, 0.3).positions, facing) / area(applyVitality(bark, 1).positions, facing);
    const top = (ny: number): boolean => ny > 0.6;
    const low = (ny: number): boolean => ny < -0.5;
    expect(kept(top)).toBeLessThan(0.5);
    expect(kept(low)).toBeGreaterThan(0.9);
  });

  it("shows rings on a sawn face around a lighter heartwood", () => {
    const wood = partOf(log("sawn"), "wood");
    // The cut faces look along the log, which lies along x.
    const face = Array.from({ length: wood.shade.length }, (_, i) => i).filter((i) => Math.abs(wood.normals[i * 3] as number) > 0.85);
    const shades = face.map((i) => wood.shade[i] as number);
    expect(new Set(shades.map((s) => s.toFixed(2))).size).toBeGreaterThan(4);
    // Each face's center, by which end it is at.
    const at = (i: number, k: number): number => wood.positions[i * 3 + k] as number;
    const end = (i: number): number => Math.sign(at(i, 0));
    const middles = new Map([-1, 1].map((side) => {
      const on = face.filter((i) => end(i) === side);
      return [side, [1, 2].map((k) => on.reduce((sum, i) => sum + at(i, k), 0) / Math.max(1, on.length))] as const;
    }));
    const r = (i: number): number => {
      const [y, z] = middles.get(end(i)) ?? [0, 0];
      return Math.hypot(at(i, 1) - (y as number), at(i, 2) - (z as number));
    };
    const widest = new Map([-1, 1].map((side) => [side, face.filter((i) => end(i) === side).reduce((m, i) => Math.max(m, r(i)), 0)] as const));
    const most = (side: number): number => widest.get(side) ?? 0;
    const near = face.filter((i) => r(i) < 0.3 * most(end(i))).map((i) => wood.shade[i] as number);
    const rim = face.filter((i) => r(i) > 0.75 * most(end(i))).map((i) => wood.shade[i] as number);
    const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
    expect(mean(near)).toBeGreaterThan(mean(rim));
  });

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

describe("stump", () => {
  const build = (roots: number): Built => stump.build({ height: 0.55, top: "sawn", roots, bark: 1 }, { rand: rand(5), facts: { scale: 1 } }, null);
  const reach = (b: Built): number => {
    const p = partOf(b, "bark").positions;
    let most = 0;
    for (let i = 0; i < p.length; i += 3) if ((p[i + 1] as number) > -0.02) most = Math.max(most, Math.hypot(p[i] as number, p[i + 2] as number));
    return most;
  };

  it("spreads its roots as far as its words say", () => {
    expect(reach(build(2.2))).toBeGreaterThan(reach(build(0.5)) + 0.3);
  });

  it("crumbles from the center into a hollow as vitality falls", () => {
    const wood = partOf(build(1.1), "wood");
    const heart = (v: number): number => {
      const p = applyVitality(wood, v).positions;
      // Faces of real size near the axis at the top.
      let area = 0;
      for (let t = 0; t < wood.indices.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => wood.indices[t + k] as number) as [number, number, number];
        const at = (i: number, k: number): number => p[i * 3 + k] as number;
        if ((at(a, 0) ** 2 + at(a, 2) ** 2) > 0.1 ** 2 || at(a, 1) < 0.5) continue;
        const e = [0, 1, 2].map((k) => at(b, k) - at(a, k));
        const f = [0, 1, 2].map((k) => at(c, k) - at(a, k));
        area += Math.hypot((e[1] as number) * (f[2] as number) - (e[2] as number) * (f[1] as number), (e[2] as number) * (f[0] as number) - (e[0] as number) * (f[2] as number), (e[0] as number) * (f[1] as number) - (e[1] as number) * (f[0] as number)) / 2;
      }
      return area;
    };
    expect(heart(1)).toBeGreaterThan(0.005);
    expect(heart(0.2)).toBeLessThan(heart(1) * 0.2);
  });
});
