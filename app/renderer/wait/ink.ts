// The field map's paper and washes, as the wait paints them. This is the one
// place the wait reads the map's look: a handmade sheet, mottled and
// fibred, and each area's watercolor hue (every area under one top-level
// directory shares it, a little lighter or darker), pooling at its rim. It
// matches `app/renderer/immersive/field-map.ts`; when the map's look
// changes, change `WAIT_INK` with it so the wait and the map stay one paper.

/** What the wait paints with. */
export interface WaitInk {
  /** The paper's ground tone. */
  readonly paperTone: string;
  /** Mottling and fibres over `w` by `h` pixels of paper, as handmade paper has. */
  paper(g: CanvasRenderingContext2D, w: number, h: number): void;
  /** An area's wash, red, green and blue: `tops` are the top-level directories in order. */
  wash(path: string, depth: number, tops: readonly string[]): readonly [number, number, number];
  /** Pigment pooling at a wash's rim, as it dries: stroke widths in pixels at the map's full size, and opacities. */
  readonly pool: readonly (readonly [number, number])[];
  /** The opacity a dry wash floats at over the paper. */
  readonly dry: number;
  /** Eases a traced ring's lattice steps into a pen's line: x, z pairs. */
  ease(ring: readonly number[]): number[];
  /** The ink of borders and the land's edge. */
  readonly ink: string;
  /** Pigment settling into the paper's tooth: a canvas of soft specks to draw large over a wash. */
  grain(cells: number, seed: number): HTMLCanvasElement;
}

const hash = (x: number, z: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const mixRgb = (a: string, b: string, t: number): [number, number, number] => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number): number => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return [ch(16), ch(8), ch(0)];
};
function noise(cells: number, seed: number, rgb: readonly [number, number, number]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = cells;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const img = g.createImageData(cells, cells);
  for (let k = 0; k < cells * cells; k++) img.data.set([rgb[0], rgb[1], rgb[2], Math.round(255 * hash(k + seed, seed))], k * 4);
  g.putImageData(img, 0, 0);
  return c;
}

const COMMON_GROUND = "#cfd3a4";
const WASHES = ["#9fbf83", "#dcb56f", "#d09684", "#8eb0c9", "#b39fcb", "#86b8a1", "#d79e68", "#a9bd93", "#cdb48a", "#9cadd6"];
const EASE = { reach: 5, passes: 2 };

export const WAIT_INK: WaitInk = {
  paperTone: "#efe4c8",
  paper(g, w, h) {
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    for (const [cells, strength] of [[14, 0.09], [56, 0.05]] as const) {
      g.globalAlpha = strength;
      g.drawImage(noise(cells, cells * 7.3, [96, 72, 40]), 0, 0, w, h);
    }
    g.globalAlpha = 1;
    g.lineCap = "round";
    const fibres = (w * h) / 2048 ** 2;
    for (const [tone, count, seed] of [["rgba(118,92,56,0.075)", 1800, 11], ["rgba(255,251,238,0.16)", 1100, 23]] as const) {
      g.strokeStyle = tone;
      g.lineWidth = 1;
      g.beginPath();
      for (let k = 0; k < count * fibres; k++) {
        const x = hash(k, seed) * w;
        const y = hash(seed, k) * h;
        const a = hash(k + seed, 3) * Math.PI * 2;
        const len = 4 + hash(k, seed + 1) * 10;
        const bend = (hash(k, seed + 2) - 0.5) * 6;
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend, x + Math.cos(a) * len, y + Math.sin(a) * len);
      }
      g.stroke();
    }
  },
  wash(path, depth, tops) {
    if (depth === 0) return mixRgb(COMMON_GROUND, "#fbf5e6", 0.15);
    const base = WASHES[tops.indexOf(path.split("/")[0] ?? "") % WASHES.length] as string;
    const tone = (hash(path.length * 13.1, path.charCodeAt(path.length - 1) || 0) - 0.5) * 0.56;
    return tone > 0 ? mixRgb(base, "#fbf5e6", tone) : mixRgb(base, "#5b5040", -tone * 0.5);
  },
  pool: [[26, 0.05], [15, 0.06], [8, 0.08], [3.5, 0.1]],
  dry: 0.62,
  ease(ring) {
    const count = ring.length / 2;
    if (count < EASE.reach * 2 + 3) return [...ring];
    let pts = Float64Array.from(ring);
    for (let pass = 0; pass < EASE.passes; pass++) {
      const out = new Float64Array(pts.length);
      for (let k = 0; k < count; k++) {
        let x = 0;
        let z = 0;
        for (let d = -EASE.reach; d <= EASE.reach; d++) {
          const i = (k + d + count) % count;
          x += pts[i * 2] as number;
          z += pts[i * 2 + 1] as number;
        }
        out[k * 2] = x / (EASE.reach * 2 + 1);
        out[k * 2 + 1] = z / (EASE.reach * 2 + 1);
      }
      pts = out;
    }
    return Array.from(pts);
  },
  ink: "rgba(74,60,44,0.62)",
  grain: (cells, seed) => noise(cells, seed, [60, 46, 26]),
};
