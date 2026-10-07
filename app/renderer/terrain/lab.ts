// The terrain lab: a small world of regions, each a biome with a landform and
// a ground cover Jev could choose, baked into one heightfield. Walk it at eye
// height or look at the whole of it from above; edit any region's biome and
// watch the budget and the ground change.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type GroundSpec, Library, type SeasonSpec, blueprintOf, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, NO_SHIFT, RELIEF_PRIMITIVES, hex } from "@gaia/primitives";
import { biome, flora } from "@gaia/kinds";
import { defaultParams, validate } from "@gaia/world";
import { FLORA_PRESETS, realize, realizeRegion } from "@gaia/realize";
import { type PlantView, createPlant, createSceneLight, createSunShadow } from "@gaia/render";
import {
  EYE_HEIGHT,
  RELIEF_BUDGET,
  type Terrain,
  type WorldSpec,
  bakeTerrain,
  groundedBase,
  heightAt,
  randomWorld,
  sampleWorld,
  scatterPlants,
  sightlines,
} from "@gaia/terrain";
import { createSky } from "../flora/environment.ts";
import { renderInspector } from "../inspector.ts";
import { type Lab, type Shot, refs, slug } from "../lab.ts";
import { createGrass, createWater } from "./cover.ts";
import { createGround, createGroundTexture, createMist } from "./ground.ts";
import { createRegionCovers } from "./regions.ts";

const TEMPLATE = /* html */ `
<main class="stage">
  <canvas class="view" aria-label="A small world of gentle landforms. Walk with WASD or the arrow keys and drag to look, or switch to the overview."></canvas>
  <div class="bar top">
    <div class="segmented modes" role="group" aria-label="View">
      <button data-ref="mode-walk" class="seg on" type="button">Walk</button>
      <button data-ref="mode-overview" class="seg" type="button">Overview</button>
    </div>
    <button data-ref="random" class="primary" title="Draw every region's landform, fields and cover uniformly, then fit the budget">Random terrain</button>
  </div>
  <div class="bar bottom">
    <div class="chip stats">
      <div class="budget" data-ref="budget"></div>
      <div class="sight" data-ref="sight"></div>
    </div>
    <div class="chip hintline"><span class="here" data-ref="here"></span><span data-ref="hint"></span></div>
  </div>
</main>
<aside class="panel">
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

/** The terrain lab has no world, so its covers wear no season. */
const NO_SEASON: SeasonSpec = { swatches: {}, ground: NO_SHIFT, frost: 0, fall: hex(0xd9a04a) };
const FOG = { walk: 0.0042, overview: 0.0008 };
const MOVE = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);

interface Planted {
  readonly view: PlantView;
  /** Radius of the trunk's bottom ring, for grounding. */
  readonly base: number;
}

export function createTerrainLab(root: HTMLElement): Lab {
  root.innerHTML = TEMPLATE;
  const $ = refs(root);
  const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
  const floraLib = new Library(FLORA_PRIMITIVES);
  let active = false;

  let world: WorldSpec = sampleWorld();
  const firstBake = performance.now();
  let terrain: Terrain = bakeTerrain(world, lib);
  let bakeMs = performance.now() - firstBake;

  const canvas = root.querySelector("canvas") as HTMLCanvasElement;
  const stage = root.querySelector(".stage") as HTMLElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const light = createSceneLight();
  // A lower sun than the flora lab's, so gentle slopes read in light and shade.
  light.uSunDirection.value.set(0.55, 0.5, 0.35).normalize();
  light.uFogDensity.value = FOG.walk;

  const covers = createRegionCovers();
  const coverOf = (i: number): GroundSpec => {
    const r = world.regions[i];
    if (r === undefined) throw new Error(`No region ${i}.`);
    return realizeRegion({ blueprint: r.biome, kind: biome }, lib, seedOf(r.id), NO_SEASON).ground;
  };
  const updateCovers = (): void => covers.update(world, world.regions.map((_, i) => coverOf(i)));
  updateCovers();

  const scene = new THREE.Scene();
  const sky = createSky(light);
  const groundTex = createGroundTexture(terrain);
  const ground = createGround(terrain, light, covers);
  const grass = createGrass(light, groundTex, covers);
  const water = createWater(terrain, light, groundTex);
  const mist = createMist(terrain, light);
  scene.add(sky, mist.mesh, ground.fine, ground.coarse, grass.mesh, water.group);
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
    scene.add(view.object);
    return { view, base };
  });

  function plant(): void {
    const spots = scatterPlants(terrain, planted.length, 9);
    planted.forEach((p, i) => {
      const s = spots[i];
      p.view.object.visible = s !== undefined;
      if (s === undefined) return;
      p.view.object.position.set(s.x, groundedBase(terrain.lattice, s.x, s.z, p.base), s.z);
    });
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
  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    if (!active || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (MOVE.has(e.code)) {
      keys.add(e.code);
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());

  const drag = { on: false, x: 0, y: 0, startX: 0, startY: 0 };
  canvas.addEventListener("pointerdown", (e) => {
    drag.on = true;
    drag.x = drag.startX = e.clientX;
    drag.y = drag.startY = e.clientY;
    if (mode === "walk") canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag.on || mode !== "walk") return;
    walker.yaw -= (e.clientX - drag.x) * 0.0045;
    walker.pitch = Math.max(-1.1, Math.min(1.1, walker.pitch - (e.clientY - drag.y) * 0.0045));
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  canvas.addEventListener("pointerup", (e) => {
    drag.on = false;
    if (mode !== "overview" || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5) return;
    const rect = canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hit = ray.intersectObject(ground.coarse)[0];
    if (hit !== undefined) select(regionAt(hit.point.x, hit.point.z));
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
    $("hint").textContent = next === "walk" ? "WASD or arrows to walk, Shift to run, drag to look" : "Drag to orbit, scroll to zoom, click a region";
    if (next === "overview") {
      camera.position.set(walker.x * 0.3 + 40, 300, walker.z * 0.3 + 330);
      orbit.target.set(0, 0, 0);
    }
    walker.moved = true;
  }

  function walkTo(x: number, z: number, yaw: number, pitch = -0.05): void {
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
  function updateWalk(dt: number): void {
    const run = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 2.4 : 1;
    const speed = 4.2 * run * dt;
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
      const half = world.size / 2 - 6;
      walker.x = Math.max(-half, Math.min(half, walker.x + (-sy * f + cy * s) * speed));
      walker.z = Math.max(-half, Math.min(half, walker.z + (-cy * f - sy * s) * speed));
      walker.moved = true;
    }
    const target = heightAt(terrain.lattice, walker.x, walker.z) + EYE_HEIGHT;
    walker.eye += (target - walker.eye) * (1 - Math.exp(-dt * 12));
    camera.position.set(walker.x, walker.eye, walker.z);
    forward.set(-sy * Math.cos(walker.pitch), Math.sin(walker.pitch), -cy * Math.cos(walker.pitch));
    camera.lookAt(camera.position.clone().add(forward));
  }

  // ---------- panel ----------

  let selected = 0;
  const fmt = (v: number, d = 1): string => v.toFixed(d);

  function rebake(): void {
    const t0 = performance.now();
    terrain = bakeTerrain(world, lib);
    bakeMs = performance.now() - t0;
    updateCovers();
    groundTex.update(terrain);
    ground.update(terrain);
    water.update(terrain);
    mist.update(terrain);
    plant();
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
  const views = planted.map((p) => p.view);
  function frame(dt: number, now: number): void {
    light.uTime.value = frozen ?? light.uTime.value + dt;
    if (mode === "walk") {
      updateWalk(dt);
      grass.follow(camera.position);
      shadowCenter.set(walker.x - Math.sin(walker.yaw) * 18, walker.eye, walker.z - Math.cos(walker.yaw) * 18);
      shadow.frame(shadowCenter, 40);
    } else {
      orbit.update();
      shadow.frame(shadowCenter.set(0, 0, 0), world.size * 0.62);
    }
    refreshSight(now);
    shadow.render(renderer, scene, views, [sky, mist.mesh, ground.fine, ground.coarse, grass.mesh, water.group]);
    renderer.render(scene, camera);
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
    setActive(on) {
      active = on;
      orbit.enabled = on && mode === "overview";
      if (!on) keys.clear();
      if (on) resize();
    },
    frame: (dt, now) => {
      if (active) frame(dt, now);
    },
    shots: (): Shot[] => RELIEF_PRIMITIVES.map((p) => ({ name: `terrain-${slug(p.id)}`, stage: () => showcase(p.id) })),
    hook: {
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
    },
  };
}
