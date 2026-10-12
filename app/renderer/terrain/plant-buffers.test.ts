import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Library, seedOf } from "@gaia/schema";
import { FLORA_PRIMITIVES } from "@gaia/primitives";
import { flora } from "@gaia/kinds";
import { FLORA_PRESETS, mergeParts, realize } from "@gaia/realize";
import { createPlant, createPlantInstances, createSceneLight, geometryOf } from "@gaia/render";

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

describe("a plant's geometry as the GPU holds it", () => {
  it("holds normals and color in 16 bits that read back as the plant wrote them, and what moves a vertex exactly", () => {
    let worst = 0;
    let moved = 0;
    for (const part of plant.parts) {
      const g = geometryOf(part);
      const n = part.shade.length;
      const c = part.channels;
      const read = (name: string, columns: readonly Float32Array[]): number[] => {
        const a = g.getAttribute(name) as THREE.BufferAttribute;
        return columns.flatMap((column, k) => Array.from(column, (wrote, i) => a.getComponent(i, k) - wrote));
      };
      // Four 16-bit values a vertex, where floats took 12 or 16 bytes.
      for (const name of ["normal", "aLook"]) expect((g.getAttribute(name) as THREE.BufferAttribute).array.byteLength).toBe(n * 8);
      const normals = [0, 1, 2].map((k) => part.normals.filter((_, i) => i % 3 === k));
      for (const d of [...read("normal", normals), ...read("aLook", [part.shade, part.tint, c.wither, c.glow])]) worst = Math.max(worst, Math.abs(d));
      // A loss threshold off by the least step moves a leaf's edge across the samples it covers.
      moved += read("aLife", [c.loss, c.droop, c.close]).filter((d) => d !== 0).length;
    }
    // Rounded to the nearest of 16 bits' steps of 1/32767.
    expect(worst).toBeLessThanOrEqual(0.5 / 32767 + 1e-9);
    expect(moved).toBe(0);
  });

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
