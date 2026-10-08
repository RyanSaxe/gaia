// The field map's look: a painted bird's-eye of the valley, as in a Ghibli
// film: gouache-rich washes, hills shaded in violet and lit warm, soft
// painted hedgerows between areas, trees as round crowns with soft shadows,
// and deep water lit at its rim. It is plain data that `field-map.ts` paints
// from, and the wait paints its sheet from the same data (`wait/ink.ts`).
//
// An area's wash is the color of the land Jev judged for it, from the
// palette the ground shader paints that land's cover with (`groundWash`).

import { type GroundSpec, rand, seedOf } from "@gaia/schema";

export interface MapStyle {
  /** The paper's tone, and the pigment its mottling is in. */
  readonly paper: string;
  readonly mottle: readonly [number, number, number];
  /** The wild past the land. */
  readonly wild: string;
  /** How an area's ground color becomes its wash: its chroma scaled, then lifted this far toward the paper. */
  readonly landChroma: number;
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
  /** A wild tree's crown, meters. */
  readonly woodSize: number;
  /** A patch's faint health wash. */
  readonly patchFill: number;
  /** The dotted ways' ink. */
  readonly trail: string;
  /** How strongly each top-level directory's name is lettered across its whole region. */
  readonly regionAlpha: number;
}

export const MAP_STYLE: MapStyle = {
  paper: "#efe5cb",
  mottle: [96, 72, 40],
  wild: "#5f8a4c",
  landChroma: 1.3,
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
  woodSize: 3.4,
  patchFill: 0.16,
  trail: "rgba(122,80,42,0.92)",
  regionAlpha: 0.2,
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
 * The color an area's ground reads as from above, red, green and blue from 0
 * to 255: its cover's sward as the ground shader mixes it (`ground.ts`), its
 * low and high blades with a touch of their tips, over its soil where the
 * cover grows in clumps.
 */
export function groundTone(g: GroundSpec): [number, number, number] {
  const sward = mix3(mix3(g.low, g.high, 0.55), g.tip, 0.1);
  return mix3(sward, g.soil, g.clump * 0.6).map((c) => c * 255) as [number, number, number];
}

/**
 * An area's wash, red, green and blue from 0 to 255: the color its ground is
 * painted with, softened into watercolor (its chroma
 * scaled about its lightness, then lifted toward the paper), and a little
 * lighter or darker, warmer or cooler by its path, so neighbors on one land
 * keep apart.
 */
export function groundWash(style: MapStyle, ground: GroundSpec, path: string): [number, number, number] {
  const tone = groundTone(ground);
  const grey = tone[0] * 0.3 + tone[1] * 0.59 + tone[2] * 0.11;
  const paint = mix3(tone.map((c) => Math.max(0, Math.min(255, grey + (c - grey) * style.landChroma))), channels(style.paper), style.landLift);
  const r = rand(seedOf(`wash:${path}`));
  const light = r.range(-1, 1) * style.toneStep;
  const warmth = r.range(-1, 1) * style.toneStep * 0.38;
  const lit = light > 0 ? mix3(paint, LIGHTER, light * 0.5) : mix3(paint, DARKER, -light * 0.3);
  return (warmth > 0 ? mix3(lit, WARMER, warmth) : mix3(lit, COOLER, -warmth)).map(Math.round) as [number, number, number];
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
