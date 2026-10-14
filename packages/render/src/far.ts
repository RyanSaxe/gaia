// Far forms: a tree far enough away to cover few pixels draws as one card
// instead of its thousands of triangles. `bakeFarForm` renders the plant
// with its own shaders from many directions into atlases of what its
// fragments are made of: color healthy and withered, normal, depth, glow,
// foliage, and how much of each texel it covers at four vitalities. A card
// (`createFarCards`) faces the eye, blends the four nearest views, cuts and
// colors them at its copy's vitality and lights them with the scene's own
// light, so a far tree keeps its shape, health, sway and night. Each copy's
// card stands in buffers written once, when the copies are placed
// (`FarCopies`); every pass the card's vertex shader measures the copy's
// crown on that pass's screen and draws it far, fading over its full form,
// or not at all, by the same rule the woods choose the full form by
// (`farChoice`, and its twin `FAR_CHOICE_GLSL`). After the World session's proof.

import * as THREE from "three";
import type { Part } from "@gaia/schema";
import { AIR, FLUTTERS, type Realized, mergeParts } from "@gaia/realize";
import type { InstanceSpot } from "./instances.ts";
import { copySeed } from "./instances.ts";
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
  /** @internal The card's textures and motion, and the targets the bake drew them into (none for a form read from storage). */
  readonly atlas: { readonly layers: readonly THREE.Texture[]; readonly frame: number; readonly sway: number; readonly frequency: number; readonly targets?: readonly THREE.WebGLRenderTarget[] };
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

/**
 * What a bake pass writes for each fragment, into up to three targets at
 * once, through alpha-to-coverage on the first's alpha, so a texel resolves
 * to each value times the share it covers. A target written 1.0 resolves to
 * the share itself.
 */
const OUTPUT = {
  // At vitality 1: color and coverage; coverage, glow, foliage and depth; normal.
  healthy: [
    "gl_FragColor = vec4(albedo, cover);",
    "pc_fragColor1 = vec4(1.0, clamp(vGlow, 0.0, 1.0), uFoliage, clamp(0.5 + dot(vWorld - uBakeCenter, uBakeDir) / (2.0 * uBakeRadius), 0.0, 1.0));",
    "pc_fragColor2 = vec4(n * 0.5 + 0.5, 1.0);",
  ].join("\n  "),
  // At the last slice: the withered color, and coverage.
  withered: ["gl_FragColor = vec4(albedo, cover);", "pc_fragColor1 = vec4(1.0);"].join("\n  "),
  cover: "gl_FragColor = vec4(1.0, 1.0, 1.0, cover);",
} as const;
type Output = keyof typeof OUTPUT;
/** Targets the bake's row draws into at once. */
const TARGETS = 3;

/** The plant's vertex shader with its color's vitality apart from its shape's, and droop left out so every slice nests inside the healthy outline. */
function bakeVert(): string {
  let s = swap(PLANT_VERT, "void main() {", "uniform float uColorVitality;\nvec3 bakeKeep(vec3 p, vec3 joint) { return p; }\nvoid main() {");
  s = swap(s, "vWither = aWither * (1.0 - uVitality);", "vWither = aWither * (1.0 - uColorVitality);");
  s = swap(s, "vec3 p = applyDroop(", "vec3 p = bakeKeep(");
  return s;
}

/** The plant's fragment shader, writing one layer instead of lit color, with leaves merging as they would on screen at the swap. */
function bakeFrag(output: Output): string {
  let s = swap(PLANT_FRAG, "void main() {", "uniform vec3 uBakeCenter;\nuniform vec3 uBakeDir;\nuniform float uBakeRadius;\nlayout(location = 1) out highp vec4 pc_fragColor1;\nlayout(location = 2) out highp vec4 pc_fragColor2;\nvoid main() {");
  // A bake texel is a fraction of a screen pixel at the swap: leaves merge as they would on screen there.
  s = swap(s, "float px = max(sqrt(abs(dx.x * dy.y - dx.y * dy.x) * 2.0), 1e-4);", `float px = max(sqrt(abs(dx.x * dy.y - dx.y * dy.x) * 2.0) * ${SUPERSAMPLE}.0, 1e-4);`);
  s = swap(s, "gl_FragColor = vec4(aerial(shoulder(color), vWorld) + glow * (1.0 - uNightness * 0.35), cover);", OUTPUT[output]);
  return s;
}

const QUAD_VERT = "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }";
/**
 * Resolves a pass's three targets into all four layers of a stage at once:
 * each layer the sum of each target through its matrix (`uMap[layer * 3 +
 * target]`), so one draw does what a draw per destination did.
 */
const DOWN_ALL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uSrc0;
uniform sampler2D uSrc1;
uniform sampler2D uSrc2;
uniform vec2 uOrigin;
uniform mat4 uMap[12];
layout(location = 1) out highp vec4 pc_fragColor1;
layout(location = 2) out highp vec4 pc_fragColor2;
layout(location = 3) out highp vec4 pc_fragColor3;
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy - uOrigin);
  vec4 s0 = texelFetch(uSrc0, at, 0);
  vec4 s1 = texelFetch(uSrc1, at, 0);
  vec4 s2 = texelFetch(uSrc2, at, 0);
  gl_FragColor = uMap[0] * s0 + uMap[1] * s1 + uMap[2] * s2;
  pc_fragColor1 = uMap[3] * s0 + uMap[4] * s1 + uMap[5] * s2;
  pc_fragColor2 = uMap[6] * s0 + uMap[7] * s1 + uMap[8] * s2;
  pc_fragColor3 = uMap[9] * s0 + uMap[10] * s1 + uMap[11] * s2;
}`;
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

/** Where one of a pass's targets goes: into which atlas layer, each source channel (r, g, b, a) into which of its channels, or -1 to drop it. */
interface Into {
  readonly target: number;
  readonly layer: number;
  readonly to: readonly [number, number, number, number];
}

/** A pass: what it draws, at which vitality, and where each of its targets goes. */
interface Pass {
  readonly output: Output;
  readonly vitality: number;
  readonly colorVitality: number;
  readonly into: readonly Into[];
}

/**
 * Four RGBA layers, every value premultiplied by the share of the texel the
 * healthy plant covers (or, for the withered color, the share at the last
 * slice): 0 healthy color and coverage at 1; 1 withered color (at the last
 * slice's shape) and glow; 2 normal and depth; 3 coverage at 0.6, 0.3 and
 * 0.1, and foliage.
 */
const PASSES: readonly Pass[] = [
  {
    output: "healthy",
    vitality: 1,
    colorVitality: 1,
    into: [
      { target: 0, layer: 0, to: [0, 1, 2, -1] },
      { target: 1, layer: 0, to: [3, -1, -1, -1] },
      { target: 1, layer: 1, to: [-1, 3, -1, -1] },
      { target: 1, layer: 3, to: [-1, -1, 3, -1] },
      { target: 1, layer: 2, to: [-1, -1, -1, 3] },
      { target: 2, layer: 2, to: [0, 1, 2, -1] },
    ],
  },
  {
    output: "withered",
    vitality: SLICES[3],
    colorVitality: 0,
    into: [
      { target: 0, layer: 1, to: [0, 1, 2, -1] },
      { target: 1, layer: 3, to: [2, -1, -1, -1] },
    ],
  },
  { output: "cover", vitality: SLICES[1], colorVitality: 1, into: [{ target: 0, layer: 3, to: [0, -1, -1, -1] }] },
  { output: "cover", vitality: SLICES[2], colorVitality: 1, into: [{ target: 0, layer: 3, to: [1, -1, -1, -1] }] },
];

const mapOf = (to: Into["to"]): THREE.Matrix4 => {
  const m = new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  to.forEach((dest, src) => {
    if (dest >= 0) m.elements[src * 4 + dest] = 1;
  });
  return m;
};
/** Each pass's twelve matrices for resolving into a stage's four layers at once (`DOWN_ALL_FRAG`). */
const STAGE_MAPS = new Map<Pass, THREE.Matrix4[]>(
  PASSES.map((pass) => {
    const maps = Array.from({ length: 12 }, () => new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
    for (const into of pass.into) {
      const m = maps[into.layer * 3 + into.target] as THREE.Matrix4;
      const add = mapOf(into.to);
      for (let n = 0; n < 16; n++) (m.elements[n] as number) += add.elements[n] as number;
    }
    return [pass, maps];
  }),
);

/** A far form being baked a little at a time, so a loading screen keeps painting. */
export interface FarBake {
  /** Resolves once every shader the bake uses has compiled, in parallel where the browser can. */
  readonly ready: Promise<void>;
  /**
   * Bakes up to `views` views (of 384: 96 directions in four passes), fewer
   * if `budgetMs` passes first; the form when the last is done, else null.
   * The GPU work a view queues is not counted in the budget, so `views`
   * bounds what a frame takes on the GPU.
   */
  step(budgetMs: number, views?: number): FarForm | null;
  /** Stops and frees everything, if it has not finished. */
  cancel(): void;
}

/** What every bake of one plant draws with: its meshes in each output, the camera and a multisampled row of `tiles` views of up to `framePx` texels. */
interface BakeRig {
  readonly sphere: THREE.Sphere;
  readonly radius: number;
  readonly height: number;
  /** Resolves once every shader the bake uses has compiled, and each output has drawn once into the row. */
  readonly ready: Promise<void>;
  /** Clears the row, color and depth. */
  clearRow(): void;
  /** Draws pass `pass` of view (i, j) into tile `tile` of the row, `size` texels across (`framePx` when omitted). */
  draw(i: number, j: number, pass: Pass, tile: number, size?: number): void;
  /** Resolves `tiles` tiles of the row, from tile `from`, into the four `layers` at texel (x, y), each target where `pass` sends it; each `size` texels across. */
  resolve(pass: Pass, layers: readonly THREE.WebGLRenderTarget[], from: number, tiles: number, x: number, y: number, size?: number): void;
  /** Resolves the row's first tile into the four layers of `stage` (`farViewStage`) at texel (x, y) in one draw, `size` texels across. */
  resolveStage(pass: Pass, stage: THREE.WebGLRenderTarget, x: number, y: number, size: number): void;
  free(): void;
}

function bakeRig(renderer: THREE.WebGLRenderer, plant: Realized, framePx: number, tiles: number): BakeRig {
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
  const px = framePx * SUPERSAMPLE;

  // Where the eye stands when this plant turns far, so detail thins as it would there.
  const pxPerRad = renderer.getDrawingBufferSize(new THREE.Vector2()).y / ((FOV * Math.PI) / 180);
  // A view `size` texels across sees the plant from where it spans that many pixels.
  const eyeAt = (size: number): number => (2 * radius * pxPerRad) / size;
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
  const row = new THREE.WebGLRenderTarget(tiles * px, px, { depthBuffer: true, type: THREE.UnsignedByteType, samples: 4, count: TARGETS });
  for (const texture of row.textures) {
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
  }
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
  const allUniforms = { uSrc0: { value: row.textures[0] }, uSrc1: { value: row.textures[1] }, uSrc2: { value: row.textures[2] }, uOrigin: { value: new THREE.Vector2() }, uMap: { value: [] as THREE.Matrix4[] } };
  const downAll = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: DOWN_ALL_FRAG, uniforms: allUniforms, depthTest: false, depthWrite: false, blending: down.blending, blendSrc: down.blendSrc, blendDst: down.blendDst, blendEquation: down.blendEquation, blendSrcAlpha: down.blendSrcAlpha, blendDstAlpha: down.blendDstAlpha });
  const quadAll = new THREE.Mesh(quad.geometry, downAll);
  quadAll.frustumCulled = false;
  const stageScene = new THREE.Scene().add(quadAll);
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

  return {
    sphere,
    radius,
    height,
    ready,
    clearRow() {
      row.scissorTest = false;
      renderer.setRenderTarget(row);
      renderer.clear(true, true, true);
    },
    draw(i, j, pass, tile, size = framePx) {
      shared.uVitality.value = pass.vitality;
      shared.uColorVitality.value = pass.colorVitality;
      for (const m of meshes) m.mesh.material = m.materials.get(pass.output) as THREE.ShaderMaterial;
      const dir = farViewDir(i, j);
      camera.position.copy(sphere.center).addScaledVector(dir, 2 * radius + 1000);
      camera.up.set(0, 1, 0);
      camera.lookAt(sphere.center);
      camera.updateMatrixWorld();
      bake.uBakeDir.value.copy(dir);
      light.uEye.value.copy(sphere.center).addScaledVector(dir, eyeAt(size));
      const at = size * SUPERSAMPLE;
      row.viewport.set(tile * at, 0, at, at);
      row.scissor.set(tile * at, 0, at, at);
      row.scissorTest = true;
      renderer.setRenderTarget(row);
      renderer.render(scene, camera);
      row.scissorTest = false;
    },
    resolve(pass, layers, from, count, x, y, size = framePx) {
      downUniforms.uOrigin.value.set(x - from * size, y);
      for (const into of pass.into) {
        const target = layers[into.layer] as THREE.WebGLRenderTarget;
        const was = target.viewport.clone();
        target.viewport.set(x, y, count * size, size);
        downUniforms.uSrc.value = row.textures[into.target] as THREE.Texture;
        downUniforms.uMap.value.copy(mapOf(into.to));
        renderer.setRenderTarget(target);
        renderer.render(quadScene, quadCamera);
        target.viewport.copy(was);
      }
    },
    resolveStage(pass, stage, x, y, size) {
      const was = stage.viewport.clone();
      stage.viewport.set(x, y, size, size);
      allUniforms.uOrigin.value.set(x, y);
      allUniforms.uMap.value = STAGE_MAPS.get(pass) as THREE.Matrix4[];
      renderer.setRenderTarget(stage);
      renderer.render(stageScene, quadCamera);
      stage.viewport.copy(was);
    },
    free() {
      row.dispose();
      down.dispose();
      downAll.dispose();
      unlit.dispose();
      quad.geometry.dispose();
      for (const m of meshes) {
        m.mesh.geometry.dispose();
        for (const mat of m.materials.values()) mat.dispose();
      }
    },
  };
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
  const cols = FAR_VIEWS.azimuths;
  const rows = FAR_VIEWS.elevations.length;
  const rig = bakeRig(renderer, plant, framePx, cols);
  // Mipmaps are made once, when the last chunk is in.
  const layers = [0, 1, 2, 3].map(() => new THREE.WebGLRenderTarget(cols * framePx, rows * framePx, { depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter }));
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
    if (i === 0) rig.clearRow();
    rig.draw(i, j, pass, i);
    if (i < cols - 1) return;
    rig.resolve(pass, layers, 0, cols, 0, j * framePx);
  };
  const finish = (): FarForm => {
    // Every chunk is in: make each atlas's mipmaps once.
    const empty = new THREE.Scene();
    const camera = new THREE.Camera();
    for (const layer of layers) {
      layer.texture.generateMipmaps = true;
      renderer.setRenderTarget(layer);
      renderer.render(empty, camera);
    }
    rig.free();
    const bytes = Math.round(cols * framePx * rows * framePx * 4 * layers.length * (4 / 3));
    return {
      bounds: { center: rig.sphere.center.clone(), radius: rig.radius, height: rig.height },
      bytes,
      ms: spent,
      atlas: { layers: layers.map((l) => l.texture), frame: framePx, sway: plant.motion.sway, frequency: plant.motion.frequency, targets: layers },
      dispose: () => {
        for (const l of layers) l.dispose();
      },
    };
  };
  let cancelled = false;
  return {
    ready: rig.ready,
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
      rig.free();
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

/**
 * One plant's own views, baked one at a time at any size up to `maxPx`
 * texels, each seen as `startFarBake` sees it, into a tile of four layers laid
 * out as a far form's atlas is: what a copy's own far views are made of
 * (`createFarCards`).
 */
export interface FarViews {
  /** Resolves once every shader the bake uses has compiled. */
  readonly ready: Promise<void>;
  /** Bakes view (i, j), `size` texels square, into the tile at texel (x, y) of `stage`'s four layers (`farViewStage`), which it clears first. */
  bake(i: number, j: number, size: number, stage: THREE.WebGLRenderTarget, x: number, y: number): void;
  dispose(): void;
}

/** Starts baking single views of `plant`, up to `maxPx` texels across. */
export function startFarViews(renderer: THREE.WebGLRenderer, plant: Realized, maxPx: number): FarViews {
  const rig = bakeRig(renderer, plant, maxPx, 1);
  return {
    ready: rig.ready,
    bake(i, j, size, stage, x, y) {
      if (size > maxPx) throw new Error(`A view of ${size} texels is larger than the ${maxPx} these views bake at most.`);
      const was = { target: renderer.getRenderTarget(), auto: renderer.autoClear, color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha() };
      renderer.autoClear = false;
      renderer.setClearColor(0x000000, 0);
      // Each pass adds its channels into the tile, so the tile starts empty in every layer.
      stage.scissor.set(x, y, size, size);
      stage.scissorTest = true;
      renderer.setRenderTarget(stage);
      renderer.clear(true, false, false);
      stage.scissorTest = false;
      for (const pass of PASSES) {
        rig.clearRow();
        rig.draw(i, j, pass, 0, size);
        rig.resolveStage(pass, stage, x, y, size);
      }
      renderer.setRenderTarget(was.target);
      renderer.autoClear = was.auto;
      renderer.setClearColor(was.color, was.alpha);
    },
    dispose: () => rig.free(),
  };
}

/** A stage for single views to bake into: one target of `width` by `height` texels with a far form's four layers. */
export function farViewStage(width: number, height: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, { depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, count: 4 });
}

/** Four layers of `width` by `height` texels, as a far form's atlas has, for views to bake or be copied into. */
export function farViewLayers(width: number, height: number): THREE.WebGLRenderTarget[] {
  return [0, 1, 2, 3].map(() => new THREE.WebGLRenderTarget(width, height, { depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
}

/**
 * The bake's version: a far form stored by an earlier version must be baked
 * again. Bump it whenever what a bake writes, or how a card reads it, changes.
 */
export const FAR_BAKE_VERSION = 2;

/** A far form as plain data, to store: its bounds and motion, and each atlas's full-size level, row by row from the bottom. */
export interface FarFormData {
  readonly version: number;
  readonly bounds: { readonly center: readonly [number, number, number]; readonly radius: number; readonly height: number };
  readonly frame: number;
  readonly sway: number;
  readonly frequency: number;
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
  return { version: FAR_BAKE_VERSION, bounds: { center: [c.x, c.y, c.z], radius: form.bounds.radius, height: form.bounds.height }, frame: form.atlas.frame, sway: form.atlas.sway, frequency: form.atlas.frequency, width, height, layers };
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
    atlas: { layers, frame: data.frame, sway: data.sway, frequency: data.frequency },
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
 * at `uFarSwap` pixels, and in `gone` how far it has dissolved for being too
 * small to see. A crown whose nearest point lies past where the air has
 * dissolved everything into the sky draws no card.
 */
export const FAR_CHOICE_GLSL = /* glsl */ `
uniform vec2 uFarPass;
uniform float uFarSwap;
uniform float uFarBand;
uniform float uFarLeave;
uniform vec2 uFarGone;
float farCard(vec4 crown, out float gone) {
  gone = 0.0;
  float focal = uFarPass.x;
  float d = distance(crown.xyz, uEye);
  if (focal <= 0.0 || d - crown.w >= ${AIR.dissolveEnd.toFixed(1)}) return 0.0;
  bool level = uFarPass.y > 0.5;
  float px = 2.0 * crown.w * focal / (level ? 1.0 : max(d, 1.0));
  if (px <= uFarGone.y) return 0.0;
  gone = clamp((uFarGone.x - px) / (uFarGone.x - uFarGone.y), 0.0, 1.0);
  float top = uFarSwap * uFarBand;
  if (px >= top) return 0.0;
  float f = px <= uFarSwap ? 1.0 : (top - px) / (top - uFarSwap);
  float leavePx = level ? uFarSwap : uFarSwap / uFarLeave;
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

const CARD_VERT = /* glsl */ `
attribute vec4 aSpot; // x, y, z, yaw
attribute vec4 aMore; // scale, vitality, seed
attribute vec4 aCrown; // what its size on screen is measured by (crownsOf)
attribute vec4 aOwnA; // its own views: x, y of their 2 by 2 tiles in the own atlas, in texels; a tile's size; which tiles hold their view (bits 1, 2, 4, 8)
attribute vec4 aOwnB; // the azimuths its two columns of tiles hold, and the elevations its two rows hold
uniform vec3 uEye;
${FAR_CHOICE_GLSL}
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
varying float vGone;
varying float vScale;
varying float vOwn;
varying vec4 vTiles0;
varying vec4 vTiles1;
varying float vTileSize;
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
// Whether the copy's own tiles hold view (i, j), and where its tile is.
float ownTile(float i, float j, out vec2 tile) {
  float c = abs(i - aOwnB.x) < 0.5 ? 0.0 : abs(i - aOwnB.y) < 0.5 ? 1.0 : -1.0;
  float r = abs(j - aOwnB.z) < 0.5 ? 0.0 : abs(j - aOwnB.w) < 0.5 ? 1.0 : -1.0;
  tile = aOwnA.xy + vec2(max(c, 0.0), max(r, 0.0)) * aOwnA.z;
  if (c < 0.0 || r < 0.0) return 0.0;
  return mod(floor(aOwnA.w / exp2(c + 2.0 * r)), 2.0);
}
void main() {
  // Whether this set draws the copy in this pass: the solid set a card standing alone, the fading set one over
  // its full form. Any other copy collapses outside the view and costs nothing more.
  float gone;
  float fade = farCard(aCrown, gone);
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
  // Drawn from its own views when it holds any of the four: a view still baking gives its weight to the rest.
  vOwn = 0.0;
  vTiles0 = vec4(0.0);
  vTiles1 = vec4(0.0);
  vTileSize = aOwnA.z;
  if (aOwnA.w > 0.5) {
    vec2 t0;
    vec2 t1;
    vec2 t2;
    vec2 t3;
    vec4 held = vec4(ownTile(i0, j0, t0), ownTile(i1, j0, t1), ownTile(i0, j1, t2), ownTile(i1, j1, t3));
    vec4 w = vW * held;
    float sum = w.x + w.y + w.z + w.w;
    if (sum > 1e-3) {
      vW = w / sum;
      vOwn = 1.0;
      vTiles0 = vec4(t0, t1);
      vTiles1 = vec4(t2, t3);
    }
  }
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
  vFade = fade;
  vGone = gone;
  vScale = s;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

/**
 * What a card shows at a texel: coverage at its vitality, color, normal,
 * foliage, glow and depth, read from its form's atlas, or from the copy's own
 * views in the own atlas when it holds them.
 */
const CARD_TAP_GLSL = /* glsl */ `
uniform sampler2D uLayer0;
uniform sampler2D uLayer1;
uniform sampler2D uLayer2;
uniform sampler2D uLayer3;
uniform sampler2D uOwn0;
uniform sampler2D uOwn1;
uniform sampler2D uOwn2;
uniform sampler2D uOwn3;
uniform vec2 uOwnSize;
varying float vOwn;
varying vec4 vTiles0;
varying vec4 vTiles1;
varying float vTileSize;
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
bool gOwn;
// One layer at uv, of the own atlas or the form's. Half a level finer than the form's mipmaps pick: blending four
// views already softens the card. The own atlas has no mipmaps: its tiles are about a texel to a pixel.
vec4 at0(vec2 uv) { return gOwn ? texture2D(uOwn0, uv) : texture2D(uLayer0, uv, -0.5); }
vec4 at1(vec2 uv) { return gOwn ? texture2D(uOwn1, uv) : texture2D(uLayer1, uv, -0.5); }
vec4 at2(vec2 uv) { return gOwn ? texture2D(uOwn2, uv) : texture2D(uLayer2, uv, -0.5); }
vec4 at3(vec2 uv) { return gOwn ? texture2D(uOwn3, uv) : texture2D(uLayer3, uv, -0.5); }
// Where a point p, from the plant's center, falls in a view's frame: the cell's in the form's atlas, or its tile's.
vec2 frameUv(vec2 cell, vec2 tile, vec3 dir, vec3 p) {
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), dir));
  vec3 up = cross(dir, right);
  vec2 f = clamp(vec2(dot(p, right), dot(p, up)) / uRadius * 0.5 + 0.5, 0.0, 1.0);
  return gOwn ? (tile + f * vTileSize) / uOwnSize : (cell + f) / GRID;
}
// Where the eye's ray through this point of the card meets the plant, as one
// view saw it: the view's depth there moves the point along the ray, so the
// four views line up on the same surface instead of ghosting thin strands.
vec2 seen(vec2 cell, vec2 tile) {
  vec3 dir = viewDir(cell);
  vec2 uv = frameUv(cell, tile, dir, vQ);
  vec4 l0 = at0(uv);
  if (l0.a < 0.05) return uv;
  float d = (at2(uv).a / l0.a - 0.5) * 2.0 * uRadius;
  float t = (dot(vQ, dir) - d) / max(dot(vVl, dir), 0.3);
  return frameUv(cell, tile, dir, vQ - vVl * t);
}
vec2 gUv0;
vec2 gUv1;
vec2 gUv2;
vec2 gUv3;
void views() {
  gOwn = vOwn > 0.5;
  gUv0 = seen(vCells0.xy, vTiles0.xy);
  gUv1 = seen(vCells0.zw, vTiles0.zw);
  gUv2 = seen(vCells1.xy, vTiles1.xy);
  gUv3 = seen(vCells1.zw, vTiles1.zw);
}
vec4 tap0() { return at0(gUv0) * vW.x + at0(gUv1) * vW.y + at0(gUv2) * vW.z + at0(gUv3) * vW.w; }
vec4 tap1() { return at1(gUv0) * vW.x + at1(gUv1) * vW.y + at1(gUv2) * vW.z + at1(gUv3) * vW.w; }
vec4 tap2() { return at2(gUv0) * vW.x + at2(gUv1) * vW.y + at2(gUv2) * vW.z + at2(gUv3) * vW.w; }
vec4 tap3() { return at3(gUv0) * vW.x + at3(gUv1) * vW.y + at3(gUv2) * vW.z + at3(gUv3) * vW.w; }
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
varying float vGone;
varying float vScale;
void main() {
  views();
  vec4 l0 = tap0();
  vec4 l3 = tap3();
  float healthy = max(l0.a, 1e-4);
  float cover = coverAt(l0, l3, vVitality);
  if (cover < 0.02) discard;
  vec4 l1 = tap1();
  vec4 l2 = tap2();
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
  // Too small to see, a card dissolves through its coverage as the full form leaves.
  gl_FragColor = vec4(aerial(shoulder(color), world) + glow * (1.0 - uNightness * 0.35), cover * vFade * (1.0 - vGone));
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
  vec4 l0 = tap0();
  if (coverAt(l0, tap3(), vVitality) < 0.5) discard;
  vec4 l2 = tap2();
  vec3 world = vWorld - vToEye * ((l2.a / max(l0.a, 1e-4) - 0.5) * 2.0 * uRadius * vScale);
  vec4 clip = projectionMatrix * viewMatrix * vec4(world, 1.0);
  gl_FragDepth = clamp(0.5 + 0.5 * clip.z / clip.w, 0.0, 1.0);
  gl_FragColor = vec4(1.0);
}
`;

/** How a card reads its bake: the coverage remapped from this range to 0 to 1, and how far toward the sun, in radii, it reads its shadow. */
export const CARD = { coverEdge: [0.25, 0.75], shadowLift: 0.2 } as const;

/** Every copy of one plant that turns far, as its form's cards: in buffers written when the copies are placed, read by every pass. */
export interface FarCopies {
  /** The solid and the fading set's meshes: to add where the copies' full forms stand, so hiding them hides their cards. */
  readonly object: THREE.Group;
  /**
   * Stands the copies, seven numbers each in `places`: where (x, y, z), yaw,
   * scale, vitality and seed (`placesOf`), and four in `crowns` (`crownsOf`).
   */
  place(places: Float32Array, crowns: Float32Array, own?: Float32Array): void;
  /** Sets copy `index`'s vitality, which its card shows. */
  setVitalityAt(index: number, v: number): void;
  /**
   * Sets copy `index`'s own views, eight numbers (`OwnViews`): where its tiles
   * stand in the own atlas, their size and which hold their view, then the
   * azimuths and elevations they hold. A copy holding none draws its form's
   * card. `own` in `place` holds every copy's eight.
   */
  setOwn(index: number, own: ArrayLike<number>): void;
  /** Swaps to the depth material for the sun's shadow: a card standing alone casts, one inside the band does not. */
  useDepth(on: boolean): void;
  dispose(): void;
}

/** Each copy as its card draws it, seven numbers per copy: where it stands (x, y, z), its yaw, scale, vitality and seed. */
export function placesOf(spots: readonly InstanceSpot[]): Float32Array {
  const places = new Float32Array(spots.length * 7);
  spots.forEach((s, k) => places.set([s.x, s.y, s.z, s.yaw, s.scale, s.vitality ?? 1, copySeed(s)], k * 7));
  return places;
}

/** Every far form's cards, one solid and one fading material per form, drawn for each plant's copies from their own buffers. */
export interface FarCards {
  /** The cards of form `form` for one plant's copies. */
  copies(form: number): FarCopies;
  /**
   * For the pass about to render: its focal length in device pixels, the
   * crown span in pixels of a meter one meter away (or of a meter, for a
   * flat pass), 0 to draw no card; and whether it is flat, as the sun's
   * shadow is.
   */
  pass(focal: number, ortho: boolean): void;
  /** Shows or hides every card of these forms, for seeing what they draw. */
  show(on: boolean): void;
  /** Reads copies' own views from these four layers, `width` by `height` texels (`setOwn`). */
  own(layers: readonly THREE.Texture[], width: number, height: number): void;
  dispose(): void;
}

/** The eight numbers of a copy's own views: x, y of its 2 by 2 tiles in texels, a tile's size, the bits of the tiles holding their view, then the azimuths of its two columns and the elevations of its two rows. */
export type OwnViews = readonly [number, number, number, number, number, number, number, number];

/** The cards of `forms`, each turning far where its copies' crowns span `swapPx[k]` device pixels, by `turn`. */
export function createFarCards(forms: readonly FarForm[], light: SceneLight, swapPx: readonly number[], turn: FarTurn): FarCards {
  if (swapPx.length !== forms.length) throw new Error(`createFarCards was given ${forms.length} forms and ${swapPx.length} sizes they turn far at.`);
  const card = new THREE.PlaneGeometry(2, 2, 1, 5);
  const pass = { uFarPass: { value: new THREE.Vector2(0, 0) }, uFarBand: { value: turn.band }, uFarLeave: { value: turn.leave }, uFarGone: { value: new THREE.Vector2(turn.gone.start, turn.gone.end) } };
  // Until a copy holds its own views, the own atlas is a texel no card reads.
  const none = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  none.needsUpdate = true;
  const owned = { uOwn0: { value: none as THREE.Texture }, uOwn1: { value: none as THREE.Texture }, uOwn2: { value: none as THREE.Texture }, uOwn3: { value: none as THREE.Texture }, uOwnSize: { value: new THREE.Vector2(1, 1) } };
  const materials = forms.map((form, k) => {
    const [l0, l1, l2, l3] = form.atlas.layers;
    const uniforms = {
      ...light,
      ...pass,
      ...owned,
      uFarSwap: { value: swapPx[k] as number },
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
    return {
      solid: new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: CARD_FRAG, uniforms, side: THREE.DoubleSide, alphaToCoverage: true }),
      fading: new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: CARD_FRAG, uniforms, defines: { FADING: "" }, side: THREE.DoubleSide, transparent: true, depthWrite: false }),
      depth: new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: CARD_DEPTH_FRAG, uniforms, side: THREE.DoubleSide }),
    };
  });
  const sets = new Set<FarCopies>();
  return {
    copies(form) {
      const m = materials[form];
      if (m === undefined) throw new Error(`No far form ${form}; there are ${forms.length}.`);
      const object = new THREE.Group();
      // Both sets read the same copies; a geometry holds room for so many, and three fixes how many an instanced
      // geometry may draw when it is first bound, so outgrowing it takes a new geometry, never new attributes.
      const geometryFor = (room: number): THREE.InstancedBufferGeometry => {
        const g = new THREE.InstancedBufferGeometry();
        g.index = card.index;
        g.setAttribute("position", card.getAttribute("position"));
        g.setAttribute("aSpot", new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, room) * 4), 4));
        g.setAttribute("aMore", new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, room) * 4), 4));
        g.setAttribute("aCrown", new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, room) * 4), 4));
        g.setAttribute("aOwnA", new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, room) * 4), 4));
        g.setAttribute("aOwnB", new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, room) * 4), 4));
        g.instanceCount = 0;
        return g;
      };
      let room = 0;
      let geometry = geometryFor(room);
      const solid = new THREE.Mesh(geometry, m.solid);
      const fading = new THREE.Mesh(geometry, m.fading);
      for (const mesh of [solid, fading]) {
        // The vertex shader places every card, and collapses those it does not draw: the mesh's bounds mean nothing.
        mesh.frustumCulled = false;
        object.add(mesh);
      }
      fading.renderOrder = 2;
      const attribute = (name: string): THREE.InstancedBufferAttribute => geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      const set: FarCopies = {
        object,
        place(places, crowns, own) {
          const count = places.length / 7;
          if (count > room) {
            room = Math.ceil(count * 1.25);
            geometry.dispose();
            geometry = geometryFor(room);
            solid.geometry = geometry;
            fading.geometry = geometry;
          }
          const spot = attribute("aSpot");
          const more = attribute("aMore");
          for (let k = 0; k < count; k++) {
            spot.array.set(places.subarray(k * 7, k * 7 + 4), k * 4);
            more.array.set(places.subarray(k * 7 + 4, k * 7 + 7), k * 4);
          }
          attribute("aCrown").array.set(crowns.subarray(0, count * 4));
          const ownA = attribute("aOwnA");
          const ownB = attribute("aOwnB");
          ownA.array.fill(0);
          ownB.array.fill(0);
          if (own !== undefined) {
            for (let k = 0; k < count; k++) {
              ownA.array.set(own.subarray(k * 8, k * 8 + 4), k * 4);
              ownB.array.set(own.subarray(k * 8 + 4, k * 8 + 8), k * 4);
            }
          }
          for (const name of ["aSpot", "aMore", "aCrown", "aOwnA", "aOwnB"]) attribute(name).needsUpdate = true;
          geometry.instanceCount = count;
        },
        setOwn(index, own) {
          const ownA = attribute("aOwnA");
          const ownB = attribute("aOwnB");
          for (let n = 0; n < 4; n++) {
            ownA.array[index * 4 + n] = own[n] as number;
            ownB.array[index * 4 + n] = own[n + 4] as number;
          }
          ownA.needsUpdate = true;
          ownB.needsUpdate = true;
        },
        setVitalityAt(index, v) {
          const more = attribute("aMore");
          more.array[index * 4 + 1] = v;
          more.needsUpdate = true;
        },
        useDepth(on) {
          solid.material = on ? m.depth : m.solid;
          fading.visible = !on;
        },
        dispose() {
          geometry.dispose();
          object.removeFromParent();
          sets.delete(set);
        },
      };
      sets.add(set);
      return set;
    },
    pass(focal, ortho) {
      pass.uFarPass.value.set(focal, ortho ? 1 : 0);
    },
    show(on) {
      for (const m of materials) for (const material of [m.solid, m.fading, m.depth]) material.visible = on;
    },
    own(layers, width, height) {
      [owned.uOwn0, owned.uOwn1, owned.uOwn2, owned.uOwn3].forEach((u, n) => (u.value = layers[n] ?? none));
      owned.uOwnSize.value.set(width, height);
    },
    dispose() {
      for (const set of [...sets]) set.dispose();
      card.dispose();
      none.dispose();
      for (const m of materials) {
        m.solid.dispose();
        m.fading.dispose();
        m.depth.dispose();
      }
    },
  };
}
