import { beforeAll, describe, expect, it } from "vitest";
import { type AnyKind, type Blueprint, type BuildingPlan, type Built, Library, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, LANDMARK_PRIMITIVES, RELIEF_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { landmark, structure } from "@gaia/kinds";
import { realize } from "@gaia/realize";
import { type BuildingSite, type Extent, TERRAIN, type Terrain, bakeTerrain, extentOf, groundLook, heightAt, siteToWorld, turningExtent, junctionVitality, ownershipOf, placeAt, vitalityAt, vitalityOver, waterDepthAt, wayVitalityAt } from "@gaia/terrain";
import { type PlacedBlueprint, areaVitality, groundVitality, missingFrom, sweep } from "@gaia/world";
import { openedWorld, provingWorld } from "./code-world.ts";
import { COMPOSED_FORMS, COMPOSING, FORMS, WATERS } from "./looks.ts";
import { type Placed, type BuildingToPlace, groundSites, landmarkBase, needsBank, ownerVitality, placeWorld, understoryVitality } from "./place.ts";
import { judged } from "virtual:proving-ground";

const doc = provingWorld();
const code = openedWorld(doc);
const vitalityOf = new Map(doc.world.things.map((t) => [t.path, t.vitality]));
/** Each trail end's vitality as the world shows it, by the place the trail names: a building's or landmark's lot, or the path of an entity that appears as a plant, stone or flowers. */
const endVitality = new Map([...vitalityOf, ...doc.world.naturalThings.flatMap((s) => (s.of === "entity" ? [[s.path, s.vitality] as const] : []))]);
/** Each area's vitality, every file under it pooled by size. */
const pooled = areaVitality(doc.world.patches.map((p) => ({ area: p.area, vitality: p.vitality, size: p.radius * p.radius })));
/** The owner of a point's ground: its file's patch, its area's lot, or the wild. `groundAt` below gives that ground's vitality. */
const ownerOf = (x: number, z: number): string => {
  const here = placeAt(doc.world, x, z);
  return here.area.depth < 0 ? "wild" : (here.file?.path ?? `lot:${here.area.path}`);
};
const groundAt = (x: number, z: number): number => {
  const here = placeAt(doc.world, x, z);
  return here.file?.vitality ?? (here.area.depth < 0 ? 1 : (pooled.get(here.area.path) ?? 1));
};
/** Offsets up to 30 m around a point. Where the land's warp bunches the ground, a neighbor's cell can be nearer than it looks, so a point counts as clear of every edge only this far in. */
const AROUND = [10, 20, 30].flatMap((r) => Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4) * r, Math.sin((k * Math.PI) / 4) * r] as const));
const clearOfEdges = (x: number, z: number): boolean => {
  const owner = ownerOf(x, z);
  return AROUND.every(([dx, dz]) => ownerOf(x + dx, z + dz) === owner);
};
/** The ground's vitality field as the page builds it: each sample's owner, weighted by each owner's vitality. */
const own = ownershipOf(groundSites(code.layout), doc.world, doc.world.size + TERRAIN.skirt * 2);
const tables = ownerVitality(doc.world, (path) => doc.world.patches.find((p) => p.path === path)?.vitality ?? 1);
const groundField = vitalityOver(own, tables.ground);
const waterField = vitalityOver(own, tables.area);

describe("the proving ground", () => {
  it("stands every part of every land, building, landmark and trail Jev composes, thriving, tired and in ruin, and chooses every option Jev is offered", () => {
    const used = (options: object, chosen: Iterable<string>): string[] => Object.keys(options).filter((k) => ![...chosen].includes(k));
    // Labels by vitality: "thriving" from 0.85, "tired" from 0.35, and "ruin" below 0.12. A thing between 0.12 and 0.35 gets no label.
    const healths = ["thriving", "tired", "ruin"];
    const labeled = (blueprint: Blueprint | undefined, v: number): PlacedBlueprint[] => {
      if (blueprint === undefined) return [];
      const label = v >= 0.85 ? "thriving" : v >= 0.35 ? "tired" : v < 0.12 ? "ruin" : undefined;
      return [{ blueprint, ...(label === undefined ? {} : { label }) }];
    };
    const lacking = (k: AnyKind, of: readonly PlacedBlueprint[]): string[] => missingFrom(k, COMPOSING.lib, of, { labels: healths });
    // A land's vitality is its own ground's: every file on it, pooled by size.
    const regionOf = new Map(doc.world.areas.map((a) => [a.path, a.region]));
    const lands = doc.world.regions.map((r, i) => {
      const own = doc.world.patches.filter((p) => regionOf.get(p.area) === i);
      const size = own.reduce((n, p) => n + p.radius * p.radius, 0);
      return labeled(r.biome, own.reduce((n, p) => n + p.vitality * p.radius * p.radius, 0) / size);
    });
    expect(lacking(COMPOSING.biome, lands.flat())).toEqual([]);
    for (const [as, k] of [["building", COMPOSING.building], ["landmark", COMPOSING.landmark]] as const) {
      expect(lacking(k, doc.world.things.filter((t) => t.as === as).flatMap((t) => labeled(t.blueprint, t.vitality))), as).toEqual([]);
    }
    expect(lacking(COMPOSING.link, doc.world.trails.flatMap((t) => labeled(t.route, ((endVitality.get(t.from) ?? 1) + (endVitality.get(t.to) ?? 1)) / 2)))).toEqual([]);
    // Every tree's and bush's frame with every crown, every stone and every drift, each under all three labels.
    const small = [...doc.world.symbols, ...doc.world.naturalThings];
    for (const [as, k, pairs] of [["tree", COMPOSING.tree, [["form", "crown"]]], ["bush", COMPOSING.bush, [["form", "crown"]]], ["stone", COMPOSING.stone, []], ["flowers", COMPOSING.flowers, []]] as const) {
      const of = small.filter((s) => s.as === as).flatMap((s) => labeled(s.blueprint, s.vitality));
      expect(missingFrom(k, COMPOSING.offered?.[as] ?? COMPOSING.lib, of, { labels: healths, pairs }), as).toEqual([]);
    }
    // Its sky is the first of the sweep's skies.
    expect(judged.sky?.id).toBe(sweep(COMPOSING.world, COMPOSING.lib).blueprints[0]?.id);
    expect(used(WATERS, Object.values(judged.waters))).toEqual([]);
    expect(used(FORMS, Object.entries(judged.forms ?? {}).flatMap(([id, form]) => (id.includes("#") ? [form] : [])))).toEqual([]);
    // Any code can appear as any form: an entity, a file and a definition each appear as a building and as a landmark,
    // and every file appears as one thing of its own.
    for (const of of ["entity", "file", "definition"] as const) {
      for (const as of ["building", "landmark"] as const) expect(doc.world.things.some((t) => (t.of ?? "entity") === of && t.as === as), `a ${of} as a ${as}`).toBe(true);
    }
    expect(doc.world.naturalThings.filter((s) => s.of === "file").length + doc.world.things.filter((t) => t.of === "file").length).toBe(doc.world.patches.length);
    expect(used(FORMS, doc.world.naturalThings.map((s) => s.form))).toEqual([]);
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
    for (let x = -half; x <= half; x += 4) {
      for (let z = -half; z <= half; z += 4) {
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
    expect(inside).toBeGreaterThan(100);
    const mean = (key: string) => {
      const sum = looks.get(key)!;
      return { blades: sum.blades / sum.count, dry: sum.dry / sum.count, bare: sum.bare / sum.count, water: sum.water / sum.count };
    };
    // The "ruins" area has low vitality throughout: its grass thins, its ground dries, bare earth opens and its water clouds.
    const ruins = mean("ruins");
    expect(ruins.blades).toBeLessThan(0.65);
    expect(ruins.dry).toBeGreaterThan(0.7);
    expect(ruins.bare).toBeGreaterThan(0.3);
    expect(ruins.water).toBeLessThan(0.1);
    for (const area of ["moor", "crossings"]) {
      const thriving = mean(area);
      expect(thriving.blades, area).toBeGreaterThan(0.97);
      expect(thriving.dry, area).toBeLessThan(0.05);
      // Bare earth shows only where a declining neighbor's ground eases across the border, as the attic's does into the
      // moor.
      expect(thriving.bare, area).toBeLessThan(0.005);
      expect(thriving.water, area).toBeGreaterThan(0.9);
    }
    // A low-vitality grove in a healthy area is one dry patch, while its neighbor's ground stays green.
    expect(mean("mixed/failing-grove.ts").dry).toBeGreaterThan(0.6);
    expect(mean("mixed/steady.ts").dry).toBeLessThan(0.1);
  });

  describe("stood as the page stands it", () => {
    let terrain: Terrain;
    let placed: Placed;
    let requests: BuildingToPlace[];
    // Baking and placing the 560 m world takes about 10 s in one Node thread, longer while other work shares the machine.
    beforeAll(() => {
      // The same buildings, landmarks and trail styles, with the same seeds.
      terrain = bakeTerrain(code.spec, new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]));
      const buildingLib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
      const landmarkLib = new Library([...LANDMARK_PRIMITIVES, ...FLORA_PRIMITIVES]);
      requests = code.buildings.map((b) => {
          const facts = Object.fromEntries(Object.entries(structure.facts).map(([k, bind]) => [k, bind(b.facts)]));
          const built = realize(b.blueprint, structure, buildingLib, { seed: seedOf(`terrain-lab/${b.facts.path}`), facts });
          const feature = built.slots.get("feature")?.output as Built | undefined;
          return { name: b.facts.name, plan: built.slots.get("footprint")?.output as BuildingPlan, beside: extentOf(feature), ...(needsBank(b.blueprint, buildingLib) ? { wheel: turningExtent(feature) } : {}) };
        });
      placed = placeWorld(terrain, {
        buildings: requests,
        landmarks: code.landmarks.map((l) => ({
          tree: l.blueprint.slots.form?.use === "great-tree@1",
          base: landmarkBase(realize(l.blueprint, landmark, landmarkLib, { seed: seedOf(`terrain-lab/landmark/${l.path}`), facts: Object.fromEntries(Object.entries(landmark.facts).map(([k, bind]) => [k, bind(l.facts)])) })),
        })),
        trees: { bases: code.naturalBuilds.trees.map(() => 0.5), crowns: code.naturalBuilds.trees.map(() => 4) },
        code: code.layout,
      });
    }, 120_000);

    it("stands each building whose wheel needs running water on its stream's bank, its wheel in the water and its floor dry", () => {
      expect(placed.dry).toEqual([]);
      const banked = requests.flatMap((b, i) => (b.wheel !== undefined ? [{ b, site: placed.sites[i] as BuildingSite }] : []));
      expect(banked.length).toBeGreaterThan(2);
      for (const { b, site } of banked) {
        expect("wall" in site, b.name).toBe(true);
        // Its wheel turns in the stream.
        const w = b.wheel as Extent;
        expect(waterDepthAt(terrain, ...siteToWorld(site, (w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2)), b.name).toBeGreaterThan(0);
        expect(waterDepthAt(terrain, site.x, site.z), b.name).toBe(0);
        // Its floor stays dry: no water reaches the floor's height anywhere under the house.
        for (let lz = -b.plan.depth / 2; lz <= b.plan.depth / 2; lz += 0.5) {
          for (let lx = -b.plan.width / 2; lx <= b.plan.width / 2; lx += 0.5) {
            const surface = heightAt(terrain.lattice, ...siteToWorld(site, lx, lz), terrain.waterLevel);
            expect(surface, `${b.name} at ${lx}, ${lz}`).toBeLessThan(site.level + b.plan.floor - 0.1);
          }
        }
      }
    });

    it("crosses its streams on footbridges and stepping stones, and has cairns where ways meet, thriving and in ruin", () => {
      const net = placed.network;
      const place = (id: string): number => endVitality.get(id) ?? 1;
      const crossings = net.ways.flatMap((w, i) => w.crossings.map(() => ({ kind: w.style.crossing, vitality: wayVitalityAt(net, i, 0.5, place) })));
      for (const kind of ["footbridge", "stepping-stones"] as const) expect(crossings.some((c) => c.kind === kind), kind).toBe(true);
      // Each spans water, from dry ground to dry ground.
      for (const c of net.ways.flatMap((w) => w.crossings)) {
        const at = (s: number): readonly [number, number] => [c.x + Math.cos(-c.yaw) * s, c.z + Math.sin(-c.yaw) * s];
        for (const end of [-c.span / 2, c.span / 2]) expect(waterDepthAt(terrain, ...at(end)), `${c.x}, ${c.z} ends dry`).toBeLessThan(0.01);
        expect(Math.max(...Array.from({ length: 21 }, (_, i) => waterDepthAt(terrain, ...at(-c.span / 2 + (c.span * i) / 20)))), `${c.x}, ${c.z} spans water`).toBeGreaterThan(0.1);
      }
      expect(crossings.some((c) => c.vitality > 0.85)).toBe(true);
      expect(crossings.some((c) => c.vitality < 0.12)).toBe(true);
      const cairns = net.junctions.filter((j) => j.cairn !== null).map((j) => junctionVitality(net, j, place));
      expect(cairns.some((v) => v > 0.85)).toBe(true);
      expect(cairns.some((v) => v < 0.12)).toBe(true);
      expect(net.dropped).toEqual([]);
      expect(terrain.ponds.length).toBeGreaterThanOrEqual(2);
    });

    it("stands every definition, file and entity the layout lays out, as a tree, a stone, a bush, flowers or one of the world's things, each on its own file's patch, however crowded its ground, and nothing else", () => {
      expect(placed.symbols.length).toBe(doc.world.symbols.length + doc.world.naturalThings.length);
      const trees = new Map(placed.trees.map((t) => [t.symbol, t]));
      expect(trees.size).toBeGreaterThan(0);
      placed.symbols.forEach((i, k) => {
        const s = doc.world.symbols[k] ?? doc.world.naturalThings[k - doc.world.symbols.length]!;
        const id = "id" in s ? s.id : s.path;
        const raised = COMPOSED_FORMS[s.form] !== undefined;
        const tree = s.as === "tree";
        // Each appears once: as its tree, as its placement, or as one of the world's buildings and landmarks.
        expect(trees.has(k), id).toBe(tree);
        expect(i >= 0, id).toBe(!tree && !raised);
        if (raised) {
          expect(doc.world.things.some((t) => t.path === id), id).toBe(true);
          return;
        }
        const p = tree ? trees.get(k)! : placed.placements[i]!;
        if (s.file !== undefined) expect(placeAt(doc.world, p.x, p.z).file?.path, id).toBe(s.file);
      });
      // Every stone, bush or flowers represents code.
      expect(placed.placements.length).toBe(placed.symbols.filter((i) => i >= 0).length);
      // A file's or definition's building or landmark is on that file's patch, except a building whose wheel needs
      // running water, which is on its area's stream bank.
      const sited = [...code.buildings.map((b, i) => ({ path: b.facts.path, at: placed.sites[i]! })), ...placed.landmarks.map((l) => ({ path: l.id, at: l.site }))];
      const banked = new Set(requests.flatMap((b, i) => (b.wheel !== undefined ? [code.buildings[i]!.facts.path] : [])));
      for (const t of doc.world.things.filter((x) => x.file !== undefined && !banked.has(x.path))) {
        const at = sited.find((x) => x.path === t.path)?.at;
        expect(at, t.path).toBeDefined();
        expect(placeAt(doc.world, at!.x, at!.z).file?.path, t.path).toBe(t.file);
      }
    });

    it("shows each stone, bush and drift of flowers at the vitality of what it stands for", () => {
      const shown = understoryVitality(placed, (k) => code.layout.symbols[k]!.vitality);
      expect(shown.length).toBe(placed.placements.length);
      placed.symbols.forEach((i, k) => {
        if (i >= 0) expect(shown[i]).toBeCloseTo(code.layout.symbols[k]!.vitality, 5);
      });
    });
  });
});
