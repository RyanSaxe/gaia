// Gaia's own world from the bundled snapshot: the world of a page with no
// engine. Jev's answers kept for the snapshot judge it, as the app's store
// would; the stand-in judges whatever they do not answer, such as a request
// whose questions or options changed since Jev was asked. Engine's graph of
// the same commit (`fixtures/gaia-graph.json`, written by `pnpm
// graph-snapshot`) stands every definition, sized by its stand. It is pure,
// so it runs on its own thread (layout-worker.ts) while the wait draws.

import type { CodeGraph, CodeModel, JevResponse } from "@gaia/schema";
import { type CodeWorld, type Judge, judgeWorld, judgedThing, keptJev, layoutWorld, planWorldRequests, requestKey, standInJev, thingsOf } from "@gaia/world";
import snapshot from "./fixtures/gaia.json";
import snapshotGraph from "./fixtures/gaia-graph.json";
import kept from "./fixtures/gaia-jev.json";
import { LOOKS } from "./looks.ts";

/** Who judges the snapshot: Jev's kept answers, or the stand-in alone. */
export type SnapshotJudge = "jev" | "stand-in";

/** The snapshot's world as laid out, who judged each thing, and how the judging went, in words; `why` says why the snapshot shows. */
export async function laySnapshot(judge: SnapshotJudge, why: string): Promise<{ world: CodeWorld; judges: Record<string, Judge>; summary: string }> {
  const model = snapshot as unknown as CodeModel;
  const stored = new Map(judge === "jev" ? Object.entries((kept as { answers: Record<string, JevResponse> }).answers) : []);
  const byKey = new Map<string, Judge>();
  const jev = keptJev(null, standInJev(LOOKS), { stored, keep: () => undefined, settled: (key, j) => byKey.set(key, j) });
  const graph = snapshotGraph as unknown as CodeGraph;
  // Each request names the definitions the graph stands, so the answers kept for them meet the layout's.
  const world = layoutWorld(model, await judgeWorld(model, LOOKS, jev, { graph }), graph);
  const judges = Object.fromEntries(planWorldRequests(model, LOOKS, { graph }).flatMap((p) => thingsOf(p).map((t) => [judgedThing(t), byKey.get(requestKey(p.request)) ?? "stand-in"] as const)));
  const byJev = Object.values(judges).filter((j) => j === "jev").length;
  const summary = byJev === 0 ? `Every thing judged by the stand-in (${why})` : `${byJev} of ${Object.keys(judges).length} things judged by Jev, from answers kept for this snapshot (${why})`;
  return { world, judges, summary };
}
