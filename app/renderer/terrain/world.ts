// The world a person walks. A full world of regions, each a biome with a
// landform and a ground cover Jev chose, baked into one heightfield on worker
// threads, which also stand its buildings, landmarks, trails, trees and
// understory, so the page never stops drawing while a world bakes. A person
// walks it at eye height, tapping or clicking the ground to walk there.
// Buildings, landmarks, trees, stones, bushes and flowers stand for code:
// tapping one opens its page in the journal, and standing at one tells the
// journal what the person stopped at. Scripted checks reach inside it through
// `WorldInside`, with the hooks in `hooks.ts`.

import * as THREE from "three";
import { type AtmosphereSpec, type Blueprint, type BuildingPlan, type GroundSpec, Library, type Palette, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, LANDMARK_PRIMITIVES, RELIEF_PRIMITIVES, ROCK_PRIMITIVES, WILDFLOWER_PRIMITIVES, WORLD_PRIMITIVES } from "@gaia/primitives";
import { biome, landmark as landmarkKind, world as worldKind } from "@gaia/kinds";
import { CLEAR_AIR, FLORA_PRESETS, type Realized, type RegionLook, type SkyLook, airFromHeight, mergeParts, mixAir, murkyAir, realizeRegion, realizeSky, regionAir, throughAir } from "@gaia/realize";
import {
  type FarCards,
  LANTERN,
  type PlantView,
  applyLight,
  FAR_BAKE_VERSION,
  createFarCards,
  type FarForm,
  type FarFormData,
  farFormData,
  farFormFrom,
  startFarBake,
  createLantern,
  createPlant,
  createRenderer,
  createSceneLight,
  createSunShadow,
  type SceneLight,
} from "@gaia/render";
import { type Capsule, clearanceAt, groundDecline, regionAt as dominantRegion, frameOf, TILE, LAND_ASPECT, type Deck, decksOf, deckShape, EYE_HEIGHT, footingAt, GAIT, groundHeightAt, heightAt, type Intent, NO_SOLIDS, NO_TRAILS, openingSpot, TRAILS, outlineShape, returnTo, type StoodSpot, withinLand, piecesShapes, type Place, placeAt, planWalk, regionWeights, siteToWorld, type Solids, type SolidShape, solidsOf, standAt, steerAlong, type Steered, type Steering, steering, steerPress, steerRelease, steerStep, stride, type Stride, acrossWay, carry, planTrip, TRAVEL, type Travel, wadingAt, fordBeside, travelFrom, travelPoint, travelStep, type Trip, trailWay, type Walker, type WalkKey, type Terrain, TERRAIN, type TrailNetwork, type Walk, WALK_TO, wallsShape, waterDepthAt, type Way, wayAhead, WILDS, type WorldPlaces, type WorldSpec } from "@gaia/terrain";
import { type Sky, createSky } from "../world/environment.ts";
import { type CaptureBounds, type Pixels, createCapture } from "./capture.ts";
import { onTap, tapSlop } from "../tap.ts";
import { type Grass, createGrass } from "./cover.ts";
import { type GroundMesh, createGround, createGroundTexture } from "./ground.ts";
import { createRegionCovers } from "./regions.ts";
import { type Water, createWater } from "./water.ts";
import { type WildGrowth, createWildGrowth, wildBushBuilds } from "./wilds.ts";
import { type Crown, type Drifts, createDrifts } from "./drifts.ts";
import { type Understory, createUnderstory, understoryBuilds } from "./understory.ts";
import { type BuildAsk, made, makeAhead } from "./made.ts";
import { createClearings } from "./clearings.ts";
import { type WayPiece, type Ways, createWays, crossingVitality, setTrailEnds } from "./trails.ts";
import { reportStage } from "../telemetry.ts";
import { takeWait } from "../wait/wait.ts";
import { withStart } from "../start/start.ts";
import { START_SKY } from "../start/table-scene.ts";
import type { Represented } from "./represent.ts";
import type { CodeWorld } from "@gaia/world";
import { type OpenedWorld, codeWorld } from "./code-world.ts";
import type { JudgedThing } from "../../world-service/protocol.ts";
import { type Building, type Settlement, composedName, createSettlement, settlementBuilds } from "./settlement.ts";
import { type Signs, createSigns } from "./signs.ts";
import { type Baked, createBaker } from "./baker.ts";
import { type PageLand, createPageLand } from "./land.ts";
import { type Standing, createStanding } from "./standing.ts";
import { type Stand, type StandRequest, type StandingLandmark, landmarkBase, ownerVitality, understoryVitality } from "./stand.ts";
import { declineAround, groundVitalityAt, setGroundOwnership, showGroundVitality } from "./vitality.ts";
import type { Drawn, Pass } from "./measure.ts";
import { type Copies, type FarForms, type FarOf, type PassSize, TURN, createCopies, createFarForms } from "./woods.ts";
import { contentHash, openFarStore } from "./far-store.ts";

const TEMPLATE = /* html */ `
<main class="stage">
  <canvas class="view" aria-label="A world of gentle landforms. Click or tap the ground to walk there, and drag to look."></canvas>
  <div class="veil" aria-label="The world is being made"></div>
</main>
`;


/** The keys that move a person, W A S D, the arrows or vim's k h j l: ahead, left, right or back, and Shift. */
const KEYS = {
  ahead: ["KeyW", "ArrowUp", "KeyK"],
  left: ["KeyA", "ArrowLeft", "KeyH"],
  right: ["KeyD", "ArrowRight", "KeyL"],
  back: ["KeyS", "ArrowDown", "KeyJ"],
  hurry: ["ShiftLeft", "ShiftRight"],
} as const;
/** How far a hand's move turns the view, radians a pixel: one to one, with no easing or drift. */
const LOOK = 0.0045;
/** Each key steering reads, by what it is to steering. */
const STEER_KEYS = new Map<string, WalkKey>([...(["ahead", "left", "right", "back"] as const).flatMap((way) => KEYS[way].map((code) => [code, way] as const)), ...KEYS.hurry.map((code) => [code, "shift"] as const)]);
/** The keys that walk or turn, as against Shift alone. */
const WALK_KEYS = new Set<string>([...KEYS.ahead, ...KEYS.left, ...KEYS.right, ...KEYS.back]);
/** How far a tap's ray looks for the ground, meters. */
const REACH = 900;
/** How much of each understory component's outline at the ground stops a walker: all of a rock, and a bush's heart, so the walk brushes its outer leaves. */
const STOPS: Readonly<Record<string, number>> = { rocks: 1, shrubs: 0.7 };
/** A stone whose top stands lower than this above the ground is stepped over, not walked around, meters. */
const STEP_OVER = 0.5;
/** While swimming, the lantern is held at least this far above the water, meters. */
const LANTERN_ABOVE_WATER = 0.15;
/** Walking this far from where a card opened closes it, meters. */
const LEAVE_CARD = 4;
/**
 * Standing still at a thing opens its card as walking up to it does: at a
 * building or landmark after `great` seconds, at anything smaller after
 * `small`, so walking through a grove or a drift of flowers opens none. A
 * thing is at hand while the person stands no farther from it than walking up
 * would bring them and `slack` meters more, and its middle lies within `view`
 * radians of the middle of their view beyond its own breadth there; of those,
 * the one nearest the middle is the one they stopped at.
 */
const STOP_AT = { great: 0.6, small: 1.5, slack: 2, view: 0.45 };
/** Moving slower than this counts as standing still, meters a second. */
const STILL = 0.25;
/** Furnishings (fingerposts, boundary stones) a tap can reach stand about this tall, meters. */
const FURNISHING_TOP = 2.4;

/** One seeded build of a flora preset: every tree is a copy of one. */
export interface TreeVariant {
  /** Radius of the trunk's bottom ring, for grounding. */
  readonly base: number;
  /** The trunk's own radius at its base: what stops a walker. */
  readonly trunk: number;
  readonly height: number;
  /** How far the crown reaches from the trunk. */
  readonly radius: number;
}

/** Something a person can walk up to and ask about: a building or a tree. */
export interface Subject {
  readonly represented: Represented;
  /** Its form in the world, such as "a watermill". */
  readonly standsAs: string;
  /** Where it stands, and where a person stops to read its sign; a tree's spot depends on where they come from. */
  readonly x: number;
  readonly z: number;
  readonly stand: (fromX: number, fromZ: number) => { x: number; z: number };
  /** How tall it stands, meters: arriving, the view turns to frame it. */
  readonly height: number;
  /** How far it reaches from its middle, meters: what a pointer finds and what catches the rim of light. */
  readonly reach: number;
  /** How long a person stands still at it before its card opens, seconds (`STOP_AT`). */
  readonly stop: number;
}

/** Where one tree stands, and which build it copies. */
export interface Tree {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly variant: number;
  readonly scale: number;
  readonly yaw: number;
  /** What it stands for, by index into the world's symbols: a definition, a file or an entity. */
  readonly symbol: number;
  readonly represented: Represented;
}

/** The world as it stands after a bake: what a map draws and what markers stand beside. */
export interface StoodWorld {
  readonly terrain: Terrain;
  /** The paths' ways of tread. */
  readonly ways: readonly Way[];
  /** Each building, with the plan, blueprint and colors its map mark is drawn from. */
  readonly buildings: readonly { readonly x: number; readonly z: number; readonly name: string; readonly kind: string; readonly vitality: number; readonly plan: BuildingPlan; readonly blueprint: Blueprint; readonly palette: Palette }[];
  /** Each landmark, with the blueprint and colors its map mark is drawn from. */
  readonly landmarks: readonly { readonly x: number; readonly z: number; readonly name: string; readonly vitality: number; readonly blueprint: Blueprint; readonly palette: Palette }[];
  readonly trees: readonly { readonly x: number; readonly z: number; readonly vitality: number }[];
  /** Each area's ground cover, by its path: the one the ground shader paints its own ground with. */
  readonly grounds: ReadonlyMap<string, GroundSpec>;
  /**
   * Where each building and landmark was laid out to stand: its entity's lot's middle (`CodeThing`), as the wait
   * learns it with the land, or where it stands in a world not laid out from code. The sheets' names keep off these.
   */
  readonly lots: readonly { readonly x: number; readonly z: number }[];
}

/** Things another layer stands in the world on each bake: the ground they keep bare and what stops a walker. */
export interface Furnishing {
  readonly capsules: readonly Capsule[];
  readonly solids: readonly SolidShape[];
}
const UNFURNISHED: Furnishing = { capsules: [], solids: [] };

/** What the immersive layer reads from the world, and the few ways it steers it. */
export interface WorldHandle {
  readonly scene: THREE.Scene;
  readonly light: SceneLight;
  readonly camera: THREE.PerspectiveCamera;
  /** Where the person stands and which way they look (radians, 0 looking toward -z), and whether they are on the move. */
  person(): { readonly x: number; readonly z: number; readonly yaw: number; readonly walking: boolean };
  /** Where a point is: its area and the file underfoot. */
  placeAt(x: number, z: number): Place;
  /** Every area and file patch of the world standing now. */
  places(): WorldPlaces;
  /** The world laid out from code, when this one was: every definition standing in it among the rest. */
  code(): CodeWorld | null;
  /** The world as it stands now. */
  stood(): StoodWorld;
  /** Calls `listener` after every bake the world takes on. */
  onStood(listener: () => void): void;
  /** Calls `listener` once the wait has given way to the first world standing. */
  onLifted(listener: () => void): void;
  /** Asked on every bake, after the trails are routed and before anything else stands: what to stand beside them. */
  furnish(furnisher: (stood: StoodWorld) => Furnishing): void;
  /** Whether the furnishing stops a walker, as it should while it shows. */
  furnishingSolid(on: boolean): void;
  /**
   * Where a person sent from the map to (x, z) lands, or null if nowhere near
   * is fit: on or beside a building, where its sign is read, looking at it;
   * elsewhere the nearest dry ground clear of every solid, in the same area
   * (in the wild only if (x, z) is), facing along a trail close by, else
   * toward the area's building or landmark, else toward `heart`.
   */
  landing(x: number, z: number, heart?: { readonly x: number; readonly z: number }): Landing | null;
  /** Puts the person at a landing at once: only under cover of a transition, so nothing is seen to jump. Resolves once the land around them is in. */
  place(at: Landing): Promise<void>;
  /**
   * Sends the person along the trails or straight across the land to a
   * landing, the world streaming in around them as they go, until they arrive
   * or take the keys; with `face` they end facing as the landing does. False
   * when neither takes them there, and nothing moves.
   */
  travel(at: Landing, face: boolean): boolean;
  /**
   * The world's own view of a thing, for its painting in the journal, `w` by
   * `h` pixels: its building, landmark or tree, or the plant or stone a
   * definition stands as, by what it stands for (an entity's path, a file's
   * path or a definition's id), seen in the afternoon light from where it can
   * be seen, with a mask of where the thing itself shows. A file with no tree
   * of its own is seen through the largest of its definitions. `wide` sees it
   * low under a wide sky, for the title page, with nothing in front of it. While the world is
   * changing it waits for it to settle. Null when nothing stands for it.
   */
  view(id: string, w: number, h: number, wide?: boolean): Promise<{ readonly color: Pixels; readonly mask: Pixels } | null>;
  /** The person's own view, `w` by `h`, as a painting is taken of it: from their eye the way they face, in the afternoon light, with nothing masked. While the world is changing it waits for it to settle. */
  look(w: number, h: number): Promise<{ readonly color: Pixels; readonly mask: Pixels }>;
  /** Where a thing's painting is seen from, looking at it: where a picture tapped in the journal takes the person. Null when nothing stands for it. */
  seenFrom(id: string): Landing | null;
  /** What the understanding pass judged about a folder, a file or a definition, every score from 0 to 1. */
  thing(of: string): JudgedThing | undefined;
  /** Calls `listener` with what a person has walked up to when its card opens, and with null when it closes. */
  onCard(listener: (thing: CardThing | null) => void): void;
  /**
   * Calls `listener` with what a tapped thing stands for, by its path or id.
   * Once anything listens, a tap on a thing no longer walks the person up to
   * it: the listener opens it instead.
   */
  onPick(listener: (id: string) => void): void;
  /**
   * Calls `listener` with the thing a person is walking up to, or has walked
   * up to while its card shows, from the tap that sends them; null once they
   * turn to something else or its card closes.
   */
  onHeading(listener: (thing: Heading | null) => void): void;
}

/** A thing a person is walking up to: where it stands, how far it reaches and its name. */
export interface Heading {
  readonly x: number;
  readonly z: number;
  readonly reach: number;
  readonly name: string;
}

/** What a person walked up to: what it stands for, and its form in the world, such as "A watermill". */
export interface CardThing {
  readonly represented: Represented;
  readonly standsAs: string;
}

/** Where a person lands and which way they look (radians, 0 looking toward -z). */
export interface Landing {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** A landmark built and measured: its key in the view pool, what it is called, its blueprint, its build and how far its foot reaches. */
export interface Landmark {
  readonly key: string;
  readonly name: string;
  readonly blueprint: Blueprint;
  readonly built: Realized;
  readonly base: number;
}

/** The landmarks standing and the network of paths between every place, from the last bake. */
export interface Settled {
  readonly sites: readonly StandingLandmark[];
  readonly network: TrailNetwork;
  /** Each way's edging stones, set by the bake on the whole land. */
  readonly edging?: Stand["edging"];
}

/** A set of plants that turn far, and how long baking or reading their far forms took, milliseconds. */
export interface FarSet {
  readonly forms: FarForms;
  ms: number;
}

/**
 * A trip along the trails while the person travels (`travelStep`): its
 * plan, where it has them, whether they took the keys, and the way ahead
 * the world is made ready along: a mark every `TRAVEL_MARK` meters, each
 * asked of the standers as the trip comes within `TRAVEL_LOOK` of it.
 */
export interface TripUnderWay {
  readonly plan: Trip;
  at: Travel;
  stopping: boolean;
  readonly marks: { readonly s: number; asked: boolean; ready: boolean }[];
  readonly began: number;
  setOff: number | null;
  waited: number;
}

/** How the last trip ended, for measuring: arrived or stopped, how far along, and what the keys and a tap's walk held then. */
export interface TripEnd {
  done: boolean;
  s: number;
  length: number;
  keys: string[];
  goal: boolean;
  by?: string;
}

/** The way a trip takes to a landing, the meters walked off the tread at each end, and which way it went (`travelWay`). */
export interface TripWay {
  way: Walker[];
  off: { start: number; end: number };
  by: "near" | "trails" | "across";
}

/** Where the view is drawn from, when held apart from the person: where the eye is, how high, and which way it looks. */
export interface ViewPin {
  readonly x: number;
  readonly z: number;
  readonly eye: number;
  readonly yaw: number;
  readonly pitch: number;
}

/** The air last laid where the eye is: the ground's decline around it, its height above the land, and the air itself. */
export interface LaidAir {
  readonly decline: number;
  readonly height: number;
  readonly air: AtmosphereSpec;
}

/** A bark vertex lower than this, meters, belongs to the trunk's base where it meets the ground. */
const TRUNK_BASE = 0.05;
/** Where a landing may be: water no deeper than this (dry first, then wading), this far from any solid, and how far it looks from the spot asked for, meters. */
const LAND = { dry: 0.02, wade: 0.45, clear: 1.1, reach: 40, ring: 1.5, far: 160 };
/**
 * How the journal's paintings are seen: every one in the same afternoon
 * light, so the book's paintings belong together; through a lens a little
 * longer than a person's eye; the thing filling about half the painting's
 * height; and the sun a little to one side behind the painter. Wide, as the
 * title page's frontispiece shows the repository's own building or landmark,
 * the thing fills `wideFill` of the painting's height from a person's eye,
 * its middle `wideLow` of the height below the painting's middle, so the sky
 * above it takes the world's name. A thing farther than `near` meters from
 * the person is painted on land held around it.
 */
export const PAINTING = { hour: 15.5, fov: 46, fill: 0.5, wideFill: 0.36, wideLow: 0.12, sunSide: 0.6, near: 120 } as const;
/**
 * A tree's crown in front of the frontispiece's thing, or this big a share of its own distance anywhere in the
 * painting in front of it, would hide the thing or fill the picture's side, so the painter stands elsewhere.
 */
const CROWN_IN_VIEW = 0.08;
/** A journal page's painting, wide to tall. */
const PAINTED_ASPECT = 520 / 660;
/** A file with nothing standing on it is painted as its patch of ground: how tall a view of it frames, and how far it reaches at most, meters. */
const PATCH_SEEN = { height: 1.6, reach: 14 } as const;
/** A landing faces along a trail this close, else the area's building or landmark this close, meters. */
const FACE_TRAIL = 14;
const FACE_THING = 160;

/** The world a person walks, as the page holds it: it draws a frame at a time at the clock's hour. */
export interface World {
  /** What the immersive layer reads and steers. */
  readonly handle: WorldHandle;
  /** The world's renderer, so the page can count its draw calls. */
  readonly renderer: THREE.WebGLRenderer;
  /** Settles once the first world stands and the wait has lifted from it. */
  readonly ready: Promise<void>;
  /** What the world shows right now, for smoothness reports: plain numbers, words and flags. */
  readonly report: () => Readonly<Record<string, string | number | boolean>>;
  /** An inactive world draws nothing and ignores the keys. */
  setActive(on: boolean): void;
  /** Draws one frame; `dt` is seconds since the last, `hour` the local hour the world shows. */
  frame(dt: number, now: number, hour: number): void;
  /** What the hooks in `hooks.ts` read and steer inside the world. */
  readonly inside: WorldInside;
}

/**
 * What the hooks in `hooks.ts` read and steer inside the world: its parts,
 * what stands now (read when a hook asks), the person, the last frame, how a
 * measure holds the world still, and the steps the world itself takes.
 * Nothing a person does goes through here.
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
  readonly standing: Standing;
  readonly sky: Sky;
  readonly ground: GroundMesh;
  readonly grass: Grass;
  readonly water: Water;
  readonly drifts: Drifts;
  readonly signs: Signs;
  readonly understory: Understory;
  readonly wildGrowth: WildGrowth;
  /** Each tree build, its instances and its far form, by its index among the builds. */
  readonly variants: readonly TreeVariant[];
  readonly groves: ReadonlyMap<number, Copies>;
  readonly treeFar: readonly FarOf[];
  /** The trees' far forms, and the bushes', which bake once the wait has lifted and are ready when `bushesBaked` settles. */
  readonly treeSet: FarSet;
  readonly bushSet: FarSet;
  readonly bushesBaked: Promise<void>;
  /** Every entity's vitality by its path, the entity each trail end stands for, and each file's vitality where a hook has set it. */
  readonly entityVitality: ReadonlyMap<string, number>;
  readonly entityOfPlace: ReadonlyMap<string, string>;
  readonly liveFileVitality: Map<string, number>;
  /** Every landmark view made so far, by its key. */
  readonly landmarkPool: ReadonlyMap<string, PlantView>;
  // What stands now.
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
  readonly decks: readonly Deck[];
  readonly broken: readonly Deck[];
  readonly solids: Solids;
  // The person.
  readonly walker: { x: number; z: number; yaw: number; pitch: number; eye: number };
  readonly keys: ReadonlySet<string>;
  readonly goal: Walk | null;
  trip: TripUnderWay | null;
  readonly tripEnd: TripEnd | null;
  body: Stride | null;
  /** Whether the person walked up to the thing they stand at, which keeps its card until they move on. */
  arrived: boolean;
  // The last frame and the last bake.
  readonly hour: number;
  readonly bakeMs: number;
  readonly openingSteps: Readonly<Record<string, number>>;
  readonly frameCalls: number;
  readonly passes: Readonly<Record<Pass, Drawn>>;
  readonly breathed: LaidAir | null;
  // How a measure or a capture holds the world.
  /** The wind's clock, held at this many seconds, or null to run. */
  frozen: number | null;
  /** Where every detail is chosen from, when pinned apart from the eye. */
  detailPin: { readonly x: number; readonly z: number } | null;
  viewPin: ViewPin | null;
  /** While a measure draws a held view, nothing streams. */
  streamHeld: boolean;
  /** While a measure drives the frames itself, the page's own loop draws none. */
  driving: boolean;
  /** Meters a second along a trip's tread. */
  travelPace: number;
  /** How many times each tree that stands for code stands (`forest`). */
  forestCopies: number;
  /** The copy the swap test stands alone while it runs. */
  swapping: Copies | null;
  // The steps the world takes.
  /** Draws one frame now, whatever holds the page's own loop. */
  frame(dt: number, now: number, at: number): void;
  walkTo(x: number, z: number, yaw: number, pitch?: number): void;
  landingNear(x: number, z: number, heart?: { readonly x: number; readonly z: number }): Landing | null;
  travelTo(at: Landing, face: boolean): boolean;
  travelWay(from: Walker, at: Walker): TripWay | null;
  approach(s: Subject): void;
  hideCard(): void;
  setEntityVitality(id: string, v: number): void;
  showLandVitality(): void;
  valleyView(stood?: StoodSpot): void;
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

/** A thing's name as it stands in the world, such as "An archive tower". */
const withArticle = (name: string): string => `${/^[aeiou]/i.test(name) ? "An" : "A"} ${name.toLowerCase()}`;

/** The shape, width over depth, of the land the world opens on: a codebase's takes the journal spread's, the proving ground's is square. */
export const OPENING_ASPECT = new URLSearchParams(location.search).get("world") === "proving" ? 1 : LAND_ASPECT;
/** Frames the first world draws under the wait before it lifts, its shaders already compiled (`warmSoon`), so it moves smoothly from the first. */
const LIFT_FRAMES = 4;
/**
 * Baking far forms: at most this many views of a form a frame (960 make a
 * form), within `ms` milliseconds under the wait, so it keeps painting while
 * every tree build bakes, and within `walkingMs` once the world is open, while
 * the bushes' forms bake.
 */
const FAR_BAKE = { views: 24, ms: 6, walkingMs: 2 } as const;
/** The air seen through from above (the `overview` hook): clear, and thinning with the world's size so the whole of it stays legible. */
const overviewAir = (size: number): AtmosphereSpec => ({ ...CLEAR_AIR, density: 0.0008 * Math.min(1, 320 / size) });
/** How far round the eye failing ground murks the air, meters: the band regions' airs blend over, so murk gathers as gradually as a region's air. */
const MURK_REACH = TERRAIN.blend;
/** Seeded builds per flora preset: a tree copies one of its form's. */
export const TREE_BUILDS = 3;
/** Each flora preset's seeded builds, preset by preset, as the woods copy them. */
const TREE_ASKS: readonly BuildAsk[] = FLORA_PRESETS.flatMap((preset, p) =>
  Array.from({ length: TREE_BUILDS }, (_, k): BuildAsk => ({ kind: "flora", blueprint: preset.blueprint, seed: seedOf(`terrain-lab/tree-${p}-${k}`), facts: { scale: 1, age: 120 } })),
);
/** Every build the world makes as it opens, whatever codebase it shows: what the page makes ahead (made.ts). */
export const openingBuilds = (): BuildAsk[] => [...TREE_ASKS, ...understoryBuilds(), ...wildBushBuilds()];

export function createWorld(root: HTMLElement): World {
  root.innerHTML = TEMPLATE;
  const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
  const floraLib = new Library(FLORA_PRIMITIVES);
  let active = false;

  const baker = createBaker();
  // The land around the person, baked in chunks from each world's plan: its level, dry placeholder until the first world opens.
  const land = createPageLand();
  const terrain: Terrain = land.terrain;
  let world: WorldSpec = terrain.spec;
  let bakeMs = 0;
  /** Milliseconds each step of the last world's opening took, on the bake's threads and then on the page. */
  let openingSteps: Record<string, number> = {};
  // What another layer stands beside the trails, and where a person is.
  /** What stops a walker without the furnishing. */
  let bodies: SolidShape[] = [];
  /** Every footbridge's deck; those a walk stands on above the water, while each holds at its way's vitality; and those that no longer hold, which a walk goes round and a trip fords beside. */
  let allDecks: readonly Deck[] = [];
  let decks: readonly Deck[] = [];
  let broken: readonly Deck[] = [];
  let places: WorldPlaces = { name: "", size: world.size, areas: [], patches: [], cells: [] };
  let furnisher: ((stood: StoodWorld) => Furnishing) | null = null;
  let furnished: Furnishing = UNFURNISHED;
  let furnishSolid = true;
  const stoodListeners: (() => void)[] = [];
  const liftedListeners: (() => void)[] = [];

  // ---------- landmarks and trails ----------
  // Each landmark stands on its lot, and trails tie the buildings and
  // landmarks Jev wants joined; `standWorld` places them on the bake thread.
  const landmarkLib = new Library([...LANDMARK_PRIMITIVES, ...FLORA_PRIMITIVES]);
  /** Builds and measures a landmark. */
  const landmarkOf = (name: string, ask: BuildAsk): Landmark => {
    const built = made(ask, landmarkLib);
    return { key: `${ask.blueprint.id}:${ask.seed}`, name, blueprint: ask.blueprint, built, base: landmarkBase(built) };
  };
  /** The landmarks of the world shown, each as Jev composed it. */
  let landmarks: Landmark[] = [];
  /** What builds each landmark Jev composed for a codebase's world. */
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
  // A building for each thing the world stands as one, each on a pad leveled into the bake; none until a world opens.
  let settlement = createSettlement(light, []);
  /** The codebase's world shown: what every area, patch, building, landmark and trail stands for. */
  let code: OpenedWorld | null = null;
  /** The light, sky and wind the world shows: the start's own until the codebase's world opens, then the one Jev composed for it. */
  let skyWorld: Blueprint = START_SKY;
  let ways: Settled = { sites: [], network: NO_TRAILS };
  // Every entity's vitality by its path, live: buildings, landmarks, plants, stones and flowers
  // stand for entities, and each trail's wear follows the two it joins. Names repeat
  // (two packages may both be called "utils"), so nothing is keyed by name.
  let landmarkEntities: Represented[] = [];
  const entityVitality = new Map<string, number>();
  /** The entity (its path) each trail end stands for, by the place id the trail names: a building's name or lot, a standing landmark's place, or an entity's own path where it stands as a plant, a stone or flowers. */
  const entityOfPlace = new Map<string, string>();
  /** Learns the entities of the world now shown. */
  function knowEntities(): void {
    landmarkEntities = code?.landmarks.map((l) => l.represented) ?? [];
    entityVitality.clear();
    entityOfPlace.clear();
    for (const r of [...settlement.buildings.map((b) => b.represented), ...landmarkEntities]) entityVitality.set(r.id, r.vitality);
    settlement.buildings.forEach((b, i) => {
      entityOfPlace.set(b.represented.name, b.represented.id);
      const lot = code?.stand.lots[i];
      if (lot !== undefined) entityOfPlace.set(lot.id, b.represented.id);
    });
    // An entity standing as a plant, a stone or flowers, at the vitality that shows on it.
    for (const s of code?.world.standing ?? []) {
      if (s.of !== "entity") continue;
      entityVitality.set(s.path, s.vitality);
      entityOfPlace.set(s.path, s.path);
    }
  }
  knowEntities();
  /** The entity standing landmark `i` stands for: the one its place names. */
  const landmarkEntity = (i: number): Represented => {
    const id = ways.sites[i]?.id;
    return landmarkEntities.find((e) => e.id === id) ?? (landmarkEntities[i % landmarkEntities.length] as Represented);
  };
  const vitalityOfPlace = (place: string): number => {
    const id = entityOfPlace.get(place);
    return id === undefined ? 1 : (entityVitality.get(id) ?? 1);
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
  /** Every region's cover and every region's drift. A world's first bake sets them before it shows. */
  const updateCovers = (): void => {
    const looks = world.regions.map((_, i) => regionLookOf(i));
    regionGrounds = looks.map((l) => l.ground);
    covers.update(world, regionGrounds, terrain);
    drifts.regions(world, looks.map((l) => l.drift));
  };

  const scene = new THREE.Scene();
  const sky = createSky(light);
  const groundTex = createGroundTexture(land);
  const ground = createGround(terrain, light, covers, groundTex);
  const clearings = createClearings(terrain);
  const grass = createGrass(light, groundTex, covers, clearings);
  const water = createWater(terrain, light, groundTex);
  // What each region sets drifting through its air: petals and leaves from its trees, and fireflies.
  const drifts = createDrifts(light, groundTex);
  scene.add(sky.mesh, ground.wilds, ground.fine, ground.coarse, ground.mirror, grass.mesh, water.group, drifts.object);
  updateCovers();
  /** Each standing landmark's view, in the order of `ways.sites`; a kind may stand more than once. */
  let landmarkViews: PlantView[] = [];
  /** Every landmark view made so far, by its kind and which of that kind it is, reused from bake to bake. */
  const landmarkPool = new Map<string, PlantView>();
  let built: Ways | null = null;
  /** Each standing landmark's key in the pool of landmark views: the landmark it is, and which of that landmark's it is. */
  const poolKeys = (sites: readonly StandingLandmark[]): string[] => {
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
  /** Makes the pooled views `sites` need that the pool lacks, one between each `wait`, so placing them builds nothing. */
  async function poolLandmarks(sites: readonly StandingLandmark[], wait: () => Promise<void>): Promise<void> {
    for (const [k, key] of poolKeys(sites).entries()) {
      if (landmarkPool.has(key)) continue;
      poolLandmark((sites[k] as StandingLandmark).landmark, key).object.visible = false;
      await wait();
    }
  }
  /** Stands each landmark on its site and builds the trails' crossings; the ground texture already carries the trails. */
  function placeWays(): void {
    for (const v of landmarkPool.values()) v.object.visible = false;
    const keys = poolKeys(ways.sites);
    landmarkViews = ways.sites.map((s, k) => {
      const key = keys[k] as string;
      const view = landmarkPool.get(key) ?? poolLandmark(s.landmark, key);
      view.object.visible = true;
      view.object.position.set(s.site.x, s.site.y - 0.05, s.site.z);
      // The door faces where its first trail arrives, or the first building.
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

  /** Shows every entity's vitality now on its landmark, on its trails' wear and on what is built along them. Nothing rebuilds. */
  function showVitality(): void {
    landmarkViews.forEach((view, i) => view.setVitality(entityVitality.get(landmarkEntity(i).id) ?? 1));
    setTrailEnds(ways.network, vitalityOfPlace);
    built?.setVitality(vitalityOfPlace);
    holdDecks();
  }

  /** Sets one entity's vitality, by its path, wherever it shows: its building and sign, its landmark, and every trail it joins. */
  function setEntityVitality(id: string, v: number): void {
    entityVitality.set(id, v);
    settlement.buildings.forEach((b, i) => {
      if (b.represented.id !== id) return;
      settlement.setVitality(b, v);
      signs.setVitality(i, v);
    });
    showVitality();
  }

  // Every file's vitality by its path, live, where a hook has changed it from
  // the world's: each file's trees and its patch of ground show it, and each
  // area's lots and water show its files' pooled.
  const liveFileVitality = new Map<string, number>();
  /** Shows each file's vitality now on its ground and on what stands for it, and each area's on its lots and its water. Nothing rebakes. */
  function showLandVitality(): void {
    if (code === null) return;
    const live = new Map(code.world.patches.map((p) => [p.path, liveFileVitality.get(p.path) ?? p.vitality]));
    const { ground, area } = ownerVitality(code.world, (path) => live.get(path) ?? 1);
    showGroundVitality(ground, area);
    showUnderstoryVitality();
  }
  /** Each stone, bush and drift of flowers shows the vitality of what it stands for, or its file's where a hook has changed that. */
  function showUnderstoryVitality(): void {
    const own = (k: number): number => liveFileVitality.get(code?.standing(k)?.file ?? "") ?? code?.stand.symbols[k]?.vitality ?? 1;
    understory.setVitality(understoryVitality({ placements: understory.placements(), symbols: symbolPlacements }, own));
  }
  placeWays();
  for (const v of settlement.views()) scene.add(v.object);
  function placeBuildings(): void {
    // No grass inside a landmark's footprint either: a hollow tower or a great trunk.
    const feet = ways.sites.map((s) => {
      const r = Math.min(landmarks[s.landmark]?.base ?? 2, 4);
      return { ax: s.site.x, az: s.site.z, bx: s.site.x + 0.01, bz: s.site.z, radius: r };
    });
    // Nor round a junction's cairn, so it stands in the open where its ways meet.
    const cairns = ways.network.junctions.flatMap(({ cairn: c }) => (c === null ? [] : [{ ax: c.x, az: c.z, bx: c.x + 0.01, bz: c.z, radius: TRAILS.cairnGround }]));
    // However many buildings, landmarks and cairns a world has, they clear the grass through the one mask.
    clearings.setCapsules([...settlement.clearings(), ...feet, ...cairns, ...furnished.capsules]);
  }
  placeBuildings();
  const signs = createSigns(light);
  scene.add(signs.mesh);

  /** The hour's light, sky and air, from the sky world's day. */
  let hour = Number.NaN;
  let skyLook: SkyLook | null = null;
  function applyHour(h: number): void {
    hour = h;
    const look = realizeSky({ blueprint: skyWorld, kind: worldKind }, worldLib, seedOf("terrain-lab/sky"), h);
    applyLight(light, look.light);
    // How windy the world is: every sway answers the one wind field this many times as hard.
    light.uWind.value = look.wind.strength;
    skyLook = look;
    breathe(camera.position);
  }
  /** Each region's air as Jev chose it, for the world it was realized for, and room for each region's weight. */
  let airs: { readonly world: WorldSpec; readonly airs: readonly AtmosphereSpec[]; readonly weights: Float64Array } | null = null;
  /** The air last laid, with the decline around the eye and the eye's height above the land it was laid for. */
  let breathed: LaidAir | null = null;
  /**
   * Lays the air where the eye stands, at `eye`, in front of the hour's sky: each region's air blended by how near
   * it lies, over the band where landforms and covers blend (`regionWeights`), so it changes gradually as the person
   * crosses from one region into the next. Over failing ground it thickens and greys with the ground's decline around
   * the eye (`declineAround`, `murkyAir`), and it thins with the eye's height above the land (`airFromHeight`). Every
   * pass reads it: the view, the water's mirror and far forms. A view from above looks through thin, clear air instead,
   * so the whole land stays legible.
   */
  function breathe(eye: { readonly x: number; readonly y: number; readonly z: number }): void {
    if (skyLook === null) return;
    if (airs?.world !== world) airs = { world, airs: world.regions.map((r) => regionAir({ blueprint: r.biome, kind: biome }, lib, seedOf(r.id))), weights: new Float64Array(world.regions.length) };
    regionWeights(world, eye.x, eye.z, airs.weights);
    const decline = declineAround(eye.x, eye.z, MURK_REACH);
    const height = eye.y - groundHeightAt(terrain, eye.x, eye.z);
    const local = aerial !== null ? overviewAir(world.size) : airFromHeight(murkyAir(mixAir(airs.airs, airs.weights), decline), height);
    breathed = { decline, height, air: local };
    sky.apply({ light: skyLook.light, ...throughAir(skyLook, local) });
  }
  const shadow = createSunShadow(light, 2048);

  // ---------- plants ----------

  // Trees are copies of a few seeded builds of each preset, drawn as
  // instances: hundreds of trees cost a few draw calls per build.
  /**
   * Each tree build, held only until its instances are made and its far form
   * is baked; asked for after that (the swap test, a build no world has
   * planted yet), it is realized again, the same build.
   */
  const treeBuilds: (Realized | null)[] = TREE_ASKS.map((ask) => made(ask, floraLib));
  const treeBuild = (k: number): Realized => treeBuilds[k] ?? made(TREE_ASKS[k] as BuildAsk, floraLib);
  const variants: TreeVariant[] = treeBuilds.map((built) => {
    const plant = built as Realized;
    const bark = plant.parts.find((part) => part.swatch === "bark");
    // The trunk's base is every bark vertex at the ground, however many sides or lobes the trunk has.
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
  });
  /** How many times each tree that stands for code stands, for measuring at scale (`forest`): once in a world a person walks. */
  let forestCopies = 1;
  let trees: readonly Tree[] = [];
  /** Each tree's copy among its build's instances. */
  let treeCopies: readonly number[] = [];
  /** The trees `forest` stands besides the world's own, each by the symbol it copies, after the world's own symbols. */
  let forestOf: readonly number[] = [];
  /** What a tree stands for (a definition, a file or an entity), and so its file. */
  const treeSymbol = (t: { readonly symbol: number }) => {
    const own = code?.stand.symbols.length ?? 0;
    return code?.standing(t.symbol < own ? t.symbol : (forestOf[t.symbol - own] ?? -1));
  };
  const treeFile = (t: { readonly symbol: number }): string | undefined => treeSymbol(t)?.file;
  const treeVitality = (t: Tree): number => liveFileVitality.get(treeFile(t) ?? "") ?? t.represented.vitality;
  let treeViews: Copies[] = [];
  /** Each build's instances by variant, kept for the life of the world. */
  const groves = new Map<number, Copies>();

  // Every plant that turns far when small on screen: each tree build, by its
  // index among the variants, and the understory's and the wild's bushes.
  const treeForms = createFarForms();
  const bushForms = createFarForms();
  const treeFar: readonly FarOf[] = variants.map((_, k) => treeForms.add(treeBuild(k)));

  // Rocks, bushes and wildflowers, scattered around the trees.
  const understory = createUnderstory(scene, light, new Library([...FLORA_PRIMITIVES, ...ROCK_PRIMITIVES, ...WILDFLOWER_PRIMITIVES]), clearings, bushForms);

  // Before every pass (the sun's shadow, the water's mirror and the view),
  // each instanced blueprint packs only the cells that pass's camera sees.
  // Past the land: the wild's covers and its scattered bushes, which stand for nothing.
  const wildGrowth = createWildGrowth(scene, light, covers, lib, floraLib, bushForms);
  const instanced = (): Copies[] => [...treeViews, ...understory.all(), ...wildGrowth.all()];
  // Far forms: each tree and bush build baked once into its far form, drawn as
  // cards where a copy is small on a pass's screen (woods.ts). A build's form
  // is read from the store when it was baked before; otherwise it bakes a few
  // views a frame, and is stored for next time. The trees' forms bake from the
  // moment the world opens, and the wait lifts only once they are ready, so no
  // frame shows a far tree before its card. The bushes' bake once the world is
  // open: until then every bush draws its full form, and the far ones then
  // change by less than a level of 255 as their cards come in.
  const farSets = [treeForms, bushForms].map((forms): FarSet => ({ forms, ms: 0 }));
  const [treeSet, bushSet] = farSets as [(typeof farSets)[number], (typeof farSets)[number]];
  const farStore = openFarStore(FAR_BAKE_VERSION);
  /** Bakes or reads every form of `set`, `ms` milliseconds a frame, and draws its cards from then on. */
  async function bakeFar(set: (typeof farSets)[number], ms: number): Promise<void> {
    const t0 = performance.now();
    const store = await farStore;
    const forms: FarForm[] = [];
    const turns: number[] = [];
    for (const { plant, px } of set.forms.close()) {
      turns.push(px);
      const key = contentHash(plant.parts, plant.motion, plant.palette, px);
      const kept = (await store?.get(key).catch(() => undefined)) as FarFormData | undefined;
      const stored = kept === undefined ? null : farFormFrom(kept);
      if (stored !== null) {
        // Its layers go to the GPU now, a form a frame: drawn first all at once, a set's uploads held one frame, in
        // the shadow pass, for a tenth of a second or more just after the world appeared.
        for (const layer of stored.atlas.layers) renderer.initTexture(layer);
        forms.push(stored);
        await new Promise((r) => requestAnimationFrame(r));
        continue;
      }
      const bake = startFarBake(renderer, plant, px);
      await bake.ready;
      for (;;) {
        const form = bake.step(ms, FAR_BAKE.views);
        if (form !== null) {
          forms.push(form);
          // A failed write only means the build bakes again next time.
          if (store !== null) void farFormData(renderer, form).then((data) => store.put(key, data)).catch(() => undefined);
          break;
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
    }
    // Each plant's copies take their cards from here, standing in buffers of their own (`createCopies`).
    set.forms.cards = createFarCards(forms, light, turns, TURN);
    set.ms = performance.now() - t0;
  }
  const farBaked = bakeFar(treeSet, FAR_BAKE.ms).then(() => {
    reportStage("tree cards", { ms: Math.round(treeSet.ms) });
    warmSoon();
  });
  const farCardSets = (): FarCards[] => farSets.flatMap((set) => (set.forms.cards === null ? [] : [set.forms.cards]));
  // Each tree build's instances are made a build a frame while the wait holds,
  // so a world's planting only moves copies.
  void (async (): Promise<void> => {
    for (const k of variants.keys()) {
      if (!groves.has(k)) {
        const view = createCopies(treeBuild(k), light, [], treeFar[k]);
        scene.add(view.object);
        groves.set(k, view);
      }
      // Its instances made, the build is the far form's alone until that bakes (`bakeFar`).
      treeBuilds[k] = null;
      await new Promise((r) => requestAnimationFrame(r));
    }
  })();
  let warming = false;
  const viewSize = new THREE.Vector2();
  const bufferSize = new THREE.Vector2();
  scene.onBeforeRender = (_renderer, _scene, passCamera) => {
    if (warming) return;
    const target = renderer.getRenderTarget();
    // The water's mirror, drawn smaller than the view, chooses detail by its
    // own size; the sun's shadow keeps the view's, so shade never changes as
    // a person walks. Crowns are measured in each pass's own device pixels.
    const height = target === null ? renderer.getDrawingBufferSize(bufferSize).y : target.height;
    const size: PassSize =
      passCamera instanceof THREE.PerspectiveCamera
        ? { smaller: target === null ? 1 : renderer.getSize(viewSize).y / target.height, focal: height / 2 / Math.tan(THREE.MathUtils.degToRad(passCamera.fov) / 2), ortho: false }
        : passCamera instanceof THREE.OrthographicCamera
          ? { smaller: 1, focal: height / (passCamera.top - passCamera.bottom), ortho: true }
          : { smaller: 1, focal: 0, ortho: false };
    // Each card measures its copy's crown on this pass's screen itself, from buffers written when the copies stood.
    for (const cards of farCardSets()) cards.pass(size.focal, size.ortho);
    for (const v of swapping === null ? instanced() : [swapping]) v.cull(passCamera, size);
  };
  /** The copy the swap test stands alone while it runs (`swapTest`), when it does. */
  let swapping: Copies | null = null;
  // Uploads every tree's and the understory's geometry, at every level, in
  // one render while the planting already holds the frame, so no level's
  // first appearance ever costs a frame.
  const warmTarget = new THREE.WebGLRenderTarget(1, 1);
  const warmCamera = new THREE.PerspectiveCamera();
  /** While above 0, the world is changing (shaders compiling, a new world settling in) and draws no frames: the wait, or the world as it stood, holds. */
  let holding = 0;
  /** Who waits for the world to settle, woken once nothing holds it. */
  const awaitingSettled: (() => void)[] = [];
  /** Lets go of one hold on the world; the last to let go wakes whoever waits on it. */
  const letGo = (): void => {
    holding--;
    if (holding === 0) for (const wake of awaitingSettled.splice(0)) wake();
  };
  /** Settles once nothing holds the world: at once if nothing does, else when the last hold lets go, never sooner. */
  const settled = (): Promise<void> => (holding === 0 ? Promise.resolve() : new Promise((wake) => awaitingSettled.push(wake)));
  let warmed: Promise<void> = Promise.resolve();
  /**
   * Readies everything to draw without holding the page: every shader the
   * world uses compiles off the page's thread where the browser can, for the
   * view, for the mirror's and the shadow's targets, and as the shadow's
   * depth, while the world draws no frames. Then `warm` uploads every level's
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
  /** Every level of every instanced plant readied to draw one copy, and its far cards, once baked, standing. */
  function readyToWarm(): void {
    for (const v of instanced()) v.warm();
  }
  function warm(): void {
    warming = true;
    readyToWarm();
    renderer.setRenderTarget(warmTarget);
    renderer.render(scene, warmCamera);
    renderer.setRenderTarget(null);
    warming = false;
  }

  /** What the bake thread stands on the codebase's world: plain data from its buildings, landmarks, trails and what stands for code. */
  const standRequest = (): StandRequest => {
    if (code === null) throw new Error("No world to stand: a codebase's world opens first.");
    const symbols = code.stand.symbols;
    const copied = symbols.flatMap((s, i) => (s.rule === "trees" ? [i] : []));
    forestOf = Array.from({ length: forestCopies - 1 }, () => copied).flat();
    return {
      buildings: settlement.requests(),
      landmarks: landmarks.map((lm) => ({ base: lm.base, tree: lm.blueprint.slots.form?.use === "great-tree@1" })),
      trees: { builds: TREE_BUILDS, bases: variants.map((v) => v.base), crowns: variants.map((v) => v.radius) },
      code: forestOf.length === 0 ? code.stand : { ...code.stand, symbols: [...symbols, ...forestOf.map((i) => symbols[i] as (typeof symbols)[number])] },
    };
  };
  /** Each tile's trees, by "ti,tj": what the trees' stander stands. */
  let treesByTile = new Map<string, Tree[]>();
  /** The largest crown among the trees, meters: how far their tiles stand. */
  let largestTree = 0;
  /** The tile of the land holding (x, z), "ti,tj". */
  const tileKeyOf = (x: number, z: number): string => {
    const frame = frameOf(world);
    return `${Math.floor((x - frame.origin) / frame.spacing / TILE.size)},${Math.floor((z - frame.origin) / frame.spacing / TILE.size)}`;
  };
  /** Stands exactly `held` of the trees as copies of their builds; each build keeps its instances and only moves its copies. */
  function standTrees(held: readonly Tree[]): void {
    const copyOf = new Map<Tree, number>();
    treeViews = variants.flatMap((_, k) => {
      const mine = held.filter((t) => t.variant === k);
      mine.forEach((t, c) => copyOf.set(t, c));
      const spots = mine.map((t) => ({ x: t.x, y: t.y, z: t.z, yaw: t.yaw, scale: t.scale, vitality: treeVitality(t) }));
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
    // Each standing tree's copy among its build's, so a file's trees take a new vitality live; -1 for a tree far off.
    treeCopies = trees.map((t) => copyOf.get(t) ?? -1);
  }
  /** Stands the bake's trees and what stands for code as stones, bushes and flowers, placed on the bake thread, and what stops a walker. */
  function plant(stood: Stand): void {
    // Trees keep off the trails, the buildings and the landmarks; the bake thread kept them off.
    // Each tree is a definition, a file or an entity, and takes its vitality.
    trees = stood.trees.map((t) => {
      const sym = treeSymbol(t);
      if (sym === undefined) throw new Error(`Tree ${t.index} stands for nothing in the world's code.`);
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
    symbolPlacements = stood.symbols;
    // The stones, bushes and flowers stand wherever the person is; the bake thread kept them out of buildings, off trails and from under landmarks.
    understory.place(stood.placements);
    showUnderstoryVitality();
    buildSolids();
    // The trees, the trails, the buildings and the landmarks stand again tile by tile around the person (`standing`).
    standing.open(world);
    warmSoon();
  }
  /** Each tree's region, by its index among the trees, found the first time its crown is asked for. */
  let treeRegions = new Map<number, number>();
  /** Every tree within `reach` of (x, z), with its crown, region and its ground's decline, for the leaves and petals it drops (`Drifts.follow`); a tree is known by its index. */
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
  /** What stops a walker: each trunk at its base, the rocks and bushes standing near by their outlines at the ground, and the cottage's walls. */
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
    // A landmark stops a walker at each of its solid pieces: a tower's blocks, each standing stone, a great trunk.
    const standing = ways.sites.flatMap((s, i) => {
      const view = landmarkViews[i];
      const lm = landmarks[s.landmark];
      if (view === undefined || lm === undefined) return [];
      const p = view.object.position;
      return piecesShapes(lm.built.parts, { x: p.x, y: p.y, z: p.z, yaw: view.object.rotation.y });
    });
    // Each building's walls, and what stands beside it, such as a mill wheel in its pit.
    const buildings = settlement.buildings.flatMap((b): SolidShape[] => {
      const e = b.beside;
      const beside = e === null ? [] : [{ points: [[e.x0, e.z0], [e.x1, e.z0], [e.x1, e.z1], [e.x0, e.z1]].flatMap(([lx, lz]) => siteToWorld(b.site, lx as number, lz as number)) }];
      return [...wallsShape(b.plan, b.site), ...beside];
    });
    bodies = [...trunks, ...components, ...standing, ...buildings];
    gatherSolids();
  }
  /** What stops a walker now: the bodies, what furnishes the world when it is solid, and each footbridge that no longer holds. */
  function gatherSolids(): void {
    solids = solidsOf([...bodies, ...(furnishSolid ? furnished.solids : []), ...broken.map(deckShape)]);
  }
  let solids: Solids = NO_SOLIDS;

  // ---------- what stands on the land, tile by tile ----------

  /** The view's device pixels a radian: how far a thing of a given size can be seen. */
  const viewFocal = (): number => renderer.getContext().drawingBufferHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const standing = createStanding(viewFocal);
  standing.add<Tree>({
    name: "trees",
    largest: () => largestTree,
    tile: (ti, tj) => treesByTile.get(`${ti},${tj}`) ?? [],
    stand(held) {
      standTrees(held);
      buildSolids();
    },
  });
  standing.add<WayPiece>({
    name: "trails",
    largest: () => built?.largest ?? 0,
    tile: (ti, tj) => built?.pieces.filter((p) => tileKeyOf(p.x, p.z) === `${ti},${tj}`) ?? [],
    stand: (held) => built?.stand(held),
  });
  standing.add<Building>({
    name: "buildings",
    largest: () => settlement.buildings.reduce((r, b) => Math.max(r, b.radius, b.height / 2), 0),
    tile(ti, tj) {
      const here = settlement.buildings.filter((b) => tileKeyOf(b.site.x, b.site.z) === `${ti},${tj}`);
      // A building far off has no meshes: its build is made on a worker before its tile stands.
      const missing = here.flatMap((b) => (b.standing === null ? [b.ask] : []));
      return missing.length === 0 ? here : makeAhead(missing).then(() => here);
    },
    // Each tile's buildings stand together as one batch, drawn a call per material.
    stand: (held) => settlement.stand(held, scene, (b) => tileKeyOf(b.site.x, b.site.z)),
  });
  standing.add<number>({
    name: "landmarks",
    largest: () => landmarkViews.reduce((r, v) => Math.max(r, v.radius, v.height / 2), 0),
    tile: (ti, tj) => ways.sites.flatMap((s, i) => (tileKeyOf(s.site.x, s.site.z) === `${ti},${tj}` ? [i] : [])),
    stand(held) {
      const keep = new Set(held);
      landmarkViews.forEach((v, i) => (v.object.visible = keep.has(i)));
    },
  });
  /** In the codebase's world, each symbol's placement among the understory's, or -1. */
  let symbolPlacements: readonly number[] = [];
  /** The subject each symbol's placement stands for, by its index in the understory's placements. */
  let symbolAt = new Map<number, Subject>();

  // ---------- signs, and walking up to see what a thing is ----------

  let subjects: Subject[] = [];
  /** The subject each sign names, by the sign's instance. */
  let signSubjects: Subject[] = [];
  /**
   * A building's signboard at the end of its walk, a landmark's at its foot,
   * and a plaque at the foot of a tree facing the middle of the world: every
   * tree standing for a file, which names the file.
   */
  function placeSigns(): void {
    const buildingSubjects: Subject[] = settlement.buildings.map((b) => ({
      represented: b.represented,
      standsAs: withArticle(b.kindName),
      x: b.site.x,
      z: b.site.z,
      stand: () => settlement.standOf(b),
      height: b.height,
      reach: Math.hypot(b.plan.width, b.plan.depth) / 2,
      stop: STOP_AT.great,
    }));
    // A landmark stands for an entity in the codebase's world: walk up to its foot to read it.
    const landmarkSubjects: Subject[] = code === null
      ? []
      : ways.sites.flatMap((s, i) => {
          const thing = code?.landmarks[i];
          const lm = landmarks[s.landmark];
          if (thing === undefined || lm === undefined) return [];
          const { x, z } = s.site;
          return [{
            represented: thing.represented,
            standsAs: withArticle(lm.name),
            x,
            z,
            height: landmarkViews[i]?.height ?? 6,
            reach: lm.base + 1,
            stop: STOP_AT.great,
            stand: (fx: number, fz: number) => {
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
        standsAs: sym === undefined ? "A tree" : withArticle(sym.form),
        x,
        z,
        height: (variants[tree.variant] as TreeVariant).height * tree.scale,
        reach: crown,
        stop: STOP_AT.small,
        // Stop just outside the crown, so the tree and its plaque are in view, not its leaves.
        stand: (fx: number, fz: number) => {
          const d = Math.hypot(fx - x, fz - z) || 1;
          const off = Math.max(3, crown * 0.9 + 1.4);
          return { x: x + ((fx - x) / d) * off, z: z + ((fz - z) / d) * off };
        },
      };
    });
    // A file's functions and classes stand on its patch: walk up to one to read what it is.
    const placed = understory.placements();
    const symbolEntries: (readonly [number, Subject])[] = code === null
      ? []
      : symbolPlacements.flatMap((at, i) => {
          const p = placed[at];
          const sym = code?.standing(i);
          if (p === undefined || sym === undefined) return [];
          const { x, z } = p;
          return [[at, {
            represented: sym.represented,
            standsAs: withArticle(sym.form),
            x,
            z,
            height: (understory.footprint(p.rule, p.variant)?.top ?? 0.8) * p.scale,
            reach: p.radius + 0.3,
            stop: STOP_AT.small,
            stand: (fx: number, fz: number) => {
              const d = Math.hypot(fx - x, fz - z) || 1;
              const off = p.radius + 2.2;
              return { x: x + ((fx - x) / d) * off, z: z + ((fz - z) / d) * off };
            },
          }]];
        });
    const symbolSubjects = symbolEntries.map(([, subject]) => subject);
    subjects = [...buildingSubjects, ...landmarkSubjects, ...treeSubjects, ...symbolSubjects];
    symbolAt = new Map(symbolEntries);
    // A tree that stands for a definition has no plaque, as no other definition has.
    const plaqued = trees.flatMap((tree, i) => (tree.symbol === undefined ? [{ tree, subject: treeSubjects[i] as Subject }] : []));
    signSubjects = [...buildingSubjects, ...landmarkSubjects, ...plaqued.map((p) => p.subject)];
    signs.set([
      ...settlement.buildings.map((b) => {
        const at = settlement.signOf(b);
        return { ...at, y: heightAt(terrain.lattice, at.x, at.z), scale: 1, name: b.represented.name, note: b.represented.what, vitality: b.represented.vitality };
      }),
      ...landmarkSubjects.map((l, i) => {
        const view = landmarkViews[i];
        const yaw = view?.object.rotation.y ?? 0;
        const lm = landmarks[ways.sites[i]?.landmark ?? 0];
        const r = (lm?.base ?? 2) + 3;
        const x = l.x + Math.sin(yaw) * r + Math.cos(yaw) * 1.6;
        const z = l.z + Math.cos(yaw) * r - Math.sin(yaw) * 1.6;
        return { x, y: heightAt(terrain.lattice, x, z), z, yaw, scale: 1, name: l.represented.name, note: l.represented.what, vitality: l.represented.vitality };
      }),
      ...plaqued.map(({ tree }) => {
        const { x, z } = tree;
        const base = (variants[tree.variant] as TreeVariant).base * tree.scale;
        const d = Math.hypot(x, z) || 1;
        const px = x - (x / d) * (base + 0.75);
        const pz = z - (z / d) * (base + 0.75);
        return { x: px, y: heightAt(terrain.lattice, px, pz) - 0.05, z: pz, yaw: Math.atan2(-x, -z), scale: 0.42, name: tree.represented.name, note: "", vitality: tree.represented.vitality };
      }),
    ]);
  }

  /** What the person walked up to while its card is open: the journal shows its page. */
  let shown: Represented | null = null;
  /** Where the person stood when the card opened: walking this far from it closes the card, meters. */
  let cardAt: { x: number; z: number } | null = null;
  const cardListeners: ((thing: CardThing | null) => void)[] = [];
  function showCard(s: Subject): void {
    for (const l of cardListeners) l({ represented: s.represented, standsAs: s.standsAs });
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
  /** Walk up to a thing, then show what it stands for; at a thing already close, the person has arrived. */
  function approach(s: Subject): void {
    const spot = s.stand(walker.x, walker.z);
    if (Math.hypot(spot.x - walker.x, spot.z - walker.z) < 2) {
      endWalk();
      arrive(s);
      return;
    }
    setGoal(spot.x, spot.z);
    pending = s;
    headFor(s);
  }
  /** How long the person has stood still, seconds; and whether they walked up to the thing they stand at, which keeps its card until they move on. */
  let stood = 0;
  let arrived = false;
  /** Arriving at a thing: its card opens. The view stays where the person looks: only their own hand turns it. */
  function arrive(s: Subject): void {
    headFor(s);
    showCard(s);
    arrived = true;
  }

  /**
   * The thing a person standing still is at (`STOP_AT`): of those they stand
   * as near as walking up would bring them, the one nearest the middle of
   * their view.
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
      const spot = s.stand(walker.x, walker.z);
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
  /** Standing still long enough at a thing opens its card, unless it is the one already open. */
  function stopAt(): void {
    const s = thingAt();
    if (s === null || stood < s.stop || shown?.id === s.represented.id) return;
    headFor(s);
    showCard(s);
  }

  /** The nearest tree a ray passes through, by each tree's trunk and crown as an upright cylinder. */
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
   * The nearest stone, bush or drift of flowers a ray passes through, by its
   * outline's reach and its top as an upright cylinder, with a little more
   * room around a low one so a thumb can find a flower. Instances can't be
   * raycast: their matrices also carry vitality, hue and seed.
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
   * The nearest furnishing a ray passes through, each solid as an upright
   * cylinder round its middle: where a walk toward it stops, just short of it
   * on the person's side.
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
  /** What the camera looks at from above, placed there by the `overview` hook for a capture; null while the person walks. */
  let aerial: THREE.Vector3 | null = null;
  const walker = { x: 0, z: 0, yaw: 0, pitch: -0.05, eye: 0 };
  /** Where a tap or click is walking the walker, if anywhere. */
  let goal: Walk | null = null;
  const keys = new Set<string>();
  /** The keys' hold on the person: how they walk and turn them (`steerStep`). */
  let steer: Steering = steering();
  const clock = (): number => performance.now() / 1000;
  /** Whether a code other than `code` holds the same way down, as W and the up arrow both walk ahead. */
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
      // The keys take over from a tap's walk; Shift alone moves nothing, so it leaves it be.
      if (WALK_KEYS.has(e.code)) endWalk();
    } else if (e.code === "Escape" && shown !== null) hideCard();
  });
  window.addEventListener("keyup", (e) => release(e.code));
  window.addEventListener("blur", () => release());

  // One pointer looks: a second finger on the canvas never jerks the view. The
  // view holds still until the press strays past a tap's slop, so a tap never
  // nudges it and a drag never walks.
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
    // The view turns with the hand, one to one and nothing more; turning it takes over from a tap's walk.
    if (goal !== null && e.clientX !== drag.x) endWalk();
    look(e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  /** Turns the view by a hand's move of (dx, dy) pixels, one to one, never easing or drifting after. */
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

  /** Where a ray first meets the ground, marched over the height the walk stands on: the lattice on the land, the wild land past it. */
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
    // A tap takes over from a trip as the keys do: it slows the person, then the walk takes them on.
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
  /** A walk that ends on its own shows what it was walking to, if the person got near enough to read it. */
  function finishWalk(): void {
    const to = pending;
    pending = null;
    goal = null;
    if (to !== null && Math.hypot(walker.x - to.x, walker.z - to.z) < 14) arrive(to);
    else if (shown === null) headFor(null);
  }

  // A tap on a building, a tree or a sign walks the person up to it and then
  // says what it is, and a tap on the ground walks there.
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
      // With a journal listening, a tap on a thing opens its page where the person stands; otherwise they walk up to it.
      if (pickListeners.length > 0) for (const l of pickListeners) l(nearest.subject.represented.id);
      else approach(nearest.subject);
      return;
    }
    // A tap on a fingerpost or a boundary stone walks up to it, not to the ground hidden behind it.
    const near = furnishingHit(ray);
    if (near !== null && (land === null || near.distance < land.distance)) setGoal(near.x, near.z);
    else if (land !== null) setGoal(land.x, land.z);
  });

  /** Shows the ground and growth for walking, or for a view from above: the whole-world mesh and the wild ring. */
  function showAerial(on: boolean): void {
    ground.fine.visible = !on;
    ground.coarse.visible = on;
    ground.wilds.visible = on;
    wildGrowth.show(!on);
    grass.mesh.visible = !on;
    drifts.object.visible = !on;
  }
  /**
   * Looks at the land from above, from `pos` toward `target`, for a capture: the camera stands exactly there, and
   * the land is drawn whole through clear air. Walking anywhere ends it.
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
   * Stand where the person stood when they last left this world (`returnTo`): exactly there while its code is laid
   * out as it was; once an edit has moved things, beside the thing they stood by, where it stands now, on dry ground
   * clear of everything there or the nearest landing to it. A first visit, or one whose thing is gone, stands where
   * the first view is best (`openingSpot`): on a stream's bank among the code, looking downstream, with the most that
   * stands for code in sight.
   */
  function valleyView(stood = code?.stood): void {
    if (code === null) return;
    const back = returnTo(code.world, stood);
    if (back !== null) {
      const beside = back.exact || standable(back.x, back.z) ? back : landingNear(back.x, back.z);
      if (beside !== null) return walkTo(beside.x, beside.z, back.yaw, -0.06);
    }
    const at = openingSpot(terrain, code.world);
    // Clear of anything solid there, as a landing is.
    const bank = landingNear(at.x, at.z);
    walkTo(bank?.x ?? at.x, bank?.z ?? at.z, at.yaw, -0.06);
  }

  const forward = new THREE.Vector3();
  let walked = 0;
  /** Sorts the decks by whether each holds at its way's vitality now, and has a walk go round those that no longer do. */
  function holdDecks(): void {
    const was = broken;
    decks = allDecks.filter((d) => crossingVitality(ways.network, d.way, d.crossing, vitalityOfPlace) >= d.holds);
    broken = allDecks.filter((d) => !decks.includes(d));
    if (broken.length !== was.length || broken.some((d, i) => d !== was[i])) gatherSolids();
  }
  /** The person's body: its velocity, its stride and its eyes' ride over the ground, eased frame by frame. */
  let body: Stride | null = null;
  const STAND: Intent = { dx: 0, dz: 0, speed: 0 };
  /** Where the lantern's hand height is measured from: the ground, or while swimming, low enough that the lantern stays above the water. */
  let lanternGround = 0;
  let tripEnd: TripEnd | null = null;
  let trip: TripUnderWay | null = null;
  /** Nearer than this, meters, a trip walks straight there, around whatever stands between, rather than by the trails. */
  const TRAVEL_NEAR = 120;
  /** How far ahead along a trip the standers hold what can be seen, meters, and how far apart it is asked. */
  const TRAVEL_LOOK = 300;
  const TRAVEL_MARK = 40;
  /** How far along the trip everything that can be seen from it stands ready, meters, asking the next marks within reach. */
  function readyAlong(t: TripUnderWay): number {
    for (const m of t.marks) {
      if (m.asked || m.s > t.at.s + TRAVEL_LOOK) continue;
      m.asked = true;
      const x = travelPoint(t.plan, m.s);
      void standing.fetch(x.x, x.z).then(() => {
        m.ready = true;
      });
    }
    const first = t.marks.findIndex((m) => !m.ready);
    return first === -1 ? Infinity : first === 0 ? 0 : (t.marks[first - 1] as (typeof t.marks)[number]).s;
  }
  /**
   * The way a trip takes from `from` to a landing: walked straight there when
   * near; else along the trails, unless their way is more than
   * `TRAVEL.detour` times the straight distance or none goes there, when it
   * goes straight across the land (`acrossWay`). Null where neither goes.
   * The meters walked off the tread at each end, at the off-tread pace, and
   * which way it went.
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
    // Straight across only where it is the shorter way; deep water may send it round farther than the trails go.
    if (across === null || (trails !== null && lengthOf(across) >= lengthOf(trails.way))) return trails;
    return { way: across, off: { start: 0, end: 0 }, by: "across" };
  }
  /**
   * Plans a trip to a landing: from where the person stands, around whatever
   * stands between, onto the nearest tread; along the trails to the tread
   * nearest the landing; and off it to the landing.
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
    trip = { plan, at: travelFrom(plan, walker.yaw), stopping: false, marks, began: performance.now(), setOff: null, waited: 0 };
    steer = steerAlong(steer);
    walkAgain();
    return true;
  }

  /**
   * Where the person walks, never turning where they look: the keys walk
   * them ahead or back along where they look (`steerStep`), and a tap's walk
   * carries them along its way while they keep looking where they looked.
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
    // A hook may have moved the walker: the body stands where the walker is.
    if (body === null || body.x !== walker.x || body.z !== walker.z) body = { ...(body ?? standAt(terrain, decks, walker.x, walker.z)), x: walker.x, z: walker.z };
    // The keys turn the view only at their one steady rate.
    const steered = steerStep(steer, clock(), walker.yaw, dt);
    steer = steered.steering;
    walker.yaw = steered.yaw;
    if (trip !== null) {
      // A trip carries the body along its way and turns the view with the way ahead, until the keys take over:
      // then it slows them at its steady rate, the view theirs, and hands them to the walk at walking pace.
      if ([...keys].some((k) => WALK_KEYS.has(k))) trip.stopping = true;
      // The body goes no farther along than the world stands ready: what can be seen from there is standing.
      const ready = readyAlong(trip);
      if (ready < trip.plan.length && trip.at.going && trip.at.v < 1 && trip.at.s >= ready - 1) trip.waited += dt;
      // Where the way ahead is not ready the trip slows to walking pace, never to a stand: a person sent somewhere gets
      // there, and at that pace what stands comes in as it does for a walk.
      trip.at = travelStep(trip.plan, trip.at, dt, walker.yaw, trip.stopping, ready, WALK_TO.pace);
      if (trip.setOff === null && trip.at.s > 0) trip.setOff = performance.now();
      walker.yaw = trip.at.yaw;
      body = carry(terrain, decks, body, trip.at.x, trip.at.z, dt);
      if (trip.at.done || (trip.stopping && trip.at.v <= WALK_TO.pace)) {
        tripEnd = { done: trip.at.done, s: +trip.at.s.toFixed(1), length: Math.round(trip.plan.length), keys: [...keys], goal: goal !== null };
        // A trip the person took over says so, so one that ends short is never a mystery.
        if (!trip.at.done) console.info(`travel: taken over at ${Math.round(trip.at.s)} of ${Math.round(trip.plan.length)} m by ${goal !== null ? "a tap on the world" : `the keys (${[...keys].join(", ")})`}`);
        trip = null;
      }
    } else {
      // Water and the grade slow the body, solids turn it aside, and it gets going and stops at once, never overshooting.
      body = stride(terrain, solids, decks, body, intent(body, steered), dt);
      if (goal !== null && body.blocked) finishWalk();
    }
    walker.x = body.x;
    walker.z = body.z;
    // Stopping at a thing opens its card, looked for only as the stop reaches each wait.
    if (goal !== null || trip !== null || keys.size > 0) arrived = false;
    const before = stood;
    stood = !arrived && goal === null && trip === null && keys.size === 0 && Math.hypot(walker.x - fromX, walker.z - fromZ) < STILL * dt ? stood + dt : 0;
    if ((before < STOP_AT.great && stood >= STOP_AT.great) || (before < STOP_AT.small && stood >= STOP_AT.small)) stopAt();
    // A card belongs to the thing it was opened at: walking away closes it.
    if (cardAt !== null && Math.hypot(walker.x - cardAt.x, walker.z - cardAt.z) > LEAVE_CARD) hideCard();
    // Eyes ride 1.6 m above the ground or a bridge's deck, easing down to float just above deep water.
    walker.eye = body.eye;
    const footing = footingAt(terrain, decks, walker.x, walker.z);
    const surface = footing.ground + footing.depth;
    lanternGround = footing.depth > 0 ? Math.max(walker.eye - EYE_HEIGHT, surface + LANTERN_ABOVE_WATER - (EYE_HEIGHT - LANTERN.drop)) : walker.eye - EYE_HEIGHT;
    // The eyes are where the body is, riding the ground: nothing bobs, sways or rolls the view.
    const eye = viewPin ?? walker;
    camera.position.set(eye.x, eye.eye, eye.z);
    const sy = Math.sin(eye.yaw);
    const cy = Math.cos(eye.yaw);
    forward.set(-sy * Math.cos(eye.pitch), Math.sin(eye.pitch), -cy * Math.cos(eye.pitch));
    camera.lookAt(camera.position.clone().add(forward));
    walked = Math.hypot(walker.x - fromX, walker.z - fromZ);
  }

  // ---------- taking on a world ----------

  /**
   * Takes on a baked world over a few frames, so no single frame holds the
   * page long enough for the wait to stutter. The world draws no frames
   * until it has all settled in.
   */
  async function adopt(next: WorldSpec, baked: Baked): Promise<void> {
    const { stand: stood, ownership } = baked;
    let since = performance.now();
    const mark = (step: string): void => {
      const now = performance.now();
      openingSteps[step] = Math.round(now - since);
      since = now;
    };
    const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
    holding++;
    try {
      // What the new world stands that has never stood is made first, a thing a frame, while the old world still shows.
      await poolLandmarks(stood.landmarks, nextFrame);
      await understory.prepare(stood.placements, nextFrame);
      world = next;
      mark("pool");
      // The land around where the person stands, before anything is stood on it.
      await land.open({ source: baked.land, report: baked.report, wildBase: baked.wildBase, whole: baked.whole }, walker.x, walker.z);
      mark("land");
      // Areas and files first, so whatever stands beside the trails knows where it is.
      if (code !== null) places = code.world;
      clearings.fit(terrain);
      settlement.seat(stood.sites);
      ways = { sites: stood.landmarks, network: stood.network, edging: stood.edging };
      allDecks = decksOf(stood.network.ways);
      holdDecks();
      placeWays();
      furnished = furnisher?.(stoodWorld()) ?? UNFURNISHED;
      // In the codebase's world a landmark stands for an entity and takes its vitality.
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
      plant(stood);
      await standing.ready(walker.x, walker.z);
      mark("plant");
      await nextFrame();
      placeSigns();
      mark("signs");
      endWalk();
      for (const listener of stoodListeners) listener();
    } finally {
      letGo();
    }
  }

  function stoodWorld(): StoodWorld {
    return {
      terrain,
      ways: ways.network.ways,
      buildings: settlement.buildings.map((b) => ({ x: b.site.x, z: b.site.z, name: b.represented.name, kind: b.kindName, vitality: b.represented.vitality, plan: b.plan, blueprint: b.blueprint, palette: b.palette })),
      landmarks: ways.sites.map((s, i) => {
        const lm = landmarks[s.landmark] as (typeof landmarks)[number];
        return { x: s.site.x, z: s.site.z, name: lm.name, vitality: code?.landmarks[i]?.vitality ?? 1, blueprint: lm.blueprint, palette: lm.built.palette };
      }),
      trees: trees.map((t) => ({ x: t.x, z: t.z, vitality: t.represented.vitality })),
      // An area shows its region's ground.
      grounds: new Map(places.areas.flatMap((a, i) => {
        const ground = regionGrounds[code?.world.areas[i]?.region ?? 0];
        return ground === undefined ? [] : [[a.path, ground] as const];
      })),
      lots: (code?.world.things ?? []).map(({ x, z }) => ({ x, z })),
    };
  }

  // Bakes run on the workers while the old world stays on screen; the newest
  // one asked for is the one the world takes on.
  let asked = 0;
  async function rebake(next: WorldSpec): Promise<boolean> {
    const mine = ++asked;
    const t0 = performance.now();
    reportStage("baking", { size: next.size });
    const baked = await baker.bake(next, standRequest());
    if (mine !== asked) {
      // A newer world was asked for: this one's finishing thread holds a world no one will take.
      baked.whole.terminate();
      return false;
    }
    bakeMs = performance.now() - t0;
    openingSteps = { ...baked.stand.took };
    reportStage("baked", { size: next.size, bakeMs: Math.round(bakeMs) });
    await adopt(next, baked);
    reportStage("stood", { size: next.size, trees: trees.length });
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
  /** Where every detail is chosen from, when pinned apart from the eye: see the `detailCenter` hook. */
  let detailPin: { readonly x: number; readonly z: number } | null = null;
  /** Where the view is drawn from, when held apart from the person, as the travel test holds it. */
  let viewPin: ViewPin | null = null;
  /** While a measure draws a held view, nothing streams: the land and the standers wait for the frames that move the person. */
  let streamHeld = false;
  /** While a measure drives the frames itself, the app's own loop draws none. */
  let driving = false;
  /** Meters a second along a trip's tread: `TRAVEL.pace`, unless a measure sets another. */
  let travelPace: number = TRAVEL.pace;
  const detailEye = new THREE.Vector3();
  const shadowCenter = new THREE.Vector3();
  const views = (): Pick<PlantView, "object" | "useDepth">[] => [...treeViews, ...settlement.views(), ...landmarkViews, ...(built?.views ?? [])];
  const lanternEye = new THREE.Vector3();
  // The water mirrors the sky, the coarse ground, trees and the cottage, and
  // never grass or the understory: its reflection is soft, so fine detail
  // there is wasted, and the understory keeps back from the water anyway.
  const mirrorHide = [grass.mesh, ground.fine, signs.mesh, drifts.object];
  // Walking, it mirrors the ground's rings at a quarter of their detail, which draw the wild land too; from above, the whole-world mesh and the wild ring.
  const mirrorShow = (): THREE.Object3D[] => (aerial === null ? [ground.mirror] : [ground.coarse, ground.wilds]);
  let frameCalls = 0;
  /** Each pass's draw calls and triangles in the last frame. */
  const passes = { shadow: { calls: 0, triangles: 0 }, mirror: { calls: 0, triangles: 0 }, view: { calls: 0, triangles: 0 } };
  let waitNight = -1;
  /** The sun's shadow, cast by every plant, building and landmark over the ground framed by `shadow.frame`. */
  function castShadows(): void {
    shadow.render(renderer, scene, [...views(), ...understory.casters(), ...wildGrowth.all(), ...(swapping === null ? [] : [swapping])], [sky.mesh, ground.wilds, ground.fine, ground.coarse, ground.mirror, grass.mesh, water.group, signs.mesh, drifts.object, ...understory.quiet()]);
  }
  /** The water's mirror as `eye` sees it, showing `show`; the draw calls it took. */
  function mirror(eye: THREE.PerspectiveCamera, show: THREE.Object3D[], dt: number): number {
    return water.mirror(renderer, scene, eye, [...mirrorHide, ...understory.quiet(), ...understory.casters().map((c) => c.object), ...wildGrowth.all().map((c) => c.object)], show, dt);
  }
  function frame(dt: number, now: number, at: number): void {
    if (holding > 0) return;
    if (at !== hour) applyHour(at);
    veil.hour(at);
    // The wait follows the hour as the world will.
    const night = Math.round(light.uNightness.value * 20) / 20;
    if (night !== waitNight) veil.night((waitNight = night));
    light.uTime.value = frozen ?? light.uTime.value + dt;
    if (aerial === null) {
      updateWalk(dt);
      detailEye.set(detailPin?.x ?? camera.position.x, camera.position.y, detailPin?.z ?? camera.position.z);
      ground.follow(detailPin?.x ?? walker.x, detailPin?.z ?? walker.z);
      if (!streamHeld) {
        land.follow(detailPin?.x ?? walker.x, detailPin?.z ?? walker.z);
        wildGrowth.follow(detailPin?.x ?? walker.x, detailPin?.z ?? walker.z);
        // While a trip hurries its marks ask for what its way will see; asking for walking's lead as well would only queue
        // tiles ahead of the ones the trip waits on. Slowed to a walk, it asks as a walk does.
        standing.follow(walker.x, walker.z, trip === null || trip.at.v <= WALK_TO.pace * 1.5);
      }
      lantern.follow(camera.position, forward, lanternGround, walked, dt);
      grass.follow(detailEye);
      water.wade(walker.x, walker.z, walker.yaw, walked, dt);
      const seen = viewPin ?? walker;
      shadowCenter.set(seen.x - Math.sin(seen.yaw) * 18, seen.eye, seen.z - Math.cos(seen.yaw) * 18);
      shadow.frame(shadowCenter, 40);
    } else {
      // The lantern waits where the person stood.
      lanternEye.set(walker.x, walker.eye, walker.z);
      lantern.follow(lanternEye, forward, lanternGround, 0, dt);
      shadow.frame(shadowCenter.set(0, 0, 0), world.size * 0.62);
    }
    breathe(camera.position);
    // Every pass thins distant detail from where the person's eyes are.
    light.uEye.value.copy(aerial === null ? detailEye : camera.position);
    if (aerial === null) drifts.follow(crownsNear, viewFocal());
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
   * Opens the codebase's world: judged and laid out by the world service, or
   * on a page with no engine from the engine's snapshot of this repository or
   * the proving ground's fixtures. The buildings and landmarks are its own, so
   * the settlement is rebuilt; the rest follows the bake.
   */
  async function openCodebase(): Promise<void> {
    reportStage("judging");
    const opened = await codeWorld(veil);
    code = opened;
    reportStage("laid out", { things: opened.world.things.length, symbols: opened.world.symbols.length });
    // The buildings and landmarks are made on other threads while the wait draws the land.
    const composedLandmarks = landmarkAsks(opened);
    await makeAhead([...settlementBuilds(opened.buildings), ...composedLandmarks]);
    landmarks = composedLandmarks.map((ask) => landmarkOf(composedName(ask.blueprint), ask));
    liveFileVitality.clear();
    for (const v of settlement.views()) scene.remove(v.object);
    settlement = createSettlement(light, opened.buildings);
    for (const v of settlement.views()) scene.add(v.object);
    // The wait's pen draws each building and landmark at its laid-out place while the world bakes.
    veil.marks(laidOut(opened));
    knowEntities();
    skyWorld = opened.sky;
    hour = Number.NaN;
    if (await rebake(opened.spec)) valleyView();
  }

  /** Each building and landmark of a codebase's world at its laid-out place, with what its mark on the map is drawn from, before a bake stands it. */
  function laidOut(c: OpenedWorld): Pick<StoodWorld, "buildings" | "landmarks"> {
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

  /** The wait the first world opens behind (app/renderer/wait/): it lifts as soon as the world stands. */
  const waiting = takeWait(root.querySelector(".veil") as HTMLElement, OPENING_ASPECT);
  const veil = withStart(waiting.wait, waiting.veil);
  // The first world's hills, water and trees come in on the wait's sheet as soon as it stands.
  let stoodOnce = false;
  stoodListeners.push(() => {
    if (!stoodOnce) veil.stood(stoodWorld());
    stoodOnce = true;
  });

  showAerial(false);
  // The first world bakes behind a quiet veil, which lifts once it stands.
  const ready = Promise.all([openCodebase(), farBaked]).then(async () => {
    await warmed;
    // The world's first frames draw under the paper, so the world shows only once it moves smoothly.
    for (let k = 0; k < LIFT_FRAMES; k++) await new Promise((r) => requestAnimationFrame(r));
    await veil.lift();
    reportStage("lifted");
    for (const listener of liftedListeners) listener();
  });
  const bushesBaked = ready.then(() => bakeFar(bushSet, FAR_BAKE.walkingMs)).then(() => reportStage("bush cards", { ms: Math.round(bushSet.ms) }));

  /** Whether a person can stand at (x, z): on the land, on dry ground clear of every solid. */
  function standable(x: number, z: number): boolean {
    return withinLand(world, x, z, 4) && waterDepthAt(terrain, x, z) <= LAND.dry && clearanceAt(solids, x, z) >= LAND.clear;
  }

  /** The landing nearest (x, z): see `WorldHandle.landing`. */
  function landingNear(x: number, z: number, heart?: { readonly x: number; readonly z: number }): Landing | null {
    // A spot on or beside a building lands where a person stops to read its sign, looking at it.
    const house = settlement.buildings.find((b) => Math.hypot(b.site.x - x, b.site.z - z) < Math.max(b.plan.width, b.plan.depth) * 0.5 + 4);
    if (house !== undefined) {
      const at = settlement.standOf(house);
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
    // Nowhere fit near the spot in its own area, as in a wide pond or a thicket: the nearest fit ground in any area, farther out.
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
    // What the person faces: the area's building or landmark if it stands near, the area's heart otherwise.
    const area = placeAt(places, lx, lz).area;
    const stood = stoodWorld();
    const thing = [...stood.buildings, ...stood.landmarks]
      .filter((t) => area.depth >= 0 && placeAt(places, t.x, t.z).area.path === area.path)
      .map((t) => ({ t, d: Math.hypot(t.x - lx, t.z - lz) }))
      .filter(({ d }) => d > 6 && d < FACE_THING)
      .sort((a, b) => a.d - b.d)[0]?.t;
    const aim = thing ?? (heart !== undefined && Math.hypot(heart.x - lx, heart.z - lz) > 8 ? heart : null);
    // On a path, look along it, the direction that heads more toward what the person would face.
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

  // ---------- the world's own view of a thing, for its painting in the journal ----------

  const capture = createCapture(renderer);
  const captureCamera = new THREE.PerspectiveCamera(PAINTING.fov, 1, 0.2, 4500);
  /** The painting of a far place under way, which the next waits for. */
  let painting: Promise<void> = Promise.resolve();
  /** What a painting is seen of: where it stands, how tall, how far it reaches, and where to stand to see it. */
  type Seen = Pick<Subject, "x" | "z" | "height" | "reach" | "stand">;
  /**
   * What stands for `id`: the thing itself; for a file without a tree, the
   * largest of its definitions; and for a file with nothing standing on it,
   * such as a document, its own patch of ground.
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
      stand: (fx, fz) => {
        const d = Math.hypot(fx - x, fz - z) || 1;
        return { x: x + ((fx - x) / d) * (reach + 3), z: z + ((fz - z) / d) * (reach + 3) };
      },
    };
  }
  /**
   * Where to stand to see `s` whole from `distance` meters off: on the side
   * the afternoon sun lights, turning around it until the spot is dry, clear
   * and inside the land, and nothing solid or no rise of the ground stands
   * between. A building is seen from where its sign is read, farther back.
   * For the frontispiece (`frame`, the painting's half width as a tangent),
   * the painter starts from the sunlit side whatever the thing, and nothing
   * may stand between them and the thing's sides or top either, and no tree's crown in front of the thing or filling the
   * picture's side, trying a little farther back where nothing near is clear.
   */
  function viewpointOf(s: Seen, distance: number, eye: number, aim: number, frame?: number): { x: number; z: number } {
    const fixed = s.stand(s.x + 1, s.z);
    const other = s.stand(s.x - 1, s.z);
    const sun = light.uSunDirection.value;
    // The frontispiece is always painted from the sunlit side, as the sign's side of a building may lie in its shadow.
    const signed = frame === undefined && fixed.x === other.x && fixed.z === other.z;
    const first = signed ? Math.atan2(fixed.x - s.x, fixed.z - s.z) : Math.atan2(sun.x, sun.z) + PAINTING.sunSide;
    const base = heightAt(terrain.lattice, s.x, s.z);
    /** Whether the ground and nothing solid stand between the eye at (x, z) and the point `side` meters across the thing and `up` meters above its foot. */
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
    /** Whether a tree's crown stands in front of the thing, or fills the picture's side in front of it, seen from (x, z). */
    const crownInView = (x: number, z: number, half: number): boolean => {
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
      if (frame === undefined) return lineClear(x, z, 0, aim);
      const across = s.reach * 0.8;
      return lineClear(x, z, 0, s.height * 0.3) && lineClear(x, z, 0, s.height) && lineClear(x, z, -across, s.height * 0.5) && lineClear(x, z, across, s.height * 0.5) && !crownInView(x, z, frame);
    };
    for (const back of frame === undefined ? [1] : [1, 1.3, 1.7]) {
      for (let k = 0; k < 16; k++) {
        // Turning a little farther each way in turn: 0, +22.5°, -22.5°, +45°, …
        const turn = Math.ceil(k / 2) * (k % 2 === 1 ? 1 : -1) * (Math.PI / 8);
        const x = s.x + Math.sin(first + turn) * distance * back;
        const z = s.z + Math.cos(first + turn) * distance * back;
        if (clearFrom(x, z)) return { x, z };
      }
    }
    return { x: s.x + Math.sin(first) * distance, z: s.z + Math.cos(first) * distance };
  }
  /**
   * Where a painting of `s` is taken from, `aspect` wide to tall, and how high the eye is and where it aims; in the
   * painting's light. `wide`: the frontispiece, the thing in the lower part of the painting under the sky that takes
   * the world's name.
   */
  function framingOf(s: Seen, aspect: number, wide: boolean): { at: { x: number; z: number }; eye: number; aim: number } {
    const tan = Math.tan(THREE.MathUtils.degToRad(PAINTING.fov) / 2);
    // Far enough back that the thing fills its share of the painting's height and most of its width.
    const fill = wide ? PAINTING.wideFill : PAINTING.fill;
    const distance = Math.max(s.height / (2 * tan * fill), (2 * s.reach) / (2 * tan * aspect * 0.7), s.reach + 2.5);
    // A small thing is seen as a painter would crouch to it; anything taller from a person's eye. Wide, the eye aims
    // above the thing's middle, so the thing sits low and the sky takes the painting's upper part.
    const eye = wide ? EYE_HEIGHT : Math.min(EYE_HEIGHT, Math.max(0.9, s.height * 0.8 + 0.5));
    const aim = wide ? s.height * 0.5 + 2 * tan * PAINTING.wideLow * distance : s.height * 0.55;
    return { at: viewpointOf(s, distance, eye, aim, wide ? tan * aspect : undefined), eye, aim };
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
    // While the world is changing it draws nothing; the view waits for whatever holds it, shaders warming or a new world
    // settling in, to let go. Waiting on the warming alone, a view asked for while a new world settled in retried at
    // once, forever, and the page never drew another frame.
    if (holding > 0) return settled().then(() => viewOf(id, w, h, wide));
    const s = subjectOf(id);
    if (s === undefined) return Promise.resolve(null);
    // A place beyond the land the person stands in is painted on land made ready around it to one side, one
    // painting at a time, while the person's land goes on following them: swapped in only for the painting's own
    // drawing, so nothing the person sees ever changes for it.
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
  /** Paints `s` on the land as it now lies, at the painting's hour. */
  function paintView(s: NonNullable<ReturnType<typeof subjectOf>>, w: number, h: number, wide: boolean): Promise<{ color: Pixels; mask: Pixels } | null> {
    return atPaintingHour(() => {
      const { at, eye, aim } = framingOf(s, w / h, wide);
      const base = heightAt(terrain.lattice, s.x, s.z);
      const from = new THREE.Vector3(at.x, heightAt(terrain.lattice, at.x, at.z) + eye, at.z);
      const shade = { x: (at.x + s.x) / 2, y: base, z: (at.z + s.z) / 2, reach: Math.max(40, Math.hypot(at.x - s.x, at.z - s.z) + s.reach) };
      return shootView(from, new THREE.Vector3(s.x, base + aim, s.z), PAINTING.fov, w, h, shade, { x: s.x, z: s.z, base, height: s.height, reach: s.reach });
    });
  }
  /** The person's own view at the painting's hour, from their eye the way they face, with nothing for the mask to show. */
  function lookOf(w: number, h: number): Promise<{ color: Pixels; mask: Pixels }> {
    if (holding > 0) return settled().then(() => lookOf(w, h));
    return atPaintingHour(() => {
      const from = camera.position.clone();
      const ahead = from.clone().add(camera.getWorldDirection(new THREE.Vector3()));
      return shootView(from, ahead, camera.fov, w, h, { x: from.x, y: from.y, z: from.z, reach: 80 }, { x: from.x, z: from.z, base: from.y - 1e4, height: 0, reach: 0 });
    });
  }
  /** Runs `take` with the world lit at the painting's hour, then lights it at its own again. */
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
   * A painting's view from `from` toward `toward`, through `fov`, `w` by `h`: every pass thins its detail from that
   * eye, the finest ground and the grass gather around it, the sun's shadow covers `shade` and the water's mirror is
   * drawn for it. The mask shows `subject`.
   */
  function shootView(from: THREE.Vector3, toward: THREE.Vector3, fov: number, w: number, h: number, shade: { x: number; y: number; z: number; reach: number }, subject: CaptureBounds): Promise<{ color: Pixels; mask: Pixels }> {
    captureCamera.fov = fov;
    captureCamera.aspect = w / h;
    captureCamera.position.copy(from);
    captureCamera.lookAt(toward);
    light.uEye.value.copy(captureCamera.position);
    breathe(from);
    ground.follow(from.x, from.z);
    grass.follow(captureCamera.position);
    shadowCenter.set(shade.x, shade.y, shade.z);
    shadow.frame(shadowCenter, shade.reach);
    castShadows();
    mirror(captureCamera, [ground.mirror], 0);
    // The next frame sets the person's eye, air, ground, grass, shadow and mirror again.
    return capture.shoot(scene, captureCamera, [sky.mesh, ground.wilds, ground.fine, ground.coarse, ground.mirror, grass.mesh, water.group, signs.mesh], subject, w, h);
  }

  const handle: WorldHandle = {
    scene,
    light,
    camera,
    person: () => ({ x: walker.x, z: walker.z, yaw: walker.yaw, walking: goal !== null || trip !== null || [...keys].some((k) => k !== "ShiftLeft" && k !== "ShiftRight") }),
    placeAt: (x, z) => placeAt(places, x, z),
    places: () => places,
    code: () => code?.world ?? null,
    stood: stoodWorld,
    onStood: (listener) => stoodListeners.push(listener),
    onLifted: (listener) => liftedListeners.push(listener),
    furnish: (f) => {
      furnisher = f;
    },
    furnishingSolid: (on) => {
      if (on === furnishSolid) return;
      furnishSolid = on;
      gatherSolids();
    },
    landing: (x, z, heart) => landingNear(x, z, heart),
    place: (at) => {
      walkTo(at.x, at.z, at.yaw);
      return Promise.all([land.around(at.x, at.z), standing.ready(at.x, at.z)]).then(() => undefined);
    },
    travel: (at, face) => travelTo(at, face),
    view: (id, w, h, wide) => viewOf(id, w, h, wide),
    look: lookOf,
    seenFrom: (id) => seenFromOf(id),
    thing: (of) => code?.thing(of),
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
      farBakeMs: Math.round(treeSet.ms),
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
      standing,
      sky,
      ground,
      grass,
      water,
      drifts,
      signs,
      understory,
      wildGrowth,
      variants,
      groves,
      treeFar,
      treeSet,
      bushSet,
      bushesBaked,
      entityVitality,
      entityOfPlace,
      liveFileVitality,
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
      get hour() { return hour; },
      get bakeMs() { return bakeMs; },
      get openingSteps() { return openingSteps; },
      get frameCalls() { return frameCalls; },
      get breathed() { return breathed; },
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
      get streamHeld() { return streamHeld; },
      set streamHeld(on) { streamHeld = on; },
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
      setEntityVitality,
      showLandVitality,
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
