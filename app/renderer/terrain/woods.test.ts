import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Library, seedOf } from "@gaia/schema";
import { TREE_PRIMITIVES } from "@gaia/primitives";
import { tree } from "@gaia/kinds";
import { sweep } from "@gaia/world";
import { type Realized, realize, shownVitality } from "@gaia/realize";
import { createSceneLight, farChoice, settleVitality } from "@gaia/render";
import { FAR, GONE, type PassSize, TURN, createCopies, createFarForms, farness } from "./woods.ts";

describe("a crown's form by its size on screen", () => {
  it("turns far only across the band, never at once", () => {
    const top = FAR.swapPx * FAR.band;
    expect(farness(top * 2)).toBe(0);
    expect(farness(top)).toBe(0);
    expect(farness(FAR.swapPx)).toBe(1);
    expect(farness(FAR.swapPx / 4)).toBe(1);
    // Across the band the far form's share rises steadily as the crown shrinks, with no jump.
    let last = 0;
    for (let px = top; px >= FAR.swapPx; px -= 0.25) {
      const f = farness(px);
      expect(f).toBeGreaterThanOrEqual(last);
      expect(f - last).toBeLessThan(0.01);
      last = f;
    }
  });
});

describe("a copy turning far", () => {
  const treeLib = new Library(TREE_PRIMITIVES);
  // The first tree blueprint from a sweep over a tree's parts.
  const firstTree = sweep(tree, treeLib).blueprints[0]!;
  const plant = realize(firstTree, tree, treeLib, { seed: seedOf("woods-test/tree"), facts: { scale: 1, age: 120 } });
  const light = createSceneLight();
  const again = (): Promise<Realized> => Promise.resolve(plant);
  const forms = createFarForms(light, 1);
  const far = forms.add(plant, again);
  // Its form has a slot at its full swap size. The woods need nothing baked in the slot to choose.
  forms.set(far.form, 0, FAR.swapPx);
  const copies = createCopies(plant, light, [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1 }], far);
  const crown = copies.crown;
  const focal = 800;
  /** Whether the full form draws in one pass with the copy's crown spanning `px` device pixels. */
  const fullAt = (camera: THREE.Camera, size: PassSize): boolean => {
    camera.updateMatrixWorld();
    light.uEye.value.copy(camera.position);
    copies.cull(camera, size);
    return copies.drawn().copies > 0;
  };
  const perspective = (px: number): boolean => {
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10000);
    camera.position.set(crown.center.x, crown.center.y, crown.center.z + (2 * crown.radius * focal) / px);
    camera.lookAt(crown.center);
    return fullAt(camera, { smaller: 1, focal, ortho: false });
  };

  it("keeps its full form exactly where its card's rule keeps it: across the band, past it until it has dissolved, and while its form fades in or holds no slot", () => {
    for (const px of [FAR.swapPx * 2, FAR.swapPx * 1.12, FAR.swapPx * 0.93, (FAR.swapPx / FAR.leave) * 0.95, 20, 6]) {
      expect(perspective(px), `${px} px`).toBe(farChoice(px, FAR.swapPx, TURN, false).full);
    }
    // A form fading in turns far at the size it turns far at now, and a form with no slot keeps its full form.
    const own = createFarForms(light, 1);
    const turning = own.add(plant, again);
    const one = createCopies(plant, light, [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1 }], turning);
    const fullOf = (px: number): boolean => {
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10000);
      camera.position.set(crown.center.x, crown.center.y, crown.center.z + (2 * crown.radius * focal) / px);
      camera.lookAt(crown.center);
      camera.updateMatrixWorld();
      light.uEye.value.copy(camera.position);
      one.cull(camera, { smaller: 1, focal, ortho: false });
      return one.drawn().copies > 0;
    };
    expect(fullOf(20)).toBe(true);
    // Halfway faded in, the form switches at a smaller span. A copy below that span has its card alone, and one above it its full form.
    own.set(turning.form, 0, 40);
    expect(fullOf(20)).toBe(false);
    expect(fullOf(60)).toBe(true);
    own.set(turning.form, -1, 0);
    expect(fullOf(20)).toBe(true);
    // With no far form at all, a copy draws across the dissolve, and nothing once its crown is too small to see.
    const alone = createCopies(plant, light, [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1 }]);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100000);
    // A short focal length keeps the copy well inside `AIR.dissolveEnd`.
    const short = 80;
    const at = (px: number): boolean => {
      camera.position.set(crown.center.x, crown.center.y, crown.center.z + (2 * crown.radius * short) / px);
      camera.lookAt(crown.center);
      camera.updateMatrixWorld();
      light.uEye.value.copy(camera.position);
      alone.cull(camera, { smaller: 1, focal: short, ortho: false });
      return alone.drawn().copies > 0;
    };
    // Across the dissolve the copy still draws, and its shader dissolves it. Once gone, its cell draws nothing.
    expect(at(GONE.start + 1)).toBe(true);
    expect(at((GONE.start + GONE.end) / 2)).toBe(true);
    expect(at(GONE.end * 0.9)).toBe(false);
  });

  it("shows a vitality on its card as its full form shows it, whether the vitality came before its far form took a slot or after", () => {
    const shownOnCard = (setter: "setVitality" | "setVitalityAt", before: boolean): number => {
      const later = createFarForms(light, 1);
      const own = later.add(plant, again);
      const one = createCopies(plant, light, [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1 }], own);
      const set = (): void => (setter === "setVitality" ? one.setVitality(0.5) : one.setVitalityAt(0, 0.5));
      if (before) set();
      later.set(own.form, 0, FAR.swapPx);
      one.warm();
      if (!before) set();
      // Let the vitality change ease in fully.
      settleVitality();
      const mesh = later.cards.object.children[0] as THREE.Mesh<THREE.InstancedBufferGeometry>;
      return mesh.geometry.getAttribute("aMore").array[1] as number;
    };
    for (const setter of ["setVitality", "setVitalityAt"] as const) {
      for (const before of [true, false]) expect(shownOnCard(setter, before), `${setter}, ${before ? "before" : "after"}`).toBeCloseTo(shownVitality(0.5), 6);
    }
  });
});
