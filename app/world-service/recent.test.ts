import { describe, expect, it } from "vitest";
import type { EngineClient } from "@gaia/schema";
import {
  RECENT_KEY,
  keepPainting,
  keepRecent,
  keepLastSpot,
  offeredWorlds,
  recentWorlds,
  lastSpotIn,
} from "./recent.ts";

interface StoreCallParams {
  key?: string;
  root?: string;
  from?: string;
  writes?: { key: string; value: unknown }[];
}

function storeEngine(
  recent?: unknown,
  checkedOut: Record<string, string> = {},
  since: Record<string, number> = {},
): EngineClient {
  const settings = new Map<string, unknown>(
    recent === undefined ? [] : [[RECENT_KEY, recent]],
  );
  const handlers: Record<string, (params: StoreCallParams) => unknown> = {
    "store.get": (params) => {
      const key = params.key ?? "";
      return settings.has(key) ? { value: settings.get(key) } : null;
    },
    "store.put": (params) => {
      for (const w of params.writes ?? []) settings.set(w.key, w.value);
      return { ok: true };
    },
    "project.commit": (params) => ({
      commit: checkedOut[params.root ?? ""] ?? null,
    }),
    "project.commits": (params) => ({
      commits: since[params.from ?? ""] ?? null,
    }),
  };
  return {
    call: async (method: string, params: StoreCallParams): Promise<unknown> =>
      handlers[method]?.(params) ?? { ok: true },
    on: (): (() => void) => (): void => {},
  } as unknown as EngineClient;
}

const painting = (fill: string): string =>
  `data:image/webp;base64,${fill.repeat(64)}`;

describe("the recent worlds", () => {
  it("offers a world kept before paintings were by its name, with none of what it kept then", async () => {
    const engine = storeEngine([
      {
        root: "/code/gaia",
        name: "gaia",
        at: 5,
        postcard: { areas: [], things: [] },
      },
      // A map picture, which Gaia stored before it painted the person's view.
      {
        root: "/code/other",
        name: "other",
        at: 4,
        picture: painting("M"),
        commit: "c1",
      },
    ]);
    expect(await recentWorlds(engine)).toEqual([
      { root: "/code/gaia", name: "gaia", at: 5 },
      { root: "/code/other", name: "other", at: 4, commit: "c1" },
    ]);
  });

  it("keeps where the person stood, and the painting of it, with the world they stood in through its next open at any commit, and never offers the spot to the start", async () => {
    const engine = storeEngine(undefined, { "/code/gaia": "c2" });
    const stood = {
      x: 12.5,
      z: -40,
      yaw: 1.2,
      layout: "0badcafe",
      by: { path: "packages/world", x: 10, z: -38 },
    };
    await keepRecent(engine, {
      root: "/code/gaia",
      name: "gaia",
      at: 1,
      commit: "c1",
    });
    await keepRecent(engine, { root: "/code/other", name: "other", at: 2 });
    expect(await lastSpotIn(engine, "/code/gaia")).toBeUndefined();
    await keepLastSpot(engine, "/code/gaia", stood);
    await keepPainting(engine, "/code/gaia", painting("A"));
    await keepRecent(engine, {
      root: "/code/gaia",
      name: "gaia",
      at: 3,
      commit: "c2",
    });
    expect(await lastSpotIn(engine, "/code/gaia")).toEqual(stood);
    expect(await recentWorlds(engine)).toEqual([
      {
        root: "/code/gaia",
        name: "gaia",
        at: 3,
        commit: "c2",
        painting: painting("A"),
        stood,
      },
      { root: "/code/other", name: "other", at: 2 },
    ]);
    expect(await offeredWorlds(engine)).toEqual([
      { root: "/code/gaia", name: "gaia", at: 3, painting: painting("A") },
      { root: "/code/other", name: "other", at: 2 },
    ]);
    // A new painting takes the old one's place.
    await keepPainting(engine, "/code/gaia", painting("B"));
    expect((await recentWorlds(engine))[0]?.painting).toBe(painting("B"));
  });
});
