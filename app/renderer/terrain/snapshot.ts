// A world from a bundled snapshot: the world of a page with no engine, and
// the showcase's everywhere. A snapshot is the engine's judged graph of a
// codebase (Gaia's own, `fixtures/gaia-graph.json`, written by `pnpm
// graph-snapshot`, or the showcase's, `fixtures/showcase-graph.json`, written
// by `pnpm showcase`), and the facts the world is laid out from are the
// graph's own (`factsOf`), as the app's world service lays it out. Jev's
// answers kept for it judge it (`fixtures/gaia-jev.json`,
// `fixtures/showcase-jev.json`), as the app's store would, and a request with
// no kept answer, such as one whose questions changed since Jev was asked,
// fails the page and names the request: nothing guesses. It is pure, so it
// runs on its own thread (layout-worker.ts) while the wait draws.

import type { JevResponse } from "@gaia/schema";
import { type CodeWorld, composeWorld, judgeWorld, keptJev, layoutWorld } from "@gaia/world";
import { type Snapshot, snapshotGraphOf, snapshotFacts } from "./snapshot-facts.ts";
import gaiaKept from "./fixtures/gaia-jev.json";
import showcaseFixedKept from "./fixtures/showcase-fixed-jev.json";
import showcaseKept from "./fixtures/showcase-jev.json";
import { LOOKS } from "./looks.ts";

/** Each snapshot's kept answers, and the command that keeps them. */
const KEPT: Readonly<Record<Snapshot, { readonly answers: unknown; readonly command: string }>> = {
  gaia: { answers: gaiaKept.answers, command: "pnpm jev-world" },
  showcase: { answers: showcaseKept.answers, command: "pnpm showcase --judge jev" },
  "showcase-fixed": { answers: showcaseFixedKept.answers, command: "pnpm showcase --judge jev --v1 fixed" },
};

/** A snapshot's world as laid out, and how the judging went, in words; `why` says why the snapshot shows. */
export async function laySnapshot(why: string, of: Snapshot = "gaia"): Promise<{ world: CodeWorld; summary: string }> {
  const facts = snapshotFacts(of);
  const stored = new Map(Object.entries(KEPT[of].answers as Record<string, JevResponse>));
  const jev = keptJev(null, { stored, keep: () => undefined, unasked: `a page with no engine asks Jev nothing: run \`${KEPT[of].command}\` to keep its answer` });
  const graph = snapshotGraphOf(of);
  // Each request names the definitions the graph stands, so the answers kept for them meet the layout's.
  const world = layoutWorld(facts, await composeWorld(facts, LOOKS, jev, await judgeWorld(facts, LOOKS, jev), { graph }), graph);
  // Jev judged each region's water, and what every file and entity stands as (a definition's with its file's).
  const judged = world.regions.length + facts.files.length + facts.entities.length;
  return { world, summary: `${judged} things judged by Jev, from answers kept for this snapshot (${why})` };
}
