// Builds ground solid outlines for buildings and built parts on their sites.
// Layered above `solids`, `site`, `gait` and `walk` so the core solids spatial
// index stays a leaf module without dependency cycles.

import type { BuildingPlan, Part } from "@gaia/schema";
import { FLOOR_CELL, type Floor, deckAt, floorOf } from "./gait.ts";
import { type BuildingSite, type Extent, siteToWorld } from "./site.ts";
import { type SolidShape, clearanceAt, solidsOf } from "./solids.ts";
import { BODY_RADIUS } from "./walk.ts";

/** A building's walls, one footprint per mass on its site. */
export function wallsShape(
  plan: BuildingPlan,
  site: BuildingSite,
): SolidShape[] {
  // One shape per mass, so a walk can pass through the open corner of an L
  // or between a cluster's volumes. A round mass is an octagon.
  return plan.masses.map((m) => {
    const corners: [number, number][] = m.round
      ? Array.from({ length: 8 }, (_, k) => {
          const a = ((k + 0.5) / 8) * Math.PI * 2;
          const r = m.width / 2 / Math.cos(Math.PI / 8);
          return [m.x + Math.cos(a) * r, m.z + Math.sin(a) * r];
        })
      : [
          [m.x - m.width / 2, m.z - m.depth / 2],
          [m.x + m.width / 2, m.z - m.depth / 2],
          [m.x + m.width / 2, m.z + m.depth / 2],
          [m.x - m.width / 2, m.z + m.depth / 2],
        ];
    return { points: corners.flatMap(([lx, lz]) => siteToWorld(site, lx, lz)) };
  });
}

/** Shapes drawn in a thing's own frame, placed on its site as Three places it. */
export function placeShapes(
  shapes: readonly SolidShape[],
  site: Pick<BuildingSite, "x" | "z" | "yaw">,
): SolidShape[] {
  const at = { ...site, level: 0 };
  return shapes.map((shape) => {
    if (!("points" in shape)) {
      const [x, z] = siteToWorld(at, shape.x, shape.z);
      return { x, z, radius: shape.radius };
    }
    const points: number[] = [];
    for (let i = 0; i + 1 < shape.points.length; i += 2) {
      points.push(
        ...siteToWorld(
          at,
          shape.points[i] as number,
          shape.points[i + 1] as number,
        ),
      );
    }
    return { points };
  });
}

/** How far past a building's walls, in meters, a solid piece must reach to block anything the walls do not. */
const PAST_WALLS = 1e-3;

/** The outlines of the solid pieces a building shows past its walls, in its own frame, for `buildingShapes`. */
export function buildingPieces(
  plan: BuildingPlan,
  parts: readonly Part[],
): SolidShape[] {
  const walls = solidsOf(wallsShape(plan, { x: 0, z: 0, yaw: 0, level: 0 }));
  return piecesShapes(parts, { x: 0, y: 0, z: 0, yaw: 0 }).filter((shape) => {
    if (!("points" in shape)) return true;
    for (let i = 0; i + 1 < shape.points.length; i += 2) {
      if (
        clearanceAt(
          walls,
          shape.points[i] as number,
          shape.points[i + 1] as number,
        ) > PAST_WALLS
      ) {
        return true;
      }
    }
    return false;
  });
}

/**
 * What stops a walker at a building on its site: each mass's walls, every solid piece the building shows past them
 * (`buildingPieces`), and the ground `beside` it, such as a mill wheel's pit.
 */
export function buildingShapes(
  plan: BuildingPlan,
  pieces: readonly SolidShape[],
  beside: Extent | null,
  site: BuildingSite,
): SolidShape[] {
  const box: SolidShape[] =
    beside === null
      ? []
      : [
          {
            points: [
              [beside.x0, beside.z0],
              [beside.x1, beside.z0],
              [beside.x1, beside.z1],
              [beside.x0, beside.z1],
            ].flatMap(([lx, lz]) =>
              siteToWorld(site, lx as number, lz as number),
            ),
          },
        ];
  return [...wallsShape(plan, site), ...placeShapes(pieces, site), ...box];
}

/** The height band in meters above a thing's base that a walker's body occupies, from just above the ground to the top of the head. */
export const BODY_BAND = { from: 0.1, to: 1.8 } as const;

/**
 * Clips a convex polygon, `stride` numbers to a corner, to the side of `edge` along coordinate `axis` that `keep`
 * names: at or above it for 1, at or below it for -1.
 */
function clip(
  poly: readonly number[],
  stride: number,
  axis: number,
  edge: number,
  keep: 1 | -1,
): number[] {
  const out: number[] = [];
  const n = poly.length / stride;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = poly[i * stride + axis] as number;
    const b = poly[j * stride + axis] as number;
    const inA = (a - edge) * keep >= 0;
    if (inA) {
      for (let k = 0; k < stride; k++) out.push(poly[i * stride + k] as number);
    }
    if (inA !== (b - edge) * keep >= 0) {
      const u = (edge - a) / (b - a);
      for (let k = 0; k < stride; k++) {
        out.push(
          (poly[i * stride + k] as number) +
            ((poly[j * stride + k] as number) -
              (poly[i * stride + k] as number)) *
              u,
        );
      }
    }
  }
  return out;
}

/** Clips a convex polygon, `stride` numbers to a corner, to the rectangle from (x0, z0) to (x1, z1) on coordinates 0 and `zAxis`. */
const clipRect = (
  poly: readonly number[],
  stride: number,
  zAxis: number,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
): number[] =>
  clip(
    clip(
      clip(clip(poly, stride, 0, x0, 1), stride, 0, x1, -1),
      stride,
      zAxis,
      z0,
      1,
    ),
    stride,
    zAxis,
    z1,
    -1,
  );

function flatXZ(poly: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < poly.length; i += 3) {
    out.push(poly[i] as number, poly[i + 2] as number);
  }
  return out;
}

function boundsXZ(
  poly: readonly number[],
  stride: number,
  zAxis: number,
): readonly [number, number, number, number] {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < poly.length; i += stride) {
    x0 = Math.min(x0, poly[i] as number);
    x1 = Math.max(x1, poly[i] as number);
    z0 = Math.min(z0, poly[i + zAxis] as number);
    z1 = Math.max(z1, poly[i + zAxis] as number);
  }
  return [x0, x1, z0, z1];
}

function overlapsFloor(
  floor: Floor | null,
  highest: number,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
): floor is Floor {
  return (
    floor !== null &&
    highest > 0 &&
    x1 >= floor.x0 &&
    z1 >= floor.z0 &&
    x0 <= floor.x0 + floor.cols * FLOOR_CELL &&
    z0 <= floor.z0 + floor.rows * FLOOR_CELL
  );
}

/** The outlines on the ground, as x, z pairs, of a triangle of x, y, z triples wherever it is within the band. */
function triangleInBand(
  tri: readonly number[],
  floor: Floor | null,
  highest: number,
): number[][] {
  const above = clip(tri, 3, 1, BODY_BAND.from, 1);
  if (above.length === 0) return [];
  const [x0, x1, z0, z1] = boundsXZ(above, 3, 2);
  if (!overlapsFloor(floor, highest, x0, x1, z0, z1)) {
    return [flatXZ(clip(above, 3, 1, BODY_BAND.to, -1))];
  }
  // Over a floor, the band's top follows the floor, cell by cell.
  const out: number[][] = [];
  for (
    let i = Math.floor((x0 - floor.x0) / FLOOR_CELL);
    i <= Math.floor((x1 - floor.x0) / FLOOR_CELL);
    i++
  ) {
    for (
      let j = Math.floor((z0 - floor.z0) / FLOOR_CELL);
      j <= Math.floor((z1 - floor.z0) / FLOOR_CELL);
      j++
    ) {
      const cx = floor.x0 + i * FLOOR_CELL;
      const cz = floor.z0 + j * FLOOR_CELL;
      const cell = clipRect(
        above,
        3,
        2,
        cx,
        cx + FLOOR_CELL,
        cz,
        cz + FLOOR_CELL,
      );
      if (cell.length === 0) continue;
      const top = Math.max(
        0,
        deckAt([floor], cx + FLOOR_CELL / 2, cz + FLOOR_CELL / 2),
      );
      out.push(flatXZ(clip(cell, 3, 1, top + BODY_BAND.to, -1)));
    }
  }
  return out;
}

function addPolyToSquares(
  squares: Map<number, number[]>,
  poly: readonly number[],
  side: number,
): void {
  const [x0, x1, z0, z1] = boundsXZ(poly, 2, 1);
  for (let i = Math.floor(x0 / side); i <= Math.floor(x1 / side); i++) {
    for (let j = Math.floor(z0 / side); j <= Math.floor(z1 / side); j++) {
      const whole =
        x0 >= i * side &&
        x1 <= (i + 1) * side &&
        z0 >= j * side &&
        z1 <= (j + 1) * side;
      const cut = whole
        ? poly
        : clipRect(
            poly,
            2,
            1,
            i * side,
            (i + 1) * side,
            j * side,
            (j + 1) * side,
          );
      if (cut.length === 0) continue;
      const key = (i + 32768) * 65536 + (j + 32768);
      const square = squares.get(key);
      if (square === undefined) squares.set(key, cut.slice());
      else for (const v of cut) square.push(v);
    }
  }
}

function addPartSolids(
  part: Part,
  floor: Floor | null,
  highest: number,
  side: number,
  squares: Map<number, number[]>,
): void {
  const p = part.positions;
  const grows = (v: number): boolean => (part.channels.grow?.[v] ?? 0) > 0;
  for (let t = 0; t + 2 < part.indices.length; t += 3) {
    const vs = [
      part.indices[t] as number,
      part.indices[t + 1] as number,
      part.indices[t + 2] as number,
    ];
    if (vs.some(grows)) continue;
    const ys = vs.map((v) => p[v * 3 + 1] as number);
    if (
      Math.max(...ys) < BODY_BAND.from ||
      Math.min(...ys) > highest + BODY_BAND.to
    ) {
      continue;
    }
    const tri = vs.flatMap((v) => [
      p[v * 3] as number,
      p[v * 3 + 1] as number,
      p[v * 3 + 2] as number,
    ]);
    for (const poly of triangleInBand(tri, floor, highest)) {
      if (poly.length > 0) addPolyToSquares(squares, poly, side);
    }
  }
}

/**
 * The solids of a built thing placed at (x, y, z) and turned by `yaw` as Three
 * turns it: the outline of its solid parts wherever they pass through a
 * walker's body, from `BODY_BAND.from` above the thing's base to `BODY_BAND.to`
 * above the ground or the walkable floor there (`floorOf`), such as a step a
 * walker climbs. A beam that slants through that band blocks along its length
 * even with its ends above and below it. A part wholly above or below the
 * band blocks nothing, so a walker passes under a lintel and through a doorway
 * between two stones. A piece that only grows in as the thing declines, such
 * as fallen stone, blocks nothing either.
 *
 * The outline is one convex shape for each square of the thing's own frame
 * that holds some of it. A square's diagonal is a body's width, so a shape
 * never closes a gap that a body fits through, and a ring, an eave or a bough
 * blocks along itself and never across the ground it bounds.
 */
export function piecesShapes(
  parts: readonly Part[],
  at: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly yaw: number;
  },
): SolidShape[] {
  const side = BODY_RADIUS * Math.SQRT2;
  const floor = floorOf(parts, { x: 0, y: 0, z: 0, yaw: 0 });
  const highest = floor === null ? 0 : Math.max(0, ...floor.tops);
  /** The outline in each square, as x, z pairs in the thing's own frame. */
  const squares = new Map<number, number[]>();
  for (const part of parts) {
    if (part.collision !== "solid") continue;
    addPartSolids(part, floor, highest, side, squares);
  }
  const c = Math.cos(at.yaw);
  const s = Math.sin(at.yaw);
  const shapes: SolidShape[] = [];
  for (const local of squares.values()) {
    const points: number[] = [];
    for (let i = 0; i + 1 < local.length; i += 2) {
      points.push(
        at.x + (local[i] as number) * c + (local[i + 1] as number) * s,
        at.z - (local[i] as number) * s + (local[i + 1] as number) * c,
      );
    }
    shapes.push({ points });
  }
  return shapes;
}
