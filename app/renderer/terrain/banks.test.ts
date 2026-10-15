import { beforeAll, describe, expect, it } from "vitest";
import { type BuildingPlan, type Built, Library, type RouteSpec, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, LANDMARK_PRIMITIVES, RELIEF_PRIMITIVES, ROUTE_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { landmark, link, structure } from "@gaia/kinds";
import { FLORA_PRESETS, STRUCTURE_PRESETS, TRAIL_PRESETS, buildSlots, realize } from "@gaia/realize";
import { type BuildingSite, type Terrain, bakeTerrain, extentOf, findBankSite, regionAt, siteToWorld, turningExtent, waterDepthAt } from "@gaia/terrain";
import { type CodeLab, codeLab, provingWorld } from "./code-world.ts";
import { laySnapshot } from "./snapshot.ts";
import { snapshotFacts } from "./snapshot-facts.ts";
import { type StandBuilding, landmarkBase, needsBank, standWorld } from "./stand.ts";

const buildingLib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
// A watermill the size of the median building that has a wheel in these two worlds, about 54 m².
const mill = realize(STRUCTURE_PRESETS.find((p) => p.name === "Watermill")!.blueprint, structure, buildingLib, { seed: 7, facts: { size: 0.7, floors: 1 } });
const millPlan = mill.slots.get("footprint")?.output as BuildingPlan;
const millBeside = extentOf(mill.slots.get("feature")?.output as Built | undefined)!;
const millWheel = turningExtent(mill.slots.get("feature")?.output as Built | undefined)!;

/** Each building of a world as the terrain lab builds it, in the order the stand sites them. */
const buildingsOf = (code: CodeLab): StandBuilding[] =>
  code.buildings.map((b) => {
    const facts = Object.fromEntries(Object.entries(structure.facts).map(([k, bind]) => [k, bind(b.facts)]));
    const built = realize(b.blueprint, structure, buildingLib, { seed: seedOf(`terrain-lab/${b.facts.path}`), facts });
    const feature = built.slots.get("feature")?.output as Built | undefined;
    return { name: b.facts.path, plan: built.slots.get("footprint")?.output as BuildingPlan, beside: extentOf(feature), ...(needsBank(b.blueprint, buildingLib) ? { wheel: turningExtent(feature) } : {}) };
  });

describe("buildings and water, in Gaia's world and the proving ground", () => {
  let worlds: { root: string; code: CodeLab; t: Terrain; buildings: StandBuilding[] }[] = [];
  // Bakes both worlds whole and builds their buildings: about thirty seconds alone, more when other work shares the machine.
  beforeAll(async () => {
    const { world, judges, summary } = await laySnapshot("jev", "a test");
    worlds = [{ root: "gaia", facts: snapshotFacts(), world, judges, summary, judged: {} }, provingWorld()].map((doc) => {
      const code = codeLab(doc as never);
      return { root: doc.root, code, t: bakeTerrain(code.spec, new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES])), buildings: buildingsOf(code) };
    });
  }, 180_000);

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

  // Stands both worlds' buildings, landmarks and trails: several seconds alone, more when other work shares the machine.
  it("stand every house on dry ground, never in a pond or a stream", { timeout: 120_000 }, () => {
    const landmarkLib = new Library([...LANDMARK_PRIMITIVES, ...FLORA_PRIMITIVES]);
    const styles = TRAIL_PRESETS.map((p) => buildSlots(p.blueprint, link, new Library(ROUTE_PRIMITIVES), { seed: 1, facts: {} }).get("route")?.output as RouteSpec);
    for (const { root, code, t, buildings } of worlds) {
      const land = structuredClone(t);
      const stood = standWorld(land, {
        buildings,
        landmarks: code.landmarks.map((l) => ({ name: l.path, base: landmarkBase(realize(l.blueprint, landmark, landmarkLib, { seed: seedOf(`terrain-lab/landmark/${l.path}`), facts: Object.fromEntries(Object.entries(landmark.facts).map(([k, bind]) => [k, bind(l.facts)])) })) })),
        trailStyles: [styles[0] as RouteSpec, styles[1] as RouteSpec, styles[2] as RouteSpec],
        trees: { count: 0, seed: 9, presets: FLORA_PRESETS.length, builds: 1, bases: FLORA_PRESETS.map(() => 0.5), crowns: FLORA_PRESETS.map(() => 4) },
        understory: { rules: [], seed: 5 },
        code: code.stand,
      });
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
});
