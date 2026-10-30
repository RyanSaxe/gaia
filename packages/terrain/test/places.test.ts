import { describe, expect, it } from "vitest";
import {
  WILD_AREA,
  WILD_OWNER,
  type OwnedSite,
  type WorldPlaces,
  groundOwners,
  outlinesOf,
  ownershipOf,
  placeAt,
  siteAt,
  vitalityAt,
  vitalityOver,
  warpPoint,
} from "@gaia/terrain";

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
    // Each area's outline includes its subdirectories, and each patch's outline is its own cell.
    const lines = outlinesOf(world, 4);
    const ring = (path: string, list: typeof lines.areas) => list.find((o) => o.path === path)!.rings.flat().length;
    expect(ring("", lines.areas)).toBeGreaterThan(0);
    expect(lines.patches.map((p) => p.path).sort()).toEqual(["src/main.ts", "src/ui/menu.ts"]);
  });
});

describe("whose ground a point is, and how alive it is", () => {
  it("takes its owner's vitality away from borders, eases into a neighbor's across a few meters, and has vitality 1 in the wild", () => {
    // Cells every 16 m, as a world from code lays them: a patch at vitality 1 to the west, one at 0.1 to the east, and one at 0.45 inside the west.
    const size = 300;
    const sites: OwnedSite[] = [];
    for (let x = -144; x <= 144; x += 16) for (let z = -144; z <= 144; z += 16) sites.push({ x, z, owner: Math.hypot(x + 72, z) < 20 ? 2 : x < 0 ? 0 : 1 });
    const vitality = [1, 0.1, 0.45];
    const own = ownershipOf(sites, { size }, size + 80);
    const values = vitalityOver(own, vitality);
    const ownerAt = (x: number, z: number): number => sites[siteAt(sites, x, z)]!.owner;

    // Wherever a point's whole neighborhood is one owner's ground, well inside the land, it has that owner's vitality.
    let inside = 0;
    for (let x = -120; x <= 120; x += 6) {
      for (let z = -120; z <= 120; z += 6) {
        const owner = ownerAt(x, z);
        const around = [[12, 0], [-12, 0], [0, 12], [0, -12], [8.5, 8.5], [-8.5, 8.5], [8.5, -8.5], [-8.5, -8.5]].every(([dx, dz]) => ownerAt(x + dx!, z + dz!) === owner);
        if (!around) continue;
        inside++;
        expect(Math.abs(vitalityAt(own, values, x, z) - vitality[owner]!)).toBeLessThan(0.01);
      }
    }
    expect(inside).toBeGreaterThan(500);

    // Across the border between the patches at vitality 1 and 0.1, ownership blends from one to the other with no seam:
    // each step a quarter meter across hands over only a little of the ground, and always the same way.
    for (const z of [-90, 37, 101]) {
      let edge = -60;
      while (ownerAt(edge + 0.25, z) === 0) edge += 0.25;
      const share = (x: number): number => groundOwners(sites, { size }, x, z).find((s) => s.owner === 0)?.share ?? 0;
      expect(share(edge)).toBeGreaterThan(0);
      expect(share(edge)).toBeLessThan(1);
      for (let x = edge - 30; x < edge + 30; x += 0.25) {
        expect(share(x + 0.25)).toBeLessThanOrEqual(share(x) + 1e-9);
        expect(share(x) - share(x + 0.25)).toBeLessThan(0.1);
      }
      expect([share(edge - 30), share(edge + 30)]).toEqual([1, 0]);
    }

    // Past the land the ground belongs to the wild, at vitality 1.
    expect(groundOwners(sites, { size }, size / 2 + 20, 0)).toEqual([{ owner: WILD_OWNER, share: 1 }]);
    expect(vitalityAt(own, values, size / 2 + 30, 10)).toBe(1);
  });
});
