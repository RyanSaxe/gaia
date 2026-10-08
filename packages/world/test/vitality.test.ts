import { describe, expect, it } from "vitest";
import { areaVitality, groundVitality, pooledVitality } from "@gaia/world";

describe("area vitality", () => {
  it("weighs each file by its size, so a large tired file outweighs a small thriving one", () => {
    expect(pooledVitality([{ vitality: 0.2, size: 900 }, { vitality: 1, size: 100 }])).toBeCloseTo(0.28);
    expect(pooledVitality([])).toBe(1);
  });

  it("pools every file under a directory, its subdirectories' included, up to the whole world", () => {
    const v = areaVitality([
      { area: "app", vitality: 1, size: 100 },
      { area: "app/renderer", vitality: 0.4, size: 300 },
      { area: "engine", vitality: 0.9, size: 600 },
    ]);
    expect(v.get("app/renderer")).toBeCloseTo(0.4);
    expect(v.get("app")).toBeCloseTo((100 + 0.4 * 300) / 400);
    expect(v.get("")).toBeCloseTo((100 + 120 + 540) / 1000);
    expect(v.has("docs")).toBe(false);
  });

  it("washes an area's own ground with its own files, and one with none of its own with everything under it", () => {
    const v = groundVitality([
      { area: "app", vitality: 1, size: 100 },
      { area: "app/renderer", vitality: 0.4, size: 300 },
      { area: "packages/world", vitality: 0.6, size: 50 },
    ]);
    expect(v.get("app")).toBeCloseTo(1);
    expect(v.get("packages")).toBeCloseTo(0.6);
  });
});
