import { describe, expect, it } from "vitest";
import { Library, rand, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES, WORLD_PRIMITIVES } from "@gaia/primitives";
import { biome, world } from "@gaia/kinds";
import { validate } from "@gaia/world";
import { realizeWorld } from "@gaia/realize";
import { blueprintOf as identify } from "@gaia/schema";
import { randomSlots } from "@gaia/world/testing";

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
});
