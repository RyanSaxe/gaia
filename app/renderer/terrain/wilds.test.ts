import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Library } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { createSceneLight } from "@gaia/render";
import { type Terrain, type WildBush, type WorldSpec, WILD_THICKETS, latticeOf, wildPast, wildThicket } from "@gaia/terrain";
import { sweep } from "@gaia/world";
import { createClearings } from "./clearings.ts";
import { COMPOSING, WILD_GROUNDS } from "./looks.ts";
import { made, plantAsk } from "./made.ts";
import { createRegionCovers } from "./regions.ts";
import { SHRUB_CLEARS, outlineOf } from "./understory.ts";
import { createWildGrowth } from "./wilds.ts";

const biomeLib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
const floraLib = new Library(FLORA_PRIMITIVES);
// A flat land 400 m across: the wild's thickets read only where the land ends and the ground's height.
const spec = { size: 400 } as WorldSpec;
const terrain = { spec, lattice: latticeOf(spec) } as Terrain;
// One bush for both of the wild's grounds, so whichever ground a thicket grows in, its bushes are this one.
const [bush] = sweep(COMPOSING.wildBush, COMPOSING.offered?.wildBush ?? COMPOSING.lib, { places: [{}] }).blueprints;
if (bush === undefined) throw new Error("The wild bush's sweep gives no bush.");

/** The wild's growth on `terrain`, its bushes keeping the grass off their feet in `clearings`. */
const wildOn = (clearings: ReturnType<typeof createClearings>) => createWildGrowth(new THREE.Scene(), createSceneLight(), createRegionCovers(), biomeLib, floraLib, clearings);

/** Whether `outline`, at bush `b`'s turn and size, holds the ground at (x, z), as the clearings read an outline. */
function within(b: WildBush, outline: Float32Array, x: number, z: number): boolean {
  const dx = x - b.x;
  const dz = z - b.z;
  const lx = dx * Math.cos(b.yaw) - dz * Math.sin(b.yaw);
  const lz = dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw);
  const a = ((Math.atan2(lz, lx) / (Math.PI * 2)) % 1 + 1) % 1;
  return Math.hypot(lx, lz) < (outline[Math.floor(a * outline.length) % outline.length] as number) * b.scale;
}

describe("the wild's bushes", () => {
  it("keep the grass off their feet as a shrub on the land does: the shrubs' share of each bush's outline at the ground, where it stands, and nothing else", () => {
    const clearings = createClearings(terrain);
    const wild = wildOn(clearings);
    wild.build(WILD_GROUNDS.map(() => bush));
    wild.update(terrain);
    // The land's own outlines: none here. Handing them over draws the window.
    clearings.update([]);
    const ground = outlineOf(made(plantAsk(bush), floraLib));
    const kept = ground.map((r) => r * SHRUB_CLEARS);
    // Every bush of every thicket the window could hold.
    const bushes: WildBush[] = [];
    for (let cj = -12; cj <= 12; cj++) for (let ci = -12; ci <= 12; ci++) bushes.push(...(wildThicket(terrain, ci, cj)?.bushes ?? []));
    // Out past the land's edge, where the wild's thickets gather.
    const [x, z] = [380, 20];
    expect(wildPast(terrain, x, z)).toBeGreaterThan(60);
    clearings.follow(x, z);
    const { uClearing, uClearingOrigin, uClearingSize } = clearings.uniforms;
    const data = uClearing.value.image.data as Uint8Array;
    const side = uClearing.value.image.width;
    const step = uClearingSize.value / side;
    let bare = 0;
    let edge = 0;
    for (let r = 0; r < side; r++) {
      const tz = uClearingOrigin.value.y + (r + 0.5) * step;
      for (let c = 0; c < side; c++) {
        const tx = uClearingOrigin.value.x + (c + 0.5) * step;
        const near = bushes.filter((b) => Math.abs(b.x - tx) < WILD_THICKETS.spread && Math.abs(b.z - tz) < WILD_THICKETS.spread);
        const want = near.some((b) => within(b, kept, tx, tz)) ? 255 : 0;
        if (data[r * side + c] !== want) expect(data[r * side + c], `texel (${c}, ${r})`).toBe(want);
        if (want === 255) bare++;
        // Round a bush's edge, within its outline but past the shrubs' share, the grass stays.
        else if (near.some((b) => within(b, ground, tx, tz))) edge++;
      }
    }
    // The window holds a few dozen bushes.
    expect(bare).toBeGreaterThan(20);
    expect(edge).toBeGreaterThan(bare);
  });

  it("clear nothing before a world gives them, and their own ground once it does", () => {
    const clearings = createClearings(terrain);
    const wild = wildOn(clearings);
    wild.update(terrain);
    const bare = (): number => {
      clearings.update([]);
      clearings.follow(380, 20);
      return (clearings.uniforms.uClearing.value.image.data as Uint8Array).filter((v) => v > 0).length;
    };
    expect(bare()).toBe(0);
    wild.build(WILD_GROUNDS.map(() => bush));
    expect(bare()).toBeGreaterThan(20);
  });
});
