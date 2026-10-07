// World primitives: the light, sky, season and wind one repository's whole
// world shares. Every option is authored as words with colors behind them, and
// each axis is chosen to stay beautiful beside every option of every other axis.

import type { ColorShift, CloudSpec, DayKey, DaySpec, GroundSpec, Rgb, SeasonSpec, Vec3 } from "@gaia/schema";
import { primitive, t } from "@gaia/schema";
import { hex, mixLab, shiftColor } from "./color.ts";

// ---------- light ----------

interface Hour {
  /** The local hour this key stands for. */
  readonly at: number;
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
  /** Moon elevation and azimuth in degrees, and how much of the moon's light reaches the land, 0 to 1. */
  readonly moonElevation: number;
  readonly moonAzimuth: number;
  readonly moon: number;
  readonly nightness: number;
}

// The night keys keep a cool blue ambient and shadow well above black: the
// land always reads as shapes under the moon, whatever moon the world has.
const HOURS = {
  "deep night": { at: 2, elevation: -32, azimuth: 222, sun: 0x7a6a9a, intensity: 0, ambient: 0x4c5e98, ambientIntensity: 0.38, shadow: 0x2b386c, glowColor: 0x34487c, glow: 0.1, zenithDim: 0.6, moonElevation: 40, moonAzimuth: 235, moon: 1, nightness: 1 },
  dawn: { at: 6, elevation: 8, azimuth: 235, sun: 0xffc4a2, intensity: 1.0, ambient: 0xb3b5dc, ambientIntensity: 0.64, shadow: 0x7c78aa, glowColor: 0xf7c7b2, glow: 0.7, zenithDim: 0.22, moonElevation: 8, moonAzimuth: 265, moon: 0.06, nightness: 0.1 },
  morning: { at: 8.5, elevation: 26, azimuth: 300, sun: 0xffe9c0, intensity: 1.16, ambient: 0xb6cde6, ambientIntensity: 0.56, shadow: 0x7489ab, glowColor: 0xf3e6cf, glow: 0.25, zenithDim: 0, moonElevation: -14, moonAzimuth: 280, moon: 0, nightness: 0 },
  midday: { at: 12.5, elevation: 58, azimuth: 35, sun: 0xfff2d4, intensity: 1.2, ambient: 0xb2cbe2, ambientIntensity: 0.52, shadow: 0x7386a5, glowColor: 0xffffff, glow: 0, zenithDim: 0, moonElevation: -50, moonAzimuth: 320, moon: 0, nightness: 0 },
  afternoon: { at: 15.5, elevation: 38, azimuth: 70, sun: 0xffe08c, intensity: 1.24, ambient: 0xb2c6dc, ambientIntensity: 0.52, shadow: 0x7183a6, glowColor: 0xf6e3c0, glow: 0.15, zenithDim: 0, moonElevation: -40, moonAzimuth: 20, moon: 0, nightness: 0 },
  "golden hour": { at: 18, elevation: 13, azimuth: 118, sun: 0xffc878, intensity: 1.34, ambient: 0xabaacb, ambientIntensity: 0.6, shadow: 0x6c6b9e, glowColor: 0xffd49a, glow: 0.6, zenithDim: 0.1, moonElevation: -12, moonAzimuth: 95, moon: 0, nightness: 0 },
  dusk: { at: 19.5, elevation: 7, azimuth: 205, sun: 0xffa27e, intensity: 0.98, ambient: 0x9c9aca, ambientIntensity: 0.72, shadow: 0x62639a, glowColor: 0xf4ab8e, glow: 0.8, zenithDim: 0.32, moonElevation: 5, moonAzimuth: 135, moon: 0.05, nightness: 0.3 },
  moonlit: { at: 22, elevation: -18, azimuth: 215, sun: 0x8a6f9a, intensity: 0, ambient: 0x5669a6, ambientIntensity: 0.44, shadow: 0x313e72, glowColor: 0x41568e, glow: 0.18, zenithDim: 0.5, moonElevation: 14, moonAzimuth: 165, moon: 1, nightness: 0.92 },
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

/** The disc a world's moon shows, and the light it lends the land. */
const MOONS = {
  "silver moon": { disc: 0xeef1f8, light: 0xa9bce6, brightness: 0.4, size: 0.026, phase: 1 },
  "amber harvest moon": { disc: 0xf7cd8e, light: 0xc4b9a8, brightness: 0.42, size: 0.036, phase: 1 },
  "thin pale crescent": { disc: 0xf1f1ea, light: 0x97a8d6, brightness: 0.2, size: 0.024, phase: 0.2 },
} as const;

const toward = (elevationDeg: number, azimuthDeg: number): Vec3 => {
  const e = (elevationDeg * Math.PI) / 180;
  const a = (azimuthDeg * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
};

export const daylight = primitive({
  id: "daylight@1",
  role: "Light",
  doc: "A whole day and night: the sun's path, the warmth of its light, how the light is painted, the moon and the stars. The hour follows the person's own clock.",
  params: {
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
    moon: t.choice("The moon that lights the world's nights", {
      "silver moon": "A bright full moon that silvers the land",
      "amber harvest moon": "A large, low, honey-colored full moon",
      "thin pale crescent": "A slim crescent; dark nights where the lantern matters",
    }),
    stars: t.scale("How many stars the night shows", { "a scattered few": 0.2, many: 0.55, "a river of stars": 1 }),
  },
  build: (p): DaySpec => {
    const warmth = WARMTH[p.warmth];
    const brush = BRUSH[p.brush];
    const moon = MOONS[p.moon];
    const warm = (c: number): Rgb => shiftColor(hex(c), warmth);
    const keyOf = (hour: Hour): DayKey => {
      // The path lifts or lowers the sun by day; at night it stays below the horizon.
      const elevation = hour.elevation > 0 ? Math.min(76, Math.max(5, hour.elevation * p.path)) : hour.elevation;
      return {
        hour: hour.at,
        light: {
          sunDirection: toward(elevation, hour.azimuth),
          sunColor: warm(hour.sun),
          sunIntensity: hour.intensity,
          moonDirection: toward(hour.moonElevation, hour.moonAzimuth),
          moonColor: shiftColor(hex(moon.light), { ...warmth, pull: warmth.pull * 0.5 }),
          moonIntensity: hour.moon * moon.brightness,
          nightness: hour.nightness,
          ambientColor: shiftColor(hex(hour.ambient), { ...warmth, pull: warmth.pull * 0.5 }),
          ambientIntensity: hour.ambientIntensity,
          shadowColor: shiftColor(hex(hour.shadow), { ...warmth, pull: warmth.pull * 0.4, chroma: 1 }),
          celBands: brush.bands,
          celSoftness: brush.softness,
          horizonGlow: warm(hour.glowColor),
          glow: hour.glow,
          zenithDim: hour.zenithDim,
        },
      };
    };
    const keys = (Object.values(HOURS) as Hour[]).map(keyOf).sort((a, b) => a.hour - b.hour);
    return {
      keys,
      moon: { color: hex(moon.disc), size: moon.size, phase: moon.phase },
      stars: { density: p.stars, river: Math.min(1, Math.max(0, (p.stars - 0.7) / 0.3)) },
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
  "towering cumulus": { scale: 1.0, stretch: 1, softness: 0.06, low: 0.0, high: 0.55, opacity: 1, billow: 0.9, cells: 0, horizon: 1 },
  // Thin and high: fine streaks nine times longer than wide, faint, kept to the upper sky.
  "cirrus streaks": { scale: 3.4, stretch: 9, softness: 0.14, low: 0.22, high: 1.05, opacity: 0.38, billow: 0.15, cells: 0, horizon: 0 },
  "low drifting banks": { scale: 0.9, stretch: 3.5, softness: 0.1, low: 0.0, high: 0.32, opacity: 0.88, billow: 0.45, cells: 0, horizon: 1 },
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

export const WORLD_PRIMITIVES = [daylight, sky, season, wind];

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
