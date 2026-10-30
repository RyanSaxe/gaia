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

describe("what is placed on the land, tile by tile", () => {
  it("places each thing's tiles as far as the largest of its kind can be seen, wherever the person walks", async () => {
    const placed: string[][] = [];
    const tiles = createThingTiles(() => FOCAL);
    tiles.add<string>({ name: "stones", largest: () => 0.5, tile: (ti, tj) => [`${ti},${tj}`], place: (things) => placed.push([...things]) });
    tiles.open(spec);
    const reach = seenTo(0.5, FOCAL);
    expect(reach).toBeCloseTo((2 * 0.5 * FOCAL) / GONE.end);
    /** The tiles wholly within sight of (cx, cz) that are not placed. */
    const unseen = (cx: number, cz: number): string[] => {
      const held = new Set(placed[placed.length - 1]);
      const out: string[] = [];
      for (let tj = 0; tj < per; tj++) {
        for (let ti = 0; ti < per; ti++) {
          const [x, z] = middle(ti, tj);
          if (Math.hypot(x - cx, z - cz) + TILE.size < reach && !held.has(`${ti},${tj}`)) out.push(`${ti},${tj}`);
        }
      }
      return out;
    };
    await tiles.ready(0, 0);
    expect(unseen(0, 0)).toEqual([]);
    // Walking far off places what can be seen from there.
    tiles.follow(1300, 1300);
    await tiles.ready(1300, 1300);
    expect(unseen(1300, 1300)).toEqual([]);
  });

  it("never holds a trip on a tile that fails: it drops the tile with a warning and requests it again", async () => {
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
