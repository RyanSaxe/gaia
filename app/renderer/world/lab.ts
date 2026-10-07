// The world lab: the flora lab's four preset trees under different worlds.
// The world is a blueprint of the `world` kind (light, sky, season, wind);
// its inspector is generated from the kind's declarations, exactly like a
// component's. The ground, air and accents under the trees come from the
// named world's biome.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type Blueprint, Library, blueprintOf, rand, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, RELIEF_PRIMITIVES, WORLD_PRIMITIVES, seasonPalette } from "@gaia/primitives";
import { biome, flora, world as worldKind } from "@gaia/kinds";
import { blueprintCount, randomSlots, validate } from "@gaia/world";
import { FLORA_PRESETS, WORLD_PRESETS, type WorldLook, realize, realizeWorld } from "@gaia/realize";
import { type PlantView, applyLight, createLantern, createPlant, createSceneLight, createSunShadow } from "@gaia/render";
import { renderInspector } from "../inspector.ts";
import { type Lab, type Shot, refs, slug } from "../lab.ts";
import { createDrift, createGround, createGroundCover, createSky } from "./environment.ts";

const TEMPLATE = /* html */ `
<main class="stage">
  <canvas class="view" aria-label="Four trees in a world. Drag to orbit, click a tree to set its vitality."></canvas>
  <div class="bar top">
    <span></span>
    <button data-ref="random" class="primary" title="Sample every world field uniformly and validate the result">Random world</button>
  </div>
  <div class="bar bottom">
    <label class="chip range grow"><span>All plants</span><input data-ref="all" type="range" min="0" max="1" step="0.01" value="1"><output data-ref="all-out">1.00</output></label>
    <button data-ref="overview">Show all</button>
  </div>
</main>
<aside class="panel">
  <header>
    <select class="preset" data-ref="preset" aria-label="World"></select>
    <div class="bp-id" data-ref="bp-id"></div>
    <div class="world-space" data-ref="space"></div>
    <div class="problems" data-ref="problems"></div>
    <div class="plant-row empty" data-ref="plant-row">
      <div class="plant-name" data-ref="plant-name">Click a tree</div>
      <div class="range"><input data-ref="vitality" type="range" min="0" max="1" step="0.01" value="1" aria-label="Vitality of the selected tree" disabled><output data-ref="vitality-out">1.00</output></div>
    </div>
  </header>
  <div class="scroll">
    <div data-ref="slots"></div>
    <details class="json"><summary>World blueprint JSON</summary><pre data-ref="json"></pre></details>
    <details class="json"><summary>Biome blueprint JSON</summary><pre data-ref="biome-json"></pre></details>
  </div>
</aside>
`;

const FACTS = { scale: 1, age: 120 };
const SPOTS: readonly [number, number][] = [
  [-9.6, -1.5],
  [-3.2, 2.2],
  [3.2, -1.2],
  [9.8, 1.6],
];
const OVERVIEW = { position: new THREE.Vector3(5.5, 6.8, 50), target: new THREE.Vector3(1.6, 4, 0) };
const WORLD_SEED = seedOf("lab/world");

/** A world blueprint and the biome of the region the lab shows under it. */
interface WorldEntry {
  name: string;
  world: Blueprint;
  biome: Blueprint;
}

interface Entry {
  readonly name: string;
  readonly blueprint: Blueprint;
  readonly seed: number;
  readonly position: THREE.Vector3;
  view: PlantView | null;
  target: number;
  shown: number;
}

export function createWorldLab(root: HTMLElement): Lab {
  root.innerHTML = TEMPLATE;
  const $ = refs(root);
  const floraLib = new Library(FLORA_PRIMITIVES);
  // Realizing a biome builds its relief too, though the trees stand on flat ground.
  const lib = new Library([...WORLD_PRIMITIVES, ...BIOME_PRIMITIVES, ...RELIEF_PRIMITIVES]);
  const worldSpace = blueprintCount(worldKind, lib);
  let active = false;

  const canvas = root.querySelector("canvas") as HTMLCanvasElement;
  const stage = root.querySelector(".stage") as HTMLElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const light = createSceneLight();
  const groundShared = { uVitality: { value: 1 } };
  const scene = new THREE.Scene();
  const sky = createSky(light);
  const ground = createGround(light, groundShared);
  const cover = createGroundCover(light, groundShared);
  const drift = createDrift(light, 991);
  const specks = createDrift(light, 4242);
  scene.add(sky.mesh, ground.mesh, cover.mesh, drift.points, specks.points);
  const shadow = createSunShadow(light, 2048);
  const lantern = createLantern(light);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  camera.position.copy(OVERVIEW.position);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(OVERVIEW.target);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 5;
  controls.maxDistance = 90;

  // ---------- the world ----------

  const first = WORLD_PRESETS[0];
  if (first === undefined) throw new Error("There are no named worlds.");
  let current: WorldEntry = { name: first.name, world: first.world, biome: first.biome };
  /** The hour shown, from the shell's clock; NaN until the first frame. */
  let hour = Number.NaN;
  const lookOf = (e: WorldEntry, h: number): WorldLook =>
    realizeWorld({ blueprint: e.world, kind: worldKind }, { blueprint: e.biome, kind: biome }, lib, WORLD_SEED, Number.isNaN(h) ? 12.5 : h);
  let look: WorldLook = lookOf(current, hour);
  /** 0 with the sun on the horizon or below, 1 with it high. */
  let daylight = 1;

  /** The hour's light, sky and air: no plant is rebuilt. */
  function applyHour(next: WorldLook): void {
    look = next;
    const l = next.light;
    applyLight(light, l);
    daylight = Math.min(1, Math.max(0, (l.sunDirection[1] - 0.1) / 0.55)) * Math.min(1, l.sunIntensity);
    shadow.frame(new THREE.Vector3(0, 0, 0), 20);
    sky.apply(next);
    drift.apply(next.drift, daylight);
    specks.apply(next.specks > 0 ? { form: "pollen", color: [0.98, 0.88, 0.5], count: Math.round(520 * next.specks), size: 0.028, glow: 0.3 } : null, daylight);
  }

  function applyLook(next: WorldLook): void {
    applyHour(next);
    ground.apply(next);
    cover.apply(next);
    entries.forEach(build);
  }

  // ---------- plants ----------

  const entries: Entry[] = FLORA_PRESETS.map((preset, i) => ({
    name: preset.name,
    blueprint: preset.blueprint,
    seed: seedOf(`lab/plant-${i}`),
    position: new THREE.Vector3(SPOTS[i]?.[0] ?? 0, 0, SPOTS[i]?.[1] ?? 0),
    view: null,
    target: 1,
    shown: 1,
  }));

  /** Components keep their own family; the world's season turns only their healthy colors. */
  function build(entry: Entry): void {
    const plant = realize(entry.blueprint, flora, floraLib, { seed: entry.seed, facts: FACTS });
    const view = createPlant({ ...plant, palette: seasonPalette(plant.palette, look.season) }, light);
    view.object.position.copy(entry.position);
    view.object.rotation.y = (entry.seed % 628) / 100;
    view.object.userData.entry = entry;
    view.setVitality(entry.shown);
    entry.view?.dispose();
    scene.add(view.object);
    entry.view = view;
  }

  // ---------- selection and camera ----------

  let selected: Entry | null = null;
  const fly = { from: new THREE.Vector3(), to: new THREE.Vector3(), camFrom: new THREE.Vector3(), camTo: new THREE.Vector3(), t: 1 };

  function flyTo(target: THREE.Vector3, cam: THREE.Vector3): void {
    fly.from.copy(controls.target);
    fly.to.copy(target);
    fly.camFrom.copy(camera.position);
    fly.camTo.copy(cam);
    fly.t = 0;
  }

  function focus(entry: Entry): void {
    const view = entry.view;
    if (view === null) return;
    const target = entry.position.clone().add(new THREE.Vector3(0, view.height * 0.45, 0));
    const away = camera.position.clone().sub(controls.target).setY(0).normalize();
    const distance = Math.max(view.height, view.radius * 2) * 1.55 + 4;
    flyTo(target, target.clone().addScaledVector(away, distance).add(new THREE.Vector3(0, view.height * 0.25, 0)));
  }

  const plantRow = $("plant-row");
  const plantName = $("plant-name");
  const vitalityInput = $<HTMLInputElement>("vitality");
  const vitalityOut = $<HTMLOutputElement>("vitality-out");
  const allInput = $<HTMLInputElement>("all");
  const allOut = $<HTMLOutputElement>("all-out");
  const fmt = (v: number): string => v.toFixed(2);

  function select(entry: Entry | null, frame = true): void {
    selected = entry;
    plantRow.classList.toggle("empty", entry === null);
    if (entry !== null && entry.view !== null) {
      ground.select(entry.position.x, entry.position.z, entry.view.radius * 0.95 + 0.6, true);
      plantName.textContent = entry.name;
      vitalityInput.disabled = false;
      vitalityInput.value = String(entry.target);
      vitalityOut.textContent = fmt(entry.target);
      if (frame) focus(entry);
    } else {
      ground.select(0, 0, 1, false);
      plantName.textContent = "Click a tree";
      vitalityInput.disabled = true;
    }
  }

  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector2();
  canvas.addEventListener("pointerdown", (e) => down.set(e.clientX, e.clientY));
  canvas.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1),
      camera,
    );
    const hits = raycaster.intersectObjects(entries.flatMap((x) => (x.view === null ? [] : [x.view.object])), true);
    let node: THREE.Object3D | null = hits[0]?.object ?? null;
    while (node !== null && node.userData.entry === undefined) node = node.parent;
    select((node?.userData.entry as Entry | undefined) ?? null);
  });

  vitalityInput.addEventListener("input", () => {
    if (selected === null) return;
    selected.target = Number(vitalityInput.value);
    vitalityOut.textContent = fmt(selected.target);
  });

  function setAll(v: number): void {
    for (const e of entries) e.target = v;
    allInput.value = String(v);
    allOut.textContent = fmt(v);
    if (selected !== null) {
      vitalityInput.value = String(v);
      vitalityOut.textContent = fmt(v);
    }
  }
  allInput.addEventListener("input", () => setAll(Number(allInput.value)));

  // ---------- world panel ----------

  const presetSelect = $<HTMLSelectElement>("preset");
  const spaceLine = $("space");
  let draws = 0;

  function refreshPresetSelect(): void {
    presetSelect.replaceChildren();
    const names = WORLD_PRESETS.map((p) => p.name);
    if (!names.includes(current.name)) names.push(current.name);
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      option.selected = name === current.name;
      presetSelect.append(option);
    }
  }

  function setWorld(entry: WorldEntry): boolean {
    const problems = [...validate(entry.world, worldKind, lib), ...validate(entry.biome, biome, lib)];
    $("problems").textContent = problems.join(" ");
    if (problems.length > 0) return false;
    current = entry;
    applyLook(lookOf(entry, hour));
    refreshWorldPanel();
    return true;
  }

  function refreshWorldPanel(): void {
    refreshPresetSelect();
    $("bp-id").textContent = current.world.id;
    $("json").textContent = JSON.stringify(current.world, null, 2);
    $("biome-json").textContent = JSON.stringify(current.biome, null, 2);
    renderInspector($("slots"), {
      kind: worldKind,
      lib,
      blueprint: current.world,
      onChange: (slots) => {
        const edited = blueprintOf(worldKind.id, slots);
        const named = WORLD_PRESETS.find((p) => p.world.id === edited.id && p.biome.id === current.biome.id)?.name;
        setWorld({ name: named ?? "Edited world", world: edited, biome: current.biome });
      },
    });
  }

  function choosePreset(i: number): boolean {
    const p = WORLD_PRESETS[i];
    return p === undefined ? false : setWorld({ name: p.name, world: p.world, biome: p.biome });
  }

  presetSelect.addEventListener("change", () => {
    const i = WORLD_PRESETS.findIndex((p) => p.name === presetSelect.value);
    if (i >= 0) choosePreset(i);
  });

  /** A uniform draw of the world kind; the ground under the trees keeps the current biome. */
  function randomWorld(random: () => number = Math.random): Blueprint | null {
    const bp = blueprintOf(worldKind.id, randomSlots(worldKind, lib, random));
    const problems = validate(bp, worldKind, lib);
    draws += 1;
    spaceLine.textContent =
      problems.length === 0
        ? `Draw ${draws}: valid, one of ${worldSpace.toLocaleString()} worlds.`
        : `Draw ${draws} failed validation: ${problems.join(" ")}`;
    if (problems.length > 0) return null;
    setWorld({ name: `Random world ${draws}`, world: bp, biome: current.biome });
    return bp;
  }

  function overview(): void {
    select(null);
    flyTo(OVERVIEW.target, OVERVIEW.position);
  }

  $("random").addEventListener("click", () => randomWorld());
  $("overview").addEventListener("click", overview);
  spaceLine.textContent = `${worldSpace.toLocaleString()} distinct worlds in the world kind's type space.`;

  // ---------- frame ----------

  function resize(): void {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const pixels = (h * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    drift.setPixels(pixels);
    specks.setPixels(pixels);
  }
  new ResizeObserver(resize).observe(stage);

  let frozen: number | null = null;
  const eye = new THREE.Vector3();
  const lastEye = new THREE.Vector3();
  const facing = new THREE.Vector3();
  function frame(dt: number, at: number): void {
    if (at !== hour) applyHour(lookOf(current, (hour = at)));
    const time = frozen ?? light.uTime.value + dt;
    light.uTime.value = time;
    // Gusts: slow surges on top of the world's steady wind.
    const surge = 0.5 + 0.5 * Math.sin(time * 0.37) * Math.sin(time * 0.23 + 1.3);
    light.uWind.value = look.wind.strength * (1 + look.wind.gust * (surge - 0.3));
    let sum = 0;
    for (const e of entries) {
      e.shown += (e.target - e.shown) * (1 - Math.exp(-dt * 5));
      if (Math.abs(e.target - e.shown) < 0.001) e.shown = e.target;
      e.view?.setVitality(e.shown);
      sum += e.shown;
    }
    const mean = sum / Math.max(1, entries.length);
    groundShared.uVitality.value = mean;
    drift.setVitality(mean);
    specks.setVitality(mean);
    if (fly.t < 1) {
      fly.t = Math.min(1, fly.t + dt / 0.8);
      const k = fly.t * fly.t * (3 - 2 * fly.t);
      controls.target.lerpVectors(fly.from, fly.to, k);
      camera.position.lerpVectors(fly.camFrom, fly.camTo, k);
    }
    controls.update();
    // The person stands where the camera is, lantern in hand, on the flat ground.
    eye.copy(camera.position);
    camera.getWorldDirection(facing);
    lantern.follow(eye, facing, 0, Math.hypot(eye.x - lastEye.x, eye.z - lastEye.z), dt);
    lastEye.copy(eye);
    const views = entries.flatMap((e) => (e.view === null ? [] : [e.view]));
    shadow.render(renderer, scene, views, [sky.mesh, ground.mesh, cover.mesh, drift.points, specks.points]);
    renderer.render(scene, camera);
  }

  applyLook(look);
  refreshWorldPanel();
  select(null, false);

  function view(pos: readonly [number, number, number], target: readonly [number, number, number]): void {
    camera.position.set(...pos);
    controls.target.set(...target);
    fly.t = 1;
  }

  // ---------- shots: each named world from the front ----------

  function showcase(i: number): void {
    choosePreset(i);
    select(null, false);
    setAll(1);
    for (const e of entries) e.shown = 1;
    view(OVERVIEW.position.toArray(), OVERVIEW.target.toArray());
    frozen = 8;
  }

  return {
    setActive(on) {
      active = on;
      controls.enabled = on;
      if (on) resize();
    },
    frame: (dt, _now, h) => {
      if (active) frame(dt, h);
    },
    shots: (): Shot[] => WORLD_PRESETS.map((p, i) => ({ name: `world-${slug(p.name)}`, stage: () => showcase(i) })),
    hook: {
      world: (i: number) => choosePreset(i),
      random: (seed?: number) => {
        if (seed === undefined) return randomWorld()?.slots;
        const r = rand(seed);
        return randomWorld(() => r.next())?.slots;
      },
      select: (i: number, frame = true) => select(entries[i] ?? null, frame),
      overview,
      setAll: (v: number) => {
        setAll(v);
        for (const e of entries) e.shown = v;
      },
      showcase,
      freeze: (t: number | null) => (frozen = t),
      view,
      space: () => worldSpace,
      look: () => look,
      name: () => current.name,
      hour: () => hour,
    },
  };
}
