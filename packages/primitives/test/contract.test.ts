// Every primitive in the manifest must keep this contract. A new primitive is
// covered as soon as it is listed in PRIMITIVES; nobody writes these tests per primitive.

import { describe, expect, it } from "vitest";
import { type AnyPrimitive, type Built, type Field, Library, type Part, type Skeleton, rand } from "@gaia/schema";
import * as primitivesModule from "@gaia/primitives";
import { PRIMITIVES } from "@gaia/primitives";
import { applyVitality, resolveParams } from "@gaia/realize";

const lib = new Library(PRIMITIVES);
const facts = { scale: 1, age: 120 };
const GEOMETRY_ROLES = new Set(["Surface", "Foliage", "Ornament"]);
const TRIANGLE_BUDGET = 40_000;

type Stored = Record<string, string | boolean | string[]>;
type Erased = (params: unknown, ctx: { rand: ReturnType<typeof rand>; facts: Record<string, number> }, input: unknown) => unknown;

/** The lowest, middle and highest level of every scale, with every choice option cycled through. */
function samples(p: AnyPrimitive): Stored[] {
  return [0, 0.5, 1].map((at, i) => {
    const out: Stored = {};
    for (const [name, f] of Object.entries(p.params) as [string, Field][]) {
      if (f.type === "scale") out[name] = f.levels[Math.round(at * (f.levels.length - 1))]?.words ?? "";
      else if (f.type === "choice") {
        const keys = Object.keys(f.options);
        out[name] = keys[i % keys.length] ?? "";
      } else if (f.type === "flag") out[name] = i % 2 === 0;
      else out[name] = Object.keys(f.members).filter((_, k) => (k + i) % 2 === 0);
    }
    return out;
  });
}

function build(p: AnyPrimitive, stored: Stored, input: unknown, seed: number): unknown {
  const params = resolveParams(p, stored, rand(seed), p.id);
  return (p.build as Erased)(params, { rand: rand(seed).fork(p.id), facts }, input);
}

const skeletons: Skeleton[] = lib.forRole("Skeleton").flatMap((p) => samples(p).map((s) => build(p, s, null, 11) as Skeleton));
const anchors = skeletons.flatMap((s) => s.tips).slice(0, 64);
const inputFor = (p: AnyPrimitive): unknown[] => (p.role === "Ornament" ? [anchors] : p.role === "Skeleton" || p.role === "Motion" || p.role === "Palette" ? [null] : skeletons);

const allFinite = (a: Float32Array): boolean => a.every(Number.isFinite);
const inUnit = (a: Float32Array): boolean => a.every((x) => x >= 0 && x <= 1);

describe("manifest", () => {
  it("lists every exported primitive", () => {
    const exported = (Object.values(primitivesModule) as unknown[]).filter(
      (v): v is AnyPrimitive => typeof v === "object" && v !== null && "build" in v && "role" in v && "id" in v,
    );
    const listed = new Set(PRIMITIVES.map((p) => p.id));
    expect(exported.map((p) => p.id).filter((id) => !listed.has(id))).toEqual([]);
  });
});

describe.each(PRIMITIVES.map((p) => [p.id, p] as const))("%s", (_id, p) => {
  it("declares a versioned ID, a doc and an instruction for every field", () => {
    expect(p.id).toMatch(/^[a-z][a-z0-9-]*@\d+$/);
    expect(p.doc.trim().length).toBeGreaterThan(10);
    for (const f of Object.values(p.params) as Field[]) expect(f.ask.trim().length).toBeGreaterThan(5);
  });

  it("builds the same output from the same seed", () => {
    for (const s of samples(p)) {
      for (const input of inputFor(p).slice(0, 2)) {
        expect(JSON.stringify(build(p, s, input, 3), replacer)).toBe(JSON.stringify(build(p, s, input, 3), replacer));
      }
    }
  });

  if (!GEOMETRY_ROLES.has(p.role)) return;

  it("writes finite geometry with channels in range, within the triangle budget", () => {
    for (const s of samples(p)) {
      for (const input of inputFor(p)) {
        for (const part of (build(p, s, input, 5) as Built).parts as Part[]) {
          expect(allFinite(part.positions) && allFinite(part.normals) && allFinite(part.channels.pivot)).toBe(true);
          const c = part.channels;
          expect([c.loss, c.droop, c.wither, c.glow, part.shade].every(inUnit)).toBe(true);
          expect(part.tint.every((x) => x >= -0.1 && x <= 0.1)).toBe(true);
          expect(part.indices.length / 3).toBeLessThanOrEqual(TRIANGLE_BUDGET);
        }
      }
    }
  });

  it("responds to vitality", () => {
    const built = build(p, (samples(p)[1] as Stored), inputFor(p)[0], 5) as Built;
    const changed = built.parts.some((part) => {
      const healthy = applyVitality(part, 1);
      const failing = applyVitality(part, 0);
      return healthy.positions.some((x, i) => x !== failing.positions[i]) || healthy.colors.some((x, i) => x !== failing.colors[i]);
    });
    expect(changed).toBe(true);
  });
});

function replacer(_key: string, value: unknown): unknown {
  return ArrayBuffer.isView(value) ? Array.from(value as Float32Array) : value;
}
