import { describe, expect, it } from "vitest";
import { type ChoiceField, type DaySpec, Library, type LightSpec, type Rgb, type ScaleField, blueprintOf, rand, resolveScale, seedOf } from "@gaia/schema";
import { WORLD_PRIMITIVES, daylight } from "@gaia/primitives";
import { world } from "@gaia/kinds";
import { lightAt, realizeSky } from "@gaia/realize";
import { randomSlots } from "@gaia/world/testing";

type Erased = (p: unknown) => DaySpec;
const build = daylight.build as unknown as Erased;

const ends = (s: ScaleField): number[] => s.levels.flatMap((l) => [0, 0.999].map((u) => resolveScale(s, l.words, u)));
/** Every sun path daylight@1 allows: each level of its `path` at both ends. */
const PATHS = ends(daylight.params.path as ScaleField);

/** Every daylight@1 blueprint, with each scale at both ends of its level. */
const days: DaySpec[] = (() => {
  const f = daylight.params;
  const choices = (c: ChoiceField): string[] => Object.keys(c.options);
  const out: DaySpec[] = [];
  for (const path of PATHS)
    for (const warmth of choices(f.warmth as ChoiceField))
      for (const brush of choices(f.brush as ChoiceField))
        for (const moon of choices(f.moon as ChoiceField))
          for (const stars of ends(f.stars as ScaleField)) out.push(build({ path, warmth, brush, moon, stars }));
  return out;
})();

/** Every number in a light, in a fixed order. */
const numbers = (l: LightSpec): number[] => Object.values(l).flatMap((v) => (typeof v === "number" ? [v] : [...(v as readonly number[])]));
const largestDifference = (x: readonly number[], y: readonly number[]): number => Math.max(...x.map((v, i) => Math.abs(v - (y[i] ?? Number.NaN))));
const largestChange = (a: LightSpec, b: LightSpec): number => largestDifference(numbers(a), numbers(b));
const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const EVERY_15_MINUTES = Array.from({ length: 96 }, (_, i) => i / 4);

describe("lightAt", () => {
  // The clock is read every minute. The fastest change, the sun's light going
  // out at the horizon, stays under 5% per minute. At each key and at midnight,
  // where one stretch of the day hands over to the next, the light has no step.
  it("never jumps from one minute to the next, at a key or across midnight", () => {
    const eps = 1e-4;
    for (const day of days) {
      for (const at of [0, 24, ...day.keys.map((k) => k.hour)]) {
        expect(largestChange(lightAt(day, at - eps), lightAt(day, at + eps))).toBeLessThan(1e-3);
      }
    }
    for (const day of days.filter((_, i) => i % 7 === 0)) {
      let worst = 0;
      let before = numbers(lightAt(day, 0));
      for (let m = 1; m <= 24 * 60; m++) {
        const now = numbers(lightAt(day, m / 60));
        worst = Math.max(worst, largestDifference(before, now));
        before = now;
      }
      expect(worst).toBeLessThan(0.05);
    }
    // Reads the light 200,000 times: half a second alone, several when other work shares the machine.
  }, 20_000);
});

describe("daylight@1 nights", () => {
  // Black is anything a display shows as black: under one step of 8-bit color.
  const BLACK = 1 / 255;
  it("never falls to black at any hour: the land's ambient and shadow, and any sky Jev can compose", () => {
    for (const day of days) {
      for (const h of EVERY_15_MINUTES) {
        const l = lightAt(day, h);
        expect(luminance(l.ambientColor) * l.ambientIntensity).toBeGreaterThan(BLACK);
        expect(luminance(l.shadowColor)).toBeGreaterThan(BLACK);
      }
    }
    const lib = new Library(WORLD_PRIMITIVES);
    const r = rand(seedOf("night skies"));
    for (let i = 0; i < 24; i++) {
      const filled = { blueprint: blueprintOf("world", randomSlots(world, lib, () => r.next())), kind: world };
      const night = realizeSky(filled, lib, seedOf("test"), 2).sky;
      expect(luminance(night.zenith)).toBeGreaterThan(BLACK);
      expect(luminance(night.horizon)).toBeGreaterThan(BLACK);
    }
    // Reads the light 93,000 times: half a second alone, several when other work shares the machine.
  }, 20_000);
});
