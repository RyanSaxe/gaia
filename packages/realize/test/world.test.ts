import { describe, expect, it } from "vitest";
import { type ChoiceField, Library, rand, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES, WORLD_PRIMITIVES, air as airPrimitive } from "@gaia/primitives";
import { biome, world } from "@gaia/kinds";
import { assemble, planDetails, planStructure, readStructure, validate } from "@gaia/world";
import { AIR, CLEAR_AIR, MURK, airFromHeight, mixAir, murkyAir, realizeWorld } from "@gaia/realize";
import { blueprintOf as identify } from "@gaia/schema";
import { fakeJev, randomSlots } from "@gaia/world/testing";

const lib = new Library([...WORLD_PRIMITIVES, ...BIOME_PRIMITIVES, ...RELIEF_PRIMITIVES]);
const SEED = seedOf("lab/world");

const seeded = (seed: number): (() => number) => {
  const r = rand(seed);
  return () => r.next();
};

const finite = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finite);
  if (value !== null && typeof value === "object") return Object.values(value).every(finite);
  return true;
};

describe("world and biome kinds", () => {
  const look = (w: Parameters<typeof identify>[1], b: Parameters<typeof identify>[1], hour = 12.5) =>
    realizeWorld({ blueprint: identify("world", w), kind: world }, { blueprint: identify("biome", b), kind: biome }, lib, SEED, hour);

  it("realizes the same look for the same blueprints and seed", () => {
    const random = seeded(31);
    for (let i = 0; i < 6; i++) {
      const w = randomSlots(world, lib, random);
      const b = randomSlots(biome, lib, random);
      expect(look(w, b)).toEqual(look(w, b));
    }
    const draw = (): string[] => {
      const random = seeded(99);
      return Array.from({ length: 20 }, () => identify("world", randomSlots(world, lib, random)).id);
    };
    expect(draw()).toEqual(draw());
  });

  it("validates and realizes every uniformly sampled world and region", () => {
    const random = seeded(7);
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const hour = random() * 24;
      const w = identify("world", randomSlots(world, lib, random));
      const b = identify("biome", randomSlots(biome, lib, random));
      expect(validate(w, world, lib)).toEqual([]);
      expect(validate(b, biome, lib)).toEqual([]);
      const l = look(w.slots, b.slots, hour);
      expect(finite(l)).toBe(true);
      for (const c of [l.sky.zenith, l.sky.horizon, l.fog.color, l.ground.low, l.ground.high, l.light.sunColor]) {
        for (const x of c) expect(x >= 0 && x <= 1).toBe(true);
      }
      ids.add(`${w.id}/${b.id}`);
    }
    expect(ids.size).toBeGreaterThan(995);
  });

  it("asks for the light first, then sky and wind with its answers in the state", () => {
    const target = { id: "repo", state: { languages: ["TypeScript"], files: 412, ageDays: 900 } };
    const s = planStructure(world, lib, target);
    expect(Object.keys(s.request.questions)).toEqual([]);
    const structure = readStructure(world, lib, s, {});
    const first = planDetails(world, lib, structure, target, { stage: 0 });
    expect(Object.keys(first.request.questions).sort()).toEqual(["light.brush", "light.moon", "light.path", "light.stars", "light.warmth"]);
    const firstAnswers = fakeJev(first.request);
    const second = planDetails(world, lib, structure, target, { stage: 1, earlier: { light: "warm" } });
    expect(Object.keys(second.request.questions).sort()).toEqual(["sky.character", "sky.clouds", "sky.cover", "wind.strength"]);
    expect((second.request.state as { earlier?: unknown }).earlier).toEqual({ light: "warm" });
    const bp = assemble(world, lib, structure, [first, second], { ...firstAnswers, ...fakeJev(second.request) });
    expect(validate(bp, world, lib)).toEqual([]);
  });
});

describe("the air where regions meet", () => {
  type Erased = (p: unknown) => ReturnType<typeof airPrimitive.build>;
  const MIST = (airPrimitive.build as unknown as Erased)({ air: "morning mist", distance: "softened distance" });
  const close = (a: readonly number[], b: readonly number[]): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i] as number, 4));

  it("is each region's own air inside it, and between two regions moves with their weights, a clear region's unused tint coloring nothing", () => {
    expect(mixAir([CLEAR_AIR, MIST], [1, 0])).toEqual(CLEAR_AIR);
    const misty = mixAir([CLEAR_AIR, MIST], [0, 1]);
    close([misty.density, misty.mist, misty.tintAmount], [MIST.density, MIST.mist, MIST.tintAmount]);
    close(misty.tint, MIST.tint);
    // Halfway, at weights of any scale: half the mist's density, mist and pull, in the mist's own color.
    const halfway = mixAir([CLEAR_AIR, MIST], [2, 2]);
    close([halfway.density, halfway.mist, halfway.tintAmount], [(CLEAR_AIR.density + MIST.density) / 2, MIST.mist / 2, MIST.tintAmount / 2]);
    close(halfway.tint, MIST.tint);
  });
});

describe("the air over failing ground and from above", () => {
  type Erased = (p: unknown) => ReturnType<typeof airPrimitive.build>;
  const airs = Object.keys((airPrimitive.params.air as ChoiceField).options).map((name) => (airPrimitive.build as unknown as Erased)({ air: name, distance: "softened distance" }));

  it("leaves thriving and tired ground's air as it was, and thickens and greys it as the ground fails, gradually", () => {
    for (const air of airs) {
      for (const decline of [0, 0.1, MURK.from]) expect(murkyAir(air, decline)).toEqual(air);
      const failed = murkyAir(air, 1);
      expect(failed.density).toBeCloseTo(air.density * MURK.thicken, 10);
      expect(failed.mist).toBeGreaterThan(air.mist);
      expect(failed.tintAmount).toBeGreaterThanOrEqual(MURK.pull);
      failed.tint.forEach((v, i) => expect(v).toBeCloseTo(MURK.tint[i] as number, 6));
      // No step anywhere: a hundredth more decline thickens the air by at most six percent.
      let last = murkyAir(air, 0);
      for (let d = 0.01; d <= 1.0001; d += 0.01) {
        const next = murkyAir(air, d);
        expect(next.density).toBeGreaterThanOrEqual(last.density);
        expect((next.density - last.density) / air.density).toBeLessThan(0.06);
        last = next;
      }
    }
  });

  it("looks the same at any eye's height, and thins steadily above it, so a view from high over the land sees it all", () => {
    for (const air of airs) {
      for (const height of [0, 1.6, 3, AIR.thinFrom]) expect(airFromHeight(air, height)).toEqual(air);
      let last = air;
      for (let h = AIR.thinFrom + 1; h <= 300; h += 1) {
        const next = airFromHeight(air, h);
        expect(next.density).toBeLessThan(last.density);
        expect(last.density - next.density).toBeLessThan(air.density * 0.03);
        expect(next.mist / Math.max(air.mist, 1e-9)).toBeCloseTo(air.mist === 0 ? 0 : next.density / air.density, 10);
        last = next;
      }
      expect(airFromHeight(air, 150).density).toBeLessThan(air.density / 3);
    }
  });
});
