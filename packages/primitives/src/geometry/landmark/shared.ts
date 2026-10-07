// Small tools every landmark shares: a piece that only withers, smooth
// normals for lumpy stones, and fallen rubble that grows in at the foot of
// what breaks.

import type { Part, Rand, Vec3 } from "@gaia/schema";
import { type Channels, type PartBuilder, type V3, cross, icosphere, normalize, sub } from "../kit.ts";

/** A piece that only withers as vitality falls, unless `extra` says more. */
export const still = (pivot: Vec3, wither: number, extra: Partial<Channels> = {}): Channels => ({ loss: 0, droop: 0, wither, glow: 0, pivot, ...extra });

export const nonEmpty = (parts: Part[]): Part[] => parts.filter((p) => p.indices.length > 0);

/** Per-vertex normals averaged over the faces each vertex touches. */
export function smoothNormals(points: readonly V3[], triangles: readonly (readonly [number, number, number])[]): V3[] {
  const acc: V3[] = points.map(() => [0, 0, 0]);
  for (const [a, b, c] of triangles) {
    const pa = points[a] as V3;
    const f = cross(sub(points[b] as V3, pa), sub(points[c] as V3, pa));
    for (const i of [a, b, c]) {
      const v = acc[i] as V3;
      v[0] += f[0];
      v[1] += f[1];
      v[2] += f[2];
    }
  }
  return acc.map((v) => normalize(v));
}

/**
 * A rough stone lying on the ground: a squashed, jittered icosphere, sunk a
 * little and turned by `yaw`. With `grow` set it grows in below that
 * vitality, so what broke above lies at the foot only once it has fallen.
 */
export function lump(b: PartBuilder, c: Vec3, radii: Vec3, yaw: number, shade: number, ch: Channels, r: Rand): void {
  const blob = icosphere(0);
  const base = b.vertexCount;
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  blob.points.forEach((q) => {
    const j = 0.8 + 0.32 * r.next();
    const x = q[0] * radii[0] * j;
    const z = q[2] * radii[2] * j;
    const y = Math.max(q[1] * radii[1] * j, -radii[1] * 0.4);
    b.vertex([c[0] + x * cs - z * sn, c[1] + y, c[2] + x * sn + z * cs], [q[0] * cs - q[2] * sn, q[1], q[0] * sn + q[2] * cs], shade + 0.15 * q[1], ch);
  });
  for (const [a, bb, cc] of blob.triangles) b.triangle(base + a, base + bb, base + cc);
}
