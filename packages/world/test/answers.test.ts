import { describe, expect, it } from "vitest";
import { reconcile } from "@gaia/world";

const stored = { key: "k", value: "weeping", model: "typesafe/jev-1.13" };
const choice = (p: Record<string, number>) => {
  const choice = Object.entries(p).sort((a, b) => b[1] - a[1])[0]![0];
  return { type: "choice" as const, choice, probabilities: p, confidence: 0.5 };
};

describe("sticky with a margin", () => {
  it("keeps the stored answer when the new favorite wins narrowly", () => {
    expect(reconcile(stored, choice({ weeping: 0.42, upright: 0.48, spreading: 0.1 }))).toBe("weeping");
  });
  it("takes the new answer when it wins clearly", () => {
    expect(reconcile(stored, choice({ weeping: 0.15, upright: 0.75, spreading: 0.1 }))).toBe("upright");
  });
  it("takes the new answer when nothing is stored", () => {
    expect(reconcile(undefined, choice({ weeping: 0.3, upright: 0.7 }))).toBe("upright");
  });
});
