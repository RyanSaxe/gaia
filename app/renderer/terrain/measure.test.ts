import { describe, expect, it } from "vitest";
import { pictureChange } from "./measure.ts";

const W = 256;
const H = 128;
const frame = (fill: (x: number, y: number) => number): Uint8Array => {
  const f = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f.fill(fill(x, y), (y * W + x) * 4, (y * W + x) * 4 + 3);
  return f;
};

describe("how much the picture changes", () => {
  it("tells a pop in one place from the same change spread thin", () => {
    const still = frame(() => 100);
    // One block of 64 pixels square, an eighth of the frame, turns 120 levels brighter.
    const pop = pictureChange(still, frame((x, y) => (x < 64 && y < 64 ? 220 : 100)), W, H);
    // The same total change, spread over every pixel.
    const spread = pictureChange(still, frame(() => 100 + 120 / 8), W, H);
    expect(pop.mean).toBeCloseTo(spread.mean, 5);
    expect(pop.worst).toBeCloseTo(120, 5);
    expect(spread.worst).toBeCloseTo(15, 5);
    expect(pictureChange(still, still, W, H)).toEqual({ mean: 0, worst: 0 });
  });
});
