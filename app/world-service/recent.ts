// The worlds a person opened before, for the start page: kept with the app's
// own settings in the store (the `app` project's `settings` table), newest
// first, each with the picture of its field map its page last painted. Six
// pictures of about 100 KB keep the app's store under a megabyte, and it is
// read whole only when the start is offered or a world is kept.

import type { EngineClient } from "@gaia/schema";
import { APP_STORE } from "./open-world.ts";
import type { RecentWorld } from "./protocol.ts";

/** Where the recent worlds are kept, in the app's `settings` table. */
export const RECENT_KEY = "recent-worlds";

/** How many recent worlds the start page offers. */
export const RECENT_KEPT = 6;

/** The longest picture kept, characters of its data URL: about 190 KB of WebP, twice what a page paints. */
export const PICTURE_MAX = 256_000;

const isPicture = (picture: unknown): picture is string => typeof picture === "string" && picture.startsWith("data:image/webp;base64,") && picture.length <= PICTURE_MAX;

/**
 * The recent worlds as the start reads them. Only what it reads is passed on,
 * so a world kept before pictures were, with the postcard of its areas it
 * kept then, is offered with no picture.
 */
export async function recentWorlds(engine: EngineClient): Promise<RecentWorld[]> {
  const kept = (await engine.call("store.get", { project: APP_STORE, table: "settings", key: RECENT_KEY }))?.value;
  if (!Array.isArray(kept)) return [];
  return kept.flatMap((r: Partial<Record<keyof RecentWorld, unknown>> | null): RecentWorld[] => {
    if (typeof r?.root !== "string" || typeof r.name !== "string") return [];
    return [{ root: r.root, name: r.name, ...(typeof r.github === "string" ? { github: r.github } : {}), at: typeof r.at === "number" ? r.at : 0, ...(isPicture(r.picture) ? { picture: r.picture } : {}) }];
  });
}

async function keep(engine: EngineClient, worlds: readonly RecentWorld[]): Promise<void> {
  await engine.call("store.put", { project: APP_STORE, writes: [{ table: "settings", key: RECENT_KEY, value: worlds.slice(0, RECENT_KEPT) }] });
}

/** Puts `world` first among the recent worlds, replacing an earlier visit to the same folder but keeping its picture until its page paints a new one. */
export async function keepRecent(engine: EngineClient, world: Omit<RecentWorld, "picture">): Promise<void> {
  const kept = await recentWorlds(engine);
  const picture = kept.find((r) => r.root === world.root)?.picture;
  await keep(engine, [picture === undefined ? world : { ...world, picture }, ...kept.filter((r) => r.root !== world.root)]);
}

/** Keeps `picture` with the recent world of `root`. One that is not a WebP data URL, or too long, or of a world no longer kept, is dropped. */
export async function keepPicture(engine: EngineClient, root: string, picture: string): Promise<void> {
  if (!isPicture(picture)) return;
  const kept = await recentWorlds(engine);
  if (!kept.some((r) => r.root === root)) return;
  await keep(
    engine,
    kept.map((r) => (r.root === root ? { ...r, picture } : r)),
  );
}
