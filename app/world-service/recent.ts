// Stores the worlds a person opened before, newest first, in the `APP_STORE`
// `settings` table. Each has the commit last opened, the person's last position
// and a painting for the start page's card. `RECENT_KEPT` paintings of about
// 60 KB keep the app store under a megabyte, and the service reads the store
// whole only to offer the start page or to write a world.

import type { EngineClient } from "@gaia/schema";
import type { StoodSpot } from "@gaia/terrain";
import { APP_STORE } from "./open-world.ts";
import type { RecentWorld } from "./protocol.ts";

/** The key of the recent worlds in the `APP_STORE` `settings` table. */
export const RECENT_KEY = "recent-worlds";

/** How many recent worlds the start page offers. */
export const RECENT_KEPT = 6;

/** The longest painting data URL stored, in characters. That is about 190 KB of WebP, three times a page's usual painting. */
export const PAINTING_MAX = 256_000;

const isPainting = (painting: unknown): painting is string => typeof painting === "string" && painting.startsWith("data:image/webp;base64,") && painting.length <= PAINTING_MAX;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Whether a value is a valid `StoodSpot`. */
const isStood = (s: unknown): s is StoodSpot => {
  if (typeof s !== "object" || s === null) return false;
  const { x, z, yaw, layout, by } = s as Partial<Record<keyof StoodSpot, unknown>>;
  const byOk = by === null || (typeof by === "object" && by !== null && typeof (by as { path?: unknown }).path === "string" && finite((by as { x?: unknown }).x) && finite((by as { z?: unknown }).z));
  return finite(x) && finite(z) && finite(yaw) && typeof layout === "string" && byOk;
};

/**
 * Reads the stored recent worlds and drops fields the start page does not
 * read. A record stored before paintings existed, with its old postcard or map
 * picture, therefore has no painting.
 */
export async function recentWorlds(engine: EngineClient): Promise<RecentWorld[]> {
  const kept = (await engine.call("store.get", { project: APP_STORE, table: "settings", key: RECENT_KEY }))?.value;
  if (!Array.isArray(kept)) return [];
  return kept.flatMap((r: Partial<Record<keyof RecentWorld, unknown>> | null): RecentWorld[] => {
    if (typeof r?.root !== "string" || typeof r.name !== "string") return [];
    return [
      {
        root: r.root,
        name: r.name,
        ...(typeof r.github === "string" ? { github: r.github } : {}),
        at: typeof r.at === "number" ? r.at : 0,
        ...(typeof r.commit === "string" ? { commit: r.commit } : {}),
        ...(isStood(r.stood) ? { stood: r.stood } : {}),
        ...(isPainting(r.painting) ? { painting: r.painting } : {}),
      },
    ];
  });
}

/**
 * Returns the recent worlds for the start page. A world whose folder has moved on from its stored `commit` also gets
 * `commitsSince`.
 */
export async function offeredWorlds(engine: EngineClient): Promise<RecentWorld[]> {
  return Promise.all(
    (await recentWorlds(engine)).map(async ({ commit, stood: _, ...world }) => {
      if (commit === undefined) return world;
      const now = (await engine.call("project.commit", { root: world.root }).catch(() => ({ commit: null }))).commit;
      if (now === null || now === commit) return world;
      const since = await engine.call("project.commits", { root: world.root, from: commit, to: now }).catch(() => ({ commits: null }));
      return since.commits === 0 ? world : { ...world, commitsSince: since.commits };
    }),
  );
}

async function keep(engine: EngineClient, worlds: readonly RecentWorld[]): Promise<void> {
  await engine.call("store.put", { project: APP_STORE, writes: [{ table: "settings", key: RECENT_KEY, value: worlds.slice(0, RECENT_KEPT) }] });
}

/**
 * Puts `world` first among the recent worlds and replaces any earlier record of the same folder. The earlier record's
 * `stood` and `painting` carry over until the page sends new ones.
 */
export async function keepRecent(engine: EngineClient, world: Omit<RecentWorld, "painting" | "stood" | "commitsSince">): Promise<void> {
  const kept = await recentWorlds(engine);
  const earlier = kept.find((r) => r.root === world.root);
  const stays = { ...(earlier?.stood === undefined ? {} : { stood: earlier.stood }), ...(earlier?.painting === undefined ? {} : { painting: earlier.painting }) };
  await keep(engine, [{ ...world, ...stays }, ...kept.filter((r) => r.root !== world.root)]);
}

/** Returns where the person was when they last left the world of `root`, if stored. */
export async function stoodIn(engine: EngineClient, root: string): Promise<StoodSpot | undefined> {
  return (await recentWorlds(engine)).find((r) => r.root === root)?.stood;
}

/** Stores `stood` with the recent world of `root`. Drops it when it is malformed or `root` is no longer a recent world. */
export async function keepStood(engine: EngineClient, root: string, stood: unknown): Promise<void> {
  if (!isStood(stood)) return;
  const kept = await recentWorlds(engine);
  if (!kept.some((r) => r.root === root)) return;
  await keep(
    engine,
    kept.map((r) => (r.root === root ? { ...r, stood } : r)),
  );
}

/** Stores `painting` with the recent world of `root`. Drops it when it is not a WebP data URL, is longer than `PAINTING_MAX`, or `root` is no longer a recent world. */
export async function keepPainting(engine: EngineClient, root: string, painting: string): Promise<void> {
  if (!isPainting(painting)) return;
  const kept = await recentWorlds(engine);
  if (!kept.some((r) => r.root === root)) return;
  await keep(
    engine,
    kept.map((r) => (r.root === root ? { ...r, painting } : r)),
  );
}
