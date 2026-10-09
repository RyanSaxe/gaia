// The map's marks for buildings and landmarks. Each draws one thing at (x, y), its foot on the ground at y, at `s`
// times its size on the whole sheet, worn by its entity's vitality from 0 to 1.
//
// Every mark is one ink drawing over watercolor washes, seen from the south-southwest and a little above and lit
// from the northwest: west faces and the upper left of roofs and crowns catch the light, south faces fall into a
// cool half shade, and a soft shadow lies on the paper to the southeast. A unit is about a pixel on the whole sheet
// at s = 1. Nothing here depends on where the mark is on the screen, so a mark never changes as the map moves.

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
const TIMBER = "#5b412d";
const GLASS = "#3f3a36";
/** The dark inside a broken roof or wall. */
const HOLLOW = "rgba(44,34,25,0.86)";

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
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
  at(X: number, Z: number, H: number): Pt;
}

/** The view: east runs right and a little up, north runs up and to the left. `lean` tips the thing east as it rises. */
function penFor(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, lean = 0): Pen {
  const m = ctx.getTransform();
  const device = s * Math.hypot(m.a, m.b);
  return {
    ctx,
    s,
    line: 0.5 + 0.36 * s,
    fine: ease(device, 1.2, 2.2),
    at: (X, Z, H) => {
      const e = X + lean * H;
      return [x + (e * 0.92 - Z * 0.42) * s, y + (-e * 0.14 - Z * 0.38 - H) * s];
    },
  };
}

const on = (pen: Pen, pts: readonly P3[]): Pt[] => pts.map(([X, Z, H]) => pen.at(X, Z, H));

/** A path through `pts`; a closed one may round its corners by `round` pixels, as plump thatch is. */
function trace(ctx: CanvasRenderingContext2D, pts: readonly Pt[], close = true, round = 0): void {
  ctx.beginPath();
  if (close && round > 0 && pts.length > 2) {
    const n = pts.length;
    const mid = (i: number): Pt => lerp(pts[i % n] as Pt, pts[(i + 1) % n] as Pt, 0.5);
    const start = mid(n - 1);
    ctx.moveTo(start[0], start[1]);
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i] as Pt;
      const [qx, qy] = mid(i);
      ctx.arcTo(px, py, qx, qy, round);
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

/** The shadow a thing `height` tall on the footprint `foot` casts on the paper, to the southeast, soft at its edge. */
function castShadow(pen: Pen, foot: readonly (readonly [number, number])[], height: number, strength = 1): void {
  const pts: Pt[] = [];
  for (const [X, Z] of foot) {
    pts.push(pen.at(X, Z, 0));
    pts.push(pen.at(X + height * 0.2, Z - height * 0.32, 0));
  }
  const h = hull(pts);
  const cx = h.reduce((a, q) => a + q[0], 0) / h.length;
  const cy = h.reduce((a, q) => a + q[1], 0) / h.length;
  for (const [grow, a] of [[1.14, 0.09], [0.96, 0.13]] as const) {
    wash(pen, h.map(([px, py]) => [cx + (px - cx) * grow, cy + (py - cy) * grow] as Pt), `rgba(80,66,48,${(a * strength).toFixed(3)})`);
  }
}

const ellipseShadow = (pen: Pen, X: number, Z: number, rx: number, rz: number, strength = 1): void => {
  const foot: [number, number][] = [];
  for (let k = 0; k < 12; k++) foot.push([X + Math.cos((k / 12) * Math.PI * 2) * rx, Z + Math.sin((k / 12) * Math.PI * 2) * rz]);
  castShadow(pen, foot, 0, strength);
};

// ---------------------------------------------------------------------------------------------------------------
// Houses: masses of walls under gabled or hipped roofs.

interface Mass {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly wall: number;
  readonly ridge: number;
  /** The ridge runs east-west ("x", the gable looks west) or north-south ("z", the gable looks south). */
  readonly along: "x" | "z";
  /** How far a hipped end runs in along the ridge; 0 is a gable. */
  readonly hip: number;
  readonly eave: number;
}

interface Skin {
  /** The west wall, in the light. */
  readonly west: string;
  /** The south wall, in half shade. */
  readonly south: string;
  readonly roof: string;
  /** How the roof's covering is drawn: its courses. */
  readonly covering: "thatch" | "slate" | "tile";
}

function skinOf(wall: string, roof: string, covering: Skin["covering"], w: Wear): Skin {
  const wl = worn(wall, w);
  return { west: lit(wl, 0.12), south: shaded(wl, 0.16), roof: worn(roof, w, 0.45), covering };
}

const footOf = (m: Mass): [number, number][] => [[m.x0, m.z0], [m.x1, m.z0], [m.x1, m.z1], [m.x0, m.z1]];

/** The four corners of the roof's slope toward the viewer: the weak eave corner, the eave's other end, then the ridge above each. */
function frontSlope(m: Mass): [P3, P3, P3, P3] {
  const e = m.eave;
  const h = m.wall - e * 0.45;
  if (m.along === "x") {
    const zm = (m.z0 + m.z1) / 2;
    const r0 = m.hip > 0 ? m.x0 + m.hip : m.x0 - e;
    const r1 = m.hip > 0 ? m.x1 - m.hip : m.x1 + e;
    return [[m.x1 + e, m.z0 - e, h], [m.x0 - e, m.z0 - e, h], [r0, zm, m.ridge], [r1, zm, m.ridge]];
  }
  const xm = (m.x0 + m.x1) / 2;
  const r0 = m.hip > 0 ? m.z0 + m.hip : m.z0 - e;
  const r1 = m.hip > 0 ? m.z1 - m.hip : m.z1 + e;
  return [[m.x0 - e, m.z0 - e, h], [m.x0 - e, m.z1 + e, h], [xm, r1, m.ridge], [xm, r0, m.ridge]];
}

/** The roof's slope facing away, drawn first so the rest covers all but its edge. */
function roofBack(pen: Pen, m: Mass, skin: Skin): void {
  const e = m.eave;
  const h = m.wall - e * 0.45;
  if (m.along === "x") {
    const zm = (m.z0 + m.z1) / 2;
    const r0 = m.hip > 0 ? m.x0 + m.hip : m.x0 - e;
    const r1 = m.hip > 0 ? m.x1 - m.hip : m.x1 + e;
    face(pen, [[r0, zm, m.ridge], [r1, zm, m.ridge], [m.x1 + e, m.z1 + e, h], [m.x0 - e, m.z1 + e, h]], shaded(skin.roof, 0.3), 1, skin.covering === "thatch" ? pen.s * 1.2 : 0);
  } else {
    const xm = (m.x0 + m.x1) / 2;
    const r0 = m.hip > 0 ? m.z0 + m.hip : m.z0 - e;
    const r1 = m.hip > 0 ? m.z1 - m.hip : m.z1 + e;
    face(pen, [[xm, r0, m.ridge], [m.x1 + e, m.z0 - e, h], [m.x1 + e, m.z1 + e, h], [xm, r1, m.ridge]], shaded(skin.roof, 0.3));
  }
}

/** The west and south walls, a gable where the ridge ends over one. */
function walls(pen: Pen, m: Mass, skin: Skin): void {
  const apex = m.ridge - 0.4;
  if (m.along === "x") {
    const zm = (m.z0 + m.z1) / 2;
    face(pen, m.hip > 0 ? [[m.x0, m.z0, 0], [m.x0, m.z1, 0], [m.x0, m.z1, m.wall], [m.x0, m.z0, m.wall]] : [[m.x0, m.z0, 0], [m.x0, m.z1, 0], [m.x0, m.z1, m.wall], [m.x0, zm, apex], [m.x0, m.z0, m.wall]], skin.west);
    face(pen, [[m.x0, m.z0, 0], [m.x1, m.z0, 0], [m.x1, m.z0, m.wall], [m.x0, m.z0, m.wall]], skin.south);
  } else {
    const xm = (m.x0 + m.x1) / 2;
    face(pen, [[m.x0, m.z0, 0], [m.x0, m.z1, 0], [m.x0, m.z1, m.wall], [m.x0, m.z0, m.wall]], skin.west);
    face(pen, m.hip > 0 ? [[m.x0, m.z0, 0], [m.x1, m.z0, 0], [m.x1, m.z0, m.wall], [m.x0, m.z0, m.wall]] : [[m.x0, m.z0, 0], [m.x1, m.z0, 0], [m.x1, m.z0, m.wall], [xm, m.z0, apex], [m.x0, m.z0, m.wall]], skin.south);
  }
}

/** The slopes toward the viewer: a hipped end in the light, then the main slope with its courses, rotted through as the building fails. */
function roofFront(pen: Pen, m: Mass, skin: Skin, w: Wear): void {
  const e = m.eave;
  const h = m.wall - e * 0.45;
  if (m.hip > 0) {
    const hipEnd: P3[] = m.along === "x"
      ? [[m.x0 - e, m.z0 - e, h], [m.x0 + m.hip, (m.z0 + m.z1) / 2, m.ridge], [m.x0 - e, m.z1 + e, h]]
      : [[m.x0 - e, m.z0 - e, h], [(m.x0 + m.x1) / 2, m.z0 + m.hip, m.ridge], [m.x1 + e, m.z0 - e, h]];
    face(pen, hipEnd, m.along === "x" ? lit(skin.roof, 0.18) : shaded(skin.roof, 0.1));
  }
  const corners = frontSlope(m);
  const [a, b, c, d] = on(pen, corners) as [Pt, Pt, Pt, Pt];
  const slope = [a, b, c, d];
  // The slope toward the viewer faces south (a ridge along x) or west (along z); either way it takes the light from above.
  const round = skin.covering === "thatch" ? pen.s * 1.2 : 0;
  wash(pen, slope, m.along === "z" ? lit(skin.roof, 0.12) : skin.roof, round);
  const { ctx } = pen;
  // The light along the ridge, the shade under the eave; each band lies within the slope, so needs no clip.
  const inset = round > 0 ? 0.06 : 0;
  const at = (u: number, t: number): Pt => lerp(lerp(a, b, u), lerp(d, c, u), t);
  wash(pen, [at(inset, 0.62), at(1 - inset, 0.62), at(1 - inset, 1 - inset * 0.5), at(inset, 1 - inset * 0.5)], rgba(LIGHT, 0.22));
  wash(pen, [at(inset, inset * 0.5), at(1 - inset, inset * 0.5), at(1 - inset, 0.18), at(inset, 0.18)], rgba(SHADE, 0.16));
  const courses: [Pt, Pt][] = [];
  if (skin.covering === "thatch") {
    for (let k = 1; k < 9; k++) {
      const u = k / 9 + (noise(w.seed, k) - 0.5) * 0.04;
      courses.push([lerp(lerp(a, b, u), lerp(d, c, u), 0.05), lerp(lerp(a, b, u), lerp(d, c, u), 0.32 + noise(w.seed, k + 9) * 0.2)]);
    }
  } else {
    for (const t of skin.covering === "slate" ? [0.22, 0.42, 0.62, 0.82] : [0.25, 0.5, 0.75]) courses.push([lerp(a, d, t), lerp(b, c, t)]);
  }
  ctx.beginPath();
  for (const [p, q] of courses) {
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  }
  ctx.lineWidth = pen.line * 0.5;
  ctx.strokeStyle = rgba(INK, 0.4 * pen.fine);
  ctx.stroke();
  ink(pen, slope, true, 1, INK, round);
  if (skin.covering === "thatch") {
    // Thatch is plump: a thick, rounded eave, and the ridge capped.
    ink(pen, [lerp(a, d, 0.1), lerp(b, c, 0.1)], false, 0.6, rgba(INK, 0.6));
    ink(pen, [lerp(d, a, 0.08), lerp(c, b, 0.08)], false, 0.6, rgba(INK, 0.6));
  }
  rotHole(pen, a, b, c, d, w.rot, w.seed);
  if (w.ivy > 0.3) moss(pen, a, b, c, d, w);
}

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

/** Ivy climbing a wall's corner: a ragged green wash from the ground up, `amount` of the wall's height. */
function ivy(pen: Pen, X: number, Z: number, height: number, amount: number, seed: number): void {
  if (amount < 0.05) return;
  const top = height * amount;
  const pts: Pt[] = [pen.at(X - 0.9, Z, 0)];
  for (let k = 0; k <= 4; k++) pts.push(pen.at(X - 0.9 + noise(seed, k) * 0.6, Z, (top * k) / 4));
  pts.push(pen.at(X + 0.3, Z - 0.3, top));
  for (let k = 4; k >= 0; k--) pts.push(pen.at(X + 0.5 + noise(seed, k + 7) * 0.9, Z - 0.3, (top * k) / 4));
  wash(pen, pts, rgba("#5f7f3e", 0.75));
}

/** A wall broken down at its corner (`X`, `Z`): a ragged gap into the dark inside, its stones lying at its foot. */
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

/** A chimney stack, toppling as its building fails and smoking while it lives. */
function chimney(pen: Pen, X: number, Z: number, h0: number, h1: number, width: number, color: string, w: Wear): void {
  const fall = ease(w.v, 0.2, 0.05);
  const top = h1 - (h1 - h0) * 0.75 * fall;
  const hw = width / 2;
  box(pen, X - hw, X + hw, Z - hw, Z + hw, h0, top, worn(color, w), "#4b3b2e", 0.85);
  if (fall > 0.4) {
    // The stack lies along the roof beside its stump.
    const p = on(pen, [[X - hw - 0.4, Z - 0.6, h0 + 0.2], [X - hw - 3, Z - 1.4, h0 - 1.6], [X - hw - 3.3, Z - 0.6, h0 - 1.1], [X - hw - 0.7, Z + 0.2, h0 + 0.7]]);
    wash(pen, p, shaded(worn(color, w), 0.1));
    ink(pen, p, true, 0.75);
  }
  smoke(pen, pen.at(X, Z, top), w.smoke);
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

/** A window or door on a wall: a dark pane, framed in ink when `frame` is set. */
function opening(pen: Pen, quad: readonly P3[], color = GLASS, frame = false): void {
  const p = on(pen, quad);
  wash(pen, p, color);
  if (frame) ink(pen, p, true, 0.45, rgba(INK, 0.8));
}
const southRect = (z: number, xa: number, xb: number, ha: number, hb: number): P3[] => [[xa, z, ha], [xb, z, ha], [xb, z, hb], [xa, z, hb]];
const westRect = (x: number, za: number, zb: number, ha: number, hb: number): P3[] => [[x, za, ha], [x, zb, ha], [x, zb, hb], [x, za, hb]];

/** Fieldstone: a scatter of rounded stones drawn on a wall between two corners, up to `height`. */
function stones(pen: Pen, from: readonly [number, number], to: readonly [number, number], height: number, seed: number, count: number): void {
  const { ctx } = pen;
  ctx.beginPath();
  for (let k = 0; k < count; k++) {
    const u = (k % 5) / 5 + noise(seed, k) * 0.16 + 0.04;
    const h = ((Math.floor(k / 5) + 0.5) / Math.ceil(count / 5)) * height + (noise(seed, k + 20) - 0.5) * 0.6;
    const [px, py] = pen.at(from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u, h);
    const r = (0.42 + noise(seed, k + 40) * 0.25) * pen.s;
    ctx.moveTo(px + r * 1.3, py);
    ctx.ellipse(px, py, r * 1.3, r * 0.8, 0, 0, Math.PI * 2);
  }
  ctx.lineWidth = pen.line * 0.45;
  ctx.strokeStyle = rgba(INK, 0.5 * pen.fine);
  ctx.stroke();
}

// ---------------------------------------------------------------------------------------------------------------
// The buildings.

/** A thatched cottage: long and low, its plump golden thatch sweeping down nearly to the ground over timbered walls. */
function thatchedCottage(pen: Pen, w: Wear, roofColor = "#c99a48", covering: Skin["covering"] = "thatch"): void {
  const m: Mass = { x0: -6, x1: 6, z0: -2.8, z1: 2.8, wall: 3, ridge: 9.4, along: "x", hip: 0, eave: covering === "thatch" ? 1.1 : 0.6 };
  castShadow(pen, footOf(m), 7);
  const skin = skinOf("#f0e4c8", roofColor, covering, w);
  roofBack(pen, m, skin);
  walls(pen, m, skin);
  // The frame's posts and the gable's window, the door left of the middle and windows either side.
  hatch(pen, [-3.2, 0.2, 3.2].map((X) => [[X, m.z0, 0], [X, m.z0, m.wall]] as P3[]), rgba(TIMBER, 0.75), 0.6);
  opening(pen, westRect(m.x0, -0.6, 0.6, 4.2, 5.4));
  opening(pen, southRect(m.z0, -2.2, -0.8, 0, 2.3), "#7a4a31", true);
  opening(pen, southRect(m.z0, -5, -3.9, 1.1, 2.1));
  opening(pen, southRect(m.z0, 1.2, 2.4, 1.1, 2.1));
  opening(pen, southRect(m.z0, 3.9, 5, 1.1, 2.1));
  ivy(pen, m.x1 - 0.2, m.z0, m.wall, w.ivy, w.seed);
  breach(pen, m.x1, m.z0, 1, m.wall, w.breach, w.seed);
  roofFront(pen, m, skin, w);
  chimney(pen, 4.6, 0.6, 6.4, 11, 1.4, "#a8806a", w);
  tufts(pen, [[-6.6, -3.6], [-3.6, -3.4], [6.4, -3.3]], w);
}

/** A storybook house: tall, crooked and gable-fronted under steep red tiles, a round turret at its corner and a tall chimney. */
function storybookHouse(base: Pen, x: number, y: number, s: number, w: Wear): void {
  const pen = penFor(base.ctx, x, y, s, 0.03);
  const m: Mass = { x0: -3.8, x1: 3.2, z0: -2.8, z1: 2.8, wall: 6.2, ridge: 12.6, along: "z", hip: 0, eave: 0.7 };
  castShadow(pen, footOf(m), 10);
  const skin = skinOf("#f1dfb4", "#b4583a", "tile", w);
  roofBack(pen, m, skin);
  walls(pen, m, skin);
  const xm = (m.x0 + m.x1) / 2;
  // Crossed braces on the front gable, a rail at each floor, a king post into the gable.
  const t = rgba(TIMBER, 0.85);
  hatch(pen, [
    [[m.x0, m.z0, 3.2], [m.x1, m.z0, 3.2]],
    [[xm, m.z0, 3.2], [xm, m.z0, m.ridge - 0.6]],
    [[m.x0, m.z0, 3.2], [xm, m.z0, m.wall]],
    [[xm, m.z0, 3.2], [m.x0, m.z0, m.wall]],
    [[xm, m.z0, 3.2], [m.x1, m.z0, m.wall]],
    [[m.x1, m.z0, 3.2], [xm, m.z0, m.wall]],
    [[m.x0, -0.9, 0], [m.x0, -0.9, m.wall]],
    [[m.x0, 1.1, 0], [m.x0, 1.1, m.wall]],
    [[m.x0, m.z0, 3.2], [m.x0, m.z1, 3.2]],
  ], t, 0.65);
  opening(pen, southRect(m.z0, xm - 0.6, xm + 0.6, 7.6, 9));
  opening(pen, westRect(m.x0, -2.3, -1.5, 4.2, 5.6));
  opening(pen, westRect(m.x0, -0.2, 0.6, 4.2, 5.6));
  opening(pen, westRect(m.x0, -0.2, 0.6, 1.1, 2.4));
  // The arched door under its porch.
  const door = on(pen, [[-1.6, m.z0, 0], [-0.4, m.z0, 0], [-0.4, m.z0, 1.9], [-1, m.z0, 2.6], [-1.6, m.z0, 1.9]]);
  wash(pen, door, "#7a3f2a");
  ink(pen, door, true, 0.5);
  face(pen, [[-2.2, m.z0 - 1.1, 2.6], [0.2, m.z0 - 1.1, 2.6], [-1, m.z0 - 1.1, 3.7]], shaded(skin.roof, 0.05), 0.7);
  ivy(pen, m.x0 + 0.3, m.z0, m.wall, w.ivy, w.seed);
  breach(pen, m.x0, m.z0, -1, m.wall, w.breach, w.seed);
  roofFront(pen, m, skin, w);
  // A tall chimney stack at the back of the ridge.
  chimney(pen, xm - 0.2, m.z1 - 0.6, m.ridge - 1.6, m.ridge + 3.2, 1.2, "#a46d55", w);
  turret(pen, m.x1 - 0.1, m.z0 + 0.3, 1.9, 8.6, 15, skin, w);
  tufts(pen, [[-4.4, -3.4], [1.2, -4.4], [5, -2.6]], w);
}

/** A round turret at the house's corner under its own cone, which rots through and loses its finial as the house fails. */
function turret(pen: Pen, X: number, Z: number, r: number, wall: number, apex: number, skin: Skin, w: Wear): void {
  const { ctx, s } = pen;
  const rx = r * 1.01 * s;
  const ry = r * 0.405 * s;
  const [bx, by] = pen.at(X, Z, 0);
  const [tx, ty] = pen.at(X, Z, wall);
  const body = (): void => {
    ctx.beginPath();
    ctx.moveTo(tx - rx, ty);
    ctx.lineTo(bx - rx, by);
    ctx.ellipse(bx, by, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(tx + rx, ty);
    ctx.ellipse(tx, ty, rx, ry, 0, 0, Math.PI, false);
    ctx.closePath();
  };
  body();
  const g = ctx.createLinearGradient(bx - rx, 0, bx + rx, 0);
  g.addColorStop(0, skin.west);
  g.addColorStop(0.35, lit(skin.west, 0.25));
  g.addColorStop(1, shaded(skin.south, 0.2));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = pen.line;
  ctx.strokeStyle = INK;
  ctx.stroke();
  hatch(pen, [[[X - r * 0.95, Z, 3.2], [X + r * 0.4, Z - r * 0.9, 3.2], [X + r * 0.95, Z, 3.2]], [[X, Z - r, 0], [X, Z - r, wall]], [[X + r * 0.7, Z - r * 0.7, 3.2], [X - r * 0.3, Z - r * 0.95, wall]]], rgba(TIMBER, 0.8), 0.6);
  opening(pen, [[X - 0.4, Z - r, 5.2], [X + 0.4, Z - r, 5.2], [X + 0.4, Z - r, 6.6], [X - 0.4, Z - r, 6.6]]);
  // The cone, eaves flaring past the wall; failing, it rots down from its tip.
  const cone = apex - (apex - wall) * 0.55 * ease(w.v, 0.35, 0.05);
  const er = (r + 0.45) * s;
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
  cg.addColorStop(0, lit(skin.roof, 0.2));
  cg.addColorStop(0.4, skin.roof);
  cg.addColorStop(1, shaded(skin.roof, 0.3));
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.lineWidth = pen.line;
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (cone >= apex - 0.5) ink(pen, [[ax, ay], [ax, ay - 1.3 * s]], false, 0.7);
  else rotHole(pen, [tx + er * 0.2, ty + er * 0.3], [tx + er, ty], [ax + er * 0.35, ay], [ax, ay + 0.2 * s], w.rot * 0.8, w.seed + 3);
}

/** A stone croft: low and snug under a hipped slate roof with its chimney on the ridge, a lean-to at its east end. */
function stoneCroft(pen: Pen, w: Wear): void {
  const m: Mass = { x0: -5.4, x1: 3.6, z0: -3, z1: 3, wall: 3.4, ridge: 7.4, along: "x", hip: 3.4, eave: 0.45 };
  castShadow(pen, [[m.x0, m.z0], [6.6, m.z0], [6.6, m.z1], [m.x0, m.z1]], 6);
  const stone = "#c6c0b0";
  const skin = skinOf(stone, "#6c7884", "slate", w);
  // The lean-to stands east, behind the croft's own end, its one slope falling away east.
  const lw = worn(stone, w);
  face(pen, [[3.6, -2.4, 0], [6.6, -2.4, 0], [6.6, -2.4, 2.2], [3.6, -2.4, 3.4]], shaded(lw, 0.18));
  face(pen, [[3.4, -2.8, 3.6], [7, -2.8, 2.1], [7, 2.6, 2.1], [3.4, 2.6, 3.6]], skin.roof);
  const leanFall = ease(w.v, 0.35, 0.1);
  if (leanFall > 0.05) {
    const p = on(pen, [[3.4 + 3.6 * (1 - leanFall), -2.8, 3.6 - 1.5 * (1 - leanFall)], [7, -2.8, 2.1], [7, 2.6, 2.1], [3.4 + 3.6 * (1 - leanFall), 2.6, 3.6 - 1.5 * (1 - leanFall)]]);
    wash(pen, p, HOLLOW);
  }
  roofBack(pen, m, skin);
  walls(pen, m, skin);
  stones(pen, [m.x0, m.z0], [m.x1, m.z0], m.wall, w.seed, 15);
  stones(pen, [m.x0, m.z0], [m.x0, m.z1], m.wall, w.seed + 1, 10);
  opening(pen, southRect(m.z0, -3.2, -2, 0, 2.4), "#4f6a4c", true);
  opening(pen, southRect(m.z0, -0.4, 1, 1.2, 2.4));
  opening(pen, westRect(m.x0, -0.7, 0.7, 1.2, 2.4));
  ivy(pen, m.x1 - 0.2, m.z0, m.wall, w.ivy, w.seed);
  breach(pen, m.x1, m.z0, 1, m.wall, w.breach, w.seed);
  roofFront(pen, m, skin, w);
  chimney(pen, -1, 0.3, 6, 9.4, 1.6, "#a39c8c", w);
  tufts(pen, [[-6, -3.6], [-1.2, -3.5], [6.8, -2.8]], w);
}

/** A watermill: a long stone mill stepping down to a lower range, under teal shingles, its great wheel at the west end fed by a flume. */
function watermill(pen: Pen, w: Wear): void {
  const main: Mass = { x0: -3, x1: 4.4, z0: -2.8, z1: 2.8, wall: 5.4, ridge: 9.8, along: "x", hip: 0, eave: 0.55 };
  const wing: Mass = { x0: 4.4, x1: 8, z0: -2.4, z1: 2.4, wall: 3.6, ridge: 6.8, along: "x", hip: 0, eave: 0.5 };
  castShadow(pen, [[-7, -3.6], [8, -2.4], [8, 2.4], [-7, 2.8]], 7);
  const stone = "#d8cfba";
  const skin = skinOf(stone, "#4e8b78", "tile", w);
  // The race: water running out from under the wheel to the southeast, dry when the mill has failed.
  const water = ease(w.v, 0.12, 0.5);
  const race = on(pen, [[-7.4, -3.2, 0], [-1.2, -4.8, 0], [2.6, -6.4, 0], [1.6, -7.2, 0], [-1.8, -5.8, 0], [-7.6, -4.4, 0]]);
  wash(pen, race, rgba(mix("#8fa8a6", "#6f9fb4", water), 0.35 + water * 0.4));
  ink(pen, [race[0] as Pt, race[1] as Pt, race[2] as Pt], false, 0.5, rgba(INK, 0.6));
  ink(pen, [race[3] as Pt, race[4] as Pt, race[5] as Pt], false, 0.5, rgba(INK, 0.6));
  // The lower range behind, then the mill.
  roofBack(pen, wing, skin);
  walls(pen, wing, skin);
  opening(pen, southRect(wing.z0, 5.4, 6.6, 0, 2.3), "#6a4a33", true);
  roofFront(pen, wing, skin, { ...w, rot: w.rot * 0.7 });
  roofBack(pen, main, skin);
  walls(pen, main, skin);
  stones(pen, [main.x0, main.z0], [main.x1, main.z0], main.wall, w.seed, 15);
  stones(pen, [main.x0, main.z0], [main.x0, main.z1], main.wall, w.seed + 1, 10);
  for (const X of [0.2, 2.8]) {
    for (const [h0, h1] of [[1, 2.4], [3.3, 4.6]] as const) {
      opening(pen, southRect(main.z0, X - 0.55, X + 0.55, h0, h1));
      opening(pen, southRect(main.z0 - 0.05, X - 1.05, X - 0.6, h0, h1), worn("#d8ae46", w), false);
      opening(pen, southRect(main.z0 - 0.05, X + 0.6, X + 1.05, h0, h1), worn("#d8ae46", w), false);
    }
  }
  ivy(pen, main.x1 - 0.2, main.z0, main.wall, w.ivy, w.seed);
  breach(pen, main.x1, main.z0, 1, main.wall, w.breach, w.seed);
  roofFront(pen, main, skin, w);
  chimney(pen, 3.4, 0.4, 7.4, 11.4, 1.2, "#a39c8c", w);
  waterwheel(pen, -4.4, -3.6, 3.2, 3.6, w, water);
  tufts(pen, [[1.6, -3.4], [8.4, -2.8]], w);
}

/** The mill's great wheel, rimmed and spoked with paddles all round, an overshot flume pouring onto it; it breaks up as the mill fails. */
function waterwheel(pen: Pen, X: number, Z: number, H: number, r: number, w: Wear, water: number): void {
  const { ctx } = pen;
  const wood = worn("#7a5636", w);
  const broken = ease(w.v, 0.3, 0.04);
  // A gap in the rim and missing paddles on a failing wheel.
  const gap = broken * 1.8;
  const ring = (rad: number, dz: number): Pt[] => {
    const pts: Pt[] = [];
    for (let k = 0; k <= 28; k++) {
      const t = 0.9 + gap + (k / 28) * (Math.PI * 2 - gap);
      pts.push(pen.at(X + Math.cos(t) * rad, Z + dz, H + Math.sin(t) * rad));
    }
    return pts;
  };
  // The far rim, then spokes, then the near rim with its paddles.
  ink(pen, ring(r, 1), false, 1.4, rgba(wood, 1));
  ink(pen, ring(r, 1), false, 0.5);
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    if (noise(w.seed, k + 100) < broken * 0.7) continue;
    const t = (k / 8) * Math.PI;
    const [p0, p1] = [pen.at(X + Math.cos(t) * r, Z, H + Math.sin(t) * r), pen.at(X - Math.cos(t) * r, Z, H - Math.sin(t) * r)];
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
  for (let k = 0; k < 16; k++) {
    if (noise(w.seed, k + 120) < broken) continue;
    const t = (k / 16) * Math.PI * 2;
    if (t > 0.9 && t < 0.9 + gap) continue;
    const p0 = pen.at(X + Math.cos(t) * r, Z, H + Math.sin(t) * r);
    const p1 = pen.at(X + Math.cos(t) * (r + 0.9), Z, H + Math.sin(t) * (r + 0.9));
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
  }
  ctx.lineWidth = pen.line * 0.9;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // The hub.
  const [hx, hy] = pen.at(X, Z, H);
  ctx.beginPath();
  ctx.arc(hx, hy, 0.6 * pen.s, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  // The flume on its trestles, coming in from the west over the wheel's top; it sags and drops as the mill fails.
  const sag = broken * 2.6;
  const fz = Z + 0.3;
  const top = H + r + 1.1;
  const trough = on(pen, [[X - 6.2, fz, top - sag], [X + 0.3, fz, top - sag * 0.2], [X + 0.3, fz, top - 0.8 - sag * 0.2], [X - 6.2, fz, top - 0.8 - sag]]);
  wash(pen, trough, worn("#8a6544", w));
  ink(pen, trough, true, 0.8);
  hatch(pen, [[[X - 5.4, fz, 0], [X - 5.4, fz, top - 0.8 - sag * 0.9]], [[X - 2.8, fz, 0], [X - 2.8 + broken * 1.6, fz, top - 0.8 - sag * 0.6]]], INK, 0.8);
  if (water > 0.05) {
    // Water spilling off the flume onto the wheel.
    const spill = on(pen, [[X + 0.3, fz - 0.2, top - 0.5], [X + 0.8, fz - 0.2, top - 1.6], [X + 1.1, fz - 0.2, top - 2.6]]);
    ink(pen, spill, false, 1.3 * water, rgba("#5f93b0", 0.9));
  }
}

/** An archive: a timbered house under blue slates in an L, its tall square tower at the back corner, quoined and crowned by an open lantern. */
function archiveTower(pen: Pen, w: Wear): void {
  const main: Mass = { x0: -5.6, x1: 2, z0: -1.8, z1: 2.6, wall: 4.6, ridge: 8.8, along: "x", hip: 0, eave: 0.5 };
  const wing: Mass = { x0: -5.2, x1: -1.4, z0: -4.6, z1: -1.8, wall: 4.6, ridge: 8.6, along: "z", hip: 0, eave: 0.5 };
  const tower = { x0: 1.8, x1: 6, z0: -0.4, z1: 3.4 };
  castShadow(pen, [[-5.6, -4.6], [6, -1.8], [6, 3.4], [-5.6, 2.6]], 12);
  const skin = skinOf("#efe6d2", "#5f6e86", "slate", w);
  // The tower's top falls first: the lantern's cap, then its posts, then the shaft from the top down.
  const fallen = ease(w.v, 0.34, 0.04);
  const shaft = 13.4 - 0.6 * fallen;
  const render = worn("#e6e0d0", w);
  face(pen, [[tower.x0, tower.z0, 0], [tower.x1, tower.z0, 0], ...jagged(tower.x1, tower.x0, tower.z0, shaft, fallen, w.seed, 1.5)], shaded(render, 0.16));
  // Quoins down its front corners, narrow lamplit windows.
  const quoins: P3[][] = [];
  for (let h = 0.4; h < shaft - 0.6; h += 1.3) {
    quoins.push([[tower.x1 - 0.1, tower.z0, h], [tower.x1 - 0.8, tower.z0, h], [tower.x1 - 0.8, tower.z0, h + 0.6], [tower.x1 - 0.1, tower.z0, h + 0.6]]);
  }
  for (const q of quoins) opening(pen, q, shaded(worn("#b8b0a0", w), 0.1), false);
  opening(pen, southRect(tower.z0, 4.1, 4.7, 9.4, 11), mix("#e2b75a", GLASS, ease(w.v, 0.75, 0.4)));
  if (fallen < 0.05) {
    face(pen, [[tower.x0, tower.z0, shaft], [tower.x1, tower.z0, shaft], [tower.x1, tower.z1, shaft], [tower.x0, tower.z1, shaft]], lit(render, 0.25));
    lantern(pen, (tower.x0 + tower.x1) / 2, (tower.z0 + tower.z1) / 2, shaft, w);
  } else {
    // Its face holed where blocks have fallen out.
    for (const [X, h, r] of [[3.6, shaft - 3.6, 0.7], [4.4, shaft - 6.2, 0.55]] as const) {
      const hole = on(pen, [[X - r, tower.z0, h - r], [X + r * 0.6, tower.z0, h - r * 1.2], [X + r, tower.z0, h + r * 0.3], [X - r * 0.2, tower.z0, h + r], [X - r * 1.1, tower.z0, h + r * 0.2]]);
      wash(pen, hole, rgba("#2c2219", fallen * 0.85));
    }
    ivy(pen, tower.x1 - 0.2, tower.z0, shaft, w.ivy * 0.6, w.seed + 5);
    rubble(pen, 5.4, -1.6, fallen * 2.6, w.seed + 2, "#cfc8b8");
  }
  roofBack(pen, main, skin);
  walls(pen, main, skin);
  hatch(pen, [-4.6, -3.6, 0, 1].map((X) => [[X, main.z0, 0], [X, main.z0, main.wall]] as P3[]), rgba(TIMBER, 0.75), 0.6);
  opening(pen, southRect(main.z0, -0.8, 0.4, 1.4, 3.2));
  roofFront(pen, main, skin, { ...w, rot: w.rot * 0.85 });
  roofBack(pen, wing, skin);
  walls(pen, wing, skin);
  const xm = (wing.x0 + wing.x1) / 2;
  hatch(pen, [[[wing.x0, wing.z0, 2.3], [wing.x1, wing.z0, 2.3]], [[wing.x0 + 1, wing.z0, 0], [wing.x0 + 1, wing.z0, wing.wall]], [[wing.x1 - 1, wing.z0, 0], [wing.x1 - 1, wing.z0, wing.wall]]], rgba(TIMBER, 0.75), 0.6);
  opening(pen, southRect(wing.z0, xm - 0.5, xm + 0.5, 0, 2), "#5a4a6a", true);
  opening(pen, southRect(wing.z0, xm - 0.6, xm + 0.6, 3.1, 4.4));
  ivy(pen, wing.x0 + 0.3, wing.z0, wing.wall, w.ivy, w.seed);
  breach(pen, wing.x0, wing.z0, -1, wing.wall, w.breach, w.seed);
  roofFront(pen, wing, skin, w);
  chimney(pen, -4.4, 1.2, 7, 10.4, 1.1, "#a39c8c", w);
  tufts(pen, [[-5.8, -5.2], [-0.6, -2.6], [6.4, -1]], w);
}

/** The south face's top edge from `xa` to `xb` at `z`: straight at `h`, or broken into a jagged stump as `fallen` grows, falling away `slant` more toward `xb`. */
function jagged(xa: number, xb: number, z: number, h: number, fallen: number, seed: number, slant = 0): P3[] {
  if (fallen < 0.05) return [[xa, z, h], [xb, z, h]];
  const n = 5;
  const pts: P3[] = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    pts.push([xa + (xb - xa) * u, z, h - fallen * (noise(seed, k + 200) * 3 + (k % 2) * 1 + slant * u)]);
  }
  return pts;
}

/** An open lantern room: four posts and a glow under a pyramid cap, which goes first as the tower fails. */
function lantern(pen: Pen, X: number, Z: number, base: number, w: Wear): void {
  const capGone = ease(w.v, 0.62, 0.42);
  const postsGone = ease(w.v, 0.48, 0.36);
  const half = 1.45;
  const top = base + 2.6;
  const glow = ease(w.v, 0.55, 0.85);
  if (glow > 0.02) {
    const p = on(pen, [[X - half, Z - half, base + 0.3], [X + half, Z - half, base + 0.3], [X + half, Z - half, top], [X - half, Z - half, top]]);
    wash(pen, p, rgba("#f3c768", 0.75 * glow));
  }
  if (postsGone < 0.95) {
    const h = base + (top - base) * (1 - postsGone);
    hatch(pen, [[[X - half, Z - half, base], [X - half, Z - half, h]], [[X + half, Z - half, base], [X + half, Z - half, h]], [[X - half, Z + half, base], [X - half, Z + half, h * 0.98 + base * 0.02]]], INK, 0.9);
  }
  if (capGone < 0.9) {
    const e = 0.6;
    const apex = top + 2.6 * (1 - capGone);
    face(pen, [[X - half - e, Z - half - e, top], [X + half + e, Z - half - e, top], [X, Z, apex]], worn("#5f6e86", w));
    face(pen, [[X - half - e, Z - half - e, top], [X, Z, apex], [X - half - e, Z + half + e, top]], lit(worn("#5f6e86", w), 0.22));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The landmarks.

/** A battlemented keep: a tall square tower of great rough blocks, a corbelled walk round its top and battlements over it. */
function keep(pen: Pen, w: Wear, seed: number): void {
  const r = 3.8;
  const shaft = 13.6;
  castShadow(pen, [[-r, -r], [r, -r], [r, r], [-r, r]], 15);
  const stone = worn("#c9bd9c", w);
  // As it fails, merlons go one by one, then the walk, then the walls come down from the top to a jagged stump.
  const fall = ease(w.v, 0.36, 0.03);
  const top = shaft - 6 * fall;
  if (fall > 0.05) {
    // The shell's far walls, seen from inside over the broken near ones.
    face(pen, [[-r, r, 0], ...jagged(-r, r, r, top, fall, seed + 2), ...jaggedWest(r, -r, r, top, fall, seed + 3), [r, -r, 0]], shaded(stone, 0.45));
  }
  const westTop = jaggedWest(-r, -r, r, top, fall, seed);
  face(pen, [[-r, -r, 0], [-r, r, 0], ...westTop], lit(stone, 0.12));
  const southTop = jagged(r, -r, -r, top, fall, seed + 1);
  face(pen, [[-r, -r, 0], [r, -r, 0], ...southTop], shaded(stone, 0.2));
  // Coursed blocks, staggered.
  const lines: P3[][] = [];
  for (let h = 2.2; h < top - 0.6; h += 2.2) {
    lines.push([[-r, -r, h], [r, -r, h]], [[-r, -r, h], [-r, r, h]]);
    const off = (h / 2.2) % 2 === 0 ? 0 : 1.3;
    for (let X = -r + 1.2 + off; X < r - 0.4; X += 2.6) lines.push([[X, -r, h - 2.2], [X, -r, h]]);
  }
  hatch(pen, lines, rgba(INK, 0.35), 0.5);
  // Arrow slits and the door.
  for (const h of [4.5, 8.5, 12]) if (h < top - 1) opening(pen, southRect(-r, -0.25, 0.25, h, h + 1.3));
  if (top > 6) opening(pen, westRect(-r, -0.25, 0.25, 7, 8.3));
  const door = on(pen, [[-0.8, -r, 0], [0.8, -r, 0], [0.8, -r, 1.9], [0, -r, 2.6], [-0.8, -r, 1.9]]);
  wash(pen, door, "#4a3a2c");
  ink(pen, door, true, 0.5);
  if (fall < 0.08) {
    battlements(pen, r, shaft, stone, w, seed);
  } else {
    // A broken top shows the dark inside of the shell.
    ivy(pen, -r + 0.4, -r, top, w.ivy, seed);
    rubble(pen, r * 0.7, -r - 1.4, 1.2 + fall * 3.2, seed + 3, "#c9bd9c");
  }
}

/** The west face's top edge, straight or jagged as the keep falls, from the front corner back. */
function jaggedWest(x: number, za: number, zb: number, h: number, fallen: number, seed: number): P3[] {
  if (fallen < 0.05) return [[x, zb, h], [x, za, h]];
  const pts: P3[] = [];
  for (let k = 5; k >= 0; k--) pts.push([x, za + ((zb - za) * k) / 5, h - fallen * (noise(seed, k + 300) * 2.2 + (k % 2) * 0.7)]);
  return pts;
}

/** The keep's crown: a corbelled walk overhanging the shaft, a parapet round it and merlons along its top. */
function battlements(pen: Pen, r: number, shaft: number, stone: string, w: Wear, seed: number): void {
  const o = r + 0.6;
  const p0 = shaft + 0.9;
  const p1 = p0 + 1.6;
  // The corbel band.
  face(pen, [[-o, -o, shaft + 0.9], [-r, -r, shaft], [-r, r, shaft], [-o, o, shaft + 0.9]], shaded(stone, 0.05), 0.8);
  face(pen, [[-o, -o, shaft + 0.9], [-r, -r, shaft], [r, -r, shaft], [o, -o, shaft + 0.9]], shaded(stone, 0.35), 0.8);
  // The walk's floor seen over the parapet, then the far parapet's merlons, then the near parapets.
  face(pen, [[-o, -o, p0], [o, -o, p0], [o, o, p0], [-o, o, p0]], shaded(stone, 0.45));
  const merlon = (k: number): boolean => noise(seed, k + 400) * 0.5 + 0.38 < w.v;
  for (let k = 0; k < 4; k++) {
    if (!merlon(k + 10)) continue;
    const X = -o + 0.3 + k * ((2 * o - 1.2) / 3);
    box(pen, X, X + 1, o - 0.7, o, p0, p1 + 1, stone, null, 0.75);
  }
  face(pen, [[-o, -o, p0 - 0.9], [-o, o, p0 - 0.9], [-o, o, p1], [-o, -o, p1]], lit(stone, 0.14));
  face(pen, [[-o, -o, p0 - 0.9], [o, -o, p0 - 0.9], [o, -o, p1], [-o, -o, p1]], shaded(stone, 0.2));
  for (let k = 0; k < 4; k++) {
    if (merlon(k)) {
      const X = -o + k * ((2 * o - 1.1) / 3);
      box(pen, X, X + 1.1, -o, -o + 0.7, p1, p1 + 1.1, stone, null, 0.75);
    }
    if (merlon(k + 5) && k > 0) {
      const Z = -o + k * ((2 * o - 1.1) / 3);
      box(pen, -o, -o + 0.7, Z, Z + 1.1, p1, p1 + 1.1, stone, null, 0.75);
    }
  }
}

/** A lantern tower: round and tapering, of dressed blocks, a gallery round its top and a glowing lantern room under a cap. */
function lanternTower(pen: Pen, w: Wear, seed: number): void {
  const { ctx, s } = pen;
  ellipseShadow(pen, 1.6, -2.6, 4.6, 3.4);
  castShadow(pen, [[-3, -3], [3, -3], [3, 3], [-3, 3]], 16, 0.8);
  const stone = worn("#d2c39f", w);
  // The crown goes first in tiers (cap and glass, then the lantern's posts, then the gallery), then the shaft falls from the top.
  const fall = ease(w.v, 0.34, 0.03);
  const shaft = 13 - 5.4 * fall;
  const rAt = (h: number): number => 3.1 - h * 0.045;
  const [bx, by] = pen.at(0, 0, 0);
  const [tx, ty] = pen.at(0, 0, shaft);
  const rb = rAt(0) * s;
  const rt = rAt(shaft) * s;
  if (fall > 0.05) {
    // The hollow inside the broken drum, its far wall in shade.
    const iy = ty + fall * 0.9 * s;
    ctx.beginPath();
    ctx.ellipse(tx, iy, rt * 1.01, rt * 0.405, 0, 0, Math.PI * 2);
    ctx.fillStyle = shaded(stone, 0.5);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(tx, iy, rt * 1.01, rt * 0.405, 0, Math.PI, Math.PI * 2);
    ctx.lineWidth = pen.line;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(tx - rt * 1.01, ty);
  ctx.lineTo(bx - rb * 1.01, by);
  ctx.ellipse(bx, by, rb * 1.01, rb * 0.405, 0, Math.PI, 0, true);
  ctx.lineTo(tx + rt * 1.01, ty);
  if (fall > 0.05) {
    // A jagged broken top.
    for (let k = 1; k < 7; k++) {
      const u = 1 - (k / 7) * 2;
      ctx.lineTo(tx + rt * 1.01 * u, ty + rt * 0.3 * Math.sqrt(1 - u * u) + (noise(seed, k + 500) * 2.6 + (k % 2) * 0.8) * fall * s);
    }
  } else {
    ctx.ellipse(tx, ty, rt * 1.01, rt * 0.405, 0, 0, Math.PI, false);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(bx - rb, 0, bx + rb, 0);
  g.addColorStop(0, lit(stone, 0.12));
  g.addColorStop(0.3, lit(stone, 0.32));
  g.addColorStop(1, shaded(stone, 0.32));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = pen.line;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // Courses of dressed blocks, curving round the drum.
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  for (let h = 1.6; h < shaft; h += 1.6) {
    const [cx, cy] = pen.at(0, 0, h);
    const rr = rAt(h) * s;
    ctx.moveTo(cx - rr * 1.01, cy);
    ctx.ellipse(cx, cy, rr * 1.01, rr * 0.405, 0, Math.PI, 0, true);
  }
  ctx.lineWidth = pen.line * 0.45;
  ctx.strokeStyle = rgba(INK, 0.35);
  ctx.stroke();
  ctx.restore();
  // Narrow windows up the drum, and the door.
  for (const h of [3.8, 7.6, 11.2]) if (h < shaft - 1.2) opening(pen, [[-0.3, -rAt(h), h], [0.3, -rAt(h), h], [0.3, -rAt(h), h + 1.2], [-0.3, -rAt(h), h + 1.2]]);
  const door = on(pen, [[-0.7, -3.1, 0], [0.7, -3.1, 0], [0.7, -3.1, 1.8], [0, -3.1, 2.4], [-0.7, -3.1, 1.8]]);
  wash(pen, door, "#5a4030");
  ink(pen, door, true, 0.5);
  if (fall > 0.05) {
    ivy(pen, -rAt(0) + 0.4, -1.4, shaft, w.ivy, seed);
    rubble(pen, 2.4, -3.4, 1.4 + fall * 3, seed + 4, "#d2c39f");
    return;
  }
  // The gallery: a corbelled ring wider than the drum, its railing, the lantern room and its cap.
  const tiers = { cap: ease(w.v, 0.66, 0.46), glass: ease(w.v, 0.6, 0.4), posts: ease(w.v, 0.5, 0.38), gallery: ease(w.v, 0.42, 0.34) };
  const gr = 3.4 * s;
  const gh = shaft + 0.8;
  const [gx, gy] = pen.at(0, 0, gh);
  if (tiers.gallery < 0.9) {
    ctx.beginPath();
    ctx.moveTo(tx - rt * 1.01, ty);
    ctx.lineTo(gx - gr * 1.01, gy);
    ctx.ellipse(gx, gy, gr * 1.01, gr * 0.405, 0, Math.PI, 0, true);
    ctx.lineTo(tx + rt * 1.01, ty);
    ctx.closePath();
    ctx.fillStyle = shaded(stone, 0.28);
    ctx.fill();
    ctx.lineWidth = pen.line;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(gx, gy, gr * 1.01, gr * 0.405, 0, 0, Math.PI * 2);
    ctx.fillStyle = lit(stone, 0.2);
    ctx.fill();
    ctx.stroke();
  }
  const lr = 1.8 * s;
  const lh = 2.7;
  const [lx, ly] = pen.at(0, 0, gh + lh);
  if (tiers.posts < 0.95) {
    const glow = 1 - tiers.glass;
    if (glow > 0.02) {
      ctx.beginPath();
      ctx.moveTo(gx - lr, gy);
      ctx.lineTo(lx - lr, ly);
      ctx.lineTo(lx + lr, ly);
      ctx.lineTo(gx + lr, gy);
      ctx.ellipse(gx, gy, lr, lr * 0.405, 0, 0, Math.PI, false);
      ctx.closePath();
      ctx.fillStyle = rgba("#f4cb6a", 0.85 * glow);
      ctx.fill();
    }
    const ph = lh * (1 - tiers.posts);
    ctx.beginPath();
    for (const u of [-1, -0.35, 0.35, 1]) {
      ctx.moveTo(gx + lr * u, gy + lr * 0.405 * Math.sqrt(1 - u * u) * 0.9);
      ctx.lineTo(lx + lr * u, gy + lr * 0.405 * Math.sqrt(1 - u * u) * 0.9 - ph * s);
    }
    ctx.lineWidth = pen.line * 0.85;
    ctx.strokeStyle = INK;
    ctx.stroke();
    // The railing round the gallery.
    ctx.beginPath();
    ctx.ellipse(gx, gy - 0.9 * s, gr * 1.01, gr * 0.405, 0, 0, Math.PI, false);
    ctx.lineWidth = pen.line * 0.6;
    ctx.stroke();
  }
  if (tiers.cap < 0.9) {
    const cr = 2.3 * s;
    const apex = (4.4 * (1 - tiers.cap) + 0.4) * s;
    ctx.beginPath();
    ctx.moveTo(lx - cr, ly);
    ctx.quadraticCurveTo(lx - cr * 0.4, ly - apex * 0.5, lx, ly - apex);
    ctx.quadraticCurveTo(lx + cr * 0.4, ly - apex * 0.5, lx + cr, ly);
    ctx.ellipse(lx, ly, cr, cr * 0.405, 0, 0, Math.PI, false);
    ctx.closePath();
    const cg = ctx.createLinearGradient(lx - cr, 0, lx + cr, 0);
    const copper = worn("#5d8a7a", w);
    cg.addColorStop(0, lit(copper, 0.3));
    cg.addColorStop(1, shaded(copper, 0.3));
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.lineWidth = pen.line;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (tiers.cap < 0.1) ink(pen, [[lx, ly - apex], [lx, ly - apex - 1.4 * s]], false, 0.8);
  }
}

/** A ring of towering standing stones round a tall king stone, lintels across some pairs; failing, the lintels drop first, then stones lean out and lie down in the grass or snap, their tops lying at their feet. */
function stoneRing(pen: Pen, w: Wear, seed: number): void {
  const R = 8.2;
  const n = 9;
  ellipseShadow(pen, 0.6, -0.6, R + 1.4, R + 1, 0.8);
  const grey = worn("#c4c2b6", w);
  const all: Stone[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.2;
    // Each stone stands until vitality drops past its own threshold, then leans out over a stretch and lies down, or snaps.
    const th = -0.04 + noise(seed, k + 600) * 0.56;
    // A fallen stone lies along the ring more than out of it, so the ring still shows in the grass.
    const fall = a + (noise(seed, k + 630) < 0.5 ? 1 : -1) * (Math.PI / 2 - noise(seed, k + 635) * 0.9);
    const snaps = noise(seed, k + 640) < 0.3;
    all.push({ a: fall, X: Math.cos(a) * R, Z: Math.sin(a) * R, h: 5 + noise(seed, k + 610) * 1.4, wd: 2.2 + noise(seed, k + 620) * 0.6, lean: snaps ? 0 : ease(w.v, th + 0.12, th), snapped: snaps && w.v < th, king: false });
  }
  all.push({ a: -Math.PI / 2 + 0.5, X: 0, Z: 0.4, h: 7.8, wd: 2.4, lean: ease(w.v, 0.2, 0.04), snapped: false, king: true });
  // Lintels across three pairs; they fall before their stones.
  const up = (k: number): boolean => (all[k] as Stone).lean < 0.02 && !(all[k] as Stone).snapped;
  const lintels = [0, 3, 6].filter((k) => w.v > 0.5 + noise(seed, k + 650) * 0.35 && up(k) && up(k + 1));
  const order = all.map((st, i) => ({ st, i })).sort((p, q) => q.st.Z - p.st.Z);
  for (const { st, i } of order) {
    if (st.snapped) {
      // The top lies at the foot, then the stump stands over it.
      drawStone(pen, { ...st, X: st.X + Math.cos(st.a) * 1.6, Z: st.Z + Math.sin(st.a) * 1.6, h: st.h * 0.6, lean: 1 }, grey, seed + i);
      drawStone(pen, { ...st, h: st.h * 0.42, broken: true }, grey, seed + i);
    } else {
      drawStone(pen, st, grey, seed + i);
    }
    // A lintel is drawn once its nearer stone is up.
    for (const k of lintels) {
      const a = all[k] as Stone;
      const b = all[k + 1] as Stone;
      if (i === (a.Z < b.Z ? k : k + 1)) {
        const h = Math.min(a.h, b.h);
        face(pen, [[a.X, a.Z, h - 0.2], [b.X, b.Z, h - 0.2], [b.X, b.Z, h + 1], [a.X, a.Z, h + 1]], shaded(grey, 0.12), 0.85);
        face(pen, [[a.X, a.Z, h + 1], [b.X, b.Z, h + 1], [b.X * 0.86, b.Z * 0.86, h + 1], [a.X * 0.86, a.Z * 0.86, h + 1]], lit(grey, 0.2), 0.85);
      }
    }
  }
}

interface Stone {
  /** The way it falls, radians from east toward north. */
  readonly a: number;
  readonly X: number;
  readonly Z: number;
  readonly h: number;
  readonly wd: number;
  /** From 0 (upright) to 1 (lying in the grass). */
  readonly lean: number;
  readonly snapped: boolean;
  readonly king: boolean;
  /** A stump with a broken top. */
  readonly broken?: boolean;
}

/** One standing stone: a tall slab with a rounded top, lit on its west edge; leaning out from the ring's middle about its foot as `lean` grows, and lying in the grass at 1. */
function drawStone(pen: Pen, st: Stone, grey: string, seed: number): void {
  const t = st.lean * (Math.PI / 2) * 0.96;
  // Out from the middle (the king stone falls toward the viewer).
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
  // A stone lying down settles into the grass, so less of its length shows, and its broad face lies up.
  const len = st.h * (1 - 0.3 * st.lean);
  const wide = 1 + 0.3 * st.lean;
  const tipAt = (f: number, side: number): P3 => [st.X + ox * out * len * f + cx * wide * side * (1 - f * 0.35), st.Z + oz * out * len * f + cz * wide * side * (1 - f * 0.35), st.h * f * up];
  const pts: P3[] = st.broken
    ? [tipAt(0, -1), tipAt(0, 1), tipAt(0.9, 1), tipAt(1, 0.3), tipAt(0.82, -0.2), tipAt(0.96, -1)]
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
  // A crack or two of lichen.
  if (noise(seed, 1) > 0.4 && st.lean < 0.5) hatch(pen, [[tipAt(0.3, -0.2), tipAt(0.55, 0.15)]], rgba(INK, 0.4), 0.45);
}

/** A great oak: a vast, broad, spreading crown on a short buttressed trunk, stag-headed with dead limbs above; it thins, browns and stands bare as it fails. */
function greatOak(pen: Pen, w: Wear, seed: number): void {
  const { ctx, s } = pen;
  const leaf = ease(w.v, 0.1, 0.8);
  ellipseShadow(pen, 3, -3.4, 10.5 * (0.5 + leaf * 0.5), 6.4 * (0.5 + leaf * 0.5), 0.5 + leaf * 0.6);
  const bark = worn("#6d533a", w);
  const [x0, y0] = pen.at(0, 0, 0);
  const at = (dx: number, h: number): Pt => [x0 + dx * s, y0 - h * s];
  // The trunk and its great limbs, drawn first so they show through a thinning crown; stag-headed, its highest
  // limbs stand bare above the crown, and on a ruin one great bough has snapped and lies below.
  const snapped = ease(w.v, 0.2, 0.05);
  type Limb = [readonly (readonly [number, number])[], number];
  const bough: Limb[] = snapped > 0.5 ? [[[[0.8, 4.2], [2.2, 5.4]], 1.3]] : [[[[0.8, 4.2], [4.8, 7.2], [10, 8.2]], 1.3], [[[4.8, 7.2], [6.4, 11]], 0.6]];
  const limbs: Limb[] = [
    [[[-0.8, 4.2], [-4.5, 7.4], [-10, 8.6]], 1.3],
    [[[-0.4, 4.4], [-2.4, 9.4], [-3.6, 13]], 1.1],
    [[[0.4, 4.4], [2.4, 9.2], [2.6, 13.4]], 1.1],
    [[[-4.5, 7.4], [-6.6, 10.8]], 0.6],
    [[[-3.6, 13], [-4, 16.6], [-2.8, 18.4]], 0.45],
    [[[2.6, 13.4], [3.8, 17.4]], 0.45],
    [[[-4, 16.6], [-5.4, 17.8]], 0.3],
    ...bough,
  ];
  const trunk = [at(-3, -0.2), at(-1.6, 1), at(-1.3, 4.6), at(1.3, 4.6), at(1.6, 1), at(3.2, -0.2)];
  const stroke = (extra: number, color: string): void => {
    for (const [pts, width] of limbs) {
      ctx.beginPath();
      pts.forEach(([dx, h], i) => {
        const [px, py] = at(dx, h);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.lineWidth = width * s + extra;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  };
  stroke(pen.line * 1.4, INK);
  wash(pen, trunk, bark);
  ink(pen, trunk, false, 1);
  stroke(0, bark);
  if (snapped > 0.5) {
    const fall = [at(4.4, -1.4), at(11.4, -0.4)];
    ink(pen, fall, false, 2.6);
    ink(pen, fall, false, 1.5, bark);
  }
  // The crown in lobes, each going as the tree fails past its own threshold; their union inked round its edge only.
  const lobes: [number, number, number][] = [[-10.4, 8.4, 3], [-7.2, 10.8, 3.6], [-3, 12.2, 3.8], [1.8, 12.4, 3.8], [6.2, 11.2, 3.6], [10.2, 8.6, 3.1], [-6.4, 7.4, 3.2], [-1.4, 8.4, 3.8], [3.8, 8.2, 3.6], [7.6, 7.2, 3], [-0.6, 10.6, 3.4]];
  const kept = lobes.map(([dx, h, r], k) => ({ dx, h, r: r * clamp01((w.v - (0.1 + noise(seed, k + 700) * 0.55)) / 0.25) * (0.8 + leaf * 0.2) })).filter((l) => l.r > 0.5);
  if (kept.length === 0) return;
  const crown = new Path2D();
  for (const l of kept) {
    const [px, py] = at(l.dx, l.h);
    crown.moveTo(px + l.r * s, py);
    crown.arc(px, py, l.r * s, 0, Math.PI * 2);
  }
  const green = mix(mix(mix("#5a8a3f", PAPER, 0.1), "#ad9f55", w.dry * 0.95), "#9a7444", ease(w.v, 0.42, 0.12));
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
    shadePath.moveTo(px + l.r * 1.25 * s, py + l.r * 0.5 * s);
    shadePath.arc(px + l.r * 0.25 * s, py + l.r * 0.5 * s, l.r * s, 0, Math.PI * 2);
    lightPath.moveTo(px - l.r * 0.3 * s + l.r * 0.5 * s, py - l.r * 0.38 * s);
    lightPath.arc(px - l.r * 0.3 * s, py - l.r * 0.38 * s, l.r * 0.5 * s, 0, Math.PI * 2);
  }
  ctx.fillStyle = rgba(SHADE, 0.22);
  ctx.fill(shadePath);
  ctx.fillStyle = rgba("#e8f0a8", 0.3 * (1 - w.dry * 0.6));
  ctx.fill(lightPath);
  ctx.beginPath();
  for (const l of kept) {
    const [px, py] = at(l.dx, l.h);
    ctx.moveTo(px - l.r * 0.7 * s, py + l.r * 0.72 * s);
    ctx.arc(px, py, l.r * s, Math.PI * 0.78, Math.PI * 0.25, true);
  }
  ctx.lineWidth = pen.line * 0.55;
  ctx.strokeStyle = rgba(INK, 0.45);
  ctx.stroke();
  ctx.restore();
}

/** A great willow: an arching dome on a gnarled trunk, its curtain of hanging strands sweeping almost to the ground; failing, the strands shorten and thin to bare whips. */
function greatWillow(pen: Pen, w: Wear, seed: number): void {
  const { ctx, s } = pen;
  const leaf = ease(w.v, 0.08, 0.7);
  ellipseShadow(pen, 2.6, -3, 10 * (0.55 + leaf * 0.45), 6 * (0.55 + leaf * 0.45), 0.5 + leaf * 0.6);
  const bark = worn("#5e4a38", w);
  const [x0, y0] = pen.at(0, 0, 0);
  const at = (dx: number, h: number): Pt => [x0 + dx * s, y0 - h * s];
  const trunk = [at(-2.2, -0.3), at(-1.2, 1.4), at(-1.5, 5.4), at(0.2, 6.2), at(1.4, 5.2), at(1.3, 1.4), at(2.4, -0.3)];
  wash(pen, trunk, bark);
  ink(pen, trunk, false, 1);
  // Boughs arching up and out, from which the strands hang.
  const boughs: [number, number, number, number][] = [[-1, 5.6, -7.4, 12.6], [0, 6, -2.4, 15.2], [0.4, 6, 3.2, 15], [1, 5.4, 7.8, 12]];
  ctx.beginPath();
  for (const [ax, ah, bx, bh] of boughs) {
    const [p0x, p0y] = at(ax, ah);
    const [p1x, p1y] = at(bx, bh);
    const [cx, cy] = at(ax + (bx - ax) * 0.2, bh + 1.6);
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
    // Each strand's leaves, as long as the tree still holds them.
    const th = 0.06 + noise(seed, k + 820) * 0.42;
    const cover = clamp01((w.v - th) / 0.2);
    held += cover / whips;
    if (cover > 0.05) {
      any = true;
      const wd = (1.2 + noise(seed, k + 830) * 0.4) * s * (0.5 + cover * 0.5);
      // A rounded clump where the strand leaves its bough.
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
  // The dome the strands hang from, while the tree holds most of them; it thins away with them.
  const dome = ease(held, 0.45, 0.9);
  if (dome > 0.05) {
    const [dx, dy] = at(0, 10.8);
    const rx = 9.8 * (0.55 + dome * 0.45) * s;
    curtain.moveTo(dx + rx, dy);
    curtain.ellipse(dx, dy, rx, 5.4 * s * dome * (0.6 + leaf * 0.4), 0, 0, Math.PI * 2);
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
  // Lit on the west, shaded to the east, the hanging strands drawn finely down the curtain.
  const [cx0] = at(-10, 0);
  const [cx1] = at(10, 0);
  const g = ctx.createLinearGradient(cx0, 0, cx1, 0);
  g.addColorStop(0, rgba("#eef4b0", 0.28));
  g.addColorStop(0.45, rgba("#eef4b0", 0));
  g.addColorStop(1, rgba(SHADE, 0.3));
  ctx.fillStyle = g;
  ctx.fillRect(cx0, y0 - 20 * s, cx1 - cx0, 22 * s);
  ctx.lineWidth = pen.line * 0.5;
  ctx.strokeStyle = rgba("#2f4a35", 0.5);
  ctx.stroke(strands);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------

export function drawBuilding(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, kind: string, vitality = 1): void {
  const k = kind.toLowerCase();
  const w = wearOf(vitality, seedOf(k));
  const pen = penFor(ctx, x, y, s);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (k.includes("storybook")) storybookHouse(pen, x, y, s, w);
  else if (k.includes("mill")) watermill(pen, w);
  else if (k.includes("archive") || k.includes("tower")) archiveTower(pen, w);
  else if (k.includes("croft")) stoneCroft(pen, w);
  else if (k.includes("thatch")) thatchedCottage(pen, w);
  else thatchedCottage(pen, w, "#b0623e", "tile");
  ctx.restore();
}

export function drawLandmark(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, name: string, vitality = 1): void {
  const k = name.toLowerCase();
  const seed = seedOf(k);
  const w = wearOf(vitality, seed);
  const pen = penFor(ctx, x, y, s);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (k.includes("keep") || k.includes("castle")) {
    keep(pen, w, seed);
    tufts(pen, [[-4.8, -4.6], [4.4, -4.4]], w);
  } else if (k.includes("tower") || k.includes("spire") || k.includes("lighthouse")) {
    lanternTower(pen, w, seed);
    tufts(pen, [[-3.8, -3.4], [3.6, -3.2]], w);
  } else if (k.includes("ring") || k.includes("stone") || k.includes("dolmen") || k.includes("avenue") || k.includes("cairn")) {
    stoneRing(pen, w, seed);
    tufts(pen, [[-10, -1.6], [6.4, -6.4], [1.4, -9.6]], w);
  } else if (k.includes("willow")) {
    greatWillow(pen, w, seed);
    tufts(pen, [[-3.2, -0.8], [3.4, -0.6]], w);
  } else {
    greatOak(pen, w, seed);
    tufts(pen, [[-3.8, -0.8], [3.8, -0.6]], w);
  }
  ctx.restore();
}
