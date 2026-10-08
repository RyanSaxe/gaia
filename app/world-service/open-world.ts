// Opening a codebase's world: the engine reads the code, Jev judges every
// look, and the world is laid out. Jev's answers are kept in the project's
// app-data store, keyed by each request's hash, so reopening asks again only
// about things whose facts changed. Jev is asked only when the engine has a
// key and runs with GAIA_JEV=live, and only after the person has seen what a
// run would send and cost and said yes, once per project. Everything Jev does
// not answer is judged by the stand-in, and the document says which.

import type { EngineClient, JevResponse } from "@gaia/schema";
import { type Judge, judgeWorld, judgedThing, keptJev, layoutWorld, planWorldRequests, requestKey, standInJev } from "@gaia/world";
import { LOOKS } from "../renderer/terrain/looks.ts";
import { engineJev } from "./jev.ts";
import type { ConsentPlan, Opening, WorldDocument } from "./protocol.ts";

/** Where the person's answer to a live run is remembered, in the project's `settings` table. */
export const CONSENT_KEY = "jev-consent";

export interface OpenWorldOptions {
  readonly engine: EngineClient;
  readonly root: string;
  /** Asks the person whether to send `plan` to Jev. Asked at most once per project; the answer is stored. */
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
      const remembered = await engine.call("store.get", { project, table: "settings", key: CONSENT_KEY });
      let approved = (remembered?.value as { approved?: boolean } | undefined)?.approved;
      if (approved === undefined) {
        const estimate = await engine.call("jev.estimate", { requests: missing.map((p) => p.request) });
        approved = await consent({ name, requests: estimate.requests, estimatedTokens: estimate.estimatedTokens, estimatedUsd: estimate.estimatedUsd, endpoint: estimate.endpoint });
        await engine.call("store.put", { project, writes: [{ table: "settings", key: CONSENT_KEY, value: { approved } }] });
      }
      ask = approved;
      if (!approved) why = "you chose the stand-in for this project";
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
  const asking = (): void => progress({ stage: "asking", name, total: missing.length, answered, failed: failures.length });
  if (ask) asking();
  const jev = keptJev(ask ? engineJev(engine) : null, standInJev(LOOKS), {
    stored,
    keep,
    settled: (key, judge, failure) => {
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

  const byJev = planned.filter((_, i) => judges.get(keys[i] as string) === "jev").length;
  const parts =
    byJev === 0
      ? [`${plural(planned.length, "thing")} judged by the stand-in`]
      : [`${plural(byJev, "thing")} judged by Jev`, ...(byJev < planned.length ? [`${plural(planned.length - byJev, "thing")} by the stand-in`] : [])];
  if (failures.length > 0) parts.push(`${plural(failures.length, "request")} failed (${failures[0]})`);
  else if (why !== "") parts.push(why);
  return {
    root,
    model,
    world: layoutWorld(model, judgments),
    judges: Object.fromEntries(planned.map((p, i) => [judgedThing(p), judges.get(keys[i] as string) ?? "stand-in"])),
    summary: parts.join("; "),
  };
}
