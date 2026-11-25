// Opens a codebase's world: the engine reads the code, Jev answers every look
// and understanding request, and `layoutWorld` lays out the result. The land's
// division depends only on the code, so the renderer receives its outlines
// before any judging. Jev's answers are stored in the project's store by
// request hash, so a reopen asks Jev only about things whose facts changed.

import type {
  CodeFacts,
  CodeGraph,
  EngineClient,
  GraphNode,
  JevClient,
  JevRequest,
  JevResponse,
  Span,
  UnderstandPlan,
} from "@gaia/schema";
import { outlinesOf } from "@gaia/terrain";
import {
  type CodeWorld,
  RequestFailed,
  areaOfRequest,
  composeWorld,
  composingEstimate,
  factsOf,
  judgeWorld,
  keptJev,
  landOf,
  layoutWorld,
  planForms,
  planWorldRequests,
  requestKey,
  vitalityOf,
  withLines,
  withVitality,
} from "@gaia/world";
import { LOOKS } from "../renderer/terrain/looks.ts";
import { engineJev } from "./jev.ts";
import type {
  ConsentPlan,
  VitalityUpdate,
  JudgedThing,
  Opening,
  WorldDocument,
} from "./protocol.ts";

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
  const kept = (
    await engine.call("store.get", {
      project: APP_STORE,
      table: "settings",
      key: LIMIT_KEY,
    })
  )?.value as { usd?: unknown } | undefined;
  return typeof kept?.usd === "number" &&
    Number.isFinite(kept.usd) &&
    kept.usd >= 0
    ? kept.usd
    : DEFAULT_SPEND_LIMIT_USD;
}

/** Stores the spend limit, in US dollars. */
export async function setSpendLimit(
  engine: EngineClient,
  usd: number,
): Promise<void> {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error(`Not a spend limit: ${usd}`);
  }
  await engine.call("store.put", {
    project: APP_STORE,
    writes: [{ table: "settings", key: LIMIT_KEY, value: { usd } }],
  });
}

type JudgedValue = NonNullable<NonNullable<GraphNode["judged"]>["value"]>;

function judgedStand(
  n: GraphNode,
): { judged: { value: JudgedValue } } | Record<string, never> {
  return n.judged?.value === undefined
    ? {}
    : { judged: { value: n.judged.value } };
}

function keepLayoutEdge(e: CodeGraph["edges"][number]): boolean {
  return (
    e.kind === "imports" ||
    ((e.kind === "calls" || e.kind === "references") && e.to.startsWith("def:"))
  );
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
            ...judgedStand(n),
          },
        ];
      case "dir":
      case "file": {
        const { judged: _, ...rest } = n;
        return [{ ...rest, ...judgedStand(n) }];
      }
      default:
        return n satisfies never;
    }
  });
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter(keepLayoutEdge),
    pending: [],
  };
}

function picksOf(
  n: GraphNode,
  spans: ReadonlyMap<string, Span>,
): { key?: Span; weak?: Span } {
  const picks: { key?: Span; weak?: Span } = {};
  for (const pick of ["key", "weak"] as const) {
    const span = spans.get(n.judged?.picks?.[pick]?.choice ?? "");
    if (span !== undefined) picks[pick] = span;
  }
  return picks;
}

/**
 * Returns the understanding pass's judgment of every folder, file and
 * definition for `WorldDocument.judged`. Keys are paths, or
 * `<path>#<qualified name>` for a definition. Blocks Jev picked are line spans.
 */
export function judgedThings(graph: CodeGraph): Record<string, JudgedThing> {
  const spans = new Map(
    graph.nodes.flatMap((n) =>
      n.kind === "block" ? [[n.id, n.span] as const] : [],
    ),
  );
  const pathOf = new Map(
    graph.nodes.flatMap((n) =>
      n.kind === "file" ? [[n.id, n.path] as const] : [],
    ),
  );
  const out: Record<string, JudgedThing> = {};
  for (const n of graph.nodes) {
    if (n.kind === "block" || n.judged?.value === undefined) continue;
    const value = n.judged.value;
    const key =
      n.kind === "def"
        ? `${pathOf.get(n.file) ?? ""}#${n.id.slice(n.id.indexOf("#") + 1)}`
        : n.path;
    out[key] = {
      quality: value.quality,
      importance: value.importance,
      concepts: value.concepts,
      picks: picksOf(n, spans),
    };
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

function ownPath(path: string | undefined): string {
  return path === undefined || path.startsWith("(") ? "" : path;
}

function folderOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

type StateEntries = Record<
  string,
  { path?: string; file?: string; from?: { path?: string } } | undefined
>;

function settledTarget(
  s: StateEntries,
): { readonly file?: string; readonly area?: string } | null {
  if (s.file?.path !== undefined) return { file: s.file.path };
  if (s.definition?.file !== undefined) return { file: s.definition.file };
  if (s.entity !== undefined) return { area: ownPath(s.entity.path) };
  if (s.directory !== undefined) return { area: ownPath(s.directory.path) };
  if (s.repository !== undefined) return { area: "" };
  return null;
}

/**
 * Returns what a request made after the looks settles, from its state, for the wait's pencil strokes. A request is
 * `composed` when it composes a blueprint and `chosen` when it picks forms (`planForms`). A file's or definition's
 * request is reported by its file. An entity's, directory's or the repository's is reported by its area, with "" for
 * the repository. A trail's request returns null.
 */
function settledByState(request: {
  readonly state?: unknown;
  readonly questions: Readonly<Record<string, unknown>>;
}): {
  readonly by: "chosen" | "composed";
  readonly file?: string;
  readonly area?: string;
} | null {
  const s = (request.state ?? {}) as StateEntries;
  const target = settledTarget(s);
  if (target === null) return null;
  const isComposed =
    Object.keys(request.questions).some((id) =>
      /^[a-z]+\.(use|present)$/.test(id),
    ) || (s as Record<string, unknown>).decided !== undefined;
  return { by: isComposed ? "composed" : "chosen", ...target };
}

/** Returns the area a request made after the looks is about, from its state: a file's or definition's folder, an entity's or directory's own path, a trail's `from` end, or "" for the sky. */
function areaOfState(state: unknown): string {
  const s = (state ?? {}) as StateEntries;
  if (s.file?.path !== undefined) return folderOf(s.file.path);
  if (s.definition?.file !== undefined) return folderOf(s.definition.file);
  if (s.entity !== undefined) return ownPath(s.entity.path);
  if (s.directory !== undefined) return ownPath(s.directory.path);
  if (s.trail !== undefined) return ownPath(s.trail.from?.path);
  return "";
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

type LandLayout = ReturnType<typeof landOf>;
type PlannedRequest = ReturnType<typeof planWorldRequests>[number];

function emitLand(
  land: LandLayout,
  name: string,
  progress: (opening: Opening) => void,
): void {
  progress({
    stage: "land",
    name,
    size: land.size,
    ...(land.aspect === undefined ? {} : { aspect: land.aspect }),
    areas: outlinesOf(land).areas,
    patches: land.patches.map(
      ({ path, name: patchName, area, x, z, radius }) => ({
        path,
        name: patchName,
        area,
        x,
        z,
        radius,
      }),
    ),
    lots: land.lots,
  });
}

function createHealthEmitter(
  land: LandLayout,
  progress: (opening: Opening) => void,
): {
  settle(path: string, vitality: number): void;
  flush(): void;
} {
  const unsent = new Set(land.patches.map((p) => p.path));
  let settled: Record<string, number> = {};
  return {
    settle(path, vitality): void {
      if (!unsent.delete(path)) return;
      settled[path] = vitality;
    },
    flush(): void {
      if (Object.keys(settled).length > 0) {
        progress({ stage: "health", vitality: settled });
      }
      settled = {};
    },
  };
}

async function unavailableReason(
  engine: EngineClient,
  root: string,
  name: string,
  missingCount: number,
  toUnderstand: number | null,
): Promise<string | undefined> {
  const status = await engine.call("jev.status", {});
  let unasked: string | undefined;
  if (!status.live) {
    unasked = "Jev is off: start Gaia with GAIA_JEV=live to judge it";
  } else if (!status.key) {
    unasked = "set OPENROUTER_API_KEY before starting Gaia";
  }
  if (unasked === undefined) return undefined;
  // Without Jev, a world opens only if every answer is stored. With no spend limit the understanding pass has no plan
  // yet, so it is planned now to count what is missing.
  const pending =
    toUnderstand ??
    (await engine.call("understanding.plan", { root })).pending.reduce(
      (n, p) => n + p.requests,
      0,
    );
  if (missingCount + pending > 0) {
    throw new Error(`Gaia could not judge ${name}: ${unasked}.`);
  }
  return unasked;
}

interface CostEstimate {
  endpoint: string;
  requests: number;
  estimatedTokens: number;
  estimatedUsd: number;
}

function sumEstimate(
  judging: CostEstimate | undefined,
  understanding: CostEstimate | undefined,
  each: CostEstimate | undefined,
  composingCount: number,
): CostEstimate {
  const zero: CostEstimate = {
    endpoint: "",
    requests: 0,
    estimatedTokens: 0,
    estimatedUsd: 0,
  };
  const j = judging ?? zero;
  const u = understanding ?? zero;
  const e = each ?? zero;
  return {
    endpoint: j.endpoint || u.endpoint,
    requests: j.requests + u.requests + composingCount,
    estimatedTokens:
      j.estimatedTokens +
      u.estimatedTokens +
      e.estimatedTokens * composingCount,
    estimatedUsd:
      j.estimatedUsd + u.estimatedUsd + e.estimatedUsd * composingCount,
  };
}

async function resolveConcurrency(
  engine: EngineClient,
  judging: { readonly concurrency: number } | undefined,
  understanding: UnderstandPlan | null,
): Promise<number> {
  if (judging !== undefined) return judging.concurrency;
  if (understanding !== null) return understanding.estimate.concurrency;
  return (await engine.call("jev.estimate", { requests: [] })).concurrency;
}

interface EstimateInput {
  engine: EngineClient;
  understanding: UnderstandPlan | null;
  missing: readonly { readonly request: JevRequest }[];
  facts: CodeFacts;
  graph: CodeGraph;
}

interface ConsentInput extends EstimateInput {
  name: string;
  limitUsd: number;
  consent: (plan: ConsentPlan) => Promise<boolean>;
}

async function computeEstimate(
  opts: EstimateInput,
): Promise<{ estimate: CostEstimate; concurrency: number }> {
  const { engine, understanding, missing, facts, graph } = opts;
  const judging =
    missing.length > 0
      ? await engine.call("jev.estimate", {
          requests: missing.map((p) => p.request),
        })
      : undefined;
  const concurrency = await resolveConcurrency(engine, judging, understanding);
  // The composing requests depend on Jev's form choices, so `composingEstimate` prices them at about two requests per
  // thing, each the size of a tree's composing request.
  const composing =
    missing.length > 0 ? composingEstimate(facts, LOOKS, graph) : null;
  const each =
    composing === null
      ? undefined
      : await engine.call("jev.estimate", { requests: [composing.sample] });
  const estimate = sumEstimate(
    judging,
    understanding?.estimate,
    each,
    composing?.requests ?? 0,
  );
  return { estimate, concurrency };
}

async function estimateAndConsent(
  opts: ConsentInput,
): Promise<{ ask: boolean; concurrency: number }> {
  const { name, limitUsd, understanding, consent } = opts;
  const { estimate, concurrency } = await computeEstimate(opts);
  console.log(
    understanding === null
      ? `gaia: ${name}: ${estimate.requests} looks to judge, about ${estimate.estimatedTokens} tokens, $${estimate.estimatedUsd.toFixed(4)}, and the understanding pass as it goes (no limit)`
      : `gaia: ${name}: ${estimate.requests} requests to judge, about ${estimate.estimatedTokens} tokens, $${estimate.estimatedUsd.toFixed(4)} (limit $${limitUsd})`,
  );
  // Above the spend limit, the person decides. Declining leaves the world unopened, and the next opening asks again.
  const approved =
    estimate.estimatedUsd <= limitUsd ||
    (await consent({
      name,
      requests: estimate.requests,
      estimatedTokens: estimate.estimatedTokens,
      estimatedUsd: estimate.estimatedUsd,
      limitUsd,
      endpoint: estimate.endpoint,
    }));
  if (!approved) {
    throw new Error(
      `Gaia did not judge ${name}: judging it costs about $${estimate.estimatedUsd.toFixed(3)}, over your $${limitUsd} limit, and you chose not to go ahead.`,
    );
  }
  return { ask: true, concurrency };
}

function createAnswerStore(
  engine: EngineClient,
  project: string,
  stored: Map<string, JevResponse>,
): {
  keep(key: string, response: JevResponse): void;
  flush(): Promise<void>;
  billed(): number;
} {
  let pending: { table: "answers"; key: string; value: unknown }[] = [];
  const writes: Promise<unknown>[] = [];
  let billed = 0;
  return {
    keep(key, response): void {
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
    },
    async flush(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.all(writes);
    },
    billed: (): number => billed,
  };
}

function createPencilBatcher(
  progress: (opening: Opening) => void,
): (settled: ReturnType<typeof settledByState>) => void {
  const penciled = new Set<string>();
  let due: {
    chosen: { files: string[]; areas: string[] };
    composed: { files: string[]; areas: string[] };
  } | null = null;
  return (settled): void => {
    if (settled === null) return;
    const [list, path] =
      settled.file === undefined
        ? (["areas", settled.area ?? ""] as const)
        : (["files", settled.file] as const);
    if (penciled.has(`${settled.by}:${list}:${path}`)) return;
    penciled.add(`${settled.by}:${list}:${path}`);
    if (due === null) {
      due = {
        chosen: { files: [], areas: [] },
        composed: { files: [], areas: [] },
      };
      setTimeout(() => {
        if (due !== null) progress({ stage: "composed", ...due });
        due = null;
      }, 0);
    }
    due[settled.by][list].push(path);
  };
}

function buildPlannedIndex(
  land: LandLayout,
  planned: readonly PlannedRequest[],
  keys: readonly string[],
): {
  unsettled: Map<string, number>;
  plannedOf: Map<string, PlannedRequest>;
  regionOf: (area: string) => string;
} {
  const unsettled = new Map<string, number>(land.areas.map((a) => [a.path, 0]));
  const plannedOf = new Map<string, PlannedRequest>();
  for (const [i, p] of planned.entries()) {
    const key = keys[i] as string;
    if (plannedOf.has(key)) continue;
    plannedOf.set(key, p);
    const area = areaOfRequest(p);
    unsettled.set(area, (unsettled.get(area) ?? 0) + 1);
  }
  const regions = new Set(
    planned.filter((p) => p.about === "area").map((p) => p.target),
  );
  const regionOf = (area: string): string => {
    for (
      let p = area;
      p !== "";
      p = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""
    ) {
      if (regions.has(p)) return p;
    }
    return "";
  };
  return { unsettled, plannedOf, regionOf };
}

function createTrackedJev(opts: {
  land: LandLayout;
  planned: readonly PlannedRequest[];
  keys: readonly string[];
  name: string;
  initialTotal: number;
  ask: boolean;
  unasked: string | undefined;
  stored: Map<string, JevResponse>;
  keep: (key: string, response: JevResponse) => void;
  engine: EngineClient;
  progress: (opening: Opening) => void;
}): {
  jev: JevClient;
  reportAsking(): void;
  addAnswered(count: number): void;
  setTotal(next: number): void;
} {
  const {
    land,
    planned,
    keys,
    name,
    ask,
    unasked,
    stored,
    keep,
    engine,
    progress,
  } = opts;
  let total = opts.initialTotal;
  let answered = 0;
  const { unsettled, plannedOf, regionOf } = buildPlannedIndex(
    land,
    planned,
    keys,
  );
  const regionsAnswered = new Set<string>();
  const inFlight = new Map<string, number>();
  const reportAsking = (): void => {
    const settled = [...unsettled]
      .filter(([area, n]) => n === 0 && regionsAnswered.has(regionOf(area)))
      .map(([area]) => area);
    progress({
      stage: "asking",
      name,
      total,
      answered,
      settled,
      asking: [...inFlight].filter(([, n]) => n > 0).map(([area]) => area),
    });
  };
  const kept = keptJev(ask ? engineJev(engine) : null, {
    stored,
    keep,
    ...(unasked === undefined ? {} : { unasked }),
  });
  const counted = new Set<string>();
  const pencil = createPencilBatcher(progress);
  const recordSettled = (
    key: string,
    p: PlannedRequest | undefined,
    fresh: boolean,
    request: JevRequest,
  ): void => {
    if (counted.has(key)) return;
    counted.add(key);
    if (p !== undefined) {
      const area = areaOfRequest(p);
      unsettled.set(area, (unsettled.get(area) ?? 1) - 1);
      if (p.about === "area") regionsAnswered.add(p.target);
      if (fresh) {
        answered++;
        reportAsking();
      }
      return;
    }
    // Form and composing requests come after the looks. Each new answer advances the count, and every answer, stored
    // or new, adds a pencil stroke over the code it settled, so the wait keeps drawing until the world is laid out.
    if (fresh) {
      answered++;
      total = Math.max(total, answered);
      reportAsking();
    }
    pencil(settledByState(request));
  };
  const jev: JevClient = {
    async ask(request): Promise<JevResponse> {
      const key = requestKey(request);
      const p = plannedOf.get(key);
      // A request sent to Jev, not answered from the store, counts as in flight for its area until it returns. A
      // look's area comes from its plan, and a form or composing request's area from its state (`areaOfState`).
      // `fresh` is read before `keep` stores the answer.
      const fresh = ask && !stored.has(key);
      let out: string | null = null;
      if (fresh) {
        out = p === undefined ? areaOfState(request.state) : areaOfRequest(p);
        inFlight.set(out, (inFlight.get(out) ?? 0) + 1);
        reportAsking();
      }
      const response = await kept.ask(request).finally(() => {
        if (out !== null) inFlight.set(out, (inFlight.get(out) ?? 1) - 1);
      });
      recordSettled(key, p, fresh, request);
      return response;
    },
  };
  return {
    jev,
    reportAsking,
    addAnswered(count): void {
      answered += count;
      total = Math.max(total, answered);
    },
    setTotal(next): void {
      total = next;
    },
  };
}

function assertSliceOk(slice: {
  readonly failed: number;
  readonly failures: readonly {
    readonly unit: string;
    readonly error: string;
  }[];
}): void {
  const failure = slice.failures[0];
  if (failure !== undefined || slice.failed > 0) {
    throw new RequestFailed(
      `understanding ${failure?.unit ?? "part of the code"}`,
      failure?.error ?? `${plural(slice.failed, "request")} failed`,
    );
  }
}

function reportSettledSlice(
  settled: readonly string[],
  progress: (opening: Opening) => void,
): void {
  const files = settled.flatMap((id) =>
    id.startsWith("file:") ? [id.slice(5)] : [],
  );
  const areas = settled.flatMap((id) =>
    id.startsWith("dir:") ? [id.slice(4)] : [],
  );
  if (files.length > 0 || areas.length > 0) {
    progress({ stage: "understood", files, areas });
  }
}

async function runUnderstandingPass(opts: {
  engine: EngineClient;
  root: string;
  progress: (opening: Opening) => void;
  health: ReturnType<typeof createHealthEmitter>;
  tracker: ReturnType<typeof createTrackedJev>;
}): Promise<number> {
  const { engine, root, progress, health, tracker } = opts;
  let understood = 0;
  for (;;) {
    const slice = await engine.call("understanding.next", { root });
    assertSliceOk(slice);
    // Reports the files and areas this slice read, so the wait can show which code Jev just covered. Then it sends
    // each file the slice finished, at the quality the finished world shows.
    reportSettledSlice(slice.settled, progress);
    for (const [path, quality] of Object.entries(slice.quality)) {
      health.settle(path, quality);
    }
    health.flush();
    understood += slice.sent;
    tracker.addAnswered(slice.sent);
    if (slice.left === 0 || (slice.sent === 0 && slice.settled.length === 0)) {
      break;
    }
    tracker.reportAsking();
  }
  return understood;
}

function summarizeJudged(
  planned: readonly PlannedRequest[],
  facts: CodeFacts,
  billed: number,
): string {
  const things = new Set([
    ...planned.map((p) => `${p.about}:${p.target}`),
    ...facts.files.map((f) => `file:${f.path}`),
    ...facts.entities.map((e) => `entity:${e.path}`),
  ]).size;
  const parts = [`${plural(things, "thing")} judged by Jev`];
  if (billed > 0) parts.push(`$${billed.toFixed(4)} billed`);
  return parts.join("; ");
}

async function resolveOpenAccess(
  opts: ConsentInput & {
    root: string;
    toUnderstand: number | null;
    initialTotal: number;
  },
): Promise<{
  ask: boolean;
  unasked: string | undefined;
  concurrency: number;
}> {
  const unasked = await unavailableReason(
    opts.engine,
    opts.root,
    opts.name,
    opts.missing.length,
    opts.toUnderstand,
  );
  if (
    unasked !== undefined ||
    (opts.initialTotal === 0 && opts.toUnderstand !== null)
  ) {
    return { ask: false, unasked, concurrency: 1 };
  }
  const { ask, concurrency } = await estimateAndConsent(opts);
  return { ask, unasked, concurrency };
}

async function readPendingPlan(
  engine: EngineClient,
  root: string,
  project: string,
  facts: CodeFacts,
  graph: CodeGraph,
): Promise<{
  limitUsd: number;
  understanding: UnderstandPlan | null;
  planned: PlannedRequest[];
  keys: string[];
  stored: Map<string, JevResponse>;
  missing: { readonly request: JevRequest }[];
  toUnderstand: number | null;
  initialTotal: number;
}> {
  // `understanding.plan` counts the understanding requests the world needs: the imports and calls only Jev can resolve,
  // and each definition's judgment. Planning takes seconds and only serves the cost estimate, so it runs only under a
  // finite spend limit. Otherwise the pass finds its requests as it goes.
  const limitUsd = await spendLimit(engine);
  const understanding = Number.isFinite(limitUsd)
    ? await engine.call("understanding.plan", { root })
    : null;
  const planned = planWorldRequests(facts, LOOKS);
  const keys = planned.map((p) => requestKey(p.request));
  // Form requests depend on the importance the understanding pass judges, so `composeWorld` plans them again after the
  // pass. This early plan uses the stored judgments and only counts the missing requests for the estimate.
  const formRequests = planForms(facts, LOOKS, { graph }).requests;
  const { records } = await engine.call("store.read", {
    project,
    table: "answers",
  });
  const stored = new Map(
    Object.entries(records as Record<string, JevResponse>),
  );
  const missing = [
    ...planned.filter((_, i) => !stored.has(keys[i] as string)),
    ...formRequests.filter((p) => !stored.has(requestKey(p.request))),
  ];
  const toUnderstand =
    understanding === null
      ? null
      : understanding.pending.reduce((n, p) => n + p.requests, 0);
  return {
    limitUsd,
    understanding,
    planned,
    keys,
    stored,
    missing,
    toUnderstand,
    initialTotal: missing.length + (toUnderstand ?? 0),
  };
}

export async function openWorld({
  engine,
  root,
  consent,
  progress,
}: OpenWorldOptions): Promise<WorldDocument> {
  progress({ stage: "reading", root });
  // Sends the land's area outlines, file patches and entity lots as soon as the graph exists. The graph includes every
  // definition, with any judgments already stored. `factsOf` derives the facts that the layout and the looks read.
  let judged = await engine.call("project.graph", { root, judged: true });
  let graph = judgedGraph(judged);
  let facts = factsOf(graph);
  const project = facts.projectId;
  const name = facts.repository.name;
  // A world is made of a codebase's files, so a folder with none has none to show.
  if (facts.files.length === 0) {
    throw new Error(
      `${name} has no files Gaia can read, so there is no world to make from it.`,
    );
  }
  const land = landOf(facts, graph);
  emitLand(land, name, progress);
  const health = createHealthEmitter(land, progress);
  const plan = await readPendingPlan(engine, root, project, facts, graph);
  const { ask, unasked, concurrency } = await resolveOpenAccess({
    engine,
    root,
    name,
    ...plan,
    facts,
    graph,
    consent,
  });

  const answerStore = createAnswerStore(engine, project, plan.stored);
  const tracker = createTrackedJev({
    land,
    planned: plan.planned,
    keys: plan.keys,
    name,
    initialTotal: plan.initialTotal,
    ask,
    unasked,
    stored: plan.stored,
    keep: (key, response) => answerStore.keep(key, response),
    engine,
    progress,
  });
  if (ask) tracker.reportAsking();
  // `engineJev` gathers each round of requests into one batch, and the engine serves one call at a time. Sending fewer
  // than `concurrency` looks at once only delays the looks and the area names they put on the map.
  let judgments = await judgeWorld(facts, LOOKS, tracker.jev, { concurrency });
  await answerStore.flush();

  // Runs the understanding pass one slice at a time until nothing is left. The layout uses the importance and quality
  // it produces. A request that still fails after the engine client's retries fails the world.
  if (ask && (plan.toUnderstand ?? 1) > 0) {
    const understood = await runUnderstandingPass({
      engine,
      root,
      progress,
      health,
      tracker,
    });
    tracker.setTotal(plan.missing.length + understood);
    tracker.reportAsking();
    // The pass changes the graph only if it sent a request.
    if (understood > 0) {
      judged = await engine.call("project.graph", { root, judged: true });
      graph = judgedGraph(judged);
      // The pass first resolves the imports and calls that only Jev can, which changes a file's importers, an area's
      // imports and an entity's dependencies. From here on, the code reads the same facts a reopen reads, and the looks
      // are asked again on them. Stored answers cover the looks those links did not change, so only the changed ones
      // go to Jev. The land's division reads no imports, so the land the wait drew stays the same.
      facts = factsOf(graph);
      judgments = await judgeWorld(facts, LOOKS, tracker.jev, { concurrency });
    }
  }
  // `composeWorld` composes every building and landmark part by part after the understanding pass. Each request
  // includes what the pass found about its entity, so its stored answer is reused until that code changes.
  const composed = await composeWorld(facts, LOOKS, tracker.jev, judgments, {
    graph,
    concurrency,
  });
  await answerStore.flush();

  const world = layoutWorld(facts, composed, graph);
  // Sends the vitality of every file no answer covered, before the document.
  for (const p of world.patches) health.settle(p.path, p.vitality);
  health.flush();
  return {
    root,
    ...(judged.commit === undefined ? {} : { commit: judged.commit }),
    facts,
    world,
    summary: summarizeJudged(plan.planned, facts, answerStore.billed()),
    judged: judgedThings(judged),
  };
}

function landShape(w: CodeWorld): string {
  return JSON.stringify([
    w.size,
    w.aspect,
    w.areas.map((r) => [r.path, r.x, r.z]),
    w.patches.map((p) => [p.path, p.x, p.z, p.radius]),
    w.symbols.map((d) => [d.id, d.x, d.z]),
  ]);
}

/**
 * Whether two layouts have the same land: the same size and aspect, and every area, patch and definition in the same
 * place. The division reads only the code, and a file's or folder's area changes it only when it crosses a rung, so
 * most commits leave the land unchanged.
 */
function sameLand(a: CodeWorld, b: CodeWorld): boolean {
  return landShape(a) === landShape(b);
}

/** Returns each definition whose lines in `b` differ from `a`, by id, with its lines in `b`. */
function linesMoved(
  a: CodeWorld,
  b: CodeWorld,
): Record<string, { line: number; lines: number }> {
  const was = new Map(a.symbols.map((s) => [s.id, s]));
  return Object.fromEntries(
    b.symbols.flatMap((s) => {
      const old = was.get(s.id);
      return old === undefined || (old.line === s.line && old.lines === s.lines)
        ? []
        : [[s.id, { line: s.line, lines: s.lines }] as const];
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
export async function refreshWorld(
  engine: EngineClient,
  shown: WorldDocument,
): Promise<{
  readonly update: VitalityUpdate | null;
  readonly shown: WorldDocument;
}> {
  const next = await openWorld({
    engine,
    root: shown.root,
    consent: async () => false,
    progress: () => {},
  });
  const now = vitalityOf(next.world);
  const vitality: Record<string, number> = {};
  for (const [id, was] of vitalityOf(shown.world)) {
    const v = now.get(id);
    if (v !== undefined && v !== was) vitality[id] = v;
  }
  const world = withVitality(shown.world, new Map(Object.entries(vitality)));
  if (!sameLand(shown.world, next.world)) {
    return {
      update:
        Object.keys(vitality).length === 0
          ? null
          : { type: "world.vitality", vitality },
      shown: { ...shown, world },
    };
  }
  const judged = Object.fromEntries(
    Object.entries(next.judged).filter(
      ([of, j]) => JSON.stringify(j) !== JSON.stringify(shown.judged[of]),
    ),
  );
  const commit = next.commit === undefined ? {} : { commit: next.commit };
  const moved = linesMoved(shown.world, next.world);
  const symbols = Object.keys(moved).length === 0 ? {} : { symbols: moved };
  return {
    update: { type: "world.vitality", vitality, judged, ...symbols, ...commit },
    shown: {
      ...shown,
      world: withLines(world, moved),
      judged: next.judged,
      ...commit,
    },
  };
}
