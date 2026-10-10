import { describe, expect, it } from "vitest";
import { type BuildingPlan, Library, type Role, seedOf } from "@gaia/schema";
import { PRIMITIVES } from "@gaia/primitives";
import { LANDMARK_PRESETS, STRUCTURE_PRESETS, realize } from "@gaia/realize";
import { structure } from "@gaia/kinds";
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

/** Every point a drawing places, from a canvas that only records. */
function recorder(): { ctx: CanvasRenderingContext2D; points: [number, number][] } {
  const points: [number, number][] = [];
  const near = (x: number, y: number, r = 0): void => {
    points.push([x - r, y - r], [x + r, y + r]);
  };
  const path = {
    moveTo: (x: number, y: number) => near(x, y),
    lineTo: (x: number, y: number) => near(x, y),
    arcTo: (x1: number, y1: number, x2: number, y2: number) => (near(x1, y1), near(x2, y2)),
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => (near(cx, cy), near(x, y)),
    bezierCurveTo: (ax: number, ay: number, bx: number, by: number, x: number, y: number) => (near(ax, ay), near(bx, by), near(x, y)),
    arc: (x: number, y: number, r: number) => near(x, y, r),
    ellipse: (x: number, y: number, rx: number, ry: number) => near(x, y, Math.max(rx, ry)),
    closePath: () => {},
  };
  class Path2DRecorder {
    constructor() {
      Object.assign(this, path);
    }
  }
  (globalThis as { Path2D?: unknown }).Path2D = Path2DRecorder;
  const ctx = new Proxy(path, {
    get: (target, key) => {
      if (key in target) return target[key as keyof typeof path];
      if (key === "getTransform") return () => ({ a: 1, b: 0 });
      if (key === "createLinearGradient") return () => ({ addColorStop: () => {} });
      if (key === "fillRect") return (x: number, y: number, w: number, h: number) => (near(x, y), near(x + w, y + h));
      return () => {};
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, points };
}

const lib = new Library(PRIMITIVES);
const buildings: [string, BuildingComposition][] = STRUCTURE_PRESETS.map((p) => {
  const built = realize(p.blueprint, structure, lib, { seed: seedOf(p.name), facts: {} });
  return [p.name, { blueprint: p.blueprint, palette: built.palette, plan: built.slots.get("footprint")?.output as BuildingPlan }];
});
// A landmark's mark reads only its words and colors, so an empty palette draws it in its own defaults.
const landmarks: [string, Composition][] = LANDMARK_PRESETS.map((p) => [p.name, { blueprint: p.blueprint, palette: { swatches: {} } }]);

describe("a mark composed from a blueprint", () => {
  const SCALE = 2;
  // Strokes and the brush's offset reach a little past the points a mark places.
  const SLACK = 3 * SCALE;
  const inside = (box: MarkBox, [x, y]: [number, number], slack = SLACK): boolean => x >= box[0] - slack && x <= box[2] + slack && y >= box[1] - slack && y <= box[3] + slack;
  // The ground the sheets keep names off round a mark's foot, before they know what will stand there.
  const reach: MarkBox = [200 - MARK_REACH.left * SCALE, 200 - MARK_REACH.up * SCALE, 200 + MARK_REACH.right * SCALE, 200 + MARK_REACH.down * SCALE];

  it.each([1, 0.5, 0.05])("draws every building and landmark preset at vitality %s inside the box it reports and the reach every mark keeps to, which names keep off", (v) => {
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
