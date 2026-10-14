import { describe, expect, it } from "vitest";
import { type BuildingPlan, type Built, Library, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, RELIEF_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { structure } from "@gaia/kinds";
import { STRUCTURE_PRESETS, realize } from "@gaia/realize";
import { type BuildingSite, bakeTerrain, extentOf, findBankSite, regionAt, turningExtent } from "@gaia/terrain";
import { codeLab, provingWorld } from "./code-world.ts";
import { laySnapshot } from "./snapshot.ts";
import { snapshotFacts } from "./snapshot-facts.ts";
import { needsBank } from "./stand.ts";

const buildingLib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
// A watermill the size of the median building that has a wheel in these two worlds, about 54 m².
const mill = realize(STRUCTURE_PRESETS.find((p) => p.name === "Watermill")!.blueprint, structure, buildingLib, { seed: 7, facts: { size: 0.7, floors: 1 } });
const millPlan = mill.slots.get("footprint")?.output as BuildingPlan;
const millBeside = extentOf(mill.slots.get("feature")?.output as Built | undefined)!;
const millWheel = turningExtent(mill.slots.get("feature")?.output as Built | undefined)!;

describe("buildings whose wheel needs running water, in Gaia's world and the proving ground", () => {
  // Bakes both worlds whole: about twenty seconds alone, more when other work shares the machine.
  it("find a bank in every area given running water, and every one of them stands on its area's stream", async () => {
    const { world, judges, summary } = await laySnapshot("jev", "a test");
    for (const doc of [{ root: "gaia", facts: snapshotFacts(), world, judges, summary, judged: {} }, provingWorld()]) {
      const code = codeLab(doc as never);
      const t = bakeTerrain(code.spec, new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]));
      const watered = code.world.regions.filter((r) => r.water === "A brook" || r.water === "A trickle");
      expect(watered.length).toBeGreaterThan(0);
      for (const r of watered) {
        const ri = code.spec.regions.findIndex((s) => s.id === (r.area === "" ? code.world.name : r.area));
        expect(findBankSite(t, millPlan, millBeside, millWheel, ri), `${doc.root}: ${r.area}`).not.toBeNull();
      }
      // Each building Jev gave a waterwheel, at its own size, near its own lot, beside those sited before it.
      const taken: BuildingSite[] = [];
      code.buildings.forEach((b, i) => {
        if (!needsBank(b.blueprint, buildingLib)) return;
        const facts = Object.fromEntries(Object.entries(structure.facts).map(([k, bind]) => [k, bind(b.facts)]));
        const built = realize(b.blueprint, structure, buildingLib, { seed: seedOf(`terrain-lab/${b.facts.path}`), facts });
        const lot = code.stand.lots[i]!;
        const feature = built.slots.get("feature")?.output as Built | undefined;
        const site = findBankSite(t, built.slots.get("footprint")?.output as BuildingPlan, extentOf(feature)!, turningExtent(feature)!, regionAt(t.spec, lot.x, lot.z), taken, lot);
        expect(site, `${doc.root}: ${b.facts.path}`).not.toBeNull();
        if (site !== null) taken.push(site);
      });
      expect(taken.length).toBeGreaterThan(0);
    }
  }, 180_000);
});
