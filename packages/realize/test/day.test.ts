import { describe, expect, it } from "vitest";
import { type ChoiceField, type DaySpec, Library, type LightSpec, type Rgb, type ScaleField, blueprintOf, resolveScale, seedOf } from "@gaia/schema";
import { WORLD_PRIMITIVES, daylight } from "@gaia/primitives";
import { world } from "@gaia/kinds";
import { WORLD_PRESETS, lightAt, realizeSky } from "@gaia/realize";

type Erased = (p: unknown) => DaySpec;
const build = daylight.build as unknown as Erased;

/** Every daylight@1 blueprint, with each scale at both ends of its level. */
const days: DaySpec[] = (() => {
  const f = daylight.params;
  const choices = (c: ChoiceField): string[] => Object.keys(c.options);
  const ends = (s: ScaleField): number[] => s.levels.flatMap((l) => [0, 0.999].map((u) => resolveScale(s, l.words, u)));
  const out: DaySpec[] = [];
  for (const path of ends(f.path as ScaleField))
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
  it("returns each key's own light at its hour", () => {
    for (const day of days.slice(0, 12)) {
      for (const key of day.keys) expect(largestChange(lightAt(day, key.hour), key.light)).toBeLessThan(1e-9);
    }
  });

  it("is continuous across every key and across midnight", () => {
    const eps = 1e-4;
    for (const day of days) {
      for (const at of [0, 24, ...day.keys.map((k) => k.hour)]) {
        expect(largestChange(lightAt(day, at - eps), lightAt(day, at + eps))).toBeLessThan(1e-3);
      }
    }
  });

  // The clock is re-read every minute; the fastest change, the sun's light
  // going out at the horizon, stays under 5% per minute.
  it("never jumps from one minute to the next", () => {
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

  it("repeats every 24 hours", () => {
    for (const day of days.filter((_, i) => i % 5 === 0)) {
      for (const h of [0, 1.3, 6, 13.7, 19.5, 23.99]) {
        expect(largestChange(lightAt(day, h), lightAt(day, h + 24))).toBeLessThan(1e-9);
        expect(largestChange(lightAt(day, h), lightAt(day, h - 48))).toBeLessThan(1e-9);
      }
    }
  });

  it("keeps the sun and moon directions unit length", () => {
    for (const day of days.filter((_, i) => i % 9 === 0)) {
      for (const h of EVERY_15_MINUTES) {
        const l = lightAt(day, h);
        expect(Math.hypot(...l.sunDirection)).toBeCloseTo(1, 9);
        expect(Math.hypot(...l.moonDirection)).toBeCloseTo(1, 9);
      }
    }
  });
});

describe("daylight@1 nights", () => {
  it("lights the land with the sun by day and the moon by night", () => {
    for (const day of days) {
      const noon = lightAt(day, 12.5);
      const night = lightAt(day, 2);
      expect(noon.nightness).toBe(0);
      expect(noon.moonIntensity).toBe(0);
      expect(noon.sunIntensity).toBeGreaterThan(1);
      expect(night.nightness).toBe(1);
      expect(night.sunIntensity).toBe(0);
      expect(night.moonIntensity).toBeGreaterThan(0.1);
      expect(night.moonDirection[1]).toBeGreaterThan(0.2);
    }
  });

  it("gives no direct sunlight once the sun is below the horizon", () => {
    for (const day of days.filter((_, i) => i % 4 === 0)) {
      for (const h of EVERY_15_MINUTES) {
        const l = lightAt(day, h);
        if (l.sunDirection[1] < -0.04) expect(l.sunIntensity).toBe(0);
      }
    }
  });

  it("sets a moonlit floor: ambient and shadow never fall toward black at any hour", () => {
    for (const day of days) {
      for (const h of EVERY_15_MINUTES) {
        const l = lightAt(day, h);
        expect(luminance(l.ambientColor) * l.ambientIntensity).toBeGreaterThan(0.05);
        expect(luminance(l.shadowColor)).toBeGreaterThan(0.04);
        // Night light is cool: blue leads the ambient whenever night has fallen.
        if (l.nightness > 0.8) expect(l.ambientColor[2]).toBeGreaterThan(l.ambientColor[0]);
      }
    }
    // Reads the light 93,000 times: half a second alone, several when other work shares the machine.
  }, 20_000);

  it("deepens every preset's sky to a blue night that is never black", () => {
    const lib = new Library(WORLD_PRIMITIVES);
    for (const p of WORLD_PRESETS) {
      const filled = { blueprint: blueprintOf("world", p.world.slots), kind: world };
      const noon = realizeSky(filled, lib, seedOf("test"), 12.5).sky;
      const night = realizeSky(filled, lib, seedOf("test"), 2).sky;
      expect(luminance(night.zenith)).toBeLessThan(luminance(noon.zenith) * 0.5);
      expect(luminance(night.zenith)).toBeGreaterThan(0.01);
      expect(night.zenith[2]).toBeGreaterThan(night.zenith[0]);
      expect(luminance(night.horizon)).toBeGreaterThan(luminance(night.zenith));
    }
  });
});
