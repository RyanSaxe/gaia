// A rock arch: a threshold the land made, that everything passes under. One
// ring of faceted stone rises from a foot either side of the way through and
// leaps over it; the way runs along z, which the world turns toward the
// trail. The ring is swept around the opening's edge and stands in pieces
// that meet without a seam: on each side a stump and two blocks above it,
// and over the opening the span in two halves. Its decline is spread over
// the whole of the vitality shown, so a ruin still reads as an arch: one
// half sags and a crack steps open across the span; that half falls and
// lies broken in the grass, leaving the other half reaching out over the
// way; its stack crumbles a block at a time to a stump a third to a half of
// the arch's height, broken on top, its blocks in chunks round it, while the
// reaching half breaks part way out, leaving the other stack standing with a
// stub of the span. The stacks are separate pieces, so a walker passes
// between them.

import type { BuildContext, Built, Rand, Resolved } from "@gaia/schema";
import type { rockArchParams } from "../../landmark.ts";
import { type Channels, PartBuilder, type V3, clamp, cross, fbm3, icosphere, normalize, sub } from "../kit.ts";
import { lump, still } from "./shared.ts";

type ArchParams = Resolved<typeof rockArchParams>;

/**
 * Each form at a stout thickness, meters: the opening's half width, its
 * height under the crown and how much of that its rounded head takes (the
 * rest rises straight), and the stone's thickness across the ring and
 * through it, along the way.
 */
export const ROCK_ARCH_FORMS = {
  "a doorway": { half: 3, rise: 14, head: 4, ring: 4.8, depth: 5 },
  "a gate": { half: 6.5, rise: 16, head: 9.5, ring: 4.4, depth: 4.8 },
  "a great span": { half: 15, rise: 18.5, head: 18.5, ring: 3.9, depth: 4.2 },
} as const;
/** Points round each ring of the sweep, and the spacing of its rings along the opening's edge, meters. */
const AROUND = 24;
const SPACING = 0.36;
/** How deep the feet are set into the ground, meters. */
const SINK = 0.8;
/** How far out from its springing toward the crown the standing half's stub reaches, as a share of its rings. */
const STUB = 0.5;

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
  const crack = clamp(crown + Math.round(r.range(-0.07, 0.07) * count), 8, count - 9);
  const springH = rise * r.range(0.72, 0.8);
  const leftTop = centers.findIndex((c, i) => i < crack - 3 && c[1] >= springH);
  const rightTop = count - 1 - [...centers].reverse().findIndex((c, i) => count - 1 - i > crack + 3 && c[1] >= springH);
  const firstUp = (from: number, to: number, h: number): number => {
    const step = from < to ? 1 : -1;
    for (let i = from; i !== to; i += step) if ((centers[i] as V3)[1] >= h) return i;
    return to;
  };
  // Each stack breaks into a stump a third to a half of the arch's height and two blocks above it.
  const tall = rise + ringT;
  const leftStump = firstUp(0, leftTop - 4, tall * r.range(0.33, 0.48));
  const rightStump = firstUp(count - 1, rightTop + 4, tall * r.range(0.33, 0.48));
  const leftMid = Math.round((leftStump + leftTop) / 2);
  const rightMid = Math.round((rightStump + rightTop) / 2);
  // One half of the span sags and falls first, and its stack crumbles; the other stack stands at any vitality, and
  // its half of the span breaks part way out, leaving a stub reaching over the way.
  const first = r.range(0.4, 0.42);
  const sags = r.next() < 0.5 ? 0 : 1;
  const stage = r.range(0.09, 0.11);
  const stub = sags === 0 ? rightTop - Math.round((rightTop - crack) * STUB) : leftTop + Math.round((crack - leftTop) * STUB);
  // Each break is ragged: its ring's points move along the sweep, by as much as the rings are apart.
  for (const i of [leftStump, leftMid, leftTop, crack, stub, rightTop, rightMid, rightStump]) {
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

  // How it gives way, a stage at a time over the whole of its decline, so that even in ruin it reads as an arch. The
  // half of the span that sags turns about the outer edge of its springing, so a crack steps open across the span;
  // then that half falls, sinking into the top of its stack, and the other half reaches out alone over the way; the
  // bare stack's upper block crumbles; the reaching half breaks part way out and its end falls, leaving a stub; last,
  // the bare stack's lower block crumbles to a stump with a broken top. Each piece sinks onto the joint below it, and
  // goes only once everything resting on it has all but gone.
  const out = new PartBuilder("stone", "solid");
  const edgeOf = (i: number, side: number): V3 => {
    const ring = grid[i] as V3[];
    let best = ring[0] as V3;
    for (const q of ring) if (side * q[0] > side * best[0]) best = q;
    return [best[0], best[1], (centers[i] as V3)[2]];
  };
  const goes = { span: first, upper: first - stage, reach: first - 2 * stage, lower: first - 3 * stage };
  const tint = r.range(-0.03, 0.03);
  const piece = (from: number, to: number, ch: Channels): void => emitSweep(out, grid, normals, centers, Math.min(from, to), Math.max(from, to), tall, ch, seed);
  const goesAt = (loss: number, pivot: V3): Channels => ({ loss, droop: 0, wither: 0, glow: 0, pivot, tint });
  const bare = sags === 0 ? { side: -1, foot: 0, stump: leftStump, mid: leftMid, top: leftTop } : { side: 1, foot: count - 1, stump: rightStump, mid: rightMid, top: rightTop };
  const hinge = edgeOf(bare.top, bare.side);
  // The half that sags would drop its crown end a meter, turning about the hinge; it falls before the sag is done, so
  // it never lies sagged over nothing but its hinge.
  const reach = Math.hypot((centers[crack] as V3)[0] - hinge[0], (centers[crack] as V3)[1] - hinge[1]);
  const turn = clamp(1 / Math.max(1, reach), 0.04, 0.1) * bare.side;
  piece(bare.top, crack, { ...goesAt(goes.span, hinge), fall: [0, 0, turn, goes.span + 0.15] });
  piece(bare.mid, bare.top, goesAt(goes.upper, centers[bare.mid] as V3));
  piece(bare.stump, bare.mid, goesAt(goes.lower, centers[bare.stump] as V3));
  piece(bare.foot, bare.stump, goesAt(0, centers[bare.stump] as V3));
  // The stack that stands, from its foot to its stub, and the end of its half of the span beyond the stub.
  piece(crack, stub, goesAt(goes.reach, centers[stub] as V3));
  piece(sags === 0 ? count - 1 : 0, stub, goesAt(0, centers[stub] as V3));

  // What has fallen lies in the grass and grows in as it falls, stopping no walker: the broken span under the half
  // that fell and under the reaching half's end, and the bare stack's blocks as chunks round its stump. Old scree lies
  // at both feet at any vitality.
  const fallen = r.fork("fallen");
  /** The ground ring under a stump: its reach along x and its depth along z. */
  const footing = (stump: number, side: number): { inner: number; outer: number; deep: number } => {
    let ground = side < 0 ? 0 : count - 1;
    const step = side < 0 ? 1 : -1;
    for (let i = ground; i !== stump; i += step) if (Math.abs((centers[i] as V3)[1]) < Math.abs((centers[ground] as V3)[1])) ground = i;
    const ring = grid[ground] as V3[];
    const xs = ring.map((q) => q[0]);
    return { inner: side < 0 ? Math.max(...xs) : Math.min(...xs), outer: side < 0 ? Math.min(...xs) : Math.max(...xs), deep: Math.max(...ring.map((q) => Math.abs(q[2]))) };
  };
  for (const [k, side] of [-1, 1].entries()) {
    const fell = k === sags;
    const grow = fell ? goes.span : goes.reach;
    // The reaching half's end lies between the crown and its stub.
    const far = fell ? 0.85 : Math.max(0.2, Math.abs((centers[stub] as V3)[0]) / half);
    for (let m = 0; m < 4; m++) {
      const size: V3 = [ringT * fallen.range(0.35, 0.6), ringT * fallen.range(0.22, 0.36), depth * fallen.range(0.25, 0.4)];
      chunk(out, side * half * fallen.range(0.12 * far, far), fallen.range(-0.45, 0.45) * depth, size, fallen.next() * Math.PI, grow, seed + k * 7 + m, fallen);
    }
    for (let m = 0; m < 6; m++) rubble(out, side * half * fallen.range(0, 1.3 * far), fallen.range(-0.8, 0.8) * depth, ringT * fallen.range(0.12, 0.22), grow, fallen);
    const foot = footing(k === 0 ? leftStump : rightStump, side);
    for (let m = 0; m < 4; m++) rubble(out, foot.outer + side * fallen.range(0.2, 1.6), fallen.range(-0.9, 0.9) * depth, ringT * fallen.range(0.08, 0.16), 1, fallen);
    if (!fell) continue;
    // The bare stack's blocks, broken, lie off its stump: out beyond it and in front of it and behind it, clear of it.
    for (const c of [{ goes: goes.upper, size: 1 }, { goes: goes.lower, size: 0.85 }]) {
      for (let m = 0; m < 3; m++) {
        const size: V3 = [ringT * fallen.range(0.3, 0.48) * c.size, ringT * fallen.range(0.22, 0.34) * c.size, ringT * fallen.range(0.28, 0.42) * c.size];
        const reach = Math.max(size[0], size[2]);
        const out_ = m === 0;
        const x = out_ ? foot.outer + side * (reach + fallen.range(0.3, 2)) : (foot.inner + foot.outer) / 2 + fallen.range(-1, 1) * Math.abs(foot.outer - foot.inner) * 0.5;
        const z = out_ ? fallen.range(-0.5, 0.5) * depth : (m === 1 ? 1 : -1) * (foot.deep + reach + fallen.range(0.2, 1.4));
        chunk(out, x, z, size, fallen.next() * Math.PI, c.goes, seed + 31 + k * 13 + m, fallen);
      }
    }
  }
  return { parts: [out.part()], anchors: [{ position: [0, rise + ringT, 0], normal: [0, 1, 0], size: 1 }] };
}

/**
 * A broken chunk of the span lying in the grass, a quarter sunk, its faces flat and sharp where it split and its
 * shading the stone's own; it grows in below `grow`.
 */
function chunk(b: PartBuilder, x: number, z: number, size: V3, yaw: number, grow: number, seed: number, r: Rand): void {
  const sphere = icosphere(1);
  const planes = Array.from({ length: 7 }, () => {
    const a = r.next() * Math.PI * 2;
    const y = r.range(-0.3, 0.9);
    const h = Math.sqrt(1 - y * y);
    return { n: [Math.cos(a) * h, y, Math.sin(a) * h] as V3, d: r.range(0.4, 0.78) };
  });
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const points = sphere.points.map((q): V3 => {
    let p: V3 = [q[0], q[1], q[2]];
    for (const pl of planes) {
      const over = p[0] * pl.n[0] + p[1] * pl.n[1] + p[2] * pl.n[2] - pl.d;
      if (over > 0) p = [p[0] - pl.n[0] * over, p[1] - pl.n[1] * over, p[2] - pl.n[2] * over];
    }
    const lx = p[0] * size[0];
    const lz = p[2] * size[2];
    return [x + lx * c - lz * sn, Math.max(p[1], -0.6) * size[1] + size[1] * 0.35, z + lx * sn + lz * c];
  });
  const ch = still([x, 0, z], 0.6, { grow: clamp(grow, 0.05, 1), tint: (r.next() - 0.5) * 0.04 });
  const middle: V3 = [x, size[1] * 0.35, z];
  // Each face its own, so the breaks read as sharp planes.
  for (const [i, j, k] of sphere.triangles) {
    const [pa, pb, pc] = [points[i] as V3, points[j] as V3, points[k] as V3];
    const f = cross(sub(pb, pa), sub(pc, pa));
    if (Math.hypot(f[0], f[1], f[2]) < 1e-8) continue;
    const mid: V3 = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
    const outward = f[0] * (mid[0] - middle[0]) + f[1] * (mid[1] - middle[1]) + f[2] * (mid[2] - middle[2]) >= 0;
    const n = normalize(outward ? f : [-f[0], -f[1], -f[2]]);
    const mottle = fbm3(mid[0] * 0.9, mid[1] * 0.9, mid[2] * 0.9, seed + 11, 3);
    const shade = 0.47 + 0.14 * mottle + 0.08 * n[1] - 0.12 * Math.max(0, -n[1]);
    const ids = [pa, pb, pc].map((q) => b.vertex(q, n, shade, ch));
    if (outward) b.triangle(ids[0] as number, ids[1] as number, ids[2] as number);
    else b.triangle(ids[0] as number, ids[2] as number, ids[1] as number);
  }
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
