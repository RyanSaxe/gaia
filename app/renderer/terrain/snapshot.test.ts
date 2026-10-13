import { describe, expect, it } from "vitest";
import { laySnapshot } from "./snapshot.ts";
import { snapshotGraphOf } from "./snapshot-facts.ts";

describe("Gaia's own world from the bundled snapshot", () => {
  // The snapshot is laid out whole, judged and all: about two seconds alone, longer while other work shares the machine.
  it("walks trails between its entities, and stands every file of the graph on its land, whoever judges it", { timeout: 60_000 }, async () => {
    const files = snapshotGraphOf()
      .nodes.flatMap((n) => (n.kind === "file" ? [n.path] : []))
      .sort();
    for (const judge of ["jev", "stand-in"] as const) {
      const { world } = await laySnapshot(judge, "a test");
      expect(world.trails.length, `${judge}'s trails`).toBeGreaterThan(0);
      expect(world.patches.map((p) => p.path).sort(), `${judge}'s patches`).toEqual(files);
    }
  });
});
