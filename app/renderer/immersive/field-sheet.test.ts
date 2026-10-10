import { describe, expect, it } from "vitest";
import { type CodeModel, Library } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { WILDS, bakeTerrain, groundHeightAt, heightAt, landHalf, outlinesOf, sampleWorld } from "@gaia/terrain";
import { type Judgments, LAYOUT, type LotPlace, layoutWorld } from "@gaia/world";
import proving from "../terrain/fixtures/proving.json";
import provingJudged from "../terrain/fixtures/proving-judged.json";
import { type Box, type Measure, type NameLand, type NamePlaces, nameLand, nameTails, placeNames } from "./map-names.ts";
import { MAP_STYLE, healthColor, healthField, landWash } from "./map-styles.ts";
import { MARK_REACH, markScale } from "./marks.ts";
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

describe("where the sheets letter areas' names", () => {
  const run = <T,>(steps: Generator<void, T>): T => {
    for (;;) {
      const step = steps.next();
      if (step.done === true) return step.value;
    }
  };
  // Capitals as wide as their letters and spacing, as near as a test can measure without a browser.
  const measure: Measure = (text, font, spacing) => text.length * (0.72 * Number(/([\d.]+)px/.exec(font)?.[1] ?? 0) + spacing);
  // The proving ground's land as the world service sends it before anything is judged: every area's outline and
  // every lot where a building or landmark will stand. Laid out once and only read.
  const world = layoutWorld(proving as unknown as CodeModel, provingJudged as unknown as Judgments);
  const landWith = (lots: readonly LotPlace[]): NameLand => run(nameLand(outlinesOf(world).areas, world.size, world.size / 2, lots));
  const land = landWith(world.things.map(({ x, z }) => ({ x, z })));
  // A wide screen's sheet and a phone's.
  const sheets = [800, 380].map((side) => run(placeNames(land, side, measure)));
  const boxes = (placed: NamePlaces): Box[] => placed.places.map((p) => {
    const [x, y] = [(p.x + land.reach) * placed.scale, (p.z + land.reach) * placed.scale];
    return [x + p.box[0], y + p.box[1], x + p.box[2], y + p.box[3]];
  });
  const hits = (a: Box, b: Box): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  // The ground any building's or landmark's mark may take round each lot, wherever on it the thing stands.
  const markGround = (placed: NamePlaces, lots: readonly LotPlace[]): Box[] => {
    const s = markScale(placed.scale, 1);
    const lot = Math.max(...Object.values(LAYOUT.lotReach)) * placed.scale;
    return lots.map(({ x, z }) => {
      const [px, py] = [(x + land.reach) * placed.scale, (z + land.reach) * placed.scale];
      return [px - MARK_REACH.left * s - lot, py - MARK_REACH.up * s - lot, px + MARK_REACH.right * s + lot, py + MARK_REACH.down * s + lot];
    });
  };

  it("letters every area with ground of its own once, and not the root, which is the whole sheet", () => {
    const areas = land.labels.filter((l) => l.area.depth > 0).map((l) => l.area.path).sort();
    expect(areas.length).toBeGreaterThan(40);
    for (const placed of sheets) expect(placed.places.map((p) => p.label.area.path).sort()).toEqual(areas);
  });

  it("never lets one name cover another", () => {
    for (const placed of sheets) {
      const all = boxes(placed);
      for (const [i, a] of all.entries()) expect(all.slice(i + 1).filter((b) => hits(a, b))).toEqual([]);
    }
  });

  it("keeps names off the ground every building and landmark may draw on, letting one over it only when nothing near is clear", () => {
    const [wide] = sheets as [NamePlaces];
    const marks = markGround(wide, land.lots);
    const clear = boxes(wide).filter((_, i) => !(wide.places[i] as NamePlaces["places"][number]).over);
    for (const b of clear) expect(marks.filter((m) => hits(b, m))).toEqual([]);
    // On a wide sheet nearly every name finds room clear of the marks.
    expect(clear.length).toBeGreaterThan(wide.places.length * 0.9);
    // Where lots stand so close that no ground is clear of them, every name is still lettered, over them.
    const lots: LotPlace[] = [];
    for (let x = -world.size / 2; x <= world.size / 2; x += 60) for (let z = -world.size / 2; z <= world.size / 2; z += 60) lots.push({ x, z });
    const crowded = run(placeNames(landWith(lots), 800, measure));
    expect(crowded.places.length).toBe(wide.places.length);
    expect(crowded.places.every((p) => p.over)).toBe(true);
  });

  it("places names from the land alone, so walking never moves one", () => {
    expect(run(placeNames(structuredClone(land), 800, measure))).toEqual(sheets[0]);
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
