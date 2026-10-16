// Many plants drawn together, such as a tile's buildings: every member's
// parts that share a material are joined into one mesh, so the batch draws
// one call per material instead of one per part of every member. Each vertex
// names its member and its part's swatch (`aBatch`), and a small float
// texture holds what each plant's own uniforms held: its placement, vitality,
// seed, turn, height and motion, the colors a spray borrows, and each
// swatch's colors, foliage, lamp and flutter. The plant shaders read the
// texture in place of those uniforms, so each member draws exactly what it
// drew alone, with every channel (wind, vitality, ruin, spin), and a change
// in a member's vitality rewrites one texel and never rebuilds geometry.

import * as THREE from "three";
import type { Part } from "@gaia/schema";
import { FLUTTERS, type Realized, mergeParts, shownVitality, spinAt } from "@gaia/realize";
import type { SceneLight } from "./light.ts";
import { CLOSED, DEPTH_FRAG, DEPTH_VERT, FOLIAGE, LAMP, PLANT_FRAG, PLANT_VERT, type PlantView, geometryOf, hasRuin, letGoOnUpload, sprayColors } from "./plant.ts";
import { createSmokeMaterial } from "./smoke.ts";

/** One plant in a batch: what it is, where it stands and turns, and its vitality. */
export interface BatchMember {
  readonly plant: Realized;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly vitality: number;
}

/** A batch of plants as one set of meshes: what a shadow pass and a scene take of a plant, and each member's vitality. */
export interface PlantBatch extends Pick<PlantView, "object" | "triangles" | "useDepth" | "dispose"> {
  readonly members: number;
  setVitality(member: number, v: number): void;
  /** Stands a member somewhere else, as a new bake's site puts it: its texels, its ray test and the batch's bounds follow. */
  move(member: number, at: Pick<BatchMember, "x" | "y" | "z" | "yaw">): void;
  /** The member the ray hits first, and how far along the ray; its parts as built, as a plant's own ray test reads them. */
  pick(raycaster: THREE.Raycaster): { readonly member: number; readonly distance: number } | undefined;
}

/** Texels at the head of each member's row: its matrix (four), its life (vitality, seed, turn, height), its motion, and a spray's bark, stem and bloom. */
const HEAD = 9;
/** Texels for each swatch after the head: healthy color and foliage, decline color and lamp, and flutter. */
const PER_SWATCH = 3;

function swap(source: string, from: string, to: string): string {
  if (!source.includes(from)) throw new Error(`The plant shader no longer contains "${from}"; update batch.ts.`);
  return source.split(from).join(to);
}

/** The plant vertex shader reading each member's placement, life and motion, and its swatch's flutter, from the batch's texture. */
function batched(vertex: string): string {
  let out = swap(
    vertex,
    "uniform float uVitality;",
    `uniform highp sampler2D uBatch;
attribute vec2 aBatch;
flat varying vec2 vBatch;
vec4 batchAt(int x) { return texelFetch(uBatch, ivec2(x, int(aBatch.x + 0.5)), 0); }
mat4 batchModel() { return mat4(batchAt(0), batchAt(1), batchAt(2), batchAt(3)); }
#define uVitality (batchAt(4).x)`,
  );
  out = swap(out, "uniform float uSeed;", "#define uSeed (batchAt(4).y)");
  out = swap(out, "uniform float uHeight;", "#define uHeight (batchAt(4).w)");
  out = swap(out, "uniform float uSway;", "#define uSway (batchAt(5).x)");
  out = swap(out, "uniform float uFrequency;", "#define uFrequency (batchAt(5).y)");
  out = swap(out, "uniform float uFlutter;", `#define uFlutter (batchAt(${HEAD} + ${PER_SWATCH} * int(aBatch.y + 0.5) + 2).x)`);
  out = swap(out, "uniform float uTurn;", "#define uTurn (batchAt(4).z)");
  // The texture's matrix places each member; the meshes themselves stand at the origin.
  out = swap(out, "modelMatrix", "batchModel()");
  out = swap(out, "void main() {", "void main() {\n  vBatch = aBatch;");
  return out;
}

/** The plant fragment shader reading each swatch's colors, foliage and lamp, and each member's spray colors, from the batch's texture. */
function batchedFragment(fragment: string): string {
  return swap(
    fragment,
    "uniform vec3 uHealthy;\nuniform vec3 uDecline;\nuniform vec3 uBark;\nuniform vec3 uStem;\nuniform vec3 uBloomColor;\nuniform float uFoliage;\nuniform float uLamp;",
    `uniform highp sampler2D uBatch;
flat varying vec2 vBatch;
vec4 batchOf(int x) { return texelFetch(uBatch, ivec2(x, int(vBatch.x + 0.5)), 0); }
vec4 swatchOf(int k) { return batchOf(${HEAD} + ${PER_SWATCH} * int(vBatch.y + 0.5) + k); }
#define uHealthy (swatchOf(0).rgb)
#define uDecline (swatchOf(1).rgb)
#define uFoliage (swatchOf(0).a)
#define uLamp (swatchOf(1).a)
#define uBark (batchOf(6).rgb)
#define uStem (batchOf(7).rgb)
#define uBloomColor (batchOf(8).rgb)`,
  );
}

const BATCH_VERT = batched(PLANT_VERT);
const BATCH_FRAG = batchedFragment(PLANT_FRAG);
const BATCH_DEPTH = batched(DEPTH_VERT);

/** How a part draws: which material it shares with the others' parts. */
const materialOf = (part: Part): string => `${CLOSED.has(part.swatch) ? "front" : "both"}|${part.cutout.some((c) => c !== 0) ? "cover" : "solid"}|${hasRuin(part) ? "ruin" : "plain"}`;

/** Each member's parts merged by swatch as a plant's are, its bounds, and the swatch slot each part takes. */
interface Prepared {
  readonly parts: readonly Part[];
  matrix: THREE.Matrix4;
  readonly height: number;
  /** Its bounds about its own origin, padded for wind and decline, and as it stands. */
  readonly local: THREE.Sphere;
  bounds: THREE.Sphere;
}

const placement = (at: Pick<BatchMember, "x" | "y" | "z" | "yaw">): THREE.Matrix4 =>
  new THREE.Matrix4().compose(new THREE.Vector3(at.x, at.y, at.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), at.yaw), new THREE.Vector3(1, 1, 1));

export function createPlantBatch(members: readonly BatchMember[], light: SceneLight): PlantBatch {
  const object = new THREE.Group();
  const prepared: Prepared[] = members.map((m) => {
    const parts = mergeParts(m.plant.parts);
    const box = new THREE.Box3();
    for (const p of parts) for (let i = 0; i < p.positions.length; i += 3) box.expandByPoint(new THREE.Vector3(p.positions[i], p.positions[i + 1], p.positions[i + 2]));
    const height = Math.max(0.3, box.max.y);
    const matrix = placement(m);
    // Wind and decline move vertices a little past the built mesh, as a plant's own bounds allow for.
    const local = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 1) : box.getBoundingSphere(new THREE.Sphere());
    local.radius += 2 + 0.15 * height;
    return { parts, matrix, height, local, bounds: local.clone().applyMatrix4(matrix) };
  });
  // Every swatch the batch draws takes one slot, the same in every member's row.
  const swatches = [...new Set(prepared.flatMap((p) => p.parts.filter((part) => part.swatch !== "smoke").map((part) => part.swatch)))].sort();
  const slotOf = new Map(swatches.map((s, i) => [s, i]));
  const width = HEAD + PER_SWATCH * swatches.length;
  const data = new Float32Array(width * Math.max(1, members.length) * 4);
  const texel = (member: number, x: number, v: readonly number[]): void => data.set(v, (member * width + x) * 4);
  members.forEach((m, i) => {
    const { matrix, height } = prepared[i] as Prepared;
    for (let c = 0; c < 4; c++) texel(i, c, matrix.elements.slice(c * 4, c * 4 + 4));
    texel(i, 4, [shownVitality(m.vitality), 0, 0, height]);
    texel(i, 5, [m.plant.motion.sway, m.plant.motion.frequency, 0, 0]);
    const spray = sprayColors(m.plant);
    texel(i, 6, spray.uBark.value.toArray());
    texel(i, 7, spray.uStem.value.toArray());
    texel(i, 8, spray.uBloomColor.value.toArray());
    swatches.forEach((name, k) => {
      const swatch = m.plant.palette.swatches[name] ?? { healthy: [1, 0, 1], decline: [1, 0, 1] };
      texel(i, HEAD + PER_SWATCH * k, [...swatch.healthy, FOLIAGE[name] ?? 0.5]);
      texel(i, HEAD + PER_SWATCH * k + 1, [...swatch.decline, LAMP.has(name) ? 1 : 0]);
      texel(i, HEAD + PER_SWATCH * k + 2, [FLUTTERS.has(name) ? 1 : 0, 0, 0, 0]);
    });
  });
  const texture = new THREE.DataTexture(data, width, Math.max(1, members.length), THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  const shared = { uBatch: { value: texture }, uDetail: { value: 0 } };

  // Spinning pieces turn by each member's accumulated phase, so a wheel's speed follows its vitality without jumping.
  const spins = prepared.map((p) => p.parts.some((part) => part.channels.spin !== undefined));
  const turns = members.map(() => 0);
  let turnedAt = light.uTime.value;
  const advanceTurns = (): void => {
    const now = light.uTime.value;
    if (now === turnedAt) return;
    const dt = Math.max(0, now - turnedAt);
    turnedAt = now;
    spins.forEach((spinning, i) => {
      if (!spinning) return;
      turns[i] = (turns[i] as number) + dt * spinAt(data[(i * width + 4) * 4] as number);
      data[(i * width + 4) * 4 + 2] = turns[i] as number;
    });
    texture.needsUpdate = true;
  };

  // Every member's parts that share a material, joined: each vertex keeps its member and its swatch's slot.
  const groups = new Map<string, { parts: Part[]; batch: number[] }>();
  const smokes: { member: number; part: Part }[] = [];
  prepared.forEach((p, member) => {
    for (const part of p.parts) {
      if (part.swatch === "smoke") {
        smokes.push({ member, part });
        continue;
      }
      const key = materialOf(part);
      const g = groups.get(key) ?? { parts: [], batch: [] };
      groups.set(key, g);
      // Relabelled alike so `mergeParts` joins them, as it joins a plant's parts of one swatch.
      g.parts.push({ ...part, swatch: key, collision: "none" });
      const slot = slotOf.get(part.swatch) as number;
      for (let v = 0; v < part.shade.length; v++) g.batch.push(member, slot);
    }
  });
  // The meshes stand at the origin and the texture places each member, so a mesh's bounds are every member's as it stands.
  const sphere = new THREE.Sphere();
  const box = new THREE.Box3();
  const bound = (): void => {
    box.makeEmpty();
    for (const p of prepared) box.union(new THREE.Box3().setFromCenterAndSize(p.bounds.center, new THREE.Vector3().setScalar(p.bounds.radius * 2)));
    if (!box.isEmpty()) box.getBoundingSphere(sphere);
  };
  bound();
  const meshes: { mesh: THREE.Mesh; color: THREE.Material; depth: THREE.Material }[] = [];
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  let triangles = 0;
  for (const [key, g] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [side, cover, ruin] = key.split("|");
    const part = mergeParts(g.parts)[0] as Part;
    const geometry = geometryOf(part);
    geometry.setAttribute("aBatch", new THREE.BufferAttribute(new Float32Array(g.batch), 2));
    geometry.boundingSphere = sphere;
    geometry.boundingBox = box;
    letGoOnUpload(geometry);
    geometries.push(geometry);
    triangles += part.indices.length / 3;
    const defines = ruin === "ruin" ? { RUIN: "" } : {};
    const color = new THREE.ShaderMaterial({
      defines,
      vertexShader: BATCH_VERT,
      fragmentShader: BATCH_FRAG,
      uniforms: { ...light, ...shared },
      side: side === "front" ? THREE.FrontSide : THREE.DoubleSide,
      alphaToCoverage: cover === "cover",
    });
    const depth = new THREE.ShaderMaterial({
      defines,
      vertexShader: BATCH_DEPTH,
      fragmentShader: DEPTH_FRAG,
      uniforms: { uTime: light.uTime, uWind: light.uWind, uWindDir: light.uWindDir, uNightness: light.uNightness, uEye: light.uEye, ...shared },
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, color);
    mesh.userData.part = key;
    if (ruin === "ruin") mesh.onBeforeRender = advanceTurns;
    object.add(mesh);
    materials.push(color, depth);
    meshes.push({ mesh, color, depth });
  }
  // Smoke drifts in its own soft material over its member, and casts no shadow.
  const smokeLife = members.map((m) => ({ uVitality: { value: shownVitality(m.vitality) } }));
  const veils: THREE.Mesh[] = smokes.map(({ member, part }) => {
    const swatch = members[member]?.plant.palette.swatches.smoke ?? { healthy: [1, 1, 1], decline: [1, 1, 1] };
    const material = createSmokeMaterial(light, smokeLife[member] as { uVitality: { value: number } }, new THREE.Vector3(...swatch.healthy));
    const geometry = geometryOf(part);
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.member = member;
    mesh.applyMatrix4((prepared[member] as Prepared).matrix);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    object.add(mesh);
    materials.push(material);
    return mesh;
  });

  // What a ray is tested against: each member's parts as built, placed as it stands, as a plant's own meshes are.
  const picks = prepared.map((p) => {
    const group = new THREE.Group();
    for (const part of p.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(part.positions, 3));
      g.setIndex(new THREE.BufferAttribute(part.indices, 1));
      g.computeBoundingSphere();
      group.add(new THREE.Mesh(g));
    }
    group.applyMatrix4(p.matrix);
    group.updateMatrixWorld(true);
    return group;
  });

  return {
    object,
    members: members.length,
    triangles,
    setVitality(member, v) {
      const value = shownVitality(v);
      data[(member * width + 4) * 4] = value;
      texture.needsUpdate = true;
      const smoke = smokeLife[member];
      if (smoke !== undefined) smoke.uVitality.value = value;
    },
    move(member, at) {
      const p = prepared[member];
      if (p === undefined) return;
      const before = p.matrix.clone().invert();
      p.matrix = placement(at);
      p.bounds = p.local.clone().applyMatrix4(p.matrix);
      for (let c = 0; c < 4; c++) texel(member, c, p.matrix.elements.slice(c * 4, c * 4 + 4));
      texture.needsUpdate = true;
      bound();
      const moved = new THREE.Matrix4().multiplyMatrices(p.matrix, before);
      const group = picks[member];
      group?.applyMatrix4(moved);
      group?.updateMatrixWorld(true);
      for (const v of veils) if (v.userData.member === member) v.applyMatrix4(moved);
    },
    pick(raycaster) {
      let best: { member: number; distance: number } | undefined;
      picks.forEach((group, member) => {
        const hit = raycaster.intersectObject(group, true)[0];
        if (hit !== undefined && (best === undefined || hit.distance < best.distance)) best = { member, distance: hit.distance };
      });
      return best;
    },
    useDepth(on) {
      for (const m of meshes) m.mesh.material = on ? m.depth : m.color;
      for (const v of veils) v.visible = !on;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const group of picks) group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      for (const m of materials) m.dispose();
      texture.dispose();
      object.removeFromParent();
    },
  };
}
