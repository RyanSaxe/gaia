import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Library, seedOf } from "@gaia/schema";
import { TREE_PRIMITIVES } from "@gaia/primitives";
import { tree } from "@gaia/kinds";
import { sweep } from "@gaia/world";
import { mergeParts, realize } from "@gaia/realize";
import { createPlant, createSceneLight, geometryOf } from "@gaia/render";

const treeLib = new Library(TREE_PRIMITIVES);
/** The first tree blueprint from a sweep over a tree's parts. */
const firstTree = sweep(tree, treeLib).blueprints[0]!;
const plant = realize(firstTree, tree, treeLib, { seed: seedOf("plant-buffers"), facts: { scale: 1, age: 120 } });

/** Every buffer under `object` as the renderer leaves it after upload, with its upload callback run. */
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
});

describe("a plant's geometry as the GPU holds it", () => {
  it("numbers its vertices in 16 bits, or in 32 once it has more than 65,535", () => {
    const largest = plant.parts.reduce((a, b) => (b.shade.length > a.shade.length ? b : a));
    const merged = mergeParts(Array.from({ length: Math.ceil(65536 / largest.shade.length) }, () => largest))[0];
    if (merged === undefined) throw new Error("mergeParts returned nothing.");
    expect(largest.shade.length).toBeLessThan(65536);
    expect(merged.shade.length).toBeGreaterThan(65535);
    const index = (part: typeof merged): THREE.BufferAttribute | null => geometryOf(part).index;
    expect(index(largest)?.array.BYTES_PER_ELEMENT).toBe(2);
    expect(index(merged)?.array.BYTES_PER_ELEMENT).toBe(4);
    for (const part of [largest, merged]) expect(Array.from(index(part)?.array ?? [])).toEqual(Array.from(part.indices));
  });
});
