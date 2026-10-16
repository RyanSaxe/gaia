// A lookout tower's walls are closed behind their mortar joints: looking
// level at a joint between two courses, from straight on or across the
// wall's curve, a person sees mortar, never the sky through the wall.

import { describe, expect, it } from "vitest";
import { type Built, type Part, rand } from "@gaia/schema";
import { lookoutTower } from "@gaia/primitives";
import { resolveParams } from "@gaia/realize";

type Erased = (params: unknown, ctx: { rand: ReturnType<typeof rand>; facts: Record<string, number> }, input: unknown) => unknown;

/** Whether the segment from `a` to `b` crosses any triangle of `part` (Möller and Trumbore). */
function hits(part: Part, a: readonly number[], b: readonly number[]): boolean {
  const p = part.positions;
  const d = [0, 1, 2].map((k) => (b[k] as number) - (a[k] as number));
  for (let t = 0; t < part.indices.length; t += 3) {
    const [i, j, k] = [part.indices[t] as number, part.indices[t + 1] as number, part.indices[t + 2] as number];
    const v0 = [p[i * 3] as number, p[i * 3 + 1] as number, p[i * 3 + 2] as number];
    const e1 = [0, 1, 2].map((c) => (p[j * 3 + c] as number) - (v0[c] as number));
    const e2 = [0, 1, 2].map((c) => (p[k * 3 + c] as number) - (v0[c] as number));
    const h = [d[1]! * e2[2]! - d[2]! * e2[1]!, d[2]! * e2[0]! - d[0]! * e2[2]!, d[0]! * e2[1]! - d[1]! * e2[0]!];
    const det = e1[0]! * h[0]! + e1[1]! * h[1]! + e1[2]! * h[2]!;
    if (Math.abs(det) < 1e-12) continue;
    const s = [0, 1, 2].map((c) => (a[c] as number) - (v0[c] as number));
    const u = (s[0]! * h[0]! + s[1]! * h[1]! + s[2]! * h[2]!) / det;
    if (u < 0 || u > 1) continue;
    const q = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!];
    const v = (d[0]! * q[0]! + d[1]! * q[1]! + d[2]! * q[2]!) / det;
    if (v < 0 || u + v > 1) continue;
    const along = (e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) / det;
    if (along >= 0 && along <= 1) return true;
  }
  return false;
}

describe("a lookout tower", () => {
  // Casts some 4,500 rays at three towers: several seconds alone, more when other work shares the machine.
  it.each(["round", "square", "octagonal"] as const)("is closed behind every joint between its courses, %s", { timeout: 60_000 }, (plan) => {
    const stored = { height: "a squat watchtower", plan, profile: "straight", galleries: "none", crown: "a conical roof", masonry: "dressed blocks" };
    const built = (lookoutTower.build as Erased)(resolveParams(lookoutTower, stored, rand(5), lookoutTower.id), { rand: rand(5).fork("tower"), facts: { scale: 1 } }, null) as Built;
    const stone = built.parts.find((p) => p.swatch === "masonry") as Part;
    // The wall and what is set in it, such as the door and its lintel; glass is seen through.
    const solid = built.parts.filter((p) => p.swatch !== "glass");
    // Each course's top, where a joint opens above it: the heights most of the blocks' upward faces lie at, below 8 m.
    const count = new Map<number, number>();
    for (let v = 0; v < stone.shade.length; v++) {
      const y = Math.round((stone.positions[v * 3 + 1] as number) * 1000) / 1000;
      if ((stone.normals[v * 3 + 1] as number) > 0.99 && y > 0.2 && y < 8) count.set(y, (count.get(y) ?? 0) + 1);
    }
    const tops = [...count].filter(([, n]) => n >= 40).map(([y]) => y);
    expect(tops.length).toBeGreaterThan(8);
    let through = 0;
    let looked = 0;
    // Level rays from outside across the tower, through each joint and the courses either side of it: toward the
    // axis, and passing it at half and 85% of the wall's radius, across the wall's curve.
    for (const y of tops) {
      // The wall's radius there: the middle of the radii of the course's own block tops.
      const radii: number[] = [];
      for (let v = 0; v < stone.shade.length; v++) {
        if (Math.abs((stone.positions[v * 3 + 1] as number) - y) < 1e-3 && (stone.normals[v * 3 + 1] as number) > 0.99) radii.push(Math.hypot(stone.positions[v * 3] as number, stone.positions[v * 3 + 2] as number));
      }
      const reach = radii.sort((p, q) => p - q)[Math.floor(radii.length / 2)] as number;
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2 + 0.03;
        for (const off of [0, 0.5, 0.85]) {
          const [sx, sz] = [-Math.sin(a) * off * reach, Math.cos(a) * off * reach];
          const ray = (h: number): boolean => solid.some((part) => hits(part, [Math.cos(a) * 3 * reach + sx, h, Math.sin(a) * 3 * reach + sz], [-Math.cos(a) * 3 * reach + sx, h, -Math.sin(a) * 3 * reach + sz]));
          // Where the courses either side are wall, not a window or the door, the joint between them is closed too.
          if (!ray(y - 0.25) || !ray(y + 0.25)) continue;
          looked++;
          if (!ray(y + 0.0175)) through++;
        }
      }
    }
    expect(looked).toBeGreaterThan(200);
    expect(through).toBe(0);
  });
});
