import { describe, expect, it } from "vitest";
import { openedWorld, provingWorld } from "./code-world.ts";
import { plantAsk } from "./made.ts";
import { AS_THING } from "./place.ts";

describe("one build for each blueprint", () => {
  const doc = provingWorld();
  const code = openedWorld(doc);
  const things = [...doc.world.symbols, ...doc.world.naturalThings];

  it("builds each tree, bush, stone and drift of flowers from its own blueprint", () => {
    let small = 0;
    code.layout.symbols.forEach((sym, k) => {
      if (sym.rule === AS_THING) return;
      small++;
      const builds = code.naturalBuilds[sym.rule as keyof typeof code.naturalBuilds];
      expect(builds[sym.variant]?.id, `symbol ${k}`).toBe(things[k]?.blueprint?.id);
    });
    expect(small).toBeGreaterThan(0);
  });

  it("seeds a build by its blueprint's content alone, so it builds the same in any world", () => {
    const [a, b] = code.naturalBuilds.trees as [NonNullable<(typeof code.naturalBuilds.trees)[number]>, NonNullable<(typeof code.naturalBuilds.trees)[number]>];
    expect(plantAsk(structuredClone(a))).toEqual(plantAsk(a));
    expect(plantAsk(a).seed).not.toBe(plantAsk(b).seed);
  });
});
