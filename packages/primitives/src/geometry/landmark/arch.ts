// A rock arch: a threshold the land made, that everything passes under. One
// ring of faceted stone rises from a foot either side of the way through and
// leaps over it; the way runs along z, which the world turns toward the
// trail. The ring is swept around the opening's edge and stands in pieces
// that meet without a seam: on each side a stack of two blocks, and over the
// opening the span in two halves. As vitality falls the stacks lean apart
// and a crack opens across the span; then each half of the span falls and
// lies broken in the grass; last the stacks' tops crumble, leaving two
// stacks either side of the way. The stacks are separate pieces, so a walker
// passes between them.

import type { BuildContext, Built, Rand, Resolved } from "@gaia/schema";
import type { rockArchParams } from "../../landmark.ts";
import { type Channels, PartBuilder, type V3, clamp, cross, fbm3, normalize, sub } from "../kit.ts";
import { lump, still } from "./shared.ts";
import { emitFallen } from "./stones.ts";

type ArchParams = Resolved<typeof rockArchParams>;

/**
 * Each form at a stout thickness, meters: the opening's half width, its
 * height under the crown and how much of that its rounded head takes (the
 * rest rises straight), and the stone's thickness across the ring and
 * through it, along the way.
 */
export const ROCK_ARCH_FORMS = {
  "a doorway": { half: 2.2, rise: 9.5, head: 2.9, ring: 3.6, depth: 3.8 },
  "a gate": { half: 4.8, rise: 10.5, head: 6.8, ring: 3.2, depth: 3.5 },
  "a great span": { half: 9.5, rise: 12.5, head: 12.5, ring: 2.8, depth: 3 },
} as const;
/** Points round each ring of the sweep, and the spacing of its rings along the opening's edge, meters. */
const AROUND = 24;
const SPACING = 0.36;
/** How deep the feet are set into the ground, meters. */
const SINK = 0.8;

/** The opening's edge from the left foot over the head to the right foot, densely, as x, y pairs. */
function openingEdge(half: number, rise: number, head: number): [number, number][] {
  const straight = Math.max(0, rise - head);
  const out: [number, number][] = [];
  for (let k = 0; k < 40; k++) out.push([-half, -SINK + ((straight + SINK) * k) / 40]);
  for (let k = 0; k <= 400; k++) {
    const phi = Math.PI * (1 - k / 400);
    out.push([half * Math.cos(phi), straight + head * Math.sin(phi)]);
  }
  for (let k = 1; k <= 40; k++) out.push([half, straight - ((straight + SINK) * k) / 40]);
  return out;
}

/** The edge resampled every `SPACING` meters: each ring's point on the edge, its tangent and the normal pointing into the stone. */
function ringsAlong(edge: readonly [number, number][], straight: number): { at: V3; along: V3; out: V3 }[] {
  const lengths = [0];
  for (let k = 1; k < edge.length; k++) {
    const [ax, ay] = edge[k - 1] as [number, number];
    const [bx, by] = edge[k] as [number, number];
    lengths.push((lengths[k - 1] as number) + Math.hypot(bx - ax, by - ay));
  }
  const total = lengths[lengths.length - 1] as number;
  const n = Math.round(total / SPACING);
  const out: { at: V3; along: V3; out: V3 }[] = [];
  let k = 1;
  for (let i = 0; i <= n; i++) {
    const s = (total * i) / n;
    while (k < edge.length - 1 && (lengths[k] as number) < s) k++;
    const [ax, ay] = edge[k - 1] as [number, number];
    const [bx, by] = edge[k] as [number, number];
    const f = clamp((s - (lengths[k - 1] as number)) / Math.max(1e-6, (lengths[k] as number) - (lengths[k - 1] as number)), 0, 1);
    const along = normalize([bx - ax, by - ay, 0]);
    const at: V3 = [ax + (bx - ax) * f, ay + (by - ay) * f, 0];
    // Into the stone is away from the middle of the opening.
    const n0: V3 = [along[1], -along[0], 0];
    const away = n0[0] * at[0] + n0[1] * (at[1] - Math.min(at[1], straight)) >= 0;
    out.push({ at, along, out: away ? n0 : [-n0[0], -n0[1], 0] });
  }
  return out;
}

/**
 * A rock arch of a chosen form, thickness and weathering, crumbling as
 * described above. See `rockArchParams`.
 */
export function buildRockArch(p: ArchParams, ctx: BuildContext): Built {
  const r = ctx.rand.fork("arch");
  const seed = Math.floor(r.next() * 1e6);
  const scale = ctx.facts.scale ?? 1;
  const form = ROCK_ARCH_FORMS[p.form];
  const half = form.half * scale;
  const rise = form.rise * scale;
  const head = form.head * scale;
  const straight = Math.max(0, rise - head);
  const ringT = form.ring * scale * p.thickness;
  const depth = form.depth * scale * p.thickness;
  const facets = p.stone;
  const lean = r.range(-0.025, 0.025);
  const rings = ringsAlong(openingEdge(half, rise, head), straight);
  const count = rings.length;
  const round = 2.4 + 2.4 * facets;
  const shape = (c: number): number => Math.sign(c) * Math.pow(Math.abs(c), 2 / round);

  // The sweep: every ring's points round the stone, and its center.
  const grid: V3[][] = [];
  const centers: V3[] = [];
  rings.forEach((g, i) => {
    const s = i / (count - 1);
    const y = Math.max(0, g.at[1]);
    const up = clamp(y / rise, 0, 1);
    const flare = 1 + 0.45 * Math.pow(clamp(1 - y / 3.5, 0, 1), 2);
    const thick = ringT * (1.25 - 0.4 * up) * (1 + 0.16 * fbm3(s * 5, 0.3, 0.7, seed, 2));
    const deep = depth * (1.2 - 0.3 * up) * (1 + 0.14 * fbm3(s * 4, 2.1, 0.4, seed + 1, 2));
    const shift: V3 = [lean * y + 0.18 * ringT * fbm3(s * 3, 5.2, 0.1, seed + 2, 2), 0, 0.35 * fbm3(s * 2.2, 8.3, 0.9, seed + 3, 2)];
    const c: V3 = [g.at[0] + g.out[0] * thick * 0.5 + shift[0], g.at[1] + g.out[1] * thick * 0.5, shift[2]];
    centers.push(c);
    grid.push(
      Array.from({ length: AROUND }, (_, j) => {
        const a = (j / AROUND) * Math.PI * 2;
        const u = shape(Math.cos(a)) * thick * 0.5 * flare;
        const w = shape(Math.sin(a)) * deep * 0.5 * flare;
        const q: V3 = [c[0] + g.out[0] * u, c[1] + g.out[1] * u, c[2] + w];
        const bump = 0.2 * fbm3(q[0] * 0.11, q[1] * 0.11, q[2] * 0.11, seed + 6, 2) + (0.15 - 0.06 * facets) * fbm3(q[0] * 0.3, q[1] * 0.3, q[2] * 0.3, seed + 4, 3) + 0.05 * fbm3(q[0] * 0.9, q[1] * 0.9, q[2] * 0.9, seed + 5, 2);
        return [c[0] + (q[0] - c[0]) * (1 + bump), c[1] + (q[1] - c[1]) * (1 + bump), c[2] + (q[2] - c[2]) * (1 + bump)];
      }),
    );
  });

  // Facets: each ring's outline is cut flat by a few lines across it, as stone
  // splits along its joints. A cut keeps its line for a stretch of the arch and
  // the next stretch is cut anew, so the facets run as faces along the stone
  // and step where its joints cross it. Cutting a convex outline by a line
  // keeps it convex, so no face ever folds over.
  const cut = 0.55 + 0.45 * facets;
  const tracks = Math.round(3 + 6 * facets);
  for (let k = 0; k < tracks; k++) {
    for (let i = 0; i < count; ) {
      const stretch = Math.max(3, Math.round((1.2 + 3 * r.next()) / SPACING));
      const a = r.next() * Math.PI * 2;
      const keep = r.range(0.9 - 0.28 * facets, 0.97 - 0.07 * facets);
      for (let m = i; m < Math.min(count, i + stretch); m++) {
        const c = centers[m] as V3;
        const g = rings[m] as { out: V3 };
        const dir: V3 = [g.out[0] * Math.cos(a), g.out[1] * Math.cos(a), Math.sin(a)];
        const ring = grid[m] as V3[];
        const reach = (q: V3): number => (q[0] - c[0]) * dir[0] + (q[1] - c[1]) * dir[1] + (q[2] - c[2]) * dir[2];
        const line = Math.max(...ring.map(reach)) * keep;
        for (const q of ring) {
          const over = reach(q) - line;
          if (over <= 0) continue;
          q[0] -= dir[0] * over * cut;
          q[1] -= dir[1] * over * cut;
          q[2] -= dir[2] * over * cut;
        }
      }
      i += stretch;
    }
  }

  // Where it breaks: the crack near the crown, the stacks' tops at the haunches, and a joint halfway up each stack.
  const crown = centers.reduce((best, c, i) => (c[1] > (centers[best] as V3)[1] ? i : best), 0);
  const crack = clamp(crown + Math.round(r.range(-0.07, 0.07) * count), 4, count - 5);
  // High on the haunches: what a stack carries of the span must rest across most of its reach from the toe it leans over.
  const springH = rise * r.range(0.72, 0.8);
  const leftTop = centers.findIndex((c, i) => i < crack - 3 && c[1] >= springH);
  const rightTop = count - 1 - [...centers].reverse().findIndex((c, i) => count - 1 - i > crack + 3 && c[1] >= springH);
  const firstUp = (from: number, to: number, h: number): number => {
    const step = from < to ? 1 : -1;
    for (let i = from; i !== to; i += step) if ((centers[i] as V3)[1] >= h) return i;
    return to;
  };
  const leftJoint = firstUp(0, leftTop, (centers[leftTop] as V3)[1] * r.range(0.42, 0.56));
  const rightJoint = firstUp(count - 1, rightTop, (centers[rightTop] as V3)[1] * r.range(0.42, 0.56));
  // Each break is ragged: its ring's points move along the sweep, by as much as the rings are apart.
  for (const i of [leftJoint, leftTop, crack, rightTop, rightJoint]) {
    (grid[i] as V3[]).forEach((q, j) => {
      const next = (grid[Math.min(count - 1, i + 1)] as V3[])[j] as V3;
      const gap = Math.hypot(next[0] - q[0], next[1] - q[1], next[2] - q[2]);
      const t = (rings[i] as { along: V3 }).along;
      const m = 0.7 * gap * fbm3(q[0] * 0.8, q[1] * 0.8, q[2] * 0.8, seed + 9, 2);
      q[0] += t[0] * m;
      q[1] += t[1] * m;
    });
  }

  // Normals from the whole sweep, so pieces meet without a seam of light.
  const normals = grid.map((ring, i) =>
    ring.map((q, j) => {
      const along = sub((grid[Math.min(count - 1, i + 1)] as V3[])[j] as V3, (grid[Math.max(0, i - 1)] as V3[])[j] as V3);
      const round = sub(ring[(j + 1) % AROUND] as V3, ring[(j + AROUND - 1) % AROUND] as V3);
      const n = normalize(cross(round, along));
      const c = centers[i] as V3;
      return (n[0] * (q[0] - c[0]) + n[1] * (q[1] - c[1]) + n[2] * (q[2] - c[2]) >= 0 ? n : [-n[0], -n[1], -n[2]]) as V3;
    }),
  );

  // How it gives way, side by side: each side leans out about its outer toe, opening the crack across the span; then
  // its half of the span falls, sinking into its stack, one side first; at last the stacks' tops crumble.
  const out = new PartBuilder("stone", "solid");
  /** The outer edge of a foot where it meets the ground, which its side leans over. */
  const toeOf = (from: number, to: number, side: number): V3 => {
    let ground = from;
    for (let i = from; i <= to; i++) if (Math.abs((centers[i] as V3)[1]) < Math.abs((centers[ground] as V3)[1])) ground = i;
    return [side * Math.max(...(grid[ground] as V3[]).map((q) => side * q[0])), 0, 0];
  };
  const sides = [
    { toe: toeOf(0, leftJoint, -1), turn: r.range(0.032, 0.042), from: r.range(0.78, 0.84) },
    { toe: toeOf(rightJoint, count - 1, 1), turn: -r.range(0.032, 0.042), from: r.range(0.72, 0.77) },
  ];
  const spanGoes = [r.range(0.34, 0.4), 0];
  spanGoes[1] = (spanGoes[0] as number) - r.range(0.04, 0.07);
  const topGoes = [r.range(0.1, 0.2), r.range(0.1, 0.2)];
  const pieces: { from: number; to: number; side: number; loss: number }[] = [
    { from: 0, to: leftJoint, side: 0, loss: 0 },
    { from: leftJoint, to: leftTop, side: 0, loss: topGoes[0] as number },
    { from: leftTop, to: crack, side: 0, loss: spanGoes[0] as number },
    { from: crack, to: rightTop, side: 1, loss: spanGoes[1] as number },
    { from: rightTop, to: rightJoint, side: 1, loss: topGoes[1] as number },
    { from: rightJoint, to: count - 1, side: 1, loss: 0 },
  ];
  const tint = r.range(-0.03, 0.03);
  for (const piece of pieces) {
    const side = sides[piece.side] as (typeof sides)[number];
    const ch: Channels = { loss: piece.loss, droop: 0, wither: 0, glow: 0, pivot: side.toe, tint, fall: [0, 0, side.turn, side.from] };
    emitSweep(out, grid, normals, centers, piece.from, piece.to, rise + ringT, ch, seed);
  }

  // What has fallen lies in the grass and grows in as it falls, stopping no walker: the broken span under each half,
  // and the crumbled top at its stack's foot. Old scree lies at both feet at any vitality.
  const fallen = r.fork("fallen");
  for (const [k, side] of [-1, 1].entries()) {
    const grow = spanGoes[k] as number;
    for (let m = 0; m < 2; m++) {
      const x = side * half * fallen.range(0.25, 0.75);
      emitFallen(out, { x, z: fallen.range(-0.4, 0.4) * depth, yaw: fallen.range(-0.5, 0.5), width: depth * 0.75, depth: ringT * 0.8, length: Math.min(5.5, half * 0.7 + 1.5) }, facets, grow, fallen);
    }
    for (let m = 0; m < 6; m++) rubble(out, side * half * fallen.range(0, 1.1), fallen.range(-0.8, 0.8) * depth, ringT * fallen.range(0.12, 0.22), grow, fallen);
    const toe = (sides[k] as (typeof sides)[number]).toe;
    for (let m = 0; m < 4; m++) rubble(out, toe[0] + side * fallen.range(0.2, 1.6), fallen.range(-0.9, 0.9) * depth, ringT * fallen.range(0.08, 0.16), 1, fallen);
    for (let m = 0; m < 5; m++) rubble(out, toe[0] + side * fallen.range(0.4, 2.4), fallen.range(-1, 1) * depth, ringT * fallen.range(0.12, 0.2), topGoes[k] as number, fallen);
  }
  return { parts: [out.part()], anchors: [{ position: [0, rise + ringT, 0], normal: [0, 1, 0], size: 1 }] };
}

/** A rough stone lying in the grass that grows in below `grow`. */
function rubble(b: PartBuilder, x: number, z: number, size: number, grow: number, r: Rand): void {
  const at: V3 = [x, size * 0.15, z];
  lump(b, at, [size, size * 0.6, size * 0.85], r.next() * Math.PI, 0.42 + 0.14 * r.next(), still([x, 0, z], 0.6, { grow: clamp(grow, 0.05, 1), tint: (r.next() - 0.5) * 0.04 }), r);
}

/**
 * One piece of the sweep, rings `from` to `to`, closed by a rough cap at each end. Its shading carries the stone's
 * mottle, faint strata and lighter tops, and darkens toward the ground and under the span.
 */
function emitSweep(b: PartBuilder, grid: readonly V3[][], normals: readonly V3[][], centers: readonly V3[], from: number, to: number, height: number, ch: Channels, seed: number): void {
  const look = (q: V3, n: V3): { shade: number; wither: number } => {
    const mottle = fbm3(q[0] * 0.9, q[1] * 0.9, q[2] * 0.9, seed + 11, 3);
    const strata = Math.sin(q[1] * 7.4 + 2.2 * fbm3(q[0] * 0.3, q[1] * 0.3, q[2] * 0.3, seed + 12, 2));
    const ground = 1 - clamp(q[1] / 0.7 + 0.2, 0, 1);
    const shade = 0.47 + 0.14 * mottle + 0.04 * strata + 0.1 * clamp(q[1] / height, 0, 1) + 0.07 * n[1] - 0.1 * Math.max(0, -n[1]) - 0.16 * ground;
    return { shade, wither: clamp(0.55 + 0.35 * mottle, 0.2, 0.95) };
  };
  const first = b.vertexCount;
  for (let i = from; i <= to; i++) {
    (grid[i] as V3[]).forEach((q, j) => {
      const n = (normals[i] as V3[])[j] as V3;
      const { shade, wither } = look(q, n);
      b.vertex(q, n, shade, { ...ch, wither });
    });
  }
  const id = (i: number, j: number): number => first + (i - from) * AROUND + (j % AROUND);
  const face = (a: number, c: number, d: number, n: V3, pa: V3, pc: V3, pd: V3): void => {
    const f = cross(sub(pc, pa), sub(pd, pa));
    if (f[0] * n[0] + f[1] * n[1] + f[2] * n[2] >= 0) b.triangle(a, c, d);
    else b.triangle(a, d, c);
  };
  for (let i = from; i < to; i++) {
    for (let j = 0; j < AROUND; j++) {
      const p00 = (grid[i] as V3[])[j] as V3;
      const p10 = (grid[i + 1] as V3[])[j] as V3;
      const p11 = (grid[i + 1] as V3[])[(j + 1) % AROUND] as V3;
      const p01 = (grid[i] as V3[])[(j + 1) % AROUND] as V3;
      const n = (normals[i] as V3[])[j] as V3;
      face(id(i, j), id(i + 1, j), id(i + 1, j + 1), n, p00, p10, p11);
      face(id(i, j), id(i + 1, j + 1), id(i, j + 1), n, p00, p11, p01);
    }
  }
  // The caps: a fresh break, a little lighter, its middle pushed out unevenly.
  for (const [i, outward] of [[from, -1], [to, 1]] as const) {
    const ring = grid[i] as V3[];
    const c = centers[i] as V3;
    // Outward is along the sweep, away from the piece's own rings.
    const inner = centers[i - outward] as V3;
    const n = normalize(sub(c, inner));
    const size = Math.hypot(...sub(ring[0] as V3, c));
    const push = size * 0.08 * (1 + 0.6 * fbm3(c[0], c[1], c[2], seed + 13, 1));
    const mid: V3 = [c[0] + n[0] * push, c[1] + n[1] * push, c[2] + n[2] * push];
    const centre = b.vertex(mid, n, look(mid, n).shade + 0.06, { ...ch, wither: 0.6 });
    const rim = ring.map((q) => b.vertex(q, n, look(q, n).shade + 0.03, { ...ch, wither: 0.6 }));
    for (let j = 0; j < AROUND; j++) face(centre, rim[j] as number, rim[(j + 1) % AROUND] as number, n, mid, ring[j] as V3, ring[(j + 1) % AROUND] as V3);
  }
}
