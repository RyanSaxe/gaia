// Builds ferns: a crown of arching fronds with two young crowns beside it, in
// the palette's stem swatch, which is green in every family. Every point of a
// frond bends about the frond's foot, so a gust turns the frond whole. As
// vitality falls the fronds brown from the tips, the outer leaflets drop and
// each frond folds down onto the ground.

import type { BuildContext, Built, Rand, Resolved } from "@gaia/schema";
import type { fernParams } from "../wildflowers.ts";
import { PartBuilder, type V3, add, addScaled, clamp, cross, lerp, lossThreshold, normalize, scale, sub } from "./kit.ts";

interface Frond {
  /** Where the frond leaves the ground. It bends and folds about this point. */
  readonly foot: V3;
  readonly azimuth: number;
  /** The frond's starting elevation and how far it arches over by its tip, in radians. */
  readonly rise: number;
  readonly arch: number;
  readonly length: number;
  /** The share of its length that has unrolled. The rest is coiled. */
  readonly unrolled: number;
  readonly tint: number;
  /** A shade offset that darkens fronds deep in the crown, in their neighbors' shadow. */
  readonly depth: number;
  readonly r: Rand;
}

/** How strongly droop bends a point toward the ground (`CHANNEL_MATH.sag` in @gaia/realize, which primitives cannot import). */
const CHANNEL_SAG = 1.1;
/** Frond length divided by crown height. */
const FROND_REACH = 1.3;
/** Steps used to trace the stalk's curve. */
const STEPS = 48;
/** How far a frond's coil winds, in radians per share of its length still coiled. A half-coiled frond winds 7 radians, a little over one turn. */
const COIL_TURN = 14;
/** Points on a leaflet's edge from root to tip, each as distance along, width and droop. */
const LOBES: readonly (readonly [number, number, number])[] = [[0.2, 1, 0.01], [0.48, 0.78, 0.03], [0.74, 0.55, 0.06]];
/** How far up the frond the first leaflets grow. */
const FIRST_LEAFLET = 0.12;

export function buildFerns(p: Resolved<typeof fernParams>, ctx: BuildContext): Built {
  const r = ctx.rand.fork("ferns");
  const out = new PartBuilder("stem");
  const s = 0.85 + 0.15 * (ctx.facts.scale ?? 1);
  // An arching frond stands about three quarters of its length tall, so `p.height` is the plant's height, not the frond's length.
  const length = p.height * s * FROND_REACH;
  const count = Math.round(p.fronds);
  emitCrown(out, [0, 0, 0], count, length, p.unroll, r.fork("crown"));
  // Two young crowns beside the main one, on different sides.
  const turn = r.next() * Math.PI * 2;
  for (let k = 0; k < 2; k++) {
    const a = turn + k * Math.PI * r.range(0.75, 1.1);
    const d = length * r.range(0.7, 0.95);
    emitCrown(out, [Math.cos(a) * d, 0, Math.sin(a) * d], Math.max(3, Math.round(count * 0.5)), length * r.range(0.5, 0.62), p.unroll, r.fork(`young${k}`));
  }
  return { parts: [out.part()], anchors: [] };
}

/** Fronds round one crown: the inner ones younger, steeper and shorter, the outer ones arching out low. */
function emitCrown(out: PartBuilder, center: V3, count: number, length: number, unroll: number, r: Rand): void {
  const spin = r.next() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const fr = r.fork(`f${i}`);
    const inner = i < Math.round(count * 0.3);
    const azimuth = spin + i * 2.39996 + fr.range(-0.25, 0.25);
    const foot = add(center, [Math.cos(azimuth) * 0.025, -0.02, Math.sin(azimuth) * 0.025]);
    const frond: Frond = {
      foot,
      azimuth,
      rise: inner ? fr.range(1.15, 1.35) : fr.range(0.82, 1.05),
      arch: inner ? fr.range(0.6, 0.9) : fr.range(1.2, 1.6),
      length: length * (inner ? fr.range(0.7, 0.85) : fr.range(0.88, 1.1)),
      unrolled: clamp(unroll + fr.range(-0.07, 0.07) - (inner ? 0.14 : 0), 0.4, 1),
      tint: fr.range(-0.04, 0.04),
      depth: inner ? -0.08 : fr.range(-0.03, 0.05),
      r: fr,
    };
    emitFrond(out, frond);
  }
}

interface Station {
  readonly at: V3;
  readonly along: V3;
  /** The frond's face (up from its leaflets) and its side, to the right of `along`. */
  readonly face: V3;
  readonly side: V3;
  /** How far into the coil, 0 where unrolled to 1 at the tip. */
  readonly coil: number;
}

/** Traces the stalk's curve: it rises, arches over, then curls into its coil past the unrolled share. */
function trace(f: Frond, arch: number): Station[] {
  const out: Station[] = [];
  let at: V3 = f.foot;
  let elevation = f.rise;
  const ds = f.length / STEPS;
  const coiled = 1 - f.unrolled;
  const twist = f.r.range(-0.2, 0.2);
  for (let k = 0; k <= STEPS; k++) {
    const t = k / STEPS;
    const azimuth = f.azimuth + twist * t;
    const out2: V3 = [Math.cos(azimuth), 0, Math.sin(azimuth)];
    const side: V3 = [-Math.sin(azimuth), 0, Math.cos(azimuth)];
    const coil = coiled > 1e-3 ? clamp((t - f.unrolled) / coiled, 0, 1) : 0;
    const along = normalize(add(scale(out2, Math.cos(elevation)), [0, Math.sin(elevation), 0]));
    out.push({ at, along, face: normalize(cross(side, along)), side, coil });
    at = addScaled(at, along, ds);
    // The arch bends more toward the tip, and the coil winds tighter toward its end. Each completes its whole turn over its own stretch.
    elevation -= (arch * 1.4 * Math.pow(t + 1e-3, 0.4)) / STEPS + (coil > 0 ? (COIL_TURN * coiled * 1.5 * Math.sqrt(coil)) / (coiled * STEPS) : 0);
  }
  return out;
}

const stationAt = (stations: readonly Station[], t: number): Station => {
  const x = clamp(t, 0, 1) * STEPS;
  const k = Math.min(STEPS - 1, Math.floor(x));
  const a = stations[k] as Station;
  const b = stations[k + 1] as Station;
  const u = x - k;
  return { at: lerp(a.at, b.at, u), along: normalize(lerp(a.along, b.along, u)), face: normalize(lerp(a.face, b.face, u)), side: normalize(lerp(a.side, b.side, u)), coil: a.coil + (b.coil - a.coil) * u };
};

/** The frond's stations, with its arch eased until the lowest point clears the soil. */
function stationsOf(f: Frond): Station[] {
  let arch = f.arch;
  let stations = trace(f, arch);
  for (let tries = 0; tries < 6 && Math.min(...stations.slice(4).map((st) => st.at[1])) < 0.05 * f.length; tries++) {
    arch *= 0.82;
    stations = trace(f, arch);
  }
  return stations;
}

/** A leaflet's length at `t` along the frond: short at the foot, longest about halfway up, and tapering toward the tip but never to zero, so every frond ends in leaf. */
const leafletLength = (t: number): number => Math.sin(Math.PI * Math.pow(clamp((t - 0.07) / 1.12, 0, 1), 0.75));

function emitFrond(out: PartBuilder, f: Frond): void {
  const stations = stationsOf(f);
  const pairs = Math.max(6, Math.round(f.length / (0.036 + 0.02 * f.length)));
  // Stalk rings: one at the foot, one at each leaflet pair, more round the coil, and one at the tip.
  const leaflets = Array.from({ length: pairs }, (_, j) => FIRST_LEAFLET + (1 - FIRST_LEAFLET) * Math.pow(j / pairs, 0.92));
  const coiling = f.unrolled < 0.98 ? Math.ceil(26 * (1 - f.unrolled)) : 0;
  const coilRings = Array.from({ length: coiling }, (_, k) => f.unrolled + ((1 - f.unrolled) * (k + 0.5)) / coiling);
  const ts = [...new Set([0, ...leaflets, ...coilRings, 1])].sort((a, b) => a - b);
  const radius = 0.004 + 0.006 * f.length;
  // At vitality 0, each point's droop lowers it to under a third of its height above the frond's foot, so the frond slumps low over the soil but never through it.
  const fold = (p: V3): number => {
    const o = sub(p, f.foot);
    const d = Math.hypot(o[0], o[1], o[2]);
    if (d < 1e-4) return 0;
    const rise = Math.asin(clamp(o[1] / d, -1, 1));
    return clamp((Math.sin(rise) - Math.cos(rise) * Math.tan(0.3 * rise + 0.03)) / CHANNEL_SAG, 0, 1);
  };
  const rings: number[] = [];
  const corners: V3[] = [];
  for (const t of ts) {
    const st = stationAt(stations, t);
    rings.push(out.vertexCount);
    const ch = { loss: 0, droop: 0, wither: 0.3 + 0.65 * t, glow: 0, pivot: f.foot, bough: f.foot, tint: f.tint };
    // The stalk thickens round the coil, which holds the rolled-up leaflets.
    const rad = radius * (1 - 0.65 * t) * (1 + 3 * st.coil * (1 - 0.6 * st.coil));
    for (let j = 0; j < 3; j++) {
      const a = Math.PI / 2 + (j * Math.PI * 2) / 3;
      const n = normalize(add(scale(st.face, Math.sin(a)), scale(st.side, Math.cos(a))));
      const p = addScaled(st.at, n, rad);
      corners.push(p);
      out.vertex(p, n, 0.4 + 0.35 * t, { ...ch, droop: fold(p) });
    }
  }
  for (let k = 0; k + 1 < rings.length; k++) {
    for (let j = 0; j < 3; j++) {
      const a = (rings[k] as number) + j;
      const b = (rings[k] as number) + ((j + 1) % 3);
      out.triangle(a, b, a + 3);
      out.triangle(b, b + 3, a + 3);
    }
  }
  // Leaflets in pairs, rooted on the stalk's lower corners so the frond stays one piece.
  const top = 0.28 * f.length;
  for (const t of leaflets) {
    const j = ts.indexOf(t);
    const st = stationAt(stations, t);
    const len = top * leafletLength(t) * (1 - 0.82 * st.coil) * f.r.range(0.9, 1.08);
    if (len < 0.006) continue;
    for (const side of [1, -1] as const) {
      const corner = j * 3 + (side === 1 ? 2 : 1);
      emitLeaflet(out, f, st, { index: (rings[0] as number) + corner, at: corners[corner] as V3 }, side, len, t, fold);
    }
  }
  // An open frond ends in one leaflet that continues along the stalk.
  const tip = stationAt(stations, 1);
  if (tip.coil < 0.02) {
    const corner = (ts.length - 1) * 3;
    emitLeaflet(out, f, tip, { index: (rings[0] as number) + corner, at: corners[corner] as V3 }, 0, top * 0.32, 1, fold);
  }
}

/**
 * One leaflet: a slim blade with a wavy edge, swept toward the frond's tip
 * (or along it for the last leaflet, `side` 0), drooping a little, with its
 * halves creased up from the midrib. Each has its own shade and turns a
 * little on its midrib, so overlapping fronds show separate leaflets.
 */
function emitLeaflet(out: PartBuilder, f: Frond, st: Station, root: { index: number; at: V3 }, side: -1 | 0 | 1, len: number, t: number, fold: (p: V3) => number): void {
  const sweep = side === 0 ? Math.PI / 2 : 0.22 + 0.5 * t + 0.9 * st.coil + f.r.range(-0.08, 0.08);
  const dir = normalize(add(add(scale(st.side, side * Math.cos(sweep)), scale(st.along, Math.sin(sweep))), scale(st.face, 0.06)));
  const twist = f.r.range(-0.45, 0.45);
  const flat = normalize(cross(st.face, dir));
  const across = normalize(add(scale(flat, Math.cos(twist)), scale(st.face, Math.sin(twist))));
  const face = normalize(cross(dir, across));
  const up = face[1] < 0 ? scale(face, -1) : face;
  const base = root.at;
  const half = len * 0.13;
  const n = normalize(addScaled(up, [0, 1, 0], 0.3));
  // Some leaflets past 55% of the frond drop, each at its own threshold, more of them toward the tip. Lower leaflets never drop.
  const frail = t > 0.55 && f.r.next() < ((t - 0.55) / 0.45) * 0.85;
  const ch = {
    loss: frail ? lossThreshold(f.r.next(), 0.35, 0.04) : 0,
    droop: 0,
    // The wither weight rises steeply toward the tip, so the tips brown first.
    wither: clamp(0.2 + 0.8 * Math.pow(t, 1.1), 0, 1),
    glow: 0,
    pivot: base,
    bough: f.foot,
    tint: f.tint + 0.04 * t * t + f.r.range(-0.015, 0.015),
  };
  const shade = 0.5 + 0.3 * t + f.depth + f.r.range(-0.12, 0.12);
  // A point on the blade from its distance along, width and droop.
  const point = (along: number, width: number, drop: number): V3 => addScaled(addScaled(base, dir, len * along), up, -len * drop + Math.abs(width) * half * 0.25);
  const at = (along: number, width: number, drop: number): number => {
    const p = addScaled(point(along, width, drop), across, width * half);
    // Each half's normal tilts a little away from the midrib, so the two halves shade differently.
    const crease = normalize(addScaled(n, across, 0.3 * Math.sign(width)));
    return out.vertex(p, crease, shade + 0.12 * along, { ...ch, droop: fold(p), wither: clamp(ch.wither + 0.15 * along, 0, 1) });
  };
  // Lobes in and out down each edge, so the blade looks like a cut leaf, not a strap.
  const rows = LOBES.map(([along, width, drop]) => [at(along, width, drop), at(along, -width, drop)] as const);
  const [first] = rows;
  if (first !== undefined) out.triangle(root.index, first[0], first[1]);
  for (let k = 0; k + 1 < rows.length; k++) {
    const [l0, r0] = rows[k] as readonly [number, number];
    const [l1, r1] = rows[k + 1] as readonly [number, number];
    out.triangle(l0, l1, r0);
    out.triangle(r0, l1, r1);
  }
  const last = rows[rows.length - 1];
  if (last !== undefined) out.triangle(last[0], at(1, 0, 0.12), last[1]);
}
