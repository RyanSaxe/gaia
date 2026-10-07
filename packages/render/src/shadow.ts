// A hand-rolled sun shadow map, as in v1/v2: a depth-only orthographic pass
// over the plants, sampled manually by every material through SceneLight.

import * as THREE from "three";
import type { SceneLight } from "./light.ts";
import type { PlantView } from "./plant.ts";

export interface SunShadow {
  /** Renders the plants' depth from the sun, covering a square of `extent` around `center`. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, plants: readonly PlantView[], hide: readonly THREE.Object3D[]): void;
  frame(center: THREE.Vector3, extent: number): void;
  dispose(): void;
}

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
    const sun = light.uSunDirection.value;
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
