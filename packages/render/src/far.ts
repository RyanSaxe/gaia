// Far forms: a tree far enough away to cover few pixels draws as one card
// instead of its thousands of triangles. `bakeFarForm` renders the plant
// with its own shaders from many directions into atlases of what its
// fragments are made of: color healthy and withered, normal, depth, glow,
// foliage, and how much of each texel it covers at four vitalities. A card
// (`createFarCards`) faces the eye, blends the four nearest views, cuts and
// colors them at its copy's vitality and lights them with the scene's own
// light, so a far tree keeps its shape, health, sway and night. Which copies
// draw far, and how far into the band each is, is the woods' choice
// (app/renderer/terrain/woods.ts). After the World session's proof.

import * as THREE from "three";
import type { Part } from "@gaia/schema";
import { FLUTTERS, type Realized, mergeParts } from "@gaia/realize";
import { LIGHT_GLSL, type SceneLight } from "./light.ts";
import { FOLIAGE, PLANT_FRAG, PLANT_VERT, geometryOf, sprayColors } from "./plant.ts";
import { WIND_GLSL } from "./sway.ts";

/** Where the views look from: azimuths all the way round, at these elevations in degrees, crowded where a walker sees far trees. */
export const FAR_VIEWS = { azimuths: 16, elevations: [-8, 0, 8, 18, 34, 60] } as const;
/** The vitalities whose coverage is baked: color comes from 1 and 0, and coverage between them is interpolated. */
const SLICES = [1, 0.6, 0.3, 0.1] as const;
/** Samples per texel along each side while baking, on top of 4x multisampling: one keeps the bake's GPU work small. */
const SUPERSAMPLE = 1;
/** The world's field of view, degrees: where a tree turns far depends on how many pixels a radian covers. */
const FOV = 58;

/** One tree build, baked. */
export interface FarForm {
  /** The plant's bounds where it stands, unscaled and unturned: the woods size a copy on screen from these. */
  readonly bounds: { readonly center: THREE.Vector3; readonly radius: number; readonly height: number };
  /** GPU memory its atlases take, bytes, mipmaps included. */
  readonly bytes: number;
  /** How long the bake took, milliseconds. */
  readonly ms: number;
  /** @internal The card's textures and motion. */
  readonly atlas: { readonly layers: readonly THREE.Texture[]; readonly frame: number; readonly sway: number; readonly frequency: number };
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
  s = swap(s, "vWither = aWither * (1.0 - uVitality);", "vWither = aWither * (1.0 - uColorVitality);");
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
 * 0.1, and foliage.
 */
const PASSES: readonly Pass[] = [
  { output: "cover", vitality: 1, colorVitality: 1, layer: 0, to: [3, -1, -1, -1] },
  { output: "albedo", vitality: 1, colorVitality: 1, layer: 0, to: [0, 1, 2, -1] },
  { output: "albedo", vitality: 0.1, colorVitality: 0, layer: 1, to: [0, 1, 2, -1] },
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
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const part of parts) {
    const p = part.positions;
    for (let i = 0; i < p.length; i += 3) box.expandByPoint(point.set(p[i] as number, p[i + 1] as number, p[i + 2] as number));
  }
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const height = Math.max(0.3, box.max.y);
  // Padding for the wind's bend and pieces growing toward a pixel.
  const radius = sphere.radius * 1.04;
  const cols = FAR_VIEWS.azimuths;
  const rows = FAR_VIEWS.elevations.length;
  const px = framePx * SUPERSAMPLE;

  // Where the eye stands when this plant turns far, so detail thins as it would there.
  const pxPerRad = renderer.getDrawingBufferSize(new THREE.Vector2()).y / ((FOV * Math.PI) / 180);
  const eyeAt = (2 * radius * pxPerRad) / framePx;
  // Still air, and a shadow map of its own: an unset sampler would read whatever the bake last bound, even the target it draws into.
  const unlit = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  unlit.needsUpdate = true;
  const light = { uTime: { value: 0 }, uWind: { value: 0 }, uWindDir: { value: new THREE.Vector2(1, 0) }, uNightness: { value: 0 }, uEye: { value: new THREE.Vector3() }, uShadowMap: { value: unlit } };
  const bake = { uBakeCenter: { value: sphere.center.clone() }, uBakeDir: { value: new THREE.Vector3() }, uBakeRadius: { value: radius } };
  const shared = {
    uVitality: { value: 1 },
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
      atlas: { layers: layers.map((l) => l.texture), frame: framePx, sway: plant.motion.sway, frequency: plant.motion.frequency },
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

/** Bakes `plant` into its far form at once (`startFarBake`, stepped to the end). */
export function bakeFarForm(renderer: THREE.WebGLRenderer, plant: Realized, framePx = 128): FarForm {
  const bake = startFarBake(renderer, plant, framePx);
  let form: FarForm | null = null;
  while (form === null) form = bake.step(Number.POSITIVE_INFINITY);
  return form;
}

const CARD_VERT = /* glsl */ `
attribute vec4 aSpot; // x, y, z, yaw
attribute vec4 aMore; // scale, vitality, seed, fade
uniform float uTime;
uniform float uWind;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uHeight;
uniform float uSway;
uniform float uFrequency;
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
varying float vScale;
${WIND_GLSL}
// The plant shader's per-copy shape variety (applyVariety), at full variety.
vec3 variety(vec3 p, vec3 root) {
  vec3 h = fract(sin(vec3(dot(root.xz, vec2(12.9898, 78.233)), dot(root.xz, vec2(39.346, 11.135)), dot(root.xz, vec2(73.156, 52.235)))) * 43758.5453);
  float up = clamp(p.y / uHeight, 0.0, 1.2);
  float squash = (h.x - 0.5) * 0.26;
  float bulge = 1.0 + 0.09 * sin(atan(p.z, p.x) * 2.0 + h.y * 6.2832) * up;
  vec3 q = vec3(p.x * (1.0 - squash * 0.3) * bulge, p.y * (1.0 + squash), p.z * (1.0 - squash * 0.3) * bulge);
  q.xz += (h.yz - 0.5) * 0.12 * uHeight * up * up;
  return q;
}
mat3 yawMat(float a) { float c = cos(a); float s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
void main() {
  vec3 root = aSpot.xyz;
  float s = aMore.x;
  mat3 R = yawMat(aSpot.w);
  vec3 C = root + R * (uCenter * s);
  vec3 V = normalize(cameraPosition - C);
  vec3 Vl = transpose(R) * V;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), Vl));
  vec3 cu = cross(Vl, right);
  vec3 q = (position.x * right + position.y * cu) * uRadius;
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
  vec3 p = variety(uCenter + q, root);
  vec3 wd = transpose(R) * vec3(WIND_DIR.x, 0.0, WIND_DIR.y);
  vec2 along = normalize(wd.xz + vec2(1e-6, 0.0));
  float give = uWind * uSway;
  if (give > 0.0) p = bendUp(p, windLean(WIND_TRUNK, give * trunkGive(uHeight), uFrequency, gustAt(root.xz, uTime), uTime, aMore.z * 6.28318530718, 1.0, 0.0, along), uHeight);
  vec3 world = root + R * (p * s);
  vWorld = world;
  vToEye = V;
  vYaw = aSpot.w;
  vVitality = aMore.y;
  vFade = aMore.w;
  vScale = s;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

/** What a card shows at a texel: coverage at its vitality, color, normal, foliage, glow and depth. */
const CARD_TAP_GLSL = /* glsl */ `
uniform sampler2D uLayer0;
uniform sampler2D uLayer1;
uniform sampler2D uLayer2;
uniform sampler2D uLayer3;
uniform float uRadius;
uniform vec2 uCoverEdge;
uniform float uElev[${FAR_VIEWS.elevations.length}];
const vec2 GRID = vec2(${FAR_VIEWS.azimuths}.0, ${FAR_VIEWS.elevations.length}.0);
varying vec3 vQ;
varying vec3 vVl;
varying vec4 vCells0;
varying vec4 vCells1;
varying vec4 vW;
varying float vVitality;
vec3 viewDir(vec2 cell) {
  float az = 6.28318530718 * cell.x / GRID.x;
  float el = radians(uElev[int(cell.y)]);
  return vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
}
// Where a point p, from the plant's center, falls in a view's frame of the atlas.
vec2 frameUv(vec2 cell, vec3 dir, vec3 p) {
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), dir));
  vec3 up = cross(dir, right);
  vec2 f = vec2(dot(p, right), dot(p, up)) / uRadius * 0.5 + 0.5;
  return (cell + clamp(f, 0.0, 1.0)) / GRID;
}
// Where the eye's ray through this point of the card meets the plant, as one
// view saw it: the view's depth there moves the point along the ray, so the
// four views line up on the same surface instead of ghosting thin strands.
vec2 seen(vec2 cell) {
  vec3 dir = viewDir(cell);
  vec2 uv = frameUv(cell, dir, vQ);
  vec4 l0 = texture2D(uLayer0, uv, -0.5);
  if (l0.a < 0.05) return uv;
  float d = (texture2D(uLayer2, uv, -0.5).a / l0.a - 0.5) * 2.0 * uRadius;
  float t = (dot(vQ, dir) - d) / max(dot(vVl, dir), 0.3);
  return frameUv(cell, dir, vQ - vVl * t);
}
vec2 gUv0;
vec2 gUv1;
vec2 gUv2;
vec2 gUv3;
void views() {
  gUv0 = seen(vCells0.xy);
  gUv1 = seen(vCells0.zw);
  gUv2 = seen(vCells1.xy);
  gUv3 = seen(vCells1.zw);
}
// Half a level finer than the mipmaps pick: blending four views already softens the card.
vec4 tap(sampler2D t) {
  return texture2D(t, gUv0, -0.5) * vW.x + texture2D(t, gUv1, -0.5) * vW.y + texture2D(t, gUv2, -0.5) * vW.z + texture2D(t, gUv3, -0.5) * vW.w;
}
// The share of the texel covered at vitality v, between the baked slices at
// 1, 0.6, 0.3 and 0.1, its edge sharpened: blending four views and their
// mipmaps softens it, and a soft edge would dither into a halo.
float coverAt(vec4 l0, vec4 l3, float v) {
  float c;
  if (v >= 0.6) c = mix(l3.r, l0.a, (v - 0.6) / 0.4);
  else if (v >= 0.3) c = mix(l3.g, l3.r, (v - 0.3) / 0.3);
  else c = mix(l3.b, l3.g, clamp((v - 0.1) / 0.2, 0.0, 1.0));
  return clamp((c - uCoverEdge.x) / (uCoverEdge.y - uCoverEdge.x), 0.0, 1.0);
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
  // Color between healthy (1) and withered (0), as the plant's wither channel mixes it.
  vec3 albedo = mix(l0.rgb / healthy, l1.rgb / max(l3.b, 1e-4), 1.0 - vVitality);
  vec3 nl = normalize(l2.rgb / healthy * 2.0 - 1.0);
  float c = cos(vYaw);
  float s = sin(vYaw);
  vec3 n = normalize(vec3(c * nl.x + s * nl.z, nl.y, -s * nl.x + c * nl.z));
  float uFoliage = l3.a / healthy;
  // The surface lies in front of or behind the card by its baked depth.
  vec3 world = vWorld - vToEye * ((l2.a / healthy - 0.5) * 2.0 * uRadius * vScale);
  // The plant shader's lighting, line for line.
  float nDotL = dot(n, uSunDirection);
  float wrapped = mix(max(nDotL, 0.0), nDotL * 0.5 + 0.5, uFoliage * 0.85);
  // A card's surface is its baked depth, which differs a little from the card the sun saw; read the shadow a little toward the sun, so the tree shadows itself only where the near form would.
  float shadow = mix(0.4 + uFoliage * 0.15, 1.0, sunShadow(world + uSunDirection * uRadius * vScale * uShadowLift, 0.0025 + uFoliage * 0.007));
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
  gl_FragColor = vec4(aerial(shoulder(color), world) + glow * (1.0 - uNightness * 0.35), cover * vFade);
  // Its depth is the baked surface's, so what stands in front of the tree hides it as the near form would.
  vec4 clip = projectionMatrix * viewMatrix * vec4(world, 1.0);
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
  vec3 world = vWorld - vToEye * ((l2.a / max(l0.a, 1e-4) - 0.5) * 2.0 * uRadius * vScale);
  vec4 clip = projectionMatrix * viewMatrix * vec4(world, 1.0);
  gl_FragDepth = clamp(0.5 + 0.5 * clip.z / clip.w, 0.0, 1.0);
  gl_FragColor = vec4(1.0);
}
`;

/** How a card reads its bake: the coverage remapped from this range to 0 to 1, and how far toward the sun, in radii, it reads its shadow. */
export const CARD = { coverEdge: [0.25, 0.75], shadowLift: 0.2 } as const;

/** Floats per copy given to `draw`: form, x, y, z, yaw, scale, vitality, seed, fade. */
export const FAR_COPY = 9;

/** Every far form's cards, drawn instanced, one solid and one fading set per form. */
export interface FarCards {
  readonly object: THREE.Group;
  /**
   * Draws `count` copies laid out `FAR_COPY` floats each in `copies`: the
   * form's index, where it stands (x, y, z), its yaw, scale, vitality and
   * seed, and its fade, 1 when wholly far and below 1 inside the band, where
   * the card draws over its near form, that much of it.
   */
  draw(copies: Float32Array, count: number): void;
  /** Swaps every card to its depth material for the shadow pass, and back. */
  useDepth(on: boolean): void;
  dispose(): void;
}

export function createFarCards(forms: readonly FarForm[], light: SceneLight): FarCards {
  const object = new THREE.Group();
  const card = new THREE.PlaneGeometry(2, 2, 1, 5);
  const sets = forms.map((form) => {
    const sides = [false, true].map((fading) => {
      // A geometry holds room for so many copies; three fixes how many an
      // instanced geometry may draw when it is first bound, so outgrowing it
      // takes a new geometry, never new attributes on the old one.
      const geometryFor = (room: number): THREE.InstancedBufferGeometry => {
        const g = new THREE.InstancedBufferGeometry();
        g.index = card.index;
        g.setAttribute("position", card.getAttribute("position"));
        g.setAttribute("aSpot", new THREE.InstancedBufferAttribute(new Float32Array(room * 4), 4));
        g.setAttribute("aMore", new THREE.InstancedBufferAttribute(new Float32Array(room * 4), 4));
        g.instanceCount = 0;
        return g;
      };
      let capacity = 16;
      const [l0, l1, l2, l3] = form.atlas.layers;
      const uniforms = {
        ...light,
        uLayer0: { value: l0 },
        uLayer1: { value: l1 },
        uLayer2: { value: l2 },
        uLayer3: { value: l3 },
        uCenter: { value: form.bounds.center },
        uRadius: { value: form.bounds.radius },
        uHeight: { value: form.bounds.height },
        uSway: { value: form.atlas.sway },
        uFrequency: { value: form.atlas.frequency },
        uElev: { value: [...FAR_VIEWS.elevations] },
        uCoverEdge: { value: new THREE.Vector2(CARD.coverEdge[0], CARD.coverEdge[1]) },
        uShadowLift: { value: CARD.shadowLift },
      };
      const color = new THREE.ShaderMaterial({
        vertexShader: CARD_VERT,
        fragmentShader: CARD_FRAG,
        uniforms,
        side: THREE.DoubleSide,
        ...(fading ? { transparent: true, depthWrite: false } : { alphaToCoverage: true }),
      });
      const depth = new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: CARD_DEPTH_FRAG, uniforms, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometryFor(capacity), color);
      mesh.frustumCulled = false;
      if (fading) mesh.renderOrder = 2;
      object.add(mesh);
      return {
        mesh,
        color,
        depth,
        fading,
        fill(list: readonly number[], copies: Float32Array): void {
          if (list.length > capacity) {
            capacity = Math.ceil(list.length * 1.25);
            mesh.geometry.dispose();
            mesh.geometry = geometryFor(capacity);
          }
          const geometry = mesh.geometry as THREE.InstancedBufferGeometry;
          const a = geometry.getAttribute("aSpot") as THREE.InstancedBufferAttribute;
          const b = geometry.getAttribute("aMore") as THREE.InstancedBufferAttribute;
          list.forEach((c, k) => {
            const o = c * FAR_COPY;
            a.array.set([copies[o + 1] as number, copies[o + 2] as number, copies[o + 3] as number, copies[o + 4] as number], k * 4);
            b.array.set([copies[o + 5] as number, copies[o + 6] as number, copies[o + 7] as number, copies[o + 8] as number], k * 4);
          });
          a.needsUpdate = true;
          b.needsUpdate = true;
          geometry.instanceCount = list.length;
        },
      };
    });
    return sides;
  });
  return {
    object,
    draw(copies, count) {
      const lists = forms.map(() => [[] as number[], [] as number[]]);
      for (let c = 0; c < count; c++) {
        const form = copies[c * FAR_COPY] as number;
        const fade = copies[c * FAR_COPY + 8] as number;
        const list = lists[form];
        if (list === undefined) throw new Error(`draw was given form ${form}, and there are ${forms.length}.`);
        (list[fade < 1 ? 1 : 0] as number[]).push(c);
      }
      sets.forEach((sides, f) => sides.forEach((side, k) => side.fill((lists[f] as number[][])[k] as number[], copies)));
    },
    useDepth(on) {
      // Inside the band the near form still casts the shadow, so a fading card casts none.
      for (const sides of sets) {
        for (const side of sides) {
          side.mesh.material = on ? side.depth : side.color;
          side.mesh.visible = !(on && side.fading);
        }
      }
    },
    dispose() {
      card.dispose();
      for (const sides of sets) {
        for (const side of sides) {
          side.mesh.geometry.dispose();
          side.color.dispose();
          side.depth.dispose();
        }
      }
    },
  };
}
