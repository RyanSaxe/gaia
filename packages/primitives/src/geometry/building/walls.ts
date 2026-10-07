// A building's walls, built against its plan: each mass's walls stand on a
// plinth and rise to the roofline over them, so gables, hipped ends, a
// lean-to's slope and a turret's ring all meet their roofs. A failing house
// falls to ruin: plaster falls away and walls rot through, worst at one
// weak corner where timbers topple and rubble gathers; ivy climbs the
// walls and weeds grow tall. Walls another mass hides are never built.

import type { BuildContext, BuildingPlan, Built, Rand, Resolved } from "@gaia/schema";
import type { fieldstoneParams, timberFrameParams } from "../../structure.ts";
import { type Channels, PartBuilder, type V3, addScaled, clamp, fbm3, lossThreshold, normalize } from "../kit.ts";
import { UP, beam, box, pillow } from "../blocks.ts";
import { type Ruin, type Wall, clearings, coarseness, massOf, on, peakOf, ruinAt, ruinOf, shownWalls, still, topAt, wallRot, wallTop, wobble } from "./frame.ts";
import { ivy, rubble, wallSheet, weedSpots, weeds } from "./ruin.ts";

/** Floor to floor, meters; a floor beam marks each storey on a timber frame. */
const STOREY = 2.3;

// ---------- shared ----------

/** A plinth of squared stones under the walls, from the footing up to the floor. */
function plinth(b: PartBuilder, plan: BuildingPlan, r: Rand, coarse: number): void {
  const rows = Math.max(1, Math.round((plan.floor + 0.1) / 0.24));
  const rowH = (plan.floor + 0.1) / rows;
  for (const w of shownWalls(plan)) {
    for (let row = 0; row < rows; row++) {
      const y0 = row === 0 ? -plan.footing : -0.1 + row * rowH;
      const y1 = -0.1 + (row + 1) * rowH;
      let s = -0.12 - (row % 2) * 0.25;
      while (s < w.length + 0.1) {
        const len = (0.45 + 0.35 * r.next()) * coarse;
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

/** The wall's core: a plain face set just behind the surface, which shows where plaster has fallen and rots through as the house declines. */
function core(b: PartBuilder, plan: BuildingPlan, ruin: Ruin, inset: number, from: number, coarse: number): void {
  for (const w of shownWalls(plan)) {
    const m = massOf(plan, w);
    const pivot = on(w, w.length / 2, wallTop(plan, m) / 2);
    wallSheet(b, plan, w, from, -inset, 0.75 * coarse, (p) => ({ shade: 0.38, c: still(pivot, 0.6, { rot: wallRot(plan, m, ruin, p) }) }));
  }
}

/** Ivy, weeds and rubble around any walls as the house declines. */
function overgrowth(plan: BuildingPlan, ruin: Ruin, r: Rand, stones: PartBuilder, size: number, coarse: number): { moss: PartBuilder; weed: PartBuilder } {
  const moss = new PartBuilder("moss");
  const weed = new PartBuilder("leaf");
  ivy(moss, plan, ruin, r.fork("ivy"), coarse);
  weeds(weed, weedSpots(plan, ruin, r.fork("weeds"), 46), r.fork("tufts"));
  rubble(stones, plan, ruin, r.fork("rubble"), size, 30);
  return { moss, weed };
}

// ---------- timber frame ----------

/** Triangles a building's walls keep within, however many masses and storeys it has. */
const WALL_TRIANGLES = 9_800;

/**
 * Builds a building's walls at its coarseness, and again coarser while they
 * run over budget, so every building fits by construction. The same plan
 * always settles on the same coarseness.
 */
function withinBudget(plan: BuildingPlan, build: (coarse: number) => Built): Built {
  let coarse = coarseness(plan);
  let built = build(coarse);
  for (let k = 0; k < 4; k++) {
    const count = built.parts.reduce((n, part) => n + part.indices.length / 3, 0);
    if (count <= WALL_TRIANGLES) break;
    coarse *= (count / WALL_TRIANGLES) ** 0.9 * 1.1;
    built = build(coarse);
  }
  return built;
}

export function buildTimberFrame(p: Resolved<typeof timberFrameParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  return withinBudget(plan, (coarse) => timberFrame(p, ctx, plan, coarse));
}

export function buildFieldstone(p: Resolved<typeof fieldstoneParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  return withinBudget(plan, (coarse) => fieldstone(p, ctx, plan, coarse));
}

function timberFrame(p: Resolved<typeof timberFrameParams>, ctx: BuildContext, plan: BuildingPlan, coarse: number): Built {
  const r = ctx.rand.fork("timber-frame");
  const seed = Math.floor(r.next() * 1e6);
  const masonry = new PartBuilder("masonry", "solid");
  const plaster = new PartBuilder("wall", "solid");
  const timber = new PartBuilder("timber", "solid");
  const ruin = ruinOf(plan);
  plinth(masonry, plan, r.fork("plinth"), coarse);
  core(masonry, plan, ruin, 0.03, plan.floor, coarse);
  const beamW = 0.17;
  const out = 0.03;

  for (const w of shownWalls(plan)) {
    const m = massOf(plan, w);
    const top = wallTop(plan, m);
    const peak = peakOf(plan, w);
    const holes = clearings(plan, w, 0.02);
    // Upright timbers: the corners, both sides of every opening, then fill.
    const posts = new Set<number>([beamW / 2, w.length - beamW / 2]);
    for (const h of holes) {
      posts.add(h.s0 - beamW / 2);
      posts.add(h.s1 + beamW / 2);
    }
    const gap = (p.framing === "close studding" ? 0.5 : 1.45) * coarse;
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
    // A rail at window-sill height in every storey, and a floor beam where each upper storey begins.
    const rails = Array.from({ length: m.storeys }, (_, k) => plan.floor + k * STOREY + 0.78).filter((y) => y < plate - 0.4);
    const floors = Array.from({ length: m.storeys - 1 }, (_, k) => plan.floor + (k + 1) * STOREY - 0.05).filter((y) => y < plate - 0.3);
    const lean = (s: number, y: number): V3 => on(w, s + wobble(plan, seed, on(w, s, y), 0.09), y, out);
    const pivotOf = (s: number): V3 => on(w, s < w.length / 2 ? 0 : w.length, top);
    const zoneAt = (s: number, y = top): number => ruinAt(ruin, on(w, s, y));
    // In the collapse, timbers go: lost below a threshold that rises toward the weak corner.
    const gone = (s: number, y = top): number => (zoneAt(s, y) > 0.3 ? lossThreshold(r.next(), 0.14 + 0.3 * zoneAt(s, y), 0.05) : 0);
    const ch = (s: number, sag = 0, y = top): Channels => still(pivotOf(s), 0.5, { droop: sag * Math.sin((Math.PI * clamp(s / w.length, 0, 1))), tint: (r.next() - 0.5) * 0.03, loss: gone(s, y) });

    // Sill and wall plate run the whole length; the plate sags a little as the house declines.
    beam(timber, lean(-0.05, sill), lean(w.length + 0.05, sill), beamW, 0.09, w.n, 0.42, ch(w.length / 2));
    const plates = clamp(Math.round(w.length / (1.4 * coarse)), 1, 6);
    for (let k = 0; k < plates; k++) {
      const s0 = (w.length * k) / plates;
      const s1 = (w.length * (k + 1)) / plates;
      beam(timber, lean(s0 - (k === 0 ? 0.05 : 0), plate), lean(s1 + (k === plates - 1 ? 0.05 : 0), plate), beamW, 0.1, w.n, 0.46, ch((s0 + s1) / 2, 0.05));
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
      // Each storey's post stands on the floor beam below it, so a fallen one is a storey long.
      const storeyed = spans.flatMap(([a, b2]): [number, number][] => {
        const cuts = [a, ...floors.filter((f) => f > a + 0.2 && f < b2 - 0.2), b2];
        return cuts.slice(1).map((c, k) => [cuts[k] as number, c]);
      });
      for (const [a, b2] of storeyed) {
        if (b2 - a <= 0.12) continue;
        const zone = zoneAt(s);
        if (a === sill && zone > 0.3) {
          // A post in the collapse topples outward off its sill and comes to rest on the ground.
          const base = lean(s, a);
          const tip = 1.62 + 0.18 * r.next();
          const c: Channels = { loss: 0, droop: 0, wither: 0.6, glow: 0, pivot: base, tint: (r.next() - 0.5) * 0.03, fall: [w.u[0] * tip, w.u[1] * tip, w.u[2] * tip, clamp(0.16 + 0.3 * zone * r.next(), 0.12, 0.42)] };
          beam(timber, base, lean(s, b2), beamW * 0.9, 0.09, w.n, 0.44 + 0.08 * r.next(), c);
        } else beam(timber, lean(s, a), lean(s, b2), beamW * 0.9, 0.09, w.n, 0.44 + 0.08 * r.next(), ch(s, 0, (a + b2) / 2));
      }
    }
    // Floor beams at every storey; rails at window-sill height between posts, and braces in the end bays.
    const all = [...filled].sort((a, b) => a - b);
    for (const y of floors) {
      for (let i = 0; i + 1 < all.length; i++) {
        const mid = ((all[i] as number) + (all[i + 1] as number)) / 2;
        if (!blocked(mid, y - 0.08, y + 0.08)) beam(timber, lean(all[i] as number, y), lean(all[i + 1] as number, y), beamW, 0.1, w.n, 0.44, ch(mid, 0, y));
      }
    }
    if (p.framing !== "close studding") {
      for (const [k, rail] of rails.entries()) {
        const head = floors[k] ?? plate;
        for (let i = 0; i + 1 < all.length; i++) {
          const a = all[i] as number;
          const b2 = all[i + 1] as number;
          const mid = (a + b2) / 2;
          if (!blocked(mid, rail - 0.08, rail + 0.08)) beam(timber, lean(a, rail), lean(b2, rail), beamW * 0.8, 0.08, w.n, 0.42, ch(mid, 0, rail));
          if (p.framing === "crossed braces" && (i === 0 || i === all.length - 2) && !blocked(mid, rail, head)) {
            const [s0, s1] = i === 0 ? [a, b2] : [b2, a];
            beam(timber, lean(s0, head - 0.05), lean(s1, rail + 0.05), beamW * 0.75, 0.08, w.n, 0.4, ch(mid, 0, (rail + head) / 2));
          }
        }
      }
    }
    // A gable's king post and collar, under the peak of whatever roofline the wall rises to.
    const rise = peak.y - top;
    if (rise > 0.5 && peak.s > 0.25 * w.length && peak.s < 0.75 * w.length) {
      const collar = top + rise * 0.45;
      let s0 = peak.s;
      let s1 = peak.s;
      while (s0 > 0.1 && topAt(plan, w, s0 - 0.05) > collar + 0.12) s0 -= 0.05;
      while (s1 < w.length - 0.1 && topAt(plan, w, s1 + 0.05) > collar + 0.12) s1 += 0.05;
      beam(timber, lean(peak.s, top), lean(peak.s, peak.y - 0.12), beamW, 0.09, w.n, 0.44, ch(peak.s, 0, peak.y));
      if (s1 - s0 > 0.4) beam(timber, lean(s0, collar), lean(s1, collar), beamW * 0.9, 0.09, w.n, 0.42, ch(peak.s, 0, collar));
    }

    // Plaster panels between the timbers. Some are loose, and fall away as the house declines.
    const verticals = [0, ...filled, w.length].sort((a, b) => a - b);
    const levels = [plan.floor, ...(p.framing === "close studding" ? floors : [...rails, ...floors]), top].sort((a, b) => a - b);
    for (let i = 0; i + 1 < verticals.length; i++) {
      const s0 = verticals[i] as number;
      const s1 = verticals[i + 1] as number;
      if (s1 - s0 < 0.05) continue;
      for (let j = 0; j + 1 < levels.length; j++) {
        // A panel stops at a door or window in its bay, above and below it.
        let spans: [number, number][] = [[levels[j] as number, levels[j + 1] as number]];
        for (const h of holes.filter((h) => s0 < h.s1 - 0.02 && s1 > h.s0 + 0.02)) {
          spans = spans.flatMap(([a, b2]): [number, number][] => (h.y1 <= a || h.y0 >= b2 ? [[a, b2]] : ([[a, h.y0], [h.y1, b2]] as [number, number][]).filter(([x, y]) => y - x > 0.06)));
        }
        for (const [a, b2] of spans) panel(plaster, plan, ruin, w, s0, s1, a, b2, p.plaster, r, seed);
      }
    }
    if (rise > 0.05) {
      // The gable's plaster, in cells so it can rot through from the peak.
      const pivot = on(w, peak.s, top + rise / 2);
      wallSheet(plaster, plan, w, top, 0.008, 0.6 * coarse, (q) => ({ shade: 0.58, c: still(pivot, 0.55, { rot: wallRot(plan, m, ruin, q) }) }));
    }
  }
  // Chunks of plaster and stone lie where the corner gave way.
  const { moss, weed } = overgrowth(plan, ruin, r.fork("overgrowth"), masonry, 0.2, coarse);
  rubble(plaster, plan, ruin, r.fork("plaster-rubble"), 0.16, 14);
  return { parts: [masonry.part(), plaster.part(), timber.part(), moss.part(), weed.part()], anchors: [] };
}

/** One plaster panel: a slightly bulging 3x3 sheet, its shade hand-laid. */
function panel(b: PartBuilder, plan: BuildingPlan, ruin: Ruin, w: Wall, s0: number, s1: number, y0: number, y1: number, rough: number, r: Rand, seed: number): void {
  const center = on(w, (s0 + s1) / 2, (y0 + y1) / 2, 0.01);
  // Panels near the weak corner are loose more often, and go earlier.
  const zone = ruinAt(ruin, center);
  const loose = r.next() < 0.4 + 0.5 * zone;
  const u = r.next();
  const c: Channels = {
    loss: loose ? lossThreshold(u, 0.42 + 0.12 * zone, 0.06) : 0,
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
      idx.push(b.vertex(q, normal, base + n * 0.12 * rough + inner * 0.04, { ...c, rot: wallRot(plan, massOf(plan, w), ruin, q) }));
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

function fieldstone(p: Resolved<typeof fieldstoneParams>, ctx: BuildContext, plan: BuildingPlan, coarse: number): Built {
  const r = ctx.rand.fork("fieldstone");
  const seed = Math.floor(r.next() * 1e6);
  const mortar = new PartBuilder("wall", "solid");
  const stones = new PartBuilder("masonry", "solid");
  const boards = new PartBuilder("timber", "solid");
  const ruin = ruinOf(plan);
  core(mortar, plan, ruin, -0.005, -plan.footing, coarse);
  const walls = shownWalls(plan);
  // Stones grow on a big house, so the walls stay within about 600 stones, and more only when the walls run over budget.
  const area = walls.reduce((sum, w) => sum + w.length * ((wallTop(plan, massOf(plan, w)) + peakOf(plan, w).y) / 2 + 0.12), 0);
  const size = Math.max(p.stones, Math.sqrt(area / (0.84 * 600))) * Math.sqrt(coarse / coarseness(plan));
  for (const w of walls) {
    const m = massOf(plan, w);
    const top = wallTop(plan, m);
    const peak = peakOf(plan, w);
    const holes = clearings(plan, w, 0.06);
    const gableTop = (s: number): number => (p.gables === "stone" ? topAt(plan, w, s) : top);
    let y = -0.12;
    let row = 0;
    while (y < (p.gables === "stone" ? peak.y : top) - 0.05) {
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
          // Stones fall from the top of the walls, and from the weak corner most.
          const fallen = wallRot(plan, m, ruin, c);
          // A tall house's upper courses fall too, so a ruin is broken down from above as well as at its weak corner.
          const missing = r.next() < 0.05 + 0.95 * Math.max(0, fallen - 0.3);
          pillow(stones, c, w.u, w.n, len * 0.94, h * 0.9, 0.05 + 0.05 * r.next(), 0.4 + 0.25 * r.next(), {
            loss: missing ? lossThreshold(r.next(), 0.22 + 0.3 * fallen, 0.05) : 0,
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
    if (peak.y - top > 0.1 && p.gables === "boards") {
      const bw = 0.24;
      for (let s = bw / 2; s < w.length; s += bw) {
        const h = topAt(plan, w, s) - top - 0.05;
        if (h < 0.1) continue;
        const c = on(w, s, top - 0.15 + (h + 0.15) / 2, 0.04);
        const zone = ruinAt(ruin, c);
        box(boards, c, [w.u, UP, w.n], [bw / 2 - 0.012, (h + 0.15) / 2, 0.03], 0.42 + 0.14 * r.next(), still(c, 0.55, { tint: (r.next() - 0.5) * 0.03, loss: r.next() < 0.25 + zone ? lossThreshold(r.next(), 0.2 + 0.25 * zone, 0.05) : 0 }));
      }
      beam(boards, on(w, -0.05, top - 0.12, 0.06), on(w, w.length + 0.05, top - 0.12, 0.06), 0.18, 0.1, w.n, 0.38, still(on(w, w.length / 2, top), 0.5));
    }
  }
  const { moss, weed } = overgrowth(plan, ruin, r.fork("overgrowth"), stones, 0.26, coarse);
  const parts = [mortar.part(), stones.part(), moss.part(), weed.part()];
  if (boards.vertexCount > 0) parts.push(boards.part());
  return { parts, anchors: [] };
}

