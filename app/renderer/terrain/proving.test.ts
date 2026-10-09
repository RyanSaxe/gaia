import { describe, expect, it } from "vitest";
import { type BuildingPlan, type Built, Library, type RouteSpec, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, LANDMARK_PRIMITIVES, RELIEF_PRIMITIVES, ROUTE_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { landmark, link, structure } from "@gaia/kinds";
import { FLORA_PRESETS, LANDMARK_PRESETS, STRUCTURE_PRESETS, TRAIL_PRESETS, buildSlots, realize } from "@gaia/realize";
import { bakeTerrain, junctionVitality, wayVitalityAt } from "@gaia/terrain";
import { type Judgments, entityVitalityOf, groundVitality } from "@gaia/world";
import { codeLab, provingWorld } from "./code-world.ts";
import { BUILDINGS, CHARACTERS, FORMS, LANDMARKS, LANDS, TRAILS, VIBES, WATERS } from "./looks.ts";
import { extentOf, landmarkBase, standWorld } from "./stand.ts";
import judgedFixture from "./fixtures/proving-judged.json";

const judged = judgedFixture as unknown as Judgments;
const doc = provingWorld();
const vitalityOf = new Map(doc.model.entities.map((e) => [e.path, entityVitalityOf(e).vitality]));

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

  // Baking the 950 m world takes about 10 s in one Node thread, longer while other work shares the machine.
  it("crosses its streams on footbridges and stepping stones, and has cairns where ways meet, thriving and in ruin", { timeout: 90_000 }, () => {
    // Stood as the terrain lab stands it: the same buildings, landmarks and trail looks, seeded alike.
    const code = codeLab(doc);
    const terrain = bakeTerrain(code.spec, new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]));
    const buildingLib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
    const landmarkLib = new Library([...LANDMARK_PRIMITIVES, ...FLORA_PRIMITIVES]);
    const routeLib = new Library(ROUTE_PRIMITIVES);
    const styles = TRAIL_PRESETS.map((p) => buildSlots(p.blueprint, link, routeLib, { seed: 1, facts: {} }).get("route")?.output as RouteSpec);
    const stood = standWorld(terrain, {
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
      understory: { rules: [], seed: 5 },
      code: code.stand,
    });
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
});
