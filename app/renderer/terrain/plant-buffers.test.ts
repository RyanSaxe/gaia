import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Library, seedOf } from "@gaia/schema";
import { FLORA_PRIMITIVES } from "@gaia/primitives";
import { flora } from "@gaia/kinds";
import { FLORA_PRESETS, realize } from "@gaia/realize";
import { createPlant, createPlantInstances, createSceneLight } from "@gaia/render";

const plant = realize((FLORA_PRESETS[0] as (typeof FLORA_PRESETS)[number]).blueprint, flora, new Library(FLORA_PRIMITIVES), { seed: seedOf("plant-buffers"), facts: { scale: 1, age: 120 } });

/** Every buffer under `object` as the renderer leaves it once uploaded: its upload callback run. */
function uploaded(object: THREE.Object3D): THREE.BufferAttribute[] {
  const all: THREE.BufferAttribute[] = [];
  object.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (g === undefined) return;
    for (const a of [...Object.values(g.attributes), ...(g.index === null ? [] : [g.index])]) {
      (a as THREE.BufferAttribute).onUploadCallback();
      all.push(a as THREE.BufferAttribute);
    }
  });
  return all;
}

describe("a plant's buffers once the GPU holds them", () => {
  it("leave a plant's view pickable by a ray, as a building or a landmark is", () => {
    const view = createPlant(plant, createSceneLight());
    uploaded(view.object);
    view.object.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, view.height * 0.3, 40), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObject(view.object, true).length).toBeGreaterThan(0);
  });

  it("keep no copy of an instanced plant's buffers on the page", () => {
    const copies = createPlantInstances(plant, createSceneLight(), [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1 }]);
    // The copies' instance matrices change as they are drawn, so they stay; everything built from the plant goes.
    const built = uploaded(copies.object).filter((a) => !(a instanceof THREE.InstancedBufferAttribute));
    expect(built.length).toBeGreaterThan(0);
    expect(built.every((a) => (a.array as unknown) === null)).toBe(true);
  });
});
