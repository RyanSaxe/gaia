// The ground's vitality. Every point of the land is someone's ground: a
// file's patch, or an area's own ground (an entity's lot); past the land it
// is the wild's, which always thrives. The ground takes the vitality of
// whatever it belongs to, as the trees do, eased across each border over a
// few meters so one patch's health drifts into its neighbor's instead of
// changing along a line. The bake records, per sample of a grid over the
// land, the few owners whose ground it is and their shares (`ownershipOf`);
// each owner's vitality is applied afterward (`vitalityOver`), so a change in
// vitality rewrites a small texture and never rebakes anything.

import { type LandSite, nearestSite, warpPoint } from "./land.ts";

/** A site of the land's division and the owner of its cell's ground, by index into the caller's list of owners. */
export interface OwnedSite extends LandSite {
  readonly owner: number;
}

export const GROUND_VITALITY = {
  /** Meters between the ownership grid's samples; a linearly filtered texture blends between them. */
  spacing: 4,
  /** Owners kept per sample, largest share first. */
  taps: 4,
  /**
   * How softly a patch's ground gives way to its neighbor's, meters: a
   * share falls by e for every `soft` meters a neighbor's site lies farther,
   * which eases one patch into the next over about 7 m.
   */
  soft: 3,
  /** Owners whose share has fallen this many `soft`s below the nearest's count for nothing, so shares end without a step. */
  cut: 4,
  /** Meters over which the land hands its ground over to the wild at its rounded edge. */
  rim: 8,
} as const;

/** The wild's owner, past the land: always thriving. */
export const WILD_OWNER = -1;
/** The wild's owner and an empty tap, as an ownership grid stores them. */
const WILD_TAP = 0xffff;

/** One owner's share of the ground at a point, 0 to 1. */
export interface Share {
  readonly owner: number;
  readonly share: number;
}

/**
 * Whose ground a grid over the land is: per sample, `GROUND_VITALITY.taps`
 * owners (0xffff for the wild) and their shares in 255ths, largest first,
 * summing to 255. Sample (i, k) lies at (origin + i * spacing, origin + k * spacing).
 */
export interface Ownership {
  readonly n: number;
  readonly origin: number;
  readonly spacing: number;
  readonly owners: Uint16Array;
  readonly shares: Uint8Array;
}

/** Side of a lookup bucket, meters. */
const BUCKET = 16;
/** The most owners whose ground can meet at one point within a cut. */
const MOST = 32;

interface Buckets {
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  readonly starts: Int32Array;
  readonly ids: Int32Array;
  readonly reach: number;
}
const bucketed = new WeakMap<readonly OwnedSite[], Buckets>();

function bucketsOf(sites: readonly OwnedSite[]): Buckets {
  const had = bucketed.get(sites);
  if (had !== undefined) return had;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  let reach = 0;
  for (const s of sites) {
    x0 = Math.min(x0, s.x);
    z0 = Math.min(z0, s.z);
    x1 = Math.max(x1, s.x);
    z1 = Math.max(z1, s.z);
    reach = Math.max(reach, Math.abs(s.reach ?? 0));
  }
  const nx = Math.max(1, Math.floor((x1 - x0) / BUCKET) + 1);
  const nz = Math.max(1, Math.floor((z1 - z0) / BUCKET) + 1);
  const at = (s: OwnedSite): number => Math.floor((s.z - z0) / BUCKET) * nx + Math.floor((s.x - x0) / BUCKET);
  const starts = new Int32Array(nx * nz + 1);
  for (const s of sites) starts[at(s) + 1] = (starts[at(s) + 1] as number) + 1;
  for (let c = 0; c < nx * nz; c++) starts[c + 1] = (starts[c + 1] as number) + (starts[c] as number);
  const fill = starts.slice(0, nx * nz);
  const ids = new Int32Array(sites.length);
  sites.forEach((s, k) => {
    const c = at(s);
    ids[fill[c] as number] = k;
    fill[c] = (fill[c] as number) + 1;
  });
  const made = { x0, z0, nx, nz, starts, ids, reach };
  bucketed.set(sites, made);
  return made;
}

/** How far (x, z) lies past the land's rounded square, meters (negative inside), as `placeAt` draws its edge. */
const pastTheRim = (size: number, x: number, z: number): number => (Math.abs(x) ** 4 + Math.abs(z) ** 4) ** 0.25 - size / 2;

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Fills `owners` and `shares` with whose ground (x, z) is (see `groundOwners`), unsorted, and returns how many. */
function ownersInto(sites: readonly OwnedSite[], size: number, x: number, z: number, soft: number, owners: Int32Array, shares: Float64Array): number {
  const half = GROUND_VITALITY.rim / 2;
  const past = pastTheRim(size, x, z);
  const wild = past <= -half ? 0 : past >= half ? 1 : smooth((past + half) / (2 * half));
  if (wild >= 1 || sites.length === 0) {
    owners[0] = WILD_OWNER;
    shares[0] = 1;
    return 1;
  }
  const [wx, wz] = warpPoint(x, z);
  const nearest = sites[nearestSite(sites, wx, wz)] as OwnedSite;
  const dMin = Math.hypot(wx - nearest.x, wz - nearest.z) - (nearest.reach ?? 0);
  const cut = GROUND_VITALITY.cut * soft;
  // Every site that could lie within `cut` of the nearest; each owner keeps its nearest site's distance.
  const b = bucketsOf(sites);
  const r = dMin + cut + b.reach;
  // The nearest site's owner first, so it is never crowded out.
  owners[0] = nearest.owner;
  shares[0] = 0;
  let count = 1;
  const j1 = Math.min(b.nz - 1, Math.floor((wz + r - b.z0) / BUCKET));
  const i1 = Math.min(b.nx - 1, Math.floor((wx + r - b.x0) / BUCKET));
  for (let j = Math.max(0, Math.floor((wz - r - b.z0) / BUCKET)); j <= j1; j++) {
    for (let i = Math.max(0, Math.floor((wx - r - b.x0) / BUCKET)); i <= i1; i++) {
      const c = j * b.nx + i;
      for (let n = b.starts[c] as number; n < (b.starts[c + 1] as number); n++) {
        const s = sites[b.ids[n] as number] as OwnedSite;
        const d = Math.hypot(wx - s.x, wz - s.z) - (s.reach ?? 0) - dMin;
        if (d >= cut) continue;
        let k = 0;
        while (k < count && owners[k] !== s.owner) k++;
        if (k === count) {
          if (count === MOST) continue;
          owners[count] = s.owner;
          shares[count++] = d;
        } else if (d < (shares[k] as number)) shares[k] = d;
      }
    }
  }
  // Each owner's share falls off by how much farther its nearest site lies, ending at the cut without a step.
  const floor = Math.exp(-GROUND_VITALITY.cut);
  let total = 0;
  for (let k = 0; k < count; k++) {
    shares[k] = Math.exp(-(shares[k] as number) / soft) - floor;
    total += shares[k] as number;
  }
  for (let k = 0; k < count; k++) shares[k] = ((shares[k] as number) / total) * (1 - wild);
  if (wild > 0) {
    owners[count] = WILD_OWNER;
    shares[count++] = wild;
  }
  return count;
}

/**
 * Whose ground (x, z) is, and how much of it: the owner of the cell that
 * holds it (`siteAt`'s rule) and, near a border, its neighbors', each
 * falling off by how much farther its nearest site lies from the warped
 * point, by e every `soft` meters. Owners meeting at a border share it
 * evenly. Within `GROUND_VITALITY.rim` of the land's edge the wild takes
 * over. Shares sum to 1, largest first.
 */
export function groundOwners(sites: readonly OwnedSite[], size: number, x: number, z: number, soft: number = GROUND_VITALITY.soft): Share[] {
  const owners = new Int32Array(MOST + 1);
  const shares = new Float64Array(MOST + 1);
  const count = ownersInto(sites, size, x, z, soft, owners, shares);
  return Array.from({ length: count }, (_, k) => ({ owner: owners[k] as number, share: shares[k] as number })).sort((p, q) => q.share - p.share || p.owner - q.owner);
}

/** The grid an ownership of a world `extent` meters across is sampled on, centered on the world. */
export function ownershipGrid(extent: number, spacing: number = GROUND_VITALITY.spacing): { readonly n: number; readonly origin: number; readonly spacing: number } {
  const n = Math.round(extent / spacing) + 1;
  return { n, origin: (-(n - 1) * spacing) / 2, spacing };
}

/**
 * Whose ground rows [k0, k1) of an ownership grid are (`groundOwners`), kept
 * to the largest `GROUND_VITALITY.taps` shares in 255ths. Rows are
 * independent, so a bake may work them out in parts, on several threads,
 * and get the same bytes as all at once.
 */
export function ownershipRows(sites: readonly OwnedSite[], size: number, grid: { readonly n: number; readonly origin: number; readonly spacing: number }, k0: number, k1: number, soft: number = GROUND_VITALITY.soft): { owners: Uint16Array; shares: Uint8Array } {
  const { n, origin, spacing } = grid;
  const taps = GROUND_VITALITY.taps;
  for (const s of sites) if (s.owner < 0 || s.owner >= WILD_TAP) throw new Error(`Ground has at most ${WILD_TAP} owners, numbered from 0; a site names owner ${s.owner}.`);
  const owners = new Uint16Array((k1 - k0) * n * taps).fill(WILD_TAP);
  const shares = new Uint8Array((k1 - k0) * n * taps);
  const who = new Int32Array(MOST + 1);
  const much = new Float64Array(MOST + 1);
  for (let k = k0; k < k1; k++) {
    for (let i = 0; i < n; i++) {
      const count = ownersInto(sites, size, origin + i * spacing, origin + k * spacing, soft, who, much);
      // The largest shares first, ties to the lower owner.
      const kept = Math.min(taps, count);
      let total = 0;
      for (let t = 0; t < kept; t++) {
        let best = t;
        for (let j = t + 1; j < count; j++) {
          const d = (much[j] as number) - (much[best] as number);
          if (d > 0 || (d === 0 && (who[j] as number) < (who[best] as number))) best = j;
        }
        [who[t], who[best]] = [who[best] as number, who[t] as number];
        [much[t], much[best]] = [much[best] as number, much[t] as number];
        total += much[t] as number;
      }
      const at = ((k - k0) * n + i) * taps;
      let left = 255;
      for (let t = 0; t < kept; t++) {
        const q = t === kept - 1 ? left : Math.min(left, Math.round(((much[t] as number) / total) * 255));
        owners[at + t] = who[t] === WILD_OWNER ? WILD_TAP : (who[t] as number);
        shares[at + t] = q;
        left -= q;
      }
    }
  }
  return { owners, shares };
}

/** Whose ground every sample of a grid `extent` meters across, centered on the world, is: `ownershipRows` over every row. */
export function ownershipOf(sites: readonly OwnedSite[], size: number, extent: number, soft: number = GROUND_VITALITY.soft, spacing: number = GROUND_VITALITY.spacing): Ownership {
  const grid = ownershipGrid(extent, spacing);
  return { ...grid, ...ownershipRows(sites, size, grid, 0, grid.n, soft) };
}

/**
 * The ground's vitality at every sample of an ownership grid, in 255ths:
 * each owner's vitality (`vitality[owner]`, 1 where it has none) weighed by
 * its share, and the wild's 1. Writes into `into` every `stride` bytes from
 * `offset`, so two tables of vitality can fill one texture's channels.
 */
export function vitalityOver(own: Ownership, vitality: ArrayLike<number>, into: Uint8Array = new Uint8Array(own.n * own.n), stride = 1, offset = 0): Uint8Array {
  const taps = GROUND_VITALITY.taps;
  const count = own.n * own.n;
  const { owners, shares } = own;
  for (let p = 0, t = 0; p < count; p++, t += taps) {
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const q = shares[t + j] as number;
      if (q === 0) continue;
      const o = owners[t + j] as number;
      const v = o === WILD_TAP ? 1 : (vitality[o] ?? 1);
      sum += q * (v < 0 ? 0 : v > 1 ? 1 : v);
    }
    into[p * stride + offset] = Math.round(sum);
  }
  return into;
}

/** The vitality at (x, z) from per-sample values in 255ths, blended between the four nearest samples as a linearly filtered texture reads them. */
export function vitalityAt(own: Ownership, values: Uint8Array, x: number, z: number, stride = 1, offset = 0): number {
  const gx = Math.min(own.n - 1, Math.max(0, (x - own.origin) / own.spacing));
  const gz = Math.min(own.n - 1, Math.max(0, (z - own.origin) / own.spacing));
  const i = Math.min(own.n - 2, Math.floor(gx));
  const k = Math.min(own.n - 2, Math.floor(gz));
  const fx = gx - i;
  const fz = gz - k;
  const v = (a: number, b: number): number => (values[(b * own.n + a) * stride + offset] as number) / 255;
  return (v(i, k) * (1 - fx) + v(i + 1, k) * fx) * (1 - fz) + (v(i, k + 1) * (1 - fx) + v(i + 1, k + 1) * fx) * fz;
}

/**
 * How ground of a given vitality looks, the rule the grass, ground and water
 * shaders follow: thriving ground keeps its full cover, and below about 0.85
 * the grass thins, shortens and yellows toward straw, the ground beneath
 * dries and bare earth opens in patches, and water clouds and stills.
 */
export const GROUND_DECLINE = {
  /** Vitality above which ground looks as it always did, and below which it has declined all it will. */
  from: 0.85,
  to: 0.02,
  /** At full decline: the share of blades that still stand, and their height. */
  blades: 0.55,
  height: 0.75,
  /** The decline past which bare earth starts to open, and how much of the ground it opens at most. */
  bareFrom: 0.3,
  bare: 0.4,
  /** How far the cover's own colors dry toward straw. */
  dry: 0.85,
} as const;

/** How far ground of vitality `v` has declined: 0 thriving, 1 all it will. */
export function groundDecline(v: number): number {
  const t = Math.min(1, Math.max(0, (v - GROUND_DECLINE.to) / (GROUND_DECLINE.from - GROUND_DECLINE.to)));
  return 1 - smooth(t);
}

/** What ground of vitality `v` shows: the share of blades standing and their height, the share of blades gone to straw, the share of bare earth, and how far its cover has dried. */
export function groundLook(v: number): { blades: number; height: number; straw: number; bare: number; dry: number } {
  const d = groundDecline(v);
  const g = GROUND_DECLINE;
  return {
    blades: 1 - (1 - g.blades) * d,
    height: 1 - (1 - g.height) * d,
    straw: d,
    bare: g.bare * smooth(Math.min(1, Math.max(0, (d - g.bareFrom) / (1 - g.bareFrom)))),
    dry: g.dry * d,
  };
}
