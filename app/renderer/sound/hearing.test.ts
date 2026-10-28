import { describe, expect, it } from "vitest";
import type { Earshot } from "../terrain/world.ts";
import { BEDS, cadence, footing, hear } from "./hearing.ts";

/** Standing still in an open meadow at noon, in a light breeze, with no decline, far from water. */
const MEADOW: Earshot = { speed: 0, travelling: false, underfoot: "ground", depth: 0, night: 0, gust: 0.3, decline: 0, canopy: 0, stream: null, mill: null };
const dB = (gain: number): number => 20 * Math.log10(gain);

describe("what a person hears", () => {
  it("never plays any bed more than 6 dB over its Hush level, at the strongest gust, beside a mill in a wood by a wide brook", () => {
    const loudest = hear({ ...MEADOW, gust: 1, canopy: 1, stream: { d: 0, bearing: 0, width: 30 }, mill: { d: 0, bearing: 0, turning: 1 } });
    for (const bed of BEDS) expect(dB(loudest[bed].gain)).toBeLessThanOrEqual(6.03);
  });

  it("hears the brook louder nearer and from its own side", () => {
    const near = hear({ ...MEADOW, stream: { d: 4, bearing: 90, width: 4 } }).stream;
    const far = hear({ ...MEADOW, stream: { d: 40, bearing: 90, width: 4 } }).stream;
    expect(dB(near.gain) - dB(far.gain)).toBeGreaterThan(15);
    expect(near.pan).toBeGreaterThan(0.3);
    expect(hear({ ...MEADOW, stream: { d: 4, bearing: -90, width: 4 } }).stream.pan).toBeLessThan(-0.3);
  });

  it("hears a waterwheel only while it turns", () => {
    expect(hear({ ...MEADOW, mill: { d: 6, bearing: 0, turning: 1 } }).mill.gain).toBeGreaterThan(0.5);
    expect(hear({ ...MEADOW, mill: { d: 6, bearing: 0, turning: 0 } }).mill.gain).toBe(0);
  });

  it("hears birds by day and crickets at night, and no birds over land that has failed", () => {
    const noon = hear(MEADOW);
    const night = hear({ ...MEADOW, night: 1 });
    expect(noon.birds.gain).toBeGreaterThan(0.5);
    expect(noon.crickets.gain).toBe(0);
    expect(night.birds.gain).toBe(0);
    expect(night.crickets.gain).toBeGreaterThan(0.5);
    expect(hear({ ...MEADOW, decline: 1 }).birds.gain).toBe(0);
  });

  it("hears the wind duller over failing land", () => {
    expect(hear({ ...MEADOW, decline: 1 }).wind.lowpass).toBeLessThan(hear(MEADOW).wind.lowpass / 2);
  });
});

describe("footfalls", () => {
  it("fall only while walking, never while a trip carries the person or they swim", () => {
    expect(cadence({ ...MEADOW, speed: 0 })).toBe(0);
    expect(cadence({ ...MEADOW, speed: 4.2 })).toBeGreaterThan(2);
    expect(cadence({ ...MEADOW, speed: 15, travelling: true })).toBe(0);
    expect(cadence({ ...MEADOW, speed: 1, underfoot: "water", depth: 1.2 })).toBe(0);
  });

  it("sound on boards on a bridge and on straw where the land has failed", () => {
    expect(footing({ underfoot: "deck", decline: 0 })).toBe("wood");
    expect(footing({ underfoot: "ground", decline: 0.8 })).toBe("dry");
    expect(footing({ underfoot: "ground", decline: 0 })).toBe("grass");
  });
});
