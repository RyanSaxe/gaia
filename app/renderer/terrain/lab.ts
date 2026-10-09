// The terrain lab: a full world of regions, each a biome with a landform and
// a ground cover Jev could choose, baked into one heightfield on worker
// threads, which also stand its buildings, landmarks, trails, trees and
// understory, so the page never stops drawing while a world bakes. Walk it at
// eye height, tapping or clicking the ground to walk there, or look at the
// whole of it from above; edit any region's biome and watch the budget and
// the ground change.
// Buildings stand for sample entities and trees for sample files; tapping one
// walks the person up to it and then opens a card saying what it stands for.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type GroundSpec, Library, type RouteSpec, type SeasonSpec, blueprintOf, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, LANDMARK_PRIMITIVES, NO_SHIFT, ROUTE_PRIMITIVES, RELIEF_PRIMITIVES, ROCK_PRIMITIVES, WILDFLOWER_PRIMITIVES, WORLD_PRIMITIVES, hex, mixLab } from "@gaia/primitives";
import { biome, flora, landmark, link, world as worldKind } from "@gaia/kinds";
import { defaultParams, validate } from "@gaia/world";
import { FLORA_PRESETS, LANDMARK_PRESETS, type Realized, TRAIL_PRESETS, WORLD_PRESETS, buildSlots, mergeParts, realize, realizeRegion, realizeSky } from "@gaia/realize";
import {
  LANTERN,
  type PlantView,
  applyLight,
  createLantern,
  createPlant,
  createRenderer,
  createSceneLight,
  createSunShadow,
  type SceneLight,
} from "@gaia/render";
import {
  COVER_TAPS,
  type Deck,
  DRY,
  EYE_HEIGHT,
  GAIT,
  type Intent,
  type Stride,
  FULL_WORLD,
  SHORE_CAP,
  SMALL_WORLD,
  type TrailNetwork,
  type Way,
  NO_TRAILS,
  type Capsule,
  type Place,
  type WorldPlaces,
  NO_SOLIDS,
  RELIEF_BUDGET,
  type SolidShape,
  type Solids,
  clearanceAt,
  decksOf,
  footingAt,
  outlineShape,
  piecesShapes,
  placeAt,
  planWalk,
  type Terrain,
  type Walk,
  type WorldSpec,
  groundHeightAt,
  heightAt,
  regionPlaces,
  latticeOf,
  randomWorld,
  sampleWorld,
  sightlines,
  siteToWorld,
  wayWear,
  wayVitalityAt,
  junctionVitality,
  solidsOf,
  stanceAt,
  standAt,
  stride,
  TERRAIN,
  WALK_TO,
  WILDS,
  walkStep,
  wallsShape,
  wayAhead,
  waterDepthAt,
} from "@gaia/terrain";
import { createSky } from "../world/environment.ts";
import { renderInspector } from "../inspector.ts";
import { type Lab, type Shot, onTap, refs, slug, tapSlop } from "../lab.ts";
import { createSheet } from "../sheet.ts";
import { createGrass } from "./cover.ts";
import { createGround, createGroundTexture } from "./ground.ts";
import { createRegionCovers } from "./regions.ts";
import { createWater } from "./water.ts";
import { createWildGrowth } from "./wilds.ts";
import { createUnderstory } from "./understory.ts";
import { createClearings } from "./clearings.ts";
import { type Ways, createWays, setTrailEnds, setTrailPlaces } from "./trails.ts";
import { createWait } from "../wait/wait.ts";
import { withStart } from "../start/start.ts";
import { createCard } from "./card.ts";
import { LANDMARK_ENTITIES, type Represented, SAMPLE_ENTITIES, SAMPLE_FILES, representEntity, representFile } from "./samples.ts";
import { type Judge, entityVitalityOf, groundVitality, judgedThing } from "@gaia/world";
import { type CodeLab, codeWorld, judgedOf, representSymbol } from "./code-world.ts";
import { createSettlement } from "./settlement.ts";
import { createSigns } from "./signs.ts";
import { type Baked, createBaker } from "./baker.ts";
import { type Stand, type StandRequest, type StandingLandmark, landmarkBase, ownerVitality, understoryVitality } from "./stand.ts";
import { groundVitalityAt, setGroundOwnership, showGroundVitality } from "./vitality.ts";
import { type TourStop, tourStops } from "./tour.ts";
import { type Change, pictureChange, tallyFrame } from "./measure.ts";
import { type Copies, type DetailMode, createCopies } from "./woods.ts";

const TEMPLATE = /* html */ `
<main class="stage">
  <canvas class="view" aria-label="A world of gentle landforms. Click or tap the ground to walk there and drag to look, or switch to the overview."></canvas>
  <div class="veil" data-ref="veil" aria-label="The world is being made"></div>
  <div class="bar top">
    <div class="segmented modes" role="group" aria-label="View">
      <button data-ref="mode-walk" class="seg on" type="button">Walk</button>
      <button data-ref="mode-overview" class="seg" type="button">Overview</button>
    </div>
    <button data-ref="codebase" title="Gaia's own world, from the engine's facts about this repository">This codebase</button>
    <button data-ref="random" class="primary" title="Draw every region's landform, fields and cover uniformly, then fit the budget">Random terrain</button>
  </div>
  <div class="bar bottom">
    <div class="chip stats" id="terrain-stats" data-ref="stats" hidden>
      <div class="budget" data-ref="budget"></div>
      <div class="sight" data-ref="sight"></div>
    </div>
    <div class="bar-row">
      <div class="chip hintline"><span class="here" data-ref="here"></span><span data-ref="hint"></span></div>
      <button data-ref="stats-toggle" class="chip stats-toggle" type="button" aria-expanded="false" aria-controls="terrain-stats">Stats</button>
    </div>
  </div>
</main>
<aside class="panel" data-ref="panel">
  <section data-ref="card" aria-live="polite"></section>
  <header>
    <div class="regions" data-ref="regions"></div>
    <div class="title" data-ref="region-name"></div>
    <div class="bp-id" data-ref="bp-id"></div>
    <div class="draw" data-ref="draw"></div>
    <div class="problems" data-ref="problems"></div>
  </header>
  <div class="scroll">
    <div data-ref="slots"></div>
    <details class="json"><summary>Biome blueprint JSON</summary><pre data-ref="json"></pre></details>
  </div>
</aside>
`;

/** The terrain lab's covers wear no season; its light and sky are the first named world's, at the shell's hour. */
const NO_SEASON: SeasonSpec = { swatches: {}, ground: NO_SHIFT, frost: 0, fall: hex(0xd9a04a) };
const SKY_WORLD = WORLD_PRESETS[0];

/** Each mode's hint, for a mouse and keyboard and for touch. */
const HINTS = {
  walk: ["Click the ground to walk there, drag to look; WASD and Shift work too", "Tap the ground to walk there, drag to look"],
  overview: ["Drag to orbit, scroll to zoom, click a region", "Drag to orbit, pinch to zoom, tap a region"],
};
const MOVE = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);
/** How far a tap's ray looks for the ground, meters. */
const REACH = 900;
/** How much of each understory component's outline at the ground stops a walker: all of a rock, and a bush's heart, so the walk brushes its outer leaves. */
const STOPS: Readonly<Record<string, number>> = { rocks: 1, shrubs: 0.7 };
/** A stone whose top stands lower than this above the ground is stepped over, not walked around, meters. */
const STEP_OVER = 0.5;
/** While swimming, the lantern is held at least this far above the water, meters. */
const LANTERN_ABOVE_WATER = 0.15;
const TAU = Math.PI * 2;
/** Arriving at a thing, the view turns to it over this long, seconds: a base, and more for each half turn. */
const FACE = { base: 0.7, perHalfTurn: 0.7 };
/** A thing lower than this is framed by its middle, looking down at it, meters. */
const LOW_THING = 2.5;
/** Walking this far from where a card opened closes it, meters. */
const LEAVE_CARD = 4;
/** Furnishings (fingerposts, boundary stones) a tap can reach stand about this tall, meters. */
const FURNISHING_TOP = 2.4;

/** One seeded build of a flora preset: every tree is a copy of one. */
interface TreeVariant {
  readonly plant: Realized;
  /** Radius of the trunk's bottom ring, for grounding. */
  readonly base: number;
  /** The trunk's own radius at its base: what stops a walker. */
  readonly trunk: number;
  readonly height: number;
  /** How far the crown reaches from the trunk. */
  readonly radius: number;
}

/** Something a person can walk up to and ask about: a building or a tree. */
interface Subject {
  readonly represented: Represented;
  /** Its form in the world, such as "a watermill". */
  readonly standsAs: string;
  /** In a codebase's world, who judged its look: Jev or the stand-in. */
  readonly judge?: Judge;
  /** Where it stands, and where a person stops to read its sign; a tree's spot depends on where they come from. */
  readonly x: number;
  readonly z: number;
  readonly stand: (fromX: number, fromZ: number) => { x: number; z: number };
  /** How tall it stands, meters: arriving, the view turns to frame it. */
  readonly height: number;
  /** How far it reaches from its middle, meters: what a pointer finds and what catches the rim of light. */
  readonly reach: number;
}

/** Where one tree stands, and which build it copies. */
interface Tree {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly variant: number;
  readonly scale: number;
  readonly yaw: number;
  /** The file it stands for. */
  readonly represented: Represented;
  /** In the codebase's world, the file patch it grows on. */
  readonly patch?: number;
}

/** The world as it stands after a bake: what a map draws and what markers stand beside. */
export interface StoodWorld {
  readonly terrain: Terrain;
  /** The paths' ways of tread. */
  readonly ways: readonly Way[];
  readonly buildings: readonly { readonly x: number; readonly z: number; readonly name: string; readonly kind: string; readonly vitality: number }[];
  readonly landmarks: readonly { readonly x: number; readonly z: number; readonly name: string; readonly vitality: number }[];
  readonly trees: readonly { readonly x: number; readonly z: number; readonly vitality: number }[];
  /** Each area's ground cover, by its path: the one the ground shader paints its own ground with. */
  readonly grounds: ReadonlyMap<string, GroundSpec>;
}

/** Things another layer stands in the world on each bake: the ground they keep bare and what stops a walker. */
export interface Furnishing {
  readonly capsules: readonly Capsule[];
  readonly solids: readonly SolidShape[];
}
const UNFURNISHED: Furnishing = { capsules: [], solids: [] };

/** What the immersive world reads from the terrain lab's world, and the few ways it steers it. */
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
  /** The world as it stands now. */
  stood(): StoodWorld;
  /** Calls `listener` after every bake the lab takes on. */
  onStood(listener: () => void): void;
  /** Calls `listener` once the wait has given way to the first world standing. */
  onLifted(listener: () => void): void;
  /** Asked on every bake, after the trails are routed and before anything else stands: what to stand beside them. */
  furnish(furnisher: (stood: StoodWorld) => Furnishing): void;
  /** Whether the furnishing stops a walker, as it should while it shows. */
  furnishingSolid(on: boolean): void;
  /** Shows only the world: no panel, no bars, walking only. */
  immersive(on: boolean): void;
  /**
   * Where a person sent from the map to (x, z) lands, or null if nowhere near
   * is fit: on or beside a building, where its sign is read, looking at it;
   * elsewhere the nearest dry ground clear of every solid, in the same area
   * (in the wild only if (x, z) is), facing along a trail close by, else
   * toward the area's building or landmark, else toward `heart`.
   */
  landing(x: number, z: number, heart?: { readonly x: number; readonly z: number }): Landing | null;
  /** Puts the person at a landing at once: only under cover of a transition, so nothing is seen to jump. */
  place(at: Landing): void;
  /** Calls `listener` with what a person has walked up to when its card opens, and with null when it closes. */
  onCard(listener: (thing: CardThing | null) => void): void;
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

/** What a person walked up to: what it stands for, its form in the world (such as "A watermill") and who judged it. */
export interface CardThing {
  readonly represented: Represented;
  readonly standsAs: string;
  readonly judge?: Judge;
}

/** Where a person lands and which way they look (radians, 0 looking toward -z). */
export interface Landing {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** Where a landing may be: water no deeper than this (dry first, then wading), this far from any solid, and how far it looks from the spot asked for, meters. */
/** A bark vertex lower than this, meters, belongs to the trunk's base where it meets the ground. */
const TRUNK_BASE = 0.05;
const LAND = { dry: 0.02, wade: 0.45, clear: 1.1, reach: 40, ring: 1.5 };
/** A landing faces along a trail this close, else the area's building or landmark this close, meters. */
const FACE_TRAIL = 14;
const FACE_THING = 160;

export interface TerrainLab extends Lab {
  readonly world: WorldHandle;
}

/** A thing's name as it stands in the world, such as "An archive tower". */
const withArticle = (name: string): string => `${/^[aeiou]/i.test(name) ? "An" : "A"} ${name.toLowerCase()}`;

/** The name the sample world goes by where a repository's name would be. */
const SAMPLE_NAME = "the sample world";

/** Which world the lab opens on: Gaia's own, unless the page's address asks for the sample world (`?world=sample`, or `?world=small` for its 320 m version). */
const ASKED_WORLD = new URLSearchParams(location.search).get("world");
/** Frames the first world draws under the wait before it lifts: the first compiles every material. */
const LIFT_FRAMES = 4;
/** The sample world's size: the full world, or the small one, to compare the two. */
const SCALE = ASKED_WORLD === "small" ? SMALL_WORLD : FULL_WORLD;
/** The air's density walking, and over the overview, which thins with the world's size so the whole of it stays legible. */
const FOG = { walk: 0.0042, overview: 0.0008 * Math.min(1, 320 / SCALE.size) };
/** Seeded builds per flora preset, and the trees the lab plants unless a hook asks otherwise: as dense as the small world's 22 over 320 m. */
const TREE_BUILDS = 3;
const TREES = Math.round(22 * (SCALE.size / 320) ** 2);

/** Level, dry ground the size of a world's lattice: what the lab holds, behind its veil, until the first bake arrives. */
function levelGround(spec: WorldSpec): Terrain {
  const lattice = latticeOf(spec);
  const count = lattice.n * lattice.n;
  const shares = new Uint8Array(count * COVER_TAPS);
  for (let i = 0; i < count; i++) shares[i * COVER_TAPS] = 255;
  return {
    spec,
    lattice,
    waterLevel: new Float32Array(count).fill(DRY),
    shore: new Float32Array(count).fill(SHORE_CAP),
    region: new Uint8Array(count),
    coverRegions: new Uint8Array(count * COVER_TAPS),
    coverShares: shares,
    streams: [],
    ponds: [],
    fit: 1,
    report: { min: 0, max: 0, range: 0, maxSlope: 0, walkShare: 1, maxStep: 0 },
    landforms: [],
  };
}

export function createTerrainLab(root: HTMLElement): TerrainLab {
  root.innerHTML = TEMPLATE;
  const $ = refs(root);
  const sheet = createSheet($("panel"));
  const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
  const floraLib = new Library(FLORA_PRIMITIVES);
  let active = false;

  const baker = createBaker();
  let world: WorldSpec = sampleWorld(SCALE);
  let terrain: Terrain = levelGround(world);
  let bakeMs = 0;
  // What another layer stands beside the trails, and where a person is.
  /** What stops a walker without the furnishing. */
  let bodies: SolidShape[] = [];
  let places: WorldPlaces = regionPlaces(world, SAMPLE_NAME, []);
  let furnisher: ((stood: StoodWorld) => Furnishing) | null = null;
  let furnished: Furnishing = UNFURNISHED;
  let furnishSolid = true;
  const stoodListeners: (() => void)[] = [];
  const liftedListeners: (() => void)[] = [];

  // ---------- landmarks and trails ----------
  // A few landmarks stand on the most prominent ground of regions spread
  // across the world, and trails tie them and the buildings together. Counts
  // follow the world's size and region count, so the same rules fill a
  // 320 m world or a kilometer; `standWorld` places them on the bake thread.
  const landmarkLib = new Library([...LANDMARK_PRIMITIVES, ...FLORA_PRIMITIVES]);
  const routeLib = new Library(ROUTE_PRIMITIVES);
  const landmarks = LANDMARK_PRESETS.map((preset, i) => {
    const built = realize(preset.blueprint, landmark, landmarkLib, { seed: seedOf(`terrain-lab/landmark-${i}`), facts: { scale: 1 } });
    return { name: preset.name, built, base: landmarkBase(built) };
  });
  const trailStyles = TRAIL_PRESETS.map((p) => buildSlots(p.blueprint, link, routeLib, { seed: 1, facts: {} }).get("route")?.output as RouteSpec);
  /** The landmarks standing and the network of paths between every place, from the last bake. */
  interface Settled {
    readonly sites: readonly StandingLandmark[];
    readonly network: TrailNetwork;
  }

  const canvas = root.querySelector("canvas") as HTMLCanvasElement;
  const stage = root.querySelector(".stage") as HTMLElement;
  const renderer = createRenderer(canvas);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const light = createSceneLight();
  light.uFogDensity.value = FOG.walk;
  // A building for each sample entity, near the stream, each on a pad leveled into the bake.
  let settlement = createSettlement(light);
  /** Gaia's own world when "This codebase" is shown: what every area, patch, building, landmark and trail stands for. */
  let code: CodeLab | null = null;
  /** The world whose light, sky and air the lab shows: the codebase's own once it is shown. */
  let skyWorld = SKY_WORLD;
  let ways: Settled = { sites: [], network: NO_TRAILS };
  // Every entity's vitality by its path, live: buildings and landmarks stand
  // for entities, and each trail's wear follows the two it joins. Names repeat
  // (two packages may both be called "utils"), so nothing is keyed by name.
  let landmarkEntities: Represented[] = [];
  const entityVitality = new Map<string, number>();
  /** The entity (its path) each trail end stands for, by the place id the trail names: a building's name or lot, or a standing landmark's place. */
  const entityOfPlace = new Map<string, string>();
  /** Learns the entities of the world now shown: the codebase's own, or the samples. */
  function knowEntities(): void {
    landmarkEntities = (code?.landmarks.map((l) => l.facts) ?? LANDMARK_ENTITIES).map(representEntity);
    entityVitality.clear();
    entityOfPlace.clear();
    for (const r of [...settlement.buildings.map((b) => b.represented), ...landmarkEntities]) entityVitality.set(r.id, r.report.vitality);
    settlement.buildings.forEach((b, i) => {
      entityOfPlace.set(b.represented.name, b.represented.id);
      const lot = code?.stand.lots[i];
      if (lot !== undefined) entityOfPlace.set(lot.id, b.represented.id);
    });
  }
  knowEntities();
  /**
   * The entity standing landmark `i` stands for: in the codebase's world the
   * one its place names; in the sample world the samples, repeated when a
   * world has more landmarks than entities.
   */
  const landmarkEntity = (i: number): Represented => {
    const id = ways.sites[i]?.id;
    return (code !== null ? landmarkEntities.find((e) => e.id === id) : undefined) ?? (landmarkEntities[i % landmarkEntities.length] as Represented);
  };
  const vitalityOfPlace = (place: string): number => {
    const id = entityOfPlace.get(place);
    return id === undefined ? 1 : (entityVitality.get(id) ?? 1);
  };
  const worldLib = new Library(WORLD_PRIMITIVES);
  const lantern = createLantern(light);

  const covers = createRegionCovers();
  const coverOf = (i: number): GroundSpec => {
    const r = world.regions[i];
    if (r === undefined) throw new Error(`No region ${i}.`);
    return realizeRegion({ blueprint: r.biome, kind: biome }, lib, seedOf(r.id), NO_SEASON).ground;
  };
  /** Each region's ground cover, as the shaders paint it. */
  let regionGrounds: readonly GroundSpec[] = [];
  const updateCovers = (): void => {
    regionGrounds = world.regions.map((_, i) => coverOf(i));
    covers.update(world, regionGrounds, terrain);
  };
  updateCovers();

  const scene = new THREE.Scene();
  const sky = createSky(light);
  const groundTex = createGroundTexture(terrain);
  const ground = createGround(terrain, light, covers, groundTex);
  const clearings = createClearings(terrain);
  const grass = createGrass(light, groundTex, covers, clearings);
  const water = createWater(terrain, light, groundTex);
  scene.add(sky.mesh, ground.wilds, ground.fine, ground.coarse, grass.mesh, water.group);
  /** Each standing landmark's view, in the order of `ways.sites`; a kind may stand more than once. */
  let landmarkViews: PlantView[] = [];
  /** Every landmark view made so far, by its kind and which of that kind it is, reused from bake to bake. */
  const landmarkPool = new Map<string, PlantView>();
  let built: Ways | null = null;
  /** Stands each landmark on its site and builds the trails' crossings; the ground texture already carries the trails. */
  function placeWays(): void {
    for (const v of landmarkPool.values()) v.object.visible = false;
    const seen = new Map<number, number>();
    landmarkViews = ways.sites.map((s) => {
      const lm = landmarks[s.landmark] as (typeof landmarks)[number];
      const nth = seen.get(s.landmark) ?? 0;
      seen.set(s.landmark, nth + 1);
      const key = `${s.landmark}#${nth}`;
      let view = landmarkPool.get(key);
      if (view === undefined) {
        view = createPlant({ ...lm.built, parts: mergeParts(lm.built.parts) }, light);
        landmarkPool.set(key, view);
        scene.add(view.object);
      }
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
    built = createWays(scene, light, landmarkLib, terrain, ways.network);
    showVitality();
  }

  /** Shows every entity's vitality now on its landmark, on its trails' wear and on what is built along them. Nothing rebuilds. */
  function showVitality(): void {
    landmarkViews.forEach((view, i) => view.setVitality(entityVitality.get(landmarkEntity(i).id) ?? 1));
    setTrailEnds(ways.network, vitalityOfPlace);
    built?.setVitality(vitalityOfPlace);
  }

  /** Sets one entity's vitality, by its path, wherever it shows: its building and sign, its landmark, and every trail it joins. */
  function setEntityVitality(id: string, v: number): void {
    entityVitality.set(id, v);
    settlement.buildings.forEach((b, i) => {
      if (b.represented.id !== id) return;
      b.view.setVitality(v);
      signs.setVitality(i, v);
    });
    showVitality();
  }

  // Every file's vitality by its path, live, where a hook has changed it from
  // the world's: each file's trees and its patch of ground show it, and each
  // area's lots and water show its files' pooled.
  const liveFileVitality = new Map<string, number>();
  /** Shows each file's vitality now on its ground and the understory growing there, and each area's on its lots and its water. Nothing rebakes. */
  function showLandVitality(): void {
    if (code === null) return;
    const live = new Map(code.world.patches.map((p) => [p.path, liveFileVitality.get(p.path) ?? p.vitality]));
    const { ground, area } = ownerVitality(code.world, (path) => live.get(path) ?? 1);
    showGroundVitality(ground, area);
    showUnderstoryVitality();
  }
  /** Each finer entity shows its file's vitality, and every scattered rock, bush and flower its ground's, read from the field the grass reads. */
  function showUnderstoryVitality(): void {
    const symbols = code?.world.symbols ?? [];
    const own = (k: number): number => liveFileVitality.get(symbols[k]?.file ?? "") ?? code?.stand.symbols[k]?.vitality ?? 1;
    understory.setVitality(understoryVitality({ placements: understory.placements(), symbols: symbolPlacements }, own, (x, z) => groundVitalityAt(x, z).ground));
  }
  placeWays();
  for (const v of settlement.views()) scene.add(v.object);
  function placeBuildings(): void {
    // No grass inside a landmark's footprint either: a hollow tower or a great trunk.
    const feet = ways.sites.map((s) => {
      const r = Math.min(landmarks[s.landmark]?.base ?? 2, 4);
      return { ax: s.site.x, az: s.site.z, bx: s.site.x + 0.01, bz: s.site.z, radius: r };
    });
    // However many buildings and landmarks a world has, they clear the grass through the one mask.
    clearings.setCapsules([...settlement.clearings(), ...feet, ...furnished.capsules]);
  }
  placeBuildings();
  const signs = createSigns(light);
  scene.add(signs.mesh);

  /** The hour's light, sky and air, from the sky world's day. */
  let hour = Number.NaN;
  function applyHour(h: number): void {
    hour = h;
    if (skyWorld === undefined) return;
    const look = realizeSky({ blueprint: skyWorld.world, kind: worldKind }, worldLib, seedOf("terrain-lab/sky"), h);
    applyLight(light, look.light);
    sky.apply({ light: look.light, sky: { ...look.sky, mid: mixLab(look.sky.zenith, look.sky.horizon, 0.5) }, fog: { color: look.sky.horizon, density: FOG[mode], mist: 0 } });
  }
  const shadow = createSunShadow(light, 2048);

  // ---------- plants ----------

  // Trees are copies of a few seeded builds of each preset, drawn as
  // instances: hundreds of trees cost a few draw calls per build.
  const variants: TreeVariant[] = FLORA_PRESETS.flatMap((preset, p) =>
    Array.from({ length: TREE_BUILDS }, (_, k) => {
      const plant = realize(preset.blueprint, flora, floraLib, { seed: seedOf(`terrain-lab/tree-${p}-${k}`), facts: { scale: 1, age: 120 } });
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
      return { plant, base, trunk, height, radius };
    }),
  );
  let treeCount = TREES;
  let trees: readonly Tree[] = [];
  /** Each tree's copy among its build's instances. */
  let treeCopies: readonly number[] = [];
  /** The file a tree grows for, in the codebase's world. */
  const treeFile = (t: { readonly patch?: number }): string | undefined => (t.patch === undefined ? undefined : code?.world.patches[t.patch]?.path);
  const treeVitality = (t: Tree): number => liveFileVitality.get(treeFile(t) ?? "") ?? t.represented.report.vitality;
  let treeViews: Copies[] = [];
  /** Each build's instances by variant, kept for the life of the lab. */
  const groves = new Map<number, Copies>();

  // Rocks, bushes and wildflowers, scattered around the trees.
  const understory = createUnderstory(scene, light, new Library([...FLORA_PRIMITIVES, ...ROCK_PRIMITIVES, ...WILDFLOWER_PRIMITIVES]), clearings);

  // Before every pass (the sun's shadow, the water's mirror and the view),
  // each instanced blueprint packs only the cells that pass's camera sees.
  // Past the land: the wild's covers and its scattered bushes, which stand for nothing.
  const wildGrowth = createWildGrowth(scene, light, covers, lib, floraLib);
  const instanced = (): Copies[] => [...treeViews, ...understory.all(), ...wildGrowth.all()];
  let warming = false;
  scene.onBeforeRender = (_renderer, _scene, passCamera) => {
    if (!warming) for (const v of instanced()) v.cull(passCamera);
  };
  // Uploads every tree's and the understory's geometry, at every level, in
  // one render while the planting already holds the frame, so no level's
  // first appearance ever costs a frame.
  const warmTarget = new THREE.WebGLRenderTarget(1, 1);
  const warmCamera = new THREE.PerspectiveCamera();
  function warm(): void {
    warming = true;
    for (const v of instanced()) v.warm();
    renderer.setRenderTarget(warmTarget);
    renderer.render(scene, warmCamera);
    renderer.setRenderTarget(null);
    warming = false;
  }

  let understoryDensity = 1;
  /** What the bake thread stands on a world: plain data from the lab's buildings, landmarks, trails, trees and understory. */
  const standRequest = (next: WorldSpec): StandRequest => ({
    buildings: settlement.requests(),
    landmarks: landmarks.map((lm) => ({ name: lm.name, base: lm.base })),
    trailStyles: [trailStyles[0], trailStyles[1], trailStyles[2]] as [RouteSpec, RouteSpec, RouteSpec],
    trees: { count: treeCount, seed: 9, presets: FLORA_PRESETS.length, builds: TREE_BUILDS, bases: variants.map((v) => v.base), crowns: variants.map((v) => v.radius) },
    understory: understory.plan(next, understoryDensity),
    ...(code === null ? {} : { code: code.stand }),
  });
  /** Stands the bake's trees and understory, placed on the bake thread, and what stops a walker. */
  function plant(stood: Stand): void {
    // Trees keep off the trails, the buildings and the landmarks; the bake thread kept them off.
    // In the codebase's world each tree grows on its file's patch and takes that file's vitality.
    const fileOf = (t: (typeof stood.trees)[number]) => {
      const patch = t.patch === undefined ? undefined : code?.world.patches[t.patch];
      return (patch === undefined ? undefined : code?.files.get(patch.path)) ?? (SAMPLE_FILES[t.index % SAMPLE_FILES.length] as (typeof SAMPLE_FILES)[number]);
    };
    trees = stood.trees.map((t) => ({ ...t, represented: representFile(fileOf(t), judgedOf(t.patch === undefined ? undefined : code?.world.patches[t.patch])) }));
    symbolPlacements = stood.symbols;
    // Each build keeps its instances from bake to bake and only moves its copies.
    treeViews = variants.flatMap((v, k) => {
      const spots = trees.filter((t) => t.variant === k).map((t) => ({ x: t.x, y: t.y, z: t.z, yaw: t.yaw, scale: t.scale, vitality: treeVitality(t) }));
      const had = groves.get(k);
      if (had !== undefined) {
        had.respot(spots);
        return [had];
      }
      if (spots.length === 0) return [];
      const view = createCopies(v.plant, light, spots);
      scene.add(view.object);
      groves.set(k, view);
      return [view];
    });
    // Each tree's copy among its build's, so a file's trees take a new vitality live.
    const copies = new Map<number, number>();
    treeCopies = trees.map((t) => {
      const i = copies.get(t.variant) ?? 0;
      copies.set(t.variant, i + 1);
      return i;
    });
    // Nothing of the understory stands in a building, on its walk, on a trail or under a landmark: the bake thread kept it clear.
    understory.place(terrain, world, [], understoryDensity, stood.placements);
    showUnderstoryVitality();
    // What stops a walker: each trunk at its base, the rocks and bushes by their outlines at the ground, and the cottage's walls.
    const trunks: SolidShape[] = trees.flatMap((t) => {
      const trunk = (variants[t.variant] as TreeVariant).trunk * t.scale;
      return trunk > 0 ? [{ x: t.x, z: t.z, radius: trunk }] : [];
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
    solids = solidsOf(furnishSolid ? [...bodies, ...furnished.solids] : bodies);
    // Each tree's file is the ground around it, out to most of its crown.
    // In the codebase's world every file has its own patch; in the sample world a file's patch is the ground around its tree, out to most of its crown.
    places =
      code !== null
        ? code.world
        : regionPlaces(
            terrain.spec,
            SAMPLE_NAME,
            trees.map((t) => ({
              path: t.represented.id,
              name: t.represented.name,
              x: t.x,
              z: t.z,
              radius: Math.max(4, Math.min(7, (variants[t.variant] as TreeVariant).radius * t.scale * 0.8)),
              vitality: t.represented.report.vitality,
            })),
          );
    warm();
    placeSigns();
  }
  let solids: Solids = NO_SOLIDS;
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
   * tree in the sample world, and in the codebase's world the first tree on
   * each file's patch, which names the file.
   */
  function placeSigns(): void {
    const judged = (about: "file" | "entity", target: string): { judge?: Judge } => (code === null ? {} : { judge: code.judgeOf(judgedThing({ about, target })) });
    const buildingSubjects: Subject[] = settlement.buildings.map((b) => ({
      represented: b.represented,
      standsAs: withArticle(b.kindName),
      ...judged("entity", b.represented.id),
      x: b.site.x,
      z: b.site.z,
      stand: () => settlement.standOf(b),
      height: b.view.height,
      reach: Math.hypot(b.plan.width, b.plan.depth) / 2,
    }));
    // A landmark stands for an entity in the codebase's world: walk up to its foot to read it.
    const landmarkSubjects: Subject[] = code === null
      ? []
      : ways.sites.flatMap((s, i) => {
          const facts = code?.landmarks[i]?.facts;
          const lm = landmarks[s.landmark];
          if (facts === undefined || lm === undefined) return [];
          const { x, z } = s.site;
          return [{
            represented: representEntity(facts),
            standsAs: withArticle(lm.name),
            ...judged("entity", facts.path),
            x,
            z,
            height: landmarkViews[i]?.height ?? 6,
            reach: lm.base + 1,
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
      return {
        represented: tree.represented,
        standsAs: "A tree",
        ...judged("file", tree.represented.id),
        x,
        z,
        height: (variants[tree.variant] as TreeVariant).height * tree.scale,
        reach: crown,
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
    const patchByPath = new Map(code?.world.patches.map((p) => [p.path, p]) ?? []);
    const symbolEntries: (readonly [number, Subject])[] = code === null
      ? []
      : code.world.symbols.flatMap((sym, i) => {
          const at = symbolPlacements[i] ?? -1;
          const p = placed[at];
          const file = code?.files.get(sym.file);
          if (p === undefined || file === undefined) return [];
          const { x, z } = p;
          return [[at, {
            represented: representSymbol(sym, file, judgedOf(patchByPath.get(sym.file))),
            standsAs: withArticle(sym.form),
            // A symbol's form is judged with its file.
            ...judged("file", sym.file),
            x,
            z,
            height: (understory.footprint(p.rule, p.variant)?.top ?? 0.8) * p.scale,
            reach: p.radius + 0.3,
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
    const named = new Set<number>();
    const plaqued = trees.flatMap((tree, i) => {
      if (tree.patch !== undefined) {
        if (named.has(tree.patch)) return [];
        named.add(tree.patch);
      }
      return [{ tree, subject: treeSubjects[i] as Subject }];
    });
    signSubjects = [...buildingSubjects, ...landmarkSubjects, ...plaqued.map((p) => p.subject)];
    signs.set([
      ...settlement.buildings.map((b) => {
        const at = settlement.signOf(b);
        return { ...at, y: heightAt(terrain.lattice, at.x, at.z), scale: 1, name: b.represented.name, note: b.represented.what, vitality: b.represented.report.vitality };
      }),
      ...landmarkSubjects.map((l, i) => {
        const view = landmarkViews[i];
        const yaw = view?.object.rotation.y ?? 0;
        const lm = landmarks[ways.sites[i]?.landmark ?? 0];
        const r = (lm?.base ?? 2) + 3;
        const x = l.x + Math.sin(yaw) * r + Math.cos(yaw) * 1.6;
        const z = l.z + Math.cos(yaw) * r - Math.sin(yaw) * 1.6;
        return { x, y: heightAt(terrain.lattice, x, z), z, yaw, scale: 1, name: l.represented.name, note: l.represented.what, vitality: l.represented.report.vitality };
      }),
      ...plaqued.map(({ tree }) => {
        const { x, z } = tree;
        const base = (variants[tree.variant] as TreeVariant).base * tree.scale;
        const d = Math.hypot(x, z) || 1;
        const px = x - (x / d) * (base + 0.75);
        const pz = z - (z / d) * (base + 0.75);
        return { x: px, y: heightAt(terrain.lattice, px, pz) - 0.05, z: pz, yaw: Math.atan2(-x, -z), scale: 0.42, name: tree.represented.name, note: "", vitality: tree.represented.report.vitality };
      }),
    ]);
  }

  const card = createCard($("card"), () => hideCard());
  /** Where the person stood when the card opened: walking this far from it closes the card, meters. */
  let cardAt: { x: number; z: number } | null = null;
  const cardListeners: ((thing: CardThing | null) => void)[] = [];
  function showCard(s: Subject): void {
    for (const l of cardListeners) l({ represented: s.represented, standsAs: s.standsAs, ...(s.judge === undefined ? {} : { judge: s.judge }) });
    card.show(s.represented, s.standsAs, s.judge);
    $("panel").classList.add("showing-card");
    sheet.name(s.represented.name);
    sheet.open(true);
    cardAt = { x: walker.x, z: walker.z };
  }
  /** The thing the person is walking up to, or whose card shows. */
  let heading: Subject | null = null;
  const headingListeners: ((thing: Heading | null) => void)[] = [];
  function headFor(s: Subject | null): void {
    if (s === heading) return;
    heading = s;
    for (const l of headingListeners) l(s === null ? null : { x: s.x, z: s.z, reach: s.reach, name: s.represented.name });
  }
  function hideCard(): void {
    if (card.shown !== null) for (const l of cardListeners) l(null);
    headFor(null);
    cardAt = null;
    card.hide();
    $("panel").classList.remove("showing-card");
    sheet.name(world.regions[selected]?.id ?? "");
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
  /** Arriving at a thing: its card opens and the view turns gently to frame it. */
  function arrive(s: Subject): void {
    headFor(s);
    showCard(s);
    face(s);
  }

  /** A gentle turn of the view, eased from where it looked to where it should; any drag or key takes the view back. */
  let turn: { yaw0: number; pitch0: number; dyaw: number; dpitch: number; t: number; duration: number } | null = null;
  function face(s: Subject): void {
    const dx = s.x - walker.x;
    const dz = s.z - walker.z;
    const far = Math.hypot(dx, dz);
    if (far < 0.5) return;
    // A tall thing is framed a little below its middle, so its foot and its sign show; a low one, a
    // function's stone or bush at the person's feet, by its own middle, looking down at it.
    const rise = s.height < LOW_THING ? s.height * 0.5 : Math.max(1.2, Math.min(4, s.height * 0.4));
    const aim = heightAt(terrain.lattice, s.x, s.z) + rise;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.max(-0.65, Math.min(0.35, Math.atan2(aim - walker.eye, far)));
    // The short way round.
    const dyaw = ((((yaw - walker.yaw) % TAU) + TAU * 1.5) % TAU) - TAU / 2;
    const dpitch = pitch - walker.pitch;
    if (Math.abs(dyaw) < 0.02 && Math.abs(dpitch) < 0.02) return;
    turn = { yaw0: walker.yaw, pitch0: walker.pitch, dyaw, dpitch, t: 0, duration: FACE.base + (Math.abs(dyaw) / Math.PI) * FACE.perHalfTurn };
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
   * The nearest rock or bush a ray passes through, by its outline's reach and
   * its top as an upright cylinder. Instances can't be raycast: their
   * matrices also carry vitality, hue and seed.
   */
  function thingHit(ray: THREE.Ray): { x: number; z: number; distance: number; at: number } | null {
    const { origin: o, direction: d } = ray;
    const flat = d.x * d.x + d.z * d.z;
    let best: { x: number; z: number; distance: number; at: number } | null = null;
    for (const [at, p] of understory.placements().entries()) {
      // A function or class can be tapped whatever it stands as, flowers too.
      const foot = STOPS[p.rule] === undefined && !symbolAt.has(at) ? undefined : understory.footprint(p.rule, p.variant);
      if (foot === undefined) continue;
      const s = flat < 1e-9 ? 0 : ((p.x - o.x) * d.x + (p.z - o.z) * d.z) / flat;
      if (s <= 0) continue;
      const x = o.x + d.x * s;
      const z = o.z + d.z * s;
      const y = o.y + d.y * s;
      // Low things get a little more room around them, so a thumb can find a flower.
      const reach = Math.max(Math.max(...foot.outline) * p.scale, symbolAt.has(at) ? 0.6 : 0);
      if (Math.hypot(x - p.x, z - p.z) > reach || y > p.y + Math.max(foot.top * p.scale, symbolAt.has(at) ? 0.5 : 0)) continue;
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

  // ---------- camera, walking and the overview ----------

  const camera = new THREE.PerspectiveCamera(58, 1, 0.2, 4500);
  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.maxPolarAngle = Math.PI * 0.42;
  orbit.minDistance = 60;
  orbit.maxDistance = Math.max(700, SCALE.size * 1.1);
  orbit.enabled = false;

  type Mode = "walk" | "overview";
  let mode: Mode = "walk";
  const walker = { x: 0, z: 0, yaw: 0, pitch: -0.05, eye: 0, moved: true };
  /** Where a tap or click is walking the walker, if anywhere. */
  let goal: Walk | null = null;
  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    if (!active || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (MOVE.has(e.code)) {
      keys.add(e.code);
      e.preventDefault();
      // The keys take over from a tap's walk and a turn; Shift alone moves nothing, so it leaves them be.
      if (e.code !== "ShiftLeft" && e.code !== "ShiftRight") {
        endWalk();
        turn = null;
      }
    } else if (e.code === "Escape" && card.shown !== null) hideCard();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());

  // One pointer looks: a second finger on the canvas never jerks the view. The
  // view holds still until the press strays past a tap's slop, so a tap never
  // nudges it and a drag never walks.
  const drag = { id: -1, x: 0, y: 0, looking: false };
  canvas.addEventListener("pointerdown", (e) => {
    if (mode !== "walk" || drag.id !== -1) return;
    drag.id = e.pointerId;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.looking = false;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== drag.id || mode !== "walk") return;
    if (!drag.looking && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= tapSlop(e)) return;
    drag.looking = true;
    turn = null;
    walker.yaw -= (e.clientX - drag.x) * 0.0045;
    walker.pitch = Math.max(-1.1, Math.min(1.1, walker.pitch - (e.clientY - drag.y) * 0.0045));
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
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
    goal = planWalk(terrain, solids, walker, { x, z });
    pending = null;
    if (card.shown === null) headFor(null);
  }
  function endWalk(): void {
    if (pending !== null && card.shown === null) headFor(null);
    pending = null;
    goal = null;
  }
  /** A walk that ends on its own shows what it was walking to, if the person got near enough to read it. */
  function finishWalk(): void {
    const to = pending;
    pending = null;
    goal = null;
    if (to !== null && Math.hypot(walker.x - to.x, walker.z - to.z) < 14) arrive(to);
    else if (card.shown === null) headFor(null);
  }

  // In the overview a tap picks a region. Walking, a tap on a building, a
  // tree or a sign walks the person up to it and then says what it is, and a
  // tap on the ground walks there.
  onTap(canvas, (e) => {
    const ray = aim(e);
    turn = null;
    if (mode === "overview") {
      // The coarse mesh is placed by its shader, so the pick marches the heightfield instead.
      const hit = groundHit(ray);
      if (hit !== null) select(regionAt(hit.x, hit.z));
      return;
    }
    const land = groundHit(ray);
    const tree = treeHit(ray);
    const building = raycaster.intersectObjects(settlement.views().map((v) => v.object), true)[0];
    const rise = code === null ? undefined : raycaster.intersectObjects(landmarkViews.map((v) => v.object), true)[0];
    const riseAt = rise === undefined ? undefined : landmarkViews.findIndex((v) => v.object.getObjectById(rise.object.id) !== undefined);
    const riseSite = riseAt === undefined ? undefined : ways.sites[riseAt]?.site;
    const sign = raycaster.intersectObject(signs.mesh)[0];
    const thing = thingHit(ray);
    const symbol = thing === null ? undefined : symbolAt.get(thing.at);
    const hits = [
      ...(thing === null || symbol === undefined ? [] : [{ distance: thing.distance, subject: symbol }]),
      ...(tree === null ? [] : [{ distance: tree.distance, subject: subjects.find((s) => s.x === tree.tree.x && s.z === tree.tree.z) }]),
      ...(building === undefined ? [] : [{ distance: building.distance, subject: subjects.find((s) => settlement.buildings.some((b) => b.view.object.getObjectById(building.object.id) !== undefined && s.x === b.site.x && s.z === b.site.z)) }]),
      ...(sign === undefined ? [] : [{ distance: sign.distance, subject: signSubjects[sign.instanceId ?? -1] }]),
      ...(rise === undefined || riseSite === undefined ? [] : [{ distance: rise.distance, subject: subjects.find((s) => s.x === riseSite.x && s.z === riseSite.z) }]),
    ].sort((a, b) => a.distance - b.distance);
    const nearest = hits[0];
    if (nearest !== undefined && nearest.subject !== undefined && (land === null || nearest.distance < land.distance + 0.5)) {
      approach(nearest.subject);
      return;
    }
    // A tap on a rock, a bush, a fingerpost or a boundary stone walks up to it, not to the ground hidden behind it.
    const near = [thing, furnishingHit(ray)].filter((t) => t !== null).sort((a, b) => a.distance - b.distance)[0];
    if (near !== undefined && (land === null || near.distance < land.distance)) setGoal(near.x, near.z);
    else if (land !== null) setGoal(land.x, land.z);
  });

  function regionAt(x: number, z: number): number {
    const l = terrain.lattice;
    const ix = Math.round((x - l.origin) / l.spacing);
    const iz = Math.round((z - l.origin) / l.spacing);
    return terrain.region[Math.max(0, Math.min(l.n - 1, iz)) * l.n + Math.max(0, Math.min(l.n - 1, ix))] ?? 0;
  }

  function setMode(next: Mode): void {
    mode = next;
    orbit.enabled = active && next === "overview";
    light.uFogDensity.value = FOG[next];
    ground.fine.visible = next === "walk";
    ground.coarse.visible = next === "overview";
    ground.wilds.visible = next === "overview";
    wildGrowth.show(next === "walk");
    grass.mesh.visible = next === "walk";
    ground.select(selected, next === "overview");
    $("mode-walk").classList.toggle("on", next === "walk");
    $("mode-overview").classList.toggle("on", next === "overview");
    const [mouseHint, touchHint] = HINTS[next];
    $("hint").innerHTML = `<span class="mouse-only">${mouseHint}</span><span class="touch-only">${touchHint}</span>`;
    endWalk();
    if (next === "overview") {
      camera.position.set(walker.x * 0.3 + 40, 300, walker.z * 0.3 + 330);
      orbit.target.set(0, 0, 0);
    }
    walker.moved = true;
  }

  /** Puts the walker at a point at once, looking along `yaw`. */
  function walkTo(x: number, z: number, yaw: number, pitch = -0.05): void {
    endWalk();
    turn = null;
    walker.x = x;
    walker.z = z;
    walker.yaw = yaw;
    walker.pitch = pitch;
    body = standAt(terrain, decks, x, z);
    walker.eye = body.eye;
    yawRate = 0;
    walker.moved = true;
    if (mode !== "walk") setMode("walk");
  }

  /** Stand on the stream's bank a quarter of the way down, looking downstream. */
  function valleyView(): void {
    const st = terrain.streams[0]?.stations;
    const a = st?.[Math.floor(st.length * 0.22)];
    const b = st?.[Math.floor(st.length * 0.6)];
    if (st === undefined || st.length < 8 || a === undefined || b === undefined) {
      walkTo(0, 0, 0);
      return;
    }
    const yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    // On the nearest dry ground clear of anything solid: a wide stream would otherwise stand the person in it.
    const x = a.x + Math.cos(yaw) * 5;
    const z = a.z - Math.sin(yaw) * 5;
    const bank = landingNear(x, z);
    walkTo(bank?.x ?? x, bank?.z ?? z, yaw, -0.06);
  }

  const forward = new THREE.Vector3();
  let walked = 0;
  /** The footbridges' decks, which a walk stands on above the water. */
  let decks: readonly Deck[] = [];
  /** The person's body: its velocity, its stride and its eyes' ride over the ground, eased frame by frame. */
  let body: Stride | null = null;
  /** How fast the arrow keys are turning the view, radians a second. */
  let yawRate = 0;
  const STAND: Intent = { dx: 0, dz: 0, speed: 0 };
  /** Where the lantern's hand height is measured from: the ground, or while swimming, low enough that the lantern stays above the water. */
  let lanternGround = 0;
  /** What the person asks of their body this frame: the keys first, then a tap's walk, moved on along its way, braking to arrive and ended there. */
  function intent(at: Stride): Intent {
    let f = 0;
    let s = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
    if (keys.has("KeyD")) s += 1;
    if (keys.has("KeyA")) s -= 1;
    if (f !== 0 || s !== 0) {
      const sy = Math.sin(walker.yaw);
      const cy = Math.cos(walker.yaw);
      return { dx: -sy * f + cy * s, dz: -cy * f - sy * s, speed: WALK_TO.pace * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? GAIT.hurry : 1) };
    }
    if (goal === null) return STAND;
    // The view stays where the person looks; only the feet follow the way.
    const heading = wayAhead(goal, at);
    goal = heading.walk;
    if (heading.remaining <= WALK_TO.reach) {
      finishWalk();
      return STAND;
    }
    const dx = heading.aim.x - at.x;
    const dz = heading.aim.z - at.z;
    const length = Math.max(1e-9, Math.hypot(dx, dz));
    const braking = Math.sqrt(2 * GAIT.arrive * Math.max(0, heading.remaining - WALK_TO.reach * 0.6));
    return { dx: dx / length, dz: dz / length, speed: Math.min(heading.pace, braking) };
  }
  function updateWalk(dt: number): void {
    const fromX = walker.x;
    const fromZ = walker.z;
    // A hook may have moved the walker: the body stands where the walker is.
    if (body === null || body.x !== walker.x || body.z !== walker.z) body = { ...(body ?? standAt(terrain, decks, walker.x, walker.z)), x: walker.x, z: walker.z };
    // The arrow keys turn the view, easing into a turn and out of it.
    const turning = (keys.has("ArrowLeft") ? 1 : 0) - (keys.has("ArrowRight") ? 1 : 0);
    yawRate += (turning * GAIT.turn - yawRate) * (1 - Math.exp((-dt * 3) / GAIT.turnEase));
    if (Math.abs(yawRate) < 1e-4 && turning === 0) yawRate = 0;
    walker.yaw += yawRate * dt;
    // Water and the grade slow the body, solids turn it aside, and it eases into and out of its stride.
    const asked = intent(body);
    body = stride(terrain, solids, decks, body, asked, dt);
    if (goal !== null && body.blocked) finishWalk();
    walker.x = body.x;
    walker.z = body.z;
    if (walker.x !== fromX || walker.z !== fromZ) walker.moved = true;
    if (turn !== null) {
      turn.t = Math.min(1, turn.t + dt / turn.duration);
      const e = turn.t * turn.t * (3 - 2 * turn.t);
      walker.yaw = turn.yaw0 + turn.dyaw * e;
      walker.pitch = turn.pitch0 + turn.dpitch * e;
      if (turn.t >= 1) turn = null;
    }
    // A card belongs to the thing it was opened at: walking away closes it.
    if (cardAt !== null && Math.hypot(walker.x - cardAt.x, walker.z - cardAt.z) > LEAVE_CARD) hideCard();
    // Eyes ride 1.6 m above the ground or a bridge's deck, easing down to float just above deep water.
    walker.eye = body.eye;
    const footing = footingAt(terrain, decks, walker.x, walker.z);
    const surface = footing.ground + footing.depth;
    lanternGround = footing.depth > 0 ? Math.max(walker.eye - EYE_HEIGHT, surface + LANTERN_ABOVE_WATER - (EYE_HEIGHT - LANTERN.drop)) : walker.eye - EYE_HEIGHT;
    // The stride lifts the eyes and sways them across the way the body moves, never rolling or pitching the view.
    const speed = Math.hypot(body.vx, body.vz);
    const across = speed > 1e-3 ? body.sway / speed : 0;
    camera.position.set(walker.x - body.vz * across, walker.eye + body.lift, walker.z + body.vx * across);
    const sy = Math.sin(walker.yaw);
    const cy = Math.cos(walker.yaw);
    forward.set(-sy * Math.cos(walker.pitch), Math.sin(walker.pitch), -cy * Math.cos(walker.pitch));
    camera.lookAt(camera.position.clone().add(forward));
    walked = Math.hypot(walker.x - fromX, walker.z - fromZ);
  }

  // ---------- panel ----------

  let selected = 0;
  const fmt = (v: number, d = 1): string => v.toFixed(d);

  /** Takes on a freshly baked world and what stands on it: everything on the land follows. */
  function adopt(next: WorldSpec, baked: Terrain, stood: Stand, ownership: Baked["ownership"]): void {
    world = next;
    terrain = baked;
    // Areas first, so whatever stands beside the trails knows where it is; files join when the trees stand.
    places = code !== null ? code.world : regionPlaces(terrain.spec, SAMPLE_NAME, []);
    clearings.fit(terrain);
    settlement.seat(stood.sites);
    ways = { sites: stood.landmarks, network: stood.network };
    decks = decksOf(stood.network.ways);
    setTrailPlaces(stood.trailPlaces, baked.lattice.n);
    placeWays();
    furnished = furnisher?.(stoodWorld()) ?? UNFURNISHED;
    // In the codebase's world a landmark stands for an entity and takes its vitality.
    landmarkViews.forEach((v, i) => v.setVitality(code === null ? 1 : (code.world.things.filter((t) => t.as === "landmark")[i]?.vitality ?? 1)));
    placeBuildings();
    updateCovers();
    groundTex.update(terrain, stood.ground);
    setGroundOwnership(ownership);
    showLandVitality();
    ground.update(terrain, stood.wilds);
    water.update(terrain);
    wildGrowth.update(terrain);
    plant(stood);
    endWalk();
    walker.moved = true;
    refreshStats();
    refreshPanel();
    for (const listener of stoodListeners) listener();
  }

  function stoodWorld(): StoodWorld {
    return {
      terrain,
      ways: ways.network.ways,
      buildings: settlement.buildings.map((b) => ({ x: b.site.x, z: b.site.z, name: b.represented.name, kind: b.kindName, vitality: b.represented.report.vitality })),
      landmarks: ways.sites.map((s, i) => {
        const facts = code?.landmarks[i]?.facts;
        return { x: s.site.x, z: s.site.z, name: landmarks[s.landmark]?.name ?? "", vitality: facts === undefined ? 1 : entityVitalityOf(facts).vitality };
      }),
      trees: trees.map((t) => ({ x: t.x, z: t.z, vitality: t.represented.report.vitality })),
      // A codebase's area shows its region's ground; each of the sample world's regions is one area.
      grounds: new Map(places.areas.flatMap((a, i) => {
        const ground = regionGrounds[code !== null ? (code.world.areas[i]?.region ?? 0) : i];
        return ground === undefined ? [] : [[a.path, ground] as const];
      })),
    };
  }

  // Bakes run on the workers while the old world stays on screen; the newest
  // one asked for is the one the lab takes on.
  let asked = 0;
  async function rebake(next: WorldSpec): Promise<boolean> {
    const mine = ++asked;
    const t0 = performance.now();
    $("random").textContent = "Baking…";
    const baked = await baker.bake(next, standRequest(next));
    if (mine !== asked) return false;
    bakeMs = performance.now() - t0;
    adopt(next, baked.terrain, baked.stand, baked.ownership);
    $("random").textContent = "Random terrain";
    return true;
  }

  const landformName = (i: number): string => world.regions[i]?.biome.slots.relief?.use.replace(/@\d+$/, "") ?? "";
  const coverName = (i: number): string => String(world.regions[i]?.biome.slots.cover?.params.cover ?? "");

  function select(i: number): void {
    selected = i;
    hideCard();
    ground.select(i, mode === "overview");
    refreshPanel();
  }

  function refreshStats(): void {
    const r = terrain.report;
    const b = RELIEF_BUDGET;
    $("budget").innerHTML =
      `<span title="Highest minus lowest ground in the walkable world">Height range <b>${fmt(r.range)} m</b> of ${b.range}</span>` +
      `<span title="Steepest ground anywhere">Steepest <b>${fmt(r.maxSlope, 0)}°</b> of ${b.maxSlope}</span>` +
      `<span title="Share of ground under ${b.walkSlope} degrees">Walkable <b>${fmt(r.walkShare * 100, 1)}%</b></span>` +
      `<span title="Tallest unbroken climb steeper than ${b.walkSlope} degrees">Tallest steep climb <b>${fmt(r.maxStep)} m</b> of ${b.maxStep}</span>` +
      `<span title="Vertical scale applied to fit the budget">Fit <b>${fmt(terrain.fit * 100, 0)}%</b></span>` +
      `<span>Baked in ${fmt(bakeMs, 0)} ms</span>`;
  }

  let lastSight = 0;
  function refreshSight(now: number): void {
    if (!walker.moved || now - lastSight < 350) return;
    lastSight = now;
    walker.moved = false;
    const at = mode === "walk" ? walker : (world.regions[selected] ?? walker);
    const s = sightlines(terrain.lattice, at.x, at.z);
    $("sight").innerHTML =
      `${mode === "walk" ? "From here" : `From the middle of ${world.regions[selected]?.id ?? ""}`}, at eye height: ` +
      `farthest visible ground <b>${fmt(s.max, 0)} m</b>, median over bearings <b>${fmt(s.median, 0)} m</b>`;
    const here = regionAt(walker.x, walker.z);
    const place = placeAt(places, walker.x, walker.z);
    if (mode !== "walk") $("here").textContent = "";
    else if (place.area.depth < 0) $("here").textContent = place.area.name;
    // In the codebase's world: the directory whose ground this is, and the file underfoot.
    else if (code !== null) $("here").textContent = `${place.area.path === "" ? code.world.name : place.area.path} · ${place.file === null ? "common ground" : place.file.name}`;
    else $("here").textContent = `${world.regions[here]?.id ?? ""} · ${landformName(here)} · ${coverName(here)}`;
  }

  function refreshPanel(): void {
    $("regions").replaceChildren(
      ...world.regions.map((r, i) => {
        const b = document.createElement("button");
        b.className = i === selected ? "region on" : "region";
        b.innerHTML = `<span>${r.id}</span><small>${landformName(i)} · ${coverName(i)}</small>`;
        b.addEventListener("click", () => {
          select(i);
          if (mode === "walk") walkTo(r.x, r.z, Math.atan2(r.x, r.z));
        });
        return b;
      }),
    );
    const region = world.regions[selected];
    if (region === undefined) return;
    sheet.name(region.id);
    $("region-name").textContent = region.id;
    $("bp-id").textContent = `${region.biome.id} · ground level ${fmt(region.base)} m`;
    $("problems").textContent = validate(region.biome, biome, lib).join(" ");
    $("json").textContent = JSON.stringify(region.biome, null, 2);
    renderInspector($("slots"), {
      kind: biome,
      lib,
      blueprint: region.biome,
      onChange: (slots) => {
        const next = blueprintOf(biome.id, slots);
        const issues = validate(next, biome, lib);
        if (issues.length > 0) {
          $("problems").textContent = issues.join(" ");
          return;
        }
        const reshaped = JSON.stringify(next.slots.relief) !== JSON.stringify(region.biome.slots.relief);
        const edited = { ...world, regions: world.regions.map((r, i) => (i === selected ? { ...r, biome: next } : r)) };
        // Only a new landform needs a new bake; a new cover only recolors.
        if (reshaped) {
          void rebake(edited);
        } else {
          world = edited;
          updateCovers();
          refreshPanel();
          walker.moved = true;
        }
      },
    });
  }

  let draws = 0;
  async function randomize(seed?: number): Promise<void> {
    draws += 1;
    const draw = draws;
    if (!(await rebake(randomWorld(lib, seed ?? Math.floor(Math.random() * 2 ** 31), SCALE)))) return;
    selected = 0;
    ground.select(selected, mode === "overview");
    refreshPanel();
    if (mode === "walk") {
      const r = world.regions[0];
      if (r !== undefined) walkTo(r.x, r.z, Math.atan2(r.x, r.z));
    }
    $("draw").textContent = `Draw ${draw}: ${world.regions.length} regions, fit ${fmt(terrain.fit * 100, 0)}%`;
  }

  $("random").addEventListener("click", () => void randomize());
  $("mode-walk").addEventListener("click", () => {
    if (mode !== "walk") {
      const r = world.regions[selected];
      if (r !== undefined) walkTo(r.x, r.z, Math.atan2(r.x, r.z));
    }
  });
  $("mode-overview").addEventListener("click", () => setMode("overview"));
  $("stats-toggle").addEventListener("click", () => {
    const open = $("stats").hidden;
    $("stats").hidden = !open;
    $("stats-toggle").setAttribute("aria-expanded", String(open));
  });

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
  const detailEye = new THREE.Vector3();
  const shadowCenter = new THREE.Vector3();
  const views = (): PlantView[] => [...treeViews, ...settlement.views(), ...landmarkViews, ...(built?.views ?? [])];
  const lanternEye = new THREE.Vector3();
  // The water mirrors the sky, the coarse ground, trees and the cottage, and
  // never grass or the understory: its reflection is soft, so fine detail
  // there is wasted, and the understory keeps back from the water anyway.
  const mirrorHide = [grass.mesh, ground.fine, signs.mesh];
  const mirrorShow = [ground.coarse, ground.wilds];
  let frameCalls = 0;
  /** Each pass's draw calls and triangles in the last frame. */
  const passes = { shadow: { calls: 0, triangles: 0 }, mirror: { calls: 0, triangles: 0 }, view: { calls: 0, triangles: 0 } };
  let waitNight = -1;
  function frame(dt: number, now: number, at: number): void {
    if (at !== hour) applyHour(at);
    // The wait follows the hour as the world will.
    const night = Math.round(light.uNightness.value * 20) / 20;
    if (night !== waitNight) veil.night((waitNight = night));
    light.uTime.value = frozen ?? light.uTime.value + dt;
    if (mode === "walk") {
      updateWalk(dt);
      detailEye.set(detailPin?.x ?? camera.position.x, camera.position.y, detailPin?.z ?? camera.position.z);
      ground.follow(detailPin?.x ?? walker.x, detailPin?.z ?? walker.z);
      wildGrowth.follow(detailPin?.x ?? walker.x, detailPin?.z ?? walker.z);
      lantern.follow(camera.position, forward, lanternGround, walked, dt);
      grass.follow(detailEye);
      water.wade(walker.x, walker.z, walker.yaw, walked, dt);
      shadowCenter.set(walker.x - Math.sin(walker.yaw) * 18, walker.eye, walker.z - Math.cos(walker.yaw) * 18);
      shadow.frame(shadowCenter, 40);
    } else {
      orbit.update();
      // The lantern waits where the person stood.
      lanternEye.set(walker.x, walker.eye, walker.z);
      lantern.follow(lanternEye, forward, lanternGround, 0, dt);
      shadow.frame(shadowCenter.set(0, 0, 0), world.size * 0.62);
    }
    refreshSight(now);
    // Every pass thins distant detail from where the person's eyes are.
    light.uEye.value.copy(mode === "walk" ? detailEye : camera.position);
    shadow.render(renderer, scene, [...views(), ...understory.casters(), ...wildGrowth.all()], [sky.mesh, ground.wilds, ground.fine, ground.coarse, grass.mesh, water.group, signs.mesh, ...understory.quiet()]);
    frameCalls = renderer.info.render.calls;
    passes.shadow = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    const mirrorCalls = water.mirror(renderer, scene, camera, [...mirrorHide, ...understory.quiet(), ...understory.casters().map((c) => c.object), ...wildGrowth.all().map((c) => c.object)], mirrorShow, dt);
    frameCalls += mirrorCalls;
    passes.mirror = { calls: mirrorCalls, triangles: mirrorCalls > 0 ? renderer.info.render.triangles : 0 };
    renderer.render(scene, camera);
    frameCalls += renderer.info.render.calls;
    passes.view = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  }

  /**
   * Shows Gaia's own world, judged and laid out from the engine's snapshot
   * of this repository, or goes back to the sample world. The buildings are
   * the codebase's entities, so the settlement is rebuilt; the rest follows
   * the bake.
   */
  async function showCodebase(on: boolean): Promise<void> {
    code = on ? await codeWorld(veil) : null;
    liveFileVitality.clear();
    for (const v of settlement.views()) scene.remove(v.object);
    settlement = createSettlement(light, code?.buildings ?? SAMPLE_ENTITIES);
    for (const v of settlement.views()) scene.add(v.object);
    knowEntities();
    skyWorld = code?.sky ?? SKY_WORLD;
    hour = Number.NaN;
    const next = code?.spec ?? sampleWorld(SCALE);
    orbit.maxDistance = Math.max(700, next.size * 1.1);
    selected = 0;
    $("codebase").textContent = on ? "Sample world" : "This codebase";
    ($("random") as HTMLButtonElement).disabled = on;
    if (await rebake(next)) valleyView();
  }

  /** The wait the first world opens behind (app/renderer/wait/): it lifts once the world stands and has drawn. */
  const veil = withStart(createWait($("veil")), $("veil"));

  setMode("walk");
  refreshStats();
  refreshPanel();
  // The first world bakes behind a quiet veil, which lifts once it stands.
  const startWithCode = ASKED_WORLD !== "sample" && ASKED_WORLD !== "small";
  const ready = (startWithCode ? showCodebase(true) : rebake(world).then(() => valleyView())).then(async () => {
    // The world's first frames compile its materials; they draw under the paper, so the world shows only once it moves smoothly.
    for (let k = 0; k < LIFT_FRAMES; k++) await new Promise((r) => requestAnimationFrame(r));
    await veil.lift();
    for (const listener of liftedListeners) listener();
  });
  $("codebase").addEventListener("click", () => void showCodebase(code === null));

  // ---------- shots: each relief primitive under every region, from above ----------

  async function showcase(reliefId: string): Promise<void> {
    const p = lib.get(reliefId);
    const sample = sampleWorld(SCALE);
    await rebake({
      ...sample,
      regions: sample.regions.map((r) => ({ ...r, biome: blueprintOf(biome.id, { ...r.biome.slots, relief: { use: p.id, params: defaultParams(p) } }) })),
    });
    selected = 0;
    walker.x = 0;
    walker.z = 0;
    setMode("overview");
    frozen = 8;
  }

  /** The places worth seeing in the world now shown, each with where to stand and which way to look (`tourStops`). */
  function tour(): TourStop[] {
    const groves = new Map<number, { x: number; z: number; trees: number }>();
    for (const t of trees) {
      if (t.patch === undefined) continue;
      const g = groves.get(t.patch) ?? { x: 0, z: 0, trees: 0 };
      groves.set(t.patch, { x: g.x + t.x, z: g.z + t.z, trees: g.trees + 1 });
    }
    const patches = code?.world.patches ?? [];
    const own = groundVitality(patches.map((p) => ({ area: p.area, vitality: p.vitality, size: p.radius * p.radius })));
    const half = world.size / 2 - 4;
    return tourStops({
      things: [
        ...settlement.buildings.map((b) => {
          const front = settlement.standOf(b);
          const d = Math.hypot(front.x - b.site.x, front.z - b.site.z) || 1;
          return { as: "building" as const, kind: b.kindName, name: b.represented.id || b.represented.name, x: b.site.x, z: b.site.z, vitality: entityVitality.get(b.represented.id) ?? 1, reach: Math.hypot(b.plan.width, b.plan.depth) / 2, front: { x: (front.x - b.site.x) / d, z: (front.z - b.site.z) / d } };
        }),
        ...ways.sites.map((s, i) => {
          const turn = landmarkViews[i]?.object.rotation.y ?? 0;
          const entity = landmarkEntity(i);
          return { as: "landmark" as const, kind: landmarks[s.landmark]?.name ?? "Landmark", name: entity.id || entity.name, x: s.site.x, z: s.site.z, vitality: entityVitality.get(entity.id) ?? 1, reach: landmarks[s.landmark]?.base ?? 4, front: { x: Math.sin(turn), z: Math.cos(turn) } };
        }),
      ],
      network: ways.network,
      wayVitality: (way, along) => wayVitalityAt(ways.network, way, along, vitalityOfPlace),
      junctionVitality: (j) => junctionVitality(ways.network, j, vitalityOfPlace),
      areas: (code?.world.areas ?? []).map((a) => ({ path: a.path, x: a.x, z: a.z, ground: a.ground, depth: a.depth, vitality: own.get(a.path) ?? 1 })),
      groves: [...groves].map(([i, g]) => ({ path: patches[i]?.path ?? `patch ${i}`, x: g.x / g.trees, z: g.z / g.trees, trees: g.trees, vitality: patches[i]?.vitality ?? 1 })),
      ponds: terrain.ponds.map((p) => ({ x: p.x, z: p.z, reach: p.reach })),
      standable: (x, z) => Math.abs(x) < half && Math.abs(z) < half && waterDepthAt(terrain, x, z) <= LAND.dry && clearanceAt(solids, x, z) >= LAND.clear,
    });
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
    if (spot === null) return null;
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

  // ---------- measuring: what a step of walking changes, and walking as a person would ----------

  /** Draws `settle` frames at this instant, without time passing, and returns the last one's pixels. */
  function grabFrame(settle = 2): Uint8Array {
    const now = performance.now();
    for (let k = 0; k < settle; k++) frame(0, now, hour);
    const gl = renderer.getContext();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  function frameChange(a: Uint8Array, b: Uint8Array): Change {
    const gl = renderer.getContext();
    return pictureChange(a, b, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  /**
   * The walk test. From where the person stands, walks `meters` along the
   * view in steps of `step` meters with the wind's clock frozen. At each step
   * the view holds while only the point detail is chosen from moves one step
   * on, so the change measured is exactly what the step does to the detail
   * drawn: levels, thinning, the grass, the ground's rings. A step is held
   * to the wind's own change over half a second, a change people already see
   * all the time, measured along the same walk every `windEvery` steps, each
   * time 1.7 s further on, so the samples span the breeze's lulls and gusts.
   * The wind's clock stands at `at` seconds, or where it is now. Returns each
   * step's [meters walked, mean, worst block] and the wind's worst blocks.
   */
  function walkSteps(meters: number, step: number, at = light.uTime.value, windEvery = 10): { steps: [number, number, number][]; wind: number[] } {
    const start = { x: walker.x, z: walker.z, yaw: walker.yaw, pitch: walker.pitch };
    const was = frozen;
    const t = at;
    const dx = -Math.sin(start.yaw);
    const dz = -Math.cos(start.yaw);
    const steps: [number, number, number][] = [];
    const wind: number[] = [];
    try {
      for (let k = 0; (k + 1) * step <= meters; k++) {
        walkTo(start.x + dx * k * step, start.z + dz * k * step, start.yaw, start.pitch);
        frozen = t;
        detailPin = { x: walker.x, z: walker.z };
        const here = grabFrame();
        if (k % windEvery === 0) {
          const moment = t + (k / windEvery) * 1.7;
          frozen = moment;
          const before = grabFrame();
          frozen = moment + 0.5;
          wind.push(frameChange(before, grabFrame()).worst);
          frozen = t;
        }
        detailPin = { x: walker.x + dx * step, z: walker.z + dz * step };
        const on = frameChange(here, grabFrame());
        steps.push([k * step, on.mean, on.worst]);
      }
    } finally {
      detailPin = null;
      frozen = was;
      walkTo(start.x, start.z, start.yaw, start.pitch);
    }
    return { steps, wind };
  }

  /**
   * Walks for `seconds` of real time as a person would: forward all along,
   * turning left or right for 0.7 s every 2.5 s, and running a third of the
   * time. The app's smoothness probe (`__lab.smoothness()`) reads the frames.
   */
  function wander(seconds: number): Promise<{ x: number; z: number }> {
    return new Promise((done) => {
      const t0 = performance.now();
      const tick = (now: number): void => {
        const t = (now - t0) / 1000;
        const beat = Math.floor(t / 2.5);
        keys.clear();
        if (t >= seconds) {
          done({ x: walker.x, z: walker.z });
          return;
        }
        keys.add("KeyW");
        if (t - beat * 2.5 < 0.7) keys.add(beat % 2 === 1 ? "ArrowLeft" : "ArrowRight");
        if (beat % 3 === 0) keys.add("ShiftLeft");
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  const handle: WorldHandle = {
    scene,
    light,
    camera,
    person: () => ({ x: walker.x, z: walker.z, yaw: walker.yaw, walking: goal !== null || [...keys].some((k) => k !== "ShiftLeft" && k !== "ShiftRight") }),
    placeAt: (x, z) => placeAt(places, x, z),
    places: () => places,
    stood: stoodWorld,
    onStood: (listener) => stoodListeners.push(listener),
    onLifted: (listener) => liftedListeners.push(listener),
    furnish: (f) => {
      furnisher = f;
    },
    furnishingSolid: (on) => {
      if (on === furnishSolid) return;
      furnishSolid = on;
      solids = solidsOf(on ? [...bodies, ...furnished.solids] : bodies);
    },
    immersive: (on) => {
      root.classList.toggle("immersive", on);
      if (on && mode !== "walk") setMode("walk");
      resize();
    },
    landing: (x, z, heart) => landingNear(x, z, heart),
    place: (at) => walkTo(at.x, at.z, at.yaw),
    onCard: (listener) => cardListeners.push(listener),
    onHeading: (listener) => headingListeners.push(listener),
  };

  return {
    world: handle,
    renderer,
    ready,
    report: () => ({
      mode,
      walking: goal !== null || [...keys].some((k) => k !== "ShiftLeft" && k !== "ShiftRight"),
      worldSize: world.size,
      regions: world.regions.length,
      trees: trees.length,
      landmarks: ways.sites.length,
      trails: ways.network.trails.length,
      ways: ways.network.ways.length,
      bakeMs: Math.round(bakeMs),
    }),
    setActive(on) {
      active = on;
      orbit.enabled = on && mode === "overview";
      if (!on) keys.clear();
      if (on) resize();
    },
    frame: (dt, now, h) => {
      if (active) frame(dt, now, h);
    },
    shots: (): Shot[] => RELIEF_PRIMITIVES.map((p) => ({ name: `terrain-${slug(p.id)}`, stage: () => showcase(p.id) })),
    hook: {
      cottage: () => {
        const b = settlement.buildings[0];
        return b === undefined ? null : { ...b.site, triangles: b.view.triangles, width: b.plan.width, depth: b.plan.depth };
      },
      /** Each standing landmark: its name, site, height and triangles. */
      landmarks: () =>
        ways.sites.map((s, i) => ({ name: landmarks[s.landmark]?.name, ...s.site, height: landmarkViews[i]?.height, triangles: landmarkViews[i]?.triangles })),
      /** Sets every landmark's entity's vitality, 0 to 1, and with it the trails they join. */
      landmarkVitality: (v: number) => {
        landmarkEntities.forEach((e) => setEntityVitality(e.id, v));
        for (const view of landmarkPool.values()) view.setVitality(v);
      },
      /** Sets an entity's vitality by its path, or every entity's with that name: its building or landmark, and the wear of every trail it joins, live. */
      entityVitality: (key: string, v: number) => {
        const named = [...settlement.buildings.map((b) => b.represented), ...landmarkEntities].filter((r) => r.name === key).map((r) => r.id);
        for (const id of entityVitality.has(key) ? [key] : named) setEntityVitality(id, v);
      },
      /** Stands landmark preset `i` on landmark site `at` in place of what stands there, so every form can be seen; returns where. */
      showLandmark: (i: number, at = 0) => {
        const s = ways.sites[at];
        const lm = landmarks[i];
        if (s === undefined || lm === undefined) return null;
        for (const [key, v] of landmarkPool) if (key.startsWith("show#") || v === landmarkViews[at]) v.object.visible = false;
        let view = landmarkPool.get(`show#${i}`);
        if (view === undefined) {
          view = createPlant({ ...lm.built, parts: mergeParts(lm.built.parts) }, light);
          landmarkPool.set(`show#${i}`, view);
          scene.add(view.object);
        }
        view.object.visible = true;
        view.object.position.set(s.site.x, s.site.y - 0.05, s.site.z);
        view.object.rotation.y = 0;
        return { name: lm.name, x: s.site.x, y: s.site.y, z: s.site.z, base: lm.base, height: view.height, triangles: view.triangles };
      },
      /** Each trail (a dependency): its ends, length and the ways it walks. */
      trails: () =>
        ways.network.trails.map((t) => ({
          id: t.id,
          from: { place: t.from, entity: entityOfPlace.get(t.from), vitality: vitalityOfPlace(t.from) },
          to: { place: t.to, entity: entityOfPlace.get(t.to), vitality: vitalityOfPlace(t.to) },
          length: Math.round(t.length),
          ways: t.ways.map((w) => w.way),
        })),
      /** Each way of tread: its ends, length, width, crossings, the trails walking it, its wear now and a point every 10 m. */
      ways: () =>
        ways.network.ways.map((w, i) => ({
          id: w.id,
          from: w.from,
          to: w.to,
          length: Math.round(w.length),
          width: +w.style.width.toFixed(2),
          crossing: w.style.crossing,
          crossings: w.crossings.map((c) => ({ x: Math.round(c.x), z: Math.round(c.z), span: +c.span.toFixed(1), yaw: +c.yaw.toFixed(2) })),
          carries: w.carries.map((c) => ways.network.trails[c.trail]?.id),
          wear: wayWear(ways.network, i, vitalityOfPlace).map((v) => +v.toFixed(2)),
          points: Array.from({ length: Math.ceil(w.points.length / 20) }, (_, k) => [Math.round(w.points[k * 20] ?? 0), Math.round(w.points[k * 20 + 1] ?? 0)]),
        })),
      /** Every building: what it stands for, where, and its vitality now. */
      buildings: () =>
        settlement.buildings.map((b) => ({ name: b.represented.name, building: b.kindName, ...b.site, width: b.plan.width, depth: b.plan.depth, triangles: b.view.triangles, vitality: b.view.vitality, sign: settlement.signOf(b), stand: settlement.standOf(b) })),
      /** Sets building `i`'s vitality, and its sign's. */
      vitality: (i: number, v: number) => {
        const b = settlement.buildings[i];
        if (b !== undefined) setEntityVitality(b.represented.id, v);
      },
      /** Walks up to subject `i` (buildings first, then trees) and shows its card on arrival. */
      inspect: (i: number) => {
        const s = subjects[i];
        if (s !== undefined) approach(s);
      },
      subjects: () => subjects.map((s) => ({ name: s.represented.name, standsAs: s.standsAs, judge: s.judge, x: s.x, z: s.z, vitality: s.represented.report.vitality })),
      card: () => (card.shown === null ? null : { name: card.shown.name, what: card.shown.what }),
      /** Whether the view is turning on its own to frame a thing the person arrived at. */
      turning: () => turn !== null,
      closeCard: () => hideCard(),
      walk: (x: number, z: number, yawDeg: number, pitchDeg = -3) => walkTo(x, z, (yawDeg * Math.PI) / 180, (pitchDeg * Math.PI) / 180),
      /**
       * The tour (`tourStops`): with no name, every stop's name, what is there
       * and where; with a name, such as "ruined building", "bridge",
       * "stepping stones", "cairn" or "watermill (ruin)", walks there, looking
       * at it, and returns the stop, or null when this world has none.
       */
      tour: (name?: string) => {
        const stops = tour();
        if (name === undefined) return stops.map((s) => ({ name: s.name, what: s.what, x: Math.round(s.x), z: Math.round(s.z) }));
        const s = stops.find((t) => t.name === name.toLowerCase());
        if (s !== undefined) walkTo(s.x, s.z, s.yaw, s.pitch);
        return s ?? null;
      },
      valley: () => valleyView(),
      walker: () => ({ x: walker.x, z: walker.z, yawDeg: (walker.yaw * 180) / Math.PI, pitchDeg: (walker.pitch * 180) / Math.PI, eye: walker.eye }),
      /** The overview, from `pos` if given, looking at `target` (the world's middle unless given). */
      overview: (pos?: [number, number, number], target?: [number, number, number]) => {
        setMode("overview");
        if (pos !== undefined) camera.position.set(...pos);
        if (target !== undefined) orbit.target.set(...target);
      },
      select: (i: number) => select(i),
      random: (seed?: number) => randomize(seed),
      showcase,
      freeze: (t: number | null) => (frozen = t),
      regions: () =>
        world.regions.map((r, i) => ({ i, id: r.id, x: Math.round(r.x), z: Math.round(r.z), landform: landformName(i), cover: coverName(i) })),
      streams: () => terrain.streams.map((s) => s.stations.filter((_, k) => k % 10 === 0).map((p) => [Math.round(p.x), Math.round(p.z), +p.level.toFixed(2)])),
      report: () => ({ ...terrain.report, fit: terrain.fit, bakeMs: Math.round(bakeMs) }),
      info: () => renderer.info.render,
      /** Draw calls in the whole last frame (shadow, mirror and view), and the water's mirror. */
      water: () => ({ ...water.stats(), frameCalls }),
      /** Draw calls and triangles of each pass in the last frame: the sun's shadow, the water's mirror and the view. */
      passes: () => structuredClone(passes),
      /**
       * Sets the vitality of a file, or of every file under a directory, by
       * its path ("" for every file), live: its trees, its finer entities, its
       * patch of ground and what grows there, and the lots and water of the
       * areas pooling it. Nothing rebakes. Returns how many files it set.
       */
      fileVitality: (path: string, v: number) => {
        const under = (p: string): boolean => path === "" || p === path || p.startsWith(`${path}/`);
        const files = (code?.world.patches ?? []).filter((p) => under(p.path));
        for (const p of files) liveFileVitality.set(p.path, v);
        trees.forEach((t, i) => {
          const file = treeFile(t);
          if (file !== undefined && under(file)) groves.get(t.variant)?.setVitalityAt(treeCopies[i] ?? 0, v);
        });
        showLandVitality();
        return files.length;
      },
      /** The ground's own vitality and its area's at (x, z), or underfoot, as the grass, the ground and the water read them. */
      groundVitality: (x?: number, z?: number) => groundVitalityAt(x ?? walker.x, z ?? walker.z),
      understory: () => understory.stats(),
      /** Shows or hides the wild bushes, for comparing frame costs. */
      showWilds: (on: boolean) => wildGrowth.show(on),
      /** The wild bushes: copies standing and drawn in the last pass, per blueprint, and each blueprint's triangles. */
      wilds: () => wildGrowth.all().map((v) => ({ standing: v.count, perCopy: v.triangles / Math.max(1, v.count), levels: v.levels, ...v.drawn() })),
      placements: () => understory.placements(),
      showUnderstory: (on: boolean) => understory.show(on),
      /** Shows or hides the grass, for comparing frame costs and looking at the bare ground. */
      showGrass: (on: boolean) => {
        grass.mesh.visible = on;
      },
      /**
       * Holds the point every detail is chosen from (the trees' and bushes'
       * levels and thinning, the grass, the ground's rings and the wild
       * bushes) at (x, z), at the eye's height, while the view stays put; or
       * lets it follow the eye again (null). Moving only this point shows
       * exactly what a step of walking changes in the detail drawn.
       */
      detailCenter: (at: [number, number] | null) => {
        detailPin = at === null ? null : { x: at[0], z: at[1] };
      },
      /**
       * Draws one frame and counts each kind's draw calls and triangles in
       * each pass (the sun's shadow, the water's mirror and the view), from
       * what the renderer actually drew.
       */
      drawn: () => {
        const kinds = new Map<THREE.Object3D, string>();
        const name = (kind: string, objects: readonly (THREE.Object3D | undefined)[]): void => {
          for (const o of objects) if (o !== undefined) kinds.set(o, kind);
        };
        name("trees", treeViews.map((v) => v.object));
        name("understory", [...understory.all().map((v) => v.object), ...understory.quiet()]);
        name("wild bushes", wildGrowth.all().map((v) => v.object));
        name("grass", [grass.mesh]);
        name("ground", [ground.fine, ground.coarse, ground.wilds]);
        name("water", [water.group]);
        name("sky", [sky.mesh]);
        name("signs", [signs.mesh]);
        name("buildings", settlement.views().map((v) => v.object));
        name("landmarks", [...landmarkViews, ...landmarkPool.values()].map((v) => v.object));
        name("trails", (built?.views ?? []).map((v) => v.object));
        const now = performance.now();
        return tallyFrame(renderer, scene, camera, kinds, () => frame(0, now, hour));
      },
      /**
       * Draws `settle` frames at this instant, without time passing, and
       * returns the last one's pixels, to compare with `change`. Freeze the
       * wind's clock first (`freeze`), so only what the probe changes moves.
       */
      grab: grabFrame,
      /** How much the picture changed between two grabbed frames (`pictureChange`). */
      change: frameChange,
      /** The walk test (`walkSteps`): each step's change to the detail drawn, and the wind's along the same walk. */
      steps: (meters: number, step = 0.7, at?: number) => walkSteps(meters, step, at),
      /** Walks as a person would for `seconds` of real time (`wander`). */
      wander,
      /** Shows or hides every tree, for comparing frame costs. */
      showTrees: (on: boolean) => {
        for (const v of treeViews) v.object.visible = on;
      },
      /** Draw calls in one whole frame: the shadow pass and the view together. */
      calls: () => {
        renderer.info.autoReset = false;
        renderer.info.reset();
        frame(0, performance.now(), hour);
        const calls = renderer.info.render.calls;
        renderer.info.autoReset = true;
        return calls;
      },
      /** Draws `count` frames back to back and waits for the GPU: milliseconds per frame, shadows included. */
      bench: (count: number) => {
        const gl = renderer.getContext();
        const pixel = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const t0 = performance.now();
        for (let k = 0; k < count; k++) frame(1 / 60, t0, hour);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return (performance.now() - t0) / count;
      },
      /** Walks straight ahead for `seconds` at walking pace, as if W were held, and reports where the walk ended. */
      stride: (seconds: number) => {
        for (let k = 0; k < Math.round(seconds * 60); k++) {
          const next = walkStep(terrain, solids, walker, { dx: -Math.sin(walker.yaw), dz: -Math.cos(walker.yaw), speed: WALK_TO.pace }, 1 / 60);
          walker.x = next.x;
          walker.z = next.z;
        }
        body = standAt(terrain, decks, walker.x, walker.z);
        walker.eye = body.eye;
        walker.moved = true;
        return { x: walker.x, z: walker.z, depth: waterDepthAt(terrain, walker.x, walker.z) };
      },
      depth: () => waterDepthAt(terrain, walker.x, walker.z),
      /** The body now: its speed, its eyes' ride and what the stride adds, and the footing under it. */
      gait: () => (body === null ? null : { speed: Math.hypot(body.vx, body.vz), eye: body.eye, lift: body.lift, sway: body.sway, steps: body.steps, camera: camera.position.y, footing: footingAt(terrain, decks, walker.x, walker.z) }),
      /** Every footbridge deck a walk stands on: its middle, the way it runs along, its span and its top at the middle. */
      decks: () => decks.map((d) => ({ x: d.x, z: d.z, along: [d.cos, -d.sin], span: d.half * 2, width: d.halfWidth * 2, top: d.base + d.topAt(0) })),
      /** The ground (bridges left out), how a person stood there before decks, and the footing now, at each (x, z). */
      profile: (points: readonly (readonly [number, number])[]) =>
        points.map(([x, z]) => {
          const s = stanceAt(terrain, x, z);
          const f = footingAt(terrain, decks, x, z);
          return { ground: groundHeightAt(terrain, x, z), eye: s.eye, depth: s.depth, swim: s.swim, footing: f.ground, deck: f.deck };
        }),
      /**
       * Walks the lab's own walk for `seconds` at 60 frames a second without
       * drawing, holding `keys` (codes) for `hold` seconds or walking a tap to
       * `to`, and records each frame: [t, x, z, speed, camera y, eye ride, footing, depth, on a deck].
       */
      trace: (seconds: number, drive: { keys?: readonly string[]; hold?: number; to?: readonly [number, number] }) => {
        keys.clear();
        if (drive.to !== undefined) setGoal(drive.to[0], drive.to[1]);
        for (const k of drive.keys ?? []) keys.add(k);
        const rows: number[][] = [];
        for (let i = 0; i < Math.round(seconds * 60); i++) {
          if (drive.hold !== undefined && i === Math.round(drive.hold * 60)) keys.clear();
          updateWalk(1 / 60);
          const f = footingAt(terrain, decks, walker.x, walker.z);
          const b = body as Stride;
          rows.push([i / 60, walker.x, walker.z, Math.hypot(b.vx, b.vz), camera.position.y, walker.eye, f.ground, f.depth, f.deck ? 1 : 0]);
        }
        keys.clear();
        return rows;
      },
      /** Where a tap's walk is headed, or null, and the corners of its way. */
      goal: () => ({ goal: goal === null ? null : { ...goal.target }, way: goal?.way.map((p) => [p.x, p.z]) ?? null }),
      /** How far (x, z) is from the nearest solid's edge, at most 2 m; negative inside one. */
      clearance: (x: number, z: number) => clearanceAt(solids, x, z),
      /** The trunks, rocks and bushes and walls that stop a walker. */
      solids: () => solids.count,
      /** The eyes' height, the water's depth and how far the person swims where they stand. */
      stance: () => stanceAt(terrain, walker.x, walker.z),
      /** Where the ground at (x, z) shows on screen, in CSS pixels from the page's top left; null when it is behind the view. */
      onScreen: (x: number, z: number) => {
        const p = new THREE.Vector3(x, groundHeightAt(terrain, x, z), z).project(camera);
        if (p.z > 1) return null;
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
      },
      ponds: () => terrain.ponds.map((p) => ({ x: p.x, z: p.z, reach: p.reach })),
      plants: () => trees.map((t) => ({ x: t.x, z: t.z, height: (variants[t.variant] as TreeVariant).height * t.scale, region: regionAt(t.x, t.z), preset: FLORA_PRESETS[Math.floor(t.variant / TREE_BUILDS)]?.name ?? "", vitality: t.represented.report.vitality })),
      /** Replants `trees` trees and the understory at `density` times its usual count, for measuring at scale; the bake thread stands them again. */
      forest: async (count: number, density = 1) => {
        treeCount = count;
        understoryDensity = density;
        await rebake(world);
        return { trees: trees.length, understory: understory.stats().placed };
      },
      /** Forces every instanced blueprint's detail ("full" or "far"), or lets distance choose ("auto"). */
      detail: (mode: DetailMode) => {
        for (const v of instanced()) v.detail = mode;
      },
      /** Trees, builds, each blueprint's levels, and the copies and triangles the last pass drew. */
      scale: () => ({
        trees: trees.length,
        builds: variants.length,
        levels: instanced().map((v) => v.levels),
        drawn: instanced().reduce((n, v) => n + v.drawn().copies, 0),
        drawnTriangles: instanced().reduce((n, v) => n + v.drawn().triangles, 0),
      }),
      selected: () => selected,
      /** Shows Gaia's own world (true) or the sample world (false). */
      codebase: (on: boolean) => showCodebase(on),
      /** Where the walker is, or (x, z): the area and file patch underfoot, in either world. */
      place: (x?: number, z?: number) => placeAt(places, x ?? walker.x, z ?? walker.z),
      /** The codebase's world: its size, areas, patches, buildings, landmarks and trails. */
      code: () =>
        code === null
          ? null
          : {
              name: code.world.name,
              judged: code.summary,
              size: code.world.size,
              sky: code.sky?.name,
              regions: code.world.regions.map((r) => ({ area: r.area, land: r.land, x: Math.round(r.x), z: Math.round(r.z) })),
              areas: code.world.areas.map((a) => ({ path: a.path, x: Math.round(a.x), z: Math.round(a.z), ground: Math.round(a.ground), depth: a.depth })),
              symbols: code.world.symbols.length,
              standingSymbols: symbolPlacements.filter((k) => k >= 0).length,
              patches: code.world.patches.length,
              things: code.world.things.map((t) => ({ path: t.path, name: t.name, as: t.as, look: t.look, x: Math.round(t.x), z: Math.round(t.z), vitality: +t.vitality.toFixed(2) })),
              trails: code.world.trails.map((t) => `${t.from}->${t.to}`),
            },
      camera: () => ({ position: camera.position.toArray(), target: orbit.target.toArray() }),
    },
  };
}
