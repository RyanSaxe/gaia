// Water is solved from the ground, never placed on it. A stream's waterline
// is a running minimum of the ground along its bed, so it only descends and
// always sits below the land it runs through; the channel is then cut below
// that line. A pond fills to just under the lowest point of its rim. The
// carve math follows v2's linear carve (src/world/compile/linear/carve.ts).

import { type Lattice, heightAt, worldOf } from "./lattice.ts";

/** The waterline sits this far below the ground along the bed before carving. */
const INSET = 0.2;
/** Banks rise at least this far above the waterline next to the channel. */
const BANK_LIP = 0.3;
/** How far the banks reach beyond the water's edge, meters. */
export const BANK = 3.5;
/** Banks never climb steeper than this grade (about 28 degrees), however deep the cut. */
const BANK_GRADE = 0.53;
/** The farthest a bank cut can reach past the water's edge, meters. */
const BANK_REACH = 14;
/** Channel depth never exceeds this share of the half width, so its walls stay walkable. */
const CHANNEL_SHAPE = 0.35;
/** Spring and seep: the stream narrows to nothing over this many meters at each end. */
const TAPER = 18;
/** A pond fills to this far below the lowest point of its rim. */
const POND_FREEBOARD = 0.3;

export interface Station {
  readonly x: number;
  readonly z: number;
  readonly level: number;
  readonly halfWidth: number;
  readonly depth: number;
}

/** How far the water surface reaches past the channel: inside the banks' containment, so its edge is always under ground. */
export const surfaceHalfWidth = (s: Station): number => s.halfWidth + BANK * 0.5;

export interface SolvedStream {
  readonly stations: readonly Station[];
}

export interface SolvedPond {
  readonly x: number;
  readonly z: number;
  /** Radius of the cut bed. */
  readonly radius: number;
  /** Radius of the water surface disc; the rim at this radius stands above the level. */
  readonly reach: number;
  readonly level: number;
}

const smooth = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** Solves a stream's waterline over `path` (world x, z pairs, source first). */
export function solveStream(l: Lattice, path: Float32Array, width: number, depth: number): SolvedStream | null {
  const count = path.length / 2;
  if (count < 4) return null;
  // Water runs downhill: start from whichever end is higher.
  const first = heightAt(l, path[0] as number, path[1] as number);
  const last = heightAt(l, path[path.length - 2] as number, path[path.length - 1] as number);
  const order = first >= last ? [...Array(count).keys()] : [...Array(count).keys()].reverse();
  const along: number[] = [0];
  for (let k = 1; k < count; k++) {
    const a = order[k - 1] as number;
    const b = order[k] as number;
    along.push((along[k - 1] as number) + Math.hypot((path[b * 2] as number) - (path[a * 2] as number), (path[b * 2 + 1] as number) - (path[a * 2 + 1] as number)));
  }
  const total = along[count - 1] as number;
  const stations: Station[] = [];
  let level = Infinity;
  order.forEach((idx, k) => {
    const x = path[idx * 2] as number;
    const z = path[idx * 2 + 1] as number;
    level = Math.min(level, heightAt(l, x, z) - INSET);
    const s = along[k] as number;
    const taper = smooth(s / TAPER) * smooth((total - s) / TAPER);
    // Never narrower than the lattice can draw, so the bed is always below the water.
    const halfWidth = Math.max(1.1, (width / 2) * taper);
    stations.push({ x, z, level, halfWidth, depth: Math.min(depth, halfWidth * CHANNEL_SHAPE) });
  });
  return { stations };
}

interface Nearest {
  distance: number;
  level: number;
  halfWidth: number;
  depth: number;
}

function nearest(stations: readonly Station[], x: number, z: number): Nearest {
  let best: Nearest = { distance: Infinity, level: 0, halfWidth: 0, depth: 0 };
  for (let i = 0; i + 1 < stations.length; i++) {
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

/** Cuts the channel and its banks into `heights`, and records the water level where the banks contain it. */
export function carveStream(l: Lattice, heights: Float32Array, level: Float32Array, stream: SolvedStream): void {
  const reach = Math.max(...stream.stations.map((s) => s.halfWidth)) + BANK_REACH;
  const xs = stream.stations.map((s) => s.x);
  const zs = stream.stations.map((s) => s.z);
  const toIndex = (w: number): number => (w - l.origin) / l.spacing;
  const x0 = Math.max(0, Math.floor(toIndex(Math.min(...xs) - reach)));
  const x1 = Math.min(l.n - 1, Math.ceil(toIndex(Math.max(...xs) + reach)));
  const z0 = Math.max(0, Math.floor(toIndex(Math.min(...zs) - reach)));
  const z1 = Math.min(l.n - 1, Math.ceil(toIndex(Math.max(...zs) + reach)));
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      const i = iz * l.n + ix;
      const s = nearest(stream.stations, worldOf(l, ix), worldOf(l, iz));
      const h = heights[i] as number;
      if (s.distance < s.halfWidth) {
        const profile = 1 - (s.distance / s.halfWidth) ** 2;
        heights[i] = Math.min(h, s.level - s.depth * profile);
        level[i] = Math.max(level[i] as number, s.level);
      } else if (s.distance < s.halfWidth + BANK_REACH) {
        const raw = (s.distance - s.halfWidth) / BANK;
        const t = smooth(raw);
        // The bank climbs from the waterline at no more than BANK_GRADE, then meets natural ground.
        const cap = s.level + BANK_LIP * t + BANK_GRADE * (s.distance - s.halfWidth);
        const eased = Math.min(h, cap);
        // Containment: next to the water the bank stands above the waterline,
        // fading back to natural ground over the outer bank. It starts from
        // the lip's own height, so the ground stays continuous there.
        const lip = Math.min(h, s.level);
        const levee = lip + (s.level + BANK_LIP * Math.max(t, 0.35) - lip) * smooth(raw / 0.12);
        const contain = 1 - smooth((raw - 0.55) / 0.4);
        const leveed = Math.max(eased, levee);
        heights[i] = eased + (leveed - eased) * contain;
        if (raw <= 0.55) level[i] = Math.max(level[i] as number, s.level);
      }
    }
  }
}

/** Fills a pond to just under its rim, then cuts a gentle bed below the level. Null when the hollow cannot hold water. */
export function solvePond(l: Lattice, heights: Float32Array, x: number, z: number, radius: number): SolvedPond | null {
  const reach = radius * 1.3;
  let rim = Infinity;
  const steps = Math.ceil((Math.PI * 2 * reach) / (l.spacing * 0.5));
  for (let k = 0; k < steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    rim = Math.min(rim, heightAt(l, x + Math.cos(a) * reach, z + Math.sin(a) * reach, heights));
  }
  const level = rim - POND_FREEBOARD;
  if (heightAt(l, x, z, heights) > level - 0.2) return null;
  return { x, z, radius, reach, level };
}

export function carvePond(l: Lattice, heights: Float32Array, level: Float32Array, pond: SolvedPond, depth: number): void {
  const toIndex = (w: number): number => (w - l.origin) / l.spacing;
  const x0 = Math.max(0, Math.floor(toIndex(pond.x - pond.reach)));
  const x1 = Math.min(l.n - 1, Math.ceil(toIndex(pond.x + pond.reach)));
  const z0 = Math.max(0, Math.floor(toIndex(pond.z - pond.reach)));
  const z1 = Math.min(l.n - 1, Math.ceil(toIndex(pond.z + pond.reach)));
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      const r = Math.hypot(worldOf(l, ix) - pond.x, worldOf(l, iz) - pond.z);
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

/**
 * Distance from each lattice sample to the nearest sample under water, meters,
 * capped at SHORE_CAP: 0 in the water, growing about a meter per meter away.
 * Sand banks and the grass's edge both read it, so they always agree.
 */
export function shoreField(l: Lattice, heights: Float32Array, level: Float32Array): Float32Array {
  const { n, spacing } = l;
  const d = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) d[i] = (level[i] as number) > (heights[i] as number) ? 0 : SHORE_CAP;
  // Two chamfer passes: straight steps cost one spacing, diagonal ones root two.
  const diag = Math.SQRT2 * spacing;
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
