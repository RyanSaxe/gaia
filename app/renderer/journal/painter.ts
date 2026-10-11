// The journal's painter: an impressionist painting of the world's own view of
// a thing, made of bristle-brush strokes that follow the shapes of what is
// seen, laid coarse to fine, the thing itself painted last and finest, with
// the paper's tooth showing faintly through the paint. A painting runs to the
// page's edges. It is the painter round 32's pages were painted with, made to
// run on a thread of its own (`painter-worker.ts`): it draws on an
// OffscreenCanvas and blurs with its own hand rather than a canvas filter,
// which not every browser has there.

import type { Pixels } from "../terrain/capture.ts";

export interface PaintJob {
  /** The world's view of the thing, in the painting's proportions. */
  readonly color: Pixels;
  /** White where the thing itself shows in `color`, black elsewhere, the same size. */
  readonly mask: Pixels;
  /** The painting's size, device pixels; its strokes are sized for a page about 1,040 wide. */
  readonly w: number;
  readonly h: number;
  /** The same seed paints the same painting. */
  readonly seed: number;
}

type RGB = [number, number, number];
type Point = [number, number];
type Ctx = OffscreenCanvasRenderingContext2D;

/** The color the strokes are laid on, where none reach. */
const GROUND = "#d9cfae";

/**
 * The layers of strokes, coarse to fine: each brush's radius, how blurred the
 * view it copies is, how many steps a stroke takes along the shapes, whether
 * it paints only the thing, and how far the painting so far must stray from
 * the view before it paints there.
 */
const LAYERS = [
  { r: 46, blur: 26, steps: 4, thing: false, stray: -1 },
  { r: 26, blur: 13, steps: 5, thing: false, stray: 22 },
  { r: 15, blur: 7, steps: 5, thing: false, stray: 30 },
  { r: 10, blur: 4, steps: 5, thing: true, stray: 14 },
  { r: 6, blur: 2.5, steps: 4, thing: true, stray: 12 },
] as const;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One box blur of `src` along rows (`step` 1) or columns (`step` w), clamped at the edges. */
function boxPass(src: Float32Array, out: Float32Array, w: number, h: number, rad: number, along: "rows" | "columns"): void {
  const [lines, len, step, stride] = along === "rows" ? [h, w, 1, w] : [w, h, w, 1];
  const n = 2 * rad + 1;
  for (let l = 0; l < lines; l++) {
    const base = l * stride;
    const at = (k: number): number => src[base + Math.max(0, Math.min(len - 1, k)) * step] as number;
    let s = 0;
    for (let k = -rad; k <= rad; k++) s += at(k);
    for (let k = 0; k < len; k++) {
      out[base + k * step] = s / n;
      s += at(k + rad + 1) - at(k - rad);
    }
  }
}

/** Three box blurs of radius about `sigma`, close to a Gaussian of that spread, of an RGBA image's color. */
function blurred(src: Uint8ClampedArray, w: number, h: number, sigma: number): Uint8ClampedArray {
  const rad = Math.round(sigma);
  if (rad < 1) return src;
  const out = new Uint8ClampedArray(src.length);
  const a = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < w * h; i++) a[i] = src[i * 4 + c] as number;
    for (let k = 0; k < 3; k++) {
      boxPass(a, b, w, h, rad, "rows");
      boxPass(b, a, w, h, rad, "columns");
    }
    for (let i = 0; i < w * h; i++) out[i * 4 + c] = a[i] as number;
  }
  for (let i = 0; i < w * h; i++) out[i * 4 + 3] = 255;
  return out;
}

/** Smooth noise in -1..1 on a lattice `cell` pixels apart. */
function valueNoise(w: number, h: number, cell: number, r: () => number): (x: number, y: number) => number {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1;
  const sm = (t: number): number => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = Math.max(0, x) / cell;
    const gy = Math.max(0, y) / cell;
    const x0 = Math.min(gw - 2, gx | 0);
    const y0 = Math.min(gh - 2, gy | 0);
    const tx = sm(Math.min(1, gx - x0));
    const ty = sm(Math.min(1, gy - y0));
    const v = (i: number, j: number): number => g[(y0 + j) * gw + x0 + i] as number;
    return (v(0, 0) * (1 - tx) + v(1, 0) * tx) * (1 - ty) + (v(0, 1) * (1 - tx) + v(1, 1) * tx) * ty;
  };
}

const clamp255 = (v: number): number => Math.max(0, Math.min(255, v)) | 0;
const rgb = (c: RGB): string => `rgb(${clamp255(c[0])},${clamp255(c[1])},${clamp255(c[2])})`;

export function paint(job: PaintJob): OffscreenCanvas {
  const { w, h } = job;
  const r = rng(job.seed);
  const canvas = (cw: number, ch: number): [OffscreenCanvas, Ctx] => {
    const c = new OffscreenCanvas(cw, ch);
    return [c, c.getContext("2d", { willReadFrequently: true }) as Ctx];
  };
  const source = (px: Pixels): OffscreenCanvas => {
    const [c, x] = canvas(px.width, px.height);
    x.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
    return c;
  };
  const color = source(job.color);
  const mask = source(job.mask);
  /** An image scaled to `cw` by `ch` and blurred by about `blur` of those pixels. */
  const grab = (im: OffscreenCanvas, blur: number, cw = w, ch = h): Uint8ClampedArray => {
    const [, x] = canvas(cw, ch);
    x.imageSmoothingQuality = "high";
    x.drawImage(im, 0, 0, cw, ch);
    return blurred(x.getImageData(0, 0, cw, ch).data, cw, ch, blur);
  };
  const at = (d: Uint8ClampedArray, x: number, y: number): RGB => {
    const i = (Math.max(0, Math.min(h - 1, y | 0)) * w + Math.max(0, Math.min(w - 1, x | 0))) * 4;
    return [d[i] as number, d[i + 1] as number, d[i + 2] as number];
  };
  const differ = (a: RGB, b: RGB): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  const thingMask = grab(mask, 2);
  const isThing = (x: number, y: number): boolean => at(thingMask, x, y)[0] > 120;

  // The direction field: strokes run along shapes (the structure tensor's minor direction), and where nothing has a
  // direction, they lean in one gentle diagonal with slow drift, as a painter's hand does.
  const q = 4;
  const fw = Math.ceil(w / q);
  const fh = Math.ceil(h / q);
  const small = grab(color, 3, fw, fh);
  const lum = new Float32Array(fw * fh);
  for (let i = 0; i < fw * fh; i++) lum[i] = 0.3 * (small[i * 4] as number) + 0.59 * (small[i * 4 + 1] as number) + 0.11 * (small[i * 4 + 2] as number);
  const tensor = [new Float32Array(fw * fh), new Float32Array(fw * fh), new Float32Array(fw * fh)] as const;
  for (let y = 1; y < fh - 1; y++) {
    for (let x = 1; x < fw - 1; x++) {
      const i = y * fw + x;
      const gx = ((lum[i + 1] as number) - (lum[i - 1] as number)) / 2;
      const gy = ((lum[i + fw] as number) - (lum[i - fw] as number)) / 2;
      tensor[0][i] = gx * gx;
      tensor[1][i] = gx * gy;
      tensor[2][i] = gy * gy;
    }
  }
  const [XX, XY, YY] = tensor.map((t) => {
    const out = new Float32Array(fw * fh);
    const tmp = new Float32Array(fw * fh);
    boxPass(t, tmp, fw, fh, 5, "rows");
    boxPass(tmp, out, fw, fh, 5, "columns");
    return out;
  }) as [Float32Array, Float32Array, Float32Array];
  const drift = valueNoise(w, h, 260, r);
  const dirAt = (x: number, y: number): Point => {
    const i = Math.max(0, Math.min(fh - 1, (y / q) | 0)) * fw + Math.max(0, Math.min(fw - 1, (x / q) | 0));
    const a = XX[i] as number;
    const b = XY[i] as number;
    const c = YY[i] as number;
    const tr = a + c + 1e-3;
    const coh = Math.min(1, Math.sqrt((a - c) ** 2 + 4 * b * b) / tr) * Math.min(1, tr / 40);
    const th = 0.5 * Math.atan2(2 * b, a - c) + Math.PI / 2;
    const d0 = -0.32 + drift(x, y) * 0.5;
    const vx = Math.cos(2 * th) * coh + Math.cos(2 * d0) * (1 - coh);
    const vy = Math.sin(2 * th) * coh + Math.sin(2 * d0) * (1 - coh);
    const t = 0.5 * Math.atan2(vy, vx);
    return [Math.cos(t), Math.sin(t)];
  };

  const [painting, ctx] = canvas(w, h);
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  /** A bristle brush: several thin lines across the stroke's width, each its own shade, converging at both ends. */
  function stroke(pts: Point[], rad: number, col: RGB, alpha: number): void {
    const n = Math.max(4, Math.round(rad / 2.2));
    const last = pts.length - 1;
    const normals = pts.map((_, k): Point => {
      const a = pts[Math.max(0, k - 1)] as Point;
      const b = pts[Math.min(last, k + 1)] as Point;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      return [-dy / l, dx / l];
    });
    const line = (point: (k: number) => Point, from = 0, to = last): void => {
      ctx.beginPath();
      for (let k = from; k <= to; k++) {
        const [x, y] = point(k);
        if (k === from) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    ctx.globalAlpha = alpha * 0.85;
    ctx.strokeStyle = rgb(col);
    ctx.lineWidth = rad * 0.62;
    line((k) => pts[k] as Point);
    for (let b = 0; b < n; b++) {
      const o = (b / (n - 1) - 0.5) * rad * 0.95;
      const jit = (r() - 0.5) * 22;
      const warm = (r() - 0.5) * 10;
      const s0 = r() * 0.25 * last;
      const s1 = last * (1 - r() * 0.2);
      ctx.strokeStyle = rgb([col[0] + jit + warm, col[1] + jit, col[2] + jit - warm]);
      ctx.globalAlpha = alpha * (0.5 + r() * 0.45);
      ctx.lineWidth = Math.max(1, (rad / n) * (1.3 + r() * 0.8));
      const from = Math.floor(s0);
      const to = Math.min(last, Math.ceil(s1));
      line(
        (k) => {
          const t = last > 0 ? k / last : 0.5;
          const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, 0.08 + t * 0.84)));
          const p = pts[k] as Point;
          const nk = normals[k] as Point;
          return [p[0] + nk[0] * o * (0.45 + 0.55 * taper), p[1] + nk[1] * o * (0.45 + 0.55 * taper)];
        },
        from,
        to,
      );
    }
    // Thick paint catches the light along one side.
    ctx.globalAlpha = alpha * 0.16;
    ctx.strokeStyle = "#fff6e4";
    ctx.lineWidth = Math.max(1, rad * 0.12);
    line((k) => {
      const p = pts[k] as Point;
      const nk = normals[k] as Point;
      return [p[0] - nk[0] * rad * 0.28, p[1] - nk[1] * rad * 0.28];
    });
    ctx.globalAlpha = 1;
  }

  const coarse = grab(color, 20);
  for (const layer of LAYERS) {
    const ref = grab(color, layer.blur);
    const cur = ctx.getImageData(0, 0, w, h).data;
    const rad = layer.r;
    const spots: Point[] = [];
    // Each cell of a grid the brush's size paints where the painting so far strays most from the view.
    for (let gy = 0; gy < h; gy += rad * 0.7) {
      for (let gx = 0; gx < w; gx += rad * 0.7) {
        let best: Point = [gx, gy];
        let worst = -1;
        let sum = 0;
        for (let k = 0; k < 5; k++) {
          const x = gx + r() * rad * 0.7;
          const y = gy + r() * rad * 0.7;
          const e = differ(at(ref, x, y), at(cur, x, y));
          sum += e;
          if (e > worst) {
            worst = e;
            best = [x, y];
          }
        }
        if (layer.thing && !isThing(best[0], best[1])) continue;
        if (sum / 5 > layer.stray) spots.push(best);
      }
    }
    for (let i = spots.length - 1; i > 0; i--) {
      const j = (r() * (i + 1)) | 0;
      [spots[i], spots[j]] = [spots[j] as Point, spots[i] as Point];
    }
    for (const [x0, y0] of spots) {
      const seen = at(ref, x0, y0);
      const around = at(coarse, x0, y0);
      // Away from the thing, specks (petals, glints) are damped toward the area's own color.
      const c0: RGB = layer.thing ? seen : [seen[0] * 0.6 + around[0] * 0.4, seen[1] * 0.6 + around[1] * 0.4, seen[2] * 0.6 + around[2] * 0.4];
      // Broken color: a touch warmer or cooler, lighter or deeper; painters push color a little past what they see.
      const m = (c0[0] + c0[1] + c0[2]) / 3;
      const jit = (r() - 0.5) * 16;
      const col = c0.map((v) => Math.max(0, Math.min(255, m + (v - m) * 1.18 + jit))) as RGB;
      const path: Point[] = [[x0, y0]];
      for (const sgn of [1, -1]) {
        let [x, y] = [x0, y0];
        let [px, py] = dirAt(x0, y0);
        px *= sgn;
        py *= sgn;
        for (let k = 0; k < layer.steps; k++) {
          let [dx, dy] = dirAt(x, y);
          if (dx * px + dy * py < 0) [dx, dy] = [-dx, -dy];
          x += dx * rad * 0.55;
          y += dy * rad * 0.55;
          [px, py] = [dx, dy];
          if (differ(at(ref, x, y), c0) > 70) break;
          if (layer.thing && !isThing(x, y)) break;
          if (sgn > 0) path.push([x, y]);
          else path.unshift([x, y]);
        }
      }
      if (path.length < 2) path.push([x0 + rad * 0.4, y0 - rad * 0.15]);
      stroke(path, rad, col, layer.thing ? 0.95 : 0.9);
    }
  }

  // The paper's tooth shows faintly through the paint.
  const g = ctx.getImageData(0, 0, w, h);
  const d = g.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = 1 - r() * 0.05;
    d[i] = (d[i] as number) * n;
    d[i + 1] = (d[i + 1] as number) * n;
    d[i + 2] = (d[i + 2] as number) * n;
  }
  ctx.putImageData(g, 0, 0);
  return painting;
}
