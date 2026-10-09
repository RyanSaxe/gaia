import type { PlaceArea } from "@gaia/terrain";
import { describe, expect, it } from "vitest";
import { createNamer, tapOn } from "./minimap.ts";

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
