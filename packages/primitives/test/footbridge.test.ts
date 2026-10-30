// A person crosses a footbridge until a gap wider than a stride opens in its
// deck, so `footbridgeHolds` must agree with the planks that show.

import { describe, expect, it } from "vitest";
import type { Part } from "@gaia/schema";
import { buildFootbridge, footbridgeHolds } from "@gaia/primitives";
import { applyVitality } from "@gaia/realize";

const SPAN = 9;
const WIDTH = 1.4;
/** The widest gap a person steps across, as `footbridgeHolds` measures it. */
const STRIDE = 0.6;
const bridges = Array.from({ length: 12 }, (_, seed) => buildFootbridge(SPAN, WIDTH, seed + 1));
const deckOf = (parts: readonly Part[]): Part => parts.find((p) => p.collision === "walkable") as Part;

describe("a footbridge", () => {
  it("stops a walk just where a gap in its planks opens wider than a stride", () => {
    /** The widest run, in meters, of planks going or gone at vitality `v`. */
    const widestGap = (deck: Part, v: number): number => {
      const extent = (p: Float32Array, k: number): number => {
        const xs = Array.from({ length: 24 }, (_, i) => p[(k * 24 + i) * 3] as number);
        return Math.max(...xs) - Math.min(...xs);
      };
      const whole = applyVitality(deck, 1).positions;
      const now = applyVitality(deck, v).positions;
      const count = deck.shade.length / 24;
      let run = 0;
      let widest = 0;
      for (let k = 0; k < count; k++) {
        run = extent(now, k) < extent(whole, k) - 1e-5 ? run + 1 : 0;
        widest = Math.max(widest, run);
      }
      return (widest * SPAN) / count;
    };
    bridges.forEach((b, i) => {
      const holds = footbridgeHolds(SPAN, i + 1);
      expect(widestGap(deckOf(b.parts), holds + 0.005), `seed ${i + 1}`).toBeLessThanOrEqual(STRIDE);
      expect(widestGap(deckOf(b.parts), holds - 0.005), `seed ${i + 1}`).toBeGreaterThan(STRIDE);
    });
  });
});
