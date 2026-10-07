// The terrain lab: a small world of regions, each a biome with a landform and
// a ground cover Jev could choose, baked into one heightfield. Walk it at eye
// height, tapping or clicking the ground to walk there, or look at the whole of
// it from above; edit any region's biome and watch the budget and the ground change.
// Buildings stand for sample entities and trees for sample files; tapping one
// walks the person up to it and then opens a card saying what it stands for.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type GroundSpec, Library, type SeasonSpec, blueprintOf, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, NO_SHIFT, RELIEF_PRIMITIVES, ROCK_PRIMITIVES, WILDFLOWER_PRIMITIVES, WORLD_PRIMITIVES, hex, mixLab } from "@gaia/primitives";
import { biome, flora, world as worldKind } from "@gaia/kinds";
import { defaultParams, validate } from "@gaia/world";
import { FLORA_PRESETS, WORLD_PRESETS, realize, realizeRegion, realizeSky } from "@gaia/realize";
import { type PlantView, applyLight, createLantern, createPlant, createRenderer, createSceneLight, createSunShadow } from "@gaia/render";
import {
  EYE_HEIGHT,
  RELIEF_BUDGET,
  type Terrain,
  type WorldSpec,
  bakeTerrain,
  groundedBase,
  heightAt,
  landRadius,
  randomWorld,
  sampleWorld,
  scatterPlants,
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
import { createCard } from "./card.ts";
import { type Represented, SAMPLE_FILES, representFile } from "./samples.ts";
import { createSettlement } from "./settlement.ts";
import { createSigns } from "./signs.ts";

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
const FOG = { walk: 0.0042, overview: 0.0008 };
/** Each mode's hint, for a mouse and keyboard and for touch. */
const HINTS = {
  walk: ["Click the ground to walk there, drag to look; WASD and Shift work too", "Tap the ground to walk there, drag to look"],
  overview: ["Drag to orbit, scroll to zoom, click a region", "Drag to orbit, pinch to zoom, tap a region"],
};
const MOVE = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);
/** How far a tap's ray looks for the ground, meters. */
const REACH = 900;

interface Planted {
  readonly view: PlantView;
  /** Radius of the trunk's bottom ring, for grounding. */
  readonly base: number;
  /** The file it stands for. */
  readonly represented: Represented;
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

  const canvas = root.querySelector("canvas") as HTMLCanvasElement;
  const stage = root.querySelector(".stage") as HTMLElement;
  const renderer = createRenderer(canvas);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const light = createSceneLight();
  light.uFogDensity.value = FOG.walk;
  // A building for each sample entity, near the stream, each on a pad leveled into the bake.
  const settlement = createSettlement(light);
  settlement.settle(terrain);
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
  const ground = createGround(terrain, light, covers);
  const clearings = createClearings(terrain);
  const grass = createGrass(light, groundTex, covers, landRadius(terrain), clearings);
  const water = createWater(terrain, light, groundTex);
  const marker = createWalkMarker();
  scene.add(sky.mesh, ground.wilds, ground.fine, ground.coarse, grass.mesh, water.group, marker.mesh);
  for (const v of settlement.views()) scene.add(v.object);
  const placeBuildings = (): void => grass.clear(settlement.clearings());
  placeBuildings();
  const signs = createSigns(light);
  scene.add(signs.mesh);

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
    let base = 0.5;
    if (bark !== undefined) {
      for (let k = 0; k < 11; k++) base = Math.max(base, Math.hypot(bark.positions[k * 3] ?? 0, bark.positions[k * 3 + 2] ?? 0));
    }
    const view = createPlant(plant, light);
    view.object.rotation.y = i * 1.7;
    const represented = representFile(SAMPLE_FILES[i % SAMPLE_FILES.length] as (typeof SAMPLE_FILES)[number]);
    view.setVitality(represented.report.vitality);
    scene.add(view.object);
    return { view, base, represented };
  });

  // Rocks, bushes and wildflowers, scattered around the trees.
  const understory = createUnderstory(scene, light, new Library([...FLORA_PRIMITIVES, ...ROCK_PRIMITIVES, ...WILDFLOWER_PRIMITIVES]), clearings);

  function plant(): void {
    const spots = scatterPlants(terrain, planted.length, 9);
    planted.forEach((p, i) => {
      const s = spots[i];
      p.view.object.visible = s !== undefined && !settlement.blocked(s.x, s.z, 6);
      if (s === undefined) return;
      p.view.object.position.set(s.x, groundedBase(terrain.lattice, s.x, s.z, p.base), s.z);
    });
    const trees = planted.flatMap((p) => (p.view.object.visible ? [{ x: p.view.object.position.x, z: p.view.object.position.z, radius: 1.6 }] : []));
    // Nothing of the understory stands in a building or on its walk: discs a meter apart along each cleared capsule.
    const cottageGround = settlement.clearings().flatMap((c) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(c.bx - c.ax, c.bz - c.az)));
      return Array.from({ length: steps + 1 }, (_, k) => ({ x: c.ax + ((c.bx - c.ax) * k) / steps, z: c.az + ((c.bz - c.az) * k) / steps, radius: c.radius + 0.5 }));
    });
    understory.place(terrain, world, [...trees, ...cottageGround]);
    placeSigns();
  }

  // ---------- signs, and walking up to see what a thing is ----------

  let subjects: Subject[] = [];
  /** A building's signboard at the end of its walk, and a plaque at the foot of each tree facing the middle of the world. */
  function placeSigns(): void {
    const buildingSubjects: Subject[] = settlement.buildings.map((b) => ({
      represented: b.represented,
      standsAs: `A ${b.kindName.toLowerCase()}`,
      x: b.site.x,
      z: b.site.z,
      stand: () => settlement.standOf(b),
    }));
    const trees = planted.filter((p) => p.view.object.visible);
    const treeSubjects: Subject[] = trees.map((p) => {
      const { x, z } = p.view.object.position;
      return {
        represented: p.represented,
        standsAs: "A tree",
        x,
        z,
        // Stop just outside the crown, so the tree and its plaque are in view, not its leaves.
        stand: (fx: number, fz: number) => {
          const d = Math.hypot(fx - x, fz - z) || 1;
          const off = Math.max(3, p.view.radius * 0.9 + 1.4);
          return { x: x + ((fx - x) / d) * off, z: z + ((fz - z) / d) * off };
        },
      };
    });
    subjects = [...buildingSubjects, ...treeSubjects];
    signs.set([
      ...settlement.buildings.map((b) => {
        const at = settlement.signOf(b);
        return { ...at, y: heightAt(terrain.lattice, at.x, at.z), scale: 1, name: b.represented.name, note: b.represented.what, vitality: b.represented.report.vitality };
      }),
      ...trees.map((p) => {
        const { x, z } = p.view.object.position;
        const d = Math.hypot(x, z) || 1;
        const px = x - (x / d) * (p.base + 0.75);
        const pz = z - (z / d) * (p.base + 0.75);
        return { x: px, y: heightAt(terrain.lattice, px, pz) - 0.05, z: pz, yaw: Math.atan2(-x, -z), scale: 0.42, name: p.represented.name, note: "", vitality: p.represented.report.vitality };
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
    goal = { x, z };
    pending = null;
    marker.place(terrain, x, z);
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
      const hit = raycaster.intersectObject(ground.coarse)[0];
      if (hit !== undefined) select(regionAt(hit.point.x, hit.point.z));
      return;
    }
    const land = groundHit(ray);
    const things = [...settlement.views().map((v) => v.object), ...planted.map((p) => p.view.object).filter((o) => o.visible)];
    const thing = raycaster.intersectObjects(things, true)[0];
    const sign = raycaster.intersectObject(signs.mesh)[0];
    const nearest = [thing, sign].filter((h) => h !== undefined).sort((a, b) => a.distance - b.distance)[0];
    if (nearest !== undefined && (land === null || nearest.distance < land.distance + 0.5)) {
      let subject: Subject | undefined;
      if (nearest === sign) subject = subjects[sign.instanceId ?? -1];
      else {
        const root = things.find((o) => o.getObjectById(nearest.object.id) !== undefined);
        subject = root === undefined ? undefined : subjects.find((s) => Math.abs(s.x - root.position.x) < 0.01 && Math.abs(s.z - root.position.z) < 0.01);
      }
      if (subject !== undefined) {
        approach(subject);
        return;
      }
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
    // Buildings' walls and features stop the walk; it slides along them.
    const wall = (x: number, z: number): boolean => settlement.blocked(x, z, 0.45);
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
      if (step.state !== "walking" || blocked) finishWalk();
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

  function rebake(): void {
    const t0 = performance.now();
    terrain = bakeTerrain(world, lib);
    settlement.settle(terrain);
    bakeMs = performance.now() - t0;
    placeBuildings();
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
  const views = [...planted.map((p) => p.view), ...settlement.views()];
  const lanternEye = new THREE.Vector3();
  // The water mirrors the sky, the coarse ground, trees and the cottage, and
  // never grass or the understory: its reflection is soft, so fine detail
  // there is wasted, and the understory keeps back from the water anyway.
  const mirrorHide = [grass.mesh, ground.fine, signs.mesh];
  const mirrorShow = [ground.coarse];
  let frameCalls = 0;
  function frame(dt: number, now: number, at: number): void {
    if (at !== hour) applyHour(at);
    light.uTime.value = frozen ?? light.uTime.value + dt;
    if (mode === "walk") {
      updateWalk(dt);
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
    shadow.render(renderer, scene, [...views, ...understory.casters()], [sky.mesh, ground.wilds, ground.fine, ground.coarse, grass.mesh, water.group, marker.mesh, signs.mesh, ...understory.quiet()]);
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
      cottage: () => {
        const b = settlement.buildings[0];
        return b === undefined ? null : { ...b.site, triangles: b.view.triangles, width: b.plan.width, depth: b.plan.depth };
      },
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
      plants: () => planted.filter((p) => p.view.object.visible).map((p) => ({ x: p.view.object.position.x, z: p.view.object.position.z, height: p.view.height, region: regionAt(p.view.object.position.x, p.view.object.position.z) })),
      selected: () => selected,
      lantern: () => ({ position: light.uLanternPosition.value.toArray(), intensity: light.uLanternIntensity.value, nightness: light.uNightness.value }),
      camera: () => ({ position: camera.position.toArray(), target: orbit.target.toArray() }),
    },
  };
}
