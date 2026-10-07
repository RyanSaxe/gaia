// Great stones set by people long ago: a ring, an avenue, a dolmen, a field
// of cairns or a loose group of menhirs, all from one lumpy slab. A stone
// never bends: as vitality falls it leans whole about its toe, or falls flat
// into the grass, or snaps, its top lying broken at its foot. Lintels and a
// dolmen's capstone go first.

import type { BuildContext, Built, Rand, Resolved } from "@gaia/schema";
import type { standingStonesParams } from "../../landmark.ts";
import { type Channels, PartBuilder, type V3, clamp, cross, fbm3, icosphere, lossThreshold, normalize, rotate } from "../kit.ts";
import { lump, smoothNormals, still } from "./shared.ts";

type StonesParams = Resolved<typeof standingStonesParams>;

/** How a stone gives way as vitality falls. */
type Decline =
  /** It turns about its toe by `most` radians once vitality drops below `from`: a lean, or a fall flat into the grass. */
  | { readonly kind: "tilt"; readonly most: number; readonly from: number }
  /** Above `at` (a share of its height) it snaps below `loss`, and the top lies broken at its foot. */
  | { readonly kind: "snap"; readonly at: number; readonly loss: number }
  | { readonly kind: "firm" };

interface Stone {
  readonly x: number;
  readonly z: number;
  /** Turns the slab's broad face; 0 faces it along z. */
  readonly yaw: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  /** The way it leans or falls, as an angle on the ground, and how far it already leans. */
  readonly toward: number;
  readonly lean: number;
  readonly decline: Decline;
}

/** The ground point a stone tips over: the edge of its foot on the side it leans toward. */
function toeOf(s: Stone): V3 {
  const dir: V3 = [Math.cos(s.toward), 0, Math.sin(s.toward)];
  const ux: V3 = [Math.cos(s.yaw), 0, -Math.sin(s.yaw)];
  const uz: V3 = [Math.sin(s.yaw), 0, Math.cos(s.yaw)];
  const reach = 0.42 * (Math.abs(dir[0] * ux[0] + dir[2] * ux[2]) * s.width + Math.abs(dir[0] * uz[0] + dir[2] * uz[2]) * s.depth);
  return [s.x + dir[0] * reach, 0, s.z + dir[2] * reach];
}

/** The axis a stone turns about to tip toward its lean: the top moves along `toward`. */
const tipAxis = (s: Stone): V3 => normalize(cross([0, 1, 0], [Math.cos(s.toward), 0, Math.sin(s.toward)]));

/**
 * The lumpy slab a stone is cut from, in its own frame: centered on the
 * ground, `sink` meters of it below, tapering and rounding toward the top,
 * its faces cut flat as sharply as `facets` asks.
 */
function slabShape(s: { width: number; depth: number; height: number }, facets: number, sink: number, r: Rand, subdiv: number): { points: V3[]; triangles: readonly (readonly [number, number, number])[]; seed: number } {
  const sphere = icosphere(subdiv);
  const seed = Math.floor(r.next() * 1e6);
  const planes: { n: V3; d: number }[] = [];
  for (let k = 0; k < 7 + Math.round(facets * 7); k++) {
    const a = r.next() * Math.PI * 2;
    const y = r.range(-0.3, 0.6);
    const h = Math.sqrt(1 - y * y);
    planes.push({ n: [Math.cos(a) * h, y, Math.sin(a) * h], d: r.range(0.72, 0.9) });
  }
  const cut = 0.4 + 0.6 * facets;
  const total = s.height + sink;
  const points: V3[] = sphere.points.map((n) => {
    const bump = 1 + 0.13 * fbm3(n[0] * 1.4, n[1] * 1.4 + seed * 0.001, n[2] * 1.4, seed, 3);
    let q: V3 = [n[0] * bump, n[1] * bump, n[2] * bump];
    for (const pl of planes) {
      const over = q[0] * pl.n[0] + q[1] * pl.n[1] + q[2] * pl.n[2] - pl.d;
      if (over > 0) q = [q[0] - pl.n[0] * over * cut, q[1] - pl.n[1] * over * cut, q[2] - pl.n[2] * over * cut];
    }
    const t = (q[1] + 1) / 2;
    const taper = 1 - 0.28 * t * t;
    return [q[0] * s.width * 0.5 * taper, -sink + t * total, q[2] * s.depth * 0.5 * taper];
  });
  return { points, triangles: sphere.triangles, seed };
}

/** Turns a point of a stone's own frame into the arrangement's: yaw, then its standing lean about the toe. */
function placer(s: Stone): { at: (q: V3) => V3; dir: (n: V3) => V3 } {
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  const toe = toeOf(s);
  const axis = tipAxis(s);
  const turn = (q: V3): V3 => [q[0] * c + q[2] * sn, q[1], -q[0] * sn + q[2] * c];
  return {
    at: (q) => {
      const p = turn(q);
      const o = rotate([p[0] + s.x - toe[0], p[1], p[2] + s.z - toe[2]], axis, s.lean);
      return [o[0] + toe[0], o[1], o[2] + toe[2]];
    },
    dir: (n) => rotate(turn(n), axis, s.lean),
  };
}

function shadeOf(p: V3, height: number, n: V3, seed: number): { shade: number; mottle: number } {
  const above = clamp(p[1] / Math.max(0.5, height), 0, 1);
  const mottle = fbm3(p[0] * 1.3, p[1] * 1.3, p[2] * 1.3, seed + 3, 3);
  const streak = fbm3(p[0] * 4, p[1] * 0.5, p[2] * 4, seed + 6, 2);
  const shade = 0.44 + 0.16 * mottle + 0.08 * streak + 0.14 * above - 0.18 * (1 - clamp(p[1] / 0.5 + 0.2, 0, 1)) + 0.05 * n[1];
  return { shade, mottle };
}

/**
 * A standing stone. It leans or falls whole about its toe, never bending;
 * or it snaps, and its top lies broken at its foot once it has gone.
 */
function emitStone(b: PartBuilder, s: Stone, facets: number, r: Rand, subdiv: number): void {
  const shape = slabShape(s, facets, 0.55, r, subdiv);
  const place = placer(s);
  const points = shape.points.map(place.at);
  const normals = smoothNormals(points, shape.triangles);
  const toe = toeOf(s);
  const d = s.decline;
  const tilt = d.kind === "tilt" ? tipAxis(s) : null;
  const fall = tilt !== null && d.kind === "tilt" ? ([tilt[0] * d.most, tilt[1] * d.most, tilt[2] * d.most, d.from] as const) : undefined;
  const breakY = d.kind === "snap" ? d.at * s.height : Infinity;
  const breakPivot = place.at([0, breakY === Infinity ? 0 : breakY, 0]);
  const tint = r.range(-0.03, 0.03);
  const first = b.vertexCount;
  shape.points.forEach((local, i) => {
    const p = points[i] as V3;
    const n = normals[i] as V3;
    const { shade, mottle } = shadeOf(p, s.height, n, shape.seed);
    const broken = local[1] > breakY;
    const loss = broken && d.kind === "snap" ? clamp(d.loss + 0.05 * fbm3(p[0] * 3, p[1] * 3, p[2] * 3, shape.seed + 8, 1), 0.05, 0.9) : 0;
    b.vertex(p, n, shade, {
      loss,
      droop: 0,
      wither: clamp(0.55 + 0.35 * mottle, 0.2, 0.95),
      glow: 0,
      pivot: broken ? breakPivot : toe,
      tint: tint + 0.025 * mottle,
      ...(fall === undefined ? {} : { fall }),
    });
  });
  for (const [a, bb, c] of shape.triangles) b.triangle(first + a, first + bb, first + c);
  // A snapped top lies in the grass beside its stump, growing in as the top goes.
  if (d.kind === "snap") {
    const len = s.height * (1 - d.at);
    const away = r.next() * Math.PI * 2;
    const reach = len * 0.55 + s.depth * 0.6;
    emitFallen(b, { x: s.x + Math.cos(away) * reach, z: s.z + Math.sin(away) * reach, yaw: away + Math.PI / 2, width: s.width * 0.85, depth: s.depth, length: len }, facets, d.loss, r);
  }
}

/** A piece of stone lying in the grass, half sunk, that grows in below `grow`: a snapped top or a fallen lintel. */
function emitFallen(b: PartBuilder, f: { x: number; z: number; yaw: number; width: number; depth: number; length: number }, facets: number, grow: number, r: Rand): void {
  const shape = slabShape({ width: f.width, depth: f.depth, height: f.length }, facets, 0, r, 2);
  const c = Math.cos(f.yaw);
  const sn = Math.sin(f.yaw);
  const roll = r.range(-0.25, 0.25);
  // Laid on its broad face along `yaw`, its middle at the spot, a third of its thickness in the ground.
  const lay = (q: V3): V3 => {
    const along = q[1] - f.length / 2;
    const up = q[2] * Math.cos(roll) + q[0] * Math.sin(roll);
    const side = q[0] * Math.cos(roll) - q[2] * Math.sin(roll);
    return [f.x + along * c - side * sn, up + f.depth * 0.18, f.z + along * sn + side * c];
  };
  const points = shape.points.map(lay);
  const normals = smoothNormals(points, shape.triangles);
  const pivot: V3 = [f.x, 0, f.z];
  const first = b.vertexCount;
  points.forEach((p, i) => {
    const n = normals[i] as V3;
    const { shade, mottle } = shadeOf(p, f.depth * 2, n, shape.seed);
    b.vertex(p, n, shade - 0.04, { loss: 0, droop: 0, wither: clamp(0.65 + 0.3 * mottle, 0.2, 0.95), glow: 0, pivot, tint: 0.02 * mottle, grow: clamp(grow, 0.05, 0.9) });
  });
  for (const [a, bb, cc] of shape.triangles) b.triangle(first + a, first + bb, first + cc);
}

/** A slab lying across two stones' tops. It falls away first, and then lies broken in the grass below. */
function emitLintel(b: PartBuilder, a: Stone, c: Stone, thick: number, depth: number, facets: number, r: Rand): void {
  const sphere = icosphere(2);
  const seed = Math.floor(r.next() * 1e6);
  const x = (a.x + c.x) / 2;
  const z = (a.z + c.z) / 2;
  const y = Math.min(a.height, c.height) * 0.97;
  const span = Math.hypot(c.x - a.x, c.z - a.z) + Math.min(a.width, c.width) * 0.9;
  const yaw = Math.atan2(c.z - a.z, c.x - a.x);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const loss = r.range(0.6, 0.7);
  const points: V3[] = sphere.points.map((n) => {
    const bump = 1 + 0.1 * fbm3(n[0] * 1.5, n[1] * 1.5, n[2] * 1.5, seed, 2);
    const flat = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), 0.55 - 0.25 * facets);
    const lx = flat(n[0]) * bump * span * 0.5;
    const ly = flat(n[1]) * bump * thick * 0.5;
    const lz = flat(n[2]) * bump * depth * 0.5;
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
  for (const [i, j, k] of sphere.triangles) b.triangle(first + i, first + j, first + k);
  // Outward of the gateway, it lies where it slid off.
  const out = Math.hypot(x, z) > 0.5 ? Math.atan2(z, x) : r.next() * Math.PI * 2;
  const reach = thick + 1.2 + r.next() * 1.2;
  emitFallen(b, { x: x + Math.cos(out) * reach, z: z + Math.sin(out) * reach, yaw: yaw + r.range(-0.4, 0.4), width: depth, depth: thick, length: span * 0.9 }, facets, loss, r);
}

/** How each stone of a group gives way, drawn from its own stream: about two in five lean, one in three snaps, the rest fall flat. */
function declineOf(sr: Rand, lean: number): Decline {
  const kind = sr.next();
  if (kind < 0.42) return { kind: "tilt", most: sr.range(0.18, 0.42), from: sr.range(0.38, 0.58) };
  if (kind < 0.75) return { kind: "snap", at: sr.range(0.3, 0.55), loss: sr.range(0.3, 0.55) };
  return { kind: "tilt", most: Math.PI / 2 - 0.1 - lean, from: sr.range(0.16, 0.34) };
}

/** A stone of the arrangement, its size jittered from the arrangement's own. */
function stoneAt(sr: Rand, x: number, z: number, yaw: number, size: { width: number; depth: number; height: number }, lean = 0): Stone {
  const toward = sr.next() * Math.PI * 2;
  return {
    x,
    z,
    yaw: yaw + sr.range(-0.12, 0.12),
    width: size.width * sr.range(0.85, 1.15),
    depth: size.depth * sr.range(0.85, 1.2),
    height: size.height * sr.range(0.82, 1.12),
    toward,
    lean,
    decline: declineOf(sr, lean),
  };
}

/**
 * Great stones in one of five arrangements. In decline the lintels and
 * capstone fall first; then stones lean, snap and fall flat, until a few
 * crooked stumps are left in the grass.
 */
export function buildStandingStones(p: StonesParams, ctx: BuildContext): Built {
  const r = ctx.rand.fork("stones");
  const scale = ctx.facts.scale ?? 1;
  // What has fallen grows in only once it has fallen, and stops no walker.
  const out = new PartBuilder("stone", "solid");
  const h = p.height * scale;
  const size = { width: h * 0.42, depth: h * 0.22, height: h };
  const count = Math.max(4, Math.round(p.count));
  const stones: Stone[] = [];
  const lintels: [number, number][] = [];
  /** Where the arrangement's heart is, for its center stone. */
  let heart: [number, number] = [0, 0];

  if (p.arrangement === "ring") {
    const ringR = Math.max(h * 1.1, (count * size.width * 1.75) / (Math.PI * 2));
    const turn = r.next() * Math.PI * 2;
    for (let k = 0; k < count; k++) {
      const sr = r.fork(`stone${k}`);
      const a = turn + (k / count) * Math.PI * 2 + sr.range(-0.06, 0.06);
      // Faces turn toward the center, as a ring is laid out.
      stones.push(stoneAt(sr, Math.cos(a) * ringR, Math.sin(a) * ringR, -a + Math.PI / 2, size));
    }
    if (p.lintels) for (let k = 0; k + 1 < count; k += 2) lintels.push([k, k + 1]);
  } else if (p.arrangement === "avenue") {
    // Two facing rows, rising toward the head, which stands at +x.
    const pairs = Math.max(2, Math.round(count / 2));
    const spacing = size.width * 2.1;
    const across = clamp(h * 0.9, 3, 5);
    const length = (pairs - 1) * spacing;
    for (let k = 0; k < pairs; k++) {
      const t = pairs === 1 ? 1 : k / (pairs - 1);
      const grade = { ...size, height: h * (0.72 + 0.38 * t) };
      for (const side of [-1, 1]) {
        const sr = r.fork(`stone${k}-${side}`);
        stones.push(stoneAt(sr, -length / 2 + k * spacing + sr.range(-0.2, 0.2), side * (across / 2 + sr.range(-0.15, 0.15)), 0, grade));
      }
      if (p.lintels && k % 2 === 1) lintels.push([stones.length - 2, stones.length - 1]);
    }
    heart = [length / 2 + spacing * 1.1, 0];
  } else if (p.arrangement === "dolmen") {
    // A chamber of uprights under one great capstone, in a ring of low kerb stones.
    const legH = Math.max(1.6, h * 0.6);
    const capL = Math.max(3.4, h * 1.2);
    const capW = capL * 0.66;
    const uprights = clamp(Math.round(count / 3), 3, 5);
    const legs: [number, number, number][] =
      uprights === 3 ? [[-0.28, 0.3, Math.PI / 2], [0.28, 0.3, Math.PI / 2], [0, -0.36, 0]]
      : [[-0.3, 0.3, Math.PI / 2], [0.3, 0.3, Math.PI / 2], [-0.3, -0.3, Math.PI / 2], [0.3, -0.3, Math.PI / 2], ...(uprights === 5 ? [[0, -0.42, 0] as [number, number, number]] : [])];
    const legSize = { width: capW * 0.45, depth: legH * 0.28, height: legH };
    const firstLeg = stones.length;
    legs.forEach(([fx, fz, yaw], k) => {
      const sr = r.fork(`leg${k}`);
      const s = stoneAt(sr, fx * capL, fz * capW, yaw, legSize);
      // The back uprights give way outward, and the capstone slides off after them.
      const back = fz < 0;
      stones.push({ ...s, height: legH * sr.range(0.96, 1.04), toward: back ? -Math.PI / 2 + sr.range(-0.3, 0.3) : s.toward, decline: back ? { kind: "tilt", most: sr.range(0.9, 1.25), from: sr.range(0.3, 0.38) } : { kind: "tilt", most: sr.range(0.08, 0.2), from: sr.range(0.36, 0.5) } });
    });
    emitCapstone(out, stones.slice(firstLeg), capL, capW, h * 0.2, p.facets, r.fork("capstone"));
    const kerb = Math.round(count * 1.5);
    const kerbR = capL * 0.95;
    for (let k = 0; k < kerb; k++) {
      const sr = r.fork(`kerb${k}`);
      const a = (k / kerb) * Math.PI * 2 + sr.range(-0.05, 0.05);
      const s = stoneAt(sr, Math.cos(a) * kerbR, Math.sin(a) * kerbR * 0.85, -a + Math.PI / 2, { width: h * 0.24, depth: h * 0.14, height: h * 0.2 });
      stones.push({ ...s, toward: a, decline: s.decline.kind === "snap" ? { kind: "tilt", most: sr.range(0.3, 0.7), from: sr.range(0.2, 0.5) } : s.decline });
    }
    heart = [0, kerbR + 1.8];
  } else if (p.arrangement === "cairn field") {
    const cairns = clamp(Math.round(count * 0.6), 3, 9);
    const spread = Math.max(5, h * 1.6);
    const placed: [number, number, number][] = [];
    for (let k = 0, tries = 0; k < cairns && tries < 200; tries++) {
      const cr = r.fork(`cairn${tries}`);
      const a = cr.next() * Math.PI * 2;
      const d = k === 0 ? 0 : spread * Math.sqrt(cr.range(0.15, 1));
      const tall = h * (k === 0 ? 1 : cr.range(0.45, 0.8));
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (placed.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < pr + tall * 0.6 + 0.8)) continue;
      placed.push([x, z, tall * 0.6]);
      emitCairn(out, x, z, tall, p.facets, cr);
      k++;
    }
    heart = [spread * 0.9, 0];
  } else {
    // Lone menhirs scattered loosely, taller than a ring's, some already leaning.
    const spread = Math.max(h * 1.3, Math.sqrt(count) * h * 0.75);
    const tall = { width: size.width * 0.85, depth: size.depth * 1.1, height: h * 1.25 };
    for (let tries = 0; stones.length < count && tries < 300; tries++) {
      const sr = r.fork(`menhir${tries}`);
      const a = sr.next() * Math.PI * 2;
      const d = spread * Math.sqrt(sr.next());
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (stones.some((s) => Math.hypot(s.x - x, s.z - z) < h * 0.9)) continue;
      const lean = sr.next() < 0.45 ? sr.range(0.12, 0.38) : sr.range(0, 0.05);
      stones.push(stoneAt(sr, x, z, sr.next() * Math.PI, tall, lean));
    }
    heart = [0, 0];
    if (stones.some((s) => Math.hypot(s.x, s.z) < h)) heart = [spread + h * 0.6, 0];
  }

  stones.forEach((s, k) => emitStone(out, s, p.facets, r.fork(`emit${k}`), s.height > h * 0.4 ? 3 : 2));
  for (const [i, j] of lintels) emitLintel(out, stones[i] as Stone, stones[j] as Stone, h * 0.17, size.depth * 1.05, p.facets, r.fork(`lintel${i}`));

  if (p.centre !== "nothing" && p.arrangement !== "dolmen") {
    const cr = r.fork("centre");
    const king = p.centre === "a tall king stone";
    const centre: Stone = {
      x: heart[0],
      z: heart[1],
      yaw: cr.next() * Math.PI,
      width: king ? size.width * 1.25 : size.width * 1.9,
      depth: king ? size.depth * 1.3 : size.width * 1.1,
      height: king ? h * 1.55 : h * 0.3,
      toward: cr.next() * Math.PI * 2,
      lean: king ? cr.range(0, 0.06) : 0,
      decline: king ? { kind: "tilt", most: cr.range(0.25, 0.4), from: cr.range(0.28, 0.4) } : { kind: "firm" },
    };
    emitStone(out, centre, p.facets, cr, 3);
  }
  return { parts: [out.part()], anchors: [] };
}

/**
 * A dolmen's capstone across the tops of its uprights. As the back uprights
 * give way outward it tips about the front ones' tops until its back edge
 * rests on the ground.
 */
function emitCapstone(b: PartBuilder, legs: readonly Stone[], length: number, width: number, thick: number, facets: number, r: Rand): void {
  const top = Math.min(...legs.map((l) => l.height)) * 0.98;
  const shape = slabShape({ width: length, depth: width, height: thick }, facets, 0, r, 3);
  // The slab's own frame stands up; turn it to lie flat, its thickness upward.
  const yaw = r.range(-0.08, 0.08);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const points: V3[] = shape.points.map((q) => {
    const [x, y, z] = q;
    return [x * c + z * s, top + y - thick * 0.15, -x * s + z * c];
  });
  const normals = smoothNormals(points, shape.triangles);
  const front = Math.max(...legs.filter((l) => l.z > 0).map((l) => l.z - l.depth * 0.3), 0);
  const hinge: V3 = [0, top, front];
  const reach = front + width * 0.5;
  const tip = Math.asin(clamp(top / Math.max(reach, top + 0.01), 0, 0.98));
  const from = Math.max(...legs.filter((l) => l.decline.kind === "tilt" && l.z < 0).map((l) => (l.decline.kind === "tilt" ? l.decline.from : 0)), 0.3) + 0.02;
  const first = b.vertexCount;
  points.forEach((p, i) => {
    const n = normals[i] as V3;
    const mottle = fbm3(p[0] * 1.1, p[1] * 1.1, p[2] * 1.1, shape.seed + 3, 3);
    const ch: Channels = { loss: 0, droop: 0, wither: clamp(0.6 + 0.3 * mottle, 0.2, 0.95), glow: 0, pivot: hinge, tint: 0.025 * mottle, fall: [-tip, 0, 0, from] };
    b.vertex(p, n, 0.5 + 0.14 * mottle + 0.1 * n[1], ch);
  });
  for (const [i, j, k] of shape.triangles) b.triangle(first + i, first + j, first + k);
}

/**
 * A cairn: small stones piled in a rounded cone, `tall` meters high. Its top
 * stones tumble first as vitality falls, coming to rest around its foot.
 */
function emitCairn(b: PartBuilder, x: number, z: number, tall: number, facets: number, r: Rand): void {
  const base = tall * 0.55;
  const stone = clamp(tall * 0.13, 0.2, 0.45);
  const rows = Math.max(3, Math.round(tall / (stone * 1.3)));
  for (let row = 0; row < rows; row++) {
    const t = row / rows;
    const y = t * tall;
    const rad = base * Math.pow(1 - t, 0.8) + stone * 0.3;
    const n = Math.max(1, Math.round((Math.PI * 2 * rad) / (stone * 1.7)));
    const turn = r.next() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = turn + (k / n) * Math.PI * 2 + r.range(-0.15, 0.15);
      const s = stone * r.range(0.75, 1.2);
      const at: V3 = [x + Math.cos(a) * rad, y + s * 0.4, z + Math.sin(a) * rad];
      const loss = row < 2 ? 0 : lossThreshold(t * r.range(0.7, 1), 0.62, 0.05);
      lump(b, at, [s, s * (0.78 - 0.12 * facets), s * 0.85], a, 0.5 + 0.2 * r.next() + 0.08 * t, { loss: clamp(loss, 0, 0.7), droop: 0, wither: 0.4 + 0.4 * r.next(), glow: 0, pivot: [x, y, z], tint: (r.next() - 0.5) * 0.05 }, r);
    }
  }
  // What tumbled lies around the foot.
  for (let k = 0; k < Math.round(rows * 1.6); k++) {
    const a = r.next() * Math.PI * 2;
    const d = base + stone + r.next() * tall * 0.5;
    const s = stone * r.range(0.7, 1.1);
    const at: V3 = [x + Math.cos(a) * d, s * 0.12, z + Math.sin(a) * d];
    lump(b, at, [s, s * 0.55, s * 0.8], a, 0.45 + 0.15 * r.next(), still([at[0], 0, at[2]], 0.6, { grow: r.range(0.12, 0.5) }), r);
  }
}
