import { describe, expect, it } from "vitest";
import { Library } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { WILD_AREA, type WorldPlaces, bakeTerrain, placeAt, regionPlaces, sampleWorld } from "@gaia/terrain";

const file = (path: string, x: number, z: number, radius: number, vitality = 0.8) => ({ path, name: path.split("/").pop() ?? path, x, z, radius, vitality });

describe("where a person is", () => {
  it("names the deepest area and the patch under a point in a world laid out from code, the common ground between, and the wild past the land", () => {
    const world: WorldPlaces = {
      name: "demo",
      size: 260,
      areas: [
        { path: "", name: "demo", depth: 0, parent: null, x: 0, z: 0, radius: 100 },
        { path: "src", name: "src", depth: 1, parent: "", x: 30, z: 0, radius: 40 },
        { path: "src/ui", name: "ui", depth: 2, parent: "src", x: 45, z: 0, radius: 15 },
      ],
      patches: [
        { ...file("src/ui/menu.ts", 50, 0, 5, 0.4), area: "src/ui" },
        { ...file("src/main.ts", 10, 0, 6, 1), area: "src" },
      ],
    };
    expect(placeAt(world, 51, 1)).toEqual({ area: { path: "src/ui", name: "ui", depth: 2 }, file: { path: "src/ui/menu.ts", name: "menu.ts", vitality: 0.4 } });
    expect(placeAt(world, 12, 0).file?.path).toBe("src/main.ts");
    expect(placeAt(world, 40, 0)).toEqual({ area: { path: "src/ui", name: "ui", depth: 2 }, file: null });
    expect(placeAt(world, 0, 30)).toEqual({ area: { path: "", name: "demo", depth: 0 }, file: null });
    // Land no circle holds is the repository's own; past the land's rounded square is the wild.
    expect(placeAt(world, 0, 120).area).toEqual({ path: "", name: "demo", depth: 0 });
    for (const [x, z] of [[140, 0], [0, -140], [120, 120], [900, 0]] as const) expect(placeAt(world, x, z)).toEqual({ area: WILD_AREA, file: null });
  });

  it("names the region whose land a point is on in a world laid out as regions, and the nearest file whose patch reaches it", () => {
    const spec = sampleWorld();
    const t = bakeTerrain(spec, new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]));
    const [a, b] = spec.regions;
    const world = regionPlaces(t.spec, "sample", [file("src/core/a.ts", a!.x, a!.z, 4), file("src/core/b.ts", a!.x + 6, a!.z, 4), file("src/ui/c.ts", b!.x, b!.z, 3)]);
    for (const r of spec.regions) {
      const here = placeAt(world, r.x, r.z).area;
      expect(here).toEqual({ path: r.id, name: r.id.split("/").pop(), depth: r.id.split("/").length });
    }
    expect(world.patches.map((p) => p.area)).toEqual([a!.id, a!.id, b!.id]);
    expect(placeAt(world, a!.x + 1, a!.z).file?.path).toBe("src/core/a.ts");
    // Where two patches overlap, the one whose middle is nearer for its size is underfoot.
    expect(placeAt(world, a!.x + 3.5, a!.z).file?.path).toBe("src/core/b.ts");
    expect(placeAt(world, b!.x, b!.z + 2.9).file?.path).toBe("src/ui/c.ts");
    expect(placeAt(world, b!.x, b!.z + 3.1).file).toBeNull();
    expect(placeAt(world, spec.size / 2 + 5, 0)).toEqual({ area: WILD_AREA, file: null });
  });
});
