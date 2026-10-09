// Many copies of one realized component, drawn as one InstancedMesh per part
// and level of detail: a rock, a bush, a drift or a tree placed a hundred
// times costs a few draw calls. The material is the plant material itself,
// with the instance's matrix, vitality, seed and hue read per instance. The
// plant shader uses most of WebGL's 16 attribute slots, so vitality, hue and
// seed ride in the instance matrix's unused bottom row.
//
// Copies are sorted into square cells. Before every pass (the view, the sun's
// shadow and the water's mirror) `cull` packs the cells that pass's camera
// can see into each level's instance buffer, so no pass draws what it cannot
// see. A coarser level leaves out whole pieces (`detailAt` in @gaia/realize),
// and a cell draws it only once every piece it leaves out has already left
// on screen at the cell's nearest point, so the switch changes no pixel.

import * as THREE from "three";
import type { Part, Swatch } from "@gaia/schema";
import { FLUTTERS, type Realized, detailAt, mergeParts } from "@gaia/realize";
import type { SceneLight } from "./light.ts";
import { DEPTH_FRAG, DEPTH_VERT, FOLIAGE, PLANT_FRAG, PLANT_VERT, type PlantView, geometryOf, sprayColors } from "./plant.ts";

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

/** How copies choose their detail: by distance from the eye, or forced, to prove that the switch never shows. */
export type DetailMode = "auto" | "full" | "far";

/** The side of a cell, in meters. */
export const INSTANCE_CELL = 32;
/** Distances from which a coarser level may draw. */
const LEVEL_AT = [48, 96, 192, 384, 768] as const;
const MAX_LEVELS = 3;
/** A level must leave out at least half the triangles of the level before it to earn its draw calls. */
const LEVEL_GAIN = 0.5;
/** Meters a cell's nearest point must lie past a level's distance before it draws that level. */
const LEVEL_MARGIN = 0.5;

export interface PlantInstances extends PlantView {
  readonly count: number;
  /** The distance from which each level draws, starting with 0 for the full detail. */
  readonly levels: readonly number[];
  /** Sets one copy's vitality; the shader reads it per instance. */
  setVitalityAt(index: number, v: number): void;
  /** Draws, in the pass about to render through `camera`, only the cells it can see, each at the detail its distance from the eye allows. */
  cull(camera: THREE.Camera): void;
  /**
   * Readies every level to draw one copy, so the next render uploads every
   * geometry at once, while a loading screen or a rebake already holds the
   * frame, never later as a level first comes into view. The next `cull` undoes it.
   */
  warm(): void;
  /**
   * Moves the copies to new spots, as many as there are: a world's new bake
   * stands the same blueprints elsewhere. The geometry, its levels and the
   * materials stay, so this costs only the copies' matrices and cells.
   */
  respot(spots: readonly InstanceSpot[]): void;
  /** How copies choose their detail; "auto" outside of tests. */
  detail: DetailMode;
  /** Copies and triangles the last culled pass drew. */
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
  out = swap(out, "modelMatrix", "placed()");
  out = swap(
    out,
    "void main() {",
    "mat4 placed() { mat4 m = instanceMatrix; m[0][3] = 0.0; m[1][3] = 0.0; m[2][3] = 0.0; return modelMatrix * m; }\nvoid main() {",
  );
  if (out.includes("vTint = aTint;")) out = out.replace("vTint = aTint;", "vTint = aTint + instanceMatrix[1][3];");
  return out;
}

const INSTANCED_VERT = instanced(PLANT_VERT);
const INSTANCED_DEPTH = instanced(DEPTH_VERT);

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

interface Cell {
  /** Indices of the copies standing in the cell. */
  readonly copies: readonly number[];
  /** Encloses every copy as drawn, wind and growth included: for culling. */
  readonly bounds: THREE.Sphere;
  /** Encloses every copy as built, so no piece's center lies outside it: for choosing detail. */
  readonly built: THREE.Sphere;
}

interface Level {
  readonly at: number;
  readonly meshes: { mesh: THREE.InstancedMesh; color: THREE.ShaderMaterial; depth: THREE.ShaderMaterial; triangles: number }[];
  /** One instance buffer every part of the level shares, and which cells it holds now. */
  attribute: THREE.InstancedBufferAttribute;
  key: string;
}

export function createPlantInstances(plant: Realized, light: SceneLight, spots: readonly InstanceSpot[]): PlantInstances {
  const object = new THREE.Group();

  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const part of plant.parts) {
    const p = part.positions;
    for (let i = 0; i < p.length; i += 3) box.expandByPoint(point.set(p[i] as number, p[i + 1] as number, p[i + 2] as number));
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.3, 0, -0.3), new THREE.Vector3(0.3, 0.3, 0.3));
  const height = Math.max(0.3, box.max.y);
  const radius = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z, 0.3);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  // Wind and decline move vertices past the built mesh, a slope shears it,
  // and far pieces grow toward a pixel's size: the drawn bounds allow for all.
  const reach = 3 + 0.15 * height;

  // Every copy's matrix, with vitality, hue and seed in its bottom row, and the cells they stand in.
  let count = 0;
  let source = new Float32Array(16);
  let cells: Cell[] = [];
  const matrix = new THREE.Matrix4();
  const shear = new THREE.Matrix4();
  const turn = new THREE.Matrix4();
  const place = (next: readonly InstanceSpot[]): void => {
    count = next.length;
    source = new Float32Array(Math.max(1, count) * 16);
    next.forEach((s, k) => {
      const [gx, gz] = s.slope ?? [0, 0];
      shear.set(1, 0, 0, 0, gx, 1, gz, 0, 0, 0, 1, 0, 0, 0, 0, 1);
      turn.makeRotationY(s.yaw).scale(new THREE.Vector3(s.scale, s.scale, s.scale));
      matrix.makeTranslation(s.x, s.y, s.z).multiply(shear).multiply(turn);
      matrix.elements[3] = s.vitality ?? 1;
      matrix.elements[7] = s.hue ?? 0;
      matrix.elements[11] = s.seed ?? (((Math.sin(s.x * 12.9898 + s.z * 78.233) * 43758.5453) % 1) + 1) % 1;
      source.set(matrix.elements, k * 16);
    });
    const byCell = new Map<string, number[]>();
    next.forEach((s, k) => {
      const key = `${Math.floor(s.x / INSTANCE_CELL)},${Math.floor(s.z / INSTANCE_CELL)}`;
      const list = byCell.get(key);
      if (list === undefined) byCell.set(key, [k]);
      else list.push(k);
    });
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    cells = [];
    for (const copies of byCell.values()) {
      const built = new THREE.Box3();
      for (const k of copies) {
        const s = next[k] as InstanceSpot;
        const tilt = 1 + Math.hypot(...(s.slope ?? [0, 0]));
        center.copy(sphere.center).multiplyScalar(s.scale).add(point.set(s.x, s.y, s.z));
        built.union(new THREE.Box3().setFromCenterAndSize(center, size.setScalar(sphere.radius * 2 * s.scale * tilt)));
      }
      const b = built.getBoundingSphere(new THREE.Sphere());
      cells.push({ copies, built: b, bounds: new THREE.Sphere(b.center.clone(), b.radius + reach) });
    }
  };
  place(spots);

  const shared = {
    uSway: { value: plant.motion.sway },
    uFrequency: { value: plant.motion.frequency },
    uHeight: { value: height },
    uVariety: { value: 1 },
    uDetail: { value: 1 },
  };
  const materials = new Map<string, { color: THREE.ShaderMaterial; depth: THREE.ShaderMaterial }>();
  const materialFor = (part: Part): { color: THREE.ShaderMaterial; depth: THREE.ShaderMaterial } => {
    const hit = materials.get(part.swatch);
    if (hit !== undefined) return hit;
    const swatch: Swatch = plant.palette.swatches[part.swatch] ?? { healthy: [1, 0, 1], decline: [1, 0, 1] };
    const foliage = FOLIAGE[part.swatch] ?? 0.5;
    const perPart = { uFlutter: { value: FLUTTERS.has(part.swatch) ? 1 : 0 } };
    const made = {
      color: new THREE.ShaderMaterial({
        vertexShader: INSTANCED_VERT,
        fragmentShader: PLANT_FRAG,
        uniforms: {
          ...light,
          ...shared,
          ...perPart,
          uHealthy: { value: vec3Of(swatch.healthy) },
          uDecline: { value: vec3Of(swatch.decline) },
          ...sprayColors(plant),
          uFoliage: { value: foliage },
          uLamp: { value: 0 },
        },
        side: foliage === 0 ? THREE.FrontSide : THREE.DoubleSide,
        alphaToCoverage: part.cutout.some((c) => c !== 0),
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

  /** An instance buffer for `n` copies, with room to grow, so a new bake rarely needs a new one. */
  const bufferFor = (n: number): THREE.InstancedBufferAttribute => {
    const attribute = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, Math.ceil(n * 1.25)) * 16), 16);
    attribute.setUsage(THREE.DynamicDrawUsage);
    return attribute;
  };
  // A tree's twigs are bark like its limbs: parts of one swatch draw as one mesh.
  const levels: Level[] = levelsOf(mergeParts(plant.parts)).map(({ at, parts }) => {
    const attribute = bufferFor(count);
    return {
      at,
      attribute,
      key: "",
      meshes: parts.flatMap((part) => {
        if (part.indices.length === 0) return [];
        const { color, depth } = materialFor(part);
        const mesh = new THREE.InstancedMesh(geometryOf(part), color, 1);
        mesh.instanceMatrix = attribute;
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.userData.part = part.swatch;
        object.add(mesh);
        return [{ mesh, color, depth, triangles: part.indices.length / 3 }];
      }),
    };
  });

  let detail: DetailMode = "auto";
  let lastDrawn = { copies: 0, triangles: 0 };
  /** Bumped whenever a copy's data changes, so the next pass repacks. */
  let generation = 0;
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const chosen: number[][] = levels.map(() => []);

  const levelFor = (cell: Cell): number => {
    if (detail === "full") return 0;
    if (detail === "far") return levels.length - 1;
    const near = cell.built.center.distanceTo(light.uEye.value) - cell.built.radius;
    let pick = 0;
    for (let k = 1; k < levels.length; k++) if ((levels[k] as Level).at <= near - LEVEL_MARGIN) pick = k;
    return pick;
  };

  const cull = (camera: THREE.Camera): void => {
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const list of chosen) list.length = 0;
    cells.forEach((cell, i) => {
      if (frustum.intersectsSphere(cell.bounds)) (chosen[levelFor(cell)] as number[]).push(i);
    });
    let copies = 0;
    let triangles = 0;
    levels.forEach((level, k) => {
      const picked = chosen[k] as number[];
      const key = `${generation}:${picked.join(",")}`;
      let n = 0;
      if (level.key !== key) {
        for (const i of picked) {
          for (const c of (cells[i] as Cell).copies) {
            level.attribute.array.set(source.subarray(c * 16, c * 16 + 16), n * 16);
            n++;
          }
        }
        level.attribute.needsUpdate = true;
        level.key = key;
      } else {
        for (const i of picked) n += (cells[i] as Cell).copies.length;
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
    source[index * 16 + 3] = v;
  };
  return {
    object,
    height,
    radius,
    get count() {
      return count;
    },
    levels: levels.map((l) => l.at),
    get triangles() {
      return perCopy * count;
    },
    get vitality() {
      return all;
    },
    get detail() {
      return detail;
    },
    set detail(mode: DetailMode) {
      detail = mode;
    },
    setVitality(v) {
      all = Math.min(1, Math.max(0, v));
      for (let i = 0; i < count; i++) write(i, all);
      generation++;
    },
    setVitalityAt(index, v) {
      write(index, Math.min(1, Math.max(0, v)));
      generation++;
    },
    cull,
    respot(next) {
      place(next);
      for (const level of levels) {
        if (level.attribute.count < Math.max(1, count)) {
          level.attribute = bufferFor(count);
          for (const m of level.meshes) m.mesh.instanceMatrix = level.attribute;
        }
        level.key = "";
      }
      generation++;
    },
    warm() {
      for (const level of levels) {
        level.attribute.array.set(source.subarray(0, 16), 0);
        level.attribute.needsUpdate = true;
        level.key = "";
        for (const m of level.meshes) {
          m.mesh.count = Math.min(1, count);
          m.mesh.visible = count > 0;
        }
      }
    },
    drawn: () => lastDrawn,
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
