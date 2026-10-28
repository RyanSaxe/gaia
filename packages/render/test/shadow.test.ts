// The sun's shadow map follows the person. Its texels must stay put on the
// land as it does, or every shadow's edge crawls with each step.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createSceneLight, createSunShadow } from "@gaia/render";

const SIZE = 2048;
const EXTENT = 40;

/** Where a world point falls on the shadow map, in texels. */
function texelOf(matrix: THREE.Matrix4, p: THREE.Vector3): [number, number] {
  const c = p.clone().applyMatrix4(matrix);
  return [((c.x + 1) / 2) * SIZE, ((c.y + 1) / 2) * SIZE];
}

describe("the sun's shadow map", () => {
  for (const [hour, direction] of [
    ["the midday sun", new THREE.Vector3(0.45, 0.85, 0.3)],
    ["a low evening sun", new THREE.Vector3(-0.8, 0.2, 0.55)],
  ] as const) {
    it(`keeps its texels on the same spots of land as its box follows a walk, under ${hour}`, () => {
      const light = createSceneLight();
      light.uSunIntensity.value = 1;
      light.uSunDirection.value.copy(direction).normalize();
      const shadow = createSunShadow(light, SIZE);
      const spot = new THREE.Vector3(3.3, 0.7, -5.1);
      const at = (k: number): [number, number] => {
        // A walk of 2 m in 1.7 cm steps, a little less than half a texel, at eye height over a gentle slope.
        shadow.frame(new THREE.Vector3(0.017 * k, 1.6 + 0.004 * k, -0.011 * k), EXTENT);
        return texelOf(light.uShadowMatrix.value, spot);
      };
      const [u0, v0] = at(0);
      // The spot may fall on another texel of the map as the box moves on, but always at the same place within it.
      for (let k = 1; k < 120; k++) {
        const [u, v] = at(k);
        expect(Math.abs(u - u0 - Math.round(u - u0))).toBeLessThan(1e-3);
        expect(Math.abs(v - v0 - Math.round(v - v0))).toBeLessThan(1e-3);
      }
      shadow.dispose();
    });
  }

  it("is a depth map that compares and uploads even before the sun's pass exists, so no draw that reads it fails", () => {
    // Until a texture is marked for upload, with its version above 0, three binds a color placeholder in its place.
    const map = createSceneLight().uShadowMap.value;
    expect(map).toBeInstanceOf(THREE.DepthTexture);
    expect((map as THREE.DepthTexture).compareFunction).not.toBeNull();
    expect(map?.version).toBeGreaterThan(0);
  });
});
