// Landmarks: great things a person steers by from far away. Each declines
// expressively through its channels: a tower crumbles from the top down and
// its lamps go out, a ring of standing stones leans, breaks and loses its
// lintels, a great tree drops its leaves and greys to a bare snag.

import type { Anchor, BuildContext, Built, Part, Rand, Resolved, Vec3 } from "@gaia/schema";
import type { greatTreeParams, lookoutTowerParams, standingStonesParams } from "../landmark.ts";
import { type Channels, PartBuilder, type V3, clamp, cross, fbm3, icosphere, lossThreshold, normalize, sub } from "./kit.ts";
import { UP, box, quad, tri } from "./blocks.ts";
import { growBranching } from "./skeleton.ts";
import { buildBark, buildLeafClumps, buildLeafStrands } from "./foliage.ts";

const still = (pivot: Vec3, wither: number, extra: Partial<Channels> = {}): Channels => ({ loss: 0, droop: 0, wither, glow: 0, pivot, ...extra });
const nonEmpty = (parts: Part[]): Part[] => parts.filter((p) => p.indices.length > 0);

// ---------- lookout tower ----------

/** Height of one course of stone, meters. */
const COURSE = 0.56;
/** Mortar gap between blocks, meters. */
const JOINT = 0.035;

/**
 * A round or square stone tower in courses of blocks. Every block has its own
 * loss threshold that rises with height, so as vitality falls the tower
 * crumbles from the top down to a jagged stump; its roof goes first and its
 * lamps go out one by one.
 */
export function buildLookoutTower(p: Resolved<typeof lookoutTowerParams>, ctx: BuildContext): Built {
  const r = ctx.rand.fork("tower");
  const s = ctx.facts.scale ?? 1;
  const height = p.height * s;
  const radius = height * 0.15;
  const taper = 0.84;
  const stone = new PartBuilder("masonry", "solid");
  const timber = new PartBuilder("timber", "solid");
  const roof = new PartBuilder("roof", "solid");
  const glass = new PartBuilder("glass");
  const shaft = p.crown === "an open lantern room" ? height * 0.8 : p.crown === "a conical roof" ? height * 0.74 : height * 0.92;
  const courses = Math.max(8, Math.round(shaft / COURSE));
  const ch = shaft / courses;
  const round = p.shape === "round";
  /** The wall's outer radius (or half side) at a height. */
  const wallAt = (y: number): number => radius * (1 + (taper - 1) * clamp(y / shaft, 0, 1)) * (y < ch * 2 ? 1.08 : 1);
  const thick = radius * 0.32;

  // Openings: a door at the foot and slit windows climbing the shaft. Blocks
  // stop at an opening's edges, so each one is a clean, dressed gap.
  const blocksAround = (rad: number): number => Math.max(10, Math.round((round ? Math.PI * 2 * rad : rad * 8) / (p.masonry * 1.1)));
  const slits: { course: number; rows: number; along: number; half: number }[] = [{ course: 0, rows: 4, along: Math.PI / 2, half: 0.55 / wallAt(0) }];
  for (let c = 5; c < courses - 3; c += 4 + Math.floor(r.next() * 3)) {
    slits.push({ course: c, rows: 3, along: r.next() * Math.PI * 2, half: 0.3 / wallAt(c * ch) });
  }

  // The courses, in running bond: each course shifts half a block.
  for (let c = 0; c < courses; c++) {
    const y0 = c * ch;
    const y1 = y0 + ch - JOINT;
    const rad = wallAt(y0 + ch / 2);
    const n = blocksAround(wallAt(c * ch));
    const step = (Math.PI * 2) / n;
    const shift = (c % 2) * step * 0.5;
    const cr = r.fork(`course${c}`);
    const open = slits.filter((sl) => c >= sl.course && c < sl.course + sl.rows);
    const gap = JOINT / (2 * rad);
    for (let k = 0; k < n; k++) {
      const a0 = k * step + shift + gap;
      const a1 = (k + 1) * step + shift - gap;
      const mid = (a0 + a1) / 2;
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
      const u = cr.next();
      const rise = (y0 + ch / 2) / height;
      // Higher blocks fall first; a seeded jitter makes the broken top jagged.
      const loss = c < 2 ? 0 : clamp(0.04 + 0.62 * Math.pow(rise, 1.35) + (u - 0.5) * 0.16, 0.02, 0.7);
      const centre = ringPoint(round, mid, rad, y0 + ch / 2);
      const pivot: V3 = [centre[0] * 0.92, y0 + ch * 0.3, centre[2] * 0.92];
      const shade = 0.52 + 0.22 * cr.next() + 0.08 * rise - (c < 2 ? 0.08 : 0);
      const channels: Channels = { loss, droop: 0, wither: 0.45 + 0.4 * cr.next(), glow: 0, pivot, tint: (cr.next() - 0.5) * 0.05 };
      const bulge = (cr.next() - 0.5) * 0.04;
      for (const [b0, b1] of pieces) ringBlock(stone, round, b0, b1, y0, y1, rad + bulge, thick, shade, channels);
    }
  }

  // The openings: dark, then lamplit panes in each slit; a plank door at the foot.
  for (const sl of slits) {
    const rad = wallAt(sl.course * ch + ch);
    const half = sl.half;
    const y0 = sl.course * ch;
    const y1 = (sl.course + sl.rows) * ch - JOINT;
    const inset = thick * 0.55;
    const corner = (a: number, y: number, d: number): V3 => ringPoint(round, a, rad - d, y);
    const out = ringNormal(round, sl.along);
    const pivot = corner(sl.along, (y0 + y1) / 2, inset);
    // Panes go with the wall around them, so nothing hangs in the air once it falls.
    const rise = (y0 + y1) / 2 / height;
    const wallLoss = sl.course < 2 ? 0 : clamp(0.62 * Math.pow(rise, 1.35) - 0.02, 0.02, 0.7);
    if (sl.course === 0) {
      quad(timber, [corner(sl.along - half, 0, inset), corner(sl.along + half, 0, inset), corner(sl.along + half, y1, inset), corner(sl.along - half, y1, inset)], out, 0.42, still(pivot, 0.8, { tint: 0.01 }));
      box(timber, ringPoint(round, sl.along, rad - 0.05, y1 + 0.05), [normalize(cross(UP, out)), UP, out], [rad * half * 1.25, 0.12, 0.14], 0.4, still(pivot, 0.8));
      continue;
    }
    quad(glass, [corner(sl.along - half, y0, inset), corner(sl.along + half, y0, inset), corner(sl.along + half, y1, inset), corner(sl.along - half, y1, inset)], out, 0.2, still(pivot, 1, { loss: wallLoss }));
    const lit: Channels = { loss: Math.max(wallLoss, lossThreshold(r.next(), 0.55 - 0.25 * rise, 0.15)), droop: 0, wither: 0.25, glow: 0.75 + 0.25 * r.next(), pivot };
    quad(glass, [corner(sl.along - half, y0, inset - 0.02), corner(sl.along + half, y0, inset - 0.02), corner(sl.along + half, y1, inset - 0.02), corner(sl.along - half, y1, inset - 0.02)], out, [0.55, 0.55, 0.85, 0.85], lit);
  }

  // A projecting cornice under the crown.
  const topR = wallAt(shaft) * 1.1;
  const crownLoss = (u: number): number => clamp(0.6 + u * 0.12, 0, 1);
  for (let k = 0, n = blocksAround(topR); k < n; k++) {
    const step = (Math.PI * 2) / n;
    const u = r.next();
    const mid = ringPoint(round, k * step + step / 2, topR, shaft);
    ringBlock(stone, round, k * step + 0.01, (k + 1) * step - 0.01, shaft - ch * 0.15, shaft + ch * 0.55, topR, thick * 1.3, 0.55 + 0.1 * u, {
      loss: crownLoss(u) - 0.04,
      droop: 0,
      wither: 0.6,
      glow: 0,
      pivot: [mid[0] * 0.9, shaft, mid[2] * 0.9],
      tint: (u - 0.5) * 0.04,
    });
  }
  const deck = shaft + ch * 0.55;
  // A floor across the top, so a look down never sees into the hollow shaft.
  disc(stone, round, deck - 0.02, topR * 0.98, 0.5, { loss: 0.6, droop: 0, wither: 0.6, glow: 0, pivot: [0, deck, 0] });

  if (p.crown === "battlements") {
    const n = blocksAround(topR);
    const step = (Math.PI * 2) / n;
    for (let k = 0; k < n; k += 2) {
      const u = r.next();
      const mid = ringPoint(round, k * step + step / 2, topR, deck);
      ringBlock(stone, round, k * step + 0.02, (k + 1) * step - 0.02, deck, deck + ch * 1.6, topR, thick * 0.8, 0.56 + 0.1 * u, {
        loss: crownLoss(u),
        droop: 0,
        wither: 0.6,
        glow: 0,
        pivot: [mid[0] * 0.95, deck, mid[2] * 0.95],
        tint: (u - 0.5) * 0.04,
      });
    }
  } else {
    // A lantern room of posts and lit glass, or a plain stone drum, under a conical roof.
    const lantern = p.crown === "an open lantern room";
    const roomH = lantern ? height * 0.1 : 0;
    const roomR = topR * 0.78;
    if (lantern) {
      const posts = round ? 8 : 4;
      for (let k = 0; k < posts; k++) {
        const a = (k / posts) * Math.PI * 2 + (round ? 0 : Math.PI / 4);
        const at = ringPoint(round, a, roomR, deck);
        box(timber, [at[0], deck + roomH / 2, at[2]], [[1, 0, 0], UP, [0, 0, 1]], [0.11, roomH / 2, 0.11], 0.42, still([0, deck, 0], 0.8, { loss: crownLoss(r.next()) }));
      }
      const sides = round ? 12 : 4;
      for (let k = 0; k < sides; k++) {
        const a0 = (k / sides) * Math.PI * 2 + (round ? 0 : Math.PI / 4);
        const a1 = ((k + 1) / sides) * Math.PI * 2 + (round ? 0 : Math.PI / 4);
        const p0 = ringPoint(round, a0, roomR * 0.97, deck + 0.15);
        const p1 = ringPoint(round, a1, roomR * 0.97, deck + 0.15);
        const n = normalize([(p0[0] + p1[0]) / 2, 0, (p0[2] + p1[2]) / 2]);
        const pivot: V3 = [0, deck + roomH / 2, 0];
        const top = deck + roomH - 0.1;
        quad(glass, [p0, p1, [p1[0], top, p1[2]], [p0[0], top, p0[2]]], n, 0.2, still(pivot, 1, { loss: 0.6 }));
        const lit: Channels = { loss: lossThreshold(r.next(), 0.7, 0.45), droop: 0, wither: 0.25, glow: 0.9 + 0.1 * r.next(), pivot };
        const q = (pt: V3, y: number): V3 => [pt[0] * 0.985, y, pt[2] * 0.985];
        quad(glass, [q(p0, deck + 0.15), q(p1, deck + 0.15), q(p1, top), q(p0, top)], n, [0.6, 0.6, 0.9, 0.9], lit);
      }
    }
    const eave = deck + roomH;
    const overhang = lantern ? topR * 1.08 : topR * 1.12;
    const rise = height - eave;
    const sides = round ? 16 : 4;
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * Math.PI * 2 + (round ? 0 : Math.PI / 4);
      const a1 = ((k + 1) / sides) * Math.PI * 2 + (round ? 0 : Math.PI / 4);
      const u = r.next();
      const ch2: Channels = { loss: crownLoss(u) + 0.04, droop: 0.15, wither: 0.7, glow: 0, pivot: [0, eave, 0], tint: (u - 0.5) * 0.04 };
      // Two bands per facet with a slight bell at the eaves.
      const ring = (t: number, a: number): V3 => {
        const rr = overhang * (1 - t) * (t < 0.2 ? 1 - 0.25 * (0.2 - t) : 1) * (round ? 1 : Math.SQRT2);
        return [Math.cos(a) * rr, eave + rise * (t < 0.2 ? t * 0.7 : 0.14 + (t - 0.2) * 1.075), Math.sin(a) * rr];
      };
      for (const [t0, t1] of [[0, 0.2], [0.2, 0.62], [0.62, 1]] as const) {
        const pa = ring(t0, a0);
        const pb = ring(t0, a1);
        const pc = ring(t1, a1);
        const pd = ring(t1, a0);
        const n = normalize(cross(sub(pb, pa), sub(pd, pa)));
        const nn: V3 = n[1] < 0 ? [-n[0], -n[1], -n[2]] : n;
        if (t1 === 1) tri(roof, [pa, pb, pc], nn, 0.5 + 0.08 * u, ch2);
        else quad(roof, [pa, pb, pc, pd], nn, [0.42 + 0.08 * u, 0.42 + 0.08 * u, 0.55, 0.55], ch2);
      }
      // Under the eaves, a dark soffit so the roof never shows daylight through.
      quad(roof, [ring(0, a0), ring(0, a1), [0, eave, 0], [0, eave, 0]], [0, -1, 0], 0.18, ch2);
    }
    // A finial at the peak.
    box(timber, [0, height + 0.35, 0], [[1, 0, 0], UP, [0, 0, 1]], [0.06, 0.45, 0.06], 0.4, still([0, height, 0], 0.8, { loss: crownLoss(r.next()) }));
  }

  const anchors: Anchor[] = [{ position: [0, height, 0], normal: [0, 1, 0], size: 1 }];
  return { parts: nonEmpty([stone.part(), timber.part(), roof.part(), glass.part()]), anchors };
}

function angleDiff(a: number, b: number): number {
  const d = (((a - b) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2);
  return d - Math.PI;
}

/** A point on a round wall, or on a square wall whose half side is `rad`, at angle `a`. */
function ringPoint(round: boolean, a: number, rad: number, y: number): V3 {
  if (round) return [Math.cos(a) * rad, y, Math.sin(a) * rad];
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = rad / Math.max(Math.abs(c), Math.abs(s));
  return [c * k, y, s * k];
}

function ringNormal(round: boolean, a: number): V3 {
  if (round) return [Math.cos(a), 0, Math.sin(a)];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return Math.abs(c) > Math.abs(s) ? [Math.sign(c), 0, 0] : [0, 0, Math.sign(s)];
}

/** One block of a ring wall between two angles and two heights: outer face, top, ends and inner face. */
function ringBlock(b: PartBuilder, round: boolean, a0: number, a1: number, y0: number, y1: number, rad: number, thick: number, shade: number, ch: Channels): void {
  const am = (a0 + a1) / 2;
  const outer = (a: number, y: number, bulge = 0): V3 => ringPoint(round, a, rad + bulge, y);
  const inner = (a: number, y: number): V3 => ringPoint(round, a, rad - thick, y);
  const bulge = 0.035;
  const n0 = ringNormal(round, a0);
  const nm = ringNormal(round, am);
  const n1 = ringNormal(round, a1);
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
}

/** A flat floor across the top of the shaft. */
function disc(b: PartBuilder, round: boolean, y: number, rad: number, shade: number, ch: Channels): void {
  const sides = round ? 16 : 4;
  for (let k = 0; k < sides; k++) {
    const a0 = (k / sides) * Math.PI * 2 + (round ? 0 : Math.PI / 4);
    const a1 = ((k + 1) / sides) * Math.PI * 2 + (round ? 0 : Math.PI / 4);
    const scaleR = round ? 1 : Math.SQRT2;
    tri(b, [[0, y, 0], [Math.cos(a0) * rad * scaleR, y, Math.sin(a0) * rad * scaleR], [Math.cos(a1) * rad * scaleR, y, Math.sin(a1) * rad * scaleR]], UP, shade, ch);
  }
}

// ---------- standing stones ----------

interface Slab {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  /** Where the stone leans as vitality falls, and how far: 0 stands firm. */
  readonly leanDir: number;
  readonly lean: number;
  /** Height share above which the stone breaks off in decline; 1 never breaks. */
  readonly breakAt: number;
  readonly breakLoss: number;
  readonly facets: number;
}

/**
 * A tall standing stone: a lumpy slab, tapering a little toward a rounded
 * top, sunk half a meter into the ground. As vitality falls a leaning stone
 * tips around a point at its foot, and a broken one loses its top.
 */
function emitSlab(b: PartBuilder, s: Slab, r: Rand, subdiv: number): void {
  const sphere = icosphere(subdiv);
  const seed = Math.floor(r.next() * 1e6);
  const planes: { n: V3; d: number }[] = [];
  for (let k = 0; k < 7 + Math.round(s.facets * 7); k++) {
    const a = r.next() * Math.PI * 2;
    const y = r.range(-0.3, 0.6);
    const h = Math.sqrt(1 - y * y);
    planes.push({ n: [Math.cos(a) * h, y, Math.sin(a) * h], d: r.range(0.72, 0.9) });
  }
  const cut = 0.4 + 0.6 * s.facets;
  const sink = 0.55;
  const total = s.height + sink;
  const cy = Math.cos(s.yaw);
  const sy = Math.sin(s.yaw);
  const tint = r.range(-0.03, 0.03);
  const points: V3[] = sphere.points.map((n) => {
    const lump = 1 + 0.13 * fbm3(n[0] * 1.4, n[1] * 1.4 + seed * 0.001, n[2] * 1.4, seed, 3);
    let q: V3 = [n[0] * lump, n[1] * lump, n[2] * lump];
    for (const pl of planes) {
      const over = q[0] * pl.n[0] + q[1] * pl.n[1] + q[2] * pl.n[2] - pl.d;
      if (over > 0) q = [q[0] - pl.n[0] * over * cut, q[1] - pl.n[1] * over * cut, q[2] - pl.n[2] * over * cut];
    }
    // A slab: flattened through its depth, tapering and rounding toward the top.
    const t = (q[1] + 1) / 2;
    const taper = 1 - 0.28 * t * t;
    const lx = q[0] * s.width * 0.5 * taper;
    const lz = q[2] * s.depth * 0.5 * taper;
    const y = -sink + t * total;
    return [s.x + lx * cy - lz * sy, y, s.z + lx * sy + lz * cy];
  });
  const normals = smoothNormals(points, sphere.triangles);
  const first = b.vertexCount;
  const foot: V3 = [s.x - Math.cos(s.leanDir) * s.width * 0.35, 0, s.z - Math.sin(s.leanDir) * s.width * 0.35];
  const breakY = s.breakAt * s.height;
  const breakPivot: V3 = [s.x, breakY, s.z];
  points.forEach((p, i) => {
    const n = normals[i] as V3;
    const above = clamp(p[1] / s.height, 0, 1);
    const mottle = fbm3(p[0] * 1.3, p[1] * 1.3, p[2] * 1.3, seed + 3, 3);
    const streak = fbm3(p[0] * 4, p[1] * 0.5, p[2] * 4, seed + 6, 2);
    const shade = 0.44 + 0.16 * mottle + 0.08 * streak + 0.14 * above - 0.18 * (1 - clamp(p[1] / 0.5 + 0.2, 0, 1)) + 0.05 * n[1];
    const broken = p[1] > breakY;
    b.vertex(p, n, shade, {
      loss: broken ? clamp(s.breakLoss + 0.05 * fbm3(p[0] * 3, p[1] * 3, p[2] * 3, seed + 8, 1), 0.05, 0.9) : 0,
      droop: broken ? 0 : s.lean,
      wither: clamp(0.55 + 0.35 * mottle, 0.2, 0.95),
      glow: 0,
      pivot: broken ? breakPivot : foot,
      tint: tint + 0.025 * mottle,
    });
  });
  for (const [a, bb, c] of sphere.triangles) b.triangle(first + a, first + bb, first + c);
}

function smoothNormals(points: readonly V3[], triangles: readonly (readonly [number, number, number])[]): V3[] {
  const acc: V3[] = points.map(() => [0, 0, 0]);
  for (const [a, b, c] of triangles) {
    const pa = points[a] as V3;
    const f = cross(sub(points[b] as V3, pa), sub(points[c] as V3, pa));
    for (const i of [a, b, c]) {
      const v = acc[i] as V3;
      v[0] += f[0];
      v[1] += f[1];
      v[2] += f[2];
    }
  }
  return acc.map((v) => normalize(v));
}

/**
 * A ring of tall stones on open ground, with lintels across some pairs and a
 * stone at the center. In decline the lintels fall away first, then stones
 * lean and break, until a few crooked stumps are left in the grass.
 */
export function buildStandingStones(p: Resolved<typeof standingStonesParams>, ctx: BuildContext): Built {
  const r = ctx.rand.fork("stones");
  const s = ctx.facts.scale ?? 1;
  const out = new PartBuilder("stone", "solid");
  const count = Math.max(4, Math.round(p.count));
  const h = p.height * s;
  const width = h * 0.42;
  const depth = h * 0.22;
  const ringR = Math.max(h * 1.1, (count * width * 1.75) / (Math.PI * 2));
  const turn = r.next() * Math.PI * 2;
  const slabs: Slab[] = [];
  for (let k = 0; k < count; k++) {
    const sr = r.fork(`stone${k}`);
    const a = turn + (k / count) * Math.PI * 2 + sr.range(-0.06, 0.06);
    const tall = h * sr.range(0.82, 1.12);
    const kind = sr.next();
    const slab: Slab = {
      x: Math.cos(a) * ringR,
      z: Math.sin(a) * ringR,
      // Faces turn toward the center, as a ring is laid out.
      yaw: -a + Math.PI / 2 + sr.range(-0.12, 0.12),
      width: width * sr.range(0.85, 1.15),
      depth: depth * sr.range(0.85, 1.2),
      height: tall,
      leanDir: a + (sr.next() < 0.5 ? 1 : -1) * sr.range(0.4, 1.4) + (sr.next() < 0.5 ? Math.PI : 0),
      lean: kind < 0.6 ? sr.range(0.22, 0.5) : 0.03,
      breakAt: kind >= 0.6 ? sr.range(0.3, 0.55) : 1,
      breakLoss: sr.range(0.3, 0.55),
      facets: p.facets,
    };
    slabs.push(slab);
    emitSlab(out, slab, sr, 3);
  }
  // Lintels across every other pair, laid on the lower of the two tops.
  if (p.lintels) {
    for (let k = 0; k + 1 < count; k += 2) {
      const a = slabs[k] as Slab;
      const b = slabs[k + 1] as Slab;
      const lr = r.fork(`lintel${k}`);
      const top = Math.min(a.height, b.height) * 0.97;
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const span = Math.hypot(b.x - a.x, b.z - a.z) + width * 0.9;
      const yaw = Math.atan2(b.z - a.z, b.x - a.x);
      emitLintel(out, mx, top, mz, yaw, span, h * 0.17, depth * 1.05, lr, p.facets);
    }
  }
  if (p.centre !== "nothing") {
    const cr = r.fork("centre");
    const king = p.centre === "a tall king stone";
    emitSlab(
      out,
      {
        x: 0,
        z: 0,
        yaw: cr.next() * Math.PI,
        width: king ? width * 1.25 : width * 1.9,
        depth: king ? depth * 1.3 : width * 1.1,
        height: king ? h * 1.55 : h * 0.3,
        leanDir: cr.next() * Math.PI * 2,
        lean: king ? 0.22 : 0.02,
        breakAt: 1,
        breakLoss: 0,
        facets: p.facets,
      },
      cr,
      3,
    );
  }
  return { parts: [out.part()], anchors: [] };
}

/** A lintel slab lying across two stones' tops; it falls away early in decline. */
function emitLintel(b: PartBuilder, x: number, y: number, z: number, yaw: number, span: number, thick: number, depth: number, r: Rand, facets: number): void {
  const sphere = icosphere(2);
  const seed = Math.floor(r.next() * 1e6);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const loss = r.range(0.5, 0.62);
  const points: V3[] = sphere.points.map((n) => {
    const lump = 1 + 0.1 * fbm3(n[0] * 1.5, n[1] * 1.5, n[2] * 1.5, seed, 2);
    const flat = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), 0.55 - 0.25 * facets);
    const lx = flat(n[0]) * lump * span * 0.5;
    const ly = flat(n[1]) * lump * thick * 0.5;
    const lz = flat(n[2]) * lump * depth * 0.5;
    return [x + lx * cy - lz * sy, y + thick * 0.4 + ly, z + lx * sy + lz * cy];
  });
  const normals = smoothNormals(points, sphere.triangles);
  const first = b.vertexCount;
  const pivot: V3 = [x, y, z];
  points.forEach((p, i) => {
    const n = normals[i] as V3;
    const mottle = fbm3(p[0] * 1.3, p[1] * 1.3, p[2] * 1.3, seed + 3, 3);
    b.vertex(p, n, 0.5 + 0.16 * mottle + 0.08 * n[1], { loss, droop: 0, wither: clamp(0.6 + 0.3 * mottle, 0.2, 0.95), glow: 0, pivot, tint: 0.02 * mottle });
  });
  for (const [a, bb, c] of sphere.triangles) b.triangle(first + a, first + bb, first + c);
}

// ---------- great tree ----------

const GREAT_TREE_HABITS = {
  "a spreading oak": { habit: "spreading", spread: 44, stature: 0.95, crown: "clumps" },
  "a tall elm": { habit: "upright", spread: 34, stature: 1.25, crown: "clumps" },
  "a great willow": { habit: "weeping", spread: 46, stature: 0.95, crown: "strands" },
} as const;

/**
 * One great old tree, four or five times a person's reach across: the
 * flora frame and crown grown at a landmark's scale. In decline its leaves
 * thin and drop, its boughs sag and its bark greys to a bare snag.
 */
export function buildGreatTree(p: Resolved<typeof greatTreeParams>, ctx: BuildContext): Built {
  const form = GREAT_TREE_HABITS[p.form];
  const scale = p.size * (ctx.facts.scale ?? 1);
  const inner: BuildContext = { rand: ctx.rand.fork("great-tree"), facts: { ...ctx.facts, scale } };
  // A crown of clumps splits once more than any flora tree, so it is many
  // clumps of ordinary leaves rather than a few giant ones. Strands fill a
  // crown by length, so a willow keeps the flora's density and its budget.
  const density = form.crown === "clumps" ? 5 : 4;
  const skeleton = growBranching({ habit: form.habit, density, spread: form.spread, stature: form.stature }, inner);
  const bark = buildBark({ roughness: p.bark }, { ...inner, rand: inner.rand.fork("bark") }, skeleton);
  const crown =
    form.crown === "strands"
      ? buildLeafStrands({ length: 2.2, fullness: p.fullness }, { ...inner, rand: inner.rand.fork("crown") }, skeleton)
      : buildLeafClumps({ shape: "round", size: 1, fullness: p.fullness }, { ...inner, rand: inner.rand.fork("crown") }, skeleton);
  return { parts: [...bark.parts, ...crown.parts], anchors: crown.anchors };
}
