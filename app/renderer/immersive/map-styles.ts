// The field sheet's look, one for the field map, the minimap, a thing's
// sketch page and the wait (docs/design-system.md, "The field sheet"): a
// painted topographic map. On the map, color is health and nothing else:
// every area starts from one healthy green (`landWash`), and each file's
// vitality spreads over the ground around it (`healthField`) in health's
// colors (`healthColor`), from green through gold and russet to ash. Hills
// are shaded in violet and lit warm under fine sepia contours. It is plain
// data that `field-map.ts` and the wait (`wait/map-wait.ts`) paint from.

import { rand, seedOf } from "@gaia/schema";

export interface MapStyle {
  /** The paper's tone, and the pigment its mottling is in. */
  readonly paper: string;
  readonly mottle: readonly [number, number, number];
  /** The wild past the land. */
  readonly wild: string;
  /** How far the healthy land's wash is lifted toward the paper. */
  readonly landLift: number;
  /** How far each area's wash steps lighter or darker, warmer or cooler, by its path, so neighbors on one land keep apart. */
  readonly toneStep: number;
  /** Ink for lettering and drawn marks. */
  readonly ink: string;
  /** The washes' own opacity, and a blurred copy laid under them so neighbors bleed into each other (opacity, blur in paper pixels). */
  readonly washAlpha: number;
  readonly bleed: number;
  readonly bleedPx: number;
  /** Pigment pooling at each wash's rim: stroke widths in paper pixels and opacities, kept inside the outline. */
  readonly pool: readonly (readonly [number, number])[];
  /** Broad brush strokes laid over the washes, each a little warmer, cooler, lighter or darker: how many. */
  readonly strokes: number;
  /** Where the paint gives way to bare paper, as a fraction of the sheet from its edge: fully gone at the first, full at the second; and how ragged that edge is. */
  readonly fade: readonly [number, number];
  readonly ragged: number;
  /** Shadow and light tints for the hills, and their strengths. */
  readonly shadow: string;
  readonly shadowAlpha: number;
  /** How strongly a slope's facing shades or lights it, and how softly the shading is laid, paper pixels. */
  readonly relief: number;
  readonly reliefBlur: number;
  readonly light: string;
  readonly lightAlpha: number;
  /** The dotted ways' ink. */
  readonly trail: string;
  /**
   * Contour lines from the real heights, in sepia ink over the paint: one every `interval` meters and every
   * `index`th one heavier, their widths in paper pixels and opacities.
   */
  readonly contour: { readonly interval: number; readonly index: number; readonly ink: string; readonly width: number; readonly alpha: number; readonly indexWidth: number; readonly indexAlpha: number };
  /** How a wash answers its area's health: thriving land a touch richer and deeper, tired land showing the paper through in dry-brush streaks. */
  readonly wilt: { readonly rich: number; readonly streaks: number };
  /** The healthy land every area's wash starts from: on the map, color means health and nothing else. */
  readonly land: readonly [number, number, number];
  /**
   * How health colors the land as it falls, from healthy down to ruin: at each vitality, the color the land turns
   * toward and how far. Healthy land is green, tired land turns gold, then russet, and ruined land ash brown.
   */
  readonly health: readonly (readonly [number, readonly [number, number, number], number])[];
  /** How far a file's health spreads over the ground around it, meters, across area borders too. */
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
  light: "#fff0c4",
  lightAlpha: 0.42,
  trail: "rgba(122,80,42,0.92)",
  contour: { interval: 1.2, index: 5, ink: "#5a4128", width: 1.8, alpha: 0.3, indexWidth: 3, indexAlpha: 0.46 },
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

/** How dry an area's land is, 0 thriving to 1 failing: nothing above 0.82, wholly dry at 0.3. */
export const dryness = (vitality: number): number => {
  const t = Math.max(0, Math.min(1, (0.82 - vitality) / 0.52));
  return t * t * (3 - 2 * t);
};

/**
 * One scale of health for the land in words, the map's legend and the
 * minimap's: the same thresholds as a thing's (`standing` in
 * `terrain/card.ts`).
 */
export const LAND_HEALTH: readonly { readonly from: number; readonly words: string }[] = [
  { from: 0.85, words: "in full leaf" },
  { from: 0.65, words: "in good heart" },
  { from: 0.4, words: "going over" },
  { from: 0.15, words: "gone to seed" },
  { from: -1, words: "laid waste" },
];
export const landHealth = (vitality: number): string => LAND_HEALTH.find((h) => vitality >= h.from)?.words ?? "laid waste";

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
 * A color as health leaves it, on `style.health`'s ramp: thriving land a touch richer and deeper, then gold,
 * russet and ash as vitality falls. Continuous in vitality, so a field of health has no steps.
 */
export function healthColor(style: MapStyle, rgb: readonly [number, number, number], vitality: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, vitality));
  const stops = style.health;
  const top = stops[0] as (typeof stops)[number];
  if (v >= top[0]) {
    // Thriving land is a touch richer and deeper than healthy land.
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

/** A color a little lighter or darker, warmer or cooler by `path`, so neighboring areas keep apart by their tone. */
function toned(style: MapStyle, rgb: readonly [number, number, number], path: string): [number, number, number] {
  const r = rand(seedOf(`wash:${path}`));
  const light = r.range(-1, 1) * style.toneStep;
  const warmth = r.range(-1, 1) * style.toneStep * 0.38;
  const lit = light > 0 ? mix3(rgb, LIGHTER, light * 0.5) : mix3(rgb, DARKER, -light * 0.3);
  return warmth > 0 ? mix3(lit, WARMER, warmth) : mix3(lit, COOLER, -warmth);
}

/** An area's healthy wash on the map: `style.land`, a little lighter or darker by its path. */
export const landWash = (style: MapStyle, path: string): [number, number, number] =>
  toned(style, mix3(style.land, channels(style.paper), style.landLift), path).map(Math.round) as [number, number, number];

/** A file's health at its place on the land: where it stands, how far its ground reaches, how much code it holds, and its vitality. */
export interface FileHealth {
  readonly x: number;
  readonly z: number;
  readonly reach: number;
  readonly size: number;
  readonly vitality: number;
}

/** How much a file's health weighs at (x, z): its size, falling off over `spread` meters past its own ground, and nothing past four of them. */
export function healthWeight(f: Omit<FileHealth, "vitality">, x: number, z: number, spread: number): number {
  const d = Math.max(0, Math.hypot(f.x - x, f.z - z) - f.reach);
  return d > spread * 4 ? 0 : f.size * Math.exp((-d * d) / (2 * spread * spread));
}

/** How much the health of the area a point lies in weighs there against its files': a hundredth of a file's average size. */
export const healthPrior = (files: readonly { readonly size: number }[]): number => (files.reduce((a, f) => a + f.size, 0) / Math.max(1, files.length)) * 0.01;

/**
 * Health over the land, from each file's own vitality: at a point, the files around it weighed by their size and
 * how near their ground is, falling off over `spread` meters, across area borders too. Far from every file it
 * settles on `fallback`, the health of the area the point lies in, without a step.
 */
export function healthField(files: readonly FileHealth[], spread: number): (x: number, z: number, fallback: number) => number {
  const far = spread * 4;
  const prior = healthPrior(files);
  // Files bucketed by where they stand on a grid of cells wide enough that every file a point can feel lies in the
  // point's cell or the eight around it, so a point asks only the files near it.
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
 * The sheet's torn edge, as a mask: a ragged line a few thousandths of the
 * sheet in from each side, with the small tears and fibres a deckled edge has.
 * Stretched to the sheet, so it serves any shape of sheet.
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
 * Where you are, drawn as the world draws a person: a small traveller in a
 * vermilion cloak and a straw hat, standing on their own soft shadow, a
 * lantern in hand that glows after dark, with their last few footprints
 * behind them along the way they face. Upright at any heading; only the
 * footprints turn.
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
