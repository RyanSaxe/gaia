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
// first. A world is always Jev's: without Jev, with a request Jev could not
// answer once the engine's client retried it, or when the person declines
// the cost, the opening fails and says which request and why. Only a
// developer who asks for it (GAIA_JEV=stand-in) gets a world the stand-in
// judges, and nothing is sent to Jev then.

import type { CodeGraph, EngineClient, GraphNode, JevClient, JevResponse, Span } from "@gaia/schema";
import { outlinesOf } from "@gaia/terrain";
import { type Judge, RequestFailed, areaOfRequest, composeWorld, factsOf, judgeWorld, judgedThing, keptJev, landOf, layoutWorld, planWorldRequests, requestKey, standInJev, thingsOf } from "@gaia/world";
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
 * and the imports between files, but no blocks or other edges. Each
 * definition keeps what places and sizes it and nothing else.
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
            exported: n.exported,
            measures: { lines: n.measures.lines, ...(n.measures.nesting === undefined ? {} : { nesting: n.measures.nesting }) },
            ...stand(n),
          },
        ];
      default: {
        const { judged: _, ...rest } = n;
        return [{ ...rest, ...stand(n) }];
      }
    }
  });
  return { ...graph, nodes, edges: graph.edges.filter((e) => e.kind === "imports"), pending: [] };
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
  /**
   * For development only (GAIA_JEV=stand-in): the stand-in judges every look and composes the world, the
   * understanding pass is not run, and nothing is sent to Jev. Never on by default, and never offered to a person.
   */
  readonly standIn?: boolean;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export async function openWorld({ engine, root, consent, progress, standIn = false }: OpenWorldOptions): Promise<WorldDocument> {
  progress({ stage: "reading", root });
  // The land, outlined as the finished map draws it, every file's patch and every entity's lot, as soon as the graph
  // exists: every definition, with whatever stand Jev's held answers already give it. The facts the layout and the
  // looks read are the graph's own (`factsOf`).
  let judged = await engine.call("project.graph", { root, judged: true });
  let graph = judgedGraph(judged);
  const facts = factsOf(graph);
  const project = facts.projectId;
  const name = facts.repository.name;
  const land = landOf(facts, graph);
  progress({ stage: "land", name, size: land.size, ...(land.aspect === undefined ? {} : { aspect: land.aspect }), areas: outlinesOf(land).areas, patches: land.patches.map(({ path, name, area, x, z, radius }) => ({ path, name, area, x, z, radius })), lots: land.lots });
  // What understanding still has to ask, going only as far as the world needs to stand: Jev's links and every
  // definition's stand. Planning it all takes seconds the wait would sit still through, and only says what judging will
  // cost, so it is planned only when there is a limit to weigh that against; otherwise the pass finds its own way.
  const limitUsd = await spendLimit(engine);
  const understanding = Number.isFinite(limitUsd) ? await engine.call("understanding.plan", { root }) : null;
  // Each file's request names the definitions the graph stands on its patch, as the layout stands them.
  const planned = planWorldRequests(facts, LOOKS, { graph });
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
  /** How many understanding requests are pending, when it was planned. */
  const toUnderstand = understanding === null ? null : understanding.pending.reduce((n, p) => n + p.requests, 0);
  // What goes to Jev: understanding's share is planned before Jev's links are in, so it settles to what was sent.
  let total = missing.length + (toUnderstand ?? 0);

  // Whether Jev is asked about the things it has not judged or understood yet, and if it cannot be, why: a world
  // that needs an answer Jev cannot give fails, saying so, rather than open half judged.
  let ask = false;
  let unasked: string | undefined;
  /** How many looks go to Jev at once: as many as the engine sends it at once. */
  let concurrency = 1;
  if (!standIn) {
    const status = await engine.call("jev.status", {});
    if (!status.live) unasked = "Jev is off: start Gaia with GAIA_JEV=live to judge it";
    else if (!status.key) unasked = "there is no OpenRouter key in the Keychain (gaia-openrouter)";
    // Without Jev, a world opens only from answers all kept: one that needs anything asked fails, saying why. With no
    // spend limit the understanding pass wasn't planned, so it is planned now to know.
    if (unasked !== undefined) {
      const pending = toUnderstand ?? (await engine.call("understanding.plan", { root })).pending.reduce((n, p) => n + p.requests, 0);
      if (missing.length + pending > 0) throw new Error(`Gaia could not judge ${name}: ${unasked}.`);
    }
  }
  // With Jev to be asked: anything missing, or, with no plan made, whatever the understanding pass finds as it goes.
  if (!standIn && unasked === undefined && (total > 0 || toUnderstand === null)) {
    const judging = missing.length > 0 ? await engine.call("jev.estimate", { requests: missing.map((p) => p.request) }) : undefined;
    concurrency = judging?.concurrency ?? understanding?.estimate.concurrency ?? (await engine.call("jev.estimate", { requests: [] })).concurrency;
    const estimate = {
      endpoint: judging?.endpoint ?? understanding?.estimate.endpoint ?? "",
      requests: (judging?.requests ?? 0) + (understanding?.estimate.requests ?? 0),
      estimatedTokens: (judging?.estimatedTokens ?? 0) + (understanding?.estimate.estimatedTokens ?? 0),
      estimatedUsd: (judging?.estimatedUsd ?? 0) + (understanding?.estimate.estimatedUsd ?? 0),
    };
    console.log(
      understanding === null
        ? `gaia: ${name}: ${estimate.requests} looks to judge, about ${estimate.estimatedTokens} tokens, $${estimate.estimatedUsd.toFixed(4)}, and the understanding pass as it goes (no limit)`
        : `gaia: ${name}: ${estimate.requests} requests to judge, about ${estimate.estimatedTokens} tokens, $${estimate.estimatedUsd.toFixed(4)} (limit $${limitUsd})`,
    );
    // Past the limit the person decides; declining leaves the world unopened, and the next opening asks again.
    ask = estimate.estimatedUsd <= limitUsd || (await consent({ name, requests: estimate.requests, estimatedTokens: estimate.estimatedTokens, estimatedUsd: estimate.estimatedUsd, limitUsd, endpoint: estimate.endpoint }));
    if (!ask) throw new Error(`Gaia did not judge ${name}: judging it costs about $${estimate.estimatedUsd.toFixed(3)}, over your $${limitUsd} limit, and you chose not to go ahead.`);
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
  /** The regions whose own request is answered: an area is settled once everything on its land is, its region's own request included. */
  const regionsAnswered = new Set<string>();
  const settledAreas = (): string[] => [...unsettled].filter(([area, n]) => n === 0 && regionsAnswered.has(regionOf(area))).map(([area]) => area);
  /** Questions in flight, by the area they are about. */
  const inFlight = new Map<string, number>();
  const asking = (): void =>
    progress({ stage: "asking", name, total, answered, settled: settledAreas(), asking: [...inFlight].filter(([, n]) => n > 0).map(([area]) => area) });
  if (ask) asking();
  // Only a developer's GAIA_JEV=stand-in has the stand-in judge; otherwise every answer is Jev's, kept or asked now.
  const kept: JevClient = standIn
    ? standInJev(LOOKS)
    : keptJev(ask ? engineJev(engine) : null, { stored, keep, ...(unasked === undefined ? {} : { unasked }) });
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
        if (p.about === "area") regionsAnswered.add(p.target);
        if (ask && !stored.has(key)) {
          answered++;
          asking();
        }
      }
      return response;
    },
  };
  // As many looks at once as the engine sends Jev at once: `engineJev` gathers each round into one batch, and the
  // engine serves one call at a time, so fewer in flight only makes the looks, and the names they letter, wait.
  const judgments = await judgeWorld(facts, LOOKS, jev, { graph, concurrency });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(writes);

  // Then the understanding pass, a slice at a time, until nothing is left; the world is laid out on the importance and
  // quality it leaves. A request the engine's client could not get answered, retries and all, fails the world.
  if (ask && (toUnderstand ?? 1) > 0) {
    let understood = 0;
    for (;;) {
      const slice = await engine.call("understanding.next", { root });
      const failure = slice.failures[0];
      if (failure !== undefined || slice.failed > 0) throw new RequestFailed(`understanding ${failure?.unit ?? "part of the code"}`, failure?.error ?? `${plural(slice.failed, "request")} failed`);
      // What the slice read, so the wait can show which code Jev has just been through, then each file it settled for
      // good, washed in at the quality the world will show.
      const files = slice.settled.flatMap((id) => (id.startsWith("file:") ? [id.slice(5)] : []));
      const areas = slice.settled.flatMap((id) => (id.startsWith("dir:") ? [id.slice(4)] : []));
      if (files.length > 0 || areas.length > 0) progress({ stage: "understood", files, areas });
      for (const [path, quality] of Object.entries(slice.quality)) settleHealth(path, quality);
      sendHealth();
      understood += slice.sent;
      answered += slice.sent;
      total = Math.max(total, answered);
      if (slice.left === 0 || (slice.sent === 0 && slice.settled.length === 0)) break;
      asking();
    }
    total = missing.length + understood;
    asking();
    // The pass changed what the graph holds only if it asked something.
    if (understood > 0) {
      judged = await engine.call("project.graph", { root, judged: true });
      graph = judgedGraph(judged);
    }
  }
  // Every building and landmark is composed part by part once the code is understood, each request carrying what the
  // pass found about its entity, so it is asked once and stays while the code does.
  const composed = await composeWorld(facts, LOOKS, jev, judgments, { graph, concurrency });
  // Its answers are kept before the world is handed over, as the looks' were.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(writes);

  const judge: Judge = standIn ? "stand-in" : "jev";
  const byThing = Object.fromEntries(planned.flatMap((p) => thingsOf(p).map((t) => [judgedThing(t), judge] as const)));
  const things = Object.keys(byThing).length;
  const parts = standIn ? [`${plural(things, "thing")} judged by the stand-in (GAIA_JEV=stand-in, for development)`] : [`${plural(things, "thing")} judged by Jev`];
  if (billed > 0) parts.push(`$${billed.toFixed(4)} billed`);
  const world = layoutWorld(facts, composed, graph);
  // Any file no answer was about is settled now, before the document.
  for (const p of world.patches) settleHealth(p.path, p.vitality);
  sendHealth();
  return { root, ...(judged.commit === undefined ? {} : { commit: judged.commit }), facts, world, judges: byThing, summary: parts.join("; "), judged: judgedThings(judged) };
}
