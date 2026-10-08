// The worlds a person opened before, for the start page: kept with the app's
// own settings in the store (the `app` project's `settings` table), newest
// first, each with a small picture of its land to paint.

import type { EngineClient } from "@gaia/schema";
import { APP_STORE } from "./open-world.ts";
import type { RecentWorld } from "./protocol.ts";
export { postcardOf } from "./postcard.ts";

/** Where the recent worlds are kept, in the app's `settings` table. */
export const RECENT_KEY = "recent-worlds";

/** How many recent worlds the start page offers. */
export const RECENT_KEPT = 6;

export async function recentWorlds(engine: EngineClient): Promise<RecentWorld[]> {
  const kept = (await engine.call("store.get", { project: APP_STORE, table: "settings", key: RECENT_KEY }))?.value;
  return Array.isArray(kept) ? (kept as RecentWorld[]).filter((r) => typeof r?.root === "string" && typeof r.name === "string") : [];
}

/** Puts `world` first among the recent worlds, replacing an earlier visit to the same folder. */
export async function keepRecent(engine: EngineClient, world: RecentWorld): Promise<void> {
  const others = (await recentWorlds(engine)).filter((r) => r.root !== world.root);
  await engine.call("store.put", { project: APP_STORE, writes: [{ table: "settings", key: RECENT_KEY, value: [world, ...others].slice(0, RECENT_KEPT) }] });
}
