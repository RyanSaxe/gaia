// Divides a world's land among the code tree. A directory's cells split among
// its subdirectories and its own ground, which holds its files and its
// entity's lot, in proportion to their ground, and the split repeats down to
// the files. Each split is a power diagram, a Voronoi diagram whose sites
// carry weights, over a raster of land cells moved by `warpPoint`.
//
// Final ownership must follow `nearestSite`, the rule `siteAt` and the terrain
// regions use, so `divideLand` redraws the result from a few sites per leaf.
// Ground rounds up to a `rung`, and sites start at points seeded by node id.
// An edit that moves no node across a rung therefore leaves the land unchanged.

import { rand, seedOf } from "@gaia/schema";
import { type LandOutline, type LandSite, nearestSite, pastTheEdge, warpPoint } from "@gaia/terrain";

/** A node of the divided tree: a directory, a directory's own ground, or a leaf, which is a file or a lot. */
export interface LandNode {
  readonly id: string;
  /** A leaf's ground in square meters. `groundOf` ignores it on a node with children. */
  readonly ground: number;
  readonly children: readonly LandNode[];
  /** Its site starts at the centroid of the parent's cells and never moves to the centroid of its own. */
  readonly heart?: boolean;
}

/** A leaf's share of the land after the final nearest-site redraw. */
export interface LeafLand {
  readonly id: string;
  readonly sites: readonly LandSite[];
  /** Square meters. */
  readonly ground: number;
  /** The leaf's cell nearest the centroid of its cells. The centroid itself can fall outside a curved leaf. */
  readonly x: number;
  readonly z: number;
  /** World points of the leaf's cells whose eight neighbors also belong to the leaf. Callers place things on these. */
  readonly inner: readonly (readonly [number, number])[];
}

export interface Land {
  /** Raster spacing, meters. */
  readonly step: number;
  readonly leaves: readonly LeafLand[];
}

export const onLand = (land: LandOutline, x: number, z: number): boolean => pastTheEdge(land, x, z) <= 0;

interface Raster {
  readonly step: number;
  readonly n: number;
  readonly half: number;
  /** px and pz are each land cell's world center. wx and wz are that point moved by `warpPoint`. */
  readonly px: Float64Array;
  readonly pz: Float64Array;
  readonly wx: Float64Array;
  readonly wz: Float64Array;
  /** The land cell at raster index j * n + i, or -1 off the land. */
  readonly at: Int32Array;
}

function rasterOf(land: LandOutline, step: number): Raster {
  const size = land.size;
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
      if (!onLand(land, x, z)) continue;
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

/** Ratio between consecutive rungs. A node's share changes only when its ground crosses a rung. */
const RUNG = 1.25;

/** Rounds ground up to the next power of `RUNG`. `divide` splits land by these values, never by exact ground. */
export const rung = (ground: number): number => (ground > 0 ? RUNG ** Math.ceil(Math.log(ground) / Math.log(RUNG) - 1e-9) : 0);

/** The rung nearest `amount` on a log scale, which may be below it. A threshold set this way matches `amount` on average. */
export const nearestRung = (amount: number): number => rung(amount / Math.sqrt(RUNG));

/** Passes in which each site not `pinned` moves to the centroid of its cells. These passes make the parts round. */
const MOVES = 6;
/** Maximum passes in `settle`. Most divisions converge in a few. */
const PASSES = 24;

/**
 * Assigns `cells` to sites as a power diagram and writes each cell's site to
 * `owner`. A cell goes to the site with the least squared distance from the
 * cell's warped point minus the site's weight. For the first `MOVES` passes,
 * each site not `pinned` also moves to the centroid of its cells. After that
 * the sites stay fixed, and Newton steps (`newtonStep`) solve for weights
 * until each site's count is within one cell or 0.5% of its target. The
 * weights for fixed sites are unique up to a constant. Equal inputs therefore
 * give equal divisions, and nearby inputs give nearby divisions.
 */
function settle(r: Raster, cells: Int32Array, targets: Float64Array, sx: Float64Array, sz: Float64Array, owner: Int32Array, pinned: readonly boolean[]): void {
  const k = targets.length;
  const cellArea = r.step * r.step;
  // Each weight starts at target area / pi. The disc where dist^2 < w then has the target area.
  let weight = Float64Array.from(targets, (t) => (t * cellArea) / Math.PI);
  const count = new Float64Array(k);
  const mx = new Float64Array(k);
  const mz = new Float64Array(k);
  // trade[i * k + j] is the number of cells site i takes from site j per square meter of weight i gains over j.
  const trade = new Float64Array(k * k);
  /** Assigns each cell to a site under weights `w` and sums each site's count, coordinates and `trade`. Returns the sum of squared count errors. */
  const assign = (w: Float64Array): number => {
    count.fill(0);
    mx.fill(0);
    mz.fill(0);
    trade.fill(0);
    for (let c = 0; c < cells.length; c++) {
      const q = cells[c] as number;
      const x = r.wx[q] as number;
      const z = r.wz[q] as number;
      let best = 0;
      let bd = Infinity;
      let next = -1;
      let nd = Infinity;
      for (let j = 0; j < k; j++) {
        const dx = x - (sx[j] as number);
        const dz = z - (sz[j] as number);
        const d = dx * dx + dz * dz - (w[j] as number);
        if (d < bd) {
          next = best;
          nd = bd;
          bd = d;
          best = j;
        } else if (d < nd) {
          nd = d;
          next = j;
        }
      }
      owner[c] = best;
      count[best] = (count[best] as number) + 1;
      mx[best] = (mx[best] as number) + x;
      mz[best] = (mz[best] as number) + z;
      if (next < 0 || next === best) continue;
      // Count cells within one step of the border between their two nearest sites. A weight change dw moves that border
      // by dw / (2 * apart), so each such cell adds 1 / (4 * apart * step) to the pair's trade.
      const apart2 = Math.max(cellArea, ((sx[best] as number) - (sx[next] as number)) ** 2 + ((sz[best] as number) - (sz[next] as number)) ** 2);
      if ((nd - bd) ** 2 < 4 * apart2 * cellArea) {
        const h = 1 / (4 * Math.sqrt(apart2) * r.step);
        trade[best * k + next] = (trade[best * k + next] as number) + h;
        trade[next * k + best] = (trade[next * k + best] as number) + h;
      }
    }
    let off = 0;
    for (let j = 0; j < k; j++) off += ((count[j] as number) - (targets[j] as number)) ** 2;
    return off;
  };
  // A site with no cells gains cells at about the rate of a lone disc. Other sites get 5% of that rate so the Newton
  // system has a unique solution.
  const grows = Math.PI / (2 * cellArea);
  let off = assign(weight);
  for (let pass = 0; ; pass++) {
    if (pass < MOVES) {
      for (let j = 0; j < k; j++) {
        const n = count[j] as number;
        if (n === 0 || pinned[j] === true) continue;
        sx[j] = (mx[j] as number) / n;
        sz[j] = (mz[j] as number) / n;
      }
      off = assign(weight);
    }
    let settled = pass >= MOVES;
    for (let j = 0; j < k && settled; j++) if (Math.abs((count[j] as number) - (targets[j] as number)) > Math.max(1, 0.005 * (targets[j] as number))) settled = false;
    if (settled || pass >= PASSES) return;
    const step = newtonStep(trade, Float64Array.from(targets, (t, j) => t - (count[j] as number)), Float64Array.from(count, (n) => (n === 0 ? grows : 0.05 * grows)));
    // Scale the step so no weight changes by more than a lone disc's weight for half of max(target, count) plus two
    // cells. Then halve it until the counts move closer to their targets, and give up below 1/20 of that scale.
    let fits = 1;
    for (let j = 0; j < k; j++) fits = Math.min(fits, ((0.5 * Math.max(targets[j] as number, count[j] as number) + 2) * cellArea) / Math.PI / Math.max(1e-9, Math.abs(step[j] as number)));
    let better = false;
    for (let scale = fits; scale > fits / 20 && !better; scale /= 2) {
      const tried = Float64Array.from(weight, (w, j) => w + scale * (step[j] as number));
      const now = assign(tried);
      if (now < off) {
        weight = tried;
        off = now;
        better = true;
      }
    }
    if (better) continue;
    // No scaled step reduced the error. Reassign under the kept weights, since the trials overwrote `owner`, and stop
    // once the sites have finished moving.
    off = assign(weight);
    if (pass >= MOVES) return;
  }
}

/**
 * Solves by conjugate gradients for the weight changes that move each site's
 * count by `short` cells. The matrix is the graph Laplacian of `trade` plus
 * the diagonal `alone`. The diagonal makes the system nonsingular and gives a
 * site with no neighbors a lone disc's growth rate.
 */
function newtonStep(trade: Float64Array, short: Float64Array, alone: Float64Array): Float64Array {
  const k = short.length;
  const times = (v: Float64Array, out: Float64Array): void => {
    for (let i = 0; i < k; i++) {
      let sum = (alone[i] as number) * (v[i] as number);
      for (let j = 0; j < k; j++) {
        const t = trade[i * k + j] as number;
        if (t !== 0) sum += t * ((v[i] as number) - (v[j] as number));
      }
      out[i] = sum;
    }
  };
  const x = new Float64Array(k);
  const rest = Float64Array.from(short);
  const dir = Float64Array.from(short);
  const turned = new Float64Array(k);
  let rr = 0;
  for (const v of rest) rr += v * v;
  const enough = rr * 1e-8;
  for (let it = 0; it < 2 * k + 8 && rr > enough; it++) {
    times(dir, turned);
    let dq = 0;
    for (let i = 0; i < k; i++) dq += (dir[i] as number) * (turned[i] as number);
    if (dq <= 0) break;
    const alpha = rr / dq;
    let next = 0;
    for (let i = 0; i < k; i++) {
      x[i] = (x[i] as number) + alpha * (dir[i] as number);
      rest[i] = (rest[i] as number) - alpha * (turned[i] as number);
      next += (rest[i] as number) ** 2;
    }
    for (let i = 0; i < k; i++) dir[i] = (rest[i] as number) + (next / rr) * (dir[i] as number);
    rr = next;
  }
  return x;
}

/** Passes that push overlapping sites apart. */
const SPACING = 48;

/**
 * Sets each child's starting site within the parent's cells. Each child is a
 * disc, with area proportional to its share, inside a unit disc. A child
 * starts at an angle and radius seeded by its id, and a `heart` child starts
 * at the center. For `SPACING` passes, overlapping discs push apart and a disc
 * past the rim moves back inside. Spaced discs make round parts instead of
 * wedges. The unit disc is then stretched over the parent's cells by their
 * second moments, so the children of a long part lie along it. The sites
 * depend on the cells only through their centroid and second moments, so a
 * small change in ground moves them a little.
 */
function spaceSites(r: Raster, cells: Int32Array, kids: readonly LandNode[], targets: Float64Array, sx: Float64Array, sz: Float64Array): void {
  const k = kids.length;
  let cx = 0;
  let cz = 0;
  for (const q of cells) {
    cx += r.wx[q] as number;
    cz += r.wz[q] as number;
  }
  cx /= Math.max(1, cells.length);
  cz /= Math.max(1, cells.length);
  let a = 0;
  let b = 0;
  let d = 0;
  for (const q of cells) {
    const x = (r.wx[q] as number) - cx;
    const z = (r.wz[q] as number) - cz;
    a += x * x;
    b += x * z;
    d += z * z;
  }
  // Add one cell's own second moment, step^2 / 12, so a part one cell wide still has a width.
  const own = (r.step * r.step) / 12;
  a = a / Math.max(1, cells.length) + own;
  b /= Math.max(1, cells.length);
  d = d / Math.max(1, cells.length) + own;
  // A disc of radius R has second moment R^2 / 4 on each axis. The stretch is twice the matrix square root of the moments.
  const det = Math.sqrt(a * d - b * b);
  const tr = Math.sqrt(a + d + 2 * det);
  const lxx = (2 * (a + det)) / tr;
  const lxz = (2 * b) / tr;
  const lzz = (2 * (d + det)) / tr;
  const total = targets.reduce((n, t) => n + t, 0) || 1;
  const radius = Float64Array.from(targets, (t) => 0.9 * Math.sqrt(t / total));
  const px = new Float64Array(k);
  const pz = new Float64Array(k);
  kids.forEach((kid, j) => {
    const h = rand(seedOf(kid.id));
    const angle = h.next() * Math.PI * 2;
    const far = kid.heart === true ? 0 : 0.3 + 0.55 * Math.sqrt(h.next());
    px[j] = Math.cos(angle) * far;
    pz[j] = Math.sin(angle) * far;
  });
  const mx = new Float64Array(k);
  const mz = new Float64Array(k);
  for (let pass = 0; pass < SPACING; pass++) {
    mx.fill(0);
    mz.fill(0);
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        let dx = (px[j] as number) - (px[i] as number);
        let dz = (pz[j] as number) - (pz[i] as number);
        let gap = Math.hypot(dx, dz);
        const overlap = (radius[i] as number) + (radius[j] as number) - gap;
        if (overlap <= 0) continue;
        if (gap < 1e-9) {
          dx = Math.cos(i + j);
          dz = Math.sin(i + j);
          gap = 1;
        }
        // Each disc moves in proportion to the other's area, so the smaller disc moves more.
        const ai = (radius[i] as number) ** 2;
        const aj = (radius[j] as number) ** 2;
        const push = (0.5 * overlap) / gap;
        mx[i] = (mx[i] as number) - (dx * push * aj) / (ai + aj);
        mz[i] = (mz[i] as number) - (dz * push * aj) / (ai + aj);
        mx[j] = (mx[j] as number) + (dx * push * ai) / (ai + aj);
        mz[j] = (mz[j] as number) + (dz * push * ai) / (ai + aj);
      }
    }
    for (let j = 0; j < k; j++) {
      let x = (px[j] as number) + (mx[j] as number);
      let z = (pz[j] as number) + (mz[j] as number);
      const out = Math.hypot(x, z);
      const room = Math.max(0, 1 - (radius[j] as number));
      if (out > room) {
        x *= room / out;
        z *= room / out;
      }
      px[j] = x;
      pz[j] = z;
    }
  }
  for (let j = 0; j < k; j++) {
    sx[j] = cx + lxx * (px[j] as number) + lxz * (pz[j] as number);
    sz[j] = cz + lxz * (px[j] as number) + lzz * (pz[j] as number);
  }
}

/** Splits `cells` among a node's children and recurses to the leaves. Writes each leaf's cells to `out`. */
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
  const grounds = kids.map((kid) => rung(groundOf(kid)));
  const total = grounds.reduce((a, b) => a + b, 0) || 1;
  const targets = Float64Array.from(grounds, (g) => (cells.length * g) / total);
  const sx = new Float64Array(kids.length);
  const sz = new Float64Array(kids.length);
  spaceSites(r, cells, kids, targets, sx, sz);
  const owner = new Int32Array(cells.length);
  settle(r, cells, targets, sx, sz, owner, kids.map((kid) => kid.heart === true));
  // Every leaf needs at least one cell. A child with fewer cells than leaves gets the cells nearest its site,
  // reassigned from siblings that keep at least one cell per leaf. A child with no cells first moves its site to the
  // farthest cell of the sibling with the most spare cells, then gets max(leaves, target) cells. Several empty
  // siblings therefore start apart.
  const leaves = kids.map((kid) => leavesOf(kid).length);
  const held = new Int32Array(kids.length);
  owner.forEach((o) => (held[o] = (held[o] as number) + 1));
  const spare = (o: number): number => (held[o] as number) - Math.max(leaves[o] as number, targets[o] as number);
  kids.forEach((_, j) => {
    const need = leaves[j] as number;
    if ((held[j] as number) >= need) return;
    if ((held[j] as number) === 0) {
      let richest = -1;
      for (let o = 0; o < kids.length; o++) if (o !== j && (richest < 0 || spare(o) > spare(richest))) richest = o;
      let far = -1;
      for (let c = 0; c < cells.length; c++) {
        if (owner[c] !== richest) continue;
        const q = cells[c] as number;
        const d = ((r.wx[q] as number) - (sx[richest] as number)) ** 2 + ((r.wz[q] as number) - (sz[richest] as number)) ** 2;
        if (d > far) {
          far = d;
          sx[j] = r.wx[q] as number;
          sz[j] = r.wz[q] as number;
        }
      }
    }
    let want = (held[j] as number) === 0 ? Math.max(need, Math.round(targets[j] as number)) : need - (held[j] as number);
    const near = Array.from(cells.keys())
      .map((c) => [c, ((r.wx[cells[c] as number] as number) - (sx[j] as number)) ** 2 + ((r.wz[cells[c] as number] as number) - (sz[j] as number)) ** 2] as const)
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (const [c] of near) {
      if (want === 0) break;
      const o = owner[c] as number;
      if (o === j || (held[o] as number) <= (leaves[o] as number)) continue;
      owner[c] = j;
      held[o] = (held[o] as number) - 1;
      held[j] = (held[j] as number) + 1;
      want--;
    }
  });
  const parts: number[][] = kids.map(() => []);
  owner.forEach((o, c) => (parts[o] as number[]).push(cells[c] as number));
  kids.forEach((kid, j) => divide(r, kid, Int32Array.from(parts[j] as number[]), out));
}

/** Leaves in depth-first order. */
function leavesOf(node: LandNode, out: LandNode[] = []): LandNode[] {
  if (node.children.length === 0) out.push(node);
  for (const c of node.children) leavesOf(c, out);
  return out;
}

/** Meters between the sites `sitesOf` places in a leaf. */
const SITE_SPACING = 16;

/**
 * Places the sites for the final nearest-site redraw. In each raster block of
 * about `SITE_SPACING` meters where a leaf owns at least a quarter of the
 * cells, the leaf gets a site at its cell nearest a point seeded by the block.
 * A leaf with no such block gets one site at its cell nearest its centroid.
 * Nearest-site division over these sites matches the nested division to
 * within a few meters, and every leaf with cells keeps at least one.
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

/** Divides the land among the leaves of `root` in proportion to their ground, rounded up by `rung`. */
export function divideLand(root: LandNode, land: LandOutline): Land {
  const size = land.size;
  const step = Math.max(2.5, Math.min(6, size / 230));
  const r = rasterOf(land, step);
  const all = Int32Array.from({ length: r.px.length }, (_, i) => i);
  const shares = new Map<string, Int32Array>();
  divide(r, root, all, shares);
  const leaves = leavesOf(root);
  const drawn = sitesOf(r, leaves, shares);
  const sites = drawn.map((d) => d.site);
  // Final ownership uses `nearestSite`, the same rule as `siteAt` and the terrain regions.
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
    // Use the leaf's cell nearest its centroid, since a curved leaf's centroid can lie outside it.
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

/** One share of a leaf from `dividePlots`. x and z are its cell nearest the centroid of its cells. */
export interface Plot {
  readonly x: number;
  readonly z: number;
  /** Square meters. */
  readonly ground: number;
}

/**
 * Divides one leaf's cells among a smaller tree with `divide`, the same split
 * `divideLand` uses. Callers use it to divide a file's patch among its
 * definitions, and a definition's plot among the definitions inside it.
 * `cells` are the leaf's `LeafLand.inner` points and `cellStep` is the raster
 * spacing. Every plot gets at least one cell.
 */
export function dividePlots(root: LandNode, cells: readonly (readonly [number, number])[], cellStep: number): ReadonlyMap<string, Plot> {
  const out = new Map<string, Plot>();
  if (cells.length === 0) return out;
  // With fewer cells than plots, split each cell in four until every plot can have one.
  let points = cells;
  let step = cellStep;
  for (const wanted = leavesOf(root).length; points.length < wanted; step /= 2) points = points.flatMap(([x, z]) => [-1, 1].flatMap((dz) => [-1, 1].map((dx) => [x + (dx * step) / 4, z + (dz * step) / 4] as const)));
  const px = Float64Array.from(points, (p) => p[0]);
  const pz = Float64Array.from(points, (p) => p[1]);
  const warped = points.map((p) => warpPoint(p[0], p[1]));
  const r: Raster = { step, n: 0, half: 0, px, pz, wx: Float64Array.from(warped, (w) => w[0]), wz: Float64Array.from(warped, (w) => w[1]), at: new Int32Array(0) };
  const shares = new Map<string, Int32Array>();
  divide(r, root, Int32Array.from({ length: points.length }, (_, i) => i), shares);
  for (const leaf of leavesOf(root)) {
    const mine = shares.get(leaf.id);
    if (mine === undefined || mine.length === 0) continue;
    let x = 0;
    let z = 0;
    for (const q of mine) {
      x += px[q] as number;
      z += pz[q] as number;
    }
    x /= mine.length;
    z /= mine.length;
    let best = mine[0] as number;
    let near = Infinity;
    for (const q of mine) {
      const d = ((px[q] as number) - x) ** 2 + ((pz[q] as number) - z) ** 2;
      if (d < near) {
        near = d;
        best = q;
      }
    }
    out.set(leaf.id, { x: px[best] as number, z: pz[best] as number, ground: mine.length * step * step });
  }
  return out;
}
