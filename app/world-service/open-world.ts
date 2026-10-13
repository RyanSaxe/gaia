// Opening a codebase's world: the engine reads the code, the land is divided,
// Jev judges every look, the understanding pass gives every folder, file and
// definition its importance and quality, and the world is laid out, its
// vitality Jev's quality. The land's division depends on the code alone (the
// engine's graph of it, divided down to each definition, but never what Jev
// judged), so its outlines and every file's patch go to the renderer before
// any judging; each area is named as its judgments settle, and each file's
// health follows the understanding pass: the wait paints the map as the world
// is judged. Jev's answers are kept in the project's
// app-data store, keyed by each request's hash, so reopening asks again only
// about things whose facts changed. Jev is asked only when the engine has a
// key and runs with GAIA_JEV=live. Until the person sets a spend limit, every
// run goes ahead with no question; with one set, a run that costs more asks
// first. Everything Jev does not answer is judged by the stand-in, and the
// document says which.

import type { CodeGraph, EngineClient, GraphNode, JevClient, JevResponse, Span } from "@gaia/schema";
import { outlinesOf } from "@gaia/terrain";
import { type Judge, areaOfRequest, judgeWorld, judgedThing, keptJev, landOf, layoutWorld, planWorldRequests, requestKey, standInJev, thingsOf } from "@gaia/world";
import { LOOKS } from "../renderer/terrain/looks.ts";
import { engineJev } from "./jev.ts";
import type { ConsentPlan, JudgedThing, Opening, WorldDocument } from "./protocol.ts";

/**
 * What judging one project may spend without asking, US dollars, until the
 * person sets their own: no limit while Gaia is being built, so a test run
 * never stops on the waiting screen (decision 39). Each run still prints its
 * estimate.
 */
export const DEFAULT_SPEND_LIMIT_USD = Number.POSITIVE_INFINITY;

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

/**
 * The graph the layout reads: directories, files and definitions, with the
 * understanding pass's importance and quality as each one's only judgment,
 * and no blocks or edges. Each definition keeps what places and sizes it and
 * nothing else.
 */
export function judgedGraph(graph: CodeGraph): CodeGraph {
  const stand = (n: GraphNode) => (n.judged?.value === undefined ? {} : { judged: { value: n.judged.value } });
  const nodes = graph.nodes.flatMap((n): GraphNode[] => {
    switch (n.kind) {
      case "block":
        return [];
      case "def":
        return [
          {
            kind: "def",
            id: n.id,
            lineage: n.lineage,
            file: n.file,
            ...(n.parent === undefined ? {} : { parent: n.parent }),
            name: n.name,
            role: n.role,
            span: n.span,
            signature: n.signature,
            ...(n.doc === undefined ? {} : { doc: n.doc }),
            measures: { lines: n.measures.lines },
            ...stand(n),
          },
        ];
      default: {
        const { judged: _, ...rest } = n;
        return [{ ...rest, ...stand(n) }];
      }
    }
  });
  return { ...graph, nodes, edges: [], pending: [] };
}

/**
 * What the understanding pass judged about every folder, file and definition,
 * as the world document carries it: by path, and by path and qualified name
 * for a definition, with the blocks Jev picked by their lines.
 */
export function judgedThings(graph: CodeGraph): Record<string, JudgedThing> {
  const spans = new Map(graph.nodes.flatMap((n) => (n.kind === "block" ? [[n.id, n.span] as const] : [])));
  const pathOf = new Map(graph.nodes.flatMap((n) => (n.kind === "file" ? [[n.id, n.path] as const] : [])));
  const out: Record<string, JudgedThing> = {};
  for (const n of graph.nodes) {
    if (n.kind === "block") continue;
    const value = n.judged?.value;
    if (value === undefined) continue;
    const key = n.kind === "def" ? `${pathOf.get(n.file) ?? ""}#${n.id.slice(n.id.indexOf("#") + 1)}` : n.path;
    const picks: { key?: Span; weak?: Span } = {};
    for (const pick of ["key", "weak"] as const) {
      const span = spans.get(n.judged?.picks?.[pick]?.choice ?? "");
      if (span !== undefined) picks[pick] = span;
    }
    out[key] = { quality: value.quality, importance: value.importance, concepts: value.concepts, picks };
  }
  return out;
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
  // The land, outlined as the finished map draws it, every file's patch and every entity's lot, as soon as the graph
  // exists: every definition, with whatever stand Jev's held answers already give it. Planning what understanding
  // still has to ask takes longer, so it comes after, while the wait draws the borders.
  let judged = await engine.call("project.graph", { root, judged: true });
  let graph = judgedGraph(judged);
  const land = landOf(model, graph);
  progress({ stage: "land", name, size: land.size, ...(land.aspect === undefined ? {} : { aspect: land.aspect }), areas: outlinesOf(land).areas, patches: land.patches.map(({ path, name, area, x, z, radius }) => ({ path, name, area, x, z, radius })), lots: land.lots });
  // What understanding still has to ask, going only as far as the world needs to stand: Jev's links and every
  // definition's stand.
  const understanding = await engine.call("understanding.plan", { root });
  // Each file's request names the definitions the graph stands on its patch, as the layout stands them.
  const planned = planWorldRequests(model, LOOKS, { graph });
  const keys = planned.map((p) => requestKey(p.request));

  // Each file's health is Jev's quality, so it goes to the renderer once the understanding pass has judged it.
  const healthUnsent = new Set(land.patches.map((p) => p.path));
  let healthSettled: Record<string, number> = {};
  const settleHealth = (path: string, vitality: number): void => {
    if (!healthUnsent.delete(path)) return;
    healthSettled[path] = vitality;
  };
  const sendHealth = (): void => {
    if (Object.keys(healthSettled).length > 0) progress({ stage: "health", vitality: healthSettled });
    healthSettled = {};
  };

  const { records } = await engine.call("store.read", { project, table: "answers" });
  const stored = new Map(Object.entries(records as Record<string, JevResponse>));
  const missing = planned.filter((_, i) => !stored.has(keys[i] as string));
  const toUnderstand = understanding.pending.reduce((n, p) => n + p.requests, 0);
  // What goes to Jev: understanding's share is planned before Jev's links are in, so it settles to what was sent.
  let total = missing.length + toUnderstand;

  // Whether Jev is asked about the things it has not judged or understood yet, and if not, why.
  let ask = false;
  let why = "";
  if (total > 0) {
    const status = await engine.call("jev.status", {});
    if (!status.live) why = "Jev is off; start Gaia with GAIA_JEV=live to ask it";
    else if (!status.key) why = "no OpenRouter key in the Keychain (gaia-openrouter)";
    else {
      const judging = missing.length > 0 ? await engine.call("jev.estimate", { requests: missing.map((p) => p.request) }) : undefined;
      const estimate = {
        endpoint: judging?.endpoint ?? understanding.estimate.endpoint,
        requests: (judging?.requests ?? 0) + understanding.estimate.requests,
        estimatedTokens: (judging?.estimatedTokens ?? 0) + understanding.estimate.estimatedTokens,
        estimatedUsd: (judging?.estimatedUsd ?? 0) + understanding.estimate.estimatedUsd,
      };
      const limitUsd = await spendLimit(engine);
      console.log(`gaia: ${name}: ${estimate.requests} requests to judge, about ${estimate.estimatedTokens} tokens, $${estimate.estimatedUsd.toFixed(4)} (${Number.isFinite(limitUsd) ? `limit $${limitUsd}` : "no limit"})`);
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
  /** What OpenRouter billed for this opening's answers. */
  let billed = 0;
  const keep = (key: string, response: JevResponse): void => {
    billed += Number.isFinite(response.costUsd) ? response.costUsd : 0;
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
  /** Understanding requests Jev refused. */
  let misunderstood = 0;
  let answered = 0;
  // Each area is settled once every request about a thing on its land is (its files, its entity and itself) and
  // its land is judged: its own, or its region's when it has no land of its own.
  const unsettled = new Map<string, number>(land.areas.map((a) => [a.path, 0]));
  const plannedOf = new Map<string, (typeof planned)[number]>();
  for (const [i, p] of planned.entries()) {
    const key = keys[i] as string;
    if (plannedOf.has(key)) continue;
    plannedOf.set(key, p);
    const area = areaOfRequest(p);
    unsettled.set(area, (unsettled.get(area) ?? 0) + 1);
  }
  const regions = new Set(planned.filter((p) => p.about === "area").map((p) => p.target));
  const regionOf = (area: string): string => {
    for (let p = area; p !== ""; p = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "") if (regions.has(p)) return p;
    return "";
  };
  const lands = new Map<string, string>();
  const settledAreas = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [area, n] of unsettled) {
      const judged = lands.get(regionOf(area));
      if (n === 0 && judged !== undefined) out[area] = judged;
    }
    return out;
  };
  /** Questions in flight, by the area they are about. */
  const inFlight = new Map<string, number>();
  const asking = (): void =>
    progress({ stage: "asking", name, total, answered, failed: failures.length + misunderstood, settled: settledAreas(), asking: [...inFlight].filter(([, n]) => n > 0).map(([area]) => area) });
  if (ask) asking();
  const kept = keptJev(ask ? engineJev(engine) : null, standInJev(LOOKS), {
    stored,
    keep,
    settled: (key, judge, failure) => {
      judges.set(key, judge);
      if (failure !== undefined) failures.push(failure);
    },
  });
  // A request counts as settled once its answer, whoever gave it, is in hand: an area's answer names its land.
  const counted = new Set<string>();
  const jev: JevClient = {
    async ask(request) {
      const key = requestKey(request);
      const p = plannedOf.get(key);
      // A question going out to Jev (not one kept from before) marks its area as being worked on until it returns.
      const out = ask && p !== undefined && !stored.has(key) ? areaOfRequest(p) : null;
      if (out !== null) {
        inFlight.set(out, (inFlight.get(out) ?? 0) + 1);
        asking();
      }
      const response = await kept.ask(request).finally(() => {
        if (out !== null) inFlight.set(out, (inFlight.get(out) ?? 1) - 1);
      });
      if (p !== undefined && !counted.has(key)) {
        counted.add(key);
        const area = areaOfRequest(p);
        unsettled.set(area, (unsettled.get(area) ?? 1) - 1);
        const judged = response.answers.land;
        if (p.about === "area" && judged?.type === "choice") lands.set(p.target, judged.choice);
        if (ask && !stored.has(key)) {
          answered++;
          asking();
        }
      }
      return response;
    },
  };
  const judgments = await judgeWorld(model, LOOKS, jev, { graph });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(writes);

  // Then the understanding pass, a slice at a time, until nothing is left or a slice moves nothing, as when Jev
  // refuses every request in it; the world is laid out on the importance and quality it leaves.
  if (ask && toUnderstand > 0) {
    let understood = 0;
    for (;;) {
      const slice = await engine.call("understanding.next", { root });
      // Each file the slice settled is washed in now, at the quality the world will show.
      for (const [path, quality] of Object.entries(slice.quality)) settleHealth(path, quality);
      sendHealth();
      understood += slice.sent + slice.failed;
      answered += slice.sent + slice.failed;
      misunderstood += slice.failed;
      total = Math.max(total, answered);
      if (slice.left === 0 || (slice.sent === 0 && slice.settled.length === 0)) break;
      asking();
    }
    total = missing.length + understood;
    asking();
    judged = await engine.call("project.graph", { root, judged: true });
    graph = judgedGraph(judged);
  }

  const byThing = Object.fromEntries(planned.flatMap((p, i) => thingsOf(p).map((t) => [judgedThing(t), judges.get(keys[i] as string) ?? "stand-in"] as const)));
  const things = Object.keys(byThing).length;
  const byJev = Object.values(byThing).filter((j) => j === "jev").length;
  const parts =
    byJev === 0
      ? [`${plural(things, "thing")} judged by the stand-in`]
      : [`${plural(byJev, "thing")} judged by Jev`, ...(byJev < things ? [`${plural(things - byJev, "thing")} by the stand-in`] : [])];
  if (billed > 0) parts.push(`$${billed.toFixed(4)} billed`);
  const failed = failures.length + misunderstood;
  if (failed > 0) parts.push(`${plural(failed, "request")} failed${failures[0] === undefined ? "" : ` (${failures[0]})`}`);
  else if (why !== "") parts.push(why);
  const world = layoutWorld(model, judgments, graph);
  // Any file no answer was about is settled now, before the document.
  for (const p of world.patches) settleHealth(p.path, p.vitality);
  sendHealth();
  return { root, model, world, judges: byThing, summary: parts.join("; "), judged: judgedThings(judged) };
}
