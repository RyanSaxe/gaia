import { describe, expect, it } from "vitest";
import { TILE, type WorldSpec, frameOf, worldOf } from "@gaia/terrain";
import { createThingTiles, seenTo } from "./thing-tiles.ts";
import { GONE } from "./woods.ts";

// A 3 km world, whose land is about thirteen tiles a side.
const spec: WorldSpec = { size: 3000, regions: [] };
const frame = frameOf(spec);
const per = Math.ceil(frame.n / TILE.size);
/** A focal length at which a 1 m thing stays visible to about 500 m. */
const FOCAL = 2000;

/** The tile's center in meters. */
const middle = (ti: number, tj: number): [number, number] => [worldOf(frame, (ti + 0.5) * TILE.size), worldOf(frame, (tj + 0.5) * TILE.size)];

describe("what stands on the land, tile by tile", () => {
  it("stands each thing's tiles as far as the largest of its kind can be seen, and lets go of tiles well past that", async () => {
    const placed: string[][] = [];
    const tiles = createThingTiles(() => FOCAL);
    tiles.add<string>({ name: "stones", largest: () => 0.5, tile: (ti, tj) => [`${ti},${tj}`], place: (things) => placed.push([...things]) });
    tiles.open(spec);
    await tiles.ready(0, 0);
    const reach = seenTo(0.5, FOCAL);
    expect(reach).toBeCloseTo((2 * 0.5 * FOCAL) / GONE.end);
    const held = new Set(placed[placed.length - 1]);
    // Every tile within reach of the center is placed, and none far past it is.
    for (let tj = 0; tj < per; tj++) {
      for (let ti = 0; ti < per; ti++) {
        const [x, z] = middle(ti, tj);
        const near = Math.hypot(x, z) - (TILE.size * Math.SQRT2) / 2;
        if (Math.hypot(x, z) + TILE.size < reach) expect(held.has(`${ti},${tj}`), `tile ${ti},${tj}`).toBe(true);
        // Tiles are requested 150 m before they can be seen, so one from a worker arrives in time.
        if (near > reach + 150) expect(held.has(`${ti},${tj}`), `tile ${ti},${tj}`).toBe(false);
      }
    }
    // Walking far off drops the old tiles once they are well past the reach, and places the new ones.
    tiles.follow(1300, 1300);
    for (let k = 0; k < 4; k++) tiles.follow(1300, 1300);
    const now = new Set(placed[placed.length - 1]);
    expect(now.size).toBeGreaterThan(0);
    for (const key of now) {
      const [ti, tj] = key.split(",").map(Number) as [number, number];
      const [x, z] = middle(ti, tj);
      expect(Math.hypot(x - 1300, z - 1300) - TILE.size).toBeLessThan(reach + 150 + 200);
    }
  });

  it("asks a trip's way for only what can be seen from it, and walking for no more while a trip asks", async () => {
    const asked = new Set<string>();
    const tiles = createThingTiles(() => FOCAL);
    tiles.add<string>({ name: "stones", largest: () => 0.5, tile: (ti, tj) => (asked.add(`${ti},${tj}`), Promise.resolve([`${ti},${tj}`])), place: () => undefined });
    tiles.open(spec);
    await tiles.fetch(0, 0);
    const reach = seenTo(0.5, FOCAL);
    // Every tile within sight of the mark is requested, and none past it, with no walking lead.
    for (const key of asked) {
      const [ti, tj] = key.split(",").map(Number) as [number, number];
      const [x, z] = middle(ti, tj);
      expect(Math.hypot(x, z) - (TILE.size * Math.SQRT2) / 2).toBeLessThanOrEqual(reach + 1e-6);
    }
    const byTrip = asked.size;
    expect(byTrip).toBeGreaterThan(0);
    // Walking on far off while a trip requests tiles adds no tiles of the walk's own.
    tiles.follow(1300, 1300, false);
    expect(asked.size).toBe(byTrip);
    // Walking without a trip requests its lead as before.
    tiles.follow(1300, 1300);
    expect(asked.size).toBeGreaterThan(byTrip);
  });

  it("never holds a trip on a tile that fails: it lets it go with a warning and asks for it again", async () => {
    let fails = 1;
    const placed: string[][] = [];
    const tiles = createThingTiles(() => FOCAL);
    tiles.add<string>({
      name: "flaky",
      largest: () => 0.1,
      tile: (ti, tj) => (fails-- > 0 ? Promise.reject(new Error("a worker failed")) : Promise.resolve([`${ti},${tj}`])),
      place: (things) => placed.push([...things]),
    });
    tiles.open(spec);
    const warn = console.warn;
    const warned: unknown[] = [];
    console.warn = (...args: unknown[]) => void warned.push(args);
    try {
      // The fetch resolves even though a tile failed, and the failure is logged.
      await tiles.fetch(0, 0);
      expect(warned.length).toBe(1);
      // Requested again, the tile arrives and is placed.
      await tiles.ready(0, 0);
      expect((placed[placed.length - 1] ?? []).length).toBeGreaterThan(0);
    } finally {
      console.warn = warn;
    }
  });

  it("drops what a worker brings for a world that has since closed", async () => {
    let release: (() => void) | null = null;
    const late = new Promise<void>((r) => (release = r));
    const placed: number[][] = [];
    const tiles = createThingTiles(() => FOCAL);
    tiles.add<number>({ name: "late", largest: () => 0.1, tile: () => late.then(() => [1]), place: (things) => placed.push([...things]) });
    tiles.open(spec);
    tiles.follow(0, 0);
    // Another world opens before the first's tiles arrive.
    tiles.open(spec);
    (release as unknown as () => void)();
    await late;
    await new Promise((r) => setTimeout(r, 0));
    tiles.follow(0, 0);
    expect(placed.every((things) => things.length === 0)).toBe(true);
  });
});
