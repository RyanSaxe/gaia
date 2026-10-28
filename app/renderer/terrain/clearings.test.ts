import { describe, expect, it } from "vitest";
import { type Capsule, type Terrain, createLattice } from "@gaia/terrain";
import { type Clearing, type Clearings, type ClearingsNear, createClearings } from "./clearings.ts";

// The clearings read only a bake's lattice: a land 1.2 km across, with its 80 m skirt, so its mask ends 680 m out.
const land = { lattice: createLattice(1360, 1) } as Terrain;
// The page's land: a window of the whole land around the person, with different x and z starts, ending at x 739 m and z 19 m.
const window = { lattice: { ...createLattice(640, 1), origin: 100, originZ: -620 } } as Terrain;
const capsules: Capsule[] = [
  { ax: 4, az: 6, bx: 12, bz: 9, radius: 1.6 },
  { ax: 402, az: -303, bx: 402, bz: -303, radius: 2.4 },
  // A walk across the page's land window's far edge in z, into land the window does not contain.
  { ax: 440, az: 10, bx: 452, bz: 34, radius: 1.8 },
];
// A rock's outline: a lobed reach in 16 directions.
const outline = Float32Array.from({ length: 16 }, (_, k) => 1.2 + 0.4 * Math.sin(k * 1.3));
const outlines: Clearing[] = [
  { x: -7, z: 3, yaw: 0.7, scale: 1.5, outline },
  { x: 390, z: -296, yaw: 2.1, scale: 1, outline },
  // A rock near the land's edge.
  { x: 676, z: 8, yaw: 0.4, scale: 1.2, outline },
];
// Bushes of the wild, past the land's edge: one just past it, one well out, and one too far from any window drawn here.
const wild: Clearing[] = [
  { x: 684, z: 14, yaw: 1.1, scale: 1.3, outline },
  { x: 742, z: -40, yaw: 4, scale: 0.9, outline },
  { x: 2400, z: 0, yaw: 0, scale: 1, outline },
];

/** Whether outline `c` covers the ground at (x, z). */
function within(c: Clearing, x: number, z: number): boolean {
  const dx = x - c.x;
  const dz = z - c.z;
  const lx = dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw);
  const lz = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw);
  const a = ((Math.atan2(lz, lx) / (Math.PI * 2)) % 1 + 1) % 1;
  return Math.hypot(lx, lz) < (c.outline[Math.floor(a * c.outline.length) % c.outline.length] as number) * c.scale;
}

/** Whether the capsules, the land's outlines or `more` keep the ground at (x, z) bare, computed from the shapes themselves. */
function cleared(x: number, z: number, more: readonly Clearing[] = []): boolean {
  for (const c of capsules) {
    const abx = c.bx - c.ax;
    const abz = c.bz - c.az;
    const len = abx * abx + abz * abz;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - c.ax) * abx + (z - c.az) * abz) / len)) : 0;
    if (Math.hypot(x - c.ax - abx * t, z - c.az - abz * t) < c.radius) return true;
  }
  return [...outlines, ...more].some((c) => within(c, x, z));
}

/**
 * Moves the grass to (x, z) and checks every window texel against `want` at
 * its center on the ground, where the grass's texture lookup places it.
 * Returns the window's texels and how many are bare.
 */
function holds(clearings: Clearings, x: number, z: number, want: (x: number, z: number) => boolean): { data: Uint8Array; bare: number } {
  clearings.follow(x, z);
  const { uClearing, uClearingOrigin, uClearingSize } = clearings.uniforms;
  const data = uClearing.value.image.data as Uint8Array;
  const side = uClearing.value.image.width;
  const step = uClearingSize.value / side;
  // The grass reaches 62 m from its center, and the window contains all of it.
  expect(Math.abs(uClearingOrigin.value.x + uClearingSize.value / 2 - x)).toBeLessThan(uClearingSize.value / 2 - 62);
  expect(Math.abs(uClearingOrigin.value.y + uClearingSize.value / 2 - z)).toBeLessThan(uClearingSize.value / 2 - 62);
  let bare = 0;
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      const expected = want(uClearingOrigin.value.x + (c + 0.5) * step, uClearingOrigin.value.y + (r + 0.5) * step) ? 255 : 0;
      if (data[r * side + c] !== expected) expect(data[r * side + c], `texel (${c}, ${r}) around (${x}, ${z})`).toBe(expected);
      if (expected === 255) bare++;
    }
  }
  return { data: data.slice(), bare };
}

/** A source of the wild's bushes, as the wild provides them: those that could reach the window's ground, plus the far one, which reaches none of it. */
const wildNear: ClearingsNear = (x0, z0, x1, z1) => wild.filter((c, k) => k === 2 || (c.x + 3 > x0 && c.x - 3 < x1 && c.z + 3 > z0 && c.z - 3 < z1));

describe("the clearings' mask", () => {
  it.each([
    ["the whole land", land, [[0, 0], [400, -300]]],
    // Around (450, -20) the window extends past the land window's edge at z 19 m, where the walk continues.
    ["a window of the land", window, [[400, -300], [450, -20]]],
  ] as const)("holds the mask of %s around the grass, each texel cleared exactly where its middle is, and again once the grass moves on", (_, t, spots) => {
    const clearings = createClearings(t);
    clearings.setCapsules(capsules);
    clearings.update(outlines);
    for (const [x, z] of spots) {
      // The shapes near the grass's center are in the window.
      expect(holds(clearings, x, z, (x, z) => cleared(x, z)).bare).toBeGreaterThan(40);
    }
  });

  it("clears the ground under the outlines asked for each window: a wild bush past the land its own, and nothing else, and the land's as it was", () => {
    const plain = createClearings(land);
    const asked = createClearings(land);
    for (const c of [plain, asked]) c.setCapsules(capsules);
    asked.setNear(wildNear);
    for (const c of [plain, asked]) c.update(outlines);
    // Windows on the land alone, and one across the land's edge at 680 m out into the wild.
    for (const [x, z] of [[0, 0], [400, -300], [650, 0]] as const) {
      const was = holds(plain, x, z, (x, z) => cleared(x, z));
      const now = holds(asked, x, z, (x, z) => cleared(x, z, wild));
      const { uClearing, uClearingOrigin, uClearingSize } = asked.uniforms;
      const side = uClearing.value.image.width;
      const step = uClearingSize.value / side;
      let wilder = 0;
      now.data.forEach((v, k) => {
        const at = [uClearingOrigin.value.x + ((k % side) + 0.5) * step, uClearingOrigin.value.y + (Math.floor(k / side) + 0.5) * step] as const;
        if (wild.some((c) => within(c, ...at))) wilder++;
        // Wherever there is no wild bush, the mask is the land's alone.
        else if (v !== was.data[k]) expect(v, `texel ${k} around (${x}, ${z})`).toBe(was.data[k]);
      });
      // Only the window across the edge contains the wild's two near bushes.
      if (x === 650) expect(wilder).toBeGreaterThan(30);
      else expect(wilder).toBe(0);
    }
  });

  it("keeps short turf apart from bare ground: a turf outline marks only the turf's mask", () => {
    const clearings = createClearings(land);
    const turf = Float32Array.from({ length: 16 }, () => 1.5);
    clearings.update([{ x: 20, z: 20, yaw: 0, scale: 1, outline: turf, turf: true }]);
    clearings.follow(20, 20);
    const { uClearing, uTurf, uClearingOrigin, uClearingSize } = clearings.uniforms;
    const side = uTurf.value.image.width;
    const step = uClearingSize.value / side;
    const texel = (x: number, z: number): number => Math.floor((z - uClearingOrigin.value.y) / step) * side + Math.floor((x - uClearingOrigin.value.x) / step);
    expect((uTurf.value.image.data as Uint8Array)[texel(20.2, 20.2)]).toBe(255);
    expect((uTurf.value.image.data as Uint8Array)[texel(24, 20)]).toBe(0);
    expect((uClearing.value.image.data as Uint8Array).every((v) => v === 0)).toBe(true);
  });
});
