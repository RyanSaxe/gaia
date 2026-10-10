import { describe, expect, it } from "vitest";
import type { EngineClient } from "@gaia/schema";
import { PICTURE_MAX, RECENT_KEY, keepPicture, keepRecent, recentWorlds } from "./recent.ts";

/** An engine whose store is a map in memory, holding `recent` as the app's recent worlds. */
function storeEngine(recent?: unknown): EngineClient {
  const settings = new Map<string, unknown>(recent === undefined ? [] : [[RECENT_KEY, recent]]);
  return {
    call: async (method: string, params: { key?: string; writes?: { key: string; value: unknown }[] }) => {
      if (method === "store.get") return settings.has(params.key ?? "") ? { value: settings.get(params.key ?? "") } : null;
      if (method === "store.put") for (const w of params.writes ?? []) settings.set(w.key, w.value);
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
    await keepPicture(engine, "/code/gaia", picture("A"));
    await keepRecent(engine, { root: "/code/gaia", name: "gaia", at: 3 });
    expect(await recentWorlds(engine)).toEqual([
      { root: "/code/gaia", name: "gaia", at: 3, picture: picture("A") },
      { root: "/code/other", name: "other", at: 2 },
    ]);
    await keepPicture(engine, "/code/gaia", picture("B"));
    expect((await recentWorlds(engine))[0]?.picture).toBe(picture("B"));
  });

  it("drops a picture that is not WebP, is too long, or is of a world no longer kept", async () => {
    const engine = storeEngine();
    await keepRecent(engine, { root: "/code/gaia", name: "gaia", at: 1 });
    await keepPicture(engine, "/code/gaia", "data:image/png;base64,AAAA");
    await keepPicture(engine, "/code/gaia", `data:image/webp;base64,${"A".repeat(PICTURE_MAX)}`);
    await keepPicture(engine, "/code/gone", picture("A"));
    expect(await recentWorlds(engine)).toEqual([{ root: "/code/gaia", name: "gaia", at: 1 }]);
  });
});
