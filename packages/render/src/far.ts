// Far forms: a tree far enough away to cover few pixels draws as one card
// instead of its thousands of triangles. `startFarBake` renders the plant
// with its own shaders from many directions into atlases of what its
// fragments are made of: color healthy and withered, normal, depth, glow,
// foliage, and how much of each texel it covers at four vitalities. A card
// (`createFarCards`) faces the eye, blends the four nearest views, cuts and
// colors them at its copy's vitality and lights them with the scene's own
// light, so a far tree keeps its shape, health, sway and night. Its boughs sag
// as the full form's do: the views are baked as the plant stands healthy, and
// a field of where each point moves as the boughs sag (`droopField`) moves
// what the card reads by its copy's vitality. A set's cards
// hold a fixed number of forms, each copied whole, every mip level a card reads,
// into a slot of texture arrays, and every plant's copies stand in one batch
// of buffers written when they are placed (`FarCopies`), so a set draws all
// its cards in one draw per pass and kind of card. Every pass the card's
// vertex shader measures each copy's crown on that pass's screen and draws it
// far, fading over its full form, or not at all, by the same rule the woods
// choose the full form by (`farChoice`, and its twin `FAR_CHOICE_GLSL`), at
// the size its form's slot turns far at. After the World session's proof.

import * as THREE from "three";
import type { Part } from "@gaia/schema";
import { AIR, CHANNEL_MATH, FLUTTERS, type Realized, mergeParts, shownVitality } from "@gaia/realize";
import type { InstanceSpot } from "./instances.ts";
import { copySeed } from "./instances.ts";
import { LIGHT_GLSL, noShadowMap, type SceneLight } from "./light.ts";
import { FOLIAGE, PLANT_FRAG, PLANT_VERT, geometryOf, sprayColors } from "./plant.ts";
import { WIND_GLSL } from "./sway.ts";
import { closeEachFrame, followVitality } from "./lag.ts";

/** Where the views look from: azimuths all the way round, at these elevations in degrees, crowded where a walker sees far trees. */
export const FAR_VIEWS = { azimuths: 16, elevations: [-8, 0, 8, 18, 34, 60] } as const;
/**
 * The vitalities whose coverage is baked, and coverage between them is interpolated. Color comes from 1 and 0. The
 * last is 0, where a copy of the poorest code stands, so its card holds only what its tree has kept.
 */
const SLICES = [1, 0.6, 0.3, 0] as const;
/** Samples per texel along each side while baking, on top of 4x multisampling: one keeps the bake's GPU work small. */
const SUPERSAMPLE = 1;
/** The world's field of view, degrees: where a tree turns far depends on how many pixels a radian covers. */
const FOV = 58;

/** Cells along each side of a far form's droop field (`droopField`). */
export const DROOP_CELLS = 12;

/**
 * Where each point of a plant moves as its boughs sag all the way, at
 * vitality 0: `DROOP_CELLS` cubed cells over the cube its views frame, four
 * bytes a cell, x, y and z each from -1 to 1 times `scale` meters. At a
 * higher vitality a point moves that much times how far its boughs have
 * sagged. `reach` is the farthest any vertex moves, meters.
 */
export interface DroopField {
  readonly cells: Uint8Array;
  readonly scale: number;
  readonly reach: number;
}

/**
 * The droop field of `parts` over the cube of half-side `radius` about
 * `center`. Droop bends each bough about its joint (`applyDroop` in
 * plant.ts), so a cell holds the mean movement of the vertices in it; a cell
 * with none takes its neighbors', so a point anywhere near the plant reads
 * the movement of the boughs beside it. Twelve cells a side hold a tree's
 * droop to about a texel at the swap.
 */
export function droopField(parts: readonly Part[], center: THREE.Vector3, radius: number): DroopField {
  const n = DROOP_CELLS;
  const sums = new Float64Array(n * n * n * 4);
  const cellOf = (v: number, c: number): number => Math.floor(((v - c) / (2 * radius) + 0.5) * n);
  let reach = 0;
  for (const part of parts) {
    const p = part.positions;
    const { droop, bough } = part.channels;
    for (let i = 0; i < p.length / 3; i++) {
      const x = p[i * 3] as number;
      const y = p[i * 3 + 1] as number;
      const z = p[i * 3 + 2] as number;
      const gx = cellOf(x, center.x);
      const gy = cellOf(y, center.y);
      const gz = cellOf(z, center.z);
      if (gx < 0 || gy < 0 || gz < 0 || gx >= n || gy >= n || gz >= n) continue;
      const s = droop[i] ?? 0;
      const at = ((gz * n + gy) * n + gx) * 4;
      sums[at + 3] = (sums[at + 3] as number) + 1;
      if (s <= 0) continue;
      const ox = x - (bough[i * 3] as number);
      const oy = y - (bough[i * 3 + 1] as number);
      const oz = z - (bough[i * 3 + 2] as number);
      const d = Math.hypot(ox, oy, oz);
      if (d <= 1e-5) continue;
      const ly = oy - s * d * CHANNEL_MATH.sag;
      const k = d / Math.hypot(ox, ly, oz);
      const moved = [ox * k - ox, ly * k - oy, oz * k - oz] as const;
      reach = Math.max(reach, Math.hypot(...moved));
      for (let a = 0; a < 3; a++) sums[at + a] = (sums[at + a] as number) + (moved[a] as number);
    }
  }
  const field = new Float32Array(n * n * n * 3);
  const filled = new Uint8Array(n * n * n);
  for (let c = 0; c < n * n * n; c++) {
    const count = sums[c * 4 + 3] as number;
    if (count === 0) continue;
    for (let a = 0; a < 3; a++) field[c * 3 + a] = (sums[c * 4 + a] as number) / count;
    filled[c] = 1;
  }
  // Empty cells take the mean of their filled neighbors, a ring at a time outward.
  for (let ring = 0; ring < n && filled.includes(0); ring++) {
    const was = filled.slice();
    for (let c = 0; c < n * n * n; c++) {
      if (was[c] === 1) continue;
      const gx = c % n;
      const gy = Math.floor(c / n) % n;
      const gz = Math.floor(c / (n * n));
      let count = 0;
      const mean = [0, 0, 0];
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const [x, y, z] = [gx + dx, gy + dy, gz + dz];
        if (x < 0 || y < 0 || z < 0 || x >= n || y >= n || z >= n) continue;
        const o = (z * n + y) * n + x;
        if (was[o] !== 1) continue;
        for (let a = 0; a < 3; a++) mean[a] = (mean[a] as number) + (field[o * 3 + a] as number);
        count++;
      }
      if (count === 0) continue;
      for (let a = 0; a < 3; a++) field[c * 3 + a] = (mean[a] as number) / count;
      filled[c] = 1;
    }
  }
  const scale = field.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const cells = new Uint8Array(n * n * n * 4);
  for (let c = 0; c < n * n * n; c++) {
    for (let a = 0; a < 3; a++) cells[c * 4 + a] = scale > 0 ? Math.round(((field[c * 3 + a] as number) / scale) * 127.5 + 127.5) : 128;
    cells[c * 4 + 3] = 255;
  }
  return { cells, scale, reach };
}

/** One tree build, baked. */
export interface FarForm {
  /** The plant's bounds where it stands, unscaled and unturned: the woods size a copy on screen from these. */
  readonly bounds: { readonly center: THREE.Vector3; readonly radius: number; readonly height: number };
  /** GPU memory its atlases take, bytes, mipmaps included. */
  readonly bytes: number;
  /** How long the bake took, milliseconds. */
  readonly ms: number;
  /** @internal The card's textures, droop and motion, and the targets the bake drew them into (none for a form read from storage). */
  readonly atlas: { readonly layers: readonly THREE.Texture[]; readonly droop: DroopField; readonly frame: number; readonly sway: number; readonly frequency: number; readonly targets?: readonly THREE.WebGLRenderTarget[] };
  dispose(): void;
}

/** The direction view (i, j) looks from, toward the plant. */
export function farViewDir(i: number, j: number): THREE.Vector3 {
  const az = (2 * Math.PI * i) / FAR_VIEWS.azimuths;
  const el = ((FAR_VIEWS.elevations[j] ?? 0) * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
}

const swap = (source: string, from: string, to: string): string => {
  if (!source.includes(from)) throw new Error(`The plant shader no longer contains "${from.slice(0, 70)}"; update far.ts.`);
  return source.split(from).join(to);
};

/** What a bake pass writes for each fragment, through alpha-to-coverage so a texel resolves to the value times the share it covers. */
const OUTPUT = {
  cover: "gl_FragColor = vec4(1.0, 1.0, 1.0, cover);",
  albedo: "gl_FragColor = vec4(albedo, cover);",
  normal: "gl_FragColor = vec4(n * 0.5 + 0.5, cover);",
  depth: "gl_FragColor = vec4(clamp(0.5 + dot(vWorld - uBakeCenter, uBakeDir) / (2.0 * uBakeRadius), 0.0, 1.0), 0.0, 0.0, cover);",
  glow: "gl_FragColor = vec4(clamp(vGlow, 0.0, 1.0), 0.0, 0.0, cover);",
  foliage: "gl_FragColor = vec4(uFoliage, 0.0, 0.0, cover);",
} as const;
type Output = keyof typeof OUTPUT;

/** The plant's vertex shader with its color's vitality apart from its shape's, and droop left out so every slice nests inside the healthy outline. */
function bakeVert(): string {
  let s = swap(PLANT_VERT, "void main() {", "uniform float uColorVitality;\nvec3 bakeKeep(vec3 p, vec3 joint) { return p; }\nvoid main() {");
  s = swap(s, "vWither = aWither * (1.0 - vitalityMid());", "vWither = aWither * (1.0 - uColorVitality);");
  s = swap(s, "vec3 p = applyDroop(", "vec3 p = bakeKeep(");
  return s;
}

/** The plant's fragment shader, writing one layer instead of lit color, with leaves merging as they would on screen at the swap. */
function bakeFrag(output: Output): string {
  let s = swap(PLANT_FRAG, "void main() {", "uniform vec3 uBakeCenter;\nuniform vec3 uBakeDir;\nuniform float uBakeRadius;\nvoid main() {");
  // A bake texel is a fraction of a screen pixel at the swap: leaves merge as they would on screen there.
  s = swap(s, "float px = max(sqrt(abs(dx.x * dy.y - dx.y * dy.x) * 2.0), 1e-4);", `float px = max(sqrt(abs(dx.x * dy.y - dx.y * dy.x) * 2.0) * ${SUPERSAMPLE}.0, 1e-4);`);
  s = swap(s, "gl_FragColor = vec4(aerial(shoulder(color), vWorld) + glow * (1.0 - uNightness * 0.35), cover);", OUTPUT[output]);
  return s;
}

const QUAD_VERT = "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }";
/** Averages SUPERSAMPLE² resolved texels of one row's bake into one atlas texel, mapped into the atlas's channels by uMap. */
const DOWN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uOrigin;
uniform mat4 uMap;
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy - uOrigin) * ${SUPERSAMPLE};
  vec4 sum = vec4(0.0);
  for (int y = 0; y < ${SUPERSAMPLE}; y++) for (int x = 0; x < ${SUPERSAMPLE}; x++) sum += texelFetch(uSrc, base + ivec2(x, y), 0);
  gl_FragColor = uMap * (sum / ${SUPERSAMPLE * SUPERSAMPLE}.0);
}`;

/** A pass and where its resolved value goes: the source channel into each atlas layer's channels. */
interface Pass {
  readonly output: Output;
  readonly vitality: number;
  readonly colorVitality: number;
  readonly layer: number;
  /** Destination channel per source channel (r, g, b, a), or -1 to drop it. */
  readonly to: readonly [number, number, number, number];
}

/**
 * Four RGBA layers, every value premultiplied by the share of the texel the
 * healthy plant covers (or, for the withered color, the share at the last
 * slice): 0 healthy color and coverage at 1; 1 withered color (at the last
 * slice's shape) and glow; 2 normal and depth; 3 coverage at 0.6, 0.3 and
 * 0, and foliage.
 */
const PASSES: readonly Pass[] = [
  { output: "cover", vitality: 1, colorVitality: 1, layer: 0, to: [3, -1, -1, -1] },
  { output: "albedo", vitality: 1, colorVitality: 1, layer: 0, to: [0, 1, 2, -1] },
  { output: "albedo", vitality: SLICES[3], colorVitality: 0, layer: 1, to: [0, 1, 2, -1] },
  { output: "glow", vitality: 1, colorVitality: 1, layer: 1, to: [3, -1, -1, -1] },
  { output: "normal", vitality: 1, colorVitality: 1, layer: 2, to: [0, 1, 2, -1] },
  { output: "depth", vitality: 1, colorVitality: 1, layer: 2, to: [3, -1, -1, -1] },
  { output: "cover", vitality: SLICES[1], colorVitality: 1, layer: 3, to: [0, -1, -1, -1] },
  { output: "cover", vitality: SLICES[2], colorVitality: 1, layer: 3, to: [1, -1, -1, -1] },
  { output: "cover", vitality: SLICES[3], colorVitality: 1, layer: 3, to: [2, -1, -1, -1] },
  { output: "foliage", vitality: 1, colorVitality: 1, layer: 3, to: [3, -1, -1, -1] },
];

const mapOf = (to: Pass["to"]): THREE.Matrix4 => {
  const m = new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  to.forEach((dest, src) => {
    if (dest >= 0) m.elements[src * 4 + dest] = 1;
  });
  return m;
};

/** A far form being baked a little at a time, so a loading screen keeps painting. */
export interface FarBake {
  /** Resolves once every shader the bake uses has compiled, in parallel where the browser can. */
  readonly ready: Promise<void>;
  /**
   * Bakes up to `views` views (of 960: 96 directions in ten passes), fewer
   * if `budgetMs` passes first; the form when the last is done, else null.
   * The GPU work a view queues is not counted in the budget, so `views`
   * bounds what a frame takes on the GPU.
   */
  step(budgetMs: number, views?: number): FarForm | null;
  /** Stops and frees everything, if it has not finished. */
  cancel(): void;
}

/**
 * Starts baking `plant` into its far form, each view `framePx` texels
 * across: the crown span on screen, in device pixels, at which the woods
 * turn it far, so one texel covers about one pixel there. The views see the
 * plant as the near form looks from that distance: still air, full detail
 * thinned as the eye would thin it, leaves merged to that pixel size.
 */
export function startFarBake(renderer: THREE.WebGLRenderer, plant: Realized, framePx = 128): FarBake {
  let spent = 0;
  const parts = mergeParts(plant.parts).filter((p: Part) => p.indices.length > 0);
  // Framed by what stands above the soil, as its copies are bounded (`createPlantInstances`): a bramble's canes root
  // under it, where no one sees them.
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const part of parts) {
    const p = part.positions;
    for (let i = 0; i < p.length; i += 3) box.expandByPoint(point.set(p[i] as number, Math.max(0, p[i + 1] as number), p[i + 2] as number));
  }
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const height = Math.max(0.3, box.max.y);
  // Padding for the wind's bend and pieces growing toward a pixel.
  const radius = sphere.radius * 1.04;
  const fieldAt = performance.now();
  const droop = droopField(parts, sphere.center, radius);
  spent += performance.now() - fieldAt;
  const cols = FAR_VIEWS.azimuths;
  const rows = FAR_VIEWS.elevations.length;
  const px = framePx * SUPERSAMPLE;

  // Where the eye stands when this plant turns far, so detail thins as it would there.
  const pxPerRad = renderer.getDrawingBufferSize(new THREE.Vector2()).y / ((FOV * Math.PI) / 180);
  const eyeAt = (2 * radius * pxPerRad) / framePx;
  // Still air, and a shadow map of its own: an unset sampler would read whatever the bake last bound, even the target it draws into.
  const unlit = noShadowMap();
  const light = { uTime: { value: 0 }, uWind: { value: 0 }, uWindDir: { value: new THREE.Vector2(1, 0) }, uNightness: { value: 0 }, uEye: { value: new THREE.Vector3() }, uShadowMap: { value: unlit } };
  const bake = { uBakeCenter: { value: sphere.center.clone() }, uBakeDir: { value: new THREE.Vector3() }, uBakeRadius: { value: radius } };
  const shared = {
    uVitality: { value: 1 },
    // Each slice is baked at rest.
    uVitalityLag: { value: 0 },
    uColorVitality: { value: 1 },
    uDetail: { value: 1 },
    uSeed: { value: 0 },
    uSway: { value: plant.motion.sway },
    uFrequency: { value: plant.motion.frequency },
    uHeight: { value: height },
    uVariety: { value: 0 },
    uTurn: { value: 0 },
  };
  const vert = bakeVert();
  const scene = new THREE.Scene();
  const meshes = parts.map((part) => {
    const swatch = plant.palette.swatches[part.swatch] ?? { healthy: [1, 0, 1], decline: [1, 0, 1] };
    const foliage = FOLIAGE[part.swatch] ?? 0.5;
    const uniforms = {
      ...light,
      ...shared,
      ...bake,
      uFlutter: { value: FLUTTERS.has(part.swatch) ? 1 : 0 },
      uHealthy: { value: new THREE.Vector3(...(swatch.healthy as [number, number, number])) },
      uDecline: { value: new THREE.Vector3(...(swatch.decline as [number, number, number])) },
      ...sprayColors(plant),
      uFoliage: { value: foliage },
      uLamp: { value: 0 },
    };
    const materials = new Map<Output, THREE.ShaderMaterial>();
    for (const output of Object.keys(OUTPUT) as Output[]) {
      materials.set(output, new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: bakeFrag(output), uniforms, side: foliage === 0 ? THREE.FrontSide : THREE.DoubleSide, alphaToCoverage: true }));
    }
    const mesh = new THREE.Mesh(geometryOf(part), materials.get("cover"));
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, materials };
  });

  // One elevation row at a time keeps the multisampled target small.
  const row = new THREE.WebGLRenderTarget(cols * px, px, { depthBuffer: true, type: THREE.UnsignedByteType, samples: 4 });
  row.texture.minFilter = THREE.NearestFilter;
  row.texture.magFilter = THREE.NearestFilter;
  // Mipmaps are made once, when the last chunk is in.
  const layers = [0, 1, 2, 3].map(() => new THREE.WebGLRenderTarget(cols * framePx, rows * framePx, { depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter }));
  const downUniforms = { uSrc: { value: row.texture }, uOrigin: { value: new THREE.Vector2() }, uMap: { value: new THREE.Matrix4() } };
  const down = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT,
    fragmentShader: DOWN_FRAG,
    uniforms: downUniforms,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquation: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), down);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene().add(quad);
  const quadCamera = new THREE.Camera();
  const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 1000, 1000 + 4 * radius + 2);
  camera.position.set(sphere.center.x, sphere.center.y, sphere.center.z + 2 * radius + 1000);
  camera.lookAt(sphere.center);

  const nextFrame = (): Promise<void> => new Promise((resolve) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 0)));
  // Compiling ahead is not enough: each output's first draw into the
  // multisampled target sets up state the GPU builds then, so each is drawn
  // once, one pixel across, a frame apart, before the bake steps.
  const ready = (async (): Promise<void> => {
    for (const output of Object.keys(OUTPUT) as Output[]) {
      for (const m of meshes) m.mesh.material = m.materials.get(output) as THREE.ShaderMaterial;
      await renderer.compileAsync(scene, camera);
    }
    await renderer.compileAsync(quadScene, quadCamera);
    for (const output of Object.keys(OUTPUT) as Output[]) {
      for (const m of meshes) m.mesh.material = m.materials.get(output) as THREE.ShaderMaterial;
      const was = renderer.getRenderTarget();
      row.viewport.set(0, 0, 1, 1);
      row.scissor.set(0, 0, 1, 1);
      row.scissorTest = true;
      renderer.setRenderTarget(row);
      renderer.render(scene, camera);
      row.scissorTest = false;
      renderer.setRenderTarget(was);
      await nextFrame();
    }
  })();

  const free = (): void => {
    row.dispose();
    down.dispose();
    unlit.dispose();
    quad.geometry.dispose();
    for (const m of meshes) {
      m.mesh.geometry.dispose();
      for (const mat of m.materials.values()) mat.dispose();
    }
  };
  let next = -1;
  let done: FarForm | null = null;
  const steps = rows * PASSES.length * cols;
  /** Renders view k (row, pass and azimuth, in that order of nesting), resolving the row into its atlas after its last view; or clears the atlases when k is -1. */
  const view = (k: number): void => {
    if (k < 0) {
      for (const layer of layers) {
        renderer.setRenderTarget(layer);
        renderer.clear(true, false, false);
      }
      return;
    }
    const i = k % cols;
    const pk = Math.floor(k / cols);
    const j = Math.floor(pk / PASSES.length);
    const pass = PASSES[pk % PASSES.length] as Pass;
    shared.uVitality.value = pass.vitality;
    shared.uColorVitality.value = pass.colorVitality;
    for (const m of meshes) m.mesh.material = m.materials.get(pass.output) as THREE.ShaderMaterial;
    if (i === 0) {
      row.scissorTest = false;
      renderer.setRenderTarget(row);
      renderer.clear(true, true, true);
    }
    const dir = farViewDir(i, j);
    camera.position.copy(sphere.center).addScaledVector(dir, 2 * radius + 1000);
    camera.up.set(0, 1, 0);
    camera.lookAt(sphere.center);
    camera.updateMatrixWorld();
    bake.uBakeDir.value.copy(dir);
    light.uEye.value.copy(sphere.center).addScaledVector(dir, eyeAt);
    row.viewport.set(i * px, 0, px, px);
    row.scissor.set(i * px, 0, px, px);
    row.scissorTest = true;
    renderer.setRenderTarget(row);
    renderer.render(scene, camera);
    row.scissorTest = false;
    if (i < cols - 1) return;
    const target = layers[pass.layer] as THREE.WebGLRenderTarget;
    target.viewport.set(0, j * framePx, cols * framePx, framePx);
    downUniforms.uOrigin.value.set(0, j * framePx);
    downUniforms.uMap.value.copy(mapOf(pass.to));
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCamera);
    target.viewport.set(0, 0, cols * framePx, rows * framePx);
  };
  const finish = (): FarForm => {
    // Every chunk is in: make each atlas's mipmaps once.
    const empty = new THREE.Scene();
    for (const layer of layers) {
      layer.texture.generateMipmaps = true;
      renderer.setRenderTarget(layer);
      renderer.render(empty, quadCamera);
    }
    free();
    const bytes = Math.round(cols * framePx * rows * framePx * 4 * layers.length * (4 / 3));
    return {
      bounds: { center: sphere.center.clone(), radius, height },
      bytes,
      ms: spent,
      atlas: { layers: layers.map((l) => l.texture), droop, frame: framePx, sway: plant.motion.sway, frequency: plant.motion.frequency, targets: layers },
      dispose: () => {
        for (const l of layers) l.dispose();
      },
    };
  };
  let cancelled = false;
  return {
    ready,
    step(budgetMs, views = Number.POSITIVE_INFINITY) {
      if (done !== null || cancelled) return done;
      const t0 = performance.now();
      const was = { target: renderer.getRenderTarget(), auto: renderer.autoClear, color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha() };
      renderer.autoClear = false;
      renderer.setClearColor(0x000000, 0);
      let n = 0;
      do {
        view(next);
        next++;
        n++;
      } while (next < steps && n < views && performance.now() - t0 < budgetMs);
      if (next >= steps) done = finish();
      renderer.setRenderTarget(was.target);
      renderer.autoClear = was.auto;
      renderer.setClearColor(was.color, was.alpha);
      spent += performance.now() - t0;
      if (done !== null) (done as { ms: number }).ms = spent;
      return done;
    },
    cancel() {
      if (done !== null || cancelled) return;
      cancelled = true;
      free();
      for (const l of layers) l.dispose();
    },
  };
}

/**
 * The bake's version: a far form stored by an earlier version must be baked
 * again. Bump it whenever what a bake writes, or how a card reads it, changes.
 */
export const FAR_BAKE_VERSION = 8;

/** A far form as plain data, to store: its bounds and motion, and each atlas's full-size level, row by row from the bottom. */
export interface FarFormData {
  readonly version: number;
  readonly bounds: { readonly center: readonly [number, number, number]; readonly radius: number; readonly height: number };
  readonly frame: number;
  readonly sway: number;
  readonly frequency: number;
  readonly droop: DroopField;
  /** Each atlas's width and height in texels. */
  readonly width: number;
  readonly height: number;
  readonly layers: readonly Uint8Array[];
}

/**
 * Reads a baked form back to store it, once, without stalling: each atlas's
 * full-size level only, since its mipmaps are made again on load.
 */
export async function farFormData(renderer: THREE.WebGLRenderer, form: FarForm): Promise<FarFormData> {
  const targets = form.atlas.targets;
  if (targets === undefined) throw new Error("farFormData reads a form just baked; this one was read from storage.");
  const first = targets[0] as THREE.WebGLRenderTarget;
  const width = first.width;
  const height = first.height;
  const layers = await Promise.all(
    targets.map(async (target) => {
      const out = new Uint8Array(width * height * 4);
      await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, out);
      return out;
    }),
  );
  const c = form.bounds.center;
  return { version: FAR_BAKE_VERSION, bounds: { center: [c.x, c.y, c.z], radius: form.bounds.radius, height: form.bounds.height }, frame: form.atlas.frame, sway: form.atlas.sway, frequency: form.atlas.frequency, droop: form.atlas.droop, width, height, layers };
}

/** A far form rebuilt from stored data, its atlases filtered and mipmapped as a bake's are; null when the data is from another version of the bake. */
export function farFormFrom(data: FarFormData): FarForm | null {
  if (data.version !== FAR_BAKE_VERSION) return null;
  // The closures below read only these, so the stored record, its pixels included, is not kept with them.
  const { width, height } = data;
  const layers = data.layers.map((pixels) => {
    const t = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.flipY = false;
    t.needsUpdate = true;
    // Once the GPU holds the atlas, the page lets its own copy go: the form
    // stays in the far store, so nothing is lost but memory, and a copy of
    // every atlas would hold some 300 MB.
    t.onUpdate = () => {
      t.image = { data: null as unknown as Uint8Array, width, height };
      t.onUpdate = null;
    };
    return t;
  });
  const [x, y, z] = data.bounds.center;
  return {
    bounds: { center: new THREE.Vector3(x, y, z), radius: data.bounds.radius, height: data.bounds.height },
    bytes: Math.round(data.width * data.height * 4 * layers.length * (4 / 3)),
    ms: 0,
    atlas: { layers, droop: data.droop, frame: data.frame, sway: data.sway, frequency: data.frequency },
    dispose: () => {
      for (const t of layers) t.dispose();
    },
  };
}

/**
 * When copies turn far, in every pass: across `band` times the size a copy
 * turns far at, its card comes in over its full form; past the band, in a
 * perspective pass, its full form still dissolves under its whole card until
 * its crown has shrunk `leave` times more. Whatever its form, a copy whose
 * crown spans fewer device pixels than `gone.start` dissolves, and by
 * `gone.end` is gone.
 */
export interface FarTurn {
  readonly band: number;
  readonly leave: number;
  readonly gone: { readonly start: number; readonly end: number };
}

/** How far a crown spanning `px` device pixels has dissolved for being too small to see: 0 whole, 1 gone. */
export function goneness(px: number, gone: FarTurn["gone"]): number {
  return Math.min(1, Math.max(0, (gone.start - px) / (gone.start - gone.end)));
}

/**
 * A card's fade over a full form still dissolving under it: whole to the eye,
 * short of 1 only so the card still draws over the full form, as it does
 * inside the band.
 */
const OVER = 1 - 1 / 1024;

/**
 * How far toward its far form a crown spanning `px` device pixels is, where
 * it turns far at `swapPx`: 0 draws the full form alone, 1 the far form alone,
 * and in between the far form over the full one, that far into the band.
 */
export function farness(px: number, swapPx: number, band: number): number {
  const top = swapPx * band;
  if (px >= top) return 0;
  if (px <= swapPx) return 1;
  return (top - px) / (top - swapPx);
}

/**
 * How a copy whose crown spans `px` device pixels on a pass's screen draws,
 * where it turns far at `swapPx`: whether its full form draws, and its card's
 * fade, 0 for no card, below 1 over the full form, and 1 alone. A flat pass
 * (`ortho`, the sun's shadow) keeps the full form only to the band's end; a
 * perspective one keeps it, dissolving, until it spans `swapPx / turn.leave`.
 * A copy spanning `turn.gone.end` pixels or fewer draws in neither form.
 * The woods choose each copy's full form by it, and the card's shader
 * (`FAR_CHOICE_GLSL`) its card, so the two always agree.
 */
export function farChoice(px: number, swapPx: number, turn: FarTurn, ortho: boolean): { full: boolean; card: number } {
  if (px <= turn.gone.end) return { full: false, card: 0 };
  const f = farness(px, swapPx, turn.band);
  const leavePx = ortho ? swapPx : swapPx / turn.leave;
  const full = f < 1 || px > leavePx;
  return { full, card: f > 0 ? (full ? Math.min(f, OVER) : 1) : 0 };
}

/**
 * GLSL twin of `farChoice` and `goneness`, measuring the crown as the woods
 * do: its card's fade for the pass (`uFarPass`: its focal length in device
 * pixels, 0 to draw no card, and 1 for a flat pass), where the form turns far
 * at `swapPx` pixels (0 for never), and in `gone` how far it has dissolved for
 * being too small to see. A crown whose nearest point lies past where the air
 * has dissolved everything into the sky draws no card.
 */
export const FAR_CHOICE_GLSL = /* glsl */ `
uniform vec2 uFarPass;
uniform float uFarBand;
uniform float uFarLeave;
uniform vec2 uFarGone;
float farCard(vec4 crown, float swapPx, out float gone) {
  gone = 0.0;
  float focal = uFarPass.x;
  float d = distance(crown.xyz, uEye);
  if (focal <= 0.0 || d - crown.w >= ${AIR.dissolveEnd.toFixed(1)}) return 0.0;
  bool level = uFarPass.y > 0.5;
  float px = 2.0 * crown.w * focal / (level ? 1.0 : max(d, 1.0));
  if (px <= uFarGone.y) return 0.0;
  gone = clamp((uFarGone.x - px) / (uFarGone.x - uFarGone.y), 0.0, 1.0);
  float top = swapPx * uFarBand;
  if (px >= top) return 0.0;
  float f = px <= swapPx ? 1.0 : (top - px) / (top - swapPx);
  float leavePx = level ? swapPx : swapPx / uFarLeave;
  bool full = f < 1.0 || px > leavePx;
  return full ? min(f, ${OVER.toFixed(10)}) : 1.0;
}
`;

/**
 * Each copy's crown: the center and radius of the plant's built bounds
 * `sphere` (at scale 1, unturned), where the copy stands at its scale, four
 * numbers per copy. A copy's size on screen is measured by it, the same for
 * its full form and its card.
 */
export function crownsOf(spots: readonly InstanceSpot[], sphere: THREE.Sphere): Float32Array {
  const crowns = new Float32Array(spots.length * 4);
  spots.forEach((s, k) => crowns.set([s.x + sphere.center.x * s.scale, s.y + sphere.center.y * s.scale, s.z + sphere.center.z * s.scale, sphere.radius * s.scale], k * 4));
  return crowns;
}

/** How many members' records a row of the members' table holds. */
const MEMBER_ROW = 256;

/**
 * How a card reads its bake: near the size its form turns far at, the coverage remapped from this range to 0 to 1,
 * for a healthy copy and for a bare one at vitality 0 (smaller, the range widens to 0 to 1 over the first mip level);
 * how far toward the sun, in radii, it reads its shadow; and how far toward the eye, in radii, a card drawn over its
 * full form stands.
 */
export const CARD = { coverEdge: [0.25, 0.75], bareEdge: [0.15, 0.65], shadowLift: 0.2, overFull: 0.15 } as const;

const CARD_VERT = /* glsl */ `
attribute vec4 aSpot; // x, y, z, yaw
attribute vec4 aMore; // scale, vitality, seed, and the member the copy belongs to
attribute vec2 aSlope; // the ground's slope under the copy, which shears it as its near form is sheared
attribute vec4 aCrown; // what its size on screen is measured by (crownsOf)
uniform vec3 uEye;
${FAR_CHOICE_GLSL}
uniform float uTime;
uniform float uWind;
// Each member's slot (-1 for none) and whether it shows in this pass, a row of ${MEMBER_ROW} members at a time; and
// each slot's form: its bounds' center and radius, then its height, sway, frequency and the crown span it turns far
// at, then its droop field's scale and reach (DroopField).
uniform highp sampler2D uMembers;
uniform highp sampler2D uSlots;
vec3 formCenter;
float formRadius;
float formHeight;
float formSway;
float formFrequency;
uniform float uElev[${FAR_VIEWS.elevations.length}];
const vec2 GRID = vec2(${FAR_VIEWS.azimuths}.0, ${FAR_VIEWS.elevations.length}.0);
varying vec3 vQ;
varying vec3 vVl;
varying vec4 vCells0;
varying vec4 vCells1;
varying vec4 vW;
varying vec3 vWorld;
varying vec3 vToEye;
varying float vYaw;
varying float vVitality;
varying float vFade;
varying float vGone;
varying float vScale;
flat varying float vSlot;
flat varying float vRadius;
flat varying float vDroop;
${WIND_GLSL}
// The plant shader's per-copy shape variety (applyVariety), at full variety.
vec3 variety(vec3 p, vec3 root) {
  vec3 h = fract(sin(vec3(dot(root.xz, vec2(12.9898, 78.233)), dot(root.xz, vec2(39.346, 11.135)), dot(root.xz, vec2(73.156, 52.235)))) * 43758.5453);
  float up = clamp(p.y / formHeight, 0.0, 1.2);
  float squash = (h.x - 0.5) * 0.26;
  float bulge = 1.0 + 0.09 * sin(atan(p.z, p.x) * 2.0 + h.y * 6.2832) * up;
  vec3 q = vec3(p.x * (1.0 - squash * 0.3) * bulge, p.y * (1.0 + squash), p.z * (1.0 - squash * 0.3) * bulge);
  q.xz += (h.yz - 0.5) * 0.12 * formHeight * up * up;
  return q;
}
mat3 yawMat(float a) { float c = cos(a); float s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
void main() {
  // A copy of a member hidden in this pass, or whose form holds no slot, collapses outside the view and costs nothing more.
  int member = int(aMore.w + 0.5);
  vec4 own = texelFetch(uMembers, ivec2(member % ${MEMBER_ROW}, member / ${MEMBER_ROW}), 0);
  if (own.x < 0.0 || own.y < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  int slot = int(own.x + 0.5);
  vec4 bounds = texelFetch(uSlots, ivec2(slot, 0), 0);
  vec4 motion = texelFetch(uSlots, ivec2(slot, 1), 0);
  vec4 droop = texelFetch(uSlots, ivec2(slot, 2), 0);
  formCenter = bounds.xyz;
  formRadius = bounds.w;
  formHeight = motion.x;
  formSway = motion.y;
  formFrequency = motion.z;
  // Whether this set draws the copy in this pass: the solid set a card standing alone, the fading set one over
  // its full form.
  float gone;
  float fade = farCard(aCrown, motion.w, gone);
#ifdef FADING
  bool drawn = fade > 0.0 && fade < 1.0;
#else
  bool drawn = fade >= 1.0;
#endif
  if (!drawn) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 root = aSpot.xyz;
  float s = aMore.x;
  mat3 R = yawMat(aSpot.w);
  vec3 C = root + R * (formCenter * s);
  vec3 V = normalize(cameraPosition - C);
  vec3 Vl = transpose(R) * V;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), Vl));
  vec3 cu = cross(Vl, right);
  // How far its boughs have sagged, as the plant shader's droop: all the way at vitality 0. Sagging boughs reach
  // past the bounds the views frame, so the card grows to hold them.
  float sag = 1.0 - aMore.y;
  vec3 q = (position.x * right + position.y * cu) * (formRadius + sag * droop.y);
  // The four nearest views: two azimuths by two elevations.
  float gi = mod(atan(Vl.z, Vl.x) / 6.28318530718 * GRID.x, GRID.x);
  float i0 = floor(gi);
  float fi = gi - i0;
  float i1 = mod(i0 + 1.0, GRID.x);
  float el = degrees(asin(clamp(Vl.y, -1.0, 1.0)));
  float j0 = 0.0;
  float fj = 0.0;
  for (int k = 0; k < ${FAR_VIEWS.elevations.length - 1}; k++) {
    if (el >= uElev[k]) { j0 = float(k); fj = clamp((el - uElev[k]) / (uElev[k + 1] - uElev[k]), 0.0, 1.0); }
  }
  float j1 = min(j0 + 1.0, GRID.y - 1.0);
  vW = vec4((1.0 - fi) * (1.0 - fj), fi * (1.0 - fj), (1.0 - fi) * fj, fi * fj);
  vCells0 = vec4(i0, j0, i1, j0);
  vCells1 = vec4(i0, j1, i1, j1);
  vQ = q;
  vVl = Vl;
  // Placed as the near form is: its variety, then the whole plant's bend in the wind.
  vec3 p = variety(formCenter + q, root);
  vec3 wd = transpose(R) * vec3(WIND_DIR.x, 0.0, WIND_DIR.y);
  vec2 along = normalize(wd.xz + vec2(1e-6, 0.0));
  float give = uWind * formSway;
  if (give > 0.0) p = bendUp(p, windLean(WIND_TRUNK, give * trunkGive(formHeight), formFrequency, gustAt(root.xz, uTime), uTime, aMore.z * 6.28318530718, 1.0, 0.0, along), formHeight);
  vec3 world = root + R * (p * s);
  world.y += dot(aSlope, world.xz - root.xz);
  vWorld = world;
  vToEye = V;
  vYaw = aSpot.w;
  vVitality = aMore.y;
  vFade = fade;
  vGone = gone;
  vScale = s;
  vSlot = float(slot);
  vRadius = formRadius;
  vDroop = sag * droop.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

/** What a card shows at a texel: coverage at its vitality, color, normal, foliage, glow and depth, from its form's slot of each atlas. */
const CARD_TAP_GLSL = /* glsl */ `
uniform highp sampler2DArray uLayer0;
uniform highp sampler2DArray uLayer1;
uniform highp sampler2DArray uLayer2;
uniform highp sampler2DArray uLayer3;
uniform highp sampler3D uDroop;
uniform float uDroopSlots;
uniform vec4 uCoverEdge;
uniform float uElev[${FAR_VIEWS.elevations.length}];
const vec2 GRID = vec2(${FAR_VIEWS.azimuths}.0, ${FAR_VIEWS.elevations.length}.0);
varying vec3 vQ;
varying vec3 vVl;
varying vec4 vCells0;
varying vec4 vCells1;
varying vec4 vW;
varying float vVitality;
flat varying float vSlot;
flat varying float vRadius;
flat varying float vDroop;
float formRadius;
// Half a level finer than the mipmaps pick: blending four views already softens the card.
const float LOD_BIAS = -0.5;
// The mip level the atlas is read at (\`atlas\`), from how many of its texels the pixel spans. A form bakes a texel
// to a pixel at the size it turns far at; this is 0 down to about 0.7 of that size and 1 at about a third.
float minified() {
  float frame = float(textureSize(uLayer0, 0).y) / GRID.y;
  float texels = max(length(dFdx(vQ)), length(dFdy(vQ))) * frame / (2.0 * formRadius);
  return max(0.0, log2(max(texels, 1e-6)) + LOD_BIAS);
}
float gLod;
// Read at the card's own scale on screen: where the views' depths move a read across a strand's edge, the step it
// takes would otherwise read a far coarser level there, and a twig's texels would fade into the sky around them.
vec4 atlas(highp sampler2DArray t, vec2 uv) {
  return textureLod(t, vec3(uv, vSlot), gLod);
}
// Where a point p, from the plant's center, moves as its boughs sag as far as this copy's have (DroopField).
vec3 droopAt(vec3 p) {
  float n = float(textureSize(uDroop, 0).x);
  vec3 f = clamp((p / (2.0 * formRadius) + 0.5) * n, 0.5, n - 0.5);
  vec3 cell = vec3(f.xy / n, (vSlot * n + f.z) / (n * uDroopSlots));
  return (texture(uDroop, cell).xyz * 2.0 - 1.0) * vDroop;
}
vec3 viewDir(vec2 cell) {
  float az = 6.28318530718 * cell.x / GRID.x;
  float el = radians(uElev[int(cell.y)]);
  return vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
}
// Where a point p, from the plant's center, falls in a view's frame of the atlas.
vec2 frameUv(vec2 cell, vec3 dir, vec3 p) {
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), dir));
  vec3 up = cross(dir, right);
  vec2 f = vec2(dot(p, right), dot(p, up)) / formRadius * 0.5 + 0.5;
  return (cell + clamp(f, 0.0, 1.0)) / GRID;
}
// The point of the card the views are read through: this one, or where the
// plant stood before its boughs sagged.
vec3 gQ;
// Where the eye's ray through this point of the card meets the plant, as one
// view saw it: the view's depth there moves the point along the ray, so the
// four views line up on the same surface instead of ghosting thin strands.
vec2 seen(vec2 cell) {
  vec3 dir = viewDir(cell);
  vec2 uv = frameUv(cell, dir, gQ);
  vec4 l0 = atlas(uLayer0, uv);
  if (l0.a < 0.05) return uv;
  float d = (atlas(uLayer2, uv).a / l0.a - 0.5) * 2.0 * formRadius;
  float t = (dot(gQ, dir) - d) / max(dot(vVl, dir), 0.3);
  return frameUv(cell, dir, gQ - vVl * t);
}
// Where the eye's ray through this point of the card meets the plant's surface
// near it, as one view saw it, read coarse so it reaches past the healthy
// outline to where a bough has sagged.
vec3 nearAlong(vec2 cell) {
  vec3 dir = viewDir(cell);
  vec3 uvw = vec3(frameUv(cell, dir, vQ), vSlot);
  float lod = max(gLod, 2.5);
  vec4 near = textureLod(uLayer0, uvw, lod);
  float d = near.a > 0.004 ? (textureLod(uLayer2, uvw, lod).a / near.a - 0.5) * 2.0 * formRadius : 0.0;
  return vQ - vVl * ((dot(vQ, dir) - d) / max(dot(vVl, dir), 0.3));
}
// The views hold the plant as it stands healthy. A sagging copy's eye ray
// meets a point the sag has moved there; the point it came from is found from
// the droop field, and the ray is moved across by as much, so every view reads
// the plant where that bough stood. The four views' surfaces are blended as
// their colors are, so the point moves smoothly as the eye does.
void unsag() {
  gQ = vQ;
  if (vDroop <= 0.0) return;
  vec3 at = nearAlong(vCells0.xy) * vW.x + nearAlong(vCells0.zw) * vW.y + nearAlong(vCells1.xy) * vW.z + nearAlong(vCells1.zw) * vW.w;
  vec3 from = at - droopAt(at);
  from = at - droopAt(from);
  vec3 moved = at - from;
  gQ = vQ - (moved - vVl * dot(moved, vVl));
}
vec2 gUv0;
vec2 gUv1;
vec2 gUv2;
vec2 gUv3;
void views() {
  formRadius = vRadius;
  gLod = minified();
  unsag();
  gUv0 = seen(vCells0.xy);
  gUv1 = seen(vCells0.zw);
  gUv2 = seen(vCells1.xy);
  gUv3 = seen(vCells1.zw);
}
vec4 tap(highp sampler2DArray t) {
  return atlas(t, gUv0) * vW.x + atlas(t, gUv1) * vW.y + atlas(t, gUv2) * vW.z + atlas(t, gUv3) * vW.w;
}
// The share of the texel covered at vitality v, between the baked slices at
// ${SLICES.join(", ")}.
float sliceCover(vec4 l0, vec4 l3, float v) {
  if (v >= ${SLICES[1].toFixed(2)}) return mix(l3.r, l0.a, (v - ${SLICES[1].toFixed(2)}) / ${(SLICES[0] - SLICES[1]).toFixed(2)});
  if (v >= ${SLICES[2].toFixed(2)}) return mix(l3.g, l3.r, (v - ${SLICES[2].toFixed(2)}) / ${(SLICES[1] - SLICES[2]).toFixed(2)});
  return mix(l3.b, l3.g, clamp((v - ${SLICES[3].toFixed(2)}) / ${(SLICES[2] - SLICES[3]).toFixed(2)}, 0.0, 1.0));
}
// That share as the card draws it. Near the size the form turns far at, its
// edge is sharpened: blending four views softens it, and a soft edge would
// dither into a halo. A bare tree is mostly twigs finer than a texel, which
// cover only a share of each, so a tree's edge eases as the copy's vitality
// falls (from the set's healthy edge to its bare one) and keeps more of it.
// Smaller on screen, each texel read is a mipmap's average of the plant's
// pieces: a twig, strand or needle finer than a texel is only a share of it,
// which a sharpened edge would cut away, so the card's outer twigs would
// vanish and its crown shrink while the full form's pieces keep covering
// their share. Over the first mip level the edge gives way to the share as
// it is.
float coverAt(vec4 l0, vec4 l3, float v) {
  float c = sliceCover(l0, l3, v);
  vec2 near = mix(uCoverEdge.zw, uCoverEdge.xy, clamp(v, 0.0, 1.0));
  vec2 edge = mix(near, vec2(0.0, 1.0), clamp(minified(), 0.0, 1.0));
  return clamp((c - edge.x) / (edge.y - edge.x), 0.0, 1.0);
}
`;

const CARD_FRAG = /* glsl */ `
precision highp float;
uniform mat4 projectionMatrix;
${LIGHT_GLSL}
${CARD_TAP_GLSL}
uniform float uShadowLift;
varying vec3 vWorld;
varying vec3 vToEye;
varying float vYaw;
varying float vFade;
varying float vGone;
varying float vScale;
void main() {
  views();
  vec4 l0 = tap(uLayer0);
  vec4 l3 = tap(uLayer3);
  float healthy = max(l0.a, 1e-4);
  float cover = coverAt(l0, l3, vVitality);
  if (cover < 0.02) discard;
  vec4 l1 = tap(uLayer1);
  vec4 l2 = tap(uLayer2);
  // Color between healthy (1) and withered (0), as the plant's wither channel mixes it. The withered color is baked
  // where the plant stands at vitality 0; what shows now and is gone by then keeps its healthy color.
  float standing = clamp(l3.b / max(sliceCover(l0, l3, vVitality), 1e-4), 0.0, 1.0);
  vec3 albedo = mix(l0.rgb / healthy, l1.rgb / max(l3.b, 1e-4), (1.0 - vVitality) * standing);
  vec3 nl = normalize(l2.rgb / healthy * 2.0 - 1.0);
  float c = cos(vYaw);
  float s = sin(vYaw);
  vec3 n = normalize(vec3(c * nl.x + s * nl.z, nl.y, -s * nl.x + c * nl.z));
  float uFoliage = l3.a / healthy;
  // The surface lies toward the eye from the card by its baked depth: how far it stood toward the camera that baked
  // its view, as \`seen\` reads it.
  vec3 world = vWorld + vToEye * ((l2.a / healthy - 0.5) * 2.0 * formRadius * vScale);
  // The plant shader's lighting, line for line.
  float nDotL = dot(n, uSunDirection);
  float wrapped = mix(max(nDotL, 0.0), nDotL * 0.5 + 0.5, uFoliage * 0.85);
  // A card's surface is its baked depth, which differs a little from the card the sun saw; read the shadow a little toward the sun, so the tree shadows itself only where the near form would.
  float shadow = mix(0.4 + uFoliage * 0.15, 1.0, sunShadow(world + uSunDirection * formRadius * vScale * uShadowLift, n, 0.0025 + uFoliage * 0.007));
  float light = softCel(wrapped * shadow) * sunUp();
  vec3 toned = nightTone(albedo);
  vec3 lit = toned * (uSunColor * uSunIntensity * light + uAmbientColor * uAmbientIntensity);
  vec3 shadowed = toned * uShadowColor * (uAmbientIntensity + 0.75);
  vec3 color = mix(shadowed, lit, clamp(light + 0.35 + uFoliage * 0.12, 0.0, 1.0));
  vec3 toEye = normalize(cameraPosition - world);
  float back = pow(clamp(dot(-toEye, uSunDirection), 0.0, 1.0), 4.0) * uFoliage * 0.22 * shadow * min(uSunIntensity, 1.0);
  color += albedo * uSunColor * back;
  float moonBack = pow(clamp(dot(-toEye, uMoonDirection), 0.0, 1.0), 3.0) * uFoliage * 0.5 * uMoonIntensity;
  color += nightTone(albedo) * uMoonColor * moonBack;
  color += nightLight(albedo, n, world, uFoliage * 0.85, mix(1.0, shadow, uMoonShadow));
  vec3 glow = l0.rgb / healthy * (l1.a / healthy) * vVitality * (1.0 + uNightness * 0.6);
  // Too small to see, a card dissolves through its coverage as the full form leaves.
  gl_FragColor = vec4(aerial(shoulder(color), world) + glow * (1.0 - uNightness * 0.35), cover * vFade * (1.0 - vGone));
  // Its depth is the baked surface's, so what stands in front of the tree hides it as the near form would.
  vec3 depthAt = world;
#ifdef FADING
  // While its full form still draws, the card draws over it: its surface is the views' blend of the full form's, a
  // little off it, and where the full form's pieces won that test they showed through the card in a scatter. Brought
  // toward the eye by a little of the crown's radius, the card covers its own full form, and anything standing
  // farther in front still hides it.
  depthAt += vToEye * ${CARD.overFull.toFixed(2)} * formRadius * vScale;
#endif
  vec4 clip = projectionMatrix * viewMatrix * vec4(depthAt, 1.0);
  gl_FragDepth = clamp(0.5 + 0.5 * clip.z / clip.w, 0.0, 1.0);
}
`;

const CARD_DEPTH_FRAG = /* glsl */ `
precision highp float;
uniform mat4 projectionMatrix;
${CARD_TAP_GLSL}
varying vec3 vWorld;
varying vec3 vToEye;
varying float vScale;
void main() {
  views();
  vec4 l0 = tap(uLayer0);
  if (coverAt(l0, tap(uLayer3), vVitality) < 0.5) discard;
  vec4 l2 = tap(uLayer2);
  vec3 world = vWorld + vToEye * ((l2.a / max(l0.a, 1e-4) - 0.5) * 2.0 * formRadius * vScale);
  vec4 clip = projectionMatrix * viewMatrix * vec4(world, 1.0);
  gl_FragDepth = clamp(0.5 + 0.5 * clip.z / clip.w, 0.0, 1.0);
  gl_FragColor = vec4(1.0);
}
`;

/** One plant's copies among a set's cards: in buffers written when the copies are placed, read by every pass. */
export interface FarCopies {
  /**
   * Stands the copies, `PLACE_STRIDE` numbers each in `places`: where (x, y, z), yaw,
   * scale, vitality, seed and the ground's slope (`placesOf`), and four in `crowns` (`crownsOf`).
   * The set keeps both arrays and stands the copies from them again whenever it packs its copies anew.
   */
  place(places: Float32Array, crowns: Float32Array): void;
  /** Sets copy `index`'s vitality, which its card shows. */
  setVitalityAt(index: number, v: number): void;
  /** Swaps to the depth material for the sun's shadow: a card standing alone casts, one inside the band does not. */
  useDepth(on: boolean): void;
  /** The slot whose form the copies' cards show, or -1 while their form holds none: then they draw no card. */
  slot: number;
  dispose(): void;
}

/** How many numbers each copy takes in `placesOf`; its shown vitality is the sixth. */
export const PLACE_STRIDE = 9;

/** Each copy as its card draws it: where it stands (x, y, z), its yaw, scale, vitality and seed, and the ground's slope under it. */
export function placesOf(spots: readonly InstanceSpot[]): Float32Array {
  const places = new Float32Array(spots.length * PLACE_STRIDE);
  spots.forEach((s, k) => places.set([s.x, s.y, s.z, s.yaw, s.scale, shownVitality(s.vitality ?? 1), copySeed(s), s.slope?.[0] ?? 0, s.slope?.[1] ?? 0], k * PLACE_STRIDE));
  return places;
}

/**
 * A set's far cards: a fixed number of slots, each holding one far form's
 * atlases (every level, exactly as baked) in a texture array, and every
 * plant's copies in one batch that draws them all, one draw for the solid
 * cards and one for those fading in, whatever forms they show.
 */
export interface FarCards {
  /** The batch's meshes, to add to the scene once. */
  readonly object: THREE.Group;
  /** How many forms it holds at once: as many as it was made with, or fewer once `fit`. */
  readonly slots: number;
  /** GPU memory the slots take, bytes, once a form has filled one; 0 before. */
  readonly bytes: number;
  /** Holds room for no more than `count` forms, never more than it was made with: a world standing fewer takes no memory for the rest. Only before the first `fill`. */
  fit(count: number): void;
  /**
   * Copies `form`'s atlases, every mip level, into `slot`: all four, or only
   * atlas `layer`, so a form read from storage can upload one atlas a frame.
   * The form's own textures are the caller's to dispose of after.
   */
  fill(renderer: THREE.WebGLRenderer, slot: number, form: FarForm, layer?: number): void;
  /** The crown span, in device pixels, at which copies shown from `slot` turn far: 0 draws none of their cards. */
  turnAt(slot: number, swapPx: number): void;
  /** One plant's copies, whose cards show while `anchor` and every object above it are visible. */
  copies(anchor: THREE.Object3D): FarCopies;
  /**
   * For the pass about to render: its focal length in device pixels, the
   * crown span in pixels of a meter one meter away (or of a meter, for a
   * flat pass), 0 to draw no card; and whether it is flat, as the sun's
   * shadow is. Each plant's copies show in it as their anchor is visible.
   */
  pass(focal: number, ortho: boolean): void;
  /** Shows or hides every card, for seeing what they draw. */
  show(on: boolean): void;
  /** Shows the batch's meshes until the next pass, so a compile or a warming render readies their shaders. */
  warm(): void;
  dispose(): void;
}

/** One plant's copies as the set holds them: its row in the members' table and its stretch of the copies' buffers. */
interface Member {
  readonly index: number;
  readonly anchor: THREE.Object3D;
  places: Float32Array;
  crowns: Float32Array;
  count: number;
  /** Where its copies start in the buffers, and how many they have room for there. */
  offset: number;
  room: number;
  slot: number;
  depth: boolean;
  /** Whether its copies showed in the last pass, as the members' table holds it. */
  shown: boolean;
  /** Copies whose vitality is easing in, by their index among the member's copies. */
  readonly easing: Map<number, { shown: number; lag: number; target: number }>;
}

/** Whether `o` draws: it and every object above it visible. */
const visibleUp = (o: THREE.Object3D): boolean => {
  for (let a: THREE.Object3D | null = o; a !== null; a = a.parent) if (!a.visible) return false;
  return true;
};

/**
 * How many mip levels of each atlas a set's slots hold, for views `frame`
 * texels across: a copy draws no card once its crown spans `gone` device
 * pixels, and a card that small reads its atlas `log2(frame / gone)` levels
 * down (\`minified\` in its shader), so no card reads the levels past that.
 */
export const farLevels = (frame: number, gone: number): number => Math.max(1, Math.min(Math.floor(Math.log2(FAR_VIEWS.azimuths * frame)) + 1, Math.ceil(Math.log2(frame / gone)) + 1));

/** GPU memory a set's slots take for views `frame` texels across: each slot's four atlases at `farLevels` levels and its droop field. */
export function farSlotBytes(frame: number, gone: number, slots: number): number {
  let texels = 0;
  for (let level = 0; level < farLevels(frame, gone); level++) texels += ((FAR_VIEWS.azimuths * frame) >> level) * ((FAR_VIEWS.elevations.length * frame) >> level);
  return slots * (texels * 4 * 4 + DROOP_CELLS ** 3 * 4);
}

/**
 * A set's cards, holding `slots` forms at once, each turning far by `turn`.
 * Near the swap they sharpen a bare copy's coverage by `bareEdge` and a
 * healthy one's by `CARD.coverEdge`: trees take `CARD.bareEdge`, since a bare
 * tree is mostly twigs finer than a texel; by default a bare copy sharpens as
 * a healthy one does.
 */
export function createFarCards(light: SceneLight, turn: FarTurn, most: number, bareEdge: readonly [number, number] = CARD.coverEdge): FarCards {
  if (!(most >= 1)) throw new Error(`A set of far cards holds at least one form; it was given ${most} slots.`);
  let slots = most;
  const card = new THREE.PlaneGeometry(2, 2, 1, 5);
  const pass = { uFarPass: { value: new THREE.Vector2(0, 0) }, uFarBand: { value: turn.band }, uFarLeave: { value: turn.leave }, uFarGone: { value: new THREE.Vector2(turn.gone.start, turn.gone.end) } };
  // Each slot's form: row 0 its bounds' center and radius, row 1 its height, sway, frequency and the span it turns far
  // at, row 2 its droop field's scale and reach.
  let slotData = new Float32Array(slots * 3 * 4);
  let slotTable = new THREE.DataTexture(slotData, slots, 3, THREE.RGBAFormat, THREE.FloatType);
  slotTable.needsUpdate = true;
  // Each member's slot and whether it shows; member 0 is nobody's, for room no copy stands in.
  let memberRows = 1;
  let memberData = new Float32Array(MEMBER_ROW * memberRows * 4).fill(0);
  memberData[0] = -1;
  const tableOf = (data: Float32Array, rows: number): THREE.DataTexture => {
    const t = new THREE.DataTexture(data, MEMBER_ROW, rows, THREE.RGBAFormat, THREE.FloatType);
    t.needsUpdate = true;
    return t;
  };
  let memberTable = tableOf(memberData, memberRows);
  const uniforms = {
    ...light,
    ...pass,
    uMembers: { value: memberTable },
    uSlots: { value: slotTable },
    uLayer0: { value: null as THREE.Texture | null },
    uLayer1: { value: null as THREE.Texture | null },
    uLayer2: { value: null as THREE.Texture | null },
    uLayer3: { value: null as THREE.Texture | null },
    uDroop: { value: null as THREE.Texture | null },
    uDroopSlots: { value: slots },
    uElev: { value: [...FAR_VIEWS.elevations] },
    uCoverEdge: { value: new THREE.Vector4(CARD.coverEdge[0], CARD.coverEdge[1], bareEdge[0], bareEdge[1]) },
    uShadowLift: { value: CARD.shadowLift },
  };
  const solidMaterial = new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: CARD_FRAG, uniforms, side: THREE.DoubleSide, alphaToCoverage: true });
  const fadingMaterial = new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: CARD_FRAG, uniforms, defines: { FADING: "" }, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  const depthMaterial = new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: CARD_DEPTH_FRAG, uniforms, side: THREE.DoubleSide });

  // Both meshes read the same copies; three fixes how many an instanced geometry may draw when it is first bound, so
  // outgrowing it takes a new geometry, never new attributes.
  const geometryFor = (room: number): THREE.InstancedBufferGeometry => {
    const g = new THREE.InstancedBufferGeometry();
    g.index = card.index;
    g.setAttribute("position", card.getAttribute("position"));
    g.setAttribute("aSpot", new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, room) * 4), 4));
    g.setAttribute("aMore", new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, room) * 4), 4));
    g.setAttribute("aSlope", new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, room) * 2), 2));
    g.setAttribute("aCrown", new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, room) * 4), 4));
    g.instanceCount = 0;
    return g;
  };
  let capacity = 0;
  let geometry = geometryFor(capacity);
  const solid = new THREE.Mesh(geometry, solidMaterial);
  const fading = new THREE.Mesh(geometry, fadingMaterial);
  const object = new THREE.Group();
  for (const mesh of [solid, fading]) {
    // The vertex shader places every card, and collapses those it does not draw: the mesh's bounds mean nothing.
    mesh.frustumCulled = false;
    object.add(mesh);
  }
  fading.renderOrder = 2;
  let shownOn = true;
  /** Whether any member's copies show in this pass, and how many members draw the sun's depth. */
  let anyShown = false;
  let depths = 0;
  const showMeshes = (): void => {
    solid.visible = shownOn && anyShown;
    fading.visible = shownOn && anyShown && depths === 0;
    solid.material = depths > 0 ? depthMaterial : solidMaterial;
  };
  showMeshes();

  /** The atlases' texture arrays and the slots' droop fields, made when the first form fills a slot, sized by its atlases. */
  let layers: THREE.DataArrayTexture[] | null = null;
  let droop: THREE.Data3DTexture | null = null;
  let frame = 0;
  const members: Member[] = [];
  let nextIndex = 1;
  const freeIndices: number[] = [];

  const attribute = (name: string): THREE.InstancedBufferAttribute => geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
  const writeRecord = (m: Member): void => {
    const at = m.index * 4;
    memberData[at] = m.slot;
    memberData[at + 1] = m.shown ? 1 : 0;
    memberTable.needsUpdate = true;
  };
  /** Writes member `m`'s copies into its stretch of the buffers, the rest of its room standing for nobody. */
  const writeCopies = (m: Member): void => {
    const spot = attribute("aSpot");
    const more = attribute("aMore");
    const slope = attribute("aSlope");
    const crown = attribute("aCrown");
    for (let k = 0; k < m.room; k++) {
      const i = m.offset + k;
      if (k >= m.count) {
        more.array.fill(0, i * 4, i * 4 + 4);
        continue;
      }
      const at = k * PLACE_STRIDE;
      spot.array.set(m.places.subarray(at, at + 4), i * 4);
      more.array.set(m.places.subarray(at + 4, at + 7), i * 4);
      more.array[i * 4 + 3] = m.index;
      slope.array.set(m.places.subarray(at + 7, at + 9), i * 2);
      crown.array.set(m.crowns.subarray(k * 4, k * 4 + 4), i * 4);
    }
    for (const [k, e] of m.easing) if (k < m.count) more.array[(m.offset + k) * 4 + 1] = e.shown + 0.5 * e.lag;
    for (const a of [spot, more, slope, crown]) a.needsUpdate = true;
  };
  /** Packs every member's copies afresh, each with room to grow, in a geometry large enough to hold them. */
  const pack = (): void => {
    let total = 0;
    for (const m of members) {
      m.offset = total;
      total += m.room;
    }
    if (total > capacity) {
      capacity = Math.ceil(total * 1.25);
      geometry.dispose();
      geometry = geometryFor(capacity);
      solid.geometry = geometry;
      fading.geometry = geometry;
    }
    for (const m of members) writeCopies(m);
    geometry.instanceCount = total;
  };
  /** A member's index in the table, growing the table a row at a time. */
  const takeIndex = (): number => {
    const index = freeIndices.pop() ?? nextIndex++;
    if (index >= MEMBER_ROW * memberRows) {
      memberRows++;
      const grown = new Float32Array(MEMBER_ROW * memberRows * 4);
      grown.set(memberData);
      memberData = grown;
      memberTable.dispose();
      memberTable = tableOf(memberData, memberRows);
      uniforms.uMembers.value = memberTable;
    }
    return index;
  };

  return {
    object,
    get slots() {
      return slots;
    },
    fit(count) {
      if (layers !== null) throw new Error("A set's far cards are fitted before any form fills a slot.");
      slots = Math.max(1, Math.min(most, Math.floor(count)));
      slotData = new Float32Array(slots * 3 * 4);
      slotTable.dispose();
      slotTable = new THREE.DataTexture(slotData, slots, 3, THREE.RGBAFormat, THREE.FloatType);
      slotTable.needsUpdate = true;
      uniforms.uSlots.value = slotTable;
      uniforms.uDroopSlots.value = slots;
    },
    get bytes() {
      return layers === null ? 0 : farSlotBytes(frame, turn.gone.end, slots);
    },
    fill(renderer, slot, form, layer) {
      if (!(slot >= 0 && slot < slots)) throw new Error(`No slot ${slot}; the set holds ${slots}.`);
      const width = FAR_VIEWS.azimuths * form.atlas.frame;
      const height = FAR_VIEWS.elevations.length * form.atlas.frame;
      if (layers === null) {
        frame = form.atlas.frame;
        const levels = farLevels(frame, turn.gone.end);
        layers = [uniforms.uLayer0, uniforms.uLayer1, uniforms.uLayer2, uniforms.uLayer3].map((uniform) => {
          const array = new THREE.DataArrayTexture(null, width, height, slots);
          array.minFilter = THREE.LinearMipmapLinearFilter;
          array.magFilter = THREE.LinearFilter;
          array.generateMipmaps = false;
          // Storage for the levels a card reads, each copied from a form's own, never made from level 0: three gives an
          // array as many levels as its mipmaps, and with no data ready it only makes room for them.
          array.mipmaps = Array.from({ length: levels }, (_, level) => ({ data: new Uint8Array(0), width: Math.max(1, width >> level), height: Math.max(1, height >> level) }));
          array.source.dataReady = false;
          array.needsUpdate = true;
          renderer.initTexture(array);
          uniform.value = array;
          return array;
        });
        droop = new THREE.Data3DTexture(new Uint8Array(DROOP_CELLS ** 3 * 4 * slots).fill(128), DROOP_CELLS, DROOP_CELLS, DROOP_CELLS * slots);
        droop.minFilter = THREE.LinearFilter;
        droop.magFilter = THREE.LinearFilter;
        droop.unpackAlignment = 1;
        droop.needsUpdate = true;
        uniforms.uDroop.value = droop;
      }
      if (form.atlas.frame !== frame) throw new Error(`A set's far forms all bake at one size; this one is ${form.atlas.frame} texels a view, the set's ${frame}.`);
      const levels = farLevels(frame, turn.gone.end);
      const at = new THREE.Vector3(0, 0, slot);
      form.atlas.layers.forEach((source, l) => {
        if (layer !== undefined && l !== layer) return;
        // A form read from storage uploads here, its mipmaps made as a bake's are.
        renderer.initTexture(source);
        const array = (layers as THREE.DataArrayTexture[])[l] as THREE.DataArrayTexture;
        for (let level = 0; level < levels; level++) {
          const region = new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(Math.max(1, width >> level), Math.max(1, height >> level)));
          renderer.copyTextureToTexture(source, array, region, at, level, level);
        }
      });
      if (layer === undefined || layer === 0) {
        const field = droop as THREE.Data3DTexture;
        (field.image.data as Uint8Array).set(form.atlas.droop.cells, slot * DROOP_CELLS ** 3 * 4);
        field.needsUpdate = true;
      }
      const c = form.bounds.center;
      slotData.set([c.x, c.y, c.z, form.bounds.radius], slot * 4);
      slotData.set([form.bounds.height, form.atlas.sway, form.atlas.frequency], (slots + slot) * 4);
      slotData.set([form.atlas.droop.scale, form.atlas.droop.reach], (2 * slots + slot) * 4);
      slotTable.needsUpdate = true;
    },
    turnAt(slot, swapPx) {
      const at = (slots + slot) * 4 + 3;
      if (slotData[at] === swapPx) return;
      slotData[at] = swapPx;
      slotTable.needsUpdate = true;
    },
    copies(anchor) {
      const m: Member = { index: takeIndex(), anchor, places: new Float32Array(0), crowns: new Float32Array(0), count: 0, offset: 0, room: 0, slot: -1, depth: false, shown: false, easing: new Map() };
      members.push(m);
      writeRecord(m);
      // A copy whose vitality changes eases in as its near form does (`followVitality`), its card showing the middle
      // of what the near form averages over: where it shows now, how far that lags, and where it is going.
      const close = (keep: number): boolean => {
        const more = attribute("aMore");
        for (const [k, e] of m.easing) {
          [e.shown, e.lag] = followVitality(e.shown, e.lag, e.target, keep);
          if (k < m.count) more.array[(m.offset + k) * 4 + 1] = e.shown + 0.5 * e.lag;
          if (e.shown === e.target && e.lag === 0) m.easing.delete(k);
        }
        more.needsUpdate = true;
        return m.easing.size > 0;
      };
      return {
        place(places, crowns) {
          m.places = places;
          m.crowns = crowns;
          m.count = places.length / PLACE_STRIDE;
          // Copies stood anew show their vitality at rest.
          m.easing.clear();
          if (m.count > m.room) {
            m.room = Math.ceil(m.count * 1.25);
            pack();
          } else writeCopies(m);
        },
        setVitalityAt(index, v) {
          const shown = attribute("aMore").array[(m.offset + index) * 4 + 1] as number;
          const from = m.easing.get(index) ?? { shown, lag: 0, target: 0 };
          m.easing.set(index, { ...from, target: shownVitality(v) });
          closeEachFrame(close);
        },
        useDepth(on) {
          if (on === m.depth) return;
          m.depth = on;
          depths += on ? 1 : -1;
          showMeshes();
        },
        get slot() {
          return m.slot;
        },
        set slot(s: number) {
          if (s === m.slot) return;
          m.slot = s;
          writeRecord(m);
        },
        dispose() {
          const k = members.indexOf(m);
          if (k < 0) return;
          members.splice(k, 1);
          if (m.depth) depths--;
          m.slot = -1;
          m.shown = false;
          writeRecord(m);
          freeIndices.push(m.index);
          pack();
          showMeshes();
        },
      };
    },
    pass(focal, ortho) {
      pass.uFarPass.value.set(focal, ortho ? 1 : 0);
      anyShown = false;
      for (const m of members) {
        const shown = m.slot >= 0 && m.count > 0 && visibleUp(m.anchor);
        if (shown !== m.shown) {
          m.shown = shown;
          writeRecord(m);
        }
        anyShown ||= shown;
      }
      showMeshes();
    },
    show(on) {
      shownOn = on;
      showMeshes();
    },
    warm() {
      anyShown = true;
      showMeshes();
    },
    dispose() {
      geometry.dispose();
      card.dispose();
      for (const m of [solidMaterial, fadingMaterial, depthMaterial]) m.dispose();
      slotTable.dispose();
      memberTable.dispose();
      for (const l of layers ?? []) l.dispose();
      droop?.dispose();
      object.removeFromParent();
    },
  };
}
