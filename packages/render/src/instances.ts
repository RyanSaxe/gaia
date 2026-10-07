// Many copies of one realized component, drawn as one InstancedMesh per part:
// a rock, a bush or a drift placed a hundred times costs as many draw calls
// as it has parts. The material is the plant material itself, with the
// instance's matrix, vitality and hue shift read per instance. The plant
// shader already uses most of WebGL's 16 attribute slots, so vitality and
// hue ride in the instance matrix's unused bottom row instead of attributes
// of their own.

import * as THREE from "three";
import type { Swatch } from "@gaia/schema";
import type { Realized } from "@gaia/realize";
import type { SceneLight } from "./light.ts";
import { DEPTH_FRAG, DEPTH_VERT, FOLIAGE, PLANT_FRAG, PLANT_VERT, type PlantView, geometryOf } from "./plant.ts";

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
}

export interface PlantInstances extends PlantView {
  readonly count: number;
  /** Sets one copy's vitality; the shader reads it per instance. */
  setVitalityAt(index: number, v: number): void;
}

function swap(source: string, from: string, to: string): string {
  if (!source.includes(from)) throw new Error(`The plant shader no longer contains "${from}"; update instances.ts.`);
  return source.split(from).join(to);
}

/** The plant vertex shader, reading placement, vitality and hue per instance. */
function instanced(vertex: string): string {
  let out = swap(vertex, "uniform float uVitality;", "#define uVitality (instanceMatrix[0][3])");
  out = swap(out, "modelMatrix", "placed()");
  out = swap(
    out,
    "void main() {",
    "mat4 placed() { mat4 m = instanceMatrix; m[0][3] = 0.0; m[1][3] = 0.0; return modelMatrix * m; }\nvoid main() {",
  );
  if (out.includes("vTint = aTint;")) out = out.replace("vTint = aTint;", "vTint = aTint + instanceMatrix[1][3];");
  return out;
}

const INSTANCED_VERT = instanced(PLANT_VERT);
const INSTANCED_DEPTH = instanced(DEPTH_VERT);

const vec3Of = (c: readonly number[]): THREE.Vector3 => new THREE.Vector3(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);

export function createPlantInstances(plant: Realized, light: SceneLight, spots: readonly InstanceSpot[]): PlantInstances {
  const object = new THREE.Group();
  const count = spots.length;

  const matrix = new THREE.Matrix4();
  const shear = new THREE.Matrix4();
  const turn = new THREE.Matrix4();
  const matrices = spots.map((s) => {
    const [gx, gz] = s.slope ?? [0, 0];
    shear.set(1, 0, 0, 0, gx, 1, gz, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    turn.makeRotationY(s.yaw).scale(new THREE.Vector3(s.scale, s.scale, s.scale));
    const m = matrix.makeTranslation(s.x, s.y, s.z).multiply(shear).multiply(turn).clone();
    m.elements[3] = s.vitality ?? 1;
    m.elements[7] = s.hue ?? 0;
    return m;
  });

  const geometries = plant.parts.map(geometryOf);
  const box = new THREE.Box3();
  for (const g of geometries) if (g.boundingBox !== null) box.union(g.boundingBox);
  const height = Math.max(0.3, box.max.y);
  const radius = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z, 0.3);
  const shared = {
    uSway: { value: plant.motion.sway },
    uFrequency: { value: plant.motion.frequency },
    uHeight: { value: height },
  };
  const meshes: { mesh: THREE.InstancedMesh; color: THREE.ShaderMaterial; depth: THREE.ShaderMaterial }[] = [];
  plant.parts.forEach((part, i) => {
    const swatch: Swatch = plant.palette.swatches[part.swatch] ?? { healthy: [1, 0, 1], decline: [1, 0, 1] };
    const foliage = FOLIAGE[part.swatch] ?? 0.5;
    const perPart = { uFlutter: { value: foliage === 0 ? 0 : 1 } };
    const color = new THREE.ShaderMaterial({
      vertexShader: INSTANCED_VERT,
      fragmentShader: PLANT_FRAG,
      uniforms: {
        ...light,
        ...shared,
        ...perPart,
        uHealthy: { value: vec3Of(swatch.healthy) },
        uDecline: { value: vec3Of(swatch.decline) },
        uFoliage: { value: foliage },
      },
      side: foliage === 0 ? THREE.FrontSide : THREE.DoubleSide,
    });
    const depth = new THREE.ShaderMaterial({
      vertexShader: INSTANCED_DEPTH,
      fragmentShader: DEPTH_FRAG,
      uniforms: { uTime: light.uTime, uWind: light.uWind, uNightness: light.uNightness, ...shared, ...perPart },
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geometries[i], color, Math.max(1, count));
    mesh.count = count;
    matrices.forEach((m, k) => mesh.setMatrixAt(k, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.userData.part = part.swatch;
    object.add(mesh);
    meshes.push({ mesh, color, depth });
  });

  const perCopy = plant.parts.reduce((n, p) => n + p.indices.length / 3, 0);
  let all = 1;
  const write = (index: number, v: number): void => {
    for (const { mesh } of meshes) mesh.instanceMatrix.array[index * 16 + 3] = v;
  };
  const flush = (): void => {
    for (const { mesh } of meshes) mesh.instanceMatrix.needsUpdate = true;
  };
  return {
    object,
    height,
    radius,
    count,
    triangles: perCopy * count,
    get vitality() {
      return all;
    },
    setVitality(v) {
      all = Math.min(1, Math.max(0, v));
      for (let i = 0; i < count; i++) write(i, all);
      flush();
    },
    setVitalityAt(index, v) {
      write(index, Math.min(1, Math.max(0, v)));
      flush();
    },
    useDepth(on) {
      for (const m of meshes) m.mesh.material = on ? m.depth : m.color;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of meshes) {
        m.color.dispose();
        m.depth.dispose();
        m.mesh.dispose();
      }
      object.removeFromParent();
    },
  };
}
