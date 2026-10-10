import { describe, expect, it } from "vitest";
import { BUDGET, FAR, createFrameBudget, farness } from "./woods.ts";

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
