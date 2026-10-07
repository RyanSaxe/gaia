import { describe, expect, it } from "vitest";
import { Library } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { type FilePatch, WILD_AREA, bakeTerrain, placeAt, sampleWorld, worldPlaces } from "@gaia/terrain";

const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
const world = sampleWorld();
const t = bakeTerrain(world, lib);
const file = (path: string) => ({ path, name: path.split("/").pop() ?? path, vitality: 0.8 });

describe("placeAt", () => {
  it("names the directory whose land a point is on, and the wild past the land's edge", () => {
    const places = worldPlaces(t, []);
    for (const r of world.regions) {
      const here = placeAt(places, r.x, r.z).area;
      expect(here.path).toBe(r.id);
      expect(here.name).toBe(r.id.split("/").pop());
      expect(here.depth).toBe(r.id.split("/").length);
    }
    const half = world.size / 2;
    for (const [x, z] of [[half + 5, 0], [0, -half - 5], [half * 0.9, half * 0.9], [5000, -3000]] as const) {
      expect(placeAt(places, x, z)).toEqual({ area: WILD_AREA, file: null });
    }
  });

  it("finds the nearest file whose patch reaches a point, and none off every patch", () => {
    const [a, b] = world.regions;
    const patches: FilePatch[] = [
      { x: a!.x, z: a!.z, reach: 4, file: file("src/core/a.ts") },
      { x: a!.x + 6, z: a!.z, reach: 4, file: file("src/core/b.ts") },
      { x: b!.x, z: b!.z, reach: 3, file: file("src/ui/c.ts") },
    ];
    const places = worldPlaces(t, patches);
    expect(placeAt(places, a!.x + 1, a!.z).file?.path).toBe("src/core/a.ts");
    // Where two patches overlap, the nearer one is underfoot.
    expect(placeAt(places, a!.x + 3.5, a!.z).file?.path).toBe("src/core/b.ts");
    expect(placeAt(places, b!.x, b!.z + 2.9).file?.path).toBe("src/ui/c.ts");
    expect(placeAt(places, b!.x, b!.z + 3.1).file).toBeNull();
    expect(placeAt(places, a!.x, a!.z + 20).file).toBeNull();
  });
});
