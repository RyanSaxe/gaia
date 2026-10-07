// Reading a building's plan: its walls, where each opening sits, and where
// the building gives way first as it declines. Every part of a building
// reads the plan through these, so walls, roof, openings, dressing and
// feature agree by construction.

import type { BuildingPlan, Opening, Vec3 } from "@gaia/schema";
import { type Channels, type V3, clamp, fbm3 } from "./kit.ts";

/** One wall seen from outside: its left end at ground level, the direction to its right end, and its outward normal. */
export interface Wall {
  readonly o: V3;
  readonly u: V3;
  readonly n: V3;
  readonly length: number;
  /** A gable wall rises to the ridge. */
  readonly gable: boolean;
}

export function wallsOf(plan: BuildingPlan): Wall[] {
  const hw = plan.width / 2;
  const hd = plan.depth / 2;
  return [
    { o: [-hw, 0, hd], u: [1, 0, 0], n: [0, 0, 1], length: plan.width, gable: plan.ridge === "z" },
    { o: [hw, 0, hd], u: [0, 0, -1], n: [1, 0, 0], length: plan.depth, gable: plan.ridge === "x" },
    { o: [hw, 0, -hd], u: [-1, 0, 0], n: [0, 0, -1], length: plan.width, gable: plan.ridge === "z" },
    { o: [-hw, 0, -hd], u: [0, 0, 1], n: [-1, 0, 0], length: plan.depth, gable: plan.ridge === "x" },
  ];
}

/** A point on a wall: `s` along it, `y` up, `d` out from its face. */
export const on = (w: Wall, s: number, y: number, d = 0): V3 => [w.o[0] + w.u[0] * s + w.n[0] * d, y, w.o[2] + w.u[2] * s + w.n[2] * d];

export const wallTop = (plan: BuildingPlan): number => plan.floor + plan.wallHeight;

/** Height of a wall's top at `s`: level under the eaves, rising to the ridge on a gable. */
export function topAt(plan: BuildingPlan, w: Wall, s: number): number {
  const top = wallTop(plan);
  if (!w.gable) return top;
  const half = w.length / 2;
  return top + plan.rise * Math.max(0, 1 - Math.abs(s - half) / half);
}

/** The wall an opening is in, and how far along it. */
export function placeOf(plan: BuildingPlan, o: Opening): { wall: Wall; s: number } {
  const walls = wallsOf(plan);
  const wall = walls.reduce((best, w) => (w.n[0] * o.normal[0] + w.n[2] * o.normal[2] > best.n[0] * o.normal[0] + best.n[2] * o.normal[2] ? w : best));
  const s = (o.position[0] - wall.o[0]) * wall.u[0] + (o.position[2] - wall.o[2]) * wall.u[2];
  return { wall, s };
}

export const sameWall = (a: Wall, b: Wall): boolean => a.n[0] === b.n[0] && a.n[2] === b.n[2];

/** Rectangles on a wall that stonework and studs keep clear of. */
export function clearings(plan: BuildingPlan, w: Wall, margin: number): { s0: number; s1: number; y0: number; y1: number }[] {
  return plan.openings
    .map((o) => ({ o, at: placeOf(plan, o) }))
    .filter((x) => sameWall(x.at.wall, w))
    .map(({ o, at }) => ({ s0: at.s - o.width / 2 - margin, s1: at.s + o.width / 2 + margin, y0: o.position[1] - margin, y1: o.position[1] + o.height + margin }));
}

/** The settled lean of a building: a gentle, seeded wobble that grows with `settle`. */
export const wobble = (plan: BuildingPlan, seed: number, p: Vec3, amount: number): number => plan.settle * amount * fbm3(p[0] * 0.35, p[1] * 0.35, p[2] * 0.35, seed, 2);

/** A piece that only withers as vitality falls. */
export const still = (pivot: Vec3, wither: number, extra: Partial<Channels> = {}): Channels => ({ loss: 0, droop: 0, wither, glow: 0, pivot, ...extra });

/** The end of the gabled axis a chimney stands at: the end with fewer openings, so a waterwheel or tower takes the other. */
export function chimneyEnd(plan: BuildingPlan): -1 | 1 {
  const ax: Vec3 = plan.ridge === "x" ? [1, 0, 0] : [0, 0, 1];
  const count = (sign: number): number => plan.openings.filter((o) => sign * (o.normal[0] * ax[0] + o.normal[2] * ax[2]) > 0.5).length;
  return count(-1) <= count(1) ? -1 : 1;
}

/**
 * Where a declining building gives way first: the front corner away from the
 * door, so a person walking up sees it. Walls crumble and timbers fall there
 * first, the roof sags and rots through over it, and rubble gathers below.
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
  return { x: (side * plan.width) / 2, z: plan.depth / 2, reach: 0.62 * Math.max(plan.width, plan.depth) };
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
export function wallRot(plan: BuildingPlan, r: Ruin, p: Vec3): number {
  const up = clamp((p[1] - plan.floor) / Math.max(0.5, wallTop(plan) + plan.rise * 0.6 - plan.floor), 0, 1);
  const z = ruinAt(r, p);
  return clamp(0.16 + 0.3 * up + z * (0.55 + 0.4 * up), 0, 1);
}
