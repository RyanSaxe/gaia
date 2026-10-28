import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { structure } from "@gaia/kinds";
import { FLORA_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { mergeParts, realize, shownVitality } from "@gaia/realize";
import { Library, blueprintOf, rand } from "@gaia/schema";
import { randomSlots } from "@gaia/world/testing";
import { createPlant, createPlantBatch, createSceneLight, easeVitality, settleVitality } from "@gaia/render";

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
const texture = (meshes[0]?.material as THREE.ShaderMaterial).uniforms.uBatch?.value as THREE.DataTexture;
const row = (member: number, x: number): number[] => {
  const width = texture.image.width;
  return [...(texture.image.data as Float32Array).slice((member * width + x) * 4, (member * width + x) * 4 + 4)];
};

describe("a batch of buildings", () => {
  it("draws every member's parts that share a material in one mesh, so it costs a call per material however many buildings stand", () => {
    const alone = plants.reduce((n, plant) => n + createPlant({ ...plant, parts: mergeParts(plant.parts) }, light).object.children.length, 0);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length).toBeLessThanOrEqual(8);
    expect(meshes.length * 3).toBeLessThan(alone);
    // It draws exactly the triangles the buildings drew alone.
    expect(batch.triangles).toBe(plants.reduce((n, plant) => n + plant.parts.filter((p) => p.swatch !== "smoke").reduce((t, p) => t + p.indices.length / 3, 0), 0));
  });

  it("names each vertex's building and swatch, and holds each building's placement and how its vitality shows where its shaders read them", () => {
    const owners = new Set<number>();
    for (const m of meshes) {
      const a = m.geometry.getAttribute("aBatch");
      for (let i = 0; i < a.count; i++) owners.add(a.getX(i));
    }
    expect([...owners].sort()).toEqual([0, 1, 2, 3]);
    members.forEach((m, i) => {
      // The fourth column of its matrix is its position.
      expect(row(i, 3).slice(0, 3)).toEqual([m.x, m.y, m.z]);
      expect(row(i, 4)[0]).toBeCloseTo(shownVitality(m.vitality), 6);
    });
    // A change in one building's vitality rewrites its texel alone, and no geometry.
    const before = meshes.map((m) => m.geometry.getAttribute("position"));
    batch.setVitality(2, 0.05);
    settleVitality();
    expect(row(2, 4)[0]).toBeCloseTo(shownVitality(0.05), 6);
    expect(row(1, 4)[0]).toBeCloseTo(shownVitality(members[1]?.vitality ?? 0), 6);
    expect(meshes.map((m) => m.geometry.getAttribute("position"))).toEqual(before);
  });

  it("eases a change in a building's vitality in from where it was, and settles exactly on the new vitality", () => {
    settleVitality();
    const was = row(3, 4)[0] as number;
    batch.setVitality(3, 0.9);
    const now = shownVitality(0.9);
    // A frame with no time passing moves nothing. Each frame's time moves the shown vitality a little toward the new
    // one, and its previous value a little behind that, so the change starts gently.
    easeVitality(0);
    expect(row(3, 4)[0]).toBe(was);
    const shown: number[] = [];
    for (let k = 0; k < 30; k++) {
      easeVitality(1 / 60);
      shown.push(row(3, 4)[0] as number);
      // The previous value, shown + lag, stays between where it started and where it shows now.
      const behind = (row(3, 4)[0] as number) + (row(3, 5)[2] as number);
      expect(behind).toBeGreaterThanOrEqual(Math.min(was, row(3, 4)[0] as number) - 1e-6);
      expect(behind).toBeLessThanOrEqual(Math.max(was, row(3, 4)[0] as number) + 1e-6);
    }
    expect(Math.abs((shown[29] as number) - was)).toBeGreaterThan(Math.abs((shown[0] as number) - was));
    expect(Math.abs((shown[29] as number) - now)).toBeGreaterThan(0);
    // Given time it comes to rest exactly, so a building at rest shows its vitality exactly.
    for (let k = 0; k < 60 * 60; k++) easeVitality(1 / 60);
    expect(row(3, 5)[2]).toBe(0);
    expect(row(3, 4)[0]).toBeCloseTo(now, 6);
  });

  it("names the building a ray hits, and follows a building to a new site", () => {
    const down = (x: number, z: number): THREE.Raycaster => new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
    expect(batch.pick(down(40, -30))?.member).toBe(1);
    expect(batch.pick(down(20, -30 + 200))).toBeUndefined();
    batch.move(1, { x: 300, y: 0, z: 300, yaw: 0 });
    expect(batch.pick(down(300, 300))?.member).toBe(1);
    expect(row(1, 3).slice(0, 3)).toEqual([300, 0, 300]);
    // Every mesh's bounds include the building at its new position, so no pass culls it.
    for (const m of meshes) expect(m.geometry.boundingSphere?.containsPoint(new THREE.Vector3(300, 3, 300))).toBe(true);
  });
});
