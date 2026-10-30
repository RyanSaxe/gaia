// Far detail leaves out whole pieces and keeps every other vertex exactly where
// the full build put it, so nothing shifts or tears as a person walks. The
// primitives contract checks that every primitive builds whole pieces.

import { describe, expect, it } from "vitest";
import { type AnyPrimitive, type Built, type Field, type Part, rand } from "@gaia/schema";
import { PRIMITIVES } from "@gaia/primitives";
import { detailAt, resolveParams } from "@gaia/realize";

/** Each field's middle words: a scale's middle level, a choice's first option, no flag and no set members. */
function middle(p: AnyPrimitive): Record<string, string | boolean | string[]> {
  const out: Record<string, string | boolean | string[]> = {};
  for (const [name, f] of Object.entries(p.params) as [string, Field][]) {
    out[name] = f.type === "scale" ? (f.levels[Math.floor(f.levels.length / 2)]?.words ?? "") : f.type === "choice" ? (Object.keys(f.options)[0] ?? "") : f.type === "flag" ? false : [];
  }
  return out;
}

/** Parts whose pieces span many sizes, from a petal to a standing stone: every rock, drift and landmark. */
const parts: Part[] = PRIMITIVES.filter((p) => p.role === "Rock" || p.role === "Drift" || p.role === "Landmark").flatMap((p) => {
  const params = resolveParams(p, middle(p), rand(5), p.id);
  return ((p.build as (params: unknown, ctx: unknown, input: unknown) => Built)(params, { rand: rand(5).fork(p.id), facts: { scale: 1, age: 120 } }, null)).parts as Part[];
});

describe("detailAt", () => {
  it("leaves out more whole pieces with distance and keeps every other vertex bit-identical, in order", () => {
    let left = 0;
    for (const part of parts) {
      const n = part.shade.length;
      const id = (v: number): number => part.piece[v * 2] as number;
      let before = new Set<number>(Array.from({ length: n }, (_, v) => id(v)));
      for (const distance of [20, 50, 120, 300, 800]) {
        const far = detailAt(part, distance);
        const kept = new Set<number>();
        for (let v = 0; v < far.shade.length; v++) kept.add(far.piece[v * 2] as number);
        // Each step out leaves out more whole pieces and brings none back.
        expect([...kept].every((k) => before.has(k)), part.swatch).toBe(true);
        left += before.size - kept.size;
        before = kept;
        const from: number[] = [];
        for (let v = 0; v < n; v++) if (kept.has(id(v))) from.push(v);
        expect(far.shade.length, part.swatch).toBe(from.length);
        const same = (full: Float32Array, reduced: Float32Array): boolean => {
          const width = full.length / n;
          return from.every((v, k) => {
            for (let c = 0; c < width; c++) if (!Object.is(reduced[k * width + c], full[v * width + c])) return false;
            return true;
          });
        };
        const arrays: [string, Float32Array, Float32Array][] = [
          ["positions", part.positions, far.positions],
          ["normals", part.normals, far.normals],
          ["shade", part.shade, far.shade],
          ["tint", part.tint, far.tint],
          ["cutout", part.cutout, far.cutout],
          ["piece", part.piece, far.piece],
          ...Object.entries(far.channels).map(([name, reduced]) => [name, part.channels[name as keyof Part["channels"]] as Float32Array, reduced as Float32Array] as [string, Float32Array, Float32Array]),
        ];
        expect(arrays.filter(([, full, reduced]) => !same(full, reduced)).map(([name]) => name), part.swatch).toEqual([]);
        // The kept triangles are the full build's, in its order.
        const at = new Map(from.map((v, k) => [v, k]));
        const triangles: number[] = [];
        for (let t = 0; t < part.indices.length; t++) {
          const k = at.get(part.indices[t] as number);
          if (k !== undefined) triangles.push(k);
        }
        expect(Array.from(far.indices), part.swatch).toEqual(triangles);
      }
    }
    // Some pieces leave within these distances, so the rule is tested.
    expect(left).toBeGreaterThan(0);
  });
});
