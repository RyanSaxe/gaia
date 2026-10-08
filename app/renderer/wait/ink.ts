// The field map's sheet, as the wait paints it: the direction the map shows
// (`CHOSEN_MAP`), so the waiting sheet and the field map are one sheet. Its
// paper, torn edge and the wild's wood past the land are the map's own
// (`paintPaperGround`, `DECKLE_MASK`, `woodsOf`); each area's wash is the
// color of the land Jev judged for it (`groundWash`), from the palette the
// ground shader paints that land's cover with; its borders are drawn in the
// map's hand. The wait has no names, title or marks.

import { type GroundSpec, Library } from "@gaia/schema";
import { BIOME_PRIMITIVES } from "@gaia/primitives";
import { biome } from "@gaia/kinds";
import { buildSlots } from "@gaia/realize";
import { MARGIN, drawWoods, paintFade, paintPaperGround, woodsOf } from "../immersive/field-map.ts";
import { CHOSEN_MAP, DECKLE_MASK, MAP_STYLES, type MapStyle, groundWash } from "../immersive/map-styles.ts";
import { LANDS } from "../terrain/looks.ts";

/** What the wait paints with. */
export interface WaitInk {
  readonly style: MapStyle;
  /** The sheet's torn edge, as a CSS mask image. */
  readonly deckle: string;
  /** How far past the land's widest reach the sheet runs, meters: as far as the field map's. */
  readonly margin: number;
  /** The sheet's paper over `w` by `h` pixels. */
  paper(g: CanvasRenderingContext2D, w: number, h: number): void;
  /** The wild past the land of `size` meters, on a square canvas `reach` meters from its middle to its edge: its wash and its wood. */
  wild(g: CanvasRenderingContext2D, size: number, reach: number): void;
  /** An area's wash, red, green and blue, in the color of the land judged for it; null for a land the wait does not know. */
  wash(path: string, land: string): readonly [number, number, number] | null;
  /** Pigment pooling at a wash's rim, as it dries: stroke widths in pixels at the map's full size, and opacities. */
  readonly pool: readonly (readonly [number, number])[];
  /** The opacity a wash comes in at, wet, and dries to, as the map floats its washes. */
  readonly wet: number;
  readonly dry: number;
  /** Broad brush strokes over the washes, a little warmer, cooler, lighter or darker: how many over the whole sheet. */
  readonly strokes: number;
  /** Eases a traced ring's lattice steps into a pen's line: x, z pairs. */
  ease(ring: readonly number[]): number[];
  /** The borders' hand: the line and, for a hedgerow, the soft band of leaves under it, with their widths in CSS pixels. */
  readonly border: { readonly line: string; readonly width: number; readonly under: string | null; readonly underWidth: number };
  /** Pigment settling into the paper's tooth: a canvas of soft specks to draw large over a wash. */
  grain(cells: number, seed: number): HTMLCanvasElement;
}

const hash = (x: number, z: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
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

const EASE = { reach: 5, passes: 2 };
/** The fade at the sheet's edge, cells on a side: coarser than the map's, as the wait's sheet is smaller. */
const FADE_CELLS = 192;

const STYLE = MAP_STYLES[CHOSEN_MAP];

/** Each land's ground cover, built once from its blueprint, as the terrain builds a region's. */
const library = new Library([...BIOME_PRIMITIVES]);
const grounds = new Map<string, GroundSpec | null>();
function groundOfLand(land: string): GroundSpec | null {
  let ground = grounds.get(land);
  if (ground === undefined) {
    const blueprint = LANDS[land]?.biome;
    const cover = blueprint?.slots.cover;
    ground = blueprint === undefined || cover === undefined ? null : ((buildSlots({ ...blueprint, slots: { cover } }, biome, library, { seed: 0, facts: {} }).get("cover")?.output as GroundSpec | undefined) ?? null);
    grounds.set(land, ground);
  }
  return ground;
}

const BORDERS: Readonly<Record<MapStyle["border"], WaitInk["border"]>> = {
  hedge: { line: "rgba(46,70,36,0.36)", width: 0.85, under: "rgba(52,80,40,0.13)", underWidth: 2.8 },
  pencil: { line: "rgba(72,66,60,0.42)", width: 0.9, under: null, underWidth: 0 },
  ink: { line: "rgba(59,44,28,0.66)", width: 1.1, under: null, underWidth: 0 },
};

export const WAIT_INK: WaitInk = {
  style: STYLE,
  deckle: DECKLE_MASK,
  margin: MARGIN,
  paper: (g, w, h) => paintPaperGround(g, STYLE, w, h),
  wild(g, size, reach) {
    const w = g.canvas.width;
    const scale = w / (reach * 2);
    const half = size / 2;
    // Its wash: everywhere past the land's edge, giving way raggedly to bare paper at the sheet's edge, as the map's.
    const wash = document.createElement("canvas");
    wash.width = wash.height = w;
    const c = wash.getContext("2d") as CanvasRenderingContext2D;
    c.fillStyle = STYLE.wild;
    c.fillRect(0, 0, w, w);
    c.globalCompositeOperation = "destination-out";
    c.beginPath();
    for (let k = 0; k <= 240; k++) {
      const a = (k / 240) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const r = half / Math.pow(Math.abs(cos) ** 4 + Math.abs(sin) ** 4, 0.25);
      c.lineTo((cos * r + reach) * scale, (sin * r + reach) * scale);
    }
    c.fill();
    const fade = document.createElement("canvas");
    fade.width = fade.height = FADE_CELLS;
    const f = fade.getContext("2d") as CanvasRenderingContext2D;
    const img = f.createImageData(FADE_CELLS, FADE_CELLS);
    paintFade(img, STYLE, 0, FADE_CELLS);
    f.putImageData(img, 0, 0);
    c.globalCompositeOperation = "destination-in";
    c.imageSmoothingEnabled = true;
    c.drawImage(fade, 0, 0, w, w);
    // Laid as the map lays its washes: a softened copy under it, so it bleeds into the land's.
    g.filter = `blur(${Math.max(1, (STYLE.bleedPx * w) / 2048).toFixed(1)}px)`;
    g.globalAlpha = STYLE.bleed;
    g.drawImage(wash, 0, 0);
    g.filter = "none";
    g.globalAlpha = STYLE.washAlpha;
    g.drawImage(wash, 0, 0);
    g.globalAlpha = 1;
    drawWoods(g, STYLE, woodsOf(STYLE, half, reach, scale));
  },
  wash(path, land) {
    const ground = groundOfLand(land);
    return ground === null ? null : groundWash(STYLE, ground, path);
  },
  pool: STYLE.pool,
  wet: Math.min(1, STYLE.washAlpha + 0.12),
  dry: STYLE.washAlpha,
  // Half the map's: with no hills shaded over them, the wait's washes show their brushwork more.
  strokes: STYLE.strokes * 0.5,
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
  border: BORDERS[STYLE.border],
  grain: (cells, seed) => noise(cells, seed, [60, 46, 26]),
};
