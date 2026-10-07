// Reading a building's plan: its masses and their walls, the roofline each
// wall rises to, where each opening sits, and where the building gives way
// first as it declines. Every part of a building reads the plan through
// these, so walls, roofs, openings, dressing and feature agree by
// construction.

import type { BuildingPlan, Mass, Opening, Vec3 } from "@gaia/schema";
import { type Channels, type V3, clamp, fbm3 } from "../kit.ts";

/** One wall seen from outside: its left end at ground level, the direction to its right end, and its outward normal. */
export interface Wall {
  readonly o: V3;
  readonly u: V3;
  readonly n: V3;
  readonly length: number;
  /** The mass it belongs to, as an index into the plan's masses. */
  readonly mass: number;
}

/** A round turret's walls: an octagon whose faces stand `width / 2` from its center. */
const ROUND_SIDES = 8;

/** The walls of one mass, in order: front (+z) first, then clockwise seen from above. */
function massWalls(m: Mass, index: number): Wall[] {
  if (m.round) {
    const apothem = m.width / 2;
    const side = 2 * apothem * Math.tan(Math.PI / ROUND_SIDES);
    return Array.from({ length: ROUND_SIDES }, (_, k) => {
      const a = (k / ROUND_SIDES) * Math.PI * 2;
      const n: V3 = [Math.sin(a), 0, Math.cos(a)];
      const u: V3 = [n[2], 0, -n[0]];
      const o: V3 = [m.x + n[0] * apothem - (u[0] * side) / 2, 0, m.z + n[2] * apothem - (u[2] * side) / 2];
      return { o, u, n, length: side, mass: index };
    });
  }
  const hw = m.width / 2;
  const hd = m.depth / 2;
  return [
    { o: [m.x - hw, 0, m.z + hd], u: [1, 0, 0], n: [0, 0, 1], length: m.width, mass: index },
    { o: [m.x + hw, 0, m.z + hd], u: [0, 0, -1], n: [1, 0, 0], length: m.depth, mass: index },
    { o: [m.x + hw, 0, m.z - hd], u: [-1, 0, 0], n: [0, 0, -1], length: m.width, mass: index },
    { o: [m.x - hw, 0, m.z - hd], u: [0, 0, 1], n: [-1, 0, 0], length: m.depth, mass: index },
  ];
}

/** Every wall of every mass, including those another mass hides; `shownWalls` leaves those out. */
export function wallsOf(plan: BuildingPlan): Wall[] {
  return plan.masses.flatMap((m, i) => massWalls(m, i));
}

export const massOf = (plan: BuildingPlan, w: Wall): Mass => plan.masses[w.mass] as Mass;

/** A point on a wall: `s` along it, `y` up, `d` out from its face. */
export const on = (w: Wall, s: number, y: number, d = 0): V3 => [w.o[0] + w.u[0] * s + w.n[0] * d, y, w.o[2] + w.u[2] * s + w.n[2] * d];

/** The height of a mass's eaves. */
export const wallTop = (plan: BuildingPlan, m: Mass = plan.masses[0] as Mass): number => plan.floor + m.wallHeight;

/** How far a mass's roof reaches along its ridge and across it, from its center. */
export function spanOf(m: Mass): { halfLength: number; halfSpan: number } {
  const alongX = m.ridge === "x";
  return { halfLength: (alongX ? m.width : m.depth) / 2, halfSpan: (alongX ? m.depth : m.width) / 2 };
}

/** A point in a mass's roof coordinates: `a` along its ridge, `b` across it, from its center. */
export function roofCoords(m: Mass, x: number, z: number): { a: number; b: number } {
  const dx = x - m.x;
  const dz = z - m.z;
  return m.ridge === "x" ? { a: dx, b: dz } : { a: dz, b: dx };
}

/** How steeply a hipped end falls: as the slopes do, or more steeply for a half-hip's small hip. */
export function hipSlope(m: Mass): number {
  const k = m.rise / spanOf(m).halfSpan;
  return m.roof === "half-hip" ? 2.2 * k : k;
}

/** The height of a hipped end's plane at `a` along the ridge. A half-hip keeps the lower part of its gables. */
export function hipPlane(m: Mass, a: number, top: number): number {
  const { halfLength, halfSpan } = spanOf(m);
  if (m.roof === "hip") return top + m.rise - hipSlope(m) * (Math.abs(a) - Math.max(0, halfLength - halfSpan));
  const cut = (0.45 * m.rise) / hipSlope(m);
  return top + m.rise - hipSlope(m) * (Math.abs(a) - (halfLength - cut));
}

/**
 * How far a hipped or half-hipped roof drops below its gabled slopes at
 * (a, b): the end planes that cut the gables back. Zero for every other form.
 */
export function hipDrop(m: Mass, a: number, b: number, top: number): number {
  if ((m.roof !== "hip" && m.roof !== "half-hip") || !m.ends[a < 0 ? 0 : 1]) return 0;
  const slope = top + m.rise - (m.rise / spanOf(m).halfSpan) * Math.abs(b);
  return Math.max(0, slope - hipPlane(m, a, top));
}

/** The height of a mass's roof plane above (x, z): what its walls rise to and its covering lies on. */
export function roofY(plan: BuildingPlan, m: Mass, x: number, z: number): number {
  const top = wallTop(plan, m);
  if (m.roof === "cone") return top + m.rise * (1 - Math.hypot(x - m.x, z - m.z) / (m.width / 2));
  const { a, b } = roofCoords(m, x, z);
  const { halfSpan } = spanOf(m);
  if (m.roof === "lean-to") return top + m.rise * (1 - (m.fall * b + halfSpan) / (2 * halfSpan));
  return top + m.rise - (m.rise / halfSpan) * Math.abs(b) - hipDrop(m, a, b, top);
}

/** Height of a wall's top at `s`: level under the eaves, rising under a gable or along a lean-to's slope. */
export function topAt(plan: BuildingPlan, w: Wall, s: number): number {
  const m = massOf(plan, w);
  if (m.roof === "cone") return wallTop(plan, m);
  const p = on(w, clamp(s, 0, w.length), 0);
  return Math.max(wallTop(plan, m), roofY(plan, m, p[0], p[2]));
}

/** The highest a wall's top reaches, and where along it. */
export function peakOf(plan: BuildingPlan, w: Wall): { s: number; y: number } {
  let best = { s: 0, y: -Infinity };
  for (let k = 0; k <= 16; k++) {
    const s = (w.length * k) / 16;
    const y = topAt(plan, w, s);
    if (y > best.y + 1e-6) best = { s, y };
  }
  return best;
}

/** True when a point lies inside a mass: within its footprint, `margin` in from its walls, and under its roof. */
export function insideMass(plan: BuildingPlan, m: Mass, p: Vec3, margin = 0): boolean {
  const inFoot = m.round ? Math.hypot(p[0] - m.x, p[2] - m.z) < m.width / 2 - margin : Math.abs(p[0] - m.x) < m.width / 2 - margin && Math.abs(p[2] - m.z) < m.depth / 2 - margin;
  return inFoot && p[1] > -plan.footing && p[1] < roofY(plan, m, p[0], p[2]);
}

/** True when a point just outside a wall is inside another mass, so nothing there shows. */
export function hidden(plan: BuildingPlan, w: Wall, s: number, y: number): boolean {
  const p = on(w, s, y, 0.06);
  return plan.masses.some((m, i) => i !== w.mass && insideMass(plan, m, p));
}

/** The walls some part of which shows: a wall wholly inside another mass is left out. */
export function shownWalls(plan: BuildingPlan): Wall[] {
  return wallsOf(plan).filter((w) => {
    const top = wallTop(plan, massOf(plan, w));
    for (let i = 0; i <= 6; i++) {
      const s = (w.length * (i + 0.5)) / 7;
      for (const y of [plan.floor + 0.3, (plan.floor + top) / 2, top - 0.1, topAt(plan, w, s) - 0.15]) if (!hidden(plan, w, s, y)) return true;
    }
    return false;
  });
}

/**
 * How much coarser a big building's fine work is (studs, plaster cells,
 * plinth stones, ivy), 1 for a cottage: a power of how many times a
 * cottage's wall area its shown walls cover, so every building keeps its
 * triangle budget however many masses it has.
 */
export function coarseness(plan: BuildingPlan): number {
  const area = shownWalls(plan).reduce((sum, w) => sum + w.length * (peakOf(plan, w).y + wallTop(plan, massOf(plan, w))) / 2, 0);
  return Math.max(1, area / 90) ** 0.65;
}

/** The wall an opening is in, and how far along it. */
export function placeOf(plan: BuildingPlan, o: Opening): { wall: Wall; s: number } {
  const walls = massWalls(plan.masses[o.mass] as Mass, o.mass);
  const facing = (w: Wall): number => w.n[0] * o.normal[0] + w.n[2] * o.normal[2];
  const wall = walls.reduce((best, w) => (facing(w) > facing(best) ? w : best));
  const s = (o.position[0] - wall.o[0]) * wall.u[0] + (o.position[2] - wall.o[2]) * wall.u[2];
  return { wall, s };
}

export const sameWall = (a: Wall, b: Wall): boolean => a.mass === b.mass && Math.abs(a.n[0] - b.n[0]) < 1e-6 && Math.abs(a.n[2] - b.n[2]) < 1e-6;

/** Rectangles on a wall that stonework and studs keep clear of. */
export function clearings(plan: BuildingPlan, w: Wall, margin: number): { s0: number; s1: number; y0: number; y1: number }[] {
  return plan.openings
    .filter((o) => o.mass === w.mass)
    .map((o) => ({ o, at: placeOf(plan, o) }))
    .filter((x) => sameWall(x.at.wall, w))
    .map(({ o, at }) => ({ s0: at.s - o.width / 2 - margin, s1: at.s + o.width / 2 + margin, y0: o.position[1] - margin, y1: o.position[1] + o.height + margin }));
}

/** The settled lean of a building: a gentle, seeded wobble that grows with `settle`. */
export const wobble = (plan: BuildingPlan, seed: number, p: Vec3, amount: number): number => plan.settle * amount * fbm3(p[0] * 0.35, p[1] * 0.35, p[2] * 0.35, seed, 2);

/** A piece that only withers as vitality falls. */
export const still = (pivot: Vec3, wither: number, extra: Partial<Channels> = {}): Channels => ({ loss: 0, droop: 0, wither, glow: 0, pivot, ...extra });

/**
 * The end of the main mass's ridge a gable chimney stands at: a gable end
 * no other mass joins, with fewer openings, so a waterwheel or tower takes
 * the other. 0 when the main roof has no free gable, so a chimney rises
 * through the ridge.
 */
export function chimneyEnd(plan: BuildingPlan): -1 | 0 | 1 {
  const m = plan.masses[0] as Mass;
  if (m.roof !== "gable" && m.roof !== "half-hip") return 0;
  const { halfLength } = spanOf(m);
  const ax: V3 = m.ridge === "x" ? [1, 0, 0] : [0, 0, 1];
  const free = (sign: number): boolean => {
    for (const across of [-0.8, 0, 0.8]) {
      const p: V3 = [m.x + ax[0] * sign * (halfLength + 0.7) + ax[2] * across, plan.floor + 1, m.z + ax[2] * sign * (halfLength + 0.7) + ax[0] * across];
      if (plan.masses.some((other, i) => i !== 0 && insideMass(plan, other, p, -0.3))) return false;
    }
    // A gable end facing the door would put the chimney across the walk.
    return !(m.ridge === "z" && sign > 0);
  };
  const count = (sign: number): number => plan.openings.filter((o) => o.mass === 0 && sign * (o.normal[0] * ax[0] + o.normal[2] * ax[2]) > 0.5).length;
  const ends = ([-1, 1] as const).filter(free);
  if (ends.length === 0) return 0;
  return ends.reduce((best, e) => (count(e) < count(best) ? e : best));
}

/**
 * Where a declining building gives way first: the front corner away from the
 * door, so a person walking up sees it. Walls crumble and timbers fall there
 * first, the roofs sag and rot through over it, and rubble gathers below.
 */
export interface Ruin {
  readonly x: number;
  readonly z: number;
  /** Meters over which the collapse fades out from the corner. */
  readonly reach: number;
}

export function ruinOf(plan: BuildingPlan): Ruin {
  const door = plan.openings.find((o) => o.kind === "door");
  const side = door !== undefined && Math.abs(door.position[0]) > 0.05 ? -Math.sign(door.position[0]) : plan.width > plan.depth ? 1 : -1;
  // The corner of whichever mass reaches farthest toward that front corner.
  let best = { x: (side * plan.width) / 2, z: plan.depth / 2, d: Infinity };
  for (const m of plan.masses) {
    const x = m.x + (side * m.width) / 2;
    const z = m.z + (m.round ? m.width : m.depth) / 2;
    const d = Math.hypot(x - (side * plan.width) / 2, z - plan.depth / 2);
    if (d < best.d) best = { x, z, d };
  }
  return { x: best.x, z: best.z, reach: clamp(0.62 * Math.max(plan.width, plan.depth), 3.5, 7.5) };
}

/** How much a point lies in the collapse, 0 to 1: most at the weak corner. */
export function ruinAt(r: Ruin, p: Vec3): number {
  const d = Math.hypot(p[0] - r.x, p[2] - r.z);
  const t = clamp(1 - d / r.reach, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * How readily a wall rots through at a point: a little near the top
 * everywhere, a lot in the collapse, and most where both meet.
 */
export function wallRot(plan: BuildingPlan, m: Mass, r: Ruin, p: Vec3): number {
  const up = clamp((p[1] - plan.floor) / Math.max(0.5, wallTop(plan, m) + m.rise * 0.6 - plan.floor), 0, 1);
  const z = ruinAt(r, p);
  return clamp(0.16 + 0.38 * up + z * (0.55 + 0.4 * up), 0, 1);
}
