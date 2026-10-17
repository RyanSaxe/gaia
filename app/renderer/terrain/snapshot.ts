// A world from a bundled snapshot: the world of a page with no engine, and
// the showcase's everywhere. A snapshot is the engine's judged graph of a
// codebase (Gaia's own, `fixtures/gaia-graph.json`, written by `pnpm
// graph-snapshot`, or the showcase's, `fixtures/showcase-graph.json`, written
// by `pnpm showcase`), and the facts the world is laid out from are the
// graph's own (`factsOf`), as the app's world service lays it out. Jev's
// answers kept for it judge it (`fixtures/gaia-jev.json`,
// `fixtures/showcase-jev.json`), as the app's store would, and a request with
// no kept answer, such as one whose questions changed since Jev was asked,
// fails the page and names the request: nothing guesses. Only a developer's
// `?judge=stand-in` has the stand-in judge it. It is pure, so it runs on its
// own thread (layout-worker.ts) while the wait draws.

import type { JevResponse } from "@gaia/schema";
import { type CodeWorld, type Judge, composeWorld, judgeWorld, judgedThing, keptJev, layoutWorld, planWorldRequests, standInJev, thingsOf } from "@gaia/world";
import { type Snapshot, snapshotGraphOf, snapshotFacts } from "./snapshot-facts.ts";
import gaiaKept from "./fixtures/gaia-jev.json";
import showcaseFixedKept from "./fixtures/showcase-fixed-jev.json";
import showcaseKept from "./fixtures/showcase-jev.json";
import { LOOKS } from "./looks.ts";

/** Who judges the snapshot: Jev's kept answers, or, for development only, the stand-in alone. */
export type SnapshotJudge = "jev" | "stand-in";

/** Each snapshot's kept answers, and the command that keeps them. */
const KEPT: Readonly<Record<Snapshot, { readonly answers: unknown; readonly command: string }>> = {
  gaia: { answers: gaiaKept.answers, command: "pnpm jev-world" },
  showcase: { answers: showcaseKept.answers, command: "pnpm showcase --judge jev" },
  "showcase-fixed": { answers: showcaseFixedKept.answers, command: "pnpm showcase --judge jev --v1 fixed" },
};

/** A snapshot's world as laid out, who judged each thing, and how the judging went, in words; `why` says why the snapshot shows. */
export async function laySnapshot(judge: SnapshotJudge, why: string, of: Snapshot = "gaia"): Promise<{ world: CodeWorld; judges: Record<string, Judge>; summary: string }> {
  const facts = snapshotFacts(of);
  const stored = new Map(Object.entries(KEPT[of].answers as Record<string, JevResponse>));
  const jev = judge === "stand-in" ? standInJev(LOOKS) : keptJev(null, { stored, keep: () => undefined, unasked: `a page with no engine asks Jev nothing: run \`${KEPT[of].command}\` to keep its answer` });
  const graph = snapshotGraphOf(of);
  // Each request names the definitions the graph stands, so the answers kept for them meet the layout's.
  const world = layoutWorld(facts, await composeWorld(facts, LOOKS, jev, await judgeWorld(facts, LOOKS, jev, { graph }), { graph }), graph);
  // Jev judged the looks, and what every file and entity stands as (a definition's with its file's).
  const things = [...planWorldRequests(facts, LOOKS, { graph }).flatMap((p) => thingsOf(p)), ...facts.files.map((f) => ({ about: "file" as const, target: f.path })), ...facts.entities.map((e) => ({ about: "entity" as const, target: e.path }))];
  const judges: Record<string, Judge> = Object.fromEntries(things.map((t) => [judgedThing(t), judge] as const));
  const judgedCount = Object.keys(judges).length;
  const summary = judge === "stand-in" ? `${judgedCount} things judged by the stand-in (?judge=stand-in, for development; ${why})` : `${judgedCount} things judged by Jev, from answers kept for this snapshot (${why})`;
  return { world, judges, summary };
}
