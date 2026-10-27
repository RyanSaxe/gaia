// A rotunda: a ring of columns on a stepped base, carrying a ring of stone
// and a dome, calm, ordered and a little grand. A gap between two columns
// faces +z, where the world turns a landmark to meet its trail; the steps and
// the paved floor are walkable, so a walk climbs them and stands among the
// columns. Decline follows what carries what: the dome falls in first, course
// by course from its crown, each block sinking into the one below it and its
// stone heaped on the floor inside; then the ring over each pair of columns
// goes, and the columns topple one by one, each to its own side of straight
// out, breaking into drums that roll on and come to rest in the grass or
// against the lowest step, leaving the stepped base, the columns' feet and
// here and there a drum or two still standing.

import type { BuildContext, Built, Rand, Resolved } from "@gaia/schema";
import type { rotundaParams } from "../../landmark.ts";
import { type Channels, PartBuilder, type V3, clamp, cross, normalize } from "../kit.ts";
import { UP, box, log, quad, tri } from "../blocks.ts";
import { lump, nonEmpty, still } from "./shared.ts";
import { restAngle } from "./stones.ts";

type RotundaParams = Resolved<typeof rotundaParams>;

const COLUMNS = { six: 6, eight: 8, twelve: 12 } as const;
/** Meters at scale 1: the circle the columns stand on, and a column's height and radius at its foot. */
const RING = 7.5;
const COLUMN = { height: 12.5, radius: 0.6 } as const;
/** A step's rise and tread, and how far the top step reaches past the columns. */
const STEP = { rise: 0.34, tread: 0.62, margin: 1.6 } as const;
/** The stone ring over the columns: its height, and how far its cornice reaches past them. */
const ENTABLATURE = 1.9;
/** The dome's shell, and how far its foot reaches past the column circle. */
const SHELL = 0.38;
const EAVE = 0.5;
/** A column's faces, which read as flutes. */
const FLUTES = 16;
/** How much vitality apart each course of the dome goes, so each is gone before the one it rests on starts. */
const COURSE_STEP = 0.06;
/** How much sooner a piece goes than what it sinks onto the face of, which must stand whole until it is all but gone. */
const ONTO = 0.06;
/** The gap between dressed blocks, meters: a joint the light falls into. */
const JOINT = 0.022;
/** How long a column's drums are, meters. */
const DRUM = 1.6;

/** The rotunda's measures at scale 1, which the map's mark draws from too. */
export const ROTUNDA_MEASURES = { ring: RING, column: COLUMN, step: STEP, entablature: ENTABLATURE, eave: EAVE } as const;

/** A point at angle `a` and radius `rad` around the rotunda's middle, `y` up. */
const around = (a: number, rad: number, y: number): V3 => [Math.cos(a) * rad, y, Math.sin(a) * rad];

/**
 * An annular block between angles a0 and a1, radii r0 and r1 and heights y0
 * and y1: its top, outer and inner faces in `segs` facets each, its ends,
 * and with `under` its underside.
 */
function sector(b: PartBuilder, a0: number, a1: number, r0: number, r1: number, y0: number, y1: number, shade: number, ch: Channels, under = false): void {
  const segs = Math.max(1, Math.ceil(((a1 - a0) * r1) / 0.9));
  for (let k = 0; k < segs; k++) {
    const u0 = a0 + ((a1 - a0) * k) / segs;
    const u1 = a0 + ((a1 - a0) * (k + 1)) / segs;
    const um = (u0 + u1) / 2;
    const out: V3 = [Math.cos(um), 0, Math.sin(um)];
    quad(b, [around(u0, r1, y0), around(u1, r1, y0), around(u1, r1, y1), around(u0, r1, y1)], out, [shade - 0.04, shade - 0.04, shade + 0.03, shade + 0.03], ch);
    // A sector from the middle is a wedge, with no inner face: a triangle of no area would hide what rests on it from `unsupportedAt`.
    if (r0 > 0) {
      quad(b, [around(u0, r0, y0), around(u1, r0, y0), around(u1, r0, y1), around(u0, r0, y1)], [-out[0], 0, -out[2]], shade - 0.16, ch);
      quad(b, [around(u0, r0, y1), around(u1, r0, y1), around(u1, r1, y1), around(u0, r1, y1)], UP, shade + 0.07, ch);
      if (under) quad(b, [around(u0, r0, y0), around(u1, r0, y0), around(u1, r1, y0), around(u0, r1, y0)], [0, -1, 0], shade - 0.2, ch);
    } else {
      tri(b, [[0, y1, 0], around(u1, r1, y1), around(u0, r1, y1)], UP, shade + 0.07, ch);
      if (under) tri(b, [[0, y0, 0], around(u0, r1, y0), around(u1, r1, y0)], [0, -1, 0], shade - 0.2, ch);
    }
  }
  for (const [a, sign] of [[a0, -1], [a1, 1]] as const) {
    quad(b, [around(a, r0, y0), around(a, r1, y0), around(a, r1, y1), around(a, r0, y1)], [-Math.sin(a) * sign, 0, Math.cos(a) * sign], shade - 0.1, ch);
  }
}

/** A round drum of `FLUTES` faces from y0 to y1, its radius going from r0 to r1, about (x, z); with `cap`, a top. */
function drum(b: PartBuilder, x: number, z: number, y0: number, y1: number, r0: number, r1: number, shade: number, ch: Channels, cap = false): void {
  const rows = Math.max(1, Math.round((y1 - y0) / 1.6));
  const slope = (r0 - r1) / (y1 - y0);
  for (let row = 0; row < rows; row++) {
    const ya = y0 + ((y1 - y0) * row) / rows;
    const yb = y0 + ((y1 - y0) * (row + 1)) / rows;
    // A gentle swell (entasis) toward the middle of a tall shaft.
    const rad = (y: number): number => r0 + (r1 - r0) * ((y - y0) / (y1 - y0)) + (rows > 1 ? 0.04 * r0 * Math.sin(Math.PI * ((y - y0) / (y1 - y0))) : 0);
    for (let k = 0; k < FLUTES; k++) {
      const a0 = (k / FLUTES) * Math.PI * 2;
      const a1 = ((k + 1) / FLUTES) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const at = (a: number, y: number): V3 => [x + Math.cos(a) * rad(y), y, z + Math.sin(a) * rad(y)];
      const n = normalize([Math.cos(am), slope, Math.sin(am)]);
      const flute = k % 2 === 0 ? 0.03 : -0.03;
      quad(b, [at(a0, ya), at(a1, ya), at(a1, yb), at(a0, yb)], n, [shade + flute - 0.02, shade + flute - 0.02, shade + flute + 0.02, shade + flute + 0.02], ch);
    }
  }
  if (cap) {
    for (let k = 0; k < FLUTES; k++) {
      const a0 = (k / FLUTES) * Math.PI * 2;
      const a1 = ((k + 1) / FLUTES) * Math.PI * 2;
      tri(b, [[x, y1, z], [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1], [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1]], UP, shade + 0.06, ch);
    }
  }
}

/** A column's foot at angle `a` on the floor: a plinth and a round base, which stay where it stood. */
function columnFoot(b: PartBuilder, a: number, ring: number, floor: number, radius: number, ch: Channels): void {
  const [x, , z] = around(a, ring, 0);
  const axes = [[Math.cos(a), 0, Math.sin(a)], UP, [-Math.sin(a), 0, Math.cos(a)]] as const;
  const plinth = radius * 1.45;
  box(b, [x, floor + 0.11, z], axes, [plinth, 0.11, plinth], 0.56, ch);
  drum(b, x, z, floor + 0.22, floor + 0.42, radius * 1.3, radius * 1.22, 0.58, ch, true);
}

/** A column's shaft from its foot to its neck, in `DRUM`-long drums: where each starts and ends, and its girth there. */
function shaftOf(floor: number, height: number, radius: number): { foot: number; neck: number; drums: number; at: (y: number) => number } {
  const foot = floor + 0.42;
  const neck = floor + height - 0.62;
  const at = (y: number): number => {
    const t = (y - foot) / (neck - foot);
    return radius * (1 - 0.14 * t + 0.04 * Math.sin(Math.PI * t));
  };
  return { foot, neck, drums: Math.max(3, Math.round((neck - foot) / DRUM)), at };
}

/**
 * A column's shaft over its foot, in drums with a joint between each, swelling a little toward its middle, and its
 * flared capital and square abacus. The lowest `stay` drums stand on the foot whatever comes; the rest, with the
 * capital, is one piece that topples about its outer edge.
 */
function columnShaft(b: PartBuilder, a: number, ring: number, floor: number, height: number, radius: number, stay: number, stub: Channels, ch: Channels, r: Rand): void {
  const [x, , z] = around(a, ring, 0);
  const axes = [[Math.cos(a), 0, Math.sin(a)], UP, [-Math.sin(a), 0, Math.cos(a)]] as const;
  const { foot, neck, drums, at } = shaftOf(floor, height, radius);
  for (let k = 0; k < drums; k++) {
    const y0 = foot + ((neck - foot) * k) / drums;
    const y1 = foot + ((neck - foot) * (k + 1)) / drums;
    const shade = 0.56 + 0.1 * r.next();
    const own = k < stay ? stub : ch;
    drum(b, x, z, y0, y1 - JOINT * 1.5, at(y0), at(y1), shade, own);
    drum(b, x, z, y1 - JOINT * 1.5, y1, at(y1) * 0.94, at(y1) * 0.94, shade - 0.2, own, k === stay - 1);
  }
  drum(b, x, z, neck, neck + 0.12, radius * 0.95, radius * 0.95, 0.56, ch);
  drum(b, x, z, neck + 0.12, neck + 0.38, radius * 0.92, radius * 1.42, 0.6, ch);
  box(b, [x, neck + 0.5, z], axes, [radius * 1.55, 0.12, radius * 1.55], 0.62, ch);
}

/** A fallen drum's or capital's ground: where it lies and how far round it reaches, so no two lie in each other. */
interface Lying {
  readonly x: number;
  readonly z: number;
  readonly reach: number;
}

/**
 * Where a column broke as it fell: each drum that went, and its capital, lying in the grass about where it struck,
 * rolled on a little and turned, growing in as the shaft goes. One that struck the steps rolled down them and lies
 * against the lowest, along it. None lies in another or in the steps; one with nowhere to lie is left out.
 */
function fallenDrums(b: PartBuilder, centre: V3, away: number, edge: number, pieces: readonly number[], radius: number, grow: number, lying: Lying[], r: Rand): void {
  const dir: V3 = [Math.cos(away), 0, Math.sin(away)];
  const side: V3 = [-dir[2], 0, dir[0]];
  let along = 0;
  pieces.forEach((len, k) => {
    const capital = k === pieces.length - 1;
    along += len / 2;
    const d = along + r.range(0.2, 2.4);
    along += len / 2;
    // The farther a drum flew, the farther it may have rolled aside.
    const off = r.range(-1, 1) * (0.5 + 0.16 * d);
    let x = centre[0] + dir[0] * d + side[0] * off;
    let z = centre[2] + dir[2] * d + side[2] * off;
    let yaw = away + r.range(-1.3, 1.3);
    const reach = capital ? radius * 1.55 * Math.SQRT2 : Math.hypot(len / 2, radius);
    // It struck the steps and rolled down them, coming to rest against the lowest, along it.
    const out = Math.hypot(x, z);
    if (out < edge + reach) {
      const round = Math.atan2(z, x) + r.range(-0.12, 0.12);
      const rest = edge + (capital ? reach : radius) + 0.03;
      x = Math.cos(round) * rest;
      z = Math.sin(round) * rest;
      yaw = round + Math.PI / 2 + r.range(-0.08, 0.08);
    }
    // Clear of every drum already lying, pushed on outward if need be.
    for (let tries = 0; tries < 10 && lying.some((o) => Math.hypot(o.x - x, o.z - z) < o.reach + reach + 0.04); tries++) {
      const round = Math.atan2(z, x);
      x += Math.cos(round) * 0.6;
      z += Math.sin(round) * 0.6;
    }
    if (lying.some((o) => Math.hypot(o.x - x, o.z - z) < o.reach + reach + 0.04)) return;
    lying.push({ x, z, reach });
    const ch = still([x, 0, z], 0.6, { grow, tint: (r.next() - 0.5) * 0.04 });
    if (capital) {
      // The capital, upside down where it came to rest.
      box(b, [x, radius * 0.55, z], [[Math.cos(yaw), 0, Math.sin(yaw)], UP, [-Math.sin(yaw), 0, Math.cos(yaw)]], [radius * 1.5, radius * 0.55, radius * 1.5], 0.56, ch);
      return;
    }
    const u: V3 = [Math.cos(yaw) * len * 0.5, 0, Math.sin(yaw) * len * 0.5];
    log(b, [x - u[0], radius * 0.96, z - u[2]], [x + u[0], radius * 0.96, z + u[2]], radius, 0.55 + 0.1 * r.next(), ch, 12);
  });
}

/**
 * A rotunda on a stepped base, crumbling as described above. See
 * `rotundaParams`.
 */
export function buildRotunda(p: RotundaParams, ctx: BuildContext): Built {
  const r = ctx.rand.fork("rotunda");
  const s = ctx.facts.scale ?? 1;
  const stone = new PartBuilder("masonry", "solid");
  // The steps and the floor inside carry a walk up among the columns instead of stopping it.
  const steps = new PartBuilder("masonry", "walkable");
  const roof = new PartBuilder("roof", "solid");
  const n = COLUMNS[p.columns];
  const ring = RING * s;
  const height = COLUMN.height * s;
  const radius = COLUMN.radius * s;
  const count = Math.max(1, Math.round(p.steps));
  const floor = count * STEP.rise;
  const top = ring + STEP.margin;
  const edge = top + (count - 1) * STEP.tread;

  // The stepped base: each step a ring of dressed blocks standing on the ground, set with joints between them, and
  // the top one a floor of paving in rings round a middle stone. Every block is a shade and a hue of its own.
  const lay = (inner: number, outer: number, y1: number, length: number): void => {
    const blocks = Math.max(inner === 0 ? 5 : 8, Math.round((Math.PI * 2 * outer) / length));
    const turn = r.next();
    const gap = JOINT / outer;
    for (let j = 0; j < blocks; j++) {
      const a0 = ((j + turn) / blocks) * Math.PI * 2 + gap;
      const a1 = ((j + 1 + turn) / blocks) * Math.PI * 2 - gap;
      sector(steps, a0, a1, inner, outer, -0.25, y1, 0.44 + 0.24 * r.next(), still([0, 0, 0], 0.4 + 0.3 * r.next(), { tint: (r.next() - 0.5) * 0.07 }));
    }
  };
  for (let k = 0; k < count - 1; k++) lay(top + (count - 2 - k) * STEP.tread - 0.05, top + (count - 1 - k) * STEP.tread, (k + 1) * STEP.rise, 1.7);
  const paving = Math.max(2, Math.round(top / 1.5));
  for (let k = 0; k < paving; k++) lay(k === 0 ? 0 : (top * k) / paving + JOINT, (top * (k + 1)) / paving, floor, 1.4);

  // The columns, with a gap between two of them facing +z, toppling outward one by one in a seeded order.
  const angles = Array.from({ length: n }, (_, k) => Math.PI / 2 + ((k + 0.5) / n) * Math.PI * 2);
  const order = angles.map((_, k) => ({ k, u: r.next() })).sort((a, b) => a.u - b.u).map((o) => o.k);
  const falls = new Array<number>(n).fill(0);
  // A column starts to topple at its own vitality; halfway down it breaks, the shaft going as its drums come to lie
  // in the grass, so every column lies broken before vitality reaches nothing.
  order.forEach((k, m) => (falls[k] = 0.29 - (0.12 * m) / Math.max(1, n - 1) + r.range(-0.006, 0.006)));
  // Each falls to its own side of straight out, within a spread its neighbours leave room for; a few keep a drum or
  // two standing on their foot, broken off above them.
  const spread = Math.min(0.9, 5.4 / n);
  const lying: Lying[] = [];
  const shaft = shaftOf(floor, height, radius);
  angles.forEach((a, k) => {
    const away = a + r.range(-1, 1) * spread;
    const radial: V3 = [Math.cos(away), 0, Math.sin(away)];
    const centre = around(a, ring, 0);
    const stay = r.next() < 0.35 ? (r.next() < 0.5 ? 1 : 2) : 0;
    const drumLen = (shaft.neck - shaft.foot) / shaft.drums;
    const stub = shaft.foot + stay * drumLen;
    const toe: V3 = [centre[0] + radial[0] * shaft.at(stub), stub, centre[2] + radial[2] * shaft.at(stub)];
    const axis = normalize(cross(UP, radial));
    // It would come to rest once its top met the ground past the steps.
    const head = around(a, ring, floor + height);
    const reach = radius * 1.55;
    const tops: V3[] = [-1, 1].flatMap((u) => [-1, 1].map((w): V3 => [head[0] + (radial[0] * u + axis[0] * w) * reach, head[1], head[2] + (radial[2] * u + axis[2] * w) * reach]));
    const most = restAngle(tops, toe, axis, 0);
    const fall = falls[k] as number;
    const wither = 0.45 + 0.3 * r.next();
    const tint = (r.next() - 0.5) * 0.05;
    const standing = still([centre[0], floor, centre[2]], wither, { tint });
    columnFoot(stone, a, ring, floor, radius, standing);
    columnShaft(stone, a, ring, floor, height, radius, stay, standing, { loss: fall - 0.15, droop: 0, wither, glow: 0, pivot: toe, tint, fall: [axis[0] * most, axis[1] * most, axis[2] * most, fall] }, r.fork(`shaft${k}`));
    const pieces = [...Array.from({ length: shaft.drums - stay }, () => drumLen - JOINT), radius * 1.1];
    fallenDrums(stone, centre, away, edge, pieces, radius, fall - 0.15, lying, r.fork(`drums${k}`));
  });

  // The ring over the columns, in a span from each column to the next; each goes before either column under it
  // falls, sinking into the capital of the one that stands longer.
  const beam = floor + height;
  const spans = angles.map((a, k) => {
    const b = angles[(k + 1) % n] as number;
    const a1 = k === n - 1 ? b + Math.PI * 2 : b;
    const later = (falls[k] as number) < (falls[(k + 1) % n] as number) ? a : b;
    const loss = Math.max(falls[k] as number, falls[(k + 1) % n] as number) + 0.012;
    const ch = still(around(later, ring, beam - 0.3), 0.55, { loss, tint: (r.next() - 0.5) * 0.03 });
    const shade = 0.56 + 0.08 * r.next();
    // Architrave, frieze and a projecting cornice, as deep as the columns carrying them.
    const e = ENTABLATURE * s;
    sector(stone, a, a1, ring - radius * 1.3, ring + radius * 1.3, beam, beam + e * 0.45, shade, ch, true);
    sector(stone, a, a1, ring - radius * 1.2, ring + radius * 1.2, beam + e * 0.45, beam + e * 0.8, shade + 0.05, ch);
    sector(stone, a, a1, ring - radius * 1.2, ring + radius * 2, beam + e * 0.8, beam + e, shade + 0.02, ch, true);
    if (p.roof === "an open ring") sector(stone, a, a1, ring - radius * 0.75, ring + radius * 0.75, beam + e, beam + e + 0.7 * s, shade, ch);
    // What rests on a span sinks onto the middle of its top.
    return { a0: a, a1, loss, centre: around((a + a1) / 2, ring, beam + e) };
  });
  const lastSpan = Math.max(...spans.map((sp) => sp.loss));

  const fallenInside: { loss: number }[] = [];
  if (p.roof !== "an open ring") {
    const high = p.roof === "a high dome";
    let spring = beam + ENTABLATURE * s;
    // A high dome stands on a drum, which goes after the dome and before the ring it stands on.
    const drumGoes = lastSpan + ONTO;
    const seats = spans.map((sp) => sp.centre);
    if (high) {
      const drumH = 1.8 * s;
      spans.forEach((sp, k) => {
        const ch = still(sp.centre, 0.55, { loss: drumGoes + r.range(0, 0.01), tint: (r.next() - 0.5) * 0.03 });
        sector(stone, sp.a0, sp.a1, ring - radius * 1.05, ring + radius * 1.05, spring, spring + drumH, 0.55 + 0.06 * r.next(), ch);
        sector(stone, sp.a0, sp.a1, ring - radius * 1.05, ring + radius * 1.45, spring + drumH, spring + drumH + 0.3 * s, 0.6, ch, true);
        seats[k] = around((sp.a0 + sp.a1) / 2, ring, spring + drumH + 0.3 * s);
      });
      spring += drumH + 0.3 * s;
    }
    const dome = domeOf(high, (ring + EAVE * s), spring);
    const courses = high ? 5 : 4;
    const gores = n * 2;
    const open = high ? 0.86 : 1;
    const base = (high ? drumGoes : lastSpan) + ONTO;
    let topmost = 0;
    let crownSeat: V3 = [0, spring, 0];
    for (let g = 0; g < gores; g++) {
      const span = spans[Math.floor(g / 2)] as (typeof spans)[number];
      const a0 = g % 2 === 0 ? span.a0 : (span.a0 + span.a1) / 2;
      const a1 = g % 2 === 0 ? (span.a0 + span.a1) / 2 : span.a1;
      let seat = seats[Math.floor(g / 2)] as V3;
      let loss = base + r.range(0, 0.05);
      for (let k = 0; k < courses; k++) {
        const t0 = (open * k) / courses;
        const t1 = (open * (k + 1)) / courses;
        const ch = still(seat, 0.6, { loss, tint: (r.next() - 0.5) * 0.04 });
        domeBlock(stone, roof, dome, a0, a1, t0, t1, 0.48 + 0.08 * r.next(), ch);
        fallenInside.push({ loss });
        seat = dome.at((a0 + a1) / 2, (t0 + t1) / 2, 0.5);
        if (k === courses - 1 && loss > topmost) {
          topmost = loss;
          crownSeat = seat;
        }
        loss += COURSE_STEP + r.range(0, 0.012);
      }
    }
    // A high dome's lantern, or a shallow dome's finial: the first thing to go.
    const crown = still(crownSeat, 0.6, { loss: topmost + COURSE_STEP });
    const peak = dome.at(0, open, 0)[1];
    if (high) {
      const rad = dome.at(0, open, 0.5)[0] * 0.92;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        box(stone, around(a, rad, peak + 0.7 * s), [[Math.cos(a), 0, Math.sin(a)], UP, [-Math.sin(a), 0, Math.cos(a)]], [0.13 * s, 0.75 * s, 0.13 * s], 0.6, crown);
      }
      sector(stone, 0, Math.PI * 2, 0, rad + 0.15, peak + 1.45 * s, peak + 1.65 * s, 0.6, crown, true);
      const cap = domeOf(true, rad + 0.1, peak + 1.65 * s);
      for (let k = 0; k < 8; k++) domeBlock(stone, roof, cap, (k / 8) * Math.PI * 2, ((k + 1) / 8) * Math.PI * 2, 0, 1, 0.5, crown, 0.12);
      drum(stone, 0, 0, cap.at(0, 1, 0)[1] - 0.1, cap.at(0, 1, 0)[1] + 0.9 * s, 0.09 * s, 0.03 * s, 0.6, crown);
    } else {
      drum(stone, 0, 0, peak - 0.1, peak + 0.5 * s, 0.32 * s, 0.22 * s, 0.6, crown, true);
      drum(stone, 0, 0, peak + 0.5 * s, peak + 1.3 * s, 0.12 * s, 0.03 * s, 0.6, crown);
    }
  }

  // What fell in lies heaped on the floor inside, growing in as the dome goes; it stops no walker.
  const heap = r.fork("heap");
  const lumps = Math.min(28, fallenInside.length);
  for (let k = 0; k < lumps; k++) {
    const grow = (fallenInside[Math.floor((k * fallenInside.length) / lumps)] as { loss: number }).loss;
    const a = heap.next() * Math.PI * 2;
    const d = Math.sqrt(heap.next()) * (ring - 1.4 * s);
    const size = (0.3 + 0.4 * heap.next()) * s;
    lump(stone, [Math.cos(a) * d, floor + size * 0.12, Math.sin(a) * d], [size * 1.2, size * 0.6, size], heap.next() * Math.PI, 0.45 + 0.12 * heap.next(), still([Math.cos(a) * d, floor, Math.sin(a) * d], 0.6, { grow: clamp(grow, 0.05, 0.9) }), heap);
  }
  return { parts: nonEmpty([steps.part(), stone.part(), roof.part()]), anchors: [{ position: [0, floor + height, 0], normal: [0, 1, 0], size: 1 }] };
}

/** A dome's shell: the point at angle `a`, a share `t` of the way from its foot to its crown, `depth` of the way in from its outer face to its inner, with its outward normal. */
interface Dome {
  at(a: number, t: number, depth: number): V3;
  normal(a: number, t: number): V3;
}

/** A high dome rises two thirds of its foot's radius over its drum; a shallow one, a little over a third. */
function domeOf(high: boolean, foot: number, spring: number): Dome {
  const rise = high ? foot * 0.65 : foot * 0.38;
  // A shallow dome is a cap of a sphere; a high one, a quarter ellipse.
  const sphere = (foot * foot + rise * rise) / (2 * rise);
  const start = Math.asin((sphere - rise) / sphere);
  const meridian = (t: number): { rad: number; y: number; nr: number; ny: number } => {
    if (high) {
      const th = (t * Math.PI) / 2;
      const nr = Math.cos(th) / foot;
      const ny = Math.sin(th) / rise;
      const l = Math.hypot(nr, ny);
      return { rad: foot * Math.cos(th), y: rise * Math.sin(th), nr: nr / l, ny: ny / l };
    }
    const th = start + t * (Math.PI / 2 - start);
    return { rad: sphere * Math.cos(th), y: sphere * (Math.sin(th) - Math.sin(start)), nr: Math.cos(th), ny: Math.sin(th) };
  };
  return {
    at: (a, t, depth) => {
      const m = meridian(t);
      return around(a, Math.max(0, m.rad - m.nr * SHELL * depth), spring + m.y - m.ny * SHELL * depth);
    },
    normal: (a, t) => {
      const m = meridian(t);
      return [Math.cos(a) * m.nr, m.ny, Math.sin(a) * m.nr];
    },
  };
}

/**
 * One block of a dome between angles a0 and a1 and shares t0 and t1 of its
 * rise: its covering outside, dressed stone inside and at its edges, each
 * in a small grid of facets so it keeps the dome's curve.
 */
function domeBlock(stone: PartBuilder, roof: PartBuilder, d: Dome, a0: number, a1: number, t0: number, t1: number, shade: number, ch: Channels, thin = 1): void {
  const cols = 3;
  const rows = 3;
  const depth = thin;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const u0 = a0 + ((a1 - a0) * i) / cols;
      const u1 = a0 + ((a1 - a0) * (i + 1)) / cols;
      const v0 = t0 + ((t1 - t0) * j) / rows;
      const v1 = t0 + ((t1 - t0) * (j + 1)) / rows;
      const n = d.normal((u0 + u1) / 2, (v0 + v1) / 2);
      const lift = 0.1 * ((v0 + v1) / 2);
      // At a closed crown the row's top meets in one point: a triangle there, never one of no area.
      if (v1 >= 1) {
        tri(roof, [d.at(u0, v0, 0), d.at(u1, v0, 0), d.at(u0, v1, 0)], n, shade + lift, ch);
        tri(stone, [d.at(u0, v0, depth), d.at(u1, v0, depth), d.at(u0, v1, depth)], [-n[0], -n[1], -n[2]], shade - 0.12, ch);
        continue;
      }
      quad(roof, [d.at(u0, v0, 0), d.at(u1, v0, 0), d.at(u1, v1, 0), d.at(u0, v1, 0)], n, [shade + lift - 0.03, shade + lift - 0.03, shade + lift + 0.02, shade + lift + 0.02], ch);
      quad(stone, [d.at(u0, v0, depth), d.at(u1, v0, depth), d.at(u1, v1, depth), d.at(u0, v1, depth)], [-n[0], -n[1], -n[2]], shade - 0.12, ch);
    }
  }
  // Its edges, seen where a neighbour has gone.
  const edge = (p: readonly [V3, V3, V3, V3], n: V3): void => quad(stone, p, n, shade - 0.06, ch);
  for (let i = 0; i < cols; i++) {
    const u0 = a0 + ((a1 - a0) * i) / cols;
    const u1 = a0 + ((a1 - a0) * (i + 1)) / cols;
    edge([d.at(u0, t0, 0), d.at(u1, t0, 0), d.at(u1, t0, depth), d.at(u0, t0, depth)], [0, -1, 0]);
    if (t1 < 1) edge([d.at(u0, t1, 0), d.at(u1, t1, 0), d.at(u1, t1, depth), d.at(u0, t1, depth)], UP);
  }
  for (const [a, sign] of [[a0, -1], [a1, 1]] as const) {
    for (let j = 0; j < rows; j++) {
      const v0 = t0 + ((t1 - t0) * j) / rows;
      const v1 = t0 + ((t1 - t0) * (j + 1)) / rows;
      edge([d.at(a, v0, 0), d.at(a, v1, 0), d.at(a, v1, depth), d.at(a, v0, depth)], [-Math.sin(a) * sign, 0, Math.cos(a) * sign]);
    }
  }
}

