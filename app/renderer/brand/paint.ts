// Gaia's mark, painted by the field map's own hand (docs/design-system.md, "Gaia's mark"): the name lettered across
// its own land as the map letters an area, on the map's paper, washes, hill shading, contours, borders, river and
// trees, in health's colors, green under the G and drying to gold and russet toward the last A. The icon is the land's
// own rounded square with the G lettered on it. Everything is seeded, so the same mark is painted every time.
// `pnpm brand` (tools/brand.ts) paints it into the pictures the app shows, at the sizes it shows them.

import { pastTheEdge } from "@gaia/terrain";
import { contoursOf, drawRivers, drawTrees, haloOf, layShade, letter, shadeSlope, strokeBorders, strokeContours } from "../immersive/field-map.ts";
import { chained, contour } from "../immersive/isolines.ts";
import { nameFont, nameSpacing } from "../immersive/map-names.ts";
import { MAP_STYLE, type MapStyle, dryness, healthColor, landWash } from "../immersive/map-styles.ts";
import { PAPER, floatWash, layWash, type WashSheet } from "../immersive/wash.ts";
import { layGround } from "../immersive/wild-ink.ts";

type Ctx = CanvasRenderingContext2D;
type Point = readonly [number, number];

/** The map's look, its contours inked a little darker so they read where the mark is small. */
const STYLE: MapStyle = { ...MAP_STYLE, contour: { ...MAP_STYLE.contour, alpha: MAP_STYLE.contour.alpha * 1.5, indexAlpha: MAP_STYLE.contour.indexAlpha * 1.5 } };

const canvasOf = (w: number, h: number): [HTMLCanvasElement, Ctx] => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext("2d", { willReadFrequently: true }) as Ctx];
};
function drain<T>(g: Generator<void, T>): T {
  let r = g.next();
  while (r.done !== true) r = g.next();
  return r.value;
}
const hash = (x: number, z: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const [fx, fy] = [x - xi, y - yi];
  const [sx, sy] = [fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)];
  const [a, b, c, d] = [hash(xi + seed, yi), hash(xi + 1 + seed, yi), hash(xi + seed, yi + 1), hash(xi + 1 + seed, yi + 1)];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
/** Smooth noise in about -1..1, in four octaves. */
const fbm = (x: number, y: number, seed: number): number => {
  let [sum, amp, f] = [0, 0.5, 1];
  for (let o = 0; o < 4; o++) {
    sum += (noise(x * f, y * f, seed + o * 17) - 0.5) * amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum * 2;
};
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A piece of land as the mark paints it, in meters from its middle. */
interface Land {
  readonly reach: number;
  readonly seed: number;
  /** How far inside the paint a point is, meters: the paint gives way raggedly to bare paper where it falls to 0. */
  readonly shape: (x: number, z: number) => number;
  readonly ragged: number;
  readonly height: (x: number, z: number) => number;
  readonly vitality: (x: number, z: number) => number;
  /** Each area's heart: an area is the ground nearer its heart than any other's, its border wandering. */
  readonly hearts: readonly Point[];
  readonly river: readonly { readonly x: number; readonly z: number; readonly halfWidth: number }[];
  readonly trees: readonly { readonly x: number; readonly z: number; readonly vitality: number }[];
  /** How many times the map's width each line is drawn, so it reads at the size it is shown; 0 draws no contours or borders. */
  readonly line: number;
  /** Lays the paper's ground under the land, or leaves the canvas clear so the land lies on whatever paper it is printed on. */
  readonly paper: boolean;
  readonly style: MapStyle;
}

/** The land on a canvas `side` pixels a side, painted as the field map paints its sheet. */
function paintLand(land: Land, side: number): HTMLCanvasElement {
  const { reach: R, style: STYLE } = land;
  const zoom = side / (2 * R);
  const k = side / PAPER;
  const [c, ctx] = canvasOf(side, side);
  if (land.paper) layGround(ctx, STYLE, side / 2, side / 2, zoom * 0.62, side, side);
  // Where the paint is, as `layWash` takes it: full inside, giving way raggedly to bare paper.
  const paintAt = (x: number, z: number): number => smooth(-land.ragged, land.ragged, land.shape(x, z) + fbm(x / 9, z / 9, land.seed) * land.ragged * 1.4 + fbm(x / 2.5, z / 2.5, land.seed + 5) * land.ragged * 0.4);
  const FADE = 384;
  const [fade, fctx] = canvasOf(FADE, FADE);
  const fimg = fctx.createImageData(FADE, FADE);
  for (let j = 0; j < FADE; j++) for (let i = 0; i < FADE; i++) fimg.data[(j * FADE + i) * 4 + 3] = Math.round(255 * paintAt(-R + ((i + 0.5) / FADE) * 2 * R, -R + ((j + 0.5) / FADE) * 2 * R));
  fctx.putImageData(fimg, 0, 0);

  // The washes: each area its healthy green, a little lighter or darker by its name, turned by health where it lies.
  const n = 256;
  const cell = (2 * R) / n;
  const nearest = new Int16Array(n * n);
  const [under, uctx] = canvasOf(n, n);
  const uimg = uctx.createImageData(n, n);
  const tones = land.hearts.map((_, a) => landWash(STYLE, `gaia/${land.seed}/${a}`));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -R + (i + 0.5) * cell;
      const z = -R + (j + 0.5) * cell;
      const [wx, wz] = [x + fbm(x / 30, z / 30, land.seed + 9) * 16, z + fbm(x / 30, z / 30, land.seed + 21) * 16];
      let best = 0;
      let bestD = Infinity;
      land.hearts.forEach(([hx, hz], a) => {
        const d = Math.hypot(wx - hx, wz - hz);
        if (d < bestD) [bestD, best] = [d, a];
      });
      nearest[j * n + i] = best;
      uimg.data.set([...healthColor(STYLE, tones[best] as [number, number, number], land.vitality(x, z)), 255], (j * n + i) * 4);
    }
  }
  uctx.putImageData(uimg, 0, 0);
  // Each area's outline, in the paper's pixels for the wash and in meters for its border.
  const outlines = land.hearts.map((_, a) => {
    const segments: number[] = [];
    contour(-1, n, -1, n, (i, j) => i >= 0 && j >= 0 && i < n && j < n && nearest[j * n + i] === a, (x0, y0, x1, y1) => segments.push(x0, y0, x1, y1));
    return chained(segments);
  });
  const pathOf = (lines: readonly number[][], to: (g: number) => number): Path2D => {
    const p = new Path2D();
    for (const line of lines) {
      p.moveTo(to(line[0] as number), to(line[1] as number));
      for (let q = 2; q < line.length; q += 2) p.lineTo(to(line[q] as number), to(line[q + 1] as number));
      p.closePath();
    }
    return p;
  };
  const sheet: WashSheet = {
    reach: R,
    half: R * 3,
    n,
    cell,
    nearest,
    fade,
    areas: outlines.map((lines, a) => ({ path: pathOf(lines, (g) => (g + 0.5) * cell * (PAPER / (2 * R))), depth: 1, pool: tones[a] as [number, number, number], dry: dryness(land.vitality(...(land.hearts[a] as Point))) })),
  };
  const [wash, wctx] = canvasOf(side, side);
  wctx.scale(k, k);
  drain(layWash(wctx, under, sheet, STYLE));
  drain(floatWash(ctx, wash, 0, 0, STYLE, k));

  // The hills, shaded as the map shades them, and their contours.
  const hn = 320;
  const hc = (2 * R) / hn;
  const heights = new Float32Array(hn * hn);
  const shade = new ImageData(hn, hn);
  const light = new ImageData(hn, hn);
  const e = hc * 1.5;
  for (let j = 0; j < hn; j++) {
    for (let i = 0; i < hn; i++) {
      const [x, z] = [-R + (i + 0.5) * hc, -R + (j + 0.5) * hc];
      heights[j * hn + i] = land.height(x, z);
      const gx = (land.height(x + e, z) - land.height(x - e, z)) / (2 * e);
      const gz = (land.height(x, z + e) - land.height(x, z - e)) / (2 * e);
      shadeSlope(STYLE, gx, gz, paintAt(x, z), shade, light, j * hn + i);
    }
  }
  layShade(ctx, shade, "multiply", STYLE.shadowAlpha, STYLE, side);
  layShade(ctx, light, "screen", STYLE.lightAlpha, STYLE, side);
  const contours = drain(contoursOf(heights, hn, hc, -R, STYLE, () => true));

  // The linework over the paint, kept to it: contours, borders, the river and the trees.
  const [ink, ictx] = canvasOf(side, side);
  ictx.save();
  ictx.setTransform(zoom, 0, 0, zoom, R * zoom, R * zoom);
  ictx.lineCap = ictx.lineJoin = "round";
  if (land.line > 0) {
    strokeContours(ictx, contours, zoom / land.line, STYLE);
    strokeBorders(ictx, outlines.map((lines) => ({ path: pathOf(lines, (g) => -R + (g + 0.5) * cell), depth: 2 })), zoom / land.line);
  }
  ictx.restore();
  const sx = (v: number): number => (v + R) * zoom;
  drawRivers(ictx, [{ stations: land.river }], sx, sx, zoom);
  drawTrees(ictx, land.trees, sx, sx, zoom, Math.max(1, land.line), STYLE, () => true);
  ictx.globalCompositeOperation = "destination-in";
  ictx.drawImage(fade, 0, 0, side, side);
  ctx.drawImage(ink, 0, 0);
  return c;
}

/** Distance from (x, z) to a polyline. */
function distanceTo(points: readonly Point[], x: number, z: number): number {
  let best = Infinity;
  for (let q = 1; q < points.length; q++) {
    const [ax, az] = points[q - 1] as Point;
    const [bx, bz] = points[q] as Point;
    const [dx, dz] = [bx - ax, bz - az];
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

/** The land the name is lettered across: an island of eleven areas, thriving at its west and dry at its east. */
function nameLand(line: number, paper: boolean): Land {
  const hearts: Point[] = [];
  for (let k = 0; hearts.length < 11; k++) {
    const [x, z] = [(hash(k, 1) - 0.5) * 330, (hash(k, 2) - 0.5) * 150];
    if ((x / 170) ** 2 + (z / 80) ** 2 < 0.8) hearts.push([x, z]);
  }
  const vitality = (x: number, z: number): number => 1 - smooth(-90, 150, x + fbm(x / 60, z / 60, 4) * 40) * 0.62;
  const course: Point[] = Array.from({ length: 31 }, (_, k) => [4 + Math.sin((k / 30) * 7) * 16 + (k / 30) * 24, -48 + (k / 30) * 130] as const);
  const trees: { x: number; z: number; vitality: number }[] = [];
  for (let k = 0; k < 900 && trees.length < 150; k++) {
    const [x, z] = [(hash(k, 31) - 0.5) * 340, (hash(31, k) - 0.5) * 160];
    // Groves stand off the river and clear of the band the name is lettered along.
    if ((x / 165) ** 2 + (z / 74) ** 2 > 0.85 || fbm(x / 22, z / 22, 8) < 0.22 || distanceTo(course, x, z) < 9 || Math.abs(z) < 28) continue;
    trees.push({ x, z, vitality: vitality(x, z) });
  }
  const hill = (x: number, z: number, cx: number, cz: number, h: number, r: number): number => h * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * r * r));
  return {
    reach: 200,
    seed: 3,
    shape: (x, z) => (1 - Math.hypot(x / 172, z / 82)) * 70 + fbm(x / 50, z / 50, 2) * 14,
    ragged: 6,
    height: (x, z) => hill(x, z, -70, -14, 15, 46) + hill(x, z, 72, 2, 11, 40) + hill(x, z, -5, 40, 6, 30) + fbm(x / 40, z / 40, 3) * 3,
    vitality,
    hearts,
    river: course.map(([x, z], k) => ({ x, z, halfWidth: 0.8 + (k / 30) * 1.8 })),
    trees,
    line,
    paper,
    style: STYLE,
  };
}

/**
 * The land the icon's G is lettered on: the land's own rounded square, a river along its foot. `size` is the pixels
 * it is painted at: under 24 only its washes and river show, as linework there would only blur the G.
 */
function iconLand(small: boolean, size: number): Land {
  return {
    reach: 100,
    seed: 5,
    shape: (x, z) => -pastTheEdge({ size: 168 }, x, z),
    ragged: 3,
    height: (x, z) => 14 * Math.exp(-((x + 12) ** 2 + (z + 8) ** 2) / (2 * 42 ** 2)) + 6 * Math.exp(-((x - 50) ** 2 + (z - 46) ** 2) / (2 * 22 ** 2)) + fbm(x / 30, z / 30, 6) * 1.6,
    vitality: (x, z) => 0.96 - smooth(10, 90, x + z) * 0.4,
    hearts: [[-50, -50], [40, -45], [-45, 40], [42, 45], [0, 0]],
    river: Array.from({ length: 21 }, (_, k) => ({ x: 70 - k * 4.5, z: 95 - k * 2 + Math.sin(k / 3) * 5, halfWidth: small ? 3.5 : 1.6 })),
    trees: [],
    line: size < 24 ? 0 : small ? 2.6 : 1,
    paper: true,
    style: small ? { ...STYLE, contour: { ...STYLE.contour, interval: 3 } } : STYLE,
  };
}

/** Letters `text` as the map letters an area's name (`nameFont`, `nameSpacing`, `letter`), at `size` pixels, edged with a little paper. */
function letterAt(ctx: Ctx, text: string, x: number, y: number, size: number): void {
  ctx.save();
  ctx.font = nameFont(size);
  ctx.letterSpacing = `${nameSpacing(size)}px`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // The spacing follows the last letter too, so the word is set half of it to the right to sit centered.
  letter(ctx, text, x + nameSpacing(size) / 2, y, STYLE.ink, haloOf(STYLE), size * 0.07);
  ctx.restore();
}

/** A canvas cut to what is painted on it, `margin` pixels round. */
function trimmed(c: HTMLCanvasElement, margin: number): HTMLCanvasElement {
  const d = (c.getContext("2d") as Ctx).getImageData(0, 0, c.width, c.height).data;
  let [x0, y0, x1, y1] = [c.width, c.height, 0, 0];
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) if ((d[(y * c.width + x) * 4 + 3] as number) > 6) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  }
  [x0, y0, x1, y1] = [Math.max(0, x0 - margin), Math.max(0, y0 - margin), Math.min(c.width, x1 + margin + 1), Math.min(c.height, y1 + margin + 1)];
  const [t, g] = canvasOf(x1 - x0, y1 - y0);
  g.drawImage(c, -x0, -y0);
  return t;
}

/**
 * The name across its land, `width` pixels wide, its lines `line` times the map's so they read at the size it is
 * shown: clear round the land so it prints on any paper, or on its own sheet of the map's paper, torn by `torn` (the
 * sheet's torn edge, `DECKLE_MASK`, loaded).
 */
export function paintLockup(width: number, line: number, torn?: HTMLImageElement): HTMLCanvasElement {
  const onPaper = torn !== undefined;
  const land = paintLand(nameLand(line, false), width);
  const [c, g] = canvasOf(width, width / 2);
  if (onPaper) layGround(g, STYLE, width / 2, width / 4, (width / 400) * 0.62, width, width / 2);
  g.drawImage(land, 0, -width / 4);
  // As the map letters an area: along the way its land runs, across its widest ground.
  g.save();
  g.translate(width / 2, width / 4 + width * 0.003);
  g.rotate(-0.035);
  letterAt(g, "GAIA", 0, 0, width * 0.165);
  g.restore();
  if (!onPaper) return trimmed(c, Math.round(width * 0.01));
  g.globalCompositeOperation = "destination-in";
  g.drawImage(torn, 0, 0, c.width, c.height);
  return c;
}

/**
 * The icon's art, `size` pixels a side: the land's rounded square on the map's paper with the G lettered on it.
 * `small` paints it for 32 pixels and under: a heavier G, a wider river and fewer, heavier contours.
 */
export function paintIcon(size: number, small: boolean): HTMLCanvasElement {
  const c = paintLand(iconLand(small, size), size);
  letterAt(c.getContext("2d") as Ctx, "G", size / 2 + size * 0.01, size / 2 + size * 0.015, size * (size < 24 ? 0.8 : small ? 0.73 : 0.635));
  return c;
}
