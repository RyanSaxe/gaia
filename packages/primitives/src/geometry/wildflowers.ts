// Wildflower drifts: one species per drift, many stems thickest at its heart
// and thinning toward its ragged edge. Petals fold toward their head at
// night, and as vitality falls they droop, fade to straw and drop, edges of
// the drift first; stems hold on longer.

import type { BuildContext, Built, Rand, Resolved } from "@gaia/schema";
import type { driftParams } from "../wildflowers.ts";
import { PartBuilder, type V3, add, addScaled, basis, clamp, cross, lossThreshold, normalize, scale, sub } from "./kit.ts";

export type Species = "daisies" | "cups" | "bells" | "spikes";

interface Flower {
  readonly base: V3;
  readonly top: V3;
  /** Direction the stem leaves the ground, before it bends. */
  readonly lean: V3;
  readonly height: number;
  /** How far the flower sits from the drift's heart, 0 to 1. */
  readonly edge: number;
  readonly r: Rand;
}

/** Flowers per square meter at the heart of a drift of density 1. */
const PER_SQUARE_METER = 24;
const MAX_FLOWERS = 300;

/** Night closing per species: open faces fold tight, bells and spikes barely change. */
const CLOSE: Record<Species, number> = { daisies: 1, cups: 0.9, bells: 0.3, spikes: 0.25 };

export function buildDrift(species: Species, p: Resolved<typeof driftParams>, ctx: BuildContext): Built {
  const r = ctx.rand.fork(`drift-${species}`);
  const petals = new PartBuilder("bloom");
  const eyes = new PartBuilder("eye");
  const stems = new PartBuilder("stem");
  const s = 0.85 + 0.15 * (ctx.facts.scale ?? 1);
  const flowers = layout(p, r.fork("layout"), s);
  for (const f of flowers) {
    const headLoss = clamp(lossThreshold(f.r.next(), 0.78) + 0.12 * f.edge, 0.02, 0.85);
    const tint = f.r.range(-0.06, 0.06);
    emitStem(stems, f, headLoss, species === "bells");
    // The head rides its stem: it sags and sways with it about the stem's foot.
    const ch = { loss: headLoss, droop: 0.35, wither: 1, glow: 0, close: CLOSE[species], tint, bough: f.base };
    if (species === "daisies") emitDaisy(petals, eyes, f, ch);
    else if (species === "cups") emitCup(petals, eyes, f, ch);
    else if (species === "bells") emitBells(petals, f, ch);
    else emitSpike(petals, f, ch);
  }
  const parts = [stems.part(), petals.part()];
  if (eyes.vertexCount > 0) parts.push(eyes.part());
  return { parts, anchors: [] };
}

/** Stems scattered over a rotated ellipse, thickest at its heart, never closer than a hand's width. */
function layout(p: Resolved<typeof driftParams>, r: Rand, s: number): Flower[] {
  const rx = p.spread;
  const rz = p.spread * r.range(0.5, 0.7);
  const turn = r.next() * Math.PI;
  const want = Math.min(MAX_FLOWERS, Math.round(Math.PI * rx * rz * p.density * PER_SQUARE_METER * 0.55));
  const out: Flower[] = [];
  const gap = 0.11;
  for (let tries = 0; out.length < want && tries < want * 30; tries++) {
    const a = r.next() * Math.PI * 2;
    const d = Math.sqrt(r.next());
    // A ragged edge: the boundary wanders with angle.
    const edgeAt = 0.75 + 0.25 * Math.sin(a * 3 + turn * 2) * Math.cos(a * 2 - turn);
    if (d > edgeAt) continue;
    const edge = d / edgeAt;
    if (r.next() > 1 - 0.55 * edge * edge) continue;
    const lx = Math.cos(a) * d * rx;
    const lz = Math.sin(a) * d * rz;
    const x = lx * Math.cos(turn) - lz * Math.sin(turn);
    const z = lx * Math.sin(turn) + lz * Math.cos(turn);
    if (out.some((f) => Math.hypot(f.base[0] - x, f.base[2] - z) < gap)) continue;
    const fr = r.fork(`f${out.length}`);
    const height = p.height * s * fr.range(0.75, 1.12) * (1 - 0.3 * edge);
    const la = fr.next() * Math.PI * 2;
    const tilt = fr.range(0.04, 0.2);
    const lean = normalize([Math.cos(la) * tilt, 1, Math.sin(la) * tilt]);
    const base: V3 = [x, -0.08, z];
    out.push({ base, top: addScaled(base, lean, height + 0.08), lean, height, edge, r: fr });
  }
  return out;
}

interface HeadLook {
  readonly bough: V3;
  readonly loss: number;
  readonly droop: number;
  readonly wither: number;
  readonly glow: number;
  readonly close: number;
  readonly tint: number;
}

/** A slim three-sided stem bending gently toward its head, and two strap leaves at its foot. */
function emitStem(out: PartBuilder, f: Flower, headLoss: number, arching: boolean): void {
  const ch = { loss: clamp(headLoss * 0.45, 0.02, 0.5), droop: 0.35, wither: 0.8, glow: 0, pivot: f.base, tint: 0 };
  const radius = 0.006 + 0.006 * f.height;
  const mid = addScaled(f.base, f.lean, (f.height + 0.08) * 0.55);
  const path: V3[] = [f.base, arching ? add(mid, scale([f.lean[0], 0, f.lean[2]], 0.6)) : mid, f.top];
  const rings: number[] = [];
  path.forEach((c, k) => {
    const dir = normalize(sub(path[Math.min(2, k + 1)] as V3, path[Math.max(0, k - 1)] as V3));
    const [u, v] = basis(dir);
    rings.push(out.vertexCount);
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * Math.PI * 2;
      const n = normalize(add(scale(u, Math.cos(a)), scale(v, Math.sin(a))));
      out.vertex(addScaled(c, n, radius * (1 - 0.4 * (k / 2))), n, 0.5 + 0.3 * (k / 2), ch);
    }
  });
  for (let k = 0; k < 2; k++) {
    for (let j = 0; j < 3; j++) {
      const a = (rings[k] as number) + j;
      const b = (rings[k] as number) + ((j + 1) % 3);
      out.triangle(a, a + 3, b);
      out.triangle(b, a + 3, b + 3);
    }
  }
  const leaves = { ...ch, loss: clamp(headLoss * 0.35, 0.02, 0.4), droop: 0.5, wither: 0.9 };
  for (let k = 0; k < 2; k++) {
    const a = f.r.next() * Math.PI * 2;
    const out2: V3 = [Math.cos(a), 0, Math.sin(a)];
    const len = 0.12 + 0.18 * f.height;
    const root: V3 = [f.base[0], 0, f.base[2]];
    const tip: V3 = add(root, [out2[0] * len * 0.8, len * 0.55, out2[2] * len * 0.8]);
    const side = normalize(cross(out2, [0, 1, 0]));
    const midP = add(root, [out2[0] * len * 0.45, len * 0.45, out2[2] * len * 0.45]);
    const n = normalize(add(cross(sub(tip, root), side), [0, 0.6, 0]));
    const w = 0.012 + 0.012 * f.height;
    const i0 = out.vertex(root, n, 0.35, leaves);
    const i1 = out.vertex(addScaled(midP, side, w), n, 0.5, leaves);
    const i2 = out.vertex(tip, n, 0.62, leaves);
    const i3 = out.vertex(addScaled(midP, side, -w), n, 0.5, leaves);
    out.triangle(i0, i1, i2);
    out.triangle(i0, i2, i3);
  }
}

/** The direction a head faces: up along its stem and well out to one side, so open faces read from eye height. */
function facingOf(f: Flower, outward: number): V3 {
  const a = f.r.next() * Math.PI * 2;
  return normalize(add(f.lean, [Math.cos(a) * outward, 0.15, Math.sin(a) * outward]));
}

function emitDisc(out: PartBuilder, center: V3, facing: V3, radius: number, rise: number, look: HeadLook, shade: number): void {
  const [u, v] = basis(facing);
  const ch = { ...look, pivot: center, close: look.close * 0.4 };
  const hub = out.vertex(addScaled(center, facing, rise), facing, shade + 0.15, ch);
  const first = out.vertexCount;
  for (let j = 0; j < 6; j++) {
    const a = (j / 6) * Math.PI * 2;
    const dir = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
    out.vertex(addScaled(center, dir, radius), normalize(addScaled(facing, dir, 0.5)), shade, ch);
  }
  for (let j = 0; j < 6; j++) out.triangle(hub, first + j, first + ((j + 1) % 6));
}

/** Many slim white-to-any rays round a raised eye. */
function emitDaisy(petals: PartBuilder, eyes: PartBuilder, f: Flower, look: HeadLook): void {
  const facing = facingOf(f, 1.1);
  const [u, v] = basis(facing);
  const radius = (0.075 + 0.06 * f.height) * f.r.range(0.85, 1.15);
  const count = 11 + Math.floor(f.r.next() * 4);
  const spin = f.r.next() * Math.PI * 2;
  const ch = { ...look, pivot: f.top };
  for (let k = 0; k < count; k++) {
    const a = spin + (k / count) * Math.PI * 2 + f.r.range(-0.08, 0.08);
    const dir = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
    const side = add(scale(u, -Math.sin(a)), scale(v, Math.cos(a)));
    const len = radius * f.r.range(0.85, 1.1);
    const w = radius * 0.13;
    const n = normalize(addScaled(facing, dir, 0.25));
    const root = addScaled(f.top, dir, radius * 0.22);
    const midP = addScaled(addScaled(f.top, dir, len * 0.6), facing, len * 0.14);
    const tip = addScaled(addScaled(f.top, dir, len), facing, len * 0.12);
    const shade = 0.72 + 0.2 * f.r.next();
    const i0 = petals.vertex(root, n, shade * 0.85, ch);
    const i1 = petals.vertex(addScaled(midP, side, w), n, shade, ch);
    const i2 = petals.vertex(tip, n, shade, ch);
    const i3 = petals.vertex(addScaled(midP, side, -w), n, shade, ch);
    petals.triangle(i0, i1, i2);
    petals.triangle(i0, i2, i3);
  }
  emitDisc(eyes, f.top, facing, radius * 0.3, radius * 0.16, look, 0.55);
}

/** Five rounded petals cupped around a small dark eye, like a poppy or a buttercup. */
function emitCup(petals: PartBuilder, eyes: PartBuilder, f: Flower, look: HeadLook): void {
  const facing = facingOf(f, 0.5);
  const [u, v] = basis(facing);
  const radius = (0.065 + 0.05 * f.height) * f.r.range(0.85, 1.15);
  const count = 5;
  const spin = f.r.next() * Math.PI * 2;
  const ch = { ...look, pivot: f.top };
  for (let k = 0; k < count; k++) {
    const a = spin + (k / count) * Math.PI * 2;
    const at = (t: number, lift: number, reach: number): V3 => {
      const dir = add(scale(u, Math.cos(a + t)), scale(v, Math.sin(a + t)));
      return addScaled(addScaled(f.top, dir, radius * reach), facing, radius * lift);
    };
    const dir = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
    const n = normalize(addScaled(facing, dir, -0.35));
    const shade = 0.7 + 0.2 * f.r.next();
    const base = petals.vertex(at(0, 0.05, 0.1), n, shade * 0.75, ch);
    const ring = [-0.62, -0.25, 0.25, 0.62].map((t, j) =>
      petals.vertex(at(t, j === 0 || j === 3 ? 0.45 : 0.7, j === 0 || j === 3 ? 0.78 : 1), n, shade, ch),
    );
    for (let j = 0; j < 3; j++) petals.triangle(base, ring[j] as number, ring[j + 1] as number);
  }
  emitDisc(eyes, addScaled(f.top, facing, radius * 0.08), facing, radius * 0.22, radius * 0.12, look, 0.35);
}

/** A bell's sides: five reads as round at a flower's size. */
const SIDES = 5;

/** An arching stem hung with nodding bells on one side, like a bluebell. */
function emitBells(petals: PartBuilder, f: Flower, look: HeadLook): void {
  const count = 3 + Math.floor(f.r.next() * 3);
  const away = normalize([f.lean[0] + 1e-3, 0, f.lean[2]]);
  const size = (0.034 + 0.022 * f.height) * f.r.range(0.85, 1.15);
  for (let k = 0; k < count; k++) {
    const t = k / count;
    const hang = addScaled(addScaled(f.top, away, size * (0.6 + 2.2 * t)), [0, 1, 0], -f.height * 0.22 * t - size * 0.8);
    const axis = normalize(add([0, -1, 0], scale(away, 0.55)));
    const [u, v] = basis(axis);
    const ch = { ...look, pivot: hang, loss: clamp(look.loss + 0.05 * k, 0.02, 0.9) };
    const top = petals.vertex(addScaled(hang, axis, -size * 0.4), scale(axis, -1), 0.6, ch);
    const rings: number[] = [];
    for (const [along, rad, flare] of [[0.25, 0.6, 0], [1, 1, 0], [1.25, 1.35, 0.4]] as const) {
      rings.push(petals.vertexCount);
      for (let j = 0; j < SIDES; j++) {
        const a = (j / SIDES) * Math.PI * 2;
        const dir = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
        const n = normalize(addScaled(dir, axis, -0.2 - flare));
        petals.vertex(addScaled(addScaled(hang, axis, size * along), dir, size * rad * 0.55), n, 0.65 + 0.25 * along * 0.6, ch);
      }
    }
    for (let j = 0; j < SIDES; j++) petals.triangle(top, (rings[0] as number) + ((j + 1) % SIDES), (rings[0] as number) + j);
    for (let ring = 0; ring < 2; ring++) {
      for (let j = 0; j < SIDES; j++) {
        const a = (rings[ring] as number) + j;
        const b = (rings[ring] as number) + ((j + 1) % SIDES);
        petals.triangle(a, b, a + SIDES);
        petals.triangle(b, b + SIDES, a + SIDES);
      }
    }
  }
}

/** A spire of small florets up the top of the stem, like lupine or lavender. */
function emitSpike(petals: PartBuilder, f: Flower, look: HeadLook): void {
  const count = 9 + Math.floor(f.r.next() * 6);
  const span = f.height * 0.38;
  const size = (0.022 + 0.016 * f.height) * f.r.range(0.85, 1.15);
  const spin = f.r.next() * Math.PI * 2;
  for (let k = 0; k < count; k++) {
    const t = k / (count - 1);
    const at = addScaled(f.top, f.lean, -span * (1 - t));
    const a = spin + k * 2.4;
    const out: V3 = [Math.cos(a), 0.3, Math.sin(a)];
    const rad = size * (1.25 - 0.65 * t);
    const c = addScaled(at, normalize(out), rad * 0.9);
    const ch = { ...look, pivot: at, loss: clamp(look.loss + 0.08 * t, 0.02, 0.9) };
    const shade = 0.6 + 0.3 * t;
    const first = petals.vertexCount;
    const dirs: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const d of dirs) petals.vertex(addScaled(c, d, rad * (d[1] === 0 ? 1 : 0.8)), normalize(add(d, normalize(out))), shade + 0.1 * d[1], ch);
    const faces = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
    for (const [x, y, z] of faces) petals.triangle(first + (x as number), first + (y as number), first + (z as number));
  }
}
