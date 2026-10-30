import { describe, expect, it } from "vitest";
import { laySnapshot } from "./snapshot.ts";
import { snapshotGraphOf } from "./snapshot-facts.ts";

describe("the showcase's world from its bundled snapshot", () => {
  // The showcase opens from its snapshot wherever the page runs and is the world of a page with no engine, with its
  // old v1 as it is or fixed, so each must lay out from its saved answers alone. Each lays out whole, including
  // judging, in about two seconds alone and longer while other work shares the machine.
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
