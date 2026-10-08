// Shared geometry tools for primitives: vector math, a Part builder that
// writes every vitality channel per vertex, an icosphere template and a
// deterministic noise. Pure typed arrays; no Three.js.

import type { Part, Vec3 } from "@gaia/schema";

export type V3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const addScaled = (a: Vec3, b: Vec3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const lerp = (a: Vec3, b: Vec3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export function normalize(a: Vec3): V3 {
  const l = length(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
}
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Two unit vectors perpendicular to `dir` and to each other. */
export function basis(dir: Vec3): [V3, V3] {
  const helper: Vec3 = Math.abs(dir[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(dir, helper));
  const v = normalize(cross(dir, u));
  return [u, v];
}

/** Rotates `v` around unit `axis` by `angle` (Rodrigues). */
export function rotate(v: Vec3, axis: Vec3, angle: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [v[0] * c + k[0] * s + axis[0] * d, v[1] * c + k[1] * s + axis[1] * d, v[2] * c + k[2] * s + axis[2] * d];
}

/** The per-vertex vitality response of one piece of a part. */
export interface Channels {
  readonly loss: number;
  readonly droop: number;
  readonly wither: number;
  readonly glow: number;
  readonly pivot: Vec3;
  /** The joint where the piece's bough or stem leaves the trunk or the ground: it sags (`droop`) and bends in the wind about it. `pivot` when absent. */
  readonly bough?: Vec3;
  /** The joint where the piece's twig leaves its bough: it bends about it in the wind, on top of the bough. `bough` when absent. */
  readonly twig?: Vec3;
  /** Hue offset in turns, -0.1 to 0.1. Zero when absent. */
  readonly tint?: number;
  /** How far the piece folds toward its pivot at night, 0 to 1. Zero when absent. */
  readonly close?: number;
  /** How the piece falls about its pivot as vitality drops: axis times radians, then the vitality it starts at. */
  readonly fall?: readonly [number, number, number, number];
  /** The vitality below which the piece grows out of its pivot. Zero when absent. */
  readonly grow?: number;
  /** How far the surface rots through into holes as vitality drops, 0 to 1. Zero when absent. */
  readonly rot?: number;
  /** How the piece turns about its pivot while alive: axis times turns per second. */
  readonly spin?: Vec3;
}

const SOLID: Vec3 = [0, 0, 0];
const NO_FALL = [0, 0, 0, 0] as const;

/**
 * Every vertex's piece (the connected run of triangles it is in, numbered by
 * first vertex) and that piece's size, the side of a square with half its
 * surface area. A vertex no triangle uses is a piece of its own, of size 0.
 */
function piecesOf(pos: readonly number[], idx: readonly number[]): Float32Array {
  const n = pos.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const root = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[a] !== r) {
      const next = parent[a] as number;
      parent[a] = r;
      a = next;
    }
    return r;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = root(idx[t] as number);
    const b = root(idx[t + 1] as number);
    const c = root(idx[t + 2] as number);
    const low = Math.min(a, b, c);
    parent[a] = low;
    parent[b] = low;
    parent[c] = low;
  }
  const area = new Float64Array(n);
  const at = (v: number): V3 => [pos[v * 3] as number, pos[v * 3 + 1] as number, pos[v * 3 + 2] as number];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] as number;
    const corner = at(a);
    const r = root(a);
    area[r] = (area[r] as number) + length(cross(sub(at(idx[t + 1] as number), corner), sub(at(idx[t + 2] as number), corner))) / 2;
  }
  const number = new Int32Array(n).fill(-1);
  let pieces = 0;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const r = root(i);
    if (number[r] === -1) number[r] = pieces++;
    out[i * 2] = number[r] as number;
    out[i * 2 + 1] = Math.sqrt((area[r] as number) / 2);
  }
  return out;
}

/** Accumulates vertices with every channel, then freezes into a Part. */
export class PartBuilder {
  readonly #pos: number[] = [];
  readonly #nrm: number[] = [];
  readonly #shade: number[] = [];
  readonly #tint: number[] = [];
  readonly #cut: number[] = [];
  readonly #loss: number[] = [];
  readonly #droop: number[] = [];
  readonly #wither: number[] = [];
  readonly #glow: number[] = [];
  readonly #pivot: number[] = [];
  readonly #bough: number[] = [];
  readonly #twig: number[] = [];
  readonly #close: number[] = [];
  readonly #fall: number[] = [];
  readonly #grow: number[] = [];
  readonly #rot: number[] = [];
  readonly #spin: number[] = [];
  /** Which optional channels some vertex wrote, so a part without them carries none. */
  readonly #uses = { fall: false, grow: false, rot: false, spin: false };
  readonly #idx: number[] = [];

  constructor(
    readonly swatch: string,
    readonly collision: Part["collision"] = "none",
  ) {}

  get vertexCount(): number {
    return this.#shade.length;
  }

  get triangleCount(): number {
    return this.#idx.length / 3;
  }

  /** Adds a vertex; `cut` places it on a leaf card (see `CUT`), and solid surfaces omit it. */
  vertex(p: Vec3, n: Vec3, shade: number, c: Channels, cut: Vec3 = SOLID): number {
    this.#pos.push(p[0], p[1], p[2]);
    this.#cut.push(cut[0], cut[1], cut[2]);
    this.#nrm.push(n[0], n[1], n[2]);
    this.#shade.push(clamp(shade, 0, 1));
    this.#tint.push(clamp(c.tint ?? 0, -0.1, 0.1));
    this.#loss.push(clamp(c.loss, 0, 1));
    this.#droop.push(clamp(c.droop, 0, 1));
    this.#wither.push(clamp(c.wither, 0, 1));
    this.#glow.push(clamp(c.glow, 0, 1));
    this.#pivot.push(c.pivot[0], c.pivot[1], c.pivot[2]);
    const bough = c.bough ?? c.pivot;
    const twig = c.twig ?? bough;
    this.#bough.push(bough[0], bough[1], bough[2]);
    this.#twig.push(twig[0], twig[1], twig[2]);
    this.#close.push(clamp(c.close ?? 0, 0, 1));
    const fall = c.fall ?? NO_FALL;
    this.#fall.push(fall[0], fall[1], fall[2], clamp(fall[3], 0, 1));
    this.#grow.push(clamp(c.grow ?? 0, 0, 1));
    this.#rot.push(clamp(c.rot ?? 0, 0, 1));
    const spin = c.spin ?? SOLID;
    this.#spin.push(spin[0], spin[1], spin[2]);
    if (c.fall !== undefined && fall[3] > 0) this.#uses.fall = true;
    if ((c.grow ?? 0) > 0) this.#uses.grow = true;
    if ((c.rot ?? 0) > 0) this.#uses.rot = true;
    if (c.spin !== undefined) this.#uses.spin = true;
    return this.#shade.length - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.#idx.push(a, b, c);
  }

  part(): Part {
    return {
      swatch: this.swatch,
      positions: new Float32Array(this.#pos),
      normals: new Float32Array(this.#nrm),
      indices: new Uint32Array(this.#idx),
      shade: new Float32Array(this.#shade),
      tint: new Float32Array(this.#tint),
      cutout: new Float32Array(this.#cut),
      piece: piecesOf(this.#pos, this.#idx),
      channels: {
        loss: new Float32Array(this.#loss),
        droop: new Float32Array(this.#droop),
        wither: new Float32Array(this.#wither),
        glow: new Float32Array(this.#glow),
        pivot: new Float32Array(this.#pivot),
        bough: new Float32Array(this.#bough),
        twig: new Float32Array(this.#twig),
        close: new Float32Array(this.#close),
        ...(this.#uses.fall ? { fall: new Float32Array(this.#fall) } : {}),
        ...(this.#uses.grow ? { grow: new Float32Array(this.#grow) } : {}),
        ...(this.#uses.rot ? { rot: new Float32Array(this.#rot) } : {}),
        ...(this.#uses.spin ? { spin: new Float32Array(this.#spin) } : {}),
      },
      collision: this.collision,
    };
  }
}

/** A leaf card's cut, with the card's own seed (0 to 1) in its fraction. */
export const cutOf = (form: number, seed: number): number => form + 0.999 * clamp(seed, 0, 1);

/** One vertex of a leaf card: where it is, its place on the card, its normal and shade. */
export interface CardPoint {
  readonly p: V3;
  readonly across: number;
  readonly along: number;
  readonly n: V3;
  readonly shade: number;
}

/** A leaf card as a grid of rows (along the card) of points (across it). */
export function emitCard(out: PartBuilder, rows: readonly (readonly CardPoint[])[], cut: number, ch: Channels): void {
  const first = out.vertexCount;
  const cols = rows[0]?.length ?? 0;
  for (const row of rows) for (const v of row) out.vertex(v.p, v.n, v.shade, ch, [v.across, v.along, cut]);
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j + 1 < cols; j++) {
      const a = first + i * cols + j;
      const b = a + cols;
      out.triangle(a, b, a + 1);
      out.triangle(a + 1, b, b + 1);
    }
  }
}

export interface SphereTemplate {
  readonly points: readonly V3[];
  readonly triangles: readonly (readonly [number, number, number])[];
}

const sphereCache = new Map<number, SphereTemplate>();

/** A unit icosphere with outward winding. Subdivision 1 has 80 triangles, 2 has 320. */
export function icosphere(subdivisions: number): SphereTemplate {
  const cached = sphereCache.get(subdivisions);
  if (cached !== undefined) return cached;
  const t = (1 + Math.sqrt(5)) / 2;
  let points: V3[] = (
    [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ] as V3[]
  ).map(normalize);
  let tris: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdivisions; s++) {
    const mids = new Map<string, number>();
    const mid = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const hit = mids.get(key);
      if (hit !== undefined) return hit;
      const pa = points[a] as V3;
      const pb = points[b] as V3;
      points = [...points, normalize(lerp(pa, pb, 0.5))];
      mids.set(key, points.length - 1);
      return points.length - 1;
    };
    const next: [number, number, number][] = [];
    for (const [a, b, c] of tris) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    tris = next;
  }
  const template = { points, triangles: tris };
  sphereCache.set(subdivisions, template);
  return template;
}

/** Smooth, deterministic 3D value noise in roughly [-1, 1]. */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function noise3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const c = (dx: number, dy: number, dz: number): number => hash3(xi + dx, yi + dy, zi + dz, seed);
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * ux;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * ux;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * ux;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return (y0 + (y1 - y0) * uz) * 2 - 1;
}

export function fbm3(x: number, y: number, z: number, seed = 0, octaves = 3): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x * f, y * f, z * f, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/**
 * The vitality span over which a piece collapses once below its `loss`, the
 * realizer's `CHANNEL_MATH.lossBand`: a piece that rests on another must
 * finish going within it before what holds it starts.
 */
export const LOSS_BAND = 0.08;

/**
 * A threshold for `loss` drawn so decline is gradual across many pieces:
 * few pieces go early, most hold on until vitality is low.
 * Fraction lost at vitality v is about 1 - (v / top)^(2/3).
 */
export const lossThreshold = (u: number, top: number, floor = 0.02): number => floor + (top - floor) * Math.pow(u, 1.5);
