import { describe, expect, it } from "vitest";
import { type AnyKind, type Library, type Role, seedOf } from "@gaia/schema";
import { PRIMITIVES } from "@gaia/primitives";
import { realize } from "@gaia/realize";
import { sweep } from "@gaia/world";
import { COMPOSING } from "../terrain/looks.ts";
import { markOf } from "../terrain/plant-mark.ts";
import type { MarkBox } from "./marks.ts";
import { PLANT_INKS, type PlantComposition, drawPlant, plantRoom } from "./plant-marks.ts";

/** The roles whose primitives stand in the world as trees, bushes, stones and drifts, so the map must ink them. */
const DRAWN: ReadonlySet<Role> = new Set(["Skeleton", "Surface", "Foliage", "Ornament", "Rock", "Overgrowth", "Drift"]);

describe("the plant marks' table", () => {
  it("says how the map inks every tree, bush, stone and flower primitive, in the role that primitive fills", () => {
    const unsaid = PRIMITIVES.filter((p) => DRAWN.has(p.role) && PLANT_INKS[p.id]?.role !== p.role).map((p) => p.id);
    expect(unsaid).toEqual([]);
  });

  it("names only primitives that exist, each in its own role", () => {
    const roles = new Map<string, Role>(PRIMITIVES.map((p) => [p.id, p.role]));
    expect(Object.entries(PLANT_INKS).filter(([id, ink]) => roles.get(id) !== ink.role).map(([id]) => id)).toEqual([]);
  });
});

/**
 * Every point a drawing shows, from a canvas that only records: a path's points count once it is filled or stroked,
 * and paint inside a clip, which shows only within the shape clipped to, counts not at all.
 */
function recorder(): { ctx: CanvasRenderingContext2D; points: [number, number][] } {
  const points: [number, number][] = [];
  const pathInto = (into: [number, number][]) => {
    const near = (x: number, y: number, r = 0): void => {
      into.push([x - r, y - r], [x + r, y + r]);
    };
    return {
      moveTo: (x: number, y: number) => near(x, y),
      lineTo: (x: number, y: number) => near(x, y),
      quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => (near(cx, cy), near(x, y)),
      arcTo: (x1: number, y1: number, x2: number, y2: number) => (near(x1, y1), near(x2, y2)),
      arc: (x: number, y: number, r: number) => near(x, y, r),
      ellipse: (x: number, y: number, rx: number, ry: number) => into.push([x - rx, y - ry], [x + rx, y + ry]),
      closePath: () => {},
    };
  };
  class Path2DRecorder {
    readonly placed: [number, number][] = [];
    constructor() {
      Object.assign(this, pathInto(this.placed));
    }
  }
  (globalThis as { Path2D?: unknown }).Path2D = Path2DRecorder;
  // The canvas's own path, taken when it is filled or stroked.
  const current: [number, number][] = [];
  const path = pathInto(current);
  const clips: boolean[] = [];
  let clipped = false;
  const paint = (p?: unknown): void => {
    if (!clipped) points.push(...(p instanceof Path2DRecorder ? p.placed : current));
  };
  const ctx = new Proxy(path, {
    get: (target, key) => {
      if (key in target) return target[key as keyof typeof path];
      if (key === "beginPath") return () => (current.length = 0);
      if (key === "fill" || key === "stroke") return paint;
      if (key === "save") return () => clips.push(clipped);
      if (key === "restore") return () => (clipped = clips.pop() ?? false);
      if (key === "clip") return () => (clipped = true);
      if (key === "getTransform") return () => ({ a: 2, b: 0 });
      if (key === "fillRect") return (x: number, y: number, w: number, h: number) => (clipped ? undefined : points.push([x, y], [x + w, y + h]));
      return () => {};
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, points };
}

/** Every tree, bush, stone and drift the sweep stands, built once, with the size its mark is drawn at. */
const plants: [string, PlantComposition][] = (
  [
    [COMPOSING.tree, COMPOSING.offered?.tree ?? COMPOSING.lib],
    [COMPOSING.bush, COMPOSING.offered?.bush ?? COMPOSING.lib],
    [COMPOSING.stone, COMPOSING.lib],
    [COMPOSING.flowers, COMPOSING.lib],
  ] as [AnyKind, Library][]
).flatMap(([k, lib]) =>
  sweep(k, lib).blueprints.map((blueprint, i): [string, PlantComposition] => {
    const built = realize(blueprint, k, COMPOSING.lib, { seed: seedOf(`build/${blueprint.id}`), facts: { scale: 1, age: 120 } });
    return [`${k.id} ${i}: ${Object.values(blueprint.slots).map((s) => s.use).join(" ")}`, markOf(blueprint, built)];
  }),
);

describe("a plant's mark composed from its blueprint", () => {
  // Strokes and the brush's offset to the southeast reach a little past the points a mark places.
  const inside = (box: MarkBox, [x, y]: [number, number], slack: number): boolean => x >= box[0] - slack && x <= box[2] + slack && y >= box[1] - slack && y <= box[3] + slack;

  // From the whole sheet's zoom to the closest, in pixels a meter.
  it.each([
    [1, 1.25],
    [0.5, 1.25],
    [0, 1.25],
    [1, 8.75],
    [0.5, 8.75],
    [0, 8.75],
  ])("draws every swept tree, bush, stone and drift at shown vitality %s and %s px/m inside the box it reports and the room its stamp is cut from", (v, s) => {
    expect(plants.length).toBeGreaterThan(40);
    for (const [name, plant] of plants) {
      const { ctx, points } = recorder();
      const box = drawPlant(ctx, 400, 400, s, plant, v);
      const room = plantRoom(plant);
      const roomBox: MarkBox = [400 - room.footX * s, 400 - room.footY * s, 400 + (room.width - room.footX) * s, 400 + (room.height - room.footY) * s];
      expect(points.length, name).toBeGreaterThan(4);
      expect(points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), name).toBe(true);
      expect(points.filter((p) => !inside(box, p, 1 + 0.25 * s)), name).toEqual([]);
      expect(points.filter((p) => !inside(roomBox, p, 0)), name).toEqual([]);
    }
  });
});
