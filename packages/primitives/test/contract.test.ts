// The contract every primitive in `PRIMITIVES` must keep. A new primitive is
// covered once it is listed there, with no tests written per primitive.

import { describe, expect, it } from "vitest";
import { type AnyPrimitive, type Built, type BuildingPlan, CUT, type Field, GRAIN, Library, type Part, type Skeleton, rand } from "@gaia/schema";
import * as primitivesModule from "@gaia/primitives";
import { LANDMARK_SHAPES, PRIMITIVES, bandOf, landmarkShape } from "@gaia/primitives";
import { applyVitality, detailAt, resolveParams } from "@gaia/realize";

const lib = new Library(PRIMITIVES);
const facts = { scale: 1, age: 120 };
const GEOMETRY_ROLES = new Set(["Surface", "Foliage", "Ornament", "Walls", "Roof", "Openings", "Dressing", "Feature", "Rock", "Overgrowth", "Drift", "Landmark"]);
/** Roles that build against a building's plan. */
const PLAN_ROLES = new Set(["Walls", "Roof", "Openings", "Dressing", "Feature"]);
/** Roles that build from nothing. */
const SOURCE_ROLES = new Set(["Skeleton", "Motion", "Palette", "Footprint", "Rock", "Drift", "Route", "Landmark"]);
const TRIANGLE_BUDGET = 40_000;

type Stored = Record<string, string | boolean | string[]>;
type Erased = (params: unknown, ctx: { rand: ReturnType<typeof rand>; facts: Record<string, number> }, input: unknown) => unknown;

/**
 * The lowest, middle and highest level of every scale, with every choice
 * option cycled through: a primitive with a choice of more than three
 * options gets one more sample for each, so every option is built.
 */
function samples(p: AnyPrimitive): Stored[] {
  const options = Math.max(3, ...(Object.values(p.params) as Field[]).map((f) => (f.type === "choice" ? Object.keys(f.options).length : 0)));
  return Array.from({ length: options }, (_, i) => [0, 0.5, 1][i % 3] as number).map((at, i) => {
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
/** Whether every vertex's position across its card is within -1 to 1 and its cut is one of `CUT`. */
const cutsKnown = (part: Part): boolean =>
  part.cutout.length === part.shade.length * 3 &&
  part.cutout.every((x, i) => Number.isFinite(x) && (i % 3 !== 0 || Math.abs(x) <= 1) && (i % 3 !== 2 || CUTS.has(Math.floor(x))));

/** Swatches the renderer draws front faces only (CLOSED in @gaia/render), so a triangle wound inward shows the far wall's inside. */
const CLOSED = new Set(["bark", "stone", "wood"]);
/** How many of a part's triangles are wound counter-clockwise seen from the side its vertex normals point to. */
function outwardTriangles(part: Part): number {
  const p = part.positions;
  const n = part.normals;
  let out = 0;
  for (let t = 0; t < part.indices.length; t += 3) {
    const [a, b, c] = [part.indices[t] as number, part.indices[t + 1] as number, part.indices[t + 2] as number];
    const e = [0, 1, 2].map((k) => (p[b * 3 + k] as number) - (p[a * 3 + k] as number));
    const f = [0, 1, 2].map((k) => (p[c * 3 + k] as number) - (p[a * 3 + k] as number));
    const face = [(e[1] as number) * (f[2] as number) - (e[2] as number) * (f[1] as number), (e[2] as number) * (f[0] as number) - (e[0] as number) * (f[2] as number), (e[0] as number) * (f[1] as number) - (e[1] as number) * (f[0] as number)];
    const facing = [0, 1, 2].reduce((sum, k) => sum + (face[k] as number) * ((n[a * 3 + k] as number) + (n[b * 3 + k] as number) + (n[c * 3 + k] as number)), 0);
    if (facing > 0) out++;
  }
  return out;
}

describe("manifest", () => {
  it("lists every exported primitive", () => {
    const exported = (Object.values(primitivesModule) as unknown[]).filter(
      (v): v is AnyPrimitive => typeof v === "object" && v !== null && "build" in v && "role" in v && "id" in v,
    );
    const listed = new Set(PRIMITIVES.map((p) => p.id));
    expect(exported.map((p) => p.id).filter((id) => !listed.has(id))).toEqual([]);
  });
});

// Each test builds every sample of a primitive, up to a second alone and several seconds on a busy machine.
// Needles on a bush build a juniper of 280 tufts per sample, about 12 s alone and over 20 s on a busy CI runner.
const SLOW: Readonly<Record<string, number>> = { "needles@1": 60_000 };

describe.each(PRIMITIVES.map((p) => [p.id, p] as const))("%s", { timeout: 20_000 }, (_id, p) => {
  const timeout = SLOW[p.id] ?? 20_000;
  it("builds the same output from the same seed", { timeout }, () => {
    for (const s of samples(p)) {
      for (const input of inputFor(p).slice(0, 2)) {
        expect(JSON.stringify(build(p, s, input, 3), replacer)).toBe(JSON.stringify(build(p, s, input, 3), replacer));
      }
    }
  });

  if (!GEOMETRY_ROLES.has(p.role)) return;

  it("writes finite geometry with channels in range, within the triangle budget", { timeout }, () => {
    for (const s of samples(p)) {
      for (const input of inputFor(p)) {
        for (const part of (build(p, s, input, 5) as Built).parts as Part[]) {
          expect(allFinite(part.positions) && allFinite(part.normals) && allFinite(part.channels.pivot) && allFinite(part.channels.bough) && allFinite(part.channels.twig)).toBe(true);
          expect(part.channels.bough.length === part.shade.length * 3 && part.channels.twig.length === part.shade.length * 3).toBe(true);
          const c = part.channels;
          expect([c.loss, c.droop, c.wither, c.glow, c.close, part.shade].every(inUnit)).toBe(true);
          expect(c.close.length).toBe(part.shade.length);
          // Optional channels, when present, cover every vertex and stay in range.
          expect([c.grow, c.rot].every((a) => a === undefined || (a.length === part.shade.length && inUnit(a)))).toBe(true);
          expect(c.fall === undefined || (c.fall.length === part.shade.length * 4 && allFinite(c.fall) && c.fall.every((x, i) => i % 4 !== 3 || (x >= 0 && x <= 1)))).toBe(true);
          expect(c.spin === undefined || (c.spin.length === part.shade.length * 3 && allFinite(c.spin))).toBe(true);
          // A grain's kind is one of `GRAIN`, which the shader can rot.
          expect(c.grain === undefined || (c.grain.length === part.shade.length * 3 && allFinite(c.grain) && c.grain.every((x, i) => i % 3 !== 2 || Object.values(GRAIN).includes(x as never)))).toBe(true);
          expect(part.tint.every((x) => x >= -0.1 && x <= 0.1)).toBe(true);
          expect(cutsKnown(part)).toBe(true);
          expect(part.indices.length / 3).toBeLessThanOrEqual(TRIANGLE_BUDGET);
        }
      }
    }
  });

  it("winds bark, stone and wood with their front faces outward", { timeout }, () => {
    for (const s of samples(p)) {
      for (const input of inputFor(p).slice(0, 2)) {
        for (const part of (build(p, s, input, 5) as Built).parts as Part[]) {
          if (!CLOSED.has(part.swatch)) continue;
          const tris = part.indices.length / 3;
          expect(outwardTriangles(part) / Math.max(1, tris)).toBeGreaterThan(0.9);
        }
      }
    }
  });

  it("builds whole pieces, and far detail leaves out whole pieces and keeps the rest bit-identical", { timeout }, () => {
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
                same(c.glow, fc.glow, 1) && same(c.pivot, fc.pivot, 3) && same(c.bough, fc.bough, 3) && same(c.twig, fc.twig, 3) && same(c.close, fc.close, 1),
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

  it("responds to vitality in every part, on everything it is built on", { timeout }, () => {
    const unchanged: string[] = [];
    inputFor(p).forEach((input, k) => {
      const built = build(p, samples(p)[1] as Stored, input, 5) as Built;
      expect(built.parts.length, `input ${k}`).toBeGreaterThan(0);
      for (const part of built.parts as Part[]) {
        const healthy = applyVitality(part, 1);
        const failing = applyVitality(part, 0);
        const moved = healthy.positions.some((x, i) => x !== failing.positions[i]);
        if (!moved && !healthy.colors.some((x, i) => x !== failing.colors[i])) unchanged.push(`${part.swatch} on input ${k}`);
      }
    });
    expect(unchanged).toEqual([]);
  });
});

/** Every combination of a primitive's choices, flags and sets, its scales at their middle level. */
function combinations(p: AnyPrimitive): Stored[] {
  let out: Stored[] = [{}];
  for (const [name, f] of Object.entries(p.params) as [string, Field][]) {
    const values: Stored[string][] =
      f.type === "scale" ? [f.levels[Math.floor(f.levels.length / 2)]?.words ?? ""]
      : f.type === "choice" ? Object.keys(f.options)
      : f.type === "flag" ? [false, true]
      : Object.keys(f.members).reduce<string[][]>((subsets, m) => [...subsets, ...subsets.map((s) => [...s, m])], [[]]);
    out = out.flatMap((s) => values.map((v) => ({ ...s, [name]: v })));
  }
  return out;
}

/** True when a point lies within a mass's footprint. A round mass's octagon reaches past its inscribed circle at the corners. */
const inFootprint = (m: BuildingPlan["masses"][number], x: number, z: number): boolean =>
  m.round ? Math.hypot(x - m.x, z - m.z) < m.width / 2 / Math.cos(Math.PI / 8) : Math.abs(x - m.x) < m.width / 2 && Math.abs(z - m.z) < m.depth / 2;

/** Dressings that can fence a garden round a building. */
const gardens = lib.forRole("Dressing").filter((p) => "extras" in p.params);

describe.each(lib.forRole("Footprint").map((p) => [p.id, p] as const))("%s", { timeout: 20_000 }, (_id, p) => {
  // A building is solid, so this is about reaching its door, not walking in.
  it("leaves every door reachable from outside: no other wing stands in front of it, and a garden's fence leaves its walk open", () => {
    for (const stored of combinations(p)) {
      for (const seed of [1, 2]) {
        const plan = build(p, stored, null, seed) as BuildingPlan;
        const door = plan.openings.find((o) => o.kind === "door");
        const m = door === undefined ? undefined : plan.masses[door.mass];
        if (door === undefined || m === undefined) throw new Error(`${JSON.stringify(stored)}: no door`);
        const [nx, , nz] = door.normal;
        const [ux, uz] = [nz, -nx];
        const half = (ax: number, az: number): number => Math.abs(ax) * (m.width / 2) + Math.abs(az) * ((m.round ? m.width : m.depth) / 2);
        const [dx, dz] = [door.position[0] - m.x, door.position[2] - m.z];
        // In its wall's face, and the whole door between the wall's ends.
        expect(Math.abs(dx * nx + dz * nz - half(nx, nz)), JSON.stringify(stored)).toBeLessThan(0.01);
        expect(Math.abs(dx * ux + dz * uz) + door.width / 2, JSON.stringify(stored)).toBeLessThanOrEqual(half(ux, uz));
        // Nothing of another mass stands just outside it.
        for (const along of [-door.width / 2, 0, door.width / 2]) {
          const [x, z] = [door.position[0] + ux * along + nx * 0.06, door.position[2] + uz * along + nz * 0.06];
          expect(plan.masses.some((o, i) => i !== door.mass && inFootprint(o, x, z)), JSON.stringify(stored)).toBe(false);
        }
        // A walk half a meter wide leads straight out from the door, and no triangle of a garden's fence in front of the door reaches into it.
        for (const garden of gardens) {
          const fence = (build(garden, { extras: ["fence"], walk: "stepping stones" }, plan, seed) as Built).parts.find((part) => part.swatch === "wall");
          if (fence === undefined) throw new Error(`${garden.id} ${JSON.stringify(stored)}: no fence`);
          let across = 0;
          for (let t = 0; t < fence.indices.length; t += 3) {
            const vs = [0, 1, 2].map((k) => fence.indices[t + k] as number);
            const out = vs.map((v) => ((fence.positions[v * 3] as number) - door.position[0]) * nx + ((fence.positions[v * 3 + 2] as number) - door.position[2]) * nz);
            const side = vs.map((v) => ((fence.positions[v * 3] as number) - door.position[0]) * ux + ((fence.positions[v * 3 + 2] as number) - door.position[2]) * uz);
            if (Math.min(...out) > 0 && Math.min(...side) < 0.25 && Math.max(...side) > -0.25) across++;
          }
          expect(across, `${garden.id} ${JSON.stringify(stored)}`).toBe(0);
        }
      }
    }
  });
});

describe.each(lib.forRole("Walls").map((p) => [p.id, p] as const))("%s", { timeout: 20_000 }, (_id, p) => {
  it("lays a floor just under the door's sill across every block, so none of the ground under the house shows", () => {
    for (const plan of plans) {
      const parts = (build(p, samples(p)[0] as Stored, plan, 5) as Built).parts;
      for (const m of plan.masses.filter((mass) => !mass.round)) {
        // An upward face at the floor over the block's middle and its corners, 0.2 m in from its walls.
        const covered = (x: number, z: number): boolean =>
          parts.some((part) => {
            for (let t = 0; t < part.indices.length; t += 3) {
              const [a, b, c] = [part.indices[t] as number, part.indices[t + 1] as number, part.indices[t + 2] as number];
              if ((part.normals[a * 3 + 1] as number) < 0.99) continue;
              const y = part.positions[a * 3 + 1] as number;
              if (y < plan.floor - 0.06 || y > plan.floor) continue;
              const [ax, az, bx, bz, cx, cz] = [a, b, c].flatMap((v) => [part.positions[v * 3] as number, part.positions[v * 3 + 2] as number]) as [number, number, number, number, number, number];
              const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
              const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
              const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
              if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
            }
            return false;
          });
        for (const [sx, sz] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
          expect(covered(m.x + sx * (m.width / 2 - 0.2), m.z + sz * (m.depth / 2 - 0.2))).toBe(true);
        }
      }
    }
  });
});

// Every primitive resolves its scales with one formula, so one test covers them all.
describe("scales", () => {
  it("resolves each scale's words within their own band, short of a neighbour's", () => {
    for (const p of PRIMITIVES) {
      for (const [name, f] of Object.entries(p.params) as [string, Field][]) {
        if (f.type !== "scale") continue;
        f.levels.forEach((level, k) => {
          const below = (level.value + (f.levels[k - 1]?.value ?? level.value)) / 2;
          const above = (level.value + (f.levels[k + 1]?.value ?? level.value)) / 2;
          for (let seed = 1; seed <= 32; seed++) {
            const value = resolveParams(p, { ...(samples(p)[0] as Stored), [name]: level.words }, rand(seed), p.id)[name] as number;
            expect(value >= Math.min(below, above) && value <= Math.max(below, above), `${p.id} ${name}: ${level.words}`).toBe(true);
          }
        });
      }
    }
  });
});

/**
 * A landmark's proportions at full vitality: its width across x and across z, and how far it reaches at
 * the ground, each over its height. Fallen stone that grows in is left out.
 */
function proportions(built: Built): number[] {
  let [x0, x1, z0, z1, top, ground] = [Infinity, -Infinity, Infinity, -Infinity, 0, 0];
  for (const part of built.parts) {
    for (let v = 0; v < part.shade.length; v++) {
      if ((part.channels.grow?.[v] ?? 0) > 0) continue;
      const [x, y, z] = [part.positions[v * 3] as number, part.positions[v * 3 + 1] as number, part.positions[v * 3 + 2] as number];
      [x0, x1, z0, z1, top] = [Math.min(x0, x), Math.max(x1, x), Math.min(z0, z), Math.max(z1, z), Math.max(top, y)];
      if (y < 1) ground = Math.max(ground, Math.hypot(x, z));
    }
  }
  return [(x1 - x0) / top, (z1 - z0) / top, ground / top];
}

describe.each(lib.forRole("Landmark").map((p) => [p.id, p] as const))("%s", (_id, p) => {
  // Builds every sample from four seeds, a few seconds alone and more on a busy machine.
  it("stands in proportions of its own from each seed, given the same answers", { timeout: 60_000 }, () => {
    for (const s of samples(p)) {
      // The same answers, their scales resolved alike. Only the build's own seed differs.
      const params = resolveParams(p, s, rand(1), p.id);
      const seen = [1, 2, 3, 4].map((seed) => proportions((p.build as Erased)(params, { rand: rand(seed).fork(p.id), facts }, null) as Built));
      const spread = (k: number): number => {
        const xs = seen.map((one) => one[k] as number);
        return (Math.max(...xs) - Math.min(...xs)) / (xs.reduce((a, x) => a + x, 0) / xs.length);
      };
      expect(Math.max(spread(0), spread(1), spread(2)), JSON.stringify(s)).toBeGreaterThan(0.03);
    }
  });

  const bands = LANDMARK_SHAPES[p.id];
  if (bands === undefined) return;

  it("picks each measure of its shape within the band its words allow, and no two words' bands meet", () => {
    for (const [name, measure] of Object.entries(bands)) {
      if (!("by" in measure)) continue;
      // A measure set by a field has a band, or null, for every option of that field.
      const field = p.params[measure.by] as Field | undefined;
      expect(field?.type, name).toBe("choice");
      if (field?.type === "choice") expect(Object.keys(measure.bands).sort(), name).toEqual(Object.keys(field.options).sort());
      const set = Object.values(measure.bands).filter((b) => b !== null).sort((a, b) => a[0] - b[0]);
      for (let k = 1; k < set.length; k++) expect((set[k - 1] as readonly [number, number])[1], name).toBeLessThan((set[k] as readonly [number, number])[0]);
    }
    for (const stored of combinations(p)) {
      for (let seed = 1; seed <= 16; seed++) {
        const params = resolveParams(p, stored, rand(seed), p.id);
        const shape = landmarkShape(bands, params, { rand: rand(seed).fork(p.id), facts });
        for (const [name, measure] of Object.entries(bands)) {
          const band = bandOf(measure, params);
          const value = shape[name] as number;
          expect(band === null ? value === 0 : value >= band[0] && value <= band[1], `${name} ${JSON.stringify(stored)}`).toBe(true);
        }
      }
    }
  });
});

function replacer(_key: string, value: unknown): unknown {
  return ArrayBuffer.isView(value) ? Array.from(value as Float32Array) : value;
}
