import { describe, expect, it } from "vitest";
import { CHANNEL_MATH } from "@gaia/realize";
import { followVitality, lagKept } from "@gaia/render";

describe("a change in vitality easing in", () => {
  const keep = lagKept(1 / 60);
  /** A jump from 0 to 1 in one step, as a commit lands, followed frame by frame. */
  const jump = (): { shown: number[]; was: number[] } => {
    let [shown, lag] = [0, 0];
    const out = { shown: [] as number[], was: [] as number[] };
    for (let k = 0; k < 60 * 60; k++) {
      [shown, lag] = followVitality(shown, lag, 1, keep);
      out.shown.push(shown);
      out.was.push(shown + lag);
    }
    return out;
  };

  it("moves toward the vitality given and never past it, and where it was never ahead of what it shows", () => {
    const { shown, was } = jump();
    for (let k = 1; k < shown.length; k++) {
      expect(shown[k]).toBeGreaterThanOrEqual(shown[k - 1] as number);
      expect(shown[k]).toBeLessThanOrEqual(1);
      expect(was[k]).toBeLessThanOrEqual(shown[k] as number);
    }
  });

  it("spreads a jump over seconds: no frame moves what the shader averages between by more than a hundredth of it", () => {
    const { shown, was } = jump();
    const middle = shown.map((s, k) => (s + (was[k] as number)) / 2);
    for (let k = 1; k < middle.length; k++) expect((middle[k] as number) - (middle[k - 1] as number)).toBeLessThan(0.01);
    // Half a lag in, it has not yet moved even halfway.
    expect(middle[Math.round(30 * CHANNEL_MATH.vitalityLag)]).toBeLessThan(0.5);
  });

  it("comes to rest exactly on the vitality given, so a thing at rest shows its steps exactly", () => {
    const { shown, was } = jump();
    expect(shown.at(-1)).toBe(1);
    expect(was.at(-1)).toBe(1);
    // Brought to rest at once, it lands there in one frame.
    expect(followVitality(0.2, -0.1, 0.8, 0)).toEqual([0.8, 0]);
  });
});
