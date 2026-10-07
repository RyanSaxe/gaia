import { describe, expect, it } from "vitest";
import { type WorldPlaces, placeAt } from "@gaia/terrain";

const world: WorldPlaces = {
  name: "demo",
  areas: [
    { path: "", name: "demo", depth: 0, parent: null, x: 0, z: 0, radius: 100 },
    { path: "src", name: "src", depth: 1, parent: "", x: 30, z: 0, radius: 40 },
    { path: "src/ui", name: "ui", depth: 2, parent: "src", x: 45, z: 0, radius: 15 },
  ],
  patches: [
    { path: "src/ui/menu.ts", name: "menu.ts", area: "src/ui", x: 50, z: 0, radius: 5, vitality: 0.4 },
    { path: "src/main.ts", name: "main.ts", area: "src", x: 10, z: 0, radius: 6, vitality: 1 },
  ],
};

describe("where a person is", () => {
  it("names the deepest area and the patch under a point, the common ground between patches, and the repository past every area", () => {
    expect(placeAt(world, 51, 1)).toEqual({ area: { path: "src/ui", name: "ui", depth: 2 }, file: { path: "src/ui/menu.ts", name: "menu.ts", vitality: 0.4 } });
    expect(placeAt(world, 12, 0).file?.path).toBe("src/main.ts");
    expect(placeAt(world, 40, 0)).toEqual({ area: { path: "src/ui", name: "ui", depth: 2 }, file: null });
    expect(placeAt(world, 0, 30)).toEqual({ area: { path: "", name: "demo", depth: 0 }, file: null });
    expect(placeAt(world, 900, 0).area.path).toBe("");
  });
});
