import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Library, seedOf } from "@gaia/schema";
import { FLORA_PRIMITIVES } from "@gaia/primitives";
import { flora } from "@gaia/kinds";
import { FLORA_PRESETS, type Realized, realize } from "@gaia/realize";
import { type FarForm, createFarCards, createSceneLight, farChoice } from "@gaia/render";
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
  it("are baked in the order plants were given them, each at its share of the size, and take none once baking", () => {
    const forms = createFarForms();
    const tree = {} as Realized;
    const bush = {} as Realized;
    expect(forms.add(tree)).toMatchObject({ form: 0, share: 1, forms });
    expect(forms.add(bush, FAR.bush)).toMatchObject({ form: 1, share: FAR.bush });
    expect(forms.close()).toEqual([
      { plant: tree, px: FAR.swapPx },
      { plant: bush, px: FAR.swapPx * FAR.bush },
    ]);
    // A plant given a form after the bake began would draw a card that was never baked.
    expect(() => forms.add(bush)).toThrow();
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
  const plant = realize((FLORA_PRESETS[0] as (typeof FLORA_PRESETS)[number]).blueprint, flora, new Library(FLORA_PRIMITIVES), { seed: seedOf("woods-test/tree"), facts: { scale: 1, age: 120 } });
  const light = createSceneLight();
  const forms = createFarForms();
  const far = forms.add(plant);
  forms.close();
  // A form with one-texel atlases: the woods only need its cards to stand.
  const form: FarForm = {
    bounds: { center: new THREE.Vector3(), radius: 1, height: 2 },
    bytes: 16,
    ms: 0,
    atlas: { layers: [0, 1, 2, 3].map(() => new THREE.DataTexture(new Uint8Array(4), 1, 1)), frame: 1, sway: 0, frequency: 1 },
    dispose: () => undefined,
  };
  forms.cards = createFarCards([form], light, [FAR.swapPx], TURN);
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
    // Its cards stood once, in the copies' own object, so hiding the copies hides them.
    expect(copies.cards?.parent).toBe(copies.object);
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
