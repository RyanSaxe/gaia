// The worlds a person opened before, for the start page: kept with the app's
// own settings in the store (the `app` project's `settings` table), newest
// first, each with the commit the person last opened it at, where they stood
// when they last left it, which its next open lands them at, and a painting of
// where they last stood still, which the start lays on its table as its card.
// Six paintings of about 60 KB keep the app's store under a megabyte, and it is
// read whole only when the start is offered or a world is kept. Once the code
// has moved on, the start is also told how many commits have touched the
// folder since, which the card tallies.

import type { EngineClient } from "@gaia/schema";
import type { StoodSpot } from "@gaia/terrain";
import { APP_STORE } from "./open-world.ts";
import type { RecentWorld } from "./protocol.ts";

/** Where the recent worlds are kept, in the app's `settings` table. */
export const RECENT_KEY = "recent-worlds";

/** How many recent worlds the start page offers. */
export const RECENT_KEPT = 6;

/** The longest painting kept, characters of its data URL: about 190 KB of WebP, three times what a page paints. */
export const PAINTING_MAX = 256_000;

const isPainting = (painting: unknown): painting is string => typeof painting === "string" && painting.startsWith("data:image/webp;base64,") && painting.length <= PAINTING_MAX;

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
 * so a world kept before paintings were, with the postcard of its areas or
 * the picture of its map it kept then, has no painting.
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
 * The recent worlds as the start offers them, each with its painting; and once the folder's code has moved on from the
 * commit the person last opened, how many commits have touched it since.
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
 * Puts `world`, opened at `commit`, first among the recent worlds, replacing an earlier visit to the same folder but
 * keeping where the person stood and its painting until they stand, or stand still, somewhere else.
 */
export async function keepRecent(engine: EngineClient, world: Omit<RecentWorld, "painting" | "stood" | "commitsSince">): Promise<void> {
  const kept = await recentWorlds(engine);
  const earlier = kept.find((r) => r.root === world.root);
  const stays = { ...(earlier?.stood === undefined ? {} : { stood: earlier.stood }), ...(earlier?.painting === undefined ? {} : { painting: earlier.painting }) };
  await keep(engine, [{ ...world, ...stays }, ...kept.filter((r) => r.root !== world.root)]);
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

/** Keeps `painting` with the recent world of `root`; one that is not a WebP data URL, or too long, or of a world no longer kept, is dropped. */
export async function keepPainting(engine: EngineClient, root: string, painting: string): Promise<void> {
  if (!isPainting(painting)) return;
  const kept = await recentWorlds(engine);
  if (!kept.some((r) => r.root === root)) return;
  await keep(
    engine,
    kept.map((r) => (r.root === root ? { ...r, painting } : r)),
  );
}
