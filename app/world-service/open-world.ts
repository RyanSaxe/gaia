// Opens a codebase's world: the engine reads the code, Jev answers every look
// and understanding request, and `layoutWorld` lays out the result. The land's
// division depends only on the code, so the renderer receives its outlines
// before any judging. Jev's answers are stored in the project's store by
// request hash, so a reopen asks Jev only about things whose facts changed.

import type { CodeGraph, EngineClient, GraphNode, JevClient, JevResponse, Span } from "@gaia/schema";
import { outlinesOf } from "@gaia/terrain";
import { type CodeWorld, RequestFailed, areaOfRequest, composeWorld, composingEstimate, factsOf, judgeWorld, keptJev, landOf, layoutWorld, planForms, planWorldRequests, requestKey, vitalityOf, withLines, withVitality } from "@gaia/world";
import { LOOKS } from "../renderer/terrain/looks.ts";
import { engineJev } from "./jev.ts";
import type { ConsentPlan, VitalityUpdate, JudgedThing, Opening, WorldDocument } from "./protocol.ts";

/**
 * The spend limit in US dollars until the person sets one. It is infinite
 * during development, so a test run never stops to ask for consent. Each run
 * still logs its estimate.
 */
export const DEFAULT_SPEND_LIMIT_USD = Number.POSITIVE_INFINITY;

/** The store project that holds the app settings. Project IDs are hex hashes, so it cannot collide with one. */
export const APP_STORE = "app";

/** The key of the spend limit in the `APP_STORE` `settings` table. */
export const LIMIT_KEY = "jev-spend-limit";

/** Returns the spend limit, in US dollars, for judging one project without asking. */
export async function spendLimit(engine: EngineClient): Promise<number> {
  const kept = (await engine.call("store.get", { project: APP_STORE, table: "settings", key: LIMIT_KEY }))?.value as { usd?: unknown } | undefined;
  return typeof kept?.usd === "number" && Number.isFinite(kept.usd) && kept.usd >= 0 ? kept.usd : DEFAULT_SPEND_LIMIT_USD;
}

/** Stores the spend limit, in US dollars. */
export async function setSpendLimit(engine: EngineClient, usd: number): Promise<void> {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`Not a spend limit: ${usd}`);
  await engine.call("store.put", { project: APP_STORE, writes: [{ table: "settings", key: LIMIT_KEY, value: { usd } }] });
}

/**
 * Reduces the graph to what the layout reads. It keeps directories, files and
 * definitions with only the understanding pass's importance and quality, the
 * imports between files, and the calls and references into definitions. A
 * definition's building or landmark scales with its incoming calls, as a
 * file's scales with its importers. Blocks and other edges are dropped, and
 * each definition keeps only the fields that place and size it.
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
  const read = (e: CodeGraph["edges"][number]): boolean => e.kind === "imports" || ((e.kind === "calls" || e.kind === "references") && e.to.startsWith("def:"));
  return { ...graph, nodes, edges: graph.edges.filter(read), pending: [] };
}

/**
 * Returns the understanding pass's judgment of every folder, file and
 * definition for `WorldDocument.judged`. Keys are paths, or
 * `<path>#<qualified name>` for a definition. Blocks Jev picked are line spans.
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
  /** Asks the person whether to send `plan` to Jev. `openWorld` calls it only when the cost exceeds the spend limit. */
  readonly consent: (plan: ConsentPlan) => Promise<boolean>;
  readonly progress: (opening: Opening) => void;
}

/**
 * Returns what a request made after the looks settles, from its state, for the wait's pencil strokes. A request is
 * `composed` when it composes a blueprint and `chosen` when it picks forms (`planForms`). A file's or definition's
 * request is reported by its file. An entity's, directory's or the repository's is reported by its area, with "" for
 * the repository. A trail's request returns null.
 */
function settledByState(request: { readonly state?: unknown; readonly questions: Readonly<Record<string, unknown>> }): { readonly by: "chosen" | "composed"; readonly file?: string; readonly area?: string } | null {
  const s = (request.state ?? {}) as Record<string, { path?: string; file?: string } | undefined>;
  const own = (path: string | undefined): string => (path === undefined || path.startsWith("(") ? "" : path);
  const by = Object.keys(request.questions).some((id) => /^[a-z]+\.(use|present)$/.test(id)) || (s as Record<string, unknown>).decided !== undefined ? "composed" : "chosen";
  if (s.file?.path !== undefined) return { by, file: s.file.path };
  if (s.definition?.file !== undefined) return { by, file: s.definition.file };
  if (s.entity !== undefined) return { by, area: own(s.entity.path) };
  if (s.directory !== undefined) return { by, area: own(s.directory.path) };
  if (s.repository !== undefined) return { by, area: "" };
  return null;
}

/** Returns the area a request made after the looks is about, from its state: a file's or definition's folder, an entity's or directory's own path, a trail's `from` end, or "" for the sky. */
function areaOfState(state: unknown): string {
  const s = (state ?? {}) as Record<string, { path?: string; file?: string; from?: { path?: string } } | undefined>;
  const folder = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const own = (path: string | undefined): string => (path === undefined || path.startsWith("(") ? "" : path);
  if (s.file?.path !== undefined) return folder(s.file.path);
  if (s.definition?.file !== undefined) return folder(s.definition.file);
  if (s.entity !== undefined) return own(s.entity.path);
  if (s.directory !== undefined) return own(s.directory.path);
  if (s.trail !== undefined) return own(s.trail.from?.path);
  return "";
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export async function openWorld({ engine, root, consent, progress }: OpenWorldOptions): Promise<WorldDocument> {
  progress({ stage: "reading", root });
  // Sends the land's area outlines, file patches and entity lots as soon as the graph exists. The graph includes every
  // definition, with any judgments already stored. `factsOf` derives the facts that the layout and the looks read.
  let judged = await engine.call("project.graph", { root, judged: true });
  let graph = judgedGraph(judged);
  let facts = factsOf(graph);
  const project = facts.projectId;
  const name = facts.repository.name;
  // A world is made of a codebase's files, so a folder with none has none to show.
  if (facts.files.length === 0) throw new Error(`${name} has no files Gaia can read, so there is no world to make from it.`);
  const land = landOf(facts, graph);
  progress({ stage: "land", name, size: land.size, ...(land.aspect === undefined ? {} : { aspect: land.aspect }), areas: outlinesOf(land).areas, patches: land.patches.map(({ path, name, area, x, z, radius }) => ({ path, name, area, x, z, radius })), lots: land.lots });
  // `understanding.plan` counts the understanding requests the world needs: the imports and calls only Jev can resolve,
  // and each definition's judgment. Planning takes seconds and only serves the cost estimate, so it runs only under a
  // finite spend limit. Otherwise the pass finds its requests as it goes.
  const limitUsd = await spendLimit(engine);
  const understanding = Number.isFinite(limitUsd) ? await engine.call("understanding.plan", { root }) : null;
  const planned = planWorldRequests(facts, LOOKS);
  const keys = planned.map((p) => requestKey(p.request));
  // Form requests depend on the importance the understanding pass judges, so `composeWorld` plans them again after the
  // pass. This early plan uses the stored judgments and only counts the missing requests for the estimate.
  const formRequests = planForms(facts, LOOKS, { graph }).requests;

  // A file's vitality is Jev's quality, so the renderer gets it once the understanding pass has judged the file.
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
  const missing = [...planned.filter((_, i) => !stored.has(keys[i] as string)), ...formRequests.filter((p) => !stored.has(requestKey(p.request)))];
  /** Pending understanding requests, or null when `understanding.plan` did not run. */
  const toUnderstand = understanding === null ? null : understanding.pending.reduce((n, p) => n + p.requests, 0);
  // Requests to send to Jev. The understanding share is planned before Jev resolves links, so the count is corrected to
  // the requests actually sent once the pass ends.
  let total = missing.length + (toUnderstand ?? 0);

  // `ask` is whether Jev gets the requests that have no stored answer, and `unasked` is the reason Jev cannot. A world
  // that needs an answer Jev cannot give fails with that reason instead of opening half judged.
  let ask = false;
  let unasked: string | undefined;
  /** Look requests in flight at once, matched to how many the engine sends Jev at once. */
  let concurrency = 1;
  const status = await engine.call("jev.status", {});
  if (!status.live) unasked = "Jev is off: start Gaia with GAIA_JEV=live to judge it";
  else if (!status.key) unasked = "set OPENROUTER_API_KEY before starting Gaia";
  // Without Jev, a world opens only if every answer is stored. With no spend limit the understanding pass has no plan
  // yet, so it is planned now to count what is missing.
  if (unasked !== undefined) {
    const pending = toUnderstand ?? (await engine.call("understanding.plan", { root })).pending.reduce((n, p) => n + p.requests, 0);
    if (missing.length + pending > 0) throw new Error(`Gaia could not judge ${name}: ${unasked}.`);
  }
  // Jev is available. Estimate the cost when answers are missing, or when the understanding pass has no plan and will
  // find its requests as it goes.
  if (unasked === undefined && (total > 0 || toUnderstand === null)) {
    const judging = missing.length > 0 ? await engine.call("jev.estimate", { requests: missing.map((p) => p.request) }) : undefined;
    concurrency = judging?.concurrency ?? understanding?.estimate.concurrency ?? (await engine.call("jev.estimate", { requests: [] })).concurrency;
    // The composing requests depend on Jev's form choices, so `composingEstimate` prices them at about two requests per
    // thing, each the size of a tree's composing request.
    const composing = missing.length > 0 ? composingEstimate(facts, LOOKS, graph) : null;
    const each = composing === null ? undefined : await engine.call("jev.estimate", { requests: [composing.sample] });
    const composed = { requests: composing?.requests ?? 0, estimatedTokens: (each?.estimatedTokens ?? 0) * (composing?.requests ?? 0), estimatedUsd: (each?.estimatedUsd ?? 0) * (composing?.requests ?? 0) };
    const estimate = {
      endpoint: judging?.endpoint ?? understanding?.estimate.endpoint ?? "",
      requests: (judging?.requests ?? 0) + (understanding?.estimate.requests ?? 0) + composed.requests,
      estimatedTokens: (judging?.estimatedTokens ?? 0) + (understanding?.estimate.estimatedTokens ?? 0) + composed.estimatedTokens,
      estimatedUsd: (judging?.estimatedUsd ?? 0) + (understanding?.estimate.estimatedUsd ?? 0) + composed.estimatedUsd,
    };
    console.log(
      understanding === null
        ? `gaia: ${name}: ${estimate.requests} looks to judge, about ${estimate.estimatedTokens} tokens, $${estimate.estimatedUsd.toFixed(4)}, and the understanding pass as it goes (no limit)`
        : `gaia: ${name}: ${estimate.requests} requests to judge, about ${estimate.estimatedTokens} tokens, $${estimate.estimatedUsd.toFixed(4)} (limit $${limitUsd})`,
    );
    // Above the spend limit, the person decides. Declining leaves the world unopened, and the next opening asks again.
    ask = estimate.estimatedUsd <= limitUsd || (await consent({ name, requests: estimate.requests, estimatedTokens: estimate.estimatedTokens, estimatedUsd: estimate.estimatedUsd, limitUsd, endpoint: estimate.endpoint }));
    if (!ask) throw new Error(`Gaia did not judge ${name}: judging it costs about $${estimate.estimatedUsd.toFixed(3)}, over your $${limitUsd} limit, and you chose not to go ahead.`);
  }

  // Jev's answers arrive in batches, and `keep` stores each batch in one `store.put`.
  let pending: { table: "answers"; key: string; value: unknown }[] = [];
  const writes: Promise<unknown>[] = [];
  /** What OpenRouter billed for this opening's answers. */
  let billed = 0;
  const keep = (key: string, response: JevResponse): void => {
    billed += Number.isFinite(response.costUsd) ? response.costUsd : 0;
    // A request asked again later in this opening, such as a look after Jev resolves links, reuses this answer.
    stored.set(key, response);
    if (pending.length === 0) {
      setTimeout(() => {
        writes.push(engine.call("store.put", { project, writes: pending }));
        pending = [];
      }, 0);
    }
    pending.push({ table: "answers", key, value: response });
  };

  let answered = 0;
  // An area is settled once every request about its files, its entity and itself is answered, and so is the request
  // for its region (`regionOf`). That region is the area itself or its nearest ancestor with land of its own.
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
  const regionsAnswered = new Set<string>();
  const settledAreas = (): string[] => [...unsettled].filter(([area, n]) => n === 0 && regionsAnswered.has(regionOf(area))).map(([area]) => area);
  /** Questions in flight, by the area they are about. */
  const inFlight = new Map<string, number>();
  const asking = (): void =>
    progress({ stage: "asking", name, total, answered, settled: settledAreas(), asking: [...inFlight].filter(([, n]) => n > 0).map(([area]) => area) });
  if (ask) asking();
  // Every answer comes from Jev, either stored or asked now.
  const kept = keptJev(ask ? engineJev(engine) : null, { stored, keep, ...(unasked === undefined ? {} : { unasked }) });
  // A request counts as settled once its answer arrives, stored or new. An area request's answer settles its region.
  const counted = new Set<string>();
  // Files and areas settled by form choices and composing. Each is sent once, batched into one `composed` message on
  // the next tick.
  const penciled = new Set<string>();
  let due: { chosen: { files: string[]; areas: string[] }; composed: { files: string[]; areas: string[] } } | null = null;
  const pencil = (settled: ReturnType<typeof settledByState>): void => {
    if (settled === null) return;
    const [list, path] = settled.file !== undefined ? (["files", settled.file] as const) : (["areas", settled.area ?? ""] as const);
    if (penciled.has(`${settled.by}:${list}:${path}`)) return;
    penciled.add(`${settled.by}:${list}:${path}`);
    if (due === null) {
      due = { chosen: { files: [], areas: [] }, composed: { files: [], areas: [] } };
      setTimeout(() => {
        if (due !== null) progress({ stage: "composed", ...due });
        due = null;
      }, 0);
    }
    due[settled.by][list].push(path);
  };
  const jev: JevClient = {
    async ask(request) {
      const key = requestKey(request);
      const p = plannedOf.get(key);
      // A request sent to Jev, not answered from the store, counts as in flight for its area until it returns. A
      // look's area comes from its plan, and a form or composing request's area from its state (`areaOfState`).
      // `fresh` is read before `keep` stores the answer.
      const fresh = ask && !stored.has(key);
      const out = fresh ? (p !== undefined ? areaOfRequest(p) : areaOfState(request.state)) : null;
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
        if (fresh) {
          answered++;
          asking();
        }
      } else if (p === undefined && !counted.has(key)) {
        // Form and composing requests come after the looks. Each new answer advances the count, and every answer, stored
        // or new, adds a pencil stroke over the code it settled, so the wait keeps drawing until the world is laid out.
        counted.add(key);
        if (fresh) {
          answered++;
          total = Math.max(total, answered);
          asking();
        }
        pencil(settledByState(request));
      }
      return response;
    },
  };
  // `engineJev` gathers each round of requests into one batch, and the engine serves one call at a time. Sending fewer
  // than `concurrency` looks at once only delays the looks and the area names they put on the map.
  let judgments = await judgeWorld(facts, LOOKS, jev, { concurrency });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(writes);

  // Runs the understanding pass one slice at a time until nothing is left. The layout uses the importance and quality
  // it produces. A request that still fails after the engine client's retries fails the world.
  if (ask && (toUnderstand ?? 1) > 0) {
    let understood = 0;
    for (;;) {
      const slice = await engine.call("understanding.next", { root });
      const failure = slice.failures[0];
      if (failure !== undefined || slice.failed > 0) throw new RequestFailed(`understanding ${failure?.unit ?? "part of the code"}`, failure?.error ?? `${plural(slice.failed, "request")} failed`);
      // Reports the files and areas this slice read, so the wait can show which code Jev just covered. Then it sends
      // each file the slice finished, at the quality the finished world shows.
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
    // The pass changes the graph only if it sent a request.
    if (understood > 0) {
      judged = await engine.call("project.graph", { root, judged: true });
      graph = judgedGraph(judged);
      // The pass first resolves the imports and calls that only Jev can, which changes a file's importers, an area's
      // imports and an entity's dependencies. From here on, the code reads the same facts a reopen reads, and the looks
      // are asked again on them. Stored answers cover the looks those links did not change, so only the changed ones
      // go to Jev. The land's division reads no imports, so the land the wait drew stays the same.
      facts = factsOf(graph);
      judgments = await judgeWorld(facts, LOOKS, jev, { concurrency });
    }
  }
  // `composeWorld` composes every building and landmark part by part after the understanding pass. Each request
  // includes what the pass found about its entity, so its stored answer is reused until that code changes.
  const composed = await composeWorld(facts, LOOKS, jev, judgments, { graph, concurrency });
  // Waits for the composing answers to be stored before returning the world, as for the looks.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(writes);

  // Counts the things Jev judged: every look target, file and entity. A file's form request also covers its
  // definitions.
  const things = new Set([...planned.map((p) => `${p.about}:${p.target}`), ...facts.files.map((f) => `file:${f.path}`), ...facts.entities.map((e) => `entity:${e.path}`)]).size;
  const parts = [`${plural(things, "thing")} judged by Jev`];
  if (billed > 0) parts.push(`$${billed.toFixed(4)} billed`);
  const world = layoutWorld(facts, composed, graph);
  // Sends the vitality of every file no answer covered, before the document.
  for (const p of world.patches) settleHealth(p.path, p.vitality);
  sendHealth();
  return { root, ...(judged.commit === undefined ? {} : { commit: judged.commit }), facts, world, summary: parts.join("; "), judged: judgedThings(judged) };
}

/**
 * Whether two layouts have the same land: the same size and aspect, and every area, patch and definition in the same
 * place. The division reads only the code, and a file's or folder's area changes it only when it crosses a rung, so
 * most commits leave the land unchanged.
 */
function sameLand(a: CodeWorld, b: CodeWorld): boolean {
  const shape = (w: CodeWorld): string =>
    JSON.stringify([w.size, w.aspect, w.areas.map((r) => [r.path, r.x, r.z]), w.patches.map((p) => [p.path, p.x, p.z, p.radius]), w.symbols.map((d) => [d.id, d.x, d.z])]);
  return shape(a) === shape(b);
}

/** Returns each definition whose lines in `b` differ from `a`, by id, with its lines in `b`. */
function linesMoved(a: CodeWorld, b: CodeWorld): Record<string, { line: number; lines: number }> {
  const was = new Map(a.symbols.map((s) => [s.id, s]));
  return Object.fromEntries(
    b.symbols.flatMap((s) => {
      const old = was.get(s.id);
      return old === undefined || (old.line === s.line && old.lines === s.lines) ? [] : [[s.id, { line: s.line, lines: s.lines }] as const];
    }),
  );
}

/**
 * Judges the `shown` world again from its folder's current commit, using `openWorld`. Stored answers cover everything
 * the commit left alone, so only changed code goes to Jev. Returns the `world.vitality` message for the page, and the
 * document as the page then shows it. The message is null when the land changed and no shown vitality did.
 *
 * Only vitality changes live. When `sameLand` holds, the message also moves the journal to the new commit, its
 * judgments and each definition's new lines. Otherwise each thing that keeps its id takes its new vitality, and the
 * new layout, code and judgments wait for the next open. Forms Jev picks for changed code are stored and appear only
 * on that open. A refresh never asks for consent mid-walk, so one that costs more than the spend limit fails, and the
 * next open asks.
 */
export async function refreshWorld(engine: EngineClient, shown: WorldDocument): Promise<{ readonly update: VitalityUpdate | null; readonly shown: WorldDocument }> {
  const next = await openWorld({ engine, root: shown.root, consent: async () => false, progress: () => {} });
  const now = vitalityOf(next.world);
  const vitality: Record<string, number> = {};
  for (const [id, was] of vitalityOf(shown.world)) {
    const v = now.get(id);
    if (v !== undefined && v !== was) vitality[id] = v;
  }
  const world = withVitality(shown.world, new Map(Object.entries(vitality)));
  if (!sameLand(shown.world, next.world)) return { update: Object.keys(vitality).length === 0 ? null : { type: "world.vitality", vitality }, shown: { ...shown, world } };
  const judged = Object.fromEntries(Object.entries(next.judged).filter(([of, j]) => JSON.stringify(j) !== JSON.stringify(shown.judged[of])));
  const commit = next.commit === undefined ? {} : { commit: next.commit };
  const moved = linesMoved(shown.world, next.world);
  const symbols = Object.keys(moved).length === 0 ? {} : { symbols: moved };
  return { update: { type: "world.vitality", vitality, judged, ...symbols, ...commit }, shown: { ...shown, world: withLines(world, moved), judged: next.judged, ...commit } };
}
