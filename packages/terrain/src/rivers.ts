// Rivers that follow the land. A region whose valley carries a stream gives
// its water a spring where water runs longest across that region; the water
// then runs downhill across the whole land, as the land falls, through other
// regions too, until it reaches the land's edge, a pond, a basin too deep to
// cross, where it sinks away at the bottom, or a river laid before it, which
// it joins, widening it below. Its valley is carved along that course, with
// the cross-section and winding Jev chose for the valley it rose in, and the
// stream loops across the valley's floor as that valley's winding allows.
// A river that passes a pond bends round it, so its valley never cuts the
// pond's rim and drains it. Where it runs is the land's, never a compass
// direction: a valley's own trough, which runs straight along its region's
// axis, gives way to the river's.
//
// Courses are routed over the land composed without those troughs, on a
// coarse grid whose shallow hollows are filled so water finds a way across
// them (priority flood), then smoothed so the grid's eight directions never
// show. Everything is pure and seeded only by the land, so every composer of
// a world (a whole bake, a plan of tiles, a bake's workers) routes the same
// rivers to the bit.

import type { HeightField, Landform, PondBed, StreamBed, ValleyCourse, ValleyNet } from "@gaia/schema";
import { bedBend, fbm, troughOffset } from "@gaia/primitives";
import { RELIEF_BUDGET } from "./budget.ts";
import { withinLand } from "./edge.ts";
import { BANK, HEAD, POND_REACH } from "./water.ts";
import type { WorldSpec } from "./world.ts";

export const RIVERS = {
  /** The routing grid's cell, meters. */
  cell: 8,
  /** A river ends this far inside the land's edge, meters, having cut through the land's rim. */
  margin: 12,
  /** Passes of a short moving average over a course, and how many points either side each takes, a point every `step` meters. */
  passes: 4,
  reach: 5,
  step: 2,
  /** The side of the valley net's lookup cells, meters. */
  net: 48,
  /** A river joins another that it comes within this many of that one's valley's half widths of. */
  alongside: 1,
  /** The steepest a river's valley floor falls to meet the floor of the river it joins. */
  joinGrade: 0.05,
  /** A hollow deeper than this, meters, is a basin rivers run down into and end in, rather than filling it to cross. */
  sink: 1.5,
  /** How fast a river widens below a confluence, meters per meter. */
  widening: 0.1,
  /** How far from its spring a river's winding eases in, and before a pond's rim or another river eases out, meters. */
  meet: 48,
  /** Fewer points than this is no river. */
  shortest: 12,
  /** How far out from a pond's middle its rim lies, in the pond's radii, where a river's valley ends. */
  pondRim: 1.4,
  /** How many points either side of a point a line's bend there is measured over, and the tightest a stream's bed bends there, in its own widths. */
  bendReach: 3,
  bedTightest: 2,
  /** How many cells a river's first heading from its spring is taken over, which its headwater runs straight back along. */
  heading: 18,
  /** A spring rises at least this far inside the land's edge, meters, clear of its rim. */
  springFromEdge: 90,
  /** The routing ground's faint roll: meters, over this many meters. */
  roll: 0.6,
  rollWavelength: 140,
  /** Past its shoulders, a valley's sides go on rising at this grade (about 19 degrees) until they meet the land, as far out as this many half widths past them. */
  grade: 0.35,
  reachOut: 2,
  /**
   * How a wall's run from its floor to its shoulder changes along its river, each side on its own: by a seeded wander
   * that `wallWander` scales into a power of e, so it narrows and widens alike, by up to about 1.5 times, over about
   * `wallWavelength` meters and half that.
   */
  wallWander: 1.3,
  wallWavelength: 320,
  wallOctaves: 2,
  /**
   * Around a bend, the wall outside it, which its river cut, runs shorter and steeper, by up to e to the `bendWall`,
   * about 1.5 times, and the slope inside it as much longer, its floor widening by up to `bendFloor` of itself; a bend
   * counts whole once it turns as tight as a winding valley's tightest, `bendTightest` half widths. Each bend is
   * measured over `wallBendReach` points either side.
   */
  bendWall: 0.4,
  bendFloor: 0.8,
  bendTightest: 1.5,
  wallBendReach: 20,
  /**
   * Inside a bend, its slope keeps a terrace, a level bench halfway up it `bench` of the way across, as an older floor
   * the river left: none where the bend turns less than the first of `terraceBends`, whole from the second on.
   */
  bench: 0.3,
  terraceBends: [0.3, 0.7],
  /** The share of a bend's radius the slope inside it may reach out to. */
  insideRoom: 0.75,
  /** The steepest a valley wall rises (about 27 degrees), well within a walk; a wall eases toward it rather than running at it. */
  steepest: 0.5,
  /** How far below its spring a valley's floor widens from nothing to its own width, meters: half the way its stream's loops ease in. */
  head: 24,
  /** The share of the relief budget's range a valley floor may lie below the land's highest ground. */
  budgetShare: 0.9,
} as const;

const ROLL_SEED = 4231;
const WALL_SEED = 5179;
/**
 * How far round its spring a valley's floor lies level, meters: as far as the spring's pool reaches (`HEAD`, centered
 * 0.6 of its radius upstream of the spring, its edge wandering out to 1 + `wander` of it), so the pool is cut into
 * level ground rather than into the hollow's rising floor, where its rim would stand as a step.
 */
const SPRING_ROOM = HEAD.radius * (0.6 + 1 + HEAD.wander);

const smoothstep = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/**
 * How far up a valley wall the ground lies, from its floor (0) to its shoulder (1), `u` of the way across it: a
 * smoothstep, or as far as `terrace` reaches toward 1, two half-height smoothsteps either side of a level bench.
 */
function wallRise(u: number, terrace: number): number {
  const riser = (1 - RIVERS.bench) / 2;
  return smoothstep(u) + terrace * ((smoothstep(u / riser) + smoothstep((u - riser - RIVERS.bench) / riser)) / 2 - smoothstep(u));
}

type Trough = Extract<HeightField, { op: "trough" }>;

/** The valley a landform with a stream carves: its trough and how deep its floor lies, or null. */
function valleyOf(lf: Landform): { readonly trough: Trough; readonly depth: number } | null {
  if (!lf.water.some((b) => b.kind === "stream")) return null;
  let found: { trough: Trough; depth: number } | null = null;
  const walk = (h: HeightField): void => {
    if (h.op === "scale" && h.of.op === "trough") found ??= { trough: h.of, depth: h.by };
    if (h.op === "sum" || h.op === "product") h.of.forEach(walk);
    if (h.op === "scale" || h.op === "terrace") walk(h.of);
  };
  walk(lf.height);
  return found;
}

/** The land without a valley's trough: its floor line, the fall along it, and the shoulders' roll, which the river's valley gives back. */
function untroughed(h: HeightField): HeightField {
  switch (h.op) {
    case "trough":
      return { op: "constant", value: 1 };
    case "plane":
      return { op: "constant", value: 0 };
    case "product":
      return h.of.some((g) => g.op === "trough") ? { op: "constant", value: 0 } : { op: "product", of: h.of.map(untroughed) };
    case "sum":
      return { op: "sum", of: h.of.map(untroughed) };
    case "scale":
      return { op: "scale", by: h.by, of: untroughed(h.of) };
    case "terrace":
      return { op: "terrace", step: h.step, riser: h.riser, of: untroughed(h.of) };
    default:
      return h;
  }
}

/** A min-heap of grid cells by height, ties by index, so the flood is the same everywhere it runs. */
class Heap {
  private readonly keys: number[] = [];
  private readonly cells: number[] = [];
  get size(): number {
    return this.cells.length;
  }
  private less(a: number, b: number): boolean {
    const ka = this.keys[a] as number;
    const kb = this.keys[b] as number;
    return ka < kb || (ka === kb && (this.cells[a] as number) < (this.cells[b] as number));
  }
  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b] as number, this.keys[a] as number];
    [this.cells[a], this.cells[b]] = [this.cells[b] as number, this.cells[a] as number];
  }
  push(key: number, cell: number): void {
    this.keys.push(key);
    this.cells.push(cell);
    let i = this.cells.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!this.less(i, up)) break;
      this.swap(i, up);
      i = up;
    }
  }
  pop(): number {
    const top = this.cells[0] as number;
    const last = this.cells.length - 1;
    this.swap(0, last);
    this.keys.pop();
    this.cells.pop();
    let i = 0;
    for (;;) {
      const a = i * 2 + 1;
      const b = a + 1;
      let m = i;
      if (a < this.cells.length && this.less(a, m)) m = a;
      if (b < this.cells.length && this.less(b, m)) m = b;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
}

/** A course's points, x and z pairs, every `RIVERS.step` meters along it. */
function resample(points: readonly number[]): number[] {
  const out: number[] = [points[0] as number, points[1] as number];
  let carry = 0;
  for (let k = 2; k < points.length; k += 2) {
    const ax = points[k - 2] as number;
    const az = points[k - 1] as number;
    const bx = points[k] as number;
    const bz = points[k + 1] as number;
    const len = Math.hypot(bx - ax, bz - az);
    let s = RIVERS.step - carry;
    while (s <= len) {
      out.push(ax + ((bx - ax) * s) / len, az + ((bz - az) * s) / len);
      s += RIVERS.step;
    }
    carry = len - (s - RIVERS.step);
  }
  return out;
}

/**
 * A course winding to either side of its line as its valley's trough winds, easing in from its spring, the last `tail` points easing out of the
 * winding and shifted by (`shiftX`, `shiftZ`) at the very end, so it meets what it runs into where that lies.
 */
function wound(line: readonly number[], trough: Trough, tail: number, shiftX: number, shiftZ: number): number[] {
  const count = line.length / 2;
  const ease = Array.from({ length: count }, (_, k) => {
    const t = tail === 0 ? 1 : Math.min(1, (count - 1 - k) / tail);
    return t * t * (3 - 2 * t);
  });
  // It rises where the land sends it, and winds only once it is under way.
  const offs = held(
    line,
    Array.from({ length: count }, (_, k) => {
      const r = Math.min(1, k / (RIVERS.meet / RIVERS.step));
      return troughOffset(trough, k * RIVERS.step) * (ease[k] as number) * r * r * (3 - 2 * r);
    }),
    () => trough.halfWidth,
  );
  const out = new Array<number>(line.length);
  for (let k = 0; k < count; k++) {
    const [nx, nz] = leftOf(line, k);
    out[k * 2] = (line[k * 2] as number) + nx * (offs[k] as number) + shiftX * (1 - (ease[k] as number));
    out[k * 2 + 1] = (line[k * 2 + 1] as number) + nz * (offs[k] as number) + shiftZ * (1 - (ease[k] as number));
  }
  return out;
}

/** The curvature of a line at point `k`, from the turn between its chords `reach` points either side, positive turning left. */
function curvatureAt(line: readonly number[], k: number, reach: number = RIVERS.bendReach): number {
  const count = line.length / 2;
  const a = Math.max(0, k - reach);
  const b = Math.min(count - 1, k + reach);
  if (a === k || b === k) return 0;
  const ax = (line[k * 2] as number) - (line[a * 2] as number);
  const az = (line[k * 2 + 1] as number) - (line[a * 2 + 1] as number);
  const bx = (line[b * 2] as number) - (line[k * 2] as number);
  const bz = (line[b * 2 + 1] as number) - (line[k * 2 + 1] as number);
  return Math.atan2(ax * bz - az * bx, ax * bx + az * bz) / ((Math.hypot(ax, az) + Math.hypot(bx, bz)) / 2 || 1);
}

/**
 * Sideways offsets along a line, to its left where positive, each held where it swings to the inside of a bend so
 * the offset line there bends no tighter than `tightest(k)` meters and never folds back on itself; the holding
 * eases into the offsets either side of it.
 */
function held(line: readonly number[], offs: readonly number[], tightest: (k: number) => number): number[] {
  const cut = offs.map((off, k) => {
    const curvature = curvatureAt(line, k);
    if (off * curvature <= 0) return 0;
    return Math.sign(off) * Math.min(Math.abs(off), Math.max(0, 1 / Math.abs(curvature) - tightest(k))) - off;
  });
  const eased = averaged(cut);
  return offs.map((off, k) => off + (eased[k] as number));
}

/** Values along a line, each eased into those either side of it by a short moving average, its two ends where they were. */
function averaged(values: readonly number[]): number[] {
  let eased = [...values];
  for (let pass = 0; pass < RIVERS.passes; pass++) {
    const q = eased.slice();
    for (let k = 1; k < eased.length - 1; k++) {
      const r = Math.min(RIVERS.reach, k, eased.length - 1 - k);
      let sum = 0;
      for (let j = k - r; j <= k + r; j++) sum += eased[j] as number;
      q[k] = sum / (2 * r + 1);
    }
    eased = q;
  }
  return eased;
}

/**
 * Where each wall of a valley along `course` stands, at each point: on its left, then its right, how far out its flat
 * floor ends, how far its shoulder lies and how much of a terrace it keeps. Each wall narrows and widens along the
 * river on its own; around a bend the wall outside it, which the river cut, runs shorter and steeper, and inside it
 * the floor widens and the slope eases and keeps a terrace. The floor ends just past the spring's pool, so the land
 * rises behind it as a hollow, and past the head it is never narrower than the trough's, so the stream's loops stay
 * on it. No wall is steeper than `RIVERS.steepest`.
 */
function wallsAlong(course: readonly number[], trough: Trough, depth: number): Float32Array {
  const count = course.length / 2;
  const floor = trough.floor * trough.halfWidth;
  const run = trough.halfWidth - floor;
  // How sharply the course turns at each point, its curvature eased along it, positive turning left; level where too
  // little of it lies either side to tell.
  const curvatures = averaged(
    averaged(Array.from({ length: count }, (_, k) => (k < RIVERS.wallBendReach || k > count - 1 - RIVERS.wallBendReach ? 0 : curvatureAt(course, k, RIVERS.wallBendReach)))),
  );
  const walls = new Float32Array(count * 6);
  for (let k = 0; k < count; k++) {
    const curvature = curvatures[k] as number;
    for (const [o, side] of [[0, 1], [3, -1]] as const) {
      // How sharply the course bends toward this side, -1 to 1, negative bending away from it.
      const bend = Math.max(-1, Math.min(1, side * curvature * RIVERS.bendTightest * trough.halfWidth));
      const wander = fbm(WALL_SEED + trough.seed * 2 + o, (k * RIVERS.step) / RIVERS.wallWavelength, 0, RIVERS.wallOctaves, 0.6);
      const head = smoothstep((k * RIVERS.step) / RIVERS.head);
      const wall = run * Math.exp(RIVERS.wallWander * wander + RIVERS.bendWall * bend);
      const [least, most] = RIVERS.terraceBends;
      const terrace = smoothstep((bend - least) / (most - least));
      // A wall rises `depth` along a smoothstep, whose steepest grade is 1.5 times its mean, or a terrace's risers, as
      // much steeper as they are shorter: one that would rise steeper than `RIVERS.steepest` runs longer, easing toward
      // that grade and never reaching it.
      const shortest = ((1.5 * depth) / RIVERS.steepest) * (1 + terrace * (1 / (1 - RIVERS.bench) - 1));
      // Never narrower than the trough's floor past the head, nor than the spring's pool at it.
      const narrowest = Math.max(floor * head, SPRING_ROOM * (1 - head));
      let edge = Math.max(narrowest, floor * (1 + RIVERS.bendFloor * Math.max(0, bend)) * head);
      let shoulder = edge + wall * (1 + (shortest / wall) ** 8) ** (1 / 8);
      // Inside a bend the slope reaches no farther than the bend's radius allows, so it never reaches past the bend's
      // middle, unless the trough's own wall already does: its floor gives way first, never narrower than the trough's.
      const room = Math.max(bend > 0 ? RIVERS.insideRoom / (side * curvature) : Infinity, floor + run);
      edge = Math.max(narrowest, Math.min(edge, room - shortest));
      shoulder = Math.max(Math.min(shoulder, room), edge + shortest);
      walls[k * 6 + o] = edge;
      walls[k * 6 + o + 1] = shoulder;
      walls[k * 6 + o + 2] = terrace;
    }
  }
  return walls;
}

/**
 * A course bent round each pond it passes, so that its valley's wall on the pond's side reaches its shoulder before
 * the pond's rim: a valley cut into the rim would drain the pond. Each point nearer the pond than that is pushed
 * straight out from the pond's middle, the push easing into the points either side, so the course bends smoothly and
 * runs where it ran away from the pond. Bending it changes its walls, so it is bent `RIVERS.passes` times over.
 */
function roundPonds(course: number[], trough: Trough, depth: number, ponds: readonly { readonly x: number; readonly z: number; readonly radius: number }[]): number[] {
  let out = course;
  const count = course.length / 2;
  for (let pass = 0; pass < RIVERS.passes; pass++) {
    const walls = wallsAlong(out, trough, depth);
    const pushX = new Array<number>(count).fill(0);
    const pushZ = new Array<number>(count).fill(0);
    let bent = false;
    for (const p of ponds) {
      for (let k = 0; k < count; k++) {
        const dx = (out[k * 2] as number) - p.x;
        const dz = (out[k * 2 + 1] as number) - p.z;
        const d = Math.hypot(dx, dz);
        const [nx, nz] = leftOf(out, k);
        // The shoulder of the wall on the pond's side: the left wall's where the pond lies to the course's left.
        const clear = p.radius * POND_REACH + (walls[k * 6 + (nx * dx + nz * dz < 0 ? 1 : 4)] as number);
        if (d >= clear) continue;
        pushX[k] = (pushX[k] as number) + (dx / d) * (clear - d);
        pushZ[k] = (pushZ[k] as number) + (dz / d) * (clear - d);
        bent = true;
      }
    }
    if (!bent) break;
    const easedX = averaged(pushX);
    const easedZ = averaged(pushZ);
    out = out.map((v, i) => v + ((i % 2 === 0 ? easedX : easedZ)[i >> 1] as number));
  }
  return out;
}

/** The unit normal to the left of a line, x and z pairs, at point `k`. */
function leftOf(line: ArrayLike<number>, k: number): readonly [number, number] {
  const count = line.length / 2;
  const a = Math.max(0, k - 1);
  const b = Math.min(count - 1, k + 1);
  const tx = (line[b * 2] as number) - (line[a * 2] as number);
  const tz = (line[b * 2 + 1] as number) - (line[a * 2 + 1] as number);
  const len = Math.hypot(tx, tz) || 1;
  return [-tz / len, tx / len];
}

/** A course smoothed so the routing grid's eight directions never show, its two ends where they were. */
function smoothed(points: number[]): number[] {
  let p = points;
  const n = p.length / 2;
  for (let pass = 0; pass < RIVERS.passes; pass++) {
    const q = p.slice();
    for (let k = 1; k < n - 1; k++) {
      const r = Math.min(RIVERS.reach, k, n - 1 - k);
      let sx = 0;
      let sz = 0;
      for (let j = k - r; j <= k + r; j++) {
        sx += p[j * 2] as number;
        sz += p[j * 2 + 1] as number;
      }
      q[k * 2] = sx / (2 * r + 1);
      q[k * 2 + 1] = sz / (2 * r + 1);
    }
    p = q;
  }
  return p;
}

/**
 * The world's rivers routed over the land, and each region's landform with them: a region whose valley carries a
 * stream loses its trough to its river's valley, which the land is cut down to wherever it is composed (every
 * landform carries the world's `valleys`), and its stream follows its river's whole course. `ground` composes the
 * land from landforms, with the rim; `regionAt` names the region that holds a point most.
 */
export function routeRivers(
  spec: WorldSpec,
  landforms: readonly Landform[],
  ground: (landforms: readonly Landform[]) => (x: number, z: number) => number,
  regionAt: (x: number, z: number) => number,
): Landform[] {
  const valleys = landforms.map(valleyOf);
  if (valleys.every((v) => v === null)) return [...landforms];
  const flat: Landform[] = landforms.map((lf, i) => (valleys[i] === null ? lf : { height: untroughed(lf.height), water: lf.water.filter((b) => b.kind !== "stream") }));
  const height = ground(flat);

  // The routing grid over the land, and its hollows filled from the land's edge inward.
  const half = spec.size / 2;
  const n = Math.ceil((half * 2) / RIVERS.cell) + 1;
  const at = (i: number): number => -half + i * RIVERS.cell;
  const h = new Float64Array(n * n);
  const inside = new Uint8Array(n * n);
  const region = new Int32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      inside[k] = withinLand(spec, at(i), at(j), RIVERS.margin) ? 1 : 0;
      if (inside[k] === 0) continue;
      // A faint seeded roll, so water crossing level ground wanders as it would rather than along the grid.
      h[k] = height(at(i), at(j)) + RIVERS.roll * fbm(ROLL_SEED, at(i) / RIVERS.rollWavelength, at(j) / RIVERS.rollWavelength, 2, 0.5);
      region[k] = regionAt(at(i), at(j));
    }
  }
  const down = new Int32Array(n * n).fill(-1);
  const filled = new Float64Array(n * n);
  const done = new Uint8Array(n * n);
  const heap = new Heap();
  const near = [-1, 0, 1];
  for (let k = 0; k < n * n; k++) {
    if (inside[k] === 0) continue;
    const i = k % n;
    const j = Math.floor(k / n);
    const edge = near.some((dj) => near.some((di) => inside[(j + dj) * n + (i + di)] !== 1));
    if (edge) {
      filled[k] = h[k] as number;
      done[k] = 1;
      heap.push(filled[k] as number, k);
    }
  }
  const popped: number[] = [];
  while (heap.size > 0) {
    const k = heap.pop();
    popped.push(k);
    const i = k % n;
    const j = Math.floor(k / n);
    for (const dj of near) {
      for (const di of near) {
        const m = (j + dj) * n + (i + di);
        if ((di === 0 && dj === 0) || inside[m] !== 1 || done[m] === 1) continue;
        done[m] = 1;
        // A hollow fills to a hair over the way out, so the water crossing it always falls toward the edge.
        filled[m] = Math.max(h[m] as number, (filled[k] as number) + 1e-4 * Math.hypot(di, dj));
        down[m] = k;
        heap.push(filled[m] as number, m);
      }
    }
  }

  // How many cells water runs from each cell before it leaves that cell's region or a hollow too deep to cross holds it.
  const run = new Int32Array(n * n);
  for (const k of popped) {
    const next = down[k] as number;
    run[k] = next >= 0 && region[next] === region[k] && (filled[k] as number) - (h[k] as number) <= RIVERS.sink ? (run[next] as number) + 1 : 1;
  }
  // The neighbour a cell falls to most steeply on the land as it lies, unfilled, or -1 at the bottom of a hollow.
  const lowerOf = (k: number): number => {
    const i = k % n;
    const j = Math.floor(k / n);
    let best = -1;
    let drop = 0;
    for (const dj of near) {
      for (const di of near) {
        const m = (j + dj) * n + (i + di);
        if ((di === 0 && dj === 0) || inside[m] !== 1) continue;
        const fall = ((h[k] as number) - (h[m] as number)) / Math.hypot(di, dj);
        if (fall > drop) {
          drop = fall;
          best = m;
        }
      }
    }
    return best;
  };
  // Each river from its spring, the highest ground its own region holds, down to the edge, a pond or a river before it.
  const ponds: { x: number; z: number; radius: number }[] = [];
  spec.regions.forEach((r, ri) => {
    for (const b of flat[ri]?.water ?? []) if (b.kind === "pond") ponds.push({ x: r.x + (b as PondBed).x, z: r.z + (b as PondBed).z, radius: (b as PondBed).radius });
  });
  const owner = new Int32Array(n * n).fill(-1);
  const ownerAt = new Int32Array(n * n);
  const rivers: { source: number; cells: number[]; into: { river: number; at: number } | null; seep: boolean; lake: { x: number; z: number; radius: number } | null }[] = [];
  valleys.forEach((v, ri) => {
    if (v === null) return;
    // Its spring: where water runs longest across its own region before it leaves, so the river Jev chose for an area
    // runs through that area, the higher ground of two; away from the land's rim, which would drain it at once, or,
    // for a region that lies wholly near the rim, anywhere it holds, so every area given water has its river. Never on
    // ground a river laid before it claims, whose valley may run past the area without entering it.
    let spring = -1;
    for (const fromEdge of [RIVERS.springFromEdge, 0]) {
      for (let k = 0; k < n * n; k++) {
        if (inside[k] !== 1 || region[k] !== ri || (owner[k] as number) >= 0 || !withinLand(spec, at(k % n), at(Math.floor(k / n)), fromEdge)) continue;
        if (spring < 0 || (run[k] as number) > (run[spring] as number) || ((run[k] as number) === (run[spring] as number) && (h[k] as number) > (h[spring] as number))) spring = k;
      }
      if (spring >= 0) break;
    }
    if (spring < 0) return;
    const cells: number[] = [];
    let into: { river: number; at: number } | null = null;
    let lake: { x: number; z: number; radius: number } | null = null;
    let seep = false;
    let sinking = false;
    for (let k = spring; ; ) {
      if ((owner[k] as number) >= 0) {
        into = { river: owner[k] as number, at: ownerAt[k] as number };
        break;
      }
      const x = at(k % n);
      const z = at(Math.floor(k / n));
      // Its valley ends at a pond's rim; its stream runs on into the pond's water.
      const pond = ponds.find((p) => Math.hypot(p.x - x, p.z - z) < p.radius * RIVERS.pondRim);
      if (pond !== undefined) {
        into = null;
        lake = pond;
        break;
      }
      cells.push(k);
      // A hollow too deep to fill holds what runs into it: the river runs on down to its lowest and sinks away there.
      if ((filled[k] as number) - (h[k] as number) > RIVERS.sink) sinking = true;
      const next = sinking ? lowerOf(k) : (down[k] as number);
      // At the land's edge the rim rises: the river sinks away into the ground there.
      if (next < 0) {
        seep = true;
        break;
      }
      k = next;
    }
    if (cells.length < 3) return;
    // Its headwater: where the land parts around its spring, its water comes from across the rest of its region,
    // straight back the way it sets off, so its valley spans its region as the area's river should; never alongside
    // its own course further down.
    const reach = Math.max(1, Math.round((v.trough.halfWidth * RIVERS.alongside) / RIVERS.cell));
    const first = cells[Math.min(cells.length - 1, RIVERS.heading)] as number;
    const back = Math.hypot((spring % n) - (first % n), Math.floor(spring / n) - Math.floor(first / n));
    const head: number[] = [];
    for (let t = 1; back > 0; t++) {
      const i = Math.round((spring % n) + (((spring % n) - (first % n)) / back) * t);
      const j = Math.round(Math.floor(spring / n) + ((Math.floor(spring / n) - Math.floor(first / n)) / back) * t);
      const k = j * n + i;
      if (i < 0 || j < 0 || i >= n || j >= n || inside[k] !== 1 || region[k] !== ri || (owner[k] as number) >= 0 || !withinLand(spec, at(i), at(j), RIVERS.springFromEdge)) break;
      if (cells.some((c, ci) => ci > RIVERS.heading && Math.max(Math.abs((c % n) - i), Math.abs(Math.floor(c / n) - j)) <= reach)) break;
      head.push(k);
    }
    cells.unshift(...head.reverse());
    const index = rivers.length;
    // A river claims the ground its valley spans either side of it too, so one that comes alongside it joins it
    // rather than running beside it in a valley of its own.
    const alongside = Math.max(1, Math.round((v.trough.halfWidth * RIVERS.alongside) / RIVERS.cell));
    cells.forEach((k, c) => {
      const i = k % n;
      const j = Math.floor(k / n);
      for (let dj = -alongside; dj <= alongside; dj++) {
        for (let di = -alongside; di <= alongside; di++) {
          const m = (j + dj) * n + (i + di);
          if (i + di < 0 || i + di >= n || j + dj < 0 || j + dj >= n || (owner[m] as number) >= 0) continue;
          owner[m] = index;
          ownerAt[m] = c;
        }
      }
    });
    rivers.push({ source: ri, cells, into, seep, lake });
  });

  // Where along a river's course, as a point index, the water reaching its `at`th cell joins it.
  const lines: number[][] = [];
  const joinIndex = (river: number, at: number): number => {
    const cells = (rivers[river] as (typeof rivers)[number]).cells;
    let along = 0;
    for (let c = 1; c <= Math.min(at, cells.length - 1); c++) {
      const a = cells[c - 1] as number;
      const b = cells[c] as number;
      along += RIVERS.cell * Math.hypot((b % n) - (a % n), Math.floor(b / n) - Math.floor(a / n));
    }
    return Math.min((lines[river] as number[]).length / 2 - 1, Math.round(along / RIVERS.step));
  };
  // Each course smoothed, then winding as its valley winds; each tributary runs on to meet its river where that
  // river now runs.
  rivers.forEach((rv) => {
    const raw: number[] = [];
    for (const k of rv.cells) raw.push(at(k % n), at(Math.floor(k / n)));
    if (rv.into !== null) {
      const parent = lines[rv.into.river] as number[];
      const target = joinIndex(rv.into.river, rv.into.at);
      raw.push(parent[target * 2] as number, parent[target * 2 + 1] as number);
    }
    lines.push(smoothed(resample(raw)));
  });
  const courses: number[][] = [];
  rivers.forEach((rv, c) => {
    const v = valleys[rv.source] as NonNullable<(typeof valleys)[number]>;
    const line = lines[c] as number[];
    const count = line.length / 2;
    // A river's winding fades out into a pond's rim, and where it joins another it bends to meet that one's own.
    const tail = rv.into === null && rv.lake === null ? 0 : Math.min(count - 1, RIVERS.meet / RIVERS.step);
    const into = rv.into;
    const target = into === null ? 0 : joinIndex(into.river, into.at);
    const parentLine = into === null ? [] : (lines[into.river] as number[]);
    const parent = into === null ? [] : (courses[into.river] as number[]);
    const shiftX = into === null ? 0 : (parent[target * 2] as number) - (parentLine[target * 2] as number);
    const shiftZ = into === null ? 0 : (parent[target * 2 + 1] as number) - (parentLine[target * 2 + 1] as number);
    courses.push(roundPonds(wound(line, v.trough, tail, shiftX, shiftZ), v.trough, v.depth, ponds.filter((p) => p !== rv.lake)));
  });
  // The water each river carries, gathered downstream: a river only ever joins one laid before it.
  const carried = rivers.map((rv, c) => {
    const width = (landforms[rv.source]?.water.find((b) => b.kind === "stream") as StreamBed).width;
    return new Float64Array((courses[c] as number[]).length / 2).fill(width * width);
  });
  for (let c = rivers.length - 1; c >= 0; c--) {
    const into = rivers[c]?.into;
    if (into === null || into === undefined) continue;
    const mine = carried[c] as Float64Array;
    const theirs = carried[into.river] as Float64Array;
    const from = Math.min(theirs.length - 1, joinIndex(into.river, into.at));
    for (let k = from; k < theirs.length; k++) theirs[k] = (theirs[k] as number) + (mine[mine.length - 1] as number);
  }

  // No valley floor lies lower than the relief budget allows below the land's highest ground.
  let highest = -Infinity;
  for (let k = 0; k < n * n; k++) if (inside[k] === 1) highest = Math.max(highest, h[k] as number);
  const lowest = highest - RIVERS.budgetShare * RELIEF_BUDGET.range;
  const valleyCourses: ValleyCourse[] = [];
  const floorsOf: (Float32Array | undefined)[] = [];
  const bends: (Float32Array | undefined)[] = [];
  const beds = new Map<number, StreamBed[]>();
  rivers.forEach((rv, c) => {
    const v = valleys[rv.source] as NonNullable<(typeof valleys)[number]>;
    const course = courses[c] as number[];
    const count = course.length / 2;
    if (count < RIVERS.shortest) return;
    // Its floor only ever descends from source to mouth, `depth` below the land or lower where the land rises along
    // its way, so its stream never has to cut a gorge; never below the relief's budget.
    const floors = new Float32Array(count);
    const depths = new Float32Array(count).fill(v.depth);
    const halfWidths = new Float32Array(count).fill(v.trough.halfWidth);
    let floorAt = Infinity;
    for (let k = 0; k < count; k++) {
      const g = height(course[k * 2] as number, course[k * 2 + 1] as number);
      floorAt = Math.max(lowest, Math.min(floorAt - 1e-3, g - v.depth));
      floors[k] = floorAt;
    }
    // Where it joins a river, its floor comes down to that river's, never hanging above it.
    const into = rv.into === null ? undefined : floorsOf[rv.into.river];
    if (rv.into !== null && into !== undefined) {
      const meet = into[Math.min(into.length - 1, joinIndex(rv.into.river, rv.into.at))] as number;
      for (let k = 0; k < count; k++) floors[k] = Math.max(lowest, Math.min(floors[k] as number, meet + RIVERS.joinGrade * (count - 1 - k) * RIVERS.step));
    }
    floorsOf[c] = floors;
    valleyCourses.push({ points: new Float32Array(course), halfWidths, floors, depths, walls: wallsAlong(course, v.trough, v.depth) });
    const stream = landforms[rv.source]?.water.find((b) => b.kind === "stream") as StreamBed;
    // It widens over a short reach below each river that joins it, as a river does below a confluence.
    const widths = Float32Array.from(carried[c] as Float64Array, (q) => Math.sqrt(q));
    for (let k = 1; k < count; k++) widths[k] = Math.min(widths[k] as number, (widths[k - 1] as number) + RIVERS.widening * RIVERS.step);
    // The stream loops across its valley's floor along the course, as far as that valley's winding allows: its bends
    // lengthen as it widens without a break in them, and a tributary's last stretch swings in to meet its river's
    // stream where that runs.
    const r = spec.regions[rv.source] as WorldSpec["regions"][number];
    const meetX = rv.into === null ? 0 : (bends[rv.into.river]?.[joinIndex(rv.into.river, rv.into.at) * 2] ?? 0);
    const meetZ = rv.into === null ? 0 : (bends[rv.into.river]?.[joinIndex(rv.into.river, rv.into.at) * 2 + 1] ?? 0);
    const path = new Float32Array(count * 2);
    const bend = new Float32Array(count * 2);
    const tails = Array.from({ length: count }, (_, k) => {
      const t = rv.into === null ? 1 : Math.min(1, (count - 1 - k) / (RIVERS.meet / RIVERS.step));
      return t * t * (3 - 2 * t);
    });
    // Its loops ease in from its spring, as its valley's winding does.
    const fades = tails.map((t, k) => {
      const r = Math.min(1, k / (RIVERS.meet / RIVERS.step));
      return t * r * r * (3 - 2 * r);
    });
    let along = 0;
    const offs = held(
      course,
      Array.from({ length: count }, (_, k) => {
        if (k > 0) along = (along * (widths[k] as number)) / (widths[k - 1] as number) + RIVERS.step;
        return bedBend(v.trough, along, widths[k] as number) * (fades[k] as number);
      }),
      (k) => RIVERS.bedTightest * (widths[k] as number),
    );
    for (let k = 0; k < count; k++) {
      const [nx, nz] = leftOf(course, k);
      const tail = tails[k] as number;
      bend[k * 2] = nx * (offs[k] as number) + meetX * (1 - tail);
      bend[k * 2 + 1] = nz * (offs[k] as number) + meetZ * (1 - tail);
      path[k * 2] = (course[k * 2] as number) + (bend[k * 2] as number) - r.x;
      path[k * 2 + 1] = (course[k * 2 + 1] as number) + (bend[k * 2 + 1] as number) - r.z;
    }
    bends[c] = bend;
    // Into a pond, the stream runs on from its valley's end down into the water.
    let bed = path;
    let bedWidths = widths;
    let bedFloors = floors.slice();
    if (rv.lake !== null) {
      const ex = (course[(count - 1) * 2] as number) - r.x;
      const ez = (course[(count - 1) * 2 + 1] as number) - r.z;
      const lx = rv.lake.x - r.x;
      const lz = rv.lake.z - r.z;
      const run = Math.hypot(lx - ex, lz - ez);
      const steps = Math.max(0, Math.floor((run - rv.lake.radius * 0.6) / RIVERS.step));
      bed = new Float32Array((count + steps) * 2);
      bed.set(path);
      bedWidths = new Float32Array(count + steps);
      bedWidths.set(widths);
      bedFloors = new Float32Array(count + steps).fill(floors[count - 1] as number);
      bedFloors.set(floors);
      for (let k = 1; k <= steps; k++) {
        bed[(count - 1 + k) * 2] = ex + ((lx - ex) * k * RIVERS.step) / run;
        bed[(count - 1 + k) * 2 + 1] = ez + ((lz - ez) * k * RIVERS.step) / run;
        bedWidths[count - 1 + k] = widths[count - 1] as number;
      }
    }
    const widest = Math.max(...bedWidths);
    const list = beds.get(rv.source) ?? [];
    // A river widens below each that joins it and deepens far less, so its channel's walls keep their slope.
    list.push({ kind: "stream", path: bed, width: widest, depth: stream.depth * Math.sqrt(widest / stream.width), widths: bedWidths, seep: rv.seep, floors: bedFloors });
    beds.set(rv.source, list);
  });
  const net = valleyNet(spec, valleyCourses);
  // Where a river falls steeply, or its headwater crosses a slope, the ground beside it lies lower than its own floor:
  // the stream's floor is the lowest ground the valleys leave beneath it and at its water's edges, so it never stands
  // above its banks, and only ever descends.
  const cutGround = (x: number, z: number): number => Math.min(height(x, z), valleySurface(net, x, z));
  for (const [ri, list] of beds) {
    const r = spec.regions[ri] as WorldSpec["regions"][number];
    for (const bed of list) {
      const floors = bed.floors as Float32Array;
      const p = bed.path;
      const count = p.length / 2;
      let lowestYet = Infinity;
      for (let k = 0; k < count; k++) {
        const x = r.x + (p[k * 2] as number);
        const z = r.z + (p[k * 2 + 1] as number);
        const [nx, nz] = leftOf(p, k);
        const out = ((bed.widths?.[k] ?? bed.width) as number) / 2 + BANK * 0.5;
        lowestYet = Math.min(lowestYet, floors[k] as number, cutGround(x, z), cutGround(x + nx * out, z + nz * out), cutGround(x - nx * out, z - nz * out));
        floors[k] = lowestYet;
      }
    }
  }
  return flat.map((lf, i) => ({ height: lf.height, water: [...lf.water, ...(beds.get(i) ?? [])], valleys: net }));
}

/**
 * The surface the land is cut down to at world (x, z), or Infinity where no valley reaches: the lowest of the
 * valleys near, each its floor, rising up the wall on that side to its shoulder and on at `RIVERS.grade` beyond it,
 * so no slope it cuts is steeper than the valley's own walls or that grade, however the land around it lies.
 */
export function valleySurface(net: ValleyNet, x: number, z: number): number {
  const cx = Math.floor((x - net.x0) / net.cell);
  const cz = Math.floor((z - net.z0) / net.cell);
  if (cx < 0 || cz < 0 || cx >= net.cols || cz >= net.rows) return Infinity;
  let lowest = Infinity;
  for (const code of net.cells[cz * net.cols + cx] ?? []) {
    const course = net.courses[Math.floor(code / 65536)] as ValleyCourse;
    const k = code % 65536;
    const p = course.points;
    const ax = p[k * 2] as number;
    const az = p[k * 2 + 1] as number;
    const abx = (p[k * 2 + 2] as number) - ax;
    const abz = (p[k * 2 + 3] as number) - az;
    const len = abx * abx + abz * abz;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / len)) : 0;
    const d = Math.hypot(x - ax - abx * t, z - az - abz * t);
    const lerp = (a: Float32Array, stride = 1, at = 0): number => (a[k * stride + at] as number) + ((a[(k + 1) * stride + at] as number) - (a[k * stride + at] as number)) * t;
    // Its left wall to the left of the segment's line, its right wall to the right, easing from one to the other
    // within a quarter of the valley's width of that line, so past the course's ends the two walls meet smoothly.
    const halfWidth = lerp(course.halfWidths);
    const across = len > 0 ? (abx * (z - az) - abz * (x - ax)) / Math.sqrt(len) : 0;
    const left = smoothstep((across / (halfWidth / 2) + 1) / 2);
    const wall = (at: number): number => lerp(course.walls, 6, at + 3) + (lerp(course.walls, 6, at) - lerp(course.walls, 6, at + 3)) * left;
    const edge = wall(0);
    const shoulder = wall(1);
    if (d > shoulder + halfWidth * RIVERS.reachOut) continue;
    const surface = lerp(course.floors) + lerp(course.depths) * wallRise((d - edge) / (shoulder - edge), wall(2)) + RIVERS.grade * Math.max(0, d - shoulder);
    lowest = Math.min(lowest, surface);
  }
  return lowest;
}

/** The valley net: every course's segments, by the cells within a valley's reach of them. */
function valleyNet(spec: WorldSpec, courses: readonly ValleyCourse[]): ValleyNet {
  const half = spec.size / 2 + RIVERS.net;
  const cols = Math.ceil((half * 2) / RIVERS.net);
  const cells: number[][] = Array.from({ length: cols * cols }, () => []);
  courses.forEach((c, ci) => {
    const p = c.points;
    const w = c.walls;
    for (let k = 0; k + 1 < p.length / 2; k++) {
      const shoulder = Math.max(w[k * 6 + 1] as number, w[k * 6 + 4] as number, w[k * 6 + 7] as number, w[k * 6 + 10] as number);
      const reach = shoulder + Math.max(c.halfWidths[k] as number, c.halfWidths[k + 1] as number) * RIVERS.reachOut;
      const minX = Math.min(p[k * 2] as number, p[k * 2 + 2] as number) - reach;
      const maxX = Math.max(p[k * 2] as number, p[k * 2 + 2] as number) + reach;
      const minZ = Math.min(p[k * 2 + 1] as number, p[k * 2 + 3] as number) - reach;
      const maxZ = Math.max(p[k * 2 + 1] as number, p[k * 2 + 3] as number) + reach;
      for (let cz = Math.max(0, Math.floor((minZ + half) / RIVERS.net)); cz <= Math.min(cols - 1, Math.floor((maxZ + half) / RIVERS.net)); cz++) {
        for (let cx = Math.max(0, Math.floor((minX + half) / RIVERS.net)); cx <= Math.min(cols - 1, Math.floor((maxX + half) / RIVERS.net)); cx++) {
          (cells[cz * cols + cx] as number[]).push(ci * 65536 + k);
        }
      }
    }
  });
  return { courses, cell: RIVERS.net, x0: -half, z0: -half, cols, rows: cols, cells };
}
