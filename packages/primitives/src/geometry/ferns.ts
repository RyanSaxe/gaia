// Ferns: a crown of arching fronds with two young crowns beside it. Each
// frond is one piece: a slim stalk carrying paired leaflets, longest a third
// of the way up, its tip still coiled where it has not unrolled. A frond's
// every point bends about the frond's foot, so in a gust it turns whole.
// As vitality falls the fronds brown from the tips, their last leaflets
// shrivel onto the stalk, and the whole frond folds down to lie on the
// ground. They take the palette's stem swatch, green in every family.

import type { BuildContext, Built, Rand, Resolved } from "@gaia/schema";
import type { fernParams } from "../wildflowers.ts";
import { PartBuilder, type V3, add, addScaled, clamp, cross, lerp, lossThreshold, normalize, scale, sub } from "./kit.ts";

interface Frond {
  /** Where the frond leaves the ground: it bends and folds about this point. */
  readonly foot: V3;
  readonly azimuth: number;
  /** Elevation it rises at, and how far it arches over by its tip, radians. */
  readonly rise: number;
  readonly arch: number;
  readonly length: number;
  /** The share of its length that has unrolled; the rest is coiled. */
  readonly unrolled: number;
  readonly tint: number;
  readonly r: Rand;
}

/** How strongly droop bends a point toward the ground (`CHANNEL_MATH.sag` in @gaia/realize, which primitives cannot import). */
const CHANNEL_SAG = 1.1;
/** A frond's length over the height its crown stands. */
const FROND_REACH = 1.3;
/** Steps the stalk's curve is traced in. */
const STEPS = 48;
/** How far a frond's coil winds, radians for each share of its length still coiled: half coiled is a turn and a bit. */
const COIL_TURN = 14;
/** A leaflet's edge from its root to its tip: how far along, how wide, how far it has drooped. */
const LOBES: readonly (readonly [number, number, number])[] = [[0.16, 1, 0.01], [0.36, 0.72, 0.02], [0.56, 0.9, 0.04], [0.78, 0.5, 0.07]];
/** How far up the frond the first leaflets grow. */
const FIRST_LEAFLET = 0.12;

export function buildFerns(p: Resolved<typeof fernParams>, ctx: BuildContext): Built {
  const r = ctx.rand.fork("ferns");
  const out = new PartBuilder("stem");
  const s = 0.85 + 0.15 * (ctx.facts.scale ?? 1);
  // A frond arches over to stand about three quarters of its length tall: the height asked is the plant's.
  const length = p.height * s * FROND_REACH;
  const count = Math.round(p.fronds);
  emitCrown(out, [0, 0, 0], count, length, p.unroll, r.fork("crown"));
  // Two young crowns beside the old one, each on its own side.
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

/** The stalk's curve: it rises, arches over, then curls into its coil beyond the unrolled share. */
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
    // The arch bends more toward the tip, and the coil winds ever tighter: each spends its whole turn over its stretch.
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

/** A frond that keeps its tips off the ground: its arch eases until the lowest point clears the soil. */
function stationsOf(f: Frond): Station[] {
  let arch = f.arch;
  let stations = trace(f, arch);
  for (let tries = 0; tries < 6 && Math.min(...stations.slice(4).map((st) => st.at[1])) < 0.05 * f.length; tries++) {
    arch *= 0.82;
    stations = trace(f, arch);
  }
  return stations;
}

/** A leaflet's length along the frond: short at the foot, longest a third of the way up, tapering to the tip. */
const leafletLength = (t: number): number => Math.sin(Math.PI * Math.pow(clamp((t - FIRST_LEAFLET * 0.6) / (1 - FIRST_LEAFLET * 0.6), 0, 1), 0.75));

function emitFrond(out: PartBuilder, f: Frond): void {
  const stations = stationsOf(f);
  const pairs = Math.max(6, Math.round(f.length / (0.034 + 0.018 * f.length)));
  // A ring where the frond leaves the ground, one at every pair of leaflets, more round the coil, and one at the tip.
  const leaflets = Array.from({ length: pairs }, (_, j) => FIRST_LEAFLET + (1 - FIRST_LEAFLET) * Math.pow(j / pairs, 0.92));
  const coiling = f.unrolled < 0.98 ? Math.ceil(40 * (1 - f.unrolled)) : 0;
  const coilRings = Array.from({ length: coiling }, (_, k) => f.unrolled + ((1 - f.unrolled) * (k + 0.5)) / coiling);
  const ts = [...new Set([0, ...leaflets, ...coilRings, 1])].sort((a, b) => a - b);
  const radius = 0.004 + 0.006 * f.length;
  // Folding to the ground: at vitality 0 each point's droop leaves it at under a third of its rise from the frond's foot, so the frond slumps low over the soil but never through it.
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
    const ch = { loss: 0, droop: 0, wither: 0.45 + 0.45 * t, glow: 0, pivot: f.foot, bough: f.foot, tint: f.tint };
    // The coil is fat with the leaflets rolled up in it.
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
}

/** One leaflet: a slim blade with a wavy edge, swept toward the frond's tip and drooping a little, its edges cupped up. */
function emitLeaflet(out: PartBuilder, f: Frond, st: Station, root: { index: number; at: V3 }, side: 1 | -1, len: number, t: number, fold: (p: V3) => number): void {
  const sweep = 0.22 + 0.5 * t + 0.9 * st.coil + f.r.range(-0.08, 0.08);
  const dir = normalize(add(add(scale(st.side, side * Math.cos(sweep)), scale(st.along, Math.sin(sweep))), scale(st.face, 0.06)));
  const across = normalize(cross(st.face, dir));
  const base = root.at;
  const half = len * 0.13;
  const n = normalize(addScaled(st.face, [0, 1, 0], 0.35));
  // Tips brown and shrivel first: the outer leaflets drop at their own thresholds, the lower ones never.
  const frail = t > 0.55 && f.r.next() < ((t - 0.55) / 0.45) * 0.85;
  const ch = {
    loss: frail ? lossThreshold(f.r.next(), 0.35, 0.04) : 0,
    droop: 0,
    wither: clamp(0.35 + 0.6 * Math.pow(t, 0.8), 0, 1),
    glow: 0,
    pivot: base,
    bough: f.foot,
    tint: f.tint,
  };
  const shade = 0.55 + 0.3 * t + f.r.range(-0.06, 0.06);
  // Along the blade: how far out, how wide, how far it has drooped.
  const point = (along: number, width: number, drop: number): V3 => addScaled(addScaled(base, dir, len * along), st.face, -len * drop + Math.abs(width) * half * 0.25);
  const at = (along: number, width: number, drop: number): number => {
    const p = addScaled(point(along, width, drop), across, width * half);
    return out.vertex(p, n, shade + 0.12 * along, { ...ch, droop: fold(p), wither: clamp(ch.wither + 0.1 * along, 0, 1) });
  };
  // Lobes in and out down each edge, so the blade reads as cut leaf, not a strap.
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
