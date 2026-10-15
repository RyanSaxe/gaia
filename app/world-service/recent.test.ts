import { describe, expect, it } from "vitest";
import type { EngineClient } from "@gaia/schema";
import { PICTURE_MAX, RECENT_KEY, keepPicture, keepRecent, keepStood, offeredWorlds, recentWorlds, stoodIn } from "./recent.ts";

/**
 * An engine whose store is a map in memory, holding `recent` as the app's recent worlds, and whose folders have
 * checked out the commits in `checkedOut` (any other is read from disk).
 */
function storeEngine(recent?: unknown, checkedOut: Record<string, string> = {}): EngineClient {
  const settings = new Map<string, unknown>(recent === undefined ? [] : [[RECENT_KEY, recent]]);
  return {
    call: async (method: string, params: { key?: string; root?: string; writes?: { key: string; value: unknown }[] }) => {
      if (method === "store.get") return settings.has(params.key ?? "") ? { value: settings.get(params.key ?? "") } : null;
      if (method === "store.put") for (const w of params.writes ?? []) settings.set(w.key, w.value);
      if (method === "project.commit") return { commit: checkedOut[params.root ?? ""] ?? null };
      return { ok: true };
    },
    on: () => () => {},
  } as unknown as EngineClient;
}

const picture = (fill: string): string => `data:image/webp;base64,${fill.repeat(64)}`;

describe("the recent worlds", () => {
  it("offers a world kept before pictures were by its name, with no picture and none of what it kept then", async () => {
    const engine = storeEngine([{ root: "/code/gaia", name: "gaia", at: 5, postcard: { areas: [], things: [] } }]);
    expect(await recentWorlds(engine)).toEqual([{ root: "/code/gaia", name: "gaia", at: 5 }]);
  });

  it("keeps a picture with the world its page opened, and keeps it when the world is opened again until a new one comes", async () => {
    const engine = storeEngine();
    await keepRecent(engine, { root: "/code/gaia", name: "gaia", at: 1 });
    await keepRecent(engine, { root: "/code/other", name: "other", at: 2 });
    await keepPicture(engine, "/code/gaia", picture("A"), "c1");
    await keepRecent(engine, { root: "/code/gaia", name: "gaia", at: 3 });
    expect(await recentWorlds(engine)).toEqual([
      { root: "/code/gaia", name: "gaia", at: 3, picture: picture("A"), commit: "c1" },
      { root: "/code/other", name: "other", at: 2 },
    ]);
    await keepPicture(engine, "/code/gaia", picture("B"), "c2");
    expect((await recentWorlds(engine))[0]?.picture).toBe(picture("B"));
  });

  it("drops a picture that is not WebP, is too long, is of a world no longer kept, or is of a world read from disk", async () => {
    const engine = storeEngine();
    await keepRecent(engine, { root: "/code/gaia", name: "gaia", at: 1 });
    await keepPicture(engine, "/code/gaia", "data:image/png;base64,AAAA", "c1");
    await keepPicture(engine, "/code/gaia", `data:image/webp;base64,${"A".repeat(PICTURE_MAX)}`, "c1");
    await keepPicture(engine, "/code/gone", picture("A"), "c1");
    await keepPicture(engine, "/code/gaia", picture("A"), undefined);
    expect(await recentWorlds(engine)).toEqual([{ root: "/code/gaia", name: "gaia", at: 1 }]);
  });

  it("offers a picture only while its folder's code is still the commit it was painted from", async () => {
    const kept = [
      { root: "/code/same", name: "same", at: 4, picture: picture("A"), commit: "c1" },
      { root: "/code/moved", name: "moved", at: 3, picture: picture("B"), commit: "c1" },
      { root: "/code/disk", name: "disk", at: 2, picture: picture("C"), commit: "c1" },
      // Kept before pictures said which commit they show, as every picture an earlier Gaia painted was.
      { root: "/code/old", name: "old", at: 1, picture: picture("D") },
    ];
    const engine = storeEngine(kept, { "/code/same": "c1", "/code/moved": "c2", "/code/old": "c1" });
    expect(await offeredWorlds(engine)).toEqual([
      { root: "/code/same", name: "same", at: 4, picture: picture("A"), commit: "c1" },
      { root: "/code/moved", name: "moved", at: 3 },
      { root: "/code/disk", name: "disk", at: 2 },
      { root: "/code/old", name: "old", at: 1 },
    ]);
  });

  it("keeps where the person stood with the world they stood in, through its next open, and never offers it to the start", async () => {
    const engine = storeEngine();
    const stood = { x: 12.5, z: -40, yaw: 1.2, layout: "0badcafe", by: { path: "packages/world", x: 10, z: -38 } };
    await keepRecent(engine, { root: "/code/gaia", name: "gaia", at: 1 });
    expect(await stoodIn(engine, "/code/gaia")).toBeUndefined();
    await keepStood(engine, "/code/gaia", stood);
    await keepRecent(engine, { root: "/code/gaia", name: "gaia", at: 2 });
    expect(await stoodIn(engine, "/code/gaia")).toEqual(stood);
    expect(await offeredWorlds(engine)).toEqual([{ root: "/code/gaia", name: "gaia", at: 2 }]);
  });

  it("drops a spot that is malformed or of a world no longer kept", async () => {
    const engine = storeEngine();
    await keepRecent(engine, { root: "/code/gaia", name: "gaia", at: 1 });
    await keepStood(engine, "/code/gaia", { x: Number.NaN, z: 0, yaw: 0, layout: "k", by: null });
    await keepStood(engine, "/code/gaia", { x: 1, z: 0, yaw: 0, layout: "k", by: { path: 7 } });
    await keepStood(engine, "/code/gone", { x: 1, z: 0, yaw: 0, layout: "k", by: null });
    expect(await recentWorlds(engine)).toEqual([{ root: "/code/gaia", name: "gaia", at: 1 }]);
  });
});
