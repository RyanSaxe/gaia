// Trails between a world's places. A trail's look is a `RouteSpec` Jev
// fills; its route is never chosen, it is found over the baked ground: the
// cheapest way at a gentle grade, around steep ground and deep water, across
// a stream where it is narrow, wandering as freely as the spec's winding
// says. The composition budget then keeps the most wanted trails that fit,
// so trails never dominate a region. Everything here is pure and seeded.

import type { RouteSpec } from "@gaia/schema";
import { fbm } from "@gaia/primitives";
import { heightAt, slopeAt, worldOf } from "./lattice.ts";
import type { Occupied } from "./scatter.ts";
import { DRY, type Terrain } from "./world.ts";

export const TRAILS = {
  /** Meters per routing cell. */
  cell: 2,
  /** Trails keep this far inside the walkable square's edge, meters. */
  margin: 22,
  /** Steepest grade a trail climbs head-on; steeper ground is a detour. */
  maxGrade: 0.32,
  /** Cost added per routing cell of shallow water: a crossing is worth about this many meters of detour. */
  wade: 14,
  /** Water deeper than this is never crossed, meters. */
  deep: 0.7,
  /** Ground already worn by a trail costs this share, so trails join instead of running side by side. */
  join: 0.55,
  /** Wavelength of the wandering that `winding` scales, meters. */
  wander: 46,
  /** The composition budget. */
  routesPerRegion: 3,
  /** Share of a region's ground trails may cover. */
  share: 0.05,
  /** How far the ground eases back to the land beyond a trail's edge, meters. */
  blend: 2.6,
  /** Half the length of ground the tread's grade is averaged over, meters. */
  grade: 7,
  /** The most the flattening cuts or fills, meters. */
  maxCut: 0.55,
  /** The trail field's reach past an edge, meters; farther reads as this. */
  reach: 6,
  /** A second trail counts at a sample when its edge is within this many meters of the nearest one's, so where trails meet the more worn one shows. */
  meet: 1.2,
} as const;

/** One end of a trail: a place, such as a cottage's door or a landmark's foot. */
export interface TrailEnd {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

/** A trail Jev wants: two places, how it looks, and how much Jev wants it. */
export interface TrailRequest {
  readonly id: string;
  readonly from: TrailEnd;
  readonly to: TrailEnd;
  readonly style: RouteSpec;
  /** Jev's probability that this dependency should show as a trail, 0 to 1. */
  readonly want: number;
}

/** Where a trail crosses a stream: the span from bank to bank, along the trail. */
export interface Crossing {
  readonly x: number;
  readonly z: number;
  /** Rotation about y that turns local +x along the trail, as Three's rotation does. */
  readonly yaw: number;
  /** Bank to bank, meters. */
  readonly span: number;
  /** The water's surface under the middle. */
  readonly level: number;
  /** The higher bank's ground, where a deck would rest. */
  readonly bank: number;
}

export interface Trail {
  readonly id: string;
  /** The ids of the places it joins: the first end, where `points` start, and the second. */
  readonly from: string;
  readonly to: string;
  readonly style: RouteSpec;
  /** The tread's center line, x and z pairs about a meter apart, from the first end to the second. */
  readonly points: Float32Array;
  readonly length: number;
  readonly crossings: readonly Crossing[];
  /** Every region the trail passes through. */
  readonly regions: readonly number[];
}

// ---------- routing ----------

class Heap {
  readonly #keys: number[] = [];
  readonly #items: number[] = [];
  get size(): number {
    return this.#items.length;
  }
  push(item: number, key: number): void {
    const k = this.#keys;
    const it = this.#items;
    k.push(key);
    it.push(item);
    let i = it.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((k[p] as number) <= key) break;
      k[i] = k[p] as number;
      it[i] = it[p] as number;
      i = p;
    }
    k[i] = key;
    it[i] = item;
  }
  pop(): number {
    const k = this.#keys;
    const it = this.#items;
    const top = it[0] as number;
    const lastK = k.pop() as number;
    const lastI = it.pop() as number;
    if (it.length > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= it.length) break;
        const r = l + 1;
        const c = r < it.length && (k[r] as number) < (k[l] as number) ? r : l;
        if ((k[c] as number) >= lastK) break;
        k[i] = k[c] as number;
        it[i] = it[c] as number;
        i = c;
      }
      k[i] = lastK;
      it[i] = lastI;
    }
    return top;
  }
}

interface Grid {
  readonly n: number;
  readonly origin: number;
  readonly height: Float32Array;
  readonly slope: Float32Array;
  readonly depth: Float32Array;
  readonly wander: Float32Array;
  readonly worn: Uint8Array;
}

function gridOf(t: Terrain, seed: number): Grid {
  const half = t.spec.size / 2 - TRAILS.margin;
  const n = Math.floor((half * 2) / TRAILS.cell) + 1;
  const origin = -half;
  const height = new Float32Array(n * n);
  const slope = new Float32Array(n * n);
  const depth = new Float32Array(n * n);
  const wander = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = origin + i * TRAILS.cell;
      const z = origin + j * TRAILS.cell;
      const k = j * n + i;
      const h = heightAt(t.lattice, x, z);
      height[k] = h;
      slope[k] = slopeAt(t.lattice, x, z);
      const level = heightAt(t.lattice, x, z, t.waterLevel);
      depth[k] = level > DRY / 2 ? Math.max(0.01, level - h) : 0;
      wander[k] = 0.5 + 0.5 * fbm(seed, x / TRAILS.wander, z / TRAILS.wander, 2, 0.5);
    }
  }
  return { n, origin, height, slope, depth, wander, worn: new Uint8Array(n * n) };
}

const NEIGHBORS: readonly [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
  [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1],
];

/** The cheapest chain of cells between two points, or null when none exists. */
function search(g: Grid, from: TrailEnd, to: TrailEnd, winding: number, avoid: readonly Occupied[]): [number, number][] | null {
  const { n, origin } = g;
  const cellOf = (x: number, z: number): number => {
    const i = Math.max(0, Math.min(n - 1, Math.round((x - origin) / TRAILS.cell)));
    const j = Math.max(0, Math.min(n - 1, Math.round((z - origin) / TRAILS.cell)));
    return j * n + i;
  };
  const start = cellOf(from.x, from.z);
  const goal = cellOf(to.x, to.z);
  const blocked = new Uint8Array(n * n);
  for (const o of avoid) {
    const reach = Math.ceil(o.radius / TRAILS.cell) + 1;
    const ci = Math.round((o.x - origin) / TRAILS.cell);
    const cj = Math.round((o.z - origin) / TRAILS.cell);
    for (let j = cj - reach; j <= cj + reach; j++) {
      for (let i = ci - reach; i <= ci + reach; i++) {
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        if (Math.hypot(origin + i * TRAILS.cell - o.x, origin + j * TRAILS.cell - o.z) < o.radius) blocked[j * n + i] = 1;
      }
    }
  }
  blocked[start] = 0;
  blocked[goal] = 0;
  const cost = new Float64Array(n * n).fill(Infinity);
  const came = new Int32Array(n * n).fill(-1);
  const done = new Uint8Array(n * n);
  const gi = goal % n;
  const gj = Math.floor(goal / n);
  const guess = (k: number): number => Math.hypot((k % n) - gi, Math.floor(k / n) - gj) * TRAILS.cell * 0.9;
  const heap = new Heap();
  cost[start] = 0;
  heap.push(start, guess(start));
  while (heap.size > 0) {
    const k = heap.pop();
    if (done[k] === 1) continue;
    done[k] = 1;
    if (k === goal) break;
    const i = k % n;
    const j = Math.floor(k / n);
    for (const [di, dj] of NEIGHBORS) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const m = nj * n + ni;
      if (done[m] === 1 || blocked[m] === 1) continue;
      const deep = g.depth[m] as number;
      if (deep > TRAILS.deep) continue;
      const run = Math.hypot(di, dj) * TRAILS.cell;
      const grade = Math.abs((g.height[m] as number) - (g.height[k] as number)) / run;
      if (grade > TRAILS.maxGrade * 1.6) continue;
      const steep = Math.max(0, grade - TRAILS.maxGrade * 0.35) / TRAILS.maxGrade;
      const side = (g.slope[m] as number) / 16;
      let step = run * (1 + 4 * steep * steep + side * side * 0.8 + winding * 1.4 * (g.wander[m] as number));
      if (deep > 0) step += TRAILS.wade * run / TRAILS.cell;
      if (g.worn[m] === 1) step *= TRAILS.join;
      const next = (cost[k] as number) + step;
      if (next < (cost[m] as number)) {
        cost[m] = next;
        came[m] = k;
        heap.push(m, next + guess(m));
      }
    }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const cells: [number, number][] = [];
  for (let k = goal; k !== -1; k = came[k] as number) {
    cells.push([origin + (k % n) * TRAILS.cell, origin + Math.floor(k / n) * TRAILS.cell]);
    if (k === start) break;
  }
  cells.reverse();
  cells[0] = [from.x, from.z];
  cells[cells.length - 1] = [to.x, to.z];
  return cells;
}

/** Chaikin corner cutting, then resampling every `spacing` meters: a trail curves instead of turning on a grid. */
function smoothLine(points: [number, number][], spacing: number): Float32Array {
  let line = points;
  for (let pass = 0; pass < 4; pass++) {
    const next: [number, number][] = [line[0] as [number, number]];
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, az] = line[k] as [number, number];
      const [bx, bz] = line[k + 1] as [number, number];
      next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    next.push(line[line.length - 1] as [number, number]);
    line = next;
  }
  const out: number[] = [];
  let carry = 0;
  out.push(line[0]![0], line[0]![1]);
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, az] = line[k] as [number, number];
    const [bx, bz] = line[k + 1] as [number, number];
    const len = Math.hypot(bx - ax, bz - az);
    let at = spacing - carry;
    while (at <= len) {
      out.push(ax + ((bx - ax) * at) / len, az + ((bz - az) * at) / len);
      at += spacing;
    }
    carry = len - (at - spacing);
  }
  const last = line[line.length - 1] as [number, number];
  if (Math.hypot(last[0] - (out[out.length - 2] as number), last[1] - (out[out.length - 1] as number)) > spacing * 0.3) out.push(last[0], last[1]);
  return new Float32Array(out);
}

const wetAt = (t: Terrain, x: number, z: number): boolean => heightAt(t.lattice, x, z, t.waterLevel) > DRY / 2;

function crossingsOf(t: Terrain, points: Float32Array): Crossing[] {
  const count = points.length / 2;
  const out: Crossing[] = [];
  let k = 0;
  while (k < count) {
    if (!wetAt(t, points[k * 2] as number, points[k * 2 + 1] as number)) {
      k++;
      continue;
    }
    const a = Math.max(0, k - 1);
    while (k < count && wetAt(t, points[k * 2] as number, points[k * 2 + 1] as number)) k++;
    const b = Math.min(count - 1, k);
    const ax = points[a * 2] as number;
    const az = points[a * 2 + 1] as number;
    const bx = points[b * 2] as number;
    const bz = points[b * 2 + 1] as number;
    const x = (ax + bx) / 2;
    const z = (az + bz) / 2;
    out.push({
      x,
      z,
      yaw: -Math.atan2(bz - az, bx - ax),
      span: Math.hypot(bx - ax, bz - az) + 1.6,
      level: heightAt(t.lattice, x, z, t.waterLevel),
      bank: Math.max(heightAt(t.lattice, ax, az), heightAt(t.lattice, bx, bz)),
    });
  }
  return out;
}

function regionIndex(t: Terrain, x: number, z: number): number {
  const l = t.lattice;
  const ix = Math.max(0, Math.min(l.n - 1, Math.round((x - l.origin) / l.spacing)));
  const iz = Math.max(0, Math.min(l.n - 1, Math.round((z - l.origin) / l.spacing)));
  return t.region[iz * l.n + ix] ?? 0;
}

/** Each region's walkable ground, square meters. */
function regionAreas(t: Terrain): number[] {
  const l = t.lattice;
  const half = t.spec.size / 2;
  const areas = t.spec.regions.map(() => 0);
  for (let iz = 0; iz < l.n; iz++) {
    if (Math.abs(worldOf(l, iz)) > half) continue;
    for (let ix = 0; ix < l.n; ix++) {
      if (Math.abs(worldOf(l, ix)) > half) continue;
      const r = t.region[iz * l.n + ix] ?? 0;
      areas[r] = (areas[r] ?? 0) + l.spacing * l.spacing;
    }
  }
  return areas;
}

/**
 * Routes the trails Jev wants, most wanted first, and keeps each only while
 * every region it crosses stays within the composition budget: at most
 * `TRAILS.routesPerRegion` trails, covering at most `TRAILS.share` of its
 * ground. Later trails prefer ground earlier ones wore, so they join.
 * `avoid` keeps trails out of footprints such as a house's walls.
 */
export function planTrails(t: Terrain, requests: readonly TrailRequest[], seed: number, avoid: readonly Occupied[] = []): Trail[] {
  const g = gridOf(t, seed);
  const areas = regionAreas(t);
  const routes = areas.map(() => 0);
  const covered = areas.map(() => 0);
  const out: Trail[] = [];
  const order = [...requests].sort((a, b) => b.want - a.want || a.id.localeCompare(b.id));
  for (const req of order) {
    const cells = search(g, req.from, req.to, req.style.winding, avoid);
    if (cells === null || cells.length < 2) continue;
    const points = smoothLine(cells, 1);
    const count = points.length / 2;
    const perRegion = new Map<number, number>();
    for (let k = 0; k < count; k++) {
      const r = regionIndex(t, points[k * 2] as number, points[k * 2 + 1] as number);
      perRegion.set(r, (perRegion.get(r) ?? 0) + req.style.width);
    }
    const fits = [...perRegion].every(([r, area]) => (routes[r] ?? 0) + 1 <= TRAILS.routesPerRegion && ((covered[r] ?? 0) + area) / Math.max(1, areas[r] ?? 0) <= TRAILS.share);
    if (!fits) continue;
    for (const [r, area] of perRegion) {
      routes[r] = (routes[r] ?? 0) + 1;
      covered[r] = (covered[r] ?? 0) + area;
    }
    for (const [x, z] of cells) {
      const i = Math.round((x - g.origin) / TRAILS.cell);
      const j = Math.round((z - g.origin) / TRAILS.cell);
      if (i >= 0 && j >= 0 && i < g.n && j < g.n) g.worn[j * g.n + i] = 1;
    }
    out.push({ id: req.id, from: req.from.id, to: req.to.id, style: req.style, points, length: count - 1, crossings: crossingsOf(t, points), regions: [...perRegion.keys()].sort((a, b) => a - b) });
  }
  return out;
}

// ---------- the ground under a trail ----------

/** Visits every lattice sample within `reach` of each segment, with its distance and the nearest point's index along the trail. */
function nearSegments(t: Terrain, trail: Trail, reach: number, visit: (index: number, distance: number, along: number) => void): void {
  const l = t.lattice;
  const pts = trail.points;
  const count = pts.length / 2;
  for (let k = 0; k + 1 < count; k++) {
    const ax = pts[k * 2] as number;
    const az = pts[k * 2 + 1] as number;
    const bx = pts[k * 2 + 2] as number;
    const bz = pts[k * 2 + 3] as number;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - l.origin) / l.spacing));
    const i1 = Math.min(l.n - 1, Math.ceil((Math.max(ax, bx) + reach - l.origin) / l.spacing));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - l.origin) / l.spacing));
    const j1 = Math.min(l.n - 1, Math.ceil((Math.max(az, bz) + reach - l.origin) / l.spacing));
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = Math.max(1e-9, dx * dx + dz * dz);
    for (let j = j0; j <= j1; j++) {
      const z = worldOf(l, j);
      for (let i = i0; i <= i1; i++) {
        const x = worldOf(l, i);
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
        const d = Math.hypot(x - ax - dx * u, z - az - dz * u);
        if (d <= reach) visit(j * l.n + i, d, k + u);
      }
    }
  }
}

/**
 * Eases the baked ground under each trail toward the tread's own smoothed
 * grade, blending back to the land over `TRAILS.blend` meters, as a cottage's
 * pad does. A trail on a hillside benches gently into it; bumps along the
 * tread soften. Water and the banks next to it are never touched, and no
 * sample moves more than `TRAILS.maxCut`.
 */
export function levelTrails(t: Terrain, trails: readonly Trail[]): void {
  const l = t.lattice;
  for (const trail of trails) {
    const pts = trail.points;
    const count = pts.length / 2;
    const ground = new Float32Array(count);
    for (let k = 0; k < count; k++) ground[k] = heightAt(l, pts[k * 2] as number, pts[k * 2 + 1] as number);
    const grade = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      let sum = 0;
      let n = 0;
      for (let m = Math.max(0, k - TRAILS.grade); m <= Math.min(count - 1, k + TRAILS.grade); m++) {
        sum += ground[m] as number;
        n++;
      }
      grade[k] = sum / n;
    }
    const half = trail.style.width / 2;
    const best = new Float32Array(l.n * l.n).fill(Infinity);
    const target = new Float32Array(l.n * l.n);
    nearSegments(t, trail, half + TRAILS.blend, (index, d, along) => {
      if (d >= (best[index] as number)) return;
      best[index] = d;
      const k = Math.min(count - 1, Math.floor(along));
      const f = along - k;
      target[index] = (grade[k] as number) * (1 - f) + (grade[Math.min(count - 1, k + 1)] as number) * f;
    });
    for (let i = 0; i < best.length; i++) {
      const d = best[i] as number;
      if (d === Infinity || (t.waterLevel[i] as number) > DRY / 2) continue;
      const u = Math.max(0, Math.min(1, (d - half - 0.3) / TRAILS.blend));
      const shore = Math.max(0, Math.min(1, ((t.shore[i] as number) - 1.5) / 2.5));
      const w = (1 - u * u * (3 - 2 * u)) * shore * shore * (3 - 2 * shore);
      if (w <= 0) continue;
      const h = l.heights[i] as number;
      const delta = Math.max(-TRAILS.maxCut, Math.min(TRAILS.maxCut, (target[i] as number) - h));
      l.heights[i] = h + delta * w;
    }
  }
}

/**
 * Signed distance from each lattice sample to the nearest trail's edge,
 * meters: negative on the tread, capped at `TRAILS.reach`. The ground paints
 * worn earth from it and the grass parts along it; water reads as far.
 */
export function trailField(t: Terrain, trails: readonly Trail[]): Float32Array {
  const l = t.lattice;
  const field = new Float32Array(l.n * l.n).fill(TRAILS.reach);
  for (const trail of trails) {
    const half = trail.style.width / 2;
    nearSegments(t, trail, half + TRAILS.reach, (index, d) => {
      if ((t.waterLevel[index] as number) > DRY / 2) return;
      const edge = d - half;
      if (edge < (field[index] as number)) field[index] = edge;
    });
  }
  return field;
}

/** A trail's place packed in one number: its index, plus how far along it (0 to 1) in the fraction. */
const packPlace = (index: number, along: number): number => index + 0.999 * Math.max(0, Math.min(1, along));

/** Unpacks `trailPlaces`' numbers: the trail's index and how far along it, from its first end (0) to its second (1); null for none. */
export function unpackPlace(packed: number): { trail: number; along: number } | null {
  if (packed < 0) return null;
  const trail = Math.floor(packed);
  return { trail, along: (packed - trail) / 0.999 };
}

/**
 * Which trails each lattice sample lies on, two numbers per sample: the
 * nearest trail within `TRAILS.reach` of its edge and, where another trail's
 * edge is within `TRAILS.meet` meters of that one's (where trails meet or
 * share a tread), that one too; -1 for none. Each packs the trail's index in
 * `trails` and how far along it the sample lies, 0 at its first end and 1 at
 * its second (see `unpackPlace`), so a shader can read the vitality of the
 * two entities a trail joins live and blend it along the trail.
 */
export function trailPlaces(t: Terrain, trails: readonly Trail[]): Float32Array {
  const l = t.lattice;
  const n = l.n * l.n;
  const d1 = new Float32Array(n).fill(Infinity);
  const d2 = new Float32Array(n).fill(Infinity);
  const p1 = new Float32Array(n).fill(-1);
  const p2 = new Float32Array(n).fill(-1);
  const mine = new Float32Array(n).fill(Infinity);
  const along = new Float32Array(n);
  trails.forEach((trail, index) => {
    const half = trail.style.width / 2;
    const last = Math.max(1, trail.points.length / 2 - 1);
    const touched: number[] = [];
    nearSegments(t, trail, half + TRAILS.reach, (i, d, k) => {
      if ((t.waterLevel[i] as number) > DRY / 2) return;
      if ((mine[i] as number) === Infinity) touched.push(i);
      if (d - half < (mine[i] as number)) {
        mine[i] = d - half;
        along[i] = k / last;
      }
    });
    for (const i of touched) {
      const d = mine[i] as number;
      const p = packPlace(index, along[i] as number);
      if (d < (d1[i] as number)) {
        d2[i] = d1[i] as number;
        p2[i] = p1[i] as number;
        d1[i] = d;
        p1[i] = p;
      } else if (d < (d2[i] as number)) {
        d2[i] = d;
        p2[i] = p;
      }
      mine[i] = Infinity;
    }
  });
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = p1[i] as number;
    out[i * 2 + 1] = (d2[i] as number) <= (d1[i] as number) + TRAILS.meet ? (p2[i] as number) : -1;
  }
  return out;
}

const smooth = (a: number, b: number, x: number): number => {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/**
 * The vitality a trail shows at a point `along` it (0 at its first end, 1 at
 * its second): each end's entity's vitality holds near its end and blends
 * across the middle.
 */
export const trailVitalityAt = (fromVitality: number, toVitality: number, along: number): number =>
  fromVitality + (toVitality - fromVitality) * smooth(0.15, 0.85, along);

/**
 * How worn a trail's tread is at a point `along` it, from its blueprint's
 * `wear` and the vitality of the entities at its ends: a thriving pair's
 * trail is worn bare, a failing one's grows over until only a faint trace is
 * left, so its route still reads. The ground and grass shaders apply the same numbers live
 * (`TRAIL_GLSL` in the terrain lab), so a vitality change never rebakes.
 */
export const trailWearAt = (wear: number, fromVitality: number, toVitality: number, along: number): number =>
  wear * (0.2 + 0.8 * smooth(0.05, 0.75, trailVitalityAt(fromVitality, toVitality, along)));

/** Discs along each trail's tread, so trees and the understory keep off it. */
export function trailDiscs(trails: readonly Trail[], margin: number): Occupied[] {
  const out: Occupied[] = [];
  for (const trail of trails) {
    const pts = trail.points;
    for (let k = 0; k < pts.length / 2; k += 2) out.push({ x: pts[k * 2] as number, z: pts[k * 2 + 1] as number, radius: trail.style.width / 2 + margin });
  }
  return out;
}

/** Small stones set along both edges of a trail's tread, grounded; none in or beside water. */
export interface EdgeStone {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly size: number;
}

export function edgeStones(t: Terrain, trail: Trail, seed: number): EdgeStone[] {
  if (trail.style.edging !== "stones") return [];
  const pts = trail.points;
  const count = pts.length / 2;
  const out: EdgeStone[] = [];
  const half = trail.style.width / 2 + 0.12;
  let h = (seed ^ 0x9e3779b9) >>> 0;
  const next = (): number => {
    h = (Math.imul(h ^ (h >>> 15), 2246822519) + 0x6d2b79f5) >>> 0;
    return h / 4294967296;
  };
  for (let k = 1; k + 1 < count; k++) {
    for (const side of [-1, 1]) {
      // Stones are set at uneven gaps and now and then left out, as by hand.
      if (next() < 0.42) continue;
      const ax = pts[(k - 1) * 2] as number;
      const az = pts[(k - 1) * 2 + 1] as number;
      const bx = pts[(k + 1) * 2] as number;
      const bz = pts[(k + 1) * 2 + 1] as number;
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      const off = half + (next() - 0.5) * 0.18;
      const x = (pts[k * 2] as number) + nx * off * side + ((bx - ax) / len) * (next() - 0.5) * 0.6;
      const z = (pts[k * 2 + 1] as number) + nz * off * side + ((bz - az) / len) * (next() - 0.5) * 0.6;
      if (heightAt(t.lattice, x, z, t.waterLevel) > DRY / 2 || heightAt(t.lattice, x, z, t.shore) < 1.2) continue;
      out.push({ x, y: heightAt(t.lattice, x, z), z, yaw: Math.atan2(bz - az, bx - ax) + (next() - 0.5) * 0.8, size: 0.16 + next() * 0.14 });
    }
  }
  return out;
}
