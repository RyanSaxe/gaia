// The flora lab: four preset plants in a sunlit meadow, an inspector
// generated from the declarations, and live vitality.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type Blueprint, Library, blueprintOf, seedOf } from "@gaia/schema";
import { FLORA_PRIMITIVES } from "@gaia/primitives";
import { flora } from "@gaia/kinds";
import { blueprintCount, randomSlots, validate } from "@gaia/world";
import { FLORA_PRESETS, realize } from "@gaia/realize";
import { type PlantView, createPlant, createSceneLight, createSunShadow } from "@gaia/render";
import { renderInspector } from "../inspector.ts";
import { type Lab, type Shot, onTap, refs, slug } from "../lab.ts";
import { createGrass, createGround, createSky } from "./environment.ts";

const TEMPLATE = /* html */ `
<main class="stage">
  <canvas class="view" aria-label="Meadow with four plants. Drag to orbit, click a plant to inspect it."></canvas>
  <div class="bar top">
    <span></span>
    <button data-ref="random" class="primary" title="Sample every field uniformly and validate the result">Random blueprint</button>
  </div>
  <div class="bar bottom">
    <label class="chip range grow"><span>All plants</span><input data-ref="all" type="range" min="0" max="1" step="0.01" value="1"><output data-ref="all-out">1.00</output></label>
    <button data-ref="overview">Show all</button>
    <div class="chip space" data-ref="space"></div>
  </div>
</main>
<aside class="panel" data-ref="panel">
  <header>
    <div class="title" data-ref="name"></div>
    <div class="bp-id" data-ref="bp-id"></div>
    <label class="range"><span>Vitality</span><input data-ref="vitality" type="range" min="0" max="1" step="0.01" value="1"><output data-ref="vitality-out">1.00</output></label>
    <div class="build-stats" data-ref="stats"></div>
    <div class="problems" data-ref="problems"></div>
  </header>
  <div class="scroll">
    <div data-ref="slots"></div>
    <details class="json"><summary>Blueprint JSON</summary><pre data-ref="json"></pre></details>
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

interface Entry {
  name: string;
  blueprint: Blueprint;
  readonly seed: number;
  readonly position: THREE.Vector3;
  view: PlantView | null;
  /** Where the shown vitality is easing toward. */
  target: number;
  shown: number;
  ms: number;
}

export function createFloraLab(root: HTMLElement): Lab {
  root.innerHTML = TEMPLATE;
  const $ = refs(root);
  const lib = new Library(FLORA_PRIMITIVES);
  const space = blueprintCount(flora, lib);
  let active = false;

  const canvas = root.querySelector("canvas") as HTMLCanvasElement;
  const stage = root.querySelector(".stage") as HTMLElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const light = createSceneLight();
  const scene = new THREE.Scene();
  const sky = createSky(light);
  const ground = createGround(light);
  const grass = createGrass(light);
  scene.add(sky, ground.mesh, grass);
  const shadow = createSunShadow(light, 2048);
  shadow.frame(new THREE.Vector3(0, 0, 0), 20);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 600);
  camera.position.copy(OVERVIEW.position);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(OVERVIEW.target);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 5;
  controls.maxDistance = 90;

  const entries: Entry[] = FLORA_PRESETS.map((preset, i) => ({
    name: preset.name,
    blueprint: preset.blueprint,
    seed: seedOf(`lab/plant-${i}`),
    position: new THREE.Vector3(SPOTS[i]?.[0] ?? 0, 0, SPOTS[i]?.[1] ?? 0),
    view: null,
    target: 1,
    shown: 1,
    ms: 0,
  }));

  function build(entry: Entry): void {
    const t0 = performance.now();
    const plant = realize(entry.blueprint, flora, lib, { seed: entry.seed, facts: FACTS });
    const view = createPlant(plant, light);
    view.object.position.copy(entry.position);
    view.object.rotation.y = (entry.seed % 628) / 100;
    view.object.userData.entry = entry;
    view.setVitality(entry.shown);
    entry.view?.dispose();
    scene.add(view.object);
    entry.view = view;
    entry.ms = performance.now() - t0;
  }
  entries.forEach(build);

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

  /** Where the camera frames a plant from, looking along `away`. */
  function framing(entry: Entry, away: THREE.Vector3): [THREE.Vector3, THREE.Vector3] | null {
    const view = entry.view;
    if (view === null) return null;
    const target = entry.position.clone().add(new THREE.Vector3(0, view.height * 0.45, 0));
    const distance = Math.max(view.height, view.radius * 2) * 1.55 + 4;
    return [target, target.clone().addScaledVector(away, distance).add(new THREE.Vector3(0, view.height * 0.25, 0))];
  }

  function focus(entry: Entry): void {
    const frame = framing(entry, camera.position.clone().sub(controls.target).setY(0).normalize());
    if (frame !== null) flyTo(...frame);
  }

  function select(entry: Entry | null, frame = true): void {
    selected = entry;
    if (entry !== null && entry.view !== null) {
      ground.select(entry.position.x, entry.position.z, entry.view.radius * 0.95 + 0.6, true);
      if (frame) focus(entry);
    } else {
      ground.select(0, 0, 1, false);
    }
    refreshPanel();
  }

  const raycaster = new THREE.Raycaster();
  onTap(canvas, (e) => {
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

  // ---------- panel ----------

  const vitalityInput = $<HTMLInputElement>("vitality");
  const vitalityOut = $<HTMLOutputElement>("vitality-out");
  const allInput = $<HTMLInputElement>("all");
  const allOut = $<HTMLOutputElement>("all-out");
  const slotsRoot = $("slots");
  const fmt = (v: number): string => v.toFixed(2);

  function refreshPanel(): void {
    $("panel").classList.toggle("empty", selected === null);
    if (selected === null) {
      $("name").textContent = "No plant selected";
      $("bp-id").textContent = "Click a plant in the meadow.";
      slotsRoot.replaceChildren();
      $("json").textContent = "";
      $("stats").textContent = "";
      return;
    }
    const entry = selected;
    $("name").textContent = entry.name;
    $("bp-id").textContent = entry.blueprint.id;
    vitalityInput.value = String(entry.target);
    vitalityOut.textContent = fmt(entry.target);
    const problems = validate(entry.blueprint, flora, lib);
    $("problems").textContent = problems.length === 0 ? "" : problems.join(" ");
    $("stats").textContent = `${(entry.view?.triangles ?? 0).toLocaleString()} triangles · built in ${entry.ms.toFixed(0)} ms`;
    $("json").textContent = JSON.stringify(entry.blueprint, null, 2);
    renderInspector(slotsRoot, {
      kind: flora,
      lib,
      blueprint: entry.blueprint,
      onChange: (slots) => {
        const next = blueprintOf(flora.id, slots);
        const issues = validate(next, flora, lib);
        if (issues.length > 0) {
          $("problems").textContent = issues.join(" ");
          return;
        }
        entry.blueprint = next;
        build(entry);
        refreshPanel();
      },
    });
  }

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

  let draws = 0;
  function randomize(): Blueprint | null {
    const entry = selected ?? entries[0];
    if (entry === undefined) return null;
    const bp = blueprintOf(flora.id, randomSlots(flora, lib, Math.random));
    const problems = validate(bp, flora, lib);
    draws += 1;
    $("space").textContent =
      problems.length === 0
        ? `Draw ${draws}: valid, one of ${space.toLocaleString()} flora blueprints.`
        : `Draw ${draws} failed validation: ${problems.join(" ")}`;
    if (problems.length > 0) return null;
    entry.blueprint = bp;
    entry.name = `Random draw ${draws}`;
    build(entry);
    select(entry, selected !== entry);
    return bp;
  }

  function overview(): void {
    select(null);
    flyTo(OVERVIEW.target, OVERVIEW.position);
  }

  $("random").addEventListener("click", () => randomize());
  $("overview").addEventListener("click", overview);
  $("space").textContent = `${space.toLocaleString()} flora blueprints in this type space.`;

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
  function frame(dt: number): void {
    light.uTime.value = frozen ?? light.uTime.value + dt;
    for (const e of entries) {
      e.shown += (e.target - e.shown) * (1 - Math.exp(-dt * 5));
      if (Math.abs(e.target - e.shown) < 0.001) e.shown = e.target;
      e.view?.setVitality(e.shown);
    }
    if (fly.t < 1) {
      fly.t = Math.min(1, fly.t + dt / 0.8);
      const k = fly.t * fly.t * (3 - 2 * fly.t);
      controls.target.lerpVectors(fly.from, fly.to, k);
      camera.position.lerpVectors(fly.camFrom, fly.camTo, k);
    }
    controls.update();
    const views = entries.flatMap((e) => (e.view === null ? [] : [e.view]));
    shadow.render(renderer, scene, views, [sky, ground.mesh, grass]);
    renderer.render(scene, camera);
  }
  select(entries[0] ?? null, false);

  // ---------- shots: each primitive in a tree that uses it, at three vitalities ----------

  function showcase(primitiveId: string, vitality: number): void {
    entries.forEach((e, i) => {
      const preset = FLORA_PRESETS[i];
      if (preset !== undefined && e.blueprint.id !== preset.blueprint.id) {
        e.blueprint = preset.blueprint;
        e.name = preset.name;
        build(e);
      }
    });
    const entry = entries.find((e) => Object.values(e.blueprint.slots).some((s) => s.use === primitiveId)) ?? entries[0];
    if (entry === undefined) return;
    setAll(vitality);
    for (const e of entries) e.shown = vitality;
    select(entry, false);
    const away = OVERVIEW.position.clone().sub(OVERVIEW.target).setY(0).normalize();
    const view = framing(entry, away);
    if (view !== null) {
      controls.target.copy(view[0]);
      camera.position.copy(view[1]);
      fly.t = 1;
    }
    frozen = 8;
  }

  return {
    setActive(on) {
      active = on;
      controls.enabled = on;
      if (on) resize();
    },
    frame: (dt) => {
      if (active) frame(dt);
    },
    shots: (): Shot[] =>
      FLORA_PRIMITIVES.flatMap((p) =>
        [1, 0.5, 0.1].map((v) => ({ name: `flora-${slug(p.id)}-vitality-${v.toFixed(1)}`, stage: () => showcase(p.id, v) })),
      ),
    hook: {
      select: (i: number, frame = true) => select(entries[i] ?? null, frame),
      overview,
      setAll: (v: number) => {
        setAll(v);
        for (const e of entries) e.shown = v;
      },
      random: () => randomize(),
      showcase,
      freeze: (t: number | null) => (frozen = t),
      view: (pos: [number, number, number], target: [number, number, number]) => {
        camera.position.set(...pos);
        controls.target.set(...target);
        fly.t = 1;
      },
      info: () =>
        entries.map((e) => ({ name: e.name, id: e.blueprint.id, triangles: e.view?.triangles, ms: Math.round(e.ms), vitality: e.shown })),
    },
  };
}
