// A building's roofs: one over each mass, in the form its plan gives it
// (gabled, hipped, half-hipped, a lean-to's one slope or a turret's cone),
// covered in thatch or tiles. Each lies on the roofline its walls rise to,
// so they meet by construction. A failing roof sags and rots into holes
// over bare rafters, worst over the weak corner; a lean-to caves in about
// its high edge, the chimney topples and the smoke stops.

import { type BuildContext, type BuildingPlan, type Built, GRAIN, type Mass, type Rand, type Resolved } from "@gaia/schema";
import type { thatchParams, tilesParams } from "../../structure.ts";
import { type Channels, PartBuilder, type V3, addScaled, clamp, cross, fbm3, normalize } from "../kit.ts";
import { UP, beam, box, log } from "../blocks.ts";
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

/** A slope's covering as built: how far it reaches across the span, where it runs along the ridge, and how it caves in. */
interface Slab {
  readonly reach: number;
  readonly a0: number;
  readonly a1: number;
  readonly fall: Partial<Channels>;
}

/** The point a slope sags and falls about: its ridge, or a lean-to's high edge. */
const hingeOf = (f: RoofFrame, a: number): V3 => roofPoint(f, a, f.m.roof === "lean-to" ? -f.m.fall * f.halfSpan : 0, f.top + f.rise);

/** Where a point lies in a roof's own terms, along its ridge and across it. */
const roofCoordsOf = (f: RoofFrame, p: V3): { a: number; b: number } => ({
  a: (p[0] - f.m.x) * f.ax[0] + (p[2] - f.m.z) * f.ax[2],
  b: (p[0] - f.m.x) * f.bx[0] + (p[2] - f.m.z) * f.bx[2],
});

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
      // Cut ends sit in their own shadow, darker than the courses. Each corner takes its own point's channels, so the
      // top edge settles with the covering and the foot stays on the underside.
      const { shade } = chan(a, t0);
      const corners = [t0, t1, u1, u0];
      const ids = corners.map((pt) => b.vertex(shape(a, pt, [0, 0]), nrm, shade - 0.2, chan(a, pt).c));
      const [p0, p1, p2] = corners.slice(0, 3).map((pt) => shape(a, pt, [0, 0])) as [V3, V3, V3];
      const facing = cross([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]);
      const [i0, i1, i2, i3] = ids as [number, number, number, number];
      if (facing[0] * nrm[0] + facing[1] * nrm[1] + facing[2] * nrm[2] >= 0) {
        b.triangle(i0, i1, i2);
        b.triangle(i0, i2, i3);
      } else {
        b.triangle(i0, i2, i1);
        b.triangle(i0, i3, i2);
      }
    }
  }
}

/** The eave sag a declining house shows: most at the eaves and mid-span. */
function sagOf(f: RoofFrame, a: number, b: number, reach: number): number {
  const e = clamp(Math.abs(b) / reach, 0, 1);
  const mid = Math.sin(Math.PI * clamp((a + f.halfLength + 1) / (2 * f.halfLength + 2), 0, 1));
  return 0.075 * e * e * (0.45 + 0.55 * mid);
}

/** How a slope sags at (a, b): as `sagOf`, and more over the collapse, about the hinge its covering hangs from. */
const sagAt = (f: RoofFrame, ruin: Ruin, reach: number, a: number, bv: number): Pick<Channels, "droop" | "pivot" | "bough"> => ({
  droop: sagOf(f, a, bv, reach) + 0.28 * ruinAt(ruin, roofPoint(f, a, bv, 0)),
  pivot: hingeOf(f, a),
  bough: hingeOf(f, a),
});

/**
 * A covering's upper surface settles onto its own underside as it rots, straight below: rotten thatch slumps and
 * loose tiles lie down on their boards. Any piece of it can last to any vitality, and once it stands alone it would
 * hang its covering's thickness above the frame; settled, it lies on the boards over the rafters. It settles from its
 * rot, the eaves and the collapse first, and all of it by vitality 0.15. A lean-to's slope keeps its thickness: it
 * caves in about its high edge instead, every point turning about that.
 */
function settles(f: RoofFrame, base: V3, rot: number): Partial<Channels> {
  return f.m.roof === "lean-to" ? {} : { loss: 0.05 + 0.3 * rot, pivot: base };
}

/** The chimney, its cap and pot, and where its smoke rises from. A gable stack needs a free gable end; otherwise it rises through the ridge. */
function chimney(stack: PartBuilder, plan: BuildingPlan, f: RoofFrame, wanted: "gable" | "ridge" | "none", r: Rand): V3 | null {
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
  // It breaks at the ridge and topples about the edge of the break on the
  // side it falls to, so it comes to rest lying along the ridge beam: by then
  // the covering has rotted and settled onto its boards, and holds nothing up.
  const breakAt = ridgeY;
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
export function smoke(b: PartBuilder, at: V3, r: Rand): void {
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
 * The frame under a roof's covering: rafters down each slope, and on a
 * hipped end hip rafters along its hips and jack rafters up it from its eave,
 * a ridge beam and purlins. It is hidden while the roof is whole and bare
 * where the covering rots through. It never goes before the covering on it,
 * because any piece of covering may last: every point of it sags and falls
 * just as the covering over it does, so the covering never lifts off it.
 */
function rafters(b: PartBuilder, debris: PartBuilder, f: RoofFrame, ruin: Ruin, { reach, a0, a1, fall }: Slab, r: Rand): void {
  const under = undersideOf(f);
  const lean = f.m.roof === "lean-to";
  const hipped = (a: number): boolean => (f.m.roof === "hip" || f.m.roof === "half-hip") && f.m.ends[a < 0 ? 0 : 1];
  // A hipped end's plane begins `start` along the ridge from the middle, and meets a slope `b` across at its hip.
  const start = f.m.roof === "hip" ? Math.max(0, f.halfLength - f.halfSpan) : f.m.roof === "half-hip" ? f.halfLength - (0.45 * f.rise) / hipSlope(f.m) : Infinity;
  const hipA = (bv: number): number => start + (slopeOf(f) * Math.abs(bv)) / hipSlope(f.m);
  const hipB = (a: number): number => ((Math.abs(a) - start) * hipSlope(f.m)) / slopeOf(f);
  // A point of the frame just under the covering, on a slope or on a hipped end.
  const at = (a: number, bv: number): V3 => roofPoint(f, a, bv, under(bv) - hipOf(f, a, bv).drop - 0.09);
  // Every timber sags and falls just as the covering over it does, point for point.
  const frame = new Following(b, (p) => {
    const { a, b: bv } = roofCoordsOf(f, p);
    return { ...sagAt(f, ruin, reach, a, bv), ...fall };
  });
  // A long timber bends at its middle, so it follows the covering's sag along it rather than cutting across it.
  const timber = (head: V3, foot: V3): void => {
    const pieces = Math.hypot(foot[0] - head[0], foot[1] - head[1], foot[2] - head[2]) > 1.6 ? 2 : 1;
    beam(frame, head, foot, 0.09, 0.13, UP, 0.4 + 0.1 * r.next(), still(head, 0.55, { tint: (r.next() - 0.5) * 0.03 }), pieces);
  };
  // Rafters down each slope from the ridge, or on a hipped end's side from the hip, to the eave.
  const runs: [number, number][] = lean ? [[-f.m.fall * (f.halfSpan - 0.06), f.m.fall * (reach - 0.06)]] : [[0.06, reach - 0.06], [-0.06, -(reach - 0.06)]];
  const count = Math.max(2, Math.round((a1 - a0 - 0.3) / 0.62));
  for (let i = 0; i <= count; i++) {
    const a = a0 + 0.15 + ((a1 - a0 - 0.3) * i) / count;
    for (const [b0, b1] of runs) {
      const head = hipped(a) && Math.abs(a) > start ? Math.sign(b1) * Math.max(Math.abs(b0), hipB(a)) : b0;
      if (Math.abs(b1) - Math.abs(head) > 0.3) timber(at(a, head), at(a, b1));
    }
  }
  for (const s of [-1, 1]) {
    if (!hipped(s) || !Number.isFinite(start)) continue;
    const foot = Math.abs(s < 0 ? a0 : a1) - 0.06;
    // Hip rafters from the ridge's end down each hip, to the eave's corner or to where a half-hip's gable takes over.
    const most = Math.min(reach - 0.06, hipB(foot));
    for (const side of [-1, 1]) timber(at(s * start, 0), at(s * hipA(most), side * most));
    // Jack rafters up the end from its eave to the hips, a rafter's spacing apart.
    const n = Math.max(1, Math.round((reach - 0.1) / 0.62));
    for (let k = -n; k <= n; k++) {
      const bv = ((reach - 0.1) * k) / n;
      if (hipOf(f, s * foot, bv).drop <= 0 || foot - hipA(bv) < 0.3) continue;
      timber(at(s * hipA(bv), bv), at(s * foot, bv));
    }
  }
  // The ridge beam and purlins run between the hipped ends.
  const r0 = hipped(-1) ? Math.max(a0, -start) : a0;
  const r1 = hipped(1) ? Math.min(a1, start) : a1;
  const ridgeB = lean ? -f.m.fall * (f.halfSpan - 0.08) : 0;
  if (r1 - r0 > 0.2) beam(frame, roofPoint(f, r0 + 0.05, ridgeB, under(ridgeB) - 0.1), roofPoint(f, r1 - 0.05, ridgeB, under(ridgeB) - 0.1), 0.16, 0.16, UP, 0.42, still(hingeOf(f, 0), 0.55));
  // Purlins carry the rafters across the slopes, notched a little into them.
  for (const bv of lean ? [0] : [-f.halfSpan * 0.5, f.halfSpan * 0.5]) {
    const y = under(bv) - 0.17;
    if (r1 - r0 > 0.4) beam(frame, roofPoint(f, r0 + 0.1, bv, y), roofPoint(f, r1 - 0.1, bv, y), 0.12, 0.12, UP, 0.4, still(hingeOf(f, 0), 0.55));
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

/**
 * How readily a roof rots through at (a, b): most at the eaves and over the collapse, least along the ridge. A hipped
 * end's eave is an eave too, by how far the end has dropped from the ridge, so no tongue of covering outlasts the
 * slopes either side of it.
 */
function roofRot(f: RoofFrame, ruin: Ruin, a: number, bv: number, reach: number): number {
  const across = clamp(Math.abs(f.m.roof === "lean-to" ? (f.m.fall * bv + f.halfSpan) / 2 : bv) / reach, 0, 1);
  const drop = hipOf(f, a, bv).drop;
  const down = drop > 0 ? clamp(drop / f.rise, 0, 1) : 0;
  return clamp(0.34 + 0.42 * Math.max(across, down) + 0.5 * ruinAt(ruin, roofPoint(f, a, bv, 0)), 0, 1);
}

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

/**
 * Where a turret stands over a corner of a mass, the eave's corner past that wall corner would come out through the
 * turret's angled face there: points of the covering past a line parallel to that face, just inside it, are moved
 * back onto it, so the covering runs into the turret and its corner stays hidden.
 */
function turretCut(plan: BuildingPlan, m: Mass): (p: V3) => V3 {
  const cuts = plan.masses.flatMap((t) =>
    !t.round || t === m
      ? []
      : [-1, 1].flatMap((sx) =>
          [-1, 1].flatMap((sz) => {
            const corner = { x: m.x + (sx * m.width) / 2, z: m.z + (sz * m.depth) / 2 };
            return Math.hypot(corner.x - t.x, corner.z - t.z) < t.width / 2 ? [{ sx, sz, corner, t }] : [];
          }),
        ),
  );
  return (p) => {
    let [x, , z] = p;
    for (const { sx, sz, corner, t } of cuts) {
      if (sx * (x - corner.x) <= 0 || sz * (z - corner.z) <= 0) continue;
      const past = (sx * (x - t.x) + sz * (z - t.z)) / Math.SQRT2 - (t.width / 2 - 0.12);
      if (past <= 0) continue;
      x -= (sx * past) / Math.SQRT2;
      z -= (sz * past) / Math.SQRT2;
    }
    return [x, p[1], z];
  };
}

/**
 * Builds into another builder, each vertex taking the channels `at` its own
 * place: a frame that sags and falls just as the covering over it does, so
 * the covering never lifts off it.
 */
class Following extends PartBuilder {
  constructor(
    readonly into: PartBuilder,
    readonly at: (p: V3) => Partial<Channels>,
  ) {
    super(into.swatch, into.collision);
  }

  override vertex(p: V3, n: V3, shade: number, c: Channels, cut?: V3): number {
    return this.into.vertex(p, n, shade, { ...c, ...this.at(p) }, cut);
  }

  override triangle(a: number, b: number, c: number): void {
    this.into.triangle(a, b, c);
  }
}

/** How wide a bundle of thatch is along the ridge, meters: the straw rots a bundle at a time. */
const BUNDLE = 0.22;
/** How wide a tile is round a cone, meters: a cone rots a tile at a time. */
export const TILE = 0.27;

function thatchSlab(roof: PartBuilder, plan: BuildingPlan, f: RoofFrame, p: Resolved<typeof thatchParams>, ruin: Ruin, seed: number, r: Rand, budget: number): Slab {
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
  const cut = turretCut(plan, f.m);
  const place = (a: number, pt: ProfilePoint, [nb, ny]: readonly [number, number]): V3 => {
    const bump = pt.top === true ? 0.035 * fbm3(a * 0.9, pt.b * 0.9, pt.y * 0.5, seed, 2) : 0;
    const end = Math.max(0, Math.abs(a) - f.halfLength) / overGable;
    // Gable ends round down a little. A hipped end drops the whole slab to its eave, so its cut end would stand across
    // it as a flat board the thatch's full thickness tall: it rounds over to its eave instead, the cut no thicker than
    // the lip.
    const hipped = f.m.roof === "hip" && f.m.ends[a < 0 ? 0 : 1];
    const round = pt.top !== true ? 0 : hipped ? end * end * Math.max(0, pt.y - under(pt.b) - lip) : f.m.roof !== "hip" ? end * end * T * 0.35 : 0;
    // A settled roof dips mid-ridge, and hipped ends fall away.
    const dip = plan.settle * 0.14 * Math.sin(Math.PI * clamp((a - a0) / (a1 - a0), 0, 1)) + round + hipOf(f, a, pt.b).drop;
    return cut(roofPoint(f, a, pt.b + nb * bump, pt.y + ny * bump - dip));
  };
  extrudeRoof(
    roof,
    f,
    profile,
    a0,
    a1,
    segments,
    place,
    (a, pt) => {
      const e = clamp(Math.abs(pt.b) / reach, 0, 1);
      const nz = fbm3(a * 0.6, pt.b * 0.6, 3.1, seed + 9, 2);
      const rot = roofRot(f, ruin, a, pt.b, reach);
      const shade = pt.top === true ? 0.52 + 0.1 * nz + 0.08 * (1 - e) : 0.3;
      return {
        shade,
        c: {
          loss: 0,
          ...sagAt(f, ruin, reach, a, pt.b),
          wither: clamp(0.5 + 0.35 * e + 0.2 * nz, 0, 1),
          glow: 0,
          tint: 0.025 * nz,
          // The straw goes before the battens under it, and slumps onto them.
          rot: rot * (pt.top === true ? 1 : 0.85),
          grain: [(a - a0) / BUNDLE, (reach - Math.abs(pt.b)) / (reach / n), GRAIN.straw],
          ...(pt.top === true ? settles(f, place(a, { b: pt.b, y: under(pt.b) }, [0, 0]), rot) : {}),
          ...fall,
        },
      };
    },
    (a, pt, n0) => (pt.top === true ? (hipOf(f, a, pt.b).n ?? n0) : n0),
  );
  return { reach, a0, a1, fall };
}

function tileSlab(roof: PartBuilder, plan: BuildingPlan, f: RoofFrame, p: Resolved<typeof tilesParams>, ruin: Ruin, seed: number, r: Rand, budget: number): Slab {
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
  const cut = turretCut(plan, f.m);
  const place = (a: number, pt: ProfilePoint, [nb, ny]: readonly [number, number]): V3 => {
    const wave = p.covering === "pantiles" && pt.top === true && Math.abs(pt.b) > 0.3 ? 0.045 * Math.abs(Math.sin((Math.PI * a) / tileW)) : 0;
    const dip = plan.settle * 0.12 * Math.sin(Math.PI * clamp((a - a0) / (a1 - a0), 0, 1)) + hipOf(f, a, pt.b).drop;
    return cut(roofPoint(f, a, pt.b + nb * wave, pt.y + ny * wave - dip));
  };
  extrudeRoof(
    roof,
    f,
    profile,
    a0,
    a1,
    segments,
    place,
    (a, pt) => {
      const rot = roofRot(f, ruin, a, pt.b, reach);
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
          ...sagAt(f, ruin, reach, a, pt.b),
          wither: clamp(0.45 + 0.4 * e * e + 0.25 * nz, 0, 1),
          glow: 0,
          tint: 0.03 * cell,
          // The tiles go before the boards under them, and lie down on them.
          rot: rot * (pt.top === true ? 1 : 0.85),
          grain: [(a - a0) / tileW, (reach - Math.abs(pt.b)) / course, GRAIN.tiles],
          ...(pt.top === true ? settles(f, place(a, { b: pt.b, y: plane(pt.b) }, [0, 0]), rot) : {}),
          ...fall,
        },
      };
    },
    (a, pt, n0) => (pt.top === true ? (hipOf(f, a, pt.b).n ?? n0) : n0),
  );
  return { reach, a0, a1, fall };
}

/**
 * A turret's cone, in courses that step out over the ones above, over a
 * dark underside and its rafters. It rots through from the eaves and over
 * the collapse, a tile or bundle at a time, and its finial leans and falls.
 */
function cone(roof: PartBuilder, wood: PartBuilder, plan: BuildingPlan, m: Mass, thick: number, overhang: number, courseH: number, covering: number, ruin: Ruin, seed: number): void {
  const top = wallTop(plan, m);
  const R = m.width / 2;
  const k = m.rise / R;
  const apex: V3 = [m.x, top + m.rise, m.z];
  const sides = 16;
  const reach = R + overhang;
  const y = (rad: number): number => top + m.rise - k * rad;
  const courses = Math.max(4, Math.round(reach / courseH));
  const radOf = (c: number): number => reach * (1 - c / courses);
  // Each course goes round in a whole number of tiles or bundles, so their edges run straight down the cone and
  // meet at its seam; what is left of a course stays in pieces of that course.
  const piece = covering === GRAIN.straw ? BUNDLE : TILE;
  const around = (c: number): number => Math.max(3, Math.round((Math.PI * (radOf(c) + radOf(c + 1))) / piece));
  // It sags about its apex, most at the eaves and over the collapse.
  const sag = (q: V3, rad: number): number => 0.06 * (rad / reach) ** 2 + 0.2 * ruinAt(ruin, q);
  const ch = (q: V3, rad: number, t: number, under: boolean, c: number, up: number): Channels => ({
    loss: 0,
    droop: sag(q, rad),
    wither: clamp(0.5 + 0.3 * (rad / reach) + 0.15 * fbm3(q[0], q[1], q[2], seed, 2), 0, 1),
    glow: 0,
    pivot: apex,
    // Its covering goes before its underside, as a slope's tiles go before the boards under them.
    rot: clamp(0.34 + 0.45 * (rad / reach) + 0.5 * ruinAt(ruin, q), 0, 1) * (under ? 0.85 : 1),
    grain: [(t / (2 * Math.PI)) * around(c), c + up, covering],
  });
  // A ring of vertices round the cone at `rad`, `lift` above its plane, in course `c`, `up` of the way up it.
  const ring = (rad: number, lift: number, under: boolean, c: number, up: number): number[] =>
    Array.from({ length: sides + 1 }, (_, i) => {
      const t = (i / sides) * Math.PI * 2;
      const out: V3 = [Math.sin(t), 0, Math.cos(t)];
      const bump = under ? 0 : 0.03 * fbm3(out[0] * 2 + rad, rad, out[2] * 2, seed, 2);
      const q: V3 = [m.x + out[0] * rad, y(rad) + (under ? -0.02 : lift + bump), m.z + out[2] * rad];
      const n = under ? normalize([-out[0] * k, -1, -out[2] * k]) : normalize([out[0] * k, 1, out[2] * k]);
      const shade = under ? 0.25 : 0.46 + 0.1 * (1 - rad / reach) + 0.08 * fbm3(t * 3, rad * 2, 1, seed + 3, 1);
      return roof.vertex(q, n, shade, ch(q, rad, t, under, c, up));
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
  const band = (rings: number[][], flip: boolean): void => {
    for (let j = 0; j + 1 < rings.length; j++) stitch(rings[j] as number[], rings[j + 1] as number[], flip);
  };
  for (let c = 0; c < courses; c++) {
    const r0 = radOf(c);
    const r1 = radOf(c + 1);
    const last = c === courses - 1;
    // Each course: the butt of its tiles stepping out over the course below (the eave's edge under the first), then
    // their face, tucked under the course above; the last runs on to the apex. Its underside follows it.
    const butt = c === 0 ? ring(reach, 0, true, 0, 0) : ring(r0 + 0.02, thick * 0.55, false, c, 0);
    band([butt, ring(r0, thick, false, c, 0.05), ring(last ? 0.02 : r1 + 0.02, thick * 0.55, false, c, 0.97), ...(last ? [ring(0, thick * 0.55, false, c, 0.999)] : [])], false);
    band([ring(r0, 0, true, c, 0), ring(r1, 0, true, c, 0.999)], true);
  }
  // Rafters run down under it from the apex to the eave, one at each of its sides, so whatever is left of it lies on
  // them; each sags just as the cone over it does.
  const frame = new Following(wood, (p) => ({ droop: sag(p, Math.hypot(p[0] - m.x, p[2] - m.z)), pivot: apex }));
  for (let i = 0; i < sides; i++) {
    const t = (i / sides) * Math.PI * 2;
    const along = (rad: number): V3 => [m.x + Math.sin(t) * rad, y(rad) - 0.09, m.z + Math.cos(t) * rad];
    beam(frame, along(0.08), along(reach - 0.05), 0.07, 0.1, UP, 0.42, still(apex, 0.55));
  }
  // It leans and falls to lie down the cone from its foot at the apex.
  const tip = Math.PI / 2 + Math.atan(k) - 0.03;
  const finial: Channels = { loss: 0, droop: 0, wither: 0.5, glow: 0, pivot: apex, fall: [tip * Math.SQRT1_2, 0, -tip * Math.SQRT1_2, 0.3] };
  log(wood, addScaled(apex, UP, -0.1), addScaled(apex, UP, 0.7), 0.045, 0.45, finial, 6);
  box(wood, addScaled(apex, UP, 0.74), [[1, 0, 0], UP, [0, 0, 1]], [0.07, 0.07, 0.07], 0.5, finial);
}

/** Every mass's roof in one covering, the rafters under each slope, and the main body's chimney and smoke. */
/** Triangles all of a building's slopes share, by each mass's length, so a building of many masses keeps its budget. */
const ROOF_TRIANGLES = 4300;

function roofs(plan: BuildingPlan, r: Rand, slab: (roof: PartBuilder, f: RoofFrame, ruin: Ruin, seed: number, r: Rand, budget: number) => Slab, coneStyle: { thick: number; overhang: number; course: number; covering: number }, wanted: "gable" | "ridge" | "none"): Built {
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
      cone(roof, bare, plan, m, coneStyle.thick, coneStyle.overhang, coneStyle.course, coneStyle.covering, ruin, seed + i);
      return;
    }
    const f = roofFrame(plan, m);
    const { reach, a0, a1, fall } = slab(roof, f, ruin, seed + i * 31, mr, (ROOF_TRIANGLES * (lengths[i] ?? 0)) / total);
    rafters(bare, roof, f, ruin, { reach, a0, a1, fall }, mr.fork("rafters"));
  });
  const vent = chimney(stack, plan, roofFrame(plan, plan.masses[0] as Mass), wanted, r.fork("chimney"));
  if (vent !== null) smoke(puffs, vent, r.fork("smoke"));
  const parts = [roof.part(), stack.part(), bare.part()].filter((part) => part.indices.length > 0);
  if (vent !== null) parts.push(puffs.part());
  return { parts, anchors: [] };
}

export function buildThatch(p: Resolved<typeof thatchParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("thatch");
  return roofs(plan, r, (roof, f, ruin, seed, mr, budget) => thatchSlab(roof, plan, f, p, ruin, seed, mr, budget), { thick: p.thickness * 0.8, overhang: p.overhang * 0.7, course: 0.55, covering: GRAIN.straw }, p.chimney);
}

export function buildTiles(p: Resolved<typeof tilesParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("tiles");
  const course = p.covering === "slates" ? 0.26 : p.covering === "shingles" ? 0.3 : 0.34;
  return roofs(plan, r, (roof, f, ruin, seed, mr, budget) => tileSlab(roof, plan, f, p, ruin, seed, mr, budget), { thick: 0.08, overhang: p.overhang * 0.6, course, covering: GRAIN.tiles }, p.chimney);
}
