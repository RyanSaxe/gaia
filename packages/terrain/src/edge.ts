// Measures the land's outline, a rectangle with rounded corners that is
// `size` meters west to east and `size / aspect` meters north to south. A
// world laid out from code uses `LAND_ASPECT`, so its map fills the journal's
// first spread. A world without an aspect, such as the proving ground, is
// square.

/** A world's land size, as `WorldSpec` and `WorldPlaces` carry it. `aspect` is width over depth and defaults to 1. */
export interface LandOutline {
  readonly size: number;
  readonly aspect?: number;
}

/** Minimum distance in meters from a building site to the land's edge, which keeps buildings off the rim. */
export const BUILDING_MARGIN = 34;

/** The width over height of the journal's spread of two 520 by 660 pages. Every world laid out from code uses it. */
export const LAND_ASPECT = 1040 / 660;
/** The area of the squircle |x|⁴ + |z|⁴ ≤ r⁴ divided by r², which is 4Γ(5/4)² / Γ(3/2). */
const SQUIRCLE = 3.7081;

/** Half the land's width (`x`) and half its depth (`z`), in meters. */
export const landReach = (land: LandOutline): { readonly x: number; readonly z: number } => ({ x: land.size / 2, z: land.size / 2 / (land.aspect ?? 1) });

/**
 * Signed distance in meters from (x, z) to the land's edge, negative inside
 * and zero on it. The edge is straight along the sides, and each corner is a
 * quarter squircle (|x|⁴ + |z|⁴ = r⁴) whose r is half the shorter side.
 */
export function pastTheEdge(land: LandOutline, x: number, z: number): number {
  const h = landReach(land);
  const r = Math.min(h.x, h.z);
  const qx = Math.abs(x) - h.x + r;
  const qz = Math.abs(z) - h.z + r;
  const ox = Math.max(qx, 0);
  const oz = Math.max(qz, 0);
  return (ox ** 4 + oz ** 4) ** 0.25 + Math.min(Math.max(qx, qz), 0) - r;
}

/** The land's area in square meters: its rectangle less the area its squircle corners cut off. */
export function landArea(land: LandOutline): number {
  const h = landReach(land);
  const r = Math.min(h.x, h.z);
  return 4 * h.x * h.z - (4 - SQUIRCLE) * r * r;
}

/** Whether (x, z) lies inside the land's rectangle, at least `margin` meters in from its sides. It ignores the rounded corners. */
export function withinLand(land: LandOutline, x: number, z: number, margin = 0): boolean {
  const h = landReach(land);
  return Math.abs(x) <= h.x - margin && Math.abs(z) <= h.z - margin;
}
