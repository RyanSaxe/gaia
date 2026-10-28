import { beforeAll, describe, expect, it } from "vitest";
import { type BuildingPlan, type Built, Library, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, LANDMARK_PRIMITIVES, RELIEF_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { landmark, structure } from "@gaia/kinds";
import { realize } from "@gaia/realize";
import { type BuildingSite, type Terrain, bakeTerrain, extentOf, findBankSite, pastTheEdge, regionAt, siteToWorld, turningExtent, waterDepthAt, yardsMeet } from "@gaia/terrain";
import { sweep } from "@gaia/world";
import { type OpenedWorld, openedWorld, provingWorld } from "./code-world.ts";
import { laySnapshot } from "./snapshot.ts";
import { snapshotFacts } from "./snapshot-facts.ts";
import { AS_THING, type Placed, type BuildingToPlace, type LandmarkToPlace, houseGround, landmarkBase, landmarkGround, needsBank, placeWorld } from "./place.ts";

const buildingLib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
// A watermill: the first building from a sweep over a building's parts, at the size of the median building with a wheel in these two worlds, about 54 m².
const millBlueprint = sweep(structure, buildingLib).blueprints.find((b) => b.slots.feature?.use === "waterwheel@1")!;
const mill = realize(millBlueprint, structure, buildingLib, { seed: 7, facts: { size: 0.7, floors: 1 } });
const millPlan = mill.slots.get("footprint")?.output as BuildingPlan;
const millBeside = extentOf(mill.slots.get("feature")?.output as Built | undefined)!;
const millWheel = turningExtent(mill.slots.get("feature")?.output as Built | undefined)!;

/** Each building of a world as the world builds it, in the order `placeWorld` sites them. */
const buildingsOf = (code: OpenedWorld): BuildingToPlace[] =>
  code.buildings.map((b) => {
    const facts = Object.fromEntries(Object.entries(structure.facts).map(([k, bind]) => [k, bind(b.facts)]));
    const built = realize(b.blueprint, structure, buildingLib, { seed: seedOf(`terrain-lab/${b.facts.path}`), facts });
    const feature = built.slots.get("feature")?.output as Built | undefined;
    return { name: b.facts.path, plan: built.slots.get("footprint")?.output as BuildingPlan, beside: extentOf(feature), ...(needsBank(b.blueprint, buildingLib) ? { wheel: turningExtent(feature) } : {}) };
  });

/** Places a world as the page does: its buildings, landmarks, trails and definitions. */
function placeAsThePage(t: Terrain, code: OpenedWorld, buildings: BuildingToPlace[]): { land: Terrain; placed: Placed; landmarks: LandmarkToPlace[] } {
  const landmarkLib = new Library([...LANDMARK_PRIMITIVES, ...FLORA_PRIMITIVES]);
  const land = structuredClone(t);
  const landmarks = code.landmarks.map((l) => ({ tree: l.blueprint.slots.form?.use === "great-tree@1", base: landmarkBase(realize(l.blueprint, landmark, landmarkLib, { seed: seedOf(`terrain-lab/landmark/${l.path}`), facts: Object.fromEntries(Object.entries(landmark.facts).map(([k, bind]) => [k, bind(l.facts)])) })) }));
  const placed = placeWorld(land, {
    buildings,
    landmarks,
    trees: { bases: code.naturalBuilds.trees.map(() => 0.5), crowns: code.naturalBuilds.trees.map(() => 4) },
    code: code.layout,
  });
  return { land, placed, landmarks };
}

describe("the showcase, as it is and fixed, and the proving ground, placed as the page places them", () => {
  let worlds: { root: string; code: OpenedWorld; t: Terrain; buildings: BuildingToPlace[]; land: Terrain; placed: Placed; landmarks: LandmarkToPlace[] }[] = [];
  // Bakes and places all three worlds whole, about two minutes while other work shares the machine, most of it for the proving ground.
  beforeAll(async () => {
    const snapshots = await Promise.all((["showcase", "showcase-fixed"] as const).map(async (of) => ({ root: of, facts: snapshotFacts(of), ...(await laySnapshot("a test", of)), judged: {} })));
    worlds = [...snapshots, provingWorld()].map((doc) => {
      const code = openedWorld(doc as never);
      const t = bakeTerrain(code.spec, new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]));
      const buildings = buildingsOf(code);
      return { root: doc.root, code, t, buildings, ...placeAsThePage(t, code, buildings) };
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
      // Each building Jev gave a waterwheel, sited at its own size near its own lot, beside those sited before it.
      const taken: BuildingSite[] = [];
      buildings.forEach((b, i) => {
        if (b.wheel === undefined) return;
        const lot = code.layout.lots[i]!;
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

  it("place every house with a waterwheel on a stream's bank, its wheel turning in the water", () => {
    for (const { root, buildings, land, placed } of worlds) {
      expect(placed.dry, root).toEqual([]);
      const wheels = buildings.filter((b) => b.wheel !== undefined && b.wheel !== null);
      expect(wheels.length, root).toBeGreaterThan(0);
      const offWater = buildings.flatMap((b, i) => {
        if (b.wheel === undefined || b.wheel === null) return [];
        const [x, z] = siteToWorld(placed.sites[i]!, (b.wheel.x0 + b.wheel.x1) / 2, (b.wheel.z0 + b.wheel.z1) / 2);
        return waterDepthAt(land, x, z) > 0.05 ? [] : [b.name];
      });
      expect(offWater, root).toEqual([]);
    }
  });

  it("run every river and place every mill on the land its areas are laid out on, never past its outline", () => {
    for (const { root, code, t, buildings, placed } of worlds) {
      const land = { size: code.world.size, ...(code.world.aspect === undefined ? {} : { aspect: code.world.aspect }) };
      const past = t.streams.flatMap((s, i) => (s.stations.some((p) => pastTheEdge(land, p.x, p.z) > 0) ? [`stream ${i}`] : []));
      const mills = buildings.flatMap((b, i) => (b.wheel !== undefined && pastTheEdge(land, placed.sites[i]!.x, placed.sites[i]!.z) > 0 ? [b.name] : []));
      expect([...past, ...mills], root).toEqual([]);
    }
  });

  it("begin and end every trail on dry ground", () => {
    for (const { root, land, placed } of worlds) {
      const { ways, trails } = placed.network;
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

  it("place every house on dry ground, never in a pond or a stream", () => {
    for (const { root, buildings, land, placed } of worlds) {
      // A house with a wheel sits on a stream's bank with its wheel in the water. Every other house is wholly on dry ground.
      buildings.forEach((b, i) => {
        if (b.wheel !== undefined) return;
        const site = placed.sites[i]!;
        const { width, depth } = b.plan;
        const under = Array.from({ length: 25 }, (_, k) => waterDepthAt(land, ...siteToWorld(site, ((k % 5) / 4 - 0.5) * width, (Math.floor(k / 5) / 4 - 0.5) * depth)));
        expect(Math.max(...under), `${root}: ${b.name}`).toBe(0);
      });
    }
  });

  it("place no house's yard on another's, and no landmark on a house, on what is beside it or on another landmark", () => {
    for (const { root, buildings, placed, landmarks } of worlds) {
      const pads = placed.edits.pads;
      const yards = pads.flatMap((a, i) => pads.flatMap((b, k) => (k > i && yardsMeet(a, b) ? [`${buildings[i]!.name} and ${buildings[k]!.name}`] : [])));
      expect(yards, root).toEqual([]);
      // Measured the way a landmark's site is found: its ground against each house's and each other landmark's.
      const ground = (s: Placed["landmarks"][number]): number => landmarkGround(landmarks[s.landmark]!.base);
      const crowded = placed.landmarks.flatMap((s, i) => [
        ...buildings.flatMap((b, k) => (Math.hypot(placed.sites[k]!.x - s.site.x, placed.sites[k]!.z - s.site.z) < houseGround(b) + ground(s) ? [`${s.id} on ${b.name}`] : [])),
        ...placed.landmarks.flatMap((o, k) => (k > i && Math.hypot(o.site.x - s.site.x, o.site.z - s.site.z) < ground(s) + ground(o) ? [`${s.id} on ${o.id}`] : [])),
      ]);
      expect(crowded, root).toEqual([]);
    }
  });

  it("place every definition, file and entity the layout lays out as a tree, a stone, a bush or flowers, however crowded its patch", () => {
    for (const { root, code, placed } of worlds) {
      const trees = new Set(placed.trees.map((tree) => tree.symbol));
      const left = code.layout.symbols.flatMap((s, i) => (s.rule === AS_THING || placed.symbols[i]! >= 0 || trees.has(i) ? [] : [code.symbolOf(i)?.represented.id ?? String(i)]));
      expect(left, root).toEqual([]);
    }
  });
});
