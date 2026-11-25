// Indexes what a person cannot walk through, such as tree trunks, rocks,
// bushes and walls. Each solid is the convex hull of its ground outline,
// rounded by a radius, so its edge has a direction everywhere and a walker
// slides around it without catching. A trunk is one point rounded by its
// radius.

/** One solid's ground outline in world meters. */
export type SolidShape =
  /** A disc, such as a trunk at its base. */
  | { readonly x: number; readonly z: number; readonly radius: number }
  /** Any outline as x, z pairs. Its convex hull is solid. */
  | { readonly points: readonly number[] };

interface Solid {
  /** The hull's corners as x, z pairs, counter-clockwise. A disc has one corner. */
  readonly hull: Float64Array;
  readonly round: number;
}

/** The solids of one world, indexed by ground cells so a step checks only the few nearby. */
export interface Solids {
  readonly count: number;
  /** @internal Solid indices by cell. */
  readonly cells: ReadonlyMap<number, readonly number[]>;
  /** @internal */
  readonly items: readonly Solid[];
}

/** Meters per index cell. */
const CELL = 4;
/** Meters past its edge that each solid is indexed, so a query finds every solid within `REACH` from its own cell. */
const REACH = 2;

const cellKey = (ix: number, iz: number): number =>
  (ix + 32768) * 65536 + (iz + 32768);

const cross2d = (
  o: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function appendHullChain(chain: [number, number][], p: [number, number]): void {
  while (chain.length >= 2) {
    const o = chain[chain.length - 2];
    const a = chain[chain.length - 1];
    if (o === undefined || a === undefined || cross2d(o, a, p) > 1e-12) break;
    chain.pop();
  }
  chain.push(p);
}

/** Andrew's monotone chain: the convex hull of x, z pairs, counter-clockwise, without collinear corners. */
function hullOf(points: readonly number[]): Float64Array {
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    pts.push([points[i] as number, points[i + 1] as number]);
  }
  const sorted = pts.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return Float64Array.from(sorted.flat());
  const lower: [number, number][] = [];
  for (const p of sorted) appendHullChain(lower, p);
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    if (p !== undefined) appendHullChain(upper, p);
  }
  lower.pop();
  upper.pop();
  return Float64Array.from([...lower, ...upper].flat());
}

/** Indexes solids from their outlines on the ground. */
export function solidsOf(shapes: readonly SolidShape[]): Solids {
  const items: Solid[] = shapes.map((s) =>
    "points" in s
      ? { hull: hullOf(s.points), round: 0 }
      : { hull: Float64Array.of(s.x, s.z), round: s.radius },
  );
  const cells = new Map<number, number[]>();
  items.forEach((solid, i) => {
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (let k = 0; k < solid.hull.length; k += 2) {
      x0 = Math.min(x0, solid.hull[k] as number);
      x1 = Math.max(x1, solid.hull[k] as number);
      z0 = Math.min(z0, solid.hull[k + 1] as number);
      z1 = Math.max(z1, solid.hull[k + 1] as number);
    }
    const pad = solid.round + REACH;
    for (
      let iz = Math.floor((z0 - pad) / CELL);
      iz <= Math.floor((z1 + pad) / CELL);
      iz++
    ) {
      for (
        let ix = Math.floor((x0 - pad) / CELL);
        ix <= Math.floor((x1 + pad) / CELL);
        ix++
      ) {
        const key = cellKey(ix, iz);
        const list = cells.get(key);
        if (list === undefined) cells.set(key, [i]);
        else list.push(i);
      }
    }
  });
  return { count: items.length, cells, items };
}

export const NO_SOLIDS: Solids = solidsOf([]);

/** A placed component's ground outline. `outline` holds its radius in `outline.length` directions at scale 1, which this turns and scales as Three places it, times `share`. */
export function outlineShape(
  x: number,
  z: number,
  yaw: number,
  scale: number,
  outline: ArrayLike<number>,
  share = 1,
): SolidShape {
  const k = outline.length;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const points: number[] = [];
  for (let i = 0; i < k; i++) {
    const a = ((i + 0.5) / k) * Math.PI * 2;
    const r = (outline[i] as number) * scale * share;
    if (r <= 0) continue;
    const lx = Math.cos(a) * r;
    const lz = Math.sin(a) * r;
    // Three's rotation about y turns local x toward (cos, -sin).
    points.push(x + lx * c + lz * s, z - lx * s + lz * c);
  }
  return points.length > 0 ? { points } : { x, z, radius: 0.05 };
}

/** The nearest edge to a point: its signed distance, negative inside, and the outward normal there. */
export interface Edge {
  distance: number;
  nx: number;
  nz: number;
}

function discEdge(
  h: Float64Array,
  round: number,
  x: number,
  z: number,
  out: Edge,
): void {
  const dx = x - (h[0] as number);
  const dz = z - (h[1] as number);
  const d = Math.hypot(dx, dz);
  out.distance = d - round;
  out.nx = d > 1e-9 ? dx / d : 1;
  out.nz = d > 1e-9 ? dz / d : 0;
}

function edgeOf(solid: Solid, x: number, z: number, out: Edge): void {
  const h = solid.hull;
  const n = h.length / 2;
  if (n === 1) {
    discEdge(h, solid.round, x, z, out);
    return;
  }
  // Outside, use the nearest point on any edge. Inside, use the nearest edge's line.
  let inside = n >= 3;
  let deepest = -Infinity;
  let inX = 1;
  let inZ = 0;
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  for (let i = 0; i < n; i++) {
    const ax = h[i * 2] as number;
    const az = h[i * 2 + 1] as number;
    const j = (i + 1) % n;
    const ex = (h[j * 2] as number) - ax;
    const ez = (h[j * 2 + 1] as number) - az;
    const len2 = ex * ex + ez * ez;
    if (len2 < 1e-18) continue;
    const len = Math.sqrt(len2);
    // Counter-clockwise, so the outward normal of (ex, ez) is (ez, -ex).
    const side = ((x - ax) * ez - (z - az) * ex) / len;
    if (side > 0) inside = false;
    if (side > deepest) {
      deepest = side;
      inX = ez / len;
      inZ = -ex / len;
    }
    const u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len2));
    const px = ax + ex * u;
    const pz = az + ez * u;
    const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d2 < best) {
      best = d2;
      bx = px;
      bz = pz;
    }
  }
  if (inside) {
    out.distance = deepest - solid.round;
    out.nx = inX;
    out.nz = inZ;
    return;
  }
  const d = Math.sqrt(best);
  out.distance = d - solid.round;
  out.nx = d > 1e-9 ? (x - bx) / d : inX;
  out.nz = d > 1e-9 ? (z - bz) / d : inZ;
}

const probe: Edge = { distance: 0, nx: 0, nz: 0 };

/**
 * Writes the nearest solid's edge to (x, z) into `out`. `out.distance` is
 * `REACH` when nothing is that close. It is accurate within `REACH` meters.
 */
export function nearestEdge(
  solids: Solids,
  x: number,
  z: number,
  out: Edge,
): Edge {
  out.distance = REACH;
  out.nx = 1;
  out.nz = 0;
  const list = solids.cells.get(
    cellKey(Math.floor(x / CELL), Math.floor(z / CELL)),
  );
  if (list === undefined) return out;
  for (const i of list) {
    edgeOf(solids.items[i] as Solid, x, z, probe);
    if (probe.distance < out.distance) {
      out.distance = probe.distance;
      out.nx = probe.nx;
      out.nz = probe.nz;
    }
  }
  return out;
}

const scratch: Edge = { distance: 0, nx: 0, nz: 0 };

/** Distance from (x, z) to the nearest solid's edge, negative inside one and at most `REACH`. */
export const clearanceAt = (solids: Solids, x: number, z: number): number =>
  nearestEdge(solids, x, z, scratch).distance;
