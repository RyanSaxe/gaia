// Draws the map's marks for trees, bushes, stones and flower drifts from their compositions, as `marks.ts` does for
// buildings, never from a kind name. A new combination of parts needs no new code, and a new primitive needs one entry
// in `PLANT_INKS`, which a contract test checks.
//
// A mark is drawn flat to the viewer at `s` pixels per meter of its build, lit from the northwest with a shadow to the
// southeast, and worn by vitality as its thing is in the world. Every copy of a build shares one drawing at each size
// and wear (`stampPlant`), so thousands of trees cost a few hundred drawings.

import type { Palette, Params, Resolved } from "@gaia/schema";
import {
  barkParams,
  blossomsParams,
  boulderParams,
  brambleParams,
  branchingParams,
  driftParams,
  fallenLogParams,
  fernParams,
  flatStoneParams,
  fruitParams,
  leafClumpsParams,
  leafMoundParams,
  leafStrandsParams,
  mossParams,
  mushroomParams,
  needlesParams,
  outcropParams,
  saplingParams,
  spireParams,
  stoneClusterParams,
  stumpParams,
  thicketParams,
} from "@gaia/primitives";
import {
  type Composition,
  INK,
  type MarkBox,
  PAPER,
  type Pen,
  type Pt,
  SHADE,
  type StampRoom,
  type Values,
  castShadow,
  clamp01,
  ease,
  ellipseFeet,
  hexOf,
  ink,
  mix,
  noise,
  penFor,
  rgba,
  seedOf,
  stamp,
  stampSet,
  trace,
  valuesOf,
  wash,
} from "./marks.ts";

/** A tree's, bush's, stone's or drift's composition and its build's size, which its mark is drawn from. */
export interface PlantComposition extends Composition {
  /** In meters at scale 1, the build's height, its radius, and the height of its lowest leaves (0 for none). */
  readonly height: number;
  readonly radius: number;
  readonly crown: number;
}

/** How a mark wears at its shown vitality, matching its thing in the world. */
interface Growth {
  readonly v: number;
  /** How much foliage or how many flowers remain, from 1 (all) to 0. */
  readonly leaf: number;
  /** How far its colors have moved toward their decline colors, from 0 to 1. */
  readonly dry: number;
  readonly seed: number;
}

const growthOf = (v: number, seed: number): Growth => ({ v, leaf: ease(v, 0.04, 0.6), dry: 1 - ease(v, 0.28, 0.95), seed });

/** Swatch colors for the mark: the palette's healthy color, mixed toward its decline color as `dry` rises. */
interface Hues {
  readonly g: Growth;
  of(name: string, fallback: string): string;
}

const huesOf = (palette: Palette, g: Growth): Hues => ({
  g,
  of: (name, fallback) => {
    const s = palette.swatches[name];
    if (s === undefined) return fallback;
    return mix(mix(hexOf(s.healthy), PAPER, 0.04), hexOf(s.decline), g.dry * 0.92);
  },
});

/** A foliage lobe, flat to the viewer: `dx` meters right of the base, `h` up, with radius `r`. */
type Lobe = readonly [number, number, number];

/** A woody stroke from the ground up: points flat to the viewer in meters, and its width at the base (`foot`) and the tip. */
interface Bough {
  readonly pts: readonly Pt[];
  readonly foot: number;
  readonly tip: number;
}

/** A conifer's or tiered sapling's ring of limbs, lowest first: its height, half-span, rise, and how far its tips droop below it. */
interface Tier {
  readonly h: number;
  readonly half: number;
  readonly rise: number;
  readonly droop: number;
}

/** A plant's frame: its wood, the lobes its foliage fills, and its whorls if it has them. */
interface Frame {
  readonly wood: readonly Bough[];
  readonly lobes: readonly Lobe[];
  readonly tiers: readonly Tier[];
  /** Whether the crown hangs from one trunk (a tree or a sapling) or rises from many stems at the ground. */
  readonly trunk: boolean;
}

/** A build's height and radius in meters at scale 1, and the height of its lowest leaves. */
interface Size {
  readonly height: number;
  readonly radius: number;
  readonly crown: number;
}

/** The drawing context passed to a part's ink. */
interface Brush {
  readonly pen: Pen;
  readonly hues: Hues;
  /** How much fine work shows, from 0 on a mark a few pixels tall to 1 on one large enough to read it. */
  readonly detail: number;
  readonly seed: number;
}

interface SkeletonInk<V = Values> {
  readonly role: "Skeleton";
  frame(p: V, size: Size, seed: number): Frame;
}
interface SurfaceInk<V = Values> {
  readonly role: "Surface";
  /** The fine work on a trunk or stem, between its wash and the foliage. */
  texture(b: Brush, bough: Bough, p: V): void;
}
interface FoliageInk<V = Values> {
  readonly role: "Foliage";
  /** Draws the foliage on the frame and returns the lobes still in leaf, where a bloom hangs. */
  draw(b: Brush, frame: Frame, p: V, size: Size): readonly Lobe[];
}
interface OrnamentInk<V = Values> {
  readonly role: "Ornament";
  draw(b: Brush, lobes: readonly Lobe[], p: V): void;
}
interface RockInk<V = Values> {
  readonly role: "Rock";
  /** Draws the stone or wood and returns the tops moss would grow on. */
  draw(b: Brush, size: Size, p: V): readonly Lobe[];
}
interface OvergrowthInk<V = Values> {
  readonly role: "Overgrowth";
  draw(b: Brush, tops: readonly Lobe[], p: V): void;
}
interface DriftInk<V = Values> {
  readonly role: "Drift";
  draw(b: Brush, size: Size, p: V): void;
}
/** A part the map does not draw, such as how a thing moves in the wind, or one that only gives the others their colors. */
interface UnseenInk {
  readonly role: "Motion" | "Palette";
}

export type PlantInk = SkeletonInk | SurfaceInk | FoliageInk | OrnamentInk | RockInk | OvergrowthInk | DriftInk | UnseenInk;

// Each helper types an entry's drawing by its own primitive's parameters.
const skeleton = <P extends Params>(_: P, ink: Omit<SkeletonInk<Resolved<P>>, "role">): SkeletonInk => ({ role: "Skeleton", ...ink }) as unknown as SkeletonInk;
const surface = <P extends Params>(_: P, ink: Omit<SurfaceInk<Resolved<P>>, "role">): SurfaceInk => ({ role: "Surface", ...ink }) as unknown as SurfaceInk;
const foliage = <P extends Params>(_: P, ink: Omit<FoliageInk<Resolved<P>>, "role">): FoliageInk => ({ role: "Foliage", ...ink }) as unknown as FoliageInk;
const ornament = <P extends Params>(_: P, ink: Omit<OrnamentInk<Resolved<P>>, "role">): OrnamentInk => ({ role: "Ornament", ...ink }) as unknown as OrnamentInk;
const rock = <P extends Params>(_: P, ink: Omit<RockInk<Resolved<P>>, "role">): RockInk => ({ role: "Rock", ...ink }) as unknown as RockInk;
const overgrowth = <P extends Params>(_: P, ink: Omit<OvergrowthInk<Resolved<P>>, "role">): OvergrowthInk => ({ role: "Overgrowth", ...ink }) as unknown as OvergrowthInk;
const drift = <P extends Params>(_: P, ink: Omit<DriftInk<Resolved<P>>, "role">): DriftInk => ({ role: "Drift", ...ink }) as unknown as DriftInk;

// ---------------------------------------------------------------------------------------------------------------
// Drawing helpers shared by the inks, flat to the viewer, in meters from the base.

const up = (b: Brush, [dx, h]: Pt): Pt => b.pen.up(dx, h);

/** A woody stroke, tapering from its foot to its tip, outlined in ink and washed in `color`. */
function bough(b: Brush, w: Bough, color: string, inked = true): void {
  const { ctx, s } = b.pen;
  const pts = w.pts.map((p) => up(b, p));
  const n = pts.length - 1;
  for (const [extra, c] of inked ? ([[b.pen.line * 1.3, INK], [0, color]] as const) : ([[0, color]] as const)) {
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pts[i] as Pt;
      const [bx, by] = pts[i + 1] as Pt;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineWidth = Math.max(0.6, (w.foot + (w.tip - w.foot) * ((i + 0.5) / n)) * s) + extra;
      ctx.strokeStyle = c;
      ctx.stroke();
    }
  }
}

/** The union of round lobes as one path. Each lobe grows the mark's box. */
function lobesPath(b: Brush, lobes: readonly Lobe[], squash = 1): Path2D {
  const path = new Path2D();
  for (const [dx, h, r] of lobes) {
    const [px, py] = up(b, [dx, h]);
    const R = r * b.pen.s;
    b.pen.reach(px, py, R);
    path.moveTo(px + R, py);
    path.ellipse(px, py, R, R * squash, 0, 0, Math.PI * 2);
  }
  return path;
}

/** Draws a crown of lobes in `color`, inked around its outline only, shaded to the southeast and lit on the northwest. */
function crown(b: Brush, lobes: readonly Lobe[], color: string, opts: { squash?: number; scallop?: number; light?: number } = {}): void {
  if (lobes.length === 0) return;
  const { ctx } = b.pen;
  const squash = opts.squash ?? 1;
  const path = lobesPath(b, lobes, squash);
  ctx.lineWidth = b.pen.line * 1.5;
  ctx.strokeStyle = INK;
  ctx.stroke(path);
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  const shade = new Path2D();
  const light = new Path2D();
  for (const [dx, h, r] of lobes) {
    const [px, py] = up(b, [dx, h]);
    const R = r * b.pen.s;
    shade.moveTo(px + R * 1.25, py + R * 0.5 * squash);
    shade.ellipse(px + R * 0.25, py + R * 0.5 * squash, R, R * squash, 0, 0, Math.PI * 2);
    light.moveTo(px - R * 0.3 + R * 0.5, py - R * 0.38 * squash);
    light.ellipse(px - R * 0.3, py - R * 0.38 * squash, R * 0.5, R * 0.5 * squash, 0, 0, Math.PI * 2);
  }
  ctx.fillStyle = rgba(SHADE, 0.19);
  ctx.fill(shade);
  ctx.fillStyle = rgba("#eef4b8", (opts.light ?? 0.32) * (1 - b.hues.g.dry * 0.6));
  ctx.fill(light);
  // A scallop of ink where lobes meet, as fine work.
  const scallop = (opts.scallop ?? 0.45) * b.detail;
  if (scallop > 0.02) {
    ctx.beginPath();
    for (const [dx, h, r] of lobes) {
      const [px, py] = up(b, [dx, h]);
      const R = r * b.pen.s;
      ctx.moveTo(px - R * 0.7, py + R * 0.72 * squash);
      ctx.ellipse(px, py, R, R * squash, 0, Math.PI * 0.78, Math.PI * 0.25, true);
    }
    ctx.lineWidth = b.pen.line * 0.55;
    ctx.strokeStyle = rgba(INK, scallop);
    ctx.stroke();
  }
  ctx.restore();
}

/** The lobes still in leaf. Each lobe shrinks away as `g.leaf` drops below its own seeded threshold. */
function kept(lobes: readonly Lobe[], g: Growth, full: number): Lobe[] {
  return lobes
    .map(([dx, h, r], k): Lobe => [dx, h, r * full * clamp01((g.leaf - noise(g.seed, k + 700) * 0.6) / 0.4) * (0.82 + 0.18 * g.leaf)])
    .filter((l) => l[2] > 0.04);
}

/** Small dots at seeded spots over the upper, outer side of each lobe: blossoms, berries, fruit. */
function dots(b: Brush, lobes: readonly Lobe[], each: number, radius: number, color: string, seed: number, edge = INK): Pt[] {
  const { ctx } = b.pen;
  const out: Pt[] = [];
  lobes.forEach(([dx, h, r], k) => {
    const n = Math.round(each * (0.6 + noise(seed, k) * 0.8));
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (1.05 + noise(seed, k * 31 + i) * 0.9);
      const d = r * (0.45 + noise(seed, k * 17 + i + 5) * 0.5);
      out.push(up(b, [dx + Math.cos(a) * d * 1.05, h - Math.sin(a) * d]));
    }
  });
  const R = Math.max(0.55, radius * b.pen.s);
  ctx.beginPath();
  for (const [px, py] of out) {
    b.pen.reach(px, py, R);
    ctx.moveTo(px + R, py);
    ctx.arc(px, py, R, 0, Math.PI * 2);
  }
  ctx.fillStyle = color;
  ctx.fill();
  if (b.detail > 0.3) {
    ctx.lineWidth = b.pen.line * 0.45;
    ctx.strokeStyle = rgba(edge, 0.55 * b.detail);
    ctx.stroke();
  }
  return out;
}

/** A soft wash on the paper where a low thing grows, so a drift reads as a patch even where its plants are specks. */
function patch(b: Brush, rx: number, rz: number, color: string, alpha: number): void {
  const feet = ellipseFeet(0, 0, rx, rz, 0).map(([X, Z]) => b.pen.at(X, Z, 0));
  wash(b.pen, feet, rgba(color, alpha), 2);
}

// ---------------------------------------------------------------------------------------------------------------
// Frames.

/** Lobes for a crown of half-width `w` and half-height `ht` centered `hc` up: one central lobe and a ring of `n` over the top. */
function crownLobes(n: number, w: number, ht: number, hc: number, seed: number, droop = 0): Lobe[] {
  const r = Math.max(0.3, Math.min(w, ht) * (n <= 5 ? 0.56 : n <= 7 ? 0.5 : 0.44));
  const lobes: Lobe[] = [[0, hc + ht * 0.12, r * 1.12]];
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0.5 : k / (n - 1);
    const a = Math.PI * (1.08 - t * 1.16) + (noise(seed, k + 40) - 0.5) * 0.3;
    const x = Math.cos(a) * Math.max(0, w - r * 0.9);
    // A weeping crown's outer lobes hang low beside it.
    const fall = droop * (1 - Math.sin(Math.max(0, a))) * ht * 1.1;
    lobes.push([x, hc + Math.sin(a) * Math.max(0, ht - r * 0.9) - fall, r * (0.86 + noise(seed, k + 60) * 0.3)]);
  }
  return lobes;
}

/** Limbs from the top of a trunk out to each lobe, arching higher where the crown weeps. */
function limbsTo(lobes: readonly Lobe[], from: Pt, width: number, weep = 0): Bough[] {
  return lobes.slice(1).map(([dx, h]) => {
    const mid: Pt = [from[0] + dx * 0.5, Math.max(from[1], h) + weep * Math.abs(dx) * 0.6];
    return { pts: [from, mid, [dx * 0.82, h - (h - from[1]) * 0.15]], foot: width, tip: width * 0.25 };
  });
}

const HABIT_FORM: Readonly<Record<string, { base: number; wide: number; droop: number }>> = {
  upright: { base: 0.36, wide: 1, droop: 0 },
  spreading: { base: 0.3, wide: 1, droop: 0.1 },
  weeping: { base: 0.34, wide: 1, droop: 0.75 },
  columnar: { base: 0.18, wide: 0.9, droop: 0 },
};

function branchingFrame(p: Resolved<typeof branchingParams>, { height: H, radius: R, crown }: Size, seed: number): Frame {
  const habit = HABIT_FORM[p.habit] ?? (HABIT_FORM.upright as NonNullable<(typeof HABIT_FORM)[string]>);
  // The crown starts where the build's leaves begin. If the leaves hang near the ground, as strands do, the habit sets the crown's base instead.
  const base = crown > H * 0.12 ? Math.min(crown, H * 0.7) : H * habit.base;
  const ht = (H - base) / 2;
  const hc = base + ht;
  const w = R * habit.wide;
  const n = Math.round(p.density) * 2 + 1;
  const lobes = crownLobes(n, w, ht, hc, seed, habit.droop);
  const girth = Math.min(1.1, Math.max(0.14, 0.05 * H + 0.04 * R));
  const lean = (noise(seed, 3) - 0.5) * girth;
  const head: Pt = [lean, base + ht * 0.35];
  const trunk: Bough = { pts: [[0, 0], [lean * 0.5, base * 0.6], head], foot: girth * 1.25, tip: girth * 0.75 };
  return { wood: [trunk, ...limbsTo(lobes, head, girth * 0.42, habit.droop)], lobes, tiers: [], trunk: true };
}

function spireFrame(p: Resolved<typeof spireParams>, { height: H, radius: R, crown }: Size): Frame {
  const n = Math.max(3, Math.min(9, Math.round(p.whorls * 0.75)));
  const foot = Math.min(H * 0.5, Math.max(H * 0.04, crown));
  const rise = ((H - foot) / n) * 1.35;
  const tiers: Tier[] = Array.from({ length: n }, (_, k) => {
    const t = k / n;
    return { h: foot + (H - foot) * t, half: R * (1 - t) ** 0.85, rise, droop: p.droop * rise };
  });
  const girth = Math.min(0.8, Math.max(0.1, 0.035 * H));
  const trunk: Bough = { pts: [[0, 0], [0, H]], foot: girth * 1.3, tip: girth * 0.25 };
  // Bare whorls: limbs out to each tier's span, as on a fir that has lost its needles.
  const whorls = tiers.flatMap((t): Bough[] => [-1, 1].map((side) => ({ pts: [[0, t.h + t.rise * 0.2], [side * t.half * 0.9, t.h - t.droop * 0.8]], foot: girth * 0.35, tip: girth * 0.1 })));
  // Leaves on a spire fill its cone: a lobe up the trunk at each whorl and one out along each side.
  const lobes = tiers.flatMap((t): Lobe[] => {
    const r = Math.max(0.25, Math.min(t.half * 0.5, t.rise * 0.75));
    return [[0, t.h + t.rise * 0.45, Math.max(r, t.half * 0.45)], [-t.half * 0.55, t.h + t.rise * 0.2, r], [t.half * 0.55, t.h + t.rise * 0.2, r]];
  });
  return { wood: [trunk, ...whorls], lobes, tiers, trunk: true };
}

function saplingFrame(p: Resolved<typeof saplingParams>, { height: H, radius: R }: Size, seed: number): Frame {
  const leanX = p.habit === "leaning" ? H * 0.22 : 0;
  const n = Math.max(2, Math.round(p.tiers));
  const tiers: Tier[] = Array.from({ length: n }, (_, k) => {
    const t = (k + 1) / (n + 1);
    const half = R * (p.habit === "reaching" ? 0.55 : 1) * (1 - t * 0.6) * (0.8 + noise(seed, k) * 0.4);
    return { h: H * (0.25 + 0.7 * t), half, rise: (H / (n + 1)) * 0.8, droop: p.habit === "tiered" ? 0.06 * H : 0 };
  });
  const at = (h: number): number => leanX * (h / H) ** 1.4;
  const stem: Bough = { pts: [[0, 0], [at(H * 0.5), H * 0.5], [at(H), H]], foot: Math.max(0.03, 0.025 * H), tip: 0.015 };
  const shoots = tiers.flatMap((t): Bough[] => [-1, 1].map((side) => ({ pts: [[at(t.h), t.h], [at(t.h) + side * t.half, t.h + (p.habit === "reaching" ? t.half * 0.9 : -t.droop)]], foot: 0.025, tip: 0.01 })));
  const lobes = tiers.flatMap((t): Lobe[] => [-1, 1].map((side) => [at(t.h) + side * t.half * 0.6, t.h + t.rise * 0.2, Math.max(0.12, t.half * 0.45)]));
  lobes.unshift([at(H), H * 0.93, Math.max(0.12, R * 0.3)]);
  return { wood: [stem, ...shoots], lobes, tiers, trunk: true };
}

const THICKET_FORM: Readonly<Record<string, { wide: number; base: number; flare: number }>> = {
  mound: { wide: 1, base: 0.08, flare: 0.5 },
  spreading: { wide: 1.15, base: 0.05, flare: 0.8 },
  vase: { wide: 0.85, base: 0.4, flare: 1 },
  scrub: { wide: 1, base: 0.15, flare: 0.7 },
};

function thicketFrame(p: Resolved<typeof thicketParams>, { height: H, radius: R }: Size, seed: number): Frame {
  const form = THICKET_FORM[p.habit] ?? (THICKET_FORM.mound as NonNullable<(typeof THICKET_FORM)[string]>);
  const n = Math.max(3, Math.min(9, Math.round(p.stems)));
  const stems: Bough[] = Array.from({ length: n }, (_, k) => {
    const t = n === 1 ? 0 : k / (n - 1) - 0.5;
    const top: Pt = [t * 2 * R * form.wide * 0.8, H * (0.75 + noise(seed, k) * 0.22) * (1 - Math.abs(t) * 0.35)];
    return { pts: [[t * R * 0.15, 0], [top[0] * form.flare * 0.6, top[1] * 0.55], top], foot: 0.04, tip: 0.015 };
  });
  const ht = (H * (1 - form.base)) / 2;
  const lobes = crownLobes(p.habit === "scrub" ? 4 : 6, R * form.wide, ht, H * form.base + ht, seed);
  // Skirt lobes bring the leaves down to the soil around the stems, except on a vase or scrub habit, whose stems show bare.
  const skirt = form.base < 0.2 ? 4 : 0;
  const r = Math.max(0.12, Math.min(R, H) * 0.4);
  for (let k = 0; k < skirt; k++) lobes.push([(k / (skirt - 1) - 0.5) * 2 * (R * form.wide - r), r * 0.95, r * (0.9 + noise(seed, k + 90) * 0.25)]);
  return { wood: stems, lobes, tiers: [], trunk: false };
}

function brambleFrame(p: Resolved<typeof brambleParams>, { height: H, radius: R }: Size, seed: number): Frame {
  const n = Math.max(3, Math.min(9, Math.round(p.canes)));
  const canes: Bough[] = [];
  const lobes: Lobe[] = [];
  for (let k = 0; k < n; k++) {
    const side = noise(seed, k) < 0.5 ? -1 : 1;
    const x0 = (noise(seed, k + 10) - 0.5) * R * 0.4;
    const x1 = side * R * (0.5 + noise(seed, k + 20) * 0.5);
    const top = H * (0.65 + noise(seed, k + 30) * 0.35);
    const mid: Pt = [x0 + (x1 - x0) * 0.4, top];
    const pts: Pt[] = [[x0, 0], [x0 + (x1 - x0) * 0.15, top * 0.75], mid, [x0 + (x1 - x0) * 0.75, top * 0.7], [x1, 0.05]];
    canes.push({ pts, foot: 0.035, tip: 0.015 });
    // Leaves cover the whole cane, from the soil up over the arch and back down.
    const r = Math.max(0.12, H * 0.2);
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ah] = pts[i] as Pt;
      const [bx, bh] = pts[i + 1] as Pt;
      for (const u of i === 0 ? [0.55, 1] : [0.5, 1]) lobes.push([ax + (bx - ax) * u, Math.max(r * 0.8, ah + (bh - ah) * u), r * (0.85 + noise(seed, k * 9 + i) * 0.3)]);
    }
  }
  return { wood: canes, lobes, tiers: [], trunk: false };
}

// ---------------------------------------------------------------------------------------------------------------
// Foliage.

/** Regroups a crown's lobes by leaf shape: soft clouds, flat layered plates, or loose tufts at the twigs. */
function gathered(lobes: readonly Lobe[], shape: string, seed: number): Lobe[] {
  if (shape === "tufts") {
    return lobes.flatMap(([dx, h, r], k): Lobe[] =>
      [0, 1, 2].map((i): Lobe => {
        const a = noise(seed, k * 7 + i) * Math.PI * 2;
        return [dx + Math.cos(a) * r * 0.55, h + Math.sin(a) * r * 0.5, r * 0.42];
      }),
    );
  }
  return [...lobes];
}

/** Draws lobes with a spiked outline, as a spray of needles reads from a distance. */
function spiky(b: Brush, lobes: readonly Lobe[], color: string): void {
  const { ctx } = b.pen;
  const path = new Path2D();
  for (const [dx, h, r] of lobes) {
    const [px, py] = up(b, [dx, h]);
    const R = r * b.pen.s;
    b.pen.reach(px, py, R);
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = i % 2 === 0 ? R : R * 0.8;
      const x = px + Math.cos(a) * rr;
      const y = py + Math.sin(a) * rr;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
  }
  ctx.lineWidth = b.pen.line * 1.3;
  ctx.strokeStyle = INK;
  ctx.stroke(path);
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  ctx.fillStyle = rgba(SHADE, 0.22);
  ctx.beginPath();
  for (const [dx, h, r] of lobes) {
    const [px, py] = up(b, [dx, h]);
    const R = r * b.pen.s;
    ctx.moveTo(px + R * 1.2, py + R * 0.45);
    ctx.arc(px + R * 0.2, py + R * 0.45, R, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}

/** Draws a conifer's whorls lowest first, each a wedge of needles with drooping or lifted tips, so each tier overlaps the one below. */
function tiers(b: Brush, ts: readonly Tier[], color: string, full: number): void {
  const g = b.hues.g;
  ts.forEach((t, k) => {
    const left = noise(b.seed, k + 300);
    // Needles drop from the lowest whorls first.
    const share = clamp01((g.leaf - (1 - k / Math.max(1, ts.length)) * 0.35 - left * 0.15) / 0.5);
    if (share < 0.05) return;
    const half = t.half * (0.55 + 0.45 * share) * (0.85 + 0.15 * full);
    const pts = [up(b, [-half, t.h - t.droop]), up(b, [-half * 0.35, t.h + t.rise * 0.55]), up(b, [0, t.h + t.rise]), up(b, [half * 0.35, t.h + t.rise * 0.55]), up(b, [half, t.h - t.droop]), up(b, [0, t.h + t.rise * 0.08])];
    wash(b.pen, pts, color);
    ink(b.pen, pts, true, 1.1);
    // Lights the northwest half of each tier.
    wash(b.pen, [pts[0] as Pt, pts[1] as Pt, pts[2] as Pt, pts[5] as Pt], rgba("#eef4b8", 0.22 * (1 - g.dry * 0.6)));
  });
}

/**
 * Draws strands hanging from a dome down to `hem` meters, like the great willow's: tapering tresses side by side
 * across the dome. As `leaf` drops below each strand's own threshold, it shortens and thins to a bare whip.
 */
function strands(b: Brush, lobes: readonly Lobe[], hem: number, color: string, full: number): void {
  if (lobes.length === 0) return;
  const { ctx } = b.pen;
  const g = b.hues.g;
  const left = Math.min(...lobes.map(([dx, , r]) => dx - r));
  const right = Math.max(...lobes.map(([dx, , r]) => dx + r));
  const span = right - left;
  const n = Math.round(7 + 6 * full);
  const tresses = new Path2D();
  const whips = new Path2D();
  for (let k = 0; k < n; k++) {
    const dx = left + ((k + 0.5) / n) * span;
    // Each hangs from the center height of the highest lobe over it, or from the dome's lowest lobe at its edges.
    const over = lobes.filter(([lx, , r]) => Math.abs(dx - lx) < r);
    const top = over.length > 0 ? Math.max(...over.map(([, h]) => h)) : Math.min(...lobes.map(([, h]) => h));
    const reach = (top - hem) * (0.88 + noise(b.seed, k + 800) * 0.12);
    const cover = clamp01((g.leaf - noise(b.seed, k + 810) * 0.5) / 0.4);
    const [tx, ty] = up(b, [dx, top]);
    const [wx, wy] = up(b, [dx * 1.06, top - reach * (0.45 + 0.55 * Math.max(cover, 0.3))]);
    whips.moveTo(tx, ty);
    whips.quadraticCurveTo(wx - Math.sign(dx) * b.pen.s * 0.2, (ty + wy) / 2, wx, wy);
    b.pen.reach(wx, wy);
    if (cover < 0.05) continue;
    const wd = (span / n) * (0.7 + 0.35 * full) * (0.55 + 0.45 * cover) * b.pen.s * 0.5;
    const [bx, by] = up(b, [dx * 1.06, top - reach * (0.35 + 0.65 * cover)]);
    b.pen.reach(bx - wd, by, wd);
    b.pen.reach(bx + wd, by, wd);
    tresses.moveTo(tx - wd, ty);
    tresses.lineTo(tx + wd, ty);
    tresses.quadraticCurveTo(bx + wd * 0.9, (ty + by) / 2, bx + wd * 0.35, by - wd * 0.35);
    tresses.arc(bx, by - wd * 0.35, wd * 0.35, 0, Math.PI, false);
    tresses.quadraticCurveTo(bx - wd * 0.9, (ty + by) / 2, tx - wd, ty);
    tresses.closePath();
  }
  // Draws the bare whips first, so the tresses cover them while leaves remain.
  ctx.lineWidth = Math.max(0.5, b.pen.line * 0.7);
  ctx.strokeStyle = mix(b.hues.of("bark", "#6d533a"), INK, 0.3);
  ctx.stroke(whips);
  ctx.lineWidth = b.pen.line * 1.4;
  ctx.strokeStyle = INK;
  ctx.stroke(tresses);
  ctx.fillStyle = mix(color, "#fff4d6", 0.06);
  ctx.fill(tresses);
  ctx.save();
  ctx.clip(tresses);
  // Shades the eastern part of the curtain, as the crown's lobes are shaded to the southeast.
  ctx.fillStyle = rgba(SHADE, 0.16);
  const [sx, sy] = up(b, [left + span * 0.55, hem]);
  const [ex, ey] = up(b, [right, Math.max(...lobes.map(([, h, r]) => h + r))]);
  ctx.fillRect(sx, ey, ex - sx, sy - ey);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------
// Stones and old wood, drawn as they lie: a face toward the viewer and a top seen a little from above.

/** Draws a rounded stone `w` meters wide and `h` tall at (`dx`, 0), with a seeded outline. Returns its top as a lobe. */
function stone(b: Brush, dx: number, w: number, h: number, sharp: number, lean: number, color: string, seed: number): Lobe {
  const n = Math.round(14 - sharp * 7);
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI * (i / n);
    const wob = 1 + (noise(seed, i + 3) - 0.5) * 0.22 * (0.5 + sharp);
    const x = dx - Math.cos(a) * (w / 2) * wob + lean * Math.sin(a) * h * 0.3;
    pts.push(up(b, [x, Math.sin(a) ** (0.8 + 0.3 * (1 - sharp)) * h * wob]));
  }
  // Its base sinks a little below the ground line.
  pts.push(up(b, [dx + w * 0.42, -h * 0.06]), up(b, [dx - w * 0.42, -h * 0.06]));
  const round = (1 - sharp) * 3;
  wash(b.pen, pts, color, round);
  // Shades its southeast side and lights its northwest shoulder.
  const { ctx } = b.pen;
  ctx.save();
  trace(ctx, pts, true, round);
  ctx.clip();
  const [cx, cy] = up(b, [dx + w * 0.28, h * 0.25]);
  ctx.fillStyle = rgba(SHADE, 0.26);
  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.5 * b.pen.s, h * 0.75 * b.pen.s, 0, 0, Math.PI * 2);
  ctx.fill();
  const [lx, ly] = up(b, [dx - w * 0.2, h * 0.75]);
  ctx.fillStyle = rgba("#fff6dc", 0.32 * (1 - b.hues.g.dry * 0.4));
  ctx.beginPath();
  ctx.ellipse(lx, ly, w * 0.24 * b.pen.s, h * 0.2 * b.pen.s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ink(b.pen, pts, true, 1.2, INK, round);
  // A crack opens as vitality falls from 0.55 to 0.15.
  const crack = ease(b.hues.g.v, 0.55, 0.15);
  if (crack > 0.05) {
    const c = [up(b, [dx - w * 0.1, h * 0.95]), up(b, [dx + w * 0.02, h * 0.6]), up(b, [dx - w * 0.06, h * (0.95 - crack * 0.75)])];
    ink(b.pen, c, false, 0.7 * crack);
  }
  return [dx - w * 0.05, h * 0.85, w * 0.42];
}

const stoneHue = (b: Brush): string => b.hues.of("stone", "#a8a296");

/** Draws a log's or stump's end where it is cut or snapped: pale wood, with a ring on a sawn face. */
function endFace(b: Brush, at: Pt, rx: number, ry: number, sawn: boolean, seed: number): void {
  const [px, py] = up(b, at);
  const { ctx } = b.pen;
  const wood = b.hues.of("wood", "#c9ab84");
  if (sawn) {
    ctx.beginPath();
    ctx.ellipse(px, py, rx * b.pen.s, ry * b.pen.s, 0, 0, Math.PI * 2);
    b.pen.reach(px, py, rx * b.pen.s);
    ctx.fillStyle = wood;
    ctx.fill();
    ctx.lineWidth = b.pen.line;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (b.detail > 0.2) {
      ctx.beginPath();
      ctx.ellipse(px, py, rx * 0.55 * b.pen.s, ry * 0.55 * b.pen.s, 0, 0, Math.PI * 2);
      ctx.lineWidth = b.pen.line * 0.45;
      ctx.strokeStyle = rgba(INK, 0.5 * b.detail);
      ctx.stroke();
    }
    return;
  }
  const n = 7;
  const pts: Pt[] = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const jag = i % 2 === 0 ? 1 : 0.55 + noise(seed, i) * 0.3;
    return [px + Math.cos(a) * rx * b.pen.s * jag, py + Math.sin(a) * ry * b.pen.s * jag] as Pt;
  });
  for (const [x, y] of pts) b.pen.reach(x, y);
  wash(b.pen, pts, wood);
  ink(b.pen, pts, true, 0.9);
}

// ---------------------------------------------------------------------------------------------------------------
// Drifts: many small plants over a spread on the ground, drawn from the back of the spread to the front.

/** Positions of a drift's plants in meters east and north of its center, farthest first. */
function plantsOver(rx: number, count: number, seed: number, ring = false): [number, number][] {
  const spots: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const a = noise(seed, i * 2 + 1) * Math.PI * 2;
    const d = ring ? 0.75 + noise(seed, i * 2 + 2) * 0.25 : Math.sqrt(noise(seed, i * 2 + 2));
    spots.push([Math.cos(a) * d * rx, Math.sin(a) * d * rx * 0.85]);
  }
  return spots.sort((p, q) => q[1] - p[1]);
}

/** Draws a stem about `h` meters tall at each spot, with a head drawn by `head` at its top. */
function stems(b: Brush, spots: readonly [number, number][], h: number, stemColor: string, head: (top: Pt, i: number) => void): void {
  const { ctx } = b.pen;
  spots.forEach(([X, Z], i) => {
    const foot = b.pen.at(X, Z, 0);
    const top = b.pen.at(X + (noise(b.seed, i + 80) - 0.5) * h * 0.25, Z, h * (0.8 + noise(b.seed, i + 90) * 0.4));
    ctx.beginPath();
    ctx.moveTo(foot[0], foot[1]);
    ctx.lineTo(top[0], top[1]);
    ctx.lineWidth = Math.max(0.5, b.pen.line * 0.5);
    ctx.strokeStyle = stemColor;
    ctx.stroke();
    head(top, i);
  });
}

/** How many plants a drift shows, by its density and spread: fewer as vitality falls, and at most 40 so they never blur. */
const drifted = (b: Brush, density: number, rx: number): number => Math.max(4, Math.round(Math.min(40, (7 + rx * 12) * density) * (0.3 + 0.7 * b.hues.g.leaf)));

function dot(b: Brush, [x, y]: Pt, r: number, color: string, edge = false): void {
  const { ctx } = b.pen;
  const R = Math.max(0.5, r * b.pen.s);
  b.pen.reach(x, y, R);
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (edge && b.detail > 0.25) {
    ctx.lineWidth = b.pen.line * 0.4;
    ctx.strokeStyle = rgba(INK, 0.6 * b.detail);
    ctx.stroke();
  }
}

function flowerDrift(b: Brush, { height, radius }: Size, p: Resolved<typeof driftParams>, head: (b: Brush, top: Pt, r: number, i: number) => void): void {
  const rx = Math.max(0.3, radius);
  patch(b, rx * 1.05, rx * 0.9, b.hues.of("stem", "#6f9a3c"), 0.22 + 0.12 * p.density);
  const spots = plantsOver(rx, drifted(b, p.density, rx), b.seed);
  // A head is at least 1.5 pixels across, so the drift's color shows when its plants are specks, and its radius is at
  // most 0.3 of the drift's.
  const r = Math.min(rx * 0.3, Math.max(0.75 / b.pen.s, Math.min(0.2, height * 0.2)));
  stems(b, spots, Math.max(0.1, height * 0.8), rgba(b.hues.of("stem", "#6f9a3c"), 0.75), (top, i) => head(b, top, r, i));
}

// ---------------------------------------------------------------------------------------------------------------
// The table: how the map inks every part of a tree, a bush, a stone or a drift.

const FOLIAGE_FULL = (fullness: number): number => 0.78 + 0.32 * fullness;

export const PLANT_INKS: Readonly<Record<string, PlantInk>> = {
  "branching@1": skeleton(branchingParams, { frame: branchingFrame }),
  "spire@1": skeleton(spireParams, { frame: (p, size) => spireFrame(p, size) }),
  "sapling@1": skeleton(saplingParams, { frame: saplingFrame }),
  "thicket@1": skeleton(thicketParams, { frame: thicketFrame }),
  "bramble@1": skeleton(brambleParams, { frame: brambleFrame }),
  "bark@1": surface(barkParams, {
    texture: (b, w, p) => {
      // Furrows down a thick trunk, drawn only where the trunk is at least 3 pixels wide.
      const furrows = p.roughness * b.detail;
      if (furrows < 0.05 || w.foot * b.pen.s < 3) return;
      const { ctx } = b.pen;
      const [a, z] = [w.pts[0] as Pt, w.pts[w.pts.length - 1] as Pt];
      ctx.beginPath();
      for (const u of [-0.25, 0.15]) {
        const [ax, ay] = up(b, [a[0] + u * w.foot, a[1] + 0.1]);
        const [zx, zy] = up(b, [z[0] + u * w.tip, z[1]]);
        ctx.moveTo(ax, ay);
        ctx.lineTo(zx, zy);
      }
      ctx.lineWidth = b.pen.line * 0.5;
      ctx.strokeStyle = rgba(INK, 0.5 * furrows);
      ctx.stroke();
    },
  }),
  "leaf-clumps@1": foliage(leafClumpsParams, {
    draw: (b, frame, p) => {
      const lobes = kept(gathered(frame.lobes, p.shape, b.seed), b.hues.g, FOLIAGE_FULL(p.fullness) * (0.9 + 0.1 * p.size));
      const leaf = b.hues.of("leaf", "#7fae4a");
      const color = p.leaf === "blossom" ? mix(b.hues.of("bloom", "#f4e6ea"), leaf, 0.25) : leaf;
      crown(b, lobes, color, { squash: p.shape === "plates" ? 0.5 : 1, scallop: p.leaf === "lobed" ? 0.7 : p.leaf === "pointed" ? 0.3 : 0.45 });
      return lobes;
    },
  }),
  "leaf-strands@1": foliage(leafStrandsParams, {
    draw: (b, frame, p, size) => {
      const lobes = kept(frame.lobes, b.hues.g, 0.9);
      const leaf = b.hues.of("leaf", "#8fb04a");
      // The curtain hangs down to the build's lowest leaves (`size.crown`).
      strands(b, lobes, Math.max(0.05, size.crown), leaf, p.fullness);
      crown(b, lobes, leaf, { scallop: 0.3, light: 0.25 });
      return lobes;
    },
  }),
  "needles@1": foliage(needlesParams, {
    draw: (b, frame, p) => {
      const color = mix(b.hues.of("leaf", "#3f7a48"), SHADE, 0.1);
      if (frame.tiers.length > 0 && frame.trunk) {
        tiers(b, frame.tiers.map((t) => ({ ...t, rise: t.rise * (0.85 + 0.2 * p.length) })), color, p.fullness);
        return [];
      }
      const lobes = kept(frame.lobes, b.hues.g, 0.75 + 0.3 * p.fullness);
      spiky(b, lobes, color);
      return lobes;
    },
  }),
  "leaf-mound@1": foliage(leafMoundParams, {
    draw: (b, frame, p) => {
      const lobes = kept(frame.lobes, b.hues.g, 0.66 + 0.4 * p.fullness);
      const leaf = b.hues.of("leaf", "#6f9a48");
      if (p.leaves === "feathery") spiky(b, lobes, mix(leaf, "#fff4d6", 0.08));
      else crown(b, lobes, p.leaves === "glossy" ? mix(leaf, SHADE, 0.15) : leaf, { light: p.leaves === "glossy" ? 0.45 : 0.3 });
      return lobes;
    },
  }),
  "blossoms@1": ornament(blossomsParams, {
    draw: (b, lobes, p) => {
      const show = b.hues.g.leaf * (0.35 + 0.9 * p.count);
      if (show < 0.05) return;
      const r = Math.max(0.06, Math.min(0.22, (lobes[0]?.[2] ?? 1) * 0.1));
      if (p.form === "berries") dots(b, lobes, 2.5 * show, r * 0.75, b.hues.of("berry", "#3e1a3c"), b.seed + 1, "#000000");
      else if (p.form === "pods") dots(b, lobes, 1.6 * show, r * 1.05, mix(b.hues.of("bloom", "#f2b84b"), "#fff6dc", 0.2), b.seed + 2);
      else dots(b, lobes, 3 * show, r * 0.85, b.hues.of("bloom", "#f4f1e6"), b.seed + 3);
    },
  }),
  "fruit@1": ornament(fruitParams, {
    draw: (b, lobes, p) => {
      const show = b.hues.g.leaf * (0.4 + 0.8 * p.crop);
      if (show < 0.05) return;
      const r = Math.max(0.12, Math.min(0.3, (lobes[0]?.[2] ?? 1) * 0.12));
      const at = dots(b, lobes, 1.8 * show, r, b.hues.of("fruit", "#d2553a"), b.seed + 4);
      if (p.fruit === "pears" && b.detail > 0.3) {
        // A pear's narrow neck above its round body.
        for (const [x, y] of at) dot(b, [x, y - r * b.pen.s * 0.9], r * 0.6, b.hues.of("fruit", "#dcc24e"));
      }
    },
  }),
  "sway@1": { role: "Motion" },
  "palette@1": { role: "Palette" },
  "boulder@1": rock(boulderParams, {
    draw: (b, { height, radius }, p) => {
      const shape = { round: [1, 0], egg: [0.75, 0], wide: [1.25, 0], lopsided: [1, 0.45] }[p.shape] ?? [1, 0];
      return [stone(b, 0, radius * 1.9 * (shape[0] as number), height, p.facets, shape[1] as number, stoneHue(b), b.seed)];
    },
  }),
  "flat-stone@1": rock(flatStoneParams, {
    draw: (b, { height, radius }, p) => {
      const color = stoneHue(b);
      const w = radius * 1.9;
      const h = Math.max(0.12, height);
      const tilt = p.top === "tilted" ? 0.35 : 0;
      const face = [up(b, [-w / 2, 0]), up(b, [-w / 2, h * (1 - tilt)]), up(b, [w / 2, h * (1 + tilt)]), up(b, [w / 2, 0])];
      const back = h * 0.55 + w * 0.12;
      const top = [face[1] as Pt, up(b, [-w * 0.38, h * (1 - tilt) + back]), up(b, [w * 0.6, h * (1 + tilt) + back]), face[2] as Pt];
      wash(b.pen, face, mix(color, SHADE, 0.22), 1 - p.facets);
      wash(b.pen, top, mix(color, "#fff6dc", 0.12), 1 - p.facets);
      ink(b.pen, face, true, 1.1);
      ink(b.pen, top, true, 1.1);
      if (p.top === "stepped") {
        const step = [up(b, [w * 0.05, h * 1.4]), up(b, [w * 0.15, h * 1.4 + back]), up(b, [w * 0.6, h * 1.4 + back]), up(b, [w / 2, h * 1.4])];
        wash(b.pen, [...step, up(b, [w / 2, h]), up(b, [w * 0.05, h])], mix(color, "#fff6dc", 0.06));
        ink(b.pen, [...step, up(b, [w / 2, h]), up(b, [w * 0.05, h])], true, 1);
      }
      return [[0.05 * w, h + back * 0.5, w * 0.4]];
    },
  }),
  "stone-cluster@1": rock(stoneClusterParams, {
    draw: (b, { height, radius }, p) => {
      const n = Math.max(2, Math.min(9, Math.round(p.count)));
      const color = stoneHue(b);
      const tops: Lobe[] = [];
      // One large stone at the center and smaller ones around it, drawn in a seeded order.
      const order = Array.from({ length: n }, (_, k) => k).sort((a, c) => noise(b.seed, a + 50) - noise(b.seed, c + 50));
      for (const k of order) {
        const big = k === 0 ? 1 : 0.4 + noise(b.seed, k + 70) * 0.35;
        const dx = k === 0 ? 0 : (noise(b.seed, k + 90) - 0.5) * radius * 1.7;
        tops.push(stone(b, dx, radius * 0.9 * big, height * big, p.facets, 0, mix(color, PAPER, k === 0 ? 0 : 0.06), b.seed + k * 13));
      }
      return tops;
    },
  }),
  "outcrop@1": rock(outcropParams, {
    draw: (b, { height, radius }, p) => {
      // A ledge seen from a little above: a lit top band over a front face in half shade.
      const color = stoneHue(b);
      const w = radius * 2;
      const h = Math.max(0.2, height);
      const d = Math.min(radius * 0.3, 1.2);
      const n = 9;
      const rise = (i: number): number => h * Math.sin(Math.PI * (i / n)) ** 0.6 * (0.75 + noise(b.seed, i) * 0.4);
      const X = (i: number): number => -w / 2 + (w * i) / n;
      const front = Array.from({ length: n + 1 }, (_, i) => b.pen.at(X(i), -d, rise(i)));
      const back = Array.from({ length: n + 1 }, (_, i) => b.pen.at(X(i) + w * 0.02, d, rise(i) * 0.9)).reverse();
      const foot = Array.from({ length: n + 1 }, (_, i) => b.pen.at(X(i), -d, -0.05)).reverse();
      const round = p.layering === "blocky" ? 0 : 2;
      const face = [...front, ...foot];
      const top = [...front, ...back];
      wash(b.pen, face, mix(color, SHADE, 0.24), round);
      wash(b.pen, top, mix(color, "#fff6dc", 0.14), round);
      // Layering on the front face: bedding lines along it, or joints across it.
      const { ctx } = b.pen;
      if (b.detail > 0.1 && p.layering !== "massive") {
        ctx.beginPath();
        if (p.layering === "layered") {
          for (const u of [0.35, 0.65]) front.forEach(([fx, fy], i) => {
            const gy = (b.pen.at(X(i), -d, 0) as Pt)[1];
            const y = fy + (gy - fy) * u;
            if (i === 0) ctx.moveTo(fx, y);
            else ctx.lineTo(fx, y);
          });
        } else {
          for (const i of [2, 4, 7]) {
            const [fx, fy] = front[i] as Pt;
            const [gx, gy] = b.pen.at(X(i), -d, 0);
            ctx.moveTo(fx, fy);
            ctx.lineTo(gx, gy);
          }
        }
        ctx.lineWidth = b.pen.line * 0.6;
        ctx.strokeStyle = rgba(INK, 0.55 * b.detail);
        ctx.stroke();
      }
      ink(b.pen, face, true, 1.1, INK, round);
      ink(b.pen, back, false, 0.9, INK);
      return [[-w * 0.18, h * 0.95, w * 0.2], [w * 0.16, h * 0.9, w * 0.18]];
    },
  }),
  "fallen-log@1": rock(fallenLogParams, {
    draw: (b, { radius }, p) => {
      const bark = mix(b.hues.of("bark", "#6d533a"), "#3b3028", ease(b.hues.g.v, 0.5, 0.1) * 0.5);
      const L = Math.max(p.length * 0.5, radius * 1.8) / 2;
      const g = p.girth;
      const body = [up(b, [-L, 0]), up(b, [-L, g * 2]), up(b, [L, g * 2.1]), up(b, [L, 0.02])];
      for (const pt of body) b.pen.reach(pt[0], pt[1]);
      const stubs = Math.round(p.boughs * (0.4 + 0.6 * b.hues.g.v));
      for (let i = 0; i < stubs; i++) {
        const x = -L * 0.7 + (L * 1.4 * (i + 0.5)) / Math.max(1, stubs);
        bough(b, { pts: [[x, g * 1.9], [x + g * 0.6, g * 3.2]], foot: g * 0.35, tip: g * 0.18 }, bark);
      }
      wash(b.pen, body, bark, g * b.pen.s);
      ink(b.pen, body, true, 1.1, INK, g * b.pen.s);
      endFace(b, [-L, g], g * 0.55, g * 1.0, p.ends !== "broken", b.seed);
      endFace(b, [L, g * 1.05], g * 0.55, g * 1.0, p.ends === "sawn", b.seed + 1);
      return [[0, g * 2, L * 0.6]];
    },
  }),
  "stump@1": rock(stumpParams, {
    draw: (b, { radius }, p) => {
      const bark = mix(b.hues.of("bark", "#6d533a"), "#3b3028", ease(b.hues.g.v, 0.5, 0.1) * 0.5);
      const r = Math.max(0.15, radius * 0.55);
      const h = p.height;
      const roots = Math.round(1 + p.roots * 2);
      for (let i = 0; i < roots; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        bough(b, { pts: [[side * r * 0.6, h * 0.35], [side * r * (1.2 + i * 0.2), 0.02]], foot: r * 0.35, tip: r * 0.12 }, bark);
      }
      const body = [up(b, [-r, 0]), up(b, [-r * 0.92, h]), up(b, [r * 0.92, h]), up(b, [r, 0])];
      wash(b.pen, body, bark);
      ink(b.pen, body, true, 1.1);
      endFace(b, [0, h], r * 0.92, r * 0.34, p.top === "sawn", b.seed);
      return [[0, h, r * 0.8]];
    },
  }),
  "moss@1": overgrowth(mossParams, {
    draw: (b, tops, p) => {
      const color = b.hues.of("moss", "#5f8a3e");
      const amount = p.cover * (0.6 + 0.4 * b.hues.g.leaf);
      if (amount < 0.05) return;
      for (const [dx, h, r] of tops) {
        if (p.growth === "lichen") {
          for (let i = 0; i < 4; i++) dot(b, up(b, [dx + (noise(b.seed, i) - 0.5) * r * 1.4, h - noise(b.seed, i + 9) * r * 0.5]), r * 0.12 * amount + 0.03, mix(color, "#e8e4c8", 0.55));
          continue;
        }
        // Moss caps the stone's top, larger as `amount` rises.
        const lobes: Lobe[] = (p.growth === "cushions" ? [-0.5, 0, 0.5] : [0]).map((u, i) => [dx + u * r, h + (noise(b.seed, i) - 0.5) * r * 0.1, r * (p.growth === "cushions" ? 0.45 : 0.95) * (0.55 + 0.45 * amount)]);
        crown(b, lobes, color, { squash: p.growth === "velvet" ? 0.42 : 0.62, scallop: 0, light: 0.25 });
      }
    },
  }),
  "daisies@1": drift(driftParams, {
    draw: (b, size, p) =>
      flowerDrift(b, size, p, (b, top, r, i) => {
        if (noise(b.seed, i + 400) > b.hues.g.leaf + 0.15) return;
        dot(b, top, r, b.hues.of("bloom", "#f4f1e6"), true);
        if (b.detail > 0.4) dot(b, top, r * 0.4, b.hues.of("eye", "#f0c43c"));
      }),
  }),
  "cups@1": drift(driftParams, {
    draw: (b, size, p) =>
      flowerDrift(b, size, p, (b, [x, y], r, i) => {
        if (noise(b.seed, i + 400) > b.hues.g.leaf + 0.15) return;
        const R = Math.max(0.9, r * b.pen.s * 1.25);
        const cup = [[x - R, y - R * 0.5], [x - R * 0.6, y + R * 0.6], [x + R * 0.6, y + R * 0.6], [x + R, y - R * 0.5]] as Pt[];
        for (const [px, py] of cup) b.pen.reach(px, py);
        wash(b.pen, cup, b.hues.of("bloom", "#d2553a"), R * 0.5);
        if (b.detail > 0.4) dot(b, [x, y], r * 0.3, b.hues.of("eye", "#3a2a20"));
      }),
  }),
  "bells@1": drift(driftParams, {
    draw: (b, size, p) =>
      flowerDrift(b, size, p, (b, [x, y], r, i) => {
        if (noise(b.seed, i + 400) > b.hues.g.leaf + 0.15) return;
        // A stem arching over, with bells hanging below the arch.
        const R = r * b.pen.s;
        const { ctx } = b.pen;
        const side = noise(b.seed, i + 420) < 0.5 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + side * R * 1.6, y - R * 1.4, x + side * R * 2.6, y + R * 0.4);
        b.pen.reach(x + side * R * 1.6, y - R * 1.4);
        b.pen.reach(x + side * R * 2.6, y + R * 0.4);
        ctx.lineWidth = Math.max(0.5, b.pen.line * 0.5);
        ctx.strokeStyle = rgba(b.hues.of("stem", "#4f8a48"), 0.8);
        ctx.stroke();
        for (const u of [0.45, 0.75, 1]) dot(b, [x + side * R * 2.6 * u, y - R * 0.9 * Math.sin(u * Math.PI * 0.8) + R * 0.9], r * 0.75, b.hues.of("bloom", "#8088dc"));
      }),
  }),
  "spikes@1": drift(driftParams, {
    draw: (b, size, p) =>
      flowerDrift(b, size, p, (b, [x, y], r, i) => {
        if (noise(b.seed, i + 400) > b.hues.g.leaf + 0.15) return;
        const { ctx } = b.pen;
        const R = r * b.pen.s;
        // The floret spike is at most three head radii long and at most 0.6 of the plant's height, however wide the head is drawn.
        const long = Math.min(R * 3, size.height * 0.6 * b.pen.s);
        b.pen.reach(x, y - long - R * 0.2, R);
        b.pen.reach(x, y + R * 0.5, R);
        ctx.beginPath();
        ctx.moveTo(x, y + R * 0.5);
        ctx.lineTo(x, y - long);
        ctx.lineWidth = Math.max(0.9, R * 1.3);
        ctx.lineCap = "round";
        ctx.strokeStyle = b.hues.of("bloom", "#8088dc");
        ctx.stroke();
      }),
  }),
  "ferns@1": drift(fernParams, {
    draw: (b, { height, radius }, p) => {
      const rx = Math.max(0.3, radius);
      const color = b.hues.of("stem", "#4f8a48");
      patch(b, rx, rx * 0.85, color, 0.25);
      const crowns = plantsOver(rx * 0.7, Math.max(2, Math.round(rx * 2.2)), b.seed);
      const { ctx } = b.pen;
      const h = Math.max(0.2, height) * (0.5 + 0.5 * p.unroll) * (0.45 + 0.55 * b.hues.g.leaf);
      const n = Math.max(3, Math.min(8, Math.round(p.fronds * 0.6)));
      for (const [X, Z] of crowns) {
        const foot = b.pen.at(X, Z, 0);
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const a = Math.PI * (0.12 + (0.76 * k) / Math.max(1, n - 1));
          const tip: Pt = [foot[0] + Math.cos(a) * h * 1.3 * b.pen.s, foot[1] - Math.sin(a) * h * b.pen.s];
          const bend: Pt = [foot[0] + Math.cos(a) * h * 0.5 * b.pen.s, foot[1] - h * 1.05 * b.pen.s];
          b.pen.reach(tip[0], tip[1]);
          b.pen.reach(bend[0], bend[1]);
          ctx.moveTo(foot[0], foot[1]);
          ctx.quadraticCurveTo(bend[0], bend[1], tip[0], tip[1]);
        }
        ctx.lineWidth = Math.max(0.8, b.pen.line * 1.1);
        ctx.strokeStyle = mix(color, INK, 0.1);
        ctx.stroke();
      }
    },
  }),
  "mushrooms@1": drift(mushroomParams, {
    draw: (b, { height, radius }, p) => {
      const rx = Math.max(0.2, radius);
      patch(b, rx, rx * 0.85, b.hues.of("stem", "#6f9a3c"), 0.18);
      const count = Math.max(3, Math.round((p.grouping === "scatter" ? 4 : 7) * (0.4 + 0.6 * b.hues.g.leaf)));
      const spots = p.grouping === "cluster" ? plantsOver(rx * 0.35, count, b.seed) : plantsOver(rx, count, b.seed, p.grouping === "ring");
      const h = Math.max(0.05, height);
      const cap = b.hues.of("cap", "#cc9e66");
      const stalk = b.hues.of("stalk", "#f2e8d0");
      const { ctx } = b.pen;
      spots.forEach(([X, Z], i) => {
        const foot = b.pen.at(X, Z, 0);
        const top = b.pen.at(X, Z, h * (0.7 + noise(b.seed, i + 5) * 0.5));
        ctx.beginPath();
        ctx.moveTo(foot[0], foot[1]);
        ctx.lineTo(top[0], top[1]);
        ctx.lineWidth = Math.max(0.7, h * 0.18 * b.pen.s);
        ctx.strokeStyle = stalk;
        ctx.stroke();
        const R = Math.max(0.9, h * 0.45 * b.pen.s);
        const H2 = p.cap === "pointed" ? R * 1.3 : p.cap === "flat" ? R * 0.35 : R * 0.75;
        const capPts: Pt[] = p.cap === "pointed" ? [[top[0] - R * 0.8, top[1]], [top[0], top[1] - H2], [top[0] + R * 0.8, top[1]]] : Array.from({ length: 9 }, (_, k) => [top[0] - Math.cos((k / 8) * Math.PI) * R, top[1] - Math.sin((k / 8) * Math.PI) * H2] as Pt);
        for (const [px, py] of capPts) b.pen.reach(px, py);
        wash(b.pen, capPts, cap);
        ink(b.pen, capPts, true, 0.8);
        if (b.detail > 0.4) dot(b, [top[0] - R * 0.25, top[1] - H2 * 0.5], h * 0.06, b.hues.of("spot", cap));
      });
    },
  }),
};

// ---------------------------------------------------------------------------------------------------------------
// Drawing a whole thing from its slots.

/** Returns the slot whose ink fills `role`, with its ink and values. */
function slotOf<R extends PlantInk["role"]>(plant: PlantComposition, role: R): { ink: Extract<PlantInk, { role: R }>; p: Values } | undefined {
  for (const slot of Object.values(plant.blueprint.slots)) {
    const entry = PLANT_INKS[slot.use];
    if (entry?.role === role) return { ink: entry as Extract<PlantInk, { role: R }>, p: valuesOf(slot.use, slot.params) };
  }
  return undefined;
}

/**
 * Draws a tree, bush, stone or drift with its base on the ground at (x, y), at `s` pixels per meter of its build, worn
 * by its shown `vitality`. Returns the box it took.
 */
export function drawPlant(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, plant: PlantComposition, vitality = 1): MarkBox {
  const seed = seedOf(plant.blueprint.id);
  const g = growthOf(vitality, seed);
  const hues = huesOf(plant.palette, g);
  const span = Math.max(plant.height, plant.radius * 2) * s;
  // Sets the ink width from the mark's size on the sheet rather than from `s`, so a small stone zoomed in is not swamped by its outline.
  const pen: Pen = { ...penFor(ctx, x, y, s), line: Math.max(0.5, Math.min(2.2, 0.42 + 0.012 * span)) };
  const m = ctx.getTransform();
  const b: Brush = { pen, hues, detail: ease(span * Math.hypot(m.a, m.b), 18, 56), seed };
  const size: Size = { height: plant.height, radius: plant.radius, crown: plant.crown };
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const frameSlot = slotOf(plant, "Skeleton");
  const rockSlot = slotOf(plant, "Rock");
  const driftSlot = slotOf(plant, "Drift");
  if (frameSlot !== undefined) {
    const frame = frameSlot.ink.frame(frameSlot.p, size, seed);
    const leafy = g.leaf;
    castShadow(pen, ellipseFeet(plant.radius * 0.1, -plant.radius * 0.1, plant.radius * 0.8 * (0.45 + 0.55 * leafy), plant.radius * 0.55 * (0.45 + 0.55 * leafy), plant.height * 0.8), 0.45 + 0.5 * leafy);
    const bark = slotOf(plant, "Surface");
    const wood = hues.of("bark", "#6d533a");
    for (const w of frame.wood) {
      bough(b, w, wood, frame.trunk || leafy < 0.5);
      bark?.ink.texture(b, w, bark.p);
    }
    const crownSlot = slotOf(plant, "Foliage");
    const lobes = crownSlot?.ink.draw(b, frame, crownSlot.p, size) ?? [];
    const bloom = slotOf(plant, "Ornament");
    if (bloom !== undefined && lobes.length > 0) bloom.ink.draw(b, lobes, bloom.p);
  } else if (rockSlot !== undefined) {
    castShadow(pen, ellipseFeet(0, 0, plant.radius * 0.9, plant.radius * 0.6, plant.height * 0.7), 0.7);
    const tops = rockSlot.ink.draw(b, size, rockSlot.p);
    const moss = slotOf(plant, "Overgrowth");
    moss?.ink.draw(b, tops, moss.p);
  } else if (driftSlot !== undefined) {
    driftSlot.ink.draw(b, size, driftSlot.p);
  }
  ctx.restore();
  return [...pen.box];
}

/** Stamps round shown vitality to eighths. Drawings one step apart look the same on the paper. */
const WEAR_STEPS = 8;
/** The plant stamp cache, capped at 48 MiB of bitmaps with least recently used eviction. */
const PLANT_STAMPS = stampSet(Number.POSITIVE_INFINITY, 48 * 2 ** 20);

/** The area in meters around its base that a plant's mark is drawn into before its stamp is cropped, with room for its crown or spread and its shadow to the southeast. */
export const plantRoom = ({ height, radius }: Pick<Size, "height" | "radius">): StampRoom => {
  const side = radius * 1.5 + 1;
  // A spread on the ground extends about 0.4 of its radius up and down the sheet.
  const above = height * 1.15 + radius * 0.4 + 1;
  return { width: side * 2 + height * 0.45, height: above + radius * 0.5 + height * 0.15 + 1, footX: side, footY: above };
};

/** Stamps a plant's mark as `drawPlant` draws it. Every copy of a build at one size and wear shares one drawing. */
export function stampPlant(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, plant: PlantComposition, vitality = 1): MarkBox {
  const v = Math.round(clamp01(vitality) * WEAR_STEPS) / WEAR_STEPS;
  return stamp(ctx, x, y, s, `p|${plant.blueprint.id}|${v}`, (c, fx, fy, ks) => drawPlant(c, fx, fy, ks, plant, v), PLANT_STAMPS, plantRoom(plant));
}
