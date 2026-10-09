import { describe, expect, it } from "vitest";
import { Library } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { WILDS, bakeTerrain, groundHeightAt, heightAt, landHalf, sampleWorld } from "@gaia/terrain";
import { nameTails } from "./map-names.ts";
import { MAP_STYLE, healthColor, healthField, landWash } from "./map-styles.ts";
import { INK, RIM, levelsFor, reliefAt } from "./wild-ink.ts";

describe("names that repeat", () => {
  it("letters a name alone when no other area shares it, and just enough of the path above it when one does", () => {
    const tails = nameTails(["docs", "packages/world/src", "packages/terrain/src", "app/renderer/terrain", "packages/terrain/test"]);
    expect(tails.get("docs")).toBe("");
    expect(tails.get("packages/terrain/test")).toBe("");
    expect(tails.get("packages/world/src")).toBe("world");
    expect(tails.get("packages/terrain/src")).toBe("terrain");
    expect(tails.get("app/renderer/terrain")).toBe("");
  });

  it("climbs as far as it must when the folder above repeats too", () => {
    const tails = nameTails(["a/lib/src", "b/lib/src", "c/src"]);
    expect(tails.get("a/lib/src")).toBe("a / lib");
    expect(tails.get("b/lib/src")).toBe("b / lib");
    expect(tails.get("c/src")).toBe("c");
  });
});

describe("health over the land", () => {
  const failing = { x: 0, z: 0, reach: 6, size: 36, vitality: 0.1 };
  const thriving = { x: 60, z: 0, reach: 6, size: 36, vitality: 0.95 };
  const field = healthField([failing, thriving], 24);

  it("reads each file's ground near its own vitality, though its neighbors' health reaches into it", () => {
    expect(Math.abs(field(0, 0, 0.5) - 0.1)).toBeLessThan(0.1);
    expect(Math.abs(field(60, 0, 0.5) - 0.95)).toBeLessThan(0.1);
  });

  it("runs as one gradient between files, across any border between them", () => {
    const between = [10, 20, 30, 40, 50].map((x) => field(x, 0, 0.5));
    for (let k = 1; k < between.length; k++) expect(between[k] as number).toBeGreaterThan(between[k - 1] as number);
  });

  it("settles on the area's own health far from every file", () => {
    expect(field(0, 500, 0.7)).toBeCloseTo(0.7, 3);
  });
});

describe("health's colors", () => {
  const land = landWash(MAP_STYLE, "app");
  const at = (v: number): [number, number, number] => healthColor(MAP_STYLE, land, v);
  const warmth = ([r, g, b]: readonly number[]): number => (r as number) - (b as number) + ((r as number) - (g as number));

  it("turns healthy green toward gold, then russet and ash, as vitality falls", () => {
    const [r, g] = at(1);
    expect(g).toBeGreaterThan(r);
    expect(warmth(at(0.5))).toBeGreaterThan(warmth(at(1)));
    expect(warmth(at(0.25))).toBeGreaterThan(warmth(at(0.5)));
    const ash = at(0);
    expect(Math.max(...ash) - Math.min(...ash)).toBeLessThan(Math.max(...at(0.25)) - Math.min(...at(0.25)));
  });

  it("changes without a step anywhere along the scale, so a field of health has no seams", () => {
    for (let v = 0; v < 1; v += 0.01) {
      const a = at(v);
      const b = at(v + 0.01);
      expect(Math.max(...a.map((c, i) => Math.abs(c - (b[i] as number))))).toBeLessThanOrEqual(6);
    }
  });
});

describe("the wild past the land", () => {
  // Baked once and only read.
  const t = bakeTerrain(sampleWorld(), new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]));

  it("draws the land's own heights, eased at its rim into the wild's, without a step, and the wild's own ground once settled", () => {
    expect(reliefAt(t, 30, -40)).toBe(heightAt(t.lattice, 30, -40));
    const out = landHalf(t) + WILDS.settle + 20;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const [cx, cz] = [Math.cos(a), Math.sin(a)];
      expect(reliefAt(t, cx * out * 1.5, cz * out * 1.5)).toBeCloseTo(groundHeightAt(t, cx * out * 1.5, cz * out * 1.5), 6);
      // From where the rim's easing begins, across the rim and far out into the wild, the ground never steps, so no
      // contours crowd into a ring where the land ends.
      for (let r = t.spec.size / 2 - RIM.inner - 20; r < out * 1.5; r += 0.5) {
        expect(Math.abs(reliefAt(t, cx * (r + 0.5), cz * (r + 0.5)) - reliefAt(t, cx * r, cz * r))).toBeLessThan(0.25);
      }
    }
  });

  it("lays the scale nearest a view's zoom, and crossfades between two scales as it zooms, never jumping", () => {
    expect(levelsFor(INK.scale)).toEqual([{ k: 0, weight: 1 }]);
    let last = levelsFor(8);
    for (let zoom = 8; zoom > 0.01; zoom *= 0.995) {
      const levels = levelsFor(zoom);
      expect(levels.reduce((sum, l) => sum + l.weight, 0)).toBeCloseTo(1, 9);
      const weightOf = (ls: typeof levels, k: number): number => ls.find((l) => l.k === k)?.weight ?? 0;
      for (const k of new Set([...levels, ...last].map((l) => l.k))) expect(Math.abs(weightOf(levels, k) - weightOf(last, k))).toBeLessThan(0.05);
      last = levels;
    }
  });
});
