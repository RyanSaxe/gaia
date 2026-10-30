import { describe, expect, it } from "vitest";
import { type BuildingPlan, Library, type Role, blueprintOf, rand, seedOf } from "@gaia/schema";
import { PRIMITIVES } from "@gaia/primitives";
import { realize } from "@gaia/realize";
import { landmark, structure } from "@gaia/kinds";
import { sweep } from "@gaia/world";
import { randomSlots } from "@gaia/world/testing";
import { type BuildingComposition, type Composition, INKS, MARK_REACH, type MarkBox, drawBuilding, drawLandmark } from "./marks.ts";
import { PLANT_INKS } from "./plant-marks.ts";

/** The roles whose primitives appear in the world as buildings and landmarks, and as trees, bushes, stones and drifts, so the map must ink them. */
const DRAWN: ReadonlySet<Role> = new Set(["Footprint", "Walls", "Roof", "Openings", "Dressing", "Feature", "Landmark"]);
const PLANTS_DRAWN: ReadonlySet<Role> = new Set(["Skeleton", "Surface", "Foliage", "Ornament", "Rock", "Overgrowth", "Drift"]);

describe("the marks' table", () => {
  it("says how the map inks every primitive that appears in the world, in the role that primitive fills", () => {
    const unsaid = PRIMITIVES.filter((p) => (DRAWN.has(p.role) && INKS[p.id]?.role !== p.role) || (PLANTS_DRAWN.has(p.role) && PLANT_INKS[p.id]?.role !== p.role)).map((p) => p.id);
    expect(unsaid).toEqual([]);
  });
});

/** A canvas that only records the points a drawing places. A path's points count once it is filled or stroked. */
function recorder(): { ctx: CanvasRenderingContext2D; points: [number, number][] } {
  const points: [number, number][] = [];
  const pathInto = (into: [number, number][]) => {
    const near = (x: number, y: number, r = 0): void => {
      into.push([x - r, y - r], [x + r, y + r]);
    };
    return {
      moveTo: (x: number, y: number) => near(x, y),
      lineTo: (x: number, y: number) => near(x, y),
      arcTo: (x1: number, y1: number, x2: number, y2: number) => (near(x1, y1), near(x2, y2)),
      quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => (near(cx, cy), near(x, y)),
      bezierCurveTo: (ax: number, ay: number, bx: number, by: number, x: number, y: number) => (near(ax, ay), near(bx, by), near(x, y)),
      arc: (x: number, y: number, r: number) => near(x, y, r),
      // An ellipse's bounding box, accounting for its rotation.
      ellipse: (x: number, y: number, rx: number, ry: number, turn = 0) => {
        const [hx, hy] = [Math.hypot(rx * Math.cos(turn), ry * Math.sin(turn)), Math.hypot(rx * Math.sin(turn), ry * Math.cos(turn))];
        into.push([x - hx, y - hy], [x + hx, y + hy]);
      },
      closePath: () => {},
    };
  };
  const path = pathInto(points);
  class Path2DRecorder {
    readonly placed: [number, number][] = [];
    constructor() {
      Object.assign(this, pathInto(this.placed));
    }
  }
  (globalThis as { Path2D?: unknown }).Path2D = Path2DRecorder;
  const drawn = (p?: unknown): void => {
    if (p instanceof Path2DRecorder) points.push(...p.placed);
  };
  const ctx = new Proxy(path, {
    get: (target, key) => {
      if (key in target) return target[key as keyof typeof path];
      if (key === "fill" || key === "stroke") return drawn;
      if (key === "getTransform") return () => ({ a: 1, b: 0 });
      if (key === "createLinearGradient") return () => ({ addColorStop: () => {} });
      if (key === "fillRect") return (x: number, y: number, w: number, h: number) => points.push([x, y], [x + w, y + h]);
      return () => {};
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, points };
}

const lib = new Library(PRIMITIVES);
/** Buildings covering every structure part, from a sweep, realized as the proving ground realizes them. */
const buildings: [string, BuildingComposition][] = sweep(structure, lib).blueprints.map((blueprint, i) => {
  const built = realize(blueprint, structure, lib, { seed: seedOf(`building ${i}`), facts: {} });
  return [`building ${i}`, { blueprint, palette: built.palette, plan: built.slots.get("footprint")?.output as BuildingPlan }];
});
// A landmark's mark reads only its words and colors, so an empty palette draws it in its default colors.
const landmarks: [string, Composition][] = sweep(landmark, lib).blueprints.map((blueprint, i) => [`landmark ${i}`, { blueprint, palette: { swatches: {} } }]);

describe("a mark composed from a blueprint", () => {
  const SCALE = 2;
  // Strokes and the wash offset extend a little past the points a mark places.
  const SLACK = 3 * SCALE;
  const inside = (box: MarkBox, [x, y]: [number, number], slack = SLACK): boolean => x >= box[0] - slack && x <= box[2] + slack && y >= box[1] - slack && y <= box[3] + slack;
  // The area around a mark's base that the sheets keep names out of before they know what will stand there.
  const reach: MarkBox = [200 - MARK_REACH.left * SCALE, 200 - MARK_REACH.up * SCALE, 200 + MARK_REACH.right * SCALE, 200 + MARK_REACH.down * SCALE];

  // Random buildings and landmarks from everything Jev can compose, so shapes the proving ground never uses are
  // covered too, beside the sweep's, which cover every part. A mark reads only a building's plan and palette, so only
  // those two slots of a random building are built.
  const drawnBuildings: [string, BuildingComposition][] = [...buildings];
  const drawnLandmarks: [string, Composition][] = [...landmarks];
  for (let i = 0; i < 300; i++) {
    const draws = rand(seedOf(`marks drawn ${i}`));
    const blueprint = blueprintOf(structure.id, randomSlots(structure, lib, () => draws.next()));
    const { footprint, palette } = blueprint.slots;
    const built = realize({ ...blueprint, slots: { footprint, palette } as typeof blueprint.slots }, structure, lib, { seed: seedOf(`marks drawn ${i}`), facts: {} });
    drawnBuildings.push([`drawn ${i}`, { blueprint, palette: built.palette, plan: built.slots.get("footprint")?.output as BuildingPlan }]);
    drawnLandmarks.push([`drawn ${i}`, { blueprint: blueprintOf(landmark.id, randomSlots(landmark, lib, () => draws.next())), palette: { swatches: {} } }]);
  }

  // Draws over 300 buildings and 300 landmarks: about a second alone, longer when the suite runs in parallel.
  it.each([1, 0.5, 0.05])("draws any building and landmark Jev can compose at vitality %s inside the box it reports and the reach every mark keeps to", { timeout: 30_000 }, (v) => {
    for (const [name, building] of drawnBuildings) {
      const { ctx, points } = recorder();
      const box = drawBuilding(ctx, 200, 200, SCALE, building, v, name);
      const what = `building ${name}: ${JSON.stringify(building.blueprint.slots)}`;
      expect(points, what).not.toEqual([]);
      expect(points.filter((p) => !inside(box, p)), what).toEqual([]);
      expect(points.filter(([x, y]) => !inside(reach, [x, y], -SLACK)), what).toEqual([]);
    }
    for (const [name, mark] of drawnLandmarks) {
      const { ctx, points } = recorder();
      const box = drawLandmark(ctx, 200, 200, SCALE, mark, v, name);
      const what = `landmark ${name}: ${JSON.stringify(mark.blueprint.slots)}`;
      expect(points, what).not.toEqual([]);
      expect(points.filter((p) => !inside(box, p)), what).toEqual([]);
      expect(points.filter(([x, y]) => !inside(reach, [x, y], -SLACK)), what).toEqual([]);
    }
  });
});
