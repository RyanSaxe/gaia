// Routes rivers downhill across the whole land and carves their valleys. Each
// region whose valley carries a stream gets a river from a spring in that
// region to the land's edge, a pond or an earlier river, and the river's valley,
// with the cross-section and winding Jev chose, replaces the region's straight
// trough. The routing reads only the land, so a whole bake, a tile plan and a
// bake's workers route the same rivers bit for bit.

import type { HeightField, Landform, PondBed, StreamBed, ValleyCourse, ValleyNet } from "@gaia/schema";
import { bedBend, fbm, troughOffset } from "@gaia/primitives";
import { RELIEF_BUDGET } from "./budget.ts";
import { BUILDING_MARGIN, pastTheEdge, withinLand } from "./edge.ts";
import { BANK, HEAD, POND_REACH } from "./water.ts";
import type { WorldSpec } from "./world.ts";

export const RIVERS = {
  /** Side in meters of a routing grid cell. */
  cell: 8,
  /** Meters inside the land's edge where the routing grid stops and a river ends. */
  margin: 12,
  /** Course smoothing: `passes` passes of a moving average over `reach` points either side, on points every `step` meters. */
  passes: 4,
  reach: 5,
  step: 2,
  /** Side in meters of the valley net's lookup cells. */
  net: 48,
  /** A river joins an earlier one when it comes within this many of the earlier valley's half widths. */
  alongside: 1,
  /** The steepest a river's valley floor falls to meet the floor of the river it joins. */
  joinGrade: 0.05,
  /** Meters a river runs before it can join an earlier river's valley, and not only its course, so it has banks of its own. */
  banked: 64,
  /** How fast a river widens below a confluence, in meters per meter. */
  widening: 0.1,
  /** Meters over which a river's winding eases in from its spring, and eases out before a pond's rim or another river. */
  meet: 48,
  /** A course with fewer points than this gets no valley or stream. */
  shortest: 12,
  /** Distance from a pond's center, in pond radii, within which a river's routing ends at the pond. */
  pondRim: 1.4,
  /** `bendReach` is the points either side over which `curvatureAt` measures a bend. `bedTightest` is a stream bed's tightest bend radius, in its own widths. */
  bendReach: 3,
  bedTightest: 2,
  /** Cells over which a river's first heading from its spring is measured. The headwater extends straight back along that heading. */
  heading: 18,
  /** Preferred minimum distance in meters from a spring to the land's edge, which keeps it off the rim. */
  springFromEdge: 90,
  /** Amplitude and wavelength in meters of the noise added to the routing ground. */
  roll: 0.6,
  rollWavelength: 140,
  /** Past its shoulders, a valley's sides keep rising at `grade` (about 19 degrees) until they meet the land, at least `reachOut` half widths past the shoulders. */
  grade: 0.35,
  reachOut: 2,
  /** The farthest past its shoulders a valley's sides rise to meet the land, meters. */
  farthest: 120,
  /**
   * Seeded noise varies each wall's run from floor to shoulder along the river, each side separately. `wallWander`
   * scales the noise as an exponent of e, so the wall narrows and widens alike, by up to about 1.5 times. The noise has
   * wavelength `wallWavelength` and `wallOctaves` octaves.
   */
  wallWander: 1.3,
  wallWavelength: 320,
  wallOctaves: 2,
  /**
   * Around a bend, the outside wall runs shorter and steeper by up to e to the `bendWall`, about 1.5 times, and the
   * inside slope runs that much longer, with its floor widening by up to `bendFloor` of itself. A bend counts in full
   * once it turns as tight as `bendTightest` half widths. Each bend is measured over `wallBendReach` points either
   * side.
   */
  bendWall: 0.4,
  bendFloor: 0.8,
  bendTightest: 1.5,
  wallBendReach: 20,
  /**
   * The slope inside a bend has a terrace, a level bench halfway up that is `bench` of the way across. There is no
   * terrace where the bend is under the first of `terraceBends`, and a full one from the second on.
   */
  bench: 0.3,
  terraceBends: [0.3, 0.7],
  /** The share of a bend's radius the slope inside it may reach out to. */
  insideRoom: 0.75,
  /** The steepest grade of a valley wall, about 27 degrees, which is walkable. A wall approaches this grade without reaching it. */
  steepest: 0.5,
  /** Meters below its spring over which a valley's floor widens from nothing to full width. It is half of `meet`. */
  head: 24,
  /** The share of the relief budget's range a valley floor may lie below the land's highest ground. */
  budgetShare: 0.9,
} as const;

const ROLL_SEED = 4231;
const WALL_SEED = 5179;
/**
 * Radius in meters around a spring where the valley floor is level. It covers the spring's pool (`HEAD`), which is
 * centered 0.6 of its radius upstream of the spring with an edge out to 1 + `wander` of the radius. So the pool is cut
 * into level ground instead of the hollow's rising floor, where its rim would show as a step.
 */
const SPRING_ROOM = HEAD.radius * (0.6 + 1 + HEAD.wander);

const smoothstep = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/**
 * Height up a valley wall `u` of the way across it, from its floor (0) to its shoulder (1). It is a smoothstep, blended
 * by `terrace` toward two half-height smoothsteps on either side of a level bench.
 */
function wallRise(u: number, terrace: number): number {
  const riser = (1 - RIVERS.bench) / 2;
  return smoothstep(u) + terrace * ((smoothstep(u / riser) + smoothstep((u - riser - RIVERS.bench) / riser)) / 2 - smoothstep(u));
}

type Trough = Extract<HeightField, { op: "trough" }>;

/** The trough and floor depth of a landform's valley, or null when the landform has no stream or no scaled trough. */
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

/** The height field without a valley's trough. It drops the trough, the plane along it and any product with a trough, which the river's valley replaces. */
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

/** A min-heap of grid cells by height, with ties broken by index, so the flood order is deterministic. */
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

/** Resamples a course of x, z pairs to a point every `RIVERS.step` meters. */
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
 * Offsets a course to either side of its line as its valley's trough winds. The winding eases in from the spring and eases out over the last
 * `tail` points, which shift toward (`shiftX`, `shiftZ`) at the end so the course meets what it runs into.
 */
function wound(line: readonly number[], trough: Trough, tail: number, shiftX: number, shiftZ: number): number[] {
  const count = line.length / 2;
  const ease = Array.from({ length: count }, (_, k) => {
    const t = tail === 0 ? 1 : Math.min(1, (count - 1 - k) / tail);
    return t * t * (3 - 2 * t);
  });
  // The winding eases in over `RIVERS.meet` from the spring, so the spring stays where the routing put it.
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
 * Sideways offsets along a line, positive to the left. Where an offset swings to the inside of a bend, it is limited so
 * the offset line bends no tighter than `tightest(k)` meters and never folds back. The limit is smoothed into the
 * neighboring offsets.
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

/** Smooths values along a line with `RIVERS.passes` passes of a moving average, keeping both ends fixed. */
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
 * For each point of a valley along `course`, the left wall then the right: where its flat floor ends, where its
 * shoulder lies and how much terrace it has. Each wall narrows and widens along the river independently. Around a bend
 * the outside wall is shorter and steeper, and inside the floor widens and the slope eases and has a terrace. The floor
 * ends just past the spring's pool, so the land rises behind it as a hollow. Past the head the floor is never narrower
 * than the trough's, so the stream's loops stay on it. No wall is steeper than `RIVERS.steepest`.
 */
function wallsAlong(course: readonly number[], trough: Trough, depth: number): Float32Array {
  const count = course.length / 2;
  const floor = trough.floor * trough.halfWidth;
  const run = trough.halfWidth - floor;
  // The course's curvature at each point, smoothed along it and positive turning left. It is 0 within
  // `RIVERS.wallBendReach` points of either end.
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
      // A wall rises `depth` along a smoothstep, whose steepest grade is 1.5 times its mean. A terrace's risers are
      // steeper in proportion to how much shorter they are. A wall that would be steeper than `RIVERS.steepest` runs
      // longer, so it approaches that grade without reaching it.
      const shortest = ((1.5 * depth) / RIVERS.steepest) * (1 + terrace * (1 / (1 - RIVERS.bench) - 1));
      // The floor is never narrower than the trough's floor past the head, nor than the spring's pool at the head.
      const narrowest = Math.max(floor * head, SPRING_ROOM * (1 - head));
      let edge = Math.max(narrowest, floor * (1 + RIVERS.bendFloor * Math.max(0, bend)) * head);
      let shoulder = edge + wall * (1 + (shortest / wall) ** 8) ** (1 / 8);
      // Inside a bend the slope reaches no farther than `RIVERS.insideRoom` of the bend's radius, unless the trough's
      // own wall already reaches farther. The floor narrows first, but never below `narrowest`.
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
 * Bends a course around each pond it passes, so its valley wall on the pond's side reaches its shoulder before the
 * pond's rim. A valley cut into the rim would drain the pond. Each point too near a pond is pushed straight out from the
 * pond's center, and the push is smoothed into the neighboring points. The course bends smoothly and keeps its place
 * away from the pond. Bending changes the walls, so it repeats up to `RIVERS.passes` times.
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
        // Use the shoulder of the wall on the pond's side, the left wall when the pond lies to the course's left.
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

/** Smooths a course so the routing grid's eight directions do not show, keeping both ends fixed. */
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
 * Routes the world's rivers over the land and returns each region's landform with them. A region whose valley carries a
 * stream loses its trough to its river's valley, and its stream follows its river's whole course. Every landform
 * carries the world's `valleys`, so the land is cut down to them wherever it is composed. `ground` composes the land
 * from landforms, rim included. `regionAt` returns the region with the largest weight at a point.
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

  // Sample the routing grid over the land.
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
      // Seeded noise, so water crossing level ground curves instead of following the grid.
      h[k] = height(at(i), at(j)) + RIVERS.roll * fbm(ROLL_SEED, at(i) / RIVERS.rollWavelength, at(j) / RIVERS.rollWavelength, 2, 0.5);
      region[k] = regionAt(at(i), at(j));
    }
  }
  // A priority flood from the land's edge inward, lowest ground first, gives every cell a way down to the edge. Each
  // cell drains to the cell it was reached from. A hollow fills to just over the lowest point of its rim, so water
  // crossing it runs on toward that point and out. No river ends in a hollow, and its valley cuts through the rim.
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
        filled[m] = Math.max(h[m] as number, (filled[k] as number) + 1e-4 * Math.hypot(di, dj));
        down[m] = k;
        heap.push(filled[m] as number, m);
      }
    }
  }

  // How many cells water runs from each cell before it leaves that cell's region.
  const run = new Int32Array(n * n);
  for (const k of popped) {
    const next = down[k] as number;
    run[k] = next >= 0 && region[next] === region[k] ? (run[next] as number) + 1 : 1;
  }
  // Each river runs from its spring down to the edge, a pond or an earlier river.
  const ponds: { x: number; z: number; radius: number }[] = [];
  spec.regions.forEach((r, ri) => {
    for (const b of flat[ri]?.water ?? []) if (b.kind === "pond") ponds.push({ x: r.x + (b as PondBed).x, z: r.z + (b as PondBed).z, radius: (b as PondBed).radius });
  });
  // The lowest ground on each pond's rim ring before any river is cut. A river that ends in the pond keeps its valley
  // floor at or above this, so its water meets the pond at the pond's surface and does not drain it.
  const rims = new Map(
    ponds.map((p) => {
      let rim = Infinity;
      const reach = p.radius * POND_REACH;
      const steps = Math.ceil((Math.PI * 2 * reach) / 2);
      for (let s = 0; s < steps; s++) rim = Math.min(rim, height(p.x + Math.cos((s / steps) * Math.PI * 2) * reach, p.z + Math.sin((s / steps) * Math.PI * 2) * reach));
      return [p, rim] as const;
    }),
  );
  // The pond each cell's water runs into: a pond within `RIVERS.pondRim` whose rim height the cell reaches. Water that
  // reaches a raised rim from lower ground runs on past it, and its valley bends around the pond.
  const pondAt = Array.from({ length: n * n }, (_, k) =>
    inside[k] === 1 ? ponds.find((p) => Math.hypot(p.x - at(k % n), p.z - at(Math.floor(k / n))) < p.radius * RIVERS.pondRim && (h[k] as number) >= (rims.get(p) as number) - RIVERS.roll) : undefined,
  );
  const owner = new Int32Array(n * n).fill(-1);
  const ownerAt = new Int32Array(n * n);
  const rivers: { source: number; cells: number[]; into: { river: number; at: number } | null; seep: boolean; lake: { x: number; z: number; radius: number } | null }[] = [];
  // 1 for each cell an earlier river's course runs through. `owner` also covers the ground its valley spans.
  const course = new Uint8Array(n * n);
  const banked = Math.round(RIVERS.banked / RIVERS.cell);
  // Water joins an earlier river anywhere that river's valley spans once it has run `RIVERS.banked`, so it has banks of
  // its own. Before that it joins only where it reaches the earlier river's course. It never joins where it is below
  // that river's course, since its water could not rise to it, and it runs on past instead.
  const joins = (k: number, along: number): boolean => {
    const o = owner[k] as number;
    if (o < 0 || (along < banked && course[k] !== 1)) return false;
    return (h[k] as number) >= (h[(rivers[o] as (typeof rivers)[number]).cells[ownerAt[k] as number] as number] as number) - RIVERS.roll;
  };
  // How many cells water runs from each cell before it reaches an earlier river, a pond or the land's edge.
  const free = new Int32Array(n * n);
  // Lay the smallest regions' rivers first, while their ground is unowned. A river through a small area would
  // otherwise own all of it before the area's own river is laid.
  const extent = new Int32Array(spec.regions.length);
  for (let k = 0; k < n * n; k++) if (inside[k] === 1) extent[region[k] as number] = (extent[region[k] as number] as number) + 1;
  for (const ri of [...valleys.keys()].sort((a, b) => (extent[a] as number) - (extent[b] as number) || a - b)) {
    const v = valleys[ri];
    if (v === null || v === undefined) continue;
    for (const k of popped) {
      const next = down[k] as number;
      free[k] = joins(k, 0) || pondAt[k] !== undefined ? 0 : next < 0 ? 1 : (free[next] as number) + 1;
    }
    // The spring is the cell where water runs longest within the region before leaving it, so the river Jev chose for
    // an area runs through that area. Ties go to the higher cell. The search prefers cells `RIVERS.springFromEdge` from
    // the land's edge, since the rim would drain the river at once. For a region near the rim it falls back to cells
    // where buildings may still stand on the banks, then to any cell in the region. The spring must run at least
    // `RIVERS.banked` before meeting an earlier river, or as far as any cell in its region allows.
    let spring = -1;
    let longest = 0;
    for (let k = 0; k < n * n; k++) if (inside[k] === 1 && region[k] === ri) longest = Math.max(longest, free[k] as number);
    for (const fromEdge of [RIVERS.springFromEdge, BUILDING_MARGIN + RIVERS.cell, 0]) {
      for (let k = 0; k < n * n; k++) {
        if (inside[k] !== 1 || region[k] !== ri || (free[k] as number) < Math.min(banked, longest) || !withinLand(spec, at(k % n), at(Math.floor(k / n)), fromEdge)) continue;
        if (spring < 0 || (run[k] as number) > (run[spring] as number) || ((run[k] as number) === (run[spring] as number) && (h[k] as number) > (h[spring] as number))) spring = k;
      }
      if (spring >= 0) break;
    }
    if (spring < 0) continue;
    const cells: number[] = [];
    let into: { river: number; at: number } | null = null;
    let lake: { x: number; z: number; radius: number } | null = null;
    let seep = false;
    for (let k = spring; ; ) {
      if (joins(k, cells.length)) {
        into = { river: owner[k] as number, at: ownerAt[k] as number };
        break;
      }
      // The valley ends at a pond's rim, and the stream continues into the pond's water.
      const pond = pondAt[k];
      if (pond !== undefined) {
        lake = pond;
        break;
      }
      cells.push(k);
      const next = down[k] as number;
      // The rim rises at the land's edge, so the river seeps away there. The routing grid covers the land's rectangle,
      // so a river running into a corner seeps away where the corner's rounded rim rises, the same distance in.
      if (next < 0 || pastTheEdge(spec, at(next % n), at(Math.floor(next / n))) > -RIVERS.margin) {
        seep = true;
        break;
      }
      k = next;
    }
    if (cells.length < 3) continue;
    // Extend the headwater straight back from the spring along its first heading, so the valley spans its region. The
    // extension stops at the region's border, owned ground, `RIVERS.springFromEdge` from the edge, or where it would run
    // alongside the river's own course further down.
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
    // A river owns the ground its valley spans on either side too, so a later river that comes alongside joins it
    // instead of running beside it in a valley of its own.
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
    for (const k of cells) course[k] = 1;
    rivers.push({ source: ri, cells, into, seep, lake });
  }

  // The point index along a river's line where water reaching its `at`th cell joins it.
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
  // Smooth each course. A tributary's course extends to its river's smoothed line at the join.
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
    // A river's winding fades out before a pond's rim. Where it joins another river, its end shifts onto that river's winding.
    const tail = rv.into === null && rv.lake === null ? 0 : Math.min(count - 1, RIVERS.meet / RIVERS.step);
    const into = rv.into;
    const target = into === null ? 0 : joinIndex(into.river, into.at);
    const parentLine = into === null ? [] : (lines[into.river] as number[]);
    const parent = into === null ? [] : (courses[into.river] as number[]);
    const shiftX = into === null ? 0 : (parent[target * 2] as number) - (parentLine[target * 2] as number);
    const shiftZ = into === null ? 0 : (parent[target * 2 + 1] as number) - (parentLine[target * 2 + 1] as number);
    courses.push(roundPonds(wound(line, v.trough, tail, shiftX, shiftZ), v.trough, v.depth, ponds.filter((p) => p !== rv.lake)));
  });
  // The flow each river carries, as width squared, summed downstream. A river only joins an earlier one, so one backward pass suffices.
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

  // The routing grid's height, bilinear between its points. Off the grid it is the composed height.
  const landAt = (x: number, z: number): number => {
    const fi = (x + half) / RIVERS.cell;
    const fj = (z + half) / RIVERS.cell;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    if (i < 0 || j < 0 || i + 1 >= n || j + 1 >= n) return height(x, z);
    const k = j * n + i;
    if (inside[k] !== 1 || inside[k + 1] !== 1 || inside[k + n] !== 1 || inside[k + n + 1] !== 1) return height(x, z);
    const u = fi - i;
    const w = fj - j;
    return ((h[k] as number) * (1 - u) + (h[k + 1] as number) * u) * (1 - w) + ((h[k + n] as number) * (1 - u) + (h[k + n + 1] as number) * u) * w;
  };
  // No valley floor lies more than `RIVERS.budgetShare` of the relief range below the land's highest ground.
  let highest = -Infinity;
  for (let k = 0; k < n * n; k++) if (inside[k] === 1) highest = Math.max(highest, h[k] as number);
  const lowest = highest - RIVERS.budgetShare * RELIEF_BUDGET.range;
  const valleyCourses: ValleyCourse[] = [];
  const floorsOf: (Float32Array | undefined)[] = [];
  /** Each river's lowest allowed floor: the rim of the pond it ends in, directly or through the river it joins. */
  const aboveOf: (number | undefined)[] = [];
  const bends: (Float32Array | undefined)[] = [];
  const beds = new Map<number, StreamBed[]>();
  rivers.forEach((rv, c) => {
    const v = valleys[rv.source] as NonNullable<(typeof valleys)[number]>;
    const course = courses[c] as number[];
    const count = course.length / 2;
    if (count < RIVERS.shortest) return;
    // The floor only descends from source to mouth. It lies `depth` below the land, or lower where the land rises along
    // the way, so the stream never cuts a gorge. It stays at or above `lowest` unless the land it crosses is lower
    // still. There it runs on the land, and its valley cuts through the rim beyond at that height.
    const floors = new Float32Array(count);
    const depths = new Float32Array(count).fill(v.depth);
    const halfWidths = new Float32Array(count).fill(v.trough.halfWidth);
    let floorAt = Infinity;
    let landLow = Infinity;
    for (let k = 0; k < count; k++) {
      const g = height(course[k * 2] as number, course[k * 2 + 1] as number);
      landLow = Math.min(landLow, g);
      floorAt = Math.max(Math.min(lowest, landLow), Math.min(floorAt - 1e-3, g - v.depth));
      floors[k] = floorAt;
    }
    // A river ending in a pond, directly or through the river it joins, keeps its floor at or above the pond's rim, so no valley drains the pond.
    const above = rv.lake !== null ? (rims.get(rv.lake) as number) : rv.into !== null ? (aboveOf[rv.into.river] ?? -Infinity) : -Infinity;
    aboveOf[c] = above;
    for (let k = 0; k < count; k++) floors[k] = Math.max(floors[k] as number, above);
    // Toward a join, the floor descends to the other river's floor at no more than `RIVERS.joinGrade`, so it neither hangs above it nor runs in below it.
    const into = rv.into === null ? undefined : floorsOf[rv.into.river];
    if (rv.into !== null && into !== undefined) {
      const meet = into[Math.min(into.length - 1, joinIndex(rv.into.river, rv.into.at))] as number;
      for (let k = 0; k < count; k++) floors[k] = Math.max(meet, Math.min(floors[k] as number, meet + RIVERS.joinGrade * (count - 1 - k) * RIVERS.step));
    }
    floorsOf[c] = floors;
    const walls = wallsAlong(course, v.trough, v.depth);
    // Each point's valley cuts the land out past its shoulders until its sides, rising at `RIVERS.grade`, meet the land.
    // A valley cut deep through a rim then ends in a slope, not a cliff.
    const reaches = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      const [nx, nz] = leftOf(course, k);
      const x = course[k * 2] as number;
      const z = course[k * 2 + 1] as number;
      const top = (floors[k] as number) + (depths[k] as number);
      let reach = 0;
      for (const [side, o] of [[1, 1], [-1, 4]] as const) {
        const shoulder = walls[k * 6 + o] as number;
        let d = shoulder + (halfWidths[k] as number) * RIVERS.reachOut;
        while (d < shoulder + RIVERS.farthest && top + RIVERS.grade * (d - shoulder) < landAt(x + nx * side * d, z + nz * side * d)) d += RIVERS.cell / 2;
        reach = Math.max(reach, d);
      }
      reaches[k] = reach;
    }
    valleyCourses.push({ points: new Float32Array(course), halfWidths, floors, depths, walls, reaches });
    const stream = landforms[rv.source]?.water.find((b) => b.kind === "stream") as StreamBed;
    // The stream widens gradually below each confluence, by at most `RIVERS.widening` meters per meter.
    const widths = Float32Array.from(carried[c] as Float64Array, (q) => Math.sqrt(q));
    for (let k = 1; k < count; k++) widths[k] = Math.min(widths[k] as number, (widths[k - 1] as number) + RIVERS.widening * RIVERS.step);
    // The stream loops across its valley's floor as far as the valley's winding allows. Its bends lengthen as it widens
    // with no jump in phase, and a tributary's last stretch shifts to meet its river's stream.
    const r = spec.regions[rv.source] as WorldSpec["regions"][number];
    const meetX = rv.into === null ? 0 : (bends[rv.into.river]?.[joinIndex(rv.into.river, rv.into.at) * 2] ?? 0);
    const meetZ = rv.into === null ? 0 : (bends[rv.into.river]?.[joinIndex(rv.into.river, rv.into.at) * 2 + 1] ?? 0);
    const path = new Float32Array(count * 2);
    const bend = new Float32Array(count * 2);
    // The loops ease out toward the end, so the stream ends on its valley's floor.
    const tails = Array.from({ length: count }, (_, k) => {
      const t = Math.min(1, (count - 1 - k) / (RIVERS.meet / RIVERS.step));
      return t * t * (3 - 2 * t);
    });
    // The loops ease in from the spring, as the valley's winding does.
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
    // For a river ending in a pond, extend the stream from its valley's end into the water.
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
    // A river deepens with the square root of its widening, so its channel walls keep their slope.
    list.push({ kind: "stream", path: bed, width: widest, depth: stream.depth * Math.sqrt(widest / stream.width), widths: bedWidths, seep: rv.seep, floors: bedFloors });
    beds.set(rv.source, list);
  });
  const net = valleyNet(spec, valleyCourses);
  // Where a river falls steeply, or its headwater crosses a slope, the ground beside it can be lower than its floor.
  // The stream's floor is the running minimum of the cut ground beneath it and at its surface edges, so it never
  // is above its banks and only descends.
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
 * The height the land is cut down to at world (x, z), or Infinity where no valley reaches. It is the lowest surface of
 * the nearby valleys. Each surface is the valley floor, rising up the wall on that side to the shoulder and then at
 * `RIVERS.grade` beyond, so no cut slope is steeper than the valley's own walls or that grade.
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
    // Use the left wall left of the segment's line and the right wall right of it, blending within a quarter of the
    // valley's width of the line, so past the course's ends the two walls meet smoothly.
    const halfWidth = lerp(course.halfWidths);
    const across = len > 0 ? (abx * (z - az) - abz * (x - ax)) / Math.sqrt(len) : 0;
    const left = smoothstep((across / (halfWidth / 2) + 1) / 2);
    const wall = (at: number): number => lerp(course.walls, 6, at + 3) + (lerp(course.walls, 6, at) - lerp(course.walls, 6, at + 3)) * left;
    const edge = wall(0);
    const shoulder = wall(1);
    if (d > lerp(course.reaches)) continue;
    const surface = lerp(course.floors) + lerp(course.depths) * wallRise((d - edge) / (shoulder - edge), wall(2)) + RIVERS.grade * Math.max(0, d - shoulder);
    lowest = Math.min(lowest, surface);
  }
  return lowest;
}

/** Indexes every course's segments by the lookup cells within the valley's reach of them, including cells past the land's edge. */
function valleyNet(spec: WorldSpec, courses: readonly ValleyCourse[]): ValleyNet {
  let out = spec.size / 2;
  for (const c of courses) for (let k = 0; k < c.points.length / 2; k++) out = Math.max(out, Math.abs(c.points[k * 2] as number) + (c.reaches[k] as number), Math.abs(c.points[k * 2 + 1] as number) + (c.reaches[k] as number));
  const half = out + RIVERS.net;
  const cols = Math.ceil((half * 2) / RIVERS.net);
  const cells: number[][] = Array.from({ length: cols * cols }, () => []);
  courses.forEach((c, ci) => {
    const p = c.points;
    for (let k = 0; k + 1 < p.length / 2; k++) {
      const reach = Math.max(c.reaches[k] as number, c.reaches[k + 1] as number);
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
