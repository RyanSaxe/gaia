import { describe, expect, it } from "vitest";
import { contentHash } from "./far-store.ts";

const part = (lift: number) => ({
  swatch: "leaf",
  positions: new Float32Array([0, lift, 0, 1, 2, 3]),
  indices: new Uint32Array([0, 1, 2]),
  channels: { decline: new Float32Array([0.5, 0.25]) },
});

describe("a far form's key", () => {
  it("is the same for the same build, and differs for any change to it", () => {
    const same = contentHash([part(1)], { sway: 1 }, "bake@1", 128);
    expect(contentHash([part(1)], { sway: 1 }, "bake@1", 128)).toBe(same);
    // Key order in an object doesn't matter; every value does.
    expect(contentHash([{ channels: part(1).channels, indices: part(1).indices, positions: part(1).positions, swatch: "leaf" }], { sway: 1 }, "bake@1", 128)).toBe(same);
    for (const changed of [
      contentHash([part(1.0001)], { sway: 1 }, "bake@1", 128),
      contentHash([part(1), part(1)], { sway: 1 }, "bake@1", 128),
      contentHash([{ ...part(1), swatch: "bark" }], { sway: 1 }, "bake@1", 128),
      contentHash([part(1)], { sway: 1.5 }, "bake@1", 128),
      contentHash([part(1)], { sway: 1 }, "bake@2", 128),
      contentHash([part(1)], { sway: 1 }, "bake@1", 112),
    ]) {
      expect(changed).not.toBe(same);
    }
  });
});
