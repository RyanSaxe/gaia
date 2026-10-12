import { describe, expect, it } from "vitest";
import { TILE, type WorldSpec, frameOf, worldOf } from "@gaia/terrain";
import { createStanding, seenTo } from "./standing.ts";
import { GONE } from "./woods.ts";

// A 3 km world: its land is some thirteen tiles a side.
const spec: WorldSpec = { size: 3000, regions: [] };
const frame = frameOf(spec);
const per = Math.ceil(frame.n / TILE.size);
/** A screen that sees a 1 m thing to about 500 m. */
const FOCAL = 2000;

/** The tile's middle, meters. */
const middle = (ti: number, tj: number): [number, number] => [worldOf(frame, (ti + 0.5) * TILE.size), worldOf(frame, (tj + 0.5) * TILE.size)];

describe("what stands on the land, tile by tile", () => {
  it("stands each thing's tiles as far as the largest of its kind can be seen, and lets go of tiles well past that", async () => {
    const stood: string[][] = [];
    const standing = createStanding(() => FOCAL);
    standing.add<string>({ name: "stones", largest: () => 0.5, tile: (ti, tj) => [`${ti},${tj}`], stand: (things) => stood.push([...things]) });
    standing.open(spec);
    await standing.ready(0, 0);
    const reach = seenTo(0.5, FOCAL);
    expect(reach).toBeCloseTo((2 * 0.5 * FOCAL) / GONE.end);
    const held = new Set(stood[stood.length - 1]);
    // Every tile within reach of the middle stands; none far past it does.
    for (let tj = 0; tj < per; tj++) {
      for (let ti = 0; ti < per; ti++) {
        const [x, z] = middle(ti, tj);
        const near = Math.hypot(x, z) - (TILE.size * Math.SQRT2) / 2;
        if (Math.hypot(x, z) + TILE.size < reach) expect(held.has(`${ti},${tj}`), `tile ${ti},${tj}`).toBe(true);
        // Tiles are asked for 150 m before they can be seen, so one a worker brings comes in time.
        if (near > reach + 150) expect(held.has(`${ti},${tj}`), `tile ${ti},${tj}`).toBe(false);
      }
    }
    // Walking far off lets the old tiles go once they lie well past the reach, and stands the new ones.
    standing.follow(1300, 1300);
    for (let k = 0; k < 4; k++) standing.follow(1300, 1300);
    const now = new Set(stood[stood.length - 1]);
    expect(now.size).toBeGreaterThan(0);
    for (const key of now) {
      const [ti, tj] = key.split(",").map(Number) as [number, number];
      const [x, z] = middle(ti, tj);
      expect(Math.hypot(x - 1300, z - 1300) - TILE.size).toBeLessThan(reach + 150 + 200);
    }
  });

  it("drops what a worker brings for a world that has since closed", async () => {
    let release: (() => void) | null = null;
    const late = new Promise<void>((r) => (release = r));
    const stood: number[][] = [];
    const standing = createStanding(() => FOCAL);
    standing.add<number>({ name: "late", largest: () => 0.1, tile: () => late.then(() => [1]), stand: (things) => stood.push([...things]) });
    standing.open(spec);
    standing.follow(0, 0);
    // Another world opens before the first's tiles come.
    standing.open(spec);
    (release as unknown as () => void)();
    await late;
    await new Promise((r) => setTimeout(r, 0));
    standing.follow(0, 0);
    expect(stood.every((things) => things.length === 0)).toBe(true);
  });
});
