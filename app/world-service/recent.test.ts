import { describe, expect, it } from "vitest";
import type { EngineClient } from "@gaia/schema";
import { PAINTING_MAX, RECENT_KEY, keepPainting, keepRecent, keepLastSpot, offeredWorlds, recentWorlds, lastSpotIn } from "./recent.ts";

/**
 * A fake engine whose in-memory store holds `recent` as the recent worlds. `checkedOut` gives each folder's current
 * commit, and any other folder is read from disk. `since[from]` gives the number of commits from `from` to the current
 * commit, and any other commit is not in the history.
 */
function storeEngine(recent?: unknown, checkedOut: Record<string, string> = {}, since: Record<string, number> = {}): EngineClient {
  const settings = new Map<string, unknown>(recent === undefined ? [] : [[RECENT_KEY, recent]]);
  return {
    call: async (method: string, params: { key?: string; root?: string; from?: string; writes?: { key: string; value: unknown }[] }) => {
      if (method === "store.get") return settings.has(params.key ?? "") ? { value: settings.get(params.key ?? "") } : null;
      if (method === "store.put") for (const w of params.writes ?? []) settings.set(w.key, w.value);
      if (method === "project.commit") return { commit: checkedOut[params.root ?? ""] ?? null };
      if (method === "project.commits") return { commits: since[params.from ?? ""] ?? null };
      return { ok: true };
    },
    on: () => () => {},
  } as unknown as EngineClient;
}

const painting = (fill: string): string => `data:image/webp;base64,${fill.repeat(64)}`;

describe("the recent worlds", () => {
  it("offers a world kept before paintings were by its name, with none of what it kept then", async () => {
    const engine = storeEngine([
      { root: "/code/gaia", name: "gaia", at: 5, postcard: { areas: [], things: [] } },
      // A map picture, which Gaia stored before it painted the person's view.
      { root: "/code/other", name: "other", at: 4, picture: painting("M"), commit: "c1" },
    ]);
    expect(await recentWorlds(engine)).toEqual([
      { root: "/code/gaia", name: "gaia", at: 5 },
      { root: "/code/other", name: "other", at: 4, commit: "c1" },
    ]);
  });

  it("keeps the painting of where the person stood still with its world until a new one comes, whatever commit it is opened at", async () => {
    const engine = storeEngine();
    await keepRecent(engine, { root: "/code/gaia", name: "gaia", at: 1, commit: "c1" });
    await keepRecent(engine, { root: "/code/other", name: "other", at: 2 });
    await keepPainting(engine, "/code/gaia", painting("A"));
    await keepRecent(engine, { root: "/code/gaia", name: "gaia", at: 3, commit: "c2" });
    expect(await recentWorlds(engine)).toEqual([
      { root: "/code/gaia", name: "gaia", at: 3, commit: "c2", painting: painting("A") },
      { root: "/code/other", name: "other", at: 2 },
    ]);
    await keepPainting(engine, "/code/gaia", painting("B"));
    expect((await recentWorlds(engine))[0]?.painting).toBe(painting("B"));
  });

  it("drops a painting that is not WebP, is too long, or is of a world no longer kept", async () => {
    const engine = storeEngine();
    await keepRecent(engine, { root: "/code/gaia", name: "gaia", at: 1 });
    await keepPainting(engine, "/code/gaia", "data:image/png;base64,AAAA");
    await keepPainting(engine, "/code/gaia", `data:image/webp;base64,${"A".repeat(PAINTING_MAX)}`);
    await keepPainting(engine, "/code/gone", painting("A"));
    expect(await recentWorlds(engine)).toEqual([{ root: "/code/gaia", name: "gaia", at: 1 }]);
  });

  it("offers each world's painting whatever its code, with how many commits touched it since it was last opened", async () => {
    const kept = [
      { root: "/code/same", name: "same", at: 3, painting: painting("A"), commit: "c1" },
      { root: "/code/moved", name: "moved", at: 2, painting: painting("B"), commit: "c1" },
      { root: "/code/disk", name: "disk", at: 1, painting: painting("C") },
    ];
    const engine = storeEngine(kept, { "/code/same": "c1", "/code/moved": "c2" }, { c1: 3 });
    expect(await offeredWorlds(engine)).toEqual([
      { root: "/code/same", name: "same", at: 3, painting: painting("A") },
      { root: "/code/moved", name: "moved", at: 2, painting: painting("B"), commitsSince: 3 },
      { root: "/code/disk", name: "disk", at: 1, painting: painting("C") },
    ]);
  });

  it("keeps where the person stood with the world they stood in, through its next open, and never offers it to the start", async () => {
    const engine = storeEngine();
    const stood = { x: 12.5, z: -40, yaw: 1.2, layout: "0badcafe", by: { path: "packages/world", x: 10, z: -38 } };
    await keepRecent(engine, { root: "/code/gaia", name: "gaia", at: 1 });
    expect(await lastSpotIn(engine, "/code/gaia")).toBeUndefined();
    await keepLastSpot(engine, "/code/gaia", stood);
    await keepRecent(engine, { root: "/code/gaia", name: "gaia", at: 2 });
    expect(await lastSpotIn(engine, "/code/gaia")).toEqual(stood);
    expect(await offeredWorlds(engine)).toEqual([{ root: "/code/gaia", name: "gaia", at: 2 }]);
  });

  it("drops a spot that is malformed or of a world no longer kept", async () => {
    const engine = storeEngine();
    await keepRecent(engine, { root: "/code/gaia", name: "gaia", at: 1 });
    await keepLastSpot(engine, "/code/gaia", { x: Number.NaN, z: 0, yaw: 0, layout: "k", by: null });
    await keepLastSpot(engine, "/code/gaia", { x: 1, z: 0, yaw: 0, layout: "k", by: { path: 7 } });
    await keepLastSpot(engine, "/code/gone", { x: 1, z: 0, yaw: 0, layout: "k", by: null });
    expect(await recentWorlds(engine)).toEqual([{ root: "/code/gaia", name: "gaia", at: 1 }]);
  });

  it("counts the commits since a world was last opened, and says it moved on when that commit left the history", async () => {
    const kept = [
      { root: "/code/ahead", name: "ahead", at: 3, commit: "c1" },
      { root: "/code/rebased", name: "rebased", at: 2, commit: "gone" },
      // Its repository moved on, but no commit touched its folder.
      { root: "/code/elsewhere", name: "elsewhere", at: 1, commit: "c2" },
    ];
    const engine = storeEngine(kept, { "/code/ahead": "c9", "/code/rebased": "c9", "/code/elsewhere": "c9" }, { c1: 14, c2: 0 });
    expect(await offeredWorlds(engine)).toEqual([
      { root: "/code/ahead", name: "ahead", at: 3, commitsSince: 14 },
      { root: "/code/rebased", name: "rebased", at: 2, commitsSince: null },
      { root: "/code/elsewhere", name: "elsewhere", at: 1 },
    ]);
  });
});
