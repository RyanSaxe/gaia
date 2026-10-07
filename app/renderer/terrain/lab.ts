// The terrain lab: a small world of regions, each a biome with a landform and
// a ground cover Jev could choose, baked into one heightfield. Walk it at eye
// height, tapping or clicking the ground to walk there, or look at the whole of
// it from above; edit any region's biome and watch the budget and the ground change.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type BuildingPlan, type GroundSpec, Library, type RouteSpec, type SeasonSpec, blueprintOf, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, LANDMARK_PRIMITIVES, NO_SHIFT, ROUTE_PRIMITIVES, RELIEF_PRIMITIVES, ROCK_PRIMITIVES, STRUCTURE_PRIMITIVES, WILDFLOWER_PRIMITIVES, WORLD_PRIMITIVES, hex, mixLab } from "@gaia/primitives";
import { biome, flora, landmark, link, structure, world as worldKind } from "@gaia/kinds";
import { defaultParams, validate } from "@gaia/world";
import { FLORA_PRESETS, LANDMARK_PRESETS, STRUCTURE_PRESETS, TRAIL_PRESETS, WORLD_PRESETS, buildSlots, mergeParts, realize, realizeRegion, realizeSky } from "@gaia/realize";
import { LANTERN, type PlantView, applyLight, createLantern, createPlant, createRenderer, createSceneLight, createSunShadow } from "@gaia/render";
import {
  type BuildingSite,
  EYE_HEIGHT,
  type LandmarkSite,
  type Occupied,
  type Trail,
  type TrailEnd,
  type TrailRequest,
  findLandmarkSite,
  levelTrails,
  planTrails,
  trailDiscs,
  trailField,
  NO_SOLIDS,
  RELIEF_BUDGET,
  type SolidShape,
  type Solids,
  clearanceAt,
  clearingsOf,
  findSite,
  insideFootprint,
  levelPad,
  outlineShape,
  planWalk,
  type Terrain,
  type Walk,
  type WorldSpec,
  bakeTerrain,
  groundedBase,
  heightAt,
  landRadius,
  randomWorld,
  sampleWorld,
  scatterPlants,
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

const TEMPLATE = /* html */ `
<main class="stage">
  <canvas class="view" aria-label="A small world of gentle landforms. Click or tap the ground to walk there and drag to look, or switch to the overview."></canvas>
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
/** How much of each understory component's outline at the ground stops a walker: all of a rock, and a bush's heart, so the walk brushes its outer leaves. */
const STOPS: Readonly<Record<string, number>> = { rocks: 1, shrubs: 0.7 };
/** A stone whose top stands lower than this above the ground is stepped over, not walked around, meters. */
const STEP_OVER = 0.5;
/** A swimmer's gentle bob: meters up and down, and seconds per bob. */
const BOB = { height: 0.03, period: 2.8 };
/** While swimming, the lantern is held at least this far above the water, meters. */
const LANTERN_ABOVE_WATER = 0.15;

interface Planted {
  readonly view: PlantView;
  /** Radius of the trunk's bottom ring, for grounding. */
  readonly base: number;
  /** The trunk's own radius at its base: what stops a walker. */
  readonly trunk: number;
}

export function createTerrainLab(root: HTMLElement): Lab {
  root.innerHTML = TEMPLATE;
  const $ = refs(root);
  const sheet = createSheet($("panel"));
  const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
  const floraLib = new Library(FLORA_PRIMITIVES);
  let active = false;

  let world: WorldSpec = sampleWorld();
  const firstBake = performance.now();
  let terrain: Terrain = bakeTerrain(world, lib);
  let bakeMs = performance.now() - firstBake;

  // One cottage stands near the stream, on a pad leveled into the bake.
  const cottagePreset = STRUCTURE_PRESETS[0];
  if (cottagePreset === undefined) throw new Error("There are no cottages.");
  const cottageBuilt = realize(cottagePreset.blueprint, structure, new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]), {
    seed: seedOf("terrain-lab/cottage"),
    facts: { size: 1, floors: 1 },
  });
  const cottagePlan = cottageBuilt.slots.get("footprint")?.output as BuildingPlan;
  const settle = (t: Terrain): BuildingSite => {
    const s = findSite(t, cottagePlan);
    levelPad(t, cottagePlan, s);
    return s;
  };
  let site = settle(terrain);

  // ---------- landmarks and trails ----------
  // A few landmarks stand on the most prominent ground of regions spread
  // across the world, and trails tie them and the cottage together. Counts
  // follow the world's size and region count, so the same rules fill a
  // 320 m world or a kilometer.
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
  interface Settled {
    readonly sites: { readonly landmark: number; readonly site: LandmarkSite }[];
    readonly trails: Trail[];
  }
  const door = (s: BuildingSite): TrailEnd => {
    const d = cottagePlan.openings.find((o) => o.kind === "door");
    const [x, z] = siteToWorld(s, d?.position[0] ?? 0, (d?.position[2] ?? cottagePlan.depth / 2) + 5.6);
    return { id: "cottage", x, z };
  };
  function settleWays(t: Terrain, home: BuildingSite): Settled {
    const regions = t.spec.regions;
    const want = Math.min(regions.length, landmarks.length, Math.max(2, Math.round(Math.sqrt(regions.length) * 1.4)));
    const spacing = t.spec.size * 0.24;
    const home_: Occupied = { x: home.x, z: home.z, radius: Math.hypot(cottagePlan.width, cottagePlan.depth) / 2 + 22 };
    // Regions spread apart: farthest first from the cottage, then from every landmark placed.
    const sites: Settled["sites"][number][] = [];
    const avoid: Occupied[] = [home_];
    const taken = new Set<number>();
    while (sites.length < want && taken.size < regions.length) {
      let pick = -1;
      let far = -1;
      regions.forEach((r, i) => {
        if (taken.has(i)) return;
        const d = Math.min(Math.hypot(r.x - home.x, r.z - home.z), ...sites.map((s) => Math.hypot(r.x - s.site.x, r.z - s.site.z)));
        if (d > far) {
          far = d;
          pick = i;
        }
      });
      taken.add(pick);
      const k = sites.length;
      const lm = landmarks[k];
      if (lm === undefined) break;
      const site = findLandmarkSite(t, pick, lm.base + 1.5, avoid);
      if (site === null) continue;
      sites.push({ landmark: k, site });
      avoid.push({ x: site.x, z: site.z, radius: spacing });
    }
    // The places to tie together, and the trails Jev would want between them:
    // a spanning tree by distance (most wanted), then a loop or two (less).
    const places: TrailEnd[] = [door(home), ...sites.map((s) => ({ id: landmarks[s.landmark]?.name ?? "", x: s.site.x, z: s.site.z }))];
    const foot = (p: TrailEnd, toward: TrailEnd, i: number): TrailEnd => {
      if (i === 0) return p;
      const lm = landmarks[sites[i - 1]?.landmark ?? 0];
      const d = Math.hypot(toward.x - p.x, toward.z - p.z) || 1;
      const r = (lm?.base ?? 2) + 1.8;
      return { id: p.id, x: p.x + ((toward.x - p.x) / d) * r, z: p.z + ((toward.z - p.z) / d) * r };
    };
    const edges: [number, number, number][] = [];
    for (let a = 0; a < places.length; a++) for (let b = a + 1; b < places.length; b++) edges.push([a, b, Math.hypot(places[a]!.x - places[b]!.x, places[a]!.z - places[b]!.z)]);
    edges.sort((p, q) => p[2] - q[2]);
    const group = places.map((_, i) => i);
    const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i] as number)));
    const requests: TrailRequest[] = [];
    let loops = 0;
    for (const [a, b] of edges) {
      const joined = root(a) !== root(b);
      if (!joined && loops >= Math.floor(places.length / 3)) continue;
      if (joined) group[root(a)] = root(b);
      else loops++;
      const pa = places[a] as TrailEnd;
      const pb = places[b] as TrailEnd;
      const style = (joined ? (a === 0 ? trailStyles[1] : trailStyles[0]) : trailStyles[2]) as RouteSpec;
      requests.push({ id: `${pa.id}->${pb.id}`, from: foot(pa, pb, a), to: foot(pb, pa, b), style, want: joined ? 0.9 - requests.length * 0.02 : 0.45 });
    }
    const keepOut: Occupied[] = [
      { x: home.x, z: home.z, radius: Math.hypot(cottagePlan.width, cottagePlan.depth) / 2 + 0.6 },
      ...sites.map((s) => ({ x: s.site.x, z: s.site.z, radius: (landmarks[s.landmark]?.base ?? 2) + 0.8 })),
    ];
    const trails = planTrails(t, requests, 41, keepOut);
    levelTrails(t, trails);
    return { sites, trails };
  }
  let ways = settleWays(terrain, site);

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
  const landmarkViews = landmarks.map((lm) => {
    const view = createPlant({ ...lm.built, parts: mergeParts(lm.built.parts) }, light);
    scene.add(view.object);
    return view;
  });
  let built: Ways | null = null;
  /** Stands each landmark on its site, paints and parts the trails, and builds their crossings. */
  function placeWays(): void {
    landmarkViews.forEach((view, k) => {
      const s = ways.sites.find((w) => w.landmark === k);
      view.object.visible = s !== undefined;
      if (s !== undefined) {
        view.object.position.set(s.site.x, s.site.y - 0.05, s.site.z);
        // The door faces where its first trail arrives, or the cottage.
        const near = ways.trails.flatMap((t) => [[t.points[0], t.points[1]], [t.points[t.points.length - 2], t.points[t.points.length - 1]]]).find(([x, z]) => Math.hypot((x ?? 0) - s.site.x, (z ?? 0) - s.site.z) < 14);
        const [fx, fz] = near ?? [site.x, site.z];
        view.object.rotation.y = Math.atan2((fx ?? 0) - s.site.x, (fz ?? 0) - s.site.z);
      }
    });
    const field = trailField(terrain, ways.trails);
    groundTex.setTrails(field);
    ground.setTrails(field);
    trailWear.value = ways.trails.length === 0 ? 0 : ways.trails.reduce((n, t) => n + t.style.wear, 0) / ways.trails.length;
    built?.dispose();
    built = createWays(scene, light, landmarkLib, terrain, ways.trails);
  }
  placeWays();
  const cottage = createPlant({ ...cottageBuilt, parts: mergeParts(cottageBuilt.parts) }, light);
  scene.add(cottage.object);
  function placeCottage(): void {
    cottage.object.position.set(site.x, site.level, site.z);
    cottage.object.rotation.y = site.yaw;
    // No grass inside a landmark's footprint: a hollow tower or a great trunk.
    const feet = ways.sites.map((s) => {
      const r = Math.min(landmarks[s.landmark]?.base ?? 2, 4);
      return { ax: s.site.x, az: s.site.z, bx: s.site.x + 0.01, bz: s.site.z, radius: r };
    });
    grass.clear([...clearingsOf(cottagePlan, site), ...feet]);
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

  const planted: Planted[] = Array.from({ length: 22 }, (_, i) => {
    const preset = FLORA_PRESETS[i % FLORA_PRESETS.length] as (typeof FLORA_PRESETS)[number];
    const plant = realize(preset.blueprint, flora, floraLib, {
      seed: seedOf(`terrain-lab/plant-${i}`),
      facts: { scale: 0.85 + ((i * 37) % 10) / 22, age: 120 },
    });
    const bark = plant.parts.find((p) => p.swatch === "bark");
    let trunk = 0;
    if (bark !== undefined) {
      for (let k = 0; k < 11; k++) trunk = Math.max(trunk, Math.hypot(bark.positions[k * 3] ?? 0, bark.positions[k * 3 + 2] ?? 0));
    }
    const view = createPlant(plant, light);
    view.object.rotation.y = i * 1.7;
    scene.add(view.object);
    return { view, base: Math.max(0.5, trunk), trunk };
  });

  // Rocks, bushes and wildflowers, scattered around the trees.
  const understory = createUnderstory(scene, light, new Library([...FLORA_PRIMITIVES, ...ROCK_PRIMITIVES, ...WILDFLOWER_PRIMITIVES]), clearings);

  function plant(): void {
    const spots = scatterPlants(terrain, planted.length, 9);
    // Trees keep off the trails and out from under a landmark.
    const clear: Occupied[] = [
      ...trailDiscs(ways.trails, 1.6),
      ...ways.sites.map((s) => ({ x: s.site.x, z: s.site.z, radius: (landmarks[s.landmark]?.base ?? 2) + (landmarks[s.landmark]?.name.startsWith("Great") ? 12 : 5) })),
    ];
    planted.forEach((p, i) => {
      const s = spots[i];
      p.view.object.visible = s !== undefined && !insideFootprint(cottagePlan, site, s.x, s.z, 6) && !clear.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < o.radius);
      if (s === undefined) return;
      p.view.object.position.set(s.x, groundedBase(terrain.lattice, s.x, s.z, p.base), s.z);
    });
    const trees = planted.flatMap((p) => (p.view.object.visible ? [{ x: p.view.object.position.x, z: p.view.object.position.z, radius: 1.6 }] : []));
    // Nothing of the understory stands in the cottage or on its walk: discs a meter apart along each cleared capsule.
    const cottageGround = clearingsOf(cottagePlan, site).flatMap((c) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(c.bx - c.ax, c.bz - c.az)));
      return Array.from({ length: steps + 1 }, (_, k) => ({ x: c.ax + ((c.bx - c.ax) * k) / steps, z: c.az + ((c.bz - c.az) * k) / steps, radius: c.radius + 0.5 }));
    });
    const ways_ = [...trailDiscs(ways.trails, 0.5), ...ways.sites.map((s) => ({ x: s.site.x, z: s.site.z, radius: (landmarks[s.landmark]?.base ?? 2) + 1 }))];
    understory.place(terrain, world, [...trees, ...cottageGround, ...ways_]);
    // What stops a walker: each trunk at its base, the rocks and bushes by their outlines at the ground, and the cottage's walls.
    const trunks: SolidShape[] = planted.flatMap((p) => (p.view.object.visible && p.trunk > 0 ? [{ x: p.view.object.position.x, z: p.view.object.position.z, radius: p.trunk }] : []));
    const components = understory.placements().flatMap((p): SolidShape[] => {
      const share = STOPS[p.rule];
      const foot = understory.footprint(p.rule, p.variant);
      if (share === undefined || foot === undefined || p.y + foot.top * p.scale - heightAt(terrain.lattice, p.x, p.z) < STEP_OVER) return [];
      return [outlineShape(p.x, p.z, p.yaw, p.scale, foot.outline, share)];
    });
    solids = solidsOf([...trunks, ...components, wallsShape(cottagePlan, site)]);
  }
  let solids: Solids = NO_SOLIDS;
  plant();

  // ---------- camera, walking and the overview ----------

  const camera = new THREE.PerspectiveCamera(58, 1, 0.2, 4500);
  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.maxPolarAngle = Math.PI * 0.42;
  orbit.minDistance = 60;
  orbit.maxDistance = 700;
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
    for (let s = step; s < REACH; s += step) {
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
    marker.place(terrain, goal.target.x, goal.target.z);
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
      const hit = raycaster.intersectObject(ground.coarse)[0];
      if (hit !== undefined) select(regionAt(hit.point.x, hit.point.z));
      return;
    }
    const land = groundHit(ray);
    const plants = planted.map((p) => p.view.object).filter((o) => o.visible);
    const tree = raycaster.intersectObjects(plants, true)[0];
    if (tree !== undefined && (land === null || tree.distance < land.distance)) {
      const root = plants.find((o) => o.getObjectById(tree.object.id) !== undefined);
      if (root !== undefined) select(regionAt(root.position.x, root.position.z));
      return;
    }
    // A tap on a rock or a bush walks up to the face that was tapped, not to the ground hidden behind it.
    const thing = raycaster.intersectObjects(understory.casters().map((c) => c.object), true)[0];
    if (thing !== undefined && (land === null || thing.distance < land.distance)) setGoal(thing.point.x, thing.point.z);
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
      if (step.state !== "walking") endWalk();
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

  function rebake(): void {
    const t0 = performance.now();
    terrain = bakeTerrain(world, lib);
    site = settle(terrain);
    ways = settleWays(terrain, site);
    bakeMs = performance.now() - t0;
    placeWays();
    placeCottage();
    updateCovers();
    groundTex.update(terrain);
    ground.update(terrain);
    water.update(terrain);
    plant();
    endWalk();
    walker.moved = true;
    refreshStats();
    refreshPanel();
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
        world = { ...world, regions: world.regions.map((r, i) => (i === selected ? { ...r, biome: next } : r)) };
        // Only a new landform needs a new bake; a new cover only recolors.
        if (reshaped) {
          rebake();
        } else {
          updateCovers();
          refreshPanel();
          walker.moved = true;
        }
      },
    });
  }

  let draws = 0;
  function randomize(seed?: number): void {
    draws += 1;
    world = randomWorld(lib, seed ?? Math.floor(Math.random() * 2 ** 31));
    selected = 0;
    rebake();
    ground.select(selected, mode === "overview");
    if (mode === "walk") {
      const r = world.regions[0];
      if (r !== undefined) walkTo(r.x, r.z, Math.atan2(r.x, r.z));
    }
    $("draw").textContent = `Draw ${draws}: ${world.regions.length} regions, fit ${fmt(terrain.fit * 100, 0)}%`;
  }

  $("random").addEventListener("click", () => randomize());
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
  const views = (): PlantView[] => [...planted.map((p) => p.view), cottage, ...landmarkViews, ...(built?.views ?? [])];
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
    shadow.render(renderer, scene, [...views(), ...understory.casters()], [sky.mesh, ground.wilds, ground.fine, ground.coarse, grass.mesh, water.group, marker.mesh, ...understory.quiet()]);
    frameCalls = renderer.info.render.calls;
    frameCalls += water.mirror(renderer, scene, camera, [...mirrorHide, ...understory.quiet(), ...understory.casters().map((c) => c.object)], mirrorShow, dt);
    renderer.render(scene, camera);
    frameCalls += renderer.info.render.calls;
  }

  setMode("walk");
  valleyView();
  refreshStats();
  refreshPanel();

  // ---------- shots: each relief primitive under every region, from above ----------

  function showcase(reliefId: string): void {
    const p = lib.get(reliefId);
    const sample = sampleWorld();
    world = {
      ...sample,
      regions: sample.regions.map((r) => ({ ...r, biome: blueprintOf(biome.id, { ...r.biome.slots, relief: { use: p.id, params: defaultParams(p) } }) })),
    };
    selected = 0;
    rebake();
    walker.x = 0;
    walker.z = 0;
    setMode("overview");
    frozen = 8;
  }

  return {
    renderer,
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
      /** Each standing landmark: its name, site, height and triangles. */
      landmarks: () =>
        ways.sites.map((s) => ({ name: landmarks[s.landmark]?.name, ...s.site, height: landmarkViews[s.landmark]?.height, triangles: landmarkViews[s.landmark]?.triangles })),
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
      plants: () => planted.filter((p) => p.view.object.visible).map((p) => ({ x: p.view.object.position.x, z: p.view.object.position.z, height: p.view.height, region: regionAt(p.view.object.position.x, p.view.object.position.z) })),
      selected: () => selected,
      lantern: () => ({ position: light.uLanternPosition.value.toArray(), intensity: light.uLanternIntensity.value, nightness: light.uNightness.value }),
      camera: () => ({ position: camera.position.toArray(), target: orbit.target.toArray() }),
    },
  };
}
