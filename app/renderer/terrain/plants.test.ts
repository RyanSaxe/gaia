import { describe, expect, it } from "vitest";
import { openedWorld, provingWorld } from "./code-world.ts";
import { plantAsk } from "./made.ts";
import { AS_THING } from "./stand.ts";

describe("one build for each blueprint", () => {
  const doc = provingWorld();
  const code = openedWorld(doc);
  const things = [...doc.world.symbols, ...doc.world.standing];

  it("stands each tree, bush, stone and flowers as its own blueprint's build: things answered alike share one, and no two blueprints do", () => {
    let small = 0;
    code.stand.symbols.forEach((sym, k) => {
      if (sym.rule === AS_THING) return;
      small++;
      const builds = code.plants[sym.rule as keyof typeof code.plants];
      expect(builds[sym.variant]?.id, `symbol ${k}`).toBe(things[k]?.blueprint?.id);
    });
    expect(small).toBeGreaterThan(500);
    for (const [group, builds] of Object.entries(code.plants)) expect(new Set(builds.map((b) => b.id)).size, group).toBe(builds.length);
    // There are fewer builds than small things, because things with the same blueprint share a build.
    expect(Object.values(code.plants).reduce((n, b) => n + b.length, 0)).toBeLessThan(small);
  });

  it("seeds a build by its blueprint's content alone, so it builds the same in any world", () => {
    const [a, b] = code.plants.trees as [NonNullable<(typeof code.plants.trees)[number]>, NonNullable<(typeof code.plants.trees)[number]>];
    expect(plantAsk(structuredClone(a))).toEqual(plantAsk(a));
    expect(plantAsk(a).seed).not.toBe(plantAsk(b).seed);
    expect(plantAsk(a).facts).toEqual({ scale: 1, age: 120 });
  });
});
