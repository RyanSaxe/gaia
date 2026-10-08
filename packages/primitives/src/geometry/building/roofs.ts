// A building's roofs: one over each mass, in the form its plan gives it
// (gabled, hipped, half-hipped, a lean-to's one slope or a turret's cone),
// covered in thatch or tiles. Each lies on the roofline its walls rise to,
// so they meet by construction. A failing roof sags and rots into holes
// over bare rafters, worst over the weak corner; a lean-to caves in about
// its high edge, the chimney topples and the smoke stops.

import type { BuildContext, BuildingPlan, Built, Mass, Rand, Resolved } from "@gaia/schema";
import type { thatchParams, tilesParams } from "../../structure.ts";
import { type Channels, PartBuilder, type V3, addScaled, clamp, cross, fbm3, lossThreshold, normalize } from "../kit.ts";
import { UP, beam, box, log, quad } from "../blocks.ts";
import { type Ruin, chimneyEnd, hipDrop, hipSlope, ruinAt, ruinOf, spanOf, still, wallTop } from "./frame.ts";
import { lump } from "./ruin.ts";

interface ProfilePoint {
  readonly b: number;
  readonly y: number;
  /** A sharp edge: the faces either side keep their own normals. */
  readonly crease?: boolean;
  /** Part of the upper surface, which takes lumps and courses. */
  readonly top?: boolean;
}

/** One mass's roof in its own terms: along its ridge (`a`) and across it (`b`), from its center. */
interface RoofFrame {
  readonly m: Mass;
  /** Unit vectors along the ridge and across the span. */
  readonly ax: V3;
  readonly bx: V3;
  /** Half the walls' length along the ridge, and half their span. */
  readonly halfLength: number;
  readonly halfSpan: number;
  readonly top: number;
  readonly rise: number;
}

function roofFrame(plan: BuildingPlan, m: Mass): RoofFrame {
  const alongX = m.ridge === "x";
  return { m, ax: alongX ? [1, 0, 0] : [0, 0, 1], bx: alongX ? [0, 0, 1] : [1, 0, 0], ...spanOf(m), top: wallTop(plan, m), rise: m.rise };
}

const roofPoint = (f: RoofFrame, a: number, b: number, y: number): V3 => [f.m.x + f.ax[0] * a + f.bx[0] * b, y, f.m.z + f.ax[2] * a + f.bx[2] * b];

/** The roof plane's underside across the span, by `b`: two slopes from the ridge, or a lean-to's one slope from its high side. */
function undersideOf(f: RoofFrame): (b: number) => number {
  if (f.m.roof === "lean-to") {
    const k = f.rise / (2 * f.halfSpan);
    return (b) => f.top + f.rise - k * (f.m.fall * b + f.halfSpan) - 0.02;
  }
  const k = f.rise / f.halfSpan;
  return (b) => f.top + f.rise - k * Math.abs(b) - 0.02;
}

/** The slope's steepness, rise over run. */
const slopeOf = (f: RoofFrame): number => (f.m.roof === "lean-to" ? f.rise / (2 * f.halfSpan) : f.rise / f.halfSpan);

/** How far a hipped end lowers the covering at (a, b), and the end's normal there. */
function hipOf(f: RoofFrame, a: number, b: number): { drop: number; n: V3 | null } {
  const drop = hipDrop(f.m, a, b, f.top);
  if (drop <= 1e-6) return { drop: 0, n: null };
  const k = hipSlope(f.m) * Math.sign(a);
  return { drop, n: normalize([f.ax[0] * k, 1, f.ax[2] * k]) };
}

/** How far past its end walls a roof reaches: a hipped roof's ends reach as far as its eaves. */
const overEnd = (f: RoofFrame, reach: number, gable: number): number => (f.m.roof === "hip" ? reach - f.halfSpan : gable);

/**
 * The vitality channels a lean-to's whole slope shares as the building
 * fails: it caves in, turning down about its high edge.
 */
function caveIn(f: RoofFrame, r: Rand): Partial<Channels> {
  if (f.m.roof !== "lean-to") return {};
  const turn = cross(f.ax, f.bx)[1] < 0 ? f.m.fall : -f.m.fall;
  const angle = 0.42 + 0.12 * r.next();
  return { fall: [f.ax[0] * turn * angle, f.ax[1] * turn * angle, f.ax[2] * turn * angle, 0.24 + 0.06 * r.next()] };
}

/** The point a slope sags and falls about: its ridge, or a lean-to's high edge. */
const hingeOf = (f: RoofFrame, a: number): V3 => roofPoint(f, a, f.m.roof === "lean-to" ? -f.m.fall * f.halfSpan : 0, f.top + f.rise);

/**
 * Extrudes a closed, counter-clockwise (b, y) profile along the ridge from
 * `a0` to `a1`, and caps both gable ends. `shape` displaces each point and
 * `chan` gives each vertex its channels and shade, and `bend` turns a
 * vertex's normal where a hipped end tilts the surface.
 */
function extrudeRoof(
  b: PartBuilder,
  f: RoofFrame,
  profile: readonly ProfilePoint[],
  a0: number,
  a1: number,
  segments: number,
  shape: (a: number, pt: ProfilePoint, normal: readonly [number, number]) => V3,
  chan: (a: number, pt: ProfilePoint) => { c: Channels; shade: number },
  bend: (a: number, pt: ProfilePoint, normal: V3) => V3 = (_a, _pt, n) => n,
): void {
  const n = profile.length;
  const seg = (i: number): [number, number] => {
    const p0 = profile[i % n] as ProfilePoint;
    const p1 = profile[(i + 1) % n] as ProfilePoint;
    const db = p1.b - p0.b;
    const dy = p1.y - p0.y;
    const l = Math.hypot(db, dy) || 1;
    return [dy / l, -db / l];
  };
  // Each profile point gives one ring vertex, or two at a crease.
  const rings: { pt: ProfilePoint; nb: number; ny: number }[][] = profile.map((pt, i) => {
    const prev = seg(i - 1 + n);
    const next = seg(i);
    if (pt.crease === true) return [{ pt, nb: prev[0], ny: prev[1] }, { pt, nb: next[0], ny: next[1] }];
    const l = Math.hypot(prev[0] + next[0], prev[1] + next[1]) || 1;
    return [{ pt, nb: (prev[0] + next[0]) / l, ny: (prev[1] + next[1]) / l }];
  });
  const rows: number[][] = [];
  for (let k = 0; k <= segments; k++) {
    const a = a0 + ((a1 - a0) * k) / segments;
    rows.push(
      rings.flatMap((ring) =>
        ring.map(({ pt, nb, ny }) => {
          const { c, shade } = chan(a, pt);
          const normal = bend(a, pt, normalize([f.bx[0] * nb, ny, f.bx[2] * nb]));
          return b.vertex(shape(a, pt, [nb, ny]), normal, shade, c);
        }),
      ),
    );
  }
  // Ring entries: the outgoing vertex of point i is its last entry, the incoming vertex of i+1 its first.
  const offsets: number[] = [];
  let total = 0;
  for (const ring of rings) {
    offsets.push(total);
    total += ring.length;
  }
  const flip = f.ax[0] * f.bx[2] - f.ax[2] * f.bx[0] > 0;
  for (let k = 0; k < segments; k++) {
    const r0 = rows[k] as number[];
    const r1 = rows[k + 1] as number[];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const iOut = (offsets[i] as number) + ((rings[i] as unknown[]).length - 1);
      const jIn = offsets[j] as number;
      const a = r0[iOut] as number;
      const bb = r0[jIn] as number;
      const c = r1[jIn] as number;
      const d = r1[iOut] as number;
      if (flip) {
        b.triangle(a, c, bb);
        b.triangle(a, d, c);
      } else {
        b.triangle(a, bb, c);
        b.triangle(a, c, d);
      }
    }
  }
  // Gable caps: a strip from each upper point down to the underside below it.
  const under = profile.filter((pt) => pt.top !== true);
  const undersideAt = (bv: number): number => {
    for (let i = 0; i + 1 < under.length; i++) {
      const p0 = under[i] as ProfilePoint;
      const p1 = under[i + 1] as ProfilePoint;
      const lo = Math.min(p0.b, p1.b);
      const hi = Math.max(p0.b, p1.b);
      if (bv >= lo - 1e-6 && bv <= hi + 1e-6) return p0.y + ((p1.y - p0.y) * (bv - p0.b)) / (p1.b - p0.b || 1);
    }
    const ends = under.map((pt) => pt.b);
    const edge = bv < Math.min(...ends) ? under.reduce((m, pt) => (pt.b < m.b ? pt : m)) : under.reduce((m, pt) => (pt.b > m.b ? pt : m));
    return edge.y;
  };
  const tops = profile.filter((pt) => pt.top === true);
  for (const [a, sign] of [[a0, -1], [a1, 1]] as const) {
    const nrm: V3 = [f.ax[0] * sign, 0, f.ax[2] * sign];
    for (let i = 0; i + 1 < tops.length; i++) {
      const t0 = tops[i] as ProfilePoint;
      const t1 = tops[i + 1] as ProfilePoint;
      const u0: ProfilePoint = { b: t0.b, y: Math.min(t0.y, undersideAt(t0.b)), top: false };
      const u1: ProfilePoint = { b: t1.b, y: Math.min(t1.y, undersideAt(t1.b)), top: false };
      const q = [t0, t1, u1, u0].map((pt) => shape(a, pt, [0, 0])) as [V3, V3, V3, V3];
      // Cut ends sit in their own shadow, darker than the courses.
      const { c, shade } = chan(a, t0);
      quad(b, q, nrm, shade - 0.2, c);
    }
  }
}

/** The eave sag a declining house shows: most at the eaves and mid-span. */
function sagOf(f: RoofFrame, a: number, b: number, reach: number): number {
  const e = clamp(Math.abs(b) / reach, 0, 1);
  const mid = Math.sin(Math.PI * clamp((a + f.halfLength + 1) / (2 * f.halfLength + 2), 0, 1));
  return 0.075 * e * e * (0.45 + 0.55 * mid);
}

/** The chimney, its cap and pot, and where its smoke rises from. A gable stack needs a free gable end; otherwise it rises through the ridge. */
function chimney(stack: PartBuilder, plan: BuildingPlan, f: RoofFrame, wanted: "gable" | "ridge" | "none", cover: number, r: Rand): V3 | null {
  if (wanted === "none") return null;
  const end = chimneyEnd(plan);
  const where = wanted === "gable" && end !== 0 ? "gable" : "ridge";
  const top = f.top;
  const ridgeY = top + f.rise;
  let base: V3;
  let foot: number;
  let width: number;
  let deep: number;
  let topple: V3;
  if (where === "gable") {
    // Against the outside face of the free gable; it topples back over the roof.
    const sign = end;
    base = roofPoint(f, sign * (f.halfLength + 0.34), 0, 0);
    topple = [-sign * f.ax[0], 0, -sign * f.ax[2]];
    foot = -0.4;
    width = 1.15;
    deep = 0.68;
  } else {
    // Through the ridge, inside its hipped ends.
    const sign = r.next() < 0.5 ? -1 : 1;
    base = roofPoint(f, sign * Math.min(f.halfLength * 0.48, Math.max(0, f.halfLength - f.halfSpan) * 0.8 + 0.2), 0, 0);
    // It topples along the ridge toward the middle of the roof, where the covering never sags.
    topple = [-sign * f.ax[0], 0, -sign * f.ax[2]];
    foot = top - 0.2;
    width = 0.78;
    deep = 0.66;
  }
  const crown = ridgeY + 0.95;
  const lean = plan.settle * 0.05 * (r.next() - 0.5);
  const courses = Math.max(3, Math.round((crown - foot) / 0.42));
  const shoulder = where === "gable" ? top * 0.8 : foot;
  // Above the break, the stack topples as one piece as the house fails:
  // back over the ridge from a gable end, or down the slope from the ridge.
  // It breaks where it leaves the covering and topples about the edge of the
  // break on the side it falls to, so it comes to rest lying along the ridge.
  const breakAt = ridgeY + cover;
  const hinge = addScaled(addScaled(addScaled(base, f.ax, lean * (breakAt - foot)), UP, breakAt), topple, deep * 0.4);
  const tip = Math.PI / 2;
  const turnAxis = normalize(cross(UP, topple));
  const falls = (y: number, wither: number): Channels =>
    y >= breakAt - 1e-3 ? still(hinge, wither, { tint: (r.next() - 0.5) * 0.04, fall: [turnAxis[0] * tip, turnAxis[1] * tip, turnAxis[2] * tip, 0.3] }) : still(addScaled(base, UP, y), wither, { tint: (r.next() - 0.5) * 0.04 });
  const center = (f.m.x - base[0]) * f.ax[0] + (f.m.z - base[2]) * f.ax[2];
  for (let k = 0; k < courses; k++) {
    const y0 = foot + ((crown - foot) * k) / courses;
    const y1 = foot + ((crown - foot) * (k + 1)) / courses;
    const narrow = y0 >= shoulder ? 0.66 : 1;
    const w = width * narrow + 0.03 * (r.next() - 0.5);
    const d = (where === "gable" && y0 >= shoulder ? deep * 0.8 : deep) + 0.02 * r.next();
    const c = addScaled(addScaled(base, f.ax, lean * (y0 - foot) + (where === "gable" && y0 >= shoulder ? Math.sign(center) * 0.06 : 0)), UP, (y0 + y1) / 2);
    box(stack, c, [f.bx, UP, f.ax], [w / 2, (y1 - y0) / 2 + 0.004, d / 2], 0.42 + 0.16 * r.next(), falls(y0, 0.35 + 0.3 * (1 - clamp(y0 / 3, 0, 1))), { bottom: k > 0 });
  }
  const capC = addScaled(addScaled(base, f.ax, lean * (crown - foot)), UP, crown + 0.06);
  box(stack, capC, [f.bx, UP, f.ax], [width * 0.66 / 2 + 0.08, 0.06, deep * 0.8 / 2 + 0.08], 0.55, falls(crown, 0.45));
  const potFrom = addScaled(capC, UP, 0.06);
  log(stack, potFrom, addScaled(potFrom, UP, 0.32), 0.13, 0.4, falls(crown, 0.5), 7);
  return addScaled(potFrom, UP, 0.4);
}

/** A few soft puffs that the smoke shader lifts, spreads and fades. Each fades away as vitality falls. */
function smoke(b: PartBuilder, at: V3, r: Rand): void {
  const puffs = 7;
  for (let i = 0; i < puffs; i++) {
    const size = 0.42 + 0.18 * r.next();
    const c: Channels = { loss: 0.42 + 0.3 * (i / puffs), droop: 0, wither: 0.7, glow: 0, pivot: at };
    const phase = (i + r.next() * 0.6) / puffs;
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const idx = corners.map(([x, y]) => b.vertex([at[0] + x * size, at[1] + y * size, at[2]], [0, 0, 1], phase, c));
    b.triangle(idx[0] as number, idx[1] as number, idx[2] as number);
    b.triangle(idx[0] as number, idx[2] as number, idx[3] as number);
  }
}

/**
 * The rafters under a roof's covering, a ridge beam and purlins: hidden
 * while the roof is whole, bare where it rots through. Over the collapse
 * they sag with the covering and some are lost. Rafters run only where the
 * slopes run, so a hipped end shows none poking through.
 */
function rafters(b: PartBuilder, debris: PartBuilder, f: RoofFrame, ruin: Ruin, reach: number, a0: number, a1: number, r: Rand): void {
  const under = undersideOf(f);
  const lean = f.m.roof === "lean-to";
  // The slopes run between the hipped ends: the whole length on a gable or a lean-to.
  const end = f.m.roof === "hip" ? Math.max(0, f.halfLength - f.halfSpan) : f.m.roof === "half-hip" ? f.halfLength - (0.45 * f.rise) / hipSlope(f.m) : a1;
  const r0 = f.m.ends[0] ? Math.max(a0, -end) : a0;
  const r1 = f.m.ends[1] ? Math.min(a1, end) : a1;
  const runs: [number, number][] = lean ? [[-f.m.fall * (f.halfSpan - 0.06), f.m.fall * (reach - 0.06)]] : [[0.06, reach - 0.06], [-0.06, -(reach - 0.06)]];
  const count = Math.max(2, Math.round((r1 - r0 - 0.3) / 0.62));
  for (let i = 0; i <= count && r1 - r0 > 0.4; i++) {
    const a = r0 + 0.15 + ((r1 - r0 - 0.3) * i) / count;
    for (const [b0, b1] of runs) {
      const zone = ruinAt(ruin, roofPoint(f, a, b1, 0));
      // A rafter hangs from the ridge beam at its head, sags about it with
      // the covering, and shrinks back onto it as it goes.
      const c: Channels = {
        loss: zone > 0.35 && r.next() < 0.5 ? lossThreshold(r.next(), 0.2, 0.04) : 0,
        droop: 0.06 + 0.3 * zone,
        wither: 0.55,
        glow: 0,
        pivot: roofPoint(f, a, b0, under(b0) - 0.09),
        tint: (r.next() - 0.5) * 0.03,
      };
      beam(b, roofPoint(f, a, b0, under(b0) - 0.09), roofPoint(f, a, b1, under(b1) - 0.09), 0.09, 0.13, UP, 0.4 + 0.1 * r.next(), c);
    }
  }
  const ridgeB = lean ? -f.m.fall * (f.halfSpan - 0.08) : 0;
  if (r1 - r0 > 0.2) beam(b, roofPoint(f, r0 + 0.05, ridgeB, under(ridgeB) - 0.1), roofPoint(f, r1 - 0.05, ridgeB, under(ridgeB) - 0.1), 0.16, 0.16, UP, 0.42, still(hingeOf(f, 0), 0.55, { droop: 0.04 }));
  for (const bv of lean ? [0] : [-f.halfSpan * 0.5, f.halfSpan * 0.5]) {
    const y = under(bv) - 0.2;
    if (r1 - r0 > 0.4) beam(b, roofPoint(f, r0 + 0.1, bv, y), roofPoint(f, r1 - 0.1, bv, y), 0.12, 0.12, UP, 0.4, still(hingeOf(f, 0), 0.55, { droop: 0.1 }));
  }
  // Below the collapsed eaves, fallen covering lies on the ground.
  const corner = { a: (ruin.x - f.m.x) * f.ax[0] + (ruin.z - f.m.z) * f.ax[2], b: (ruin.x - f.m.x) * f.bx[0] + (ruin.z - f.m.z) * f.bx[2] };
  for (let i = 0; i < 6; i++) {
    const a = corner.a + (r.next() - 0.5) * 3.2;
    const sign = lean ? f.m.fall : corner.b >= 0 ? 1 : -1;
    const p = roofPoint(f, clamp(a, a0, a1), sign * (reach + 0.2 + r.next() * 1.4), 0);
    const zone = ruinAt(ruin, p);
    const size = 0.22 + 0.2 * r.next();
    lump(debris, [p[0], size * 0.02, p[2]], [size, size * 0.3, size * 0.7], r.next() * Math.PI, 0.45, { loss: 0, droop: 0, wither: 0.7, glow: 0, pivot: [p[0], 0, p[2]], grow: clamp(0.1 + 0.25 * zone * r.next(), 0.06, 0.4) }, r);
  }
}

/** How readily a roof rots through at (a, b): most at the eaves and over the collapse, least along the ridge. */
const roofRot = (f: RoofFrame, ruin: Ruin, a: number, bv: number, reach: number): number =>
  clamp(0.34 + 0.42 * clamp(Math.abs(f.m.roof === "lean-to" ? (f.m.fall * bv + f.halfSpan) / 2 : bv) / reach, 0, 1) + 0.5 * ruinAt(ruin, roofPoint(f, a, bv, 0)), 0, 1);

/** The covering's profile across the span: its underside, then its courses up each slope and over the ridge, counter-clockwise. */
function profileOf(f: RoofFrame, reach: number, ridgeStop: number, courses: (sign: number, stop: number) => ProfilePoint[], roll: () => ProfilePoint[]): ProfilePoint[] {
  const under = undersideOf(f);
  if (f.m.roof === "lean-to") {
    const s = f.m.fall;
    const high = -s * (f.halfSpan + 0.08);
    const low = s * reach;
    // Only the slope: from the low eave up to the high side, tucked under the wall it leans on.
    const side = courses(s, -(f.halfSpan + 0.08));
    const cap: ProfilePoint = { b: high, y: side.length > 0 ? (side[s > 0 ? side.length - 1 : 0] as ProfilePoint).y : under(high), top: true, crease: true };
    const bottom: ProfilePoint[] = s > 0 ? [{ b: high, y: under(high), crease: true }, { b: low, y: under(low), crease: true }] : [{ b: low, y: under(low), crease: true }, { b: high, y: under(high), crease: true }];
    return s > 0 ? [...bottom, ...side, cap] : [...bottom, cap, ...side];
  }
  return [{ b: -reach, y: under(reach) }, { b: 0, y: under(0), crease: true }, { b: reach, y: under(reach), crease: true }, ...courses(1, ridgeStop), ...roll(), ...courses(-1, ridgeStop)];
}

function thatchSlab(roof: PartBuilder, plan: BuildingPlan, f: RoofFrame, p: Resolved<typeof thatchParams>, ruin: Ruin, seed: number, r: Rand, budget: number): { reach: number; a0: number; a1: number } {
  const k = slopeOf(f);
  const secant = Math.sqrt(1 + k * k);
  const T = p.thickness;
  const reach = f.halfSpan + p.overhang + T * 0.3;
  const under = undersideOf(f);
  const surface = (b: number): number => under(b) + T * secant;
  const lip = T * 0.22;
  const n = 4;
  // One slope's courses, from the eave in to `stop` across the span, with a rolled eave.
  const courses = (sign: number, stop: number): ProfilePoint[] => {
    const pts: ProfilePoint[] = [];
    const at = (bv: number): number => sign * bv;
    for (let i = 1; i <= 3; i++) {
      const t = (i / 4) * Math.PI;
      pts.push({ b: at(reach + Math.sin(t) * T * 0.38), y: under(at(reach)) + (1 - Math.cos(t)) * 0.5 * (surface(at(reach)) + lip - under(at(reach))), top: true });
    }
    for (let c = 0; c < n; c++) {
      const b0 = reach * (1 - c / n) * 0.98 + stop * (c / n);
      const b1 = reach * (1 - (c + 1) / n) * 0.98 + stop * ((c + 1) / n);
      pts.push({ b: at(b0), y: surface(at(b0)) + lip * (c === 0 ? 1 : 0.8), top: true, crease: c === 0 });
      pts.push({ b: at(b0 * 0.55 + b1 * 0.45), y: surface(at(b0 * 0.55 + b1 * 0.45)) + lip * 0.4, top: true });
      pts.push({ b: at(b1 + 0.04), y: surface(at(b1 + 0.04)) + 0.01, top: true, crease: c < n - 1 });
    }
    return sign > 0 ? pts : pts.reverse();
  };
  // The ridge roll over the apex.
  const roll = (): ProfilePoint[] => {
    const rr = T * 0.75;
    return Array.from({ length: 7 }, (_, i) => {
      const t = (i / 6) * Math.PI;
      return { b: Math.cos(t) * rr * 1.1, y: surface(0) - rr * 0.35 + Math.sin(t) * rr, top: true };
    });
  };
  const profile = profileOf(f, reach, 0.25, courses, roll);
  const overGable = overEnd(f, reach, p.overhang * 0.75 + 0.15);
  const a0 = -f.halfLength - overGable;
  const a1 = f.halfLength + overGable;
  const segments = Math.max(6, Math.min(Math.round((a1 - a0) / 0.45), Math.floor(budget / (2 * profile.length))));
  const fall = caveIn(f, r);
  extrudeRoof(
    roof,
    f,
    profile,
    a0,
    a1,
    segments,
    (a, pt, [nb, ny]) => {
      const bump = pt.top === true ? 0.035 * fbm3(a * 0.9, pt.b * 0.9, pt.y * 0.5, seed, 2) : 0;
      const end = Math.max(0, Math.abs(a) - f.halfLength) / overGable;
      // Gable ends round down a little, a settled roof dips mid-ridge, and hipped ends fall away.
      const dip = plan.settle * 0.14 * Math.sin(Math.PI * clamp((a - a0) / (a1 - a0), 0, 1)) + (pt.top === true && f.m.roof !== "hip" ? end * end * T * 0.35 : 0) + hipOf(f, a, pt.b).drop;
      return roofPoint(f, a, pt.b + nb * bump, pt.y + ny * bump - dip);
    },
    (a, pt) => {
      const e = clamp(Math.abs(pt.b) / reach, 0, 1);
      const nz = fbm3(a * 0.6, pt.b * 0.6, 3.1, seed + 9, 2);
      const shade = pt.top === true ? 0.52 + 0.1 * nz + 0.08 * (1 - e) : 0.3;
      return {
        shade,
        c: {
          loss: 0,
          droop: sagOf(f, a, pt.b, reach) + 0.28 * ruinAt(ruin, roofPoint(f, a, pt.b, 0)),
          wither: clamp(0.5 + 0.35 * e + 0.2 * nz, 0, 1),
          glow: 0,
          pivot: hingeOf(f, a),
          tint: 0.025 * nz,
          rot: roofRot(f, ruin, a, pt.b, reach),
          ...fall,
        },
      };
    },
    (a, pt, n0) => (pt.top === true ? (hipOf(f, a, pt.b).n ?? n0) : n0),
  );
  return { reach, a0, a1 };
}

function tileSlab(roof: PartBuilder, plan: BuildingPlan, f: RoofFrame, p: Resolved<typeof tilesParams>, ruin: Ruin, seed: number, r: Rand, budget: number): { reach: number; a0: number; a1: number } {
  const k = slopeOf(f);
  const secant = Math.sqrt(1 + k * k);
  const T = 0.16;
  const reach = f.halfSpan + p.overhang;
  const plane = undersideOf(f);
  // A gentle kick: the slope flattens over the last stretch of the eaves.
  const under = (b: number): number => {
    const down = f.m.roof === "lean-to" ? f.m.fall * b : Math.abs(b);
    const kick = Math.max(0, down - f.halfSpan + 0.1);
    return plane(b) + kick * kick * k * 0.35;
  };
  const surface = (b: number): number => under(b) + T * secant;
  const course = p.covering === "slates" ? 0.26 : p.covering === "shingles" ? 0.3 : 0.34;
  const step = p.covering === "slates" ? 0.018 : 0.03;
  const courses = (sign: number, stop: number): ProfilePoint[] => {
    const at = (bv: number): number => sign * bv;
    const pts: ProfilePoint[] = [{ b: at(reach + 0.02), y: surface(at(reach)) - T * 0.9, top: true, crease: true }];
    const n = Math.max(3, Math.round(Math.abs(reach - stop) / course));
    for (let c = 0; c < n; c++) {
      const b0 = reach + ((stop - reach) * c) / n;
      const b1 = reach + ((stop - reach) * (c + 1)) / n;
      pts.push({ b: at(b0), y: surface(at(b0)) + step, top: true, crease: true });
      pts.push({ b: at(b1 + 0.01 * Math.sign(reach - stop)), y: surface(at(b1)), top: true, crease: true });
    }
    return sign > 0 ? pts : pts.reverse();
  };
  const roll = (): ProfilePoint[] => {
    const rr = 0.13;
    return Array.from({ length: 5 }, (_, i) => {
      const t = (i / 4) * Math.PI;
      return { b: Math.cos(t) * rr * 1.6, y: surface(0) + Math.sin(t) * rr - 0.02, top: true };
    });
  };
  const profile = profileOf(f, reach, 0.18, courses, roll);
  const overGable = overEnd(f, reach, p.overhang * 0.6 + 0.12);
  const a0 = -f.halfLength - overGable;
  const a1 = f.halfLength + overGable;
  const tileW = p.covering === "pantiles" ? 0.3 : p.covering === "slates" ? 0.36 : 0.22;
  // Pantiles need a few segments per tile for their roll; each slope keeps to its share of the roofs' triangles.
  const wanted = Math.round((a1 - a0) / (p.covering === "pantiles" ? tileW / 4 : tileW));
  const segments = Math.max(8, Math.min(wanted, Math.floor(budget / (2 * profile.length))));
  const fall = caveIn(f, r);
  extrudeRoof(
    roof,
    f,
    profile,
    a0,
    a1,
    segments,
    (a, pt, [nb, ny]) => {
      const wave = p.covering === "pantiles" && pt.top === true && Math.abs(pt.b) > 0.3 ? 0.045 * Math.abs(Math.sin((Math.PI * a) / tileW)) : 0;
      const dip = plan.settle * 0.12 * Math.sin(Math.PI * clamp((a - a0) / (a1 - a0), 0, 1)) + hipOf(f, a, pt.b).drop;
      return roofPoint(f, a, pt.b + nb * wave, pt.y + ny * wave - dip);
    },
    (a, pt) => {
      const e = clamp(Math.abs(pt.b) / reach, 0, 1);
      const row = Math.floor(Math.abs(pt.b) / course);
      const col = Math.floor(a / tileW + (row % 2) * 0.5);
      const cell = fbm3(col * 1.7, row * 2.3, 0.5, seed, 1);
      const nz = fbm3(a * 0.4, pt.b * 0.4, 1.3, seed + 5, 2);
      const vary = p.covering === "pantiles" ? 0.06 : 0.12;
      const shade = pt.top === true ? 0.5 + vary * cell + 0.06 * nz : 0.28;
      return {
        shade,
        c: {
          loss: 0,
          droop: sagOf(f, a, pt.b, reach) + 0.28 * ruinAt(ruin, roofPoint(f, a, pt.b, 0)),
          wither: clamp(0.45 + 0.4 * e * e + 0.25 * nz, 0, 1),
          glow: 0,
          pivot: hingeOf(f, a),
          tint: 0.03 * cell,
          rot: roofRot(f, ruin, a, pt.b, reach),
          ...fall,
        },
      };
    },
    (a, pt, n0) => (pt.top === true ? (hipOf(f, a, pt.b).n ?? n0) : n0),
  );
  return { reach, a0, a1 };
}

/**
 * A turret's cone, in courses that step out over the ones above, over a
 * dark underside. It rots through from the eaves and over the collapse, and
 * its finial leans and falls.
 */
function cone(roof: PartBuilder, wood: PartBuilder, plan: BuildingPlan, m: Mass, thick: number, overhang: number, courseH: number, ruin: Ruin, seed: number): void {
  const top = wallTop(plan, m);
  const R = m.width / 2;
  const k = m.rise / R;
  const apex: V3 = [m.x, top + m.rise, m.z];
  const sides = 16;
  const reach = R + overhang;
  const y = (rad: number): number => top + m.rise - k * rad;
  const courses = Math.max(4, Math.round(reach / courseH));
  const rings: { rad: number; lift: number }[] = [];
  for (let c = 0; c < courses; c++) {
    const r0 = reach * (1 - c / courses);
    const r1 = reach * (1 - (c + 1) / courses);
    rings.push({ rad: r0, lift: thick }, { rad: r1 + 0.02, lift: thick * 0.55 });
  }
  rings.push({ rad: 0, lift: thick * 0.55 });
  const ch = (q: V3, rad: number): Channels => ({
    loss: 0,
    droop: 0.06 * (rad / reach) ** 2 + 0.2 * ruinAt(ruin, q),
    wither: clamp(0.5 + 0.3 * (rad / reach) + 0.15 * fbm3(q[0], q[1], q[2], seed, 2), 0, 1),
    glow: 0,
    pivot: apex,
    rot: clamp(0.34 + 0.45 * (rad / reach) + 0.5 * ruinAt(ruin, q), 0, 1),
  });
  const ring = (rad: number, lift: number, under: boolean): number[] =>
    Array.from({ length: sides + 1 }, (_, i) => {
      const t = (i / sides) * Math.PI * 2;
      const out: V3 = [Math.sin(t), 0, Math.cos(t)];
      const bump = under ? 0 : 0.03 * fbm3(out[0] * 2 + rad, rad, out[2] * 2, seed, 2);
      const q: V3 = [m.x + out[0] * rad, y(rad) + (under ? -0.02 : lift + bump), m.z + out[2] * rad];
      const n = under ? normalize([-out[0] * k, -1, -out[2] * k]) : normalize([out[0] * k, 1, out[2] * k]);
      const shade = under ? 0.25 : 0.46 + 0.1 * (1 - rad / reach) + 0.08 * fbm3(t * 3, rad * 2, 1, seed + 3, 1);
      return roof.vertex(q, n, shade, ch(q, rad));
    });
  const stitch = (lo: number[], hi: number[], flip: boolean): void => {
    for (let i = 0; i < sides; i++) {
      const [a, b, c, d] = [lo[i] as number, lo[i + 1] as number, hi[i + 1] as number, hi[i] as number];
      if (flip) {
        roof.triangle(a, c, b);
        roof.triangle(a, d, c);
      } else {
        roof.triangle(a, b, c);
        roof.triangle(a, c, d);
      }
    }
  };
  const outer = rings.map(({ rad, lift }) => ring(rad, lift, false));
  for (let j = 0; j + 1 < outer.length; j++) stitch(outer[j] as number[], outer[j + 1] as number[], false);
  // The eave's edge and the underside.
  const lip = ring(reach, 0, true);
  stitch(lip, outer[0] as number[], false);
  const inner = [reach, reach * 0.5, 0].map((rad) => ring(rad, 0, true));
  for (let j = 0; j + 1 < inner.length; j++) stitch(inner[j] as number[], inner[j + 1] as number[], true);
  // It leans and falls to lie down the cone from its foot at the apex.
  const tip = Math.PI / 2 + Math.atan(k) - 0.03;
  const finial: Channels = { loss: 0, droop: 0, wither: 0.5, glow: 0, pivot: apex, fall: [tip * Math.SQRT1_2, 0, -tip * Math.SQRT1_2, 0.3] };
  log(wood, addScaled(apex, UP, -0.1), addScaled(apex, UP, 0.7), 0.045, 0.45, finial, 6);
  box(wood, addScaled(apex, UP, 0.74), [[1, 0, 0], UP, [0, 0, 1]], [0.07, 0.07, 0.07], 0.5, finial);
}

/** Every mass's roof in one covering, the rafters under each slope, and the main body's chimney and smoke. */
/** Triangles all of a building's slopes share, by each mass's length, so a building of many masses keeps its budget. */
const ROOF_TRIANGLES = 4300;

function roofs(plan: BuildingPlan, r: Rand, slab: (roof: PartBuilder, f: RoofFrame, ruin: Ruin, seed: number, r: Rand, budget: number) => { reach: number; a0: number; a1: number }, coneStyle: { thick: number; overhang: number; course: number; cover: number }, wanted: "gable" | "ridge" | "none"): Built {
  const seed = Math.floor(r.next() * 1e6);
  const roof = new PartBuilder("roof", "solid");
  const stack = new PartBuilder("masonry", "solid");
  const puffs = new PartBuilder("smoke");
  const bare = new PartBuilder("timber", "solid");
  const ruin = ruinOf(plan);
  const lengths = plan.masses.map((m) => (m.roof === "cone" ? 0 : spanOf(m).halfLength + 0.6));
  const total = lengths.reduce((a, b) => a + b, 0);
  plan.masses.forEach((m, i) => {
    const mr = r.fork(`mass${i}`);
    if (m.roof === "cone") {
      cone(roof, bare, plan, m, coneStyle.thick, coneStyle.overhang, coneStyle.course, ruin, seed + i);
      return;
    }
    const f = roofFrame(plan, m);
    const { reach, a0, a1 } = slab(roof, f, ruin, seed + i * 31, mr, (ROOF_TRIANGLES * (lengths[i] ?? 0)) / total);
    rafters(bare, roof, f, ruin, reach, a0, a1, mr.fork("rafters"));
  });
  const vent = chimney(stack, plan, roofFrame(plan, plan.masses[0] as Mass), wanted, coneStyle.cover, r.fork("chimney"));
  if (vent !== null) smoke(puffs, vent, r.fork("smoke"));
  const parts = [roof.part(), stack.part(), bare.part()].filter((part) => part.indices.length > 0);
  if (vent !== null) parts.push(puffs.part());
  return { parts, anchors: [] };
}

export function buildThatch(p: Resolved<typeof thatchParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("thatch");
  return roofs(plan, r, (roof, f, ruin, seed, mr, budget) => thatchSlab(roof, plan, f, p, ruin, seed, mr, budget), { thick: p.thickness * 0.8, overhang: p.overhang * 0.7, course: 0.55, cover: p.thickness * 1.1 }, p.chimney);
}

export function buildTiles(p: Resolved<typeof tilesParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("tiles");
  const course = p.covering === "slates" ? 0.26 : p.covering === "shingles" ? 0.3 : 0.34;
  return roofs(plan, r, (roof, f, ruin, seed, mr, budget) => tileSlab(roof, plan, f, p, ruin, seed, mr, budget), { thick: 0.08, overhang: p.overhang * 0.6, course, cover: 0.19 }, p.chimney);
}
