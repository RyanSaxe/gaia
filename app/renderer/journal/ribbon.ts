// The journal's silk ribbon, drawn as a
// band of satin along a soft curve in the book's own pixels. Its width is
// shaded in lanes, darker at the edges and catching the light along one side,
// and the light changes along its length as it drapes; where it twists it
// narrows and shows its duller back; its end is cut in a swallowtail; and it
// casts a soft shadow on what it lies on. The part that hangs free can sway.

type Point = readonly [number, number];

/** Where the ribbon lies, in the book's own pixels: its curve, its width, where it twists, and from where it hangs free. */
export interface RibbonLie {
  readonly points: readonly Point[];
  readonly width: number;
  /** How far along the curve it twists, 0 to 1. */
  readonly twist: number;
  /** How far along the curve it hangs free and sways, 0 to 1; 1 holds it still. */
  readonly free: number;
}

/** The silk's crimson, and how bright each lane across its width is, edge to edge. */
const BASE = [148, 34, 30] as const;
const LANES = [0.58, 0.86, 1.22, 1.04, 0.9, 0.64] as const;

/** The gutter's shadow, as the page's own (journal.css, .jb-right .jp::after): darkest in the fold, over the page's height. */
const GUTTER = `<linearGradient id="jb-silk-gutter" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="62" y2="0"><stop offset="0" stop-color="rgb(52,32,12)" stop-opacity="0.58"/><stop offset="0.1" stop-color="rgb(52,32,12)" stop-opacity="0.34"/><stop offset="0.33" stop-color="rgb(52,32,12)" stop-opacity="0.16"/><stop offset="0.66" stop-color="rgb(52,32,12)" stop-opacity="0.05"/><stop offset="1" stop-color="rgb(52,32,12)" stop-opacity="0"/></linearGradient><rect x="-4" y="-330" width="70" height="660" fill="url(#jb-silk-gutter)"/>`;

/** A smooth curve through the points (Catmull-Rom), `n` samples. */
function curve(points: readonly Point[], n: number): Point[] {
  const at = (k: number): Point => points[Math.max(0, Math.min(points.length - 1, k))] as Point;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (points.length - 1);
    const k = Math.min(points.length - 2, Math.floor(t));
    const u = t - k;
    const [p0, p1, p2, p3] = [at(k - 1), at(k), at(k + 1), at(k + 2)];
    const c = (a: number, b: number, c2: number, d: number): number =>
      0.5 * (2 * b + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u * u + (-a + 3 * b - 3 * c2 + d) * u * u * u);
    out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
  }
  return out;
}

const shadeOf = (silk: readonly number[], k: number, white = 0): string => {
  const ch = silk.map((v) => Math.round(Math.min(255, v * k + (255 - v * k) * white)));
  return `rgb(${ch.join(",")})`;
};

/** The ribbon as an SVG in the book's own pixels, and where its box lies. */
export function ribbonSvg(lie: RibbonLie, silk: readonly number[] = BASE): { readonly left: number; readonly top: number; readonly width: number; readonly height: number; readonly svg: string } {
  const N = 90;
  const c = curve(lie.points, N);
  const normals = c.map((_, i) => {
    const a = c[Math.max(0, i - 1)] as Point;
    const b = c[Math.min(N - 1, i + 1)] as Point;
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l] as Point;
  });
  // Where it twists it narrows, and its back, duller, shows.
  const turn = (t: number): number => Math.exp(-(((t - lie.twist) / 0.045) ** 2));
  const half = (t: number): number => (lie.width / 2) * (1 - 0.72 * turn(t));
  // The light along its length, as the silk drapes: broad swells, brightest where it falls toward you.
  const light = (t: number): number => (0.9 + 0.16 * Math.sin(t * 9.5 + 0.6) + 0.07 * Math.sin(t * 23 + 1.3)) * (1 - 0.32 * turn(t));
  // The swallowtail: the last stretch's middle is cut back by most of the width.
  const notch = lie.width * 0.75;
  const len = c.reduce((s, p, i) => (i === 0 ? 0 : s + Math.hypot(p[0] - (c[i - 1] as Point)[0], p[1] - (c[i - 1] as Point)[1])), 0);
  const cutFrom = 1 - notch / len;
  const lanes = LANES.length;
  const side = (i: number, u: number): Point => {
    const t = i / (N - 1);
    const p = c[i] as Point;
    const nn = normals[i] as Point;
    const h = half(t);
    // Past where the cut begins, each lane ends as far short of the tip as the V reaches across it.
    return [p[0] + nn[0] * u * h, p[1] + nn[1] * u * h];
  };
  const quads: { readonly path: string; readonly fill: string; readonly free: boolean }[] = [];
  for (let i = 0; i < N - 1; i++) {
    const t = i / (N - 1);
    for (let l = 0; l < lanes; l++) {
      const u0 = -1 + (2 * l) / lanes;
      const u1 = -1 + (2 * (l + 1)) / lanes;
      const a = side(i, u0);
      const b = side(i, u1);
      const d = side(i + 1, u1);
      const e = side(i + 1, u0);
      const k = (LANES[l] as number) * light(t);
      // The lane that catches the light shines toward white where the drape faces you.
      const white = l === 2 ? Math.max(0, light(t) - 0.98) * 1.6 : 0;
      quads.push({ path: `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}L${d[0].toFixed(1)} ${d[1].toFixed(1)}L${e[0].toFixed(1)} ${e[1].toFixed(1)}Z`, fill: shadeOf(silk, k, white), free: t >= lie.free });
    }
  }
  const xs = c.map((p) => p[0]);
  const ys = c.map((p) => p[1]);
  const pad = lie.width + 8;
  const left = Math.floor(Math.min(...xs) - pad);
  const top = Math.floor(Math.min(...ys) - pad);
  const width = Math.ceil(Math.max(...xs) + pad) - left;
  const height = Math.ceil(Math.max(...ys) + pad) - top;
  const hang = c[Math.round(lie.free * (N - 1))] as Point;
  // The swallowtail: its outline, down one edge, in to the cut's point, and back up the other.
  const cut = c[Math.round(cutFrom * (N - 1))] as Point;
  const outline = [...c.map((_, i) => side(i, -1)), cut, ...c.map((_, i) => side(N - 1 - i, 1))];
  const clip = `<clipPath id="jb-silk-cut" clipPathUnits="userSpaceOnUse"><path d="M${outline.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L")}Z"/></clipPath>`;
  const draw = (free: boolean): string => quads.filter((q) => q.free === free).map((q) => `<path d="${q.path}" fill="${q.fill}" stroke="${q.fill}" stroke-width="0.5"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}" style="overflow:visible">
<defs>${clip}<filter id="jb-silk-shadow" x="-40%" y="-10%" width="180%" height="120%"><feDropShadow dx="1.4" dy="2.2" stdDeviation="1.8" flood-color="#1c0b04" flood-opacity="0.38"/></filter></defs>
<g filter="url(#jb-silk-shadow)"><g clip-path="url(#jb-silk-cut)">${draw(false)}${GUTTER}</g><g class="jb-ribbon-free" style="transform-box: view-box; transform-origin: ${hang[0].toFixed(1)}px ${hang[1].toFixed(1)}px"><g clip-path="url(#jb-silk-cut)">${draw(true)}</g></g></g></svg>`;
  return { left, top, width, height, svg };
}

/**
 * Where the ribbon lies on the page it marks, in the book's own pixels: fixed at the spine's head, down the gutter in
 * the fold's shadow, well clear of the writing, and out of the foot to lie along the book's lower edge. It is the one
 * lie: elsewhere in the book it is turned about the spine (`RIBBON_POSES`), and only its head and tail show.
 */
export const RIBBON_LIE: RibbonLie = { points: [[7, -346], [7.5, -200], [8.5, 0], [8, 200], [9, 320], [12, 346], [28, 362], [56, 368], [84, 366]], width: 14, twist: 0.9, free: 0.85 };

/**
 * How the ribbon is laid in the book, as CSS sets it about the spine: raised `z` of the book's pixels, turned `deg`
 * about the spine, and then `off` from the leaf it lies on, along that leaf.
 */
export interface RibbonPose {
  readonly z: number;
  readonly deg: number;
  readonly off: number;
}

/**
 * Where the ribbon rests, by where its page is from the open spread: on it, above the paper and under a leaf that
 * turns; among the right-hand leaves, under the open page and over the leaves' edges; and among the left-hand leaves,
 * on the cover that carries them, shut under the cover and open over the left-hand page, which hides all but its
 * head and tail; when the cover's edge lifts under the pointer, lifted with it (`.jb-cover.open.lift`).
 */
export const RIBBON_POSES = {
  here: { z: 1, deg: 0, off: 0 },
  after: { z: -1, deg: 0, off: 0 },
  "before-shut": { z: 3, deg: 0, off: -0.6 },
  "before-open": { z: 0.4, deg: -179.6, off: -0.6 },
  "before-lifted": { z: 0.4, deg: -176, off: -0.6 },
} as const satisfies Record<string, RibbonPose>;

/** A pose as a CSS transform, about the spine. */
export const ribbonTransform = (p: RibbonPose): string => `translateZ(${p.z}px) rotateY(${p.deg.toFixed(2)}deg) translateZ(${p.off}px)`;
