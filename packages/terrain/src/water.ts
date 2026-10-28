// Solves water from the ground and carves it in, following v2's linear carve
// (src/world/compile/linear/carve.ts). A stream's waterline is a running
// minimum of the ground along its bed, so it only descends and stays below the
// land it runs through. A pond fills to just under the lowest point of its rim.

import { type Lattice, heightAt, worldOf, worldOfZ } from "./lattice.ts";

/** Meters the waterline sits below the ground along the bed, before carving. */
const INSET = 0.2;
/** Banks rise at least this far above the waterline next to the channel. */
const BANK_LIP = 0.3;
/** How far the banks reach beyond the water's edge, meters. */
export const BANK = 3.5;
/** Banks never climb steeper than this grade (about 28 degrees), however deep the cut. */
const BANK_GRADE = 0.53;
/** The farthest a bank cut can reach past the water's edge, meters. */
export const BANK_REACH = 14;
/** Channel depth never exceeds this share of the half width, so its walls stay walkable. */
const CHANNEL_SHAPE = 0.35;
/**
 * Meters past the waterline that the bank continues the channel wall's
 * straight slope. It is the diagonal of the world's 1 m lattice, the farthest
 * apart two samples on either side of the waterline can be along a triangle's
 * edge. The ground is drawn and walked as flat triangles between samples, so
 * the visible waterline is where each triangle crosses the water level. When
 * the ground is straight through the waterline, that crossing lands on the
 * channel's own edge and the waterline follows the stream's curve. A bank
 * that bends within one sample of the water moves the crossing in every
 * triangle, and the waterline steps along the lattice.
 */
const WALL = Math.SQRT2;
/** The deepest a routed river's water lies below its valley's floor, meters. */
const BELOW_FLOOR = 0.5;
/**
 * The shapes where a stream begins and ends, in meters. The spring pool has radius `radius`, its edge varies by
 * `wander` of that radius, and it is at most `depth` deep under walls that rise `wall` per meter. The stream leaves the
 * pool with half width `outlet` and reaches full width `run` meters on. A stream that seeps away narrows to `outlet`
 * over its last `run` meters and ends in a wet patch of radius `patch`, `patchDepth` deep.
 */
export const HEAD = { radius: 1.9, wander: 0.22, depth: 0.22, wall: 0.18, outlet: 0.6, run: 8, patch: 2.3, patchDepth: 0.08 } as const;
/** Minimum stream half width in meters, except where it narrows at a spring or seep. It is the narrowest the lattice draws without gaps. */
const NARROWEST = 1.1;
/** A pond fills to this far below the lowest point of its rim. */
const POND_FREEBOARD = 0.3;
/** The radius of a pond's rim ring, in pond radii. The pond fills to just under the lowest ground on that ring. */
export const POND_REACH = 1.3;

export interface Station {
  readonly x: number;
  readonly z: number;
  readonly level: number;
  readonly halfWidth: number;
  readonly depth: number;
}

/**
 * A station's cross-section for flow speed. Half width and depth are clamped to their `NARROWEST` values, so water does
 * not speed up where the stream narrows at a spring or seep.
 */
export const flowSection = (s: Station): number => Math.max(s.halfWidth, NARROWEST) * Math.max(s.depth, NARROWEST * CHANNEL_SHAPE);

/** Half width of the drawn water surface, the channel plus half a bank. It stays inside the banks' containment, so its edge is always under ground. */
export const surfaceHalfWidth = (s: Station): number => s.halfWidth + BANK * 0.5;

export interface SolvedStream {
  readonly stations: readonly Station[];
  /** Whether it seeps away at its last station, instead of running into other water or off the land. */
  readonly seep?: boolean;
}

/** A spring's pool or a seep's wet patch, with its center, edge, depth and water level. */
export interface Head {
  readonly x: number;
  readonly z: number;
  readonly level: number;
  readonly depth: number;
  /** Distance in meters from the center to the edge toward `angle`, in radians from +x toward +z. */
  readonly edge: (angle: number) => number;
  /** The largest distance from the center to the edge. */
  readonly reach: number;
}

/** Three phases for a head's edge shape, hashed from its position, so the same place always gives the same shape. */
function phases(x: number, z: number): readonly [number, number, number] {
  let h = (Math.imul(Math.round(x * 10) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(z * 10) | 0, 0x165667b1)) >>> 0;
  const next = (): number => {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  };
  return [next() * Math.PI * 2, next() * Math.PI * 2, next() * Math.PI * 2];
}

/** A stream's spring pool, and its wet patch if it seeps away (`HEAD`). */
export function headsOf(stream: SolvedStream): readonly Head[] {
  const st = stream.stations;
  const n = st.length;
  if (n < 2) return [];
  const head = (at: Station, toward: Station, radius: number, depth: number, back: number): Head => {
    const dx = toward.x - at.x;
    const dz = toward.z - at.z;
    const len = Math.hypot(dx, dz) || 1;
    // Offset the pool upstream of the first station, so the stream leaves from its downstream side.
    const x = at.x - (dx / len) * radius * back;
    const z = at.z - (dz / len) * radius * back;
    const [a, b, c] = phases(x, z);
    const edge = (angle: number): number => radius * (1 + HEAD.wander * (0.55 * Math.sin(2 * angle + a) + 0.3 * Math.sin(3 * angle + b) + 0.15 * Math.sin(5 * angle + c)));
    return { x, z, level: at.level, depth, edge, reach: radius * (1 + HEAD.wander) };
  };
  const heads = [head(st[0] as Station, st[Math.min(3, n - 1)] as Station, HEAD.radius, HEAD.depth, 0.6)];
  if (stream.seep === true) heads.push(head(st[n - 1] as Station, st[Math.max(0, n - 4)] as Station, HEAD.patch, HEAD.patchDepth, 0.3));
  return heads;
}

export interface SolvedPond {
  readonly x: number;
  readonly z: number;
  /** Radius of the cut bed. */
  readonly radius: number;
  /** Radius of the water surface disc. The ground on this ring is above the level. */
  readonly reach: number;
  readonly level: number;
}

const smooth = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** Optional data for `solveStream`, per point of the course where it applies, source first. */
export interface StreamCourse {
  readonly widths?: Float32Array;
  /** The valley floor height under each point, which only descends. The waterline never dips more than `BELOW_FLOOR` under it. */
  readonly floors?: Float32Array;
  /** False when it ends in another stream, a pond or past the land. It then keeps its width to its end. */
  readonly seep?: boolean;
  /**
   * The water level already on the lattice, per sample. Where this stream runs into an earlier one, it meets that
   * water at its surface, not under it in that stream's channel.
   */
  readonly water?: Float32Array;
}

/**
 * Solves a stream's waterline over `path`, a list of world x, z pairs. With `widths`, the course runs from the first
 * point as given. Without them it runs from whichever end is higher.
 */
export function solveStream(l: Lattice, path: Float32Array, width: number, depth: number, course: StreamCourse = {}): SolvedStream | null {
  const count = path.length / 2;
  if (count < 4) return null;
  // Start from whichever end is higher, unless `widths` fixes the direction.
  const first = heightAt(l, path[0] as number, path[1] as number);
  const last = heightAt(l, path[path.length - 2] as number, path[path.length - 1] as number);
  const order = course.widths !== undefined || first >= last ? [...Array(count).keys()] : [...Array(count).keys()].reverse();
  const along: number[] = [0];
  for (let k = 1; k < count; k++) {
    const a = order[k - 1] as number;
    const b = order[k] as number;
    along.push((along[k - 1] as number) + Math.hypot((path[b * 2] as number) - (path[a * 2] as number), (path[b * 2 + 1] as number) - (path[a * 2 + 1] as number)));
  }
  const total = along[count - 1] as number;
  const stations: Station[] = [];
  let level = Infinity;
  // The ground height, or another stream's surface plus `INSET` where that stream's water is above the ground.
  const oz = l.originZ ?? l.origin;
  const groundAt = (x: number, z: number): number => {
    const g = heightAt(l, x, z);
    const water = course.water;
    if (water === undefined) return g;
    const i = Math.min(l.n - 1, Math.max(0, Math.round((z - oz) / l.spacing))) * l.n + Math.min(l.n - 1, Math.max(0, Math.round((x - l.origin) / l.spacing)));
    const surface = water[i] as number;
    return surface > g ? surface + INSET : g;
  };
  order.forEach((idx, k) => {
    const x = path[idx * 2] as number;
    const z = path[idx * 2 + 1] as number;
    const s = along[k] as number;
    // The stream leaves its pool at half width `HEAD.outlet` and widens over `HEAD.run`. Where it seeps away it
    // narrows the same way into its wet patch. Elsewhere it is never narrower than `NARROWEST`.
    const full = Math.max(NARROWEST, (course.widths?.[idx] ?? width) / 2);
    const share = Math.min(1, HEAD.outlet / full);
    const opens = (from: number): number => share + (1 - share) * smooth(from / HEAD.run);
    const halfWidth = full * opens(s) * (course.seep === false ? 1 : opens(total - s));
    level = Math.min(level, groundAt(x, z) - INSET);
    // A routed river can cross ground that falls away to one side. Its level also stays below the ground at both
    // surface edges, so it cuts into the higher bank instead of standing above the lower one.
    if (course.widths !== undefined) {
      const a = Math.max(0, idx - 1);
      const b = Math.min(count - 1, idx + 1);
      const tx = (path[b * 2] as number) - (path[a * 2] as number);
      const tz = (path[b * 2 + 1] as number) - (path[a * 2 + 1] as number);
      const len = Math.hypot(tx, tz) || 1;
      const out = halfWidth + BANK * 0.5;
      level = Math.min(level, groundAt(x - (tz / len) * out, z + (tx / len) * out) - INSET, groundAt(x + (tz / len) * out, z - (tx / len) * out) - INSET);
    }
    // A dip along the bed never pulls the level more than `BELOW_FLOOR` below the valley floor, so the stream cuts no gorge after it.
    const floor = course.floors?.[idx];
    if (floor !== undefined) level = Math.max(level, floor - BELOW_FLOOR);
    stations.push({ x, z, level, halfWidth, depth: Math.min(depth, halfWidth * CHANNEL_SHAPE) });
  });
  return { stations, ...(course.seep === false ? {} : { seep: true }) };
}

interface Nearest {
  distance: number;
  level: number;
  halfWidth: number;
  depth: number;
}

/** The nearest point to (x, z) on the segments from station `i` to `i + 1` for each `i` in `segments`, ascending, with the stream's level, half width and depth there. */
function nearest(stations: readonly Station[], segments: readonly number[], x: number, z: number): Nearest {
  let best: Nearest = { distance: Infinity, level: 0, halfWidth: 0, depth: 0 };
  for (const i of segments) {
    const a = stations[i] as Station;
    const b = stations[i + 1] as Station;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len = abx * abx + abz * abz;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len)) : 0;
    const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t));
    if (d < best.distance) {
      best = {
        distance: d,
        level: a.level + (b.level - a.level) * t,
        halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * t,
        depth: a.depth + (b.depth - a.depth) * t,
      };
    }
  }
  return best;
}

/**
 * Indexes the stream's segments by square cells `reach` wide. Each cell lists,
 * in order, every segment within `reach` of any point in it. Only points that
 * near a segment are carved, and a carved point's nearest segment is always in
 * its cell's list. So searching that list finds the same segment as searching
 * every segment.
 */
function segmentCells(stations: readonly Station[], reach: number): { readonly at: (x: number, z: number) => readonly number[] | undefined } {
  const cells = new Map<number, number[]>();
  const key = (cx: number, cz: number): number => (cz + 0x8000) * 0x10000 + (cx + 0x8000);
  for (let i = 0; i + 1 < stations.length; i++) {
    const a = stations[i] as Station;
    const b = stations[i + 1] as Station;
    for (let cz = Math.floor((Math.min(a.z, b.z) - reach) / reach); cz <= Math.floor((Math.max(a.z, b.z) + reach) / reach); cz++) {
      for (let cx = Math.floor((Math.min(a.x, b.x) - reach) / reach); cx <= Math.floor((Math.max(a.x, b.x) + reach) / reach); cx++) {
        const k = key(cx, cz);
        const list = cells.get(k);
        if (list === undefined) cells.set(k, [i]);
        else list.push(i);
      }
    }
  }
  return { at: (x, z) => cells.get(key(Math.floor(x / reach), Math.floor(z / reach))) };
}

/** Cuts the channel and its banks into `heights`, and records the water level where the banks contain it. */
export function carveStream(l: Lattice, heights: Float32Array, level: Float32Array, stream: SolvedStream): void {
  let widest = 0;
  for (const s of stream.stations) widest = Math.max(widest, s.halfWidth);
  const reach = widest + BANK_REACH;
  const cells = segmentCells(stream.stations, reach);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of stream.stations) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
  }
  const toIndex = (w: number): number => (w - l.origin) / l.spacing;
  const toIndexZ = (w: number): number => (w - (l.originZ ?? l.origin)) / l.spacing;
  const x0 = Math.max(0, Math.floor(toIndex(minX - reach)));
  const x1 = Math.min(l.n - 1, Math.ceil(toIndex(maxX + reach)));
  const z0 = Math.max(0, Math.floor(toIndexZ(minZ - reach)));
  const z1 = Math.min(l.n - 1, Math.ceil(toIndexZ(maxZ + reach)));
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      const i = iz * l.n + ix;
      const segments = cells.at(worldOf(l, ix), worldOfZ(l, iz));
      if (segments === undefined) continue;
      const s = nearest(stream.stations, segments, worldOf(l, ix), worldOfZ(l, iz));
      const h = heights[i] as number;
      // The channel's walls slope straight from the middle of its bed up through the waterline (`WALL`).
      const wall = s.halfWidth > 0 ? s.depth / s.halfWidth : CHANNEL_SHAPE;
      if (s.distance < s.halfWidth) {
        heights[i] = Math.min(h, s.level - wall * (s.halfWidth - s.distance));
        level[i] = Math.max(level[i] as number, s.level);
      } else if (s.distance < s.halfWidth + BANK_REACH) {
        const out = s.distance - s.halfWidth;
        const raw = out / BANK;
        const t = smooth(raw);
        // The bank climbs from the waterline at no more than BANK_GRADE, then meets natural ground.
        const cap = s.level + BANK_LIP * t + BANK_GRADE * out;
        const eased = Math.min(h, cap);
        // Next to the water the bank rises above the waterline, fading back to
        // natural ground over the outer bank. The levee starts from the lip's
        // height, so the ground stays continuous there.
        const lip = Math.min(h, s.level);
        const levee = lip + (s.level + BANK_LIP * Math.max(t, 0.35) - lip) * smooth(raw / 0.12);
        const contain = 1 - smooth((raw - 0.55) / 0.4);
        const leveed = Math.max(eased, levee);
        // The wall's slope continues up the bank for `WALL` meters. Past that, the bank climbs or falls to its own
        // height at no more than `BANK_GRADE`.
        const top = s.level + wall * Math.min(out, WALL);
        const past = BANK_GRADE * Math.max(0, out - WALL);
        const walled = Math.min(top + past, Math.max(top - past, eased + (leveed - eased) * contain));
        // Where it meets another stream's water, the bank does not rise into that water.
        heights[i] = (level[i] as number) > h ? eased : walled;
        if (raw <= 0.55) level[i] = Math.max(level[i] as number, s.level);
      }
    }
  }
  for (const head of headsOf(stream)) carveHead(l, heights, level, head);
}

/** Cuts a spring's pool or a seep's wet patch as a bowl under its level, with walls that continue past its edge until they meet the ground. */
function carveHead(l: Lattice, heights: Float32Array, level: Float32Array, head: Head): void {
  const reach = head.reach + head.depth / HEAD.wall + 1;
  const toIndex = (w: number): number => (w - l.origin) / l.spacing;
  const toIndexZ = (w: number): number => (w - (l.originZ ?? l.origin)) / l.spacing;
  const x0 = Math.max(0, Math.floor(toIndex(head.x - reach)));
  const x1 = Math.min(l.n - 1, Math.ceil(toIndex(head.x + reach)));
  const z0 = Math.max(0, Math.floor(toIndexZ(head.z - reach)));
  const z1 = Math.min(l.n - 1, Math.ceil(toIndexZ(head.z + reach)));
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      const dx = worldOf(l, ix) - head.x;
      const dz = worldOfZ(l, iz) - head.z;
      const r = Math.hypot(dx, dz);
      if (r > reach) continue;
      const i = iz * l.n + ix;
      // Signed distance inward from the edge. The walls slope straight through the waterline, as a stream's do.
      const inward = head.edge(Math.atan2(dz, dx)) - r;
      heights[i] = Math.min(heights[i] as number, head.level - Math.min(head.depth, HEAD.wall * inward));
      if (inward > -1) level[i] = Math.max(level[i] as number, head.level);
    }
  }
}

/**
 * Finds the level that fills a pond to `POND_FREEBOARD` under the lowest ground on its rim ring, or null when the hollow
 * cannot hold water. Rim samples where `level`, the water already laid, is above the ground lie in an inflowing stream,
 * so they are skipped instead of counting as a gap in the rim. `carvePond` cuts the bed.
 */
export function solvePond(l: Lattice, heights: Float32Array, x: number, z: number, radius: number, level?: Float32Array): SolvedPond | null {
  const reach = radius * POND_REACH;
  let rim = Infinity;
  const steps = Math.ceil((Math.PI * 2 * reach) / (l.spacing * 0.5));
  const oz = l.originZ ?? l.origin;
  for (let k = 0; k < steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    const px = x + Math.cos(a) * reach;
    const pz = z + Math.sin(a) * reach;
    // A rim sample next to any wet lattice point lies in an inflow's channel.
    if (level !== undefined) {
      const ix = Math.floor((px - l.origin) / l.spacing);
      const iz = Math.floor((pz - oz) / l.spacing);
      let wet = false;
      for (let dz = 0; dz <= 1 && !wet; dz++) {
        for (let dx = 0; dx <= 1 && !wet; dx++) {
          const i = Math.min(l.n - 1, Math.max(0, iz + dz)) * l.n + Math.min(l.n - 1, Math.max(0, ix + dx));
          wet = (level[i] as number) > (heights[i] as number);
        }
      }
      if (wet) continue;
    }
    rim = Math.min(rim, heightAt(l, px, pz, heights));
  }
  const surface = rim - POND_FREEBOARD;
  if (!Number.isFinite(surface) || heightAt(l, x, z, heights) > surface - 0.2) return null;
  return { x, z, radius, reach, level: surface };
}

export function carvePond(l: Lattice, heights: Float32Array, level: Float32Array, pond: SolvedPond, depth: number): void {
  const toIndex = (w: number): number => (w - l.origin) / l.spacing;
  const toIndexZ = (w: number): number => (w - (l.originZ ?? l.origin)) / l.spacing;
  const x0 = Math.max(0, Math.floor(toIndex(pond.x - pond.reach)));
  const x1 = Math.min(l.n - 1, Math.ceil(toIndex(pond.x + pond.reach)));
  const z0 = Math.max(0, Math.floor(toIndexZ(pond.z - pond.reach)));
  const z1 = Math.min(l.n - 1, Math.ceil(toIndexZ(pond.z + pond.reach)));
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      const r = Math.hypot(worldOf(l, ix) - pond.x, worldOfZ(l, iz) - pond.z);
      if (r > pond.reach) continue;
      const i = iz * l.n + ix;
      const h = heights[i] as number;
      if (r < pond.radius) {
        const bed = pond.level - depth * (1 - (r / pond.radius) ** 2);
        // The cut fades out toward the bed's edge, so the ground stays continuous.
        const weight = 1 - smooth((r - pond.radius * 0.6) / (pond.radius * 0.4));
        heights[i] = h + (Math.min(h, bed) - h) * weight;
      }
      level[i] = Math.max(level[i] as number, pond.level);
    }
  }
}

/** The shore field stops counting this far from the water, meters. */
export const SHORE_CAP = 12;
/** The coarsest lattice spacing in meters at which `shoreField` places the water's edge between samples. Coarser lattices are far levels, where interpolating across a whole step would misplace the edge. */
const EDGE_BETWEEN_AT_MOST = 2;

/** Depth in meters that gives water full banks. Where water this deep is within a meter, sand and the grass edge start at the water's edge. */
export const BANKED = 0.4;
/** Shore distance in meters given to the shallowest water, falling to 0 at `BANKED` depth. It lies past the grass edge, so grass meets a thin trickle. */
const SHALLOW_BANK = 3;

/**
 * 1 where a lattice sample's nearest water is a pond's, else 0. `shore` is `shoreField` over the same samples. The ground
 * keeps a full ring of sand around a pond, where a stream's sand narrows. It measures from the pond's own water as
 * `shoreField` does, so a tile and the whole bake agree.
 */
export function nearPond(l: Lattice, heights: Float32Array, level: Float32Array, ponds: readonly SolvedPond[], shore: Float32Array): Uint8Array {
  const { n } = l;
  const pondLevel = new Float32Array(n * n).fill(-1000);
  for (const pond of ponds) {
    const toIndex = (w: number): number => (w - l.origin) / l.spacing;
    const toIndexZ = (w: number): number => (w - (l.originZ ?? l.origin)) / l.spacing;
    for (let iz = Math.max(0, Math.floor(toIndexZ(pond.z - pond.reach))); iz <= Math.min(n - 1, Math.ceil(toIndexZ(pond.z + pond.reach))); iz++) {
      for (let ix = Math.max(0, Math.floor(toIndex(pond.x - pond.reach))); ix <= Math.min(n - 1, Math.ceil(toIndex(pond.x + pond.reach))); ix++) {
        const i = iz * n + ix;
        // `level` holds 32-bit floats, so a pond's own samples equal `Math.fround(pond.level)`.
        if (Math.hypot(worldOf(l, ix) - pond.x, worldOfZ(l, iz) - pond.z) <= pond.reach && (level[i] as number) === Math.fround(pond.level)) pondLevel[i] = pond.level;
      }
    }
  }
  const fromPonds = shoreField(l, heights, pondLevel);
  return Uint8Array.from(fromPonds, (d, i) => (d < SHORE_CAP && d <= (shore[i] as number) + 0.5 ? 1 : 0));
}

/** Samples past a tile's edge that its shore reads: `SHORE_CAP` worth, plus one for the wet neighbor a dry sample starts from and one for that neighbor's neighbors. */
export const shoreMargin = (spacing: number): number => Math.ceil(SHORE_CAP / spacing) + 2;

/**
 * Distance in meters from each lattice sample to the water's edge, capped at
 * `SHORE_CAP`. It is 0 in water deep enough for full banks (`BANKED`) and
 * grows about a meter per meter away. Shallow water, such as a stream
 * narrowing at its spring or seep, starts up to `SHALLOW_BANK` meters out, so
 * the banks narrow with it instead of ringing it with sand. Sand banks and the
 * grass edge both read this field, so they agree.
 */
export function shoreField(l: Lattice, heights: Float32Array, level: Float32Array): Float32Array {
  const { n, spacing } = l;
  const d = new Float32Array(n * n);
  const wet = (i: number): boolean => (level[i] as number) > (heights[i] as number);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      if (!wet(i)) {
        d[i] = SHORE_CAP;
        continue;
      }
      // The deepest water within a meter. Every waterline is shallow, but water a meter in is deep unless the stream
      // itself is thin. A coarser level reads only its own sample, so it never finds deeper water than the full
      // lattice does, and its shore never lies nearer the water than the lattice's.
      let deepest = 0;
      const r = Math.floor(1 / spacing);
      for (let jz = Math.max(0, iz - r); jz <= Math.min(n - 1, iz + r); jz++) {
        for (let jx = Math.max(0, ix - r); jx <= Math.min(n - 1, ix + r); jx++) deepest = Math.max(deepest, (level[jz * n + jx] as number) - (heights[jz * n + jx] as number));
      }
      d[i] = SHALLOW_BANK * Math.max(0, 1 - deepest / BANKED);
    }
  }
  const diag = Math.SQRT2 * spacing;
  // A dry sample beside water starts at its distance to where the neighbor's water level meets the ground between
  // them, not a whole step. The edge then follows the water instead of the lattice's staircase.
  for (let iz = 0; spacing <= EDGE_BETWEEN_AT_MOST && iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      if (wet(i)) continue;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const jx = ix + dx;
          const jz = iz + dz;
          if ((dx === 0 && dz === 0) || jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
          const j = jz * n + jx;
          if (!wet(j)) continue;
          const under = (level[j] as number) - (heights[j] as number);
          const above = (heights[i] as number) - (level[j] as number);
          const step = dx !== 0 && dz !== 0 ? diag : spacing;
          // At least 0.01, so only wet samples are 0.
          d[i] = Math.min(d[i] as number, (d[j] as number) + Math.max(0.01, (step * Math.max(0, above)) / (under + Math.max(0, above))));
        }
      }
    }
  }
  // Two chamfer passes. A straight step costs one spacing and a diagonal step √2 spacings.
  const relax = (i: number, j: number, cost: number): void => {
    const v = (d[j] as number) + cost;
    if (v < (d[i] as number)) d[i] = v;
  };
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      if (ix > 0) relax(i, i - 1, spacing);
      if (iz > 0) {
        relax(i, i - n, spacing);
        if (ix > 0) relax(i, i - n - 1, diag);
        if (ix < n - 1) relax(i, i - n + 1, diag);
      }
    }
  }
  for (let iz = n - 1; iz >= 0; iz--) {
    for (let ix = n - 1; ix >= 0; ix--) {
      const i = iz * n + ix;
      if (ix < n - 1) relax(i, i + 1, spacing);
      if (iz < n - 1) {
        relax(i, i + n, spacing);
        if (ix < n - 1) relax(i, i + n + 1, diag);
        if (ix > 0) relax(i, i + n - 1, diag);
      }
    }
  }
  return d;
}
