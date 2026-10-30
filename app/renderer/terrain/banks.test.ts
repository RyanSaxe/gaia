import { beforeAll, describe, expect, it } from "vitest";
import { type BuildingPlan, type Built, Library, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, LANDMARK_PRIMITIVES, RELIEF_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { landmark, structure } from "@gaia/kinds";
import { realize } from "@gaia/realize";
import { type Terrain, bakeTerrain, extentOf, heightAt, pastTheEdge, placeAt, regionAt, siteToWorld, turningExtent, waterDepthAt } from "@gaia/terrain";
import { type OpenedWorld, openedWorld, provingWorld } from "./code-world.ts";
import { COMPOSED_FORMS, WATERS } from "./looks.ts";
import { laySnapshot } from "./snapshot.ts";
import { snapshotFacts } from "./snapshot-facts.ts";
import { type Placed, type BuildingToPlace, landmarkBase, needsBank, placeWorld, understoryVitality } from "./place.ts";

const buildingLib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
/** Each building of a world as the world builds it, in the order `placeWorld` sites them. */
const buildingsOf = (code: OpenedWorld): BuildingToPlace[] =>
  code.buildings.map((b) => {
    const facts = Object.fromEntries(Object.entries(structure.facts).map(([k, bind]) => [k, bind(b.facts)]));
    const built = realize(b.blueprint, structure, buildingLib, { seed: seedOf(`terrain-lab/${b.facts.path}`), facts });
    const feature = built.slots.get("feature")?.output as Built | undefined;
    return { name: b.facts.path, plan: built.slots.get("footprint")?.output as BuildingPlan, beside: extentOf(feature), ...(needsBank(b.blueprint, buildingLib) ? { wheel: turningExtent(feature) } : {}) };
  });

/** Places a world as the page does: its buildings, landmarks, trails and definitions. */
function placeAsThePage(t: Terrain, code: OpenedWorld, buildings: BuildingToPlace[]): { land: Terrain; placed: Placed } {
  const landmarkLib = new Library([...LANDMARK_PRIMITIVES, ...FLORA_PRIMITIVES]);
  const land = structuredClone(t);
  const placed = placeWorld(land, {
    buildings,
    landmarks: code.landmarks.map((l) => ({ tree: l.blueprint.slots.form?.use === "great-tree@1", base: landmarkBase(realize(l.blueprint, landmark, landmarkLib, { seed: seedOf(`terrain-lab/landmark/${l.path}`), facts: Object.fromEntries(Object.entries(landmark.facts).map(([k, bind]) => [k, bind(l.facts)])) })) })),
    trees: { bases: code.naturalBuilds.trees.map(() => 0.5), crowns: code.naturalBuilds.trees.map(() => 4) },
    code: code.layout,
  });
  return { land, placed };
}

describe("the showcase, as it is and fixed, and the proving ground, placed as the page places them", () => {
  let worlds: { root: string; code: OpenedWorld; t: Terrain; buildings: BuildingToPlace[]; land: Terrain; placed: Placed }[] = [];
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

  it("give every area Jev gives running water a river that rises in its own land, and every area Jev gives a still pond its pond", () => {
    let ponds = 0;
    for (const { root, code, t } of worlds) {
      const rising = new Set(t.streams.map((s) => regionAt(t.spec, s.stations[0]!.x, s.stations[0]!.z)));
      const watered = code.world.regions.filter((r) => r.water === "A brook" || r.water === "A trickle");
      expect(watered.filter((r) => !rising.has(code.spec.regions.findIndex((s) => s.id === (r.area === "" ? code.world.name : r.area)))).map((r) => r.area), root).toEqual([]);
      const still = code.world.regions.filter((r) => WATERS[r.water]?.settles?.["relief.pond"] === true);
      expect(still.filter((r) => !t.ponds.some((p) => p.x === r.x && p.z === r.z)).map((r) => r.area), root).toEqual([]);
      ponds += still.length;
    }
    expect(ponds).toBeGreaterThan(0);
  });

  it("place every house with a waterwheel on a stream's bank, its wheel turning in the water and its floor dry", () => {
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
      // No water reaches the floor's height anywhere under the house.
      buildings.forEach((b, i) => {
        if (b.wheel === undefined || b.wheel === null) return;
        const site = placed.sites[i]!;
        for (let lz = -b.plan.depth / 2; lz <= b.plan.depth / 2; lz += 0.5) {
          for (let lx = -b.plan.width / 2; lx <= b.plan.width / 2; lx += 0.5) {
            const surface = heightAt(land.lattice, ...siteToWorld(site, lx, lz), land.waterLevel);
            expect(surface, `${root}: ${b.name} at ${lx}, ${lz}`).toBeLessThan(site.level + b.plan.floor - 0.1);
          }
        }
      });
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

  it("place every definition, file and entity the layout lays out, as a tree, a stone, a bush, flowers or one of the world's things, each on its own file's patch, however crowded its ground, and nothing else", () => {
    for (const { root, code, buildings, placed } of worlds) {
      const { world } = code;
      expect(placed.symbols.length, root).toBe(world.symbols.length + world.naturalThings.length);
      const trees = new Map(placed.trees.map((t) => [t.symbol, t]));
      expect(trees.size, root).toBeGreaterThan(0);
      const astray: string[] = [];
      placed.symbols.forEach((i, k) => {
        const s = world.symbols[k] ?? world.naturalThings[k - world.symbols.length]!;
        const path = "id" in s ? s.id : s.path;
        const raised = COMPOSED_FORMS[s.form] !== undefined;
        const tree = s.as === "tree";
        // Each appears once: as its tree, as its placement, or as one of the world's buildings and landmarks.
        expect(trees.has(k), `${root}: ${path}`).toBe(tree);
        expect(i >= 0, `${root}: ${path}`).toBe(!tree && !raised);
        if (raised) {
          expect(world.things.some((t) => t.path === path), `${root}: ${path}`).toBe(true);
          return;
        }
        const p = tree ? trees.get(k)! : placed.placements[i]!;
        const on = placeAt(world, p.x, p.z).file?.path;
        if (s.file !== undefined && on !== s.file) astray.push(`${path} (${s.as}) on ${on ?? "no file"}`);
      });
      // Every stone, bush or flowers represents code.
      expect(placed.placements.length, root).toBe(placed.symbols.filter((i) => i >= 0).length);
      // A file's or definition's building or landmark is on that file's patch, except a building whose wheel needs
      // running water, which is on its area's stream bank, and a landmark whose patch has no spot the placement rules
      // accept (`Placed.offGround`). Every building fits its own patch.
      const sited = [...code.buildings.map((b, i) => ({ path: b.facts.path, at: placed.sites[i]! })), ...placed.landmarks.map((l) => ({ path: l.id, at: l.site }))];
      const banked = new Set(buildings.flatMap((b, i) => (b.wheel !== undefined ? [code.buildings[i]!.facts.path] : [])));
      const off = new Set(placed.offGround);
      expect(code.buildings.filter((b) => off.has(b.facts.path)).map((b) => b.facts.path), root).toEqual([]);
      for (const t of world.things.filter((x) => x.file !== undefined && !banked.has(x.path) && !off.has(x.path))) {
        const at = sited.find((x) => x.path === t.path)?.at;
        const on = at === undefined ? undefined : placeAt(world, at.x, at.z).file?.path;
        if (on !== t.file) astray.push(`${t.path} (${t.as}) on ${on ?? "no file"}`);
      }
      expect(astray, root).toEqual([]);
    }
  });

  it("cross every stream a trail meets from dry bank to dry bank, and drop no trail Jev asks for", () => {
    for (const { root, land, placed } of worlds) {
      const net = placed.network;
      for (const c of net.ways.flatMap((w) => w.crossings)) {
        const at = (s: number): readonly [number, number] => [c.x + Math.cos(-c.yaw) * s, c.z + Math.sin(-c.yaw) * s];
        for (const end of [-c.span / 2, c.span / 2]) expect(waterDepthAt(land, ...at(end)), `${root}: ${c.x}, ${c.z} ends dry`).toBeLessThan(0.01);
        expect(Math.max(...Array.from({ length: 21 }, (_, i) => waterDepthAt(land, ...at(-c.span / 2 + (c.span * i) / 20)))), `${root}: ${c.x}, ${c.z} spans water`).toBeGreaterThan(0.1);
      }
      expect(net.dropped, root).toEqual([]);
    }
  });

  it("show each stone, bush and drift of flowers at the vitality of the code it represents", () => {
    for (const { root, code, placed } of worlds) {
      const shown = understoryVitality(placed, (k) => code.layout.symbols[k]!.vitality);
      expect(shown.length, root).toBe(placed.placements.length);
      placed.symbols.forEach((i, k) => {
        if (i >= 0) expect(shown[i], root).toBeCloseTo(code.layout.symbols[k]!.vitality, 5);
      });
    }
  });
});
