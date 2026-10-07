import { describe, expect, it } from "vitest";
import { type ChoiceField, Library, type ScaleField, rand, resolveScale, seedOf } from "@gaia/schema";
import {
  DECLINE_MARGIN,
  PALETTE_FAMILIES,
  type PaletteFamily,
  WORLD_PRIMITIVES,
  deltaE,
  paletteOf,
  palette as palettePrimitive,
  season as seasonPrimitive,
  seasonPalette,
  toLch,
} from "@gaia/primitives";
import { world } from "@gaia/kinds";
import { blueprintCount, fieldSize, planDetails, planStructure, randomSlots, readStructure, validate } from "@gaia/world";
import { WORLD_PRESETS, realizeWorld } from "@gaia/realize";
import { blueprintOf as identify } from "@gaia/schema";
import { fakeJev } from "@gaia/world/testing";

const lib = new Library(WORLD_PRIMITIVES);
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

describe("world kind", () => {
  it("realizes the same look for the same blueprint and seed", () => {
    for (const { blueprint } of WORLD_PRESETS) {
      expect(realizeWorld(blueprint, world, lib, SEED)).toEqual(realizeWorld(blueprint, world, lib, SEED));
      expect(identify("world", blueprint.slots).id).toBe(blueprint.id);
    }
    const draw = (): string[] => {
      const random = seeded(99);
      return Array.from({ length: 20 }, () => identify("world", randomSlots(world, lib, random)).id);
    };
    expect(draw()).toEqual(draw());
  });

  it("validates and realizes every uniformly sampled world", () => {
    const random = seeded(7);
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const bp = identify("world", randomSlots(world, lib, random));
      expect(validate(bp, world, lib)).toEqual([]);
      const look = realizeWorld(bp, world, lib, SEED);
      expect(finite(look)).toBe(true);
      for (const c of [look.sky.zenith, look.sky.horizon, look.fog.color, look.ground.low, look.ground.high, look.light.sunColor]) {
        for (const x of c) expect(x >= 0 && x <= 1).toBe(true);
      }
      ids.add(bp.id);
    }
    // A space of billions: a thousand draws should essentially never repeat.
    expect(ids.size).toBeGreaterThan(995);
  });

  it("names six distinct, valid preset worlds", () => {
    expect(new Set(WORLD_PRESETS.map((p) => p.blueprint.id)).size).toBe(WORLD_PRESETS.length);
    for (const { blueprint } of WORLD_PRESETS) expect(validate(blueprint, world, lib)).toEqual([]);
  });

  it("counts exactly the worlds its declarations admit", () => {
    const size = (role: string): number =>
      lib.forRole(role as never).reduce((sum, p) => sum + Object.values(p.params).reduce((n, f) => n * fieldSize(f), 1), 0);
    // Six required slots multiply; the optional drift slot adds an "absent" option.
    const expected = size("Light") * size("Sky") * size("Season") * size("Atmosphere") * size("Ground") * size("Wind") * (1 + size("Accents"));
    expect(blueprintCount(world, lib)).toBe(expected);
    // 162 light x 90 sky x 18 season x 15 air x 63 ground x 4 wind x (1 + 15) drift.
    expect(expected).toBe(15_872_371_200);
  });

  it("asks Jev only closed questions, and assembles a valid world from its answers", () => {
    const subject = { id: "repo", state: { languages: ["TypeScript"], files: 412, ageDays: 900 } };
    const s = planStructure(world, lib, subject);
    expect(Object.keys(s.request.questions)).toEqual(["drift.present"]);
    const structure = readStructure(world, lib, s, fakeJev(s.request, { "drift.present": true }));
    const d = planDetails(world, lib, structure, subject);
    const types = new Set(Object.values(d.request.questions).map((q) => q.type));
    expect([...types].every((t) => t === "choice" || t === "score" || t === "noul")).toBe(true);
    // Every param of every chosen primitive: 4 light, 3 sky, 2 season, 2 air, 3 ground, 2 drift, 1 wind.
    expect(Object.keys(d.request.questions).length).toBe(17);
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
