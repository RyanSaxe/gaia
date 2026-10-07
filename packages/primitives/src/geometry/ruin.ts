// What a declining building gathers: ivy climbing its walls, weeds around
// its feet and rubble where it gives way. Each piece grows out of its own
// pivot below a vitality threshold, so a healthy house shows none of it and
// a failing one is overgrown, with no geometry rebuilt.

import { type BuildingPlan, CUT, type Rand, type Vec3 } from "@gaia/schema";
import { type Channels, type PartBuilder, type V3, addScaled, clamp, cross, icosphere, normalize, rotate } from "./kit.ts";
import { type Ruin, type Wall, clearings, on, ruinAt, topAt, wallsOf } from "./plan.ts";

/** Sorted breaks every `cell` meters from `a` to `b`, with `extra` breaks added where they fall inside. */
function breaks(a: number, b: number, cell: number, extra: readonly number[]): number[] {
  const n = Math.max(1, Math.round((b - a) / cell));
  const out = Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  for (const x of extra) if (x > a + 0.02 && x < b - 0.02) out.push(x);
  return [...new Set(out)].sort((p, q) => p - q);
}

/**
 * A wall's face as a grid of cells about `cell` meters across, from `y0` up
 * to the wall's top and over its gable, `d` out from the wall, so rot and
 * shade can vary across it. Its doors and windows are cut out exactly, so
 * an open door or a broken pane shows the dark inside.
 */
export function wallSheet(b: PartBuilder, plan: BuildingPlan, w: Wall, y0: number, d: number, cell: number, at: (p: V3) => { c: Channels; shade: number }): void {
  const top = topAt(plan, w, 0);
  const holes = clearings(plan, w, 0).filter((h) => h.y1 <= top + 1e-3);
  const cols = breaks(0, w.length, cell, holes.flatMap((h) => [h.s0, h.s1]));
  const body = breaks(y0, top, cell, holes.flatMap((h) => [h.y0, h.y1]));
  const peak = topAt(plan, w, w.length / 2);
  const gableRows = peak - top > 0.05 ? Math.max(1, Math.round((peak - top) / cell)) : 0;
  const rows = body.length + gableRows;
  const yAt = (s: number, j: number): number => (j < body.length ? (body[j] as number) : top + ((topAt(plan, w, s) - top) * (j - body.length + 1)) / gableRows);
  const idx: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (const s of cols) {
      const p = on(w, s, yAt(s, j), d);
      const { c, shade } = at(p);
      idx.push(b.vertex(p, w.n, shade, c));
    }
  }
  const n = cols.length;
  for (let j = 0; j + 1 < rows; j++) {
    for (let i = 0; i + 1 < n; i++) {
      const sm = ((cols[i] as number) + (cols[i + 1] as number)) / 2;
      const ym = (yAt(sm, j) + yAt(sm, j + 1)) / 2;
      if (holes.some((h) => sm > h.s0 && sm < h.s1 && ym > h.y0 && ym < h.y1)) continue;
      const a = idx[j * n + i] as number;
      const bb = idx[j * n + i + 1] as number;
      const c = idx[(j + 1) * n + i + 1] as number;
      const dd = idx[(j + 1) * n + i] as number;
      b.triangle(a, bb, c);
      b.triangle(a, c, dd);
    }
  }
}

/** One leaf card facing `n`, centered at `c`, `size` across, turned by `twist` about `n`. */
function card(b: PartBuilder, c: Vec3, n: Vec3, up: Vec3, size: number, twist: number, cut: number, ch: Channels, shade: number): void {
  const side0 = normalize(cross(up, n));
  const side = rotate(side0, n, twist);
  const along = normalize(cross(n, side));
  const h = size / 2;
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const idx = corners.map(([x, y]) => b.vertex(addScaled(addScaled(c, side, x * h), along, y * h), n, shade + 0.12 * y, ch, [x, y, cut]));
  b.triangle(idx[0] as number, idx[1] as number, idx[2] as number);
  b.triangle(idx[0] as number, idx[2] as number, idx[3] as number);
}

/**
 * Ivy climbing the walls: strands from the ground at the corners and over
 * the collapse. The lowest leaves come first as vitality falls, and the
 * strands reach higher as it keeps falling, up over the eaves.
 */
export function ivy(b: PartBuilder, plan: BuildingPlan, ruin: Ruin, r: Rand): void {
  for (const w of wallsOf(plan)) {
    const holes = clearings(plan, w, 0.05).filter((h) => h.y0 < plan.floor + 0.5);
    const starts = [0.25 + 0.4 * r.next(), w.length - 0.25 - 0.4 * r.next()];
    const mid = w.length * (0.3 + 0.4 * r.next());
    if (ruinAt(ruin, on(w, mid, 0)) > 0.2 || w.length > 6) starts.push(mid);
    for (const s0 of starts) {
      const zone = Math.max(ruinAt(ruin, on(w, s0, 0)), 0.15);
      const reach = Math.min(8, topAt(plan, w, s0) * (0.65 + 0.5 * zone) + 0.3);
      let s = s0;
      for (let y = 0.15; y < reach; y += 0.22) {
        s = clamp(s + (r.next() - 0.5) * 0.35, 0.1, w.length - 0.1);
        if (holes.some((h) => s > h.s0 && s < h.s1 && y < h.y1)) continue;
        for (let k = 0; k < 2; k++) {
          const ss = clamp(s + (r.next() - 0.5) * 0.5, 0.05, w.length - 0.05);
          const c = on(w, ss, y + (r.next() - 0.5) * 0.15, 0.06 + 0.05 * r.next());
          const height = y / reach;
          const ch: Channels = {
            loss: 0,
            droop: 0,
            wither: 0.2,
            glow: 0,
            pivot: c,
            tint: (r.next() - 0.5) * 0.06,
            grow: clamp(0.62 - 0.5 * height + 0.1 * zone + (r.next() - 0.5) * 0.08, 0.06, 0.7),
          };
          const n = normalize(addScaled(w.n, [r.next() - 0.5, r.next() * 0.4, r.next() - 0.5], 0.5));
          card(b, c, n, [0, 1, 0], 0.32 + 0.16 * r.next(), (r.next() - 0.5) * 1.4, CUT.cluster + r.next() * 0.98, ch, 0.42 + 0.2 * r.next());
        }
      }
    }
  }
}

/**
 * Tufts of rank grass: long blades fanning out from a point on the ground,
 * darker at the root and pale at the tip. They grow in below their
 * thresholds, the rankest first, so a failing house stands in long, dry grass.
 */
export function weeds(b: PartBuilder, spots: readonly { x: number; z: number; grow: number; size: number }[], r: Rand): void {
  for (const spot of spots) {
    const pivot: V3 = [spot.x, 0, spot.z];
    const ch: Channels = { loss: 0, droop: 0.2, wither: 0.6, glow: 0, pivot, tint: (r.next() - 0.5) * 0.08, grow: spot.grow };
    const blades = 7;
    const turn = r.next() * Math.PI * 2;
    for (let k = 0; k < blades; k++) {
      const a = turn + (k / blades) * Math.PI * 2 + (r.next() - 0.5) * 0.6;
      const out: V3 = [Math.cos(a), 0, Math.sin(a)];
      const h = spot.size * (0.65 + 0.55 * r.next());
      const lean = 0.25 + 0.45 * r.next();
      const root = addScaled(pivot, out, 0.04);
      const tip = addScaled(addScaled(root, out, h * lean), [0, 1, 0], h * (1 - lean * 0.4));
      const side: V3 = [-out[2], 0, out[0]];
      const n = normalize(cross(side, [tip[0] - root[0], tip[1] - root[1], tip[2] - root[2]]));
      const half = 0.035 + 0.025 * r.next();
      const i0 = b.vertex(addScaled(root, side, -half), n, 0.18, ch);
      const i1 = b.vertex(addScaled(root, side, half), n, 0.18, ch);
      const i2 = b.vertex(tip, n, 0.85, ch);
      b.triangle(i0, i1, i2);
    }
  }
}

/** Weed spots around a building's feet and through its yard: rankest at the collapse. */
export function weedSpots(plan: BuildingPlan, ruin: Ruin, r: Rand, count: number): { x: number; z: number; grow: number; size: number }[] {
  const out: { x: number; z: number; grow: number; size: number }[] = [];
  const door = plan.openings.find((o) => o.kind === "door");
  for (let i = 0; i < count; i++) {
    const w = wallsOf(plan)[Math.floor(r.next() * 4)] as Wall;
    const s = r.next() * w.length;
    const out0 = 0.15 + Math.pow(r.next(), 2) * 2.4;
    const p = on(w, s, 0, out0);
    // Keep the doorway and its walk passable a little longer.
    const onWalk = door !== undefined && Math.abs(p[0] - door.position[0]) < 0.6 && p[2] > plan.depth / 2;
    const z = ruinAt(ruin, p);
    out.push({ x: p[0], z: p[2], grow: clamp(0.2 + 0.28 * r.next() + 0.15 * z - (onWalk ? 0.15 : 0), 0.06, 0.62), size: 0.45 + 0.5 * r.next() + 0.3 * z });
  }
  return out;
}

/**
 * A rough lump of rubble lying on the ground: a squashed, jittered
 * icosphere, sunk a little, that grows in below its threshold.
 */
export function lump(b: PartBuilder, c: Vec3, radii: Vec3, yaw: number, shade: number, ch: Channels, r: Rand): void {
  const blob = icosphere(0);
  const base = b.vertexCount;
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const jitter = blob.points.map(() => 0.82 + 0.3 * r.next());
  blob.points.forEach((q, i) => {
    const j = jitter[i] as number;
    const x = q[0] * radii[0] * j;
    const z = q[2] * radii[2] * j;
    const y = Math.max(q[1] * radii[1] * j, -radii[1] * 0.35);
    b.vertex([c[0] + x * cs - z * sn, c[1] + y, c[2] + x * sn + z * cs], [q[0] * cs - q[2] * sn, q[1], q[0] * sn + q[2] * cs], shade + 0.15 * q[1], ch);
  });
  for (const [a, bb, cc] of blob.triangles) b.triangle(base + a, base + bb, base + cc);
}

/**
 * Rubble at the foot of the collapse and in a few heaps along the walls:
 * stones and chunks of wall lying on the ground, the ones nearest the weak
 * corner first.
 */
export function rubble(b: PartBuilder, plan: BuildingPlan, ruin: Ruin, r: Rand, size: number, count: number): void {
  for (let i = 0; i < count; i++) {
    // Most rubble lies near the weak corner, inside and out; the rest along the walls.
    const near = i < count * 0.7;
    let x: number;
    let z: number;
    if (near) {
      const a = r.next() * Math.PI * 2;
      const d = Math.pow(r.next(), 0.7) * ruin.reach * 0.55;
      x = ruin.x + Math.cos(a) * d;
      z = ruin.z + Math.sin(a) * d;
    } else {
      const w = wallsOf(plan)[Math.floor(r.next() * 4)] as Wall;
      const p = on(w, r.next() * w.length, 0, 0.2 + r.next() * 0.9);
      x = p[0];
      z = p[2];
    }
    const zone = ruinAt(ruin, [x, 0, z]);
    const s = size * (0.55 + 0.7 * r.next()) * (0.8 + 0.4 * zone);
    const c: V3 = [x, s * 0.08, z];
    const ch: Channels = { loss: 0, droop: 0, wither: 0.55 + 0.3 * r.next(), glow: 0, pivot: [x, 0, z], tint: (r.next() - 0.5) * 0.05, grow: clamp(0.08 + 0.34 * zone * (0.55 + 0.45 * r.next()) + (near ? 0 : 0.06 * r.next()), 0.05, 0.45) };
    lump(b, c, [s, s * 0.55, s * (0.7 + 0.4 * r.next())], r.next() * Math.PI, 0.4 + 0.2 * r.next(), ch, r);
  }
}
