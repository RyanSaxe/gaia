// The wild past the land, as the field sheet draws it (docs/design-system.md,
// "The field sheet"): an old survey in ink on unwashed paper. Color on the
// sheet means health, and the wild stands for no code, so past the land's
// paint the paper stays bare and ink draws what is there: contours and
// hachures from the wild's heights, its thickets where they stand, tufts where
// its golden steppe runs and stipple where it runs to scrub, all from the
// functions the world grows the wild from (`@gaia/terrain`), so the map and
// the world never disagree.
//
// The wild has no end, so it cannot be painted onto one sheet. It is inked in
// square tiles anchored to the world, each at one of a ladder of scales,
// painted a few milliseconds at a time in the page's idle time ahead of where
// a view will look, and kept. A view only lays the tiles it shows, at the
// scales nearest its own, crossfading between two as the map zooms, so nothing
// is drawn afresh as the person walks. The paper under the ink is one
// handmade paper anchored to the world too, the same under the land's paint
// and past it, so no seam shows where the land's sheet ends.

import { type Terrain, WILDS, WILD_THICKETS, heightAt, wildHash, wildPatch, wildRollAt, wildScrub, wildShare, wildThicket } from "@gaia/terrain";
import { chained, isoline } from "./isolines.ts";
import type { MapStyle } from "./map-styles.ts";

/** A view of the land: its middle in meters, and css pixels a meter. */
export interface LandView {
  readonly x: number;
  readonly z: number;
  readonly zoom: number;
}

/**
 * Near its rounded rim the land rises to a crest, and past it the ground
 * settles over `WILDS.settle` meters into the wild's roll. The sheet eases its
 * relief over the rim's last `inner` meters to the height `held` meters in, and
 * from the rim out toward the wild's roll, so neither the hill shade nor any
 * contour draws a ring where the land ends.
 */
export const RIM = { inner: 110, held: 60 } as const;

const smooth = (v: number): number => {
  const u = Math.max(0, Math.min(1, v));
  return u * u * (3 - 2 * u);
};

/** The ground's height as the sheet draws it: the land's own, eased at its rim (`RIM`), and the wild's roll past it. */
export function reliefAt(t: Terrain, x: number, z: number): number {
  const half = t.spec.size / 2;
  const r = Math.pow(Math.abs(x) ** 4 + Math.abs(z) ** 4, 0.25);
  const toRim = half - r;
  if (toRim >= RIM.inner) return heightAt(t.lattice, x, z);
  const pull = Math.min(1, (half - RIM.held) / Math.max(r, 1e-6));
  const held = heightAt(t.lattice, x * pull, z * pull);
  if (toRim < 0) return held + (wildRollAt(t, x, z) - held) * smooth(-toRim / WILDS.settle);
  return held + (heightAt(t.lattice, x, z) - held) * smooth((toRim - RIM.held) / (RIM.inner - RIM.held));
}

// ---------- the paper ----------

/** The paper's ground: one square of handmade paper, meters a side and pixels a meter, that repeats without a seam. */
const GROUND = { meters: 512, density: 2 };
/** How much the paper is mottled in two sizes of blotch (meters across, strength), and its fibres and specks a square kilometer. */
const MOTTLE: readonly (readonly [number, number])[] = [[85, 0.09], [20, 0.05]];
const FIBRES: readonly (readonly [string, number, number])[] = [["rgba(118,92,56,0.075)", 1430, 11], ["rgba(255,251,238,0.16)", 880, 23]];
const SPECKS: readonly (readonly [string, number])[] = [["rgba(120,96,60,0.06)", 0], ["rgba(255,250,235,0.1)", 1]];
const SPECKS_KM2 = 2400;

const hash = (x: number, z: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const grounds = new WeakMap<MapStyle, HTMLCanvasElement>();

/**
 * The paper's ground as one tile that repeats without a seam: mottled as
 * handmade paper is, with fibres and a faint grain, as dense a meter as the
 * field map's paper. Painted once for each look of the sheet.
 */
function groundOf(style: MapStyle): HTMLCanvasElement {
  const known = grounds.get(style);
  if (known !== undefined) return known;
  const side = GROUND.meters * GROUND.density;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = style.paper;
  ctx.fillRect(0, 0, side, side);
  // Blotches, each layer a small grid of soft cells drawn large; the grid carries two cells of the far side around
  // it, so its smoothing wraps and the tile meets its neighbors without a seam.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  for (const [across, strength] of MOTTLE) {
    const cells = Math.max(2, Math.round(GROUND.meters / across));
    const pad = 2;
    const n = cells + pad * 2;
    const grid = document.createElement("canvas");
    grid.width = grid.height = n;
    const g = grid.getContext("2d") as CanvasRenderingContext2D;
    const img = g.createImageData(n, n);
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const k = (((b - pad) % cells) + cells) % cells * cells + ((((a - pad) % cells) + cells) % cells);
        img.data.set([...style.mottle, Math.round(255 * hash(k + cells * 7.3, cells * 7.3))], (b * n + a) * 4);
      }
    }
    g.putImageData(img, 0, 0);
    ctx.globalAlpha = strength;
    ctx.drawImage(grid, pad, pad, cells, cells, 0, 0, side, side);
  }
  ctx.globalAlpha = 1;
  // Fibres and specks, each drawn again a tile away wherever it crosses the tile's edge.
  const area = (GROUND.meters / 1000) ** 2;
  const d = GROUND.density;
  const wrapped = (x: number, y: number, reach: number, draw: (x: number, y: number) => void): void => {
    for (const ox of [-side, 0, side]) {
      for (const oy of [-side, 0, side]) {
        if (x + ox > -reach && x + ox < side + reach && y + oy > -reach && y + oy < side + reach) draw(x + ox, y + oy);
      }
    }
  };
  ctx.lineCap = "round";
  for (const [tone, perKm2, seed] of FIBRES) {
    ctx.strokeStyle = tone;
    ctx.lineWidth = 0.71 * d;
    ctx.beginPath();
    for (let n = 0; n < perKm2 * area; n++) {
      const x0 = hash(n, seed) * side;
      const y0 = hash(seed, n) * side;
      const a = hash(n + seed, 3) * Math.PI * 2;
      const len = (3.3 + hash(n, seed + 1) * 8.7) * d;
      const bend = (hash(n, seed + 2) - 0.5) * 4.4 * d;
      wrapped(x0, y0, len + 4, (x, y) => {
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend, x + Math.cos(a) * len, y + Math.sin(a) * len);
      });
    }
    ctx.stroke();
  }
  for (const [tone, from] of SPECKS) {
    ctx.fillStyle = tone;
    ctx.beginPath();
    for (let n = from; n < SPECKS_KM2 * 2 * area; n += 2) {
      const w = (0.55 + hash(n, 4) * 1.65) * d;
      const h = (0.55 + hash(n, 5) * 1.65) * d;
      wrapped(hash(n, 1) * side, hash(n, 2) * side, 4 * d, (x, y) => ctx.rect(x, y, w, h));
    }
    ctx.fill();
  }
  grounds.set(style, canvas);
  return canvas;
}

const patterns = new WeakMap<CanvasRenderingContext2D, { readonly style: MapStyle; readonly pattern: CanvasPattern }>();

/**
 * Lays the paper's ground over `w` by `h` of `ctx`'s own units, anchored to the
 * world: `ox`, `oy` is where the world's middle falls and `density` how many of
 * those units a meter takes. The field map's painted paper lays it under its
 * land, and every view lays it past the land, so the paper runs on unbroken.
 */
export function layGround(ctx: CanvasRenderingContext2D, style: MapStyle, ox: number, oy: number, density: number, w: number, h: number): void {
  let laid = patterns.get(ctx);
  if (laid === undefined || laid.style !== style) {
    const pattern = ctx.createPattern(groundOf(style), "repeat");
    if (pattern === null) return;
    laid = { style, pattern };
    patterns.set(ctx, laid);
  }
  const k = density / GROUND.density;
  laid.pattern.setTransform(new DOMMatrix([k, 0, 0, k, ox, oy]));
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = laid.pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ---------- the ink ----------

export const INK = {
  /** Level 0's scale, css pixels a meter (about the minimap's); each coarser level is half the last. */
  scale: 1.28,
  finest: -2,
  coarsest: 6,
  /** A tile's side, css pixels. */
  tile: 256,
  /**
   * At level 0, meters: heights sampled (close enough that a contour round the flat top of a rise stays round),
   * hachures, and tufts and stipple; each coarser level doubles them.
   */
  sample: 2.5,
  hachure: 6.5,
  tuft: 10,
  /** Thickets are drawn up to this level, and their lead bushes only, thinned, at the last. */
  thickets: 2,
  /**
   * Tiles kept at most, about 1 MB each: enough for the field map zoomed between two levels (about 70 tiles on the
   * widest sheet) with the minimap's around the person.
   */
  keep: 96,
  /** How far round the person the minimap's tiles are painted ahead, meters. */
  ahead: 300,
} as const;

/** The level whose scale is nearest a view's, as a fraction: 0 at `INK.scale`, 1 at half of it. */
const levelOf = (zoom: number): number => Math.max(INK.finest, Math.min(INK.coarsest, Math.log2(INK.scale / Math.max(1e-6, zoom))));

/** The one or two levels a view at `zoom` lays, and how strongly: a crossfade between two levels midway, so zooming never jumps. */
export function levelsFor(zoom: number): { readonly k: number; readonly weight: number }[] {
  const f = levelOf(zoom);
  const k = Math.floor(f);
  if (k >= INK.coarsest) return [{ k: INK.coarsest, weight: 1 }];
  const upper = smooth((f - k - 0.3) / 0.4);
  return [
    { k, weight: 1 - upper },
    { k: k + 1, weight: upper },
  ].filter((l) => l.weight > 0);
}

/** A tile's side at level `k`, meters. */
const tileMeters = (k: number): number => (INK.tile / INK.scale) * 2 ** k;

/** What a tile is painted from: the baked land, the sheet's look and how its paint gives way at its edge. */
interface Sheet {
  readonly terrain: Terrain;
  readonly style: MapStyle;
  /** The land's painted square's half side, meters, and how much paint it holds over that square (alpha). */
  readonly reach: number;
  readonly paint: HTMLCanvasElement;
  /** How far in from the square's edge any of it is bare, meters. */
  readonly bare: number;
  readonly dpr: number;
}

const SEEDS = { hachure: 201, tuft: 211, stipple: 221, thicket: 231 };
/** The wild's contours on bare paper, as strong as the land's over its paint: a little lighter. */
const WILD_LINE = 0.8;

/**
 * A line (x and y pairs) drawn as a curve through the middles of its steps, bending at its points, so a contour
 * traced cell by cell reads as an easy line. A point's curve depends only on its neighbors, so the same line traced
 * in two tiles is drawn the same in both.
 */
function curve(path: Path2D, line: readonly number[]): void {
  const count = line.length / 2;
  if (count < 2) return;
  const at = (k: number): [number, number] => [line[k * 2] as number, line[k * 2 + 1] as number];
  const [x0, z0] = at(0);
  path.moveTo(x0, z0);
  for (let k = 1; k < count - 1; k++) {
    const [x, z] = at(k);
    const [nx, nz] = at(k + 1);
    path.quadraticCurveTo(x, z, (x + nx) / 2, (z + nz) / 2);
  }
  const [xn, zn] = at(count - 1);
  path.lineTo(xn, zn);
}

/**
 * Inks one tile, `k` its level and `i`, `j` its place on that level's grid, in
 * steps: its heights, its slopes and grass, then its contours and thickets.
 * Everything is placed on grids anchored to the world, so a mark that crosses
 * a tile's edge is drawn the same in both tiles and they meet without a seam.
 */
function* inkTile(sheet: Sheet, k: number, i: number, j: number): Generator<void, HTMLCanvasElement> {
  const { terrain: t, style, reach, dpr } = sheet;
  const res = INK.scale * 2 ** -k;
  const side = tileMeters(k);
  const x0 = i * side;
  const z0 = j * side;
  const px = Math.round(INK.tile * dpr);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  // Drawn in meters: a css pixel is `1 / res` meters.
  const unit = 1 / res;
  g.setTransform(px / side, 0, 0, px / side, -x0 * (px / side), -z0 * (px / side));
  g.lineCap = g.lineJoin = "round";
  /** Whether the paper is bare anywhere near a point: past the land's square, or in its unpainted edge. */
  const inked = (x: number, z: number, pad: number): boolean => Math.max(Math.abs(x), Math.abs(z)) > reach - sheet.bare - pad;

  // Heights on a grid anchored to the world, reaching four samples past the tile on each side: as far as the slope
  // of a hachure that reaches into the tile is read.
  const step = INK.sample * 2 ** k;
  const gi = Math.floor(x0 / step) - 4;
  const gj = Math.floor(z0 / step) - 4;
  const n = Math.ceil(side / step) + 9;
  const heights = new Float32Array(n * n);
  for (let b = 0; b < n; b++) {
    for (let a = 0; a < n; a++) {
      const x = (gi + a) * step;
      const z = (gj + b) * step;
      heights[b * n + a] = inked(x, z, step * 2) ? reliefAt(t, x, z) : Number.NaN;
    }
    if (b === n >> 1) yield;
  }
  yield;
  /** The height between the samples, and its slope, by the samples around a point. */
  const at = (a: number, b: number): number => heights[Math.max(0, Math.min(n - 1, b)) * n + Math.max(0, Math.min(n - 1, a))] as number;
  const heightOf = (x: number, z: number): number => {
    const u = x / step - gi;
    const v = z / step - gj;
    const a = Math.floor(u);
    const b = Math.floor(v);
    const fu = u - a;
    const fv = v - b;
    return (at(a, b) * (1 - fu) + at(a + 1, b) * fu) * (1 - fv) + (at(a, b + 1) * (1 - fu) + at(a + 1, b + 1) * fu) * fv;
  };
  const ink = style.ink;
  const inkRgb = [parseInt(ink.slice(1, 3), 16), parseInt(ink.slice(3, 5), 16), parseInt(ink.slice(5, 7), 16)].join(",");

  // Contours from the same heights as the land's, in the same sepia and widths, a little lighter on bare paper, and
  // wider apart on coarse levels. Each is joined into lines drawn as easy curves through their cells' crossings.
  const c = style.contour;
  const interval = c.interval * 2 ** Math.max(0, k - 1);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of heights) if (!Number.isNaN(v)) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
  const lines = [new Path2D(), new Path2D()];
  for (let s = Math.ceil(lo / interval); s * interval <= hi; s++) {
    const segments: number[] = [];
    isoline(heights, n, s * interval, (a0, b0, a1, b1) => segments.push((gi + a0) * step, (gj + b0) * step, (gi + a1) * step, (gj + b1) * step));
    const path = lines[s % c.index === 0 ? 1 : 0] as Path2D;
    for (const line of chained(segments)) curve(path, line);
  }
  g.strokeStyle = c.ink;
  g.globalAlpha = c.alpha * WILD_LINE;
  g.lineWidth = 0.85 * unit;
  g.stroke(lines[0] as Path2D);
  g.globalAlpha = c.indexAlpha * WILD_LINE;
  g.lineWidth = 1.4 * unit;
  g.stroke(lines[1] as Path2D);
  g.globalAlpha = 1;
  yield;

  // Slopes: hachures along the fall line, heavier and closer on the slopes turned from the light in the northwest.
  const scale = 2 ** k;
  const hachures = [new Path2D(), new Path2D(), new Path2D()];
  const hs = INK.hachure * scale;
  const long = 3 * scale;
  for (let b = Math.floor((z0 - long) / hs); b <= Math.floor((z0 + side + long) / hs); b++) {
    for (let a = Math.floor((x0 - long) / hs); a <= Math.floor((x0 + side + long) / hs); a++) {
      const x = (a + wildHash(a, b, SEEDS.hachure)) * hs;
      const z = (b + wildHash(a, b, SEEDS.hachure + 1)) * hs;
      // Only a hachure long enough to reach into the tile, whose slope the grid holds.
      if (x < x0 - long || x > x0 + side + long || z < z0 - long || z > z0 + side + long || !inked(x, z, hs)) continue;
      const gx = (heightOf(x + 2 * step, z) - heightOf(x - 2 * step, z)) / (4 * step);
      const gz = (heightOf(x, z + 2 * step) - heightOf(x, z - 2 * step)) / (4 * step);
      const s = Math.hypot(gx, gz);
      if (!(s > 0.018)) continue;
      const shade = gx + gz < 0 ? 1 : 0.45;
      const strength = Math.min(1, (s - 0.018) / 0.05) * shade;
      if (wildHash(a, b, SEEDS.hachure + 2) > 0.35 + strength * 0.65) continue;
      const len = (3 + strength * 2.5) * scale * 0.5;
      const path = hachures[Math.min(2, Math.floor(strength * 3))] as Path2D;
      path.moveTo(x - (gx / s) * len, z - (gz / s) * len);
      path.lineTo(x + (gx / s) * len, z + (gz / s) * len);
    }
  }
  hachures.forEach((path, q) => {
    g.strokeStyle = `rgba(${inkRgb},${(0.2 + q * 0.13).toFixed(3)})`;
    g.lineWidth = (0.5 + q * 0.2) * unit;
    g.stroke(path);
  });

  // Grass: tufts where the golden steppe runs and a few on the green grass; stipple where the wild runs to scrub.
  // Near the land its own grass runs on, and the wild's marks thin away as its covers do.
  const ts = INK.tuft * scale;
  const tufts = [new Path2D(), new Path2D()];
  const stipple = new Path2D();
  for (let b = Math.floor(z0 / ts) - 1; b <= Math.ceil((z0 + side) / ts); b++) {
    for (let a = Math.floor(x0 / ts) - 1; a <= Math.ceil((x0 + side) / ts); a++) {
      const x = (a + wildHash(a, b, SEEDS.tuft)) * ts;
      const z = (b + wildHash(a, b, SEEDS.tuft + 1)) * ts;
      if (!inked(x, z, ts)) continue;
      const share = wildShare(t, x, z);
      if (share <= 0) continue;
      const patch = wildPatch(x, z);
      if (wildHash(a, b, SEEDS.tuft + 2) < (0.18 + patch * 0.62) * share) {
        const h = (1.7 + patch * 0.9) * scale;
        const blades = 3 + Math.floor(wildHash(a, b, SEEDS.tuft + 3) * 2);
        const path = tufts[patch > 0.5 ? 1 : 0] as Path2D;
        path.moveTo(x - h * 0.62, z);
        path.lineTo(x + h * 0.62, z);
        for (let q = 0; q < blades; q++) {
          const u = q / (blades - 1) - 0.5;
          const tall = h * (0.7 + wildHash(a + q, b, SEEDS.tuft + 4) * 0.5) * (1 - Math.abs(u) * 0.5);
          path.moveTo(x + u * h * 0.9, z);
          path.lineTo(x + u * h * 1.25, z - tall);
        }
      }
      const scrub = wildScrub(x, z);
      const dots = Math.round((scrub - 0.35) * 9 * share);
      for (let d = 0; d < dots; d++) {
        const dx = x + (wildHash(a, b, SEEDS.stipple + d) - 0.5) * ts;
        const dz = z + (wildHash(a, b, SEEDS.stipple + 20 + d) - 0.5) * ts;
        const r = 0.55 * scale * (0.7 + wildHash(a, b, SEEDS.stipple + 40 + d) * 0.6);
        stipple.moveTo(dx + r, dz);
        stipple.arc(dx, dz, r, 0, Math.PI * 2);
      }
    }
  }
  tufts.forEach((path, q) => {
    g.strokeStyle = `rgba(${inkRgb},${q === 0 ? 0.3 : 0.44})`;
    g.lineWidth = 0.5 * unit;
    g.stroke(path);
  });
  g.fillStyle = `rgba(${inkRgb},0.4)`;
  g.fill(stipple);
  yield;

  // Thickets: each bush where the world stands it, a crown scalloped in ink over the paper, its side away from the
  // light hatched and its shadow hatched to the southeast; never smaller than legible. Coarse levels draw only some
  // thickets' lead bushes.
  if (k <= INK.thickets) {
    const cell = WILD_THICKETS.cell;
    const pad = WILD_THICKETS.spread + 6 * scale;
    const shadows = new Path2D();
    const crowns: { crown: Path2D; x: number; y: number; r: number }[] = [];
    for (let cj = Math.floor((z0 - pad) / cell); cj <= Math.floor((z0 + side + pad) / cell); cj++) {
      for (let ci = Math.floor((x0 - pad) / cell); ci <= Math.floor((x0 + side + pad) / cell); ci++) {
        if (k === INK.thickets && wildHash(ci, cj, SEEDS.thicket) > 0.35) continue;
        const thicket = wildThicket(t, ci, cj);
        if (thicket === null) continue;
        const bushes = k === INK.thickets ? thicket.bushes.slice(0, 1) : thicket.bushes;
        for (const bush of bushes) {
          if (!inked(bush.x, bush.z, pad)) continue;
          const r = Math.max(2.4 * unit, 2.3 * bush.scale) * 1.25;
          const x = bush.x;
          const y = bush.z - r * 0.25;
          for (let h = 0; h < 4; h++) {
            const o = (h - 1.5) * r * 0.36;
            shadows.moveTo(x + r * 0.25 + o, y + r * 1.45);
            shadows.lineTo(x + r * 1.2 + o * 0.3, y + r * 0.7 + o * 0.15);
          }
          shadows.moveTo(x, y + r * 0.85);
          shadows.lineTo(x + r * 0.05, y + r * 1.4);
          const crown = new Path2D();
          const lobes = 6;
          const turn = bush.yaw;
          for (let l = 0; l <= lobes; l++) {
            const a = (l / lobes) * Math.PI * 2 + turn;
            const rr = r * (0.86 + hash(bush.seed * 97, l) * 0.24);
            const mid = a - Math.PI / lobes;
            if (l === 0) crown.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
            else crown.quadraticCurveTo(x + Math.cos(mid) * rr * 1.22, y + Math.sin(mid) * rr * 1.22, x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          }
          crown.closePath();
          crowns.push({ crown, x, y, r });
        }
      }
    }
    g.strokeStyle = `rgba(${inkRgb},0.42)`;
    g.lineWidth = 0.55 * unit;
    g.stroke(shadows);
    for (const { crown, x, y, r } of crowns) {
      g.fillStyle = style.paper;
      g.fill(crown);
      g.save();
      g.clip(crown);
      g.beginPath();
      for (let h = -3; h <= 3; h++) {
        const o = h * r * 0.32;
        g.moveTo(x + o + r * 0.1, y - r * 1.25);
        g.lineTo(x + o + r * 0.9, y + r * 0.85);
      }
      g.strokeStyle = `rgba(${inkRgb},0.4)`;
      g.lineWidth = 0.48 * unit;
      g.stroke();
      g.restore();
      g.strokeStyle = `rgba(${inkRgb},0.82)`;
      g.lineWidth = 0.75 * unit;
      g.stroke(crown);
    }
  }

  // The land's paint takes what it covers: the ink shows only where the paper is bare.
  if (x0 < reach && x0 + side > -reach && z0 < reach && z0 + side > -reach) {
    g.globalCompositeOperation = "destination-out";
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(sheet.paint, -reach, -reach, reach * 2, reach * 2);
    g.globalCompositeOperation = "source-over";
  }
  return canvas;
}

export interface WildInk {
  /** Lays the paper's ground under a view `w` by `h` css pixels, anchored to the world. */
  ground(ctx: CanvasRenderingContext2D, w: number, h: number, view: LandView): void;
  /**
   * Lays the wild's ink over a view `w` by `h` css pixels, at the one or two
   * levels nearest its zoom. A tile not yet inked is inked at once if `now`;
   * otherwise it is left out and inked in the page's idle time, and
   * `onLanded`'s listeners hear when it is ready.
   */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, view: LandView, now: boolean): void;
  /** Asks, nearest first, for the tiles views would lay: each its box in meters and its zoom. The earlier asks go first. */
  want(views: readonly { readonly box: readonly [number, number, number, number]; readonly zoom: number }[]): void;
  /** Inks one step of a tile asked for; false when none is waiting. */
  step(): boolean;
  /** Whether any tile is waiting to be inked. */
  readonly waiting: boolean;
  /** Calls `listener` when a tile a view went without has been inked. */
  onLanded(listener: () => void): void;
  /** Tiles kept, inked and waiting, the longest step, and tiles inked at once because a view could not wait. */
  stats(): { readonly tiles: number; readonly inked: number; readonly waiting: number; readonly longestStepMs: number; readonly atOnce: number; readonly atOnceMs: number };
}

/** The wild's ink for one painted sheet: `reach` is the land's painted square's half side and `paint` its paint (alpha). */
export function createWildInk(terrain: Terrain, style: MapStyle, reach: number, paint: HTMLCanvasElement): WildInk {
  const sheet: Sheet = {
    terrain,
    style,
    reach,
    paint,
    bare: (style.fade[1] + style.ragged * 1.7) * reach * 2,
    dpr: Math.min(2, window.devicePixelRatio || 1),
  };
  const kept = new Map<string, { readonly canvas: HTMLCanvasElement; used: number }>();
  /** Tiles asked for, nearest first, and the one being inked. */
  let queue: { k: number; i: number; j: number; key: string }[] = [];
  let inking: { key: string; steps: Generator<void, HTMLCanvasElement> } | null = null;
  /** Tiles a view went without, to tell `onLanded` when one lands. */
  const missed = new Set<string>();
  const landed: (() => void)[] = [];
  let clock = 0;
  const timing = { inked: 0, longestStepMs: 0, atOnce: 0, atOnceMs: 0 };
  const keyOf = (k: number, i: number, j: number): string => `${k}:${i}:${j}`;
  /** Whether a tile has any bare paper to ink: tiles deep inside the land's paint are never inked. */
  const bare = (k: number, i: number, j: number): boolean => {
    const side = tileMeters(k);
    const inner = reach - sheet.bare - INK.sample * 2 ** k * 2;
    return !(i * side > -inner && (i + 1) * side < inner && j * side > -inner && (j + 1) * side < inner);
  };
  /** The tiles a box needs at level `k`. */
  const tilesOf = (k: number, box: readonly [number, number, number, number]): { k: number; i: number; j: number; key: string }[] => {
    const side = tileMeters(k);
    const out: { k: number; i: number; j: number; key: string }[] = [];
    for (let j = Math.floor(box[1] / side); j <= Math.floor(box[3] / side); j++) {
      for (let i = Math.floor(box[0] / side); i <= Math.floor(box[2] / side); i++) if (bare(k, i, j)) out.push({ k, i, j, key: keyOf(k, i, j) });
    }
    return out;
  };
  /** The clock when the last view was laid: the tiles it laid are never forgotten, however many it took. */
  let laid = 0;
  const forget = (): void => {
    if (kept.size <= INK.keep) return;
    const oldest = [...kept.entries()].filter(([, t]) => t.used < laid).sort((a, b) => a[1].used - b[1].used).slice(0, kept.size - INK.keep);
    for (const [key] of oldest) kept.delete(key);
  };
  const inkNow = (k: number, i: number, j: number, key: string): HTMLCanvasElement => {
    const t0 = performance.now();
    const steps = inking?.key === key ? inking.steps : inkTile(sheet, k, i, j);
    let next = steps.next();
    while (next.done !== true) next = steps.next();
    if (inking?.key === key) inking = null;
    kept.set(key, { canvas: next.value, used: ++clock });
    timing.atOnce++;
    timing.atOnceMs += performance.now() - t0;
    forget();
    return next.value;
  };

  return {
    ground(ctx, w, h, view) {
      layGround(ctx, style, w / 2 - view.x * view.zoom, h / 2 - view.z * view.zoom, view.zoom, w, h);
    },
    draw(ctx, w, h, view, now) {
      laid = ++clock;
      const device = ctx.getTransform().a;
      const box: [number, number, number, number] = [view.x - w / 2 / view.zoom, view.z - h / 2 / view.zoom, view.x + w / 2 / view.zoom, view.z + h / 2 / view.zoom];
      // Tile edges fall on whole device pixels, so neighbors meet without a hairline.
      const snapX = (x: number): number => Math.round(((x - view.x) * view.zoom + w / 2) * device) / device;
      const snapZ = (z: number): number => Math.round(((z - view.z) * view.zoom + h / 2) * device) / device;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      for (const { k, weight } of levelsFor(view.zoom)) {
        const side = tileMeters(k);
        ctx.globalAlpha = weight;
        for (const tile of tilesOf(k, box)) {
          let found = kept.get(tile.key);
          if (found === undefined && now) found = { canvas: inkNow(tile.k, tile.i, tile.j, tile.key), used: 0 };
          if (found === undefined) {
            missed.add(tile.key);
            if (!queue.some((q) => q.key === tile.key)) queue.unshift(tile);
            continue;
          }
          found.used = ++clock;
          const x0 = snapX(tile.i * side);
          const y0 = snapZ(tile.j * side);
          ctx.drawImage(found.canvas, x0, y0, snapX((tile.i + 1) * side) - x0, snapZ((tile.j + 1) * side) - y0);
        }
      }
      ctx.restore();
    },
    want(views) {
      const asked: typeof queue = [];
      const seen = new Set<string>();
      for (const v of views) {
        const cx = (v.box[0] + v.box[2]) / 2;
        const cz = (v.box[1] + v.box[3]) / 2;
        for (const { k } of levelsFor(v.zoom)) {
          const side = tileMeters(k);
          const tiles = tilesOf(k, v.box).sort((a, b) => Math.hypot((a.i + 0.5) * side - cx, (a.j + 0.5) * side - cz) - Math.hypot((b.i + 0.5) * side - cx, (b.j + 0.5) * side - cz));
          for (const tile of tiles) {
            if (seen.has(tile.key)) continue;
            seen.add(tile.key);
            const found = kept.get(tile.key);
            if (found !== undefined) found.used = ++clock;
            else asked.push(tile);
          }
        }
      }
      // A tile a view is waiting for keeps its place at the front.
      queue = [...queue.filter((q) => missed.has(q.key) && !seen.has(q.key)), ...asked];
    },
    step() {
      if (inking === null) {
        const next = queue.shift();
        if (next === undefined) return false;
        if (kept.has(next.key)) return true;
        inking = { key: next.key, steps: inkTile(sheet, next.k, next.i, next.j) };
      }
      const t0 = performance.now();
      const result = inking.steps.next();
      timing.longestStepMs = Math.max(timing.longestStepMs, performance.now() - t0);
      if (result.done === true) {
        kept.set(inking.key, { canvas: result.value, used: ++clock });
        timing.inked++;
        const was = missed.delete(inking.key);
        inking = null;
        forget();
        if (was) for (const l of landed) l();
      }
      return true;
    },
    get waiting() {
      return inking !== null || queue.length > 0;
    },
    onLanded: (listener) => landed.push(listener),
    stats: () => ({ tiles: kept.size, inked: timing.inked, waiting: queue.length + (inking === null ? 0 : 1), longestStepMs: +timing.longestStepMs.toFixed(1), atOnce: timing.atOnce, atOnceMs: Math.round(timing.atOnceMs) }),
  };
}
