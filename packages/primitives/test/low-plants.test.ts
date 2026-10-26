// Ferns, among the lowest drifts, decline as plants do: a fern's fronds brown
// from their tips and fold down to lie low over the soil.

import { describe, expect, it } from "vitest";
import { type Built, type Field, Library, type Part, rand } from "@gaia/schema";
import { PRIMITIVES } from "@gaia/primitives";
import { applyVitality, resolveParams } from "@gaia/realize";

const lib = new Library(PRIMITIVES);
const facts = { scale: 1, age: 120 };

function build(id: string, stored: Record<string, string>, seed: number): Part[] {
  const p = lib.get(id);
  const params = resolveParams(p, stored, rand(seed), p.id);
  return ((p.build as (params: unknown, ctx: unknown, input: unknown) => Built)(params, { rand: rand(seed).fork(p.id), facts }, null)).parts as Part[];
}

const heights = (positions: Float32Array): number[] => Array.from(positions).filter((_, i) => i % 3 === 1);
const levels = (id: string, name: string): string[] => ((lib.get(id).params as Record<string, Field>)[name] as Extract<Field, { type: "scale" }>).levels.map((l) => l.words);

describe("ferns@1", () => {
  const ferns = levels("ferns@1", "height").map((height, i) => build("ferns@1", { fronds: "a full crown", height, unroll: "fully open" }, 3 + i)[0] as Part);

  it("folds its fronds down to lie low over the soil as it fails, never through it", () => {
    for (const part of ferns) {
      const healthy = heights(applyVitality(part, 1).positions);
      const ruined = heights(applyVitality(part, 0).positions);
      expect(Math.max(...ruined)).toBeLessThan(0.5 * Math.max(...healthy));
      expect(Math.min(...ruined)).toBeGreaterThan(-0.03);
    }
  });

  it("browns from the tips: the outer reach of every frond withers more than its foot", () => {
    for (const part of ferns) {
      const { positions, channels } = part;
      const reach = (i: number): number =>
        Math.hypot((positions[i * 3] as number) - (channels.bough[i * 3] as number), (positions[i * 3 + 1] as number) - (channels.bough[i * 3 + 1] as number), (positions[i * 3 + 2] as number) - (channels.bough[i * 3 + 2] as number));
      const far = Math.max(...Array.from({ length: part.shade.length }, (_, i) => reach(i)));
      const mean = (keep: (d: number) => boolean): number => {
        const w = Array.from(channels.wither).filter((_, i) => keep(reach(i) / far));
        return w.reduce((a, b) => a + b, 0) / w.length;
      };
      expect(mean((d) => d > 0.66)).toBeGreaterThan(mean((d) => d < 0.33) + 0.2);
    }
  });
});
