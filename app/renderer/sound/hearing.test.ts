import { describe, expect, it } from "vitest";
import type { Earshot } from "../terrain/world.ts";
import { BEDS, hear } from "./hearing.ts";

/** Standing still in an open meadow at noon, in a light breeze, with no decline, far from water. */
const MEADOW: Earshot = { speed: 0, travelling: false, underfoot: "ground", depth: 0, night: 0, gust: 0.3, decline: 0, canopy: 0, stream: null, mill: null };
const dB = (gain: number): number => 20 * Math.log10(gain);

describe("what a person hears", () => {
  it("never plays any bed more than 6 dB over its Hush level, at the strongest gust, beside a mill in a wood by a wide brook", () => {
    const loudest = hear({ ...MEADOW, gust: 1, canopy: 1, stream: { d: 0, bearing: 0, width: 30 }, mill: { d: 0, bearing: 0, turning: 1 } });
    for (const bed of BEDS) expect(dB(loudest[bed].gain)).toBeLessThanOrEqual(6.03);
  });
});
