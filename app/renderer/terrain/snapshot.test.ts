import { describe, expect, it } from "vitest";
import { bakeTerrain } from "@gaia/terrain";
import { openedWorld } from "./code-world.ts";
import { COMPOSING, WATERS } from "./looks.ts";
import { laySnapshot } from "./snapshot.ts";
import { snapshotFacts, snapshotGraphOf } from "./snapshot-facts.ts";

const files = (): string[] =>
  snapshotGraphOf()
    .nodes.flatMap((n) => (n.kind === "file" ? [n.path] : []))
    .sort();

describe("Gaia's own world from the bundled snapshot", () => {
  // A page with no engine asks Jev nothing, so the snapshot stands on the answers `pnpm jev-world` keeps. The snapshot
  // is laid out whole, judged and all: about two seconds alone, longer while other work shares the machine.
  it("lays out whole on Jev's kept answers alone, with its trails and every file of the graph on its land", { timeout: 60_000 }, async () => {
    const { world, summary } = await laySnapshot("a test");
    expect(world.trails.length).toBeGreaterThan(0);
    expect(world.patches.map((p) => p.path).sort()).toEqual(files());
    expect(summary).toContain("judged by Jev");
  });

  // The showcase opens from its snapshot wherever the page runs, with its old v1 as it is or fixed, so each must lay out on its kept answers alone.
  it.each(["showcase", "showcase-fixed"] as const)("lays %s out on Jev's kept answers alone, with its trails and every file of its graph", { timeout: 60_000 }, async (of) => {
    const { world, summary } = await laySnapshot("a test", of);
    expect(world.trails.length).toBeGreaterThan(0);
    expect(world.patches.map((p) => p.path).sort()).toEqual(
      snapshotGraphOf(of)
        .nodes.flatMap((n) => (n.kind === "file" ? [n.path] : []))
        .sort(),
    );
    expect(summary).toContain("judged by Jev");
  });

  // The world shows every answer Jev gives, and the kernel's trickle runs down past the engine's pond. Each showcase is
  // laid out and its land baked whole: about two seconds alone, longer while other work shares the machine.
  it.each(["showcase", "showcase-fixed"] as const)("holds the pond of every area of %s Jev gives a still pond", { timeout: 60_000 }, async (of) => {
    const { world, summary } = await laySnapshot("a test", of);
    const terrain = bakeTerrain(openedWorld({ root: of, facts: snapshotFacts(of), world, summary, judged: {} }).spec, COMPOSING.lib);
    const still = world.regions.filter((r) => WATERS[r.water]?.settles?.["relief.pond"] === true);
    expect(still.length).toBeGreaterThan(0);
    expect(still.filter((r) => !terrain.ponds.some((p) => p.x === r.x && p.z === r.z)).map((r) => r.area)).toEqual([]);
  });
});
