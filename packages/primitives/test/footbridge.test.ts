// A footbridge breaks as it fails, as a house does: its planks go missing
// and its rails hang from their posts and fall, and its deck keeps its line,
// since the walk crosses on it until a gap wider than a stride opens.
// Nothing passes through the deck.

import { describe, expect, it } from "vitest";
import type { Part } from "@gaia/schema";
import { buildFootbridge, footbridgeDeck, footbridgeHolds } from "@gaia/primitives";
import { applyVitality } from "@gaia/realize";

const SPAN = 9;
const WIDTH = 1.4;
const bridges = Array.from({ length: 12 }, (_, seed) => buildFootbridge(SPAN, WIDTH, seed + 1));
const deckOf = (parts: readonly Part[]): Part => parts.find((p) => p.collision === "walkable") as Part;
const frameOf = (parts: readonly Part[]): Part => parts.find((p) => p.collision === "solid" && p.swatch === "timber") as Part;

/** Each rail's vertices: the frame's pieces that fall, grouped by how they fall. */
function rails(frame: Part): number[][] {
  const fall = frame.channels.fall;
  if (fall === undefined) return [];
  const by = new Map<string, number[]>();
  for (let v = 0; v < frame.shade.length; v++) {
    if ((fall[v * 4 + 3] as number) === 0) continue;
    const key = Array.from(fall.subarray(v * 4, v * 4 + 4)).join(",");
    by.set(key, [...(by.get(key) ?? []), v]);
  }
  return [...by.values()];
}

/** How many of the deck's planks still show at vitality `v`: each plank is a box of 24 vertices, collapsed when gone. */
function planksShown(deck: Part, v: number): number {
  const p = applyVitality(deck, v).positions;
  let shown = 0;
  for (let k = 0; k < deck.shade.length / 24; k++) {
    const xs = Array.from({ length: 24 }, (_, i) => p[(k * 24 + i) * 3] as number);
    if (Math.max(...xs) - Math.min(...xs) > 0.1) shown++;
  }
  return shown;
}

describe("a footbridge", () => {
  it("loses about one plank in ten by vitality 0.5 and most of them by 0.13", () => {
    const all = bridges.reduce((n, b) => n + deckOf(b.parts).shade.length / 24, 0);
    const shown = (v: number): number => bridges.reduce((n, b) => n + planksShown(deckOf(b.parts), v), 0) / all;
    expect(shown(1)).toBe(1);
    expect(shown(0.5)).toBeGreaterThan(0.8);
    expect(shown(0.5)).toBeLessThan(0.97);
    expect(shown(0.13)).toBeLessThan(0.5);
  });

  it("stops a walk just where a gap in its planks opens wider than a stride, and almost never above 0.6", () => {
    /** The widest run of planks not wholly there at vitality `v`, going or gone, meters. */
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
    let fallen = 0;
    bridges.forEach((b, i) => {
      const holds = footbridgeHolds(SPAN, i + 1);
      expect(holds).toBeLessThan(0.7);
      expect(widestGap(deckOf(b.parts), holds + 0.005)).toBeLessThanOrEqual(0.6);
      expect(widestGap(deckOf(b.parts), holds - 0.005)).toBeGreaterThan(0.6);
      if (holds > 0.13) fallen++;
    });
    expect(fallen / bridges.length).toBeGreaterThan(0.9);
  });

  it("hangs its rails from their posts as it fails, swung out past the deck and never through it", () => {
    const deck = footbridgeDeck(SPAN, WIDTH);
    let hanging = 0;
    let count = 0;
    for (const b of bridges) {
      const frame = frameOf(b.parts);
      for (const v of [1, 0.5, 0.3, 0.13, 0.05]) {
        const p = applyVitality(frame, v).positions;
        for (const rail of rails(frame)) {
          if (v === 1) count++;
          const ys = rail.map((i) => p[i * 3 + 1] as number);
          if (v === 0.13 && Math.max(...ys) - Math.min(...ys) > 1) hanging++;
          for (const i of rail) {
            const [x, y, z] = [p[i * 3] as number, p[i * 3 + 1] as number, p[i * 3 + 2] as number];
            const inDeck = Math.abs(x) < SPAN / 2 && Math.abs(z) < deck.halfWidth - 0.02 && y < deck.topAt(x) && y > deck.topAt(x) - 0.4;
            expect(inDeck, `vitality ${v}`).toBe(false);
          }
        }
      }
    }
    expect(hanging / count).toBeGreaterThan(0.4);
  });
});
