// What a person cannot walk through: tree trunks, rocks, bushes and a
// house's walls. Each solid is the convex hull of its outline on the ground,
// rounded by a radius (a trunk is one point rounded by the trunk's own
// radius), so its edge has a direction everywhere and a walker slides around
// it without catching. Built once from placements; every step of a walk asks
// how far the nearest edge is.

import type { BuildingPlan, Part } from "@gaia/schema";
import { type BuildingSite, siteToWorld } from "./site.ts";

/** One thing in the way, as its outline on the ground in world meters. */
export type SolidShape =
  /** A disc, such as a trunk at its base. */
  | { readonly x: number; readonly z: number; readonly radius: number }
  /** Any outline, as x, z pairs: its convex hull blocks. */
  | { readonly points: readonly number[] };

interface Solid {
  /** The hull's corners as x, z pairs, counter-clockwise; one corner for a disc. */
  readonly hull: Float64Array;
  readonly round: number;
}

/** The solids of one world, indexed by ground cells so a step only asks about the few nearby. */
export interface Solids {
  readonly count: number;
  /** @internal Solid indices by cell. */
  readonly cells: ReadonlyMap<number, readonly number[]>;
  /** @internal */
  readonly items: readonly Solid[];
}

/** Meters per index cell. */
const CELL = 4;
/** Every solid is indexed this far past its edge, so a query within `REACH` of a point finds it from the point's cell alone. */
const REACH = 2;

const cellKey = (ix: number, iz: number): number => (ix + 32768) * 65536 + (iz + 32768);

/** Andrew's monotone chain: the convex hull of x, z pairs, counter-clockwise, without collinear corners. */
function hullOf(points: readonly number[]): Float64Array {
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < points.length; i += 2) pts.push([points[i] as number, points[i + 1] as number]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return Float64Array.from(pts.flat());
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return Float64Array.from([...lower, ...upper].flat());
}

/** Indexes solids from their outlines on the ground. */
export function solidsOf(shapes: readonly SolidShape[]): Solids {
  const items: Solid[] = shapes.map((s) => ("points" in s ? { hull: hullOf(s.points), round: 0 } : { hull: Float64Array.of(s.x, s.z), round: s.radius }));
  const cells = new Map<number, number[]>();
  items.forEach((solid, i) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < solid.hull.length; k += 2) {
      x0 = Math.min(x0, solid.hull[k] as number);
      x1 = Math.max(x1, solid.hull[k] as number);
      z0 = Math.min(z0, solid.hull[k + 1] as number);
      z1 = Math.max(z1, solid.hull[k + 1] as number);
    }
    const pad = solid.round + REACH;
    for (let iz = Math.floor((z0 - pad) / CELL); iz <= Math.floor((z1 + pad) / CELL); iz++) {
      for (let ix = Math.floor((x0 - pad) / CELL); ix <= Math.floor((x1 + pad) / CELL); ix++) {
        const key = cellKey(ix, iz);
        const list = cells.get(key);
        if (list === undefined) cells.set(key, [i]);
        else list.push(i);
      }
    }
  });
  return { count: items.length, cells, items };
}

export const NO_SOLIDS: Solids = solidsOf([]);

/** A placed component's outline on the ground: its reach in `outline.length` directions at scale 1, turned and scaled as Three places it, times `share`. */
export function outlineShape(x: number, z: number, yaw: number, scale: number, outline: ArrayLike<number>, share = 1): SolidShape {
  const k = outline.length;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const points: number[] = [];
  for (let i = 0; i < k; i++) {
    const a = ((i + 0.5) / k) * Math.PI * 2;
    const r = (outline[i] as number) * scale * share;
    if (r <= 0) continue;
    const lx = Math.cos(a) * r;
    const lz = Math.sin(a) * r;
    // Three's rotation about y turns local x toward (cos, -sin).
    points.push(x + lx * c + lz * s, z - lx * s + lz * c);
  }
  return points.length > 0 ? { points } : { x, z, radius: 0.05 };
}

/** A building's walls: its footprint's rectangle on its site. */
export function wallsShape(plan: BuildingPlan, site: BuildingSite): SolidShape {
  const w = plan.width / 2;
  const d = plan.depth / 2;
  return { points: [[-w, -d], [w, -d], [w, d], [-w, d]].flatMap(([lx, lz]) => siteToWorld(site, lx as number, lz as number)) };
}

/** A walker's body, from just above the ground to the top of its head, meters above a thing's base. */
export const BODY_BAND = { from: 0.1, to: 1.8 } as const;

/**
 * The solids of a built thing standing at (x, y, z), turned by `yaw` as Three
 * turns it: each solid piece's outline across a walker's body height. A
 * piece wholly above or below that band stops nothing, so a walker passes
 * under a lintel and through a doorway between two stones. Nor does a piece
 * that only grows in as the thing declines, such as fallen stone.
 */
export function piecesShapes(parts: readonly Part[], at: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }): SolidShape[] {
  const c = Math.cos(at.yaw);
  const s = Math.sin(at.yaw);
  const shapes: SolidShape[] = [];
  for (const part of parts) {
    if (part.collision !== "solid") continue;
    const byPiece = new Map<number, number[]>();
    for (let v = 0; v * 3 < part.positions.length; v++) {
      const y = part.positions[v * 3 + 1] as number;
      if (y < BODY_BAND.from || y > BODY_BAND.to || (part.channels.grow?.[v] ?? 0) > 0) continue;
      const lx = part.positions[v * 3] as number;
      const lz = part.positions[v * 3 + 2] as number;
      const piece = part.piece[v * 2] as number;
      let points = byPiece.get(piece);
      if (points === undefined) byPiece.set(piece, (points = []));
      points.push(at.x + lx * c + lz * s, at.z - lx * s + lz * c);
    }
    for (const points of byPiece.values()) shapes.push({ points });
  }
  return shapes;
}

/** The nearest edge to a point: signed distance (negative inside) and the outward direction there. */
export interface Edge {
  distance: number;
  nx: number;
  nz: number;
}

function edgeOf(solid: Solid, x: number, z: number, out: Edge): void {
  const h = solid.hull;
  const n = h.length / 2;
  if (n === 1) {
    const dx = x - (h[0] as number);
    const dz = z - (h[1] as number);
    const d = Math.hypot(dx, dz);
    out.distance = d - solid.round;
    out.nx = d > 1e-9 ? dx / d : 1;
    out.nz = d > 1e-9 ? dz / d : 0;
    return;
  }
  // Outside: the nearest point on any edge. Inside: the nearest edge's line.
  let inside = n >= 3;
  let deepest = -Infinity;
  let inX = 1;
  let inZ = 0;
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  for (let i = 0; i < n; i++) {
    const ax = h[i * 2] as number;
    const az = h[i * 2 + 1] as number;
    const j = (i + 1) % n;
    const ex = (h[j * 2] as number) - ax;
    const ez = (h[j * 2 + 1] as number) - az;
    const len2 = ex * ex + ez * ez;
    if (len2 < 1e-18) continue;
    const len = Math.sqrt(len2);
    // Counter-clockwise, so the outward normal of (ex, ez) is (ez, -ex).
    const side = ((x - ax) * ez - (z - az) * ex) / len;
    if (side > 0) inside = false;
    if (side > deepest) {
      deepest = side;
      inX = ez / len;
      inZ = -ex / len;
    }
    const u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len2));
    const px = ax + ex * u;
    const pz = az + ez * u;
    const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d2 < best) {
      best = d2;
      bx = px;
      bz = pz;
    }
  }
  if (inside) {
    out.distance = deepest - solid.round;
    out.nx = inX;
    out.nz = inZ;
    return;
  }
  const d = Math.sqrt(best);
  out.distance = d - solid.round;
  out.nx = d > 1e-9 ? (x - bx) / d : inX;
  out.nz = d > 1e-9 ? (z - bz) / d : inZ;
}

const probe: Edge = { distance: 0, nx: 0, nz: 0 };

/**
 * The nearest solid's edge to (x, z), written into `out`; `out.distance` is
 * `REACH` when nothing is that close. Accurate within `REACH` meters.
 */
export function nearestEdge(solids: Solids, x: number, z: number, out: Edge): Edge {
  out.distance = REACH;
  out.nx = 1;
  out.nz = 0;
  const list = solids.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (list === undefined) return out;
  for (const i of list) {
    edgeOf(solids.items[i] as Solid, x, z, probe);
    if (probe.distance < out.distance) {
      out.distance = probe.distance;
      out.nx = probe.nx;
      out.nz = probe.nz;
    }
  }
  return out;
}

const scratch: Edge = { distance: 0, nx: 0, nz: 0 };

/** How far (x, z) is from the nearest solid's edge, negative inside one; at most 2 m. */
export const clearanceAt = (solids: Solids, x: number, z: number): number => nearestEdge(solids, x, z, scratch).distance;
