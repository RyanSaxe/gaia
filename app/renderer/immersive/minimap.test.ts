import { describe, expect, it } from "vitest";
import { markAt } from "./minimap.ts";

describe("the ring round a thing walked up to", () => {
  it("keeps the ring and its name on the scrap and apart, wherever the thing is", () => {
    // A scrap 156 px a side, the minimap's own.
    const side = 156;
    const inside = (least: number, most: number): boolean => least >= -1e-9 && most <= side + 1e-9;
    const off: string[] = [];
    for (let x = -200; x <= 356; x += 4) {
      for (let y = -200; y <= 356; y += 4) {
        for (const r of [9, 17, 26]) {
          for (const [w, h] of [[30, 13], [136, 13], [136, 27]] as const) {
            const { ring, name } = markAt(x, y, r, w, h, side);
            const apart = name[1] + h <= ring[1] - r || name[1] >= ring[1] + r;
            const kept = inside(ring[0] - r, ring[0] + r) && inside(ring[1] - r, ring[1] + r) && inside(name[0], name[0] + w) && inside(name[1], name[1] + h);
            if (!kept || !apart) off.push(`${w}x${h} by a ring of ${r} px at (${x}, ${y})`);
          }
        }
      }
    }
    expect(off).toEqual([]);
  });
});
