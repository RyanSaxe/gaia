// A windmill: a stone tower mill, a timber smock mill or a post mill, its
// sails turning on the spin channel about a windshaft tipped up a little, so
// the sails lean back over the cap and sweep clear of the widening body
// below. Sails and cap stand on the mill's front (+z). As vitality falls the
// sails' canvas or shutters tear away to bare frames and the sails slow to a
// stop (`spinAt` in @gaia/realize); then the cap, or a post mill's whole
// body, lists on its curb or post. The list turns about the windshaft
// itself, through the hub, so the sails (which turn about the same axis)
// stay on their shaft without a fall of their own. The body stands: it
// greys, its stage and boards rot through, its lamps go out, and fallen
// stone and boards gather at its foot.

import { type Anchor, type BuildContext, type Built, GRAIN, type Rand, type Resolved, type Vec3 } from "@gaia/schema";
import type { windmillParams } from "../../landmark.ts";
import { type Channels, PartBuilder, type V3, add, addScaled, clamp, cross, dot, lossThreshold, normalize, scale, sub } from "../kit.ts";
import { UP, beam, box, log, quad, tri } from "../blocks.ts";
import { lump, nonEmpty, still } from "./shared.ts";
import { COURSE, JOINT, MORTAR, angleDiff, courseSpans, ringBlock, ringNormal, ringPoint } from "./tower.ts";

type MillParams = Resolved<typeof windmillParams>;

/** The windshaft's rise above level, radians. */
const TILT = 0.14;
/** Along the windshaft, out of the front; up the sails' plane, leaning back; and across it. */
const SHAFT: V3 = [0, Math.sin(TILT), Math.cos(TILT)];
const PLANE_UP: V3 = [0, Math.cos(TILT), -Math.sin(TILT)];
const ACROSS: V3 = [1, 0, 0];
/** How far the cap lists once failing, radians, and the shown vitality it starts to at, once the sails have all but stopped; it has listed fully 0.14 lower. */
const LIST = { cap: 0.3, buck: 0.15, from: 0.16 } as const;
/** A cap's profile from its eaves to its apex: shares of its rise and of its radius. */
type Profile = readonly (readonly [number, number])[];
const OGEE: Profile = [[0, 1], [0.14, 1.05], [0.32, 0.97], [0.5, 0.8], [0.68, 0.55], [0.84, 0.3], [0.95, 0.1], [1, 0]];
const BONNET: Profile = [[0, 1], [0.12, 0.98], [0.38, 0.8], [0.62, 0.55], [0.84, 0.27], [1, 0]];

interface Parts {
  readonly stone: PartBuilder;
  readonly boards: PartBuilder;
  readonly timber: PartBuilder;
  readonly roof: PartBuilder;
  readonly glass: PartBuilder;
  /** The sails' canvas or shutters and their frames, which turn and stop no walker. */
  readonly cloth: PartBuilder;
  readonly frame: PartBuilder;
}

/** A body's shape, laid out before it is built, so the hub can stand where the sails clear it. */
interface Body {
  readonly hubY: number;
  /** The lowest a sail's tip may sweep. */
  readonly clear: number;
  /** How far forward of the mill's axis the body reaches at height `y`. */
  front(y: number): number;
  build(parts: Parts, hub: V3, r: Rand): void;
}

/** A piece of the cap or buck: it lists about the windshaft through `pivot` as the mill fails. */
const listing = (pivot: Vec3, angle: number, wither: number, extra: Partial<Channels> = {}): Channels =>
  still(pivot, wither, { ...extra, fall: [SHAFT[0] * angle, SHAFT[1] * angle, SHAFT[2] * angle, LIST.from] });

/** Boards that rot a whole length at a time: piece `k` of a run `j`. */
const board = (j: number, k: number): Vec3 => [k + 0.5, j + 0.5, GRAIN.boards];

/** An opening in a ring wall: a door or window at angle `along`, over `rows` courses from `course`, `half` radians either side. */
interface Opening {
  readonly along: number;
  readonly course: number;
  readonly rows: number;
  readonly half: number;
}

/** Courses of stone from `y0`, as the lookout tower lays them, stopping clean at each opening. */
function masonry(b: PartBuilder, sides: number, y0: number, courses: number, ch: number, wallAt: (y: number) => number, thick: number, openings: readonly Opening[], r: Rand): void {
  for (let c = 0; c < courses; c++) {
    const ya = y0 + c * ch;
    const rad = wallAt(ya + ch / 2);
    const cr = r.fork(`course${c}`);
    const open = openings.filter((o) => c >= o.course && c < o.course + o.rows);
    for (const [a0, a1] of courseSpans(sides, rad, 1.05, c % 2 === 1)) {
      const mid = (a0 + a1) / 2;
      let pieces: [number, number][] = [[a0, a1]];
      for (const o of open) {
        const at = mid + angleDiff(o.along, mid);
        pieces = pieces.flatMap(([b0, b1]): [number, number][] =>
          at + o.half <= b0 || at - o.half >= b1 ? [[b0, b1]] : ([[b0, at - o.half], [at + o.half, b1]] as [number, number][]).filter(([s, e]) => e - s > 0.02),
        );
      }
      const shade = 0.5 + 0.22 * cr.next() - (c < 2 ? 0.06 : 0);
      const wither = 0.4 + 0.45 * cr.next();
      const tint = (cr.next() - 0.5) * 0.05;
      const bulge = (cr.next() - 0.5) * 0.04;
      for (const [b0, b1] of pieces) {
        const foot = ringPoint(sides, (b0 + b1) / 2, rad - thick / 2, y0);
        ringBlock(b, sides, b0, b1, ya, ya + ch - JOINT, rad + bulge, thick, shade, still(foot, wither, { tint }), false, JOINT, rad - 0.02 - MORTAR);
      }
    }
  }
}

/** A plank door, or a window's dark pane and the lamp behind it, set into an opening of a ring wall. Lamps go out as the mill fails. */
function fill(parts: Parts, sides: number, o: Opening, y0: number, ch: number, rad: number, thick: number, door: boolean, r: Rand): void {
  const ya = y0 + o.course * ch;
  const yb = ya + o.rows * ch - JOINT;
  const corner = (a: number, y: number, d: number): V3 => ringPoint(sides, a, rad - d, y);
  const out = ringNormal(sides, o.along);
  const inset = thick * 0.55;
  const sill = corner(o.along, ya, inset);
  const span = (y: number, d: number): [V3, V3, V3, V3] => [corner(o.along - o.half, ya, d), corner(o.along + o.half, ya, d), corner(o.along + o.half, y, d), corner(o.along - o.half, y, d)];
  if (door) {
    quad(parts.timber, span(yb, inset), out, 0.42, still(sill, 0.8, { tint: 0.01 }));
    return;
  }
  quad(parts.glass, span(yb, inset), out, 0.2, still(sill, 1));
  const lit: Channels = { loss: lossThreshold(r.next(), 0.6, 0.18), droop: 0, wither: 0.25, glow: 0.8 + 0.2 * r.next(), pivot: sill };
  quad(parts.glass, span(yb, inset - 0.02), out, [0.55, 0.55, 0.85, 0.85], lit);
}

/** A boarded stage ringing a wall at `y`, reaching `out` past it, with a rail; its boards rot through a length at a time. */
function stage(parts: Parts, sides: number, y: number, wall: number, out: number, r: Rand): void {
  const rim = wall + out;
  courseSpans(sides, rim, 1.3, false).forEach(([a0, a1], k) => {
    const u = r.next();
    const mid = (a0 + a1) / 2;
    const foot = ringPoint(sides, mid, wall - 0.2, y);
    // A board's post and the rail over it rot away with it, so none is left standing on nothing.
    const plank = still(foot, 0.6, { rot: 0.7, grain: board(1, k), tint: (u - 0.5) * 0.04 });
    ringBlock(parts.timber, sides, a0, a1, y, y + 0.14, rim, out + 0.12, 0.5 + 0.1 * u, plank, true);
    ringBlock(parts.timber, sides, a0, a1, y + 0.92, y + 1.02, rim - 0.04, 0.08, 0.52, plank, true);
    if (k % 2 === 1) return;
    const n = ringNormal(sides, a0 + 0.02);
    const t = normalize(cross(UP, n));
    const post = ringPoint(sides, a0 + 0.08 / rim, rim - 0.08, y);
    box(parts.timber, add(post, [0, 0.55, 0]), [t, UP, n], [0.06, 0.48, 0.06], 0.45, plank);
    beam(parts.timber, ringPoint(sides, a0, wall - 0.05, y - 1.1), ringPoint(sides, a0, rim - 0.2, y - 0.02), 0.14, 0.12, t, 0.42, still(foot, 0.6));
  });
}

/** A short ring of timber on a wall's head that the cap turns on, or the cap's own skirt. */
function curbRing(b: PartBuilder, sides: number, y0: number, y1: number, rad: number, thick: number, ch: (u: number) => Channels, r: Rand): void {
  for (const [a0, a1] of courseSpans(sides, rad, 1.6, false)) {
    const u = r.next();
    ringBlock(b, sides, a0, a1, y0, y1, rad, thick, 0.4 + 0.1 * u, ch(u), true);
  }
}

/** A fantail behind a tower mill's cap, which in a working mill turns the cap to face the wind: two struts carrying six vanes. It lists with the cap. */
function fantail(parts: Parts, capY: number, capR: number, hub: V3, r: Rand): void {
  const ch = listing(hub, LIST.cap, 0.65);
  const fan: V3 = [0, capY + 1.5, -capR - 1.25];
  for (const x of [-0.35, 0.35]) beam(parts.timber, [x, capY + 0.1, -capR * 0.75], [x * 0.4, fan[1] - 0.1, fan[2]], 0.1, 0.1, [1, 0, 0], 0.42, ch);
  log(parts.timber, [-0.3, fan[1], fan[2]], [0.3, fan[1], fan[2]], 0.09, 0.42, ch, 6);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + r.next() * 0.1;
    const e: V3 = [0, Math.cos(a), Math.sin(a)];
    const t: V3 = [0, -Math.sin(a), Math.cos(a)];
    // Each vane is pitched a little across its arm, as a fan's are.
    const pitched = normalize(addScaled(t, ACROSS, 0.5));
    box(parts.cloth, addScaled(fan, e, 0.75), [e, pitched, normalize(cross(e, pitched))], [0.5, 0.17, 0.015], 0.55, ch);
    beam(parts.timber, fan, addScaled(fan, e, 1.25), 0.05, 0.05, ACROSS, 0.42, ch);
  }
}

/** A flat floor across a ring wall at `y`, facing up (`facing` 1) or down (-1), so a look over the head never sees into the hollow below. */
function fan(b: PartBuilder, sides: number, y: number, rad: number, facing: 1 | -1, shade: number, ch: Channels): void {
  const n = sides === 0 ? 16 : sides;
  const off = sides === 0 ? 0 : Math.PI / sides;
  const k = sides === 0 ? 1 : 1 / Math.cos(Math.PI / sides);
  for (let i = 0; i < n; i++) {
    const a0 = off + (i / n) * Math.PI * 2;
    const a1 = off + ((i + 1) / n) * Math.PI * 2;
    tri(b, [[0, y, 0], [Math.cos(a0) * rad * k, y, Math.sin(a0) * rad * k], [Math.cos(a1) * rad * k, y, Math.sin(a1) * rad * k]], [0, facing, 0], shade, ch);
  }
}

/** A turning cap over a ring wall's head: a domed roof of `profile`, smooth on a round tower, faceted on a polygon, and a finial. */
function dome(parts: Parts, sides: number, y0: number, rad: number, rise: number, profile: Profile, ch: (u: number) => Channels, r: Rand): void {
  const n = sides === 0 ? 20 : sides;
  const off = sides === 0 ? 0 : Math.PI / sides;
  const corner = sides === 0 ? 1 : 1 / Math.cos(Math.PI / sides);
  const at = (a: number, i: number): V3 => {
    const [t, f] = profile[i] as readonly [number, number];
    return [Math.cos(a) * rad * f * corner, y0 + rise * t, Math.sin(a) * rad * f * corner];
  };
  /** Outward and up across the profile at ring `i`, averaged over the bands either side. */
  const slope = (i: number): [number, number] => {
    const p = profile[Math.max(0, i - 1)] as readonly [number, number];
    const q = profile[Math.min(profile.length - 1, i + 1)] as readonly [number, number];
    const l = Math.hypot(rise * (q[0] - p[0]), rad * (q[1] - p[1]));
    return [(rise * (q[0] - p[0])) / l, (-rad * (q[1] - p[1])) / l];
  };
  for (let k = 0; k < n; k++) {
    const a0 = off + (k / n) * Math.PI * 2;
    const a1 = off + ((k + 1) / n) * Math.PI * 2;
    const c = ch(r.next());
    for (let i = 0; i + 1 < profile.length; i++) {
      const vs = [[a0, i], [a1, i], [a1, i + 1], [a0, i + 1]].map(([a, j]) => {
        const [out, up] = slope(j as number);
        const face = sides === 0 ? (a as number) : (a0 + a1) / 2;
        const shade = 0.4 + 0.18 * ((profile[j as number] as readonly [number, number])[0] as number);
        return parts.roof.vertex(at(a as number, j as number), normalize([Math.cos(face) * out, up, Math.sin(face) * out]), shade, c);
      }) as [number, number, number, number];
      parts.roof.triangle(vs[0], vs[2], vs[1]);
      if (i + 2 < profile.length) parts.roof.triangle(vs[0], vs[3], vs[2]);
    }
    tri(parts.roof, [at(a0, 0), at(a1, 0), [0, y0, 0]], [0, -1, 0], 0.12, c);
  }
  const top = y0 + rise;
  const c = ch(0.5);
  log(parts.timber, [0, top - 0.15, 0], [0, top + 0.9, 0], 0.07, 0.4, c, 6);
  box(parts.timber, [0, top + 0.42, 0], [[1, 0, 0], UP, [0, 0, 1]], [0.16, 0.16, 0.16], 0.45, c);
}

/** Lapped weatherboards over a flat face from corner `a` to corner `b` (each where it stands at a height), from `y0` to `y1`, rotting through a length at a time; with the dark lining behind them, so a hole shows the frame, never the sky. */
function boarded(parts: Parts, run: number, a: (y: number) => V3, b: (y: number) => V3, y0: number, y1: number, ch: (grain: (q: Vec3) => Vec3) => Channels, lining: Channels, r: Rand): void {
  const rows = Math.max(4, Math.round((y1 - y0) / 0.3));
  const bh = (y1 - y0) / rows;
  const side = normalize(cross(sub(b(y0), a(y0)), UP));
  const mid = add(a(y0), b(y0));
  const n0 = side[0] * mid[0] + side[2] * mid[2] < 0 ? scale(side, -1) : side;
  const out = (p: V3, d: number): V3 => addScaled(p, n0, d);
  const along = normalize(sub(b(y0), a(y0)));
  for (let k = 0; k < rows; k++) {
    const ya = y0 + k * bh;
    const yb = ya + bh + 0.01;
    const grain = (q: Vec3): Vec3 => [dot(q, along) / 1.7 + run * 13, run * 7 + k + 0.5, GRAIN.boards];
    const c = ch(grain);
    const shade = 0.5 + 0.1 * r.next() + (k % 2) * 0.03;
    quad(parts.boards, [out(a(ya), 0.05), out(b(ya), 0.05), b(yb), a(yb)], normalize(addScaled(n0, UP, 0.16)), shade, c);
    quad(parts.boards, [a(ya), b(ya), out(b(ya), 0.05), out(a(ya), 0.05)], [0, -1, 0], 0.18, c);
  }
  quad(parts.timber, [out(a(y0), -0.12), out(b(y0), -0.12), out(b(y1), -0.12), out(a(y1), -0.12)], n0, 0.08, lining);
}

/**
 * A small window over boards: a frame, its dark pane and the lamp behind it. A lamp goes out as the mill fails,
 * shrinking onto the window; one in a listing body, whose pivot is what it lists about, only dims.
 */
function boardWindow(parts: Parts, at: V3, n: V3, half: number, ch: Channels, r: Rand): void {
  const t = normalize(cross(UP, n));
  const p = (x: number, y: number, d: number): V3 => addScaled(addScaled(addScaled(at, t, x), UP, y), n, d);
  box(parts.timber, p(0, 0, 0.06), [t, UP, n], [half + 0.1, half * 1.3 + 0.1, 0.05], 0.38, ch);
  const pane = (d: number): [V3, V3, V3, V3] => [p(-half, -half * 1.3, d), p(half, -half * 1.3, d), p(half, half * 1.3, d), p(-half, half * 1.3, d)];
  quad(parts.glass, pane(0.12), n, 0.2, ch);
  const out = ch.fall === undefined ? lossThreshold(r.next(), 0.6, 0.18) : 0;
  quad(parts.glass, pane(0.13), n, [0.55, 0.55, 0.85, 0.85], { ...ch, loss: out, wither: 0.25, glow: 0.8 + 0.2 * r.next() });
}

/** What gathers at the foot as the mill fails: fallen stones and boards, growing in, never in a walker's way. */
function fallen(parts: Parts, foot: number, stones: number, r: Rand): void {
  for (let i = 0; i < stones + 6; i++) {
    const a = r.next() * Math.PI * 2;
    const d = foot + 0.4 + Math.pow(r.next(), 1.6) * 3;
    const at: V3 = [Math.cos(a) * d, 0, Math.sin(a) * d];
    const grow = clamp(0.08 + 0.45 * r.next(), 0.06, 0.55);
    if (i < stones) {
      const s = 0.25 + 0.3 * r.next();
      lump(parts.stone, [at[0], s * 0.1, at[2]], [s, s * 0.6, s * 0.8], r.next() * Math.PI, 0.42 + 0.15 * r.next(), still(at, 0.6, { grow }), r);
      continue;
    }
    const yaw = r.next() * Math.PI;
    box(parts.timber, [at[0], 0.04, at[2]], [[Math.cos(yaw), 0, Math.sin(yaw)], UP, [-Math.sin(yaw), 0, Math.cos(yaw)]], [0.8 + 0.6 * r.next(), 0.03, 0.11], 0.45, still(at, 0.7, { grow }));
  }
}

function towerMill(h: number): Body {
  const curb = h * 0.76;
  const r0 = h * 0.2;
  const r1 = h * 0.118;
  const courses = Math.max(10, Math.round(curb / COURSE));
  const ch = curb / courses;
  const wallAt = (y: number): number => r0 + (r1 - r0) * clamp(y / curb, 0, 1);
  const stageC = Math.round(courses * 0.3);
  const stageY = stageC * ch;
  const capY = curb + 0.32;
  const capR = r1 + 0.42;
  const rise = h - capY - 0.9;
  return {
    hubY: capY + rise * 0.28,
    clear: stageY + 1.6,
    front: (y) => (y > capY ? capR * profileAt(OGEE, (y - capY) / rise) : wallAt(y) + (Math.abs(y - stageY - 0.4) < 0.8 ? 1.25 : 0)),
    build(parts, hub, r) {
      const thick = r0 * 0.24;
      const openings: Opening[] = [{ along: 1.0, course: 0, rows: 4, half: 0.5 / r0 }];
      const turns = [1.55, 0.45, 2.3, 1.15, 1.95];
      for (let c = 5, i = 0; c + 3 < courses; c += 4 + Math.floor(r.next() * 2), i++) {
        if (c + 2 >= stageC - 1 && c <= stageC + 1) continue;
        openings.push({ along: (turns[i % turns.length] as number) + (r.next() - 0.5) * 0.3, course: c, rows: 2, half: 0.32 / wallAt(c * ch) });
      }
      masonry(parts.stone, 0, 0, courses, ch, wallAt, thick, openings, r.fork("courses"));
      openings.forEach((o, i) => fill(parts, 0, o, 0, ch, wallAt(o.course * ch + ch), thick, i === 0, r));
      stage(parts, 0, stageY, wallAt(stageY), 1.15, r.fork("stage"));
      curbRing(parts.timber, 0, curb - 0.05, curb + 0.3, r1 + 0.12, 0.45, () => still([0, curb, 0], 0.6), r);
      fan(parts.timber, 0, curb + 0.28, r1 + 0.1, 1, 0.3, still([0, curb, 0], 0.6));
      cap(parts, 0, capY, capR, rise, OGEE, hub, r);
      fantail(parts, capY, capR, hub, r);
      fallen(parts, r0, 16, r.fork("fallen"));
    },
  };
}

function smockMill(h: number): Body {
  const base = h * 0.2;
  const curb = h * 0.77;
  const rb = h * 0.2;
  const s0 = h * 0.185;
  const s1 = h * 0.112;
  const smockAt = (y: number): number => s0 + (s1 - s0) * clamp((y - base) / (curb - base), 0, 1);
  const capY = curb + 0.3;
  const capR = s1 + 0.38;
  const rise = h - capY - 0.9;
  return {
    hubY: capY + rise * 0.3,
    clear: base + 1.7,
    front: (y) => (y > capY ? capR * profileAt(BONNET, (y - capY) / rise) : y < base + 1.2 && y > base - 1.2 ? rb + 1.15 : y < base ? rb : smockAt(y)),
    build(parts, hub, r) {
      // A stone base with a door, and a stage round its head.
      const courses = Math.max(4, Math.round(base / COURSE));
      const ch = base / courses;
      const door: Opening = { along: Math.PI / 4, course: 0, rows: 4, half: 0.5 / rb };
      masonry(parts.stone, 8, 0, courses, ch, () => rb, rb * 0.22, [door], r.fork("courses"));
      fill(parts, 8, door, 0, ch, rb, rb * 0.22, true, r);
      stage(parts, 8, base, rb, 1.05, r.fork("stage"));
      // The smock: eight boarded faces leaning in, a post at every corner.
      const sector = Math.PI / 4;
      const cornerAt = (a: number) => (y: number): V3 => ringPoint(8, a, smockAt(y), y);
      for (let j = 0; j < 8; j++) {
        const mid = j * sector;
        const foot = ringPoint(8, mid, smockAt(base) - 0.3, base);
        boarded(parts, j, cornerAt(mid - sector / 2 + 1e-4), cornerAt(mid + sector / 2 - 1e-4), base + 0.05, curb, (grain) => still(foot, 0.6, { rot: 0.55, grain }), still(foot, 0.5), r);
        const edge = mid + sector / 2;
        beam(parts.timber, ringPoint(8, edge, smockAt(base) + 0.04, base), ringPoint(8, edge, smockAt(curb) + 0.04, curb), 0.2, 0.2, ringNormal(8, mid), 0.4, still(foot, 0.6));
      }
      for (const [j, y] of [[2, 0.46], [1, 0.62], [3, 0.36], [6, 0.52]] as const) {
        const yy = h * y;
        boardWindow(parts, ringPoint(8, j * sector, smockAt(yy), yy), ringNormal(8, j * sector), 0.3, still(ringPoint(8, j * sector, smockAt(yy), yy), 0.6), r);
      }
      curbRing(parts.timber, 8, curb - 0.05, curb + 0.28, s1 + 0.1, 0.4, () => still([0, curb, 0], 0.6), r);
      fan(parts.timber, 8, curb + 0.26, s1 + 0.08, 1, 0.3, still([0, curb, 0], 0.6));
      cap(parts, 8, capY, capR, rise, BONNET, hub, r);
      fallen(parts, rb, 6, r.fork("fallen"));
    },
  };
}

/** A tower's or smock's cap: its skirt, a floor over the wall's head, and the dome, all listing about the windshaft as the mill fails. */
function cap(parts: Parts, sides: number, y0: number, rad: number, rise: number, profile: Profile, hub: V3, r: Rand): void {
  const ch = (u: number): Channels => listing(hub, LIST.cap, 0.7, { tint: (u - 0.5) * 0.04 });
  curbRing(parts.timber, sides, y0 - 0.32, y0 + 0.02, rad - 0.02, 0.14, ch, r);
  fan(parts.timber, sides, y0 - 0.3, rad - 0.1, -1, 0.15, ch(0.5));
  dome(parts, sides, y0, rad, rise, profile, ch, r);
}

function postMill(h: number): Body {
  const W = h * 0.25;
  const D = h * 0.34;
  const yb = h * 0.3;
  const ye = h * 0.78;
  const reach = h * 0.2;
  const crown: V3 = [0, yb + 0.9, 0];
  return {
    hubY: ye + (h - ye) * 0.3,
    clear: 2.4,
    front: (y) => (y >= yb - 0.3 ? D / 2 + 0.12 : y < yb * 0.75 ? reach * 0.75 : 0.5),
    build(parts, _hub, r) {
      // The trestle: two cross-trees on four piers, quarter bars up to the post.
      const diag = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
      for (const a of diag) {
        const [x, z] = [Math.cos(a) * reach, Math.sin(a) * reach];
        box(parts.stone, [x, 0.3, z], [[Math.cos(a), 0, Math.sin(a)], UP, [-Math.sin(a), 0, Math.cos(a)]], [0.5, 0.38, 0.45], 0.5, still([x, 0, z], 0.6));
        beam(parts.timber, [x * 0.9, 0.95, z * 0.9], [x * 0.1, yb * 0.7, z * 0.1], 0.26, 0.24, UP, 0.44, still([x, 0, z], 0.6));
      }
      for (const a of diag.slice(0, 2)) beam(parts.timber, [Math.cos(a) * reach, 0.8, Math.sin(a) * reach], [-Math.cos(a) * reach, 0.8, -Math.sin(a) * reach], 0.34, 0.32, UP, 0.42, still([0, 0, 0], 0.6));
      log(parts.timber, [0, 0.7, 0], crown, 0.34, 0.42, still([0, 0, 0], 0.6), 8);
      // The buck: a boarded body on the post, its gabled roof, windows, a door and ladder behind and a tail pole.
      const ch = (u: number, extra: Partial<Channels> = {}): Channels => listing(crown, LIST.buck, 0.65, { tint: (u - 0.5) * 0.04, ...extra });
      const corners: V3[] = [[-W / 2, 0, D / 2], [W / 2, 0, D / 2], [W / 2, 0, -D / 2], [-W / 2, 0, -D / 2]];
      const at = (c: V3) => (y: number): V3 => [c[0], y, c[2]];
      box(parts.timber, [0, yb + 0.1, 0], [[1, 0, 0], UP, [0, 0, 1]], [W / 2 + 0.04, 0.12, D / 2 + 0.04], 0.3, ch(0.5));
      corners.forEach((c, j) => {
        const next = corners[(j + 1) % 4] as V3;
        boarded(parts, j, at(c), at(next), yb + 0.2, ye, (grain) => ch(r.next(), { rot: 0.5, grain }), ch(0.5), r);
        beam(parts.timber, [c[0] * 1.02, yb + 0.1, c[2] * 1.01], [c[0] * 1.02, ye, c[2] * 1.01], 0.2, 0.2, normalize([c[0], 0, c[2]]), 0.4, ch(0.5));
      });
      const o = 0.32;
      const eave = (x: number, z: number): V3 => [x * (W / 2 + o), ye - 0.12, z];
      const ridge = (z: number): V3 => [0, h, z];
      for (const side of [-1, 1]) {
        const n = normalize([side * (h - ye), W / 2 + o, 0]);
        const e0 = eave(side, -D / 2 - o);
        const e1 = eave(side, D / 2 + o);
        const r0 = ridge(-D / 2 - o);
        const r1 = ridge(D / 2 + o);
        for (const [t0, t1] of [[0, 0.35], [0.35, 0.7], [0.7, 1]] as const) {
          quad(parts.roof, [add(e0, scale(sub(r0, e0), t0)), add(e1, scale(sub(r1, e1), t0)), add(e1, scale(sub(r1, e1), t1)), add(e0, scale(sub(r0, e0), t1))], n, 0.42 + 0.14 * t0, ch(r.next()));
        }
        quad(parts.roof, [e0, e1, [side * W * 0.4, ye, D / 2], [side * W * 0.4, ye, -D / 2]], [0, -1, 0], 0.12, ch(0.5));
      }
      for (const z of [D / 2, -D / 2]) {
        tri(parts.boards, [[-W / 2, ye - 0.02, z], [W / 2, ye - 0.02, z], [0, h - 0.05, z]], [0, 0, Math.sign(z)], 0.52, ch(0.5, { rot: 0.4, grain: board(9, z > 0 ? 1 : 2) }));
      }
      for (const [x, z, nx, nz] of [[W / 2, D * 0.18, 1, 0], [W / 2, -D * 0.22, 1, 0], [-W / 2, D * 0.12, -1, 0], [0, D / 2, 0, 1]] as const) {
        boardWindow(parts, [x, yb + (ye - yb) * (z > 0 ? 0.62 : 0.4), z], [nx, 0, nz], 0.28, ch(0.5), r);
      }
      quad(parts.timber, [[-0.45, yb + 0.2, -D / 2 - 0.06], [0.45, yb + 0.2, -D / 2 - 0.06], [0.45, yb + 2.1, -D / 2 - 0.06], [-0.45, yb + 2.1, -D / 2 - 0.06]], [0, 0, -1], 0.36, ch(0.5));
      const foot = -D / 2 - yb * 0.75;
      for (const x of [-0.5, 0.5]) beam(parts.timber, [x, yb + 0.15, -D / 2 - 0.1], [x * 1.15, 0.05, foot], 0.16, 0.08, [x, 0, 0], 0.42, ch(0.5));
      for (let k = 1; k * 0.34 < yb; k++) {
        const t = (k * 0.34) / yb;
        const y = 0.05 + (yb + 0.1) * (1 - t);
        const z = foot + (-D / 2 - 0.1 - foot) * (1 - t);
        log(parts.timber, [-0.52, y, z], [0.52, y, z], 0.035, 0.45, ch(0.5, { rot: 0.5, grain: board(11, k) }), 5);
      }
      beam(parts.timber, [0, yb + 0.05, -D / 2 + 0.4], [0, 0.85, -D / 2 - yb * 1.3], 0.24, 0.2, UP, 0.4, ch(0.5));
      fallen(parts, reach, 4, r.fork("fallen"));
    },
  };
}

/** A profile's share of its radius at share `t` of its rise; 1 below the eaves, 0 above the apex. */
function profileAt(profile: Profile, t: number): number {
  if (t <= 0) return 1;
  for (let i = 0; i + 1 < profile.length; i++) {
    const [t0, f0] = profile[i] as readonly [number, number];
    const [t1, f1] = profile[i + 1] as readonly [number, number];
    if (t <= t1) return f0 + ((f1 - f0) * (t - t0)) / (t1 - t0);
  }
  return 0;
}

/**
 * The sails: whips from the hub, each carrying a frame of bars and hemlaths
 * twisted from a steep weather at the heel to a flatter one at the tip, and
 * canvas or shutters on its trailing side. Everything turns about the
 * windshaft; canvas tears through and shutters and a few bars rot away as
 * the mill fails, leaving the bare frames.
 */
function sails(parts: Parts, hub: V3, count: number, R: number, shutters: boolean, shaft: number, r: Rand): void {
  const rate = count === 6 ? 0.12 : 0.15;
  const turning = (wither: number, extra: Partial<Channels> = {}): Channels => ({ loss: 0, droop: 0, wither, glow: 0, pivot: hub, spin: scale(SHAFT, rate), ...extra });
  // The poll end and the windshaft running back into the cap.
  box(parts.frame, addScaled(hub, SHAFT, 0.15), [ACROSS, PLANE_UP, SHAFT], [0.34, 0.34, 0.38], 0.45, turning(0.6));
  log(parts.frame, hub, addScaled(hub, SHAFT, -shaft), 0.22, 0.4, turning(0.6), 8);
  const inner = R * (count === 6 ? 0.26 : 0.2);
  const width = R * (count === 6 ? 0.17 : 0.22);
  const lead = width * 0.18;
  const trail = width - lead;
  const bars = Math.max(8, Math.round((R - inner) / 0.55));
  const start = count === 6 ? 0.3 : Math.PI / 4;
  for (let k = 0; k < count; k++) {
    const phi = start + (k / count) * Math.PI * 2;
    const e = add(scale(ACROSS, Math.cos(phi)), scale(PLANE_UP, Math.sin(phi)));
    // Which way the sail moves as it turns: its leading edge.
    const t = sub(scale(PLANE_UP, Math.cos(phi)), scale(ACROSS, Math.sin(phi)));
    const at = (u: number, v: number, lift = 0): V3 => {
      const w = 0.36 - 0.22 * clamp((u - inner) / (R - inner), 0, 1);
      return addScaled(addScaled(addScaled(hub, e, u), t, v * Math.cos(w)), SHAFT, v * Math.sin(w) + lift);
    };
    const tint = (r.next() - 0.5) * 0.04;
    beam(parts.frame, at(0.3, 0, 0.12), at(R + 0.2, 0, 0.12), 0.24, 0.2, t, 0.46, turning(0.6, { tint }));
    const us = Array.from({ length: bars + 1 }, (_, j) => inner + ((R - inner) * j) / bars);
    us.forEach((u, j) => beam(parts.frame, at(u, -trail, 0.03), at(u, lead, 0.03), 0.05, 0.06, SHAFT, 0.5, turning(0.6, { tint, rot: 0.55, grain: board(k * 3, j) })));
    for (let j = 0; j < bars; j++) {
      const [u0, u1] = [us[j] as number, us[j + 1] as number];
      for (const v of [-trail, -trail / 2]) beam(parts.frame, at(u0, v, 0.02), at(u1, v, 0.02), 0.07, 0.06, SHAFT, 0.48, turning(0.6, { tint }));
      beam(parts.frame, at(u0, lead * 0.55, 0.02), at(u1, lead * 0.55, 0.02), lead * 0.9, 0.04, t, 0.5, turning(0.6, { tint }));
      if (shutters) {
        // A shutter across each bay, turned a little open, going whole as it rots.
        const um = (u0 + u1) / 2;
        const c = at(um, -trail / 2 - 0.06, -0.02);
        const across = normalize(sub(at(um, -0.12), at(um, -trail)));
        const face = normalize(cross(e, across));
        const tilt = normalize(addScaled(scale(e, Math.cos(0.45)), face, Math.sin(0.45)));
        box(parts.cloth, c, [across, tilt, normalize(cross(across, tilt))], [(trail - 0.18) / 2, (u1 - u0) * 0.46, 0.02], 0.55, turning(0.5, { tint, rot: 0.95, grain: board(k * 3 + 1, j) }));
      }
    }
    if (shutters) continue;
    // Canvas spread over the front of the bars, tearing through to tatters as the mill fails.
    const across = 3;
    const v0 = -trail + 0.04;
    const v1 = -0.14;
    for (let j = 0; j < bars; j++) {
      for (let i = 0; i < across; i++) {
        const corner = (jj: number, ii: number): V3 => {
          const f = ii / across;
          return at(inner + 0.05 + ((R - inner - 0.15) * jj) / bars, v0 + (v1 - v0) * f, 0.1);
        };
        const p = [corner(j, i), corner(j, i + 1), corner(j + 1, i + 1), corner(j + 1, i)] as const;
        const n = normalize(cross(sub(p[1], p[0]), sub(p[3], p[0])));
        // A touch lighter toward the whip, so a sail reads as cloth, not a flat board.
        const [s0, s1] = [0.56 + (0.06 * i) / across, 0.56 + (0.06 * (i + 1)) / across];
        quad(parts.cloth, p, dot(n, SHAFT) < 0 ? scale(n, -1) : n, [s0, s1, s1, s0], turning(0.85, { tint, rot: 0.85 }));
      }
    }
  }
}

/** A windmill whose sails turn on its cap; see `windmillParams` for its axes. */
export function buildWindmill(p: MillParams, ctx: BuildContext): Built {
  const r = ctx.rand.fork("windmill");
  const h = p.height * (ctx.facts.scale ?? 1);
  const parts: Parts = {
    stone: new PartBuilder("masonry", "solid"),
    boards: new PartBuilder("render", "solid"),
    timber: new PartBuilder("timber", "solid"),
    roof: new PartBuilder("roof", "solid"),
    glass: new PartBuilder("glass"),
    cloth: new PartBuilder("wall"),
    frame: new PartBuilder("timber"),
  };
  const body = p.body === "a stone tower mill" ? towerMill(h) : p.body === "a timber smock mill" ? smockMill(h) : postMill(h);
  const count = p.sails === "six sails" ? 6 : 4;
  const R = Math.min(h * 0.56, (body.hubY - body.clear) / Math.cos(TILT));
  // The hub stands far enough out that every sail, at every turn, clears the body behind it.
  const setback = R * 0.07 + 0.3;
  let z = body.front(body.hubY) + 0.6;
  for (let L = -R; L <= R; L += 0.25) z = Math.max(z, body.front(body.hubY - L * Math.cos(TILT)) - L * Math.sin(TILT) + setback);
  const hub: V3 = [0, body.hubY, z];
  body.build(parts, hub, r.fork("body"));
  sails(parts, hub, count, R, p.sails === "four lattice sails", (z - body.front(body.hubY) + 0.9) / Math.cos(TILT), r.fork("sails"));
  const anchors: Anchor[] = [{ position: [0, h, 0], normal: [0, 1, 0], size: 1 }];
  return { parts: nonEmpty(Object.values(parts).map((b) => b.part())), anchors };
}
