// Many copies of one realized component, drawn as one InstancedMesh per part
// and level of detail: a rock, a bush, a drift or a tree placed a hundred
// times costs a few draw calls. The material is the plant material itself,
// with the instance's matrix, vitality, seed and hue read per instance. The
// plant shader uses most of WebGL's 16 attribute slots, so vitality, hue and
// seed ride in the instance matrix's unused bottom row, and only how far a
// copy's vitality lags a change (`easeVitality`) takes a slot of its own.
//
// Each level of detail leaves out whole pieces (`detailAt` in @gaia/realize).
// Which copies draw, and at which level, is chosen before every pass by the
// one who stands the copies (the world's woods): `draw` packs the
// copies it is given into each level's instance buffer.

import * as THREE from "three";
import type { Part, Swatch } from "@gaia/schema";
import { FLUTTERS, type Realized, detailAt, mergeParts, shownVitality } from "@gaia/realize";
import type { SceneLight } from "./light.ts";
import { DEPTH_FRAG, DEPTH_VERT, FOLIAGE, PLANT_FRAG, PLANT_VERT, type PlantView, geometryOf, letGoOnUpload, sprayColors } from "./plant.ts";
import { closeEachFrame, followVitality } from "./lag.ts";

/** Where one copy stands. */
export interface InstanceSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  /** The ground's slope under the copy, dy/dx and dy/dz: stems stay upright while the base follows it. */
  readonly slope?: readonly [number, number];
  readonly vitality?: number;
  /** A hue shift in turns for this copy, so neighbors of one blueprint differ a little. */
  readonly hue?: number;
  /** The copy's own seed, 0 to 1, so neighbors of one blueprint never flutter in step. Drawn from its place when absent. */
  readonly seed?: number;
}

/** A copy's own seed, 0 to 1, drawn from where it stands when its spot gives none: neighbors never flutter in step. */
export function copySeed(spot: InstanceSpot): number {
  return spot.seed ?? (((Math.sin(spot.x * 12.9898 + spot.z * 78.233) * 43758.5453) % 1) + 1) % 1;
}

/** Distances from which a coarser level may draw. */
const LEVEL_AT = [48, 96, 192, 384, 768] as const;
const MAX_LEVELS = 3;
/** A level must leave out at least half the triangles of the level before it to earn its draw calls. */
const LEVEL_GAIN = 0.5;

/** The copies one level draws in a pass, and a name for that choice: the same name again draws without repacking. */
export interface LevelCopies {
  readonly copies: readonly number[];
  readonly key: string;
}

export interface PlantInstances extends PlantView {
  readonly count: number;
  /**
   * The distance from which each level may draw, starting with 0 for the
   * full detail: every piece a level leaves out has already left on screen
   * at that distance.
   */
  readonly levels: readonly number[];
  /** Encloses the plant as built, at scale 1 where it stands, so no piece's center lies outside it. A copy: changing it changes nothing. */
  readonly built: THREE.Sphere;
  /** How much farther than `built` the plant reaches as drawn: wind, decline and far pieces growing toward a pixel's size. */
  readonly reach: number;
  /** Sets one copy's vitality; the shader reads it per instance. */
  setVitalityAt(index: number, v: number): void;
  /**
   * For the pass about to render, at `focal` device pixels of focal length:
   * a copy whose crown spans fewer than `from` pixels dissolves, gone at
   * `to`, where only its far card draws (0 and 0 for no far card); and,
   * far card or not, a copy whose crown spans fewer than `gone[0]` pixels
   * dissolves, gone at `gone[1]`, too small to see. A focal of 0 dissolves
   * nothing.
   */
  nearLeaves(focal: number, from: number, to: number, gone: readonly [number, number]): void;
  /** Draws, in the pass about to render, the copies given for each level, packed into its instance buffer; levels not given draw nothing. */
  draw(levels: readonly LevelCopies[]): void;
  /**
   * Readies every level to draw one copy, so the next render uploads every
   * geometry at once, while a loading screen or a rebake already holds the
   * frame, never later as a level first comes into view. The next `draw` undoes it.
   */
  warm(): void;
  /**
   * Moves the copies to new spots, as many as there are: a world's new bake
   * stands the same blueprints elsewhere. The geometry, its levels and the
   * materials stay, so this costs only the copies' matrices.
   */
  respot(spots: readonly InstanceSpot[]): void;
  /** Copies and triangles the last pass drew. */
  drawn(): { copies: number; triangles: number };
}

function swap(source: string, from: string, to: string): string {
  if (!source.includes(from)) throw new Error(`The plant shader no longer contains "${from}"; update instances.ts.`);
  return source.split(from).join(to);
}

/** The plant vertex shader, reading placement, vitality, seed and hue per instance. */
function instanced(vertex: string): string {
  let out = swap(vertex, "uniform float uVitality;", "#define uVitality (instanceMatrix[0][3])");
  out = swap(out, "uniform float uSeed;", "#define uSeed (instanceMatrix[2][3])");
  out = swap(out, "uniform float uVitalityLag;", "attribute float aVitalityLag;\n#define uVitalityLag aVitalityLag");
  out = swap(out, "modelMatrix", "placed()");
  out = swap(
    out,
    "void main() {",
    "mat4 placed() { mat4 m = instanceMatrix; m[0][3] = 0.0; m[1][3] = 0.0; m[2][3] = 0.0; return modelMatrix * m; }\nvoid main() {",
  );
  if (out.includes("vTint = aTint;")) out = out.replace("vTint = aTint;", "vTint = aTint + instanceMatrix[1][3];");
  return out;
}

/**
 * The near form leaving: once a copy's crown spans fewer device pixels than
 * `uNearLeaves.y` on this pass's screen, the copy dissolves, until at
 * `uNearLeaves.z` it is gone and its far card stands alone; and below
 * `uNearGone.x` pixels it dissolves too small to see, gone at `uNearGone.y`.
 * Its crown is measured as `crownsOf` in @gaia/render measures it, from the
 * copy's own matrix, so the dissolve ends where the copy stops drawing.
 * `uNearLeaves.x` is the pass's focal length in device pixels; 0 never
 * dissolves.
 */
const NEAR_LEAVES_VERT = /* glsl */ `
  {
    float scale = length(instanceMatrix[0].xz);
    vec3 crown = instanceMatrix[3].xyz + uCrown.xyz * scale;
    float span = 2.0 * uCrown.w * scale * uNearLeaves.x / max(distance(crown, uEye), 1.0);
    float leaving = clamp((uNearLeaves.y - span) / max(uNearLeaves.y - uNearLeaves.z, 1e-3), 0.0, 1.0);
    float small = clamp((uNearGone.x - span) / max(uNearGone.x - uNearGone.y, 1e-3), 0.0, 1.0);
    vNearGone = uNearLeaves.x > 0.0 ? max(leaving, small) : 0.0;
  }
  gl_Position = projectionMatrix * viewMatrix * world;`;

const INSTANCED_VERT = swap(
  swap(instanced(PLANT_VERT), "void main() {", "uniform vec4 uCrown;\nuniform vec3 uNearLeaves;\nuniform vec2 uNearGone;\nvarying float vNearGone;\nvoid main() {"),
  "  gl_Position = projectionMatrix * viewMatrix * world;",
  NEAR_LEAVES_VERT,
);
const INSTANCED_DEPTH = instanced(DEPTH_VERT);
// A leaving copy thins through its coverage, sample by sample, whatever it
// is made of. It leaves under its far card, which covers its finest pieces
// only in part, and bark screened away a whole pixel at a time showed
// through the card there as a stipple. Bark covers every sample, so each
// part draws exactly as before until the copy leaves.
const INSTANCED_FRAG = swap(
  swap(PLANT_FRAG, "void main() {", "varying float vNearGone;\nvoid main() {"),
  "  gl_FragColor = vec4(aerial(shoulder(color), vWorld) + glow * (1.0 - uNightness * 0.35), cover);",
  "  gl_FragColor = vec4(aerial(shoulder(color), vWorld) + glow * (1.0 - uNightness * 0.35), cover * (1.0 - vNearGone));",
);

const vec3Of = (c: readonly number[]): THREE.Vector3 => new THREE.Vector3(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);
const trianglesOf = (parts: readonly Part[]): number => parts.reduce((n, p) => n + p.indices.length / 3, 0);

/** The full detail, then each coarser level that leaves out enough to be worth drawing. */
function levelsOf(parts: readonly Part[]): { at: number; parts: readonly Part[] }[] {
  const levels = [{ at: 0, parts }];
  let triangles = trianglesOf(parts);
  for (const at of LEVEL_AT) {
    if (levels.length >= MAX_LEVELS) break;
    const reduced = parts.map((p) => detailAt(p, at));
    const t = trianglesOf(reduced);
    if (t > triangles * LEVEL_GAIN) continue;
    levels.push({ at, parts: reduced });
    triangles = t;
  }
  return levels;
}

interface Level {
  readonly at: number;
  readonly meshes: { mesh: THREE.InstancedMesh; color: THREE.ShaderMaterial; depth: THREE.ShaderMaterial; triangles: number }[];
  /** One instance buffer every part of the level shares, and the name of the choice of copies it holds now. */
  attribute: THREE.InstancedBufferAttribute;
  /** Each copy's vitality lag, packed as the matrices are. */
  lags: THREE.InstancedBufferAttribute;
  key: string;
  /** The copies' data as packed: a copy's change since repacks the level. */
  generation: number;
}

export function createPlantInstances(plant: Realized, light: SceneLight, spots: readonly InstanceSpot[]): PlantInstances {
  // Only the palette is read once the copies stand, so the parts' arrays go once the levels are made.
  const { palette } = plant;
  const object = new THREE.Group();

  // Bounded by what stands above the soil: a bramble's canes root a metre or more under it, where no one sees them.
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const part of plant.parts) {
    const p = part.positions;
    for (let i = 0; i < p.length; i += 3) box.expandByPoint(point.set(p[i] as number, Math.max(0, p[i + 1] as number), p[i + 2] as number));
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.3, 0, -0.3), new THREE.Vector3(0.3, 0.3, 0.3));
  const height = Math.max(0.3, box.max.y);
  const radius = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z, 0.3);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  // Wind and decline move vertices past the built mesh, a slope shears it,
  // and far pieces grow toward a pixel's size: the drawn bounds allow for all.
  const reach = 3 + 0.15 * height;

  // Every copy's matrix, with vitality, hue and seed in its bottom row, and its vitality's lag.
  let count = 0;
  let source = new Float32Array(16);
  let lagSource = new Float32Array(1);
  /** The shown vitality each copy is easing toward. */
  let targets = new Float32Array(1);
  const matrix = new THREE.Matrix4();
  const shear = new THREE.Matrix4();
  const turn = new THREE.Matrix4();
  // The copies whose vitality still lags a change, each frame closing a little more.
  const lagging = new Set<number>();
  const closeLags = (keep: number): boolean => {
    for (const index of lagging) {
      const target = targets[index] as number;
      const [shown, lag] = followVitality(source[index * 16 + 3] as number, lagSource[index] as number, target, keep);
      source[index * 16 + 3] = shown;
      lagSource[index] = lag;
      if (shown === target && lag === 0) lagging.delete(index);
    }
    generation++;
    return lagging.size > 0;
  };

  const place = (next: readonly InstanceSpot[]): void => {
    count = next.length;
    source = new Float32Array(Math.max(1, count) * 16);
    // Copies stood anew show their vitality at rest.
    lagSource = new Float32Array(Math.max(1, count));
    targets = new Float32Array(Math.max(1, count));
    lagging.clear();
    next.forEach((s, k) => {
      const [gx, gz] = s.slope ?? [0, 0];
      shear.set(1, 0, 0, 0, gx, 1, gz, 0, 0, 0, 1, 0, 0, 0, 0, 1);
      turn.makeRotationY(s.yaw).scale(new THREE.Vector3(s.scale, s.scale, s.scale));
      matrix.makeTranslation(s.x, s.y, s.z).multiply(shear).multiply(turn);
      matrix.elements[3] = shownVitality(s.vitality ?? 1);
      targets[k] = matrix.elements[3];
      matrix.elements[7] = s.hue ?? 0;
      matrix.elements[11] = copySeed(s);
      source.set(matrix.elements, k * 16);
    });
  };
  place(spots);

  const shared = {
    uSway: { value: plant.motion.sway },
    uFrequency: { value: plant.motion.frequency },
    uHeight: { value: height },
    uVariety: { value: 1 },
    uDetail: { value: 1 },
    uCrown: { value: new THREE.Vector4(sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius) },
    uNearLeaves: { value: new THREE.Vector3(0, 0, 0) },
    uNearGone: { value: new THREE.Vector2(0, 0) },
  };
  const materials = new Map<string, { color: THREE.ShaderMaterial; depth: THREE.ShaderMaterial }>();
  const materialFor = (part: Part): { color: THREE.ShaderMaterial; depth: THREE.ShaderMaterial } => {
    const hit = materials.get(part.swatch);
    if (hit !== undefined) return hit;
    const swatch: Swatch = palette.swatches[part.swatch] ?? { healthy: [1, 0, 1], decline: [1, 0, 1] };
    const foliage = FOLIAGE[part.swatch] ?? 0.5;
    const perPart = { uFlutter: { value: FLUTTERS.has(part.swatch) ? 1 : 0 } };
    const made = {
      color: new THREE.ShaderMaterial({
        vertexShader: INSTANCED_VERT,
        fragmentShader: INSTANCED_FRAG,
        uniforms: {
          ...light,
          ...shared,
          ...perPart,
          uHealthy: { value: vec3Of(swatch.healthy) },
          uDecline: { value: vec3Of(swatch.decline) },
          ...sprayColors({ palette }),
          uFoliage: { value: foliage },
          uLamp: { value: 0 },
        },
        side: foliage === 0 ? THREE.FrontSide : THREE.DoubleSide,
        alphaToCoverage: true,
      }),
      depth: new THREE.ShaderMaterial({
        vertexShader: INSTANCED_DEPTH,
        fragmentShader: DEPTH_FRAG,
        uniforms: { uTime: light.uTime, uWind: light.uWind, uWindDir: light.uWindDir, uNightness: light.uNightness, uEye: light.uEye, ...shared, ...perPart },
        side: THREE.DoubleSide,
      }),
    };
    materials.set(part.swatch, made);
    return made;
  };

  /** An instance buffer for `n` copies of `size` floats each, with room to grow, so a new bake rarely needs a new one. */
  const bufferFor = (n: number, size = 16): THREE.InstancedBufferAttribute => {
    const attribute = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, Math.ceil(n * 1.25)) * size), size);
    attribute.setUsage(THREE.DynamicDrawUsage);
    return attribute;
  };
  // A tree's twigs are bark like its limbs: parts of one swatch draw as one mesh.
  const levels: Level[] = levelsOf(mergeParts(plant.parts)).map(({ at, parts }) => {
    const attribute = bufferFor(count);
    const lags = bufferFor(count, 1);
    return {
      at,
      attribute,
      lags,
      key: "",
      generation: -1,
      meshes: parts.flatMap((part) => {
        if (part.indices.length === 0) return [];
        const { color, depth } = materialFor(part);
        const geometry = geometryOf(part);
        // No ray is cast at the copies, so the page keeps none of their buffers once the GPU holds them.
        letGoOnUpload(geometry);
        geometry.setAttribute("aVitalityLag", lags);
        const mesh = new THREE.InstancedMesh(geometry, color, 1);
        mesh.instanceMatrix = attribute;
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.userData.part = part.swatch;
        object.add(mesh);
        return [{ mesh, color, depth, triangles: part.indices.length / 3 }];
      }),
    };
  });

  let lastDrawn = { copies: 0, triangles: 0 };
  /** Bumped whenever a copy's data changes, so the next pass repacks. */
  let generation = 0;

  const draw = (chosen: readonly LevelCopies[]): void => {
    let copies = 0;
    let triangles = 0;
    levels.forEach((level, k) => {
      const picked = chosen[k];
      const n = picked?.copies.length ?? 0;
      if (n > count) throw new Error(`draw was given ${n} copies at level ${k} of a plant with ${count}.`);
      if (picked !== undefined && (level.key !== picked.key || level.generation !== generation)) {
        picked.copies.forEach((c, i) => {
          level.attribute.array.set(source.subarray(c * 16, c * 16 + 16), i * 16);
          level.lags.array[i] = lagSource[c] as number;
        });
        level.attribute.needsUpdate = true;
        level.lags.needsUpdate = true;
        level.key = picked.key;
        level.generation = generation;
      }
      for (const m of level.meshes) {
        m.mesh.count = n;
        m.mesh.visible = n > 0;
        triangles += m.triangles * n;
      }
      copies += n;
    });
    lastDrawn = { copies, triangles };
  };

  const meshes = levels.flatMap((l) => l.meshes);
  const perCopy = trianglesOf(plant.parts);
  let all = 1;
  const write = (index: number, v: number): void => {
    // The copy's shown vitality eases toward it from where it is; a copy already resting there needs nothing.
    if (v === targets[index] && (lagging.has(index) || source[index * 16 + 3] === v)) return;
    targets[index] = v;
    lagging.add(index);
    closeEachFrame(closeLags);
  };
  return {
    object,
    height,
    radius,
    get count() {
      return count;
    },
    levels: levels.map((l) => l.at),
    built: sphere.clone(),
    reach,
    get triangles() {
      return perCopy * count;
    },
    get vitality() {
      return all;
    },
    setVitality(v) {
      all = Math.min(1, Math.max(0, v));
      for (let i = 0; i < count; i++) write(i, shownVitality(all));
      generation++;
    },
    setVitalityAt(index, v) {
      write(index, shownVitality(v));
      generation++;
    },
    draw,
    respot(next) {
      place(next);
      for (const level of levels) {
        if (level.attribute.count < Math.max(1, count)) {
          level.attribute = bufferFor(count);
          level.lags = bufferFor(count, 1);
          for (const m of level.meshes) {
            m.mesh.instanceMatrix = level.attribute;
            m.mesh.geometry.setAttribute("aVitalityLag", level.lags);
          }
        }
        level.key = "";
      }
      generation++;
    },
    warm() {
      for (const level of levels) {
        level.attribute.array.set(source.subarray(0, 16), 0);
        level.lags.array[0] = lagSource[0] as number;
        level.attribute.needsUpdate = true;
        level.lags.needsUpdate = true;
        level.key = "";
        for (const m of level.meshes) {
          m.mesh.count = Math.min(1, count);
          m.mesh.visible = count > 0;
        }
      }
    },
    drawn: () => lastDrawn,
    nearLeaves(focal, from, to, gone) {
      shared.uNearLeaves.value.set(focal, from, to);
      shared.uNearGone.value.set(gone[0], gone[1]);
    },
    useDepth(on) {
      for (const m of meshes) m.mesh.material = on ? m.depth : m.color;
    },
    dispose() {
      for (const m of meshes) {
        m.mesh.geometry.dispose();
        m.mesh.dispose();
      }
      for (const m of materials.values()) {
        m.color.dispose();
        m.depth.dispose();
      }
      object.removeFromParent();
    },
  };
}
