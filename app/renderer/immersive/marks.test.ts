import { describe, expect, it } from "vitest";
import { type BuildingPlan, Library, type Role, blueprintOf, rand, seedOf } from "@gaia/schema";
import { PRIMITIVES } from "@gaia/primitives";
import { realize } from "@gaia/realize";
import { landmark, structure } from "@gaia/kinds";
import { sweep } from "@gaia/world";
import { randomSlots } from "@gaia/world/testing";
import { type BuildingComposition, type Composition, INKS, MARK_REACH, type MarkBox, drawBuilding, drawLandmark } from "./marks.ts";

/** The roles whose primitives stand in the world as buildings and landmarks, so the map must ink them. */
const DRAWN: ReadonlySet<Role> = new Set(["Footprint", "Walls", "Roof", "Openings", "Dressing", "Feature", "Landmark"]);

describe("the marks' table", () => {
  it("says how the map inks every structure and landmark primitive, in the role that primitive fills", () => {
    const unsaid = PRIMITIVES.filter((p) => DRAWN.has(p.role) && INKS[p.id]?.role !== p.role).map((p) => p.id);
    expect(unsaid).toEqual([]);
  });

  it("names only primitives that exist", () => {
    const ids = new Set<string>(PRIMITIVES.map((p) => p.id));
    expect(Object.keys(INKS).filter((id) => !ids.has(id))).toEqual([]);
  });
});

/** Every point a drawing places, from a canvas that only records: a path's points count once it is filled or stroked. */
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
      // An ellipse's box, turned by its rotation.
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
/** Every part of a building and of a landmark, swept, as the proving ground stands them. */
const buildings: [string, BuildingComposition][] = sweep(structure, lib).blueprints.map((blueprint, i) => {
  const built = realize(blueprint, structure, lib, { seed: seedOf(`building ${i}`), facts: {} });
  return [`building ${i}`, { blueprint, palette: built.palette, plan: built.slots.get("footprint")?.output as BuildingPlan }];
});
// A landmark's mark reads only its words and colors, so an empty palette draws it in its own defaults.
const landmarks: [string, Composition][] = sweep(landmark, lib).blueprints.map((blueprint, i) => [`landmark ${i}`, { blueprint, palette: { swatches: {} } }]);

describe("a mark composed from a blueprint", () => {
  const SCALE = 2;
  // Strokes and the brush's offset reach a little past the points a mark places.
  const SLACK = 3 * SCALE;
  const inside = (box: MarkBox, [x, y]: [number, number], slack = SLACK): boolean => x >= box[0] - slack && x <= box[2] + slack && y >= box[1] - slack && y <= box[3] + slack;
  // The ground the sheets keep names off round a mark's foot, before they know what will stand there.
  const reach: MarkBox = [200 - MARK_REACH.left * SCALE, 200 - MARK_REACH.up * SCALE, 200 + MARK_REACH.right * SCALE, 200 + MARK_REACH.down * SCALE];

  // Buildings and landmarks drawn from everything Jev can compose, so no shape the proving ground never takes strays.
  // A mark reads only a building's plan and palette, so only those two slots are built.
  const drawn = Array.from({ length: 300 }, (_, i) => {
    const draws = rand(seedOf(`marks drawn ${i}`));
    const blueprint = blueprintOf(structure.id, randomSlots(structure, lib, () => draws.next()));
    const { footprint, palette } = blueprint.slots;
    const built = realize({ ...blueprint, slots: { footprint, palette } as typeof blueprint.slots }, structure, lib, { seed: seedOf(`marks drawn ${i}`), facts: {} });
    const building: BuildingComposition = { blueprint, palette: built.palette, plan: built.slots.get("footprint")?.output as BuildingPlan };
    const mark: Composition = { blueprint: blueprintOf(landmark.id, randomSlots(landmark, lib, () => draws.next())), palette: { swatches: {} } };
    return { building, mark };
  });

  // Draws 300 buildings and 300 landmarks: about a second alone, longer when the suite runs in parallel.
  it.each([1, 0.5, 0.05])("draws any building and landmark Jev can compose at vitality %s inside the box it reports and the reach every mark keeps to", { timeout: 30_000 }, (v) => {
    for (const [i, { building, mark }] of drawn.entries()) {
      const b = recorder();
      const box = drawBuilding(b.ctx, 200, 200, SCALE, building, v, `drawn ${i}`);
      expect(b.points.filter((p) => !inside(box, p)), `building ${i}: ${JSON.stringify(building.blueprint.slots)}`).toEqual([]);
      expect(b.points.filter(([x, y]) => !inside(reach, [x, y], -SLACK)), `building ${i}: ${JSON.stringify(building.blueprint.slots)}`).toEqual([]);
      const l = recorder();
      const lbox = drawLandmark(l.ctx, 200, 200, SCALE, mark, v, `drawn ${i}`);
      expect(l.points.filter((p) => !inside(lbox, p)), `landmark ${i}: ${JSON.stringify(mark.blueprint.slots)}`).toEqual([]);
      expect(l.points.filter(([x, y]) => !inside(reach, [x, y], -SLACK)), `landmark ${i}: ${JSON.stringify(mark.blueprint.slots)}`).toEqual([]);
    }
  });

  it.each([1, 0.5, 0.05])("draws every swept building and landmark at vitality %s inside the box it reports and the reach every mark keeps to, which names keep off", (v) => {
    for (const [name, b] of buildings) {
      const { ctx, points } = recorder();
      const box = drawBuilding(ctx, 200, 200, SCALE, b, v, name);
      expect(points.length, name).toBeGreaterThan(50);
      expect(points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), name).toBe(true);
      expect(points.filter((p) => !inside(box, p)), name).toEqual([]);
      expect(points.filter(([x, y]) => !inside(reach, [x, y], -SLACK)), name).toEqual([]);
    }
    for (const [name, l] of landmarks) {
      const { ctx, points } = recorder();
      const box = drawLandmark(ctx, 200, 200, SCALE, l, v, name);
      expect(points.length, name).toBeGreaterThan(20);
      expect(points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), name).toBe(true);
      expect(points.filter((p) => !inside(box, p)), name).toEqual([]);
      expect(points.filter(([x, y]) => !inside(reach, [x, y], -SLACK)), name).toEqual([]);
    }
  });
});
