import { describe, expect, it } from "vitest";
import { type Blueprint, type BuildingPlan, type Built, type FilledSlot, Library, type Skeleton, blueprintOf, rand, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, BUSH_PRIMITIVES, FLORA_PRIMITIVES, RELIEF_PRIMITIVES, STRUCTURE_PRIMITIVES, TREE_PRIMITIVES, fieldAt } from "@gaia/primitives";
import { biome, bush, structure, tree } from "@gaia/kinds";
import { sweep, validate } from "@gaia/world";
import { randomSlots } from "@gaia/world/testing";
import { type Realized, realize } from "@gaia/realize";
import {
  type BuildingSite,
  RELIEF_BUDGET,
  type Station,
  TERRAIN,
  WILDS,
  type Terrain,
  bakeTerrain,
  extentOf,
  composer,
  coverWeights,
  findSite,
  groundHeightAt,
  levelPad,
  siteToWorld,
  groundedBase,
  groundSlope,
  heightAt,
  landHalf,
  landformsOf,
  slopeAt,
  isWet,
  PLANT_SLOPE,
  streamFlow,
  surfaceHalfWidth,
  waterDepthAt,
  wildPast,
  wildRollAt,
  wildShare,
  wildThicket,
  wildsRing,
  withinBudget,
} from "@gaia/terrain";
import { randomWorld, sampleWorld } from "@gaia/terrain/testing";

const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
const bytes = (a: ArrayBufferView): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const draws = Array.from({ length: 16 }, (_, i) => randomWorld(lib, 7000 + i));
/** Baked once and only read: the sample world, then sixteen random draws. */
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
        // It is plain data, so a structured clone evaluates identically.
        const clone = structuredClone(lf!);
        expect(fieldAt(clone.height, 13.7, -41.2)).toBe(fieldAt(lf!.height, 13.7, -41.2));
      }
    }
  });
});

// Some tests here bake a world or read every baked sample. Each takes up to a second alone, and several when other work shares the machine.
describe("terrain", { timeout: 20_000 }, () => {
  it("bakes byte-identical ground and water for the same world", () => {
    const a = baked[0] as Terrain;
    const b = bakeTerrain(sampleWorld(), lib);
    expect(bytes(a.lattice.heights).equals(bytes(b.lattice.heights))).toBe(true);
    expect(bytes(a.waterLevel).equals(bytes(b.waterLevel))).toBe(true);
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
    // The baked lattice has no crack: neighbors differ by less than the steepest slope allows.
    const limit = Math.tan((RELIEF_BUDGET.maxSlope * Math.PI) / 180) * 1.5;
    for (const [i, t] of baked.slice(0, 4).entries()) {
      const { n, heights, spacing, origin } = t.lattice;
      const half = t.spec.size / 2;
      let steepest = { step: 0, x: 0, z: 0 };
      for (let iz = 0; iz < n - 1; iz++) {
        if (Math.abs(origin + iz * spacing) > half) continue;
        for (let ix = 0; ix < n - 1; ix++) {
          if (Math.abs(origin + ix * spacing) > half) continue;
          const h0 = heights[iz * n + ix]!;
          const step = Math.max(Math.abs(heights[iz * n + ix + 1]! - h0), Math.abs(heights[(iz + 1) * n + ix]! - h0));
          if (step > steepest.step) steepest = { step, x: origin + ix * spacing, z: origin + iz * spacing };
        }
      }
      expect(steepest.step, `world ${i} at (${steepest.x}, ${steepest.z})`).toBeLessThan(limit * spacing);
    }
  });

  it("has no seams at region edges: the composed ground and the cover blend are continuous", () => {
    // The band, widened by how far the warp can carry a border off the bisector.
    const reach = TERRAIN.blend / 2 + TERRAIN.warp + 10;
    for (const w of [sampleWorld(), ...draws.slice(0, 6)]) {
      const h = composer(w, landformsOf(w, lib));
      const c0 = new Float64Array(w.regions.length);
      const c1 = new Float64Array(w.regions.length);
      // Walk the line between every pair of region centers in 1 mm steps across the whole blend band.
      for (const a of w.regions) {
        for (const b of w.regions) {
          if (a === b) continue;
          const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          const dx = (b.x - a.x) / len;
          const dz = (b.z - a.z) / len;
          for (let s = -reach; s <= reach; s += 0.5) {
            const x = mid.x + dx * s;
            const z = mid.z + dz * s;
            const jump = Math.abs(h(x + dx * 0.001, z + dz * 0.001) - h(x, z));
            expect(jump, `${a.id}|${b.id} at ${s}`).toBeLessThan(0.002);
            coverWeights(w, x, z, c0);
            coverWeights(w, x + dx * 0.001, z + dz * 0.001, c1);
            let total = 0;
            c0.forEach((v, i) => {
              total += v;
              expect(Math.abs(v - (c1[i] as number)), `cover ${i} at ${s}`).toBeLessThan(0.002);
            });
            expect(total).toBeCloseTo(1, 9);
          }
        }
      }
    }
  });

  it("shows each region's own cover at its middle", () => {
    for (const t of baked.slice(0, 7)) {
      const w = t.spec;
      const weights = new Float64Array(w.regions.length);
      w.regions.forEach((r, i) => {
        coverWeights(w, r.x, r.z, weights);
        expect(weights[i], `${r.id} at its middle`).toBeGreaterThan(0.8);
      });
    }
  });

  it("fills every pond its lands hold, even where another area's river runs close by", () => {
    const land = (relief: FilledSlot) =>
      blueprintOf("biome", {
        relief,
        cover: { use: "ground-cover@1", params: { cover: "lush grass", length: "natural", wildflowers: "none" } },
        natives: { use: "native-families@1", params: { families: [] } },
      });
    // A narrow valley's trickle runs down past a basin's pond. Its valley, cut deeper than the basin, would drain the pond through its rim.
    const pond = { x: -10, z: 40 };
    const passed = bakeTerrain(
      {
        size: 320,
        regions: [
          { id: "valley", x: 0, z: -100, base: 0, biome: land({ use: "valley@1", params: { depth: "moderate", width: "narrow", run: "north-south", fall: "gentle", meander: "winding", stream: "trickle" } }) },
          { id: "basin", ...pond, base: 0, biome: land({ use: "basin@1", params: { depth: "a bowl", size: "medium", rim: "a soft rim", pond: true } }) },
          { id: "meadow", x: -60, z: 60, base: 1, biome: land({ use: "meadow@1", params: { undulation: "softly undulating", tilt: "slightly tilted", facing: "east" } }) },
        ],
      },
      lib,
    );
    expect(Math.min(...passed.streams.flatMap((s) => s.stations.map((st) => Math.hypot(st.x - pond.x, st.z - pond.z))))).toBeLessThan(60);
    for (const t of [...baked, passed]) {
      const landforms = landformsOf(t.spec, lib);
      const held = t.spec.regions.flatMap((r, i) => landforms[i]!.water.flatMap((b) => (b.kind === "pond" ? [[r.x + b.x, r.z + b.z]] : [])));
      expect(t.ponds.map((p) => [p.x, p.z])).toEqual(held);
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
          // Where it narrows at its spring or seep below what the lattice draws without gaps, its bed need not dip below the water.
          if (a.halfWidth < 1.1) continue;
          expect(heightAt(t.lattice, a.x, a.z)).toBeLessThan(a.level);
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          const nx = -(b.z - a.z) / len;
          const nz = (b.x - a.x) / len;
          const edge = surfaceHalfWidth(a);
          for (const side of [-1, 1]) {
            const x = a.x + nx * edge * side;
            const z = a.z + nz * edge * side;
            // Where another stream runs in, its mouth is the bank, and its water meets this one's at the surface.
            const mouth = t.streams.find((o) => o !== s && o.stations.some((q) => Math.hypot(q.x - x, q.z - z) < q.halfWidth));
            if (mouth !== undefined) {
              expect(Math.max(...mouth.stations.filter((q) => Math.hypot(q.x - x, q.z - z) < q.halfWidth).map((q) => q.level)), `mouth at station ${i}`).toBeGreaterThanOrEqual(a.level - 0.05);
              continue;
            }
            // The bank climbs straight from the waterline, so on the inside of the tightest bend, where the surface's
            // edge comes within 9 cm of the channel's, the ground is still 3 cm above the water.
            expect(heightAt(t.lattice, x, z), `bank at station ${i}`).toBeGreaterThanOrEqual(a.level + 0.02);
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

  describe("grounds plants, each copy leaned on its ground's slope", () => {
    const floraLib = new Library(FLORA_PRIMITIVES);
    // Every tree's and every bush's frame, each with every crown.
    const plants = [tree, bush].flatMap((k) => sweep(k, new Library(k === tree ? TREE_PRIMITIVES : BUSH_PRIMITIVES), { pairs: [["form", "crown"]] }).blueprints.map((blueprint) => ({ k, blueprint })));
    type Point = readonly [number, number, number];
    /** Spots for a plant in world `t`: dry, gentle ground across the land, every 23 m. */
    const spotsOf = (t: Terrain): { x: number; z: number }[] => {
      const spots: { x: number; z: number }[] = [];
      const half = t.spec.size / 2 - 20;
      for (let z = -half; z <= half && spots.length < 16; z += 23) {
        for (let x = -half; x <= half && spots.length < 16; x += 23) if (slopeAt(t.lattice, x, z) <= PLANT_SLOPE / 2 && !isWet(t, x, z)) spots.push({ x, z });
      }
      return spots;
    };
    /**
     * A plant's point placed at `s` on origin height `y`, turned by `turn` (Three's Y rotation, x' = x cos + z sin,
     * z' = -x sin + z cos) and tilted on the ground's slope there as its instance is, with its base following the ground
     * and its stems upright. Also returns the ground's height under the point.
     */
    const stood = (t: Terrain, s: { x: number; z: number }, y: number, turn: number, [vx, vy, vz]: Point): { at: number; ground: number } => {
      const dx = vx * Math.cos(turn) + vz * Math.sin(turn);
      const dz = -vx * Math.sin(turn) + vz * Math.cos(turn);
      const [gx, gz] = groundSlope(t.lattice, s.x, s.z);
      return { at: y + vy + gx * dx + gz * dz, ground: heightAt(t.lattice, s.x + dx, s.z + dz) };
    };
    const barkOf = (k: typeof tree | typeof bush, blueprint: Blueprint): { points: Point[]; skel: Skeleton } => {
      const built = realize(blueprint, k, floraLib, { seed: seedOf("p"), facts: { scale: 1, age: 1 } });
      const bark = built.parts.find((p) => p.swatch === "bark")!;
      const points: Point[] = [];
      for (let k = 0; k < bark.positions.length; k += 3) points.push([bark.positions[k]!, bark.positions[k + 1]!, bark.positions[k + 2]!]);
      return { points, skel: built.slots.get("form")?.output as Skeleton };
    };
    /**
     * Every bark vertex at ground level near where a trunk, stem or cane leaves the soil, however many sides or lobes
     * it has. A trunk's root flare reaches out to three of its radii.
     */
    const rootRing = (points: readonly Point[], skel: Skeleton): Point[] =>
      points.filter((v) => v[1] < 0.05 && skel.limbs.some((l) => l.parent === -1 && Math.hypot(v[0] - l.start[0], v[2] - l.start[2]) < 3.5 * l.startRadius));

    it("stands every trunk's and every stem's bottom ring at or under the ground", () => {
      const bases = plants.map(({ k, blueprint }) => {
        const { points, skel } = barkOf(k, blueprint);
        return rootRing(points, skel);
      });
      for (const ring of bases) expect(ring.length, "the origin is the trunk base").toBeGreaterThanOrEqual(3);
      baked.slice(0, 8).forEach((t, w) => {
        const spots = spotsOf(t);
        expect(spots.length).toBe(16);
        spots.forEach((s, i) => {
          const ring = bases[(w * spots.length + i) % bases.length]!;
          const y = groundedBase(t.lattice, s.x, s.z, Math.max(...ring.map((v) => Math.hypot(v[0], v[2]))));
          for (const v of ring) {
            const { at, ground } = stood(t, s, y, i * 1.7, v);
            expect(at, "no gap under the trunk").toBeLessThanOrEqual(ground);
            expect(ground - at, "not sunk deep").toBeLessThan(0.8);
          }
        });
      });
    });
  });
});

describe("wild land past the rim", () => {
  it("goes on without end from the land's edge, with no step, and the ring drawn from above is the same ground", () => {
    for (const t of baked) {
      const h = landHalf(t);
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const [cx, cz] = [Math.cos(a), Math.sin(a)];
        // Across the land's edge the ground never jumps, with no step between neighbors a quarter meter apart.
        const cross = h / Math.max(Math.abs(cx), Math.abs(cz));
        for (let r = cross - 20; r < cross + 20; r += 0.25) {
          const step = Math.abs(groundHeightAt(t, cx * (r + 0.25), cz * (r + 0.25)) - groundHeightAt(t, cx * r, cz * r));
          expect(step).toBeLessThan(0.12);
        }
        expect(wildPast(t, cx * cross, cz * cross)).toBeCloseTo(0, 6);
      }
      // The walkable square lies well inside `landHalf`, so its ground is the lattice.
      expect(groundHeightAt(t, t.spec.size / 2, -t.spec.size / 2)).toBe(heightAt(t.lattice, t.spec.size / 2, -t.spec.size / 2));
      // The coarse ring drawn from above is the same ground.
      const { positions } = wildsRing(t);
      for (let v = 0; v < positions.length; v += 3 * 37) {
        expect(positions[v + 1]!).toBeCloseTo(groundHeightAt(t, positions[v]!, positions[v + 2]!), 5);
      }
    }
  });

  it("grows its own covers and thickets only out past the land, each cell's thicket always the same", () => {
    for (const t of baked.slice(0, 4)) {
      const h = landHalf(t);
      // Past the settle band, the ground is the wild roll, which the field map draws.
      expect(groundHeightAt(t, h + WILDS.settle + 40, 17)).toBeCloseTo(wildRollAt(t, h + WILDS.settle + 40, 17), 9);
      expect(wildShare(t, 0, 0)).toBe(0);
      expect(wildShare(t, h + 200, -h - 200)).toBe(1);
      let bushes = 0;
      for (let cj = -60; cj < 60; cj++) {
        for (let ci = -60; ci < 60; ci++) {
          const thicket = wildThicket(t, ci, cj);
          if ((ci * 7 + cj) % 23 === 0) expect(wildThicket(t, ci, cj)).toEqual(thicket);
          for (const b of thicket?.bushes ?? []) {
            bushes++;
            expect(wildPast(t, b.x, b.z)).toBeGreaterThan(0);
          }
        }
      }
      expect(bushes).toBeGreaterThan(0);
    }
  });
});

describe("flow", () => {
  it("runs every solved stream downstream, toward its lower end", () => {
    let stations = 0;
    for (const t of baked) {
      for (const s of t.streams) {
        const flow = streamFlow(s);
        const st = s.stations;
        for (let i = 0; i + 1 < st.length; i++) {
          const a = st[i] as Station;
          const b = st[i + 1] as Station;
          const vx = flow[i * 2] as number;
          const vz = flow[i * 2 + 1] as number;
          // The next station is downstream, so the waterline never rises toward it and the flow heads its way.
          expect(b.level).toBeLessThanOrEqual(a.level);
          expect(vx * (b.x - a.x) + vz * (b.z - a.z)).toBeGreaterThan(0);
          stations++;
        }
      }
    }
    expect(stations).toBeGreaterThan(200);
  });
});

describe("a cottage on the land", () => {
  const structureLib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
  const t = baked[0] as Terrain;

  /**
   * Sites a building and its feature on `terrain` apart from the `taken` sites, as the world does, levels its pad, and
   * checks that it stands on dry, level ground inside the world and rests on that ground. Returns its site.
   */
  const expectGrounded = (name: string, built: Realized, terrain: Terrain, taken: readonly BuildingSite[]): BuildingSite => {
    const plan = built.slots.get("footprint")?.output as BuildingPlan;
    const beside = extentOf(built.slots.get("feature")?.output as Built | undefined);
    const site = findSite(terrain, plan, taken, 30, beside);
    levelPad(terrain, plan, site, beside);
    const ground = (lx: number, lz: number): number => heightAt(terrain.lattice, ...siteToWorld(site, lx, lz));
    for (const other of taken) expect(Math.hypot(site.x - other.x, site.z - other.z), `${name} apart`).toBeGreaterThanOrEqual(30);
    expect(Math.max(Math.abs(site.x), Math.abs(site.z)), `${name} inside the world`).toBeLessThan(terrain.spec.size / 2);
    // The pad is level and dry under the whole house and its walk, which starts at the door, out past any porch.
    const front = Math.max(plan.depth / 2, ...plan.openings.filter((o) => o.kind === "door").map((o) => o.position[2]));
    for (let lx = -plan.width / 2 - 1; lx <= plan.width / 2 + 1; lx += 0.5) {
      for (let lz = -plan.depth / 2 - 1; lz <= front + 5.5; lz += 0.5) {
        expect(Math.abs(ground(lx, lz) - site.level), name).toBeLessThan(0.02);
        if (Math.abs(lx) <= plan.width / 2 && lz >= -plan.depth / 2) expect(waterDepthAt(terrain, ...siteToWorld(site, lx, lz)), `${name} dry`).toBe(0);
      }
    }
    // The ground under a feature, such as a mill wheel's pit or a tower, is the building's level ground.
    if (beside !== null) {
      for (const [lx, lz] of [[beside.x0, beside.z0], [beside.x1, beside.z0], [beside.x0, beside.z1], [beside.x1, beside.z1]] as const) expect(Math.abs(ground(lx, lz) - site.level), `${name} feature`).toBeLessThan(0.02);
    }
    for (const part of built.parts) {
      let lowest = Infinity;
      for (let i = 0; i < part.positions.length; i += 3) {
        const above = site.level + (part.positions[i + 1] as number) - ground(part.positions[i] as number, part.positions[i + 2] as number);
        lowest = Math.min(lowest, above);
      }
      // Each part either reaches into the ground or rests on the stone base at floor level, so nothing hangs between.
      expect(lowest <= 0 || lowest >= plan.floor - 0.12, `${name} ${part.swatch} lowest ${lowest.toFixed(3)}`).toBe(true);
    }
    // The garden walk's stones show above the ground and lie on it.
    for (const part of ((built.slots.get("ornaments")?.output as Built | undefined)?.parts ?? []).filter((p) => p.collision === "walkable")) {
      for (let i = 0; i < part.positions.length; i += 3) {
        if ((part.positions[i + 1] as number) <= 0) continue;
        expect(site.level + (part.positions[i + 1] as number) - ground(part.positions[i] as number, part.positions[i + 2] as number), `${name} ${part.swatch} stone`).toBeLessThan(0.08);
      }
    }
    // The walls' foundation reaches well below the ground, so a slope never shows a gap.
    const solid = built.parts.filter((p) => p.collision === "solid");
    const footing = Math.min(...solid.flatMap((p) => Array.from(p.positions.filter((_, i) => i % 3 === 1))));
    expect(footing, name).toBeLessThan(-1);
    return site;
  };

  // Sites 60 buildings drawn from everything Jev can compose, in villages of three on their own copy of the land. It
  // takes about 2.5 s alone, longer when the suite runs in parallel.
  it("stands any building Jev can compose on dry, level ground inside the world, apart from its neighbors, never floating", { timeout: 120_000 }, () => {
    const draws = rand(seedOf("grounded draws"));
    for (let v = 0; v < 20; v++) {
      const terrain: Terrain = { ...t, lattice: { ...t.lattice, heights: t.lattice.heights.slice() } };
      const taken: BuildingSite[] = [];
      for (let i = v * 3; i < v * 3 + 3; i++) {
        const blueprint = blueprintOf(structure.id, randomSlots(structure, structureLib, () => draws.next()));
        taken.push(expectGrounded(JSON.stringify(blueprint.slots), realize(blueprint, structure, structureLib, { seed: seedOf(`grounded ${i}`), facts: { size: 1, floors: 1 } }), terrain, taken));
      }
    }
  });
});
