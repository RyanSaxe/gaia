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
  /** How far the vertex sags toward the ground about its `bough` joint as vitality falls, 0 to 1. */
  readonly droop: Float32Array;
  /** How far the vertex's color moves toward the decline swatch, 0 to 1. */
  readonly wither: Float32Array;
  /** How much the vertex shines when vitality is high, 0 to 1. */
  readonly glow: Float32Array;
  /**
   * The point each vertex's piece hangs from, xyz per vertex: where a leaf's
   * stalk meets its twig, a petal its flower. The piece collapses onto it,
   * and a leaf flutters about it in the wind.
   */
  readonly pivot: Float32Array;
  /**
   * What carries the vertex, xyz per vertex: the joint where its bough or
   * stem leaves the trunk or the ground. The whole bough, with everything
   * it carries, sags about this joint (`droop`) and bends about it in the
   * wind. Equal to `pivot` for a piece carried by nothing finer.
   */
  readonly bough: Float32Array;
  /**
   * The joint where the vertex's twig leaves its bough, xyz per vertex: the
   * twig and its leaves bend about it in the wind, on top of the bough's
   * bend. Equal to `bough` for a piece with no twig of its own.
   */
  readonly twig: Float32Array;
  /** How far the vertex folds toward its pivot at night, 0 to 1. Flowers close; most pieces never do. */
  readonly close: Float32Array;
  /**
   * How a piece falls as vitality drops, four per vertex: the axis it turns
   * about its pivot, scaled by the most it turns in radians, then the
   * vitality below which it starts to turn. A door swings ajar, a chimney
   * topples, a post leans. Absent means nothing falls.
   */
  readonly fall?: Float32Array;
  /**
   * The vitality below which a piece grows out of its pivot: ivy, weeds,
   * rubble and boards over windows. 0 means it never grows. Absent means none.
   */
  readonly grow?: Float32Array;
  /** How far a surface rots through into ragged holes as vitality drops, 0 to 1. Absent means none. */
  readonly rot?: Float32Array;
  /**
   * How a piece turns about its pivot while it is alive, three per vertex:
   * the axis scaled by turns per second. It slows as vitality falls and
   * stops near the bottom, like a mill wheel. Absent means nothing turns.
   */
  readonly spin?: Float32Array;
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
  /**
   * Where each vertex sits on a leaf card, three per vertex: across the card
   * (-1 to 1), along it, and the card's cut from `CUT`. The renderer cuts each
   * card to that leafy shape; a solid surface is all zeros.
   */
  readonly cutout: Float32Array;
  /**
   * The whole piece each vertex belongs to, two per vertex: the piece's number
   * in the part (0, 1, 2, ... in build order) and its size in meters, the side
   * of a square with half the piece's surface area. A piece is a connected run
   * of triangles, such as one leaf card, one limb or one petal; renderers thin
   * distant detail by leaving out whole pieces, smallest first.
   */
  readonly piece: Float32Array;
  readonly channels: VitalityChannels;
  readonly collision: "solid" | "walkable" | "none";
}

/**
 * The shapes a leaf card can be cut to. A cut's fraction carries the card's
 * own seed, so no two cards show the same leaves. A spray (cluster, oval,
 * lobed, umbels) is a stalk from the card's base (along -1) to its tip
 * (along 1) with leaves or flowers on short stalks along it: its base sits
 * on the twig that carries it, and as vitality falls each leaf drops in
 * place at its own threshold near the card's `loss`, so a spray never
 * shrinks or flies toward anything.
 */
export const CUT = {
  /** A solid surface: nothing is cut. */
  solid: 0,
  /** A spray of slender pointed leaves, like a birch's or a willow's. */
  cluster: 1,
  /** Small lance leaves hanging from a stem down the middle; along counts leaves. */
  strand: 2,
  /** A needle spray with a jagged fringe; along runs from 0 at the base to 1 at the tip. */
  needles: 3,
  /** A spray of small rounded oval leaves, like a cherry's or a box's. */
  oval: 4,
  /** A spray of palmate leaves with pointed lobes, like a maple's. */
  lobed: 5,
  /**
   * A patch laid on a surface, like moss on stone. Across is how deep in the
   * patch the vertex sits (0 at its edge, 1 at its heart) and along jitters
   * that edge; the patch recedes from its edge as vitality falls. It is never
   * a card: it does not fade when seen edge-on.
   */
  patch: 6,
  /**
   * The solid heart of a fir's frond, inside its needles: drawn dark, as
   * the shade between them. It is never a card: it does not thin when seen
   * edge-on.
   */
  core: 8,
  /** A spray in bloom: umbels of five-petaled flowers on fine stalks, with a few small fresh leaves, like a cherry's. */
  umbels: 9,
  /** A crowded cluster of overlapping rounded leaves around a short stalk, its rim leafy, like the leaves of a bush seen close. */
  crowded: 10,
  /** A full spray of slender pointed leaves fanned in two rings around a short stalk, nearly all leaf, like a birch's twig seen close. */
  crowdedPointed: 11,
  /** A full spray of broad lobed leaves, one in the middle and six about it, overlapping, like a maple's twig seen close. */
  crowdedLobed: 12,
  /** A full spray in bloom: umbels of five-petaled flowers crowded around a short stalk, with a few small fresh leaves. */
  crowdedUmbels: 13,
} as const;

/** The cuts that are sprays: their leaves drop in place rather than collapsing onto the pivot. */
export const SPRAYS: ReadonlySet<number> = new Set([CUT.cluster, CUT.oval, CUT.lobed, CUT.umbels, CUT.crowded, CUT.crowdedPointed, CUT.crowdedLobed, CUT.crowdedUmbels]);

export interface Anchor {
  readonly position: Vec3;
  readonly normal: Vec3;
  /** Relative size of what may attach here, 0 to 1. */
  readonly size: number;
  /**
   * What carries the anchor, so what grows on it moves with it: the joints
   * of its bough and twig (as the `bough` and `twig` channels) and how far
   * the bough droops there. Absent for an anchor carried by nothing that moves.
   */
  readonly carry?: { readonly bough: Vec3; readonly twig: Vec3; readonly droop: number };
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
  /** How far each blade leans from upright: 0 stands straight, 1 lies flat. */
  readonly lean: number;
  /** A blade's outline: 0 is a pointed blade, 1 a round leaf. */
  readonly round: number;
  /** How far a blade arcs over toward its tip, 0 to 1. */
  readonly bend: number;
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
  /** How gusty the world is, 0 to 1. Nothing reads it yet: the gusts come from the one wind field (`gustAt`), the same in every world. */
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
  /** What sets a building apart and says what it does: a turning waterwheel, a tower. */
  Feature: { input: BuildingPlan; output: Built };
  /** A rock's body: a boulder, a stone, a cluster or an outcrop. */
  Rock: { input: null; output: Built };
  /** What grows over another piece's upward faces, such as moss on stone. */
  Overgrowth: { input: Built; output: Built };
  /** A drift of small plants at ground level, such as wildflowers. */
  Drift: { input: null; output: Built };
  /** How a trail between two places looks and runs. The terrain routes it; geometry follows the route. */
  Route: { input: null; output: RouteSpec };
  /** A great thing a person can steer by from far away, such as a tower or a ring of standing stones. */
  Landmark: { input: null; output: Built };
}

/**
 * A trail's look, in numbers the terrain and the ground shader read. The
 * route itself is never chosen: the terrain finds it over the ground.
 */
export interface RouteSpec {
  /** Width of the worn tread, meters. */
  readonly width: number;
  /** How bare the tread is worn, 0 (grassed over) to 1 (bare earth). */
  readonly wear: number;
  /** What lines the tread's edges. */
  readonly edging: "none" | "stones";
  /** How freely the trail wanders off the easiest line, 0 to 1. */
  readonly winding: number;
  /** How the trail crosses a stream. */
  readonly crossing: "stepping-stones" | "footbridge";
}

/** A door or window in a building's wall. */
export interface Opening {
  readonly kind: "door" | "window";
  /** The mass whose wall it is in, as an index into the plan's masses. */
  readonly mass: number;
  /** Bottom center of the opening, on the wall's outer face. */
  readonly position: Vec3;
  /** Unit outward normal of the wall it is in; always level. */
  readonly normal: Vec3;
  readonly width: number;
  readonly height: number;
}

/**
 * The form of one mass's roof: two slopes meeting at a ridge over gable
 * walls; four slopes with no gables; gables whose tops are hipped back; one
 * slope against a taller wall; or a cone over a round turret.
 */
export type RoofForm = "gable" | "hip" | "half-hip" | "lean-to" | "cone";

/**
 * One volume of a building: walls standing on a rectangle (or on a round
 * turret's octagon) under a roof of its own. A building is one mass or
 * several joined ones that overlap where they meet, so a wall inside another
 * mass never shows and walls and roofs agree by construction.
 */
export interface Mass {
  /** Center of its footprint in the building's frame. */
  readonly x: number;
  readonly z: number;
  /** Outer wall lengths along x and z; a round mass is `width` across. */
  readonly width: number;
  readonly depth: number;
  readonly round: boolean;
  /** Floor to the top of its walls, where its eaves sit. */
  readonly wallHeight: number;
  /** How many storeys its walls hold, for windows and floor beams. */
  readonly storeys: number;
  /** The roof's height above the top of its walls. */
  readonly rise: number;
  /** The axis its ridge runs along; a lean-to's high side runs along it. */
  readonly ridge: "x" | "z";
  readonly roof: RoofForm;
  /** The side across its span a lean-to's slope falls toward. */
  readonly fall: 1 | -1;
  /** Whether each end of its ridge (toward -, toward +) stands free; a hipped roof hips only free ends, so a range of joined masses reads as one roof. */
  readonly ends: readonly [boolean, boolean];
}

/**
 * A building's plan, which its walls, roof, openings and dressing all build
 * against, so they agree by construction. Local meters: the origin is the
 * center of the whole footprint at ground level, and the door faces +z.
 */
export interface BuildingPlan {
  /** The whole footprint's extent along x and z, centered on the origin. */
  readonly width: number;
  readonly depth: number;
  /** Floor level above the ground: the plinth that shows. */
  readonly floor: number;
  /** How far the foundation reaches below ground level, so uneven ground never shows a gap. */
  readonly footing: number;
  /** The building's volumes; the first is its main body, whose front wall holds the door. */
  readonly masses: readonly Mass[];
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
