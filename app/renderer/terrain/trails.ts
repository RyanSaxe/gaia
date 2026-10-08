// The paths as the ground and the grass read them, and the things built
// along them. The trail field rides in the ground texture's fourth channel,
// so the ground paints worn earth and the grass parts from the same samples.
// A trail stands for a dependency between two entities and walks the ways of
// one network; each way's wear follows the vitality of every trail walking
// it (`wayWear` in @gaia/terrain): a second texture says which ways each
// sample lies on and how far along them, and a tiny one holds each way's
// wear at a few stations along it, rewritten live, so a way between thriving
// entities is worn bare and one only failing entities walk grows over, with
// nothing rebaked. The footbridges, stepping stones, edging stones and the
// junctions' cairns are ordinary components in the plant material, so they
// wither with their way's vitality like everything else.

import * as THREE from "three";
import { type Built, type Library, seedOf } from "@gaia/schema";
import { buildCairn, buildEdgingStones, buildFootbridge, buildSteppingStones } from "@gaia/primitives";
import { type Realized, mergeParts } from "@gaia/realize";
import { type PlantView, type SceneLight, createPlant } from "@gaia/render";
import { type Terrain, type TrailNetwork, type Way, edgeStones, junctionVitality, wayVitalityAt, wayWear } from "@gaia/terrain";

/**
 * GLSL: the signed distance to the nearest way's edge, meters, negative on
 * the tread, read with the mesh's own triangle interpolation; and how worn
 * the ways are at a point, blended between each way's stations as
 * `wayWearAt` in @gaia/terrain does. Where ways meet, the more worn one
 * shows. Needs the ground texture's uniforms (GROUND_SAMPLE_GLSL) declared
 * first.
 */
export const TRAIL_GLSL = /* glsl */ `
uniform sampler2D uTrailPlace;
uniform sampler2D uTrailEnds;
float trailAt(vec2 xz) {
  vec2 g = clamp((xz - uGroundOrigin) / uGroundSpacing, vec2(0.0), vec2(uGroundN - 1.001));
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  float h00 = texelFetch(uGround, i, 0).a;
  float h10 = texelFetch(uGround, i + ivec2(1, 0), 0).a;
  float h01 = texelFetch(uGround, i + ivec2(0, 1), 0).a;
  float h11 = texelFetch(uGround, i + ivec2(1, 1), 0).a;
  if (f.x + f.y <= 1.0) return h00 + f.x * (h10 - h00) + f.y * (h01 - h00);
  return h11 + (1.0 - f.x) * (h01 - h11) + (1.0 - f.y) * (h10 - h11);
}
// One way's wear at a packed place (its index, plus how far along it in the fraction), between its four stations.
float trailWearOf(float packed) {
  if (packed < 0.0) return 0.0;
  float k = floor(packed);
  vec4 s = texelFetch(uTrailEnds, ivec2(int(k), 0), 0);
  float f = clamp((packed - k) / 0.999, 0.0, 1.0) * 3.0;
  return f < 1.0 ? mix(s.x, s.y, f) : f < 2.0 ? mix(s.y, s.z, f - 1.0) : mix(s.z, s.w, f - 2.0);
}
float trailWearSample(ivec2 i) {
  vec2 p = texelFetch(uTrailPlace, i, 0).xy;
  return max(trailWearOf(p.x), trailWearOf(p.y));
}
float trailWearAt(vec2 xz) {
  vec2 g = clamp((xz - uGroundOrigin) / uGroundSpacing, vec2(0.0), vec2(uGroundN - 1.001));
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  float h00 = trailWearSample(i);
  float h10 = trailWearSample(i + ivec2(1, 0));
  float h01 = trailWearSample(i + ivec2(0, 1));
  float h11 = trailWearSample(i + ivec2(1, 1));
  if (f.x + f.y <= 1.0) return h00 + f.x * (h10 - h00) + f.y * (h01 - h00);
  return h11 + (1.0 - f.x) * (h01 - h11) + (1.0 - f.y) * (h10 - h11);
}
`;

const texture = (data: Float32Array, width: number, height: number, format: THREE.PixelFormat): THREE.DataTexture => {
  const t = new THREE.DataTexture(data, width, height, format, THREE.FloatType);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
};

/** The paths' textures, shared by the ground and the grass: which ways each sample lies on, and each way's wear at its stations. */
export const trailUniforms = {
  uTrailPlace: { value: texture(new Float32Array([-1, -1]), 1, 1, THREE.RGFormat) },
  uTrailEnds: { value: texture(new Float32Array(4), 1, 1, THREE.RGBAFormat) },
};

/** Takes on a bake's `trailPlaces`, two numbers per lattice sample of an `n` by `n` lattice. */
export function setTrailPlaces(places: Float32Array, n: number): void {
  const old = trailUniforms.uTrailPlace.value;
  trailUniforms.uTrailPlace.value = texture(places, n, n, THREE.RGFormat);
  old.dispose();
}

/**
 * Each way's wear at its stations, from the vitality of the entities every
 * trail walking it joins (`wayWear`). Call it again whenever an entity's
 * vitality changes; it only rewrites a texel per way.
 */
export function setTrailEnds(network: TrailNetwork, vitalityOf: (place: string) => number): void {
  const n = Math.max(1, network.ways.length);
  let ends = trailUniforms.uTrailEnds.value;
  if (ends.image.width !== n) {
    ends.dispose();
    ends = texture(new Float32Array(n * 4), n, 1, THREE.RGBAFormat);
    trailUniforms.uTrailEnds.value = ends;
  }
  const data = ends.image.data as Float32Array;
  network.ways.forEach((_, i) => data.set(wayWear(network, i, vitalityOf), i * 4));
  ends.needsUpdate = true;
}

export interface Ways {
  /** Every component built along the trails, for shadows and the mirror. */
  readonly views: readonly PlantView[];
  /** Sets each crossing's, edging's and cairn's vitality from the trails walking its way (`wayVitalityAt`, `junctionVitality`). */
  setVitality(vitalityOf: (place: string) => number): void;
  dispose(): void;
}

const STONE_PALETTE = (lib: Library): Realized["palette"] => {
  const palette = lib.get("palette@1");
  return (palette.build as (p: unknown) => Realized["palette"])({ family: "spring-meadow", contrast: 1 });
};

/** How far along a way (0 to 1) its center line passes nearest a point. */
function alongOf(trail: Way, x: number, z: number): number {
  const pts = trail.points;
  const count = pts.length / 2;
  let best = 0;
  let near = Infinity;
  for (let k = 0; k < count; k++) {
    const d = Math.hypot((pts[k * 2] as number) - x, (pts[k * 2 + 1] as number) - z);
    if (d < near) {
      near = d;
      best = k;
    }
  }
  return best / Math.max(1, count - 1);
}

/** Builds each way's crossings and edging stones, and each junction's cairn, and adds them to the scene. */
export function createWays(scene: THREE.Scene, light: SceneLight, lib: Library, t: Terrain, network: TrailNetwork): Ways {
  const palette = STONE_PALETTE(lib);
  const placed: { view: PlantView; vitality: (of: (place: string) => number) => number }[] = [];
  const show = (built: Built, x: number, y: number, z: number, yaw: number, vitality: (of: (place: string) => number) => number): void => {
    if (built.parts.length === 0) return;
    const view = createPlant({ parts: mergeParts(built.parts), motion: { sway: 0, frequency: 0 }, palette, slots: new Map() }, light);
    view.object.position.set(x, y, z);
    view.object.rotation.y = yaw;
    scene.add(view.object);
    placed.push({ view, vitality });
  };
  const add = (built: Built, x: number, y: number, z: number, yaw: number, way: number, along: number): void => show(built, x, y, z, yaw, (of) => wayVitalityAt(network, way, along, of));
  network.ways.forEach((trail, i) => {
    trail.crossings.forEach((c, k) => {
      const seed = seedOf(`${trail.id}/crossing${k}`);
      const along = alongOf(trail, c.x, c.z);
      if (trail.style.crossing === "footbridge") add(buildFootbridge(c.span, trail.style.width, seed), c.x, c.bank, c.z, c.yaw, i, along);
      else add(buildSteppingStones(c.span, seed), c.x, c.level, c.z, c.yaw, i, along);
    });
    // One mesh of edging stones per way, so each follows its own way's vitality.
    const stones = edgeStones(t, trail, seedOf(`${trail.id}/edging`));
    if (stones.length > 0) add(buildEdgingStones(stones, seedOf(`${trail.id}/edging-stones`)), 0, 0, 0, 0, i, 0.5);
  });
  // A small cairn beside a junction, where it suits.
  for (const j of network.junctions) {
    if (j.cairn === null) continue;
    show(buildCairn(seedOf(`${j.id}/cairn`)), j.cairn.x, j.cairn.y, j.cairn.z, seedOf(`${j.id}/turn`) % 628 / 100, (of) => junctionVitality(network, j, of));
  }
  return {
    views: placed.map((p) => p.view),
    setVitality(vitalityOf) {
      for (const p of placed) p.view.setVitality(p.vitality(vitalityOf));
    },
    dispose() {
      for (const p of placed) p.view.dispose();
    },
  };
}
