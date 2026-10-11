// The land's edge. A world's land is a rectangle with rounded corners, `size`
// meters wide, west to east, and `size / aspect` deep, north to south; past
// its edge is the wild. A world laid out from code takes the proportions of
// the journal's two pages side by side (`LAND_ASPECT`), so its map fills the
// journal's first spread at whatever scale fits it; a world without an
// aspect, such as the proving ground, is square.

/** A world's land, as `WorldSpec` and `WorldPlaces` carry it: its width, and how much wider than deep it is (1 if absent). */
export interface LandOutline {
  readonly size: number;
  readonly aspect?: number;
}

/** The journal's spread, two 520 by 660 pages: the proportions every world laid out from code takes. */
export const LAND_ASPECT = 1040 / 660;
/** A squircle's share of the square round it: |x|⁴ + |z|⁴ ≤ r⁴ holds 4Γ(5/4)² / Γ(3/2) r². */
const SQUIRCLE = 3.7081;

/** How far the land reaches from its middle, meters: east and west (`x`), and north and south (`z`). */
export const landReach = (land: LandOutline): { readonly x: number; readonly z: number } => ({ x: land.size / 2, z: land.size / 2 / (land.aspect ?? 1) });

/**
 * How far (x, z) lies past the land's edge, meters: negative inside, zero on
 * it. The edge runs straight along the land's long sides and turns its
 * corners as a squircle (|x|⁴ + |z|⁴ = r⁴) as deep as the land, so a square
 * land is exactly the rounded square it has always been.
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

/** The land's ground, square meters: its rectangle less what its squircle corners leave out. */
export function landArea(land: LandOutline): number {
  const h = landReach(land);
  const r = Math.min(h.x, h.z);
  return 4 * h.x * h.z - (4 - SQUIRCLE) * r * r;
}

/** Whether (x, z) lies within the land's rectangle, at least `margin` meters in from its sides: where things may be placed. */
export function withinLand(land: LandOutline, x: number, z: number, margin = 0): boolean {
  const h = landReach(land);
  return Math.abs(x) <= h.x - margin && Math.abs(z) <= h.z - margin;
}
