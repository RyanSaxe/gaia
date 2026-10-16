import { describe, expect, it } from "vitest";
import { laySnapshot } from "./snapshot.ts";
import { snapshotGraphOf } from "./snapshot-facts.ts";

const files = (): string[] =>
  snapshotGraphOf()
    .nodes.flatMap((n) => (n.kind === "file" ? [n.path] : []))
    .sort();

describe("Gaia's own world from the bundled snapshot", () => {
  // The snapshot is laid out whole, judged and all: about two seconds alone, longer while other work shares the machine.
  it("walks trails between its entities, and stands every file of the graph on its land, under the stand-in a developer asks for", { timeout: 60_000 }, async () => {
    const { world } = await laySnapshot("stand-in", "a test");
    expect(world.trails.length).toBeGreaterThan(0);
    expect(world.patches.map((p) => p.path).sort()).toEqual(files());
  });

  // A page with no engine asks Jev nothing, so the snapshot stands on the answers `pnpm jev-world` keeps, or not at
  // all: whole, with its trails and every file, or failing on the first request with no kept answer, naming it.
  it("on Jev's kept answers alone, lays out whole with its trails and every file, or fails naming a request with no kept answer, never guessing", { timeout: 60_000 }, async () => {
    const laid = await laySnapshot("jev", "a test").then(
      (r) => r,
      (e: Error) => e,
    );
    if (laid instanceof Error) {
      expect(laid.message).toMatch(/^Gaia could not finish .+: there is no answer kept for it, .*pnpm jev-world/);
      return;
    }
    expect(laid.world.trails.length).toBeGreaterThan(0);
    expect(laid.world.patches.map((p) => p.path).sort()).toEqual(files());
    expect(new Set(Object.values(laid.judges))).toEqual(new Set(["jev"]));
  });

  // The showcase, folio, opens from its snapshot wherever the page runs, so it must lay out on its kept answers alone.
  it("lays the showcase out on Jev's kept answers alone, with its trails and every file of its graph", { timeout: 60_000 }, async () => {
    const { world, judges } = await laySnapshot("jev", "a test", "showcase");
    expect(world.trails.length).toBeGreaterThan(0);
    expect(world.patches.map((p) => p.path).sort()).toEqual(
      snapshotGraphOf("showcase")
        .nodes.flatMap((n) => (n.kind === "file" ? [n.path] : []))
        .sort(),
    );
    expect(new Set(Object.values(judges))).toEqual(new Set(["jev"]));
  });
});
