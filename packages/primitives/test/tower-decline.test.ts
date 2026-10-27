// A lookout tower crumbles from the top down, and its door and lintel go
// with the wall around them: no doorway is left standing above the rubble.

import { describe, expect, it } from "vitest";
import { type Built, type Part, rand } from "@gaia/schema";
import { lookoutTower } from "@gaia/primitives";
import { applyVitality, resolveParams } from "@gaia/realize";

type Erased = (params: unknown, ctx: { rand: ReturnType<typeof rand>; facts: Record<string, number> }, input: unknown) => unknown;

const PLANS = ["round", "square", "octagonal"] as const;
const CROWNS = ["a conical roof", "battlements", "an open lantern room"] as const;

describe("a lookout tower", () => {
  // Builds nine towers and reads each at four vitalities: a few seconds alone, more when other work shares the machine.
  it("never leaves its door or lintel standing higher than the wall beside the doorway", { timeout: 30_000 }, () => {
    for (const plan of PLANS) {
      for (const crown of CROWNS) {
        const stored = { height: "a lookout tower", plan, profile: "straight", galleries: "none", crown, masonry: "dressed blocks" };
        const built = (lookoutTower.build as Erased)(resolveParams(lookoutTower, stored, rand(3), lookoutTower.id), { rand: rand(3).fork("tower"), facts: { scale: 1 } }, null) as Built;
        const timber = built.parts.find((p) => p.swatch === "timber") as Part;
        const stone = built.parts.find((p) => p.swatch === "masonry") as Part;
        // The door and its lintel: the timber at the tower's foot, around the doorway's middle.
        const whole = applyVitality(timber, 1).positions;
        const door = Array.from({ length: timber.shade.length }, (_, v) => v).filter((v) => (whole[v * 3 + 1] as number) < 3);
        const cx = door.reduce((s, v) => s + (whole[v * 3] as number), 0) / door.length;
        const cz = door.reduce((s, v) => s + (whole[v * 3 + 2] as number), 0) / door.length;
        for (const vitality of [1, 0.5, 0.1, 0.03]) {
          // What still stands at this vitality: a piece goes once vitality falls below its loss, and a piece with none never goes.
          const stands = (part: Part, i: number): boolean => {
            const loss = part.channels.loss[i] as number;
            return loss === 0 || vitality > loss;
          };
          const top = Math.max(0, ...door.filter((v) => stands(timber, v)).map((v) => whole[v * 3 + 1] as number));
          const rest = applyVitality(stone, 1).positions;
          let wall = 0;
          for (let v = 0; v < stone.shade.length; v++) {
            if (stands(stone, v) && Math.hypot((rest[v * 3] as number) - cx, (rest[v * 3 + 2] as number) - cz) < 1.4) wall = Math.max(wall, rest[v * 3 + 1] as number);
          }
          expect(top, `${plan}, ${crown}, vitality ${vitality}`).toBeLessThanOrEqual(wall + 0.2);
        }
      }
    }
  });
});
