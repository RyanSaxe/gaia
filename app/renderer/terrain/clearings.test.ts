import { describe, expect, it } from "vitest";
import { type Capsule, type Terrain, createLattice } from "@gaia/terrain";
import { type Clearing, createClearings } from "./clearings.ts";

// The clearings read only a bake's lattice: a land 1.2 km across, with its 80 m skirt.
const land = { lattice: createLattice(1360, 1) } as Terrain;
// The page's land: a window of the whole around the person, starting at different x and z.
const window = { lattice: { ...createLattice(640, 1), origin: 100, originZ: -620 } } as Terrain;
const capsules: Capsule[] = [
  { ax: 4, az: 6, bx: 12, bz: 9, radius: 1.6 },
  { ax: 402, az: -303, bx: 402, bz: -303, radius: 2.4 },
];
// A rock's outline: a lobed reach in 16 directions.
const outline = Float32Array.from({ length: 16 }, (_, k) => 1.2 + 0.4 * Math.sin(k * 1.3));
const outlines: Clearing[] = [
  { x: -7, z: 3, yaw: 0.7, scale: 1.5, outline },
  { x: 390, z: -296, yaw: 2.1, scale: 1, outline },
];

/** Whether the ground at (x, z) is kept bare, from the shapes themselves. */
function cleared(x: number, z: number): boolean {
  for (const c of capsules) {
    const abx = c.bx - c.ax;
    const abz = c.bz - c.az;
    const len = abx * abx + abz * abz;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - c.ax) * abx + (z - c.az) * abz) / len)) : 0;
    if (Math.hypot(x - c.ax - abx * t, z - c.az - abz * t) < c.radius) return true;
  }
  for (const c of outlines) {
    const dx = x - c.x;
    const dz = z - c.z;
    const lx = dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw);
    const lz = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw);
    const a = ((Math.atan2(lz, lx) / (Math.PI * 2)) % 1 + 1) % 1;
    if (Math.hypot(lx, lz) < (c.outline[Math.floor(a * c.outline.length) % c.outline.length] as number) * c.scale) return true;
  }
  return false;
}

describe("the clearings' mask", () => {
  it.each([
    ["the whole land", land, [[0, 0], [400, -300]]],
    ["a window of the land", window, [[400, -300]]],
  ] as const)("holds the mask of %s around the grass, each texel cleared exactly where its middle is, and again once the grass moves on", (_, t, spots) => {
    const clearings = createClearings(t);
    clearings.setCapsules(capsules);
    clearings.update(outlines);
    const { uClearing, uClearingOrigin, uClearingSize } = clearings.uniforms;
    for (const [x, z] of spots) {
      clearings.follow(x, z);
      const data = uClearing.value.image.data as Uint8Array;
      const side = uClearing.value.image.width;
      const step = uClearingSize.value / side;
      // The grass reaches 62 m from where it gathers: the window holds all of it.
      expect(Math.abs(uClearingOrigin.value.x + uClearingSize.value / 2 - x)).toBeLessThan(uClearingSize.value / 2 - 62);
      expect(Math.abs(uClearingOrigin.value.y + uClearingSize.value / 2 - z)).toBeLessThan(uClearingSize.value / 2 - 62);
      let bare = 0;
      for (let r = 0; r < side; r++) {
        for (let c = 0; c < side; c++) {
          // Each texel's middle on the ground, as the grass's texture lookup places it.
          const want = cleared(uClearingOrigin.value.x + (c + 0.5) * step, uClearingOrigin.value.y + (r + 0.5) * step) ? 255 : 0;
          if (data[r * side + c] !== want) expect(data[r * side + c], `texel (${c}, ${r}) around (${x}, ${z})`).toBe(want);
          if (want === 255) bare++;
        }
      }
      // Both shapes near where the grass gathers are in the window.
      expect(bare).toBeGreaterThan(40);
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
