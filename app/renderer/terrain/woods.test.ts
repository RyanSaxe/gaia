import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Library, seedOf } from "@gaia/schema";
import { FLORA_PRIMITIVES } from "@gaia/primitives";
import { flora } from "@gaia/kinds";
import { FLORA_PRESETS, type Realized, realize } from "@gaia/realize";
import { createSceneLight } from "@gaia/render";
import { BUDGET, FAR, type PassSize, createCopies, createFarForms, createFrameBudget, farness } from "./woods.ts";

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

describe("the frame budget", () => {
  it("turns trees far sooner only gradually, within a card's sharpness, and eases back", () => {
    const budget = createFrameBudget();
    const heavy = BUDGET.triangles * 2;
    // A second of a heavy view raises the swap size by at most its rise.
    for (let k = 0; k < 60; k++) budget.update(heavy, 1 / 60);
    expect(budget.swapPx).toBeGreaterThan(FAR.swapPx);
    expect(budget.swapPx).toBeLessThanOrEqual(FAR.swapPx * (1 + BUDGET.rise) ** 1.01);
    // However long it stays heavy, a card's texel never spans more than 1.5 pixels.
    for (let k = 0; k < 6000; k++) budget.update(heavy, 1 / 60);
    expect(budget.swapPx).toBeCloseTo(FAR.swapPx * BUDGET.most, 6);
    // Just under the budget it holds, so it never hunts back and forth.
    const held = budget.swapPx;
    budget.update(BUDGET.triangles * 0.9, 1);
    expect(budget.swapPx).toBe(held);
    // A light view eases it back, never below the size the far forms baked at.
    for (let k = 0; k < 6000; k++) budget.update(0, 1 / 60);
    expect(budget.swapPx).toBe(FAR.swapPx);
    // A frame with no time passing changes nothing.
    budget.update(heavy, 0);
    expect(budget.swapPx).toBe(FAR.swapPx);
  });
});

describe("the far forms", () => {
  it("are baked in the order plants were given them, each at its share of the size, and take none once baking", () => {
    const forms = createFarForms();
    const tree = {} as Realized;
    const bush = {} as Realized;
    expect(forms.add(tree)).toMatchObject({ form: 0, share: 1, batch: forms.batch });
    expect(forms.add(bush, FAR.bush)).toMatchObject({ form: 1, share: FAR.bush });
    expect(forms.close()).toEqual([
      { plant: tree, px: FAR.swapPx },
      { plant: bush, px: FAR.swapPx * FAR.bush },
    ]);
    // A plant given a form after the bake began would draw a card that was never baked.
    expect(() => forms.add(bush)).toThrow();
  });
});

describe("a copy turning far", () => {
  const plant = realize((FLORA_PRESETS[0] as (typeof FLORA_PRESETS)[number]).blueprint, flora, new Library(FLORA_PRIMITIVES), { seed: seedOf("woods-test/tree"), facts: { scale: 1, age: 120 } });
  const light = createSceneLight();
  const forms = createFarForms();
  const far = forms.add(plant);
  forms.close();
  far.batch.baked = true;
  const copies = createCopies(plant, light, [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1 }], far);
  const crown = copies.crown;
  const focal = 800;
  /** One pass with the copy's crown spanning `px` device pixels: whether its full form draws, and its card's fade (null without a card). */
  const drawnAt = (px: number, camera: THREE.Camera, size: PassSize): { full: boolean; card: number | null } => {
    camera.updateMatrixWorld();
    light.uEye.value.copy(camera.position);
    far.batch.count = 0;
    copies.cull(camera, size);
    return { full: copies.drawn().copies > 0, card: far.batch.count === 0 ? null : (far.batch.copies[8] as number) };
  };
  const perspective = (px: number): { full: boolean; card: number | null } => {
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10000);
    camera.position.set(crown.center.x, crown.center.y, crown.center.z + (2 * crown.radius * focal) / px);
    camera.lookAt(crown.center);
    return drawnAt(px, camera, { smaller: 1, focal, ortho: false });
  };
  it("keeps its full form past the band, under its whole card, until it has dissolved", () => {
    // Inside the band the card draws over the full form, that far into it.
    const band = perspective(FAR.swapPx * 1.12);
    expect(band.full).toBe(true);
    expect(band.card).toBeGreaterThan(0);
    expect(band.card).toBeLessThan(1);
    // Past the band's end the full form still draws, dissolving, and the card draws over it whole.
    const leaving = perspective(FAR.swapPx * 0.93);
    expect(leaving.full).toBe(true);
    expect(leaving.card).toBeGreaterThan(0.99);
    expect(leaving.card).toBeLessThan(1);
    // Once dissolved, only the card draws, standing alone.
    const gone = perspective((FAR.swapPx / FAR.leave) * 0.95);
    expect(gone).toEqual({ full: false, card: 1 });
  });

  it("in the sun's flat shadow pass, keeps its full form only to the band's end", () => {
    const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 10000);
    camera.position.set(crown.center.x, crown.center.y + 500, crown.center.z);
    camera.lookAt(crown.center);
    // A flat pass measures a crown by its size alone, whatever its distance.
    const flatFocal = (px: number): number => px / (2 * crown.radius);
    expect(drawnAt(FAR.swapPx * 0.93, camera, { smaller: 1, focal: flatFocal(FAR.swapPx * 0.93), ortho: true })).toEqual({ full: false, card: 1 });
    expect(drawnAt(FAR.swapPx * 1.12, camera, { smaller: 1, focal: flatFocal(FAR.swapPx * 1.12), ortho: true }).full).toBe(true);
  });
});
