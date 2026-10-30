// Ferns and mushrooms are placed by the hundred, so each drift of them stays
// within a small triangle budget at every setting.

import { describe, expect, it } from "vitest";
import { type Built, type Field, Library, type Part, rand } from "@gaia/schema";
import { PRIMITIVES } from "@gaia/primitives";
import { resolveParams } from "@gaia/realize";

const lib = new Library(PRIMITIVES);
const facts = { scale: 1, age: 120 };

function build(id: string, stored: Record<string, string>, seed: number): Part[] {
  const p = lib.get(id);
  const params = resolveParams(p, stored, rand(seed), p.id);
  return ((p.build as (params: unknown, ctx: unknown, input: unknown) => Built)(params, { rand: rand(seed).fork(p.id), facts }, null)).parts as Part[];
}

/** Every combination of a drift's settings, each scale at every level. */
function settings(id: string): Record<string, string>[] {
  let out: Record<string, string>[] = [{}];
  for (const [name, f] of Object.entries(lib.get(id).params as Record<string, Field>)) {
    const words = f.type === "scale" ? f.levels.map((l) => l.words) : f.type === "choice" ? Object.keys(f.options) : [];
    out = out.flatMap((s) => words.map((w) => ({ ...s, [name]: w })));
  }
  return out;
}

describe("the lowest drifts", () => {
  it.each(["ferns@1", "mushrooms@1"])("%s stays light enough to place by the hundred at every setting", (id) => {
    for (const stored of settings(id)) {
      const triangles = build(id, stored, 3).reduce((n, p) => n + p.indices.length / 3, 0);
      expect(triangles, JSON.stringify(stored)).toBeLessThan(12_000);
    }
  });
});
