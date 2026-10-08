// Dividing a world's land among the code's tree. Each directory's land is
// divided among its own ground (its files and the lot its entity stands on,
// kept together at its heart) and its subdirectories, each given ground in
// proportion to the code it holds; then each of those is divided the same
// way, down to the files. Every division is a relaxed, weighted Voronoi
// division of a fine raster of the land, measured from points moved by the
// land's warp (`warpPoint`), so borders curve and wander, nest the way the
// tree nests, and fill the land with no gaps. Last, a few sites drawn from
// each leaf's share redraw the whole division as plain nearest-site cells:
// the very rule `siteAt` and the terrain's regions use, so a leaf's ground
// here is its ground everywhere.
//
// Starting sites are seeded by each node's id, and every step is a fixed
// number of the same moves, so the same code gives the same land and a small
// change to the code moves the land a little.

import { rand, seedOf } from "@gaia/schema";
import { type LandSite, nearestSite, warpPoint } from "@gaia/terrain";

/** A node of the tree whose land is divided: a directory, its own ground, or a leaf (a file or a lot). */
export interface LandNode {
  readonly id: string;
  /** A leaf's ground, square meters; ignored for a node with children. */
  readonly ground: number;
  readonly children: readonly LandNode[];
  /** Starts at its parent's middle: a directory's own ground is its heart. */
  readonly heart?: boolean;
}

/** One leaf's land: the sites that draw its ground, the ground it holds, and its heart. */
export interface LeafLand {
  readonly id: string;
  readonly sites: readonly LandSite[];
  /** Square meters its cell holds. */
  readonly ground: number;
  /** The middle of its ground, moved onto it if the middle falls outside. */
  readonly x: number;
  readonly z: number;
  /** Raster cells well inside its ground (every neighbor its too), as world points, for standing things on it. */
  readonly inner: readonly (readonly [number, number])[];
}

export interface Land {
  /** Raster spacing, meters. */
  readonly step: number;
  readonly leaves: readonly LeafLand[];
}

/** Whether (x, z) lies on the land: inside the walkable square's rounded edge. */
export const onLand = (size: number, x: number, z: number): boolean => Math.abs(x) ** 4 + Math.abs(z) ** 4 <= (size / 2) ** 4;

/** Share of a square the land's rounded square covers. */
export const LAND_SHARE = 0.927;

interface Raster {
  readonly step: number;
  readonly n: number;
  readonly half: number;
  /** World and warped coordinates of every land cell, and the cell index of each. */
  readonly px: Float64Array;
  readonly pz: Float64Array;
  readonly wx: Float64Array;
  readonly wz: Float64Array;
  /** Raster index (j * n + i) → land cell, or -1. */
  readonly at: Int32Array;
}

function rasterOf(size: number, step: number): Raster {
  const n = Math.ceil(size / step);
  const half = (n * step) / 2;
  const at = new Int32Array(n * n).fill(-1);
  const px: number[] = [];
  const pz: number[] = [];
  const wx: number[] = [];
  const wz: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + (i + 0.5) * step;
      const z = -half + (j + 0.5) * step;
      if (!onLand(size, x, z)) continue;
      at[j * n + i] = px.length;
      const [a, b] = warpPoint(x, z);
      px.push(x);
      pz.push(z);
      wx.push(a);
      wz.push(b);
    }
  }
  return { step, n, half, px: Float64Array.from(px), pz: Float64Array.from(pz), wx: Float64Array.from(wx), wz: Float64Array.from(wz), at };
}

const groundOf = (node: LandNode): number => (node.children.length === 0 ? node.ground : node.children.reduce((n, c) => n + groundOf(c), 0));

/**
 * Relaxes a weighted division of `cells` among sites: each cell goes to the
 * site nearest its warped point less the site's reach; each site then moves
 * toward the middle of its cells, and its reach grows or shrinks until its
 * share matches its target. `owner` receives each cell's site.
 */
function relax(r: Raster, cells: Int32Array, targets: Float64Array, sx: Float64Array, sz: Float64Array, reach: Float64Array, iterations: number, owner: Int32Array, pinned: readonly boolean[]): void {
  const k = targets.length;
  const count = new Float64Array(k);
  const mx = new Float64Array(k);
  const mz = new Float64Array(k);
  const cellArea = r.step * r.step;
  const held = [...pinned];
  for (let it = 0; ; it++) {
    count.fill(0);
    mx.fill(0);
    mz.fill(0);
    for (let c = 0; c < cells.length; c++) {
      const q = cells[c] as number;
      const x = r.wx[q] as number;
      const z = r.wz[q] as number;
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < k; j++) {
        const dx = x - (sx[j] as number);
        const dz = z - (sz[j] as number);
        const d = Math.sqrt(dx * dx + dz * dz) - (reach[j] as number);
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      owner[c] = best;
      count[best] = (count[best] as number) + 1;
      mx[best] = (mx[best] as number) + x;
      mz[best] = (mz[best] as number) + z;
    }
    if (it >= iterations) return;
    let mean = 0;
    // The sibling holding the most more than its share, which gives ground to any sibling left with none.
    let richest = 0;
    for (let j = 1; j < k; j++) if ((count[j] as number) - (targets[j] as number) > (count[richest] as number) - (targets[richest] as number)) richest = j;
    for (let j = 0; j < k; j++) {
      const n = count[j] as number;
      // A heart crowded off its spot no longer holds it: pulling it back with reach alone would swell it into a wedge.
      if (n === 0) held[j] = false;
      if (n === 0 && j !== richest) {
        // Starved: start again in the richest sibling's ground, on the cell farthest from its site, as strong as it.
        let far = -1;
        let at = -1;
        for (let c = 0; c < cells.length; c++) {
          if (owner[c] !== richest) continue;
          const q = cells[c] as number;
          const d = ((r.wx[q] as number) - (sx[richest] as number)) ** 2 + ((r.wz[q] as number) - (sz[richest] as number)) ** 2;
          if (d > far) {
            far = d;
            at = q;
          }
        }
        if (at >= 0) {
          sx[j] = r.wx[at] as number;
          sz[j] = r.wz[at] as number;
          // Just strong enough to win the ground it lands on, no more.
          reach[j] = (reach[richest] as number) - Math.sqrt(far) + 2 * r.step;
        }
        mean += reach[j] as number;
        continue;
      }
      // A heart stays at its parent's middle and only grows or shrinks; the rest gather around it.
      if (n > 0 && held[j] !== true) {
        sx[j] = (sx[j] as number) + 0.7 * ((mx[j] as number) / n - (sx[j] as number));
        sz[j] = (sz[j] as number) + 0.7 * ((mz[j] as number) / n - (sz[j] as number));
      }
      const area = Math.max(n, 1) * cellArea;
      // Raising a reach moves its borders out by half as much: the share changes by about half the perimeter times the change.
      const change = (1.6 * ((targets[j] as number) - n) * cellArea) / (3.6 * Math.sqrt(area));
      reach[j] = (reach[j] as number) + Math.max(-3 * r.step, Math.min(3 * r.step, change));
      mean += reach[j] as number;
    }
    mean /= k;
    for (let j = 0; j < k; j++) reach[j] = (reach[j] as number) - mean;
  }
}

/** Divides `cells` among a node's children, then each child's share among its own, down to the leaves. */
function divide(r: Raster, node: LandNode, cells: Int32Array, out: Map<string, Int32Array>): void {
  if (node.children.length === 0) {
    out.set(node.id, cells);
    return;
  }
  const kids = node.children;
  if (kids.length === 1) {
    divide(r, kids[0] as LandNode, cells, out);
    return;
  }
  const grounds = kids.map(groundOf);
  const total = grounds.reduce((a, b) => a + b, 0) || 1;
  const targets = Float64Array.from(grounds, (g) => (cells.length * g) / total);
  let cx = 0;
  let cz = 0;
  for (const q of cells) {
    cx += r.wx[q] as number;
    cz += r.wz[q] as number;
  }
  cx /= Math.max(1, cells.length);
  cz /= Math.max(1, cells.length);
  const spread = Math.sqrt(cells.length / Math.PI) * r.step;
  const sx = new Float64Array(kids.length);
  const sz = new Float64Array(kids.length);
  const reach = new Float64Array(kids.length);
  kids.forEach((kid, j) => {
    // A child starts at a spot seeded by its id, its own ground at the heart; then it moves to the nearest cell.
    const h = rand(seedOf(kid.id));
    const a = h.next() * Math.PI * 2;
    const d = kid.heart === true ? 0 : spread * (0.3 + 0.55 * Math.sqrt(h.next()));
    const tx = cx + Math.cos(a) * d;
    const tz = cz + Math.sin(a) * d;
    let best = Infinity;
    for (const q of cells) {
      const e = ((r.wx[q] as number) - tx) ** 2 + ((r.wz[q] as number) - tz) ** 2;
      if (e < best) {
        best = e;
        sx[j] = r.wx[q] as number;
        sz[j] = r.wz[q] as number;
      }
    }
    reach[j] = Math.sqrt((targets[j] as number) / Math.PI) * r.step * 0.5;
  });
  const owner = new Int32Array(cells.length);
  relax(r, cells, targets, sx, sz, reach, 24, owner, kids.map((k) => k.heart === true));
  // A child still without ground takes the cells nearest its site, as many as its share.
  const held = new Int32Array(kids.length);
  owner.forEach((o) => (held[o] = (held[o] as number) + 1));
  kids.forEach((_, j) => {
    if ((held[j] as number) > 0) return;
    const near = Array.from(cells.keys())
      .map((c) => [c, ((r.wx[cells[c] as number] as number) - (sx[j] as number)) ** 2 + ((r.wz[cells[c] as number] as number) - (sz[j] as number)) ** 2] as const)
      .sort((a, b) => a[1] - b[1] || a[0] - b[0])
      .slice(0, Math.max(1, Math.round(targets[j] as number)));
    for (const [c] of near) owner[c] = j;
  });
  const parts: number[][] = kids.map(() => []);
  owner.forEach((o, c) => (parts[o] as number[]).push(cells[c] as number));
  kids.forEach((kid, j) => divide(r, kid, Int32Array.from(parts[j] as number[]), out));
}

/** The leaves of a tree, in order. */
function leavesOf(node: LandNode, out: LandNode[] = []): LandNode[] {
  if (node.children.length === 0) out.push(node);
  for (const c of node.children) leavesOf(c, out);
  return out;
}

/** Meters between the sites that draw a leaf's ground. */
const SITE_SPACING = 16;

/**
 * Sites that draw each leaf's ground: in every block of the raster a leaf
 * holds a fair part of, the leaf's cell nearest a spot seeded by the block,
 * and always at least the cell nearest its middle. Nearest-site division over
 * these, with no reach, redraws the nested division to within a few meters,
 * and no leaf can be swallowed.
 */
function sitesOf(r: Raster, leaves: readonly LandNode[], shares: ReadonlyMap<string, Int32Array>): { site: LandSite; leaf: number }[] {
  const m = Math.max(2, Math.round(SITE_SPACING / r.step));
  const blocks = Math.ceil(r.n / m);
  const out: { site: LandSite; leaf: number }[] = [];
  const cellOf = (q: number): [number, number] => [Math.round(((r.px[q] as number) + r.half) / r.step - 0.5), Math.round(((r.pz[q] as number) + r.half) / r.step - 0.5)];
  leaves.forEach((leaf, li) => {
    const cells = shares.get(leaf.id) ?? new Int32Array(0);
    if (cells.length === 0) return;
    const byBlock = new Map<number, number[]>();
    for (const q of cells) {
      const [i, j] = cellOf(q);
      const key = Math.floor(j / m) * blocks + Math.floor(i / m);
      const list = byBlock.get(key);
      if (list === undefined) byBlock.set(key, [q]);
      else list.push(q);
    }
    const picks: number[] = [];
    for (const key of [...byBlock.keys()].sort((a, b) => a - b)) {
      const list = byBlock.get(key) as number[];
      if (list.length * 4 < m * m) continue;
      const h = rand(seedOf(`site:${key}`));
      const bx = ((key % blocks) + 0.2 + 0.6 * h.next()) * m;
      const bz = (Math.floor(key / blocks) + 0.2 + 0.6 * h.next()) * m;
      let best = list[0] as number;
      let near = Infinity;
      for (const q of list) {
        const [i, j] = cellOf(q);
        const d = (i - bx) ** 2 + (j - bz) ** 2;
        if (d < near) {
          near = d;
          best = q;
        }
      }
      picks.push(best);
    }
    if (picks.length === 0) {
      let x = 0;
      let z = 0;
      for (const q of cells) {
        x += r.px[q] as number;
        z += r.pz[q] as number;
      }
      x /= cells.length;
      z /= cells.length;
      let best = cells[0] as number;
      let near = Infinity;
      for (const q of cells) {
        const d = ((r.px[q] as number) - x) ** 2 + ((r.pz[q] as number) - z) ** 2;
        if (d < near) {
          near = d;
          best = q;
        }
      }
      picks.push(best);
    }
    for (const q of picks) out.push({ site: { x: Math.round((r.wx[q] as number) * 100) / 100, z: Math.round((r.wz[q] as number) * 100) / 100 }, leaf: li });
  });
  return out;
}

/** Divides a world of side `size` among a tree's leaves, by the ground each asks for. */
export function divideLand(root: LandNode, size: number): Land {
  const step = Math.max(2.5, Math.min(6, size / 230));
  const r = rasterOf(size, step);
  const all = Int32Array.from({ length: r.px.length }, (_, i) => i);
  const shares = new Map<string, Int32Array>();
  divide(r, root, all, shares);
  const leaves = leavesOf(root);
  const drawn = sitesOf(r, leaves, shares);
  const sites = drawn.map((d) => d.site);
  // The final shares, by the one rule every reader uses.
  const owner = new Int32Array(r.px.length);
  for (let q = 0; q < owner.length; q++) owner[q] = (drawn[nearestSite(sites, r.wx[q] as number, r.wz[q] as number)] as { leaf: number }).leaf;
  const cells: number[][] = leaves.map(() => []);
  owner.forEach((o, q) => (cells[o] as number[]).push(q));
  const out: LeafLand[] = leaves.map((leaf, j) => {
    const mine = cells[j] as number[];
    let x = 0;
    let z = 0;
    for (const q of mine) {
      x += r.px[q] as number;
      z += r.pz[q] as number;
    }
    x /= Math.max(1, mine.length);
    z /= Math.max(1, mine.length);
    // The middle moves onto the leaf's own ground when its shape bends around it.
    let hx = x;
    let hz = z;
    let near = Infinity;
    for (const q of mine) {
      const d = ((r.px[q] as number) - x) ** 2 + ((r.pz[q] as number) - z) ** 2;
      if (d < near) {
        near = d;
        hx = r.px[q] as number;
        hz = r.pz[q] as number;
      }
    }
    const inner: [number, number][] = [];
    for (const q of mine) {
      const i = Math.round(((r.px[q] as number) + r.half) / step - 0.5);
      const jj = Math.round(((r.pz[q] as number) + r.half) / step - 0.5);
      let whole = true;
      for (let dj = -1; dj <= 1 && whole; dj++) {
        for (let di = -1; di <= 1 && whole; di++) {
          const ii = i + di;
          const kk = jj + dj;
          const o = ii < 0 || kk < 0 || ii >= r.n || kk >= r.n ? -1 : (r.at[kk * r.n + ii] as number);
          if (o < 0 || owner[o] !== j) whole = false;
        }
      }
      if (whole) inner.push([r.px[q] as number, r.pz[q] as number]);
    }
    const own = drawn.filter((d) => d.leaf === j).map((d) => d.site);
    return { id: leaf.id, sites: own, ground: mine.length * step * step, x: mine.length > 0 ? hx : (own[0]?.x ?? 0), z: mine.length > 0 ? hz : (own[0]?.z ?? 0), inner };
  });
  return { step, leaves: out };
}
