// World primitives: the art direction Jev chooses for a whole repository.
// Every option is authored as words with colors behind them, and each axis
// is chosen to stay beautiful beside every option of every other axis.

import type { AccentForm, ColorShift, CloudSpec, GroundSpec, LightSpec, Rgb, SeasonSpec } from "@gaia/schema";
import { primitive, t } from "@gaia/schema";
import { hex, mixLab, shiftColor } from "./color.ts";

// ---------- light ----------

interface Hour {
  /** Sun elevation and azimuth in degrees; azimuth 0 faces +z. */
  readonly elevation: number;
  readonly azimuth: number;
  readonly sun: number;
  readonly intensity: number;
  readonly ambient: number;
  readonly ambientIntensity: number;
  readonly shadow: number;
  readonly glowColor: number;
  readonly glow: number;
  readonly zenithDim: number;
}

const HOURS = {
  dawn: { elevation: 8, azimuth: 235, sun: 0xffc4a2, intensity: 1.0, ambient: 0xb3b5dc, ambientIntensity: 0.64, shadow: 0x7c78aa, glowColor: 0xf7c7b2, glow: 0.7, zenithDim: 0.22 },
  morning: { elevation: 26, azimuth: 300, sun: 0xffe9c0, intensity: 1.16, ambient: 0xb6cde6, ambientIntensity: 0.56, shadow: 0x7489ab, glowColor: 0xf3e6cf, glow: 0.25, zenithDim: 0 },
  midday: { elevation: 58, azimuth: 35, sun: 0xfff2d4, intensity: 1.2, ambient: 0xb2cbe2, ambientIntensity: 0.52, shadow: 0x7386a5, glowColor: 0xffffff, glow: 0, zenithDim: 0 },
  afternoon: { elevation: 38, azimuth: 70, sun: 0xffe08c, intensity: 1.24, ambient: 0xb2c6dc, ambientIntensity: 0.52, shadow: 0x7183a6, glowColor: 0xf6e3c0, glow: 0.15, zenithDim: 0 },
  "golden hour": { elevation: 13, azimuth: 118, sun: 0xffc878, intensity: 1.34, ambient: 0xabaacb, ambientIntensity: 0.6, shadow: 0x6c6b9e, glowColor: 0xffd49a, glow: 0.6, zenithDim: 0.1 },
  dusk: { elevation: 7, azimuth: 205, sun: 0xffa27e, intensity: 0.98, ambient: 0x9c9aca, ambientIntensity: 0.72, shadow: 0x62639a, glowColor: 0xf4ab8e, glow: 0.8, zenithDim: 0.32 },
} as const satisfies Record<string, Hour>;

const WARMTH = {
  cool: { hue: 250, pull: 0.25, maxTurn: 50, chroma: 0.85, lightness: 0 },
  neutral: { hue: 0, pull: 0, maxTurn: 0, chroma: 1, lightness: 0 },
  warm: { hue: 65, pull: 0.3, maxTurn: 40, chroma: 1.25, lightness: 0 },
} as const satisfies Record<string, ColorShift>;

const BRUSH = {
  "soft watercolor": { bands: 6, softness: 0.42 },
  painterly: { bands: 4, softness: 0.22 },
  "bold gouache": { bands: 3, softness: 0.1 },
} as const;

export const daylight = primitive({
  id: "daylight@1",
  role: "Light",
  doc: "The sun's hour, its path across the sky, the warmth of its light, and how the light is painted.",
  params: {
    hour: t.choice("What hour does the world always rest at?", {
      dawn: "First light: a low rosy sun, lavender shadows",
      morning: "Clear fresh light from a climbing sun",
      midday: "High, even light with short shadows",
      afternoon: "Warm side light that models every form",
      "golden hour": "A low amber sun and long violet shadows",
      dusk: "The sun just setting, the sky glowing rose",
    }),
    path: t.scale("How high the sun rides", { "low, like winter": 0.62, middling: 1, "high, like midsummer": 1.3 }),
    warmth: t.choice("The temperature of the light", {
      cool: "Silvery, blue-leaning light",
      neutral: "Clean daylight",
      warm: "Honeyed, amber-leaning light",
    }),
    brush: t.choice("How the light is painted", {
      "soft watercolor": "Many soft steps of light, edges melting together",
      painterly: "A few clear steps of light with soft edges",
      "bold gouache": "Few flat steps of light with crisp edges",
    }),
  },
  build: (p): LightSpec => {
    const hour: Hour = HOURS[p.hour];
    const warmth = WARMTH[p.warmth];
    const brush = BRUSH[p.brush];
    const elevation = (Math.min(76, Math.max(5, hour.elevation * p.path)) * Math.PI) / 180;
    const azimuth = (hour.azimuth * Math.PI) / 180;
    const warm = (c: number): Rgb => shiftColor(hex(c), warmth);
    return {
      sunDirection: [Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)],
      sunColor: warm(hour.sun),
      sunIntensity: hour.intensity,
      ambientColor: shiftColor(hex(hour.ambient), { ...warmth, pull: warmth.pull * 0.5 }),
      ambientIntensity: hour.ambientIntensity,
      shadowColor: shiftColor(hex(hour.shadow), { ...warmth, pull: warmth.pull * 0.4, chroma: 1 }),
      celBands: brush.bands,
      celSoftness: brush.softness,
      horizonGlow: warm(hour.glowColor),
      glow: hour.glow,
      zenithDim: hour.zenithDim,
    };
  },
});

// ---------- sky ----------

const SKY_COLORS = {
  cobalt: { zenith: 0x3f78d6, horizon: 0xa9d0ef },
  "powder blue": { zenith: 0x6aa5e3, horizon: 0xcfe6f2 },
  "watercolor wash": { zenith: 0x93b4d6, horizon: 0xe4ebe8 },
  "teal lagoon": { zenith: 0x3d93b6, horizon: 0xbfe4dc },
  lavender: { zenith: 0x7c8ed2, horizon: 0xe2d8ec },
  apricot: { zenith: 0x7aa1cf, horizon: 0xf3dcc0 },
} as const;

type CloudShape = Omit<CloudSpec, "threshold">;

const CLOUD_FORMS = {
  "fair-weather puffs": { scale: 3.0, stretch: 1.2, softness: 0.08, low: 0.03, high: 0.95, opacity: 0.95, billow: 0.65, cells: 0, horizon: 0 },
  "towering cumulus": { scale: 1.0, stretch: 1, softness: 0.06, low: 0.0, high: 0.45, opacity: 1, billow: 0.9, cells: 0, horizon: 1 },
  "cirrus streaks": { scale: 2.2, stretch: 5, softness: 0.1, low: 0.05, high: 0.95, opacity: 0.75, billow: 0.3, cells: 0, horizon: 0 },
  "mackerel dapples": { scale: 2.6, stretch: 1.8, softness: 0.06, low: 0.1, high: 0.95, opacity: 0.8, billow: 0.35, cells: 1, horizon: 0 },
  "low drifting banks": { scale: 0.9, stretch: 3.5, softness: 0.1, low: 0.0, high: 0.26, opacity: 0.88, billow: 0.45, cells: 0, horizon: 1 },
} as const satisfies Record<string, CloudShape>;

export const sky = primitive({
  id: "sky@1",
  role: "Sky",
  doc: "The sky's own color and the form and amount of its clouds.",
  params: {
    character: t.choice("The sky's color at noon", {
      cobalt: "Deep, clear cobalt blue",
      "powder blue": "Soft, bright powder blue",
      "watercolor wash": "Pale washed blue, almost grey-green at the horizon",
      "teal lagoon": "Blue-green, like a shallow lagoon",
      lavender: "Lilac-blue, soft violet at the horizon",
      apricot: "Blue above, warm apricot at the horizon",
    }),
    clouds: t.choice("The form of the clouds", {
      "fair-weather puffs": "Small bright cumulus puffs",
      "towering cumulus": "Great billowing towers standing on the horizon",
      "cirrus streaks": "Thin, high streaks brushed across the sky",
      "mackerel dapples": "Rows of small dappled cloudlets",
      "low drifting banks": "Long soft banks drifting low along the horizon",
    }),
    cover: t.scale("How much of the sky the clouds cover", { "a few": 0.62, scattered: 0.56, "many, but with blue between": 0.5 }),
  },
  build: (p) => {
    const colors = SKY_COLORS[p.character];
    return { zenith: hex(colors.zenith), horizon: hex(colors.horizon), clouds: { ...CLOUD_FORMS[p.clouds], threshold: p.cover } };
  },
});

// ---------- season ----------

interface SeasonDef {
  readonly leaf: ColorShift;
  readonly bark: ColorShift;
  readonly bloom: ColorShift;
  readonly ground: ColorShift;
  readonly frost: number;
  readonly fall: number;
}

const keep: ColorShift = { hue: 0, pull: 0, maxTurn: 0, chroma: 1, lightness: 0 };

const SEASONS = {
  spring: {
    leaf: { hue: 122, pull: 0.3, maxTurn: 30, chroma: 1.06, lightness: 0.045 },
    bark: { ...keep, lightness: 0.02 },
    bloom: { ...keep, chroma: 1.05, lightness: 0.02 },
    ground: { hue: 125, pull: 0.35, maxTurn: 30, chroma: 1.06, lightness: 0.035 },
    frost: 0,
    fall: 0xf3c9d4,
  },
  "high summer": {
    leaf: { hue: 145, pull: 0.2, maxTurn: 25, chroma: 1.14, lightness: -0.035 },
    bark: { ...keep, lightness: -0.01 },
    bloom: { ...keep, chroma: 1.1 },
    ground: { hue: 138, pull: 0.25, maxTurn: 25, chroma: 1.1, lightness: -0.025 },
    frost: 0,
    fall: 0x7fb350,
  },
  "early autumn": {
    leaf: { hue: 82, pull: 0.4, maxTurn: 40, chroma: 1.06, lightness: 0.01 },
    bark: keep,
    bloom: { ...keep, chroma: 0.95 },
    ground: { hue: 88, pull: 0.4, maxTurn: 38, chroma: 0.96, lightness: 0.02 },
    frost: 0,
    fall: 0xe2b444,
  },
  "deep autumn": {
    leaf: { hue: 45, pull: 0.55, maxTurn: 55, chroma: 1.12, lightness: -0.02 },
    bark: { ...keep, lightness: -0.03 },
    bloom: { hue: 35, pull: 0.2, maxTurn: 20, chroma: 0.95, lightness: -0.02 },
    ground: { hue: 70, pull: 0.5, maxTurn: 50, chroma: 0.92, lightness: -0.01 },
    frost: 0,
    fall: 0xd8663a,
  },
  "first frost": {
    leaf: { hue: 205, pull: 0.15, maxTurn: 20, chroma: 0.78, lightness: 0.06 },
    bark: { ...keep, chroma: 0.8, lightness: 0.04 },
    bloom: { ...keep, chroma: 0.82, lightness: 0.04 },
    ground: { hue: 200, pull: 0.2, maxTurn: 25, chroma: 0.6, lightness: 0.08 },
    frost: 0.75,
    fall: 0xdcd3bc,
  },
  "monsoon green": {
    leaf: { hue: 155, pull: 0.3, maxTurn: 35, chroma: 1.18, lightness: -0.05 },
    bark: { ...keep, chroma: 0.9, lightness: -0.06 },
    bloom: { ...keep, chroma: 1.08, lightness: -0.02 },
    ground: { hue: 150, pull: 0.35, maxTurn: 35, chroma: 1.16, lightness: -0.045 },
    frost: 0,
    fall: 0x5a9c58,
  },
} as const satisfies Record<string, SeasonDef>;

const scaled = (s: ColorShift, k: number): ColorShift => ({
  hue: s.hue,
  pull: s.pull * k,
  maxTurn: s.maxTurn * k,
  chroma: 1 + (s.chroma - 1) * k,
  lightness: s.lightness * k,
});

export const season = primitive({
  id: "season@1",
  role: "Season",
  doc: "The season the world rests in; it turns every component's healthy colors and the ground, never decline.",
  params: {
    season: t.choice("Which season", {
      spring: "Fresh yellow-greens and new blossom",
      "high summer": "Deep, saturated, heavy greens",
      "early autumn": "Greens turning gold",
      "deep autumn": "Copper, rust and russet",
      "first frost": "Pale, silvered colors and frosted grass",
      "monsoon green": "Dark, wet, glossy emerald",
    }),
    strength: t.scale("How strongly the season shows", { "a hint": 0.5, clearly: 1, "in full": 1.4 }),
  },
  build: (p): SeasonSpec => {
    const def: SeasonDef = SEASONS[p.season];
    const k = p.strength;
    return {
      swatches: { leaf: scaled(def.leaf, k), bark: scaled(def.bark, k), bloom: scaled(def.bloom, k) },
      ground: scaled(def.ground, k),
      frost: Math.min(1, def.frost * k),
      fall: hex(def.fall),
    };
  },
});

// ---------- atmosphere ----------

const AIRS = {
  clear: { tint: 0xc8dcec, tintAmount: 0, density: 0.0035, mist: 0, specks: 0 },
  "hazy gold": { tint: 0xf0d49c, tintAmount: 0.55, density: 0.009, mist: 0.12, specks: 0 },
  "blue haze": { tint: 0x9fbde0, tintAmount: 0.45, density: 0.008, mist: 0.08, specks: 0 },
  "morning mist": { tint: 0xe2e9ec, tintAmount: 0.5, density: 0.006, mist: 0.35, specks: 0 },
  "pollen-filled": { tint: 0xf1e2a8, tintAmount: 0.32, density: 0.0065, mist: 0.06, specks: 1 },
} as const;

export const air = primitive({
  id: "air@1",
  role: "Atmosphere",
  doc: "What hangs in the air between you and the distance.",
  params: {
    air: t.choice("The character of the air", {
      clear: "Crisp, clean air",
      "hazy gold": "Warm golden haze",
      "blue haze": "Distance fades into soft blue",
      "morning mist": "White mist lying low on the ground",
      "pollen-filled": "Air thick with drifting golden pollen",
    }),
    distance: t.scale("How far you can see", { "for miles": 0.55, "softened distance": 1, "close and dreamy": 1.7 }),
  },
  build: (p) => {
    const a = AIRS[p.air];
    return { tint: hex(a.tint), tintAmount: a.tintAmount, density: a.density * p.distance, mist: a.mist, specks: a.specks };
  },
});

// ---------- ground cover ----------

interface Cover {
  readonly soil: number;
  readonly low: number;
  readonly high: number;
  readonly tip: number;
  readonly height: number;
  readonly width: number;
  readonly density: number;
  readonly clump: number;
  readonly flowers: readonly [number, number, number];
}

const COVERS = {
  "lush grass": { soil: 0x6f8f4a, low: 0x5a9146, high: 0x9ccc68, tip: 0xb6da80, height: 0.4, width: 0.045, density: 1, clump: 0, flowers: [0xf6f1e0, 0xf5d45c, 0xb9a5e8] },
  "golden steppe": { soil: 0xa69660, low: 0x9a8c4c, high: 0xd6c07a, tip: 0xecdb9e, height: 0.5, width: 0.035, density: 0.85, clump: 0.15, flowers: [0xf3e6c4, 0xe9a24c, 0xc96a5a] },
  "silver grass": { soil: 0x7c875a, low: 0x748658, high: 0xb4c09c, tip: 0xeae6da, height: 0.85, width: 0.03, density: 0.62, clump: 0.35, flowers: [0xf2efe6, 0xd8c9e6, 0xf0d9a0] },
  moss: { soil: 0x4f7a3c, low: 0x4c7c3a, high: 0x86b04e, tip: 0xa6c660, height: 0.09, width: 0.06, density: 1, clump: 0.1, flowers: [0xf4f0e2, 0xe8c45a, 0xd88aa0] },
  heather: { soil: 0x6a6048, low: 0x6a5a6c, high: 0xa47cae, tip: 0xc89cd0, height: 0.26, width: 0.05, density: 0.95, clump: 0.3, flowers: [0xd9a8de, 0xf2d7f0, 0x9c6fb8] },
  "sand and scrub": { soil: 0xd4c19a, low: 0x87905c, high: 0xb1b278, tip: 0xcdc694, height: 0.3, width: 0.04, density: 0.45, clump: 0.8, flowers: [0xf2c45a, 0xe8836a, 0xf4efe0] },
  "clover meadow": { soil: 0x5e8944, low: 0x4f8b42, high: 0x8ec45e, tip: 0xa4d07a, height: 0.18, width: 0.07, density: 1, clump: 0, flowers: [0xf3f0f2, 0xe7a5c8, 0xc9b6ec] },
} as const satisfies Record<string, Cover>;

export const groundCover = primitive({
  id: "ground-cover@1",
  role: "Ground",
  doc: "What grows over the open ground between the components.",
  params: {
    cover: t.choice("What covers the ground", {
      "lush grass": "Soft green grass",
      "golden steppe": "Dry golden grassland",
      "silver grass": "Tall pale plumed grass that ripples in the wind",
      moss: "A deep cushion of moss",
      heather: "Low purple heather",
      "sand and scrub": "Pale sand with clumps of scrub",
      "clover meadow": "A low carpet of clover",
    }),
    length: t.scale("How tall the cover grows", { cropped: 0.65, natural: 1, "tall and unkempt": 1.45 }),
    wildflowers: t.scale("How many wildflowers", { none: 0, "a scattering": 0.03, "drifts of them": 0.11 }),
  },
  build: (p): GroundSpec => {
    const c: Cover = COVERS[p.cover];
    return {
      soil: hex(c.soil),
      low: hex(c.low),
      high: hex(c.high),
      tip: hex(c.tip),
      height: c.height * p.length,
      width: c.width,
      density: c.density,
      clump: c.clump,
      flowers: p.wildflowers,
      flowerColors: c.flowers.map(hex),
    };
  },
});

// ---------- ambient accents ----------

const ACCENTS = {
  "drifting petals": { form: "petals", color: 0xf7d8e0, size: 0.075, glow: 0 },
  "fireflies at dusk": { form: "fireflies", color: 0xf6ea8c, size: 0.07, glow: 1 },
  "motes of light": { form: "motes", color: 0xfff2cc, size: 0.04, glow: 0.6 },
  "falling leaves": { form: "leaves", color: 0xd9a04a, size: 0.1, glow: 0 },
  "dandelion seeds": { form: "seeds", color: 0xf6f4ee, size: 0.055, glow: 0.1 },
} as const satisfies Record<string, { form: AccentForm; color: number; size: number; glow: number }>;

export const drift = primitive({
  id: "drift@1",
  role: "Accents",
  doc: "Small living things drifting through the air. Always subtle.",
  params: {
    form: t.choice("What drifts through the air", {
      "drifting petals": "Pale petals carried on the breeze",
      "fireflies at dusk": "Fireflies blinking low over the ground",
      "motes of light": "Tiny motes of light hanging in the sunbeams",
      "falling leaves": "Leaves spinning down, in the season's color",
      "dandelion seeds": "Dandelion seeds floating past",
    }),
    amount: t.scale("How many", { "a few": 70, some: 180, many: 380 }),
  },
  build: (p) => {
    const a = ACCENTS[p.form];
    return { form: a.form, color: hex(a.color), count: Math.round(p.amount), size: a.size, glow: a.glow };
  },
});

// ---------- wind ----------

export const wind = primitive({
  id: "wind@1",
  role: "Wind",
  doc: "The wind that moves everything in the world.",
  params: {
    strength: t.scale("How hard the wind blows", { "still air": 0.25, "light airs": 0.6, breezy: 1, gusty: 1.55 }),
  },
  build: (p) => ({ strength: p.strength, gust: Math.max(0, (p.strength - 0.6) * 0.9) }),
});

export const WORLD_PRIMITIVES = [daylight, sky, season, air, groundCover, drift, wind];

/** The color of the ground, with the season applied. Grass decline stays fixed elsewhere. */
export function seasonGround(g: GroundSpec, s: SeasonSpec): GroundSpec {
  const shift = (c: Rgb): Rgb => shiftColor(c, s.ground);
  const frosted = (c: Rgb): Rgb => mixLab(shift(c), hex(0xeef3f6), s.frost * 0.7);
  return {
    ...g,
    soil: shift(g.soil),
    low: shift(g.low),
    high: shift(g.high),
    tip: frosted(g.tip),
    flowerColors: g.flowerColors.map((c) => shiftColor(c, { ...s.ground, pull: s.ground.pull * 0.3, maxTurn: 15 })),
  };
}
