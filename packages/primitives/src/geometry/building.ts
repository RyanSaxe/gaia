// A cottage, built against one plan. The footprint lays out the plan; walls,
// roof, openings and dressing each read it, so they meet without gaps. Every
// vertex carries its vitality response: plaster falls away in patches,
// stones go missing, the roof's eaves sag and moss creeps up from the
// ground, shutters hang crooked, window lights go out one by one, flowers
// vanish and the chimney stops smoking.

import type { BuildContext, BuildingPlan, Built, Opening, Rand, Resolved, Vec3 } from "@gaia/schema";
import type { casementsParams, cottageGardenParams, cottagePlanParams, fieldstoneParams, thatchParams, tilesParams, timberFrameParams } from "../structure.ts";
import { type Channels, PartBuilder, type V3, addScaled, clamp, cross, fbm3, icosphere, lossThreshold, normalize, sub } from "./kit.ts";
import { UP, beam, box, flatStone, log, pillow, quad, tri } from "./blocks.ts";

// ---------- the plan ----------

/** One wall seen from outside: its left end at ground level, the direction to its right end, and its outward normal. */
interface Wall {
  readonly o: V3;
  readonly u: V3;
  readonly n: V3;
  readonly length: number;
  /** A gable wall rises to the ridge. */
  readonly gable: boolean;
}

function wallsOf(plan: BuildingPlan): Wall[] {
  const hw = plan.width / 2;
  const hd = plan.depth / 2;
  return [
    { o: [-hw, 0, hd], u: [1, 0, 0], n: [0, 0, 1], length: plan.width, gable: plan.ridge === "z" },
    { o: [hw, 0, hd], u: [0, 0, -1], n: [1, 0, 0], length: plan.depth, gable: plan.ridge === "x" },
    { o: [hw, 0, -hd], u: [-1, 0, 0], n: [0, 0, -1], length: plan.width, gable: plan.ridge === "z" },
    { o: [-hw, 0, -hd], u: [0, 0, 1], n: [-1, 0, 0], length: plan.depth, gable: plan.ridge === "x" },
  ];
}

/** A point on a wall: `s` along it, `y` up, `d` out from its face. */
const on = (w: Wall, s: number, y: number, d = 0): V3 => [w.o[0] + w.u[0] * s + w.n[0] * d, y, w.o[2] + w.u[2] * s + w.n[2] * d];

const wallTop = (plan: BuildingPlan): number => plan.floor + plan.wallHeight;

/** Height of a wall's top at `s`: level under the eaves, rising to the ridge on a gable. */
function topAt(plan: BuildingPlan, w: Wall, s: number): number {
  const top = wallTop(plan);
  if (!w.gable) return top;
  const half = w.length / 2;
  return top + plan.rise * Math.max(0, 1 - Math.abs(s - half) / half);
}

/** The wall an opening is in, and how far along it. */
function placeOf(plan: BuildingPlan, o: Opening): { wall: Wall; s: number } {
  const walls = wallsOf(plan);
  const wall = walls.reduce((best, w) => (w.n[0] * o.normal[0] + w.n[2] * o.normal[2] > best.n[0] * o.normal[0] + best.n[2] * o.normal[2] ? w : best));
  const s = (o.position[0] - wall.o[0]) * wall.u[0] + (o.position[2] - wall.o[2]) * wall.u[2];
  return { wall, s };
}

const sameWall = (a: Wall, b: Wall): boolean => a.n[0] === b.n[0] && a.n[2] === b.n[2];

export function layOutCottage(p: Resolved<typeof cottagePlanParams>, ctx: BuildContext): BuildingPlan {
  const r = ctx.rand.fork("plan");
  const size = clamp(ctx.facts.size ?? 1, 0.6, 1.4) * p.size;
  const floors = clamp(ctx.facts.floors ?? 1, 1, 2);
  const [w0, d0] = p.shape === "long" ? [7.8, 5.4] : p.shape === "snug" ? [6.2, 5.3] : [5.2, 7.2];
  const width = w0 * size * (0.96 + 0.08 * r.next());
  const depth = d0 * size * (0.96 + 0.08 * r.next());
  const ridge = p.shape === "gable-fronted" ? "z" : "x";
  const halfSpan = (ridge === "x" ? depth : width) / 2;
  const rise = Math.tan((p.roofline * Math.PI) / 180) * halfSpan;
  const wallHeight = 2.45 + (floors - 1) * 2.25;
  const plan0 = { width, depth, floor: p.base, footing: 1.4, wallHeight, rise, ridge, settle: p.character, openings: [] } as const;
  const walls = wallsOf(plan0);
  const [front, right, back, left] = walls as [Wall, Wall, Wall, Wall];
  const count = Math.round(p.windows);
  const openings: Opening[] = [];
  const winW = 0.78 + 0.14 * r.next();
  const winH = 0.98 + 0.12 * r.next();
  const sill = plan0.floor + 0.86;
  const window = (w: Wall, s: number, y: number, scale = 1): void => {
    openings.push({ kind: "window", position: on(w, s, y), normal: w.n, width: winW * scale, height: winH * scale });
  };
  const doorH = Math.min(1.95, wallHeight - 0.32);

  // The door, in the front wall: a little off center on a long house.
  const doorAt = front.length / 2 + (p.shape === "long" ? (r.next() < 0.5 ? -1 : 1) * front.length * 0.12 : 0);
  openings.push({ kind: "door", position: on(front, doorAt, plan0.floor), normal: front.n, width: 0.96, height: doorH });

  // Front windows either side of the door, where they fit with their shutters.
  const reach = Math.max(1.55, front.length * 0.27);
  for (const side of [-1, 1]) {
    const s = doorAt + side * reach;
    if (s > 0.95 && s < front.length - 0.95) window(front, s, sill);
  }
  // The back wall, and the long sides of a gable-fronted house.
  const evenly = (w: Wall, n: number, y: number): void => {
    const fit = Math.min(n, Math.floor((w.length - 0.6) / 1.9));
    for (let k = 1; k <= fit; k++) window(w, (w.length * k) / (fit + 1), y);
  };
  if (ridge === "x") {
    evenly(back, Math.max(1, count - 1), sill);
    // One gable stays blank for the chimney; the other has a window toward the front.
    if (count >= 2) window(right, right.length * 0.34, sill);
    if (count >= 3) window(left, left.length * 0.72, sill, 0.9);
  } else {
    evenly(left, count >= 2 ? 2 : 1, sill);
    evenly(right, count >= 2 ? 2 : 1, sill);
    if (count >= 3) evenly(back, 1, sill);
    // A small attic window under the front peak.
    if (rise > 1.7) window(front, front.length / 2, wallTop(plan0) + 0.3, 0.7);
  }
  // An upper storey repeats the front windows above.
  if (floors >= 1.5) {
    for (const o of [...openings]) {
      const { wall, s } = placeOf(plan0, o);
      if (sameWall(wall, front) && o.position[1] < plan0.floor + 1.2) window(front, s, plan0.floor + 2.25 + 0.72, 0.85);
    }
  }
  return { ...plan0, openings };
}

// ---------- shared ----------

const still = (pivot: Vec3, wither: number, extra: Partial<Channels> = {}): Channels => ({ loss: 0, droop: 0, wither, glow: 0, pivot, ...extra });

/** Rectangles on a wall that stonework and studs keep clear of. */
function clearings(plan: BuildingPlan, w: Wall, margin: number): { s0: number; s1: number; y0: number; y1: number }[] {
  return plan.openings
    .map((o) => ({ o, at: placeOf(plan, o) }))
    .filter((x) => sameWall(x.at.wall, w))
    .map(({ o, at }) => ({ s0: at.s - o.width / 2 - margin, s1: at.s + o.width / 2 + margin, y0: o.position[1] - margin, y1: o.position[1] + o.height + margin }));
}

/** The settled lean of a building: a gentle, seeded wobble that grows with `settle`. */
const wobble = (plan: BuildingPlan, seed: number, p: Vec3, amount: number): number => plan.settle * amount * fbm3(p[0] * 0.35, p[1] * 0.35, p[2] * 0.35, seed, 2);

/** A plinth of squared stones under the walls, from the footing up to the floor. */
function plinth(b: PartBuilder, plan: BuildingPlan, r: Rand): void {
  const rows = Math.max(1, Math.round((plan.floor + 0.1) / 0.24));
  const rowH = (plan.floor + 0.1) / rows;
  for (const w of wallsOf(plan)) {
    for (let row = 0; row < rows; row++) {
      const y0 = row === 0 ? -plan.footing : -0.1 + row * rowH;
      const y1 = -0.1 + (row + 1) * rowH;
      let s = -0.12 - (row % 2) * 0.25;
      while (s < w.length + 0.1) {
        const len = 0.45 + 0.35 * r.next();
        const s1 = Math.min(w.length + 0.12, s + len);
        const d = 0.06 + 0.025 * r.next();
        const c = on(w, (s + s1) / 2, (y0 + y1) / 2, d - 0.12);
        const shade = 0.42 + 0.22 * r.next();
        box(b, c, [w.u, UP, w.n], [(s1 - s) / 2 - 0.012, (y1 - y0) / 2 - 0.01, 0.12], shade, still(c, 0.35 + 0.4 * r.next(), { tint: (r.next() - 0.5) * 0.04 }), { bottom: true });
        s = s1;
      }
    }
  }
}

/** The wall's core: a plain face set just behind the surface, which shows where plaster has fallen. */
function core(b: PartBuilder, plan: BuildingPlan, inset: number, from: number): void {
  for (const w of wallsOf(plan)) {
    const top = wallTop(plan);
    const pivot = on(w, w.length / 2, top / 2);
    const c = still(pivot, 0.6);
    quad(b, [on(w, 0, from, -inset), on(w, w.length, from, -inset), on(w, w.length, top, -inset), on(w, 0, top, -inset)], w.n, 0.38, c);
    if (w.gable) tri(b, [on(w, 0, top, -inset), on(w, w.length, top, -inset), on(w, w.length / 2, top + plan.rise, -inset)], w.n, 0.38, c);
  }
}

// ---------- timber frame ----------

export function buildTimberFrame(p: Resolved<typeof timberFrameParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("timber-frame");
  const seed = Math.floor(r.next() * 1e6);
  const masonry = new PartBuilder("masonry", "solid");
  const plaster = new PartBuilder("wall", "solid");
  const timber = new PartBuilder("timber", "solid");
  plinth(masonry, plan, r.fork("plinth"));
  core(masonry, plan, 0.03, plan.floor);
  const top = wallTop(plan);
  const beamW = 0.17;
  const out = 0.03;

  for (const w of wallsOf(plan)) {
    const holes = clearings(plan, w, 0.02);
    // Upright timbers: the corners, both sides of every opening, then fill.
    const posts = new Set<number>([beamW / 2, w.length - beamW / 2]);
    for (const h of holes) {
      posts.add(h.s0 - beamW / 2);
      posts.add(h.s1 + beamW / 2);
    }
    const gap = p.framing === "close studding" ? 0.5 : 1.45;
    const sorted = [...posts].filter((s) => s >= beamW / 2 - 1e-6 && s <= w.length - beamW / 2 + 1e-6).sort((a, b) => a - b);
    const filled: number[] = [];
    sorted.forEach((s, i) => {
      filled.push(s);
      const next = sorted[i + 1];
      if (next === undefined) return;
      const n = Math.floor((next - s) / gap);
      for (let k = 1; k < n + 1 && n > 0; k++) filled.push(s + ((next - s) * k) / (n + 1));
    });
    const blocked = (s: number, y0: number, y1: number): boolean => holes.some((h) => s > h.s0 - beamW * 0.4 && s < h.s1 + beamW * 0.4 && y1 > h.y0 && y0 < h.y1);
    const sill = plan.floor + beamW / 2;
    const plate = top - beamW / 2;
    const rail = plan.floor + 0.84 - 0.06;
    const lean = (s: number, y: number): V3 => on(w, s + wobble(plan, seed, on(w, s, y), 0.09), y, out);
    const pivotOf = (s: number): V3 => on(w, s < w.length / 2 ? 0 : w.length, top);
    const ch = (s: number, sag = 0): Channels => still(pivotOf(s), 0.5, { droop: sag * Math.sin((Math.PI * clamp(s / w.length, 0, 1))), tint: (r.next() - 0.5) * 0.03 });

    // Sill and wall plate run the whole length; the plate sags a little as the house declines.
    beam(timber, lean(-0.05, sill), lean(w.length + 0.05, sill), beamW, 0.09, w.n, 0.42, ch(w.length / 2));
    for (let k = 0; k < 6; k++) {
      const s0 = (w.length * k) / 6;
      const s1 = (w.length * (k + 1)) / 6;
      beam(timber, lean(s0 - (k === 0 ? 0.05 : 0), plate), lean(s1 + (k === 5 ? 0.05 : 0), plate), beamW, 0.1, w.n, 0.46, ch((s0 + s1) / 2, 0.05));
    }
    // Posts, broken where an opening passes.
    for (const s of filled) {
      const spans: [number, number][] = [];
      let y = sill;
      for (const h of holes.filter((h) => s > h.s0 - beamW * 0.4 && s < h.s1 + beamW * 0.4).sort((a, b) => a.y0 - b.y0)) {
        if (h.y0 > y) spans.push([y, h.y0]);
        y = Math.max(y, h.y1);
      }
      if (plate > y) spans.push([y, plate]);
      for (const [a, b2] of spans) if (b2 - a > 0.12) beam(timber, lean(s, a), lean(s, b2), beamW * 0.9, 0.09, w.n, 0.44 + 0.08 * r.next(), ch(s));
    }
    // Rails at window-sill height between posts, and braces in the end bays.
    if (p.framing !== "close studding") {
      const all = [...filled].sort((a, b) => a - b);
      for (let i = 0; i + 1 < all.length; i++) {
        const a = all[i] as number;
        const b2 = all[i + 1] as number;
        const mid = (a + b2) / 2;
        if (!blocked(mid, rail - 0.08, rail + 0.08)) beam(timber, lean(a, rail), lean(b2, rail), beamW * 0.8, 0.08, w.n, 0.42, ch(mid));
        if (p.framing === "crossed braces" && (i === 0 || i === all.length - 2) && !blocked(mid, rail, plate)) {
          const [s0, s1] = i === 0 ? [a, b2] : [b2, a];
          beam(timber, lean(s0, plate - 0.05), lean(s1, rail + 0.05), beamW * 0.75, 0.08, w.n, 0.4, ch(mid));
        }
      }
    }
    // Gables: a king post and a collar.
    if (w.gable) {
      const half = w.length / 2;
      const collar = top + plan.rise * 0.45;
      const reachAt = half * (1 - 0.45) - 0.1;
      beam(timber, lean(half, top), lean(half, top + plan.rise - 0.12), beamW, 0.09, w.n, 0.44, ch(half));
      beam(timber, lean(half - reachAt, collar), lean(half + reachAt, collar), beamW * 0.9, 0.09, w.n, 0.42, ch(half));
    }

    // Plaster panels between the timbers. Some are loose, and fall away as the house declines.
    const verticals = [0, ...filled, w.length].sort((a, b) => a - b);
    const levels = p.framing === "close studding" ? [plan.floor, top] : [plan.floor, rail, top];
    for (let i = 0; i + 1 < verticals.length; i++) {
      const s0 = verticals[i] as number;
      const s1 = verticals[i + 1] as number;
      if (s1 - s0 < 0.05) continue;
      for (let j = 0; j + 1 < levels.length; j++) {
        panel(plaster, plan, w, s0, s1, levels[j] as number, levels[j + 1] as number, p.plaster, r, seed);
      }
    }
    if (w.gable) {
      const half = w.length / 2;
      for (const [s0, s1] of [[0, half], [half, w.length]] as const) {
        const apex = s0 === 0 ? on(w, half, top + plan.rise, 0.008) : on(w, half, top + plan.rise, 0.008);
        const a = on(w, s0, top, 0.008);
        const b2 = on(w, s1, top, 0.008);
        tri(plaster, [a, b2, apex], w.n, 0.58, still(on(w, half, top + plan.rise / 2), 0.55));
      }
    }
  }
  return { parts: [masonry.part(), plaster.part(), timber.part()], anchors: [] };
}

/** One plaster panel: a slightly bulging 3x3 sheet, its shade hand-laid. */
function panel(b: PartBuilder, plan: BuildingPlan, w: Wall, s0: number, s1: number, y0: number, y1: number, rough: number, r: Rand, seed: number): void {
  const loose = r.next() < 0.4;
  const u = r.next();
  const center = on(w, (s0 + s1) / 2, (y0 + y1) / 2, 0.01);
  const c: Channels = {
    loss: loose ? lossThreshold(u, 0.42, 0.06) : 0,
    droop: 0,
    wither: 0.45 + 0.35 * r.next(),
    glow: 0,
    pivot: center,
    tint: (r.next() - 0.5) * 0.02,
  };
  const base = 0.6 + 0.08 * (r.next() - 0.5);
  const idx: number[] = [];
  for (let j = 0; j <= 2; j++) {
    for (let i = 0; i <= 2; i++) {
      const s = s0 + ((s1 - s0) * i) / 2;
      const y = y0 + ((y1 - y0) * j) / 2;
      const inner = i === 1 && j === 1 ? 1 : i === 1 || j === 1 ? 0.45 : 0;
      const n = fbm3(s * 1.3 + w.n[0] * 7, y * 1.3, w.n[2] * 7, seed, 2);
      const d = 0.008 + inner * 0.014 * rough + n * 0.006 * rough;
      const q = on(w, s + wobble(plan, seed, on(w, s, y), 0.09), y, d);
      const normal = normalize(addScaled(w.n, w.u, n * 0.12 * rough));
      idx.push(b.vertex(q, normal, base + n * 0.12 * rough + inner * 0.04, c));
    }
  }
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const a = idx[j * 3 + i] as number;
      const bb = idx[j * 3 + i + 1] as number;
      const cc = idx[(j + 1) * 3 + i + 1] as number;
      const dd = idx[(j + 1) * 3 + i] as number;
      // Walls are built with u to the right and y up, so this winding faces out along n.
      b.triangle(a, bb, cc);
      b.triangle(a, cc, dd);
    }
  }
}

// ---------- fieldstone ----------

export function buildFieldstone(p: Resolved<typeof fieldstoneParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("fieldstone");
  const seed = Math.floor(r.next() * 1e6);
  const mortar = new PartBuilder("wall", "solid");
  const stones = new PartBuilder("masonry", "solid");
  const boards = new PartBuilder("timber", "solid");
  core(mortar, plan, -0.005, -plan.footing);
  const top = wallTop(plan);
  const size = p.stones;
  for (const w of wallsOf(plan)) {
    const holes = clearings(plan, w, 0.06);
    const gableTop = (s: number): number => (w.gable && p.gables === "stone" ? topAt(plan, w, s) : top);
    let y = -0.12;
    let row = 0;
    while (y < topAt(plan, w, w.length / 2) - 0.05) {
      const h = size * (0.62 + 0.22 * r.next());
      let s = -0.08 - (row % 2) * size * 0.45;
      while (s < w.length + 0.05) {
        // Corner stones are long and alternate, binding the walls together.
        const corner = s < 0.2 || s > w.length - 0.9;
        const len = size * (corner ? 1.5 : 0.85 + 0.6 * r.next());
        const mid = s + len / 2;
        const cy = y + h / 2;
        const clear = cy + h * 0.3 < gableTop(clamp(mid, 0, w.length)) && !holes.some((o) => mid + len * 0.4 > o.s0 && mid - len * 0.4 < o.s1 && cy + h * 0.4 > o.y0 && cy - h * 0.4 < o.y1);
        if (clear && mid > -0.02 && mid < w.length + 0.02) {
          const c = on(w, clamp(mid, 0.05, w.length - 0.05) + wobble(plan, seed, on(w, mid, cy), 0.07), cy, 0);
          const ground = clamp(cy / 1.8, 0, 1);
          const missing = r.next() < 0.05;
          pillow(stones, c, w.u, w.n, len * 0.94, h * 0.9, 0.05 + 0.05 * r.next(), 0.4 + 0.25 * r.next(), {
            loss: missing ? lossThreshold(r.next(), 0.3, 0.05) : 0,
            droop: 0,
            wither: 0.3 + 0.55 * (1 - ground) + 0.15 * r.next(),
            glow: 0,
            pivot: c,
            tint: (r.next() - 0.5) * 0.06,
          }, r);
        }
        s += len;
      }
      y += h;
      row++;
    }
    // Upright boards under the peak.
    if (w.gable && p.gables === "boards") {
      const bw = 0.24;
      for (let s = bw / 2; s < w.length; s += bw) {
        const h = topAt(plan, w, s) - top - 0.05;
        if (h < 0.1) continue;
        const c = on(w, s, top - 0.15 + (h + 0.15) / 2, 0.04);
        box(boards, c, [w.u, UP, w.n], [bw / 2 - 0.012, (h + 0.15) / 2, 0.03], 0.42 + 0.14 * r.next(), still(c, 0.55, { tint: (r.next() - 0.5) * 0.03 }));
      }
      beam(boards, on(w, -0.05, top - 0.12, 0.06), on(w, w.length + 0.05, top - 0.12, 0.06), 0.18, 0.1, w.n, 0.38, still(on(w, w.length / 2, top), 0.5));
    }
  }
  const parts = [mortar.part(), stones.part()];
  if (boards.vertexCount > 0) parts.push(boards.part());
  return { parts, anchors: [] };
}

// ---------- roofs ----------

interface ProfilePoint {
  readonly b: number;
  readonly y: number;
  /** A sharp edge: the faces either side keep their own normals. */
  readonly crease?: boolean;
  /** Part of the upper surface, which takes lumps and courses. */
  readonly top?: boolean;
}

interface RoofFrame {
  /** Unit vectors along the ridge and across the span. */
  readonly ax: V3;
  readonly bx: V3;
  /** Half the walls' length along the ridge, and half their span. */
  readonly halfLength: number;
  readonly halfSpan: number;
  readonly top: number;
  readonly rise: number;
}

function roofFrame(plan: BuildingPlan): RoofFrame {
  const alongX = plan.ridge === "x";
  return {
    ax: alongX ? [1, 0, 0] : [0, 0, 1],
    bx: alongX ? [0, 0, 1] : [1, 0, 0],
    halfLength: (alongX ? plan.width : plan.depth) / 2,
    halfSpan: (alongX ? plan.depth : plan.width) / 2,
    top: wallTop(plan),
    rise: plan.rise,
  };
}

const roofPoint = (f: RoofFrame, a: number, b: number, y: number): V3 => [f.ax[0] * a + f.bx[0] * b, y, f.ax[2] * a + f.bx[2] * b];

/**
 * Extrudes a closed, counter-clockwise (b, y) profile along the ridge from
 * `a0` to `a1`, and caps both gable ends. `shape` displaces each point and
 * `chan` gives each vertex its channels and shade.
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
          const normal = normalize([f.bx[0] * nb, ny, f.bx[2] * nb]);
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

/** The chimney, its cap and pot, and where its smoke rises from. */
function chimney(stack: PartBuilder, plan: BuildingPlan, f: RoofFrame, where: "gable" | "ridge" | "none", r: Rand): V3 | null {
  if (where === "none") return null;
  const top = f.top;
  const ridgeY = top + f.rise;
  let base: V3;
  let foot: number;
  let width: number;
  let deep: number;
  if (where === "gable") {
    // The end with fewer openings, against its outside face.
    const ends = [-1, 1].map((sign) => ({
      sign,
      count: plan.openings.filter((o) => o.normal[0] * f.ax[0] + o.normal[2] * f.ax[2] > 0.9 * sign && sign * (o.normal[0] * f.ax[0] + o.normal[2] * f.ax[2]) > 0.5).length,
    }));
    const sign = (ends[0] as { count: number }).count <= (ends[1] as { count: number }).count ? -1 : 1;
    base = roofPoint(f, sign * (f.halfLength + 0.34), 0, 0);
    foot = -0.4;
    width = 1.15;
    deep = 0.68;
  } else {
    const sign = r.next() < 0.5 ? -1 : 1;
    base = roofPoint(f, sign * f.halfLength * 0.48, 0, 0);
    foot = top - 0.2;
    width = 0.78;
    deep = 0.66;
  }
  const crown = ridgeY + 0.95;
  const lean = plan.settle * 0.05 * (r.next() - 0.5);
  const courses = Math.max(3, Math.round((crown - foot) / 0.42));
  const shoulder = where === "gable" ? top * 0.8 : foot;
  for (let k = 0; k < courses; k++) {
    const y0 = foot + ((crown - foot) * k) / courses;
    const y1 = foot + ((crown - foot) * (k + 1)) / courses;
    const narrow = y0 >= shoulder ? 0.66 : 1;
    const w = width * narrow + 0.03 * (r.next() - 0.5);
    const d = (where === "gable" && y0 >= shoulder ? deep * 0.8 : deep) + 0.02 * r.next();
    const c = addScaled(addScaled(base, f.ax, lean * (y0 - foot) + (where === "gable" && y0 >= shoulder ? -Math.sign(base[0] * f.ax[0] + base[2] * f.ax[2]) * 0.06 : 0)), UP, (y0 + y1) / 2);
    box(stack, c, [f.bx, UP, f.ax], [w / 2, (y1 - y0) / 2 + 0.004, d / 2], 0.42 + 0.16 * r.next(), still(c, 0.35 + 0.3 * (1 - clamp(y0 / 3, 0, 1)), { tint: (r.next() - 0.5) * 0.04 }), { bottom: k > 0 });
  }
  const capC = addScaled(addScaled(base, f.ax, lean * (crown - foot)), UP, crown + 0.06);
  box(stack, capC, [f.bx, UP, f.ax], [width * 0.66 / 2 + 0.08, 0.06, deep * 0.8 / 2 + 0.08], 0.55, still(capC, 0.45));
  const potFrom = addScaled(capC, UP, 0.06);
  log(stack, potFrom, addScaled(potFrom, UP, 0.32), 0.13, 0.4, still(potFrom, 0.5), 7);
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

export function buildThatch(p: Resolved<typeof thatchParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("thatch");
  const seed = Math.floor(r.next() * 1e6);
  const f = roofFrame(plan);
  const roof = new PartBuilder("roof", "solid");
  const stack = new PartBuilder("masonry", "solid");
  const puffs = new PartBuilder("smoke");
  const k = f.rise / f.halfSpan;
  const secant = Math.sqrt(1 + k * k);
  const T = p.thickness;
  const reach = f.halfSpan + p.overhang + T * 0.3;
  const under = (b: number): number => f.top + f.rise - k * Math.abs(b) - 0.02;
  const surface = (b: number): number => under(b) + T * secant;
  // The profile, counter-clockwise: underside left to right, then the upper
  // surface back over the ridge, in soft courses, with rolled eaves.
  const courses = 4;
  const lip = T * 0.22;
  const profile: ProfilePoint[] = [
    { b: -reach, y: under(reach) },
    { b: 0, y: under(0), crease: true },
    { b: reach, y: under(reach), crease: true },
  ];
  const side = (sign: number): ProfilePoint[] => {
    const pts: ProfilePoint[] = [];
    // The rolled eave: out and round from the underside to the upper surface.
    for (let i = 1; i <= 3; i++) {
      const t = (i / 4) * Math.PI;
      pts.push({ b: sign * (reach + Math.sin(t) * T * 0.38), y: under(reach) + (1 - Math.cos(t)) * 0.5 * (surface(reach) + lip - under(reach)), top: true });
    }
    for (let c = 0; c < courses; c++) {
      const t0 = c / courses;
      const t1 = (c + 1) / courses;
      const b0 = reach * (1 - t0) * 0.98 + 0.25 * t0;
      const b1 = reach * (1 - t1) * 0.98 + 0.25 * t1;
      pts.push({ b: sign * b0, y: surface(b0) + lip * (c === 0 ? 1 : 0.8), top: true, crease: c === 0 });
      pts.push({ b: sign * (b0 * 0.55 + b1 * 0.45), y: surface(b0 * 0.55 + b1 * 0.45) + lip * 0.4, top: true });
      pts.push({ b: sign * (b1 + 0.04), y: surface(b1 + 0.04) + 0.01, top: true, crease: c < courses - 1 });
    }
    return sign > 0 ? pts : pts.reverse();
  };
  // The ridge roll over the apex.
  const roll: ProfilePoint[] = [];
  const rr = T * 0.75;
  for (let i = 0; i <= 6; i++) {
    const t = (i / 6) * Math.PI;
    roll.push({ b: Math.cos(t) * rr * 1.1, y: surface(0) - rr * 0.35 + Math.sin(t) * rr, top: true });
  }
  profile.push(...side(1), ...roll, ...side(-1));
  const overGable = p.overhang * 0.75 + 0.15;
  const a0 = -f.halfLength - overGable;
  const a1 = f.halfLength + overGable;
  const segments = Math.max(10, Math.round((a1 - a0) / 0.45));
  extrudeRoof(
    roof,
    f,
    profile,
    a0,
    a1,
    segments,
    (a, pt, [nb, ny]) => {
      const lump = pt.top === true ? 0.035 * fbm3(a * 0.9, pt.b * 0.9, pt.y * 0.5, seed, 2) : 0;
      const end = Math.max(0, Math.abs(a) - f.halfLength) / overGable;
      // Gable ends round down a little, and a settled roof dips mid-ridge.
      const dip = plan.settle * 0.14 * Math.sin(Math.PI * clamp((a - a0) / (a1 - a0), 0, 1)) + (pt.top === true ? end * end * T * 0.35 : 0);
      return addScaled(roofPoint(f, a, pt.b + nb * lump, pt.y + ny * lump - dip), UP, 0);
    },
    (a, pt) => {
      const e = clamp(Math.abs(pt.b) / reach, 0, 1);
      const n = fbm3(a * 0.6, pt.b * 0.6, 3.1, seed + 9, 2);
      const shade = pt.top === true ? 0.52 + 0.1 * n + 0.08 * (1 - e) : 0.3;
      return {
        shade,
        c: { loss: 0, droop: sagOf(f, a, pt.b, reach), wither: clamp(0.5 + 0.35 * e + 0.2 * n, 0, 1), glow: 0, pivot: roofPoint(f, a, 0, f.top + f.rise), tint: 0.025 * n },
      };
    },
  );
  const vent = chimney(stack, plan, f, p.chimney, r.fork("chimney"));
  if (vent !== null) smoke(puffs, vent, r.fork("smoke"));
  const parts = [roof.part(), stack.part()].filter((part) => part.indices.length > 0);
  if (vent !== null) parts.push(puffs.part());
  return { parts, anchors: [] };
}

export function buildTiles(p: Resolved<typeof tilesParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("tiles");
  const seed = Math.floor(r.next() * 1e6);
  const f = roofFrame(plan);
  const roof = new PartBuilder("roof", "solid");
  const stack = new PartBuilder("masonry", "solid");
  const puffs = new PartBuilder("smoke");
  const k = f.rise / f.halfSpan;
  const secant = Math.sqrt(1 + k * k);
  const T = 0.16;
  const reach = f.halfSpan + p.overhang;
  // A gentle kick: the slope flattens over the last stretch of the eaves.
  const under = (b: number): number => {
    const ab = Math.abs(b);
    const kick = Math.max(0, ab - f.halfSpan + 0.1);
    return f.top + f.rise - k * ab + kick * kick * k * 0.35 - 0.02;
  };
  const surface = (b: number): number => under(b) + T * secant;
  const course = p.covering === "slates" ? 0.26 : p.covering === "shingles" ? 0.3 : 0.34;
  const step = p.covering === "slates" ? 0.018 : 0.03;
  const profile: ProfilePoint[] = [
    { b: -reach, y: under(reach) },
    { b: 0, y: under(0), crease: true },
    { b: reach, y: under(reach), crease: true },
  ];
  const side = (sign: number): ProfilePoint[] => {
    const pts: ProfilePoint[] = [{ b: sign * (reach + 0.02), y: surface(reach) - T * 0.9, top: true, crease: true }];
    const n = Math.max(3, Math.round((reach - 0.18) / course));
    for (let c = 0; c < n; c++) {
      const b0 = reach - ((reach - 0.18) * c) / n;
      const b1 = reach - ((reach - 0.18) * (c + 1)) / n;
      pts.push({ b: sign * b0, y: surface(b0) + step, top: true, crease: true });
      pts.push({ b: sign * (b1 + 0.01), y: surface(b1 + 0.01), top: true, crease: true });
    }
    return sign > 0 ? pts : pts.reverse();
  };
  const roll: ProfilePoint[] = [];
  const rr = 0.13;
  for (let i = 0; i <= 4; i++) {
    const t = (i / 4) * Math.PI;
    roll.push({ b: Math.cos(t) * rr * 1.6, y: surface(0) + Math.sin(t) * rr - 0.02, top: true });
  }
  profile.push(...side(1), ...roll, ...side(-1));
  const overGable = p.overhang * 0.6 + 0.12;
  const a0 = -f.halfLength - overGable;
  const a1 = f.halfLength + overGable;
  const tileW = p.covering === "pantiles" ? 0.3 : p.covering === "slates" ? 0.36 : 0.22;
  const segments = Math.max(12, Math.round((a1 - a0) / (p.covering === "pantiles" ? tileW / 4 : tileW)));
  extrudeRoof(
    roof,
    f,
    profile,
    a0,
    a1,
    segments,
    (a, pt, [nb, ny]) => {
      const wave = p.covering === "pantiles" && pt.top === true && Math.abs(pt.b) > 0.3 ? 0.045 * Math.abs(Math.sin((Math.PI * a) / tileW)) : 0;
      const dip = plan.settle * 0.12 * Math.sin(Math.PI * clamp((a - a0) / (a1 - a0), 0, 1));
      return roofPoint(f, a, pt.b + nb * wave, pt.y + ny * wave - dip);
    },
    (a, pt) => {
      const e = clamp(Math.abs(pt.b) / reach, 0, 1);
      const row = Math.floor(Math.abs(pt.b) / course);
      const col = Math.floor(a / tileW + (row % 2) * 0.5);
      const cell = fbm3(col * 1.7, row * 2.3, 0.5, seed, 1);
      const n = fbm3(a * 0.4, pt.b * 0.4, 1.3, seed + 5, 2);
      const vary = p.covering === "pantiles" ? 0.06 : 0.12;
      const shade = pt.top === true ? 0.5 + vary * cell + 0.06 * n : 0.28;
      return {
        shade,
        c: { loss: 0, droop: sagOf(f, a, pt.b, reach), wither: clamp(0.45 + 0.4 * e * e + 0.25 * n, 0, 1), glow: 0, pivot: roofPoint(f, a, 0, f.top + f.rise), tint: 0.03 * cell },
      };
    },
  );
  const vent = chimney(stack, plan, f, p.chimney, r.fork("chimney"));
  if (vent !== null) smoke(puffs, vent, r.fork("smoke"));
  const parts = [roof.part(), stack.part()].filter((part) => part.indices.length > 0);
  if (vent !== null) parts.push(puffs.part());
  return { parts, anchors: [] };
}

// ---------- openings ----------

export function buildCasements(p: Resolved<typeof casementsParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("casements");
  const glass = new PartBuilder("glass");
  const frame = new PartBuilder("timber", "solid");
  const trim = new PartBuilder("trim", "solid");
  const stone = new PartBuilder("masonry", "solid");
  for (const o of plan.openings) {
    const { wall: w, s } = placeOf(plan, o);
    const y = o.position[1];
    const at = (ds: number, dy: number, d: number): V3 => on(w, s + ds, y + dy, d);
    const hw = o.width / 2;
    const axes = [w.u, UP, w.n] as const;
    const wr = r.fork(`${o.kind}-${s.toFixed(2)}-${y.toFixed(2)}`);
    const pivot = at(0, o.height / 2, 0);
    const wood = (): Channels => still(pivot, 0.5, { tint: (wr.next() - 0.5) * 0.02 });
    if (o.kind === "window") {
      // A dark pane, and in front of it the lamplit pane, which goes out below its threshold.
      quad(glass, [at(-hw, 0, 0.035), at(hw, 0, 0.035), at(hw, o.height, 0.035), at(-hw, o.height, 0.035)], w.n, 0.2, still(pivot, 1));
      const lit: Channels = { loss: lossThreshold(wr.next(), 0.62, 0.2), droop: 0, wither: 0.25, glow: 0.7 + 0.3 * wr.next(), pivot };
      quad(glass, [at(-hw, 0, 0.045), at(hw, 0, 0.045), at(hw, o.height, 0.045), at(-hw, o.height, 0.045)], w.n, [0.55, 0.55, 0.85, 0.85], lit);
      // Frame, glazing bars, sill and lintel.
      const fw = 0.085;
      box(frame, at(0, o.height + fw / 2, 0.07), axes, [hw + fw, fw / 2, 0.05], 0.46, wood());
      box(frame, at(0, -fw / 2 + 0.01, 0.07), axes, [hw + fw, fw / 2, 0.05], 0.4, wood());
      for (const sign of [-1, 1]) box(frame, at(sign * (hw + fw / 2), o.height / 2, 0.07), axes, [fw / 2, o.height / 2 + fw, 0.05], 0.42, wood());
      const bars = p.panes === "four panes" ? { v: 1, h: 1 } : p.panes === "six panes" ? { v: 1, h: 2 } : { v: 0, h: 0 };
      for (let i = 1; i <= bars.v; i++) box(frame, at(-hw + (o.width * i) / (bars.v + 1), o.height / 2, 0.06), axes, [0.018, o.height / 2, 0.02], 0.5, wood());
      for (let i = 1; i <= bars.h; i++) box(frame, at(0, (o.height * i) / (bars.h + 1), 0.06), axes, [hw, 0.018, 0.02], 0.5, wood());
      const sillC = at(0, -0.06, 0.1);
      box(stone, sillC, axes, [hw + 0.14, 0.045, 0.12], 0.62, still(sillC, 0.5));
      // Shutters: upright boards with a ledge; one may hang off its hinge as the house declines.
      if (p.shutters) {
        for (const sign of [-1, 1]) {
          const sw = hw + 0.02;
          const inner = sign * (hw + fw);
          const hinge = at(inner, o.height + fw, 0.05);
          const loose = wr.next() < 0.35;
          const ch: Channels = {
            loss: wr.next() < 0.12 ? lossThreshold(wr.next(), 0.22, 0.04) : 0,
            droop: loose ? 0.3 : 0.04,
            wither: 0.55 + 0.3 * wr.next(),
            glow: 0,
            pivot: hinge,
            tint: (wr.next() - 0.5) * 0.02,
          };
          const boards = 3;
          for (let k = 0; k < boards; k++) {
            const bc = inner + sign * (sw * (k + 0.5)) / boards;
            box(trim, at(bc, o.height / 2, 0.05), axes, [sw / boards / 2 - 0.008, o.height / 2 + fw * 0.6, 0.022], 0.5 + 0.08 * wr.next(), ch);
          }
          box(trim, at(inner + (sign * sw) / 2, o.height * 0.72, 0.08), axes, [sw / 2 - 0.02, 0.035, 0.012], 0.6, ch);
          box(trim, at(inner + (sign * sw) / 2, o.height * 0.25, 0.08), axes, [sw / 2 - 0.02, 0.035, 0.012], 0.6, ch);
        }
      }
    } else {
      const h = o.height;
      const arched = p.door === "arched";
      // Planks; an arched door's tops follow its arch.
      const planks = 5;
      for (let k = 0; k < planks; k++) {
        const x = -hw + (o.width * (k + 0.5)) / planks;
        const ph = arched ? h - hw + Math.sqrt(Math.max(0, hw * hw - x * x)) : h;
        box(trim, at(x, ph / 2, 0.035), axes, [o.width / planks / 2 - 0.008, ph / 2, 0.03], 0.46 + 0.1 * wr.next(), still(pivot, 0.55, { tint: (wr.next() - 0.5) * 0.02 }));
      }
      for (const ly of [0.28, 0.74]) box(frame, at(0, h * ly, 0.08), axes, [hw - 0.06, 0.06, 0.018], 0.48, wood());
      const knob = at(hw * 0.62, h * 0.48, 0.11);
      box(frame, knob, axes, [0.03, 0.03, 0.03], 0.3, wood());
      // Frame and lintel; an arched door's frame is a ring of short beams.
      const fw = 0.11;
      if (arched) {
        const spring = h - hw;
        for (const sign of [-1, 1]) box(frame, at(sign * (hw + fw / 2), spring / 2, 0.075), axes, [fw / 2, spring / 2, 0.06], 0.42, wood());
        const steps = 6;
        for (let i = 0; i < steps; i++) {
          const t0 = (i / steps) * Math.PI;
          const t1 = ((i + 1) / steps) * Math.PI;
          const R = hw + fw / 2;
          beam(frame, at(Math.cos(t0) * R, spring + Math.sin(t0) * R, 0.075), at(Math.cos(t1) * R, spring + Math.sin(t1) * R, 0.075), fw, 0.12, w.n, 0.44, wood());
        }
      } else {
        for (const sign of [-1, 1]) box(frame, at(sign * (hw + fw / 2), h / 2, 0.075), axes, [fw / 2, h / 2 + fw, 0.06], 0.42, wood());
        box(frame, at(0, h + fw / 2, 0.08), axes, [hw + fw + 0.12, fw / 2 + 0.02, 0.07], 0.46, wood());
      }
      // A small pitched hood over the door, on two brackets.
      if (p.door === "hooded") {
        const eave = Math.min(h + 0.14, plan.wallHeight - 0.42);
        const peak = eave + 0.32;
        const half = hw + 0.36;
        for (const sign of [-1, 1]) {
          const from = at(0, peak, 0);
          const to = at(sign * half, eave, 0);
          const along = normalize(sub(to, from));
          let slab = normalize(cross(along, w.n));
          if (slab[1] < 0) slab = [-slab[0], -slab[1], -slab[2]];
          const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
          const mid = addScaled(addScaled(from, sub(to, from), 0.5), w.n, 0.36);
          box(trim, mid, [along, slab, w.n], [len / 2 + 0.06, 0.035, 0.36], 0.52, still(at(0, peak, 0), 0.55, { droop: 0.05 }));
        }
        for (const sign of [-1, 1]) beam(frame, at(sign * (hw + 0.16), h - 0.3, 0.02), at(sign * (hw + 0.16), eave - 0.02, 0.55), 0.07, 0.07, w.u, 0.4, wood());
      }
      // Steps up to the floor.
      const n = Math.max(1, Math.round(plan.floor / 0.2));
      const rise = plan.floor / n;
      for (let i = 0; i < n; i++) {
        const top = plan.floor - i * rise;
        const out = 0.36 * (i + 1);
        const sc = on(w, s, (top - 0.4) / 2, out / 2);
        box(stone, sc, axes, [hw + 0.22 - i * 0.02 + 0.03 * wr.next(), (top + 0.4) / 2, out / 2], 0.56 + 0.08 * wr.next(), still(sc, 0.5), { bottom: true });
      }
    }
  }
  return { parts: [glass.part(), frame.part(), trim.part(), stone.part()].filter((part) => part.indices.length > 0), anchors: [] };
}

// ---------- dressing ----------

export function buildGarden(p: Resolved<typeof cottageGardenParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("garden");
  const walk = new PartBuilder("masonry", "walkable");
  const wood = new PartBuilder("timber", "solid");
  const paint = new PartBuilder("trim", "solid");
  const leaf = new PartBuilder("leaf");
  const bloom = new PartBuilder("bloom");
  const lamp = new PartBuilder("glass");
  const fence = new PartBuilder("wall", "solid");
  const extras = new Set(p.extras);
  const door = plan.openings.find((o) => o.kind === "door");
  const steps = Math.max(1, Math.round(plan.floor / 0.2));
  const blob = icosphere(0);

  const sphere = (b: PartBuilder, c: Vec3, radii: Vec3, shade: number, ch: Channels): void => {
    const base = b.vertexCount;
    for (const q of blob.points) b.vertex([c[0] + q[0] * radii[0], c[1] + q[1] * radii[1], c[2] + q[2] * radii[2]], q, shade + 0.18 * q[1], ch);
    for (const [a, bb, cc] of blob.triangles) b.triangle(base + a, base + bb, base + cc);
  };

  // The walk: stones leading out from the doorstep.
  if (door !== undefined) {
    const { wall: w, s } = placeOf(plan, door);
    const start = 0.36 * steps + 0.42;
    const flags = p.walk === "flagstones";
    const count = flags ? 10 : 6;
    const gapLen = flags ? 0.4 : 0.66;
    for (let i = 0; i < count; i++) {
      const d = start + i * gapLen;
      const sway = Math.sin(i * 0.55 + r.next() * 0.3) * 0.22;
      const cols = flags ? [-0.21, 0.21] : [0];
      for (const col of cols) {
        const q = on(w, s + sway + col + (r.next() - 0.5) * 0.08, 0, d);
        const radius = flags ? 0.2 + 0.03 * r.next() : 0.27 + 0.07 * r.next();
        flatStone(walk, q[0], q[2], radius, 0.045, 0.52 + 0.14 * r.next(), still(q, 0.45 + 0.35 * r.next(), { tint: (r.next() - 0.5) * 0.04 }), r);
      }
    }
  }

  // Flower boxes under the ground-floor windows: flowers go first, then the leaves wilt.
  if (extras.has("flower boxes")) {
    for (const o of plan.openings) {
      if (o.kind !== "window" || o.position[1] > plan.floor + 1.5) continue;
      const { wall: w, s } = placeOf(plan, o);
      const y = o.position[1] - 0.12;
      const hw = o.width / 2 + 0.06;
      const boxC = on(w, s, y - 0.1, 0.24);
      box(paint, boxC, [w.u, UP, w.n], [hw, 0.1, 0.11], 0.5, still(boxC, 0.5));
      const pivot = on(w, s, y, 0.24);
      for (let i = 0; i < 6; i++) {
        const x = -hw + 0.1 + ((2 * hw - 0.2) * i) / 5;
        const c = on(w, s + x, y + 0.03 + 0.03 * r.next(), 0.24 + (r.next() - 0.5) * 0.08);
        sphere(leaf, c, [0.12, 0.09, 0.1], 0.45 + 0.15 * r.next(), { loss: lossThreshold(r.next(), 0.3, 0.04), droop: 0.5, wither: 0.85, glow: 0, pivot, tint: (r.next() - 0.5) * 0.04 });
      }
      for (let i = 0; i < 3; i++) {
        const c = on(w, s - hw + 0.15 + (2 * hw - 0.3) * r.next(), y - 0.12, 0.36);
        sphere(leaf, c, [0.07, 0.14, 0.05], 0.4, { loss: lossThreshold(r.next(), 0.35, 0.04), droop: 0.6, wither: 0.85, glow: 0, pivot, tint: 0 });
      }
      for (let i = 0; i < 9; i++) {
        const c = on(w, s - hw + 0.08 + (2 * hw - 0.16) * r.next(), y + 0.09 + 0.05 * r.next(), 0.2 + 0.12 * r.next());
        sphere(bloom, c, [0.055, 0.045, 0.055], 0.62, { loss: lossThreshold(r.next(), 0.72, 0.25), droop: 0.3, wither: 0.9, glow: 0, pivot, tint: (r.next() - 0.5) * 0.12 });
      }
    }
  }

  // A lantern on a bracket beside the door, lit at night while the code is healthy.
  if (extras.has("lantern") && door !== undefined) {
    const { wall: w, s } = placeOf(plan, door);
    const free = (side: number): boolean =>
      !plan.openings.some((o) => o !== door && sameWall(placeOf(plan, o).wall, w) && Math.abs(placeOf(plan, o).s - (s + side * (door.width / 2 + 0.38))) < o.width / 2 + 0.55);
    const side = free(1) ? 1 : -1;
    const ls = s + side * (door.width / 2 + 0.38);
    const ly = plan.floor + door.height * 0.92;
    beam(wood, on(w, ls, ly + 0.25, 0), on(w, ls, ly + 0.25, 0.42), 0.05, 0.05, w.u, 0.35, still(on(w, ls, ly, 0), 0.5));
    const c = on(w, ls, ly, 0.4);
    box(wood, addScaled(c, UP, 0.16), [w.u, UP, w.n], [0.11, 0.025, 0.11], 0.35, still(c, 0.5));
    box(wood, addScaled(c, UP, -0.15), [w.u, UP, w.n], [0.09, 0.02, 0.09], 0.35, still(c, 0.5));
    box(lamp, c, [w.u, UP, w.n], [0.075, 0.13, 0.075], 0.8, { loss: lossThreshold(r.next(), 0.42, 0.25), droop: 0, wither: 0.4, glow: 1, pivot: c });
  }

  // Split logs stacked against the longest bare stretch of a side wall, end grain out.
  if (extras.has("woodpile")) {
    const walls = wallsOf(plan).filter((w) => w.n[2] === 0);
    let best: { w: Wall; s0: number; s1: number } | null = null;
    for (const w of walls) {
      const holes = clearings(plan, w, 0.1)
        .filter((h) => h.y0 < 1.3 + plan.floor)
        .map((h) => [h.s0, h.s1] as const)
        .sort((a, b) => a[0] - b[0]);
      let from = 0.25;
      for (const [h0, h1] of [...holes, [w.length - 0.25, w.length] as const]) {
        if (h0 - from > (best === null ? 0 : best.s1 - best.s0)) best = { w, s0: from, s1: h0 };
        from = Math.max(from, h1);
      }
    }
    if (best !== null) {
      const { w } = best;
      const len = Math.min(2.2, best.s1 - best.s0);
      const s0 = best.s0 + (best.s1 - best.s0 - len) / 2;
      const rad = 0.085;
      const rows = 5;
      for (let row = 0; row < rows; row++) {
        const n = Math.floor((len - row * rad) / (rad * 2.05));
        for (let i = 0; i < n; i++) {
          const s = s0 + rad + row * rad + i * rad * 2.05;
          const yy = rad * 0.8 + row * rad * 1.75;
          const from = on(w, s, yy, 0.12);
          const to = on(w, s, yy, 0.62 + 0.05 * r.next());
          const pivot = on(w, s, 0, 0.35);
          log(wood, from, to, rad * (0.9 + 0.2 * r.next()), 0.45 + 0.12 * r.next(), { loss: row >= 2 ? lossThreshold(r.next(), 0.35, 0.05) : 0, droop: 0, wither: 0.5, glow: 0, pivot, tint: (r.next() - 0.5) * 0.03 });
        }
      }
    }
  }

  // A low picket fence around the front garden, with a gap where the walk passes.
  if (extras.has("fence")) {
    const hw = plan.width / 2 + 0.35;
    const front = plan.depth / 2 + 3.4;
    const back = plan.depth / 2 - 0.25;
    const gateX = door?.position[0] ?? 0;
    const runs: [V3, V3][] = [
      [[-hw, 0, back], [-hw, 0, front]],
      [[-hw, 0, front], [hw, 0, front]],
      [[hw, 0, front], [hw, 0, back]],
    ];
    for (const [a, b2] of runs) {
      const len = Math.hypot(b2[0] - a[0], b2[2] - a[2]);
      const u = normalize(sub(b2, a));
      const n: V3 = [u[2], 0, -u[0]];
      const count = Math.floor(len / 0.2);
      for (let i = 0; i <= count; i++) {
        const q = addScaled(a, u, (len * i) / count);
        if (Math.abs(q[2] - front) < 0.01 && Math.abs(q[0] - gateX) < 0.62) continue;
        const h = 0.78 + 0.06 * Math.sin(i * 0.9);
        const base: V3 = [q[0], -0.25, q[2]];
        const ch: Channels = { loss: r.next() < 0.18 ? lossThreshold(r.next(), 0.32, 0.04) : 0, droop: 0.12 + 0.1 * r.next(), wither: 0.6, glow: 0, pivot: base, tint: 0 };
        box(fence, [q[0], (h - 0.25) / 2, q[2]], [u, UP, n], [0.035, (h + 0.25) / 2, 0.014], 0.55 + 0.08 * r.next(), ch);
      }
      for (const ry of [0.22, 0.58]) {
        const segs = Math.max(1, Math.round(len / 2));
        for (let k = 0; k < segs; k++) {
          const p0 = addScaled(a, u, (len * k) / segs);
          const p1 = addScaled(a, u, (len * (k + 1)) / segs);
          const mid = addScaled(p0, sub(p1, p0), 0.5);
          if (Math.abs(mid[2] - front) < 0.01 && Math.abs(mid[0] - gateX) < 0.62 + len / segs / 2) {
            for (const [x0, x1] of [[p0[0], gateX - 0.62], [gateX + 0.62, p1[0]]] as const) {
              if (Math.abs(x1 - x0) > 0.1) beam(fence, [Math.min(x0, x1), ry, front - 0.03], [Math.max(x0, x1), ry, front - 0.03], 0.07, 0.025, n, 0.5, still([gateX, 0, front], 0.6, { droop: 0.05 }));
            }
            continue;
          }
          beam(fence, addScaled([p0[0], ry, p0[2]], n, -0.03), addScaled([p1[0], ry, p1[2]], n, -0.03), 0.07, 0.025, n, 0.5, still(p0, 0.6, { droop: 0.05 }));
        }
      }
    }
  }

  const parts = [walk, wood, paint, leaf, bloom, lamp, fence].filter((b) => b.triangleCount > 0).map((b) => b.part());
  // A walk is always there, so the dressing always has a part.
  return { parts, anchors: [] };
}
