import { describe, expect, it } from "vitest";
import { Library, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { rock } from "@gaia/kinds";
import { ROCK_PRESETS, realize } from "@gaia/realize";
import { type Placement, type ScatterRule, type Terrain, bakeTerrain, growGrove, heightAt, randomWorld, sampleWorld, scatterComponents, slopeAt, waterDepthAt } from "@gaia/terrain";

const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
const worlds: Terrain[] = [sampleWorld(), randomWorld(lib, 7003), randomWorld(lib, 7011)].map((w) => bakeTerrain(w, lib));

const RULES: readonly ScatterRule[] = [
  {
    id: "rocks",
    variants: [{ radius: 0.9, weight: 2 }, { radius: 1.6, weight: 1 }],
    groups: 4,
    members: [1, 4],
    spread: 6,
    mix: "member",
    scale: [0.7, 1.25],
    maxSlope: 22,
    waterClearance: 1.5,
    ground: "lowest",
    sink: 0.05,
  },
  {
    id: "flowers",
    variants: [{ radius: 2, weight: 1 }, { radius: 1.2, weight: 1 }],
    groups: 5,
    members: [2, 5],
    spread: 7,
    mix: "group",
    scale: [0.8, 1.15],
    maxSlope: 20,
    waterClearance: 1,
    ground: "plane",
    sink: 0.02,
  },
];
const TREES = [{ x: 0, z: 0, radius: 6 }];
const placedIn = worlds.map((t) => scatterComponents(t, RULES, 21, TREES));
const ruleOf = (p: Placement): ScatterRule => RULES.find((r) => r.id === p.rule)!;
const ring = (p: Placement, share: number): [number, number][] =>
  Array.from({ length: 24 }, (_, k) => [p.x + Math.cos((k / 24) * Math.PI * 2) * p.radius * share, p.z + Math.sin((k / 24) * Math.PI * 2) * p.radius * share]);

describe("scatterComponents", () => {
  it("places the same things in the same spots for the same seed, and others for another", () => {
    const t = worlds[0]!;
    expect(scatterComponents(t, RULES, 21, TREES)).toEqual(placedIn[0]);
    expect(scatterComponents(t, RULES, 22, TREES)).not.toEqual(placedIn[0]);
  });

  it("fills every world with groups of each rule", () => {
    for (const placed of placedIn) {
      for (const rule of RULES) expect(placed.filter((p) => p.rule === rule.id).length, rule.id).toBeGreaterThan(30);
    }
  });

  it("keeps everything apart, clear of what already stands, and off steep ground", () => {
    for (const [w, placed] of placedIn.entries()) {
      const t = worlds[w]!;
      placed.forEach((a, i) => {
        expect(slopeAt(t.lattice, a.x, a.z), "slope").toBeLessThanOrEqual(ruleOf(a).maxSlope);
        for (const tree of TREES) expect(Math.hypot(a.x - tree.x, a.z - tree.z)).toBeGreaterThanOrEqual((a.radius + tree.radius) * 0.85);
        for (const b of placed.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual((a.radius + b.radius) * 0.85 - 1e-9);
      });
    }
  });

  it("never stands in water or on a stream bed", () => {
    for (const [w, placed] of placedIn.entries()) {
      const t = worlds[w]!;
      for (const p of placed) {
        for (const [x, z] of [[p.x, p.z] as [number, number], ...ring(p, 1)]) expect(waterDepthAt(t, x, z), p.rule).toBe(0);
      }
    }
  });

  it("grounds solid things below the lowest ground under them, buried no deeper than the slope demands", () => {
    for (const [w, placed] of placedIn.entries()) {
      const t = worlds[w]!;
      for (const p of placed.filter((q) => q.rule === "rocks")) {
        const tan = Math.tan((ruleOf(p).maxSlope * Math.PI) / 180);
        for (const [x, z] of ring(p, 0.85)) {
          const g = heightAt(t.lattice, x, z);
          expect(p.y, "no gap under the base").toBeLessThanOrEqual(g + 1e-6);
          expect(g - p.y, "not sunk deeper than the slope across it").toBeLessThanOrEqual(tan * p.radius * 2 + 0.1);
        }
      }
    }
  });

  it("lays drifts on the ground's plane, never more than a centimeter above the ground under them", () => {
    for (const [w, placed] of placedIn.entries()) {
      const t = worlds[w]!;
      for (const p of placed.filter((q) => q.rule === "flowers")) {
        for (const share of [0.3, 0.6, 1]) {
          for (const [x, z] of ring(p, share)) {
            const plane = p.y + p.slope[0] * (x - p.x) + p.slope[1] * (z - p.z);
            const g = heightAt(t.lattice, x, z);
            expect(plane, "never floating").toBeLessThanOrEqual(g + 0.01);
            expect(g - plane, "stems stay out of the ground").toBeLessThan(0.4);
          }
        }
      }
    }
  });

  it("seats a real rock so the edge where it meets the ground is never above the ground", () => {
    const rockLib = new Library(PRIMITIVES);
    const t = worlds[0]!;
    const placed = placedIn[0]!.filter((p) => p.rule === "rocks").slice(0, 24);
    const bodies = ROCK_PRESETS.map(({ blueprint }) => realize(blueprint, rock, rockLib, { seed: seedOf("r"), facts: { scale: 1 } }).parts[0]!);
    placed.forEach((p, i) => {
      const body = bodies[i % bodies.length]!;
      let reach = 0;
      for (let k = 0; k < body.positions.length; k += 3) if (body.positions[k + 1]! < 0.6) reach = Math.max(reach, Math.hypot(body.positions[k]!, body.positions[k + 2]!));
      // Scale the body to the placement's footprint, as the lab does.
      const s = p.radius / reach;
      for (let k = 0; k < body.positions.length; k += 3) {
        const vy = body.positions[k + 1]!;
        if (Math.abs(vy) > 0.02) continue;
        const vx = body.positions[k]! * s;
        const vz = body.positions[k + 2]! * s;
        const x = p.x + vx * Math.cos(p.yaw) + vz * Math.sin(p.yaw);
        const z = p.z - vx * Math.sin(p.yaw) + vz * Math.cos(p.yaw);
        expect(p.y + vy * s, "the rock's ground line is under the turf").toBeLessThanOrEqual(heightAt(t.lattice, x, z) + 0.06);
      }
    });
  });

  it("grows each thing where it belongs: woodland plants under a grove's canopy, meadow flowers in the open, and a change in one place moves nothing far from it", () => {
    const t = worlds[0]!;
    const grove = growGrove({ x: -40, z: 40, count: 40, spacing: 6, reach: 70, seed: 3 }, () => true).map(([x, z]) => ({ x, z, radius: 6.5 }));
    const rules: ScatterRule[] = [
      { ...RULES[1]!, id: "woodland", groups: 65, places: { under: 1, edge: 0, open: 0, dry: 0, wet: 0 } },
      { ...RULES[1]!, id: "meadow", groups: 8, places: { under: 0, edge: 0, open: 1, dry: 0, wet: 0 } },
    ];
    const placed = scatterComponents(t, rules, 5, [], { canopy: grove });
    const crowns = (p: Placement): number => grove.filter((c) => Math.hypot(c.x - p.x, c.z - p.z) < c.radius + p.radius * 2).length;
    const woodland = placed.filter((p) => p.rule === "woodland");
    expect(woodland.length).toBeGreaterThan(3);
    for (const p of woodland) expect(crowns(p), "a woodland plant stands under the grove").toBeGreaterThan(0);
    const meadow = placed.filter((p) => p.rule === "meadow");
    expect(meadow.length).toBeGreaterThan(30);
    expect(meadow.filter((p) => Math.hypot(p.x + 40, p.z - 40) < 25)).toHaveLength(0);
    // A tree planted far away changes nothing here.
    const moved = scatterComponents(t, rules, 5, [], { canopy: [...grove, { x: 120, z: -120, radius: 5 }] });
    const near = (list: readonly Placement[]) => list.filter((p) => Math.hypot(p.x - 120, p.z + 120) > 40);
    expect(near(moved)).toEqual(near(placed));
  });

  it("grows a grove close at its heart, thinning toward its margin, on ground it fits", () => {
    const fits = (x: number): boolean => x < 30;
    const trees = growGrove({ x: 0, z: 0, count: 30, spacing: 6, reach: 80, seed: 11 }, fits);
    expect(trees).toHaveLength(30);
    expect(trees[0]).toEqual([0, 0]);
    for (const [x] of trees) expect(x).toBeLessThan(30);
    const gap = ([x, z]: [number, number]): number => Math.min(...trees.filter((o) => o[0] !== x || o[1] !== z).map((o) => Math.hypot(o[0] - x, o[1] - z)));
    for (const tr of trees) expect(gap(tr)).toBeGreaterThanOrEqual(6 - 1e-9);
    const byReach = [...trees].sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    const mean = (list: [number, number][]): number => list.reduce((n, tr) => n + gap(tr), 0) / list.length;
    expect(mean(byReach.slice(0, 10)), "the heart stands closer than the margin").toBeLessThan(mean(byReach.slice(-8)));
  });
});
