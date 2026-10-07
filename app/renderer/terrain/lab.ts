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
  type DetailMode,
  type PlantInstances,
  type PlantView,
  applyLight,
  createLantern,
  createPlant,
  createPlantInstances,
  createRenderer,
  createSceneLight,
  createSunShadow,
} from "@gaia/render";
import {
  COVER_TAPS,
  DRY,
  EYE_HEIGHT,
  FULL_WORLD,
  SHORE_CAP,
  SMALL_WORLD,
  type Trail,
  NO_SOLIDS,
  RELIEF_BUDGET,
  type SolidShape,
  type Solids,
  clearanceAt,
  outlineShape,
  piecesShapes,
  placeAt,
  planWalk,
  type Terrain,
  type Walk,
  type WorldSpec,
  heightAt,
  landRadius,
  latticeOf,
  randomWorld,
  sampleWorld,
  sightlines,
  siteToWorld,
  solidsOf,
  stanceAt,
  WALK_TO,
  walkStep,
  walkToward,
  wallsShape,
  waterDepthAt,
} from "@gaia/terrain";
import { createSky } from "../world/environment.ts";
import { renderInspector } from "../inspector.ts";
import { type Lab, type Shot, onTap, refs, slug, tapSlop } from "../lab.ts";
import { createSheet } from "../sheet.ts";
import { createGrass } from "./cover.ts";
import { createGround, createGroundTexture } from "./ground.ts";
import { createWalkMarker } from "./marker.ts";
import { createRegionCovers } from "./regions.ts";
import { createWater } from "./water.ts";
import { createUnderstory } from "./understory.ts";
import { createClearings } from "./clearings.ts";
import { type Ways, createWays, trailWear } from "./trails.ts";
import { createCard } from "./card.ts";
import { type Represented, SAMPLE_ENTITIES, SAMPLE_FILES, representEntity, representFile } from "./samples.ts";
import { type CodeLab, codeWorld } from "./code-world.ts";
import { createSettlement } from "./settlement.ts";
import { createSigns } from "./signs.ts";
import { createBaker } from "./baker.ts";
import type { Stand, StandRequest, StandingLandmark } from "./stand.ts";

const TEMPLATE = /* html */ `
<main class="stage">
  <canvas class="view" aria-label="A world of gentle landforms. Click or tap the ground to walk there and drag to look, or switch to the overview."></canvas>
  <div class="veil" data-ref="veil" role="status"><span>Baking the world…</span></div>
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
/** A swimmer's gentle bob: meters up and down, and seconds per bob. */
const BOB = { height: 0.03, period: 2.8 };
/** While swimming, the lantern is held at least this far above the water, meters. */
const LANTERN_ABOVE_WATER = 0.15;

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
  /** Where it stands, and where a person stops to read its sign; a tree's spot depends on where they come from. */
  readonly x: number;
  readonly z: number;
  readonly stand: (fromX: number, fromZ: number) => { x: number; z: number };
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

/** The full world, or the small one with `?world=small` in the page's address, to compare the two. */
const SCALE = new URLSearchParams(location.search).get("world") === "small" ? SMALL_WORLD : FULL_WORLD;
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

export function createTerrainLab(root: HTMLElement): Lab {
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

  // ---------- landmarks and trails ----------
  // A few landmarks stand on the most prominent ground of regions spread
  // across the world, and trails tie them and the buildings together. Counts
  // follow the world's size and region count, so the same rules fill a
  // 320 m world or a kilometer; `standWorld` places them on the bake thread.
  const landmarkLib = new Library([...LANDMARK_PRIMITIVES, ...FLORA_PRIMITIVES]);
  const routeLib = new Library(ROUTE_PRIMITIVES);
  const landmarks = LANDMARK_PRESETS.map((preset, i) => {
    const built = realize(preset.blueprint, landmark, landmarkLib, { seed: seedOf(`terrain-lab/landmark-${i}`), facts: { scale: 1 } });
    // The footprint at the ground: how far the landmark reaches within a meter of it.
    let base = 1;
    for (const part of built.parts) {
      for (let k = 0; k < part.positions.length; k += 3) {
        if ((part.positions[k + 1] as number) < 1) base = Math.max(base, Math.hypot(part.positions[k] as number, part.positions[k + 2] as number));
      }
    }
    return { name: preset.name, built, base: Math.min(base, 10) };
  });
  const trailStyles = TRAIL_PRESETS.map((p) => buildSlots(p.blueprint, link, routeLib, { seed: 1, facts: {} }).get("route")?.output as RouteSpec);
  /** The landmarks standing and the trails between every place, from the last bake. */
  interface Settled {
    readonly sites: readonly StandingLandmark[];
    readonly trails: readonly Trail[];
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
  let ways: Settled = { sites: [], trails: [] };
  const worldLib = new Library(WORLD_PRIMITIVES);
  const lantern = createLantern(light);

  const covers = createRegionCovers();
  const coverOf = (i: number): GroundSpec => {
    const r = world.regions[i];
    if (r === undefined) throw new Error(`No region ${i}.`);
    return realizeRegion({ blueprint: r.biome, kind: biome }, lib, seedOf(r.id), NO_SEASON).ground;
  };
  const updateCovers = (): void => covers.update(world, world.regions.map((_, i) => coverOf(i)), terrain);
  updateCovers();

  const scene = new THREE.Scene();
  const sky = createSky(light);
  const groundTex = createGroundTexture(terrain);
  const ground = createGround(terrain, light, covers, groundTex);
  const clearings = createClearings(terrain);
  const grass = createGrass(light, groundTex, covers, landRadius(terrain), clearings);
  const water = createWater(terrain, light, groundTex);
  const marker = createWalkMarker();
  scene.add(sky.mesh, ground.wilds, ground.fine, ground.coarse, grass.mesh, water.group, marker.mesh);
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
      const near = ways.trails.flatMap((t) => [[t.points[0], t.points[1]], [t.points[t.points.length - 2], t.points[t.points.length - 1]]]).find(([x, z]) => Math.hypot((x ?? 0) - s.site.x, (z ?? 0) - s.site.z) < 14);
      const home = settlement.buildings[0]?.site;
      const [fx, fz] = near ?? [home?.x ?? 0, home?.z ?? 0];
      view.object.rotation.y = Math.atan2((fx ?? 0) - s.site.x, (fz ?? 0) - s.site.z);
      return view;
    });
    trailWear.value = ways.trails.length === 0 ? 0 : ways.trails.reduce((n, t) => n + t.style.wear, 0) / ways.trails.length;
    built?.dispose();
    built = createWays(scene, light, landmarkLib, terrain, ways.trails);
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
    clearings.setCapsules([...settlement.clearings(), ...feet]);
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
      let trunk = 0;
      if (bark !== undefined) {
        for (let i = 0; i < 11; i++) trunk = Math.max(trunk, Math.hypot(bark.positions[i * 3] ?? 0, bark.positions[i * 3 + 2] ?? 0));
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
  let treeViews: PlantInstances[] = [];
  /** Each build's instances by variant, kept for the life of the lab. */
  const groves = new Map<number, PlantInstances>();

  // Rocks, bushes and wildflowers, scattered around the trees.
  const understory = createUnderstory(scene, light, new Library([...FLORA_PRIMITIVES, ...ROCK_PRIMITIVES, ...WILDFLOWER_PRIMITIVES]), clearings);

  // Before every pass (the sun's shadow, the water's mirror and the view),
  // each instanced blueprint packs only the cells that pass's camera sees.
  const instanced = (): PlantInstances[] => [...treeViews, ...understory.all()];
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
    trees: { count: treeCount, seed: 9, presets: FLORA_PRESETS.length, builds: TREE_BUILDS, bases: variants.map((v) => v.base) },
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
    trees = stood.trees.map((t) => ({ ...t, represented: representFile(fileOf(t)) }));
    // Each build keeps its instances from bake to bake and only moves its copies.
    treeViews = variants.flatMap((v, k) => {
      const spots = trees.filter((t) => t.variant === k).map((t) => ({ x: t.x, y: t.y, z: t.z, yaw: t.yaw, scale: t.scale, vitality: t.represented.report.vitality }));
      const had = groves.get(k);
      if (had !== undefined) {
        had.respot(spots);
        return [had];
      }
      if (spots.length === 0) return [];
      const view = createPlantInstances(v.plant, light, spots);
      scene.add(view.object);
      groves.set(k, view);
      return [view];
    });
    // Nothing of the understory stands in a building, on its walk, on a trail or under a landmark: the bake thread kept it clear.
    understory.place(terrain, world, [], understoryDensity, stood.placements);
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
      return [wallsShape(b.plan, b.site), ...beside];
    });
    solids = solidsOf([...trunks, ...components, ...standing, ...buildings]);
    warm();
    placeSigns();
  }
  let solids: Solids = NO_SOLIDS;

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
    const buildingSubjects: Subject[] = settlement.buildings.map((b) => ({
      represented: b.represented,
      standsAs: `A ${b.kindName.toLowerCase()}`,
      x: b.site.x,
      z: b.site.z,
      stand: () => settlement.standOf(b),
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
            standsAs: `A ${lm.name.toLowerCase()}`,
            x,
            z,
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
        x,
        z,
        // Stop just outside the crown, so the tree and its plaque are in view, not its leaves.
        stand: (fx: number, fz: number) => {
          const d = Math.hypot(fx - x, fz - z) || 1;
          const off = Math.max(3, crown * 0.9 + 1.4);
          return { x: x + ((fx - x) / d) * off, z: z + ((fz - z) / d) * off };
        },
      };
    });
    subjects = [...buildingSubjects, ...landmarkSubjects, ...treeSubjects];
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
  function showCard(s: Subject): void {
    card.show(s.represented, s.standsAs);
    $("panel").classList.add("showing-card");
    sheet.name(s.represented.name);
    sheet.open(true);
  }
  function hideCard(): void {
    card.hide();
    $("panel").classList.remove("showing-card");
    sheet.name(world.regions[selected]?.id ?? "");
  }
  /** The subject a walk is taking the person to, shown when they get there. */
  let pending: Subject | null = null;
  /** Walk up to a thing, then show what it stands for; a thing already close is shown at once. */
  function approach(s: Subject): void {
    const spot = s.stand(walker.x, walker.z);
    if (Math.hypot(spot.x - walker.x, spot.z - walker.z) < 2) {
      endWalk();
      showCard(s);
      return;
    }
    setGoal(spot.x, spot.z);
    pending = s;
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
  function thingHit(ray: THREE.Ray): { x: number; z: number; distance: number } | null {
    const { origin: o, direction: d } = ray;
    const flat = d.x * d.x + d.z * d.z;
    let best: { x: number; z: number; distance: number } | null = null;
    for (const p of understory.placements()) {
      const foot = STOPS[p.rule] === undefined ? undefined : understory.footprint(p.rule, p.variant);
      if (foot === undefined) continue;
      const s = flat < 1e-9 ? 0 : ((p.x - o.x) * d.x + (p.z - o.z) * d.z) / flat;
      if (s <= 0) continue;
      const x = o.x + d.x * s;
      const z = o.z + d.z * s;
      const y = o.y + d.y * s;
      if (Math.hypot(x - p.x, z - p.z) > Math.max(...foot.outline) * p.scale || y > p.y + foot.top * p.scale) continue;
      if (best === null || s < best.distance) best = { x, z, distance: s };
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
      // The keys take over from a tap's walk; Shift alone moves nothing, so it leaves the walk be.
      if (e.code !== "ShiftLeft" && e.code !== "ShiftRight") endWalk();
    }
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

  /** Where a ray first meets the walkable ground, marched over the heightfield the mesh draws; past the rim, the wild land. */
  function groundHit(ray: THREE.Ray): { x: number; z: number; distance: number } | null {
    const l = terrain.lattice;
    const { origin: o, direction: d } = ray;
    const above = (s: number): boolean => o.y + d.y * s > heightAt(l, o.x + d.x * s, o.z + d.z * s);
    const edge = l.origin + (l.n - 1) * l.spacing;
    const step = l.spacing * 0.5;
    // Start where the ray enters the lattice's square, so a view from above or beyond it still finds the ground.
    let enter = 0;
    let leave = Infinity;
    for (const [p, v] of [[o.x, d.x], [o.z, d.z]] as const) {
      if (Math.abs(v) < 1e-9) {
        if (p < l.origin || p > edge) return null;
        continue;
      }
      const a = (l.origin - p) / v;
      const b = (edge - p) / v;
      enter = Math.max(enter, Math.min(a, b));
      leave = Math.min(leave, Math.max(a, b));
    }
    for (let s = Math.max(step, enter + step); s < Math.min(leave, enter + REACH); s += step) {
      const x = o.x + d.x * s;
      const z = o.z + d.z * s;
      if (x < l.origin || x > edge || z < l.origin || z > edge) break;
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
    const wild = raycaster.intersectObject(ground.wilds)[0];
    return wild === undefined ? null : { x: wild.point.x, z: wild.point.z, distance: wild.distance };
  }

  function setGoal(x: number, z: number): void {
    goal = planWalk(terrain, solids, walker, { x, z });
    pending = null;
    marker.place(terrain, goal.target.x, goal.target.z);
  }
  function endWalk(): void {
    pending = null;
    if (goal === null) return;
    goal = null;
    marker.fade();
  }
  /** A walk that ends on its own shows what it was walking to, if the person got near enough to read it. */
  function finishWalk(): void {
    const to = pending;
    endWalk();
    if (to !== null && Math.hypot(walker.x - to.x, walker.z - to.z) < 14) showCard(to);
  }

  // In the overview a tap picks a region. Walking, a tap on a building, a
  // tree or a sign walks the person up to it and then says what it is, and a
  // tap on the ground walks there.
  onTap(canvas, (e) => {
    const ray = aim(e);
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
    const hits = [
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
    // A tap on a rock or a bush walks up to it, not to the ground hidden behind it.
    const thing = thingHit(ray);
    if (thing !== null && (land === null || thing.distance < land.distance)) setGoal(thing.x, thing.z);
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
    walker.x = x;
    walker.z = z;
    walker.yaw = yaw;
    walker.pitch = pitch;
    walker.eye = stanceAt(terrain, x, z).eye;
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
    walkTo(a.x + Math.cos(yaw) * 5, a.z - Math.sin(yaw) * 5, yaw, -0.06);
  }

  const forward = new THREE.Vector3();
  let walked = 0;
  let bob = 0;
  /** Where the lantern's hand height is measured from: the ground, or while swimming, low enough that the lantern stays above the water. */
  let lanternGround = 0;
  function updateWalk(dt: number): void {
    const fromX = walker.x;
    const fromZ = walker.z;
    const speed = WALK_TO.pace * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 2.4 : 1);
    let f = 0;
    let s = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
    if (keys.has("KeyD")) s += 1;
    if (keys.has("KeyA")) s -= 1;
    if (keys.has("ArrowLeft")) walker.yaw += 1.8 * dt;
    if (keys.has("ArrowRight")) walker.yaw -= 1.8 * dt;
    const sy = Math.sin(walker.yaw);
    const cy = Math.cos(walker.yaw);
    if (f !== 0 || s !== 0) {
      // Water slows the walk and solids turn it aside along their edges.
      const next = walkStep(terrain, solids, walker, { dx: -sy * f + cy * s, dz: -cy * f - sy * s, speed }, dt);
      walker.x = next.x;
      walker.z = next.z;
      walker.moved = true;
    } else if (goal !== null) {
      // The view stays where the person looks; only the feet follow the way.
      const step = walkToward(terrain, solids, walker, goal, dt);
      walker.x = step.walker.x;
      walker.z = step.walker.z;
      goal = step.walk;
      walker.moved = true;
      if (step.state !== "walking") finishWalk();
    }
    // Eyes ride 1.6 m above the ground, easing down to float just above deep water, with a gentle bob there.
    const stance = stanceAt(terrain, walker.x, walker.z);
    bob = (bob + dt / BOB.period) % 1;
    const target = stance.eye + Math.sin(bob * Math.PI * 2) * BOB.height * stance.swim;
    walker.eye += (target - walker.eye) * (1 - Math.exp(-dt * 12));
    const surface = heightAt(terrain.lattice, walker.x, walker.z) + stance.depth;
    lanternGround = stance.depth > 0 ? Math.max(walker.eye - EYE_HEIGHT, surface + LANTERN_ABOVE_WATER - (EYE_HEIGHT - LANTERN.drop)) : walker.eye - EYE_HEIGHT;
    camera.position.set(walker.x, walker.eye, walker.z);
    forward.set(-sy * Math.cos(walker.pitch), Math.sin(walker.pitch), -cy * Math.cos(walker.pitch));
    camera.lookAt(camera.position.clone().add(forward));
    walked = Math.hypot(walker.x - fromX, walker.z - fromZ);
  }

  // ---------- panel ----------

  let selected = 0;
  const fmt = (v: number, d = 1): string => v.toFixed(d);

  /** Takes on a freshly baked world and what stands on it: everything on the land follows. */
  function adopt(next: WorldSpec, baked: Terrain, stood: Stand): void {
    world = next;
    terrain = baked;
    clearings.fit(terrain);
    (grass.mesh.material as THREE.ShaderMaterial).uniforms.uLand!.value = landRadius(terrain);
    settlement.seat(stood.sites);
    ways = { sites: stood.landmarks, trails: stood.trails };
    placeWays();
    // In the codebase's world a landmark stands for an entity and takes its vitality.
    landmarkViews.forEach((v, i) => v.setVitality(code === null ? 1 : (code.world.things.filter((t) => t.as === "landmark")[i]?.vitality ?? 1)));
    placeBuildings();
    updateCovers();
    groundTex.update(terrain, stood.ground);
    ground.update(terrain, stood.wilds);
    water.update(terrain);
    plant(stood);
    endWalk();
    walker.moved = true;
    refreshStats();
    refreshPanel();
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
    adopt(next, baked.terrain, baked.stand);
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
    if (code !== null) {
      // Where you are in the code: the directory whose ground this is, and the file underfoot.
      const place = placeAt(code.world, walker.x, walker.z);
      $("here").textContent = mode === "walk" ? `${place.area.path === "" ? code.world.name : place.area.path} · ${place.file === null ? "common ground" : place.file.name}` : "";
    } else {
      $("here").textContent = mode === "walk" ? `${world.regions[here]?.id ?? ""} · ${landformName(here)} · ${coverName(here)}` : "";
    }
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
  const shadowCenter = new THREE.Vector3();
  const views = (): PlantView[] => [...treeViews, ...settlement.views(), ...landmarkViews, ...(built?.views ?? [])];
  const lanternEye = new THREE.Vector3();
  // The water mirrors the sky, the coarse ground, trees and the cottage, and
  // never grass or the understory: its reflection is soft, so fine detail
  // there is wasted, and the understory keeps back from the water anyway.
  const mirrorHide = [grass.mesh, ground.fine, signs.mesh];
  const mirrorShow = [ground.coarse];
  let frameCalls = 0;
  /** Each pass's draw calls and triangles in the last frame. */
  const passes = { shadow: { calls: 0, triangles: 0 }, mirror: { calls: 0, triangles: 0 }, view: { calls: 0, triangles: 0 } };
  function frame(dt: number, now: number, at: number): void {
    if (at !== hour) applyHour(at);
    light.uTime.value = frozen ?? light.uTime.value + dt;
    if (mode === "walk") {
      updateWalk(dt);
      ground.follow(walker.x, walker.z);
      lantern.follow(camera.position, forward, lanternGround, walked, dt);
      grass.follow(camera.position);
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
    marker.frame(dt, camera.position, light.uNightness.value);
    refreshSight(now);
    // Every pass thins distant detail from where the person's eyes are.
    light.uEye.value.copy(camera.position);
    shadow.render(renderer, scene, [...views(), ...understory.casters()], [sky.mesh, ground.wilds, ground.fine, ground.coarse, grass.mesh, water.group, marker.mesh, signs.mesh, ...understory.quiet()]);
    frameCalls = renderer.info.render.calls;
    passes.shadow = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    const mirrorCalls = water.mirror(renderer, scene, camera, [...mirrorHide, ...understory.quiet(), ...understory.casters().map((c) => c.object)], mirrorShow, dt);
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
    code = on ? await codeWorld() : null;
    for (const v of settlement.views()) scene.remove(v.object);
    settlement = createSettlement(light, code?.buildings ?? SAMPLE_ENTITIES);
    for (const v of settlement.views()) scene.add(v.object);
    skyWorld = code?.sky ?? SKY_WORLD;
    hour = Number.NaN;
    const next = code?.spec ?? sampleWorld(SCALE);
    orbit.maxDistance = Math.max(700, next.size * 1.1);
    selected = 0;
    $("codebase").textContent = on ? "Sample world" : "This codebase";
    ($("random") as HTMLButtonElement).disabled = on;
    if (await rebake(next)) valleyView();
  }

  setMode("walk");
  refreshStats();
  refreshPanel();
  // The first world bakes behind a quiet veil, which lifts once it stands.
  const startWithCode = new URLSearchParams(location.search).get("world") === "code";
  const ready = (startWithCode ? showCodebase(true) : rebake(world).then(() => valleyView())).then(() => {
    $("veil").classList.add("lifted");
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

  return {
    renderer,
    ready,
    report: () => ({
      mode,
      walking: goal !== null || [...keys].some((k) => k !== "ShiftLeft" && k !== "ShiftRight"),
      worldSize: world.size,
      regions: world.regions.length,
      trees: trees.length,
      landmarks: ways.sites.length,
      trails: ways.trails.length,
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
      /** Sets every landmark's vitality, 0 to 1. */
      landmarkVitality: (v: number) => landmarkViews.forEach((view) => view.setVitality(v)),
      /** Each trail: its ends, length, crossings and a point every 10 m. */
      trails: () =>
        ways.trails.map((t) => ({
          id: t.id,
          length: t.length,
          width: t.style.width,
          crossings: t.crossings.map((c) => ({ x: Math.round(c.x), z: Math.round(c.z), span: +c.span.toFixed(1) })),
          points: Array.from({ length: Math.ceil(t.points.length / 20) }, (_, k) => [Math.round(t.points[k * 20] ?? 0), Math.round(t.points[k * 20 + 1] ?? 0)]),
        })),
      /** Every building: what it stands for, where, and its vitality now. */
      buildings: () =>
        settlement.buildings.map((b) => ({ name: b.represented.name, building: b.kindName, ...b.site, width: b.plan.width, depth: b.plan.depth, triangles: b.view.triangles, vitality: b.view.vitality, sign: settlement.signOf(b), stand: settlement.standOf(b) })),
      /** Sets building `i`'s vitality, and its sign's. */
      vitality: (i: number, v: number) => {
        settlement.buildings[i]?.view.setVitality(v);
        signs.setVitality(i, v);
      },
      /** Walks up to subject `i` (buildings first, then trees) and shows its card on arrival. */
      inspect: (i: number) => {
        const s = subjects[i];
        if (s !== undefined) approach(s);
      },
      subjects: () => subjects.map((s) => ({ name: s.represented.name, standsAs: s.standsAs, x: s.x, z: s.z, vitality: s.represented.report.vitality })),
      card: () => (card.shown === null ? null : { name: card.shown.name, what: card.shown.what }),
      closeCard: () => hideCard(),
      walk: (x: number, z: number, yawDeg: number, pitchDeg = -3) => walkTo(x, z, (yawDeg * Math.PI) / 180, (pitchDeg * Math.PI) / 180),
      valley: () => valleyView(),
      walker: () => ({ x: walker.x, z: walker.z, yawDeg: (walker.yaw * 180) / Math.PI, pitchDeg: (walker.pitch * 180) / Math.PI, eye: walker.eye }),
      overview: (pos?: [number, number, number]) => {
        setMode("overview");
        if (pos !== undefined) camera.position.set(...pos);
      },
      select: (i: number) => select(i),
      random: (seed?: number) => randomize(seed),
      showcase,
      freeze: (t: number | null) => (frozen = t),
      regions: () =>
        world.regions.map((r, i) => ({ i, id: r.id, x: Math.round(r.x), z: Math.round(r.z), landform: landformName(i), cover: coverName(i) })),
      streams: () => terrain.streams.map((s) => s.stations.filter((_, k) => k % 10 === 0).map((p) => [Math.round(p.x), Math.round(p.z), +p.level.toFixed(2)])),
      report: () => ({ ...terrain.report, fit: terrain.fit, bakeMs: Math.round(bakeMs) }),
      sight: (x: number, z: number) => {
        const s = sightlines(terrain.lattice, x, z);
        return { max: s.max, median: s.median };
      },
      info: () => renderer.info.render,
      /** Draw calls in the whole last frame (shadow, mirror and view), and the water's mirror. */
      water: () => ({ ...water.stats(), frameCalls }),
      /** Draw calls and triangles of each pass in the last frame: the sun's shadow, the water's mirror and the view. */
      passes: () => structuredClone(passes),
      waterVitality: (v: number) => water.vitality(v),
      understory: () => understory.stats(),
      placements: () => understory.placements(),
      showUnderstory: (on: boolean) => understory.show(on),
      /** Shows or hides the grass, for comparing frame costs and looking at the bare ground. */
      showGrass: (on: boolean) => {
        grass.mesh.visible = on;
      },
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
        walker.eye = stanceAt(terrain, walker.x, walker.z).eye;
        walker.moved = true;
        return { x: walker.x, z: walker.z, depth: waterDepthAt(terrain, walker.x, walker.z) };
      },
      depth: () => waterDepthAt(terrain, walker.x, walker.z),
      /** Where a tap's walk is headed, or null, the corners of its way, and how opaque its ring is now. */
      goal: () => ({ goal: goal === null ? null : { ...goal.target }, way: goal?.way.map((p) => [p.x, p.z]) ?? null, ring: marker.opacity() }),
      /** How far (x, z) is from the nearest solid's edge, at most 2 m; negative inside one. */
      clearance: (x: number, z: number) => clearanceAt(solids, x, z),
      /** The trunks, rocks and bushes and walls that stop a walker. */
      solids: () => solids.count,
      /** The eyes' height, the water's depth and how far the person swims where they stand. */
      stance: () => stanceAt(terrain, walker.x, walker.z),
      /** Where the ground at (x, z) shows on screen, in CSS pixels from the page's top left; null when it is behind the view. */
      onScreen: (x: number, z: number) => {
        const p = new THREE.Vector3(x, heightAt(terrain.lattice, x, z), z).project(camera);
        if (p.z > 1) return null;
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
      },
      ponds: () => terrain.ponds.map((p) => ({ x: p.x, z: p.z, reach: p.reach })),
      plants: () => trees.map((t) => ({ x: t.x, z: t.z, height: (variants[t.variant] as TreeVariant).height * t.scale, region: regionAt(t.x, t.z) })),
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
      /** Where the walker is in the code: the area and file patch underfoot, or null outside the codebase's world. */
      place: (x?: number, z?: number) => (code === null ? null : placeAt(code.world, x ?? walker.x, z ?? walker.z)),
      /** The codebase's world: its size, areas, patches, buildings, landmarks and trails. */
      code: () =>
        code === null
          ? null
          : {
              name: code.world.name,
              size: code.world.size,
              sky: code.sky?.name,
              regions: code.world.regions.map((r) => ({ area: r.area, land: r.land, x: Math.round(r.x), z: Math.round(r.z) })),
              areas: code.world.areas.map((a) => ({ path: a.path, x: Math.round(a.x), z: Math.round(a.z), radius: Math.round(a.radius), depth: a.depth })),
              patches: code.world.patches.length,
              things: code.world.things.map((t) => ({ path: t.path, name: t.name, as: t.as, look: t.look, x: Math.round(t.x), z: Math.round(t.z), vitality: +t.vitality.toFixed(2) })),
              trails: code.world.trails.map((t) => `${t.from}->${t.to}`),
            },
      lantern: () => ({ position: light.uLanternPosition.value.toArray(), intensity: light.uLanternIntensity.value, nightness: light.uNightness.value }),
      camera: () => ({ position: camera.position.toArray(), target: orbit.target.toArray() }),
    },
  };
}
