import { describe, expect, it } from "vitest";
import { type BuildingPlan, Library, type RouteSpec, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, RELIEF_PRIMITIVES, ROUTE_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { link, structure } from "@gaia/kinds";
import { STRUCTURE_PRESETS, TRAIL_PRESETS, buildSlots, realize } from "@gaia/realize";
import { bakeTerrain, heightAt, sampleWorld, siteToWorld } from "@gaia/terrain";
import { type StandCode, type StandRequest, standWorld } from "./stand.ts";

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
  trees: { count: 30, seed: 9, presets: 2, builds: 2, bases: [0.5, 0.6, 0.7, 0.8] },
  understory: {
    rules: [{ id: "rocks", variants: [{ radius: 0.8, weight: 1 }], groups: 4, members: [1, 3], spread: 5, mix: "member", scale: [0.8, 1.2], maxSlope: 22, waterClearance: 1.5, ground: "lowest", sink: 0.05 }],
    seed: 5,
  },
};
const bytes = (a: ArrayBufferView): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

describe("standing a world's things on a bake", () => {
  it("stands the same things whether the bake crossed to another thread or not, leveling the pads first", () => {
    const here = bakeTerrain(sampleWorld(), lib);
    // A worker's bake arrives as a structured clone.
    const there = structuredClone(here);
    const a = standWorld(here, request);
    const b = standWorld(there, request);
    expect(bytes(a.ground).equals(bytes(b.ground))).toBe(true);
    expect(bytes(here.lattice.heights).equals(bytes(there.lattice.heights))).toBe(true);
    expect(b.sites).toEqual(a.sites);
    expect(b.trails).toEqual(a.trails);
    expect(b.trees).toEqual(a.trees);
    expect(b.placements).toEqual(a.placements);
    expect(a.trails.length).toBeGreaterThan(0);
    // The ground texture's data is the leveled lattice: each house stands on its own flat pad.
    a.sites.forEach((site, i) => {
      const plan = request.buildings[i]!.plan;
      for (const [lx, lz] of [[0, 0], [plan.width / 2, 0], [0, -plan.depth / 2]] as const) {
        const [x, z] = siteToWorld(site, lx, lz);
        expect(Math.abs(heightAt(here.lattice, x, z) - site.level)).toBeLessThan(0.02);
      }
    });
    const n = here.lattice.n;
    for (let k = 0; k < n * n; k += 1009) expect(a.ground[k * 4]).toBe(here.lattice.heights[k]);
    // Nothing stands in a house: trees keep six meters off its walls.
    for (const t of a.trees) {
      for (const site of a.sites) expect(Math.hypot(t.x - site.x, t.z - site.z)).toBeGreaterThan(4);
    }
  });

  it("stands a world laid out from code: each building and landmark on its lot, each tree on its file's patch, trails between lots", () => {
    const t = bakeTerrain(sampleWorld(), lib);
    const code: StandCode = {
      lots: [{ id: "packages/a", x: -40, z: 30, radius: 9 }, { id: "packages/b", x: 50, z: -20, radius: 9 }],
      landmarks: [{ landmark: 0, lot: { id: "packages/c", x: 10, z: 70, radius: 7 } }],
      patches: [
        { x: -60, z: -50, radius: 12, trees: 4, preset: 0 },
        { x: 20, z: -70, radius: 8, trees: 2, preset: 1 },
        { x: 0, z: 0, radius: 10, trees: 0, preset: -1 },
      ],
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
    expect(stood.trails.length).toBeGreaterThan(0);
    for (const tr of stood.trails) expect(["packages/a->packages/b", "packages/a->packages/c"]).toContain(tr.id);
  });
});
