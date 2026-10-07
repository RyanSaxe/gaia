import { describe, expect, it } from "vitest";
import { type ChoiceField, Library, type ScaleField, rand, resolveScale, seedOf } from "@gaia/schema";
import {
  BIOME_PRIMITIVES,
  DECLINE_MARGIN,
  PALETTE_FAMILIES,
  type PaletteFamily,
  RELIEF_PRIMITIVES,
  WORLD_PRIMITIVES,
  deltaE,
  paletteOf,
  palette as palettePrimitive,
  season as seasonPrimitive,
  seasonPalette,
  toLch,
} from "@gaia/primitives";
import { biome, world } from "@gaia/kinds";
import { assemble, blueprintCount, fieldSize, planDetails, planStructure, randomSlots, readStructure, validate } from "@gaia/world";
import { WORLD_PRESETS, realizeWorld } from "@gaia/realize";
import { blueprintOf as identify } from "@gaia/schema";
import { fakeJev } from "@gaia/world/testing";

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
  const look = (w: Parameters<typeof identify>[1], b: Parameters<typeof identify>[1]) =>
    realizeWorld({ blueprint: identify("world", w), kind: world }, { blueprint: identify("biome", b), kind: biome }, lib, SEED);

  it("realizes the same look for the same blueprints and seed", () => {
    for (const p of WORLD_PRESETS) {
      expect(look(p.world.slots, p.biome.slots)).toEqual(look(p.world.slots, p.biome.slots));
      expect(identify("world", p.world.slots).id).toBe(p.world.id);
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
      const w = identify("world", randomSlots(world, lib, random));
      const b = identify("biome", randomSlots(biome, lib, random));
      expect(validate(w, world, lib)).toEqual([]);
      expect(validate(b, biome, lib)).toEqual([]);
      const l = look(w.slots, b.slots);
      expect(finite(l)).toBe(true);
      for (const c of [l.sky.zenith, l.sky.horizon, l.fog.color, l.ground.low, l.ground.high, l.light.sunColor]) {
        for (const x of c) expect(x >= 0 && x <= 1).toBe(true);
      }
      ids.add(`${w.id}/${b.id}`);
    }
    expect(ids.size).toBeGreaterThan(995);
  });

  it("names six distinct, valid preset worlds", () => {
    expect(new Set(WORLD_PRESETS.map((p) => `${p.world.id}/${p.biome.id}`)).size).toBe(WORLD_PRESETS.length);
    for (const p of WORLD_PRESETS) {
      expect(validate(p.world, world, lib)).toEqual([]);
      expect(validate(p.biome, biome, lib)).toEqual([]);
    }
  });

  it("counts exactly the worlds and regions their declarations admit", () => {
    const size = (role: string): number =>
      lib.forRole(role as never).reduce((sum, p) => sum + Object.values(p.params).reduce((n, f) => n * fieldSize(f), 1), 0);
    expect(blueprintCount(world, lib)).toBe(size("Light") * size("Sky") * size("Season") * size("Wind"));
    // 162 light x 72 sky x 18 season x 4 wind.
    expect(blueprintCount(world, lib)).toBe(839_808);
    expect(blueprintCount(biome, lib)).toBe(size("Relief") * size("Ground") * (1 + size("Atmosphere")) * (1 + size("Accents")) * size("Natives"));
  });

  it("asks for light and season first, then sky and wind with those answers in the state", () => {
    const target = { id: "repo", state: { languages: ["TypeScript"], files: 412, ageDays: 900 } };
    const s = planStructure(world, lib, target);
    expect(Object.keys(s.request.questions)).toEqual([]);
    const structure = readStructure(world, lib, s, {});
    const first = planDetails(world, lib, structure, target, { stage: 0 });
    expect(Object.keys(first.request.questions).sort()).toEqual(["light.brush", "light.hour", "light.path", "light.warmth", "season.season", "season.strength"]);
    const firstAnswers = fakeJev(first.request);
    const second = planDetails(world, lib, structure, target, { stage: 1, earlier: { light: "dusk", season: "deep autumn" } });
    expect(Object.keys(second.request.questions).sort()).toEqual(["sky.character", "sky.clouds", "sky.cover", "wind.strength"]);
    expect((second.request.state as { earlier?: unknown }).earlier).toEqual({ light: "dusk", season: "deep autumn" });
    const bp = assemble(world, lib, structure, [first, second], { ...firstAnswers, ...fakeJev(second.request) });
    expect(validate(bp, world, lib)).toEqual([]);
  });
});

describe("season and decline", () => {
  const seasonField = seasonPrimitive.params.season as ChoiceField;
  const strengthField = seasonPrimitive.params.strength as ScaleField;
  const contrastField = palettePrimitive.params.contrast as ScaleField;
  type Erased = (p: unknown) => ReturnType<typeof seasonPrimitive.build>;

  /** Every season at the weakest and strongest number each strength level can resolve to. */
  const seasons = Object.keys(seasonField.options).flatMap((name) =>
    strengthField.levels.flatMap((level) =>
      [0, 0.999].map((unit) => ({
        name,
        spec: (seasonPrimitive.build as unknown as Erased)({ season: name, strength: resolveScale(strengthField, level.words, unit) }),
      })),
    ),
  );
  const palettes = (Object.keys(PALETTE_FAMILIES) as PaletteFamily[]).flatMap((family) =>
    contrastField.levels.flatMap((level) => [0, 0.999].map((unit) => ({ family, palette: paletteOf(family, resolveScale(contrastField, level.words, unit)) }))),
  );

  it("keeps every healthy color clear of decline by the stated margin, in every season", () => {
    let checked = 0;
    for (const { spec } of seasons) {
      for (const { palette } of palettes) {
        const seasoned = seasonPalette(palette, spec);
        for (const [name, swatch] of Object.entries(seasoned.swatches)) {
          const margin = DECLINE_MARGIN[name] ?? 0.09;
          expect(deltaE(swatch.healthy, swatch.decline)).toBeGreaterThanOrEqual(margin - 1e-9);
          checked++;
        }
      }
    }
    // 6 seasons x 3 strengths x 2 ends x 8 families x 3 contrasts x 2 ends x 3 swatches.
    expect(checked).toBe(5184);
  });

  it("never touches decline: every world declines toward the same colors", () => {
    for (const { spec } of seasons) {
      for (const { palette } of palettes) {
        const seasoned = seasonPalette(palette, spec);
        for (const [name, swatch] of Object.entries(palette.swatches)) {
          expect(seasoned.swatches[name]?.decline).toEqual(swatch.decline);
        }
      }
    }
  });

  it("visibly turns leaves, but never drags a family across the color wheel", () => {
    for (const name of Object.keys(seasonField.options)) {
      const spec = (seasonPrimitive.build as unknown as Erased)({ season: name, strength: 1 });
      const moved = (Object.keys(PALETTE_FAMILIES) as PaletteFamily[]).map((family) => {
        const base = paletteOf(family, 1).swatches.leaf;
        const turned = seasonPalette(paletteOf(family, 1), spec).swatches.leaf;
        if (base === undefined || turned === undefined) throw new Error(family);
        const hueTurn = Math.abs(((toLch(turned.healthy)[2] - toLch(base.healthy)[2] + 540) % 360) - 180);
        expect(hueTurn).toBeLessThan(80);
        return deltaE(base.healthy, turned.healthy);
      });
      expect(Math.max(...moved)).toBeGreaterThan(0.03);
    }
  });
});
