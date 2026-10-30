import { describe, expect, it } from "vitest";
import { outlinesOf } from "@gaia/terrain";
import { type LotPlace, layoutWorld } from "@gaia/world";
import { facts as provingFacts, judged as provingJudged } from "virtual:proving-ground";
import { type Box, type Measure, type NameLand, type NamePlaces, nameLand, placeNames } from "./map-names.ts";
import { healthField } from "./map-styles.ts";

describe("where the sheets letter areas' names", () => {
  const run = <T,>(steps: Generator<void, T>): T => {
    for (;;) {
      const step = steps.next();
      if (step.done === true) return step.value;
    }
  };
  // Approximates a capital's width from the font size and spacing, since the test has no browser to measure with.
  const measure: Measure = (text, font, spacing) => text.length * (0.72 * Number(/([\d.]+)px/.exec(font)?.[1] ?? 0) + spacing);
  // The proving ground's land as the world service sends it before Jev judges anything: every area's outline and
  // every lot for a building or landmark. Laid out once and only read.
  const world = layoutWorld(provingFacts, provingJudged, undefined, 1);
  const landWith = (lots: readonly LotPlace[]): NameLand => run(nameLand(outlinesOf(world).areas, world.size, world.size / 2, lots));
  const land = landWith(world.things.map(({ x, z }) => ({ x, z })));
  // A wide screen's sheet and a phone's.
  const sheets = [800, 380].map((side) => run(placeNames(land, side, measure)));
  const boxes = (placed: NamePlaces): Box[] => placed.places.map((p) => {
    const [x, y] = [(p.x + land.reach) * placed.scale, (p.z + land.reach) * placed.scale];
    return [x + p.box[0], y + p.box[1], x + p.box[2], y + p.box[3]];
  });
  const hits = (a: Box, b: Box): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

  it("letters every area with ground of its own once, and not the root, which is the whole sheet", () => {
    const areas = land.labels.filter((l) => l.area.depth > 0).map((l) => l.area.path).sort();
    expect(areas.length).toBeGreaterThan(40);
    for (const placed of sheets) expect(placed.places.map((p) => p.label.area.path).sort()).toEqual(areas);
    // When lots are so dense that no ground is clear of them, every name is still lettered, over the marks.
    const lots: LotPlace[] = [];
    for (let x = -world.size / 2; x <= world.size / 2; x += 60) for (let z = -world.size / 2; z <= world.size / 2; z += 60) lots.push({ x, z });
    const crowded = run(placeNames(landWith(lots), 800, measure));
    expect(crowded.places.map((p) => p.label.area.path).sort()).toEqual(areas);
  });

  it("never lets one name cover another", () => {
    for (const placed of sheets) {
      const all = boxes(placed);
      for (const [i, a] of all.entries()) expect(all.slice(i + 1).filter((b) => hits(a, b))).toEqual([]);
    }
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
});
