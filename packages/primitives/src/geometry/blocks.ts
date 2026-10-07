// Small solids that buildings are made of: oriented boxes, quads, logs,
// pillowed stones and flat stepping stones. Each writes its vertices with
// one channel response, so a piece moves and withers as one.

import type { Rand, Vec3 } from "@gaia/schema";
import { type Channels, type PartBuilder, type V3, addScaled, cross, dot, normalize, scale, sub } from "./kit.ts";

export const UP: V3 = [0, 1, 0];

/** A quad from four corners in order, facing `n`. Winding follows `n`. */
export function quad(b: PartBuilder, p: readonly [Vec3, Vec3, Vec3, Vec3], n: Vec3, shade: number | readonly number[], c: Channels): void {
  const s = (i: number): number => (typeof shade === "number" ? shade : (shade[i] ?? 0.5));
  const facing = dot(cross(sub(p[1], p[0]), sub(p[2], p[0])), n) >= 0;
  const i0 = b.vertex(p[0], n, s(0), c);
  const i1 = b.vertex(p[1], n, s(1), c);
  const i2 = b.vertex(p[2], n, s(2), c);
  const i3 = b.vertex(p[3], n, s(3), c);
  if (facing) {
    b.triangle(i0, i1, i2);
    b.triangle(i0, i2, i3);
  } else {
    b.triangle(i0, i2, i1);
    b.triangle(i0, i3, i2);
  }
}

/** A triangle facing `n`. */
export function tri(b: PartBuilder, p: readonly [Vec3, Vec3, Vec3], n: Vec3, shade: number, c: Channels): void {
  const facing = dot(cross(sub(p[1], p[0]), sub(p[2], p[0])), n) >= 0;
  const i0 = b.vertex(p[0], n, shade, c);
  const i1 = b.vertex(p[1], n, shade, c);
  const i2 = b.vertex(p[2], n, shade, c);
  if (facing) b.triangle(i0, i1, i2);
  else b.triangle(i0, i2, i1);
}

/**
 * An oriented box: center, three unit axes and half sizes. Tops catch a
 * little more light and undersides a little less, as painted wood does.
 */
export function box(b: PartBuilder, c: Vec3, axes: readonly [Vec3, Vec3, Vec3], half: Vec3, shade: number, ch: Channels, skip: { bottom?: boolean } = {}): void {
  for (let i = 0; i < 3; i++) {
    for (const sign of [-1, 1]) {
      const axis = axes[i] as Vec3;
      const n = scale(axis, sign);
      if (skip.bottom === true && dot(n, UP) < -0.9) continue;
      const t1 = axes[(i + 1) % 3] as Vec3;
      const t2 = axes[(i + 2) % 3] as Vec3;
      const h1 = half[(i + 1) % 3] as number;
      const h2 = half[(i + 2) % 3] as number;
      const center = addScaled(c, n, half[i] as number);
      const lift = dot(n, UP) > 0.7 ? 0.08 : dot(n, UP) < -0.7 ? -0.12 : 0;
      const p = (u: number, v: number): V3 => addScaled(addScaled(center, t1, u * h1), t2, v * h2);
      quad(b, [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)], n, shade + lift, ch);
    }
  }
}

/** A box between two points with a square-ish section; `up` orients the section. */
export function beam(b: PartBuilder, from: Vec3, to: Vec3, width: number, thick: number, up: Vec3, shade: number, ch: Channels): void {
  const axis = sub(to, from);
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (len < 1e-4) return;
  const a = scale(axis, 1 / len);
  const side = normalize(cross(a, up));
  const v = normalize(cross(side, a));
  box(b, addScaled(from, axis, 0.5), [a, v, side], [len / 2, width / 2, thick / 2], shade, ch);
}

/** A log: a six-sided cylinder with lighter end grain. */
export function log(b: PartBuilder, from: Vec3, to: Vec3, radius: number, shade: number, ch: Channels, sides = 6): void {
  const axis = sub(to, from);
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (len < 1e-4) return;
  const a = scale(axis, 1 / len);
  const helper: Vec3 = Math.abs(a[1]) < 0.9 ? UP : [1, 0, 0];
  const u = normalize(cross(a, helper));
  const v = normalize(cross(a, u));
  const ring = (k: number): V3 => {
    const t = (k / sides) * Math.PI * 2;
    return addScaled(scale(u, Math.cos(t)), v, Math.sin(t));
  };
  for (let k = 0; k < sides; k++) {
    const r0 = ring(k);
    const r1 = ring(k + 1);
    const mid = normalize(addScaled(r0, r1, 1));
    quad(b, [addScaled(from, r0, radius), addScaled(from, r1, radius), addScaled(to, r1, radius), addScaled(to, r0, radius)], mid, shade, ch);
  }
  for (const [end, n] of [[from, scale(a, -1)], [to, a]] as const) {
    for (let k = 0; k < sides; k++) {
      tri(b, [end, addScaled(end, ring(k), radius * 0.98), addScaled(end, ring(k + 1), radius * 0.98)], n, shade + 0.32, ch);
    }
  }
}

/**
 * A stone set into a wall: a rounded pillow lying on the plane through `c`
 * with outward normal `n`, `w` wide along `u` and `h` tall, standing `proud` out.
 */
export function pillow(b: PartBuilder, c: Vec3, u: Vec3, n: Vec3, w: number, h: number, proud: number, shade: number, ch: Channels, r: Rand): void {
  const v = normalize(cross(n, u));
  const sides = 7;
  const rim: V3[] = [];
  const mid: V3[] = [];
  const turn = r.next() * Math.PI;
  for (let k = 0; k < sides; k++) {
    const t = turn + (k / sides) * Math.PI * 2;
    const j = 0.85 + 0.25 * r.next();
    const x = Math.cos(t) * (w / 2) * j;
    const y = Math.sin(t) * (h / 2) * j;
    rim.push(addScaled(addScaled(c, u, x), v, y));
    mid.push(addScaled(addScaled(addScaled(c, u, x * 0.72), v, y * 0.72), n, proud * 0.8));
  }
  const top = addScaled(c, n, proud);
  for (let k = 0; k < sides; k++) {
    const a = rim[k] as V3;
    const bb = rim[(k + 1) % sides] as V3;
    const ma = mid[k] as V3;
    const mb = mid[(k + 1) % sides] as V3;
    const out = normalize(addScaled(sub(addScaled(ma, mb, 1), scale(c, 2)), n, proud * 4));
    quad(b, [a, bb, mb, ma], out, shade - 0.05, ch);
    tri(b, [ma, mb, top], normalize(addScaled(n, out, 0.25)), shade + 0.05, ch);
  }
}

/** A flat, rounded stone lying on the ground, its top `lift` above y = 0 and sunk below it. */
export function flatStone(b: PartBuilder, x: number, z: number, radius: number, lift: number, shade: number, ch: Channels, r: Rand): void {
  const sides = 8;
  const turn = r.next() * Math.PI;
  const stretch = 0.75 + 0.35 * r.next();
  const rim: V3[] = [];
  const low: V3[] = [];
  for (let k = 0; k < sides; k++) {
    const t = turn + (k / sides) * Math.PI * 2;
    const j = 0.82 + 0.3 * r.next();
    const dx = Math.cos(t) * radius * j;
    const dz = Math.sin(t) * radius * j * stretch;
    rim.push([x + dx * 0.86, lift, z + dz * 0.86]);
    low.push([x + dx, -0.12, z + dz]);
  }
  const top: V3 = [x, lift + 0.012, z];
  for (let k = 0; k < sides; k++) {
    const a = rim[k] as V3;
    const c = rim[(k + 1) % sides] as V3;
    tri(b, [top, a, c], UP, shade + 0.04 * (k % 2), ch);
    const la = low[k] as V3;
    const lc = low[(k + 1) % sides] as V3;
    const out = normalize([(a[0] + c[0]) / 2 - x, 0.6, (a[2] + c[2]) / 2 - z]);
    quad(b, [la, lc, c, a], out, shade - 0.08, ch);
  }
}
