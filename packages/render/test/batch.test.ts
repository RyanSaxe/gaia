import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { structure } from "@gaia/kinds";
import { FLORA_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { mergeParts, realize } from "@gaia/realize";
import { Library, blueprintOf, rand } from "@gaia/schema";
import { randomSlots } from "@gaia/world/testing";
import { createPlant, createPlantBatch, createSceneLight, settleVitality } from "@gaia/render";

const lib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
/** Four buildings drawn from everything Jev can compose, each built as the settlement builds one. */
const plants = (() => {
  const r = rand(11);
  return Array.from({ length: 4 }, (_, i) => realize(blueprintOf("structure", randomSlots(structure, lib, () => r.next())), structure, lib, { seed: 11 + i, facts: { size: 1, floors: 1.5, reach: 0.5 } }));
})();
const members = plants.map((plant, i) => ({ plant, x: i * 40, y: 2, z: -30, yaw: i * 0.7, vitality: 1 - i * 0.3 }));
const light = createSceneLight();
const batch = createPlantBatch(members, light);
const meshes = batch.object.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.geometry.getAttribute("aBatch") !== undefined);
/** What the batch's shaders read for each building, such as its placement and how its vitality shows. */
const texture = (meshes[0]?.material as THREE.ShaderMaterial).uniforms.uBatch?.value as THREE.DataTexture;

describe("a batch of buildings", () => {
  it("draws every member's parts that share a material in one mesh, so it costs a call per material however many buildings stand", () => {
    const alone = plants.reduce((n, plant) => n + createPlant({ ...plant, parts: mergeParts(plant.parts) }, light).object.children.length, 0);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length).toBeLessThanOrEqual(8);
    expect(meshes.length * 3).toBeLessThan(alone);
    // It draws exactly the triangles the buildings drew alone.
    expect(batch.triangles).toBe(plants.reduce((n, plant) => n + plant.parts.filter((p) => p.swatch !== "smoke").reduce((t, p) => t + p.indices.length / 3, 0), 0));
  });

  it("shows a change in one building's vitality without rebuilding any geometry", () => {
    const versions = (m: THREE.Mesh): number[] => Object.values(m.geometry.attributes).map((a) => (a as THREE.BufferAttribute).version);
    const geometry = meshes.map((m) => ({ geometry: m.geometry, versions: versions(m), index: m.geometry.index?.version }));
    const shown = (texture.image.data as Float32Array).slice();
    // The first building stands at vitality 1.
    batch.setVitality(0, 0.05);
    settleVitality();
    // What the shaders read changes, and every mesh keeps its geometry, its buffers unwritten.
    expect((texture.image.data as Float32Array).some((v, i) => v !== shown[i])).toBe(true);
    meshes.forEach((m, i) => {
      expect(m.geometry).toBe(geometry[i]?.geometry);
      expect(versions(m)).toEqual(geometry[i]?.versions);
      expect(m.geometry.index?.version).toBe(geometry[i]?.index);
    });
  });

  it("names the building a ray hits, and follows a building to a new site", () => {
    const down = (x: number, z: number): THREE.Raycaster => new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
    expect(batch.pick(down(40, -30))?.member).toBe(1);
    expect(batch.pick(down(20, -30 + 200))).toBeUndefined();
    batch.move(1, { x: 300, y: 0, z: 300, yaw: 0 });
    expect(batch.pick(down(300, 300))?.member).toBe(1);
    // Every mesh's bounds include the building at its new position, so no pass culls it.
    for (const m of meshes) expect(m.geometry.boundingSphere?.containsPoint(new THREE.Vector3(300, 3, 300))).toBe(true);
  });
});
