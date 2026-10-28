// Lays out the showcase world from its bundled snapshot, with or without an
// engine. The snapshot is the engine's judged graph of a codebase
// (`fixtures/showcase-graph.json`, written by `pnpm showcase`), and Jev's
// saved answers judge it (`fixtures/showcase-jev.json`) as the app's store
// would. A request with no saved answer, such as one whose questions changed
// since Jev was asked, fails the page and names the request rather than
// guessing.

import type { JevResponse } from "@gaia/schema";
import { type CodeWorld, composeWorld, judgeWorld, keptJev, layoutWorld } from "@gaia/world";
import { type Snapshot, snapshotGraphOf, snapshotFacts } from "./snapshot-facts.ts";
import showcaseFixedKept from "./fixtures/showcase-fixed-jev.json";
import showcaseKept from "./fixtures/showcase-jev.json";
import { LOOKS } from "./looks.ts";

/** Each snapshot's saved answers, and the command that saves them. */
const KEPT: Readonly<Record<Snapshot, { readonly answers: unknown; readonly command: string }>> = {
  showcase: { answers: showcaseKept.answers, command: "pnpm showcase --judge jev" },
  "showcase-fixed": { answers: showcaseFixedKept.answers, command: "pnpm showcase --judge jev --v1 fixed" },
};

/** A snapshot's laid-out world and a summary of the judging. `why` gives the reason the snapshot shows. */
export async function laySnapshot(why: string, of: Snapshot): Promise<{ world: CodeWorld; summary: string }> {
  const facts = snapshotFacts(of);
  const stored = new Map(Object.entries(KEPT[of].answers as Record<string, JevResponse>));
  const jev = keptJev(null, { stored, keep: () => undefined, unasked: `a page with no engine asks Jev nothing: run \`${KEPT[of].command}\` to keep its answer` });
  const graph = snapshotGraphOf(of);
  // Each request names the definitions in the graph, so the saved answers match the layout's requests.
  const world = layoutWorld(facts, await composeWorld(facts, LOOKS, jev, await judgeWorld(facts, LOOKS, jev), { graph }), graph);
  // Jev judged each region's water and every file's and entity's form, with a file's definitions judged alongside it.
  const judged = world.regions.length + facts.files.length + facts.entities.length;
  return { world, summary: `${judged} things judged by Jev, from answers kept for this snapshot (${why})` };
}
