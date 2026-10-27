// An overcast sky dims and evens the light under it and pales its breaks; a fair sky leaves the daylight exactly as
// it is, so every fair world looks as it did before skies could be overcast.

import { describe, expect, it } from "vitest";
import { type DaySpec, Library, type Rgb, blueprintOf } from "@gaia/schema";
import { WORLD_PRIMITIVES, daylight } from "@gaia/primitives";
import { world } from "@gaia/kinds";
import { buildSlots, lightAt, realizeSky } from "@gaia/realize";

const lib = new Library(WORLD_PRIMITIVES);
const LIGHT = { path: "middling", warmth: "warm", brush: "painterly", moon: "silver moon", stars: "many" } as const;
const HOURS = (daylight.build as unknown as (p: unknown) => DaySpec)({ path: 1, warmth: "warm", brush: "painterly", moon: "silver moon", stars: 0.55 }).keys.map((k) => k.hour);
const OVERCASTS = ["fair", "a heavy sky, with breaks of light", "low and grey, the sun seldom through"] as const;

const SEED = 7;
const blueprint = (overcast: (typeof OVERCASTS)[number], cover = "scattered") =>
  blueprintOf("world", {
    light: { use: "daylight@1", params: LIGHT },
    sky: { use: "sky@1", params: { character: "powder blue", clouds: "fair-weather puffs", cover, overcast } },
    wind: { use: "wind@1", params: { strength: "breezy" } },
  });
const skyOf = (overcast: (typeof OVERCASTS)[number], hour: number, cover = "scattered") => realizeSky({ blueprint: blueprint(overcast, cover), kind: world }, lib, SEED, hour);
type Sky = ReturnType<typeof skyOf>;
const every = (hour: number): [Sky, Sky, Sky] => [skyOf(OVERCASTS[0], hour), skyOf(OVERCASTS[1], hour), skyOf(OVERCASTS[2], hour)];
const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe("an overcast sky", () => {
  it("leaves a fair sky's light exactly as the daylight gives it, at every hour", () => {
    for (const hour of HOURS) {
      for (const cover of ["a few", "scattered", "many, but with blue between"]) {
        const fair = skyOf("fair", hour, cover);
        const day = buildSlots(blueprint("fair", cover), world, lib, { seed: SEED, facts: {} }).get("light")?.output as DaySpec;
        expect(fair.light, `${cover} at ${hour}`).toEqual(lightAt(day, hour));
        expect(fair.sky.clouds.overcast, `${cover} at ${hour}`).toBeUndefined();
      }
    }
  });

  it("dims the sun and lifts the shadows the heavier it is, and turns the light more even", () => {
    const [fair, heavy, low] = every(12.5);
    expect(heavy.light.sunIntensity).toBeLessThan(fair.light.sunIntensity);
    expect(low.light.sunIntensity).toBeLessThan(heavy.light.sunIntensity);
    expect(low.light.ambientIntensity).toBeGreaterThan(fair.light.ambientIntensity);
    // Shadows lift toward the light around them, so the land's light and shade draw together.
    const gap = (s: Sky): number => luminance(s.light.ambientColor) - luminance(s.light.shadowColor);
    expect(gap(low)).toBeLessThan(gap(heavy));
    expect(gap(heavy)).toBeLessThan(gap(fair));
    expect(low.light.celSoftness).toBeGreaterThanOrEqual(fair.light.celSoftness);
  });

  it("pales the sky seen through its breaks toward its clouds, and greys the clouds' bodies", () => {
    for (const hour of [9, 12.5, 15.5]) {
      const [fair, heavy, low] = every(hour);
      expect(luminance(heavy.sky.zenith), `${hour}`).toBeGreaterThan(luminance(fair.sky.zenith));
      expect(luminance(low.sky.zenith), `${hour}`).toBeGreaterThan(luminance(heavy.sky.zenith));
      // A break shows near the clouds' own brightness, never far darker than them.
      expect(luminance(low.sky.cloudLit) - luminance(low.sky.zenith), `${hour}`).toBeLessThan(0.12);
      expect(luminance(low.sky.cloudLit), `${hour}`).toBeLessThan(luminance(fair.sky.cloudLit));
      expect(luminance(low.sky.cloudShade), `${hour}`).toBeLessThan(luminance(low.sky.cloudLit));
    }
  });

  it("covers more of the sky than any fair cover", () => {
    const fairest = Math.min(...["a few", "scattered", "many, but with blue between"].map((c) => skyOf("fair", 12, c).sky.clouds.threshold));
    const heavy = skyOf("a heavy sky, with breaks of light", 12).sky.clouds;
    const low = skyOf("low and grey, the sun seldom through", 12).sky.clouds;
    expect(heavy.threshold).toBeLessThan(fairest);
    expect(low.threshold).toBeLessThan(heavy.threshold);
    expect(low.overcast ?? 0).toBeGreaterThan(heavy.overcast ?? 0);
  });
});
