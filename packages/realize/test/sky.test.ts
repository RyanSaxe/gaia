import { describe, expect, it } from "vitest";
import { type DaySpec, Library, type Rgb, type Vec3, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES, WORLD_PRIMITIVES, daylight } from "@gaia/primitives";
import { biome, world } from "@gaia/kinds";
import { AIR, WORLD_PRESETS, aerialAt, realizeWorld, skyColorAt } from "@gaia/realize";

const lib = new Library([...WORLD_PRIMITIVES, ...BIOME_PRIMITIVES, ...RELIEF_PRIMITIVES]);
const SEED = seedOf("lab/world");
const KEY_HOURS = (daylight.build as unknown as (p: unknown) => DaySpec)({
  path: 1,
  warmth: "neutral",
  brush: "painterly",
  moon: "silver moon",
  stars: 0.5,
}).keys.map((k) => k.hour);

const looks = WORLD_PRESETS.flatMap((p) =>
  KEY_HOURS.map((hour) => ({
    name: `${p.name} at ${hour}`,
    look: realizeWorld({ blueprint: p.world, kind: world }, { blueprint: p.biome, kind: biome }, lib, SEED, hour),
  })),
);
const bearings = Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2);
const apart = (a: Rgb, b: Rgb): number => Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? Number.NaN))));
const STEP = 1 / 255;

describe("the horizon", () => {
  it("dissolves far land along a level ray into exactly the sky behind it, at every key hour", () => {
    expect(KEY_HOURS).toHaveLength(8);
    const eye: Vec3 = [0, 1.6, 0];
    for (const { name, look } of looks) {
      for (const a of bearings) {
        const dir: Vec3 = [Math.sin(a), 0, Math.cos(a)];
        const land: Vec3 = [dir[0] * AIR.dissolveEnd, eye[1], dir[2] * AIR.dissolveEnd];
        const sky = skyColorAt(look, dir);
        for (const ground of [
          [0, 0, 0],
          [1, 1, 1],
          [0.3, 0.6, 0.2],
        ] as Rgb[]) {
          expect(apart(aerialAt(look, ground, eye, land), sky), name).toBeLessThan(STEP);
        }
      }
    }
  });

  it("meets the sky without a line: just below and just above the horizon look the same", () => {
    for (const { name, look } of looks) {
      for (const a of bearings) {
        const below = skyColorAt(look, [Math.sin(a), -0.003, Math.cos(a)]);
        const above = skyColorAt(look, [Math.sin(a), 0.003, Math.cos(a)]);
        expect(apart(below, above), name).toBeLessThan(STEP);
      }
    }
  });

  it("keeps near land its own color and fades it with distance in no visible step", () => {
    const eye: Vec3 = [0, 1.6, 0];
    const ground: Rgb = [0.3, 0.6, 0.2];
    for (const { name, look } of looks) {
      expect(apart(aerialAt(look, ground, eye, [5, 0, 0]), ground), name).toBeLessThan(0.05);
      let last = aerialAt(look, ground, eye, [1, 0, 0]);
      for (let d = 2; d <= AIR.dissolveEnd; d += 1) {
        const next = aerialAt(look, ground, eye, [d, 0, 0]);
        expect(apart(next, last), `${name} at ${d} m`).toBeLessThan(2 * STEP);
        last = next;
      }
    }
  });
});
