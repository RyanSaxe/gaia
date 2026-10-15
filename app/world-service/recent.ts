// The worlds a person opened before, for the start page: kept with the app's
// own settings in the store (the `app` project's `settings` table), newest
// first, each with the commit the person last opened it at and the picture of
// its field map its page painted then. Six pictures of about 100 KB keep the app's
// store under a megabyte, and it is read whole only when the start is offered
// or a world is kept. A picture is offered only while its folder's code is
// still that commit: a map that would be drawn anew is never shown. Once the
// code has moved on, the start is told how many commits have touched the
// folder since, which its card tallies. Each world also keeps where the
// person stood when they last left it, which its next open lands them at.

import type { EngineClient } from "@gaia/schema";
import type { StoodSpot } from "@gaia/terrain";
import { APP_STORE } from "./open-world.ts";
import type { RecentWorld } from "./protocol.ts";

/** Where the recent worlds are kept, in the app's `settings` table. */
export const RECENT_KEY = "recent-worlds";

/** How many recent worlds the start page offers. */
export const RECENT_KEPT = 6;

/** The longest picture kept, characters of its data URL: about 190 KB of WebP, twice what a page paints. */
export const PICTURE_MAX = 256_000;

const isPicture = (picture: unknown): picture is string => typeof picture === "string" && picture.startsWith("data:image/webp;base64,") && picture.length <= PICTURE_MAX;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Whether a value is a spot as a page keeps it (`StoodSpot`). */
const isStood = (s: unknown): s is StoodSpot => {
  if (typeof s !== "object" || s === null) return false;
  const { x, z, yaw, layout, by } = s as Partial<Record<keyof StoodSpot, unknown>>;
  const byOk = by === null || (typeof by === "object" && by !== null && typeof (by as { path?: unknown }).path === "string" && finite((by as { x?: unknown }).x) && finite((by as { z?: unknown }).z));
  return finite(x) && finite(z) && finite(yaw) && typeof layout === "string" && byOk;
};

/**
 * The recent worlds as they are kept. Only what the start reads is passed on,
 * so a world kept before pictures were, with the postcard of its areas it
 * kept then, has no picture, and neither has one kept before pictures said
 * which commit they show.
 */
export async function recentWorlds(engine: EngineClient): Promise<RecentWorld[]> {
  const kept = (await engine.call("store.get", { project: APP_STORE, table: "settings", key: RECENT_KEY }))?.value;
  if (!Array.isArray(kept)) return [];
  return kept.flatMap((r: Partial<Record<keyof RecentWorld, unknown>> | null): RecentWorld[] => {
    if (typeof r?.root !== "string" || typeof r.name !== "string") return [];
    const opened = typeof r.commit === "string" ? { commit: r.commit, ...(isPicture(r.picture) ? { picture: r.picture } : {}) } : {};
    return [{ root: r.root, name: r.name, ...(typeof r.github === "string" ? { github: r.github } : {}), at: typeof r.at === "number" ? r.at : 0, ...opened, ...(isStood(r.stood) ? { stood: r.stood } : {}) }];
  });
}

/**
 * The recent worlds as the start offers them: each picture only while its folder's code is still the commit the person
 * last opened, so the start never shows, and the wait never starts from, a map that would be drawn anew; and once the
 * code has moved on, how many commits have touched the folder since.
 */
export async function offeredWorlds(engine: EngineClient): Promise<RecentWorld[]> {
  return Promise.all(
    (await recentWorlds(engine)).map(async ({ picture, commit, stood: _, ...world }) => {
      if (commit === undefined) return world;
      const now = (await engine.call("project.commit", { root: world.root }).catch(() => ({ commit: null }))).commit;
      if (now === null) return world;
      if (now === commit) return { ...world, ...(picture === undefined ? {} : { picture }), commit };
      const since = await engine.call("project.commits", { root: world.root, from: commit, to: now }).catch(() => ({ commits: null }));
      return since.commits === 0 ? world : { ...world, commitsSince: since.commits };
    }),
  );
}

async function keep(engine: EngineClient, worlds: readonly RecentWorld[]): Promise<void> {
  await engine.call("store.put", { project: APP_STORE, writes: [{ table: "settings", key: RECENT_KEY, value: worlds.slice(0, RECENT_KEPT) }] });
}

/**
 * Puts `world`, opened at `commit`, first among the recent worlds, replacing an earlier visit to the same folder but
 * keeping its picture, while it pictures that commit, until its page paints a new one, and where the person stood
 * until they stand somewhere else.
 */
export async function keepRecent(engine: EngineClient, world: Omit<RecentWorld, "picture" | "stood" | "commitsSince">): Promise<void> {
  const kept = await recentWorlds(engine);
  const earlier = kept.find((r) => r.root === world.root);
  const pictured = earlier?.picture !== undefined && world.commit !== undefined && earlier.commit === world.commit ? { picture: earlier.picture } : {};
  await keep(engine, [{ ...world, ...pictured, ...(earlier?.stood === undefined ? {} : { stood: earlier.stood }) }, ...kept.filter((r) => r.root !== world.root)]);
}

/** Where the person stood when they last left the world of `root`, if it is kept and they stood anywhere in it. */
export async function stoodIn(engine: EngineClient, root: string): Promise<StoodSpot | undefined> {
  return (await recentWorlds(engine)).find((r) => r.root === root)?.stood;
}

/** Keeps `stood` with the recent world of `root`; one that is malformed, or of a world no longer kept, is dropped. */
export async function keepStood(engine: EngineClient, root: string, stood: unknown): Promise<void> {
  if (!isStood(stood)) return;
  const kept = await recentWorlds(engine);
  if (!kept.some((r) => r.root === root)) return;
  await keep(
    engine,
    kept.map((r) => (r.root === root ? { ...r, stood } : r)),
  );
}

/**
 * Keeps `picture`, painted from `commit`, with the recent world of `root`. One that is not a WebP data URL, or too
 * long, or of a world no longer kept, is dropped, and so is one of a world read from disk, whose code may have changed
 * by the next time with nothing to tell.
 */
export async function keepPicture(engine: EngineClient, root: string, picture: string, commit: string | undefined): Promise<void> {
  if (!isPicture(picture) || commit === undefined) return;
  const kept = await recentWorlds(engine);
  if (!kept.some((r) => r.root === root)) return;
  await keep(
    engine,
    kept.map((r) => (r.root === root ? { ...r, picture, commit } : r)),
  );
}
