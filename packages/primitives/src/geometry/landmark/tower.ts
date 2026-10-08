// A stone lookout tower in courses of blocks, built from a few strong axes:
// its plan (round, square or eight-sided), how it rises (straight, tapering,
// or in stages that set back on string courses), walkways on corbels, and
// its crown. Every block has its own loss threshold that rises with height,
// and never falls below the thresholds of the blocks it rests on, so as
// vitality falls the tower crumbles from the top down to a jagged stump and
// no block is ever left above a gap; rubble gathers at its foot, everything
// a course carries (galleries, the crown, its roof) goes before it, and its
// lamps go out one by one.

import type { Anchor, BuildContext, Built, Rand, Resolved } from "@gaia/schema";
import type { lookoutTowerParams } from "../../landmark.ts";
import { type Channels, LOSS_BAND, PartBuilder, type V3, clamp, cross, fbm3, lossThreshold, normalize, sub } from "../kit.ts";
import { UP, box, quad, tri } from "../blocks.ts";
import { lump, nonEmpty, still } from "./shared.ts";

/** Height of one course of stone, meters. */
const COURSE = 0.56;
/** Mortar gap between blocks, meters. */
const JOINT = 0.035;
/** Faces of each plan; 0 is round. */
const SIDES = { round: 0, square: 4, octagonal: 8 } as const;
/** How far a gallery's walkway reaches past the wall, how thick it is, and its parapet's height. */
const GALLERY = { out: 0.95, slab: 0.24, parapet: 0.9 } as const;
/** A parapet kept low, so a lantern room's glass shows above it. */
const LOW_PARAPET = 0.5;

type TowerParams = Resolved<typeof lookoutTowerParams>;

/**
 * The tower's shape: where its shaft ends, its wall's outer radius at each
 * height (the apothem on a polygon), and the heights where its stages meet.
 */
interface Shape {
  readonly sides: number;
  readonly shaft: number;
  readonly courseH: number;
  readonly courses: number;
  readonly stages: readonly number[];
  readonly wallAt: (y: number) => number;
}

function shapeOf(p: TowerParams, height: number): Shape {
  const sides = SIDES[p.plan];
  const radius = height * (p.profile === "stepped" ? 0.165 : 0.15);
  const gallery = p.galleries !== "none";
  // The shaft stops where the crown starts: a cone's eaves sit about three quarters up.
  const drum = Math.max(1.6, height * 0.1);
  const shaft =
    p.crown === "a conical roof" ? height * 0.74 - (gallery ? GALLERY.slab + drum : COURSE * 0.55)
    : p.crown === "an open lantern room" ? height * (gallery ? 0.72 : 0.78)
    : p.crown === "battlements" ? height * 0.9
    : height * 0.96;
  const courses = Math.max(8, Math.round(shaft / COURSE));
  const courseH = shaft / courses;
  const count = height >= 15 ? 3 : 2;
  // Stages meet on course joints, so a set-back never splits a block.
  const stages = Array.from({ length: count - 1 }, (_, k) => Math.round((courses * (k + 1)) / count) * courseH);
  const stageOf = (y: number): number => stages.filter((s) => y >= s).length;
  const wallAt = (y: number): number => {
    const t = clamp(y / shaft, 0, 1);
    const lean = p.profile === "tapering" ? 1 - 0.26 * t : p.profile === "stepped" ? (1 - 0.17 * stageOf(y)) * (1 - 0.04 * t) : 1 - 0.04 * t;
    return radius * lean * (y < courseH * 2 ? 1.08 : 1);
  };
  return { sides, shaft, courseH, courses, stages, wallAt };
}

/** The angle of the face center nearest `a` on a polygon of `sides` faces. */
const facetOf = (sides: number, a: number): number => {
  const sector = (Math.PI * 2) / sides;
  return Math.round(a / sector) * sector;
};

/** A point on a round wall, or on a polygonal wall whose apothem is `rad`, at angle `a`. */
function ringPoint(sides: number, a: number, rad: number, y: number): V3 {
  if (sides === 0) return [Math.cos(a) * rad, y, Math.sin(a) * rad];
  const k = rad / Math.cos(a - facetOf(sides, a));
  return [Math.cos(a) * k, y, Math.sin(a) * k];
}

function ringNormal(sides: number, a: number): V3 {
  const f = sides === 0 ? a : facetOf(sides, a);
  return [Math.cos(f), 0, Math.sin(f)];
}

/**
 * One course's blocks as angle spans about `len` meters long, shifted half a
 * block on odd courses. On a polygon every corner is a joint, so no block
 * bends around one.
 */
function courseSpans(sides: number, rad: number, len: number, odd: boolean): [number, number][] {
  const gap = JOINT / (2 * rad);
  if (sides === 0) {
    const n = Math.max(10, Math.round((Math.PI * 2 * rad) / len));
    const step = (Math.PI * 2) / n;
    const shift = odd ? step / 2 : 0;
    return Array.from({ length: n }, (_, k) => [k * step + shift + gap, (k + 1) * step + shift - gap]);
  }
  const sector = (Math.PI * 2) / sides;
  const half = rad * Math.tan(sector / 2);
  const n = Math.max(2, Math.round((2 * half) / len));
  const step = (2 * half) / n;
  const inner = odd ? Array.from({ length: n }, (_, k) => -half + step * (k + 0.5)) : Array.from({ length: n - 1 }, (_, k) => -half + step * (k + 1));
  const ts = [-half, ...inner, half];
  const out: [number, number][] = [];
  // Corners close without a joint, so the two faces meet in one clean arris.
  const last = ts.length - 2;
  for (let j = 0; j < sides; j++) {
    for (let k = 0; k <= last; k++) {
      out.push([j * sector + Math.atan((ts[k] as number) / rad) + (k === 0 ? 0 : gap), j * sector + Math.atan((ts[k + 1] as number) / rad) - (k === last ? 0 : gap)]);
    }
  }
  return out;
}

/** One block of a ring wall between two angles and two heights: outer face, top, ends, inner face, and with `under` its underside. */
function ringBlock(b: PartBuilder, sides: number, a0: number, a1: number, y0: number, y1: number, rad: number, thick: number, shade: number, ch: Channels, under = false): void {
  const am = (a0 + a1) / 2;
  const outer = (a: number, y: number, bulge = 0): V3 => ringPoint(sides, a, rad + bulge, y);
  const inner = (a: number, y: number): V3 => ringPoint(sides, a, rad - thick, y);
  const bulge = 0.035;
  const n0 = ringNormal(sides, a0);
  const nm = ringNormal(sides, am);
  const n1 = ringNormal(sides, a1);
  // Outer face in two halves, so a round wall stays round and each block pillows a little.
  quad(b, [outer(a0, y0), outer(am, y0, bulge), outer(am, y1, bulge), outer(a0, y1)], normalize([n0[0] + nm[0], 0, n0[2] + nm[2]]), [shade - 0.05, shade, shade + 0.04, shade], ch);
  quad(b, [outer(am, y0, bulge), outer(a1, y0), outer(a1, y1), outer(am, y1, bulge)], normalize([n1[0] + nm[0], 0, n1[2] + nm[2]]), [shade, shade - 0.05, shade, shade + 0.04], ch);
  quad(b, [outer(a0, y1), outer(am, y1, bulge), inner(am, y1), inner(a0, y1)], UP, shade + 0.06, ch);
  quad(b, [outer(am, y1, bulge), outer(a1, y1), inner(a1, y1), inner(am, y1)], UP, shade + 0.06, ch);
  const side0 = normalize(cross(UP, n0));
  const side1 = normalize(cross(n1, UP));
  quad(b, [outer(a0, y0), outer(a0, y1), inner(a0, y1), inner(a0, y0)], side0, shade - 0.1, ch);
  quad(b, [outer(a1, y0), outer(a1, y1), inner(a1, y1), inner(a1, y0)], side1, shade - 0.1, ch);
  quad(b, [inner(a0, y0), inner(a1, y0), inner(a1, y1), inner(a0, y1)], [-nm[0], 0, -nm[2]], shade - 0.2, ch);
  if (under) quad(b, [outer(a0, y0), inner(a0, y0), inner(a1, y0), outer(a1, y0)], [0, -1, 0], shade - 0.22, ch);
}

/** A flat floor across the top of a shaft, in wedges; each wedge shrinks toward `foot` of its middle angle as it goes. */
function disc(b: PartBuilder, sides: number, y: number, rad: number, shade: number, ch: Channels, foot: (a: number) => V3): void {
  const n = sides === 0 ? 16 : sides;
  const off = sides === 0 ? 0 : Math.PI / sides;
  const k = sides === 0 ? 1 : 1 / Math.cos(Math.PI / sides);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + off;
    const a1 = ((i + 1) / n) * Math.PI * 2 + off;
    tri(b, [[0, y, 0], [Math.cos(a0) * rad * k, y, Math.sin(a0) * rad * k], [Math.cos(a1) * rad * k, y, Math.sin(a1) * rad * k]], UP, shade, { ...ch, pivot: foot((a0 + a1) / 2) });
  }
}

/** The wedge of a disc of `sides` that angle `a` falls in, by its middle angle. */
function wedgeOf(sides: number, a: number): number {
  const n = sides === 0 ? 16 : sides;
  const off = sides === 0 ? 0 : Math.PI / sides;
  const step = (Math.PI * 2) / n;
  return off + (Math.floor((((a - off) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / step) + 0.5) * step;
}

/** How readily a piece at share `rise` of the tower's height falls: higher first, jagged by `u`. */
const fallsAt = (rise: number, u: number): number => clamp(0.04 + 0.62 * Math.pow(rise, 1.35) + (u - 0.5) * 0.16, 0.02, 0.7);

/** The most a block's threshold reaches, so whatever it carries still has room to go first while the tower is whole. */
const MOST = 0.6;
/**
 * A piece let into the wall (a corbel, a walkway, a string course) shrinks
 * back into the wall as it goes, so it starts only once the blocks it is let
 * into stand whole, and finishes before they start.
 */
const LET_IN = LOSS_BAND + 0.01;

/** A laid block: its angle span, the heights it spans and the vitality below which it falls. */
interface Laid {
  readonly a0: number;
  readonly a1: number;
  readonly y0: number;
  readonly y1: number;
  readonly loss: number;
}

/** True when two angle spans overlap, however many turns apart they are written. */
function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  const shift = Math.round(((a0 + a1) / 2 - (b0 + b1) / 2) / (Math.PI * 2)) * Math.PI * 2;
  return b0 + shift < a1 && b1 + shift > a0;
}

/**
 * The blocks laid so far, and what holds a new piece up: the highest
 * threshold among the blocks under its span, so a piece never outlasts
 * anything it rests on.
 */
class Courses {
  readonly laid: Laid[] = [];
  /** The highest threshold among blocks overlapping angles a0..a1 whose tops lie between y0 and y1; -1 when there are none. */
  under(a0: number, a1: number, y0: number, y1: number): number {
    let most = -1;
    for (const b of this.laid) if (b.y1 >= y0 && b.y1 <= y1 && overlaps(a0, a1, b.a0, b.a1)) most = Math.max(most, b.loss);
    return most;
  }
  /** The highest threshold of any block whose top lies between y0 and y1, all round. */
  ring(y0: number, y1: number): number {
    return this.under(0, Math.PI * 2, y0, y1);
  }
}

/**
 * A walkway on stepped corbels ringing the wall at height `y`, with a
 * parapet `parapet` meters high along its edge (none where battlements
 * stand there instead). Its pieces
 * fall a little before the wall they hang from. `broken` leaves out some of
 * the walkway and parapet, as on a ruin.
 */
function gallery(stone: PartBuilder, sides: number, y: number, wall: number, thick: number, courses: Courses, parapet: number, broken: boolean, r: Rand): number {
  const out = GALLERY.out;
  const rim = wall + out;
  // A gallery never outlasts the wall it is let into: it goes once the
  // blocks it hangs from stand whole, shrinking back into them.
  const held = Math.max(0, courses.ring(y - 1.6, y + 0.05)) + LET_IN;
  const root = (a: number, h: number): V3 => ringPoint(sides, a, wall - thick * 0.5, h);
  let most = 0;
  for (const [a0, a1] of courseSpans(sides, wall, 1.25, false)) {
    const mid = (a0 + a1) / 2;
    const n = ringNormal(sides, mid);
    const t = normalize(cross(UP, n));
    const u = r.next();
    const loss = clamp(held + 0.015 * u, 0.02, 0.86);
    for (let i = 0; i < 3; i++) {
      const reach = (out * (i + 1)) / 3;
      const h = y - (2.5 - i) * 0.22;
      const c = ringPoint(sides, mid, wall + reach / 2 - 0.1, h);
      box(stone, c, [t, UP, n], [0.17, 0.11, reach / 2 + 0.1], 0.5 + 0.08 * u + 0.03 * i, still(root(mid, h), 0.55, { loss }));
    }
  }
  for (const [a0, a1] of courseSpans(sides, rim, 1.6, false)) {
    if (broken && r.next() < 0.4) continue;
    const u = r.next();
    const loss = clamp(held + 0.015 * u, 0.02, 0.86);
    most = Math.max(most, loss);
    const ch = still(root((a0 + a1) / 2, y), 0.55, { loss, tint: (u - 0.5) * 0.04 });
    ringBlock(stone, sides, a0, a1, y, y + GALLERY.slab, rim, out + 0.15, 0.55 + 0.08 * u, ch, true);
    if (parapet > 0 && !(broken && r.next() < 0.5)) ringBlock(stone, sides, a0, a1, y + GALLERY.slab, y + GALLERY.slab + parapet, rim, 0.22, 0.56 + 0.1 * u, ch);
  }
  return most;
}

/**
 * A stone tower in courses of blocks, crumbling from the top down as
 * vitality falls. See `lookoutTowerParams` for its axes.
 */
export function buildLookoutTower(p: TowerParams, ctx: BuildContext): Built {
  const r = ctx.rand.fork("tower");
  const seed = Math.floor(r.next() * 1e6);
  const height = p.height * (ctx.facts.scale ?? 1);
  const shape = shapeOf(p, height);
  const { sides, shaft, courseH: ch, courses, wallAt } = shape;
  const stone = new PartBuilder("masonry", "solid");
  const timber = new PartBuilder("timber", "solid");
  const roof = new PartBuilder("roof", "solid");
  const glass = new PartBuilder("glass");
  const thick = wallAt(0) * 0.32;
  /** The ground under the middle of the wall at angle `a`: what a piece sinks toward as it goes, so it slides down into the wall below. */
  const foot = (a: number): V3 => ringPoint(sides, a, wallAt(ch * 2.5) - thick * 0.5, 0);
  const blockLen = p.masonry * 1.1;
  const broken = p.crown === "a broken top";
  const topGallery = p.galleries !== "none";
  // Galleries at every stage stand where the stages meet; the top one rings the shaft's head.
  const midGalleries = p.galleries === "a gallery at every stage" ? shape.stages : [];

  // A ruin's broken top: a jagged line, low in two notches, above which no block stands.
  const notches = [r.next() * Math.PI * 2, r.next() * Math.PI * 2];
  const jagged = (a: number): number => {
    if (!broken) return Infinity;
    const n = 0.5 + 0.5 * fbm3(Math.cos(a) * 2.6, Math.sin(a) * 2.6, 0.3, seed, 3);
    const dips = notches.map((o, k) => Math.max(0, 1 - Math.abs(Math.atan2(Math.sin(a - o), Math.cos(a - o))) / (k === 0 ? 0.9 : 0.5)) ** 2);
    return shaft * Math.max(0.52, 0.66 + 0.34 * n - 0.24 * (dips[0] ?? 0) - 0.14 * (dips[1] ?? 0));
  };
  const lowestTop = broken ? shaft * 0.52 : shaft;

  // Openings: a door at the foot and slit windows climbing the shaft, clear
  // of the galleries and below a ruin's broken top. Blocks stop at an
  // opening's edges, so each one is a clean, dressed gap.
  const busy = (c: number, rows: number): boolean =>
    midGalleries.some((g) => c * ch < g + ch && (c + rows) * ch > g - 3 * ch) || (c + rows) * ch > lowestTop - ch;
  const slits: { course: number; rows: number; along: number; half: number }[] = [{ course: 0, rows: 4, along: Math.PI / 2, half: 0.55 / wallAt(0) }];
  for (let c = 5; c < courses - 3; c += 4 + Math.floor(r.next() * 3)) {
    const along = sides === 0 ? r.next() * Math.PI * 2 : facetOf(sides, r.next() * Math.PI * 2);
    if (!busy(c, 3)) slits.push({ course: c, rows: 3, along, half: 0.3 / wallAt(c * ch) });
  }

  // The courses, in running bond: each course shifts half a block. A block
  // rests on the blocks under its span and falls no later than any of them,
  // so the tower comes down from the top and nothing hangs over a gap; a
  // block with nothing under it is never laid.
  const laid = new Courses();
  for (let c = 0; c < courses; c++) {
    const y0 = c * ch;
    const y1 = y0 + ch - JOINT;
    const rad = wallAt(y0 + ch / 2);
    const cr = r.fork(`course${c}`);
    const open = slits.filter((sl) => c >= sl.course && c < sl.course + sl.rows);
    for (const [a0, a1] of courseSpans(sides, rad, blockLen, c % 2 === 1)) {
      const mid = (a0 + a1) / 2;
      const u = cr.next();
      const top = jagged(mid);
      if (y0 + ch / 2 > top) continue;
      let pieces: [number, number][] = [[a0, a1]];
      for (const sl of open) {
        const o = mid + angleDiff(sl.along, mid);
        pieces = pieces.flatMap(([b0, b1]): [number, number][] => {
          if (o + sl.half <= b0 || o - sl.half >= b1) return [[b0, b1]];
          const keep: [number, number][] = [];
          if (o - sl.half - b0 > 0.02) keep.push([b0, o - sl.half]);
          if (b1 - (o + sl.half) > 0.02) keep.push([o + sl.half, b1]);
          return keep;
        });
      }
      const under = c === 0 ? 0 : laid.under(a0, a1, y0 - ch * 0.6, y0);
      if (under < 0) continue;
      const rise = (y0 + ch / 2) / height;
      // Higher blocks fall first; a seeded jitter makes the broken top jagged.
      // On a ruin, the blocks along the break are loose and go sooner.
      const loose = top - y0 < ch * 2.5 ? 0.12 : 0;
      const loss = c < 2 ? 0 : clamp(Math.max(fallsAt(rise, u) + loose, under), 0.02, MOST);
      for (const [b0, b1] of pieces) laid.laid.push({ a0: b0, a1: b1, y0, y1, loss });
      // A falling block sinks down into the wall below it as it goes, never hanging in the air.
      const pivot = foot(mid);
      const shade = 0.52 + 0.22 * cr.next() + 0.08 * rise - (c < 2 ? 0.08 : 0);
      const channels: Channels = { loss, droop: 0, wither: 0.45 + 0.4 * cr.next(), glow: 0, pivot, tint: (cr.next() - 0.5) * 0.05 };
      const bulge = (cr.next() - 0.5) * 0.04;
      for (const [b0, b1] of pieces) ringBlock(stone, sides, b0, b1, y0, y1, rad + bulge, thick, shade, channels);
    }
  }

  // A string course where each stage meets the next, a little proud of the
  // wall below; it goes before the blocks it is set on.
  for (const s of shape.stages) {
    const rad = wallAt(s - ch / 2) + 0.08;
    for (const [a0, a1] of courseSpans(sides, rad, blockLen * 1.4, false)) {
      if (s > jagged((a0 + a1) / 2)) continue;
      const under = laid.under(a0, a1, s - 0.4, s + 0.05);
      if (under < 0) continue;
      const u = r.next();
      const root = ringPoint(sides, (a0 + a1) / 2, rad - 0.08 - thick * 0.5, s - 0.13);
      ringBlock(stone, sides, a0, a1, s - 0.26, s, rad, thick * 0.7, 0.6 + 0.08 * u, still(root, 0.5, { loss: clamp(under + LET_IN + 0.015 * u, 0.02, 0.86) }), true);
    }
  }
  for (const g of midGalleries) gallery(stone, sides, g, wallAt(g - ch / 2), thick, laid, GALLERY.parapet, broken, r.fork(`gallery${g.toFixed(1)}`));

  // The openings: dark, then lamplit panes in each slit; a plank door at the foot.
  for (const sl of slits) {
    const rad = wallAt(sl.course * ch + ch);
    const half = sl.half;
    const y0 = sl.course * ch;
    const y1 = (sl.course + sl.rows) * ch - JOINT;
    const inset = thick * 0.55;
    const corner = (a: number, y: number, d: number): V3 => ringPoint(sides, a, rad - d, y);
    const out = ringNormal(sides, sl.along);
    // The foot of the opening, for the door that never goes.
    const pivot = corner(sl.along, 0, inset);
    // Panes go with the wall around them, so nothing hangs in the air once it falls.
    const rise = (y0 + y1) / 2 / height;
    const reveal = (half * 2.5) as number;
    const wallLoss = sl.course < 2 ? 0 : Math.max(0, laid.under(sl.along - reveal, sl.along + reveal, y0 - 0.05, y1 + ch + 0.05));
    if (sl.course === 0) {
      quad(timber, [corner(sl.along - half, 0, inset), corner(sl.along + half, 0, inset), corner(sl.along + half, y1, inset), corner(sl.along - half, y1, inset)], out, 0.42, still(pivot, 0.8, { tint: 0.01 }));
      box(timber, ringPoint(sides, sl.along, rad - 0.05, y1 + 0.05), [normalize(cross(UP, out)), UP, out], [rad * half * 1.25, 0.12, 0.14], 0.4, still(pivot, 0.8));
      continue;
    }
    // The pane goes just before the wall around it, shrinking onto its sill.
    const sill = corner(sl.along, y0, inset);
    quad(glass, [corner(sl.along - half, y0, inset), corner(sl.along + half, y0, inset), corner(sl.along + half, y1, inset), corner(sl.along - half, y1, inset)], out, 0.2, still(sill, 1, { loss: wallLoss > 0 ? wallLoss + LET_IN : 0 }));
    // Its lamp goes out before the wall around it starts to go, shrinking onto the sill.
    const lit: Channels = { loss: Math.max(wallLoss > 0 ? wallLoss + LET_IN + 0.01 : 0, lossThreshold(r.next(), 0.55 - 0.25 * rise, 0.15)), droop: 0, wither: 0.25, glow: 0.75 + 0.25 * r.next(), pivot: sill };
    quad(glass, [corner(sl.along - half, y0, inset - 0.02), corner(sl.along + half, y0, inset - 0.02), corner(sl.along + half, y1, inset - 0.02), corner(sl.along - half, y1, inset - 0.02)], out, [0.55, 0.55, 0.85, 0.85], lit);
  }

  // The head of the shaft: a walkway ringing it, or a projecting cornice.
  // The crown goes first, and always before the top of the wall that carries it.
  // The crown goes in two tiers, each whole while the one above it goes:
  // first the roof and the lantern's glass, then the deck, posts, drum and
  // battlements they stand on, then the walkway or the top course. Each
  // piece shrinks back toward where it stands, so it never leaves its perch.
  const headWall = wallAt(shaft - ch / 2);
  let perch = laid.ring(shaft - ch * 1.6, shaft + 0.05);
  const tier = (k: number, u: number): number => clamp(perch + LET_IN * (k + 1) + 0.02 * k + 0.015 * u, 0.02, 0.92);
  const c0 = (under: number): number => clamp(Math.max(under, 0) + 0.005, 0.02, MOST + 0.01);
  let deck: number;
  let rim: number;
  if (topGallery) {
    const parapet = p.crown === "battlements" ? 0 : p.crown === "an open lantern room" ? LOW_PARAPET : GALLERY.parapet;
    perch = Math.max(perch, gallery(stone, sides, shaft, headWall, thick, laid, parapet, broken, r.fork("top-gallery")));
    deck = shaft + GALLERY.slab;
    rim = headWall + GALLERY.out;
  } else {
    rim = headWall * 1.1;
    deck = shaft + ch * 0.55;
    if (!broken) {
      for (const [a0, a1] of courseSpans(sides, rim, blockLen, false)) {
        // The cornice is the head course of the wall, and comes down with it.
        const u = r.next();
        const loss = c0(laid.under(a0, a1, shaft - ch * 1.6, shaft + 0.05));
        perch = Math.max(perch, loss);
        ringBlock(stone, sides, a0, a1, shaft - ch * 0.15, deck, rim, thick * 1.3, 0.55 + 0.1 * u, still(foot((a0 + a1) / 2), 0.6, { loss, tint: (u - 0.5) * 0.04 }), true);
      }
    }
  }
  // A floor across the top, so a look down never sees into the hollow shaft;
  // a ruin's lies lower, heaped with fallen stone.
  if (broken) {
    const floor = lowestTop - ch * 2;
    const goes = clamp(laid.ring(floor - ch, floor + ch) + 0.01, 0.02, MOST + 0.03);
    disc(stone, sides, floor, headWall - thick * 0.5, 0.42, still([0, 0, 0], 0.6, { loss: goes }), foot);
    for (let i = 0; i < 9; i++) {
      const a = r.next() * Math.PI * 2;
      const d = r.next() * (headWall - thick) * 0.7;
      const s = 0.3 + 0.3 * r.next();
      // Each lies on a wedge of the floor and goes down with it.
      lump(stone, [Math.cos(a) * d, floor, Math.sin(a) * d], [s, s * 0.55, s * 0.8], r.next() * Math.PI, 0.45, still(foot(wedgeOf(sides, a)), 0.6, { loss: goes }), r);
    }
  } else disc(stone, sides, deck - 0.02, rim * 0.98, 0.5, still([0, 0, 0], 0.6, { loss: tier(0, 1) }), (a) => ringPoint(sides, a, rim * 0.9, deck - 0.02));

  if (p.crown === "battlements") {
    courseSpans(sides, rim, blockLen, false).forEach(([a0, a1], k) => {
      if (k % 2 === 1) return;
      const u = r.next();
      // Each shrinks down onto the walkway or cornice it stands on.
      ringBlock(stone, sides, a0, a1, deck, deck + ch * 1.6, rim, thick * 0.8, 0.56 + 0.1 * u, still(ringPoint(sides, (a0 + a1) / 2, rim - thick * 0.4, deck), 0.6, { loss: tier(0, u), tint: (u - 0.5) * 0.04 }));
    });
  } else if (!broken) {
    crownRoof(p, shape, height, shaft, deck, topGallery ? headWall : rim, topGallery, { stone, timber, roof, glass }, tier, r);
  }

  // Fallen stone at the foot: it gathers as the tower crumbles, and a ruin has always had some.
  // It grows in, and never stops a walker.
  for (let i = 0; i < 26; i++) {
    const a = r.next() * Math.PI * 2;
    const d = wallAt(0) * (sides === 0 ? 1 : 1.1) + 0.3 + Math.pow(r.next(), 1.6) * Math.max(2.5, height * 0.2);
    const s = (0.22 + 0.3 * r.next()) * p.masonry;
    const at: V3 = [Math.cos(a) * d, 0, Math.sin(a) * d];
    // A ruin's oldest rubble fell before any decline, so it lies there even at full health.
    const grow = broken && i % 3 === 0 ? 1 : clamp(0.08 + 0.5 * r.next(), 0.06, 0.55);
    lump(stone, [at[0], s * 0.1, at[2]], [s, s * 0.6, s * 0.8], r.next() * Math.PI, 0.42 + 0.15 * r.next(), still(at, 0.6, { grow, tint: (r.next() - 0.5) * 0.04 }), r);
  }

  const anchors: Anchor[] = [{ position: [0, height, 0], normal: [0, 1, 0], size: 1 }];
  return { parts: nonEmpty([stone.part(), timber.part(), roof.part(), glass.part()]), anchors };
}

/**
 * A roof over the tower's head: a lantern room of posts and lit glass, or a
 * stone drum when a gallery rings the head, then a cone (a pyramid on a
 * polygon) with a finial. It goes first as the tower fails.
 */
function crownRoof(
  p: TowerParams,
  shape: Shape,
  height: number,
  shaft: number,
  deck: number,
  base: number,
  ringed: boolean,
  parts: { readonly stone: PartBuilder; readonly timber: PartBuilder; readonly roof: PartBuilder; readonly glass: PartBuilder },
  tier: (k: number, u: number) => number,
  r: Rand,
): void {
  const { stone, timber, roof, glass } = parts;
  const { sides } = shape;
  const facets = sides === 0 ? 16 : sides;
  const off = sides === 0 ? 0 : Math.PI / sides;
  const corner = sides === 0 ? 1 : 1 / Math.cos(Math.PI / sides);
  let eave = deck;
  let overhang = base * 1.12;
  // Where each roof facet stands, by its middle angle: what it shrinks back onto as it goes.
  let seat = (a: number): V3 => ringPoint(sides, a, base * 0.9, deck);
  if (p.crown === "an open lantern room") {
    const roomH = height * (ringed ? 0.14 : 0.1);
    const roomR = base * (ringed ? 0.9 : 0.78);
    const posts = sides === 0 ? 8 : sides;
    // The posts stand on the wall's top course, down through the deck, and shrink down onto it.
    const postAt = (k: number): V3 => {
      const a = (k / posts) * Math.PI * 2 + off;
      return [Math.cos(a) * roomR * corner, deck + roomH, Math.sin(a) * roomR * corner];
    };
    for (let k = 0; k < posts; k++) {
      const at = postAt(k);
      box(timber, [at[0], (shaft + deck + roomH) / 2, at[2]], [[1, 0, 0], UP, [0, 0, 1]], [0.11, (deck + roomH - shaft) / 2, 0.11], 0.42, still([at[0], shaft, at[2]], 0.8, { loss: tier(0, r.next()) }));
    }
    const panes = sides === 0 ? 12 : sides;
    for (let k = 0; k < panes; k++) {
      const a0 = (k / panes) * Math.PI * 2 + off;
      const a1 = ((k + 1) / panes) * Math.PI * 2 + off;
      const p0: V3 = [Math.cos(a0) * roomR * 0.97 * corner, deck, Math.sin(a0) * roomR * 0.97 * corner];
      const p1: V3 = [Math.cos(a1) * roomR * 0.97 * corner, deck, Math.sin(a1) * roomR * 0.97 * corner];
      const n = normalize([(p0[0] + p1[0]) / 2, 0, (p0[2] + p1[2]) / 2]);
      // A pane stands on the deck and shrinks down onto it.
      const pivot: V3 = [(p0[0] + p1[0]) / 2, deck, (p0[2] + p1[2]) / 2];
      const top = deck + roomH - 0.1;
      quad(glass, [p0, p1, [p1[0], top, p1[2]], [p0[0], top, p0[2]]], n, 0.2, still(pivot, 1, { loss: tier(1, 0) }));
      // Its lamps go out one by one, never outlasting the room around them.
      const lit: Channels = { loss: lossThreshold(r.next(), 0.92, tier(1, 1)), droop: 0, wither: 0.25, glow: 0.9 + 0.1 * r.next(), pivot };
      // The lamplit pane lies just outside the dark one, as a window's does, so it shows at night.
      const q = (pt: V3, y: number): V3 => [pt[0] * 1.012, y, pt[2] * 1.012];
      quad(glass, [q(p0, deck), q(p1, deck), q(p1, top), q(p0, top)], n, [0.6, 0.6, 0.9, 0.9], lit);
    }
    eave = deck + roomH;
    overhang = roomR * (ringed ? 1.12 : 1.4);
    // Each facet shrinks back onto the top of its nearest post.
    seat = (a: number): V3 => postAt(Math.round((a - off) / ((Math.PI * 2) / posts)) % posts);
  } else if (ringed) {
    // Inside the gallery, a drum of stone carries the roof above the walkway.
    // Its blocks shrink down toward its foot, so its courses settle into each other as it goes.
    const drum = Math.max(1.6, height * 0.1);
    const rows = Math.max(2, Math.round(drum / COURSE));
    const u = r.next();
    for (let k = 0; k < rows; k++) {
      const y0 = deck + (drum * k) / rows;
      const y1 = deck + (drum * (k + 1)) / rows - JOINT;
      for (const [a0, a1] of courseSpans(sides, base, p.masonry * 1.1, k % 2 === 1)) {
        const shade = r.next();
        ringBlock(stone, sides, a0, a1, y0, y1, base, base * 0.3, 0.55 + 0.18 * shade, still(ringPoint(sides, (a0 + a1) / 2, base * 0.85, deck), 0.55, { loss: tier(0, u), tint: (shade - 0.5) * 0.05 }));
      }
    }
    eave = deck + drum;
    overhang = base * 1.18;
    seat = (a: number): V3 => ringPoint(sides, a, base * 0.85, eave);
  }
  const rise = height - eave;
  let first: Channels | null = null;
  for (let k = 0; k < facets; k++) {
    const a0 = (k / facets) * Math.PI * 2 + off;
    const a1 = ((k + 1) / facets) * Math.PI * 2 + off;
    const u = r.next();
    // Each facet shrinks back onto what it stands on as the roof goes.
    const ch: Channels = { loss: tier(1, u), droop: 0, wither: 0.7, glow: 0, pivot: seat((a0 + a1) / 2), tint: (u - 0.5) * 0.04 };
    first ??= ch;
    // Three bands per facet with a slight bell at the eaves.
    const ring = (t: number, a: number): V3 => {
      const rr = overhang * (1 - t) * (t < 0.2 ? 1 - 0.25 * (0.2 - t) : 1) * corner;
      return [Math.cos(a) * rr, eave + rise * (t < 0.2 ? t * 0.7 : 0.14 + (t - 0.2) * 1.075), Math.sin(a) * rr];
    };
    for (const [t0, t1] of [[0, 0.2], [0.2, 0.62], [0.62, 1]] as const) {
      const pa = ring(t0, a0);
      const pb = ring(t0, a1);
      const pc = ring(t1, a1);
      const pd = ring(t1, a0);
      const n = normalize(cross(sub(pb, pa), sub(pd, pa)));
      const nn: V3 = n[1] < 0 ? [-n[0], -n[1], -n[2]] : n;
      if (t1 === 1) tri(roof, [pa, pb, pc], nn, 0.5 + 0.08 * u, ch);
      else quad(roof, [pa, pb, pc, pd], nn, [0.42 + 0.08 * u, 0.42 + 0.08 * u, 0.55, 0.55], ch);
    }
    // Under the eaves, a dark soffit so the roof never shows daylight through.
    quad(roof, [ring(0, a0), ring(0, a1), [0, eave, 0], [0, eave, 0]], [0, -1, 0], 0.18, ch);
  }
  // The finial goes down with the first facet, at whose apex it stands.
  if (first !== null) box(timber, [0, height + 0.35, 0], [[1, 0, 0], UP, [0, 0, 1]], [0.06, 0.45, 0.06], 0.4, { ...first, wither: 0.8 });
}

function angleDiff(a: number, b: number): number {
  const d = (((a - b) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2);
  return d - Math.PI;
}
