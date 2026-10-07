// A hand-rolled sun shadow map, as in v1/v2: a depth-only orthographic pass
// over the plants, sampled manually by every material through SceneLight.
// At night it is cast by the moon.

import * as THREE from "three";
import type { SceneLight } from "./light.ts";
import type { PlantView } from "./plant.ts";

export interface SunShadow {
  /** Renders the plants' depth from the sun, covering a square of `extent` around `center`. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, plants: readonly PlantView[], hide: readonly THREE.Object3D[]): void;
  frame(center: THREE.Vector3, extent: number): void;
  dispose(): void;
}

/** How far below the horizon (as a direction's height) the sun lends no light; `lightAt` in @gaia/realize ends it there. */
const SUN_GONE = 0.04;
const smooth01 = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function createSunShadow(light: SceneLight, size = 2048): SunShadow {
  const target = new THREE.WebGLRenderTarget(size, size, {
    depthTexture: new THREE.DepthTexture(size, size),
    depthBuffer: true,
  });
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 1, 120);
  light.uShadowMap.value = target.depthTexture;
  light.uShadowTexel.value = 1 / size;
  const center = new THREE.Vector3();
  let extent = 20;

  const update = (): void => {
    // Once the sun is down the map follows the moon, and moon shadows fade in
    // with the night. They rise from nothing as the sun sinks past the point
    // where its light ends, so the map's change of caster never shows.
    const fromMoon = light.uSunIntensity.value <= 0.001;
    const sun = fromMoon ? light.uMoonDirection.value : light.uSunDirection.value;
    const night = smooth01((light.uNightness.value - 0.45) / 0.35);
    const sunk = smooth01((-light.uSunDirection.value.y - SUN_GONE) / 0.12);
    light.uMoonShadow.value = fromMoon ? night * sunk : 0;
    camera.position.copy(center).addScaledVector(sun, 60);
    camera.up.set(0, 1, 0);
    camera.lookAt(center);
    camera.left = -extent;
    camera.right = extent;
    camera.top = extent;
    camera.bottom = -extent;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    light.uShadowMatrix.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  };
  update();

  return {
    frame(c, e) {
      center.copy(c);
      extent = e;
      update();
    },
    render(renderer, scene, plants, hide) {
      const visible = hide.map((o) => o.visible);
      for (const o of hide) o.visible = false;
      for (const p of plants) p.useDepth(true);
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
      for (const p of plants) p.useDepth(false);
      hide.forEach((o, i) => (o.visible = visible[i] ?? true));
    },
    dispose() {
      target.dispose();
    },
  };
}
