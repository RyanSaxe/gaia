// The types primitives produce and consume. They hold plain typed arrays and
// numbers, so they cross worker boundaries and hash without Three.js.

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
   * The point each vertex's piece hangs from, xyz per vertex, such as where a
   * leaf's stalk meets its twig or a petal meets its flower. The piece
   * collapses onto it, and a leaf flutters about it in the wind.
   */
  readonly pivot: Float32Array;
  /**
   * The joint where the vertex's bough or stem leaves the trunk or the ground,
   * xyz per vertex. The whole bough, with everything on it, sags about this
   * joint (`droop`) and bends about it in the wind. Equal to `pivot` for a
   * piece attached to nothing finer.
   */
  readonly bough: Float32Array;
  /**
   * The joint where the vertex's twig leaves its bough, xyz per vertex. The
   * twig and its leaves bend about it in the wind, on top of the bough's
   * bend. Equal to `bough` for a piece with no twig of its own.
   */
  readonly twig: Float32Array;
  /** How far the vertex folds toward its pivot at night, 0 to 1. Flowers close, and most pieces never do. */
  readonly close: Float32Array;
  /**
   * How a piece falls as vitality drops, four per vertex: the axis it turns
   * about its pivot, scaled by its largest turn in radians, then the vitality
   * below which it starts to turn. For example, a door swings ajar, a chimney
   * topples or a post leans. Absent means nothing falls.
   */
  readonly fall?: Float32Array;
  /**
   * The vitality below which a piece grows out of its pivot, such as ivy,
   * weeds, rubble and boards over windows. 0 means it never grows. Absent
   * means no piece grows.
   */
  readonly grow?: Float32Array;
  /** How far a surface rots through into ragged holes as vitality drops, 0 to 1. Absent means none. */
  readonly rot?: Float32Array;
  /**
   * The grain a surface rots along, three per vertex: the vertex's position
   * across the surface's courses and up them, counted in tiles, bundles,
   * patches, stones or boards, and the surface's kind (`GRAIN`). Rot then
   * opens holes a whole piece at a time, so their edges step along the
   * courses instead of curving smoothly. A piece breaks away from the edge
   * where the second number's fraction is 0. Absent means rot follows a noise
   * of the rest position.
   */
  readonly grain?: Float32Array;
  /**
   * How a piece turns about its pivot, three per vertex: the axis scaled by
   * turns per second. It slows as vitality falls and stops near 0, like a
   * mill wheel. Absent means nothing turns.
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
   * Where each vertex is on a leaf card, three per vertex: across the card
   * from -1 to 1, along it, and the card's cut from `CUT`. The renderer cuts
   * each card to that shape. A solid surface is all zeros.
   */
  readonly cutout: Float32Array;
  /**
   * The whole piece each vertex belongs to, two per vertex: the piece's number
   * in the part, counting from 0 in build order, and its size in meters, which
   * is the side of a square with half the piece's surface area. A piece is a
   * connected run of triangles, such as one leaf card, one limb or one petal.
   * Renderers thin distant detail by leaving out whole pieces, smallest first.
   */
  readonly piece: Float32Array;
  readonly channels: VitalityChannels;
  readonly collision: "solid" | "walkable" | "none";
}

/**
 * The kinds of surface for `grain`, which set how a surface comes apart as it
 * rots. Each kind loses one piece at a time, a piece the size of the shader's
 * cell for that kind (`grainSize` in @gaia/render).
 */
export const GRAIN = {
  /** No grain. Rot opens holes where a noise of the rest position falls below `rot`. */
  none: 0,
  /** Tiles, slates or shingles laid in courses that break joint. */
  tiles: 1,
  /** Straw laid in courses. */
  straw: 2,
  /** Plaster, which falls away in patches about a hand and a half across. */
  plaster: 3,
  /** Stones or rubble laid in courses that break joint, which fall a block at a time. */
  stones: 4,
  /** Boards, which fall away a board length at a time. */
  boards: 5,
} as const;

/**
 * The shapes a leaf card can be cut to. A cut's fraction holds the card's own
 * seed, so no two cards show the same leaves. A spray, such as `cluster`,
 * `oval`, `lobed` or `umbels`, is a stalk from the card's base at along -1 to
 * its tip at along 1, with leaves or flowers on short stalks along it. Its
 * base is on the twig it grows from. As vitality falls, each leaf drops in
 * place at its own threshold near the card's `loss`, so a spray never shrinks
 * or moves toward its pivot.
 */
export const CUT = {
  /** A solid surface: nothing is cut. */
  solid: 0,
  /** A spray of slender pointed leaves, like a birch's or a willow's. */
  cluster: 1,
  /** Small lance leaves hanging from a stem down the middle. `along` counts leaves. */
  strand: 2,
  /** A needle spray with a jagged fringe. `along` runs from 0 at the base to 1 at the tip. */
  needles: 3,
  /** A spray of small rounded oval leaves, like a cherry's or a box's. */
  oval: 4,
  /** A spray of palmate leaves with pointed lobes, like a maple's. */
  lobed: 5,
  /**
   * A patch laid on a surface, like moss on stone. `across` is how far into
   * the patch the vertex is, from 0 at its edge to 1 at its center, and
   * `along` jitters that edge. The patch recedes from its edge as vitality
   * falls. It is never a card, so it does not fade when seen edge-on.
   */
  patch: 6,
  /**
   * The solid center of a fir's frond, inside its needles. No primitive
   * writes this cut now. It is never a card, so it does not thin when seen
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
   * The bough and twig joints the anchor is attached to, as in the `bough`
   * and `twig` channels, and how far the bough droops there, so what grows on
   * the anchor moves with it. Absent for an anchor attached to nothing that
   * moves.
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
// A repository has one art direction. Its specs are plain numbers and colors
// that the world composer combines and every material reads.

/**
 * A shift of one color in OKLCh. It pulls the hue toward `hue`, in degrees,
 * by `pull` but never more than `maxTurn` degrees, scales chroma by `chroma`
 * and offsets lightness by `lightness`.
 */
export interface ColorShift {
  readonly hue: number;
  readonly pull: number;
  readonly maxTurn: number;
  readonly chroma: number;
  readonly lightness: number;
}

/** The sun and moon at one hour, and the hour's effect on the sky. */
export interface LightSpec {
  /** Unit vector toward the sun. It points below the horizon at night. */
  readonly sunDirection: Vec3;
  readonly sunColor: Rgb;
  /** Zero once the sun is below the horizon. */
  readonly sunIntensity: number;
  /** Unit vector toward the moon. */
  readonly moonDirection: Vec3;
  /** The moon's light on the land, a dim cool key. */
  readonly moonColor: Rgb;
  readonly moonIntensity: number;
  /** 0 by day, 1 in deep night. The lantern, the stars and the world's own glow fade in with it. */
  readonly nightness: number;
  readonly ambientColor: Rgb;
  readonly ambientIntensity: number;
  /** Shadows are tinted, never black. */
  readonly shadowColor: Rgb;
  readonly celBands: number;
  readonly celSoftness: number;
  /** The color the hour adds to the horizon. `glow` sets how much. */
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
 * A world's whole day. Nothing chooses the hour. It follows the person's own
 * clock, and `lightAt` in @gaia/realize interpolates the light between the keys.
 */
export interface DaySpec {
  /** Ordered by hour. The light wraps from the last key to the first across midnight. */
  readonly keys: readonly DayKey[];
  readonly moon: MoonSpec;
  readonly stars: StarSpec;
}

/** Cloud shape as numbers that one shader reads, with no branches per cloud form. */
export interface CloudSpec {
  /** Noise frequency over the sky projection. */
  readonly scale: number;
  /** East-west stretch. Above 1 draws streaks. */
  readonly stretch: number;
  /** Noise level above which there is cloud. */
  readonly threshold: number;
  readonly softness: number;
  /** Lowest and highest sky elevation where clouds form, as sin(elevation). */
  readonly low: number;
  readonly high: number;
  readonly opacity: number;
  /**
   * How overcast the sky is, 0 to 1, or absent on a fair sky. An overcast sky greys its clouds and darkens their
   * undersides, brightens the sky seen through its breaks, and dims and cools the sun's light so shadows soften.
   */
  readonly overcast?: number;
  /** How strongly the sun side brightens and the far side shades, 0 to 1. */
  readonly billow: number;
  /** Breaks the cover into small cells, like a mackerel sky, 0 to 1. */
  readonly cells: number;
  /** 0 spreads clouds across the dome. 1 sets them on the horizon, like towers and banks. */
  readonly horizon: number;
}

export interface SkySpec {
  readonly zenith: Rgb;
  readonly horizon: Rgb;
  readonly clouds: CloudSpec;
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
  /** 0 is an even carpet, and 1 is tufts on bare soil. */
  readonly clump: number;
  /** How far each blade leans from upright, from 0 for straight to 1 for flat. */
  readonly lean: number;
  /** A blade's outline, from 0 for a pointed blade to 1 for a round leaf. */
  readonly round: number;
  /** How far a blade arcs over toward its tip, 0 to 1. */
  readonly bend: number;
  /** Fraction of blades that carry a flower. */
  readonly flowers: number;
  readonly flowerColors: readonly Rgb[];
}

export type AccentForm = "petals" | "fireflies" | "leaves";

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
}

/**
 * Every role a slot can declare, with what its primitive consumes and produces.
 * A slot declared with `on: "form"` takes the output of slot "form" as its input.
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
  /** The part that sets a building apart and shows what it does, such as a turning waterwheel or a tower. */
  Feature: { input: BuildingPlan; output: Built };
  /** A rock's body: a boulder, a stone, a cluster, an outcrop, a fallen log or a stump. */
  Rock: { input: null; output: Built };
  /** What grows over another piece's upward faces, such as moss on stone. */
  Overgrowth: { input: Built; output: Built };
  /** A drift of small plants at ground level, such as wildflowers. */
  Drift: { input: null; output: Built };
  /** How a trail between two places looks. The terrain routes it, and its geometry follows the route. */
  Route: { input: null; output: RouteSpec };
  /** A large structure a person can navigate by from far away, such as a tower or a ring of standing stones. */
  Landmark: { input: null; output: Built };
}

/**
 * A trail's look, in numbers the terrain and the ground shader read. The
 * route itself is never chosen. The terrain finds it over the ground.
 */
export interface RouteSpec {
  /** Width of the worn tread, meters. */
  readonly width: number;
  /** How bare the tread is worn, from 0 for grassed over to 1 for bare earth. */
  readonly wear: number;
  /** What lines the tread's edges. */
  readonly edging: "none" | "stones";
  /** How far the trail may depart from the easiest line, 0 to 1. */
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
  /** Unit outward normal of the wall it is in. It is always level. */
  readonly normal: Vec3;
  readonly width: number;
  readonly height: number;
}

/**
 * The form of one mass's roof. `gable` is two slopes meeting at a ridge over
 * gable walls, `hip` is four slopes with no gables, `half-hip` is gables whose
 * tops are hipped back, `lean-to` is one slope against a taller wall, and
 * `cone` covers a round turret.
 */
export type RoofForm = "gable" | "hip" | "half-hip" | "lean-to" | "cone";

/**
 * One volume of a building: walls on a rectangle, or on a round turret's
 * octagon, under a roof of its own. A building is one mass or several joined
 * masses that overlap where they meet, so a wall inside another mass never
 * shows and walls and roofs agree by construction.
 */
export interface Mass {
  /** Center of its footprint in the building's frame. */
  readonly x: number;
  readonly z: number;
  /** Outer wall lengths along x and z. A round mass is `width` across. */
  readonly width: number;
  readonly depth: number;
  readonly round: boolean;
  /** Height from the floor to the top of its walls, where its eaves are. */
  readonly wallHeight: number;
  /** How many storeys its walls hold, for windows and floor beams. */
  readonly storeys: number;
  /** The roof's height above the top of its walls. */
  readonly rise: number;
  /** The axis its ridge runs along. A lean-to's high side runs along it too. */
  readonly ridge: "x" | "z";
  readonly roof: RoofForm;
  /** The side across its span a lean-to's slope falls toward. */
  readonly fall: 1 | -1;
  /** Whether each end of its ridge, toward - and toward +, is free. A hipped roof hips only free ends, so a range of joined masses reads as one roof. */
  readonly ends: readonly [boolean, boolean];
}

/**
 * A building's plan, which its walls, roof, openings and dressing all build
 * against, so they agree by construction. In local meters, the origin is the
 * center of the whole footprint at ground level, and the door faces +z.
 */
export interface BuildingPlan {
  /** The whole footprint's extent along x and z, centered on the origin. */
  readonly width: number;
  readonly depth: number;
  /** Floor level above the ground, which shows as a plinth. */
  readonly floor: number;
  /** How far the foundation reaches below ground level, so uneven ground never shows a gap. */
  readonly footing: number;
  /** The building's volumes. The first is its main body, whose front wall has the door. */
  readonly masses: readonly Mass[];
  /** How settled and crooked the whole building is, from 0 for square to 1 for storybook, so every part leans alike. */
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
