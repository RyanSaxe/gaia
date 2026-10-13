// Gaia's own world from the bundled snapshot: the world of a page with no
// engine. The snapshot is the engine's graph of Gaia (`fixtures/gaia-graph.json`,
// written by `pnpm graph-snapshot`), and the facts the world is laid out from
// are the graph's own (`factsOf`), as the app's world service lays it out.
// Jev's answers kept for it judge it (`fixtures/gaia-jev.json`), as the app's
// store would, and a request with no kept answer, such as one whose questions
// changed since Jev was asked, fails the page and names the request: nothing
// guesses. Only a developer's `?judge=stand-in` has the stand-in judge it. It
// is pure, so it runs on its own thread (layout-worker.ts) while the wait draws.

import type { JevResponse } from "@gaia/schema";
import { type CodeWorld, type Judge, composeWorld, judgeWorld, judgedThing, keptJev, layoutWorld, planWorldRequests, standInJev, thingsOf } from "@gaia/world";
import { snapshotGraphOf, snapshotFacts } from "./snapshot-facts.ts";
import kept from "./fixtures/gaia-jev.json";
import { LOOKS } from "./looks.ts";

/** Who judges the snapshot: Jev's kept answers, or, for development only, the stand-in alone. */
export type SnapshotJudge = "jev" | "stand-in";

/** The snapshot's world as laid out, who judged each thing, and how the judging went, in words; `why` says why the snapshot shows. */
export async function laySnapshot(judge: SnapshotJudge, why: string): Promise<{ world: CodeWorld; judges: Record<string, Judge>; summary: string }> {
  const facts = snapshotFacts();
  const stored = new Map(Object.entries((kept as { answers: Record<string, JevResponse> }).answers));
  const jev = judge === "stand-in" ? standInJev(LOOKS) : keptJev(null, { stored, keep: () => undefined, unasked: "a page with no engine asks Jev nothing: run `pnpm jev-world` to keep its answer" });
  const graph = snapshotGraphOf();
  // Each request names the definitions the graph stands, so the answers kept for them meet the layout's.
  const world = layoutWorld(facts, await composeWorld(facts, LOOKS, jev, await judgeWorld(facts, LOOKS, jev, { graph }), { graph }), graph);
  const judges: Record<string, Judge> = Object.fromEntries(planWorldRequests(facts, LOOKS, { graph }).flatMap((p) => thingsOf(p).map((t) => [judgedThing(t), judge] as const)));
  const things = Object.keys(judges).length;
  const summary = judge === "stand-in" ? `${things} things judged by the stand-in (?judge=stand-in, for development; ${why})` : `${things} things judged by Jev, from answers kept for this snapshot (${why})`;
  return { world, judges, summary };
}
