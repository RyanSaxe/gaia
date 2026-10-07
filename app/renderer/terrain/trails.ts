// Trails as the ground and the grass read them, and the things built along
// them. The trail field rides in the ground texture's fourth channel, so the
// ground paints worn earth and the grass parts from the same samples. A
// trail stands for a dependency between two entities, and its wear follows
// their vitality: a second texture says which trails each sample lies on and
// how far along them, and a tiny one holds each trail's ends' vitality, which
// changes live, so a trail between thriving entities is worn bare and one to
// a failing entity grows over, with nothing rebaked. The footbridges,
// stepping stones and edging stones are ordinary components in the plant
// material, so they wither with the trail's vitality like everything else.

import * as THREE from "three";
import { type Built, type Library, seedOf } from "@gaia/schema";
import { buildEdgingStones, buildFootbridge, buildSteppingStones } from "@gaia/primitives";
import { type Realized, mergeParts } from "@gaia/realize";
import { type PlantView, type SceneLight, createPlant } from "@gaia/render";
import { type Terrain, type Trail, edgeStones } from "@gaia/terrain";

/**
 * GLSL: the signed distance to the nearest trail's edge, meters, negative on
 * the tread, read with the mesh's own triangle interpolation; and how worn
 * the trails are at a point, from the vitality of the entities each joins,
 * blended along it as `trailWearAt` in @gaia/terrain does. Where trails meet,
 * the more worn one shows. Needs the ground texture's uniforms
 * (GROUND_SAMPLE_GLSL) declared first.
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
// One trail's wear at a packed place (its index, plus how far along it in the fraction).
float trailWearOf(float packed) {
  if (packed < 0.0) return 0.0;
  float k = floor(packed);
  vec4 ends = texelFetch(uTrailEnds, ivec2(int(k), 0), 0);
  float v = mix(ends.x, ends.y, smoothstep(0.15, 0.85, (packed - k) / 0.999));
  return ends.z * (0.2 + 0.8 * smoothstep(0.05, 0.75, v));
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

/** The trails' textures, shared by the ground and the grass: which trails each sample lies on, and each trail's ends' vitality and wear. */
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
 * Each trail's ends: the vitality of the entity at its first end and at its
 * second, and its blueprint's wear. Call it again whenever an entity's
 * vitality changes; it only rewrites a texel per trail.
 */
export function setTrailEnds(trails: readonly Trail[], vitalityOf: (place: string) => number): void {
  const n = Math.max(1, trails.length);
  let ends = trailUniforms.uTrailEnds.value;
  if (ends.image.width !== n) {
    ends.dispose();
    ends = texture(new Float32Array(n * 4), n, 1, THREE.RGBAFormat);
    trailUniforms.uTrailEnds.value = ends;
  }
  const data = ends.image.data as Float32Array;
  trails.forEach((t, i) => {
    data[i * 4] = vitalityOf(t.from);
    data[i * 4 + 1] = vitalityOf(t.to);
    data[i * 4 + 2] = t.style.wear;
  });
  ends.needsUpdate = true;
}

export interface Ways {
  /** Every component built along the trails, for shadows and the mirror. */
  readonly views: readonly PlantView[];
  /** Sets each crossing's and each trail's edging's vitality from the vitality at its place along its trail. */
  setVitality(at: (trail: number, along: number) => number): void;
  dispose(): void;
}

const STONE_PALETTE = (lib: Library): Realized["palette"] => {
  const palette = lib.get("palette@1");
  return (palette.build as (p: unknown) => Realized["palette"])({ family: "spring-meadow", contrast: 1 });
};

/** How far along a trail (0 to 1) its center line passes nearest a point. */
function alongOf(trail: Trail, x: number, z: number): number {
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

/** Builds each trail's crossings and edging stones and adds them to the scene. */
export function createWays(scene: THREE.Scene, light: SceneLight, lib: Library, t: Terrain, trails: readonly Trail[]): Ways {
  const palette = STONE_PALETTE(lib);
  const placed: { view: PlantView; trail: number; along: number }[] = [];
  const add = (built: Built, x: number, y: number, z: number, yaw: number, trail: number, along: number): void => {
    if (built.parts.length === 0) return;
    const view = createPlant({ parts: mergeParts(built.parts), motion: { sway: 0, frequency: 0 }, palette, slots: new Map() }, light);
    view.object.position.set(x, y, z);
    view.object.rotation.y = yaw;
    scene.add(view.object);
    placed.push({ view, trail, along });
  };
  trails.forEach((trail, i) => {
    trail.crossings.forEach((c, k) => {
      const seed = seedOf(`${trail.id}/crossing${k}`);
      const along = alongOf(trail, c.x, c.z);
      if (trail.style.crossing === "footbridge") add(buildFootbridge(c.span, trail.style.width, seed), c.x, c.bank, c.z, c.yaw, i, along);
      else add(buildSteppingStones(c.span, seed), c.x, c.level, c.z, c.yaw, i, along);
    });
    // One mesh of edging stones per trail, so each follows its own trail's vitality.
    const stones = edgeStones(t, trail, seedOf(`${trail.id}/edging`));
    if (stones.length > 0) add(buildEdgingStones(stones, seedOf(`${trail.id}/edging-stones`)), 0, 0, 0, 0, i, 0.5);
  });
  return {
    views: placed.map((p) => p.view),
    setVitality(at) {
      for (const p of placed) p.view.setVitality(at(p.trail, p.along));
    },
    dispose() {
      for (const p of placed) p.view.dispose();
    },
  };
}
