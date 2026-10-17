import { beforeAll, describe, expect, it } from "vitest";
import { type BuildingPlan, type Built, Library, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, LANDMARK_PRIMITIVES, RELIEF_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { landmark, structure } from "@gaia/kinds";
import { FLORA_PRESETS, realize } from "@gaia/realize";
import { type BuildingSite, type Terrain, bakeTerrain, extentOf, findBankSite, regionAt, siteToWorld, turningExtent, waterDepthAt, yardsMeet } from "@gaia/terrain";
import { type OpenedWorld, openedWorld, provingWorld } from "./code-world.ts";
import { laySnapshot } from "./snapshot.ts";
import { snapshotFacts } from "./snapshot-facts.ts";
import { BUILDINGS } from "../../../tools/proving-looks.ts";
import { AS_THING, type Stand, type StandBuilding, type StandLandmark, blockedBy, landmarkBase, needsBank, standWorld } from "./stand.ts";

const buildingLib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
// A watermill the size of the median building that has a wheel in these two worlds, about 54 m².
const mill = realize(BUILDINGS.Watermill!, structure, buildingLib, { seed: 7, facts: { size: 0.7, floors: 1 } });
const millPlan = mill.slots.get("footprint")?.output as BuildingPlan;
const millBeside = extentOf(mill.slots.get("feature")?.output as Built | undefined)!;
const millWheel = turningExtent(mill.slots.get("feature")?.output as Built | undefined)!;

/** Each building of a world as the world builds it, in the order the stand sites them. */
const buildingsOf = (code: OpenedWorld): StandBuilding[] =>
  code.buildings.map((b) => {
    const facts = Object.fromEntries(Object.entries(structure.facts).map(([k, bind]) => [k, bind(b.facts)]));
    const built = realize(b.blueprint, structure, buildingLib, { seed: seedOf(`terrain-lab/${b.facts.path}`), facts });
    const feature = built.slots.get("feature")?.output as Built | undefined;
    return { name: b.facts.path, plan: built.slots.get("footprint")?.output as BuildingPlan, beside: extentOf(feature), ...(needsBank(b.blueprint, buildingLib) ? { wheel: turningExtent(feature) } : {}) };
  });

/** A world stood as the page stands it: its buildings, its landmarks, its trails and its definitions. */
function standAsThePage(t: Terrain, code: OpenedWorld, buildings: StandBuilding[]): { land: Terrain; stood: Stand; landmarks: StandLandmark[] } {
  const landmarkLib = new Library([...LANDMARK_PRIMITIVES, ...FLORA_PRIMITIVES]);
  const land = structuredClone(t);
  const landmarks = code.landmarks.map((l) => ({ tree: l.blueprint.slots.form?.use === "great-tree@1", base: landmarkBase(realize(l.blueprint, landmark, landmarkLib, { seed: seedOf(`terrain-lab/landmark/${l.path}`), facts: Object.fromEntries(Object.entries(landmark.facts).map(([k, bind]) => [k, bind(l.facts)])) })) }));
  const stood = standWorld(land, {
    buildings,
    landmarks,
    trees: { builds: 1, bases: FLORA_PRESETS.map(() => 0.5), crowns: FLORA_PRESETS.map(() => 4) },
    code: code.stand,
  });
  return { land, stood, landmarks };
}

describe("Gaia's world, the showcase and the proving ground, stood as the page stands them", () => {
  let worlds: { root: string; code: OpenedWorld; t: Terrain; buildings: StandBuilding[]; land: Terrain; stood: Stand; landmarks: StandLandmark[] }[] = [];
  // Bakes and stands all four worlds whole: about fifty seconds alone, more when other work shares the machine.
  beforeAll(async () => {
    const snapshots = await Promise.all((["gaia", "showcase", "showcase-fixed"] as const).map(async (of) => ({ root: of, facts: snapshotFacts(of), ...(await laySnapshot("a test", of)), judged: {} })));
    worlds = [...snapshots, provingWorld()].map((doc) => {
      const code = openedWorld(doc as never);
      const t = bakeTerrain(code.spec, new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]));
      const buildings = buildingsOf(code);
      return { root: doc.root, code, t, buildings, ...standAsThePage(t, code, buildings) };
    });
  }, 240_000);

  it("find a bank in every area given running water, and every building with a wheel stands on its area's stream", () => {
    for (const { root, code, t, buildings } of worlds) {
      const watered = code.world.regions.filter((r) => r.water === "A brook" || r.water === "A trickle");
      expect(watered.length).toBeGreaterThan(0);
      for (const r of watered) {
        const ri = code.spec.regions.findIndex((s) => s.id === (r.area === "" ? code.world.name : r.area));
        expect(findBankSite(t, millPlan, millBeside, millWheel, ri), `${root}: ${r.area}`).not.toBeNull();
      }
      // Each building Jev gave a waterwheel, at its own size, near its own lot, beside those sited before it.
      const taken: BuildingSite[] = [];
      buildings.forEach((b, i) => {
        if (b.wheel === undefined) return;
        const lot = code.stand.lots[i]!;
        const site = findBankSite(t, b.plan, b.beside!, b.wheel!, regionAt(t.spec, lot.x, lot.z), taken, lot);
        expect(site, `${root}: ${b.name}`).not.toBeNull();
        if (site !== null) taken.push(site);
      });
      expect(taken.length).toBeGreaterThan(0);
    }
  });

  it("give every area Jev gives running water a river that rises in its own land", () => {
    for (const { root, code, t } of worlds) {
      const rising = new Set(t.streams.map((s) => regionAt(t.spec, s.stations[0]!.x, s.stations[0]!.z)));
      const watered = code.world.regions.filter((r) => r.water === "A brook" || r.water === "A trickle");
      expect(watered.filter((r) => !rising.has(code.spec.regions.findIndex((s) => s.id === (r.area === "" ? code.world.name : r.area)))).map((r) => r.area), root).toEqual([]);
    }
  });

  it("stand every house with a waterwheel on a stream's bank, its wheel turning in the water", () => {
    for (const { root, buildings, land, stood } of worlds) {
      expect(stood.dry, root).toEqual([]);
      const wheels = buildings.filter((b) => b.wheel !== undefined && b.wheel !== null);
      expect(wheels.length, root).toBeGreaterThan(0);
      const offWater = buildings.flatMap((b, i) => {
        if (b.wheel === undefined || b.wheel === null) return [];
        const [x, z] = siteToWorld(stood.sites[i]!, (b.wheel.x0 + b.wheel.x1) / 2, (b.wheel.z0 + b.wheel.z1) / 2);
        return waterDepthAt(land, x, z) > 0.05 ? [] : [b.name];
      });
      expect(offWater, root).toEqual([]);
    }
  });

  it("begin and end every trail on dry ground", () => {
    for (const { root, land, stood } of worlds) {
      const { ways, trails } = stood.network;
      expect(trails.length, root).toBeGreaterThan(0);
      const depthAt = (w: { readonly way: number; readonly reversed: boolean }, first: boolean): number => {
        const p = ways[w.way]!.points;
        const k = first !== w.reversed ? 0 : p.length - 2;
        return waterDepthAt(land, p[k]!, p[k + 1]!);
      };
      const wet = trails.flatMap((tr) => (tr.ways.length > 0 && (depthAt(tr.ways[0]!, true) > 0 || depthAt(tr.ways[tr.ways.length - 1]!, false) > 0) ? [tr.id] : []));
      expect(wet, root).toEqual([]);
    }
  });

  it("stand every house on dry ground, never in a pond or a stream", () => {
    for (const { root, buildings, land, stood } of worlds) {
      // A house with a wheel stands on a stream's bank with its wheel in the water; every other house stands wholly on dry ground.
      buildings.forEach((b, i) => {
        if (b.wheel !== undefined) return;
        const site = stood.sites[i]!;
        const { width, depth } = b.plan;
        const under = Array.from({ length: 25 }, (_, k) => waterDepthAt(land, ...siteToWorld(site, ((k % 5) / 4 - 0.5) * width, (Math.floor(k / 5) / 4 - 0.5) * depth)));
        expect(Math.max(...under), `${root}: ${b.name}`).toBe(0);
      });
    }
  });

  it("stand no house's yard on another's, and no landmark on a house, on what stands beside it or on another landmark", () => {
    for (const { root, buildings, stood, landmarks } of worlds) {
      const pads = stood.edits.pads;
      const yards = pads.flatMap((a, i) => pads.flatMap((b, k) => (k > i && yardsMeet(a, b) ? [`${buildings[i]!.name} and ${buildings[k]!.name}`] : [])));
      expect(yards, root).toEqual([]);
      const base = (s: Stand["landmarks"][number]): number => landmarks[s.landmark]!.base;
      const crowded = stood.landmarks.flatMap((s, i) => [
        ...buildings.flatMap((b, k) => (blockedBy(b, stood.sites[k]!, s.site.x, s.site.z, base(s)) ? [`${s.id} on ${b.name}`] : [])),
        ...stood.landmarks.flatMap((o, k) => (k > i && Math.hypot(o.site.x - s.site.x, o.site.z - s.site.z) < base(s) + base(o) ? [`${s.id} on ${o.id}`] : [])),
      ]);
      expect(crowded, root).toEqual([]);
    }
  });

  it("stand every definition, file and entity the layout lays out as a tree, a stone, a bush or flowers, however crowded its patch", () => {
    for (const { root, code, stood } of worlds) {
      const trees = new Set(stood.trees.map((tree) => tree.symbol));
      const left = code.stand.symbols.flatMap((s, i) => (s.rule === AS_THING || stood.symbols[i]! >= 0 || trees.has(i) ? [] : [code.standing(i)?.represented.id ?? String(i)]));
      expect(left, root).toEqual([]);
    }
  });
});
