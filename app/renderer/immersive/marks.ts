// The map's marks for buildings and landmarks, each drawn from its own composition and never chosen by name. A
// building's mark is its realized plan seen from above: every mass (the body, a wing, a porch, a lean-to, a turret)
// drawn back to front at the plan's own size, its walls and roofs inked as the primitive in each slot says and
// washed in the palette's colors, its features drawn by their own primitives, and one wear rule for every mass. A
// landmark's mark is drawn from its primitive's own words: a tower's plan, profile, galleries and crown; the stones'
// arrangement; a great tree's form and age. So a new combination of primitives draws with no new code, and a new
// primitive needs one entry in `INKS`, which a contract test asks for.
//
// Every mark is one ink drawing over watercolor washes, seen from the south-southwest and a little above and lit
// from the northwest: west faces and the upper left of roofs and crowns catch the light, south faces fall into a
// cool half shade, and a soft shadow lies on the paper to the southeast. A unit is about a pixel on the whole sheet
// at s = 1. Nothing here depends on where the mark is on the screen, so a mark never changes as the map moves.

import type { Blueprint, BuildingPlan, Mass, Opening, Palette, Params, Resolved, RoofForm, Rgb } from "@gaia/schema";
import {
  PRIMITIVES,
  casementsParams,
  cottageGardenParams,
  fieldstoneParams,
  greatTreeParams,
  lookoutTowerParams,
  standingStonesParams,
  thatchParams,
  tilesParams,
  timberFrameParams,
  towerParams,
  waterwheelParams,
} from "@gaia/primitives";

type Pt = readonly [number, number];
/** A point east, north and up from the thing's foot, in units. */
type P3 = readonly [number, number, number];

const INK = "#3a2f22";
/** What a wash fades toward as its thing tires: dry straw on the paper. */
const FADED = "#cdbf9c";
/** The sheet's own paper, which every wash lets show through a little. */
const PAPER = "#efe5cb";
/** The cool violet that shade leans toward, as the map shades its hills. */
const SHADE = "#4a4660";
/** The warm light on a lit face. */
const LIGHT = "#fff4d6";
const GLASS = "#3f3a36";
/** The dark inside a broken roof or wall. */
const HOLLOW = "rgba(44,34,25,0.86)";

/** Units a meter on a building's mark: a unit is `MARK_METERS` of land, so close in a building stands at the land's own size. */
const K = 1.5;
/** Units a meter on a landmark's mark, a little under the land's own size, so a soaring tower stays a mark. */
const LK = 1.15;
/** Floor to floor, meters, as a plan lays out its storeys. */
const STOREY = 2.3;
/** How much taller a roof is drawn than it stands: a little steeper, as a mapmaker draws it, so its covering carries the mark. */
const ROOF_LIFT = 1.25;

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const clamp = (t: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, t));
/** 0 at `a` and 1 at `b`, eased; `a` may lie above `b`. */
const ease = (v: number, a: number, b: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** A number in [0, 1) from a seed and an index, the same every time. */
const noise = (seed: number, i: number): number => {
  const n = Math.sin(seed * 91.3458 + i * 47.853 + 0.5) * 43758.5453;
  return n - Math.floor(n);
};
const seedOf = (text: string): number => {
  let h = 2166136261;
  for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 16777619);
  return (h >>> 0) / 4294967296;
};

const rgbOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hexOf = (c: Rgb): string => `#${c.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("")}`;
/** The color `t` of the way from `a` to `b`, as hex. */
const mix = (a: string, b: string, t: number): string => {
  const pa = rgbOf(a);
  const pb = rgbOf(b);
  const k = clamp01(t);
  return `#${pa.map((c, i) => Math.round(c + ((pb[i] as number) - c) * k).toString(16).padStart(2, "0")).join("")}`;
};
const rgba = (hex: string, a: number): string => `rgba(${rgbOf(hex).join(",")},${a.toFixed(3)})`;
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** How a mark is worn by its vitality: each from 0 (sound) to 1 (gone). */
interface Wear {
  readonly v: number;
  /** Washes dried toward straw. */
  readonly dry: number;
  /** A roof rotted through from its weak corner. */
  readonly rot: number;
  /** A wall broken down at the weak corner. */
  readonly breach: number;
  /** Ivy and moss taking the walls. */
  readonly ivy: number;
  /** How strongly the chimney smokes, from 0 (cold) to 1. */
  readonly smoke: number;
  readonly seed: number;
}

function wearOf(v: number, seed: number): Wear {
  return {
    v,
    dry: 1 - ease(v, 0.22, 0.86),
    rot: ease(v, 0.62, 0.05),
    breach: ease(v, 0.3, 0.03),
    ivy: ease(v, 0.68, 0.1),
    smoke: ease(v, 0.32, 0.9),
    seed,
  };
}

/** A wash's color as its thing wears: fading toward straw, and, for a roof, darkening with rot. */
const worn = (c: string, w: Wear, rots = 0): string => mix(mix(mix(c, PAPER, 0.12), FADED, w.dry * 0.72), "#6a5f4b", w.rot * rots);
const shaded = (c: string, t = 0.2): string => mix(c, SHADE, t);
const lit = (c: string, t = 0.2): string => mix(c, LIGHT, t);

interface Pen {
  readonly ctx: CanvasRenderingContext2D;
  readonly s: number;
  /** The ink's width in pixels. */
  readonly line: number;
  /** How strongly fine work (timbers, courses, joints) shows: it fades out as a unit shrinks from 2.2 to 1.2 device pixels, so a small mark keeps a clean silhouette. */
  readonly fine: number;
  /** Where a point east, north and up from the foot falls on the sheet. */
  at(X: number, Z: number, H: number): Pt;
  /** A point `dx` units right of the foot and `h` up on the sheet itself, for what is drawn flat to the eye, as a tree's crown is. */
  up(dx: number, h: number): Pt;
  /** Takes a round thing `r` pixels across at (`px`, `py`) on the sheet into the box. */
  reach(px: number, py: number, r?: number): void;
  /** The box every point placed so far falls in, in pixels: left, top, right, bottom. */
  readonly box: [number, number, number, number];
}

/** The view: east runs right and a little up, north runs up and to the left. `lean` tips the thing east as it rises. */
function penFor(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, lean = 0): Pen {
  const m = ctx.getTransform();
  const device = s * Math.hypot(m.a, m.b);
  const box: [number, number, number, number] = [x, y, x, y];
  const seen = (px: number, py: number): Pt => {
    box[0] = Math.min(box[0], px);
    box[1] = Math.min(box[1], py);
    box[2] = Math.max(box[2], px);
    box[3] = Math.max(box[3], py);
    return [px, py];
  };
  return {
    ctx,
    s,
    line: 0.5 + 0.36 * s,
    fine: ease(device, 1.2, 2.2),
    box,
    at: (X, Z, H) => {
      const e = X + lean * H;
      return seen(x + (e * 0.92 - Z * 0.42) * s, y + (-e * 0.14 - Z * 0.38 - H) * s);
    },
    up: (dx, h) => seen(x + dx * s, y - h * s),
    reach: (px, py, r = 0) => {
      seen(px - r, py - r);
      seen(px + r, py + r);
    },
  };
}

const on = (pen: Pen, pts: readonly P3[]): Pt[] => pts.map(([X, Z, H]) => pen.at(X, Z, H));

/** A path through `pts`; a closed one may round its corners by `round` pixels, as plump thatch is. */
function trace(ctx: CanvasRenderingContext2D, pts: readonly Pt[], close = true, round = 0): void {
  ctx.beginPath();
  if (close && round > 0 && pts.length > 2) {
    // Each corner's curve meets its edges within the nearer half of the shorter one, so a short edge or a sharp
    // corner never throws the curve wide.
    const p = pts.filter((q, i) => {
      const next = pts[(i + 1) % pts.length] as Pt;
      return Math.hypot(q[0] - next[0], q[1] - next[1]) > 0.05;
    });
    const n = p.length;
    if (n < 3) {
      trace(ctx, pts, close);
      return;
    }
    const mid = (i: number): Pt => lerp(p[i % n] as Pt, p[(i + 1) % n] as Pt, 0.5);
    const start = mid(n - 1);
    ctx.moveTo(start[0], start[1]);
    for (let i = 0; i < n; i++) {
      const q = p[i] as Pt;
      const before = p[(i + n - 1) % n] as Pt;
      const after = p[(i + 1) % n] as Pt;
      const v1: Pt = [before[0] - q[0], before[1] - q[1]];
      const v2: Pt = [after[0] - q[0], after[1] - q[1]];
      const l1 = Math.hypot(v1[0], v1[1]);
      const l2 = Math.hypot(v2[0], v2[1]);
      const angle = Math.acos(clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2), -1, 1));
      const r = Math.min(round, 0.45 * Math.min(l1, l2) * Math.tan(angle / 2));
      const [qx, qy] = mid(i);
      ctx.arcTo(q[0], q[1], qx, qy, r);
    }
    ctx.closePath();
    return;
  }
  pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  if (close) ctx.closePath();
}

/** Washes a shape, the brush a touch off the pen's line to the southeast as a hand's is. */
function wash(pen: Pen, pts: readonly Pt[], color: string, round = 0): void {
  const d = 0.22 * pen.s;
  trace(pen.ctx, pts.map(([px, py]) => [px + d, py + d * 0.8] as Pt), true, round);
  pen.ctx.fillStyle = color;
  pen.ctx.fill();
}

function ink(pen: Pen, pts: readonly Pt[], close = true, weight = 1, color = INK, round = 0): void {
  if (weight <= 0) return;
  trace(pen.ctx, pts, close, round);
  pen.ctx.lineWidth = pen.line * weight;
  pen.ctx.strokeStyle = color;
  pen.ctx.stroke();
}

function face(pen: Pen, pts: readonly P3[], color: string, weight = 1, round = 0): Pt[] {
  const p = on(pen, pts);
  wash(pen, p, color, round);
  ink(pen, p, true, weight, INK, round);
  return p;
}

/** Fine lines in the drawing (timbers, courses, joints): thin, and in a lighter ink. */
function hatch(pen: Pen, lines: readonly (readonly P3[])[], color: string, weight = 0.55): void {
  if (lines.length === 0 || pen.fine < 0.02) return;
  const { ctx } = pen;
  ctx.beginPath();
  for (const l of lines) on(pen, l).forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.lineWidth = pen.line * weight;
  ctx.strokeStyle = color;
  ctx.globalAlpha = pen.fine;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function hull(pts: readonly Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as Pt, lower[lower.length - 1] as Pt, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2] as Pt, upper[upper.length - 1] as Pt, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The shadow things cast on the paper to the southeast, soft at its edge: each point of their feet, with the height standing over it. */
function castShadow(pen: Pen, feet: readonly (readonly [number, number, number])[], strength = 1): void {
  const pts: Pt[] = [];
  for (const [X, Z, height] of feet) {
    pts.push(pen.at(X, Z, 0));
    pts.push(pen.at(X + height * 0.2, Z - height * 0.32, 0));
  }
  if (pts.length < 3) return;
  const h = hull(pts);
  const cx = h.reduce((a, q) => a + q[0], 0) / h.length;
  const cy = h.reduce((a, q) => a + q[1], 0) / h.length;
  for (const [grow, a] of [[1.14, 0.09], [0.96, 0.13]] as const) {
    wash(pen, h.map(([px, py]) => [cx + (px - cx) * grow, cy + (py - cy) * grow] as Pt), `rgba(80,66,48,${(a * strength).toFixed(3)})`);
  }
}

const ellipseFeet = (X: number, Z: number, rx: number, rz: number, height: number): [number, number, number][] =>
  Array.from({ length: 12 }, (_, k) => [X + Math.cos((k / 12) * Math.PI * 2) * rx, Z + Math.sin((k / 12) * Math.PI * 2) * rz, height] as [number, number, number]);

/**
 * A roof rotted through from its weak eave corner `a`, by `amount` from 0 (sound) to 1 (most of the covering gone):
 * the dark inside and the bare rafters over it. `b` is the eave's other end, `c` and `d` the ridge above `b` and `a`.
 */
function rotHole(pen: Pen, a: Pt, b: Pt, c: Pt, d: Pt, amount: number, seed: number): void {
  if (amount < 0.04) return;
  const at = (u: number, t: number): Pt => lerp(lerp(a, b, u), lerp(d, c, u), t);
  const ru = 0.12 + amount * 0.86;
  const rt = 0.22 + amount * 0.95;
  const edge: Pt[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * (Math.PI / 2);
    const j = 0.74 + noise(seed, i) * 0.42;
    edge.push(at(Math.min(1, Math.cos(t) * ru * j), Math.min(1, Math.sin(t) * rt * j)));
  }
  const hole = [a, ...edge];
  const { ctx } = pen;
  wash(pen, hole, HOLLOW);
  // Bare rafters up the slope and a purlin across, each only as far as the hole's (smoothed) edge.
  const reach = (u: number, ru0: number, rt0: number): number => rt0 * 0.74 * Math.sqrt(Math.max(0, 1 - (u / (ru0 * 0.74)) ** 2));
  ctx.beginPath();
  for (let k = 0; k <= 7; k++) {
    const u = 0.04 + k * 0.135;
    const t = Math.min(1, reach(u, ru, rt));
    if (t < 0.05) continue;
    const p = at(u, 0);
    const q = at(u, t);
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  }
  const across = Math.min(1, reach(0.52, rt, ru));
  if (across > 0.05) {
    const p = at(0, 0.52);
    const q = at(across, 0.52);
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  }
  ctx.lineWidth = pen.line * 0.8;
  ctx.strokeStyle = "#a88a63";
  ctx.stroke();
  ink(pen, edge, false, 0.7);
}

/** Moss and ivy greening a failing roof's sound part in a few soft dabs. */
function moss(pen: Pen, a: Pt, b: Pt, c: Pt, d: Pt, w: Wear): void {
  const at = (u: number, t: number): Pt => lerp(lerp(a, b, u), lerp(d, c, u), t);
  const { ctx } = pen;
  ctx.fillStyle = rgba("#6f8a45", 0.32 * w.ivy);
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const [px, py] = at(0.45 + noise(w.seed, k + 30) * 0.5, 0.25 + noise(w.seed, k + 40) * 0.6);
    const r = (0.9 + noise(w.seed, k + 50)) * pen.s;
    ctx.moveTo(px + r, py);
    ctx.ellipse(px, py, r * 1.3, r * 0.8, 0, 0, Math.PI * 2);
  }
  ctx.fill();
}

/** Ivy climbing a south wall from its corner at (`X`, `Z`): a ragged green wash from the ground up, `amount` of the wall's height, spreading along the wall from the corner; `dir` is the corner's side (east +1). */
function ivy(pen: Pen, X: number, Z: number, height: number, amount: number, seed: number, dir = 1): void {
  if (amount < 0.05) return;
  const top = height * amount;
  const pts: Pt[] = [];
  for (let k = 0; k <= 4; k++) pts.push(pen.at(X - dir * noise(seed, k) * 0.4, Z - 0.1, (top * k) / 4));
  pts.push(pen.at(X - dir * 0.9, Z - 0.1, top));
  for (let k = 4; k >= 0; k--) pts.push(pen.at(X - dir * (1.3 + noise(seed, k + 7) * 1.1), Z - 0.1, (top * k) / 4));
  wash(pen, pts, rgba("#5f7f3e", 0.75));
}

/** A south wall broken down at its corner (`X`, `Z`): a ragged gap into the dark inside, its stones lying at its foot; `dir` is the corner's side (east +1). */
function breach(pen: Pen, X: number, Z: number, dir: number, height: number, amount: number, seed: number): void {
  if (amount < 0.04) return;
  const width = 1 + amount * 3.6;
  const drop = height * (0.25 + amount * 0.6);
  const pts: P3[] = [[X - dir * width, Z, height]];
  for (let k = 1; k <= 4; k++) pts.push([X - dir * width * (1 - k / 4.4), Z, height - drop * (k / 4) * (0.7 + noise(seed, k) * 0.5)]);
  pts.push([X, Z, height - drop], [X, Z, height]);
  const p = on(pen, pts);
  wash(pen, p, HOLLOW);
  ink(pen, p.slice(0, -1), false, 0.75);
  rubble(pen, X - dir * width * 0.4, Z - 1.1, amount * 2.6, seed);
}

/** Fallen stones heaped on the ground at (`X`, `Z`), `spread` units across. */
function rubble(pen: Pen, X: number, Z: number, spread: number, seed: number, stone = "#b9b2a2"): void {
  if (spread < 0.3) return;
  const { ctx } = pen;
  const n = Math.round(2 + spread * 1.6);
  for (let k = 0; k < n; k++) {
    const [px, py] = pen.at(X + (noise(seed, k + 60) - 0.5) * spread * 1.8, Z + (noise(seed, k + 70) - 0.5) * spread * 0.6, 0);
    const r = (0.45 + noise(seed, k + 80) * 0.5) * pen.s;
    ctx.beginPath();
    ctx.ellipse(px, py, r * 1.3, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fillStyle = mix(stone, SHADE, noise(seed, k + 90) * 0.25);
    ctx.fill();
    ctx.lineWidth = pen.line * 0.55;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
}

/** Grass at a thing's foot in a few quick strokes of the pen, growing rank round a ruin. */
function tufts(pen: Pen, spots: readonly (readonly [number, number])[], w: Wear): void {
  const { ctx, s } = pen;
  const tall = 1 + w.ivy * 1.1;
  ctx.beginPath();
  for (const [k, [X, Z]] of spots.entries()) {
    const [px, py] = pen.at(X, Z, 0);
    for (const d of [-1, -0.3, 0.4, 1]) {
      const h = (0.9 + noise(w.seed, k * 4 + d + 900) * 0.8) * tall * s;
      ctx.moveTo(px + d * 0.45 * s, py);
      ctx.quadraticCurveTo(px + d * 0.5 * s, py - h * 0.6, px + d * 1.1 * s, py - h);
    }
  }
  ctx.lineWidth = pen.line * 0.5;
  ctx.strokeStyle = rgba(mix(INK, "#4f6a2f", 0.4), 0.7);
  ctx.stroke();
}

/** An upright box: its west face in the light, its south face in shade, and its top. */
function box(pen: Pen, x0: number, x1: number, z0: number, z1: number, h0: number, h1: number, color: string, top: string | null = null, weight = 1): void {
  face(pen, [[x0, z0, h0], [x0, z1, h0], [x0, z1, h1], [x0, z0, h1]], lit(color, 0.14), weight);
  face(pen, [[x0, z0, h0], [x1, z0, h0], [x1, z0, h1], [x0, z0, h1]], shaded(color, 0.18), weight);
  face(pen, [[x0, z0, h1], [x1, z0, h1], [x1, z1, h1], [x0, z1, h1]], top ?? lit(color, 0.3), weight);
}

/** Chimney smoke drifting east on the wind: a soft grey wisp and a fine curl of ink, thinning away as the building tires. */
function smoke(pen: Pen, [px, py]: Pt, amount: number): void {
  if (amount < 0.04) return;
  const { ctx, s } = pen;
  const len = 0.45 + amount * 0.55;
  const pts: Pt[] = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    pts.push([px + (t * 4.4 + Math.sin(t * 5.2) * 0.9) * s * len, py - (0.6 + t * 6) * s * len]);
  }
  ctx.beginPath();
  for (const [k, q] of pts.entries()) {
    if (k % 2 === 1) continue;
    const t = k / 8;
    const rx = (0.7 + t * 1.5) * s * len;
    pen.reach(q[0], q[1], rx);
    ctx.moveTo(q[0] + rx, q[1]);
    ctx.ellipse(q[0], q[1], rx, (0.55 + t * 0.9) * s * len, -0.5, 0, Math.PI * 2);
  }
  ctx.fillStyle = `rgba(228,228,224,${(amount * 0.42).toFixed(3)})`;
  ctx.fill();
  trace(ctx, pts, false);
  ctx.lineWidth = pen.line * 0.5;
  ctx.strokeStyle = rgba(INK, amount * 0.55);
  ctx.stroke();
}

/** A dark pane or a door on a wall, framed in ink when `frame` is set. */
function pane(pen: Pen, quad: readonly P3[], color = GLASS, frame = false): Pt[] {
  const p = on(pen, quad);
  wash(pen, p, color);
  if (frame) ink(pen, p, true, 0.45, rgba(INK, 0.8));
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// What a mark is drawn from.

/** What a mark is drawn from: the blueprint Jev filled (each slot's primitive and the words chosen for it) and the colors realizing it gave. */
export interface Composition {
  readonly blueprint: Blueprint;
  readonly palette: Palette;
}

/** A building's composition, with the plan its footprint realized: the masses every part of it is built against. */
export interface BuildingComposition extends Composition {
  readonly plan: BuildingPlan;
}

type Values = Readonly<Record<string, unknown>>;

const PRIMITIVE = new Map(PRIMITIVES.map((p) => [p.id as string, p] as const));

/** A slot's words as its primitive's build reads them, each scale at its level's own value rather than a seeded draw within it. */
function valuesOf(id: string, words: Values): Values {
  const p = PRIMITIVE.get(id);
  if (p === undefined) return words;
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(p.params)) {
    const word = words[name];
    out[name] = field.type === "scale" ? (field.levels.find((l) => l.words === word) ?? field.levels[Math.floor(field.levels.length / 2)])?.value : word;
  }
  return out;
}

/** The colors a mark is washed in: the palette's healthy colors, which the wear then dries. */
interface Look {
  readonly w: Wear;
  /** A swatch's healthy color as hex, or `fallback` where the palette has none. */
  hue(name: string, fallback: string): string;
}

const lookOf = (palette: Palette, w: Wear): Look => ({
  w,
  hue: (name, fallback) => {
    const swatch = palette.swatches[name];
    return swatch === undefined ? fallback : hexOf(swatch.healthy);
  },
});

/** One face of a mass's walls that shows, for its walls' ink to draw fine work on. */
interface WallFace {
  /** Where the face meets the ground, from one corner along it to the other. */
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  /** The plinth's top and the walls' top at the eaves, in units. */
  readonly floor: number;
  readonly eave: number;
  /** The face's top a share `u` of the way along it: the eaves, or a gable's slopes. */
  top(u: number): number;
  readonly storeys: number;
  /** Whether it is an end wall, which may rise into a gable. */
  readonly end: boolean;
  readonly seed: number;
}

/** A roof slope toward the viewer: `a` its eave corner nearest the weak corner, `b` the eave's other end, `c` and `d` the ridge above `b` and `a`. */
interface Slope {
  readonly a: Pt;
  readonly b: Pt;
  readonly c: Pt;
  readonly d: Pt;
}

/** How the map inks a building's plan: every mass it lays out, with no drawing of its own. */
interface FootprintInk {
  readonly role: "Footprint";
}

// Each kind of entry reads its primitive's parameters, `V`: a scale as its level's number, a choice as its word.

/** How the map inks a wall material: the walls' wash, and the fine work on each face that shows. */
interface WallInk<V = Values> {
  readonly role: "Walls";
  wash(look: Look, p: V): string;
  face(pen: Pen, f: WallFace, look: Look, p: V): void;
}

/** How the map inks a roof covering. */
interface RoofInk<V = Values> {
  readonly role: "Roof";
  /** How far its eaves and verges reach past the walls, meters. */
  overhang(p: V): number;
  /** How plump its edges are, as a rounding in units: thatch is soft, tiles are sharp. */
  plump(p: V): number;
  chimney(p: V): "gable" | "ridge" | "none";
  /** Its courses on a slope toward the viewer, between the slope's wash and its outline. */
  courses(pen: Pen, s: Slope, look: Look, p: V): void;
  /** Touches over the slope's outline, such as thatch's rolled eave. */
  edge?(pen: Pen, s: Slope, look: Look, p: V): void;
  /** How the material turns the palette's roof color, as straw warms it. */
  tint?(c: string, p: V): string;
}

/** How the map inks a building's windows and doors: each at its place in the plan, `q` its corners on the wall (bottom left, bottom right, top right, top left). */
interface OpeningsInk<V = Values> {
  readonly role: "Openings";
  window(pen: Pen, q: readonly P3[], look: Look, p: V): void;
  door(pen: Pen, q: readonly P3[], look: Look, p: V): void;
}

/** How the map inks what gathers round a building, drawn in front of it. */
interface DressingInk<V = Values> {
  readonly role: "Dressing";
  draw(pen: Pen, house: House, look: Look, p: V): void;
}

/** How the map inks a feature: where it stands, so it is drawn in turn with the masses, and its own drawing. */
interface FeatureInk<V = Values> {
  readonly role: "Feature";
  place(house: House, p: V): readonly [number, number];
  draw(pen: Pen, house: House, look: Look, p: V): void;
}

/** How the map inks a landmark, from its foot. */
interface LandmarkInk<V = Values> {
  readonly role: "Landmark";
  draw(pen: Pen, look: Look, p: V, seed: number): void;
}

export type Ink = FootprintInk | WallInk | RoofInk | OpeningsInk | DressingInk | FeatureInk | LandmarkInk;

// Each helper types an entry's drawing by its own primitive's parameters.
const walls = <P extends Params>(_: P, ink: Omit<WallInk<Resolved<P>>, "role">): WallInk => ({ role: "Walls", ...ink }) as unknown as WallInk;
const roof = <P extends Params>(_: P, ink: Omit<RoofInk<Resolved<P>>, "role">): RoofInk => ({ role: "Roof", ...ink }) as unknown as RoofInk;
const openings = <P extends Params>(_: P, ink: Omit<OpeningsInk<Resolved<P>>, "role">): OpeningsInk => ({ role: "Openings", ...ink }) as unknown as OpeningsInk;
const dressing = <P extends Params>(_: P, ink: Omit<DressingInk<Resolved<P>>, "role">): DressingInk => ({ role: "Dressing", ...ink }) as unknown as DressingInk;
const feature = <P extends Params>(_: P, ink: Omit<FeatureInk<Resolved<P>>, "role">): FeatureInk => ({ role: "Feature", ...ink }) as unknown as FeatureInk;
const landmark = <P extends Params>(_: P, ink: Omit<LandmarkInk<Resolved<P>>, "role">): LandmarkInk => ({ role: "Landmark", ...ink }) as unknown as LandmarkInk;

// ---------------------------------------------------------------------------------------------------------------
// A building's masses as the mark draws them.

/** One mass as the mark draws it, in units east (X), north (Z) and up from the middle of the building's footprint. */
interface Block {
  readonly index: number;
  readonly round: boolean;
  /** Its footprint, trimmed back where it runs into a mass laid out before it. */
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  /** The plinth's top, the top of its walls and its roof's rise. */
  readonly floor: number;
  readonly eave: number;
  readonly rise: number;
  /** Its ridge runs east-west ("x") or north-south ("z"). */
  readonly along: "x" | "z";
  readonly form: RoofForm;
  /** Whether its near end (west, or south) and its far end stand free; a joined end is never hipped. */
  readonly ends: readonly [boolean, boolean];
  /** Which way across its span a lean-to's slope falls: toward the viewer (-1) or away. */
  readonly fall: 1 | -1;
  readonly storeys: number;
}

/** A point in a plan's frame (x east, y up, z toward the door, meters) in the mark's units: the door faces the viewer. */
const fromPlan = (x: number, y: number, z: number): P3 => [x * K, -z * K, y * K];

function blocksOf(plan: BuildingPlan): Block[] {
  const blocks: Block[] = plan.masses.map((m, index) => {
    const deep = m.round ? m.width : m.depth;
    return {
      index,
      round: m.round,
      x0: (m.x - m.width / 2) * K,
      x1: (m.x + m.width / 2) * K,
      z0: (-m.z - deep / 2) * K,
      z1: (-m.z + deep / 2) * K,
      floor: plan.floor * K,
      eave: (plan.floor + m.wallHeight) * K,
      rise: m.rise * K * (m.roof === "cone" ? 1 : ROOF_LIFT),
      along: m.ridge,
      form: m.roof,
      // North is the plan's -z, so a ridge along z runs its ends the other way.
      ends: m.ridge === "x" ? m.ends : [m.ends[1], m.ends[0]],
      fall: m.ridge === "x" ? (-m.fall as 1 | -1) : m.fall,
      storeys: m.storeys,
    };
  });
  // Joined masses overlap where they meet; the later one stops at the earlier one's wall, so no wall shows inside another.
  for (let i = 1; i < blocks.length; i++) {
    let k = blocks[i] as Block;
    if (k.round) continue;
    for (let j = 0; j < i; j++) {
      const h = blocks[j] as Block;
      if (h.round) continue;
      const ox = Math.min(k.x1, h.x1) - Math.max(k.x0, h.x0);
      const oz = Math.min(k.z1, h.z1) - Math.max(k.z0, h.z0);
      if (ox <= 0 || oz <= 0) continue;
      if (oz <= ox) k = k.z0 + k.z1 < h.z0 + h.z1 ? { ...k, z1: Math.max(k.z0 + 0.5, h.z0) } : { ...k, z0: Math.min(k.z1 - 0.5, h.z1) };
      else k = k.x0 + k.x1 < h.x0 + h.x1 ? { ...k, x1: Math.max(k.x0 + 0.5, h.x0) } : { ...k, x0: Math.min(k.x1 - 0.5, h.x1) };
    }
    blocks[i] = k;
  }
  return blocks;
}

/** How far a thing lies from the viewer: the mark draws the farthest first. */
const depthOf = (X: number, Z: number): number => 0.42 * X + 0.92 * Z;

/** A building being drawn: its plan, its masses, and what every part of it shares. */
interface House {
  readonly plan: BuildingPlan;
  readonly blocks: readonly Block[];
  /** The side of the plan's x (+1 or -1) its chimney leaves free, which a feature takes. */
  readonly side: 1 | -1;
  /** Its highest roof's top above the ground, meters. */
  readonly top: number;
  readonly w: Wear;
}

const inFoot = (m: Mass, x: number, z: number, margin: number): boolean =>
  m.round ? Math.hypot(x - m.x, z - m.z) < m.width / 2 + margin : Math.abs(x - m.x) < m.width / 2 + margin && Math.abs(z - m.z) < m.depth / 2 + margin;

/** The end of the main body's ridge (-1 or +1 along it, in the plan) a gable chimney climbs, as the roofs choose it: a free gable, never one facing the door, with the fewest windows; 0 when it has none. */
function chimneyEnd(plan: BuildingPlan): -1 | 0 | 1 {
  const m = plan.masses[0];
  if (m === undefined || (m.roof !== "gable" && m.roof !== "half-hip")) return 0;
  const alongX = m.ridge === "x";
  const half = (alongX ? m.width : m.depth) / 2;
  const free = (sign: number): boolean => {
    if (!alongX && sign > 0) return false;
    return [-0.8, 0, 0.8].every((across) => {
      const x = alongX ? m.x + sign * (half + 0.7) : m.x + across;
      const z = alongX ? m.z + across : m.z + sign * (half + 0.7);
      return !plan.masses.some((o, i) => i !== 0 && inFoot(o, x, z, 0.3));
    });
  };
  const count = (sign: number): number => plan.openings.filter((o) => o.mass === 0 && sign * (alongX ? o.normal[0] : o.normal[2]) > 0.5).length;
  const ends = ([-1, 1] as const).filter(free);
  if (ends.length === 0) return 0;
  return ends.reduce((best, e) => (count(e) < count(best) ? e : best));
}

/** Where a building gives way first, as its ruin does: the front corner away from the door, and how far the collapse reaches. */
function weakOf(plan: BuildingPlan): { X: number; Z: number; reach: number } {
  const door = plan.openings.find((o) => o.kind === "door");
  const side = door !== undefined && Math.abs(door.position[0]) > 0.05 ? -Math.sign(door.position[0]) : plan.width > plan.depth ? 1 : -1;
  let best = { x: (side * plan.width) / 2, z: plan.depth / 2, d: Infinity };
  for (const m of plan.masses) {
    const x = m.x + (side * m.width) / 2;
    const z = m.z + (m.round ? m.width : m.depth) / 2;
    const d = Math.hypot(x - (side * plan.width) / 2, z - plan.depth / 2);
    if (d < best.d) best = { x, z, d };
  }
  return { X: best.x * K, Z: -best.z * K, reach: clamp(0.62 * Math.max(plan.width, plan.depth), 3.5, 7.5) * K };
}

/** How much a point lies in the collapse, from 0 to 1 at the weak corner. */
const ruinAt = (weak: { X: number; Z: number; reach: number }, X: number, Z: number): number => {
  const t = clamp01(1 - Math.hypot(X - weak.X, Z - weak.Z) / weak.reach);
  return t * t * (3 - 2 * t);
};

/** A rectangular mass's roof and walls in 3D, from its block: `a` runs along its ridge and `b` across, each from its middle, so the viewer always looks from -a and -b. */
interface Shape {
  readonly at: (a: number, b: number, h: number) => P3;
  readonly L: number;
  readonly S: number;
  /** The slope facing away, the slope toward the viewer, and the corners of the latter: near eave, far eave, far ridge end, near ridge end. */
  readonly back: readonly P3[] | null;
  readonly front: readonly P3[] | null;
  readonly frontQuad: readonly [P3, P3, P3, P3] | null;
  /** The hipped ends near (west or south) and far. */
  readonly near: readonly P3[] | null;
  readonly far: readonly P3[] | null;
  /** A lean-to's one slope: low eave near, low eave far, high side far, high side near. */
  readonly lean: readonly [P3, P3, P3, P3] | null;
  /** The long wall toward the viewer and the near end wall: each outline, and the face for fine work. */
  readonly walls: readonly { readonly outline: readonly P3[]; readonly face: WallFace; readonly lit: boolean }[];
  /** The roof's top. */
  readonly ridge: number;
}

/** A half-hip cuts its gables back halfway up the roof. */
const HALF_HIP = 0.5;

function shapeOf(k: Block, e: number, seed: number): Shape {
  const cx = (k.x0 + k.x1) / 2;
  const cz = (k.z0 + k.z1) / 2;
  const alongX = k.along === "x";
  const L = (alongX ? k.x1 - k.x0 : k.z1 - k.z0) / 2;
  const S = (alongX ? k.z1 - k.z0 : k.x1 - k.x0) / 2;
  const at = (a: number, b: number, h: number): P3 => (alongX ? [cx + a, cz + b, h] : [cx + b, cz + a, h]);
  const E = k.eave;
  const R = k.rise;
  const ridge = E + R;
  // The long wall faces south under a ridge along x, west under one along z; the near end the other way.
  const longLit = !alongX;
  const wallFace = (outline: readonly P3[], from: P3, to: P3, top: (u: number) => number, end: boolean, lit: boolean): Shape["walls"][number] => ({
    outline,
    lit,
    face: { from: [from[0], from[1]], to: [to[0], to[1]], floor: k.floor, eave: E, top, storeys: k.storeys, end, seed: seed + k.index * 7 + (end ? 3 : 0) },
  });
  const endWall = (profile: readonly (readonly [number, number])[]): Shape["walls"][number] => {
    const outline = [at(-L, -S, 0), at(-L, S, 0), ...[...profile].reverse().map(([b, h]) => at(-L, b, h))];
    const top = (u: number): number => {
      const b = -S + 2 * S * u;
      for (let i = 1; i < profile.length; i++) {
        const [b0, h0] = profile[i - 1] as readonly [number, number];
        const [b1, h1] = profile[i] as readonly [number, number];
        if (b <= b1 + 1e-6) return h0 + ((h1 - h0) * (b - b0)) / Math.max(1e-6, b1 - b0);
      }
      return (profile[profile.length - 1] as readonly [number, number])[1];
    };
    return wallFace(outline, at(-L, -S, 0), at(-L, S, 0), top, true, !longLit);
  };
  const longWall = (h: number): Shape["walls"][number] => wallFace([at(-L, -S, 0), at(L, -S, 0), at(L, -S, h), at(-L, -S, h)], at(-L, -S, 0), at(L, -S, 0), () => h, false, longLit);

  if (k.form === "lean-to") {
    // One slope from its high side against the mass it leans on down to its low eave.
    const slope = R / (2 * S);
    const heightAt = (b: number): number => E + R * (1 - (k.fall * b + S) / (2 * S));
    const bh = -k.fall * S;
    const bl = k.fall * (S + e);
    const low = E - slope * e;
    const quad: [P3, P3, P3, P3] = [at(-L - e, bl, low), at(L + e, bl, low), at(L + e, bh, ridge), at(-L - e, bh, ridge)];
    const towardViewer = k.fall < 0;
    return {
      at,
      L,
      S,
      back: towardViewer ? null : quad,
      front: towardViewer ? quad : null,
      frontQuad: towardViewer ? quad : null,
      near: null,
      far: null,
      lean: quad,
      walls: [longWall(heightAt(-S)), endWall([[-S, heightAt(-S)], [S, heightAt(S)]])],
      ridge,
    };
  }

  const slope = R / S;
  const low = E - slope * e;
  const trunc = E + HALF_HIP * R;
  const tb = (1 - HALF_HIP) * S;
  /** The edge of a slope at one end, from its eave corner up to the ridge: straight up a gable, along a hip, or up a cut-back gable and over its small hip. */
  const endEdge = (sign: -1 | 1, side: -1 | 1): P3[] => {
    const free = k.ends[sign < 0 ? 0 : 1];
    const ea = sign * (L + e);
    const eave = at(ea, side * (S + e), low);
    if (free && k.form === "hip") return [eave, at(sign * Math.max(0, L - S), 0, ridge)];
    if (free && k.form === "half-hip") return [eave, at(ea, side * tb, trunc), at(sign * Math.max(0, L + e - 0.6 * tb), 0, ridge)];
    return [eave, at(ea, 0, ridge)];
  };
  const slopeOf = (side: -1 | 1): P3[] => [...endEdge(-1, side), ...endEdge(1, side).reverse()];
  const nearEdge = endEdge(-1, -1);
  const farEdge = endEdge(1, -1);
  const hipEnd = (sign: -1 | 1): P3[] | null => {
    if (!k.ends[sign < 0 ? 0 : 1]) return null;
    const ea = sign * (L + e);
    if (k.form === "hip") return [at(ea, -(S + e), low), at(ea, S + e, low), at(sign * Math.max(0, L - S), 0, ridge)];
    if (k.form === "half-hip") return [at(ea, -tb, trunc), at(ea, tb, trunc), at(sign * Math.max(0, L + e - 0.6 * tb), 0, ridge)];
    return null;
  };
  const nearFree = k.ends[0];
  // The near end wall's top: a gable to just under the ridge, the eaves under a hip, or a gable cut back halfway.
  const profile: [number, number][] =
    nearFree && k.form === "hip" ? [[-S, E], [S, E]]
    : nearFree && k.form === "half-hip" ? [[-S, E], [-tb, trunc - 0.2], [tb, trunc - 0.2], [S, E]]
    : [[-S, E], [0, ridge - 0.3], [S, E]];
  return {
    at,
    L,
    S,
    back: slopeOf(1),
    front: slopeOf(-1),
    frontQuad: [nearEdge[0] as P3, farEdge[0] as P3, farEdge[farEdge.length - 1] as P3, nearEdge[nearEdge.length - 1] as P3],
    near: hipEnd(-1),
    far: hipEnd(1),
    lean: null,
    walls: [longWall(E), endWall(profile)],
    ridge,
  };
}

/** What a building's slots say, each read by its entry in the table. */
interface Parts {
  readonly walls: { readonly ink: WallInk; readonly p: Values } | null;
  readonly roof: { readonly ink: RoofInk; readonly p: Values } | null;
  readonly openings: { readonly ink: OpeningsInk; readonly p: Values } | null;
  readonly dressing: readonly { readonly ink: DressingInk; readonly p: Values }[];
  readonly features: readonly { readonly ink: FeatureInk; readonly p: Values }[];
}

function partsOf(bp: Blueprint): Parts {
  let wallsPart: Parts["walls"] = null;
  let roofPart: Parts["roof"] = null;
  let openingsPart: Parts["openings"] = null;
  const dressingParts: { ink: DressingInk; p: Values }[] = [];
  const features: { ink: FeatureInk; p: Values }[] = [];
  for (const slot of Object.values(bp.slots)) {
    const entry = INKS[slot.use];
    if (entry === undefined) continue;
    const p = valuesOf(slot.use, slot.params);
    if (entry.role === "Walls") wallsPart = { ink: entry, p };
    else if (entry.role === "Roof") roofPart = { ink: entry, p };
    else if (entry.role === "Openings") openingsPart = { ink: entry, p };
    else if (entry.role === "Dressing") dressingParts.push({ ink: entry, p });
    else if (entry.role === "Feature") features.push({ ink: entry, p });
  }
  return { walls: wallsPart, roof: roofPart, openings: openingsPart, dressing: dressingParts, features };
}

/** The roofs' color: the palette's, as the covering's material turns it. */
const roofHue = (look: Look, part: Parts["roof"]): string => {
  const c = look.hue("roof", "#8a7a62");
  return part?.ink.tint?.(c, part.p) ?? c;
};

/** Walls with no ink of their own: plain plaster. */
const PLAIN_WALLS: WallInk = { role: "Walls", wash: (look) => look.hue("wall", "#efe6d2"), face: () => {} };

/** The openings that look toward the viewer, on mass `index`: each its corners on its wall, and whether it is the door. */
function openingsOn(plan: BuildingPlan, index: number): { q: P3[]; door: boolean }[] {
  const out: { q: P3[]; door: boolean }[] = [];
  for (const o of plan.openings as readonly Opening[]) {
    if (o.mass !== index) continue;
    // The normal in the mark's frame (east, north): it shows when it turns toward the viewer at the south-southwest.
    const nx = o.normal[0];
    const nz = -o.normal[2];
    if (-0.42 * nx - 0.92 * nz < 0.2) continue;
    const [X, Z, H] = fromPlan(o.position[0], o.position[1], o.position[2]);
    // Along the wall, left to right as seen.
    const ux = -nz;
    const uz = nx;
    const hw = (o.width / 2) * K;
    const top = H + o.height * K;
    const left: [number, number] = [X - ux * hw, Z - uz * hw];
    const right: [number, number] = [X + ux * hw, Z + uz * hw];
    out.push({ q: [[left[0], left[1], H], [right[0], right[1], H], [right[0], right[1], top], [left[0], left[1], top]], door: o.kind === "door" });
  }
  return out;
}

/** The plinth along a wall's foot, in the masonry's wash. */
function plinth(pen: Pen, f: WallFace, color: string): void {
  if (f.floor < 0.15) return;
  const p = on(pen, [[f.from[0], f.from[1], 0], [f.to[0], f.to[1], 0], [f.to[0], f.to[1], f.floor], [f.from[0], f.from[1], f.floor]]);
  wash(pen, p, color);
  ink(pen, [p[3] as Pt, p[2] as Pt], false, 0.5, rgba(INK, 0.7));
}

/** A slope toward the viewer: its wash, the light along its ridge and the shade under its eave, its courses, then rot and moss as the building fails. */
function frontSlope(pen: Pen, outline: readonly P3[], quad: readonly [P3, P3, P3, P3], weakFar: boolean, color: string, round: number, roofPart: Parts["roof"], look: Look, rot: number): void {
  const w = look.w;
  const p = on(pen, outline);
  const [n0, f0, f1, n1] = on(pen, quad) as [Pt, Pt, Pt, Pt];
  const s: Slope = weakFar ? { a: f0, b: n0, c: n1, d: f1 } : { a: n0, b: f0, c: f1, d: n1 };
  wash(pen, p, color, round);
  // The light along the ridge, the shade under the eave; each band lies within the slope, so needs no clip.
  const inset = round > 0 ? 0.06 : 0;
  const at = (u: number, t: number): Pt => lerp(lerp(s.a, s.b, u), lerp(s.d, s.c, u), t);
  wash(pen, [at(inset, 0.62), at(1 - inset, 0.62), at(1 - inset, 1 - inset * 0.5), at(inset, 1 - inset * 0.5)], rgba(LIGHT, 0.22));
  wash(pen, [at(inset, inset * 0.5), at(1 - inset, inset * 0.5), at(1 - inset, 0.18), at(inset, 0.18)], rgba(SHADE, 0.16));
  roofPart?.ink.courses(pen, s, look, roofPart.p);
  ink(pen, p, true, 1, INK, round);
  roofPart?.ink.edge?.(pen, s, look, roofPart.p);
  rotHole(pen, s.a, s.b, s.c, s.d, rot, w.seed + 11);
  if (w.ivy > 0.3) moss(pen, s.a, s.b, s.c, s.d, w);
}

/** One rectangular mass, back to front: the far slope and hip, the walls with their plinth, fine work and openings, the near hip, then the slope toward the viewer. */
function drawBlock(pen: Pen, house: House, k: Block, parts: Parts, look: Look, weak: ReturnType<typeof weakOf>): void {
  const w = look.w;
  const roofPart = parts.roof;
  const wallsPart = parts.walls ?? { ink: PLAIN_WALLS, p: {} };
  const e = (roofPart?.ink.overhang(roofPart.p) ?? 0.4) * K;
  const round = (roofPart?.ink.plump(roofPart.p) ?? 0) * pen.s;
  const sh = shapeOf(k, e, w.seed);
  const roofC = worn(roofHue(look, roofPart), w, 0.45);
  const wallC = worn(wallsPart.ink.wash(look, wallsPart.p), w);
  const masonry = worn(look.hue("masonry", "#a89d8a"), w);
  if (sh.back !== null) face(pen, sh.back, shaded(roofC, 0.3), 1, round);
  if (sh.far !== null) face(pen, sh.far, shaded(roofC, 0.35), 1, round);
  for (const wall of sh.walls) {
    face(pen, wall.outline, wall.lit ? lit(wallC, 0.12) : shaded(wallC, 0.16));
    plinth(pen, wall.face, wall.lit ? lit(masonry, 0.1) : shaded(masonry, 0.16));
    wallsPart.ink.face(pen, wall.face, look, wallsPart.p);
  }
  drawOpenings(pen, house, k.index, parts, look);
  // Ivy climbs the corner nearest the collapse, the more the nearer.
  const corners: [number, number][] = [[k.x0, k.z0], [k.x1, k.z0]];
  const [ivyX, ivyZ] = corners.reduce((best, c) => (ruinAt(weak, c[0], c[1]) > ruinAt(weak, best[0], best[1]) ? c : best));
  const near = ruinAt(weak, ivyX, ivyZ);
  ivy(pen, ivyX, ivyZ, k.eave, w.ivy * (0.45 + 0.55 * near), w.seed + k.index, ivyX === k.x1 ? 1 : -1);
  if (sh.near !== null) face(pen, sh.near, k.along === "x" ? lit(roofC, 0.18) : shaded(roofC, 0.1), 1, round);
  if (sh.front !== null && sh.frontQuad !== null) {
    const [n0, f0] = sh.frontQuad;
    const weakFar = ruinAt(weak, f0[0], f0[1]) > ruinAt(weak, n0[0], n0[1]);
    const nearest = Math.max(ruinAt(weak, f0[0], f0[1]), ruinAt(weak, n0[0], n0[1]));
    const rot = w.rot * (0.5 + 0.5 * nearest);
    frontSlope(pen, sh.front, sh.frontQuad, weakFar, k.along === "z" ? lit(roofC, 0.12) : roofC, round, roofPart, look, rot);
  }
  if (sh.lean !== null) caveIn(pen, sh.lean, w);
}

/** A lean-to's whole slope caving in about its high edge as its building fails: the dark inside showing from its low eave up. */
function caveIn(pen: Pen, quad: readonly [P3, P3, P3, P3], w: Wear): void {
  const fall = ease(w.v, 0.35, 0.1);
  if (fall < 0.05) return;
  const [l0, l1, h1, h0] = on(pen, quad) as [Pt, Pt, Pt, Pt];
  wash(pen, [l0, l1, lerp(l1, h1, fall * 0.9), lerp(l0, h0, fall * 0.9)], HOLLOW);
}

function drawOpenings(pen: Pen, house: House, index: number, parts: Parts, look: Look): void {
  const part = parts.openings;
  for (const o of openingsOn(house.plan, index)) {
    if (part === null) pane(pen, o.q, o.door ? "#6a4a33" : GLASS, o.door);
    else if (o.door) part.ink.door(pen, o.q, look, part.p);
    else part.ink.window(pen, o.q, look, part.p);
  }
}

/** A round turret under its own cone, which rots through and loses its finial as the building fails. */
function drawTurret(pen: Pen, house: House, k: Block, parts: Parts, look: Look): void {
  const w = look.w;
  const { ctx, s } = pen;
  const X = (k.x0 + k.x1) / 2;
  const Z = (k.z0 + k.z1) / 2;
  const r = (k.x1 - k.x0) / 2;
  const wallsPart = parts.walls ?? { ink: PLAIN_WALLS, p: {} };
  const roofPart = parts.roof;
  const wallC = worn(wallsPart.ink.wash(look, wallsPart.p), w);
  const roofC = worn(roofHue(look, roofPart), w, 0.45);
  const rx = r * 1.01 * s;
  const ry = r * 0.405 * s;
  const [bx, by] = pen.at(X, Z, 0);
  const [tx, ty] = pen.at(X, Z, k.eave);
  pen.reach(bx, by, rx);
  const body = new Path2D();
  body.moveTo(tx - rx, ty);
  body.lineTo(bx - rx, by);
  body.ellipse(bx, by, rx, ry, 0, Math.PI, 0, true);
  body.lineTo(tx + rx, ty);
  body.ellipse(tx, ty, rx, ry, 0, 0, Math.PI, false);
  body.closePath();
  const g = ctx.createLinearGradient(bx - rx, 0, bx + rx, 0);
  g.addColorStop(0, lit(wallC, 0.12));
  g.addColorStop(0.35, lit(wallC, 0.3));
  g.addColorStop(1, shaded(wallC, 0.36));
  ctx.fillStyle = g;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  // Its walls' fine work on the face turned toward the viewer.
  const fz = Z - r * 0.6;
  wallsPart.ink.face(pen, { from: [X - r, fz], to: [X + r, fz], floor: k.floor, eave: k.eave, top: () => k.eave, storeys: k.storeys, end: false, seed: w.seed + k.index * 7 }, look, wallsPart.p);
  ctx.restore();
  ctx.lineWidth = pen.line;
  ctx.strokeStyle = INK;
  ctx.stroke(body);
  drawOpenings(pen, house, k.index, parts, look);
  // The cone, eaves flaring past the wall; failing, it rots down from its tip.
  const apex = k.eave + k.rise;
  const cone = apex - k.rise * 0.55 * ease(w.v, 0.35, 0.05);
  const er = (r + (roofPart?.ink.overhang(roofPart.p) ?? 0.4) * K * 0.75) * s;
  pen.reach(tx, ty, er * 1.01);
  const [ax, ay] = pen.at(X, Z, cone);
  ctx.beginPath();
  if (cone < apex - 0.5) {
    ctx.moveTo(tx - er * 1.01, ty);
    ctx.lineTo(ax - er * 0.35, ay + 0.4 * s);
    ctx.lineTo(ax - er * 0.1, ay - 0.3 * s);
    ctx.lineTo(ax + er * 0.15, ay + 0.5 * s);
    ctx.lineTo(ax + er * 0.35, ay);
    ctx.lineTo(tx + er * 1.01, ty);
  } else {
    ctx.moveTo(tx - er * 1.01, ty);
    ctx.lineTo(ax, ay);
    ctx.lineTo(tx + er * 1.01, ty);
  }
  ctx.ellipse(tx, ty, er * 1.01, er * 0.405, 0, 0, Math.PI, false);
  ctx.closePath();
  const cg = ctx.createLinearGradient(tx - er, 0, tx + er, 0);
  cg.addColorStop(0, lit(roofC, 0.2));
  cg.addColorStop(0.4, roofC);
  cg.addColorStop(1, shaded(roofC, 0.3));
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.lineWidth = pen.line;
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (cone >= apex - 0.5) ink(pen, [[ax, ay], [ax, ay - 1.3 * s]], false, 0.7);
  else rotHole(pen, [tx + er * 0.2, ty + er * 0.3], [tx + er, ty], [ax + er * 0.35, ay], [ax, ay + 0.2 * s], w.rot * 0.8, w.seed + 3);
}

/** A chimney stack `wx` by `wz` units, toppling along the ridge toward `fallX`, `fallZ` as its building fails and smoking while it lives; returns the top it smokes from. */
function chimney(pen: Pen, X: number, Z: number, h0: number, h1: number, wx: number, wz: number, ridge: number, fall: readonly [number, number], color: string, w: Wear, shoulder = 0): Pt {
  const fallen = ease(w.v, 0.2, 0.05);
  const top = Math.max(h0 + 0.5, h1 - (h1 - ridge) * 1.2 * fallen);
  // A gable stack is broad up to its shoulder, round the hearth, and narrows above.
  if (shoulder > h0) box(pen, X - wx * 0.75, X + wx * 0.75, Z - wz * 0.7, Z + wz * 0.7, h0, shoulder, worn(color, w), shaded(worn(color, w), 0.2), 0.85);
  box(pen, X - wx / 2, X + wx / 2, Z - wz / 2, Z + wz / 2, Math.max(h0, shoulder - 0.2), top, worn(color, w), "#4b3b2e", 0.85);
  if (fallen > 0.4) {
    // The stack lies along the ridge beside its stump.
    const [fx, fz] = fall;
    const len = (h1 - ridge) * 0.9;
    const px = -fz * 0.6;
    const pz = fx * 0.6;
    const p = on(pen, [[X + px, Z + pz, ridge + 0.4], [X + fx * len + px, Z + fz * len + pz, ridge + 0.2], [X + fx * len - px, Z + fz * len - pz, ridge + 0.3], [X - px, Z - pz, ridge + 0.5]]);
    wash(pen, p, shaded(worn(color, w), 0.1));
    ink(pen, p, true, 0.75);
  }
  return pen.at(X, Z, top);
}

// ---------------------------------------------------------------------------------------------------------------
// The table: how the map inks every structure and landmark primitive.

/** Timber framing: posts at every corner and between, a rail at every floor, and braces or close studs as its framing says. */
function timberFace(pen: Pen, f: WallFace, look: Look, framing: string): void {
  const timber = rgba(worn(look.hue("timber", "#5b412d"), look.w), 0.85);
  const len = Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1]);
  const at = (u: number, h: number): P3 => [f.from[0] + (f.to[0] - f.from[0]) * u, f.from[1] + (f.to[1] - f.from[1]) * u, h];
  const gap = (framing === "close studding" ? 0.55 : 1.45) * K;
  const n = Math.max(1, Math.round(len / gap));
  const lines: P3[][] = [];
  for (let j = 0; j <= n; j++) {
    const u = j / n;
    lines.push([at(u, f.floor), at(u, f.end ? f.top(u) : f.eave)]);
  }
  const floors = [f.floor, ...Array.from({ length: f.storeys - 1 }, (_, i) => f.floor + (i + 1) * STOREY * K), f.eave];
  for (const h of floors.slice(1)) lines.push([at(0, h), at(1, h)]);
  if (framing === "posts and rails") for (let i = 0; i + 1 < floors.length; i++) lines.push([at(0, ((floors[i] as number) + (floors[i + 1] as number)) / 2), at(1, ((floors[i] as number) + (floors[i + 1] as number)) / 2)]);
  if (framing === "crossed braces") {
    for (let i = 0; i + 1 < floors.length; i++) {
      const h0 = floors[i] as number;
      const h1 = floors[i + 1] as number;
      lines.push([at(0, h0), at(1 / n, h1)], [at(1, h0), at(1 - 1 / n, h1)]);
    }
  }
  // A king post up into the gable.
  if (f.end && f.top(0.5) > f.eave + 1) lines.push([at(0.5, f.eave), at(0.5, f.top(0.5))]);
  hatch(pen, lines, timber, 0.62);
}

/** Fieldstone: rounded stones in rough courses up a face, as big as the walls' stones are. */
function stoneFace(pen: Pen, f: WallFace, size: number, upTo: (u: number) => number): void {
  if (pen.fine < 0.02) return;
  const { ctx } = pen;
  const len = Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1]);
  const stone = size * K;
  const rows = Math.max(1, Math.round((Math.max(...[0, 0.25, 0.5, 0.75, 1].map(upTo)) - f.floor) / (stone * 1.5)));
  ctx.beginPath();
  for (let row = 0; row < rows; row++) {
    const h = f.floor + (row + 0.5) * stone * 1.5;
    const across = Math.max(1, Math.round(len / (stone * 2.4)));
    for (let j = 0; j < across; j++) {
      const u = (j + 0.5 + (row % 2) * 0.5 + (noise(f.seed, row * 31 + j) - 0.5) * 0.3) / (across + 0.5);
      if (u <= 0.02 || u >= 0.98 || h > upTo(u) - stone * 0.5) continue;
      const [px, py] = pen.at(f.from[0] + (f.to[0] - f.from[0]) * u, f.from[1] + (f.to[1] - f.from[1]) * u, h + (noise(f.seed, row * 17 + j + 5) - 0.5) * stone * 0.4);
      const r = stone * (0.42 + noise(f.seed, row * 13 + j + 9) * 0.22) * pen.s;
      ctx.moveTo(px + r * 1.25, py);
      ctx.ellipse(px, py, r * 1.25, r * 0.78, 0, 0, Math.PI * 2);
    }
  }
  ctx.lineWidth = pen.line * 0.45;
  ctx.strokeStyle = rgba(INK, 0.5 * pen.fine);
  ctx.stroke();
}

/** Lines across a slope from eave to ridge at shares `ts` of the way up. */
const courseLines = (s: Slope, ts: readonly number[]): [Pt, Pt][] => ts.map((t) => [lerp(s.a, s.d, t), lerp(s.b, s.c, t)]);

function strokeLines(pen: Pen, lines: readonly (readonly [Pt, Pt])[], weight: number, alpha: number): void {
  const { ctx } = pen;
  ctx.beginPath();
  for (const [p, q] of lines) {
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  }
  ctx.lineWidth = pen.line * weight;
  ctx.strokeStyle = rgba(INK, alpha * pen.fine);
  ctx.stroke();
}

/** A tower's door: a round-headed dark opening at its foot. */
function towerDoor(pen: Pen, X: number, Z: number, half: number, height: number, color: string): void {
  const door = on(pen, [[X - half, Z, 0], [X + half, Z, 0], [X + half, Z, height * 0.75], [X, Z, height], [X - half, Z, height * 0.75]]);
  wash(pen, door, color);
  ink(pen, door, true, 0.5);
}

/**
 * Every structure and landmark primitive, by id: how the map inks it. A primitive missing here fails the marks'
 * contract test, so a new one is never drawn as something else.
 */
export const INKS: Readonly<Record<string, Ink>> = {
  "cottage-plan@1": { role: "Footprint" },

  "timber-frame@1": walls(timberFrameParams, {
    wash: (look) => look.hue("wall", "#f0e4c8"),
    face: (pen, f, look, p) => timberFace(pen, f, look, p.framing),
  }),

  "fieldstone@1": walls(fieldstoneParams, {
    // Stones in pale lime mortar read, at a distance, as the two together.
    wash: (look) => mix(look.hue("wall", "#e6e0d0"), look.hue("masonry", "#a89d8a"), 0.42),
    face: (pen, f, look, p) => {
      stoneFace(pen, f, p.stones, (u) => (p.gables === "stone" || !f.end ? f.top(u) : Math.min(f.top(u), f.eave)));
      if (p.gables === "boards" && f.end && f.top(0.5) > f.eave + 0.5) {
        // Upright boards under the peak.
        const len = Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1]);
        const n = Math.max(3, Math.round(len / (0.45 * K)));
        const lines: P3[][] = [];
        for (let j = 1; j < n; j++) {
          const u = j / n;
          if (f.top(u) <= f.eave + 0.2) continue;
          const X = f.from[0] + (f.to[0] - f.from[0]) * u;
          const Z = f.from[1] + (f.to[1] - f.from[1]) * u;
          lines.push([[X, Z, f.eave], [X, Z, f.top(u)]]);
        }
        lines.push([[f.from[0], f.from[1], f.eave], [f.to[0], f.to[1], f.eave]]);
        hatch(pen, lines, rgba(worn(look.hue("timber", "#5b412d"), look.w), 0.8), 0.6);
      }
    },
  }),

  "thatch@1": roof(thatchParams, {
    overhang: (p) => 0.35 + p.overhang * 0.7,
    plump: (p) => 0.6 + p.thickness * 2.2,
    // Straw warms whatever color the palette gives the roof.
    tint: (c) => mix(c, "#d4a752", 0.5),
    chimney: (p) => p.chimney,
    courses: (pen, s, look) => {
      // Soft strokes of straw down the slope from the ridge.
      const lines: [Pt, Pt][] = [];
      for (let k = 1; k < 9; k++) {
        const u = k / 9 + (noise(look.w.seed, k) - 0.5) * 0.04;
        const at = (t: number): Pt => lerp(lerp(s.a, s.b, u), lerp(s.d, s.c, u), t);
        lines.push([at(0.05), at(0.32 + noise(look.w.seed, k + 9) * 0.2)]);
      }
      strokeLines(pen, lines, 0.5, 0.4);
    },
    edge: (pen, s) => {
      // Thatch is plump: a thick, rounded eave, and the ridge capped.
      ink(pen, [lerp(s.a, s.d, 0.1), lerp(s.b, s.c, 0.1)], false, 0.6, rgba(INK, 0.6));
      ink(pen, [lerp(s.d, s.a, 0.08), lerp(s.c, s.b, 0.08)], false, 0.6, rgba(INK, 0.6));
    },
  }),

  "tiles@1": roof(tilesParams, {
    overhang: (p) => 0.15 + p.overhang * 0.6,
    plump: () => 0,
    chimney: (p) => p.chimney,
    courses: (pen, s, _look, p) => {
      // Slates lie in many fine courses; pantiles in fewer, rippled by their rounded rolls; shingles in staggered courses.
      if (p.covering === "slates") {
        strokeLines(pen, courseLines(s, [0.18, 0.34, 0.5, 0.66, 0.82]), 0.45, 0.42);
        return;
      }
      const ts = [0.25, 0.5, 0.75];
      strokeLines(pen, courseLines(s, ts), 0.5, 0.4);
      const ticks: [Pt, Pt][] = [];
      const n = p.covering === "pantiles" ? 11 : 8;
      for (const [r, t] of [0, ...ts].entries()) {
        for (let j = 0; j < n; j++) {
          const u = (j + (p.covering === "shingles" ? (r % 2) * 0.5 : 0) + 0.5) / n;
          if (u > 0.98) continue;
          const at = (tt: number): Pt => lerp(lerp(s.a, s.b, u), lerp(s.d, s.c, u), tt);
          ticks.push([at(t + 0.02), at(t + 0.22)]);
        }
      }
      strokeLines(pen, ticks, p.covering === "pantiles" ? 0.55 : 0.4, p.covering === "pantiles" ? 0.32 : 0.26);
    },
  }),

  "casements@1": openings(casementsParams, {
    window: (pen, q, look, p) => {
      const w = look.w;
      // Dark panes with a little lamplight while the house is lived in, darker and empty as it fails.
      const glass = mix(mix(GLASS, look.hue("glass", "#ffbf66"), 0.22 * (1 - w.dry)), "#241c15", w.breach * 0.8);
      if (p.shutters && w.v > 0.18) {
        const [bl, br, tr, tl] = q as [P3, P3, P3, P3];
        const ux = (br[0] - bl[0]) * 0.55;
        const uz = (br[1] - bl[1]) * 0.55;
        const trim = worn(look.hue("trim", "#7fa36a"), w);
        pane(pen, [[bl[0] - ux, bl[1] - uz, bl[2]], bl, tl, [tl[0] - ux, tl[1] - uz, tl[2]]], trim);
        // One shutter hangs askew on a tired house.
        const hang = ease(w.v, 0.6, 0.35) * 0.35 * (tr[2] - br[2]);
        pane(pen, [br, [br[0] + ux, br[1] + uz, br[2] - hang], [tr[0] + ux, tr[1] + uz, tr[2] - hang], tr], trim);
      }
      const panes = pane(pen, q, glass);
      if (p.panes !== "one pane" && pen.fine > 0.02) {
        const [bl, br, tr, tl] = panes as [Pt, Pt, Pt, Pt];
        const bars: [Pt, Pt][] = [[lerp(bl, br, 0.5), lerp(tl, tr, 0.5)], [lerp(bl, tl, 0.5), lerp(br, tr, 0.5)]];
        if (p.panes === "six panes") bars.push([lerp(bl, br, 0.25), lerp(tl, tr, 0.25)], [lerp(bl, br, 0.75), lerp(tl, tr, 0.75)]);
        const { ctx } = pen;
        ctx.beginPath();
        for (const [a, b] of bars) {
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
        }
        ctx.lineWidth = pen.line * 0.35;
        ctx.strokeStyle = rgba(LIGHT, 0.55 * pen.fine);
        ctx.stroke();
      }
    },
    door: (pen, q, look, p) => {
      const color = worn(mix(look.hue("trim", "#7fa36a"), look.hue("timber", "#5b412d"), 0.45), look.w);
      const [bl, br, tr, tl] = q as [P3, P3, P3, P3];
      const mid = (a: P3, b: P3): P3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      if (p.door === "arched") {
        const rise = (br[2] - bl[2] + tr[2] - br[2]) * 0.22;
        pane(pen, [bl, br, [tr[0], tr[1], tr[2] - rise], [mid(tl, tr)[0], mid(tl, tr)[1], tr[2]], [tl[0], tl[1], tl[2] - rise]], color, true);
        return;
      }
      pane(pen, q, color, true);
      if (p.door === "hooded") {
        const out = 0.5 * K;
        const ux = br[0] - bl[0];
        const uz = br[1] - bl[1];
        const ul = Math.hypot(ux, uz) || 1;
        // The hood juts out from the wall toward the viewer.
        const nx = uz / ul;
        const nz = -ux / ul;
        const h = tl[2] + 0.2 * K;
        face(pen, [[tl[0] - ux * 0.25 + nx * out, tl[1] - uz * 0.25 + nz * out, h], [tr[0] + ux * 0.25 + nx * out, tr[1] + uz * 0.25 + nz * out, h], [mid(tl, tr)[0] + nx * out * 0.5, mid(tl, tr)[1] + nz * out * 0.5, h + 0.9 * K]], shaded(worn(look.hue("roof", "#8a7a62"), look.w, 0.4), 0.05), 0.7);
      }
    },
  }),

  "cottage-garden@1": dressing(cottageGardenParams, {
    draw: (pen, house, look, p) => {
      const w = look.w;
      const extras = new Set(p.extras);
      const door = house.plan.openings.find((o) => o.kind === "door");
      const [dX, dZ] = door === undefined ? [0, (house.blocks[0]?.z0 ?? 0)] : fromPlan(door.position[0], 0, door.position[2]);
      const front = Math.min(...house.blocks.map((b) => b.z0));
      const west = Math.min(...house.blocks.map((b) => b.x0));
      const east = Math.max(...house.blocks.map((b) => b.x1));
      const { ctx } = pen;
      // The walk to the door.
      const walkTo = front - 3.2 * K;
      if (p.walk === "flagstones") {
        const path = on(pen, [[dX - 0.6, dZ - 0.1, 0], [dX + 0.6, dZ - 0.1, 0], [dX + 0.7, walkTo, 0], [dX - 0.7, walkTo, 0]]);
        wash(pen, path, rgba(mix(look.hue("masonry", "#a89d8a"), PAPER, 0.35), 0.75 * (1 - w.ivy * 0.7)));
      } else {
        for (let j = 1; j <= 3; j++) {
          const [px, py] = pen.at(dX + (noise(w.seed, j + 150) - 0.5) * 0.8, dZ - (j / 3.4) * (dZ - walkTo), 0);
          ctx.beginPath();
          ctx.ellipse(px, py, 0.75 * pen.s, 0.4 * pen.s, 0, 0, Math.PI * 2);
          ctx.fillStyle = rgba(mix(look.hue("masonry", "#a89d8a"), PAPER, 0.3), 0.85 * (1 - w.ivy * 0.6));
          ctx.fill();
        }
      }
      if (extras.has("fence")) {
        // A low picket fence round the front garden, gapped for the walk; pickets drop out as the house fails.
        const Z = walkTo + 0.4;
        const lines: P3[][] = [];
        const top = 0.95 * K;
        for (let X = west - 1.2 * K; X <= east + 1.2 * K; X += 0.55 * K) {
          if (Math.abs(X - dX) < 1.1 * K) continue;
          if (noise(w.seed, Math.round(X * 10) + 170) * 0.6 + 0.3 > w.v + 0.25) continue;
          lines.push([[X, Z, 0], [X, Z, top]]);
        }
        lines.push([[west - 1.2 * K, Z, top * 0.7], [dX - 1.1 * K, Z, top * 0.7]], [[dX + 1.1 * K, Z, top * 0.7], [east + 1.2 * K, Z, top * 0.7]]);
        hatch(pen, lines, rgba(worn(look.hue("wall", "#efe6d2"), w), 0.95), 0.75);
        hatch(pen, lines, rgba(INK, 0.45), 0.3);
      }
      if (extras.has("woodpile")) {
        // Log ends stacked against the near end of the house.
        const b = house.blocks[0] as Block;
        const X = b.x0 - 0.4 * K;
        const Z = b.z0 + (b.z1 - b.z0) * 0.6;
        const logs: [number, number][] = [[0, 0.3], [0.6, 0.3], [-0.6, 0.3], [0.3, 0.8], [-0.3, 0.8], [0, 1.3]];
        for (const [k, [dz, h]] of logs.entries()) {
          if (noise(w.seed, k + 190) > 0.35 + w.v) continue;
          const [px, py] = pen.at(X, Z + dz * K, h * K);
          ctx.beginPath();
          ctx.arc(px, py, 0.42 * pen.s, 0, Math.PI * 2);
          ctx.fillStyle = worn("#b88a5c", w);
          ctx.fill();
          ctx.lineWidth = pen.line * 0.4;
          ctx.strokeStyle = INK;
          ctx.stroke();
        }
      }
      if (extras.has("flower boxes") && w.v > 0.35) {
        // Flowers under the ground floor's windows toward the walk.
        const bloom = mix(look.hue("bloom", "#e8a0b0"), "#d86a5a", 0.25);
        ctx.fillStyle = rgba(bloom, 0.9 * ease(w.v, 0.35, 0.6));
        ctx.beginPath();
        for (const b of house.blocks) {
          for (const o of openingsOn(house.plan, b.index)) {
            if (o.door || (o.q[0] as P3)[2] > (house.plan.floor + 1.6) * K) continue;
            const [l, r] = [o.q[0] as P3, o.q[1] as P3];
            for (let j = 0; j < 3; j++) {
              const [px, py] = pen.at(l[0] + ((r[0] - l[0]) * (j + 0.5)) / 3, l[1] + ((r[1] - l[1]) * (j + 0.5)) / 3 - 0.2, l[2] - 0.1);
              ctx.moveTo(px + 0.45 * pen.s, py);
              ctx.arc(px, py, 0.45 * pen.s, 0, Math.PI * 2);
            }
          }
        }
        ctx.fill();
      }
      if (extras.has("lantern") && door !== undefined) {
        const [px, py] = pen.at(dX + 0.9 * K, dZ - 0.2, (house.plan.floor + 1.9) * K);
        ctx.beginPath();
        ctx.arc(px, py, 0.5 * pen.s, 0, Math.PI * 2);
        ctx.fillStyle = mix(look.hue("glass", "#ffbf66"), GLASS, ease(w.v, 0.7, 0.35));
        ctx.fill();
      }
    },
  }),

  "waterwheel@1": feature(waterwheelParams, {
    place: (house, p) => {
      const [X, Z] = wheelAt(house, p.wheel);
      return [X, Z];
    },
    draw: (pen, house, look, p) => drawWaterwheel(pen, house, look, p.wheel, p.drive),
  }),

  "tower@1": feature(towerParams, {
    place: (house) => {
      const t = towerAt(house, 0);
      return [t.X, t.Z];
    },
    draw: (pen, house, look, p) => drawArchiveTower(pen, house, look, p.height, p.cap),
  }),

  "lookout-tower@1": landmark(lookoutTowerParams, { draw: (pen, look, p, seed) => drawLookoutTower(pen, look, p, seed) }),
  "standing-stones@1": landmark(standingStonesParams, { draw: (pen, look, p, seed) => drawStones(pen, look, p, seed) }),
  "great-tree@1": landmark(greatTreeParams, { draw: (pen, look, p, seed) => drawGreatTree(pen, look, p, seed) }),
};

// ---------------------------------------------------------------------------------------------------------------
// Features.

/** How far a mill's wheel is turned toward the viewer from its true plane, radians. */
const TURN = (35 * Math.PI) / 180;

/** Where a mill's wheel turns, as the wheel stands it: beside the free end, its axle out of the wall; in units, with its radius. */
function wheelAt(house: House, radius: number): [number, number, number, number] {
  const { plan, side } = house;
  const W = 0.62 + 0.12 * radius;
  const x = side * (plan.width / 2 + 0.38 + W / 2);
  const z = plan.masses[0]?.ridge === "x" ? -0.15 : -plan.depth * 0.12;
  const [X, Z, H] = fromPlan(x, radius - 0.42, z);
  return [X, Z, H, radius * K];
}

/** The mill's great wheel, rimmed and spoked with paddles all round, in its own upright plane; a flume pours onto an overshot wheel, a race runs under an undershot one. It breaks up as the mill fails. */
function drawWaterwheel(pen: Pen, house: House, look: Look, radius: number, drive: string): void {
  const w = look.w;
  const { ctx } = pen;
  const [X, Z, H, r] = wheelAt(house, radius);
  const wood = worn(look.hue("timber", "#7a5636"), w);
  const water = ease(w.v, 0.12, 0.5);
  const broken = ease(w.v, 0.3, 0.04);
  // The wheel turns in the plane across the end wall, which from the south-southwest shows it nearly edge on; it is
  // drawn turned 35 degrees toward the viewer, as a draughtsman turns a wheel so it reads as one.
  const [ux, uz] = [-Math.sin(TURN), Math.cos(TURN)];
  // `across` runs along the axle, away from the viewer.
  const pt = (t: number, rad: number, across = 0): P3 => [X + Math.cos(t) * rad * ux + across * uz, Z + Math.cos(t) * rad * uz - across * ux, H + Math.sin(t) * rad];
  // The race: water running out from the pit toward the viewer, dry when the mill has failed.
  const race = on(pen, [[X - 1.4, Z + r * 0.4, 0], [X + 1.4, Z + r * 0.4, 0], [X + 1.8, Z - r - 4.5, 0], [X - 1.8, Z - r - 4.5, 0]]);
  wash(pen, race, rgba(mix("#8fa8a6", "#6f9fb4", water), 0.3 + water * 0.4));
  const gap = broken * 1.8;
  const ring = (rad: number, dx: number): Pt[] => {
    const pts: Pt[] = [];
    for (let k = 0; k <= 28; k++) {
      const t = 0.9 + gap + (k / 28) * (Math.PI * 2 - gap);
      pts.push(pen.at(...pt(t, rad, dx)));
    }
    return pts;
  };
  const far = 0.9;
  ink(pen, ring(r, far), false, 1.4, wood);
  ink(pen, ring(r, far), false, 0.5);
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    if (noise(w.seed, k + 100) < broken * 0.7) continue;
    const t = (k / 8) * Math.PI;
    const p0 = pen.at(...pt(t, r));
    const p1 = pen.at(...pt(t + Math.PI, r));
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
  }
  ctx.lineWidth = pen.line * 0.7;
  ctx.strokeStyle = shaded(wood, 0.2);
  ctx.stroke();
  const near = ring(r, 0);
  ink(pen, near, false, 2.2, INK);
  ink(pen, near, false, 1.1, wood);
  ink(pen, ring(r * 0.62, 0), false, 0.7, INK);
  ctx.beginPath();
  const paddles = Math.round(14 + 4 * radius);
  for (let k = 0; k < paddles; k++) {
    if (noise(w.seed, k + 120) < broken) continue;
    const t = (k / paddles) * Math.PI * 2;
    if (t > 0.9 && t < 0.9 + gap) continue;
    const p0 = pen.at(...pt(t, r));
    const p1 = pen.at(...pt(t, r + 0.9));
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
  }
  ctx.lineWidth = pen.line * 0.9;
  ctx.strokeStyle = INK;
  ctx.stroke();
  const [hx, hy] = pen.at(X, Z, H);
  ctx.beginPath();
  ctx.arc(hx, hy, 0.6 * pen.s, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  if (drive === "overshot") {
    // The flume on its trestles, coming in from behind the house over the wheel's top; it sags and drops as the mill fails.
    const sag = broken * 2.6;
    const top = H + r + 1.1;
    const z0 = (house.plan.depth / 2 + 2.4) * K;
    const trough = on(pen, [[X, z0, top - sag], [X, Z + 0.3, top - sag * 0.2], [X, Z + 0.3, top - 0.8 - sag * 0.2], [X, z0, top - 0.8 - sag]]);
    wash(pen, trough, worn(mix(look.hue("timber", "#8a6544"), PAPER, 0.25), w));
    ink(pen, trough, true, 0.8);
    hatch(pen, [[[X, z0 - 1.5, 0], [X, z0 - 1.5, top - 0.8 - sag * 0.9]], [[X, (z0 + Z) / 2, 0], [X + broken * 1.6, (z0 + Z) / 2, top - 0.8 - sag * 0.6]]], INK, 0.8);
    if (water > 0.05) ink(pen, on(pen, [[X, Z + 0.1, top - 0.5], [X, Z - 0.5, top - 1.6], [X, Z - 0.8, top - 2.6]]), false, 1.3 * water, rgba("#5f93b0", 0.9));
  } else if (water > 0.05) {
    // The race running under the wheel's foot.
    ink(pen, on(pen, [[X, Z + r, 0.3], [X, Z, 0.4], [X, Z - r, 0.3]]), false, 1.6 * water, rgba("#5f93b0", 0.85));
  }
}

/** Where an archive's tower stands, as the tower stands it: at the back corner on the free side, joined to the house a little; in units, with its side and height. */
function towerAt(house: House, rise: number): { X: number; Z: number; T: number; H: number } {
  const { plan, side } = house;
  const T = clamp(Math.min(plan.width, plan.depth) * 0.62, 3, 3.8);
  // How far it rises also follows how much leans on its entity; the mark takes the middle of that.
  const H = clamp(house.top + rise + 1.25, 8, 19);
  const [X, Z] = fromPlan(side * (plan.width / 2 + T / 2 - 0.35), 0, -plan.depth / 2 - T / 2 + 1.05);
  return { X, Z, T: T * K, H: H * K };
}

/** The south face's top edge from `xa` to `xb` at `z`: straight at `h`, or broken into a jagged stump as `fallen` grows. */
function jagged(xa: number, xb: number, z: number, h: number, fallen: number, seed: number): P3[] {
  if (fallen < 0.05) return [[xa, z, h], [xb, z, h]];
  const n = 5;
  const pts: P3[] = [];
  for (let k = 0; k <= n; k++) pts.push([xa + ((xb - xa) * k) / n, z, h - fallen * (noise(seed, k + 200) * 3 + (k % 2) * 1)]);
  return pts;
}

/** The west face's top edge, straight or jagged as the tower falls, from the front corner back. */
function jaggedWest(x: number, za: number, zb: number, h: number, fallen: number, seed: number): P3[] {
  if (fallen < 0.05) return [[x, zb, h], [x, za, h]];
  const pts: P3[] = [];
  for (let k = 5; k >= 0; k--) pts.push([x, za + ((zb - za) * k) / 5, h - fallen * (noise(seed, k + 300) * 2.2 + (k % 2) * 0.7)]);
  return pts;
}

/** An archive's square tower, rendered between stone quoins with narrow lamplit windows, under a steep cap or an open lantern room; it crumbles from the top as the archive fails. */
function drawArchiveTower(pen: Pen, house: House, look: Look, rise: number, cap: string): void {
  const w = look.w;
  const t = towerAt(house, rise);
  const x0 = t.X - t.T / 2;
  const x1 = t.X + t.T / 2;
  const z0 = t.Z - t.T / 2;
  const z1 = t.Z + t.T / 2;
  const fallen = ease(w.v, 0.34, 0.04);
  const top = t.H * (1 - 0.42 * fallen);
  const render = worn(look.hue("wall", "#e6e0d0"), w);
  const stone = worn(look.hue("masonry", "#b8b0a0"), w);
  face(pen, [[x0, z0, 0], [x0, z1, 0], ...jaggedWest(x0, z0, z1, top, fallen, w.seed + 4)], lit(render, 0.14));
  face(pen, [[x0, z0, 0], [x1, z0, 0], ...jagged(x1, x0, z0, top, fallen, w.seed + 1)], shaded(render, 0.16));
  // Quoins up its front corners, narrow lamplit windows.
  for (let h = 0.4, k = 0; h < top - 0.6 - fallen * 3; h += 1.3, k++) {
    const long = k % 2 === 0 ? 0.8 : 0.55;
    for (const [X, dir] of [[x1, -1], [x0, 1]] as const) pane(pen, [[X, z0, h], [X + dir * long, z0, h], [X + dir * long, z0, h + 0.6], [X, z0, h + 0.6]], shaded(stone, 0.1));
  }
  const glow = mix("#e2b75a", GLASS, ease(w.v, 0.75, 0.4));
  for (let h = house.top * K + 1.5; h < top - 2.2; h += 2.7 * K) pane(pen, [[t.X - 0.35, z0, h], [t.X + 0.35, z0, h], [t.X + 0.35, z0, h + 1.6], [t.X - 0.35, z0, h + 1.6]], glow);
  if (fallen < 0.05) {
    face(pen, [[x0, z0, top], [x1, z0, top], [x1, z1, top], [x0, z1, top]], lit(render, 0.25));
    if (cap === "lantern") lantern(pen, t.X, t.Z, t.T / 2 - 0.3, top, look);
    else pyramid(pen, t.X, t.Z, t.T / 2 + 0.5, top, t.T * 0.95, look);
  } else {
    // Its face holed where blocks have fallen out, ivy over the stump, stone at its foot.
    for (const [X, h, r] of [[t.X - t.T * 0.15, top - 3.6, 0.7], [t.X + t.T * 0.2, top - 6.2, 0.55]] as const) {
      const hole = on(pen, [[X - r, z0, h - r], [X + r * 0.6, z0, h - r * 1.2], [X + r, z0, h + r * 0.3], [X - r * 0.2, z0, h + r], [X - r * 1.1, z0, h + r * 0.2]]);
      wash(pen, hole, rgba("#2c2219", fallen * 0.85));
    }
    ivy(pen, x1 - 0.2, z0, top, w.ivy * 0.6, w.seed + 5, 1);
    rubble(pen, x1 - 0.6, z0 - 1.4, fallen * 2.6, w.seed + 2, stone);
  }
}

/** A steep four-sided cap with a finial, which sinks and loses its finial as its tower fails. */
function pyramid(pen: Pen, X: number, Z: number, half: number, base: number, height: number, look: Look): void {
  const w = look.w;
  const gone = ease(w.v, 0.62, 0.38);
  const apex = base + height * (1 - 0.6 * gone);
  const c = worn(look.hue("roof", "#5f6e86"), w, 0.5);
  face(pen, [[X - half, Z - half, base], [X + half, Z - half, base], [X, Z, apex]], shaded(c, 0.12));
  face(pen, [[X - half, Z - half, base], [X, Z, apex], [X - half, Z + half, base]], lit(c, 0.22));
  if (gone < 0.1) {
    const [ax, ay] = pen.at(X, Z, apex);
    ink(pen, [[ax, ay], [ax, ay - 1.3 * pen.s]], false, 0.7);
  }
}

/** An open lantern room: four posts and a glow under a pyramid cap, which goes first as its tower fails. */
function lantern(pen: Pen, X: number, Z: number, half: number, base: number, look: Look): void {
  const w = look.w;
  const capGone = ease(w.v, 0.62, 0.42);
  const postsGone = ease(w.v, 0.48, 0.36);
  const top = base + 2.6;
  const glow = ease(w.v, 0.55, 0.85);
  if (glow > 0.02) wash(pen, on(pen, [[X - half, Z - half, base + 0.3], [X + half, Z - half, base + 0.3], [X + half, Z - half, top], [X - half, Z - half, top]]), rgba(mix(look.hue("glass", "#f3c768"), "#f3c768", 0.5), 0.75 * glow));
  if (postsGone < 0.95) {
    const h = base + (top - base) * (1 - postsGone);
    hatch(pen, [[[X - half, Z - half, base], [X - half, Z - half, h]], [[X + half, Z - half, base], [X + half, Z - half, h]], [[X - half, Z + half, base], [X - half, Z + half, h * 0.98 + base * 0.02]]], INK, 0.9);
  }
  if (capGone < 0.9) {
    const e = 0.6;
    const apex = top + 2.6 * (1 - capGone);
    const c = worn(look.hue("roof", "#5f6e86"), w, 0.4);
    face(pen, [[X - half - e, Z - half - e, top], [X + half + e, Z - half - e, top], [X, Z, apex]], c);
    face(pen, [[X - half - e, Z - half - e, top], [X, Z, apex], [X - half - e, Z + half + e, top]], lit(c, 0.22));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Landmarks.

/** A point on a ring `r` round the axis at angle `a` (from east toward north): on a circle, or on a polygon of `sides` faces whose apothem is `r`. */
function ringPoint(sides: number, a: number, r: number): [number, number] {
  if (sides === 0) return [Math.cos(a) * r, Math.sin(a) * r];
  const sector = (Math.PI * 2) / sides;
  const k = r / Math.cos(a - Math.round(a / sector) * sector);
  return [Math.cos(a) * k, Math.sin(a) * k];
}

/** How a face turned toward `a` takes the northwest light: above 0 lit, below 0 in shade. */
const lightOf = (a: number): number => -0.8 * Math.cos(a) + 0.6 * Math.sin(a);
/** How far a face turned toward `a` looks toward the viewer at the south-southwest. */
const viewOf = (a: number): number => -0.415 * Math.cos(a) - 0.91 * Math.sin(a);

/**
 * One drum of a tower between heights `h0` and `h1` (units), its wall `r0` out at the foot and `r1` at the top: round,
 * or a polygon of `sides` faces, each face lit by how it turns to the light. With `jag` its top is broken into a
 * jagged edge. Course lines every `course` units, when given.
 */
function drum(pen: Pen, sides: number, h0: number, r0: number, h1: number, r1: number, color: string, opts: { jag?: number; seed?: number; course?: number; weight?: number; alpha?: number } = {}): void {
  const { ctx, s } = pen;
  ctx.globalAlpha = opts.alpha ?? 1;
  const jag = opts.jag ?? 0;
  const seed = opts.seed ?? 0;
  const dip = (k: number): number => (jag > 0.05 ? (noise(seed, k + 500) * 2.6 + (k % 2) * 0.8) * jag : 0);
  if (sides === 0) {
    const [bx, by] = pen.at(0, 0, h0);
    const [tx, ty] = pen.at(0, 0, h1);
    const rb = r0 * s;
    const rt = r1 * s;
    pen.at(-r0 * 1.1, 0, h0);
    pen.at(r0 * 1.1, 0, h0);
    pen.at(-r1 * 1.1, 0, h1);
    pen.at(r1 * 1.1, 0, h1);
    const body = new Path2D();
    body.moveTo(tx - rt * 1.01, ty);
    body.lineTo(bx - rb * 1.01, by);
    body.ellipse(bx, by, Math.max(0.01, rb * 1.01), Math.max(0.01, rb * 0.405), 0, Math.PI, 0, true);
    body.lineTo(tx + rt * 1.01, ty);
    if (jag > 0.05) {
      for (let k = 1; k < 7; k++) {
        const u = 1 - (k / 7) * 2;
        body.lineTo(tx + rt * 1.01 * u, ty + rt * 0.3 * Math.sqrt(1 - u * u) + dip(k) * s);
      }
    } else if (rt > 0.01) {
      body.ellipse(tx, ty, rt * 1.01, rt * 0.405, 0, 0, Math.PI, false);
    }
    body.closePath();
    const g = ctx.createLinearGradient(bx - Math.max(rb, rt), 0, bx + Math.max(rb, rt), 0);
    g.addColorStop(0, lit(color, 0.12));
    g.addColorStop(0.3, lit(color, 0.32));
    g.addColorStop(1, shaded(color, 0.32));
    ctx.fillStyle = g;
    ctx.fill(body);
    if (opts.course !== undefined && pen.fine > 0.02 && h1 - h0 > opts.course) {
      ctx.save();
      ctx.clip(body);
      ctx.beginPath();
      for (let h = h0 + opts.course; h < h1 - 0.2; h += opts.course) {
        const [cx, cy] = pen.at(0, 0, h);
        const rr = (r0 + ((r1 - r0) * (h - h0)) / (h1 - h0)) * s;
        ctx.moveTo(cx - rr * 1.01, cy);
        ctx.ellipse(cx, cy, rr * 1.01, rr * 0.405, 0, Math.PI, 0, true);
      }
      ctx.lineWidth = pen.line * 0.45;
      ctx.strokeStyle = rgba(INK, 0.35 * pen.fine);
      ctx.stroke();
      ctx.restore();
    }
    if ((opts.weight ?? 1) > 0) {
      ctx.lineWidth = pen.line * (opts.weight ?? 1);
      ctx.strokeStyle = INK;
      ctx.stroke(body);
    }
    ctx.globalAlpha = 1;
    return;
  }
  const sector = (Math.PI * 2) / sides;
  for (let k = 0; k < sides; k++) {
    const a = (k + 1) * sector;
    if (viewOf(a) < 0.02) continue;
    const [ax0, az0] = ringPoint(sides, a - sector / 2 + 1e-6, r0);
    const [bx0, bz0] = ringPoint(sides, a + sector / 2 - 1e-6, r0);
    const [ax1, az1] = ringPoint(sides, a - sector / 2 + 1e-6, r1);
    const [bx1, bz1] = ringPoint(sides, a + sector / 2 - 1e-6, r1);
    const topEdge: P3[] = [];
    const n = jag > 0.05 ? 4 : 1;
    for (let j = n; j >= 0; j--) topEdge.push([ax1 + ((bx1 - ax1) * j) / n, az1 + ((bz1 - az1) * j) / n, h1 - (j === 0 || j === n ? 0 : dip(k * 5 + j))]);
    const l = lightOf(a);
    const c = l > 0 ? lit(color, 0.18 * l) : shaded(color, -0.34 * l);
    face(pen, [[ax0, az0, h0], [bx0, bz0, h0], ...topEdge], c, opts.weight ?? 1);
    if (opts.course !== undefined && pen.fine > 0.02) {
      const lines: P3[][] = [];
      for (let h = h0 + opts.course; h < h1 - 0.2; h += opts.course) {
        const t = (h - h0) / (h1 - h0);
        lines.push([[ax0 + (ax1 - ax0) * t, az0 + (az1 - az0) * t, h], [bx0 + (bx1 - bx0) * t, bz0 + (bz1 - bz0) * t, h]]);
      }
      hatch(pen, lines, rgba(INK, 0.35), 0.45);
    }
  }
  ctx.globalAlpha = 1;
}

/** A tower's ring seen from above at height `h`: a disc, or a polygon. */
function disc(pen: Pen, sides: number, h: number, r: number, color: string, weight = 1): void {
  const pts: P3[] = [];
  const n = sides === 0 ? 24 : sides;
  for (let k = 0; k < n; k++) {
    const a = sides === 0 ? (k / n) * Math.PI * 2 : (k + 0.5) * ((Math.PI * 2) / sides);
    const [X, Z] = ringPoint(sides, a, r);
    pts.push([X, Z, h]);
  }
  face(pen, pts, color, weight);
}

/** A tower's open lantern room: posts round a glow, which go as its tower fails. */
function lanternRoom(pen: Pen, sides: number, base: number, r: number, height: number, look: Look, posts: number, glass: number): void {
  const glow = 1 - glass;
  const top = base + height;
  if (glow > 0.02) drum(pen, sides, base, r, top, r, mix(look.hue("glass", "#f4cb6a"), "#f4cb6a", 0.5), { weight: 0, alpha: 0.85 * glow });
  if (posts < 0.95) {
    const lines: P3[][] = [];
    const n = sides === 0 ? 6 : sides;
    for (let k = 0; k < n; k++) {
      const a = (k + (sides === 0 ? 0 : 0.5)) * ((Math.PI * 2) / n);
      if (viewOf(a) < -0.5) continue;
      const [X, Z] = ringPoint(sides, a, r);
      lines.push([[X, Z, base], [X, Z, base + height * (1 - posts)]]);
    }
    hatch(pen, lines, INK, 0.9);
  }
}

/** A tower's walkway on corbels at height `h`, ringing a wall `r` out: the corbels, the floor and the parapet, `parapet` units high. */
function gallery(pen: Pen, sides: number, h: number, r: number, parapet: number, stone: string): void {
  const out = r + 0.95 * LK;
  drum(pen, sides, h - 0.8 * LK, r, h, out, shaded(stone, 0.22));
  disc(pen, sides, h, out, lit(stone, 0.2));
  if (parapet > 0) drum(pen, sides, h, out, h + parapet, out, stone, { weight: 0.8 });
}

/** Battlements round an open top at `h`, on a wall `r` out: far merlons, the walk, the near parapet and its merlons, each going one by one as the tower fails. */
function battlements(pen: Pen, sides: number, h: number, r: number, stone: string, w: Wear, seed: number): void {
  const n = Math.max(6, Math.round((Math.PI * 2 * r) / (1.9 * LK)));
  const kept = (k: number): boolean => noise(seed, k + 400) * 0.5 + 0.38 < w.v;
  const m = 0.45 * LK;
  const merlon = (k: number, h0: number, h1: number): void => {
    const [X, Z] = ringPoint(sides, (k / n) * Math.PI * 2, r - m);
    box(pen, X - m, X + m, Z - m, Z + m, h0, h1, stone, null, 0.7);
  };
  disc(pen, sides, h + 0.2, r, shaded(stone, 0.45));
  for (let k = 0; k < n; k++) if (Math.sin((k / n) * Math.PI * 2) > 0 && kept(k)) merlon(k, h, h + 1.7 * LK);
  drum(pen, sides, h - 0.2, r, h + 1, r, stone, { weight: 0.9 });
  for (let k = 0; k < n; k++) if (Math.sin((k / n) * Math.PI * 2) <= 0 && kept(k)) merlon(k, h + 1, h + 1.8 * LK);
}

/** A cone or a many-sided spire from a ring `r` out at `h0` up to its point at `h1`, rotting through as its tower fails; a finial while it is whole. */
function spire(pen: Pen, sides: number, h0: number, r: number, h1: number, look: Look, gone: number, seed: number): void {
  const c = worn(look.hue("roof", "#5d8a7a"), look.w, 0.5);
  const apex = h0 + (h1 - h0) * (1 - 0.55 * gone);
  drum(pen, sides, h0, r, apex, 0, c);
  if (gone < 0.1) {
    const [ax, ay] = pen.at(0, 0, apex);
    ink(pen, [[ax, ay], [ax, ay - 1.4 * pen.s]], false, 0.8);
  } else {
    const [ex, ey] = pen.at(r * 0.2, -r * 0.9, h0);
    const [fx, fy] = pen.at(r, 0, h0);
    const [tx, ty] = pen.at(0, 0, apex);
    rotHole(pen, [ex, ey], [fx, fy], lerp([fx, fy], [tx, ty], 0.8), lerp([ex, ey], [tx, ty], 0.8), gone * 0.8, seed + 3);
  }
}

/** A stone tower from its own words: its plan, how it rises, its galleries and crown; the crown goes first, then the shaft falls from the top. */
function drawLookoutTower(pen: Pen, look: Look, p: Resolved<typeof lookoutTowerParams>, seed: number): void {
  const w = look.w;
  const sides = p.plan === "round" ? 0 : p.plan === "square" ? 4 : 8;
  const m = p.height;
  const radius = m * (p.profile === "stepped" ? 0.165 : 0.15);
  const hasGallery = p.galleries !== "none";
  const drumM = Math.max(1.6, m * 0.1);
  const shaftM =
    p.crown === "a conical roof" ? m * 0.74 - (hasGallery ? 0.24 + drumM : 0.3)
    : p.crown === "an open lantern room" ? m * (hasGallery ? 0.72 : 0.78)
    : p.crown === "battlements" ? m * 0.9
    : m * 0.96;
  const count = m >= 15 ? 3 : 2;
  const stagesM = Array.from({ length: count - 1 }, (_, k) => (shaftM * (k + 1)) / count);
  const wallAt = (yM: number): number => {
    const t = clamp01(yM / shaftM);
    const stage = stagesM.filter((y) => yM >= y - 1e-6).length;
    const lean = p.profile === "tapering" ? 1 - 0.26 * t : p.profile === "stepped" ? (1 - 0.17 * stage) * (1 - 0.04 * t) : 1 - 0.04 * t;
    return radius * lean * LK;
  };
  const broken = p.crown === "a broken top";
  const fall = ease(w.v, 0.36, 0.03);
  const jag = broken ? Math.max(0.45, fall) : fall;
  const shaft = shaftM * LK;
  const top = shaft * (1 - 0.45 * fall);
  const stone = worn(look.hue("masonry", "#d2c39f"), w);
  const course = 0.56 * p.masonry * 2 * LK;
  const r0 = wallAt(0);
  castShadow(pen, ellipseFeet(0, 0, r0, r0, top * 0.8));
  // The hollow inside a broken top, its far wall in shade.
  if (jag > 0.05) disc(pen, sides, top - jag * 1.2, wallAt((top / LK) * 0.99) * 0.9, shaded(stone, 0.55), 0.6);
  // The shaft, stage by stage, a string course where each sets back.
  const breaks = [0, ...stagesM.map((y) => y * LK).filter((y) => y < top - 0.5), top];
  for (let i = 0; i + 1 < breaks.length; i++) {
    const h0 = breaks[i] as number;
    const h1 = breaks[i + 1] as number;
    const last = i + 2 === breaks.length;
    drum(pen, sides, h0, wallAt(h0 / LK + 0.01), h1, wallAt(h1 / LK - 0.01), stone, { jag: last ? jag : 0, seed, course });
    if (!last && p.profile === "stepped") disc(pen, sides, h1, wallAt(h1 / LK - 0.01), lit(stone, 0.2), 0.8);
  }
  // Slit windows up the face toward the viewer, and the door.
  const ahead = Math.atan2(-0.91, -0.415);
  for (let h = 3.2 * LK; h < top - 1.6 * LK; h += 3.6 * LK) {
    const [X, Z] = ringPoint(sides, sides === 0 ? ahead : -Math.PI / 2, wallAt(h / LK));
    pane(pen, [[X - 0.3, Z, h], [X + 0.3, Z, h], [X + 0.3, Z, h + 1.3], [X - 0.3, Z, h + 1.3]]);
  }
  const [dX, dZ] = ringPoint(sides, sides === 0 ? ahead : -Math.PI / 2, r0);
  towerDoor(pen, dX, dZ, 0.75, 2.6, worn("#5a4030", w));
  tufts(pen, [[-r0 - 0.6, -r0 * 0.5], [r0 + 0.4, -r0 * 0.4]], w);
  // Galleries where the stages meet, while they stand.
  const tiers = { cap: ease(w.v, 0.66, 0.46), glass: ease(w.v, 0.6, 0.4), posts: ease(w.v, 0.5, 0.38), gallery: ease(w.v, 0.42, 0.34) };
  if (p.galleries === "a gallery at every stage" && tiers.gallery < 0.9) for (const y of stagesM) if (y * LK < top - 1) gallery(pen, sides, y * LK, wallAt(y), 0.9 * LK, stone);
  if (jag > 0.05) {
    ivy(pen, -r0 * 0.5, -r0 * 0.9, top, w.ivy, seed, -1);
    rubble(pen, r0 * 0.8, -r0 - 1.2, (broken ? 1.6 : 0) + fall * 3, seed + 4, stone);
    return;
  }
  // The crown, on a gallery at the top if it has one.
  const head = wallAt(shaftM - 0.01);
  let crownBase = top;
  let crownR = head;
  if (hasGallery && tiers.gallery < 0.9) {
    const parapet = p.crown === "battlements" ? 0 : p.crown === "an open lantern room" ? 0.5 * LK : 0.9 * LK;
    gallery(pen, sides, top + 0.25 * LK, head, parapet, stone);
    crownBase = top + 0.25 * LK;
    crownR = head + 0.95 * LK;
  }
  if (p.crown === "battlements") {
    battlements(pen, sides, crownBase, crownR, stone, w, seed);
  } else if (p.crown === "an open lantern room") {
    const lr = head * 0.72;
    const lh = Math.max(2.2, m * 0.12) * LK;
    lanternRoom(pen, sides, crownBase, lr, lh, look, tiers.posts, tiers.glass);
    if (tiers.cap < 0.9) spire(pen, sides, crownBase + lh * (1 - tiers.posts), lr + 0.5 * LK, Math.max(crownBase + lh + 1.4 * LK, m * LK), look, tiers.cap, seed);
  } else if (tiers.cap < 0.9) {
    // A drum inside the gallery carries the roof, whose eaves sit about three quarters up.
    let eaves = crownBase;
    let eavesR = head + 0.4 * LK;
    if (hasGallery) {
      eaves = crownBase + drumM * LK;
      drum(pen, sides, crownBase, head * 0.82, eaves, head * 0.82, stone);
      eavesR = head * 0.82 + 0.6 * LK;
    }
    spire(pen, sides, eaves, eavesR, m * LK, look, tiers.cap, seed);
  }
}

/** Which way an avenue of stones runs, radians from east toward north. */
const AVENUE = (32 * Math.PI) / 180;

/** A standing stone at (`X`, `Z`): `h` tall and `wd` wide; it leans whole about its foot toward `a` (radians from east toward north) as `lean` grows to 1, lying in the grass, or snaps. */
interface Stone {
  readonly X: number;
  readonly Z: number;
  readonly h: number;
  readonly wd: number;
  readonly a: number;
  readonly lean: number;
  readonly snapped: boolean;
  readonly king: boolean;
  readonly broken?: boolean;
}

/** One standing stone: a tall slab with a rounded or a faceted top, lit on its west edge; leaning out about its foot as `lean` grows, and lying in the grass at 1. */
function drawStone(pen: Pen, st: Stone, grey: string, sharp: boolean, seed: number): void {
  const t = st.lean * (Math.PI / 2) * 0.96;
  const ox = Math.cos(st.a);
  const oz = Math.sin(st.a);
  const up = Math.cos(t);
  const out = Math.sin(t);
  const half = st.wd / 2;
  // Across the slab: a standing stone shows the viewer its broad face; one lying down lies across its fall.
  const ax = 1 + (-oz - 1) * st.lean;
  const az = ox * st.lean;
  const al = Math.hypot(ax, az) || 1;
  const cx = (ax / al) * half;
  const cz = (az / al) * half;
  const len = st.h * (1 - 0.3 * st.lean);
  const wide = 1 + 0.3 * st.lean;
  const tipAt = (f: number, side: number): P3 => [st.X + ox * out * len * f + cx * wide * side * (1 - f * 0.35), st.Z + oz * out * len * f + cz * wide * side * (1 - f * 0.35), st.h * f * up];
  const pts: P3[] = st.broken
    ? [tipAt(0, -1), tipAt(0, 1), tipAt(0.9, 1), tipAt(1, 0.3), tipAt(0.82, -0.2), tipAt(0.96, -1)]
    : sharp ? [tipAt(0, -1), tipAt(0, 1), tipAt(0.72, 1), tipAt(1, 0.2), tipAt(0.86, -0.7), tipAt(0.7, -1)]
    : [tipAt(0, -1), tipAt(0, 1), tipAt(0.8, 1), tipAt(0.95, 0.6), tipAt(1, 0), tipAt(0.95, -0.6), tipAt(0.8, -1)];
  const p = on(pen, pts);
  const { ctx } = pen;
  trace(ctx, p);
  const xs = p.map((q) => q[0]);
  const g = ctx.createLinearGradient(Math.min(...xs), 0, Math.max(...xs), 0);
  const stone = st.lean > 0.9 ? shaded(grey, 0.06) : grey;
  g.addColorStop(0, lit(stone, 0.3));
  g.addColorStop(0.45, stone);
  g.addColorStop(1, shaded(stone, 0.3));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = pen.line * (st.king ? 1 : 0.9);
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (noise(seed, 1) > 0.4 && st.lean < 0.5) hatch(pen, [[tipAt(0.3, -0.2), tipAt(0.55, 0.15)]], rgba(INK, 0.4), 0.45);
}

/** A cairn: small stones piled in a rounded cone at (`X`, `Z`), `tall` units high; its top stones tumble first, sliding down the pile. */
function drawCairn(pen: Pen, X: number, Z: number, tall: number, grey: string, w: Wear, seed: number): void {
  const { ctx, s } = pen;
  const lost = ease(w.v, 0.42 + noise(seed, 3) * 0.2, 0.05) * 0.55;
  const H = tall * (1 - lost);
  const R = tall * 0.62 * (1 + lost * 0.4);
  const [bx, by] = pen.at(X, Z, 0);
  const [tx, ty] = pen.at(X, Z, H);
  pen.at(X - R, Z, 0);
  pen.at(X + R, Z, 0);
  const rx = R * 1.01 * s;
  const ry = R * 0.405 * s;
  const mound = new Path2D();
  mound.moveTo(bx - rx, by);
  mound.bezierCurveTo(bx - rx * 0.7, by - (by - ty) * 0.55, tx - rx * 0.35, ty, tx, ty);
  mound.bezierCurveTo(tx + rx * 0.35, ty, bx + rx * 0.7, by - (by - ty) * 0.55, bx + rx, by);
  mound.ellipse(bx, by, rx, ry, 0, 0, Math.PI, false);
  mound.closePath();
  const g = ctx.createLinearGradient(bx - rx, 0, bx + rx, 0);
  g.addColorStop(0, lit(grey, 0.3));
  g.addColorStop(0.45, grey);
  g.addColorStop(1, shaded(grey, 0.32));
  ctx.fillStyle = g;
  ctx.fill(mound);
  if (pen.fine > 0.02) {
    ctx.save();
    ctx.clip(mound);
    ctx.beginPath();
    for (let row = 0; row < 5; row++) {
      const hh = (row + 0.5) / 5;
      const across = Math.max(1, Math.round(5 * (1 - hh)));
      for (let j = 0; j < across; j++) {
        const u = ((j + 0.5) / across - 0.5) * (1 - hh * 0.8) * 2;
        const px = bx + u * rx * 0.9;
        const py = by - (by - ty) * hh + ry * 0.4;
        const r = (0.5 + noise(seed, row * 7 + j) * 0.3) * s * Math.max(0.6, tall / 6);
        ctx.moveTo(px + r * 1.3, py);
        ctx.ellipse(px, py, r * 1.3, r * 0.8, 0, 0, Math.PI * 2);
      }
    }
    ctx.lineWidth = pen.line * 0.45;
    ctx.strokeStyle = rgba(INK, 0.45 * pen.fine);
    ctx.stroke();
    ctx.restore();
  }
  ctx.lineWidth = pen.line;
  ctx.strokeStyle = INK;
  ctx.stroke(mound);
  rubble(pen, X + R * 0.6, Z - R * 0.5, lost * tall * 0.6, seed, grey);
}

/** A dolmen's capstone across its uprights' tops, tipping off as it fails until its far edge rests on the ground. */
function capstone(pen: Pen, X: number, Z: number, L: number, W: number, h: number, thick: number, tip: number, grey: string): void {
  // It tips about its west edge: its east end comes down.
  const east = h * (1 - tip);
  const pts = (dh: number): P3[] => [[X - L / 2, Z - W / 2, h + dh], [X + L / 2, Z - W / 2, east + dh], [X + L / 2, Z + W / 2, east + dh], [X - L / 2, Z + W / 2, h + dh]];
  const [b0, b1] = pts(0);
  const [t0, t1, t2, t3] = pts(thick);
  face(pen, [b0 as P3, b1 as P3, t1 as P3, t0 as P3], shaded(grey, 0.2));
  face(pen, [[X - L / 2, Z - W / 2, h], t0 as P3, t3 as P3, [X - L / 2, Z + W / 2, h]], lit(grey, 0.1));
  face(pen, [t0 as P3, t1 as P3, t2 as P3, t3 as P3], lit(grey, 0.28));
}

/** Great stones in their arrangement: a ring, an avenue, a dolmen, a field of cairns or loose menhirs. The lintels and capstone go first; then the stones lean, snap or lie down. */
function drawStones(pen: Pen, look: Look, p: Resolved<typeof standingStonesParams>, seed: number): void {
  const w = look.w;
  const h = p.height * LK;
  const n = Math.max(4, Math.round(p.count));
  const wd = h * 0.42;
  const grey = worn(look.hue("stone", "#c4c2b6"), w);
  const sharp = p.facets > 0.7;
  const stones: Stone[] = [];
  const lintels: [number, number][] = [];
  const cairns: [number, number, number][] = [];
  let heart: [number, number] = [0, 0];
  let cap: { X: number; Z: number; L: number; W: number; h: number } | null = null;
  /** A stone that stands until vitality drops past its own threshold, then leans out over a stretch and lies down, or snaps. */
  const stand = (k: number, X: number, Z: number, height: number, width: number, out: number, leaning = 0): Stone => {
    const th = -0.04 + noise(seed, k + 600) * 0.56;
    const snaps = noise(seed, k + 640) < 0.3;
    const fall = out + (noise(seed, k + 630) < 0.5 ? 1 : -1) * (Math.PI / 2 - noise(seed, k + 635) * 0.9);
    return { X, Z, h: height, wd: width, a: fall, lean: snaps ? 0 : Math.max(leaning, ease(w.v, th + 0.12, th)), snapped: snaps && w.v < th, king: false };
  };
  if (p.arrangement === "ring") {
    const R = Math.max(h * 1.1, (n * wd * 1.75) / (Math.PI * 2));
    const turn = noise(seed, 1) * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = turn + (k / n) * Math.PI * 2;
      // A fallen stone lies along the ring more than out of it, so the ring still shows in the grass.
      stones.push(stand(k, Math.cos(a) * R, Math.sin(a) * R, h * (0.88 + noise(seed, k + 610) * 0.26), wd * (0.9 + noise(seed, k + 620) * 0.25), a));
    }
    if (p.lintels) for (let k = 0; k + 1 < n; k += 2) lintels.push([k, k + 1]);
  } else if (p.arrangement === "avenue") {
    // Two facing rows, rising toward the head. Seen side on the rows would stand in one line like a fence, so the
    // avenue is drawn running away from the viewer at a slant, its head to the east-northeast.
    const pairs = Math.max(2, Math.round(n / 2));
    const spacing = wd * 2.1;
    const across = clamp(p.height * 0.9, 3, 5) * LK;
    const length = (pairs - 1) * spacing;
    const [ax, az] = [Math.cos(AVENUE), Math.sin(AVENUE)];
    const at = (along: number, side: number): [number, number] => [along * ax - side * az, along * az + side * ax];
    for (let k = 0; k < pairs; k++) {
      const t = k / (pairs - 1);
      for (const side of [-1, 1]) stones.push(stand(stones.length, ...at(-length / 2 + k * spacing, (side * across) / 2), h * (0.72 + 0.38 * t), wd, AVENUE + (side * Math.PI) / 2));
      if (p.lintels && k % 2 === 1) lintels.push([stones.length - 2, stones.length - 1]);
    }
    heart = at(length / 2 + spacing * 1.1, 0);
  } else if (p.arrangement === "dolmen") {
    // A chamber of uprights under one great capstone, in a ring of low kerb stones.
    const legH = Math.max(1.6, p.height * 0.6) * LK;
    const capL = Math.max(3.4, p.height * 1.2) * LK;
    const capW = capL * 0.66;
    const uprights = clamp(Math.round(n / 3), 3, 5);
    const legs: [number, number][] = uprights === 3 ? [[-0.28, -0.3], [0.28, -0.3], [0, 0.36]] : [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3], ...(uprights === 5 ? [[0, 0.42] as [number, number]] : [])];
    const kerb = Math.round(n * 1.5);
    const kerbR = capL * 0.95;
    for (let k = 0; k < kerb; k++) {
      const a = (k / kerb) * Math.PI * 2;
      stones.push(stand(k + 50, Math.cos(a) * kerbR, Math.sin(a) * kerbR * 0.85, h * 0.2, h * 0.24, a));
    }
    // The uprights on the east side give way outward, after the capstone has tipped off.
    for (const [fx, fz] of legs) stones.push({ X: fx * capL, Z: fz * capW, h: legH, wd: capW * 0.42, a: fx >= 0 ? 0 : Math.PI, lean: fx >= 0 ? ease(w.v, 0.3, 0.12) * 0.7 : ease(w.v, 0.2, 0.05) * 0.15, snapped: false, king: false });
    cap = { X: 0, Z: 0, L: capL, W: capW, h: legH };
  } else if (p.arrangement === "cairn field") {
    const count = clamp(Math.round(n * 0.6), 3, 9);
    const spread = Math.max(5, p.height * 1.6) * LK;
    for (let k = 0, tries = 0; k < count && tries < 200; tries++) {
      const a = noise(seed, tries + 700) * Math.PI * 2;
      const d = k === 0 ? 0 : spread * Math.sqrt(0.15 + noise(seed, tries + 710) * 0.85);
      const tall = h * (k === 0 ? 1 : 0.45 + noise(seed, tries + 720) * 0.35);
      const X = Math.cos(a) * d;
      const Z = Math.sin(a) * d * 0.8;
      if (cairns.some(([cx, cz, ct]) => Math.hypot(cx - X, cz - Z) < ct * 0.6 + tall * 0.6 + 0.8)) continue;
      cairns.push([X, Z, tall]);
      k++;
    }
  } else {
    // Lone menhirs scattered loosely, taller than a ring's, some already leaning.
    const spread = Math.max(h * 1.3, Math.sqrt(n) * h * 0.75);
    for (let tries = 0; stones.length < n && tries < 300; tries++) {
      const a = noise(seed, tries + 800) * Math.PI * 2;
      const d = spread * Math.sqrt(noise(seed, tries + 810));
      const X = Math.cos(a) * d;
      const Z = Math.sin(a) * d * 0.8;
      if (stones.some((st) => Math.hypot(st.X - X, st.Z - Z) < h * 0.9)) continue;
      const leaning = noise(seed, tries + 820) < 0.45 ? 0.08 + noise(seed, tries + 830) * 0.18 : 0;
      stones.push(stand(stones.length, X, Z, h * 1.25, wd * 0.85, a, leaning));
    }
  }
  if (p.centre !== "nothing" && p.arrangement !== "dolmen") {
    const king = p.centre === "a tall king stone";
    stones.push({ X: heart[0], Z: heart[1] + 0.4, h: king ? h * 1.55 : h * 0.3, wd: king ? wd * 1.1 : h * 0.9, a: -Math.PI / 2 + 0.5, lean: ease(w.v, 0.2, 0.04), snapped: false, king });
  }
  // The shadow over the whole arrangement.
  const feet: [number, number, number][] = [...stones.map((st) => [st.X, st.Z, st.h * 0.5] as [number, number, number]), ...cairns.map(([X, Z, t]) => [X, Z, t * 0.6] as [number, number, number])];
  castShadow(pen, feet, 0.7);
  // Lintels drop first, before their stones.
  const up = (k: number): boolean => (stones[k] as Stone).lean < 0.02 && !(stones[k] as Stone).snapped;
  const standing = lintels.filter(([i, j]) => w.v > 0.5 + noise(seed, i + 650) * 0.35 && up(i) && up(j));
  const things: { depth: number; draw: () => void }[] = [];
  stones.forEach((st, i) => {
    things.push({
      depth: depthOf(st.X, st.Z),
      draw: () => {
        if (st.snapped) {
          // The top lies at the foot, then the stump stands over it.
          drawStone(pen, { ...st, X: st.X + Math.cos(st.a) * 1.6, Z: st.Z + Math.sin(st.a) * 1.6, h: st.h * 0.6, lean: 1 }, grey, sharp, seed + i);
          drawStone(pen, { ...st, h: st.h * 0.42, broken: true }, grey, sharp, seed + i);
        } else drawStone(pen, st, grey, sharp, seed + i);
      },
    });
  });
  for (const [i, j] of standing) {
    const a = stones[i] as Stone;
    const b = stones[j] as Stone;
    const lh = Math.min(a.h, b.h);
    things.push({
      depth: Math.min(depthOf(a.X, a.Z), depthOf(b.X, b.Z)) - 0.01,
      draw: () => {
        face(pen, [[a.X, a.Z, lh - 0.2], [b.X, b.Z, lh - 0.2], [b.X, b.Z, lh + 1], [a.X, a.Z, lh + 1]], shaded(grey, 0.12), 0.85);
        // Its top, seen past its near face: the slab's depth runs across the line between its stones, away from the viewer.
        const len = Math.hypot(b.X - a.X, b.Z - a.Z) || 1;
        const [px, pz] = [(-(b.Z - a.Z) / len) * 0.9, ((b.X - a.X) / len) * 0.9];
        const [dx, dz] = pz >= 0 ? [px, pz] : [-px, -pz];
        face(pen, [[a.X, a.Z, lh + 1], [b.X, b.Z, lh + 1], [b.X + dx, b.Z + dz, lh + 1], [a.X + dx, a.Z + dz, lh + 1]], lit(grey, 0.2), 0.85);
      },
    });
  }
  for (const [k, [X, Z, t]] of cairns.entries()) things.push({ depth: depthOf(X, Z), draw: () => drawCairn(pen, X, Z, t, grey, w, seed + k * 13) });
  if (cap !== null) {
    const c = cap;
    things.push({ depth: depthOf(c.X, c.Z) - 2, draw: () => capstone(pen, c.X, c.Z, c.L, c.W, c.h, h * 0.2, ease(w.v, 0.62, 0.35), grey) });
  }
  things.sort((a, b) => b.depth - a.depth).forEach((t) => t.draw());
  const spread = Math.max(h, ...feet.map(([X, Z]) => Math.hypot(X, Z)));
  tufts(pen, [[-spread - 1, -1.6], [spread * 0.6, -spread * 0.7], [0.4, -spread - 1.2]], w);
}

/** How each great tree grows, at "vast": its trunk, its crown as lobes (east, up, radius in units), its great limbs, and its green. */
const TREE_FORMS: Readonly<Record<string, { trunk: number; girth: number; crown: (seed: number) => [number, number, number][]; green: string; limbs: readonly (readonly [readonly (readonly [number, number])[], number])[] }>> = {
  "a spreading oak": {
    trunk: 4.6,
    girth: 1.3,
    green: "#5a8a3f",
    crown: () => [[-10.4, 8.4, 3], [-7.2, 10.8, 3.6], [-3, 12.2, 3.8], [1.8, 12.4, 3.8], [6.2, 11.2, 3.6], [10.2, 8.6, 3.1], [-6.4, 7.4, 3.2], [-1.4, 8.4, 3.8], [3.8, 8.2, 3.6], [7.6, 7.2, 3], [-0.6, 10.6, 3.4]],
    limbs: [[[[-0.8, 4.2], [-4.5, 7.4], [-10, 8.6]], 1.3], [[[-0.4, 4.4], [-2.4, 9.4], [-3.6, 13]], 1.1], [[[0.4, 4.4], [2.4, 9.2], [2.6, 13.4]], 1.1], [[[-4.5, 7.4], [-6.6, 10.8]], 0.6], [[[0.8, 4.2], [4.8, 7.2], [10, 8.2]], 1.3], [[[4.8, 7.2], [6.4, 11]], 0.6]],
  },
  "a tall elm": {
    trunk: 7.5,
    girth: 1.1,
    green: "#6b9a45",
    crown: (seed) => dome(seed, 0, 15.5, 7.2, 7.4, 3.2, 13),
    limbs: [[[[-0.5, 7], [-3.2, 12], [-5, 17]], 1], [[[0.4, 7], [2.8, 12.4], [4.4, 17.4]], 1], [[[0, 7.2], [0.4, 14], [0, 20]], 0.9]],
  },
  "an umbrella pine": {
    trunk: 13,
    girth: 0.95,
    green: "#4f7a4a",
    crown: (seed) => [...dome(seed, 0, 15.6, 10.4, 2.6, 3, 11), [-5, 17.6, 3.2], [0, 18.2, 3.4], [5, 17.6, 3.2]],
    limbs: [[[[0, 12], [-4, 14.6], [-8, 15.6]], 0.8], [[[0, 12], [4.4, 14.4], [8.4, 15.4]], 0.8]],
  },
  "a dark yew": {
    trunk: 2.6,
    girth: 1.5,
    green: "#3e6440",
    crown: (seed) => dome(seed, 0, 7, 10, 5.6, 3.4, 16),
    limbs: [[[[-0.6, 2.4], [-5, 5]], 0.9], [[[0.6, 2.4], [5, 5.2]], 0.9]],
  },
};

/** Lobes over a dome centered `h` up, `rx` across and `ry` high: a ring round its outline and a few inside, each about `r`. */
function dome(seed: number, dx: number, h: number, rx: number, ry: number, r: number, count: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const rim = Math.ceil(count * 0.65);
  for (let k = 0; k < rim; k++) {
    const a = Math.PI * (0.02 + (0.96 * k) / (rim - 1));
    out.push([dx - Math.cos(a) * rx, h + Math.sin(a) * ry * 0.9 - ry * 0.25, r * (0.85 + noise(seed, k + 900) * 0.3)]);
  }
  for (let k = rim; k < count; k++) out.push([dx + (noise(seed, k + 910) - 0.5) * rx * 1.2, h + (noise(seed, k + 920) - 0.6) * ry * 0.8, r * (0.95 + noise(seed, k + 930) * 0.3)]);
  return out;
}

/** A great tree from its form and age: a lobed crown on a trunk that flares and forks lower as it ages, bare limbs above an ancient crown; it thins, browns and stands bare as it fails. */
function drawGreatTree(pen: Pen, look: Look, p: Resolved<typeof greatTreeParams>, seed: number): void {
  if (p.form === "a great willow") {
    greatWillow(pen, look, p.size / 2.7, p.age, seed);
    return;
  }
  const form = TREE_FORMS[p.form] ?? (TREE_FORMS["a spreading oak"] as NonNullable<(typeof TREE_FORMS)[string]>);
  const w = look.w;
  const { ctx } = pen;
  // A young giant stands a little taller; an ancient one spreads lower and wider.
  const f = (p.size / 2.7) * (1.06 - 0.12 * p.age);
  const at = (dx: number, h: number): Pt => pen.up(dx * f * (1 + 0.1 * p.age), h * f);
  const leaf = ease(w.v, 0.1, 0.8);
  const lobes = form.crown(seed);
  const width = Math.max(...lobes.map(([dx, , r]) => Math.abs(dx) + r));
  castShadow(pen, ellipseFeet(width * f * 0.25, -width * f * 0.3, width * f * 0.85 * (0.5 + leaf * 0.5), width * f * 0.55 * (0.5 + leaf * 0.5), 0), 0.5 + leaf * 0.6);
  const bark = worn(mix(look.hue("bark", "#6d533a"), "#6d533a", 0.5), w);
  const g = form.girth * (0.8 + 0.4 * p.age);
  // On a ruin one great bough has snapped and lies below.
  const snapped = ease(w.v, 0.2, 0.05);
  // Stag-headed: an old tree's highest limbs stand bare above its crown.
  const crownTop = Math.max(...lobes.map(([, h, r]) => h + r));
  const stag: (readonly [readonly (readonly [number, number])[], number])[] = p.age > 0.6 ? [[[[-1.5, crownTop - 4], [-2.4, crownTop + 1.6], [-1.4, crownTop + 3.4]], 0.45], [[[1.6, crownTop - 4], [2.6, crownTop + 2.2]], 0.4]] : [];
  const limbs = [...form.limbs.slice(0, snapped > 0.5 ? -1 : undefined), ...stag];
  const flare = 1 + 0.6 * p.age;
  const trunk = [at(-1.6 * g * flare, -0.2), at(-g, 1), at(-g * 0.85, form.trunk), at(g * 0.85, form.trunk), at(g, 1), at(1.7 * g * flare, -0.2)];
  const stroke = (extra: number, color: string): void => {
    for (const [pts, width0] of limbs) {
      ctx.beginPath();
      pts.forEach(([dx, h], i) => {
        const [px, py] = at(dx, h);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.lineWidth = width0 * f * pen.s + extra;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  };
  stroke(pen.line * 1.4, INK);
  wash(pen, trunk, bark);
  ink(pen, trunk, false, 1);
  stroke(0, bark);
  tufts(pen, [[-3.4 * f * flare, -0.8], [3.6 * f * flare, -0.6]], w);
  if (snapped > 0.5) {
    const fallen = [at(form.trunk * 0.9, -1.4), at(form.trunk * 0.9 + 7, -0.4)];
    ink(pen, fallen, false, 2.6);
    ink(pen, fallen, false, 1.5, bark);
  }
  // The crown in lobes, each going as the tree fails past its own threshold; their union inked round its edge only.
  const full = 0.82 + 0.18 * p.fullness;
  const kept = lobes.map(([dx, h, r], k) => ({ dx, h, r: r * full * clamp01((w.v - (0.1 + noise(seed, k + 700) * 0.55)) / 0.25) * (0.8 + leaf * 0.2) })).filter((l) => l.r > 0.5);
  if (kept.length === 0) return;
  const crown = new Path2D();
  for (const l of kept) {
    const [px, py] = at(l.dx, l.h);
    pen.up((l.dx - l.r) * f, (l.h + l.r) * f);
    pen.up((l.dx + l.r) * f, (l.h + l.r) * f);
    crown.moveTo(px + l.r * f * pen.s, py);
    crown.arc(px, py, l.r * f * pen.s, 0, Math.PI * 2);
  }
  const green = mix(mix(mix(form.green, PAPER, 0.1), "#ad9f55", w.dry * 0.95), "#9a7444", ease(w.v, 0.42, 0.12));
  ctx.lineWidth = pen.line * 2;
  ctx.strokeStyle = INK;
  ctx.stroke(crown);
  ctx.fillStyle = green;
  ctx.fill(crown);
  ctx.save();
  ctx.clip(crown);
  // Shade under each lobe to the southeast, the light on its northwest shoulder, and a scallop of ink where lobes meet.
  const shadePath = new Path2D();
  const lightPath = new Path2D();
  for (const l of kept) {
    const [px, py] = at(l.dx, l.h);
    const r = l.r * f * pen.s;
    shadePath.moveTo(px + r * 1.25, py + r * 0.5);
    shadePath.arc(px + r * 0.25, py + r * 0.5, r, 0, Math.PI * 2);
    lightPath.moveTo(px - r * 0.3 + r * 0.5, py - r * 0.38);
    lightPath.arc(px - r * 0.3, py - r * 0.38, r * 0.5, 0, Math.PI * 2);
  }
  ctx.fillStyle = rgba(SHADE, 0.22);
  ctx.fill(shadePath);
  ctx.fillStyle = rgba("#e8f0a8", 0.3 * (1 - w.dry * 0.6));
  ctx.fill(lightPath);
  ctx.beginPath();
  for (const l of kept) {
    const [px, py] = at(l.dx, l.h);
    const r = l.r * f * pen.s;
    ctx.moveTo(px - r * 0.7, py + r * 0.72);
    ctx.arc(px, py, r, Math.PI * 0.78, Math.PI * 0.25, true);
  }
  ctx.lineWidth = pen.line * 0.55;
  ctx.strokeStyle = rgba(INK, 0.45);
  ctx.stroke();
  ctx.restore();
}

/** A great willow: an arching dome on a gnarled trunk, its curtain of hanging strands sweeping almost to the ground; failing, the strands shorten and thin to bare whips. */
function greatWillow(pen: Pen, look: Look, f: number, age: number, seed: number): void {
  const w = look.w;
  const { ctx } = pen;
  const s = pen.s * f;
  const leaf = ease(w.v, 0.08, 0.7);
  castShadow(pen, ellipseFeet(2.6 * f, -3 * f, 10 * f * (0.55 + leaf * 0.45), 6 * f * (0.55 + leaf * 0.45), 0), 0.5 + leaf * 0.6);
  const bark = worn(mix(look.hue("bark", "#5e4a38"), "#5e4a38", 0.5), w);
  const at = (dx: number, h: number): Pt => pen.up(dx * f, h * f);
  const g = 1 + 0.4 * age;
  const trunk = [at(-2.2 * g, -0.3), at(-1.2 * g, 1.4), at(-1.5, 5.4), at(0.2, 6.2), at(1.4, 5.2), at(1.3 * g, 1.4), at(2.4 * g, -0.3)];
  wash(pen, trunk, bark);
  ink(pen, trunk, false, 1);
  tufts(pen, [[-3.2 * f, -0.8], [3.4 * f, -0.6]], w);
  // Boughs arching up and out, from which the strands hang.
  const boughs: [number, number, number, number][] = [[-1, 5.6, -7.4, 12.6], [0, 6, -2.4, 15.2], [0.4, 6, 3.2, 15], [1, 5.4, 7.8, 12]];
  ctx.beginPath();
  for (const [ax, ah, bx, bh] of boughs) {
    const [p0x, p0y] = at(ax, ah);
    const [p1x, p1y] = at(bx, bh);
    const [cx, cy] = at(ax + (bx - ax) * 0.2, bh + 1.6);
    pen.reach(p1x, p1y, 1.5 * s);
    ctx.moveTo(p0x, p0y);
    ctx.quadraticCurveTo(cx, cy, p1x, p1y);
  }
  ctx.lineCap = "round";
  ctx.lineWidth = 1.5 * s + pen.line * 0.6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = 1.5 * s;
  ctx.strokeStyle = bark;
  ctx.stroke();
  // Bare whips hang from the boughs; leaves dress them while the tree lives.
  const whips = 13;
  const strands = new Path2D();
  const curtain = new Path2D();
  let any = false;
  let held = 0;
  for (let k = 0; k < whips; k++) {
    const u = k / (whips - 1);
    const dx = -9.6 + u * 19.2;
    const top = 10.6 + Math.sqrt(Math.max(0, 1 - (dx / 10.2) ** 2)) * 5.4;
    const bottom = 1.2 + noise(seed, k + 800) * 1.8 + (1 - leaf) * (3 + noise(seed, k + 810) * 3);
    const [tx, ty] = at(dx * 0.92, top);
    const [bx, by] = at(dx * 1.08, bottom);
    strands.moveTo(tx, ty);
    strands.quadraticCurveTo(bx - Math.sign(dx) * 0.6 * s, (ty + by) / 2, bx, by);
    const th = 0.06 + noise(seed, k + 820) * 0.42;
    const cover = clamp01((w.v - th) / 0.2);
    held += cover / whips;
    if (cover > 0.05) {
      any = true;
      const wd = (1.2 + noise(seed, k + 830) * 0.4) * s * (0.5 + cover * 0.5);
      pen.reach(tx, ty, wd * 1.4);
      curtain.moveTo(tx + wd * 1.4, ty);
      curtain.arc(tx, ty, wd * 1.4, 0, Math.PI * 2);
      const bot = ty + (by - ty) * (0.35 + cover * 0.65);
      curtain.moveTo(tx - wd, ty);
      curtain.lineTo(tx + wd, ty);
      curtain.quadraticCurveTo(bx + wd * 0.6, (ty + bot) / 2, bx + wd * 0.4, bot - wd * 0.4);
      curtain.arc(bx, bot - wd * 0.4, wd * 0.4, 0, Math.PI, false);
      curtain.quadraticCurveTo(bx - wd * 0.6, (ty + bot) / 2, tx - wd, ty);
      curtain.closePath();
    }
  }
  const domed = ease(held, 0.45, 0.9);
  if (domed > 0.05) {
    const [dx, dy] = at(0, 10.8);
    const rx = 9.8 * (0.55 + domed * 0.45) * s;
    at(-10.6, 16.4);
    at(10.6, 16.4);
    curtain.moveTo(dx + rx, dy);
    curtain.ellipse(dx, dy, rx, 5.4 * s * domed * (0.6 + leaf * 0.4), 0, 0, Math.PI * 2);
  }
  ctx.lineWidth = pen.line * 0.6;
  ctx.strokeStyle = rgba(INK, 0.75);
  ctx.stroke(strands);
  if (!any) return;
  const green = mix(mix(mix("#6f9f86", PAPER, 0.12), "#a8a466", w.dry * 0.9), "#9a8050", ease(w.v, 0.4, 0.1));
  ctx.lineWidth = pen.line * 2;
  ctx.strokeStyle = INK;
  ctx.stroke(curtain);
  ctx.fillStyle = green;
  ctx.fill(curtain);
  ctx.save();
  ctx.clip(curtain);
  const [cx0] = at(-10, 0);
  const [cx1, y0] = at(10, 0);
  const gr = ctx.createLinearGradient(cx0, 0, cx1, 0);
  gr.addColorStop(0, rgba("#eef4b0", 0.28));
  gr.addColorStop(0.45, rgba("#eef4b0", 0));
  gr.addColorStop(1, rgba(SHADE, 0.3));
  ctx.fillStyle = gr;
  ctx.fillRect(cx0, y0 - 20 * s, cx1 - cx0, 22 * s);
  ctx.lineWidth = pen.line * 0.5;
  ctx.strokeStyle = rgba("#2f4a35", 0.5);
  ctx.stroke(strands);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------

/** A box in pixels: left, top, right, bottom. */
export type MarkBox = [number, number, number, number];

/** How a mark grows with the land close in: its scale per pixel a meter, about a building's width over its drawing's. */
const MARK_METERS = 0.67;
/** A mark's scale at `zoom` pixels a meter: a legible size on the whole sheet, growing with the land as the map comes close, as the trees do. */
export const markScale = (zoom: number, grow: number): number => Math.max(1.1 * grow, MARK_METERS * zoom);
/**
 * How far any mark reaches from its foot, units, its ink included: the widest range and the tallest tower and its
 * smoke. The sheets keep names off this much round every lot before they know what will stand there, so a contract
 * test holds every building and landmark to it.
 */
export const MARK_REACH = { left: 22, right: 24, up: 37, down: 11 } as const;

/**
 * Draws a building at (x, y), the middle of its footprint on the ground there, at `s` pixels a unit, worn by
 * `vitality`; `name` seeds its wear, so each building fails in its own way. Returns the box it took.
 */
export function drawBuilding(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, b: BuildingComposition, vitality = 1, name = ""): MarkBox {
  const w = wearOf(vitality, seedOf(name));
  const look = lookOf(b.palette, w);
  const plan = b.plan;
  const pen = penFor(ctx, x, y, s, plan.settle * 0.03);
  const parts = partsOf(b.blueprint);
  const blocks = blocksOf(plan);
  const end = chimneyEnd(plan);
  const house: House = {
    plan,
    blocks,
    side: plan.masses[0]?.ridge === "x" && end === 1 ? -1 : 1,
    top: Math.max(...plan.masses.map((m) => plan.floor + m.wallHeight + m.rise)),
    w,
  };
  const weak = weakOf(plan);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  castShadow(pen, blocks.flatMap((k) => [[k.x0, k.z0], [k.x1, k.z0], [k.x1, k.z1], [k.x0, k.z1]].map(([X, Z]) => [X as number, Z as number, (k.eave + k.rise) * 0.75] as [number, number, number])));
  // Everything that stands, drawn from the farthest to the nearest.
  const things: { depth: number; draw: () => void }[] = blocks.map((k) => ({
    depth: depthOf((k.x0 + k.x1) / 2, (k.z0 + k.z1) / 2),
    draw: () => (k.round ? drawTurret(pen, house, k, parts, look) : drawBlock(pen, house, k, parts, look, weak)),
  }));
  for (const f of parts.features) {
    const [X, Z] = f.ink.place(house, f.p);
    things.push({ depth: depthOf(X, Z), draw: () => f.ink.draw(pen, house, look, f.p) });
  }
  // The chimney: up a free gable from the ground, or through the ridge.
  const stack: { top: Pt | null } = { top: null };
  const main = blocks[0];
  const wanted = parts.roof?.ink.chimney(parts.roof.p) ?? "none";
  if (main !== undefined && !main.round && wanted !== "none") {
    const sh = shapeOf(main, 0, w.seed);
    const sign = main.along === "x" ? end : -end;
    const gable = wanted === "gable" && end !== 0;
    const ridgeSign = noise(w.seed, 77) < 0.5 ? -1 : 1;
    const a = gable ? sign * (sh.L + 0.34 * K) : ridgeSign * Math.min(sh.L * 0.48, Math.max(0, sh.L - sh.S) * 0.8 + 0.2 * K);
    const [X, Z] = sh.at(a, 0, 0);
    const [wa, wb] = gable ? [0.68 * K, 1.15 * K] : [0.66 * K, 0.78 * K];
    const [wx, wz] = main.along === "x" ? [wa, wb] : [wb, wa];
    const toward = -Math.sign(a) || 1;
    const fall: [number, number] = main.along === "x" ? [toward, 0] : [0, toward];
    const mainDepth = depthOf((main.x0 + main.x1) / 2, (main.z0 + main.z1) / 2);
    things.push({
      depth: gable ? depthOf(X, Z) : mainDepth - 0.001,
      draw: () => {
        stack.top = chimney(pen, X, Z, gable ? 0 : sh.ridge - 0.9 * K, sh.ridge + 0.95 * K, wx, wz, sh.ridge, fall, look.hue("masonry", "#a39c8c"), w, gable ? main.eave * 0.8 : 0);
      },
    });
  }
  things.sort((p, q) => q.depth - p.depth).forEach((t) => t.draw());
  // The wall breaks at the weak corner, on the mass whose front corner it is.
  const corners = blocks.filter((k) => !k.round).flatMap((k) => [{ k, east: false, X: k.x0 }, { k, east: true, X: k.x1 }]);
  const broken = corners.reduce<(typeof corners)[number] | undefined>((best, c) => (best === undefined || Math.hypot(c.X - weak.X, c.k.z0 - weak.Z) < Math.hypot(best.X - weak.X, best.k.z0 - weak.Z) ? c : best), undefined);
  if (broken !== undefined) breach(pen, broken.X, broken.k.z0, broken.east ? 1 : -1, broken.k.eave, w.breach, w.seed);
  for (const d of parts.dressing) d.ink.draw(pen, house, look, d.p);
  if (stack.top !== null) smoke(pen, stack.top, w.smoke);
  const west = Math.min(...blocks.map((k) => k.x0));
  const east = Math.max(...blocks.map((k) => k.x1));
  const front = Math.min(...blocks.map((k) => k.z0));
  tufts(pen, [[west - 0.6, front - 0.8], [(west + east) / 2 + 2.4, front - 0.6], [east + 0.4, front - 0.5]], w);
  ctx.restore();
  return [...pen.box];
}

/**
 * Draws a landmark at (x, y), its foot on the ground there, at `s` pixels a unit, worn by `vitality`; `name` seeds
 * its wear. Returns the box it took.
 */
export function drawLandmark(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, l: Composition, vitality = 1, name = ""): MarkBox {
  const seed = seedOf(name);
  const w = wearOf(vitality, seed);
  const look = lookOf(l.palette, w);
  const pen = penFor(ctx, x, y, s);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const slot of Object.values(l.blueprint.slots)) {
    const entry = INKS[slot.use];
    if (entry?.role !== "Landmark") continue;
    entry.draw(pen, look, valuesOf(slot.use, slot.params), seed);
  }
  ctx.restore();
  return [...pen.box];
}

// ---------------------------------------------------------------------------------------------------------------
// Stamps. The map redraws on every frame of a glide or a zoom, and a composed mark is many strokes, so each mark is
// drawn once into a bitmap at the size it shows and stamped from then on. A stamp is kept at sizes a quarter of a
// doubling apart and drawn shrunk to the size asked for, never grown, so it stays as crisp as the ink.

/** Sizes are kept in steps of 2^(1/4): a glide draws a mark anew about every fifth of the way to twice its size. */
const STAMP_STEPS = 4;
/** How many stamps are kept, the least recently stamped going first. */
const STAMPS_KEPT = 160;
/** The bitmap a stamp is first drawn into, in units round the mark's foot: room for the widest range and the tallest tower. */
const SCRATCH = { width: 180, height: 170, footX: 90, footY: 125 } as const;

interface Stamp {
  readonly canvas: HTMLCanvasElement;
  /** Where its top left lies from the mark's foot, and its size, in pixels at its own scale. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const stamps = new Map<string, Stamp>();
let scratch: CanvasRenderingContext2D | null = null;

function stampOf(s: number, device: number, draw: (c: CanvasRenderingContext2D, x: number, y: number, s: number) => MarkBox): Stamp {
  const w = Math.ceil(SCRATCH.width * s * device);
  const h = Math.ceil(SCRATCH.height * s * device);
  if (scratch === null || scratch.canvas.width < w || scratch.canvas.height < h) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(w, scratch?.canvas.width ?? 0);
    canvas.height = Math.max(h, scratch?.canvas.height ?? 0);
    scratch = canvas.getContext("2d", { willReadFrequently: false }) as CanvasRenderingContext2D;
  }
  const c = scratch;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, w, h);
  c.setTransform(device, 0, 0, device, 0, 0);
  const fx = SCRATCH.footX * s;
  const fy = SCRATCH.footY * s;
  const box = draw(c, fx, fy, s);
  // A little room for the ink's width and the brush's offset past the points the mark placed.
  const pad = 1 + s;
  const x0 = Math.max(0, Math.floor((box[0] - pad) * device));
  const y0 = Math.max(0, Math.floor((box[1] - pad) * device));
  const x1 = Math.min(w, Math.ceil((box[2] + pad) * device));
  const y1 = Math.min(h, Math.ceil((box[3] + pad) * device));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, x1 - x0);
  canvas.height = Math.max(1, y1 - y0);
  (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(c.canvas, x0, y0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return { canvas, left: x0 / device - fx, top: y0 / device - fy, width: canvas.width / device, height: canvas.height / device };
}

/** Stamps the mark `key` names at (x, y), `s` pixels a unit, drawing it with `draw` only when no stamp of it is kept at this size and on this screen. */
function stamp(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, key: string, draw: (c: CanvasRenderingContext2D, x: number, y: number, s: number) => MarkBox): MarkBox {
  const m = ctx.getTransform();
  const device = Math.hypot(m.a, m.b);
  const kept = 2 ** (Math.ceil(Math.log2(s) * STAMP_STEPS - 1e-6) / STAMP_STEPS);
  const id = `${key}|${kept.toFixed(4)}|${device.toFixed(2)}`;
  let st = stamps.get(id);
  if (st === undefined) {
    st = stampOf(kept, device, draw);
    if (stamps.size >= STAMPS_KEPT) stamps.delete(stamps.keys().next().value as string);
  } else {
    stamps.delete(id);
  }
  stamps.set(id, st);
  const k = s / kept;
  // On whole device pixels, so a stamp shown at its own size is copied rather than resampled.
  const left = Math.round((x + st.left * k) * device) / device;
  const top = Math.round((y + st.top * k) * device) / device;
  ctx.drawImage(st.canvas, left, top, st.width * k, st.height * k);
  return [left, top, left + st.width * k, top + st.height * k];
}

/** Stamps a building's mark, as `drawBuilding` draws it. */
export function stampBuilding(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, b: BuildingComposition, vitality = 1, name = ""): MarkBox {
  const key = `b|${b.blueprint.id}|${name}|${vitality.toFixed(3)}|${b.plan.masses.length}|${b.plan.width.toFixed(3)}|${b.plan.depth.toFixed(3)}`;
  return stamp(ctx, x, y, s, key, (c, fx, fy, ks) => drawBuilding(c, fx, fy, ks, b, vitality, name));
}

/** Stamps a landmark's mark, as `drawLandmark` draws it. */
export function stampLandmark(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, l: Composition, vitality = 1, name = ""): MarkBox {
  const key = `l|${l.blueprint.id}|${name}|${vitality.toFixed(3)}`;
  return stamp(ctx, x, y, s, key, (c, fx, fy, ks) => drawLandmark(c, fx, fy, ks, l, vitality, name));
}
