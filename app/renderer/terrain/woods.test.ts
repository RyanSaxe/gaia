import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Library, seedOf } from "@gaia/schema";
import { TREE_PRIMITIVES } from "@gaia/primitives";
import { tree } from "@gaia/kinds";
import { sweep } from "@gaia/world";
import { type Realized, realize, shownVitality } from "@gaia/realize";
import { createSceneLight, farChoice, settleVitality } from "@gaia/render";
import { FAR, GONE, type PassSize, TURN, createCopies, createFarForms, farness, goneAt } from "./woods.ts";

describe("a crown's form by its size on screen", () => {
  it("turns far only across the band, never at once", () => {
    const top = FAR.swapPx * FAR.band;
    expect(farness(top * 2)).toBe(0);
    expect(farness(top)).toBe(0);
    expect(farness(FAR.swapPx)).toBe(1);
    expect(farness(FAR.swapPx / 4)).toBe(1);
    // Across the band the far form comes in steadily as the crown shrinks, with no jump anywhere.
    let last = 0;
    for (let px = top; px >= FAR.swapPx; px -= 0.25) {
      const f = farness(px);
      expect(f).toBeGreaterThanOrEqual(last);
      expect(f - last).toBeLessThan(0.01);
      last = f;
    }
  });
});

describe("the far forms", () => {
  const again = (): Promise<Realized> => Promise.reject(new Error("not made again here"));

  it("are numbered in the order plants were given them, each baking at its share of the size", () => {
    const forms = createFarForms(createSceneLight(), 2);
    const tree = {} as Realized;
    const bush = {} as Realized;
    expect(forms.add(tree, again)).toMatchObject({ form: 0, share: 1, forms });
    expect(forms.add(bush, again, FAR.bush)).toMatchObject({ form: 1, share: FAR.bush });
    expect(forms.plants.map((p) => [p.plant, p.px])).toEqual([
      [tree, FAR.swapPx],
      [bush, FAR.swapPx * FAR.bush],
    ]);
  });

  it("turn far only while they hold a slot, every copy of one that holds none keeping its full form", () => {
    const forms = createFarForms(createSceneLight(), 1);
    const { form } = forms.add({} as Realized, again);
    expect(forms.swapPx(form)).toBe(0);
    forms.set(form, 0, FAR.swapPx * 0.5);
    expect([forms.slotOf(form), forms.swapPx(form)]).toEqual([0, FAR.swapPx * 0.5]);
    forms.set(form, -1, FAR.swapPx);
    expect([forms.slotOf(form), forms.swapPx(form)]).toEqual([-1, 0]);
  });
});

describe("a crown too small to see", () => {
  it("is gone past the distance goneAt gives, at any focal length", () => {
    for (const [radius, focal] of [[0.5, 1678], [1, 1443], [6, 800]] as const) {
      const d = goneAt(radius, focal);
      expect((2 * radius * focal) / d).toBeCloseTo(GONE.end, 9);
      expect(farChoice((2 * radius * focal) / (d * 1.001), FAR.swapPx * FAR.bush, TURN, false)).toEqual({ full: false, card: 0 });
    }
  });
});

describe("a copy turning far", () => {
  const treeLib = new Library(TREE_PRIMITIVES);
  // The first tree of a sweep of a tree's parts.
  const firstTree = sweep(tree, treeLib).blueprints[0]!;
  const plant = realize(firstTree, tree, treeLib, { seed: seedOf("woods-test/tree"), facts: { scale: 1, age: 120 } });
  const light = createSceneLight();
  const again = (): Promise<Realized> => Promise.resolve(plant);
  const forms = createFarForms(light, 1);
  const far = forms.add(plant, again);
  // Its form holds a slot, turned all the way in; the woods need nothing baked in it to choose.
  forms.set(far.form, 0, FAR.swapPx);
  const copies = createCopies(plant, light, [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1 }], far);
  const crown = copies.crown;
  const focal = 800;
  /** One pass with the copy's crown spanning `px` device pixels: whether its full form draws. */
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

  it("keeps its full form exactly where its card's rule keeps it: across the band, and past it until it has dissolved", () => {
    for (const px of [FAR.swapPx * 2, FAR.swapPx * 1.12, FAR.swapPx * 0.93, (FAR.swapPx / FAR.leave) * 0.95, 20, 6]) {
      expect(perspective(px), `${px} px`).toBe(farChoice(px, FAR.swapPx, TURN, false).full);
    }
  });

  it("turns far at the size its form turns far at now, and keeps its full form while the form holds no slot", () => {
    const own = createFarForms(light, 1);
    const turning = own.add(plant, again);
    const one = createCopies(plant, light, [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1 }], turning);
    const fullAt = (px: number): boolean => {
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10000);
      camera.position.set(crown.center.x, crown.center.y, crown.center.z + (2 * crown.radius * focal) / px);
      camera.lookAt(crown.center);
      camera.updateMatrixWorld();
      light.uEye.value.copy(camera.position);
      one.cull(camera, { smaller: 1, focal, ortho: false });
      return one.drawn().copies > 0;
    };
    expect(fullAt(20)).toBe(true);
    // Halfway turned in, it turns far at a smaller size: a copy past that has its card alone, one short of it its full form.
    own.set(turning.form, 0, 40);
    expect(fullAt(20)).toBe(false);
    expect(fullAt(60)).toBe(true);
    own.set(turning.form, -1, 0);
    expect(fullAt(20)).toBe(true);
  });

  it("counts the copies a view would draw far in any direction, by their crowns' size", () => {
    const spots = [10, 300, 900, 5000].map((z) => ({ x: 0, y: 0, z, yaw: 0, scale: 1 }));
    const own = createFarForms(light, 1);
    const set = createCopies(plant, light, spots, own.add(plant, again));
    const eye = new THREE.Vector3(crown.center.x, crown.center.y, crown.center.z);
    const expected = spots.filter((s) => {
      const d = Math.max(1, Math.abs(s.z));
      const px = (2 * crown.radius * focal) / d;
      return d - crown.radius < 1400 && px > GONE.end && px <= FAR.swapPx * FAR.band;
    }).length;
    expect(set.farCount(eye, focal)).toBe(expected);
    expect(own.weigh(eye, focal)[0]).toBe(expected);
  });

  it("in the sun's flat shadow pass, keeps its full form only to the band's end", () => {
    const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 10000);
    camera.position.set(crown.center.x, crown.center.y + 500, crown.center.z);
    camera.lookAt(crown.center);
    // A flat pass measures a crown by its size alone, whatever its distance.
    const flatFocal = (px: number): number => px / (2 * crown.radius);
    expect(fullAt(camera, { smaller: 1, focal: flatFocal(FAR.swapPx * 0.93), ortho: true })).toBe(false);
    expect(fullAt(camera, { smaller: 1, focal: flatFocal(FAR.swapPx * 1.12), ortho: true })).toBe(true);
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
      // Once the change has eased in.
      settleVitality();
      const mesh = later.cards.object.children[0] as THREE.Mesh<THREE.InstancedBufferGeometry>;
      return mesh.geometry.getAttribute("aMore").array[1] as number;
    };
    for (const setter of ["setVitality", "setVitalityAt"] as const) {
      for (const before of [true, false]) expect(shownOnCard(setter, before), `${setter}, ${before ? "before" : "after"}`).toBeCloseTo(shownVitality(0.5), 6);
    }
  });

  it("draws nothing once its crown is too small to see, even with no far form", () => {
    const alone = createCopies(plant, light, [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1 }]);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100000);
    // A short focal length keeps the copy well within where the air dissolves everything.
    const short = 80;
    const at = (px: number): boolean => {
      camera.position.set(crown.center.x, crown.center.y, crown.center.z + (2 * crown.radius * short) / px);
      camera.lookAt(crown.center);
      camera.updateMatrixWorld();
      light.uEye.value.copy(camera.position);
      alone.cull(camera, { smaller: 1, focal: short, ortho: false });
      return alone.drawn().copies > 0;
    };
    // Across the dissolve it still draws (its shader dissolves it); once gone, its cell draws nothing.
    expect(at(GONE.start + 1)).toBe(true);
    expect(at((GONE.start + GONE.end) / 2)).toBe(true);
    expect(at(GONE.end * 0.9)).toBe(false);
  });
});
