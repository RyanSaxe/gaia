import { beforeAll, describe, expect, it } from "vitest";
import { type BuildingPlan, type Built, Library, type RouteSpec, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, LANDMARK_PRIMITIVES, RELIEF_PRIMITIVES, ROUTE_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { landmark, link, structure } from "@gaia/kinds";
import { FLORA_PRESETS, LANDMARK_PRESETS, STRUCTURE_PRESETS, TRAIL_PRESETS, buildSlots, realize } from "@gaia/realize";
import { type ScatterRule, TERRAIN, type Terrain, bakeTerrain, groundLook, junctionVitality, ownershipOf, placeAt, vitalityAt, vitalityOver, wayVitalityAt } from "@gaia/terrain";
import { type Judgments, areaVitality, entityVitalityOf, groundVitality } from "@gaia/world";
import { codeLab, provingWorld } from "./code-world.ts";
import { BUILDINGS, CHARACTERS, FORMS, LANDMARKS, LANDS, TRAILS, VIBES, WATERS } from "./looks.ts";
import { type Stand, extentOf, groundSites, landmarkBase, ownerVitality, standWorld, understoryVitality } from "./stand.ts";
import judgedFixture from "./fixtures/proving-judged.json";

const judged = judgedFixture as unknown as Judgments;
const doc = provingWorld();
const code = codeLab(doc);
const vitalityOf = new Map(doc.model.entities.map((e) => [e.path, entityVitalityOf(e).vitality]));
/** Each area's vitality, every file under it pooled by size. */
const pooled = areaVitality(doc.world.patches.map((p) => ({ area: p.area, vitality: p.vitality, size: p.radius * p.radius })));
/** What a point's own ground is (its file's patch, its area's lot, or the wild), and that ground's vitality. */
const ownerOf = (x: number, z: number): string => {
  const here = placeAt(doc.world, x, z);
  return here.area.depth < 0 ? "wild" : (here.file?.path ?? `lot:${here.area.path}`);
};
const groundAt = (x: number, z: number): number => {
  const here = placeAt(doc.world, x, z);
  return here.file?.vitality ?? (here.area.depth < 0 ? 1 : (pooled.get(here.area.path) ?? 1));
};
/** Points up to 30 m around a point: where the land's warp gathers the ground, a neighbor's cell lies nearer than it looks, so a point is clear of every edge only this far in. */
const AROUND = [10, 20, 30].flatMap((r) => Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4) * r, Math.sin((k * Math.PI) / 4) * r] as const));
const clearOfEdges = (x: number, z: number): boolean => {
  const owner = ownerOf(x, z);
  return AROUND.every(([dx, dz]) => ownerOf(x + dx, z + dz) === owner);
};
/** The ground's vitality field as the page builds it: whose ground each sample is, weighed by each owner's vitality. */
const own = ownershipOf(groundSites(code.stand), doc.world.size, doc.world.size + TERRAIN.skirt * 2);
const tables = ownerVitality(doc.world, (path) => doc.world.patches.find((p) => p.path === path)?.vitality ?? 1);
const groundField = vitalityOver(own, tables.ground);
const waterField = vitalityOver(own, tables.area);

describe("the proving ground", () => {
  it("chooses every option the judge can choose, and stands every building and landmark thriving, tired and in ruin", () => {
    const used = (options: object, chosen: Iterable<string>): string[] => Object.keys(options).filter((k) => ![...chosen].includes(k));
    expect(used(LANDS, Object.values(judged.lands))).toEqual([]);
    expect(used(WATERS, Object.values(judged.waters))).toEqual([]);
    expect(used(CHARACTERS, Object.values(judged.characters))).toEqual([]);
    expect(used(VIBES, Object.values(judged.vibes))).toEqual([]);
    expect(used(FORMS, Object.values(judged.forms).flatMap((f) => Object.values(f)))).toEqual([]);
    expect(used(TRAILS, judged.trails.map((t) => t.look))).toEqual([]);
    for (const [as, looks] of [["building", BUILDINGS], ["landmark", LANDMARKS]] as const) {
      for (const look of Object.keys(looks)) {
        const healths = doc.world.things.filter((t) => t.as === as && t.look === look).map((t) => vitalityOf.get(t.path) ?? 1);
        expect(healths.some((v) => v >= 0.85), `a thriving ${look}`).toBe(true);
        expect(healths.some((v) => v >= 0.35 && v < 0.85), `a tired ${look}`).toBe(true);
        expect(healths.some((v) => v < 0.12), `a ${look} in ruin`).toBe(true);
      }
    }
  });

  it("lays out every planned land, a whole area in ruin beside thriving ones, a tiny area and deep nesting", () => {
    expect(doc.world.regions.map((r) => r.area).sort()).toEqual(Object.keys(judged.lands).sort());
    const ground = groundVitality(doc.world.patches.map((p) => ({ area: p.area, vitality: p.vitality, size: p.radius * p.radius })));
    expect(ground.get("ruins")).toBeLessThan(0.1);
    expect(ground.get("crossings")).toBeGreaterThan(0.95);
    expect(doc.world.patches.some((p) => p.vitality < 0.05)).toBe(true);
    expect(Math.min(...doc.world.areas.filter((a) => a.depth > 0).map((a) => a.ground))).toBeLessThan(1000);
    expect(Math.max(...doc.world.areas.map((a) => a.depth))).toBeGreaterThanOrEqual(6);
  });

  it("dries the ground of its failing area and failing grove, keeps its thriving ground green, and clouds the failing area's water", () => {
    const looks = new Map<string, { blades: number; dry: number; bare: number; water: number; count: number }>();
    let inside = 0;
    const half = doc.world.size / 2 - 20;
    for (let x = -half; x <= half; x += 8) {
      for (let z = -half; z <= half; z += 8) {
        const here = placeAt(doc.world, x, z);
        if (here.area.depth < 0) continue;
        const v = vitalityAt(own, groundField, x, z);
        // Away from its edges, the ground has exactly its file's vitality, or on a lot its area's.
        if (clearOfEdges(x, z)) {
          inside++;
          expect(Math.abs(v - groundAt(x, z)), `${ownerOf(x, z)} at ${x}, ${z}`).toBeLessThan(0.01);
        }
        const look = groundLook(v);
        for (const key of [here.area.path.split("/")[0] ?? "", here.file?.path ?? ""]) {
          const sum = looks.get(key) ?? { blades: 0, dry: 0, bare: 0, water: 0, count: 0 };
          looks.set(key, { blades: sum.blades + look.blades, dry: sum.dry + look.dry, bare: sum.bare + look.bare, water: sum.water + vitalityAt(own, waterField, x, z), count: sum.count + 1 });
        }
      }
    }
    expect(inside).toBeGreaterThan(500);
    const mean = (key: string) => {
      const sum = looks.get(key)!;
      return { blades: sum.blades / sum.count, dry: sum.dry / sum.count, bare: sum.bare / sum.count, water: sum.water / sum.count };
    };
    // The failing area reads as ruin all through: its grass thins, its ground dries and bare earth opens; its water clouds.
    const ruins = mean("ruins");
    expect(ruins.blades).toBeLessThan(0.65);
    expect(ruins.dry).toBeGreaterThan(0.7);
    expect(ruins.bare).toBeGreaterThan(0.3);
    expect(ruins.water).toBeLessThan(0.1);
    for (const thriving of [mean("moor"), mean("crossings")]) {
      expect(thriving.blades).toBeGreaterThan(0.97);
      expect(thriving.dry).toBeLessThan(0.05);
      expect(thriving.bare).toBeLessThan(0.001);
      expect(thriving.water).toBeGreaterThan(0.9);
    }
    // A failing grove in a living area is one sick patch: its ground dries, while its neighbor's stays green.
    expect(mean("mixed/failing-grove.ts").dry).toBeGreaterThan(0.6);
    expect(mean("mixed/steady.ts").dry).toBeLessThan(0.1);
  });

  describe("stood as the terrain lab stands it", () => {
    let terrain: Terrain;
    let stood: Stand;
    // Baking and standing the 950 m world takes about 10 s in one Node thread, longer while other work shares the machine.
    beforeAll(() => {
      // The same buildings, landmarks and trail looks, seeded alike, and an understory of rocks, shrubs and flowers.
      terrain = bakeTerrain(code.spec, new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]));
      const buildingLib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
      const landmarkLib = new Library([...LANDMARK_PRIMITIVES, ...FLORA_PRIMITIVES]);
      const routeLib = new Library(ROUTE_PRIMITIVES);
      const styles = TRAIL_PRESETS.map((p) => buildSlots(p.blueprint, link, routeLib, { seed: 1, facts: {} }).get("route")?.output as RouteSpec);
      const understory = (id: string, groups: number): ScatterRule => ({ id, variants: [{ radius: 0.8, weight: 1 }], groups, members: [1, 4], spread: 5, mix: "member", scale: [0.8, 1.2], maxSlope: 22, waterClearance: 1.5, ground: "lowest", sink: 0.05 });
      stood = standWorld(terrain, {
        buildings: code.buildings.map((b) => {
          const preset = STRUCTURE_PRESETS.find((p) => p.name === b.building);
          if (preset === undefined) throw new Error(`No building ${b.building}.`);
          const facts = Object.fromEntries(Object.entries(structure.facts).map(([k, bind]) => [k, bind(b.facts)]));
          const built = realize(preset.blueprint, structure, buildingLib, { seed: seedOf(`terrain-lab/${b.facts.path}`), facts });
          return { name: b.facts.name, plan: built.slots.get("footprint")?.output as BuildingPlan, beside: extentOf(built.slots.get("feature")?.output as Built | undefined) };
        }),
        landmarks: LANDMARK_PRESETS.map((p, i) => ({ name: p.name, base: landmarkBase(realize(p.blueprint, landmark, landmarkLib, { seed: seedOf(`terrain-lab/landmark-${i}`), facts: { scale: 1 } })) })),
        trailStyles: [styles[0] as RouteSpec, styles[1] as RouteSpec, styles[2] as RouteSpec],
        trees: { count: 0, seed: 9, presets: FLORA_PRESETS.length, builds: 1, bases: FLORA_PRESETS.map(() => 0.5), crowns: FLORA_PRESETS.map(() => 4) },
        understory: { rules: [understory("rocks", 3), understory("shrubs", 5), understory("flowers", 6)], seed: 5 },
        code: code.stand,
      });
    }, 120_000);

    it("crosses its streams on footbridges and stepping stones, and has cairns where ways meet, thriving and in ruin", () => {
      const net = stood.network;
      const place = (id: string): number => vitalityOf.get(id) ?? 1;
      const crossings = net.ways.flatMap((w, i) => w.crossings.map(() => ({ kind: w.style.crossing, vitality: wayVitalityAt(net, i, 0.5, place) })));
      for (const kind of ["footbridge", "stepping-stones"] as const) expect(crossings.some((c) => c.kind === kind), kind).toBe(true);
      expect(crossings.some((c) => c.vitality > 0.85)).toBe(true);
      expect(crossings.some((c) => c.vitality < 0.12)).toBe(true);
      const cairns = net.junctions.filter((j) => j.cairn !== null).map((j) => junctionVitality(net, j, place));
      expect(cairns.some((v) => v > 0.85)).toBe(true);
      expect(cairns.some((v) => v < 0.12)).toBe(true);
      expect(net.dropped).toEqual([]);
      expect(terrain.ponds.length).toBeGreaterThanOrEqual(2);
    });

    it("grows the understory with the vitality of the ground it stands on, so the ruins' bushes and flowers fail", () => {
      // The page shows each scattered placement's vitality from the ground's vitality field, as the grass beneath it reads it, and each file's finer entity its file's.
      const shown = understoryVitality(stood, (k) => code.stand.symbols[k]!.vitality, (x, z) => vitalityAt(own, groundField, x, z));
      stood.symbols.forEach((i, k) => {
        if (i >= 0) expect(shown[i]).toBeCloseTo(code.stand.symbols[k]!.vitality, 5);
      });
      const symbols = new Set(stood.symbols);
      const scattered = stood.placements.flatMap((p, i) => (symbols.has(i) ? [] : [{ x: p.x, z: p.z, vitality: shown[i]! }]));
      expect(scattered.length).toBeGreaterThan(1000);
      // A file's patch is as healthy as its file, a lot as its whole area, and the wild past the land thrives; away from its edges, a placement shows exactly that.
      const clear = scattered.filter((p) => clearOfEdges(p.x, p.z));
      expect(clear.length).toBeGreaterThan(300);
      for (const p of clear) expect(Math.abs(p.vitality - groundAt(p.x, p.z)), `${ownerOf(p.x, p.z)} at ${p.x}, ${p.z}`).toBeLessThan(0.01);
      expect(clear.some((p) => placeAt(doc.world, p.x, p.z).file === null), "understory on a lot").toBe(true);
      const ruins = clear.filter((p) => /^ruins(\/|$)/.test(placeAt(doc.world, p.x, p.z).area.path));
      expect(ruins.length).toBeGreaterThan(20);
      for (const p of ruins) expect(p.vitality).toBeLessThan(0.25);
    });
  });
});
