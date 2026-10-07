// The terrain lab: a full world of regions, each a biome with a landform and
// a ground cover Jev could choose, baked into one heightfield on worker
// threads, so the page never stops drawing while a world bakes. Walk it at eye
// height, tapping or clicking the ground to walk there, or look at the whole of
// it from above; edit any region's biome and watch the budget and the ground change.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type BuildingPlan, type GroundSpec, Library, type SeasonSpec, blueprintOf, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, NO_SHIFT, RELIEF_PRIMITIVES, ROCK_PRIMITIVES, STRUCTURE_PRIMITIVES, WILDFLOWER_PRIMITIVES, WORLD_PRIMITIVES, hex, mixLab } from "@gaia/primitives";
import { biome, flora, structure, world as worldKind } from "@gaia/kinds";
import { defaultParams, validate } from "@gaia/world";
import { FLORA_PRESETS, type Realized, STRUCTURE_PRESETS, WORLD_PRESETS, mergeParts, realize, realizeRegion, realizeSky } from "@gaia/realize";
import { type PlantInstances, applyLight, createLantern, createPlant, createPlantInstances, createRenderer, createSceneLight, createSunShadow } from "@gaia/render";
import {
  type BuildingSite,
  COVER_TAPS,
  DRY,
  EYE_HEIGHT,
  FULL_WORLD,
  SHORE_CAP,
  SMALL_WORLD,
  RELIEF_BUDGET,
  clearingsOf,
  insideFootprint,
  type Terrain,
  type WorldSpec,
  heightAt,
  landRadius,
  latticeOf,
  randomWorld,
  sampleWorld,
  sightlines,
  WALK_TO,
  walkStep,
  walkToward,
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
import { createBaker } from "./baker.ts";
import type { Stand, Tree } from "./bake-worker.ts";

const TEMPLATE = /* html */ `
<main class="stage">
  <canvas class="view" aria-label="A world of gentle landforms. Click or tap the ground to walk there and drag to look, or switch to the overview."></canvas>
  <div class="veil" data-ref="veil" role="status"><span>Baking the world…</span></div>
  <div class="bar top">
    <div class="segmented modes" role="group" aria-label="View">
      <button data-ref="mode-walk" class="seg on" type="button">Walk</button>
      <button data-ref="mode-overview" class="seg" type="button">Overview</button>
    </div>
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
const FOG = { walk: 0.0042, overview: 0.0008 };
/** Each mode's hint, for a mouse and keyboard and for touch. */
const HINTS = {
  walk: ["Click the ground to walk there, drag to look; WASD and Shift work too", "Tap the ground to walk there, drag to look"],
  overview: ["Drag to orbit, scroll to zoom, click a region", "Drag to orbit, pinch to zoom, tap a region"],
};
const MOVE = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);
/** How far a tap's ray looks for the ground, meters. */
const REACH = 900;

/** The full world, or the small one with `?world=small` in the page's address, to compare the two. */
const SCALE = new URLSearchParams(location.search).get("world") === "small" ? SMALL_WORLD : FULL_WORLD;
/** Trees in the world: as dense as the small world's 22 over 320 m. Tune here; each stands as a copy of one of TREE_KINDS realized trees. */
const TREES = Math.round(22 * (SCALE.size / 320) ** 2);
const TREE_KINDS = 22;

interface TreeKind {
  readonly plant: Realized;
  /** Radius of the trunk's bottom ring, for grounding. */
  readonly base: number;
  readonly height: number;
}

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

  // One cottage stands near the stream, on a pad leveled into the bake.
  const cottagePreset = STRUCTURE_PRESETS[0];
  if (cottagePreset === undefined) throw new Error("There are no cottages.");
  const cottageBuilt = realize(cottagePreset.blueprint, structure, new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]), {
    seed: seedOf("terrain-lab/cottage"),
    facts: { size: 1, floors: 1 },
  });
  const cottagePlan = cottageBuilt.slots.get("footprint")?.output as BuildingPlan;
  let site: BuildingSite = { x: 0, z: 0, yaw: 0, level: 0 };

  const canvas = root.querySelector("canvas") as HTMLCanvasElement;
  const stage = root.querySelector(".stage") as HTMLElement;
  const renderer = createRenderer(canvas);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const light = createSceneLight();
  light.uFogDensity.value = FOG.walk;
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
  const cottage = createPlant({ ...cottageBuilt, parts: mergeParts(cottageBuilt.parts) }, light);
  scene.add(cottage.object);
  function placeCottage(): void {
    cottage.object.position.set(site.x, site.level, site.z);
    cottage.object.rotation.y = site.yaw;
    grass.clear(clearingsOf(cottagePlan, site));
  }
  placeCottage();

  /** The hour's light, sky and air, from the sky world's day. */
  let hour = Number.NaN;
  function applyHour(h: number): void {
    hour = h;
    if (SKY_WORLD === undefined) return;
    const look = realizeSky({ blueprint: SKY_WORLD.world, kind: worldKind }, worldLib, seedOf("terrain-lab/sky"), h);
    applyLight(light, look.light);
    sky.apply({ light: look.light, sky: { ...look.sky, mid: mixLab(look.sky.zenith, look.sky.horizon, 0.5) }, fog: { color: look.sky.horizon, density: FOG[mode], mist: 0 } });
  }
  const shadow = createSunShadow(light, 2048);

  // ---------- plants ----------

  const kinds: TreeKind[] = Array.from({ length: TREE_KINDS }, (_, i) => {
    const preset = FLORA_PRESETS[i % FLORA_PRESETS.length] as (typeof FLORA_PRESETS)[number];
    const plant = realize(preset.blueprint, flora, floraLib, {
      seed: seedOf(`terrain-lab/plant-${i}`),
      facts: { scale: 0.85 + ((i * 37) % 10) / 22, age: 120 },
    });
    const bark = plant.parts.find((p) => p.swatch === "bark");
    let base = 0.5;
    let height = 1;
    if (bark !== undefined) {
      for (let k = 0; k < 11; k++) base = Math.max(base, Math.hypot(bark.positions[k * 3] ?? 0, bark.positions[k * 3 + 2] ?? 0));
    }
    for (const part of plant.parts) for (let k = 1; k < part.positions.length; k += 3) height = Math.max(height, part.positions[k] as number);
    return { plant, base, height };
  });
  /** Each kind's copies, placed again with every bake. */
  let trees: readonly Tree[] = [];
  let groves: PlantInstances[] = [];

  // Rocks, bushes and wildflowers, scattered around the trees.
  const understory = createUnderstory(scene, light, new Library([...FLORA_PRIMITIVES, ...ROCK_PRIMITIVES, ...WILDFLOWER_PRIMITIVES]), clearings);

  /** Stands the bake's trees and understory: placed on the bake thread, drawn here. */
  function plant(stood: Stand): void {
    trees = stood.trees;
    for (const g of groves) {
      scene.remove(g.object);
      g.dispose();
    }
    groves = kinds.flatMap((k, i) => {
      const spots = trees.flatMap((t, n) => (t.kind === i ? [{ x: t.x, y: t.y, z: t.z, yaw: n * 1.7, scale: 1 }] : []));
      if (spots.length === 0) return [];
      const grove = createPlantInstances(k.plant, light, spots);
      scene.add(grove.object);
      return [grove];
    });
    understory.place(terrain, world, stood.occupied, stood.placements);
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
  let goal: { x: number; z: number } | null = null;
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
    goal = { x, z };
    marker.place(terrain, x, z);
  }
  function endWalk(): void {
    if (goal === null) return;
    goal = null;
    marker.fade();
  }

  // In the overview a tap picks a region. Walking, a tap on a tree picks the
  // region it grows in, and a tap on the ground walks there.
  onTap(canvas, (e) => {
    const ray = aim(e);
    if (mode === "overview") {
      const hit = groundHit(ray);
      if (hit !== null) select(regionAt(hit.x, hit.z));
      return;
    }
    const land = groundHit(ray);
    const tree = raycaster.intersectObjects(groves.map((g) => g.object), true)[0];
    if (tree !== undefined && (land === null || tree.distance < land.distance)) {
      select(regionAt(tree.point.x, tree.point.z));
      return;
    }
    if (land !== null) setGoal(land.x, land.z);
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
    walker.eye = heightAt(terrain.lattice, x, z) + EYE_HEIGHT;
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
    // The cottage's walls stop the walk; it slides along them.
    const wall = (x: number, z: number): boolean => insideFootprint(cottagePlan, site, x, z, 0.45);
    /** Steps to (x, z), sliding along a wall in the way; returns how far the walker moved. */
    const stepTo = (x: number, z: number): number => {
      const x0 = walker.x;
      const z0 = walker.z;
      if (!wall(x, z)) {
        walker.x = x;
        walker.z = z;
      } else if (!wall(x, walker.z)) walker.x = x;
      else if (!wall(walker.x, z)) walker.z = z;
      return Math.hypot(walker.x - x0, walker.z - z0);
    };
    if (f !== 0 || s !== 0) {
      // Wading slows the walk, and deep water turns it aside along the edge.
      const next = walkStep(terrain, walker, { dx: -sy * f + cy * s, dz: -cy * f - sy * s, speed }, dt);
      stepTo(next.x, next.z);
      walker.moved = true;
    } else if (goal !== null) {
      // The view stays where the person looks; only the feet head for the goal.
      const step = walkToward(terrain, walker, goal, dt);
      const wanted = Math.hypot(step.walker.x - walker.x, step.walker.z - walker.z);
      // A wall that leaves only a crawl along it ends the walk, as deep water does.
      const blocked = stepTo(step.walker.x, step.walker.z) < wanted * 0.25;
      walker.moved = true;
      if (step.state !== "walking" || blocked) endWalk();
    }
    const target = heightAt(terrain.lattice, walker.x, walker.z) + EYE_HEIGHT;
    walker.eye += (target - walker.eye) * (1 - Math.exp(-dt * 12));
    camera.position.set(walker.x, walker.eye, walker.z);
    forward.set(-sy * Math.cos(walker.pitch), Math.sin(walker.pitch), -cy * Math.cos(walker.pitch));
    camera.lookAt(camera.position.clone().add(forward));
    walked = Math.hypot(walker.x - fromX, walker.z - fromZ);
  }

  // ---------- panel ----------

  let selected = 0;
  const fmt = (v: number, d = 1): string => v.toFixed(d);

  /** Takes on a freshly baked world: everything that stands on the land follows it. */
  function adopt(next: WorldSpec, baked: Terrain, stood: Stand): void {
    world = next;
    terrain = baked;
    site = stood.site;
    placeCottage();
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
    const baked = await baker.bake(next, {
      plan: cottagePlan,
      trees: { count: TREES, seed: 9, trunks: kinds.map((k) => k.base) },
      understory: understory.plan(next),
    });
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
    $("here").textContent = mode === "walk" ? `${world.regions[here]?.id ?? ""} · ${landformName(here)} · ${coverName(here)}` : "";
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
  const lanternEye = new THREE.Vector3();
  // The water mirrors the sky, the coarse ground, trees and the cottage, and
  // never grass or the understory: its reflection is soft, so fine detail
  // there is wasted, and the understory keeps back from the water anyway.
  const mirrorHide = [grass.mesh, ground.fine];
  const mirrorShow = [ground.coarse];
  let frameCalls = 0;
  function frame(dt: number, now: number, at: number): void {
    if (at !== hour) applyHour(at);
    light.uTime.value = frozen ?? light.uTime.value + dt;
    if (mode === "walk") {
      updateWalk(dt);
      ground.follow(walker.x, walker.z);
      lantern.follow(camera.position, forward, walker.eye - EYE_HEIGHT, walked, dt);
      grass.follow(camera.position);
      water.wade(walker.x, walker.z, walker.yaw, walked, dt);
      shadowCenter.set(walker.x - Math.sin(walker.yaw) * 18, walker.eye, walker.z - Math.cos(walker.yaw) * 18);
      shadow.frame(shadowCenter, 40);
    } else {
      orbit.update();
      // The lantern waits where the person stood.
      lanternEye.set(walker.x, walker.eye, walker.z);
      lantern.follow(lanternEye, forward, walker.eye - EYE_HEIGHT, 0, dt);
      shadow.frame(shadowCenter.set(0, 0, 0), world.size * 0.62);
    }
    marker.frame(dt, camera.position, light.uNightness.value);
    refreshSight(now);
    shadow.render(renderer, scene, [...groves, cottage, ...understory.casters()], [sky.mesh, ground.wilds, ground.fine, ground.coarse, grass.mesh, water.group, marker.mesh, ...understory.quiet()]);
    frameCalls = renderer.info.render.calls;
    frameCalls += water.mirror(renderer, scene, camera, [...mirrorHide, ...understory.quiet(), ...understory.casters().map((c) => c.object)], mirrorShow, dt);
    renderer.render(scene, camera);
    frameCalls += renderer.info.render.calls;
  }

  setMode("walk");
  refreshStats();
  refreshPanel();
  // The first world bakes behind a quiet veil, which lifts once it stands.
  const ready = rebake(world).then(() => {
    valleyView();
    $("veil").classList.add("lifted");
  });

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
      cottage: () => ({ ...site, triangles: cottage.triangles, width: cottagePlan.width, depth: cottagePlan.depth }),
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
        for (const g of groves) g.object.visible = on;
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
          const next = walkStep(terrain, walker, { dx: -Math.sin(walker.yaw), dz: -Math.cos(walker.yaw), speed: WALK_TO.pace }, 1 / 60);
          walker.x = next.x;
          walker.z = next.z;
        }
        walker.eye = heightAt(terrain.lattice, walker.x, walker.z) + EYE_HEIGHT;
        walker.moved = true;
        return { x: walker.x, z: walker.z, depth: waterDepthAt(terrain, walker.x, walker.z) };
      },
      depth: () => waterDepthAt(terrain, walker.x, walker.z),
      /** Where a tap's walk is headed, or null, and how opaque its ring is now. */
      goal: () => ({ goal: goal === null ? null : { ...goal }, ring: marker.opacity() }),
      /** Where the ground at (x, z) shows on screen, in CSS pixels from the page's top left; null when it is behind the view. */
      onScreen: (x: number, z: number) => {
        const p = new THREE.Vector3(x, heightAt(terrain.lattice, x, z), z).project(camera);
        if (p.z > 1) return null;
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
      },
      ponds: () => terrain.ponds.map((p) => ({ x: p.x, z: p.z, reach: p.reach })),
      plants: () => trees.map((t) => ({ x: t.x, z: t.z, height: (kinds[t.kind] as TreeKind).height, region: regionAt(t.x, t.z) })),
      selected: () => selected,
      lantern: () => ({ position: light.uLanternPosition.value.toArray(), intensity: light.uLanternIntensity.value, nightness: light.uNightness.value }),
      camera: () => ({ position: camera.position.toArray(), target: orbit.target.toArray() }),
    },
  };
}
