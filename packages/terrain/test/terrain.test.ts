import { describe, expect, it } from "vitest";
import { Library, blueprintOf, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, RELIEF_PRIMITIVES, fieldAt } from "@gaia/primitives";
import { biome, flora } from "@gaia/kinds";
import { validate } from "@gaia/world";
import { FLORA_PRESETS, realize } from "@gaia/realize";
import {
  RELIEF_BUDGET,
  type Station,
  WADE,
  WALK_TO,
  WILDS,
  type Terrain,
  bakeTerrain,
  composer,
  groundedBase,
  heightAt,
  landRadius,
  landformsOf,
  randomWorld,
  sampleWorld,
  scatterPlants,
  sightlines,
  EYE_HEIGHT,
  surfaceHalfWidth,
  wadeSpeed,
  walkStep,
  walkToward,
  waterDepthAt,
  wildsRing,
  withinBudget,
} from "@gaia/terrain";

const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
const bytes = (a: ArrayBufferView): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const draws = Array.from({ length: 16 }, (_, i) => randomWorld(lib, 7000 + i));
const baked: Terrain[] = [sampleWorld(), ...draws].map((w) => bakeTerrain(w, lib));

describe("landforms", () => {
  it("every relief primitive builds a finite, serializable field at its lowest and highest levels", () => {
    for (const p of RELIEF_PRIMITIVES) {
      for (const end of ["first", "last"] as const) {
        const params: Record<string, string | boolean> = {};
        for (const [name, f] of Object.entries(p.params)) {
          if (f.type === "scale") params[name] = (end === "first" ? f.levels[0] : f.levels[f.levels.length - 1])?.words ?? "";
          else if (f.type === "choice") params[name] = Object.keys(f.options)[end === "first" ? 0 : Object.keys(f.options).length - 1] ?? "";
          else if (f.type === "flag") params[name] = end === "last";
        }
        const region = blueprintOf("biome", {
          relief: { use: p.id, params },
          cover: { use: "ground-cover@1", params: { cover: "lush grass", length: "natural", wildflowers: "none" } },
          natives: { use: "native-families@1", params: { families: [] } },
        });
        const world = { size: 320, regions: [{ id: "r", x: 0, z: 0, base: 0, biome: region }] };
        expect(validate(region, biome, lib), p.id).toEqual([]);
        const [lf] = landformsOf(world, lib);
        expect(lf).toBeDefined();
        for (let k = 0; k < 200; k++) expect(Number.isFinite(fieldAt(lf!.height, (k % 20) * 9 - 90, Math.floor(k / 20) * 18 - 90)), p.id).toBe(true);
        // Plain data: a structured clone evaluates identically.
        const clone = structuredClone(lf!);
        expect(fieldAt(clone.height, 13.7, -41.2)).toBe(fieldAt(lf!.height, 13.7, -41.2));
      }
    }
  });
});

describe("terrain", () => {
  it("bakes byte-identical ground and water for the same world", () => {
    const a = bakeTerrain(sampleWorld(), lib);
    const b = bakeTerrain(sampleWorld(), lib);
    expect(bytes(a.lattice.heights).equals(bytes(b.lattice.heights))).toBe(true);
    expect(bytes(a.waterLevel).equals(bytes(b.waterLevel))).toBe(true);
    expect(randomWorld(lib, 42)).toEqual(randomWorld(lib, 42));
  });

  it("keeps every random draw inside the relief budget, after water is cut", () => {
    for (const t of baked) {
      const r = t.report;
      expect(r.range, "range").toBeLessThanOrEqual(RELIEF_BUDGET.range);
      expect(r.maxSlope, "steepest").toBeLessThanOrEqual(RELIEF_BUDGET.maxSlope);
      expect(r.walkShare, "walkable").toBeGreaterThanOrEqual(RELIEF_BUDGET.walkShare);
      expect(r.maxStep, "step").toBeLessThanOrEqual(RELIEF_BUDGET.maxStep);
      expect(withinBudget(r)).toBe(true);
    }
  });

  it("has no seams at region edges: the composed ground is continuous", () => {
    for (const w of [sampleWorld(), ...draws.slice(0, 6)]) {
      const h = composer(w, landformsOf(w, lib));
      // Walk the line between every pair of region centers in 1 mm steps across the blend band and the bisector.
      for (const a of w.regions) {
        for (const b of w.regions) {
          if (a === b) continue;
          const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          const dx = (b.x - a.x) / len;
          const dz = (b.z - a.z) / len;
          for (let s = -30; s <= 30; s += 0.25) {
            const x = mid.x + dx * s;
            const z = mid.z + dz * s;
            const jump = Math.abs(h(x + dx * 0.001, z + dz * 0.001) - h(x, z));
            expect(jump, `${a.id}|${b.id} at ${s}`).toBeLessThan(0.002);
          }
        }
      }
    }
  });

  it("never leaves a crack in the baked lattice: neighbors differ by less than the steepest slope allows", () => {
    const limit = Math.tan((RELIEF_BUDGET.maxSlope * Math.PI) / 180) * 1.5;
    for (const t of baked.slice(0, 4)) {
      const { n, heights, spacing, origin } = t.lattice;
      const half = t.spec.size / 2;
      for (let iz = 0; iz < n - 1; iz++) {
        if (Math.abs(origin + iz * spacing) > half) continue;
        for (let ix = 0; ix < n - 1; ix++) {
          if (Math.abs(origin + ix * spacing) > half) continue;
          const h0 = heights[iz * n + ix]!;
          expect(Math.abs(heights[iz * n + ix + 1]! - h0)).toBeLessThan(limit * spacing);
          expect(Math.abs(heights[(iz + 1) * n + ix]! - h0)).toBeLessThan(limit * spacing);
        }
      }
    }
  });

  it("keeps every stream inside its bed: below the ground beside it, above the ground beneath it", () => {
    let streams = 0;
    for (const t of baked) {
      for (const s of t.streams) {
        streams++;
        const st = s.stations;
        for (let i = 0; i + 1 < st.length; i++) {
          const a = st[i] as Station;
          const b = st[i + 1] as Station;
          // Water only runs downhill.
          expect(b.level).toBeLessThanOrEqual(a.level);
          expect(heightAt(t.lattice, a.x, a.z)).toBeLessThan(a.level);
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          const nx = -(b.z - a.z) / len;
          const nz = (b.x - a.x) / len;
          const edge = surfaceHalfWidth(a);
          for (const side of [-1, 1]) {
            const x = a.x + nx * edge * side;
            const z = a.z + nz * edge * side;
            expect(heightAt(t.lattice, x, z), `bank at station ${i}`).toBeGreaterThanOrEqual(a.level + 0.03);
          }
        }
      }
      for (const p of t.ponds) {
        expect(heightAt(t.lattice, p.x, p.z)).toBeLessThan(p.level);
        for (let k = 0; k < 64; k++) {
          const ang = (k / 64) * Math.PI * 2;
          expect(heightAt(t.lattice, p.x + Math.cos(ang) * p.reach, p.z + Math.sin(ang) * p.reach)).toBeGreaterThan(p.level);
        }
      }
    }
    expect(streams).toBeGreaterThan(3);
  });

  it("grounds plants: every point of a trunk's bottom ring is at or under the ground", () => {
    const floraLib = new Library(FLORA_PRIMITIVES);
    // The first ring of the bark is the trunk's base (10 sides, 11 vertices).
    const bases = FLORA_PRESETS.map(({ blueprint }) => {
      const bark = realize(blueprint, flora, floraLib, { seed: seedOf("p"), facts: { scale: 1, age: 1 } }).parts.find((p) => p.swatch === "bark")!;
      return Array.from({ length: 11 }, (_, k) => [bark.positions[k * 3]!, bark.positions[k * 3 + 1]!, bark.positions[k * 3 + 2]!] as const);
    });
    for (const ring of bases) expect(Math.max(...ring.map((v) => Math.abs(v[1]))), "the origin is the trunk base").toBeLessThan(0.1);
    for (const t of baked.slice(0, 8)) {
      const spots = scatterPlants(t, 16, 9);
      expect(spots.length).toBe(16);
      spots.forEach((s, i) => {
        const ring = bases[i % bases.length]!;
        const radius = Math.max(...ring.map((v) => Math.hypot(v[0], v[2])));
        const y = groundedBase(t.lattice, s.x, s.z, radius);
        const turn = i * 1.7;
        for (const [vx, vy, vz] of ring) {
          // Three's Y rotation: x' = x cos + z sin, z' = -x sin + z cos.
          const x = s.x + vx * Math.cos(turn) + vz * Math.sin(turn);
          const z = s.z - vx * Math.sin(turn) + vz * Math.cos(turn);
          const g = heightAt(t.lattice, x, z);
          expect(y + vy, "no gap under the trunk").toBeLessThanOrEqual(g);
          expect(g - (y + vy), "not sunk deep").toBeLessThan(0.8);
        }
      });
    }
  });

  it("ends sight lines within a few hundred meters at eye height", () => {
    const medians: number[] = [];
    for (const t of baked) {
      for (const r of t.spec.regions) {
        const s = sightlines(t.lattice, r.x, r.z);
        expect(s.max).toBeLessThan(470);
        medians.push(s.median);
      }
    }
    medians.sort((a, b) => a - b);
    expect(medians[Math.floor(medians.length / 2)]).toBeLessThan(200);
  });
});

describe("wild land past the rim", () => {
  it("meets the baked ground at the hand-over circle and rolls at most 6 m once settled", () => {
    const { rings, segments, settle, variation } = WILDS;
    for (const t of baked) {
      const { positions } = wildsRing(t);
      expect(positions.length).toBe(rings * segments * 3);
      const r0 = landRadius(t);
      for (let s = 0; s < segments; s++) {
        const v = (segments + s) * 3;
        const [x, y, z] = [positions[v]!, positions[v + 1]!, positions[v + 2]!];
        expect(Math.hypot(x, z)).toBeCloseTo(r0, 2);
        expect(y).toBeCloseTo(heightAt(t.lattice, x, z), 3);
      }
      let low = Infinity;
      let high = -Infinity;
      for (let v = 0; v < positions.length; v += 3) {
        if (Math.hypot(positions[v]!, positions[v + 2]!) < r0 + settle) continue;
        low = Math.min(low, positions[v + 1]!);
        high = Math.max(high, positions[v + 1]!);
      }
      expect(high - low).toBeLessThanOrEqual(variation + 1e-4);
    }
  });
});

describe("wading", () => {
  const t = baked[0]!;
  const pond = t.ponds[0]!;
  const dt = 1 / 60;
  const walkFrom = (x: number, z: number, dx: number, dz: number, steps: number, speed = 4.2) => {
    const path = [{ x, z }];
    for (let i = 0; i < steps; i++) path.push(walkStep(t, path[path.length - 1]!, { dx, dz, speed }, dt));
    return path;
  };

  it("measures water depth as the surface above the ground, and none on dry land", () => {
    expect(waterDepthAt(t, pond.x, pond.z)).toBeGreaterThan(WADE.deepest);
    expect(waterDepthAt(t, pond.x + pond.reach * 2.5, pond.z)).toBe(0);
    for (let k = 0; k < 400; k++) {
      const x = ((k * 37) % 300) - 150;
      const z = ((k * 91) % 300) - 150;
      expect(waterDepthAt(t, x, z)).toBeGreaterThanOrEqual(0);
    }
  });

  it("never ends a step in water 1.2 m deep or more, so eyes stay above the surface", () => {
    expect(WADE.deepest).toBeLessThan(EYE_HEIGHT);
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const start = { x: pond.x + Math.cos(ang) * pond.reach * 1.6, z: pond.z + Math.sin(ang) * pond.reach * 1.6 };
      for (const p of walkFrom(start.x, start.z, -Math.cos(ang), -Math.sin(ang), 900)) {
        expect(waterDepthAt(t, p.x, p.z)).toBeLessThan(WADE.deepest);
      }
    }
  });

  it("slows as the water deepens", () => {
    expect(wadeSpeed(0)).toBe(1);
    expect(wadeSpeed(1.1)).toBeCloseTo(0.4, 6);
    const dry = walkStep(t, { x: pond.x + pond.reach * 2, z: pond.z }, { dx: 0, dz: 1, speed: 4 }, 0.1);
    const dryStep = Math.hypot(dry.x - pond.x - pond.reach * 2, dry.z - pond.z);
    // A point in shallow water at the pond's edge.
    let wet = { x: pond.x, z: pond.z };
    for (let r = pond.reach; r > 0; r -= 0.25) {
      const d = waterDepthAt(t, pond.x + r, pond.z);
      if (d > 0.5 && d < 1) {
        wet = { x: pond.x + r, z: pond.z };
        break;
      }
    }
    const depth = waterDepthAt(t, wet.x, wet.z);
    expect(depth).toBeGreaterThan(0.5);
    const moved = walkStep(t, wet, { dx: 0, dz: 1, speed: 4 }, 0.1);
    const wetStep = Math.hypot(moved.x - wet.x, moved.z - wet.z);
    expect(wetStep).toBeLessThan(dryStep * 0.85);
    expect(wetStep).toBeCloseTo(dryStep * wadeSpeed(depth), 6);
  });

  it("slides along the deep water's edge instead of stopping dead", () => {
    // Walk straight across the pond's near side: the deep middle turns the
    // walker aside, and they slide around it and come out past the pond.
    // The farthest line from the middle that still crosses deep water.
    const crosses = (z: number): boolean =>
      Array.from({ length: 200 }, (_, k) => pond.x + (k / 100 - 1) * pond.reach).some((x) => waterDepthAt(t, x, z) >= WADE.deepest + 0.05);
    let z = pond.z;
    while (crosses(z - 0.5)) z -= 0.5;
    const path = walkFrom(pond.x - pond.reach * 1.5, z, 1, 0, 3600);
    expect(path.some((p) => Math.abs(p.z - z) > 0.2)).toBe(true);
    expect(path[path.length - 1]!.x).toBeGreaterThan(pond.x + pond.reach * 0.5);
    for (const p of path) expect(waterDepthAt(t, p.x, p.z)).toBeLessThan(WADE.deepest);
  });

});

describe("walking to a tapped point", () => {
  const t = baked[0]!;
  const pond = t.ponds[0]!;
  const dt = 1 / 60;
  type Point = { x: number; z: number };
  /** Steps toward `target` until the walk ends, at most a minute of it. */
  const walkTo = (from: Point, target: Point) => {
    let at = from;
    const path = [at];
    for (let i = 0; i < 3600; i++) {
      const next = walkToward(t, at, target, dt);
      at = next.walker;
      path.push(at);
      if (next.state !== "walking") return { state: next.state, at, path, seconds: (i + 1) * dt };
    }
    return { state: "walking" as const, at, path, seconds: 60 };
  };
  // The sample world's pond lies near its east edge, so the dry ground to walk on is west of it.
  const dry = { x: pond.x - pond.reach * 2.5, z: pond.z };
  const firstStep = (target: Point): number => {
    const { walker } = walkToward(t, dry, target, dt);
    return Math.hypot(walker.x - dry.x, walker.z - dry.z);
  };

  it("walks to a point on dry ground and ends the walk within reach of it", () => {
    const target = { x: dry.x - 12, z: dry.z + 5 };
    expect(waterDepthAt(t, dry.x, dry.z)).toBe(0);
    expect(waterDepthAt(t, target.x, target.z)).toBe(0);
    const walk = walkTo(dry, target);
    expect(walk.state).toBe("arrived");
    expect(Math.hypot(walk.at.x - target.x, walk.at.z - target.z)).toBeLessThanOrEqual(WALK_TO.reach);
    // At walking pace, straight there.
    expect(walk.seconds).toBeCloseTo((13 - WALK_TO.reach) / WALK_TO.pace, 1);
  });

  it("walks to a near point at walking pace and jogs toward a far one", () => {
    expect(firstStep({ x: dry.x - 10, z: dry.z })).toBeCloseTo(WALK_TO.pace * dt, 6);
    expect(firstStep({ x: dry.x - 60, z: dry.z })).toBeCloseTo(WALK_TO.pace * WALK_TO.jog * dt, 6);
  });

  it("stops at the edge of deep water across the way instead of pushing into it", () => {
    const west = { x: pond.x - pond.reach * 1.6, z: pond.z };
    const walk = walkTo(west, { x: pond.x + pond.reach * 1.6, z: pond.z });
    expect(walk.state).toBe("stalled");
    for (const p of walk.path) expect(waterDepthAt(t, p.x, p.z)).toBeLessThan(WADE.deepest);
    // At the shore: the deep water starts within a stride ahead.
    expect(walk.at.x).toBeGreaterThan(west.x + pond.reach * 0.3);
    expect(waterDepthAt(t, walk.at.x + 1, walk.at.z)).toBeGreaterThanOrEqual(WADE.deepest);
    // Asked again, the walk stays where it stopped.
    expect(walkToward(t, walk.at, { x: pond.x + pond.reach * 1.6, z: pond.z }, dt)).toEqual({ walker: walk.at, state: "stalled" });
  });

  it("slides past deep water it only brushes and still arrives", () => {
    const crosses = (z: number): boolean =>
      Array.from({ length: 200 }, (_, k) => pond.x + (k / 100 - 1) * pond.reach).some((x) => waterDepthAt(t, x, z) >= WADE.deepest + 0.05);
    let z = pond.z;
    while (crosses(z - 0.5)) z -= 0.5;
    const target = { x: pond.x + pond.reach * 1.8, z };
    const walk = walkTo({ x: pond.x - pond.reach * 1.8, z }, target);
    expect(walk.state).toBe("arrived");
    for (const p of walk.path) expect(waterDepthAt(t, p.x, p.z)).toBeLessThan(WADE.deepest);
  });

  it("ends the walk where it stands when the point is within reach", () => {
    expect(walkToward(t, dry, { x: dry.x + 1, z: dry.z + 0.5 }, dt)).toEqual({ walker: dry, state: "arrived" });
  });
});
