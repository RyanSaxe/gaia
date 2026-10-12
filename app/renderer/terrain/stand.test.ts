import { describe, expect, it } from "vitest";
import { type BuildingPlan, Library, type RouteSpec, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, RELIEF_PRIMITIVES, ROUTE_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { link, structure } from "@gaia/kinds";
import { STRUCTURE_PRESETS, TRAIL_PRESETS, buildSlots, realize } from "@gaia/realize";
import { type Placement, SHORE_CAP, TILE, bakeTerrain, frameOf, heightAt, planTerrain, sampleWorld, siteToWorld, standTile, tileTerrain, trailField, trailPlaces } from "@gaia/terrain";
import { type StandCode, type StandRequest, TILE_SCATTER, scatterTile, standWorld, tilesOf } from "./stand.ts";

const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
const buildingLib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
const routeLib = new Library(ROUTE_PRIMITIVES);
const styles = TRAIL_PRESETS.map((p) => buildSlots(p.blueprint, link, routeLib, { seed: 1, facts: {} }).get("route")?.output as RouteSpec);
const request: StandRequest = {
  buildings: STRUCTURE_PRESETS.slice(0, 2).map((p, i) => ({
    name: `home-${i}`,
    plan: realize(p.blueprint, structure, buildingLib, { seed: seedOf(`home-${i}`), facts: { size: 1, floors: 1 } }).slots.get("footprint")?.output as BuildingPlan,
    beside: null,
  })),
  landmarks: [{ name: "Lantern tower", base: 3 }, { name: "Great oak", base: 2 }],
  trailStyles: [styles[0]!, styles[1]!, styles[2]!],
  trees: { count: 30, seed: 9, presets: 2, builds: 2, bases: [0.5, 0.6, 0.7, 0.8], crowns: [3, 3, 4, 4] },
  understory: {
    rules: [{ id: "rocks", variants: [{ radius: 0.8, weight: 1 }], groups: 4, members: [1, 3], spread: 5, mix: "member", scale: [0.8, 1.2], maxSlope: 22, waterClearance: 1.5, ground: "lowest", sink: 0.05 }],
    seed: 5,
  },
};
const bytes = (a: ArrayBufferView): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
/** The sample world, baked once; standing levels a bake's ground, so each test stands its own copy. */
const baked = bakeTerrain(sampleWorld(), lib);
const pristine = structuredClone(baked);
const forTiles = structuredClone(baked);
const forScatter = structuredClone(baked);

describe("standing a world's things on a bake", () => {
  it("stands the same things whether the bake crossed to another thread or not, leveling the pads first", () => {
    const here = baked;
    // A worker's bake arrives as a structured clone.
    const there = structuredClone(pristine);
    const a = standWorld(here, request);
    const b = standWorld(there, request);
    expect(b.edits).toEqual(a.edits);
    expect(bytes(here.lattice.heights).equals(bytes(there.lattice.heights))).toBe(true);
    expect(b.sites).toEqual(a.sites);
    expect(b.network).toEqual(a.network);
    expect(b.trees).toEqual(a.trees);
    expect(b.placements).toEqual(a.placements);
    expect(a.network.ways.length).toBeGreaterThan(0);
    // Each house stands on its own flat pad.
    a.sites.forEach((site, i) => {
      const plan = request.buildings[i]!.plan;
      for (const [lx, lz] of [[0, 0], [plan.width / 2, 0], [0, -plan.depth / 2]] as const) {
        const [x, z] = siteToWorld(site, lx, lz);
        expect(Math.abs(heightAt(here.lattice, x, z) - site.level)).toBeLessThan(0.02);
      }
    });
    // Nothing stands in a house: trees keep six meters off its walls.
    for (const t of a.trees) {
      for (const site of a.sites) expect(Math.hypot(t.x - site.x, t.z - site.z)).toBeGreaterThan(4);
    }
  });

  it("stands a world laid out from code: each building and landmark on its lot, each tree on its file's patch, trails between lots", () => {
    const t = pristine;
    const code: StandCode = {
      lots: [{ id: "packages/a", x: -40, z: 30, radius: 9 }, { id: "packages/b", x: 50, z: -20, radius: 9 }],
      landmarks: [{ landmark: 0, lot: { id: "packages/c", x: 10, z: 70, radius: 7 } }],
      patches: [
        { x: -60, z: -50, radius: 12, trees: 4, preset: 0, heart: { x: -60, z: -50 }, closeness: 0.7, reach: 12, stature: 1, seed: 1 },
        { x: 20, z: -70, radius: 8, trees: 2, preset: 1, heart: { x: 20, z: -70 }, closeness: 0.7, reach: 8, stature: 1, seed: 2 },
        { x: 0, z: 0, radius: 10, trees: 0, preset: -1, heart: { x: 0, z: 0 }, closeness: 0.7, reach: 10, stature: 1, seed: 3 },
      ],
      cells: [],
      symbols: [{ x: -55, z: -40, rule: "rocks", variant: 0, radius: 0.8, scale: 1, vitality: 0.3 }],
      regions: [],
      trails: [{ from: "packages/a", to: "packages/b", want: 0.9, style: 0 }, { from: "packages/a", to: "packages/c", want: 0.8, style: 1 }],
    };
    const stood = standWorld(t, { ...request, code });
    stood.sites.forEach((site, i) => {
      const lot = code.lots[i]!;
      expect(Math.hypot(site.x - lot.x, site.z - lot.z)).toBeLessThanOrEqual(lot.radius + 1e-6);
    });
    const [lm] = stood.landmarks;
    expect(lm?.landmark).toBe(0);
    expect(Math.hypot(lm!.site.x - 10, lm!.site.z - 70)).toBeLessThanOrEqual(7 + 1e-6);
    expect(stood.trees.length).toBeGreaterThan(0);
    for (const tree of stood.trees) {
      const patch = code.patches[tree.patch!]!;
      expect(Math.hypot(tree.x - patch.x, tree.z - patch.z)).toBeLessThanOrEqual(patch.radius);
      expect(Math.floor(tree.variant / request.trees.builds)).toBe(patch.preset);
    }
    expect(stood.trees.some((tree) => tree.patch === 2)).toBe(false);
    // A file's function stands near where the layout put it, as the blueprint it was given, with its file's vitality.
    const sym = stood.placements[stood.symbols[0]!]!;
    expect(sym).toMatchObject({ rule: "rocks", variant: 0, vitality: 0.3 });
    expect(Math.hypot(sym.x + 55, sym.z + 40)).toBeLessThan(5);
    expect(stood.network.trails.length).toBeGreaterThan(0);
    for (const tr of stood.network.trails) expect(["packages/a->packages/b", "packages/a->packages/c"]).toContain(tr.id);
  });

  // Bakes and levels every 64-sample tile of the land, and the land twice more at coarser strides: two seconds alone,
  // several when other work shares the machine.
  it("bakes each tile of the land alone, leveled as standing leveled the world, sample for sample", { timeout: 20_000 }, () => {
    const t = forTiles;
    const stood = standWorld(t, request);
    expect(stood.edits.pads.length).toBe(request.buildings.length);
    expect(stood.edits.ways.length).toBeGreaterThan(0);
    const plan = planTerrain(t.spec, t.landforms);
    const size = 64;
    const { n } = t.lattice;
    const field = trailField(t, stood.network.ways);
    const places = trailPlaces(t, stood.network.ways);
    const differ = { heights: 0, water: 0, shore: 0, field: 0, places: 0 };
    for (let z0 = 0; z0 < n; z0 += size) {
      for (let x0 = 0; x0 < n; x0 += size) {
        const tile = standTile(plan, stood.edits, stood.network.ways, x0, z0, size);
        for (let j = 0; j < Math.min(size, n - z0); j++) {
          for (let i = 0; i < Math.min(size, n - x0); i++) {
            const w = (z0 + j) * n + x0 + i;
            const k = j * size + i;
            if (tile.heights[k] !== t.lattice.heights[w]) differ.heights++;
            if (tile.waterLevel[k] !== t.waterLevel[w]) differ.water++;
            if (tile.shore[k] !== t.shore[w]) differ.shore++;
            if (tile.trailField[k] !== field[w]) differ.field++;
            if (tile.trailPlaces[k * 2] !== places[w * 2] || tile.trailPlaces[k * 2 + 1] !== places[w * 2 + 1]) differ.places++;
          }
        }
      }
    }
    expect(differ).toEqual({ heights: 0, water: 0, shore: 0, field: 0, places: 0 });
    // A coarser level takes every stride-th sample: the same land, but for the shore it measures between its own
    // samples, and the treads it eases by that shore, all close to the water.
    for (const stride of [2, 4]) {
      const side = Math.ceil(n / stride);
      const tile = standTile(plan, stood.edits, stood.network.ways, 0, 0, side, stride);
      let wet = 0;
      const coarse = { water: 0, region: 0, dryHeights: 0 };
      for (let j = 0; j * stride < n; j++) {
        for (let i = 0; i * stride < n; i++) {
          const w = j * stride * n + i * stride;
          const k = j * side + i;
          if (tile.waterLevel[k] !== t.waterLevel[w]) coarse.water++;
          if (tile.region[k] !== t.region[w]) coarse.region++;
          if ((t.shore[w] as number) < SHORE_CAP) wet++;
          else if (tile.heights[k] !== t.lattice.heights[w]) coarse.dryHeights++;
        }
      }
      expect(coarse, `stride ${stride}`).toEqual({ water: 0, region: 0, dryHeights: 0 });
      expect(wet).toBeGreaterThan(0);
    }
  });

  // Each tile's window is a few hundred meters a side: a second or so of baking when other work shares the machine.
  it("scatters a tile's understory alone, on its own window of the land, as it stands with the world", { timeout: 20_000 }, () => {
    const t = forScatter;
    const stood = standWorld(t, request);
    const plan = planTerrain(t.spec, t.landforms);
    const m = Math.ceil(TILE_SCATTER.sites + TILE_SCATTER.reads) + 2;
    const tiles = tilesOf(t.spec);
    expect(tiles.length).toBeGreaterThan(1);
    let total = 0;
    for (const [ti, tj] of tiles) {
      const withWorld = scatterTile(t, stood.scatter, ti, tj);
      const window = tileTerrain(plan, standTile(plan, stood.edits, stood.network.ways, ti * TILE.size - m, tj * TILE.size - m, TILE.size + 2 * m));
      // The same groups and members; heights read between samples from the window's own origin differ only in rounding.
      const settled = (ps: readonly Placement[]) => ps.map((p) => ({ ...p, y: Math.round(p.y * 1e9) }));
      expect(settled(scatterTile(window, stood.scatter, ti, tj)), `tile (${ti}, ${tj})`).toEqual(settled(withWorld));
      total += withWorld.length;
    }
    // Every tile's own groups, and no group twice: the world's understory is its tiles'.
    expect(stood.placements.length - stood.symbols.length).toBe(total);
    expect(total).toBeGreaterThan(0);
    expect(frameOf(t.spec).n).toBeGreaterThan(TILE.size);
  });
});
