import type { PlaceArea } from "@gaia/terrain";
import { describe, expect, it } from "vitest";
import { createNamer, markAt, nameBreaks, tapOn } from "./minimap.ts";

const area = (path: string): PlaceArea => ({ path, name: path.split("/").pop() ?? path, depth: path.split("/").length });
const WILD: PlaceArea = { path: "", name: "The wilds", depth: -1 };
const FRAME = 1 / 60;

/** Walks `seconds` in `where`, a frame at a time, and returns every name the minimap letters: null for none. */
function walk(namer: ReturnType<typeof createNamer>, where: PlaceArea, seconds: number): (string | null)[] {
  const lettered: (string | null)[] = [];
  for (let t = 0; t < seconds; t += FRAME) {
    const next = namer.next(where, FRAME);
    if (next !== undefined) lettered.push(next?.name ?? null);
  }
  return lettered;
}

describe("the minimap's name", () => {
  it("letters the first place at once, then a new area only after 2.5 s in it, so a border walked along never flickers", () => {
    const namer = createNamer();
    expect(walk(namer, area("app/renderer"), 1)).toEqual(["renderer"]);
    for (let k = 0; k < 6; k++) {
      expect(walk(namer, area("app/world-service"), 2.3)).toEqual([]);
      expect(walk(namer, area("app/renderer"), 0.5)).toEqual([]);
    }
    expect(walk(namer, area("app/world-service"), 2.4)).toEqual([]);
    expect(walk(namer, area("app/world-service"), 0.2)).toEqual(["world-service"]);
  });

  it("lets the old name fade in the wild after the same pause and letters nothing there", () => {
    const namer = createNamer();
    walk(namer, area("docs"), 1);
    expect(walk(namer, WILD, 2.4)).toEqual([]);
    expect(walk(namer, WILD, 5)).toEqual([null]);
    expect(walk(namer, area("docs"), 3)).toEqual(["docs"]);
  });
});

describe("a tap on the minimap", () => {
  it("tucks it on its outer 16 px or up to 6 px past its edge, and unfolds the map from its land", () => {
    expect(tapOn(78, 78)).toBe("unfold");
    expect(tapOn(17, 120)).toBe("unfold");
    expect(tapOn(15, 120)).toBe("tuck");
    expect(tapOn(78, 150)).toBe("tuck");
    expect(tapOn(-5, 40)).toBe("tuck");
    expect(tapOn(78, 163)).toBe(null);
  });
});

describe("the ring round a thing walked up to", () => {
  it("lets the thing's name break after an underscore or before a capital that follows a small letter or digit", () => {
    expect(nameBreaks("an_endpoint_override")).toEqual(["an_", "endpoint_", "override"]);
    expect(nameBreaks("FailingGroveMeasure")).toEqual(["Failing", "Grove", "Measure"]);
    expect(nameBreaks("readJSON2Html")).toEqual(["read", "JSON2", "Html"]);
    expect(nameBreaks("docs")).toEqual(["docs"]);
  });

  it("keeps the ring and its name 10 px inside the scrap's torn edge, apart, wherever the thing is", () => {
    const inside = (least: number, most: number): boolean => least >= 10 - 1e-9 && most <= 146 + 1e-9;
    const off: string[] = [];
    for (let x = -200; x <= 356; x += 4) {
      for (let y = -200; y <= 356; y += 4) {
        for (const r of [9, 17, 26]) {
          for (const [w, h] of [[30, 13], [136, 13], [136, 27]] as const) {
            const { ring, name } = markAt(x, y, r, w, h);
            const apart = name[1] + h <= ring[1] - r || name[1] >= ring[1] + r;
            const kept = inside(ring[0] - r, ring[0] + r) && inside(ring[1] - r, ring[1] + r) && inside(name[0], name[0] + w) && inside(name[1], name[1] + h);
            if (!kept || !apart) off.push(`${w}x${h} by a ring of ${r} px at (${x}, ${y})`);
          }
        }
      }
    }
    expect(off).toEqual([]);
  });

  it("writes the name over the ring, and under it only where the area's name or the edge leaves no room above", () => {
    const [, top] = markAt(78, 94, 17, 136, 27).name;
    expect(top + 27).toBeLessThan(94 - 17);
    const [, under] = markAt(78, 50, 17, 136, 27).name;
    expect(under).toBeGreaterThan(50 + 17);
  });
});
