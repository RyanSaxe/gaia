// Opening a codebase's world: the engine reads the code, the land is divided,
// Jev judges every look, and the world is laid out. The land's division
// depends on the code alone, so its outlines go to the renderer before any
// judging, and each area is named as its judgments settle: the wait paints
// the map as the world is judged. Jev's answers are kept in the project's
// app-data store, keyed by each request's hash, so reopening asks again only
// about things whose facts changed. Jev is asked only when the engine has a
// key and runs with GAIA_JEV=live. A run that costs no more than the
// person's spend limit goes ahead with no question; one that costs more asks
// first. Everything Jev does not answer is judged by the stand-in, and the
// document says which.

import type { EngineClient, JevResponse } from "@gaia/schema";
import { outlinesOf } from "@gaia/terrain";
import { type Judge, areaOfRequest, judgeWorld, judgedThing, keptJev, landOf, layoutWorld, planWorldRequests, requestKey, standInJev, thingsOf } from "@gaia/world";
import { LOOKS } from "../renderer/terrain/looks.ts";
import { engineJev } from "./jev.ts";
import type { ConsentPlan, Opening, WorldDocument } from "./protocol.ts";

/**
 * What judging one project may spend without asking, US dollars, until the
 * person sets their own: about six times what judging Gaia's own repository
 * (267 requests, about $0.016) costs.
 */
export const DEFAULT_SPEND_LIMIT_USD = 0.1;

/** The store's "project" that keeps the app's own settings, apart from every project's (project IDs are hex hashes). */
export const APP_STORE = "app";

/** Where the person's spend limit is kept, in the app's `settings` table. */
export const LIMIT_KEY = "jev-spend-limit";

/** Where a project remembers that the person chose the stand-in over spending past their limit, in its `settings` table. */
export const CONSENT_KEY = "jev-consent";

/** What judging one project may spend without asking. */
export async function spendLimit(engine: EngineClient): Promise<number> {
  const kept = (await engine.call("store.get", { project: APP_STORE, table: "settings", key: LIMIT_KEY }))?.value as { usd?: unknown } | undefined;
  return typeof kept?.usd === "number" && Number.isFinite(kept.usd) && kept.usd >= 0 ? kept.usd : DEFAULT_SPEND_LIMIT_USD;
}

/** Sets what judging one project may spend without asking. */
export async function setSpendLimit(engine: EngineClient, usd: number): Promise<void> {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`Not a spend limit: ${usd}`);
  await engine.call("store.put", { project: APP_STORE, writes: [{ table: "settings", key: LIMIT_KEY, value: { usd } }] });
}

export interface OpenWorldOptions {
  readonly engine: EngineClient;
  readonly root: string;
  /** Asks the person whether to send `plan` to Jev: only when it costs more than their spend limit. */
  readonly consent: (plan: ConsentPlan) => Promise<boolean>;
  readonly progress: (opening: Opening) => void;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export async function openWorld({ engine, root, consent, progress }: OpenWorldOptions): Promise<WorldDocument> {
  progress({ stage: "reading", root });
  const model = await engine.call("project.open", { root });
  const project = model.projectId;
  const name = model.repository.name;
  const planned = planWorldRequests(model, LOOKS);
  const keys = planned.map((p) => requestKey(p.request));

  // The land, outlined as the finished map draws it, before anything is judged.
  const land = landOf(model);
  progress({ stage: "land", name, size: land.size, areas: outlinesOf(land).areas });

  const { records } = await engine.call("store.read", { project, table: "answers" });
  const stored = new Map(Object.entries(records as Record<string, JevResponse>));
  const missing = planned.filter((_, i) => !stored.has(keys[i] as string));

  // Whether Jev is asked about the things it has not judged yet, and if not, why.
  let ask = false;
  let why = "";
  if (missing.length > 0) {
    const status = await engine.call("jev.status", {});
    if (!status.live) why = "Jev is off; start Gaia with GAIA_JEV=live to ask it";
    else if (!status.key) why = "no OpenRouter key in the Keychain (gaia-openrouter)";
    else {
      const estimate = await engine.call("jev.estimate", { requests: missing.map((p) => p.request) });
      const limitUsd = await spendLimit(engine);
      if (estimate.estimatedUsd <= limitUsd) ask = true;
      else {
        // Past the limit the person decides; choosing the stand-in is remembered for the project until the limit changes.
        const remembered = (await engine.call("store.get", { project, table: "settings", key: CONSENT_KEY }))?.value as { approved?: boolean; limitUsd?: number } | undefined;
        if (remembered?.approved === false && remembered.limitUsd === limitUsd) ask = false;
        else {
          ask = await consent({ name, requests: estimate.requests, estimatedTokens: estimate.estimatedTokens, estimatedUsd: estimate.estimatedUsd, limitUsd, endpoint: estimate.endpoint });
          if (!ask) await engine.call("store.put", { project, writes: [{ table: "settings", key: CONSENT_KEY, value: { approved: false, limitUsd } }] });
        }
        if (!ask) why = "you chose the stand-in for this project";
      }
    }
  }

  // Answers Jev gives arrive a batch at a time; each batch is stored in one write.
  let pending: { table: "answers"; key: string; value: unknown }[] = [];
  const writes: Promise<unknown>[] = [];
  const keep = (key: string, response: JevResponse): void => {
    if (pending.length === 0) {
      setTimeout(() => {
        writes.push(engine.call("store.put", { project, writes: pending }));
        pending = [];
      }, 0);
    }
    pending.push({ table: "answers", key, value: response });
  };

  const judges = new Map<string, Judge>();
  const failures: string[] = [];
  let answered = 0;
  // Each area is settled once every request about a thing on its land is: its files, its entity and itself.
  const unsettled = new Map<string, number>(land.areas.map((a) => [a.path, 0]));
  const areaOf = new Map<string, string>();
  for (const [i, p] of planned.entries()) {
    const key = keys[i] as string;
    if (areaOf.has(key)) continue;
    const area = areaOfRequest(p);
    areaOf.set(key, area);
    unsettled.set(area, (unsettled.get(area) ?? 0) + 1);
  }
  const settledAreas = (): string[] => [...unsettled].filter(([, n]) => n === 0).map(([a]) => a);
  const asking = (): void => progress({ stage: "asking", name, total: missing.length, answered, failed: failures.length, settled: settledAreas() });
  if (ask) asking();
  const jev = keptJev(ask ? engineJev(engine) : null, standInJev(LOOKS), {
    stored,
    keep,
    settled: (key, judge, failure) => {
      const area = areaOf.get(key);
      if (area !== undefined && !judges.has(key)) unsettled.set(area, (unsettled.get(area) ?? 1) - 1);
      judges.set(key, judge);
      if (failure !== undefined) failures.push(failure);
      if (ask && !stored.has(key)) {
        answered++;
        asking();
      }
    },
  });
  const judgments = await judgeWorld(model, LOOKS, jev);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(writes);

  const byThing = Object.fromEntries(planned.flatMap((p, i) => thingsOf(p).map((t) => [judgedThing(t), judges.get(keys[i] as string) ?? "stand-in"] as const)));
  const things = Object.keys(byThing).length;
  const byJev = Object.values(byThing).filter((j) => j === "jev").length;
  const parts =
    byJev === 0
      ? [`${plural(things, "thing")} judged by the stand-in`]
      : [`${plural(byJev, "thing")} judged by Jev`, ...(byJev < things ? [`${plural(things - byJev, "thing")} by the stand-in`] : [])];
  if (failures.length > 0) parts.push(`${plural(failures.length, "request")} failed (${failures[0]})`);
  else if (why !== "") parts.push(why);
  return {
    root,
    model,
    world: layoutWorld(model, judgments),
    judges: byThing,
    summary: parts.join("; "),
  };
}
