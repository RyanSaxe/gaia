import { beforeAll, describe, expect, it } from "vitest";
import { type BuildingPlan, type Built, Library, type RouteSpec, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, LANDMARK_PRIMITIVES, RELIEF_PRIMITIVES, ROUTE_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { landmark, link, structure } from "@gaia/kinds";
import { FLORA_PRESETS, LANDMARK_PRESETS, STRUCTURE_PRESETS, TRAIL_PRESETS, buildSlots, realize } from "@gaia/realize";
import { type BuildingSite, type Extent, TERRAIN, type Terrain, bakeTerrain, extentOf, groundLook, siteToWorld, turningExtent, junctionVitality, ownershipOf, placeAt, vitalityAt, vitalityOver, waterDepthAt, wayVitalityAt } from "@gaia/terrain";
import { type Judgments, areaVitality, groundVitality } from "@gaia/world";
import { codeLab, provingWorld } from "./code-world.ts";
import { BUILDINGS, CHARACTERS, COMPOSED_FORMS, FORMS, LANDMARKS, LANDS, TRAILS, WATERS, presetBlueprint } from "./looks.ts";
import { type Stand, type StandBuilding, groundSites, landmarkBase, needsBank, ownerVitality, standWorld, understoryVitality } from "./stand.ts";
import judgedFixture from "./fixtures/proving-judged.json";

const judged = judgedFixture as unknown as Judgments;
const doc = provingWorld();
const code = codeLab(doc);
const vitalityOf = new Map(doc.world.things.map((t) => [t.path, t.vitality]));
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
const own = ownershipOf(groundSites(code.stand), doc.world, doc.world.size + TERRAIN.skirt * 2);
const tables = ownerVitality(doc.world, (path) => doc.world.patches.find((p) => p.path === path)?.vitality ?? 1);
const groundField = vitalityOver(own, tables.ground);
const waterField = vitalityOver(own, tables.area);

describe("the proving ground", () => {
  it("chooses every option the judge can choose, and stands every building and landmark thriving, tired and in ruin", () => {
    const used = (options: object, chosen: Iterable<string>): string[] => Object.keys(options).filter((k) => ![...chosen].includes(k));
    // Lands and trails are hand-filled blueprints here, so each preset is found by its blueprint.
    const blueprints = (of: Iterable<{ readonly id: string } | undefined>): Set<string> => new Set([...of].flatMap((b) => (b === undefined ? [] : [b.id])));
    const landsUsed = blueprints(Object.values(judged.lands));
    expect(Object.keys(LANDS).filter((k) => !landsUsed.has(presetBlueprint("land", k).id))).toEqual([]);
    expect(used(WATERS, Object.values(judged.waters))).toEqual([]);
    expect(used(CHARACTERS, Object.values(judged.characters))).toEqual([]);
    expect(used(FORMS, Object.values(judged.forms).flatMap((f) => Object.values(f)))).toEqual([]);
    // Anything stands as anything: an entity, a file and a definition each stand as a building and as a landmark, and
    // every file stands as one thing of its own.
    for (const of of ["entity", "file", "definition"] as const) {
      for (const as of ["building", "landmark"] as const) expect(doc.world.things.some((t) => (t.of ?? "entity") === of && t.as === as), `a ${of} as a ${as}`).toBe(true);
    }
    expect(doc.world.standing.filter((s) => s.of === "file").length + doc.world.things.filter((t) => t.of === "file").length).toBe(doc.world.patches.length);
    expect(used(FORMS, doc.world.standing.map((s) => s.form))).toEqual([]);
    const trailsUsed = blueprints(judged.trails.map((t) => t.route));
    expect(Object.keys(TRAILS).filter((k) => !trailsUsed.has(presetBlueprint("trail", k).id))).toEqual([]);
    for (const [as, looks] of [["building", BUILDINGS], ["landmark", LANDMARKS]] as const) {
      for (const look of Object.keys(looks)) {
        const blueprint = (as === "building" ? STRUCTURE_PRESETS : LANDMARK_PRESETS).find((p) => p.name === look)?.blueprint.id;
        const healths = doc.world.things.filter((t) => t.as === as && t.blueprint.id === blueprint).map((t) => vitalityOf.get(t.path) ?? 1);
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
    let requests: StandBuilding[];
    // Baking and standing the 950 m world takes about 10 s in one Node thread, longer while other work shares the machine.
    beforeAll(() => {
      // The same buildings, landmarks and trail looks, seeded alike.
      terrain = bakeTerrain(code.spec, new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]));
      const buildingLib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
      const landmarkLib = new Library([...LANDMARK_PRIMITIVES, ...FLORA_PRIMITIVES]);
      const routeLib = new Library(ROUTE_PRIMITIVES);
      const styles = TRAIL_PRESETS.map((p) => buildSlots(p.blueprint, link, routeLib, { seed: 1, facts: {} }).get("route")?.output as RouteSpec);
      requests = code.buildings.map((b) => {
          const facts = Object.fromEntries(Object.entries(structure.facts).map(([k, bind]) => [k, bind(b.facts)]));
          const built = realize(b.blueprint, structure, buildingLib, { seed: seedOf(`terrain-lab/${b.facts.path}`), facts });
          const feature = built.slots.get("feature")?.output as Built | undefined;
          return { name: b.facts.name, plan: built.slots.get("footprint")?.output as BuildingPlan, beside: extentOf(feature), ...(needsBank(b.blueprint, buildingLib) ? { wheel: turningExtent(feature) } : {}) };
        });
      stood = standWorld(terrain, {
        buildings: requests,
        landmarks: code.landmarks.map((l) => ({
          name: l.path,
          base: landmarkBase(realize(l.blueprint, landmark, landmarkLib, { seed: seedOf(`terrain-lab/landmark/${l.path}`), facts: Object.fromEntries(Object.entries(landmark.facts).map(([k, bind]) => [k, bind(l.facts)])) })),
        })),
        trailStyles: [styles[0] as RouteSpec, styles[1] as RouteSpec, styles[2] as RouteSpec],
        trees: { count: 0, seed: 9, presets: FLORA_PRESETS.length, builds: 1, bases: FLORA_PRESETS.map(() => 0.5), crowns: FLORA_PRESETS.map(() => 4) },
        code: code.stand,
      });
    }, 120_000);

    it("stands each building whose wheel needs running water on its stream's bank, its wheel in the water", () => {
      expect(stood.dry).toEqual([]);
      const banked = requests.flatMap((b, i) => (b.wheel !== undefined ? [{ b, site: stood.sites[i] as BuildingSite }] : []));
      expect(banked.length).toBeGreaterThan(2);
      for (const { b, site } of banked) {
        expect("wall" in site, b.name).toBe(true);
        // Its wheel turns in the stream.
        const w = b.wheel as Extent;
        expect(waterDepthAt(terrain, ...siteToWorld(site, (w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2)), b.name).toBeGreaterThan(0);
        expect(waterDepthAt(terrain, site.x, site.z), b.name).toBe(0);
      }
    });

    it("crosses its streams on footbridges and stepping stones, and has cairns where ways meet, thriving and in ruin", () => {
      const net = stood.network;
      const place = (id: string): number => vitalityOf.get(id) ?? 1;
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
      expect(stood.symbols.length).toBe(doc.world.symbols.length + doc.world.standing.length);
      const trees = new Map(stood.trees.map((t) => [t.symbol, t]));
      expect(trees.size).toBeGreaterThan(0);
      stood.symbols.forEach((i, k) => {
        const s = doc.world.symbols[k] ?? doc.world.standing[k - doc.world.symbols.length]!;
        const id = "id" in s ? s.id : s.path;
        const raised = COMPOSED_FORMS[s.form] !== undefined;
        const tree = FORMS[s.form]?.rule === "trees";
        // Each stands once: as its tree, as its placement, or as one of the world's buildings and landmarks.
        expect(trees.has(k), id).toBe(tree);
        expect(i >= 0, id).toBe(!tree && !raised);
        if (raised) {
          expect(doc.world.things.some((t) => t.path === id), id).toBe(true);
          return;
        }
        const p = tree ? trees.get(k)! : stood.placements[i]!;
        if (s.file !== undefined) expect(placeAt(doc.world, p.x, p.z).file?.path, id).toBe(s.file);
      });
      // No stone, bush or flowers stands for nothing.
      expect(stood.placements.length).toBe(stood.symbols.filter((i) => i >= 0).length);
      // A file's or a definition's building or landmark stands on that file's patch, but a building whose wheel needs
      // running water, which stands on its area's stream's bank.
      const sited = [...code.buildings.map((b, i) => ({ path: b.facts.path, at: stood.sites[i]! })), ...stood.landmarks.map((l) => ({ path: l.id, at: l.site }))];
      const banked = new Set(requests.flatMap((b, i) => (b.wheel !== undefined ? [code.buildings[i]!.facts.path] : [])));
      for (const t of doc.world.things.filter((x) => x.file !== undefined && !banked.has(x.path))) {
        const at = sited.find((x) => x.path === t.path)?.at;
        expect(at, t.path).toBeDefined();
        expect(placeAt(doc.world, at!.x, at!.z).file?.path, t.path).toBe(t.file);
      }
    });

    it("shows each stone, bush and drift of flowers at the vitality of what it stands for", () => {
      const shown = understoryVitality(stood, (k) => code.stand.symbols[k]!.vitality);
      expect(shown.length).toBe(stood.placements.length);
      stood.symbols.forEach((i, k) => {
        if (i >= 0) expect(shown[i]).toBeCloseTo(code.stand.symbols[k]!.vitality, 5);
      });
    });
  });
});
