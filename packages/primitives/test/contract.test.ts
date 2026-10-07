// Every primitive in the manifest must keep this contract. A new primitive is
// covered as soon as it is listed in PRIMITIVES; nobody writes these tests per primitive.

import { describe, expect, it } from "vitest";
import { type AnyPrimitive, type Built, type BuildingPlan, CUT, type Field, Library, type Part, type Skeleton, rand } from "@gaia/schema";
import * as primitivesModule from "@gaia/primitives";
import { PRIMITIVES } from "@gaia/primitives";
import { applyVitality, detailAt, resolveParams } from "@gaia/realize";

const lib = new Library(PRIMITIVES);
const facts = { scale: 1, age: 120 };
const GEOMETRY_ROLES = new Set(["Surface", "Foliage", "Ornament", "Walls", "Roof", "Openings", "Dressing", "Rock", "Overgrowth", "Drift"]);
/** Roles that build against a building's plan. */
const PLAN_ROLES = new Set(["Walls", "Roof", "Openings", "Dressing"]);
/** Roles that build from nothing. */
const SOURCE_ROLES = new Set(["Skeleton", "Motion", "Palette", "Footprint", "Rock", "Drift"]);
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
const plans: BuildingPlan[] = lib.forRole("Footprint").flatMap((p) => samples(p).map((s) => build(p, s, null, 13) as BuildingPlan));
/** What overgrowth grows on: every rock body at its lowest, middle and highest levels. */
const rocks: Built[] = lib.forRole("Rock").flatMap((p) => samples(p).map((s) => build(p, s, null, 13) as Built));
const inputFor = (p: AnyPrimitive): unknown[] =>
  p.role === "Ornament" ? [anchors]
  : p.role === "Overgrowth" ? rocks
  : PLAN_ROLES.has(p.role) ? plans
  : SOURCE_ROLES.has(p.role) ? [null]
  : skeletons;

const allFinite = (a: Float32Array): boolean => a.every(Number.isFinite);
const inUnit = (a: Float32Array): boolean => a.every((x) => x >= 0 && x <= 1);
const CUTS = new Set<number>(Object.values(CUT));
/** Every vertex sits across its card within -1 to 1 and names a cut the renderer knows. */
const cutsKnown = (part: Part): boolean =>
  part.cutout.length === part.shade.length * 3 &&
  part.cutout.every((x, i) => Number.isFinite(x) && (i % 3 !== 0 || Math.abs(x) <= 1) && (i % 3 !== 2 || CUTS.has(Math.floor(x))));

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
          expect([c.loss, c.droop, c.wither, c.glow, c.close, part.shade].every(inUnit)).toBe(true);
          expect(c.close.length).toBe(part.shade.length);
          expect(part.tint.every((x) => x >= -0.1 && x <= 0.1)).toBe(true);
          expect(cutsKnown(part)).toBe(true);
          expect(part.indices.length / 3).toBeLessThanOrEqual(TRIANGLE_BUDGET);
        }
      }
    }
  });

  it("builds whole pieces, and far detail leaves out whole pieces and keeps the rest bit-identical", () => {
    for (const s of samples(p)) {
      for (const input of inputFor(p).slice(0, 2)) {
        for (const part of (build(p, s, input, 5) as Built).parts as Part[]) {
          const n = part.shade.length;
          const id = (v: number): number => part.piece[v * 2] as number;
          expect(part.piece.length).toBe(n * 2);
          // A triangle never spans two pieces, and pieces are numbered in order of their first vertex.
          for (let t = 0; t < part.indices.length; t += 3) {
            const a = id(part.indices[t] as number);
            expect(id(part.indices[t + 1] as number) === a && id(part.indices[t + 2] as number) === a).toBe(true);
          }
          let top = -1;
          for (let v = 0; v < n; v++) {
            expect(id(v) <= top + 1).toBe(true);
            top = Math.max(top, id(v));
          }
          let before = new Set<number>(Array.from({ length: top + 1 }, (_, k) => k));
          for (const distance of [20, 50, 120, 300, 800]) {
            const far = detailAt(part, distance);
            const kept = new Set<number>();
            for (let v = 0; v < far.shade.length; v++) kept.add(far.piece[v * 2] as number);
            // Each step out leaves out more whole pieces and brings none back.
            expect([...kept].every((k) => before.has(k))).toBe(true);
            before = kept;
            const from: number[] = [];
            for (let v = 0; v < n; v++) if (kept.has(id(v))) from.push(v);
            expect(far.shade.length).toBe(from.length);
            const same = (full: Float32Array, reduced: Float32Array, width: number): boolean =>
              from.every((v, k) => {
                for (let c = 0; c < width; c++) if (!Object.is(reduced[k * width + c], full[v * width + c])) return false;
                return true;
              });
            const c = part.channels;
            const fc = far.channels;
            expect(
              same(part.positions, far.positions, 3) && same(part.normals, far.normals, 3) && same(part.shade, far.shade, 1) &&
                same(part.tint, far.tint, 1) && same(part.cutout, far.cutout, 3) && same(part.piece, far.piece, 2) &&
                same(c.loss, fc.loss, 1) && same(c.droop, fc.droop, 1) && same(c.wither, fc.wither, 1) &&
                same(c.glow, fc.glow, 1) && same(c.pivot, fc.pivot, 3) && same(c.close, fc.close, 1),
            ).toBe(true);
            // The kept triangles are the full build's, in its order.
            const at = new Map(from.map((v, k) => [v, k]));
            const triangles: number[] = [];
            for (let t = 0; t < part.indices.length; t++) {
              const k = at.get(part.indices[t] as number);
              if (k !== undefined) triangles.push(k);
            }
            expect(Array.from(far.indices)).toEqual(triangles);
          }
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
