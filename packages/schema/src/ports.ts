// What primitives produce and consume. Everything here is plain typed arrays,
// so it crosses worker boundaries and hashes without Three.js.

import type { Landform } from "./relief.ts";

export type Vec3 = readonly [number, number, number];
export type Rgb = readonly [number, number, number];

/**
 * Per-vertex vitality channels. The shader combines them with the instance's
 * live vitality, so a vitality change never rebuilds geometry.
 */
export interface VitalityChannels {
  /** The vitality below which the vertex's piece collapses to its pivot. 0 means never. */
  readonly loss: Float32Array;
  /** How far the vertex sags toward the ground as vitality falls, 0 to 1. */
  readonly droop: Float32Array;
  /** How far the vertex's color moves toward the decline swatch, 0 to 1. */
  readonly wither: Float32Array;
  /** How much the vertex shines when vitality is high, 0 to 1. */
  readonly glow: Float32Array;
  /** The point each vertex collapses toward and sags around, xyz per vertex. */
  readonly pivot: Float32Array;
}

export interface Part {
  /** The palette swatch that colors this part, such as "bark" or "leaf". */
  readonly swatch: string;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  /** Per-vertex brightness variation, 0 to 1. */
  readonly shade: Float32Array;
  /** Per-vertex hue offset in turns, -0.1 to 0.1, so one swatch varies across a canopy. */
  readonly tint: Float32Array;
  readonly channels: VitalityChannels;
  readonly collision: "solid" | "walkable" | "none";
}

export interface Anchor {
  readonly position: Vec3;
  readonly normal: Vec3;
  /** Relative size of what may attach here, 0 to 1. */
  readonly size: number;
}

export interface Built {
  readonly parts: readonly Part[];
  readonly anchors: readonly Anchor[];
}

export interface Limb {
  readonly start: Vec3;
  readonly end: Vec3;
  readonly startRadius: number;
  readonly endRadius: number;
  /** 0 for the trunk, then 1, 2, ... for each split. */
  readonly depth: number;
  /** Index of the parent limb, or -1 for the trunk. */
  readonly parent: number;
}

export interface Skeleton {
  readonly limbs: readonly Limb[];
  /** Where foliage and ornaments may attach. */
  readonly tips: readonly Anchor[];
}

export interface Swatch {
  readonly healthy: Rgb;
  readonly decline: Rgb;
}

export interface Palette {
  readonly swatches: Readonly<Record<string, Swatch>>;
}

export interface MotionSpec {
  /** How strongly wind moves the component, 0 to 1. */
  readonly sway: number;
  /** Wind response frequency in hertz. */
  readonly frequency: number;
}

// ---------- the world's art direction ----------
// One world per repository. Its outputs are plain numbers and colors that the
// world composer combines and every material reads.

/**
 * A seasonal turn of one color in OKLCh: hue pulled toward `hue` (degrees) by
 * `pull` but never more than `maxTurn` degrees, chroma scaled, lightness offset.
 */
export interface ColorShift {
  readonly hue: number;
  readonly pull: number;
  readonly maxTurn: number;
  readonly chroma: number;
  readonly lightness: number;
}

/** The sun at one hour, and what that hour does to the sky. */
export interface LightSpec {
  /** Unit vector toward the sun. */
  readonly sunDirection: Vec3;
  readonly sunColor: Rgb;
  readonly sunIntensity: number;
  readonly ambientColor: Rgb;
  readonly ambientIntensity: number;
  /** Shadows are tinted, never black. */
  readonly shadowColor: Rgb;
  readonly celBands: number;
  readonly celSoftness: number;
  /** The color the hour lends the horizon, and how much of it. */
  readonly horizonGlow: Rgb;
  readonly glow: number;
  /** How far the hour deepens the zenith, 0 to 1. */
  readonly zenithDim: number;
}

/** Cloud shape as numbers one shader reads: no per-form branches. */
export interface CloudSpec {
  /** Noise frequency over the sky projection. */
  readonly scale: number;
  /** East-west stretch; above 1 draws streaks. */
  readonly stretch: number;
  /** Noise level above which there is cloud. */
  readonly threshold: number;
  readonly softness: number;
  /** Lowest and highest sky elevation where clouds form, as sin(elevation). */
  readonly low: number;
  readonly high: number;
  readonly opacity: number;
  /** How strongly the sun side brightens and the far side shades, 0 to 1. */
  readonly billow: number;
  /** Breaks the cover into small cells, like a mackerel sky, 0 to 1. */
  readonly cells: number;
  /** 0 spreads clouds across the dome; 1 stands them on the horizon, like towers and banks. */
  readonly horizon: number;
}

export interface SkySpec {
  readonly zenith: Rgb;
  readonly horizon: Rgb;
  readonly clouds: CloudSpec;
}

export interface SeasonSpec {
  /** Shifts per palette swatch name; a swatch without one keeps its color. */
  readonly swatches: Readonly<Record<string, ColorShift>>;
  readonly ground: ColorShift;
  /** How white the grass tips turn, 0 to 1. */
  readonly frost: number;
  /** The color of what falls in this season, such as leaves. */
  readonly fall: Rgb;
}

export interface AtmosphereSpec {
  /** The air's own color, and how far it pulls the horizon and fog toward it. */
  readonly tint: Rgb;
  readonly tintAmount: number;
  /** Aerial-perspective density per unit of distance. */
  readonly density: number;
  /** Low-lying haze near the ground, 0 to 1. */
  readonly mist: number;
  /** Fine specks hanging in the air, such as pollen, 0 to 1. */
  readonly specks: number;
}

export interface GroundSpec {
  readonly soil: Rgb;
  readonly low: Rgb;
  readonly high: Rgb;
  readonly tip: Rgb;
  /** Blade height in world units. */
  readonly height: number;
  readonly width: number;
  /** Fraction of the full blade count, 0 to 1. */
  readonly density: number;
  /** 0 is an even carpet; 1 is tufts on bare soil. */
  readonly clump: number;
  /** Fraction of blades that carry a flower. */
  readonly flowers: number;
  readonly flowerColors: readonly Rgb[];
}

export type AccentForm = "petals" | "fireflies" | "motes" | "leaves" | "seeds";

export interface AccentSpec {
  readonly form: AccentForm;
  readonly color: Rgb;
  readonly count: number;
  readonly size: number;
  /** Emission, 0 to 1. */
  readonly glow: number;
}

export interface WindSpec {
  /** Multiplies every sway in the world. 1 is a light breeze. */
  readonly strength: number;
  /** How much the strength surges in slow gusts, 0 to 1. */
  readonly gust: number;
}

/**
 * Every role a slot can ask for, with what its primitive consumes and produces.
 * A slot declared with `on: "form"` feeds the output of slot "form" in as input.
 */
export interface Roles {
  Skeleton: { input: null; output: Skeleton };
  Surface: { input: Skeleton; output: Built };
  Foliage: { input: Skeleton; output: Built };
  Ornament: { input: readonly Anchor[]; output: Built };
  Motion: { input: null; output: MotionSpec };
  Palette: { input: null; output: Palette };
  Relief: { input: null; output: Landform };
  Light: { input: null; output: LightSpec };
  Sky: { input: null; output: SkySpec };
  Season: { input: null; output: SeasonSpec };
  Atmosphere: { input: null; output: AtmosphereSpec };
  Ground: { input: null; output: GroundSpec };
  Accents: { input: null; output: AccentSpec };
  Wind: { input: null; output: WindSpec };
  Natives: { input: null; output: NativeFamilies };
}

/** The palette families native to a region. Empty means every family. */
export interface NativeFamilies {
  readonly families: readonly string[];
}

export type Role = keyof Roles;
export type RoleInput<R extends Role> = Roles[R]["input"];
export type RoleOutput<R extends Role> = Roles[R]["output"];
