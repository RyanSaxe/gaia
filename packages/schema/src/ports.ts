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

/** The sun and moon at one hour, and what that hour does to the sky. */
export interface LightSpec {
  /** Unit vector toward the sun; below the horizon at night. */
  readonly sunDirection: Vec3;
  readonly sunColor: Rgb;
  /** Zero once the sun is below the horizon. */
  readonly sunIntensity: number;
  /** Unit vector toward the moon. */
  readonly moonDirection: Vec3;
  /** The moon's light on the land, a dim cool key. */
  readonly moonColor: Rgb;
  readonly moonIntensity: number;
  /** 0 by day, 1 in deep night. Fades in the lantern, the stars and the world's own glow. */
  readonly nightness: number;
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

/** The light at one hour of the day. */
export interface DayKey {
  /** Local hour, 0 to 24. */
  readonly hour: number;
  readonly light: LightSpec;
}

/** The moon a world shows at night. */
export interface MoonSpec {
  /** The disc's own color. */
  readonly color: Rgb;
  /** Angular radius of the disc, in radians. */
  readonly size: number;
  /** 0 is a thin crescent, 1 is full. */
  readonly phase: number;
}

/** The stars a world shows at night. */
export interface StarSpec {
  /** Share of the sky's star cells that hold a star, 0 to 1. */
  readonly density: number;
  /** How strongly a milky river of stars crosses the sky, 0 to 1. */
  readonly river: number;
}

/**
 * A world's whole day. The hour is never chosen: it follows the person's own
 * clock, and `lightAt` in @gaia/realize reads the light between the keys.
 */
export interface DaySpec {
  /** Ordered by hour; the light wraps from the last key to the first across midnight. */
  readonly keys: readonly DayKey[];
  readonly moon: MoonSpec;
  readonly stars: StarSpec;
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
  Light: { input: null; output: DaySpec };
  Sky: { input: null; output: SkySpec };
  Season: { input: null; output: SeasonSpec };
  Atmosphere: { input: null; output: AtmosphereSpec };
  Ground: { input: null; output: GroundSpec };
  Accents: { input: null; output: AccentSpec };
  Wind: { input: null; output: WindSpec };
  Natives: { input: null; output: NativeFamilies };
  Footprint: { input: null; output: BuildingPlan };
  Walls: { input: BuildingPlan; output: Built };
  Roof: { input: BuildingPlan; output: Built };
  Openings: { input: BuildingPlan; output: Built };
  Dressing: { input: BuildingPlan; output: Built };
}

/** A door or window in a building's wall. */
export interface Opening {
  readonly kind: "door" | "window";
  /** Bottom center of the opening, on the wall's outer face. */
  readonly position: Vec3;
  /** Unit outward normal of the wall it is in; always level. */
  readonly normal: Vec3;
  readonly width: number;
  readonly height: number;
}

/**
 * A building's plan, which its walls, roof, openings and dressing all build
 * against, so they agree by construction. Local meters: the origin is the
 * center of the footprint at ground level, and the door faces +z.
 */
export interface BuildingPlan {
  /** Outer wall lengths along x and z. */
  readonly width: number;
  readonly depth: number;
  /** Floor level above the ground: the plinth that shows. */
  readonly floor: number;
  /** How far the foundation reaches below ground level, so uneven ground never shows a gap. */
  readonly footing: number;
  /** Floor to the top of the walls, where the eaves sit. */
  readonly wallHeight: number;
  /** The ridge's height above the top of the walls. */
  readonly rise: number;
  /** The axis the ridge runs along. */
  readonly ridge: "x" | "z";
  /** How settled and crooked the whole building is, 0 (square) to 1 (storybook), so every part leans alike. */
  readonly settle: number;
  readonly openings: readonly Opening[];
}

/** The palette families native to a region. Empty means every family. */
export interface NativeFamilies {
  readonly families: readonly string[];
}

export type Role = keyof Roles;
export type RoleInput<R extends Role> = Roles[R]["input"];
export type RoleOutput<R extends Role> = Roles[R]["output"];
