// Great stones decline whole: a stone leans or falls flat about its toe and
// never bends, whatever its arrangement.

import { describe, expect, it } from "vitest";
import { type Built, rand } from "@gaia/schema";
import { standingStones } from "@gaia/primitives";
import { applyVitality } from "@gaia/realize";

const ARRANGEMENTS = ["ring", "avenue", "dolmen", "cairn field", "leaning menhirs"] as const;

const build = (arrangement: (typeof ARRANGEMENTS)[number]): Built =>
  standingStones.build({ arrangement, count: 9, height: 3.8, lintels: true, centre: "a tall king stone", facets: 0.55 }, { rand: rand(7), facts: {} }, null);

describe("standing stones", () => {
  it.each(ARRANGEMENTS)("keep every whole stone rigid as it leans or falls, in a %s", (arrangement) => {
    const part = build(arrangement).parts[0];
    if (part === undefined) throw new Error("no stones");
    const healthy = applyVitality(part, 1).positions;
    const failing = applyVitality(part, 0.05).positions;
    const at = (p: Float32Array, v: number): [number, number, number] => [p[v * 3] as number, p[v * 3 + 1] as number, p[v * 3 + 2] as number];
    const gap = (p: Float32Array, a: number, b: number): number => Math.hypot(...at(p, a).map((x, i) => x - (at(p, b)[i] as number)));
    // Group each piece's vertices that neither collapse nor grow in: the stone itself.
    const pieces = new Map<number, number[]>();
    for (let v = 0; v < part.shade.length; v++) {
      if ((part.channels.loss[v] ?? 0) > 0 || (part.channels.grow?.[v] ?? 0) > 0) continue;
      const id = part.piece[v * 2] as number;
      pieces.set(id, [...(pieces.get(id) ?? []), v]);
    }
    let tilted = 0;
    for (const vs of pieces.values()) {
      const [a, b, c] = [vs[0], vs[Math.floor(vs.length / 2)], vs[vs.length - 1]] as [number, number, number];
      for (const [p, q] of [[a, b], [b, c], [a, c]] as const) expect(gap(failing, p, q)).toBeCloseTo(gap(healthy, p, q), 3);
      if (at(failing, a).some((x, i) => Math.abs(x - (at(healthy, a)[i] as number)) > 0.3)) tilted++;
    }
    // And decline shows: some stones have moved a long way.
    expect(tilted).toBeGreaterThan(0);
  });
});
