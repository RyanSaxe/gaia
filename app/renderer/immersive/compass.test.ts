import { describe, expect, it } from "vitest";
import { type Needle, swing } from "./compass.ts";

const FRAME = 1 / 60;

describe("the compass's needle", () => {
  /** Swings a needle resting at `from` toward `bearing` for `seconds`, and returns its angle at every frame. */
  function track(from: number, bearing: number, seconds: number): number[] {
    const needle: Needle = { angle: from, speed: 0 };
    const angles: number[] = [];
    for (let t = 0; t < seconds; t += FRAME) {
      swing(needle, bearing, FRAME);
      angles.push(needle.angle);
    }
    return angles;
  }

  it("settles on north within about a second of a sudden quarter turn, swinging about a tenth past it first", () => {
    const turn = Math.PI / 2;
    const angles = track(0, turn, 2);
    const past = (Math.max(...angles) - turn) / turn;
    expect(past).toBeGreaterThan(0.05);
    expect(past).toBeLessThan(0.15);
    const settled = angles.findIndex((_, k) => angles.slice(k).every((a) => Math.abs(a - turn) < turn * 0.02));
    expect(settled * FRAME).toBeLessThan(1.1);
  });

  it("always turns the short way round", () => {
    const angles = track(0.1, Math.PI * 2 - 0.1, 2);
    expect(Math.min(...angles)).toBeGreaterThan(-0.3);
    expect(angles.at(-1) as number).toBeCloseTo(-0.1, 2);
  });
});
