// The field sheet's style for the field map, minimap, journal maps and loading
// screen (docs/design-system.md, "The field sheet"). On the map, color shows
// vitality and nothing else: every area starts from one green (`landWash`),
// and each file's vitality spreads over the ground around it (`healthField`)
// in the colors of `healthColor`. Callers pass shown vitality (`shownVitality`
// in @gaia/realize), so the map matches what the world shows.

import { rand, seedOf } from "@gaia/schema";

export interface MapStyle {
  /** The paper color, and the RGB of its mottling. */
  readonly paper: string;
  readonly mottle: readonly [number, number, number];
  /** The color of the wild past the land's edge. */
  readonly wild: string;
  /** How far `land` is mixed toward the paper color, 0 to 1. */
  readonly landLift: number;
  /** The largest shift of an area's wash lighter or darker and warmer or cooler, seeded by its path, so neighboring areas differ. */
  readonly toneStep: number;
  /** Ink for lettering and drawn marks. */
  readonly ink: string;
  /** The washes' opacity, and the opacity and blur in paper pixels of a blurred copy under them that bleeds neighbors together. */
  readonly washAlpha: number;
  readonly bleed: number;
  readonly bleedPx: number;
  /** Strokes inside each wash's rim, as [width in paper pixels, opacity] pairs, that darken the rim like pooled pigment. */
  readonly pool: readonly (readonly [number, number])[];
  /** The number of broad brush strokes over the washes, each a little warmer, cooler, lighter or darker. */
  readonly strokes: number;
  /** The paint's fade to bare paper, as fractions of the sheet from its edge: no paint at `fade[0]` and full paint at `fade[1]`. `ragged` is how uneven that edge is. */
  readonly fade: readonly [number, number];
  readonly ragged: number;
  /** Shadow and light tints for the hills, and their strengths. */
  readonly shadow: string;
  readonly shadowAlpha: number;
  /** How strongly a slope's aspect shades or lights it, and the shading's blur in paper pixels. */
  readonly relief: number;
  readonly reliefBlur: number;
  /** The cap on a slope's shading or light as a share of the full tint, so a steep valley side shades no darker than a hillside. */
  readonly reliefMost: number;
  readonly light: string;
  readonly lightAlpha: number;
  /** The ink of the dotted trails. */
  readonly trail: string;
  /**
   * Sepia contour lines from the real heights: one every `interval` meters, with every `index`th one heavier. Widths
   * are in paper pixels. On ground steeper than the grade `thin`, only the heavier lines are drawn, as survey maps thin
   * lines that would crowd.
   */
  readonly contour: { readonly interval: number; readonly index: number; readonly ink: string; readonly width: number; readonly alpha: number; readonly indexWidth: number; readonly indexAlpha: number; readonly thin: number };
  /** How a wash follows vitality. Above the top `health` stop, `rich` saturates and deepens it. As `dryness` rises, `streaks` dry-brush streaks show the paper through. */
  readonly wilt: { readonly rich: number; readonly streaks: number };
  /** The green every area's wash starts from. On the map, color shows vitality and nothing else. */
  readonly land: readonly [number, number, number];
  /**
   * The vitality ramp as [shown vitality, color, mix] stops. At each stop the land mixes toward the color by that
   * share. Land is green at 0.85 and above, gold around 0.55, russet around 0.25 and ash brown at 0.
   */
  readonly health: readonly (readonly [number, readonly [number, number, number], number])[];
  /** How far in meters a file's vitality spreads over the ground around it, across area borders too. */
  readonly spread: number;
}

export const MAP_STYLE: MapStyle = {
  paper: "#efe5cb",
  mottle: [96, 72, 40],
  wild: "#5f8a4c",
  landLift: 0.1,
  toneStep: 0.42,
  ink: "#3a2f22",
  washAlpha: 0.84,
  bleed: 0.5,
  bleedPx: 7,
  pool: [[22, 0.05], [10, 0.07], [4, 0.09]],
  strokes: 2600,
  fade: [0.002, 0.012],
  ragged: 0.006,
  shadow: "#6e6aa0",
  shadowAlpha: 0.62,
  relief: 4.5,
  reliefBlur: 7,
  reliefMost: 0.55,
  light: "#fff0c4",
  lightAlpha: 0.42,
  trail: "rgba(122,80,42,0.92)",
  contour: { interval: 1.2, index: 5, ink: "#5a4128", width: 1.8, alpha: 0.3, indexWidth: 3, indexAlpha: 0.46, thin: 0.22 },
  wilt: { rich: 0.3, streaks: 46 },
  land: [104, 160, 66],
  health: [
    [0.85, [214, 178, 72], 0],
    [0.7, [214, 178, 72], 0.25],
    [0.55, [214, 178, 72], 0.55],
    [0.4, [206, 138, 56], 0.72],
    [0.25, [168, 92, 50], 0.82],
    [0.1, [126, 104, 84], 0.86],
    [0, [140, 128, 112], 0.9],
  ],
  spread: 24,
};

/** An area's dryness from 0 to 1 by its shown vitality: 0 above 0.82, rising smoothly to 1 at 0.3. */
export const dryness = (vitality: number): number => {
  const t = Math.max(0, Math.min(1, (0.82 - vitality) / 0.52));
  return t * t * (3 - 2 * t);
};

const channels = (h: string): [number, number, number] => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const mix3 = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [0, 1, 2].map((i) => (a[i] as number) * (1 - t) + (b[i] as number) * t) as [number, number, number];
const LIGHTER = channels("#fbf5e6");
const DARKER = channels("#5b5040");
const WARMER = channels("#e2bd62");
const COOLER = channels("#5f9aa6");

/**
 * Returns `rgb` colored by shown vitality on the `style.health` ramp. Above the top stop it is a little more
 * saturated and deeper, and below it turns gold, russet and ash. The result is continuous in vitality, so a vitality
 * field has no visible steps.
 */
export function healthColor(style: MapStyle, rgb: readonly [number, number, number], vitality: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, vitality));
  const stops = style.health;
  const top = stops[0] as (typeof stops)[number];
  if (v >= top[0]) {
    // Above the top stop, saturates and darkens the color by up to `style.wilt.rich`.
    const grey = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
    const rich = Math.min(1, (v - top[0]) / (1 - top[0])) * style.wilt.rich;
    return rgb.map((c) => Math.round(Math.max(0, Math.min(255, (grey + (c - grey) * (1 + rich)) * (1 - rich * 0.25))))) as [number, number, number];
  }
  let k = 1;
  while (k < stops.length - 1 && v < (stops[k] as (typeof stops)[number])[0]) k++;
  const [v0, c0, m0] = stops[k - 1] as (typeof stops)[number];
  const [v1, c1, m1] = stops[k] as (typeof stops)[number];
  const u = Math.max(0, Math.min(1, (v0 - v) / (v0 - v1)));
  const m = m0 + (m1 - m0) * u;
  return [0, 1, 2].map((i) => Math.round((rgb[i] as number) * (1 - m) + ((c0[i] as number) + ((c1[i] as number) - (c0[i] as number)) * u) * m)) as [number, number, number];
}

/** Shifts a color lighter or darker and warmer or cooler, seeded by `path`, so neighboring areas differ in tone. */
function toned(style: MapStyle, rgb: readonly [number, number, number], path: string): [number, number, number] {
  const r = rand(seedOf(`wash:${path}`));
  const light = r.range(-1, 1) * style.toneStep;
  const warmth = r.range(-1, 1) * style.toneStep * 0.38;
  const lit = light > 0 ? mix3(rgb, LIGHTER, light * 0.5) : mix3(rgb, DARKER, -light * 0.3);
  return warmth > 0 ? mix3(lit, WARMER, warmth) : mix3(lit, COOLER, -warmth);
}

/** An area's wash before vitality: `style.land` lifted toward the paper and toned by its path. */
export const landWash = (style: MapStyle, path: string): [number, number, number] =>
  toned(style, mix3(style.land, channels(style.paper), style.landLift), path).map(Math.round) as [number, number, number];

/** A file's vitality at its place on the land, with its position, its ground's radius (`reach`) and its code size. */
export interface FileHealth {
  readonly x: number;
  readonly z: number;
  readonly reach: number;
  readonly size: number;
  readonly vitality: number;
}

/** A file's weight at (x, z): its size times a Gaussian falloff of width `spread` meters past its own ground, and 0 beyond 4 * `spread`. */
export function healthWeight(f: Omit<FileHealth, "vitality">, x: number, z: number, spread: number): number {
  const d = Math.max(0, Math.hypot(f.x - x, f.z - z) - f.reach);
  return d > spread * 4 ? 0 : f.size * Math.exp((-d * d) / (2 * spread * spread));
}

/** The weight of a point's area vitality against its files' weights: a hundredth of the mean file size. */
export const healthPrior = (files: readonly { readonly size: number }[]): number => (files.reduce((a, f) => a + f.size, 0) / Math.max(1, files.length)) * 0.01;

/**
 * Returns vitality over the land from each file's own vitality. At a point, it averages the nearby files weighted by
 * `healthWeight`, across area borders too. Far from every file it approaches `fallback`, the vitality of the point's
 * area, with no step.
 */
export function healthField(files: readonly FileHealth[], spread: number): (x: number, z: number, fallback: number) => number {
  const far = spread * 4;
  const prior = healthPrior(files);
  // Buckets files on a grid whose cells are wide enough that every file with weight at a point lies in the point's
  // cell or the eight around it. A lookup then reads only nearby files.
  const size = far + files.reduce((m, f) => Math.max(m, f.reach), 0);
  const cell = (v: number): number => Math.floor(v / size);
  const buckets = new Map<number, FileHealth[]>();
  const keyOf = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);
  for (const f of files) {
    const key = keyOf(cell(f.x), cell(f.z));
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [f]);
    else bucket.push(f);
  }
  return (x, z, fallback) => {
    let weight = prior;
    let sum = prior * fallback;
    const ci = cell(x);
    const cj = cell(z);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const bucket = buckets.get(keyOf(i, j));
        if (bucket === undefined) continue;
        for (const f of bucket) {
          const w = healthWeight(f, x, z, spread);
          weight += w;
          sum += w * f.vitality;
        }
      }
    }
    return sum / weight;
  };
}

const hash = (x: number, z: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * The sheet's torn edge as a CSS mask: a ragged polygon 3 to 11 thousandths of
 * the sheet in from each side, with occasional deeper tears. It stretches to
 * the sheet, so it fits any aspect ratio.
 */
export const DECKLE_MASK = ((): string => {
  const points: string[] = [];
  const side = (k: number, t: number): [number, number] => {
    const inset = 3 + hash(k, 5) * 4 + (hash(k, 9) > 0.93 ? 4 : 0);
    const along = t * 1000;
    return k < 1000 ? [along, inset] : k < 2000 ? [1000 - inset, along] : k < 3000 ? [1000 - along, 1000 - inset] : [inset, 1000 - along];
  };
  for (let k = 0; k < 4000; k += 6) {
    const [x, y] = side(k, (k % 1000) / 1000);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none"><polygon points="${points.join(" ")}" fill="#000"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
})();

/**
 * The person's marker, drawn like the person in the world: a traveller in a
 * vermilion cloak and straw hat with a lantern that glows after dark
 * (`.traveller-glow`), a soft shadow, and their last few footprints behind
 * them. The figure stays upright at any heading, and only the footprints turn.
 */
export const TRAVELLER_SVG = /* html */ `
<svg class="field-map-traveller" viewBox="-30 -30 60 60" aria-hidden="true">
  <circle class="traveller-glow" cx="5" cy="-4" r="13"/>
  <g class="traveller-steps">
    <ellipse cx="-2.2" cy="9" rx="1.5" ry="2.3" opacity=".62"/>
    <ellipse cx="2.4" cy="15" rx="1.5" ry="2.3" opacity=".46"/>
    <ellipse cx="-2.2" cy="21" rx="1.5" ry="2.3" opacity=".32"/>
    <ellipse cx="2.4" cy="27" rx="1.5" ry="2.3" opacity=".2"/>
  </g>
  <ellipse cx="1.2" cy="3.4" rx="6.4" ry="2.2" fill="rgba(58,44,28,.3)"/>
  <path d="M-2.2 3.2V-1M2 3.2V-1" stroke="#3b2c1c" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M-4.6 0.6 -3 -8.4H3L4.6 0.6Q0 2 -4.6 0.6Z" fill="#b8452c" stroke="#5a2414" stroke-width=".9" stroke-linejoin="round"/>
  <circle cx="0" cy="-10.6" r="2.7" fill="#f1d6b2" stroke="#5a2414" stroke-width=".8"/>
  <ellipse cx="0" cy="-12.2" rx="5.2" ry="1.5" fill="#d5ac5c" stroke="#5a3a1a" stroke-width=".7"/>
  <path d="M-2.4 -12.6Q0 -16.4 2.4 -12.6Z" fill="#d5ac5c" stroke="#5a3a1a" stroke-width=".7"/>
  <path d="M4 -4.2 5 -1.6" stroke="#3b2c1c" stroke-width=".8"/>
  <rect x="3.7" y="-1.8" width="2.6" height="3.2" rx=".8" fill="#f2c45a" stroke="#5a3a1a" stroke-width=".6"/>
</svg>`;
