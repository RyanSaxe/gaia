// Helpers every landmark uses: seeded proportions within the bands of its
// answers, channels for a piece that only withers, smooth normals for lumpy
// stones, and rubble that grows in at the foot of what breaks.

import type { BuildContext, Part, Rand, Vec3 } from "@gaia/schema";
import { type Channels, type PartBuilder, type V3, cross, icosphere, normalize, sub } from "../kit.ts";

/** The minimum and maximum of one landmark measure. */
export type Band = readonly [number, number];

/**
 * A measure set by the answer to one field (`by`). Each answer has its own band, or `null` when the measure does not
 * apply, such as a dome's rise over an open ring. No two bands overlap, so a build never looks like one with a
 * different answer.
 */
export interface ByWord {
  readonly by: string;
  readonly bands: Readonly<Record<string, Band | null>>;
}

/** A landmark's measures. Each has one fixed band, or a band for each answer to one field. */
export type Bands = Readonly<Record<string, Band | ByWord>>;

/** A build's measures, each picked inside its band. A measure that does not apply to the answer is 0. */
export type Shape<B extends Bands> = { readonly [M in keyof B]: number };

/** A band `share` either side of `mid`, for a measure that no answer sets. */
export const about = (mid: number, share: number): Band => [mid * (1 - share), mid * (1 + share)];

/** The band of `measure` for these answers, or null when the measure does not apply. */
export function bandOf(measure: Band | ByWord, answers: Readonly<Record<string, unknown>>): Band | null {
  if (!("by" in measure)) return measure;
  const word = String(answers[measure.by]);
  const band = measure.bands[word];
  if (band === undefined) throw new Error(`No band for ${measure.by} "${word}".`);
  return band;
}

/**
 * Picks each measure from the build's seed, inside the band its answers allow. Each measure draws from its own forked
 * stream. Two landmarks with the same answers differ, each is the same on every run, and adding a measure never
 * shifts another.
 */
export function landmarkShape<B extends Bands>(bands: B, answers: Readonly<Record<string, unknown>>, ctx: BuildContext): Shape<B> {
  const r = ctx.rand.fork("shape");
  const out: Record<string, number> = {};
  for (const [name, measure] of Object.entries(bands)) {
    const band = bandOf(measure, answers);
    out[name] = band === null ? 0 : band[0] + (band[1] - band[0]) * r.fork(name).next();
  }
  return out as Shape<B>;
}

/** How directly a point at angle `a` round a landmark faces weather from angle `weather`: 1 facing it, 0 sheltered. */
export const facing = (a: number, weather: number): number => (1 + Math.cos(a - weather)) / 2;

/** Channels for a piece that only withers as vitality falls, plus any `extra` channels. */
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
 * A rough stone on the ground: a squashed, jittered icosphere, sunk a little
 * and turned by `yaw`. With `ch.grow` set it grows in below that vitality, so
 * rubble appears at the foot only once the piece above has fallen.
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
