import { describe, expect, it } from "vitest";
import { Library, blueprintOf, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, RELIEF_PRIMITIVES, fieldAt } from "@gaia/primitives";
import { biome, flora } from "@gaia/kinds";
import { validate } from "@gaia/world";
import { FLORA_PRESETS, realize } from "@gaia/realize";
import {
  RELIEF_BUDGET,
  type Station,
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
  surfaceHalfWidth,
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
