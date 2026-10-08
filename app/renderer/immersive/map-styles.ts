// The field map's directions: how its paper, washes, hills, water, borders,
// the wild past the land and its lettering are painted. Each direction is
// plain data that `field-map.ts` paints from; `CHOSEN_MAP` picks the one the
// app shows, and `?map=` picks another for a look at it.
//
// - `painted`: a painted bird's-eye of the valley, as in a Ghibli film:
//   gouache-rich washes, hills shaded in violet and lit warm, hedgerows of
//   painted dots between areas, trees as round crowns with soft shadows, and
//   deep water lit at its rim.
// - `sketchbook`: a traveller's watercolor sketchbook page: loose,
//   transparent washes bleeding into each other wet-in-wet, blooms where the
//   pigment dried unevenly, pencil borders, and paint fading raggedly into
//   white paper short of the sheet's edge.
// - `explorer`: an old explorer's chart on aged parchment: thin hand-tinted
//   washes, hills drawn as ink hachures, the coast of each pond engraved with
//   water lines, ink borders with a band of color inside each region, and the
//   wild drawn as a forest of little inked trees.

export type MapStyleName = "painted" | "sketchbook" | "explorer";

export interface MapStyle {
  readonly name: MapStyleName;
  /** The paper's tone, and the pigment its mottling is in. */
  readonly paper: string;
  readonly mottle: readonly [number, number, number];
  /** Whether the paper is old: foxed, and darkened toward its edges. */
  readonly aged: boolean;
  /** One hue per top-level directory, the repository's own ground, and the wild past the land. */
  readonly washes: readonly string[];
  readonly common: string;
  readonly wild: string;
  /** How far a subdirectory's wash steps lighter or darker than its top-level hue. */
  readonly toneStep: number;
  /** Ink for lettering and drawn marks. */
  readonly ink: string;
  /** The washes' own opacity, and a blurred copy laid under them so neighbors bleed into each other (opacity, blur in paper pixels). */
  readonly washAlpha: number;
  readonly bleed: number;
  readonly bleedPx: number;
  /** Pigment pooling at each wash's rim: stroke widths in paper pixels and opacities, kept inside the outline. */
  readonly pool: readonly (readonly [number, number])[];
  /** Blooms where the pigment dried unevenly: how many. */
  readonly blooms: number;
  /** Broad brush strokes laid over the washes, each a little warmer, cooler, lighter or darker: how many. */
  readonly strokes: number;
  /** Where the paint gives way to bare paper, as a fraction of the sheet from its edge: fully gone at the first, full at the second; and how ragged that edge is. */
  readonly fade: readonly [number, number];
  readonly ragged: number;
  /** How hills are drawn. */
  readonly hills: "shade" | "hachure" | "lit";
  /** Shadow and light tints for the hills, and their strengths. */
  readonly shadow: string;
  readonly shadowAlpha: number;
  /** How strongly a slope's facing shades or lights it, and how softly the shading is laid, paper pixels. */
  readonly relief: number;
  readonly reliefBlur: number;
  readonly light: string;
  readonly lightAlpha: number;
  /** How the borders between areas are drawn. */
  readonly border: "pencil" | "ink" | "hedge";
  /** How water is drawn. */
  readonly water: "wash" | "engraved" | "deep";
  /** How trees are drawn, on the land and in the wild. */
  readonly trees: "dab" | "symbol" | "crown";
  /** A wild tree's crown, meters. */
  readonly woodSize: number;
  /** A patch's faint health wash and the line round it. */
  readonly patchFill: number;
  readonly patchLine: number;
  /** The dotted ways' ink. */
  readonly trail: string;
  /** Top-level areas lettered in spaced capitals. */
  readonly capitals: boolean;
  /** How strongly each top-level directory's name is lettered across its whole region. */
  readonly regionAlpha: number;
}

const SHARED = ["#9fbf83", "#dcb56f", "#d09684", "#8eb0c9", "#b39fcb", "#86b8a1", "#d79e68", "#a9bd93", "#cdb48a", "#9cadd6"];

export const MAP_STYLES: Readonly<Record<MapStyleName, MapStyle>> = {
  painted: {
    name: "painted",
    paper: "#efe5cb",
    mottle: [96, 72, 40],
    aged: false,
    washes: ["#8fbb68", "#e2bb5c", "#dc9670", "#7fb3d0", "#ad97d2", "#6fb893", "#e09c56", "#a0c47a", "#d6b26a", "#8aa8de"],
    common: "#b7cf8c",
    wild: "#5f8a4c",
    toneStep: 0.42,
    ink: "#3a2f22",
    washAlpha: 0.84,
    bleed: 0.5,
    bleedPx: 7,
    pool: [[22, 0.05], [10, 0.07], [4, 0.09]],
    blooms: 0,
    strokes: 2600,
    fade: [0.002, 0.012],
    ragged: 0.006,
    hills: "lit",
    shadow: "#6e6aa0",
    shadowAlpha: 0.62,
    relief: 4.5,
    reliefBlur: 7,
    light: "#fff0c4",
    lightAlpha: 0.42,
    border: "hedge",
    water: "deep",
    trees: "crown",
    woodSize: 3.4,
    patchFill: 0.16,
    patchLine: 0,
    trail: "rgba(122,80,42,0.92)",
    capitals: false,
    regionAlpha: 0.2,
  },
  sketchbook: {
    name: "sketchbook",
    paper: "#f6f1e4",
    mottle: [110, 96, 70],
    aged: false,
    washes: SHARED,
    common: "#cad6a2",
    wild: "#a9bf8a",
    toneStep: 0.5,
    ink: "#4f4234",
    washAlpha: 0.5,
    bleed: 0.42,
    bleedPx: 12,
    pool: [[16, 0.05], [7, 0.08], [2.5, 0.12]],
    blooms: 30,
    strokes: 1200,
    fade: [0.004, 0.032],
    ragged: 0.02,
    hills: "shade",
    shadow: "#7d86a8",
    shadowAlpha: 0.55,
    relief: 5,
    reliefBlur: 6,
    light: "#ffffff",
    lightAlpha: 0,
    border: "pencil",
    water: "wash",
    trees: "dab",
    woodSize: 3,
    patchFill: 0.12,
    patchLine: 0.1,
    trail: "rgba(112,72,38,0.85)",
    capitals: false,
    regionAlpha: 0.16,
  },
  explorer: {
    name: "explorer",
    paper: "#e8d6a8",
    mottle: [120, 82, 36],
    aged: true,
    washes: ["#a8b97d", "#d6ae68", "#c98f72", "#93abb3", "#a99bb8", "#8fae8f", "#cf9a62", "#b0b884", "#c7ab7c", "#9aa8c4"],
    common: "#cbc792",
    wild: "#b9b27e",
    toneStep: 0.4,
    ink: "#3b2c1c",
    washAlpha: 0.42,
    bleed: 0.12,
    bleedPx: 5,
    pool: [[30, 0.07], [16, 0.09], [7, 0.12], [2.5, 0.14]],
    blooms: 0,
    strokes: 0,
    fade: [0.004, 0.022],
    ragged: 0.01,
    hills: "hachure",
    shadow: "#6b5a44",
    shadowAlpha: 0.32,
    relief: 4,
    reliefBlur: 3,
    light: "#ffffff",
    lightAlpha: 0,
    border: "ink",
    water: "engraved",
    trees: "symbol",
    woodSize: 2.4,
    patchFill: 0.1,
    patchLine: 0.16,
    trail: "rgba(96,58,30,0.9)",
    capitals: true,
    regionAlpha: 0.26,
  },
};

/** The direction the app shows. */
export const CHOSEN_MAP: MapStyleName = "painted";

/** The direction `?map=` asks for, or the chosen one. */
export function askedMapStyle(): MapStyle {
  const asked = new URLSearchParams(location.search).get("map");
  return MAP_STYLES[(asked !== null && asked in MAP_STYLES ? asked : CHOSEN_MAP) as MapStyleName];
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
