// Creates the world a person walks at eye height. Worker threads bake the
// regions Jev chose into one heightfield and place the buildings, landmarks,
// trails, trees and understory, so the page keeps drawing while a world bakes.
// Tapping a thing that represents code opens its journal page. Scripted checks
// read the world through `WorldInside` and the hooks in `hooks.ts`.

import * as THREE from "three";
import { type AtmosphereSpec, type Blueprint, type BuildingPlan, type GroundSpec, Library, type Palette, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, LANDMARK_PRIMITIVES, RELIEF_PRIMITIVES, ROCK_PRIMITIVES, WILDFLOWER_PRIMITIVES, WORLD_PRIMITIVES } from "@gaia/primitives";
import { biome, landmark as landmarkKind, world as worldKind } from "@gaia/kinds";
import { CLEAR_AIR, type Realized, type RegionLook, type SkyLook, airFromHeight, gustAt, mergeParts, mixAir, murkyAir, realizeRegion, realizeSky, regionAir, spinAt, throughAir } from "@gaia/realize";
import {
  LANTERN,
  type PlantView,
  applyLight,
  CARD,
  FAR_BAKE_VERSION,
  createLantern,
  createPlant,
  createRenderer,
  createSceneLight,
  createSunShadow,
  closeEachFrame,
  easeVitality,
  followVitality,
  type SceneLight,
} from "@gaia/render";
import { type Capsule, clearanceAt, groundDecline, regionAt as dominantRegion, frameOf, TILE, LAND_ASPECT, type Deck, decksOf, deckShape, type Floor, floorOf, type Footbed, EYE_HEIGHT, footingAt, GAIT, groundHeightAt, heightAt, type Intent, NO_SOLIDS, NO_TRAILS, openingSpot, TRAILS, outlineShape, returnTo, type Station, type LastSpot, withinLand, piecesShapes, type Place, placeAt, planWalk, regionWeights, siteToWorld, type Solids, type SolidShape, solidsOf, standAt, steerAlong, type Steered, type Steering, steering, steerPress, steerRelease, steerStep, stride, type Stride, acrossWay, carry, planTrip, TRAVEL, type Travel, hurryFor, wadingAt, fordBeside, travelFrom, travelPoint, travelStep, type Trip, trailWay, type Walker, type WalkKey, type Terrain, TERRAIN, type TrailNetwork, type Walk, WALK_TO, wallsShape, waterDepthAt, type Way, wayAhead, WILDS, type WorldPlaces, type WorldSpec } from "@gaia/terrain";
import { type Sky, createSky } from "../world/environment.ts";
import { type CaptureBounds, type Pixels, createCapture } from "./capture.ts";
import { onTap, tapSlop } from "../tap.ts";
import { type Grass, createGrass } from "./cover.ts";
import { type GroundMesh, createGround, createGroundTexture } from "./ground.ts";
import { createRegionCovers } from "./regions.ts";
import { type Water, createWater } from "./water.ts";
import { type WildGrowth, createWildGrowth } from "./wilds.ts";
import { type Crown, type Drifts, createDrifts } from "./drifts.ts";
import { type Understory, createUnderstory, understoryBuilds } from "./understory.ts";
import { type PlantMark, markOf } from "./plant-mark.ts";
import { type BuildAsk, made, makeAhead, makeLater, plantAsk } from "./made.ts";
import { createClearings } from "./clearings.ts";
import { type WayPiece, type Ways, createWays, crossingVitality, setTrailEnds } from "./trails.ts";
import { reportStage } from "../telemetry.ts";
import { takeWait } from "../wait/wait.ts";
import { withStart } from "../start/start.ts";
import { START_SKY } from "../start/table-scene.ts";
import type { Represented } from "./represent.ts";
import { type CodeWorld, vitalityOf, withLines, withVitality } from "@gaia/world";
import { type OpenedWorld, type PlantGroup, codeWorld, onVitalityUpdate } from "./code-world.ts";
import type { JudgedThing } from "../../world-service/protocol.ts";
import { type Building, type Settlement, composedName, createSettlement, settlementBuilds } from "./settlement.ts";
import { type Signs, createSigns } from "./signs.ts";
import { type Baked, createBaker } from "./baker.ts";
import { type PageLand, createPageLand } from "./land.ts";
import { type ThingTiles, createThingTiles } from "./thing-tiles.ts";
import { AS_THING, type Placed, type PlaceRequest, type PlacedLandmark, landmarkBase, landmarkFeet, ownerVitality, understoryVitality } from "./place.ts";
import { declineAround, groundVitalityAt, setGroundOwnership, showGroundVitality } from "./vitality.ts";
import type { Drawn, Pass } from "./measure.ts";
import { type Copies, FAR_SLOTS, type FarForms, type FarOf, type PassSize, createCopies, createFarForms } from "./woods.ts";
import { openFarStore } from "./far-store.ts";
import { type FarStream, createFarStream } from "./far-stream.ts";

const TEMPLATE = /* html */ `
<main class="stage">
  <canvas class="view" aria-label="A world of gentle landforms. Click or tap the ground to walk there, and drag to look."></canvas>
  <div class="veil" aria-label="The world is being made"></div>
</main>
`;


/** Key codes for walking ahead, left, right or back, as W A S D, the arrows or vim's k h j l, and Shift to hurry. */
const KEYS = {
  ahead: ["KeyW", "ArrowUp", "KeyK"],
  left: ["KeyA", "ArrowLeft", "KeyH"],
  right: ["KeyD", "ArrowRight", "KeyL"],
  back: ["KeyS", "ArrowDown", "KeyJ"],
  hurry: ["ShiftLeft", "ShiftRight"],
} as const;
/** Radians the view turns per pixel of drag, applied directly with no easing or drift. */
const LOOK = 0.0045;
/** Maps each key code to its `WalkKey` for steering. */
const STEER_KEYS = new Map<string, WalkKey>([...(["ahead", "left", "right", "back"] as const).flatMap((way) => KEYS[way].map((code) => [code, way] as const)), ...KEYS.hurry.map((code) => [code, "shift"] as const)]);
/** The keys that walk or turn, which excludes Shift. */
const WALK_KEYS = new Set<string>([...KEYS.ahead, ...KEYS.left, ...KEYS.right, ...KEYS.back]);
/** Meters a tap's ray searches for the ground. */
const REACH = 900;
/** The share of each understory component's ground outline that blocks a walker: all of a rock, and the inner 70% of a bush, so the walk brushes its outer leaves. */
const STOPS: Readonly<Record<string, number>> = { rocks: 1, shrubs: 0.7 };
/** A walker steps over a stone whose top is less than this many meters above the ground, rather than walking around it. */
const STEP_OVER = 0.5;
/** Minimum meters between the lantern and the water while swimming. */
const LANTERN_ABOVE_WATER = 0.15;
/** Walking this far from where a card opened closes it, meters. */
const LEAVE_CARD = 4;
/**
 * Standing still at a thing opens its card, as walking up to it does. A
 * building or landmark opens after `great` seconds and anything smaller after
 * `small`, so walking through a grove or a drift of flowers opens none. A
 * thing is in reach when the person is within the walk-up distance plus
 * `slack` meters, and its center is within `view` radians of the view's
 * center beyond its own angular width. Of those, the one nearest the view's
 * center is the one the person stopped at.
 */
const STOP_AT = { great: 0.6, small: 1.5, slack: 2, view: 0.45 };
/** Meters a second below which the person counts as standing still. */
const STILL = 0.25;
/** Approximate height in meters of the furnishings a tap can hit, such as fingerposts and boundary stones. */
const FURNISHING_TOP = 2.4;

/** The build of one distinct tree blueprint. Every tree with that blueprint is a copy of it. */
export interface TreeVariant {
  /** Radius of the trunk's bottom ring, for grounding. */
  readonly base: number;
  /** The trunk's radius at its base, which blocks a walker. */
  readonly trunk: number;
  readonly height: number;
  /** How far the crown reaches from the trunk. */
  readonly radius: number;
}

/** Something a person can walk up to and ask about: a building or a tree. */
export interface Subject {
  readonly represented: Represented;
  /** Its form in the world, such as "a watermill". */
  readonly formName: string;
  /** For a tree, bush, stone or flowers, its build's name from its parts (`composedName`). Other things may share it. */
  readonly built?: string;
  /** Its position. `readingSpot` gives where a person stops to read its sign, which for a tree depends on where they come from. */
  readonly x: number;
  readonly z: number;
  readonly readingSpot: (fromX: number, fromZ: number) => { x: number; z: number };
  /** Height in meters, for aiming at it and framing its painting. */
  readonly height: number;
  /** Radius in meters from its center, used for pointer hits and the rim light. */
  readonly reach: number;
  /** How long a person stands still at it before its card opens, seconds (`STOP_AT`). */
  readonly stop: number;
}

/** One tree's position and the build it copies. */
export interface Tree {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly variant: number;
  readonly scale: number;
  readonly yaw: number;
  /** The ground's slope under it, passed to its copy. */
  readonly slope: readonly [number, number];
  /** Index into the world's symbols of the definition, file or entity it represents. */
  readonly symbol: number;
  readonly represented: Represented;
}

/** A placed tree, stone, bush or drift: its position, vitality, scale relative to its build, and the build. */
export interface BakedPlant {
  readonly x: number;
  readonly z: number;
  readonly vitality: number;
  readonly scale: number;
  readonly build: PlantMark;
}

/** The world after a bake, as the map draws it and places markers beside it. */
export interface BakedWorld {
  readonly terrain: Terrain;
  /** The paths' ways of tread. */
  readonly ways: readonly Way[];
  /** Each building, with the plan, blueprint and colors its map mark is drawn from. */
  readonly buildings: readonly { readonly x: number; readonly z: number; readonly name: string; readonly kind: string; readonly vitality: number; readonly plan: BuildingPlan; readonly blueprint: Blueprint; readonly palette: Palette }[];
  /** Each landmark, with the blueprint and colors its map mark is drawn from. */
  readonly landmarks: readonly { readonly x: number; readonly z: number; readonly name: string; readonly vitality: number; readonly blueprint: Blueprint; readonly palette: Palette }[];
  /** Each tree, with the build its map mark is drawn from. */
  readonly trees: readonly BakedPlant[];
  /** Each stone, bush and drift of flowers, in the same form as `trees`. */
  readonly understory: readonly BakedPlant[];
  /** Each area's ground cover by path, which the ground shader paints its ground with. */
  readonly grounds: ReadonlyMap<string, GroundSpec>;
  /**
   * Where the layout put each building and landmark: the center of its lot (`CodeThing`), as the wait screen
   * receives it with the land, or its position in a world not laid out from code. The map sheets place their names
   * clear of these points.
   */
  readonly lots: readonly { readonly x: number; readonly z: number }[];
}

/** Things another layer places in the world on each bake: the ground they keep bare and the solids that block a walker. */
export interface Furnishing {
  readonly capsules: readonly Capsule[];
  readonly solids: readonly SolidShape[];
}
const UNFURNISHED: Furnishing = { capsules: [], solids: [] };

/** What the immersive layer reads from the world, and the few ways it controls it. */
export interface WorldHandle {
  readonly scene: THREE.Scene;
  readonly light: SceneLight;
  readonly camera: THREE.PerspectiveCamera;
  /** The person's position, their yaw in radians with 0 facing -z, and whether they are moving. */
  person(): { readonly x: number; readonly z: number; readonly yaw: number; readonly walking: boolean };
  /** What the world sounds like at the person's position now (`app/renderer/sound/`). */
  earshot(): Earshot;
  /** The area and file patch at a point. */
  placeAt(x: number, z: number): Place;
  /** Every area and file patch of the current world. */
  places(): WorldPlaces;
  /** The code layout of the current world, or null for a world not laid out from code. */
  code(): CodeWorld | null;
  /** The current world as of its last bake. */
  baked(): BakedWorld;
  /** Calls `listener` after every bake. */
  onBaked(listener: () => void): void;
  /** Calls `listener` once the wait screen lifts from the first world. */
  onLifted(listener: () => void): void;
  /** Sets `furnisher`, which each bake calls after routing the trails and before placing anything else, to get what to place beside them. */
  furnish(furnisher: (baked: BakedWorld) => Furnishing): void;
  /** Sets whether the furnishing blocks a walker, which it should while it shows. */
  furnishingSolid(on: boolean): void;
  /**
   * Where a person sent from the map to (x, z) lands, or null if no spot
   * nearby fits. On or beside a building, they land where its sign is read,
   * facing it. Elsewhere they land on the nearest dry ground clear of every
   * solid in the same area, and in the wild only if (x, z) is in the wild.
   * They face along a nearby trail, else toward the area's building or
   * landmark, else toward `center`.
   */
  landing(x: number, z: number, center?: { readonly x: number; readonly z: number }): Landing | null;
  /** Moves the person to a landing at once. Call it only behind a transition, so nothing visibly jumps. Resolves once the land around them has loaded. */
  place(at: Landing): Promise<void>;
  /** Resolves once the land and everything within sight of (x, z) have loaded, as a jump waits for them. */
  around(x: number, z: number): Promise<void>;
  /**
   * Sends the person along the trails or straight across the land to a
   * landing, streaming the world in around them, until they arrive or press a
   * key. With `face`, they end facing the landing's yaw. Returns false,
   * moving nothing, when neither route reaches it.
   */
  travel(at: Landing, face: boolean): boolean;
  /** The trip under way, or null once it arrives (`at.done`) or the person takes over. */
  trip(): Readonly<TripUnderWay> | null;
  /**
   * Sets whether paper hides the world, which lets the trip under way hurry.
   * When on, the trip goes at the multiple of its pace that arrives within
   * `TRAVEL.underBook` seconds (`hurryFor`), along the same way, and waits on
   * nothing the person would see. When off, it continues at its own pace and
   * steering from where it is.
   */
  hurry(on: boolean): void;
  /**
   * Renders a thing for its journal painting, `w` by `h` pixels, in the
   * afternoon light from a spot where it is visible, with a mask of the
   * thing's own pixels. `id` is an entity's path, a file's path or a
   * definition's id, and the view shows the building, landmark, tree, plant
   * or stone that represents it. A file with no tree of its own is shown
   * through its tallest definition. `wide` frames it low under a wide sky for
   * the title page, with nothing in front of it. Waits for a changing world
   * to settle. Returns null when nothing represents the id.
   */
  view(id: string, w: number, h: number, wide?: boolean): Promise<{ readonly color: Pixels; readonly mask: Pixels } | null>;
  /** Renders the person's own view, `w` by `h`, as a painting: from their eye and facing, in the afternoon light, with nothing masked. Waits for a changing world to settle. */
  look(w: number, h: number): Promise<{ readonly color: Pixels; readonly mask: Pixels }>;
  /** The spot and facing a thing's painting is rendered from, where tapping its picture in the journal takes the person. Null when nothing represents it. */
  seenFrom(id: string): Landing | null;
  /** What the understanding pass judged about a folder, a file or a definition, every score from 0 to 1. */
  thing(of: string): JudgedThing | undefined;
  /**
   * Calls `listener` with the ids of changed things once vitality changes live (`setVitality`), as when the world
   * refreshes onto a new commit. From then on, `code`, `places`, `baked` and `thing` return the new values.
   */
  onVitality(listener: (changed: readonly string[]) => void): void;
  /** Calls `listener` with what a person has walked up to when its card opens, and with null when it closes. */
  onCard(listener: (thing: CardThing | null) => void): void;
  /**
   * Calls `listener` with the path or id that a tapped thing represents. Once
   * a listener exists, tapping a thing no longer walks the person to it, and
   * the listener opens it instead.
   */
  onPick(listener: (id: string) => void): void;
  /**
   * Calls `listener` with the thing the person walks up to, from the tap that
   * sends them and while its card shows. Calls it with null once they turn to
   * something else or the card closes.
   */
  onHeading(listener: (thing: Heading | null) => void): void;
}

/** A sound source's distance in meters, and its bearing in degrees from the view direction, positive to the right. */
export interface Heard {
  readonly d: number;
  readonly bearing: number;
}

/** What the person can hear at their position, not how the sound plays. */
export interface Earshot {
  /** Ground speed in m/s, and whether a trip is moving them. */
  readonly speed: number;
  readonly travelling: boolean;
  /** What is underfoot, and the water depth at their legs in meters. */
  readonly underfoot: "ground" | "deck" | "water";
  readonly depth: number;
  /** Darkness for the hour, 0 by day to 1 at night. */
  readonly night: number;
  /** Wind strength at the person, 0 to 1 (`gustAt`). */
  readonly gust: number;
  /** How much the ground around them has declined, 0 to 1, as the air's murk uses it. */
  readonly decline: number;
  /** The share of the sky overhead covered by trees, 0 in the open to 1 deep in a wood. */
  readonly canopy: number;
  /** The nearest running water, with distance measured from its bank, and its width in meters. */
  readonly stream: (Heard & { readonly width: number }) | null;
  /** The nearest waterwheel, and how fast it turns, 0 stopped to 1. */
  readonly mill: (Heard & { readonly turning: number }) | null;
}

/** A thing the person is walking up to: its position, radius and name. */
export interface Heading {
  readonly x: number;
  readonly z: number;
  readonly reach: number;
  readonly name: string;
}

/** What a person walked up to: what it represents, and its form in the world, such as "A watermill". */
export interface CardThing {
  readonly represented: Represented;
  readonly formName: string;
}

/** Where a person lands, and their yaw in radians with 0 facing -z. */
export interface Landing {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** A built landmark: its key in the view pool, name, blueprint, build, base radius and ground contact points (`landmarkFeet`). */
export interface Landmark {
  readonly key: string;
  readonly name: string;
  readonly blueprint: Blueprint;
  readonly built: Realized;
  readonly base: number;
  readonly feet: ReturnType<typeof landmarkFeet>;
}

/** The placed landmarks and the trail network between every place, from the last bake. */
export interface Settled {
  readonly sites: readonly PlacedLandmark[];
  readonly network: TrailNetwork;
  /** Each way's edging stones, set by the bake on the whole land. */
  readonly edging?: Placed["edging"];
}

/** A set of plants with far forms, and the stream that loads those forms into the cards' slots. */
export interface FarSet {
  readonly forms: FarForms;
  readonly stream: FarStream;
}

/**
 * A trip in progress (`travelStep`): its plan, the person's position on it,
 * whether they pressed a key, and the marks the world loads ahead along the
 * way. There is a mark every `TRAVEL_MARK` meters, requested from the
 * layers once the trip comes within `TRAVEL_LOOK` of it.
 */
export interface TripUnderWay {
  readonly plan: Trip;
  at: Travel;
  stopping: boolean;
  readonly marks: { readonly s: number; asked: boolean; ready: boolean }[];
  readonly began: number;
  /** The multiple of its own pace the trip goes while the world is hidden (`hurryFor`), or null while the world is visible. */
  hurry: number | null;
  setOff: number | null;
  waited: number;
}

/** How the last trip ended, for measuring: arrived or stopped, how far along, and the held keys and tap walk at that moment. */
export interface TripEnd {
  done: boolean;
  s: number;
  length: number;
  keys: string[];
  goal: boolean;
  by?: string;
}

/** The way a trip takes to a landing, the meters walked off the tread at each end, and which route it took (`travelWay`). */
export interface TripWay {
  way: Walker[];
  off: { start: number; end: number };
  by: "near" | "trails" | "across";
}

/** A view position separate from the person: the eye's position, height and direction. */
export interface ViewPin {
  readonly x: number;
  readonly z: number;
  readonly eye: number;
  readonly yaw: number;
  readonly pitch: number;
}

/** The air last applied at the eye: the ground's decline around it, the eye's height above the land, and the resulting air. */
export interface AppliedAir {
  readonly decline: number;
  readonly height: number;
  readonly air: AtmosphereSpec;
}

/** A bark vertex lower than this, meters, belongs to the trunk's base where it meets the ground. */
const TRUNK_BASE = 0.05;
/** Landing limits in meters: the water depth allowed, `dry` first and then `wade`, the clearance from any solid, and the search distances from the requested spot. */
const LAND = { dry: 0.02, wade: 0.45, clear: 1.1, reach: 40, ring: 1.5, far: 160 };
/**
 * Camera setup for the journal's paintings. Every painting uses the same
 * afternoon light at `hour` so the book's paintings match, a lens a little
 * longer than a person's eye, the thing filling `fill` of the height, and the
 * sun a little to one side behind the painter. The title page's wide
 * frontispiece of the repository's own building or landmark is taken from a
 * person's eye, with the thing filling `wideFill` of the height and its
 * center `wideLow` of the height below the painting's center, which leaves
 * sky above it for the world's name. A thing farther than `near` meters from
 * the person is painted on land loaded around it.
 */
export const PAINTING = { hour: 15.5, fov: 46, fill: 0.5, wideFill: 0.36, wideLow: 0.12, sunSide: 0.6, near: 120 } as const;
/**
 * A tree crown in front of the frontispiece's thing, or one this large a share of its own distance anywhere in front
 * of the painter, would hide the thing or fill the picture's side, so the painter moves elsewhere.
 */
const CROWN_IN_VIEW = 0.08;
/** Width over height of a journal page's painting. */
const PAINTED_ASPECT = 520 / 660;
/** A file with nothing placed on it is painted as its patch of ground, framed this many meters tall and reaching at most `reach` meters. */
const PATCH_SEEN = { height: 1.6, reach: 14 } as const;
/** A landing faces along a trail within `FACE_TRAIL` meters, else the area's building or landmark within `FACE_THING` meters. */
const FACE_TRAIL = 14;
const FACE_THING = 160;

/** The world as the page uses it. It draws one frame at a time at the clock's hour. */
export interface World {
  /** What the immersive layer reads and controls. */
  readonly handle: WorldHandle;
  /** The world's renderer, so the page can count its draw calls. */
  readonly renderer: THREE.WebGLRenderer;
  /** Resolves once the first world is placed and the wait screen has lifted. */
  readonly ready: Promise<void>;
  /** The world's current state for smoothness reports, as plain numbers, words and flags. */
  readonly report: () => Readonly<Record<string, string | number | boolean>>;
  /** An inactive world draws nothing and ignores the keys. */
  setActive(on: boolean): void;
  /** Draws one frame. `dt` is seconds since the last, and `hour` is the local hour the world shows. */
  frame(dt: number, now: number, hour: number): void;
  /** The internals that the hooks in `hooks.ts` read and drive. */
  readonly inside: WorldInside;
}

/**
 * The world's internals for the hooks in `hooks.ts`: its parts, what is
 * placed now, the person, the last frame, the controls a measure uses to hold
 * the world still, and the world's own operations. Hooks read these when
 * called. No user action goes through here.
 */
export interface WorldInside {
  // Its parts.
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly light: SceneLight;
  readonly terrain: Terrain;
  readonly land: PageLand;
  readonly thingTiles: ThingTiles;
  readonly sky: Sky;
  readonly ground: GroundMesh;
  readonly grass: Grass;
  readonly water: Water;
  readonly drifts: Drifts;
  readonly signs: Signs;
  readonly understory: Understory;
  readonly wildGrowth: WildGrowth;
  /** Each tree build, its blueprint, its instances and its far form, by its index among the builds. */
  readonly variants: readonly TreeVariant[];
  readonly treeBlueprints: readonly Blueprint[];
  readonly groves: ReadonlyMap<number, Copies>;
  readonly treeFar: readonly FarOf[];
  /** The trees' far forms, and the bushes', which load once the wait screen has lifted. Both sets have settled when `bushesBaked` resolves. */
  readonly treeSet: FarSet;
  readonly bushSet: FarSet;
  readonly bushesBaked: Promise<void>;
  /** Every thing's current vitality by the id it represents (`vitalityOf`), and the entity each trail end represents. */
  readonly thingVitality: ReadonlyMap<string, number>;
  readonly entityOfPlace: ReadonlyMap<string, string>;
  /** Every landmark view made so far, by its key. */
  readonly landmarkPool: ReadonlyMap<string, PlantView>;
  // What is placed now.
  /** The world shown: its regions and size. */
  readonly spec: WorldSpec;
  readonly code: OpenedWorld | null;
  readonly places: WorldPlaces;
  readonly settlement: Settlement;
  readonly landmarks: readonly Landmark[];
  readonly landmarkViews: readonly PlantView[];
  readonly landmarkEntities: readonly Represented[];
  readonly ways: Settled;
  readonly built: Ways | null;
  readonly trees: readonly Tree[];
  readonly treeViews: readonly Copies[];
  readonly treeCopies: readonly number[];
  readonly subjects: readonly Subject[];
  /** What the person walked up to while its card is open. */
  readonly shown: Represented | null;
  readonly symbolPlacements: readonly number[];
  readonly decks: readonly Footbed[];
  readonly broken: readonly Deck[];
  readonly solids: Solids;
  // The person.
  readonly walker: { x: number; z: number; yaw: number; pitch: number; eye: number };
  readonly keys: ReadonlySet<string>;
  readonly goal: Walk | null;
  trip: TripUnderWay | null;
  readonly tripEnd: TripEnd | null;
  body: Stride | null;
  /** Whether the person walked up to the thing at their position, which keeps its card open until they move on. */
  arrived: boolean;
  /** The light, sky and wind the world shows. Setting another applies it from the next frame. */
  skyWorld: Blueprint;
  // The last frame and the last bake.
  readonly hour: number;
  readonly bakeMs: number;
  readonly openingSteps: Readonly<Record<string, number>>;
  readonly frameCalls: number;
  readonly passes: Readonly<Record<Pass, Drawn>>;
  readonly appliedAir: AppliedAir | null;
  // Controls a measure or a capture uses to hold the world still.
  /** The wind's clock, frozen at this many seconds, or null to run. */
  frozen: number | null;
  /** The point every detail choice uses, when pinned apart from the eye. */
  detailPin: { readonly x: number; readonly z: number } | null;
  viewPin: ViewPin | null;
  /** Pauses streaming while a measure draws a pinned view. */
  streamPaused: boolean;
  /** Set while a measure drives the frames itself, so the page's own loop draws none. */
  driving: boolean;
  /** Meters a second along a trip's tread. */
  travelPace: number;
  /** How many copies of each code tree to place (`forest`). */
  forestCopies: number;
  /** The copy the swap test shows alone while it runs. */
  swapping: Copies | null;
  // The world's own operations.
  /** Draws one frame now, even while the page's own loop is paused. */
  frame(dt: number, now: number, at: number): void;
  walkTo(x: number, z: number, yaw: number, pitch?: number): void;
  landingNear(x: number, z: number, center?: { readonly x: number; readonly z: number }): Landing | null;
  travelTo(at: Landing, face: boolean): boolean;
  travelWay(from: Walker, at: Walker): TripWay | null;
  approach(s: Subject): void;
  hideCard(): void;
  setVitality(changes: ReadonlyMap<string, number>): void;
  valleyView(stood?: LastSpot): void;
  lookFromAbove(pos?: readonly [number, number, number], target?: readonly [number, number, number]): void;
  treeFile(t: { readonly symbol: number }): string | undefined;
  vitalityOfPlace(place: string): number;
  landmarkEntity(i: number): Represented;
  standable(x: number, z: number): boolean;
  press(code: string): void;
  release(code?: string): void;
  setGoal(x: number, z: number): void;
  updateWalk(dt: number): void;
  viewOf(id: string, w: number, h: number, wide?: boolean): Promise<{ readonly color: Pixels; readonly mask: Pixels } | null>;
  rebake(next: WorldSpec): Promise<boolean>;
  instanced(): Copies[];
  treeBuild(k: number): Realized;
}

/** A form's name with its article, such as "An archive tower". */
const withArticle = (name: string): string => `${/^[aeiou]/i.test(name) ? "An" : "A"} ${name.toLowerCase()}`;

/** Width over depth of the land the world opens on. A codebase's land matches the journal spread, and the proving ground's is square. */
export const OPENING_ASPECT = new URLSearchParams(location.search).get("world") === "proving" ? 1 : LAND_ASPECT;
/** Frames the first world draws behind the wait screen before it lifts, with shaders already compiled (`warmSoon`), so motion is smooth from the first visible frame. */
const LIFT_FRAMES = 4;
/**
 * Far form bake budget per frame: at most `views` of a form's 960 views.
 * Behind the wait screen a frame spends at most `ms` milliseconds, so the
 * page keeps painting while every tree build bakes. Once the world is open,
 * the bushes' forms bake within `walkingMs`.
 */
const FAR_BAKE = { views: 24, ms: 6, walkingMs: 2 } as const;
/** Far form slots per set: `FAR_SLOTS`, or the page's `?farSlots=trees,bushes` parameter, to view the world under a smaller budget. */
const farSlots = ((): { readonly trees: number; readonly bushes: number } => {
  const asked = new URLSearchParams(location.search).get("farSlots")?.split(",").map(Number);
  const [trees, bushes] = asked ?? [];
  return trees !== undefined && bushes !== undefined && trees >= 1 && bushes >= 1 ? { trees, bushes } : FAR_SLOTS;
})();
/** The air for the `overview` hook's view from above: clear, and thinner for a larger world so all of it stays legible. */
const overviewAir = (size: number): AtmosphereSpec => ({ ...CLEAR_AIR, density: 0.0008 * Math.min(1, 320 / size) });
/** The smallest spacing radius in meters that a stone, bush or flowers keeps from the rest, however small its build is at the ground. */
const UNDERSTORY_LEAST = 0.3;
/** Meters around the eye over which declining ground murks the air. It equals the band over which regions' airs blend, so murk changes as gradually as a region's air. */
const MURK_REACH = TERRAIN.blend;

export function createWorld(root: HTMLElement): World {
  root.innerHTML = TEMPLATE;
  const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
  const floraLib = new Library(FLORA_PRIMITIVES);
  let active = false;

  const baker = createBaker();
  // The land around the person, baked in chunks from each world's plan. It is a level, dry placeholder until the first world opens.
  const land = createPageLand();
  const terrain: Terrain = land.terrain;
  let world: WorldSpec = terrain.spec;
  let bakeMs = 0;
  /** Milliseconds each step of the last world's opening took, on the bake's threads and then on the page. */
  let openingSteps: Record<string, number> = {};
  // What a walker collides with and stands on, and what another layer places beside the trails.
  /** What blocks a walker, not counting the furnishing. */
  let bodies: SolidShape[] = [];
  /**
   * Every footbridge's deck (`allDecks`), the decks a walker stands on above the water while their way's vitality
   * keeps them intact (`decks`), and the broken decks (`broken`) that a walk goes around and a trip fords beside.
   */
  let allDecks: readonly Deck[] = [];
  let decks: readonly Footbed[] = [];
  let broken: readonly Deck[] = [];
  /** The placed landmarks' floors, which a walker stands on like an intact deck. */
  let floors: readonly Floor[] = [];
  let places: WorldPlaces = { name: "", size: world.size, areas: [], patches: [], cells: [] };
  let furnisher: ((baked: BakedWorld) => Furnishing) | null = null;
  let furnished: Furnishing = UNFURNISHED;
  let furnishSolid = true;
  const bakedListeners: (() => void)[] = [];
  const liftedListeners: (() => void)[] = [];

  // ---------- landmarks and trails ----------
  // Each landmark is placed on its lot, and trails join the buildings and
  // landmarks Jev chose to connect. `placeWorld` places them on the bake thread.
  const landmarkLib = new Library([...LANDMARK_PRIMITIVES, ...FLORA_PRIMITIVES]);
  /** Builds and measures a landmark. */
  const landmarkOf = (name: string, ask: BuildAsk): Landmark => {
    const built = made(ask, landmarkLib);
    return { key: `${ask.blueprint.id}:${ask.seed}`, name, blueprint: ask.blueprint, built, base: landmarkBase(built), feet: landmarkFeet(built) };
  };
  /** The landmarks of the world shown, each as Jev composed it. */
  let landmarks: Landmark[] = [];
  /** The build requests for the landmarks Jev composed for a codebase's world. */
  const landmarkAsks = (c: OpenedWorld): BuildAsk[] =>
    c.landmarks.map((l) => ({
      kind: "landmark",
      blueprint: l.blueprint,
      seed: seedOf(`terrain-lab/landmark/${l.path}`),
      facts: Object.fromEntries(Object.entries(landmarkKind.facts).map(([k, bind]) => [k, bind(l.facts)])),
    }));

  const canvas = root.querySelector("canvas") as HTMLCanvasElement;
  const stage = root.querySelector(".stage") as HTMLElement;
  const renderer = createRenderer(canvas);
  canvas.addEventListener("webglcontextlost", () => reportStage("context lost"));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const light = createSceneLight();
  // A building for each thing that appears as one, each on a pad leveled into the bake. Empty until a world opens.
  let settlement = createSettlement(light, []);
  /** The codebase's world on show, with what every area, patch, building, landmark and trail represents. */
  let code: OpenedWorld | null = null;
  /** The light, sky and wind the world shows: the start screen's until the codebase's world opens, then the one Jev composed for it. */
  let skyWorld: Blueprint = START_SKY;
  let ways: Settled = { sites: [], network: NO_TRAILS };
  // Every thing's live vitality by the id it represents: a file's path, a definition's id or an entity's root path.
  // It starts as the layout set it and changes through `setVitality`. Each trail's wear follows the two entities it
  // joins. Names repeat, since two packages may both be called "utils", so nothing is keyed by name.
  let landmarkEntities: Represented[] = [];
  let thingVitality = new Map<string, number>();
  /**
   * The entity path each trail end represents, by the place id the trail names: a building's name or lot, a placed
   * landmark's place, or the path of an entity that appears as a plant, stone or flowers.
   */
  const entityOfPlace = new Map<string, string>();
  /** Rebuilds the entity maps for the world on show. */
  function knowEntities(): void {
    landmarkEntities = code?.landmarks.map((l) => l.represented) ?? [];
    thingVitality = code === null ? new Map() : vitalityOf(code.world);
    entityOfPlace.clear();
    settlement.buildings.forEach((b, i) => {
      entityOfPlace.set(b.represented.name, b.represented.id);
      const lot = code?.layout.lots[i];
      if (lot !== undefined) entityOfPlace.set(lot.id, b.represented.id);
    });
    // An entity that appears as a plant, stone or flowers.
    for (const s of code?.world.naturalThings ?? []) if (s.of === "entity") entityOfPlace.set(s.path, s.path);
  }
  knowEntities();
  /** The entity that placed landmark `i` represents, found by its place id. */
  const landmarkEntity = (i: number): Represented => {
    const id = ways.sites[i]?.id;
    return landmarkEntities.find((e) => e.id === id) ?? (landmarkEntities[i % landmarkEntities.length] as Represented);
  };
  const vitalityOfPlace = (place: string): number => {
    const id = entityOfPlace.get(place);
    return id === undefined ? 1 : (thingVitality.get(id) ?? 1);
  };
  // While a change eases in, the ground, the areas' water and drifts, the trails' wear and the signs follow it the
  // same way each plant and building eases its own vitality (`followVitality`), showing `shown` plus half its `lag`.
  // Buildings, landmarks, plants, stones and flowers receive the target vitality and ease it themselves.
  const easing = new Map<string, { shown: number; lag: number; target: number }>();
  /** A thing's vitality as the ground, trail wear and signs show it now. */
  const shownVitalityOf = (id: string): number => {
    const e = easing.get(id);
    return e === undefined ? (thingVitality.get(id) ?? 1) : e.shown + 0.5 * e.lag;
  };
  const shownVitalityOfPlace = (place: string): number => {
    const id = entityOfPlace.get(place);
    return id === undefined ? 1 : shownVitalityOf(id);
  };
  /** Advances every easing change by one frame and updates the ground, trail wear and signs. Returns whether any change still eases. */
  const easeShown = (keep: number): boolean => {
    const moved = new Set(easing.keys());
    for (const [id, e] of easing) {
      [e.shown, e.lag] = followVitality(e.shown, e.lag, e.target, keep);
      if (e.shown === e.target && e.lag === 0) easing.delete(id);
    }
    setTrailEnds(ways.network, shownVitalityOfPlace);
    showGround();
    showSigns(moved);
    return easing.size > 0;
  };
  const worldLib = new Library(WORLD_PRIMITIVES);
  const lantern = createLantern(light);

  const covers = createRegionCovers();
  const regionLookOf = (i: number): RegionLook => {
    const r = world.regions[i];
    if (r === undefined) throw new Error(`No region ${i}.`);
    return realizeRegion({ blueprint: r.biome, kind: biome }, lib, seedOf(r.id));
  };
  /** Each region's ground cover, as the shaders paint it. */
  let regionGrounds: readonly GroundSpec[] = [];
  /** Updates every region's cover and drift. A world's first bake calls it before the world shows. */
  const updateCovers = (): void => {
    const looks = world.regions.map((_, i) => regionLookOf(i));
    regionGrounds = looks.map((l) => l.ground);
    covers.update(world, regionGrounds, terrain);
    drifts.regions(world, looks.map((l) => l.drift));
  };

  const scene = new THREE.Scene();
  const sky = createSky(light);
  const groundTex = createGroundTexture(land);
  const clearings = createClearings(terrain);
  const ground = createGround(terrain, light, covers, groundTex, clearings);
  const grass = createGrass(light, groundTex, covers, clearings);
  const water = createWater(terrain, light, groundTex);
  // What drifts through each region's air: petals and leaves from its trees, and fireflies.
  const drifts = createDrifts(light, groundTex);
  scene.add(sky.mesh, ground.wilds, ground.fine, ground.coarse, ground.mirror, grass.mesh, water.group, drifts.object);
  updateCovers();
  /** Each placed landmark's view, in the order of `ways.sites`. A kind may appear more than once. */
  let landmarkViews: PlantView[] = [];
  /** Every landmark view made so far, by its kind and which of that kind it is, reused from bake to bake. */
  const landmarkPool = new Map<string, PlantView>();
  let built: Ways | null = null;
  /** Each placed landmark's key in the view pool: the landmark's key and its index among copies of that landmark. */
  const poolKeys = (sites: readonly PlacedLandmark[]): string[] => {
    const seen = new Map<string, number>();
    return sites.map((s) => {
      const key = landmarks[s.landmark]?.key ?? String(s.landmark);
      const nth = seen.get(key) ?? 0;
      seen.set(key, nth + 1);
      return `${key}#${nth}`;
    });
  };
  /** A pooled view of landmark `i`, made now and added to the scene. */
  const poolLandmark = (i: number, key: string): PlantView => {
    const lm = landmarks[i] as (typeof landmarks)[number];
    const view = createPlant({ ...lm.built, parts: mergeParts(lm.built.parts) }, light);
    landmarkPool.set(key, view);
    scene.add(view.object);
    return view;
  };
  /** Creates the views `sites` needs that the pool lacks, one per `wait`, so placing them later builds nothing. */
  async function poolLandmarks(sites: readonly PlacedLandmark[], wait: () => Promise<void>): Promise<void> {
    for (const [k, key] of poolKeys(sites).entries()) {
      if (landmarkPool.has(key)) continue;
      poolLandmark((sites[k] as PlacedLandmark).landmark, key).object.visible = false;
      await wait();
    }
  }
  /** Places each landmark on its site and builds the trails' crossings. The ground texture already includes the trails. */
  function placeWays(): void {
    for (const v of landmarkPool.values()) v.object.visible = false;
    const keys = poolKeys(ways.sites);
    landmarkViews = ways.sites.map((s, k) => {
      const key = keys[k] as string;
      const view = landmarkPool.get(key) ?? poolLandmark(s.landmark, key);
      view.object.visible = true;
      view.object.position.set(s.site.x, s.site.y - 0.05, s.site.z);
      // Turn the door toward where its first trail arrives, or toward the first building.
      const near = ways.network.ways.flatMap((t) => [[t.points[0], t.points[1]], [t.points[t.points.length - 2], t.points[t.points.length - 1]]]).find(([x, z]) => Math.hypot((x ?? 0) - s.site.x, (z ?? 0) - s.site.z) < 14);
      const home = settlement.buildings[0]?.site;
      const [fx, fz] = near ?? [home?.x ?? 0, home?.z ?? 0];
      view.object.rotation.y = Math.atan2((fx ?? 0) - s.site.x, (fz ?? 0) - s.site.z);
      return view;
    });
    ways.sites.forEach((s, i) => entityOfPlace.set(s.id, landmarkEntity(i).id));
    built?.dispose();
    built = createWays(scene, light, landmarkLib, terrain, ways.network, ways.edging);
    showVitality();
  }

  /** Shows every entity's current vitality on its landmark, its trails' wear and what is built along them. Nothing rebuilds. */
  function showVitality(): void {
    landmarkViews.forEach((view, i) => view.setVitality(thingVitality.get(landmarkEntity(i).id) ?? 1));
    setTrailEnds(ways.network, shownVitalityOfPlace);
    built?.setVitality(vitalityOfPlace);
    holdDecks();
  }

  /** Shows each file's current vitality on its ground, and each area's pooled vitality on its lots and water. Nothing rebakes. */
  function showLandVitality(): void {
    showGround();
    showUnderstoryVitality();
  }
  /** Shows each file's vitality on its ground and each area's on its lots and water, where each change has eased to. */
  function showGround(): void {
    if (code === null) return;
    const { ground, area } = ownerVitality(code.world, shownVitalityOf);
    showGroundVitality(ground, area);
  }
  /** Shows on each sign naming one of `ids` the vitality of what it names, where its change has eased to. */
  function showSigns(ids: ReadonlySet<string>): void {
    signSubjects.forEach((s, k) => {
      if (ids.has(s.represented.id)) signs.setVitality(k, shownVitalityOf(s.represented.id));
    });
  }
  /** Each understory placement's shown vitality, which is that of the thing it represents. */
  function understoryShown(): Float32Array {
    const own = (k: number): number => thingVitality.get(code?.symbolOf(k)?.represented.id ?? "") ?? code?.layout.symbols[k]?.vitality ?? 1;
    return understoryVitality({ placements: understory.placements(), symbols: symbolPlacements }, own);
  }
  function showUnderstoryVitality(): void {
    understory.setVitality(understoryShown());
  }

  const vitalityListeners: ((changed: readonly string[]) => void)[] = [];
  /**
   * Sets vitality live by the id each thing represents: a file's path, a definition's id or an entity's root path. It
   * updates everywhere the thing shows: its building or landmark and sign, its trees, stones, bushes and flowers, its
   * patch of ground, the lots, water and drifts of the areas that pool it, and the wear of every trail it joins. It
   * also updates the code world, so the map and the journal read the new values. Nothing rebakes, moves or changes
   * shape. This is the only way vitality changes after a bake.
   */
  function setVitality(changes: ReadonlyMap<string, number>): void {
    if (code === null) return;
    // Each change eases in from its currently shown value.
    for (const [id, v] of changes) {
      const from = easing.get(id) ?? { shown: shownVitalityOf(id), lag: 0, target: 0 };
      easing.set(id, { ...from, target: v });
    }
    closeEachFrame(easeShown);
    const was = code.world;
    code = { ...code, world: withVitality(was, changes) };
    if (places === was) places = code.world;
    thingVitality = vitalityOf(code.world);
    for (const b of settlement.buildings) {
      const v = changes.get(b.represented.id);
      if (v !== undefined) settlement.setVitality(b, v);
    }
    trees.forEach((t, i) => {
      const v = changes.get(t.represented.id);
      const copy = treeCopies[i] ?? -1;
      if (v !== undefined && copy >= 0) groves.get(t.variant)?.setVitalityAt(copy, v);
    });
    showVitality();
    showLandVitality();
    for (const listener of vitalityListeners) listener([...changes.keys()]);
  }
  placeWays();
  for (const v of settlement.views()) scene.add(v.object);
  function placeBuildings(): void {
    // Clear the grass inside each landmark's footprint, such as a hollow tower or a great trunk, and under every piece
    // it rests on however far out, such as a rotunda's steps or a great span's feet. Each foot rotates with its
    // landmark, matching Three's rotation.
    const feet = ways.sites.flatMap((s, i) => {
      const lm = landmarks[s.landmark];
      const turn = landmarkViews[i]?.object.rotation.y ?? 0;
      const [c, sn] = [Math.cos(turn), Math.sin(turn)];
      const under = (lm?.feet ?? []).map((f) => {
        const x = s.site.x + f.x * c + f.z * sn;
        const z = s.site.z - f.x * sn + f.z * c;
        return { ax: x, az: z, bx: x + 0.01, bz: z, radius: f.radius };
      });
      return [{ ax: s.site.x, az: s.site.z, bx: s.site.x + 0.01, bz: s.site.z, radius: Math.min(lm?.base ?? 2, 4) }, ...under];
    });
    // Clear the grass around each junction's cairn, so it sits in the open where its ways meet.
    const cairns = ways.network.junctions.flatMap(({ cairn: c }) => (c === null ? [] : [{ ax: c.x, az: c.z, bx: c.x + 0.01, bz: c.z, radius: TRAILS.cairnGround }]));
    // All buildings, landmarks and cairns clear the grass through one mask, however many there are.
    clearings.setCapsules([...settlement.clearings(), ...feet, ...cairns, ...furnished.capsules]);
  }
  placeBuildings();
  const signs = createSigns(light);
  scene.add(signs.mesh);

  /** The current hour. `applyHour` sets the light, sky and air for it from `skyWorld`'s day. */
  let hour = Number.NaN;
  let skyLook: SkyLook | null = null;
  function applyHour(h: number): void {
    hour = h;
    const look = realizeSky({ blueprint: skyWorld, kind: worldKind }, worldLib, seedOf("terrain-lab/sky"), h);
    applyLight(light, look.light);
    // The wind strength. Every swaying part scales its response to the one wind field by this.
    light.uWind.value = look.wind.strength;
    skyLook = look;
    applyAir(camera.position);
  }
  /** Each region's air as Jev chose it, the world it was realized for, and a buffer for each region's weight. */
  let airs: { readonly world: WorldSpec; readonly airs: readonly AtmosphereSpec[]; readonly weights: Float64Array } | null = null;
  /** The air last applied, with the decline around the eye and the eye's height above the land. */
  let appliedAir: AppliedAir | null = null;
  /**
   * Applies the air at `eye` in front of the hour's sky. It blends each region's air by distance over the band where
   * landforms and covers blend (`regionWeights`), so the air changes gradually from one region to the next. Over
   * declining ground it thickens and greys with the decline around the eye (`declineAround`, `murkyAir`), and it thins
   * with the eye's height above the land (`airFromHeight`). Every pass uses it: the view, the water's mirror and the
   * far forms. A view from above uses thin, clear air instead, so the whole land stays legible.
   */
  function applyAir(eye: { readonly x: number; readonly y: number; readonly z: number }): void {
    if (skyLook === null) return;
    if (airs?.world !== world) airs = { world, airs: world.regions.map((r) => regionAir({ blueprint: r.biome, kind: biome }, lib, seedOf(r.id))), weights: new Float64Array(world.regions.length) };
    regionWeights(world, eye.x, eye.z, airs.weights);
    const decline = declineAround(eye.x, eye.z, MURK_REACH);
    const height = eye.y - groundHeightAt(terrain, eye.x, eye.z);
    const local = aerial !== null ? overviewAir(world.size) : airFromHeight(murkyAir(mixAir(airs.airs, airs.weights), decline), height);
    appliedAir = { decline, height, air: local };
    sky.apply({ light: skyLook.light, ...throughAir(skyLook, local) });
  }
  const shadow = createSunShadow(light, 2048);

  // ---------- plants ----------

  // Each tree is an instance of the build for its blueprint (`OpenedWorld.plants`),
  // so hundreds of trees cost a few draw calls per build. No tree is placed
  // until a world opens.
  /** Each tree build's request by variant, one per distinct blueprint. */
  let treeAsks: readonly BuildAsk[] = [];
  /**
   * Each tree build, kept only until its instances are made and its far form
   * is baked. A later request, such as the swap test's, realizes the same
   * build again.
   */
  let treeBuilds: (Realized | null)[] = [];
  const treeBuild = (k: number): Realized => treeBuilds[k] ?? made(treeAsks[k] as BuildAsk, floraLib);
  const variantOf = (plant: Realized): TreeVariant => {
    const bark = plant.parts.find((part) => part.swatch === "bark");
    // The trunk's base radius is the farthest bark vertex near the ground, however many sides or lobes the trunk has.
    let trunk = 0;
    if (bark !== undefined) {
      for (let i = 0; i < bark.positions.length; i += 3) {
        if ((bark.positions[i + 1] as number) < TRUNK_BASE) trunk = Math.max(trunk, Math.hypot(bark.positions[i] as number, bark.positions[i + 2] as number));
      }
    }
    const base = Math.max(0.5, trunk);
    let height = 1;
    let radius = 1;
    for (const part of plant.parts) {
      for (let i = 0; i < part.positions.length; i += 3) {
        height = Math.max(height, part.positions[i + 1] as number);
        radius = Math.max(radius, Math.hypot(part.positions[i] as number, part.positions[i + 2] as number));
      }
    }
    return { base, trunk, height, radius };
  };
  let variants: TreeVariant[] = [];
  /** Each tree build's map mark, by its variant. */
  let treeMarks: readonly PlantMark[] = [];
  /** How many copies of each code tree to place, for measuring at scale (`forest`). It is 1 in a world a person walks. */
  let forestCopies = 1;
  let trees: readonly Tree[] = [];
  /** Each tree's copy among its build's instances. */
  let treeCopies: readonly number[] = [];
  /** The extra trees `forest` places, by the index of the symbol each copies. Their symbol numbers follow the world's own symbols. */
  let forestOf: readonly number[] = [];
  /** The definition, file or entity a tree represents, which gives its file. */
  const treeSymbol = (t: { readonly symbol: number }) => {
    const own = code?.layout.symbols.length ?? 0;
    return code?.symbolOf(t.symbol < own ? t.symbol : (forestOf[t.symbol - own] ?? -1));
  };
  const treeFile = (t: { readonly symbol: number }): string | undefined => treeSymbol(t)?.file;
  const treeVitality = (t: Tree): number => thingVitality.get(t.represented.id) ?? t.represented.vitality;
  let treeViews: Copies[] = [];
  /** Each build's instances by variant, kept for the life of the world. */
  const groves = new Map<number, Copies>();

  // Far forms for every plant that switches to a card when small on screen:
  // each tree build by variant index, and the understory's and the wild's
  // bushes. A bare tree's twigs are finer than its card's texels, so tree cards
  // sharpen a bare copy's edge (`CARD.bareEdge`). Bushes, stones and flowers
  // keep a healthy copy's edge.
  const treeForms = createFarForms(light, farSlots.trees, CARD.bareEdge);
  const bushForms = createFarForms(light, farSlots.bushes);
  let treeFar: readonly FarOf[] = [];

  // Rocks, bushes and wildflowers, scattered around the trees.
  const understory = createUnderstory(scene, light, new Library([...FLORA_PRIMITIVES, ...ROCK_PRIMITIVES, ...WILDFLOWER_PRIMITIVES]), clearings, bushForms);

  // The wild past the land has its own covers and scattered bushes, which
  // represent no code.
  const wildGrowth = createWildGrowth(scene, light, covers, lib, floraLib, clearings, bushForms);
  const instanced = (): Copies[] => [...treeViews, ...understory.all(), ...wildGrowth.all()];
  // Each tree and bush build bakes a far form, drawn as cards where a copy is
  // small on a pass's screen (woods.ts). Each set's slots go to the forms with
  // the most copies a view would draw far (far-stream.ts). The trees' forms load
  // before the wait screen lifts, so no frame shows a far tree without its
  // card. The bushes' forms load once the world is open. Until then every bush
  // draws its full form, and a far bush changes by less than one level in 255
  // when its card arrives.
  const farStore = openFarStore(FAR_BAKE_VERSION);
  const farPace = { opening: { views: FAR_BAKE.views, ms: FAR_BAKE.ms }, walking: { views: FAR_BAKE.views, ms: FAR_BAKE.walkingMs } } as const;
  const farSets = [treeForms, bushForms].map((forms): FarSet => ({ forms, stream: createFarStream(renderer, forms, farStore, farPace) }));
  const [treeSet, bushSet] = farSets as [FarSet, FarSet];
  for (const set of farSets) scene.add(set.forms.cards.object);
  /**
   * Makes one build of each distinct tree blueprint, its far form and its instances, once, as the world opens. It makes
   * one build's instances per frame behind the wait screen, so a later planting only moves copies while the far forms
   * bake.
   */
  function buildTrees(blueprints: readonly Blueprint[]): void {
    if (treeAsks.length > 0) throw new Error("The woods build a world's trees once, when it opens.");
    treeAsks = blueprints.map(plantAsk);
    treeBuilds = treeAsks.map((ask) => made(ask, floraLib));
    variants = treeBuilds.map((built) => variantOf(built as Realized));
    treeMarks = treeBuilds.map((built, k) => markOf(blueprints[k] as Blueprint, built as Realized));
    treeFar = variants.map((_, k) => treeForms.add(treeBuild(k), () => makeLater(treeAsks[k] as BuildAsk, floraLib)));
    void (async (): Promise<void> => {
      for (const k of variants.keys()) {
        if (!groves.has(k)) {
          const view = createCopies(treeBuild(k), light, [], treeFar[k]);
          scene.add(view.object);
          groves.set(k, view);
        }
        // Once its instances exist, only the far form needs the build, and the far stream drops it after loading (`createFarStream`).
        treeBuilds[k] = null;
        await new Promise((r) => requestAnimationFrame(r));
      }
    })();
  }
  let warming = false;
  const viewSize = new THREE.Vector2();
  const bufferSize = new THREE.Vector2();
  scene.onBeforeRender = (_renderer, _scene, passCamera) => {
    if (warming) return;
    const target = renderer.getRenderTarget();
    // Before every pass, each instanced blueprint packs only the cells that
    // pass's camera sees. The water's mirror is drawn smaller than the view, so
    // it chooses detail by its own size. The sun's shadow uses the view's
    // detail, so shade never changes as a person walks. Crowns are measured in
    // each pass's own device pixels.
    const height = target === null ? renderer.getDrawingBufferSize(bufferSize).y : target.height;
    const size: PassSize =
      passCamera instanceof THREE.PerspectiveCamera
        ? { smaller: target === null ? 1 : renderer.getSize(viewSize).y / target.height, focal: height / 2 / Math.tan(THREE.MathUtils.degToRad(passCamera.fov) / 2), ortho: false }
        : passCamera instanceof THREE.OrthographicCamera
          ? { smaller: 1, focal: height / (passCamera.top - passCamera.bottom), ortho: true }
          : { smaller: 1, focal: 0, ortho: false };
    for (const v of swapping === null ? instanced() : [swapping]) v.cull(passCamera, size);
    // The card shader measures each copy's crown on this pass's screen from buffers written when the copies were
    // placed. A plant's cards draw in this pass only while the plant is visible.
    for (const set of farSets) set.forms.cards.pass(size.focal, size.ortho);
  };
  /** The copy the swap test shows alone while it runs (`swapTest`), or null. */
  let swapping: Copies | null = null;
  // Uploads every tree's and the understory's geometry at every level in one
  // render while the planting already blocks frames, so no level's first
  // appearance costs a frame.
  const warmTarget = new THREE.WebGLRenderTarget(1, 1);
  const warmCamera = new THREE.PerspectiveCamera();
  /** While above 0, the world is changing, such as compiling shaders or settling a new world, and draws no frames. The wait screen or the last frame stays on screen. */
  let holding = 0;
  /** Callbacks waiting for the world to settle, called once `holding` reaches 0. */
  const awaitingSettled: (() => void)[] = [];
  /** Releases one hold. The last release wakes every waiter. */
  const letGo = (): void => {
    holding--;
    if (holding === 0) for (const wake of awaitingSettled.splice(0)) wake();
  };
  /** Resolves once `holding` is 0: at once if it already is, else when the last hold is released. */
  const settled = (): Promise<void> => (holding === 0 ? Promise.resolve() : new Promise((wake) => awaitingSettled.push(wake)));
  let warmed: Promise<void> = Promise.resolve();
  /**
   * Prepares everything to draw without blocking the page. Every shader the
   * world uses compiles off the main thread where the browser can, for the
   * view, for the mirror's and shadow's targets, and as the shadow's depth,
   * while the world draws no frames. Then `warm` uploads every level's
   * geometry in one render, which no longer waits on a compile.
   */
  function warmSoon(): void {
    warmed = warmed.then(async () => {
      holding++;
      try {
        readyToWarm();
        await renderer.compileAsync(scene, warmCamera);
        renderer.setRenderTarget(warmTarget);
        await renderer.compileAsync(scene, warmCamera);
        const depth = [...views(), ...understory.casters(), ...wildGrowth.all()];
        for (const v of depth) v.useDepth(true);
        try {
          await renderer.compileAsync(scene, warmCamera);
        } finally {
          for (const v of depth) v.useDepth(false);
          renderer.setRenderTarget(null);
        }
        warm();
        reportStage("shaders");
      } finally {
        letGo();
      }
    });
  }
  /** Sets every level of every instanced plant to draw one copy, and readies every far card material. */
  function readyToWarm(): void {
    for (const v of instanced()) v.warm();
    for (const set of farSets) set.forms.cards.warm();
  }
  function warm(): void {
    warming = true;
    readyToWarm();
    renderer.setRenderTarget(warmTarget);
    renderer.render(scene, warmCamera);
    renderer.setRenderTarget(null);
    warming = false;
  }

  /** The request the bake thread places the codebase's world from: plain data for its buildings, landmarks, trails and code things. */
  const placeRequest = (): PlaceRequest => {
    if (code === null) throw new Error("No world to place: a codebase's world opens first.");
    // A stone, bush or flowers keeps clear of the rest by its build's widest reach at the ground, which for a fallen log runs along its length.
    const symbols = code.layout.symbols.map((s) => {
      const outline = s.rule === "trees" || s.rule === AS_THING ? undefined : understory.footprint(s.rule, s.variant)?.outline;
      return outline === undefined ? s : { ...s, radius: Math.max(UNDERSTORY_LEAST, ...outline) };
    });
    const copied = symbols.flatMap((s, i) => (s.rule === "trees" ? [i] : []));
    forestOf = Array.from({ length: forestCopies - 1 }, () => copied).flat();
    return {
      buildings: settlement.requests(),
      landmarks: landmarks.map((lm) => ({ base: lm.base, tree: lm.blueprint.slots.form?.use === "great-tree@1" })),
      trees: { bases: variants.map((v) => v.base), crowns: variants.map((v) => v.radius) },
      code: { ...code.layout, symbols: [...symbols, ...forestOf.map((i) => symbols[i] as (typeof symbols)[number])] },
    };
  };
  /** Each tile's trees by "ti,tj", which the trees' layer places. */
  let treesByTile = new Map<string, Tree[]>();
  /** The largest tree crown radius in meters, which sets how far away `thingTiles` places tree tiles. */
  let largestTree = 0;
  /** The tile of the land holding (x, z), "ti,tj". */
  const tileKeyOf = (x: number, z: number): string => {
    const frame = frameOf(world);
    return `${Math.floor((x - frame.origin) / frame.spacing / TILE.size)},${Math.floor((z - frame.origin) / frame.spacing / TILE.size)}`;
  };
  /** Places exactly the trees in `held` as copies of their builds. Each build keeps its instances and only moves its copies. */
  function placeTrees(held: readonly Tree[]): void {
    const copyOf = new Map<Tree, number>();
    treeViews = variants.flatMap((_, k) => {
      const mine = held.filter((t) => t.variant === k);
      mine.forEach((t, c) => copyOf.set(t, c));
      const spots = mine.map((t) => ({ x: t.x, y: t.y, z: t.z, yaw: t.yaw, scale: t.scale, slope: t.slope, vitality: treeVitality(t) }));
      const had = groves.get(k);
      if (had !== undefined) {
        had.respot(spots);
        return [had];
      }
      if (spots.length === 0) return [];
      const view = createCopies(treeBuild(k), light, spots, treeFar[k]);
      scene.add(view.object);
      groves.set(k, view);
      treeBuilds[k] = null;
      return [view];
    });
    // Each tree's copy index within its build, so a live vitality change reaches it, or -1 for a tree not placed.
    treeCopies = trees.map((t) => copyOf.get(t) ?? -1);
  }
  /** Places the bake's trees, the code things that appear as stones, bushes and flowers, and the walker's solids, at the positions the bake thread chose. */
  function plant(placed: Placed): void {
    // The bake thread already kept trees off the trails, buildings and landmarks.
    // Each tree represents a definition, file or entity and takes its vitality.
    trees = placed.trees.map((t) => {
      const sym = treeSymbol(t);
      if (sym === undefined) throw new Error(`Tree ${t.index} represents nothing in the world's code.`);
      return { ...t, represented: sym.represented };
    });
    treesByTile = new Map();
    treeRegions = new Map();
    for (const t of trees) {
      const key = tileKeyOf(t.x, t.z);
      const list = treesByTile.get(key);
      if (list === undefined) treesByTile.set(key, [t]);
      else list.push(t);
    }
    largestTree = trees.reduce((r, t) => Math.max(r, (variants[t.variant] as TreeVariant).radius * t.scale), 0);
    treeCopies = trees.map(() => -1);
    symbolPlacements = placed.symbols;
    // The stones, bushes and flowers are placed all at once, not by tile. The bake thread kept them out of buildings, off trails and from under landmarks.
    understory.place(placed.placements);
    showUnderstoryVitality();
    buildSolids();
    // The trees, trails, buildings and landmarks are placed again tile by tile around the person (`thingTiles`).
    thingTiles.open(world);
    warmSoon();
  }
  /** Each tree's region by tree index, computed the first time `crownsNear` needs it. */
  let treeRegions = new Map<number, number>();
  /** Every tree within `reach` of (x, z), identified by index, with its crown, region and ground decline, for the leaves and petals it drops (`Drifts.follow`). */
  function crownsNear(x: number, z: number, reach: number): Crown[] {
    const out: Crown[] = [];
    trees.forEach((t, id) => {
      if (Math.abs(t.x - x) > reach || Math.abs(t.z - z) > reach || Math.hypot(t.x - x, t.z - z) > reach) return;
      const v = variants[t.variant] as TreeVariant;
      let region = treeRegions.get(id);
      if (region === undefined) treeRegions.set(id, (region = dominantRegion(world, t.x, t.z)));
      out.push({ id, x: t.x, z: t.z, ground: t.y, low: t.y + v.height * t.scale * 0.45, high: t.y + v.height * t.scale * 0.92, reach: v.radius * t.scale, region, decline: groundDecline(groundVitalityAt(t.x, t.z).area) });
    });
    return out;
  }
  /** Builds what blocks a walker: each placed trunk at its base, the rocks and bushes by their ground outlines, the landmarks' solid pieces and the buildings' walls. */
  function buildSolids(): void {
    const trunks: SolidShape[] = trees.flatMap((t, i) => {
      const trunk = (variants[t.variant] as TreeVariant).trunk * t.scale;
      return trunk > 0 && treeCopies[i] !== -1 ? [{ x: t.x, z: t.z, radius: trunk }] : [];
    });
    const components = understory.placements().flatMap((p): SolidShape[] => {
      const share = STOPS[p.rule];
      const foot = understory.footprint(p.rule, p.variant);
      if (share === undefined || foot === undefined || p.y + foot.top * p.scale - heightAt(terrain.lattice, p.x, p.z) < STEP_OVER) return [];
      return [outlineShape(p.x, p.z, p.yaw, p.scale, foot.outline, share)];
    });
    // A landmark blocks a walker at each of its solid pieces, such as a tower's blocks, each standing stone or a great trunk.
    const landmarkSolids = ways.sites.flatMap((s, i) => {
      const view = landmarkViews[i];
      const lm = landmarks[s.landmark];
      if (view === undefined || lm === undefined) return [];
      const p = view.object.position;
      return piecesShapes(lm.built.parts, { x: p.x, y: p.y, z: p.z, yaw: view.object.rotation.y });
    });
    // Each building's walls, and what is beside it, such as a mill wheel in its pit.
    const buildings = settlement.buildings.flatMap((b): SolidShape[] => {
      const e = b.beside;
      const beside = e === null ? [] : [{ points: [[e.x0, e.z0], [e.x1, e.z0], [e.x1, e.z1], [e.x0, e.z1]].flatMap(([lx, lz]) => siteToWorld(b.site, lx as number, lz as number)) }];
      return [...wallsShape(b.plan, b.site), ...beside];
    });
    bodies = [...trunks, ...components, ...landmarkSolids, ...buildings];
    gatherSolids();
    // A landmark's walkable parts support a walker instead of blocking it, such as a rotunda's steps and the floor inside.
    floors = ways.sites.flatMap((s, i) => {
      const view = landmarkViews[i];
      const lm = landmarks[s.landmark];
      if (view === undefined || lm === undefined) return [];
      const p = view.object.position;
      const floor = floorOf(lm.built.parts, { x: p.x, y: p.y, z: p.z, yaw: view.object.rotation.y });
      return floor === null ? [] : [floor];
    });
    holdDecks();
  }
  /** Rebuilds what blocks a walker now: the bodies, the furnishing while it is solid, and each broken footbridge. */
  function gatherSolids(): void {
    solids = solidsOf([...bodies, ...(furnishSolid ? furnished.solids : []), ...broken.map(deckShape)]);
  }
  let solids: Solids = NO_SOLIDS;

  // ---------- what is placed on the land, tile by tile ----------

  /** The view's device pixels per radian, which sets how far away a thing of a given size can be seen. */
  const viewFocal = (): number => renderer.getContext().drawingBufferHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const thingTiles = createThingTiles(viewFocal);
  thingTiles.add<Tree>({
    name: "trees",
    largest: () => largestTree,
    tile: (ti, tj) => treesByTile.get(`${ti},${tj}`) ?? [],
    place(held) {
      placeTrees(held);
      buildSolids();
    },
  });
  thingTiles.add<WayPiece>({
    name: "trails",
    largest: () => built?.largest ?? 0,
    tile: (ti, tj) => built?.pieces.filter((p) => tileKeyOf(p.x, p.z) === `${ti},${tj}`) ?? [],
    place: (held) => built?.place(held),
  });
  thingTiles.add<Building>({
    name: "buildings",
    largest: () => settlement.buildings.reduce((r, b) => Math.max(r, b.radius, b.height / 2), 0),
    tile(ti, tj) {
      const here = settlement.buildings.filter((b) => tileKeyOf(b.site.x, b.site.z) === `${ti},${tj}`);
      // A distant building has no meshes, so a worker makes its build before its tile is placed.
      const missing = here.flatMap((b) => (b.batchSlot === null ? [b.ask] : []));
      return missing.length === 0 ? here : makeAhead(missing).then(() => here);
    },
    // Each tile's buildings are placed together as one batch, drawn with one call per material.
    place: (held) => settlement.place(held, scene, (b) => tileKeyOf(b.site.x, b.site.z)),
  });
  thingTiles.add<number>({
    name: "landmarks",
    largest: () => landmarkViews.reduce((r, v) => Math.max(r, v.radius, v.height / 2), 0),
    tile: (ti, tj) => ways.sites.flatMap((s, i) => (tileKeyOf(s.site.x, s.site.z) === `${ti},${tj}` ? [i] : [])),
    place(held) {
      const keep = new Set(held);
      landmarkViews.forEach((v, i) => (v.object.visible = keep.has(i)));
    },
  });
  /** In the codebase's world, each symbol's placement among the understory's, or -1. */
  let symbolPlacements: readonly number[] = [];
  /** The subject each symbol's placement represents, by its index in the understory's placements. */
  let symbolAt = new Map<number, Subject>();

  // ---------- signs, and walking up to see what a thing is ----------

  let subjects: Subject[] = [];
  /** The subject each sign names, by the sign's instance. */
  let signSubjects: Subject[] = [];
  /**
   * Builds the subjects a person can walk up to, and places a signboard for
   * each building at the end of its walk and for each landmark at its foot.
   */
  function placeSigns(): void {
    const buildingSubjects: Subject[] = settlement.buildings.map((b) => ({
      represented: b.represented,
      formName: withArticle(b.kindName),
      x: b.site.x,
      z: b.site.z,
      readingSpot: () => settlement.readingSpotOf(b),
      height: b.height,
      reach: Math.hypot(b.plan.width, b.plan.depth) / 2,
      stop: STOP_AT.great,
    }));
    // A landmark represents an entity in the codebase's world. A person walks up to its foot to read it.
    const landmarkSubjects: Subject[] = code === null
      ? []
      : ways.sites.flatMap((s, i) => {
          const thing = code?.landmarks[i];
          const lm = landmarks[s.landmark];
          if (thing === undefined || lm === undefined) return [];
          const { x, z } = s.site;
          return [{
            represented: thing.represented,
            formName: withArticle(lm.name),
            x,
            z,
            height: landmarkViews[i]?.height ?? 6,
            reach: lm.base + 1,
            stop: STOP_AT.great,
            readingSpot: (fx: number, fz: number) => {
              const d = Math.hypot(fx - x, fz - z) || 1;
              const off = lm.base + 7;
              return { x: x + ((fx - x) / d) * off, z: z + ((fz - z) / d) * off };
            },
          }];
        });
    const treeSubjects: Subject[] = trees.map((tree) => {
      const { x, z } = tree;
      const crown = (variants[tree.variant] as TreeVariant).radius * tree.scale;
      const sym = treeSymbol(tree);
      return {
        represented: tree.represented,
        formName: sym === undefined ? "A tree" : withArticle(sym.form),
        built: composedName(treeAsks[tree.variant]?.blueprint as Blueprint),
        x,
        z,
        height: (variants[tree.variant] as TreeVariant).height * tree.scale,
        reach: crown,
        stop: STOP_AT.small,
        // Stop just outside the crown, so the person sees the tree rather than its leaves.
        readingSpot: (fx: number, fz: number) => {
          const d = Math.hypot(fx - x, fz - z) || 1;
          const off = Math.max(3, crown * 0.9 + 1.4);
          return { x: x + ((fx - x) / d) * off, z: z + ((fz - z) / d) * off };
        },
      };
    });
    // A file's functions and classes are placed on its patch. A person walks up to one to read what it is.
    const placed = understory.placements();
    const symbolEntries: (readonly [number, Subject])[] = code === null
      ? []
      : symbolPlacements.flatMap((at, i) => {
          const p = placed[at];
          const sym = code?.symbolOf(i);
          if (p === undefined || sym === undefined) return [];
          const { x, z } = p;
          return [[at, {
            represented: sym.represented,
            formName: withArticle(sym.form),
            ...(code?.naturalBuilds[p.rule as PlantGroup]?.[p.variant] === undefined ? {} : { built: composedName(code.naturalBuilds[p.rule as PlantGroup][p.variant] as Blueprint) }),
            x,
            z,
            height: (understory.footprint(p.rule, p.variant)?.top ?? 0.8) * p.scale,
            reach: p.radius + 0.3,
            stop: STOP_AT.small,
            readingSpot: (fx: number, fz: number) => {
              const d = Math.hypot(fx - x, fz - z) || 1;
              const off = p.radius + 2.2;
              return { x: x + ((fx - x) / d) * off, z: z + ((fz - z) / d) * off };
            },
          }]];
        });
    const symbolSubjects = symbolEntries.map(([, subject]) => subject);
    subjects = [...buildingSubjects, ...landmarkSubjects, ...treeSubjects, ...symbolSubjects];
    symbolAt = new Map(symbolEntries);
    signSubjects = [...buildingSubjects, ...landmarkSubjects];
    signs.set([
      ...settlement.buildings.map((b) => {
        const at = settlement.signOf(b);
        return { ...at, y: heightAt(terrain.lattice, at.x, at.z), name: b.represented.name, note: b.represented.what, vitality: b.represented.vitality };
      }),
      ...landmarkSubjects.map((l, i) => {
        const view = landmarkViews[i];
        const yaw = view?.object.rotation.y ?? 0;
        const lm = landmarks[ways.sites[i]?.landmark ?? 0];
        const r = (lm?.base ?? 2) + 3;
        const x = l.x + Math.sin(yaw) * r + Math.cos(yaw) * 1.6;
        const z = l.z + Math.cos(yaw) * r - Math.sin(yaw) * 1.6;
        return { x, y: heightAt(terrain.lattice, x, z), z, yaw, name: l.represented.name, note: l.represented.what, vitality: l.represented.vitality };
      }),
    ]);
  }

  /** What the person walked up to while its card is open. The journal shows its page. */
  let shown: Represented | null = null;
  /** Where the person was when the card opened. Walking `LEAVE_CARD` meters from here closes the card. */
  let cardAt: { x: number; z: number } | null = null;
  const cardListeners: ((thing: CardThing | null) => void)[] = [];
  function showCard(s: Subject): void {
    for (const l of cardListeners) l({ represented: s.represented, formName: s.formName });
    shown = s.represented;
    cardAt = { x: walker.x, z: walker.z };
  }
  /** The thing the person is walking up to, or whose card shows. */
  let heading: Subject | null = null;
  const headingListeners: ((thing: Heading | null) => void)[] = [];
  const pickListeners: ((id: string) => void)[] = [];
  function headFor(s: Subject | null): void {
    if (s === heading) return;
    heading = s;
    for (const l of headingListeners) l(s === null ? null : { x: s.x, z: s.z, reach: s.reach, name: s.represented.name });
  }
  function hideCard(): void {
    if (shown !== null) for (const l of cardListeners) l(null);
    headFor(null);
    cardAt = null;
    shown = null;
  }
  /** The subject a walk is taking the person to, shown when they get there. */
  let pending: Subject | null = null;
  /** Walks the person up to a thing and then shows what it represents. Within 2 m of the stopping spot, the person arrives at once. */
  function approach(s: Subject): void {
    const spot = s.readingSpot(walker.x, walker.z);
    if (Math.hypot(spot.x - walker.x, spot.z - walker.z) < 2) {
      endWalk();
      arrive(s);
      return;
    }
    setGoal(spot.x, spot.z);
    pending = s;
    headFor(s);
  }
  /** Seconds the person has stood still, and whether they walked up to the thing at their position, which keeps its card open until they move on. */
  let stood = 0;
  let arrived = false;
  /** Opens the card of the thing the person arrived at. The view does not turn, since only the person's own hand turns it. */
  function arrive(s: Subject): void {
    headFor(s);
    showCard(s);
    arrived = true;
  }

  /**
   * The thing a still person is at (`STOP_AT`): of the things within walk-up
   * distance, the one nearest the center of their view.
   */
  function thingAt(): Subject | null {
    const cp = Math.cos(walker.pitch);
    const fx = -Math.sin(walker.yaw) * cp;
    const fy = Math.sin(walker.pitch);
    const fz = -Math.cos(walker.yaw) * cp;
    let best: Subject | null = null;
    let nearest = STOP_AT.view;
    for (const s of subjects) {
      const dx = s.x - walker.x;
      const dz = s.z - walker.z;
      const far = Math.hypot(dx, dz);
      const spot = s.readingSpot(walker.x, walker.z);
      if (far > Math.hypot(spot.x - s.x, spot.z - s.z) + STOP_AT.slack) continue;
      const dy = heightAt(terrain.lattice, s.x, s.z) + s.height * 0.4 - walker.eye;
      const cos = (dx * fx + dy * fy + dz * fz) / (Math.hypot(dx, dy, dz) || 1);
      const off = Math.acos(Math.max(-1, Math.min(1, cos))) - Math.atan2(s.reach, far);
      if (off < nearest) {
        nearest = off;
        best = s;
      }
    }
    return best;
  }
  /** Opens the card of the thing the person has stood still at long enough, unless that card is already open. */
  function stopAt(): void {
    const s = thingAt();
    if (s === null || stood < s.stop || shown?.id === s.represented.id) return;
    headFor(s);
    showCard(s);
  }

  /** The nearest tree a ray passes through, treating each tree as an upright cylinder 1.2 m in radius times its scale, as tall as the tree. */
  function treeHit(ray: THREE.Ray): { tree: Tree; distance: number } | null {
    const { origin: o, direction: d } = ray;
    const flat = d.x * d.x + d.z * d.z;
    let best: { tree: Tree; distance: number } | null = null;
    for (const t of trees) {
      const v = variants[t.variant] as TreeVariant;
      const s = flat < 1e-9 ? 0 : ((t.x - o.x) * d.x + (t.z - o.z) * d.z) / flat;
      if (s <= 0) continue;
      const y = o.y + d.y * s;
      if (Math.hypot(o.x + d.x * s - t.x, o.z + d.z * s - t.z) > 1.2 * t.scale || y < t.y || y > t.y + v.height * t.scale) continue;
      if (best === null || s < best.distance) best = { tree: t, distance: s };
    }
    return best;
  }

  /**
   * The nearest stone, bush or drift of flowers a ray passes through, treating
   * each as an upright cylinder from its outline's reach and its top. A small
   * one gets at least 0.6 m of radius and 0.5 m of height, so a thumb can find
   * a flower. Instances can't be raycast, because their matrices also carry
   * vitality, hue and seed.
   */
  function thingHit(ray: THREE.Ray): { x: number; z: number; distance: number; at: number } | null {
    const { origin: o, direction: d } = ray;
    const flat = d.x * d.x + d.z * d.z;
    let best: { x: number; z: number; distance: number; at: number } | null = null;
    for (const [at, p] of understory.placements().entries()) {
      const foot = understory.footprint(p.rule, p.variant);
      if (foot === undefined) continue;
      const s = flat < 1e-9 ? 0 : ((p.x - o.x) * d.x + (p.z - o.z) * d.z) / flat;
      if (s <= 0) continue;
      const x = o.x + d.x * s;
      const z = o.z + d.z * s;
      const y = o.y + d.y * s;
      const reach = Math.max(Math.max(...foot.outline) * p.scale, 0.6);
      if (Math.hypot(x - p.x, z - p.z) > reach || y > p.y + Math.max(foot.top * p.scale, 0.5)) continue;
      if (best === null || s < best.distance) best = { x, z, distance: s, at };
    }
    return best;
  }

  /**
   * The nearest furnishing a ray passes through, treating each solid as an
   * upright cylinder around its center. Returns where a walk toward it stops,
   * just short of it on the person's side.
   */
  function furnishingHit(ray: THREE.Ray): { x: number; z: number; distance: number } | null {
    const { origin: o, direction: d } = ray;
    const flat = d.x * d.x + d.z * d.z;
    if (flat < 1e-9) return null;
    let best: { x: number; z: number; distance: number } | null = null;
    for (const shape of furnished.solids) {
      let cx: number;
      let cz: number;
      let r: number;
      if ("points" in shape) {
        const n = shape.points.length / 2;
        cx = 0;
        cz = 0;
        for (let k = 0; k < n; k++) {
          cx += (shape.points[k * 2] as number) / n;
          cz += (shape.points[k * 2 + 1] as number) / n;
        }
        r = 0;
        for (let k = 0; k < n; k++) r = Math.max(r, Math.hypot((shape.points[k * 2] as number) - cx, (shape.points[k * 2 + 1] as number) - cz));
      } else {
        cx = shape.x;
        cz = shape.z;
        r = shape.radius;
      }
      const s = ((cx - o.x) * d.x + (cz - o.z) * d.z) / flat;
      if (s <= 0 || (best !== null && s > best.distance)) continue;
      const y = o.y + d.y * s;
      const ground = heightAt(terrain.lattice, cx, cz);
      if (Math.hypot(o.x + d.x * s - cx, o.z + d.z * s - cz) > r + 0.25 || y < ground - 0.2 || y > ground + FURNISHING_TOP) continue;
      const back = Math.hypot(o.x - cx, o.z - cz) || 1;
      best = { x: cx + ((o.x - cx) / back) * (r + 1.1), z: cz + ((o.z - cz) / back) * (r + 1.1), distance: s };
    }
    return best;
  }

  // ---------- camera, walking, and the view from above ----------

  const camera = new THREE.PerspectiveCamera(58, 1, 0.2, 4500);
  /** The point the camera looks at from above, set by the `overview` hook for a capture. Null while the person walks. */
  let aerial: THREE.Vector3 | null = null;
  const walker = { x: 0, z: 0, yaw: 0, pitch: -0.05, eye: 0 };
  /** Where a tap or click is walking the walker, if anywhere. */
  let goal: Walk | null = null;
  const keys = new Set<string>();
  /** The steering state from held keys, which `steerStep` turns into walking and turning. */
  let steer: Steering = steering();
  const clock = (): number => performance.now() / 1000;
  /** Whether a held key other than `code` maps to the same way, as W and the up arrow both walk ahead. */
  const heldElsewhere = (code: string, way: WalkKey): boolean => [...keys].some((k) => k !== code && STEER_KEYS.get(k) === way);
  function press(code: string): void {
    const way = STEER_KEYS.get(code);
    if (way !== undefined && !heldElsewhere(code, way)) steer = steerPress(steer, way, clock());
    keys.add(code);
  }
  function release(code?: string): void {
    if (code === undefined) {
      keys.clear();
      steer = steerRelease(steer);
      return;
    }
    keys.delete(code);
    const way = STEER_KEYS.get(code);
    if (way !== undefined && !heldElsewhere(code, way)) steer = steerRelease(steer, way);
  }
  window.addEventListener("keydown", (e) => {
    if (!active || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (STEER_KEYS.has(e.code)) {
      e.preventDefault();
      if (e.repeat) return;
      press(e.code);
      // A walking key ends a tap's walk. Shift alone moves nothing, so it leaves the walk running.
      if (WALK_KEYS.has(e.code)) endWalk();
    } else if (e.code === "Escape" && shown !== null) hideCard();
  });
  window.addEventListener("keyup", (e) => release(e.code));
  window.addEventListener("blur", () => release());

  // Only one pointer turns the view, so a second finger on the canvas never
  // jerks it. The view stays still until the press moves past a tap's slop, so
  // a tap never nudges it and a drag never walks.
  const drag = { id: -1, x: 0, y: 0, looking: false };
  canvas.addEventListener("pointerdown", (e) => {
    if (aerial !== null || drag.id !== -1) return;
    drag.id = e.pointerId;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.looking = false;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== drag.id || aerial !== null) return;
    if (!drag.looking && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= tapSlop(e)) return;
    drag.looking = true;
    // The view turns with the hand one to one. Turning it ends a tap's walk.
    if (goal !== null && e.clientX !== drag.x) endWalk();
    look(e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  /** Turns the view by a drag of (dx, dy) pixels, one to one, with no easing or drift after. */
  function look(dx: number, dy: number): void {
    walker.yaw -= dx * LOOK;
    walker.pitch = Math.max(-1.1, Math.min(1.1, walker.pitch - dy * LOOK));
  }
  for (const type of ["pointerup", "pointercancel"] as const) {
    canvas.addEventListener(type, (e) => {
      if (e.pointerId === drag.id) drag.id = -1;
    });
  }

  const raycaster = new THREE.Raycaster();
  function aim(e: PointerEvent): THREE.Ray {
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
    return raycaster.ray;
  }

  /** Where a ray first meets the ground a walker stands on, the lattice on the land and the wild land past it, by marching along the ray. */
  function groundHit(ray: THREE.Ray): { x: number; z: number; distance: number } | null {
    const { origin: o, direction: d } = ray;
    const above = (s: number): boolean => o.y + d.y * s > groundHeightAt(terrain, o.x + d.x * s, o.z + d.z * s);
    const step = terrain.lattice.spacing * 0.5;
    // Skip the air above the highest ground, so a view from above finds the ground as quickly as one at eye height.
    const top = terrain.report.max + TERRAIN.rim + WILDS.variation + 2;
    const enter = d.y < 0 && o.y > top ? (o.y - top) / -d.y : 0;
    for (let s = enter + step; s < enter + REACH; s += step) {
      if (above(s)) continue;
      let lo = s - step;
      let hi = s;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        if (above(mid)) lo = mid;
        else hi = mid;
      }
      return { x: o.x + d.x * hi, z: o.z + d.z * hi, distance: hi };
    }
    return null;
  }

  function setGoal(x: number, z: number): void {
    // A tap ends a trip as the keys do. The trip slows the person, then the walk continues.
    if (trip !== null) trip.stopping = true;
    goal = planWalk(terrain, solids, walker, { x, z });
    pending = null;
    if (shown === null) headFor(null);
  }
  function endWalk(): void {
    if (pending !== null && shown === null) headFor(null);
    pending = null;
    goal = null;
  }
  /** Ends a walk that arrived or was blocked, and shows what it was walking to if the person is within 14 m of it. */
  function finishWalk(): void {
    const to = pending;
    pending = null;
    goal = null;
    if (to !== null && Math.hypot(walker.x - to.x, walker.z - to.z) < 14) arrive(to);
    else if (shown === null) headFor(null);
  }

  // A tap on a building, tree or sign walks the person up to it and then shows
  // what it is. A tap on the ground walks there.
  onTap(canvas, (e) => {
    if (aerial !== null) return;
    const ray = aim(e);
    const land = groundHit(ray);
    const tree = treeHit(ray);
    const building = settlement.pick(raycaster);
    const rise = code === null ? undefined : raycaster.intersectObjects(landmarkViews.map((v) => v.object), true)[0];
    const riseAt = rise === undefined ? undefined : landmarkViews.findIndex((v) => v.object.getObjectById(rise.object.id) !== undefined);
    const riseSite = riseAt === undefined ? undefined : ways.sites[riseAt]?.site;
    const sign = raycaster.intersectObject(signs.mesh)[0];
    const thing = thingHit(ray);
    const symbol = thing === null ? undefined : symbolAt.get(thing.at);
    const hits = [
      ...(thing === null || symbol === undefined ? [] : [{ distance: thing.distance, subject: symbol }]),
      ...(tree === null ? [] : [{ distance: tree.distance, subject: subjects.find((s) => s.x === tree.tree.x && s.z === tree.tree.z) }]),
      ...(building === undefined ? [] : [{ distance: building.distance, subject: subjects.find((s) => s.x === building.building.site.x && s.z === building.building.site.z) }]),
      ...(sign === undefined ? [] : [{ distance: sign.distance, subject: signSubjects[sign.instanceId ?? -1] }]),
      ...(rise === undefined || riseSite === undefined ? [] : [{ distance: rise.distance, subject: subjects.find((s) => s.x === riseSite.x && s.z === riseSite.z) }]),
    ].sort((a, b) => a.distance - b.distance);
    const nearest = hits[0];
    if (nearest !== undefined && nearest.subject !== undefined && (land === null || nearest.distance < land.distance + 0.5)) {
      // With a journal listening, a tap on a thing opens its page without moving the person. Otherwise they walk up to it.
      if (pickListeners.length > 0) for (const l of pickListeners) l(nearest.subject.represented.id);
      else approach(nearest.subject);
      return;
    }
    // A tap on a fingerpost or a boundary stone walks up to it, not to the ground hidden behind it.
    const near = furnishingHit(ray);
    if (near !== null && (land === null || near.distance < land.distance)) setGoal(near.x, near.z);
    else if (land !== null) setGoal(land.x, land.z);
  });

  /** Switches the ground and growth between walking and a view from above, which uses the whole-world mesh and the wild ring. */
  function showAerial(on: boolean): void {
    ground.fine.visible = !on;
    ground.coarse.visible = on;
    ground.wilds.visible = on;
    wildGrowth.show(!on);
    grass.mesh.visible = !on;
    drifts.object.visible = !on;
  }
  /**
   * Points the camera at the land from above for a capture, from exactly `pos` toward `target`, and draws the whole
   * land through clear air. Walking anywhere ends it.
   */
  function lookFromAbove(pos?: readonly [number, number, number], target?: readonly [number, number, number]): void {
    if (aerial === null) {
      endWalk();
      ground.aerial();
      aerial = new THREE.Vector3();
      camera.position.set(walker.x * 0.3 + 40, 300, walker.z * 0.3 + 330);
      showAerial(true);
    }
    if (pos !== undefined) camera.position.set(...pos);
    if (target !== undefined) aerial.set(...target);
    camera.lookAt(aerial);
  }
  function walkAgain(): void {
    if (aerial === null) return;
    aerial = null;
    showAerial(false);
  }

  /** Puts the walker at a point at once, looking along `yaw`. */
  function walkTo(x: number, z: number, yaw: number, pitch = -0.05): void {
    endWalk();
    if (trip !== null) tripEnd = { done: false, s: +trip.at.s.toFixed(1), length: Math.round(trip.plan.length), keys: [...keys], goal: goal !== null, by: "put elsewhere" };
    trip = null;
    stood = 0;
    arrived = false;
    walker.x = x;
    walker.z = z;
    walker.yaw = yaw;
    walker.pitch = pitch;
    body = standAt(terrain, decks, x, z);
    walker.eye = body.eye;
    steer = steerAlong(steer);
    walkAgain();
  }

  /**
   * Puts the person where they were when they last left this world (`returnTo`). While the code's layout is
   * unchanged, that spot is exact. Once an edit has moved things, it is beside the thing they stood by, at its new
   * position, on clear dry ground or at the nearest landing. A first visit, or one whose thing is gone, uses the best
   * first view (`openingSpot`): on a stream's bank among the code, looking downstream, with the most code things in
   * sight.
   */
  function valleyView(stood = code?.stood): void {
    if (code === null) return;
    const back = returnTo(code.world, stood);
    if (back !== null) {
      const beside = back.exact || standable(back.x, back.z) ? back : landingNear(back.x, back.z);
      if (beside !== null) return walkTo(beside.x, beside.z, back.yaw, -0.06);
    }
    const at = openingSpot(terrain, code.world);
    // Move clear of any solid there, as a landing does.
    const bank = landingNear(at.x, at.z);
    walkTo(bank?.x ?? at.x, bank?.z ?? at.z, at.yaw, -0.06);
  }

  const forward = new THREE.Vector3();
  let walked = 0;
  /** Splits the decks into intact and broken by their way's current vitality, so a walk goes around the broken ones. The landmarks' floors are always intact. */
  function holdDecks(): void {
    const was = broken;
    decks = [...allDecks.filter((d) => crossingVitality(ways.network, d.way, d.crossing, vitalityOfPlace) >= d.holds), ...floors];
    broken = allDecks.filter((d) => !decks.includes(d));
    if (broken.length !== was.length || broken.some((d, i) => d !== was[i])) gatherSolids();
  }
  /** The person's body: its velocity, its stride and its eye height over the ground, eased frame by frame. */
  let body: Stride | null = null;
  const STAND: Intent = { dx: 0, dz: 0, speed: 0 };
  /** The base the lantern's hand height is measured from: the ground, or while swimming, a height that keeps the lantern above the water. */
  let lanternGround = 0;
  let tripEnd: TripEnd | null = null;
  let trip: TripUnderWay | null = null;
  /** Within this many meters, a trip walks straight there around any obstacle rather than by the trails. */
  const TRAVEL_NEAR = 120;
  /** Meters ahead along a trip that the layers load what can be seen (`TRAVEL_LOOK`), and the spacing of the marks they load at (`TRAVEL_MARK`). */
  const TRAVEL_LOOK = 300;
  const TRAVEL_MARK = 40;
  /** Requests the marks within `TRAVEL_LOOK` ahead, and returns how far along the trip, in meters, everything visible from it has loaded. */
  function readyAlong(t: TripUnderWay): number {
    for (const m of t.marks) {
      if (m.asked || m.s > t.at.s + TRAVEL_LOOK) continue;
      m.asked = true;
      const x = travelPoint(t.plan, m.s);
      void thingTiles.fetch(x.x, x.z).then(() => {
        m.ready = true;
      });
    }
    const first = t.marks.findIndex((m) => !m.ready);
    return first === -1 ? Infinity : first === 0 ? 0 : (t.marks[first - 1] as (typeof t.marks)[number]).s;
  }
  /**
   * The way a trip takes from `from` to a landing. Within `TRAVEL_NEAR` it
   * walks straight there. Otherwise it follows the trails, unless their way
   * is more than `TRAVEL.detour` times the straight distance or no trail goes
   * there, and then it goes straight across the land (`acrossWay`). Returns
   * null when neither works. The result also gives the meters walked off the
   * tread at each end, at the off-tread pace, and which route it took.
   */
  function travelWay(from: Walker, at: Walker): TripWay | null {
    const lengthOf = (way: readonly Walker[]): number => way.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - (way[i - 1] as Walker).x, p.z - (way[i - 1] as Walker).z)), 0);
    const straight = Math.hypot(at.x - from.x, at.z - from.z);
    if (straight < TRAVEL_NEAR) {
      const way = [...planWalk(terrain, solids, from, at).way];
      return { way, off: { start: lengthOf(way), end: 0 }, by: "near" };
    }
    const tread = trailWay(ways.network, from, at);
    let trails: { way: Walker[]; off: { start: number; end: number }; by: "trails" } | null = null;
    if (tread !== null && tread.length >= 2) {
      const on = planWalk(terrain, solids, from, tread[0] as Walker).way;
      const leave = planWalk(terrain, solids, tread[tread.length - 1] as Walker, at).way;
      trails = { way: [...on, ...tread.slice(1, -1), ...leave], off: { start: lengthOf(on), end: lengthOf(leave) }, by: "trails" };
    }
    if (trails !== null && lengthOf(trails.way) <= straight * TRAVEL.detour) return trails;
    const across = acrossWay(terrain, solids, from, at, ways.network.ways.flatMap((w) => w.crossings).filter((c) => !broken.some((d) => d.crossing === c)));
    // Go straight across only when that is shorter. Deep water may send it around farther than the trails go.
    if (across === null || (trails !== null && lengthOf(across) >= lengthOf(trails.way))) return trails;
    return { way: across, off: { start: 0, end: 0 }, by: "across" };
  }
  /**
   * Plans and starts a trip to a landing by `travelWay`, such as around
   * obstacles onto the nearest tread, along the trails to the tread nearest
   * the landing, and off it to the landing. Returns false when no route goes
   * there.
   */
  function travelTo(at: Landing, face: boolean): boolean {
    const chosen = travelWay({ x: walker.x, z: walker.z }, at);
    if (chosen === null) return false;
    const { way, off } = chosen;
    endWalk();
    hideCard();
    const plan = planTrip(fordBeside(terrain, way, broken), off, face ? at.yaw : null, travelPace, (x, z) => wadingAt(terrain, decks, x, z));
    const marks = Array.from({ length: Math.floor(plan.length / TRAVEL_MARK) + 1 }, (_, i) => ({ s: Math.min(plan.length, i * TRAVEL_MARK), asked: false, ready: false }));
    marks.push({ s: plan.length, asked: false, ready: false });
    trip = { plan, at: travelFrom(plan, walker.yaw), stopping: false, marks, began: performance.now(), hurry: null, setOff: null, waited: 0 };
    steer = steerAlong(steer);
    walkAgain();
    return true;
  }

  /**
   * The direction and speed the person walks, which never turns the view.
   * The keys walk them ahead or back along the view (`steerStep`), and a
   * tap's walk moves them along its way while the view stays where it was.
   */
  function intent(at: Stride, steered: Steered): Intent {
    if (steered.ahead !== 0) {
      const way = Math.sign(steered.ahead);
      return { dx: -Math.sin(walker.yaw) * way, dz: -Math.cos(walker.yaw) * way, speed: WALK_TO.pace * Math.abs(steered.ahead) * (steered.hurry ? GAIT.hurry : 1) };
    }
    if ([...keys].some((k) => WALK_KEYS.has(k))) return STAND;
    if (goal === null) return STAND;
    const heading = wayAhead(goal, at);
    goal = heading.walk;
    if (heading.remaining <= WALK_TO.reach) {
      finishWalk();
      return STAND;
    }
    const braking = Math.sqrt(2 * GAIT.arrive * Math.max(0, heading.remaining - WALK_TO.reach * 0.6));
    return { dx: heading.aim.x - at.x, dz: heading.aim.z - at.z, speed: Math.min(heading.pace, braking) };
  }
  function updateWalk(dt: number): void {
    const fromX = walker.x;
    const fromZ = walker.z;
    // A hook may have moved the walker, so move the body to the walker.
    if (body === null || body.x !== walker.x || body.z !== walker.z) body = { ...(body ?? standAt(terrain, decks, walker.x, walker.z)), x: walker.x, z: walker.z };
    // The keys turn the view only at one steady rate.
    const steered = steerStep(steer, clock(), walker.yaw, dt);
    steer = steered.steering;
    walker.yaw = steered.yaw;
    if (trip !== null) {
      // A trip moves the body along its way and turns the view with the way ahead until a key is pressed. Then it
      // slows at its steady rate, the keys control the view, and the walk takes over at walking pace.
      if ([...keys].some((k) => WALK_KEYS.has(k))) trip.stopping = true;
      // The body goes no farther than the world has loaded, so everything visible from there is placed. While paper
      // hides the world and the trip hurries, it waits on nothing, and the marks it passes are never requested.
      if (trip.hurry !== null) for (const m of trip.marks) if (m.s < trip.at.s) m.asked = m.ready = true;
      const ready = trip.hurry !== null ? Infinity : readyAlong(trip);
      if (ready < trip.plan.length && trip.at.going && trip.at.v < 1 && trip.at.s >= ready - 1) trip.waited += dt;
      // Where the way ahead has not loaded, the trip slows to walking pace but never stops. A person sent somewhere
      // gets there, and at walking pace things load as they do for a walk.
      trip.at = travelStep(trip.plan, trip.at, dt * (trip.hurry ?? 1), walker.yaw, trip.stopping, ready, WALK_TO.pace);
      if (trip.setOff === null && trip.at.s > 0) trip.setOff = performance.now();
      walker.yaw = trip.at.yaw;
      body = carry(terrain, decks, body, trip.at.x, trip.at.z, dt);
      if (trip.at.done || (trip.stopping && trip.at.v <= WALK_TO.pace)) {
        tripEnd = { done: trip.at.done, s: +trip.at.s.toFixed(1), length: Math.round(trip.plan.length), keys: [...keys], goal: goal !== null };
        // Log a trip the person took over, so a trip that ends short is never a mystery.
        if (!trip.at.done) console.info(`travel: taken over at ${Math.round(trip.at.s)} of ${Math.round(trip.plan.length)} m by ${goal !== null ? "a tap on the world" : `the keys (${[...keys].join(", ")})`}`);
        trip = null;
      }
    } else {
      // Water and the grade slow the body, solids turn it aside, and it starts and stops at once without overshooting.
      body = stride(terrain, solids, decks, body, intent(body, steered), dt);
      if (goal !== null && body.blocked) finishWalk();
    }
    walker.x = body.x;
    walker.z = body.z;
    // Standing still at a thing opens its card. `stopAt` runs only when the still time crosses `STOP_AT.great` or `STOP_AT.small`.
    if (goal !== null || trip !== null || keys.size > 0) arrived = false;
    const before = stood;
    stood = !arrived && goal === null && trip === null && keys.size === 0 && Math.hypot(walker.x - fromX, walker.z - fromZ) < STILL * dt ? stood + dt : 0;
    if ((before < STOP_AT.great && stood >= STOP_AT.great) || (before < STOP_AT.small && stood >= STOP_AT.small)) stopAt();
    // A card belongs to the thing it opened at, so walking away closes it.
    if (cardAt !== null && Math.hypot(walker.x - cardAt.x, walker.z - cardAt.z) > LEAVE_CARD) hideCard();
    // The eyes are 1.6 m above the ground or a bridge's deck, easing down to just above deep water.
    walker.eye = body.eye;
    const footing = footingAt(terrain, decks, walker.x, walker.z);
    const surface = footing.ground + footing.depth;
    lanternGround = footing.depth > 0 ? Math.max(walker.eye - EYE_HEIGHT, surface + LANTERN_ABOVE_WATER - (EYE_HEIGHT - LANTERN.drop)) : walker.eye - EYE_HEIGHT;
    // The camera sits at the body's eye height, and nothing bobs, sways or rolls the view.
    const eye = viewPin ?? walker;
    camera.position.set(eye.x, eye.eye, eye.z);
    const sy = Math.sin(eye.yaw);
    const cy = Math.cos(eye.yaw);
    forward.set(-sy * Math.cos(eye.pitch), Math.sin(eye.pitch), -cy * Math.cos(eye.pitch));
    camera.lookAt(camera.position.clone().add(forward));
    walked = Math.hypot(walker.x - fromX, walker.z - fromZ);
  }

  // ---------- adopting a baked world ----------

  /**
   * Adopts a baked world over a few frames, so no single frame blocks the
   * page long enough for the wait screen to stutter. The world draws no
   * frames until all of it is in place.
   */
  async function adopt(next: WorldSpec, baked: Baked): Promise<void> {
    const { placed, ownership } = baked;
    let since = performance.now();
    const mark = (step: string): void => {
      const now = performance.now();
      openingSteps[step] = Math.round(now - since);
      since = now;
    };
    const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
    holding++;
    try {
      // First make what the new world needs that was never made, one thing a frame, while the old world still shows.
      await poolLandmarks(placed.landmarks, nextFrame);
      await understory.prepare(placed.placements, nextFrame);
      world = next;
      mark("pool");
      // Load the land around the person before anything is placed on it.
      await land.open({ source: baked.land, report: baked.report, wildBase: baked.wildBase, whole: baked.whole }, walker.x, walker.z);
      mark("land");
      // Set the areas and files first, so the furnisher can look up the area and file of each thing it places.
      if (code !== null) places = code.world;
      clearings.fit(terrain);
      settlement.seat(placed.sites);
      ways = { sites: placed.landmarks, network: placed.network, edging: placed.edging };
      allDecks = decksOf(placed.network.ways);
      holdDecks();
      placeWays();
      furnished = furnisher?.(bakedWorld()) ?? UNFURNISHED;
      // In the codebase's world a landmark represents an entity and takes its vitality.
      landmarkViews.forEach((v, i) => v.setVitality(code === null ? 1 : (code.world.things.filter((t) => t.as === "landmark")[i]?.vitality ?? 1)));
      placeBuildings();
      await nextFrame();
      updateCovers();
      groundTex.update(terrain);
      setGroundOwnership(ownership);
      showLandVitality();
      await nextFrame();
      ground.update(terrain);
      water.update(terrain);
      wildGrowth.update(terrain);
      await nextFrame();
      mark("ground");
      plant(placed);
      await thingTiles.ready(walker.x, walker.z);
      mark("plant");
      await nextFrame();
      placeSigns();
      mark("signs");
      endWalk();
      for (const listener of bakedListeners) listener();
    } finally {
      letGo();
    }
  }

  function bakedWorld(): BakedWorld {
    return {
      terrain,
      ways: ways.network.ways,
      buildings: settlement.buildings.map((b) => ({ x: b.site.x, z: b.site.z, name: b.represented.name, kind: b.kindName, vitality: b.vitality, plan: b.plan, blueprint: b.blueprint, palette: b.palette })),
      landmarks: ways.sites.map((s, i) => {
        const lm = landmarks[s.landmark] as (typeof landmarks)[number];
        return { x: s.site.x, z: s.site.z, name: lm.name, vitality: thingVitality.get(landmarkEntity(i).id) ?? 1, blueprint: lm.blueprint, palette: lm.built.palette };
      }),
      trees: trees.map((t) => ({ x: t.x, z: t.z, vitality: treeVitality(t), scale: t.scale, build: treeMarks[t.variant] as PlantMark })),
      understory: ((shown) =>
        understory.placements().flatMap((p, i) => {
          const build = understory.mark(p.rule, p.variant);
          return build === undefined ? [] : [{ x: p.x, z: p.z, vitality: shown[i] ?? 1, scale: p.scale, build }];
        }))(understoryShown()),
      // An area shows its region's ground.
      grounds: new Map(places.areas.flatMap((a, i) => {
        const ground = regionGrounds[code?.world.areas[i]?.region ?? 0];
        return ground === undefined ? [] : [[a.path, ground] as const];
      })),
      lots: (code?.world.things ?? []).map(({ x, z }) => ({ x, z })),
    };
  }

  // Bakes run on the workers while the old world stays on screen. The world
  // adopts only the newest bake requested.
  let asked = 0;
  async function rebake(next: WorldSpec): Promise<boolean> {
    const mine = ++asked;
    const t0 = performance.now();
    reportStage("baking", { size: next.size });
    const baked = await baker.bake(next, placeRequest());
    if (mine !== asked) {
      // A newer world was requested, so end this bake's finishing thread, whose world nothing will use.
      baked.whole.terminate();
      return false;
    }
    bakeMs = performance.now() - t0;
    openingSteps = { ...baked.placed.took };
    reportStage("baked", { size: next.size, bakeMs: Math.round(bakeMs) });
    await adopt(next, baked);
    reportStage("placed", { size: next.size, trees: trees.length });
    return true;
  }

  // ---------- frame ----------

  function resize(): void {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);

  let frozen: number | null = null;
  /** The point every detail choice uses when pinned apart from the eye (the `detailCenter` hook). */
  let detailPin: { readonly x: number; readonly z: number } | null = null;
  /** The view position when pinned apart from the person, as the travel test pins it. */
  let viewPin: ViewPin | null = null;
  /** Pauses streaming while a measure draws a pinned view. The land and the layers wait for the frames that move the person. */
  let streamPaused = false;
  /** Set while a measure drives the frames itself, so the app's own loop draws none. */
  let driving = false;
  /** Meters a second along a trip's tread: `TRAVEL.pace`, unless a measure sets another. */
  let travelPace: number = TRAVEL.pace;
  const detailEye = new THREE.Vector3();
  const shadowCenter = new THREE.Vector3();
  const views = (): Pick<PlantView, "object" | "useDepth">[] => [...treeViews, ...settlement.views(), ...landmarkViews, ...(built?.views ?? [])];
  const lanternEye = new THREE.Vector3();
  // The water mirrors the sky, the coarse ground, trees, buildings and
  // landmarks, never the grass or the understory. Its reflection is soft, so
  // fine detail there is wasted, and the understory keeps back from the water
  // anyway.
  const mirrorHide = [grass.mesh, ground.fine, signs.mesh, drifts.object];
  // While walking, it mirrors the ground's rings at a quarter of their detail, which include the wild land. From above, it mirrors the whole-world mesh and the wild ring.
  const mirrorShow = (): THREE.Object3D[] => (aerial === null ? [ground.mirror] : [ground.coarse, ground.wilds]);
  let frameCalls = 0;
  /** Each pass's draw calls and triangles in the last frame. */
  const passes = { shadow: { calls: 0, triangles: 0 }, mirror: { calls: 0, triangles: 0 }, view: { calls: 0, triangles: 0 } };
  let waitNight = -1;
  /** Renders the sun's shadow, cast by every plant, building and landmark over the ground framed by `shadow.frame`. */
  function castShadows(): void {
    shadow.render(renderer, scene, [...views(), ...understory.casters(), ...wildGrowth.all(), ...(swapping === null ? [] : [swapping])], [sky.mesh, ground.wilds, ground.fine, ground.coarse, ground.mirror, grass.mesh, water.group, signs.mesh, drifts.object, ...understory.quiet()]);
  }
  /** Renders the water's mirror as `eye` sees it, showing `show`, and returns its draw calls. */
  function mirror(eye: THREE.PerspectiveCamera, show: THREE.Object3D[], dt: number): number {
    return water.mirror(renderer, scene, eye, [...mirrorHide, ...understory.quiet(), ...understory.casters().map((c) => c.object), ...wildGrowth.all().map((c) => c.object)], show, dt);
  }
  function frame(dt: number, now: number, at: number): void {
    if (holding > 0) return;
    if (at !== hour) applyHour(at);
    veil.hour(at);
    // The wait screen follows the hour as the world will.
    const night = Math.round(light.uNightness.value * 20) / 20;
    if (night !== waitNight) veil.night((waitNight = night));
    light.uTime.value = frozen ?? light.uTime.value + dt;
    // A change in vitality eases in over the frame's own time, even with the wind's clock frozen.
    easeVitality(dt);
    if (aerial === null) {
      updateWalk(dt);
      detailEye.set(detailPin?.x ?? camera.position.x, camera.position.y, detailPin?.z ?? camera.position.z);
      ground.follow(detailPin?.x ?? walker.x, detailPin?.z ?? walker.z);
      if (!streamPaused) {
        land.follow(detailPin?.x ?? walker.x, detailPin?.z ?? walker.z);
        wildGrowth.follow(detailPin?.x ?? walker.x, detailPin?.z ?? walker.z);
        // While a trip goes faster than 1.5 times walking pace, only its marks request tiles. Requesting walking's lead as
        // well would queue tiles ahead of the ones the trip waits on.
        thingTiles.follow(walker.x, walker.z, trip === null || trip.at.v <= WALK_TO.pace * 1.5);
      }
      lantern.follow(camera.position, forward, lanternGround, walked, dt);
      grass.follow(detailEye);
      water.wade(walker.x, walker.z, walker.yaw, walked, dt);
      const seen = viewPin ?? walker;
      shadowCenter.set(seen.x - Math.sin(seen.yaw) * 18, seen.eye, seen.z - Math.cos(seen.yaw) * 18);
      shadow.frame(shadowCenter, 40);
    } else {
      // The lantern stays at the person's position.
      lanternEye.set(walker.x, walker.eye, walker.z);
      lantern.follow(lanternEye, forward, lanternGround, 0, dt);
      shadow.frame(shadowCenter.set(0, 0, 0), world.size * 0.62);
    }
    applyAir(camera.position);
    // Every pass thins distant detail by distance from the person's eyes, or from the camera above.
    light.uEye.value.copy(aerial === null ? detailEye : camera.position);
    if (aerial === null) drifts.follow(crownsNear, viewFocal());
    // The far streams follow the person and advance their fades by the frame's own time.
    if (!streamPaused && aerial === null) for (const set of farSets) set.stream.follow(light.uEye.value, viewFocal(), dt);
    castShadows();
    frameCalls = renderer.info.render.calls;
    passes.shadow = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    const mirrorCalls = mirror(camera, mirrorShow(), dt);
    frameCalls += mirrorCalls;
    passes.mirror = { calls: mirrorCalls, triangles: mirrorCalls > 0 ? renderer.info.render.triangles : 0 };
    renderer.render(scene, camera);
    frameCalls += renderer.info.render.calls;
    passes.view = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  }

  /**
   * Opens the codebase's world, judged and laid out by the world service, or
   * on a page with no engine from the showcase's snapshot or the proving
   * ground's fixtures. The world has its own buildings and landmarks, so the
   * settlement is rebuilt. The rest comes from the bake.
   */
  async function openCodebase(): Promise<void> {
    reportStage("judging");
    const opened = await codeWorld(veil);
    code = opened;
    reportStage("laid out", { things: opened.world.things.length, symbols: opened.world.symbols.length });
    // Worker threads make the buildings, the landmarks, one build of each distinct tree, stone, bush and flowers, and
    // the wild's bushes while the wait screen draws the land.
    const composedLandmarks = landmarkAsks(opened);
    await makeAhead([...settlementBuilds(opened.buildings), ...composedLandmarks, ...opened.naturalBuilds.trees.map(plantAsk), ...understoryBuilds(opened.naturalBuilds), ...opened.wild.map(plantAsk)]);
    buildTrees(opened.naturalBuilds.trees);
    understory.build(opened.naturalBuilds);
    wildGrowth.build(opened.wild);
    landmarks = composedLandmarks.map((ask) => landmarkOf(composedName(ask.blueprint), ask));
    for (const v of settlement.views()) scene.remove(v.object);
    settlement = createSettlement(light, opened.buildings);
    for (const v of settlement.views()) scene.add(v.object);
    // The wait screen draws each building and landmark at its laid-out place while the world bakes.
    veil.marks(laidOut(opened));
    knowEntities();
    // While the world is open, a refresh from new commits changes only what the journal reads and vitality: the new
    // judgments and each definition's new lines, then each thing's vitality.
    onVitalityUpdate((update) => {
      if (code === null) return;
      const judged = update.judged;
      if (judged !== undefined) {
        const was = code.thing;
        code = { ...code, thing: (of) => judged[of] ?? was(of) };
      }
      if (update.symbols !== undefined) {
        const was = code.world;
        code = { ...code, world: withLines(was, update.symbols) };
        if (places === was) places = code.world;
      }
      setVitality(new Map(Object.entries(update.vitality)));
    });
    skyWorld = opened.sky;
    hour = Number.NaN;
    if (await rebake(opened.spec)) valleyView();
  }

  /** Each building and landmark of a codebase's world at its laid-out place, with what the map draws its mark from, before a bake places it. */
  function laidOut(c: OpenedWorld): Pick<BakedWorld, "buildings" | "landmarks"> {
    const houses = c.world.things.filter((t) => t.as === "building");
    const rises = c.world.things.filter((t) => t.as === "landmark");
    return {
      buildings: settlement.buildings.map((b, i) => ({ x: houses[i]?.x ?? 0, z: houses[i]?.z ?? 0, name: b.represented.name, kind: b.kindName, vitality: b.represented.vitality, plan: b.plan, blueprint: b.blueprint, palette: b.palette })),
      landmarks: c.landmarks.map((l, i) => {
        const lm = landmarks[i] as (typeof landmarks)[number];
        return { x: rises[i]?.x ?? 0, z: rises[i]?.z ?? 0, name: lm.name, vitality: l.vitality, blueprint: lm.blueprint, palette: lm.built.palette };
      }),
    };
  }

  /** The wait screen the first world opens behind (app/renderer/wait/). It lifts as soon as the world is placed. */
  const waiting = takeWait(root.querySelector(".veil") as HTMLElement, OPENING_ASPECT);
  const veil = withStart(waiting.wait, waiting.veil);
  // The wait screen's sheet draws the first world's hills, water and trees as soon as the world is placed.
  let bakedOnce = false;
  bakedListeners.push(() => {
    if (!bakedOnce) veil.baked(bakedWorld());
    bakedOnce = true;
  });

  showAerial(false);
  // The first world bakes behind the veil, which lifts once the world is placed.
  const ready = openCodebase().then(async () => {
    // The trees' far forms load for the person's position before the world shows. Meanwhile the world draws no
    // frames behind the wait screen, so the bakes have the GPU to themselves.
    holding++;
    try {
      await treeSet.stream.open(new THREE.Vector3(walker.x, walker.eye, walker.z), viewFocal());
    } finally {
      letGo();
    }
    reportStage("tree cards", { ...treeSet.stream.stats(), builds: variants.length });
    await warmed;
    // The world's first frames draw behind the paper, so the world shows only once its motion is smooth.
    for (let k = 0; k < LIFT_FRAMES; k++) await new Promise((r) => requestAnimationFrame(r));
    await veil.lift();
    reportStage("lifted");
    for (const listener of liftedListeners) listener();
  });
  const bushesBaked = ready
    .then(() => bushSet.stream.open(light.uEye.value, viewFocal()))
    .then(() => Promise.all(farSets.map((set) => set.stream.settled())))
    .then(() => reportStage("bush cards", { ...bushSet.stream.stats() }));

  /** Whether a person can stand at (x, z): on the land, on dry ground clear of every solid. */
  function standable(x: number, z: number): boolean {
    return withinLand(world, x, z, 4) && waterDepthAt(terrain, x, z) <= LAND.dry && clearanceAt(solids, x, z) >= LAND.clear;
  }

  /** The landing nearest (x, z), as `WorldHandle.landing` describes. */
  function landingNear(x: number, z: number, center?: { readonly x: number; readonly z: number }): Landing | null {
    // A spot on or beside a building lands where a person reads its sign, facing the building.
    const house = settlement.buildings.find((b) => Math.hypot(b.site.x - x, b.site.z - z) < Math.max(b.plan.width, b.plan.depth) * 0.5 + 4);
    if (house !== undefined) {
      const at = settlement.readingSpotOf(house);
      if (waterDepthAt(terrain, at.x, at.z) <= LAND.wade && clearanceAt(solids, at.x, at.z) >= LAND.clear * 0.5) return { x: at.x, z: at.z, yaw: Math.atan2(-(house.site.x - at.x), -(house.site.z - at.z)) };
    }
    const asked = placeAt(places, x, z).area;
    const fits = (px: number, pz: number, depth: number): boolean => {
      if (waterDepthAt(terrain, px, pz) > depth || clearanceAt(solids, px, pz) < LAND.clear) return false;
      const area = placeAt(places, px, pz).area;
      return asked.depth < 0 ? area.depth < 0 : area.path === asked.path && area.depth === asked.depth;
    };
    let spot: { x: number; z: number } | null = null;
    for (const depth of [LAND.dry, LAND.wade]) {
      for (let r = 0; r <= LAND.reach && spot === null; r += LAND.ring) {
        const count = Math.max(1, Math.round((Math.PI * 2 * r) / LAND.ring));
        for (let k = 0; k < count; k++) {
          const a = (k / count) * Math.PI * 2;
          const px = x + Math.cos(a) * r;
          const pz = z + Math.sin(a) * r;
          if (fits(px, pz, depth)) {
            spot = { x: px, z: pz };
            break;
          }
        }
      }
      if (spot !== null) break;
    }
    // If no spot in its own area fits, as in a wide pond or a thicket, take the nearest fit ground in any area, farther out.
    for (let r = LAND.ring; r <= LAND.far && spot === null; r += LAND.ring) {
      const count = Math.max(1, Math.round((Math.PI * 2 * r) / LAND.ring));
      for (let k = 0; k < count && spot === null; k++) {
        const px = x + Math.cos((k / count) * Math.PI * 2) * r;
        const pz = z + Math.sin((k / count) * Math.PI * 2) * r;
        if (waterDepthAt(terrain, px, pz) <= LAND.wade && clearanceAt(solids, px, pz) >= LAND.clear) spot = { x: px, z: pz };
      }
    }
    if (spot === null) {
      console.warn(`landing: no dry ground clear of everything within ${LAND.far} m of (${Math.round(x)}, ${Math.round(z)})`);
      return null;
    }
    const { x: lx, z: lz } = spot;
    const toward = (tx: number, tz: number): number => Math.atan2(-(tx - lx), -(tz - lz));
    // The person faces the area's building or landmark if one is near, else `center`.
    const area = placeAt(places, lx, lz).area;
    const baked = bakedWorld();
    const thing = [...baked.buildings, ...baked.landmarks]
      .filter((t) => area.depth >= 0 && placeAt(places, t.x, t.z).area.path === area.path)
      .map((t) => ({ t, d: Math.hypot(t.x - lx, t.z - lz) }))
      .filter(({ d }) => d > 6 && d < FACE_THING)
      .sort((a, b) => a.d - b.d)[0]?.t;
    const aim = thing ?? (center !== undefined && Math.hypot(center.x - lx, center.z - lz) > 8 ? center : null);
    // On a path, face along it in the direction closer to what the person would face.
    let best: { d: number; tx: number; tz: number } | null = null;
    for (const way of ways.network.ways) {
      const p = way.points;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const d = Math.hypot((p[k] as number) - lx, (p[k + 1] as number) - lz);
        if (d < FACE_TRAIL && (best === null || d < best.d)) best = { d, tx: (p[k + 2] as number) - (p[k] as number), tz: (p[k + 3] as number) - (p[k + 1] as number) };
      }
    }
    if (best !== null && Math.hypot(best.tx, best.tz) > 1e-6) {
      const sign = aim === null || best.tx * (aim.x - lx) + best.tz * (aim.z - lz) >= 0 ? 1 : -1;
      return { x: lx, z: lz, yaw: Math.atan2(-best.tx * sign, -best.tz * sign) };
    }
    return { x: lx, z: lz, yaw: aim === null ? walker.yaw : toward(aim.x, aim.z) };
  }

  // ---------- rendering a thing for its journal painting ----------

  const capture = createCapture(renderer);
  const captureCamera = new THREE.PerspectiveCamera(PAINTING.fov, 1, 0.2, 4500);
  /** The far-place painting in progress, which the next one waits for. */
  let painting: Promise<void> = Promise.resolve();
  /** A painting's subject: its position, height, radius, and where to stand to see it. */
  type Seen = Pick<Subject, "x" | "z" | "height" | "reach" | "readingSpot">;
  /**
   * What represents `id`: the thing itself, or for a file without a tree its
   * tallest definition, or for a file with nothing placed on it, such as a
   * document, its own patch of ground.
   */
  function subjectOf(id: string): Seen | undefined {
    const own = subjects.find((s) => s.represented.id === id);
    if (own !== undefined) return own;
    const largest = subjects.filter((s) => s.represented.id.startsWith(`${id}#`)).sort((a, b) => b.height - a.height)[0];
    if (largest !== undefined) return largest;
    const cells = code?.world.cells.filter((k) => k.file === id) ?? [];
    if (cells.length === 0) return undefined;
    const x = cells.reduce((n, k) => n + k.x, 0) / cells.length;
    const z = cells.reduce((n, k) => n + k.z, 0) / cells.length;
    const reach = Math.min(PATCH_SEEN.reach, Math.max(...cells.map((k) => Math.hypot(k.x - x, k.z - z))) + 2);
    return {
      x,
      z,
      height: PATCH_SEEN.height,
      reach,
      readingSpot: (fx, fz) => {
        const d = Math.hypot(fx - x, fz - z) || 1;
        return { x: x + ((fx - x) / d) * (reach + 3), z: z + ((fz - z) / d) * (reach + 3) };
      },
    };
  }
  /**
   * Where to stand to see `s` whole from `distance` meters away. The search
   * starts on the side the afternoon sun lights and turns around the thing
   * until the spot is dry, clear and inside the land, with no solid or rise
   * of ground in between. A building is seen from the direction of its sign.
   * No tree crown may be in front of the thing or fill the picture's side,
   * where `half` is the painting's half width as a tangent. If no near spot
   * is clear of crowns, the search tries farther back. If none is, as deep in
   * a wood, a page's painting uses the spot it would have without that rule,
   * framed by its trees. For the frontispiece (`wide`), the search always
   * starts on the sunlit side, and the lines to the thing's sides and top
   * must be clear too.
   */
  function viewpointOf(s: Seen, distance: number, eye: number, aim: number, half: number, wide: boolean): { x: number; z: number } {
    const fixed = s.readingSpot(s.x + 1, s.z);
    const other = s.readingSpot(s.x - 1, s.z);
    const sun = light.uSunDirection.value;
    // The frontispiece is always painted from the sunlit side, since a building's sign side may be in shadow.
    const signed = !wide && fixed.x === other.x && fixed.z === other.z;
    const first = signed ? Math.atan2(fixed.x - s.x, fixed.z - s.z) : Math.atan2(sun.x, sun.z) + PAINTING.sunSide;
    const base = heightAt(terrain.lattice, s.x, s.z);
    /** Whether neither the ground nor a solid is between the eye at (x, z) and the point `side` meters across the thing and `up` meters above its foot. */
    const lineClear = (x: number, z: number, side: number, up: number): boolean => {
      const span = Math.hypot(s.x - x, s.z - z);
      const [tx, tz] = [s.x + ((s.z - z) / span) * side, s.z - ((s.x - x) / span) * side];
      const from = heightAt(terrain.lattice, x, z) + eye;
      const to = base + up;
      for (let d = 1; d < span - s.reach - 0.5; d += 1) {
        const t = d / span;
        const [px, pz] = [x + (tx - x) * t, z + (tz - z) * t];
        if (clearanceAt(solids, px, pz) < 0.25 || heightAt(terrain.lattice, px, pz) > from + (to - from) * t - 0.3) return false;
      }
      return true;
    };
    /** Whether a tree crown is in front of the thing, or fills the picture's side in front of it, seen from (x, z). */
    const crownInView = (x: number, z: number): boolean => {
      const span = Math.hypot(s.x - x, s.z - z);
      const [ux, uz] = [(s.x - x) / span, (s.z - z) / span];
      return trees.some((t) => {
        const crown = (variants[t.variant] as TreeVariant).radius * t.scale;
        const along = (t.x - x) * ux + (t.z - z) * uz;
        if (along <= 0 || along + crown > span - s.reach * 0.5) return false;
        const across = Math.abs((t.x - x) * uz - (t.z - z) * ux);
        return across < s.reach + crown || (across - crown < along * half && crown > along * CROWN_IN_VIEW);
      });
    };
    const clearFrom = (x: number, z: number): boolean => {
      if (!withinLand(world, x, z, 2) || waterDepthAt(terrain, x, z) > LAND.wade || clearanceAt(solids, x, z) < 0.6) return false;
      if (!wide) return lineClear(x, z, 0, aim);
      const across = s.reach * 0.8;
      return lineClear(x, z, 0, s.height * 0.3) && lineClear(x, z, 0, s.height) && lineClear(x, z, -across, s.height * 0.5) && lineClear(x, z, across, s.height * 0.5);
    };
    /** The first spot around the thing, trying each of `backs` times `distance` away, where `fits` holds. */
    const search = (fits: (x: number, z: number) => boolean, backs: readonly number[]): { x: number; z: number } | null => {
      for (const back of backs) {
        for (let k = 0; k < 16; k++) {
          // Turning a little farther each way in turn: 0, +22.5°, -22.5°, +45°, …
          const turn = Math.ceil(k / 2) * (k % 2 === 1 ? 1 : -1) * (Math.PI / 8);
          const x = s.x + Math.sin(first + turn) * distance * back;
          const z = s.z + Math.cos(first + turn) * distance * back;
          if (fits(x, z)) return { x, z };
        }
      }
      return null;
    };
    // Search twice. A single search that includes the crowns would fall back to the bare first direction, which can
    // be in water, wherever every spot has a crown in view.
    const clearOfCrowns = search((x, z) => clearFrom(x, z) && !crownInView(x, z), [1, 1.3, 1.7]);
    if (clearOfCrowns !== null) return clearOfCrowns;
    return (wide ? null : search(clearFrom, [1])) ?? { x: s.x + Math.sin(first) * distance, z: s.z + Math.cos(first) * distance };
  }
  /**
   * Where a painting of `s` with width-to-height `aspect` is taken from, the eye height and the aim height, in the
   * painting's light. With `wide`, it frames the frontispiece, with the thing in the lower part under the sky that
   * shows the world's name.
   */
  function framingOf(s: Seen, aspect: number, wide: boolean): { at: { x: number; z: number }; eye: number; aim: number } {
    const tan = Math.tan(THREE.MathUtils.degToRad(PAINTING.fov) / 2);
    // Far enough back that the thing fills its share of the painting's height and most of its width.
    const fill = wide ? PAINTING.wideFill : PAINTING.fill;
    const distance = Math.max(s.height / (2 * tan * fill), (2 * s.reach) / (2 * tan * aspect * 0.7), s.reach + 2.5);
    // A small thing is painted from a crouching eye height, and anything taller from a person's eye. For `wide`, the
    // eye aims above the thing's center, so the thing sits low and the sky fills the painting's upper part.
    const eye = wide ? EYE_HEIGHT : Math.min(EYE_HEIGHT, Math.max(0.9, s.height * 0.8 + 0.5));
    const aim = wide ? s.height * 0.5 + 2 * tan * PAINTING.wideLow * distance : s.height * 0.55;
    return { at: viewpointOf(s, distance, eye, aim, tan * aspect, wide), eye, aim };
  }
  function seenFromOf(id: string): Landing | null {
    const s = subjectOf(id);
    if (s === undefined) return null;
    const was = hour;
    applyHour(PAINTING.hour);
    try {
      const { at } = framingOf(s, PAINTED_ASPECT, false);
      return { x: at.x, z: at.z, yaw: Math.atan2(-(s.x - at.x), -(s.z - at.z)) };
    } finally {
      applyHour(was);
    }
  }
  function viewOf(id: string, w: number, h: number, wide = false): Promise<{ color: Pixels; mask: Pixels } | null> {
    // While the world is changing it draws nothing, so the view waits until every hold, such as shaders warming or a
    // new world settling, is released. Waiting on the warming alone made a view requested while a new world settled
    // retry at once forever, and the page never drew another frame.
    if (holding > 0) return settled().then(() => viewOf(id, w, h, wide));
    const s = subjectOf(id);
    if (s === undefined) return Promise.resolve(null);
    // A place beyond the person's loaded land is painted on separate land loaded around it (`land.aside`), one
    // painting at a time, while the person's land keeps following them. The separate land is swapped in only while
    // the painting draws, so nothing the person sees changes.
    if (Math.hypot(s.x - walker.x, s.z - walker.z) > PAINTING.near) {
      const done = painting
        .then(() => land.aside(s.x, s.z))
        .then((aside) => {
          if (aside === null) return null;
          return aside.paint(() => paintView(s, w, h, wide));
        });
      painting = done.then(() => undefined, () => undefined);
      return done;
    }
    return paintView(s, w, h, wide);
  }
  /** Paints `s` on the currently loaded land, at the painting's hour. */
  function paintView(s: NonNullable<ReturnType<typeof subjectOf>>, w: number, h: number, wide: boolean): Promise<{ color: Pixels; mask: Pixels } | null> {
    return atPaintingHour(() => {
      const { at, eye, aim } = framingOf(s, w / h, wide);
      const base = heightAt(terrain.lattice, s.x, s.z);
      const from = new THREE.Vector3(at.x, heightAt(terrain.lattice, at.x, at.z) + eye, at.z);
      const shade = { x: (at.x + s.x) / 2, y: base, z: (at.z + s.z) / 2, reach: Math.max(40, Math.hypot(at.x - s.x, at.z - s.z) + s.reach) };
      return shootView(from, new THREE.Vector3(s.x, base + aim, s.z), PAINTING.fov, w, h, shade, { x: s.x, z: s.z, base, height: s.height, reach: s.reach });
    });
  }
  /** The person's own view at the painting's hour, from their eye and facing, with an empty mask. */
  function lookOf(w: number, h: number): Promise<{ color: Pixels; mask: Pixels }> {
    if (holding > 0) return settled().then(() => lookOf(w, h));
    return atPaintingHour(() => {
      const from = camera.position.clone();
      const ahead = from.clone().add(camera.getWorldDirection(new THREE.Vector3()));
      return shootView(from, ahead, camera.fov, w, h, { x: from.x, y: from.y, z: from.z, reach: 80 }, { x: from.x, z: from.z, base: from.y - 1e4, height: 0, reach: 0 });
    });
  }
  /** Runs `take` with the world lit at the painting's hour, then restores the current hour's light. */
  function atPaintingHour<T>(take: () => T): T {
    const was = hour;
    applyHour(PAINTING.hour);
    try {
      return take();
    } finally {
      applyHour(was);
    }
  }
  /**
   * Renders a painting from `from` toward `toward` with `fov`, `w` by `h`. Every pass thins detail by distance from
   * that eye, the finest ground and the grass center on it, the sun's shadow covers `shade`, and the water's mirror is
   * drawn for it. The mask shows `subject`.
   */
  function shootView(from: THREE.Vector3, toward: THREE.Vector3, fov: number, w: number, h: number, shade: { x: number; y: number; z: number; reach: number }, subject: CaptureBounds): Promise<{ color: Pixels; mask: Pixels }> {
    captureCamera.fov = fov;
    captureCamera.aspect = w / h;
    captureCamera.position.copy(from);
    captureCamera.lookAt(toward);
    light.uEye.value.copy(captureCamera.position);
    applyAir(from);
    ground.follow(from.x, from.z);
    grass.follow(captureCamera.position);
    shadowCenter.set(shade.x, shade.y, shade.z);
    shadow.frame(shadowCenter, shade.reach);
    castShadows();
    mirror(captureCamera, [ground.mirror], 0);
    // The next frame restores the person's eye, air, ground, grass, shadow and mirror.
    return capture.shoot(scene, captureCamera, [sky.mesh, ground.wilds, ground.fine, ground.coarse, ground.mirror, grass.mesh, water.group, signs.mesh], subject, w, h);
  }

  /**
   * Sound sources indexed in square cells, so working out what the person
   * hears costs the same in a world of any size: the streams' stations and
   * the trees by cell, and the waterwheels. Rebuilt when the land, the trees
   * or the settlement change.
   */
  let earshotIndex: { terrain: Terrain; trees: readonly Tree[]; settlement: Settlement; stations: Map<number, Station[]>; crowns: Map<number, Tree[]>; wheels: Building[] } | null = null;
  const EAR = {
    /** The cell side, and the farthest a stream or waterwheel is heard, in meters. */
    cell: 32,
    reach: 96,
    /** The radius around the person for measuring canopy cover, and how far they move before it is measured again, in meters. */
    canopy: 12,
    move: 2,
  } as const;
  const cellOf = (v: number): number => Math.floor(v / EAR.cell);
  const cellKey = (cx: number, cz: number): number => (cx + 32768) * 65536 + (cz + 32768);
  function filed<T>(items: readonly T[], at: (t: T) => { readonly x: number; readonly z: number }): Map<number, T[]> {
    const cells = new Map<number, T[]>();
    for (const item of items) {
      const p = at(item);
      const key = cellKey(cellOf(p.x), cellOf(p.z));
      const cell = cells.get(key);
      if (cell === undefined) cells.set(key, [item]);
      else cell.push(item);
    }
    return cells;
  }
  function* within<T>(cells: Map<number, T[]>, x: number, z: number, reach: number): Generator<T> {
    for (let cx = cellOf(x - reach); cx <= cellOf(x + reach); cx++) for (let cz = cellOf(z - reach); cz <= cellOf(z + reach); cz++) yield* cells.get(cellKey(cx, cz)) ?? [];
  }
  function earshotFiles(): NonNullable<typeof earshotIndex> {
    if (earshotIndex?.terrain === terrain && earshotIndex.trees === trees && earshotIndex.settlement === settlement) return earshotIndex;
    earshotIndex = {
      terrain,
      trees,
      settlement,
      stations: filed(
        terrain.streams.flatMap((st) => st.stations),
        (p) => p,
      ),
      crowns: filed(trees, (t) => t),
      wheels: settlement.buildings.filter((b) => b.wheel !== null && b.byWater),
    };
    canopyAt = { x: Infinity, z: Infinity, cover: 0 };
    return earshotIndex;
  }
  /** The canopy cover at the last measured spot. `canopyOver` measures again once the person moves `EAR.move` meters. */
  let canopyAt = { x: Infinity, z: Infinity, cover: 0 };
  function canopyOver(crowns: Map<number, Tree[]>, x: number, z: number): number {
    if (Math.hypot(x - canopyAt.x, z - canopyAt.z) < EAR.move) return canopyAt.cover;
    let cover = 0;
    for (const t of within(crowns, x, z, EAR.canopy * 2)) {
      const v = variants[t.variant];
      if (v === undefined) continue;
      const r = v.radius * t.scale;
      const d = Math.hypot(t.x - x, t.z - z);
      if (d > r + EAR.canopy) continue;
      // Each crown covers its share of the sky within `canopy`, fading out past its own edge.
      cover += ((r * r) / (EAR.canopy * EAR.canopy)) * Math.min(1, Math.max(0, (r + EAR.canopy - d) / EAR.canopy));
    }
    canopyAt = { x, z, cover: Math.min(1, cover) };
    return canopyAt.cover;
  }
  function earshot(): Earshot {
    const { x, z, yaw } = walker;
    const files = earshotFiles();
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const heard = (tx: number, tz: number, d: number): Heard => {
      const dx = tx - x;
      const dz = tz - z;
      // Positive to the right of the view direction. Right is (cos yaw, -sin yaw).
      return { d: Math.max(0, d), bearing: (Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz) * 180) / Math.PI };
    };
    let stream: (Heard & { width: number }) | null = null;
    for (const p of within(files.stations, x, z, EAR.reach)) {
      const d = Math.hypot(p.x - x, p.z - z) - p.halfWidth;
      if (d <= EAR.reach && (stream === null || d < stream.d)) stream = { ...heard(p.x, p.z, d), d, width: p.halfWidth * 2 };
    }
    let mill: (Heard & { turning: number }) | null = null;
    for (const b of files.wheels) {
      const wheel = b.wheel as NonNullable<Building["wheel"]>;
      const [wx, wz] = siteToWorld(b.site, (wheel.x0 + wheel.x1) / 2, (wheel.z0 + wheel.z1) / 2);
      const d = Math.hypot(wx - x, wz - z);
      if (d <= EAR.reach && (mill === null || d < mill.d)) mill = { ...heard(wx, wz, d), turning: spinAt(b.vitality) };
    }
    const footing = footingAt(terrain, decks, x, z);
    return {
      speed: body === null ? 0 : Math.hypot(body.vx, body.vz),
      travelling: trip !== null,
      underfoot: footing.deck ? "deck" : footing.depth > 0.05 ? "water" : "ground",
      depth: footing.depth,
      night: light.uNightness.value,
      gust: gustAt(x, z, light.uTime.value),
      decline: appliedAir?.decline ?? 0,
      canopy: canopyOver(files.crowns, x, z),
      stream: stream === null ? null : { ...stream, d: Math.max(0, stream.d) },
      mill,
    };
  }

  const handle: WorldHandle = {
    scene,
    light,
    camera,
    person: () => ({ x: walker.x, z: walker.z, yaw: walker.yaw, walking: goal !== null || trip !== null || [...keys].some((k) => k !== "ShiftLeft" && k !== "ShiftRight") }),
    earshot,
    placeAt: (x, z) => placeAt(places, x, z),
    places: () => places,
    code: () => code?.world ?? null,
    baked: bakedWorld,
    onBaked: (listener) => bakedListeners.push(listener),
    onLifted: (listener) => liftedListeners.push(listener),
    furnish: (f) => {
      furnisher = f;
    },
    furnishingSolid: (on) => {
      if (on === furnishSolid) return;
      furnishSolid = on;
      gatherSolids();
    },
    landing: (x, z, center) => landingNear(x, z, center),
    place: (at) => {
      walkTo(at.x, at.z, at.yaw);
      return handle.around(at.x, at.z);
    },
    around: (x, z) => Promise.all([land.around(x, z), thingTiles.ready(x, z)]).then(() => undefined),
    travel: (at, face) => travelTo(at, face),
    trip: () => trip,
    hurry: (on) => {
      if (trip === null || on === (trip.hurry !== null)) return;
      trip.hurry = on ? hurryFor(trip.plan, trip.at) : null;
      // Request the destination at once, so its land has loaded, or nearly, when the trip arrives.
      const end = trip.marks[trip.marks.length - 1];
      if (on && end !== undefined && !end.asked) {
        end.asked = true;
        const at = travelPoint(trip.plan, end.s);
        void thingTiles.fetch(at.x, at.z).then(() => {
          end.ready = true;
        });
      }
    },
    view: (id, w, h, wide) => viewOf(id, w, h, wide),
    look: lookOf,
    seenFrom: (id) => seenFromOf(id),
    thing: (of) => code?.thing(of),
    onVitality: (listener) => vitalityListeners.push(listener),
    onCard: (listener) => cardListeners.push(listener),
    onPick: (listener) => pickListeners.push(listener),
    onHeading: (listener) => headingListeners.push(listener),
  };

  return {
    handle,
    renderer,
    ready,
    report: () => ({
      walking: goal !== null || trip !== null || [...keys].some((k) => k !== "ShiftLeft" && k !== "ShiftRight"),
      worldSize: world.size,
      regions: world.regions.length,
      trees: trees.length,
      landmarks: ways.sites.length,
      trails: ways.network.trails.length,
      ways: ways.network.ways.length,
      bakeMs: Math.round(bakeMs),
      farBakeMs: treeSet.stream.stats().ms,
    }),
    setActive(on: boolean) {
      active = on;
      if (!on) release();
      if (on) resize();
    },
    frame: (dt: number, now: number, h: number) => {
      if (active && !driving) frame(dt, now, h);
    },
    // Each accessor reads or sets the world's own variable the moment a hook uses it, so a hook sees what the world sees.
    inside: {
      renderer,
      scene,
      camera,
      canvas,
      light,
      terrain,
      land,
      thingTiles: thingTiles,
      sky,
      ground,
      grass,
      water,
      drifts,
      signs,
      understory,
      wildGrowth,
      get variants() { return variants; },
      get treeBlueprints() { return treeAsks.map((ask) => ask.blueprint); },
      groves,
      get treeFar() { return treeFar; },
      treeSet,
      bushSet,
      bushesBaked,
      get thingVitality() { return thingVitality; },
      entityOfPlace,
      landmarkPool,
      walker,
      keys,
      passes,
      get spec() { return world; },
      get code() { return code; },
      get places() { return places; },
      get settlement() { return settlement; },
      get landmarks() { return landmarks; },
      get landmarkViews() { return landmarkViews; },
      get landmarkEntities() { return landmarkEntities; },
      get ways() { return ways; },
      get built() { return built; },
      get trees() { return trees; },
      get treeViews() { return treeViews; },
      get treeCopies() { return treeCopies; },
      get subjects() { return subjects; },
      get shown() { return shown; },
      get symbolPlacements() { return symbolPlacements; },
      get decks() { return decks; },
      get broken() { return broken; },
      get solids() { return solids; },
      get goal() { return goal; },
      get tripEnd() { return tripEnd; },
      get skyWorld() { return skyWorld; },
      set skyWorld(b) {
        skyWorld = b;
        hour = Number.NaN;
      },
      get hour() { return hour; },
      get bakeMs() { return bakeMs; },
      get openingSteps() { return openingSteps; },
      get frameCalls() { return frameCalls; },
      get appliedAir() { return appliedAir; },
      get trip() { return trip; },
      set trip(t) { trip = t; },
      get body() { return body; },
      set body(b) { body = b; },
      get arrived() { return arrived; },
      set arrived(on) { arrived = on; },
      get frozen() { return frozen; },
      set frozen(t) { frozen = t; },
      get detailPin() { return detailPin; },
      set detailPin(at) { detailPin = at; },
      get viewPin() { return viewPin; },
      set viewPin(pin) { viewPin = pin; },
      get streamPaused() { return streamPaused; },
      set streamPaused(on) { streamPaused = on; },
      get driving() { return driving; },
      set driving(on) { driving = on; },
      get travelPace() { return travelPace; },
      set travelPace(pace) { travelPace = pace; },
      get forestCopies() { return forestCopies; },
      set forestCopies(n) { forestCopies = n; },
      get swapping() { return swapping; },
      set swapping(copy) { swapping = copy; },
      frame,
      walkTo,
      landingNear,
      travelTo,
      travelWay,
      approach,
      hideCard,
      setVitality,
      valleyView,
      lookFromAbove,
      treeFile,
      vitalityOfPlace,
      landmarkEntity,
      standable,
      press,
      release,
      setGoal,
      updateWalk,
      viewOf,
      rebake,
      instanced,
      treeBuild,
    },
  };
}
