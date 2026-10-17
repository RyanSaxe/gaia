import { describe, expect, it } from "vitest";
import { laySnapshot } from "./snapshot.ts";
import { snapshotGraphOf } from "./snapshot-facts.ts";

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
});
