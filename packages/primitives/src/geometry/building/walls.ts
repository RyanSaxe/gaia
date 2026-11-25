// Builds a building's walls from its plan. Each mass's visible walls stand on
// a plinth and rise to the roofline over them, so gables, hipped ends, a
// lean-to's slope and a turret's ring all meet their roofs. As vitality falls,
// plaster falls away and walls rot through, worst at the weak corner (`Ruin`),
// and ivy and weeds grow.

import {
  type BuildContext,
  type BuildingPlan,
  type Built,
  GRAIN,
  type Rand,
  type Resolved,
} from "@gaia/schema";
import type { fieldstoneParams, timberFrameParams } from "../../structure.ts";
import {
  type Channels,
  LOSS_BAND,
  PartBuilder,
  type V3,
  addScaled,
  clamp,
  fbm3,
  lossThreshold,
  normalize,
} from "../kit.ts";
import { UP, beam, box, pillow } from "../blocks.ts";
import {
  PLASTER,
  type Ruin,
  STONE,
  type Wall,
  clearings,
  coarseness,
  massOf,
  on,
  peakOf,
  ruinAt,
  ruinOf,
  shownWalls,
  still,
  topAt,
  wallGrain,
  wallRot,
  wallTop,
  wobble,
} from "./frame.ts";
import { type Hold, ivy, rubble, wallSheet, weedSpots, weeds } from "./ruin.ts";

/** Floor-to-floor height in meters. A timber frame has a floor beam at each storey. */
const STOREY = 2.3;

// ---------- shared ----------

/** A plinth of squared stones under the walls, from the footing up to the floor. */
function plinth(
  b: PartBuilder,
  plan: BuildingPlan,
  r: Rand,
  coarse: number,
): void {
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
        box(
          b,
          c,
          [w.u, UP, w.n],
          [(s1 - s) / 2 - 0.012, (y1 - y0) / 2 - 0.01, 0.12],
          shade,
          still(c, 0.35 + 0.4 * r.next(), { tint: (r.next() - 0.5) * 0.04 }),
          { bottom: true },
        );
        s = s1;
      }
    }
  }
}

/**
 * The floor inside the walls, just under the door's sill. It covers the ground under the house, so no ground shows
 * through a door or a hole, such as a mill's wheel pit, dug where the terrain lattice reaches under the wheel's wall.
 * Each mass's floor is a few millimetres above the previous one where they overlap, so they do not z-fight. It rots
 * through near the weak corner as the walls do.
 */
function floor(b: PartBuilder, plan: BuildingPlan, ruin: Ruin): void {
  plan.masses.forEach((m, i) => {
    if (m.round) return;
    const c: V3 = [m.x, plan.floor - 0.06 + i * 0.004, m.z];
    box(
      b,
      c,
      [[1, 0, 0], UP, [0, 0, 1]],
      [m.width / 2 - 0.1, 0.04, m.depth / 2 - 0.1],
      0.3,
      still(c, 0.6, { rot: clamp(0.3 + 0.6 * ruinAt(ruin, c), 0, 1) }),
      { bottom: true },
    );
  });
}

/**
 * How the wall's core rots at a point: in stone blocks, at `behind` times the wall's rot, so it goes just after the
 * surface in front of it. The core is the last of the wall to go, so ivy holds to it.
 */
const coreOf =
  (plan: BuildingPlan, ruin: Ruin, behind: number): Hold =>
  (w, p) => ({
    rot: wallRot(plan, massOf(plan, w), ruin, p) * behind,
    grain: wallGrain(w, GRAIN.stones, STONE),
  });

/** The wall's core: a plain face of rubble set just behind the surface, which shows where plaster or stones have fallen. */
function core(
  b: PartBuilder,
  plan: BuildingPlan,
  hold: Hold,
  inset: number,
  from: number,
  coarse: number,
): void {
  for (const w of shownWalls(plan)) {
    const pivot = on(w, w.length / 2, wallTop(plan, massOf(plan, w)) / 2);
    wallSheet(b, plan, w, from, -inset, 0.75 * coarse, (p) => ({
      shade: 0.38,
      c: still(pivot, 0.6, hold(w, p)),
    }));
  }
}

/** Ivy, weeds and rubble round the walls as vitality falls. The ivy goes with `hold`. */
function overgrowth(
  plan: BuildingPlan,
  ruin: Ruin,
  r: Rand,
  stones: PartBuilder,
  size: number,
  coarse: number,
  hold: Hold,
): { moss: PartBuilder; weed: PartBuilder } {
  const moss = new PartBuilder("moss");
  const weed = new PartBuilder("leaf");
  ivy(moss, plan, ruin, r.fork("ivy"), coarse, hold);
  weeds(weed, weedSpots(plan, ruin, r.fork("weeds"), 46), r.fork("tufts"));
  rubble(stones, plan, ruin, r.fork("rubble"), size, 30);
  return { moss, weed };
}

// ---------- timber frame ----------

/** The triangle budget for a building's walls, whatever its masses and storeys. */
const WALL_TRIANGLES = 9_800;

/**
 * Builds a building's walls at its coarseness, then rebuilds them coarser
 * while they are over `WALL_TRIANGLES`, so every building fits. The same plan
 * always ends at the same coarseness.
 */
function withinBudget(
  plan: BuildingPlan,
  build: (coarse: number) => Built,
): Built {
  let coarse = coarseness(plan);
  let built = build(coarse);
  for (let k = 0; k < 4; k++) {
    const count = built.parts.reduce(
      (n, part) => n + part.indices.length / 3,
      0,
    );
    if (count <= WALL_TRIANGLES) break;
    coarse *= (count / WALL_TRIANGLES) ** 0.9 * 1.1;
    built = build(coarse);
  }
  return built;
}

export function buildTimberFrame(
  p: Resolved<typeof timberFrameParams>,
  ctx: BuildContext,
  plan: BuildingPlan,
): Built {
  return withinBudget(plan, (coarse) => timberFrame(p, ctx, plan, coarse));
}

export function buildFieldstone(
  p: Resolved<typeof fieldstoneParams>,
  ctx: BuildContext,
  plan: BuildingPlan,
): Built {
  return withinBudget(plan, (coarse) => fieldstone(p, ctx, plan, coarse));
}

interface Hole {
  readonly s0: number;
  readonly s1: number;
  readonly y0: number;
  readonly y1: number;
}

interface TimberMember {
  readonly s0: number;
  readonly s1: number;
  readonly y0: number;
  readonly y1: number;
  readonly gives: number;
}

interface TimberWallCtx {
  readonly timber: PartBuilder;
  readonly plan: BuildingPlan;
  readonly ruin: Ruin;
  readonly w: Wall;
  readonly seed: number;
  readonly r: Rand;
  readonly beamW: number;
  readonly out: number;
  readonly top: number;
  readonly sill: number;
  readonly plate: number;
  readonly holes: readonly Hole[];
  readonly floors: readonly number[];
  readonly members: TimberMember[];
  readonly lean: (s: number, y: number) => V3;
  readonly zoneAt: (s: number, y?: number) => number;
  readonly ch: (s: number, sag?: number, y?: number) => Channels;
  readonly member: (
    c: Channels,
    s0: number,
    s1: number,
    y0: number,
    y1: number,
  ) => Channels;
  readonly blocked: (s: number, y0: number, y1: number) => boolean;
}

function wallPostPositions(
  w: Wall,
  holes: readonly Hole[],
  framing: Resolved<typeof timberFrameParams>["framing"],
  beamW: number,
  coarse: number,
): number[] {
  const posts = new Set<number>([beamW / 2, w.length - beamW / 2]);
  for (const h of holes) {
    posts.add(h.s0 - beamW / 2);
    posts.add(h.s1 + beamW / 2);
  }
  const gap = (framing === "close studding" ? 0.5 : 1.45) * coarse;
  const sorted = [...posts]
    .filter((s) => s >= beamW / 2 - 1e-6 && s <= w.length - beamW / 2 + 1e-6)
    .toSorted((a, b) => a - b);
  const filled: number[] = [];
  sorted.forEach((s, i) => {
    filled.push(s);
    const next = sorted[i + 1];
    if (next === undefined) return;
    const n = Math.floor((next - s) / gap);
    for (let k = 1; k <= n; k++) {
      filled.push(s + ((next - s) * k) / (n + 1));
    }
  });
  return filled;
}

function postStoreySpans(
  s: number,
  sill: number,
  plate: number,
  beamW: number,
  holes: readonly Hole[],
  floors: readonly number[],
): [number, number][] {
  const spans: [number, number][] = [];
  let y = sill;
  const matching = holes
    .filter((hole) => s > hole.s0 - beamW * 0.4 && s < hole.s1 + beamW * 0.4)
    .toSorted((a, b) => a.y0 - b.y0);
  for (const h of matching) {
    if (h.y0 > y) spans.push([y, h.y0]);
    y = Math.max(y, h.y1);
  }
  if (plate > y) spans.push([y, plate]);
  // Each storey's post stands on the floor beam below it, so a fallen one is a storey long.
  return spans.flatMap(([a, b2]): [number, number][] => {
    const cuts = [a, ...floors.filter((f) => f > a + 0.2 && f < b2 - 0.2), b2];
    return cuts.slice(1).map((c, k) => [cuts[k] as number, c]);
  });
}

function addWallPosts(ctx: TimberWallCtx, filled: readonly number[]): void {
  const {
    timber,
    w,
    r,
    beamW,
    sill,
    plate,
    holes,
    floors,
    lean,
    zoneAt,
    ch,
    member,
  } = ctx;
  for (const s of filled) {
    const storeyed = postStoreySpans(s, sill, plate, beamW, holes, floors);
    for (const [a, b2] of storeyed) {
      if (b2 - a <= 0.12) continue;
      const zone = zoneAt(s);
      if (a === sill && zone > 0.3) {
        // A post in the collapse topples outward off its sill and comes to
        // rest with its head on the ground. It turns past level by the angle
        // that the sill's height makes over the post's length.
        const base = lean(s, a);
        const length = b2 - a;
        const tip =
          Math.PI / 2 + Math.asin(clamp((base[1] - 0.04) / length, 0, 0.9));
        const c: Channels = {
          loss: 0,
          droop: 0,
          wither: 0.6,
          glow: 0,
          pivot: base,
          tint: (r.next() - 0.5) * 0.03,
          fall: [
            w.u[0] * tip,
            w.u[1] * tip,
            w.u[2] * tip,
            clamp(0.16 + 0.3 * zone * r.next(), 0.12, 0.42),
          ],
        };
        beam(
          timber,
          base,
          lean(s, b2),
          beamW * 0.9,
          0.09,
          w.n,
          0.44 + 0.08 * r.next(),
          member(c, s, s, a, b2),
        );
      } else {
        beam(
          timber,
          lean(s, a),
          lean(s, b2),
          beamW * 0.9,
          0.09,
          w.n,
          0.44 + 0.08 * r.next(),
          member(ch(s, 0, (a + b2) / 2), s, s, a, b2),
        );
      }
    }
  }
}

function addWallFloorBeams(ctx: TimberWallCtx, all: readonly number[]): void {
  const { timber, w, beamW, floors, lean, ch, member, blocked } = ctx;
  for (const y of floors) {
    for (let i = 0; i + 1 < all.length; i++) {
      const a = all[i] as number;
      const b2 = all[i + 1] as number;
      const mid = (a + b2) / 2;
      if (!blocked(mid, y - 0.08, y + 0.08)) {
        beam(
          timber,
          lean(a, y),
          lean(b2, y),
          beamW,
          0.1,
          w.n,
          0.44,
          member(ch(mid, 0, y), a, b2, y, y),
        );
      }
    }
  }
}

function addWallRailRow(
  ctx: TimberWallCtx,
  all: readonly number[],
  rail: number,
  head: number,
  crossed: boolean,
): void {
  const { timber, w, beamW, lean, ch, member, blocked } = ctx;
  for (let i = 0; i + 1 < all.length; i++) {
    const a = all[i] as number;
    const b2 = all[i + 1] as number;
    const mid = (a + b2) / 2;
    if (!blocked(mid, rail - 0.08, rail + 0.08)) {
      beam(
        timber,
        lean(a, rail),
        lean(b2, rail),
        beamW * 0.8,
        0.08,
        w.n,
        0.42,
        member(ch(mid, 0, rail), a, b2, rail, rail),
      );
    }
    if (
      crossed &&
      (i === 0 || i === all.length - 2) &&
      !blocked(mid, rail, head)
    ) {
      const [s0, s1] = i === 0 ? [a, b2] : [b2, a];
      beam(
        timber,
        lean(s0, head - 0.05),
        lean(s1, rail + 0.05),
        beamW * 0.75,
        0.08,
        w.n,
        0.4,
        member(ch(mid, 0, (rail + head) / 2), a, b2, rail, head),
      );
    }
  }
}

function addGableTimber(
  ctx: TimberWallCtx,
  peak: { s: number; y: number },
): void {
  const { timber, plan, w, beamW, top, lean, ch, member } = ctx;
  const rise = peak.y - top;
  if (rise <= 0.5 || peak.s <= 0.25 * w.length || peak.s >= 0.75 * w.length) {
    return;
  }
  const collar = top + rise * 0.45;
  let s0 = peak.s;
  let s1 = peak.s;
  while (s0 > 0.1 && topAt(plan, w, s0 - 0.05) > collar + 0.12) s0 -= 0.05;
  while (s1 < w.length - 0.1 && topAt(plan, w, s1 + 0.05) > collar + 0.12) {
    s1 += 0.05;
  }
  beam(
    timber,
    lean(peak.s, top),
    lean(peak.s, peak.y - 0.12),
    beamW,
    0.09,
    w.n,
    0.44,
    member(ch(peak.s, 0, peak.y), peak.s, peak.s, top, peak.y),
  );
  if (s1 - s0 > 0.4) {
    beam(
      timber,
      lean(s0, collar),
      lean(s1, collar),
      beamW * 0.9,
      0.09,
      w.n,
      0.42,
      member(ch(peak.s, 0, collar), s0, s1, collar, collar),
    );
  }
}

function bayVerticalSpans(
  holes: readonly Hole[],
  s0: number,
  s1: number,
  y0: number,
  y1: number,
): [number, number][] {
  let spans: [number, number][] = [[y0, y1]];
  const overlapping = holes.filter(
    (hole) => s0 < hole.s1 - 0.02 && s1 > hole.s0 + 0.02,
  );
  for (const h of overlapping) {
    spans = spans.flatMap(([a, b2]): [number, number][] =>
      h.y1 <= a || h.y0 >= b2
        ? [[a, b2]]
        : (
            [
              [a, h.y0],
              [h.y1, b2],
            ] as [number, number][]
          ).filter(([x, y]) => y - x > 0.06),
    );
  }
  return spans;
}

function addWallPlasterPanels(
  plaster: PartBuilder,
  ctx: TimberWallCtx,
  filled: readonly number[],
  rails: readonly number[],
  p: Resolved<typeof timberFrameParams>,
): void {
  const { plan, ruin, w, seed, r, top, holes, floors, members } = ctx;
  const verticals = [0, ...filled, w.length].toSorted((a, b) => a - b);
  const levels = [
    plan.floor,
    ...(p.framing === "close studding" ? floors : [...rails, ...floors]),
    top,
  ].toSorted((a, b) => a - b);
  for (let i = 0; i + 1 < verticals.length; i++) {
    const s0 = verticals[i] as number;
    const s1 = verticals[i + 1] as number;
    if (s1 - s0 < 0.05) continue;
    for (let j = 0; j + 1 < levels.length; j++) {
      // A panel stops at a door or window in its bay, above and below it.
      const spans = bayVerticalSpans(
        holes,
        s0,
        s1,
        levels[j] as number,
        levels[j + 1] as number,
      );
      for (const [a, b2] of spans) {
        const framing = Math.max(
          0,
          ...members
            .filter(
              (mem) =>
                mem.s1 > s0 - 0.12 &&
                mem.s0 < s1 + 0.12 &&
                mem.y1 > a - 0.12 &&
                mem.y0 < b2 + 0.12,
            )
            .map((mem) => mem.gives),
        );
        panel(
          plaster,
          plan,
          ruin,
          w,
          s0,
          s1,
          a,
          b2,
          p.plaster,
          r,
          seed,
          framing,
        );
      }
    }
  }
}

function buildTimberWall(
  plaster: PartBuilder,
  timber: PartBuilder,
  p: Resolved<typeof timberFrameParams>,
  plan: BuildingPlan,
  ruin: Ruin,
  w: Wall,
  coarse: number,
  seed: number,
  r: Rand,
): void {
  const beamW = 0.17;
  const out = 0.03;
  const m = massOf(plan, w);
  const top = wallTop(plan, m);
  const peak = peakOf(plan, w);
  const holes = clearings(plan, w, 0.02);
  // Upright timbers: the corners, both sides of every opening, then fill.
  const filled = wallPostPositions(w, holes, p.framing, beamW, coarse);
  const sill = plan.floor + beamW / 2;
  const plate = top - beamW / 2;
  // A rail at window-sill height in every storey, and a floor beam where each upper storey begins.
  const rails = Array.from(
    { length: m.storeys },
    (_, k) => plan.floor + k * STOREY + 0.78,
  ).filter((y) => y < plate - 0.4);
  const floors = Array.from(
    { length: m.storeys - 1 },
    (_, k) => plan.floor + (k + 1) * STOREY - 0.05,
  ).filter((y) => y < plate - 0.3);
  const lean = (s: number, y: number): V3 =>
    on(w, s + wobble(plan, seed, on(w, s, y), 0.09), y, out);
  const pivotOf = (s: number): V3 =>
    on(w, s < w.length / 2 ? 0 : w.length, top);
  const zoneAt = (s: number, y = top): number => ruinAt(ruin, on(w, s, y));
  // In the collapse, timbers go below a loss threshold that rises toward the weak corner.
  const gone = (s: number, y = top): number =>
    zoneAt(s, y) > 0.3
      ? lossThreshold(r.next(), 0.14 + 0.3 * zoneAt(s, y), 0.05)
      : 0;
  const ch = (s: number, sag = 0, y = top): Channels =>
    still(pivotOf(s), 0.5, {
      droop: sag * Math.sin(Math.PI * clamp(s / w.length, 0, 1)),
      tint: (r.next() - 0.5) * 0.03,
      loss: gone(s, y),
    });
  // Every timber's extent and the vitality below which it falls or goes,
  // so the plaster it frames can go first.
  const members: TimberMember[] = [];
  const member = (
    c: Channels,
    s0: number,
    s1: number,
    y0: number,
    y1: number,
  ): Channels => {
    members.push({
      s0: Math.min(s0, s1),
      s1: Math.max(s0, s1),
      y0: Math.min(y0, y1),
      y1: Math.max(y0, y1),
      gives: Math.max(c.loss, c.fall?.[3] ?? 0),
    });
    // A timber that goes shrinks back onto the post or sill it is pegged to at its first end.
    return c.loss > 0 ? { ...c, pivot: lean(s0, Math.min(y0, y1)) } : c;
  };
  const blocked = (s: number, y0: number, y1: number): boolean =>
    holes.some(
      (h) =>
        s > h.s0 - beamW * 0.4 &&
        s < h.s1 + beamW * 0.4 &&
        y1 > h.y0 &&
        y0 < h.y1,
    );
  const ctx: TimberWallCtx = {
    timber,
    plan,
    ruin,
    w,
    seed,
    r,
    beamW,
    out,
    top,
    sill,
    plate,
    holes,
    floors,
    members,
    lean,
    zoneAt,
    ch,
    member,
    blocked,
  };

  // The sill and wall plate run the whole length. The plate sags a little as vitality falls.
  beam(
    timber,
    lean(-0.05, sill),
    lean(w.length + 0.05, sill),
    beamW,
    0.09,
    w.n,
    0.42,
    member(ch(w.length / 2), 0, w.length, sill, sill),
  );
  const plates = clamp(Math.round(w.length / (1.4 * coarse)), 1, 6);
  for (let k = 0; k < plates; k++) {
    const s0 = (w.length * k) / plates;
    const s1 = (w.length * (k + 1)) / plates;
    beam(
      timber,
      lean(s0 - (k === 0 ? 0.05 : 0), plate),
      lean(s1 + (k === plates - 1 ? 0.05 : 0), plate),
      beamW,
      0.1,
      w.n,
      0.46,
      member(ch((s0 + s1) / 2, 0.05), s0, s1, plate, plate),
    );
  }
  // Posts, broken where an opening passes.
  addWallPosts(ctx, filled);
  // Floor beams at every storey, rails at window-sill height between posts, and braces in the end bays.
  const all = filled.toSorted((a, b) => a - b);
  addWallFloorBeams(ctx, all);
  if (p.framing !== "close studding") {
    const crossed = p.framing === "crossed braces";
    for (const [k, rail] of rails.entries()) {
      addWallRailRow(ctx, all, rail, floors[k] ?? plate, crossed);
    }
  }
  // A gable's king post and collar, under the peak of whatever roofline the wall rises to.
  addGableTimber(ctx, peak);
  // Plaster panels between the timbers. Some are loose and fall away as vitality falls.
  addWallPlasterPanels(plaster, ctx, filled, rails, p);
  const rise = peak.y - top;
  if (rise > 0.05) {
    // The gable's plaster, in cells so it can rot through from the peak.
    const pivot = on(w, peak.s, top + rise / 2);
    const grain = wallGrain(w, GRAIN.plaster, PLASTER);
    wallSheet(plaster, plan, w, top, 0.008, 0.6 * coarse, (q) => ({
      shade: 0.58,
      c: still(pivot, 0.55, { rot: wallRot(plan, m, ruin, q), grain }),
    }));
  }
}

function timberFrame(
  p: Resolved<typeof timberFrameParams>,
  ctx: BuildContext,
  plan: BuildingPlan,
  coarse: number,
): Built {
  const r = ctx.rand.fork("timber-frame");
  const seed = Math.floor(r.next() * 1e6);
  const masonry = new PartBuilder("masonry", "solid");
  const plaster = new PartBuilder("wall", "solid");
  const timber = new PartBuilder("timber", "solid");
  const ruin = ruinOf(plan);
  plinth(masonry, plan, r.fork("plinth"), coarse);
  // Fallen plaster exposes a band of the rubble core before the wall opens.
  const hold = coreOf(plan, ruin, 0.92);
  core(masonry, plan, hold, 0.03, plan.floor, coarse);
  floor(timber, plan, ruin);

  for (const w of shownWalls(plan)) {
    buildTimberWall(plaster, timber, p, plan, ruin, w, coarse, seed, r);
  }
  // Chunks of plaster and stone at the collapsed corner.
  const { moss, weed } = overgrowth(
    plan,
    ruin,
    r.fork("overgrowth"),
    masonry,
    0.2,
    coarse,
    hold,
  );
  rubble(plaster, plan, ruin, r.fork("plaster-rubble"), 0.16, 14);
  return {
    parts: [
      masonry.part(),
      plaster.part(),
      timber.part(),
      moss.part(),
      weed.part(),
    ],
    anchors: [],
  };
}

function panelInnerWeight(i: number, j: number): number {
  if (i === 1 && j === 1) return 1;
  if (i === 1 || j === 1) return 0.45;
  return 0;
}

/**
 * One plaster panel: a slightly bulging 3x3 sheet with varied shade. It goes
 * no later than any timber framing it (`framing` is the highest threshold
 * among them), and slumps onto the timber under it as it goes.
 */
function panel(
  b: PartBuilder,
  plan: BuildingPlan,
  ruin: Ruin,
  w: Wall,
  s0: number,
  s1: number,
  y0: number,
  y1: number,
  rough: number,
  r: Rand,
  seed: number,
  framing: number,
): void {
  const center = on(w, (s0 + s1) / 2, (y0 + y1) / 2, 0.01);
  // Panels near the weak corner are loose more often, and go earlier.
  const zone = ruinAt(ruin, center);
  const loose = r.next() < 0.4 + 0.5 * zone;
  const u = r.next();
  const own = loose ? lossThreshold(u, 0.42 + 0.12 * zone, 0.06) : 0;
  const c: Channels = {
    loss: framing > 0 ? Math.max(own, framing + LOSS_BAND + 0.01) : own,
    droop: 0,
    wither: 0.45 + 0.35 * r.next(),
    glow: 0,
    pivot: on(w, (s0 + s1) / 2, y0, 0.01),
    tint: (r.next() - 0.5) * 0.02,
  };
  const base = 0.6 + 0.08 * (r.next() - 0.5);
  const idx: number[] = [];
  for (let j = 0; j <= 2; j++) {
    for (let i = 0; i <= 2; i++) {
      const s = s0 + ((s1 - s0) * i) / 2;
      const y = y0 + ((y1 - y0) * j) / 2;
      const inner = panelInnerWeight(i, j);
      const n = fbm3(s * 1.3 + w.n[0] * 7, y * 1.3, w.n[2] * 7, seed, 2);
      const d = 0.008 + inner * 0.014 * rough + n * 0.006 * rough;
      const q = on(w, s + wobble(plan, seed, on(w, s, y), 0.09), y, d);
      const normal = normalize(addScaled(w.n, w.u, n * 0.12 * rough));
      idx.push(
        b.vertex(q, normal, base + n * 0.12 * rough + inner * 0.04, {
          ...c,
          rot: wallRot(plan, massOf(plan, w), ruin, q),
          grain: wallGrain(w, GRAIN.plaster, PLASTER),
        }),
      );
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

function stoneFits(
  holes: readonly Hole[],
  w: Wall,
  mid: number,
  cy: number,
  len: number,
  h: number,
  gableTop: number,
): boolean {
  if (mid <= -0.02 || mid >= w.length + 0.02) return false;
  if (cy + h * 0.3 >= gableTop) return false;
  return !holes.some(
    (o) =>
      mid + len * 0.4 > o.s0 &&
      mid - len * 0.4 < o.s1 &&
      cy + h * 0.4 > o.y0 &&
      cy - h * 0.4 < o.y1,
  );
}

function layFieldstoneWall(
  stones: PartBuilder,
  plan: BuildingPlan,
  ruin: Ruin,
  w: Wall,
  top: number,
  peak: { s: number; y: number },
  size: number,
  stoneGables: boolean,
  r: Rand,
  seed: number,
): void {
  const m = massOf(plan, w);
  const holes = clearings(plan, w, 0.06);
  const gableTop = (s: number): number =>
    stoneGables ? topAt(plan, w, s) : top;
  const maxY = (stoneGables ? peak.y : top) - 0.05;
  let y = -0.12;
  let row = 0;
  while (y < maxY) {
    const h = size * (0.62 + 0.22 * r.next());
    let s = -0.08 - (row % 2) * size * 0.45;
    while (s < w.length + 0.05) {
      // Corner stones are long and alternate, binding the walls together.
      const corner = s < 0.2 || s > w.length - 0.9;
      const len = size * (corner ? 1.5 : 0.85 + 0.6 * r.next());
      const mid = s + len / 2;
      const cy = y + h / 2;
      if (
        stoneFits(holes, w, mid, cy, len, h, gableTop(clamp(mid, 0, w.length)))
      ) {
        const c = on(
          w,
          clamp(mid, 0.05, w.length - 0.05) +
            wobble(plan, seed, on(w, mid, cy), 0.07),
          cy,
          0,
        );
        const ground = clamp(cy / 1.8, 0, 1);
        // Stones fall from the top of the walls, and most at the weak corner.
        const fallen = wallRot(plan, m, ruin, c);
        // A tall house's upper courses fall too, so the walls break down from above as well as at the weak corner.
        const missing = r.next() < 0.05 + 0.95 * Math.max(0, fallen - 0.3);
        // The stone rots with the wall behind it, using the rot at its block's center, and goes from its top down.
        const [u, v] = wallGrain(w, GRAIN.stones, STONE)(c);
        const grainRow = Math.floor(v);
        pillow(
          stones,
          c,
          w.u,
          w.n,
          len * 0.94,
          h * 0.9,
          0.05 + 0.05 * r.next(),
          0.4 + 0.25 * r.next(),
          {
            loss: missing
              ? lossThreshold(r.next(), 0.22 + 0.3 * fallen, 0.05)
              : 0,
            droop: 0,
            wither: 0.3 + 0.55 * (1 - ground) + 0.15 * r.next(),
            glow: 0,
            pivot: c,
            tint: (r.next() - 0.5) * 0.06,
            rot: fallen,
            grain: (q) => [
              u,
              grainRow + clamp((c[1] + h / 2 - q[1]) / h, 0, 0.999),
              GRAIN.stones,
            ],
          },
          r,
        );
      }
      s += len;
    }
    y += h;
    row++;
  }
}

function addGableBoards(
  boards: PartBuilder,
  plan: BuildingPlan,
  ruin: Ruin,
  w: Wall,
  top: number,
  r: Rand,
): void {
  const bw = 0.24;
  for (let s = bw / 2; s < w.length; s += bw) {
    const h = topAt(plan, w, s) - top - 0.05;
    if (h < 0.1) continue;
    const c = on(w, s, top - 0.15 + (h + 0.15) / 2, 0.04);
    const zone = ruinAt(ruin, c);
    box(
      boards,
      c,
      [w.u, UP, w.n],
      [bw / 2 - 0.012, (h + 0.15) / 2, 0.03],
      0.42 + 0.14 * r.next(),
      still(c, 0.55, {
        tint: (r.next() - 0.5) * 0.03,
        loss:
          r.next() < 0.25 + zone
            ? lossThreshold(r.next(), 0.2 + 0.25 * zone, 0.05)
            : 0,
      }),
    );
  }
  beam(
    boards,
    on(w, -0.05, top - 0.12, 0.06),
    on(w, w.length + 0.05, top - 0.12, 0.06),
    0.18,
    0.1,
    w.n,
    0.38,
    still(on(w, w.length / 2, top), 0.5),
  );
}

function fieldstone(
  p: Resolved<typeof fieldstoneParams>,
  ctx: BuildContext,
  plan: BuildingPlan,
  coarse: number,
): Built {
  const r = ctx.rand.fork("fieldstone");
  const seed = Math.floor(r.next() * 1e6);
  const mortar = new PartBuilder("wall", "solid");
  const stones = new PartBuilder("masonry", "solid");
  const boards = new PartBuilder("timber", "solid");
  const ruin = ruinOf(plan);
  // The mortar goes just after the stones in front of it, so a fallen stone leaves a hole, not a bare patch of mortar.
  const hold = coreOf(plan, ruin, 0.95);
  core(mortar, plan, hold, -0.005, -plan.footing, coarse);
  floor(boards, plan, ruin);
  const walls = shownWalls(plan);
  // A big house uses bigger stones, so its walls have about 600 at most. Stones grow again only when the walls are over budget.
  const area = walls.reduce(
    (sum, w) =>
      sum +
      w.length *
        ((wallTop(plan, massOf(plan, w)) + peakOf(plan, w).y) / 2 + 0.12),
    0,
  );
  const size =
    Math.max(p.stones, Math.sqrt(area / (0.84 * 600))) *
    Math.sqrt(coarse / coarseness(plan));
  for (const w of walls) {
    const m = massOf(plan, w);
    const top = wallTop(plan, m);
    const peak = peakOf(plan, w);
    layFieldstoneWall(
      stones,
      plan,
      ruin,
      w,
      top,
      peak,
      size,
      p.gables === "stone",
      r,
      seed,
    );
    // Upright boards under the peak.
    if (peak.y - top > 0.1 && p.gables === "boards") {
      addGableBoards(boards, plan, ruin, w, top, r);
    }
  }
  const { moss, weed } = overgrowth(
    plan,
    ruin,
    r.fork("overgrowth"),
    stones,
    0.26,
    coarse,
    hold,
  );
  const parts = [mortar.part(), stones.part(), moss.part(), weed.part()];
  if (boards.vertexCount > 0) parts.push(boards.part());
  return { parts, anchors: [] };
}
