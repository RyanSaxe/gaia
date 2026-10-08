import { describe, expect, it } from "vitest";
import { Library } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { WILD_AREA, type WorldPlaces, bakeTerrain, outlinesOf, placeAt, regionPlaces, sampleWorld, warpPoint } from "@gaia/terrain";

const file = (path: string, x: number, z: number, radius: number, vitality = 0.8) => ({ path, name: path.split("/").pop() ?? path, x, z, radius, vitality });

describe("where a person is", () => {
  it("names the area and the file whose cell holds a point, a lot's ground as its area's own, and the wild past the land", () => {
    const world: WorldPlaces = {
      name: "demo",
      size: 260,
      areas: [
        { path: "", name: "demo", depth: 0, parent: null, x: 0, z: 0 },
        { path: "src", name: "src", depth: 1, parent: "", x: 30, z: 0 },
        { path: "src/ui", name: "ui", depth: 2, parent: "src", x: 50, z: 0 },
      ],
      patches: [
        { ...file("src/ui/menu.ts", 50, 0, 5, 0.4), area: "src/ui" },
        { ...file("src/main.ts", 10, 0, 6, 1), area: "src" },
      ],
      cells: [
        { area: "src/ui", file: "src/ui/menu.ts", x: 50, z: 0 },
        { area: "src", file: "src/main.ts", x: 10, z: 0 },
        { area: "", file: null, x: -60, z: 0 },
      ],
    };
    // Every point names the area and file of the cell whose site is nearest its warped point, and every cell is found.
    const seen = new Set<string>();
    for (let x = -120; x <= 120; x += 6) {
      for (let z = -120; z <= 120; z += 6) {
        const here = placeAt(world, x, z);
        if (here.area.depth < 0) continue;
        const [wx, wz] = warpPoint(x, z);
        const nearest = world.cells.reduce((b, c, i) => (Math.hypot(wx - c.x, wz - c.z) < Math.hypot(wx - world.cells[b]!.x, wz - world.cells[b]!.z) ? i : b), 0);
        expect(here.area.path).toBe(world.cells[nearest]!.area);
        expect(here.file?.path ?? null).toBe(world.cells[nearest]!.file);
        seen.add(here.file?.path ?? "lot");
      }
    }
    expect([...seen].sort()).toEqual(["lot", "src/main.ts", "src/ui/menu.ts"]);
    expect(placeAt(world, 50, 0).file?.vitality ?? 0.4).toBe(0.4);
    for (const [x, z] of [[140, 0], [0, -140], [120, 120], [900, 0]] as const) expect(placeAt(world, x, z)).toEqual({ area: WILD_AREA, file: null });
    // Outlines trace each area holding its subdirectories', and each patch's own cell.
    const lines = outlinesOf(world, 4);
    const ring = (path: string, list: typeof lines.areas) => list.find((o) => o.path === path)!.rings.flat().length;
    expect(ring("", lines.areas)).toBeGreaterThan(0);
    expect(lines.patches.map((p) => p.path).sort()).toEqual(["src/main.ts", "src/ui/menu.ts"]);
    expect(outlinesOf(world, 4)).toBe(lines);
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
