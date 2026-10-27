import { describe, expect, it } from "vitest";
import { type BuildingPlan, type Built, Library, type RouteSpec, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, RELIEF_PRIMITIVES, ROUTE_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { link, structure } from "@gaia/kinds";
import { buildSlots, realize } from "@gaia/realize";
import { sweep } from "@gaia/world";
import { SHORE_CAP, bakeTerrain, extentOf, heightAt, planTerrain, siteToWorld, standTile, trailField, trailPlaces, yardsMeet } from "@gaia/terrain";
import { sampleWorld } from "@gaia/terrain/testing";
import { type StandCode, type StandRequest, blockedBy, standWorld } from "./stand.ts";

const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
const buildingLib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
const routeLib = new Library(ROUTE_PRIMITIVES);
/** The first two trails of a sweep of a trail's parts: one crossing streams on a footbridge, the other on stepping stones. */
const styles = sweep(link, routeLib).blueprints.slice(0, 2).map((b) => buildSlots(b, link, routeLib, { seed: 1, facts: {} }).get("route")?.output as RouteSpec);
/** The first three houses of a sweep of a building's parts that stand as a single block and need no stream, small enough for this world's lots. */
const houses = sweep(structure, buildingLib).blueprints.filter((b) => b.slots.footprint?.params.massing === "a single block" && b.slots.feature?.use !== "waterwheel@1").slice(0, 3);
/** A world laid out from code, as small as the tests need: two buildings' lots, a landmark's, three files' patches and what stands on them. */
const code: StandCode = {
  lots: [{ id: "packages/a", x: -40, z: 30, radius: 9 }, { id: "packages/b", x: 50, z: -20, radius: 9 }],
  landmarks: [{ landmark: 0, lot: { id: "packages/c", x: 10, z: 70, radius: 7 } }],
  patches: [
    { x: -60, z: -50, radius: 12 },
    { x: 20, z: -70, radius: 8 },
    { x: 0, z: 0, radius: 10 },
  ],
  cells: [],
  symbols: [
    { x: -55, z: -40, rule: "rocks", variant: 0, radius: 0.8, scale: 1, vitality: 0.3 },
    { x: -64, z: -54, rule: "trees", variant: 0, radius: 1, scale: 1, vitality: 0.8 },
    { x: 20, z: -70, rule: "trees", variant: 1, radius: 1, scale: 0.7, vitality: 0.4 },
  ],
  trails: [{ from: "packages/a", to: "packages/b", want: 0.9, style: styles[0]! }, { from: "packages/a", to: "packages/c", want: 0.8, style: styles[1]! }],
};
const request: StandRequest = {
  buildings: houses.slice(0, 2).map((blueprint, i) => ({
    name: `home-${i}`,
    plan: realize(blueprint, structure, buildingLib, { seed: seedOf(`home-${i}`), facts: { size: 1, floors: 1 } }).slots.get("footprint")?.output as BuildingPlan,
    beside: null,
  })),
  landmarks: [{ base: 3, tree: false }],
  trees: { builds: 2, bases: [0.5, 0.6, 0.7, 0.8], crowns: [3, 3, 4, 4] },
  code,
};
const bytes = (a: ArrayBufferView): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
/** A test world, baked once; standing levels a bake's ground, so each test stands its own copy. */
const baked = bakeTerrain(sampleWorld(), lib);
const pristine = structuredClone(baked);
const forTiles = structuredClone(baked);
const forOneLot = structuredClone(baked);

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

  it("stands a world laid out from code: each building and landmark on its lot, each definition near its spot as a tree, a stone, a bush or flowers and nothing else besides, trails between lots", () => {
    const t = pristine;
    const code = request.code;
    const stood = standWorld(t, request);
    stood.sites.forEach((site, i) => {
      const lot = code.lots[i]!;
      expect(Math.hypot(site.x - lot.x, site.z - lot.z)).toBeLessThanOrEqual(lot.radius + 1e-6);
    });
    const [lm] = stood.landmarks;
    expect(lm?.landmark).toBe(0);
    expect(Math.hypot(lm!.site.x - 10, lm!.site.z - 70)).toBeLessThanOrEqual(7 + 1e-6);
    // Every tree is a definition that stands as one, near where the layout put it, as the tree it was given; nothing
    // else grows trees.
    expect(stood.trees.map((tree) => tree.symbol).sort()).toEqual([1, 2]);
    for (const tree of stood.trees) {
      const sym = code.symbols[tree.symbol!]!;
      expect(Math.hypot(tree.x - sym.x, tree.z - sym.z)).toBeLessThan(8);
      expect(Math.floor(tree.variant / request.trees.builds)).toBe(sym.variant);
    }
    expect(stood.symbols.slice(1)).toEqual([-1, -1]);
    // A file's function stands near where the layout put it, as the blueprint it was given, with its own vitality.
    const sym = stood.placements[stood.symbols[0]!]!;
    expect(sym).toMatchObject({ rule: "rocks", variant: 0, vitality: 0.3 });
    expect(Math.hypot(sym.x + 55, sym.z + 40)).toBeLessThan(5);
    // No stone, bush or flowers stands for nothing: the land between the things that stand for code is grass, ground and water.
    expect(stood.placements).toEqual([sym]);
    expect(stood.network.trails.length).toBeGreaterThan(0);
    for (const tr of stood.network.trails) expect(["packages/a->packages/b", "packages/a->packages/c"]).toContain(tr.id);
  });

  it("stands buildings and a landmark laid out on one lot each on ground of its own, as a crowded file's definitions are", () => {
    const buildings = houses.map((blueprint, i) => {
      const built = realize(blueprint, structure, buildingLib, { seed: seedOf(`crowded-${i}`), facts: { size: 1, floors: 1 } });
      return { name: `crowded-${i}`, plan: built.slots.get("footprint")?.output as BuildingPlan, beside: extentOf(built.slots.get("feature")?.output as Built | undefined) };
    });
    // One middle for all four, with the lots the layout gives a building and a landmark.
    const code: StandCode = {
      lots: buildings.map((b) => ({ id: b.name, x: -40, z: 30, radius: 5.4 })),
      landmarks: [{ landmark: 0, lot: { id: "tower", x: -40, z: 30, radius: 4.2 } }],
      patches: [],
      cells: [],
      symbols: [],
      trails: [],
    };
    const stood = standWorld(forOneLot, { ...request, buildings, code });
    const pads = stood.edits.pads;
    pads.forEach((a, i) => pads.forEach((b, k) => expect(k > i && yardsMeet(a, b), `${i} and ${k}`).toBe(false)));
    const [tower] = stood.landmarks;
    expect(tower).toBeDefined();
    buildings.forEach((b, k) => expect(blockedBy(b, stood.sites[k]!, tower!.site.x, tower!.site.z, request.landmarks[0]!.base), b.name).toBe(false));
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
    const differ = { heights: 0, water: 0, shore: 0, nearPond: 0, field: 0, places: 0 };
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
            if (tile.nearPond[k] !== t.nearPond[w]) differ.nearPond++;
            if (tile.trailField[k] !== field[w]) differ.field++;
            if (tile.trailPlaces[k * 2] !== places[w * 2] || tile.trailPlaces[k * 2 + 1] !== places[w * 2 + 1]) differ.places++;
          }
        }
      }
    }
    expect(differ).toEqual({ heights: 0, water: 0, shore: 0, nearPond: 0, field: 0, places: 0 });
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
});
