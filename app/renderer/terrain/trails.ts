// Trails as the ground and the grass read them, and the things built along
// them. The trail field rides in the ground texture's fourth channel, so the
// ground paints worn earth and the grass parts from the same samples. The
// footbridges, stepping stones and edging stones are ordinary components in
// the plant material, so they wither with vitality like everything else.

import * as THREE from "three";
import { type Built, type Library, seedOf } from "@gaia/schema";
import { buildEdgingStones, buildFootbridge, buildSteppingStones } from "@gaia/primitives";
import { type Realized, mergeParts } from "@gaia/realize";
import { type PlantView, type SceneLight, createPlant } from "@gaia/render";
import { type Terrain, type Trail, edgeStones } from "@gaia/terrain";

/**
 * GLSL: the signed distance to the nearest trail's edge, meters, negative on
 * the tread, read with the mesh's own triangle interpolation. Needs the
 * ground texture's uniforms (GROUND_SAMPLE_GLSL) declared first.
 */
export const TRAIL_GLSL = /* glsl */ `
uniform float uTrailWear;
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
`;

/** How worn the world's trails read, shared by the ground and the grass. */
export const trailWear = { value: 0 };

export interface Ways {
  /** Every component built along the trails, for shadows and the mirror. */
  readonly views: readonly PlantView[];
  dispose(): void;
}

const STONE_PALETTE = (lib: Library): Realized["palette"] => {
  const palette = lib.get("palette@1");
  return (palette.build as (p: unknown) => Realized["palette"])({ family: "spring-meadow", contrast: 1 });
};

/** Builds each trail's crossings and edging stones and adds them to the scene. */
export function createWays(scene: THREE.Scene, light: SceneLight, lib: Library, t: Terrain, trails: readonly Trail[]): Ways {
  const palette = STONE_PALETTE(lib);
  const views: PlantView[] = [];
  const add = (built: Built, x: number, y: number, z: number, yaw: number): void => {
    if (built.parts.length === 0) return;
    const view = createPlant({ parts: mergeParts(built.parts), motion: { sway: 0, frequency: 0 }, palette, slots: new Map() }, light);
    view.object.position.set(x, y, z);
    view.object.rotation.y = yaw;
    scene.add(view.object);
    views.push(view);
  };
  for (const trail of trails) {
    trail.crossings.forEach((c, k) => {
      const seed = seedOf(`${trail.id}/crossing${k}`);
      if (trail.style.crossing === "footbridge") add(buildFootbridge(c.span, trail.style.width, seed), c.x, c.bank, c.z, c.yaw);
      else add(buildSteppingStones(c.span, seed), c.x, c.level, c.z, c.yaw);
    });
  }
  const stones = trails.flatMap((trail) => edgeStones(t, trail, seedOf(`${trail.id}/edging`)));
  if (stones.length > 0) add(buildEdgingStones(stones, seedOf("edging")), 0, 0, 0, 0);
  return {
    views,
    dispose() {
      for (const v of views) v.dispose();
    },
  };
}
