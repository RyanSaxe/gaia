// The codebase a page with no engine carries, as the world reads it: the
// facts derived from its judged graph, shared by the page and the thread that
// lays a snapshot out. It is the showcase's (`fixtures/showcase-graph.json`,
// written by `pnpm showcase`), with its old `v1/` as it is or fixed
// (`fixtures/showcase-fixed-graph.json`, written by `pnpm showcase --v1 fixed`).

import type { CodeGraph, CodeFacts } from "@gaia/schema";
import { factsOf } from "@gaia/world";
import showcaseFixedGraph from "./fixtures/showcase-fixed-graph.json";
import showcaseGraph from "./fixtures/showcase-graph.json";

/** Which carried codebase: the showcase's, with its `v1/` as it is or fixed. */
export type Snapshot = "showcase" | "showcase-fixed";

const GRAPHS: Readonly<Record<Snapshot, unknown>> = { showcase: showcaseGraph, "showcase-fixed": showcaseFixedGraph };

/** A snapshot's graph. */
export const snapshotGraphOf = (of: Snapshot): CodeGraph => GRAPHS[of] as CodeGraph;

/** A snapshot's code facts, read from its graph. */
export const snapshotFacts = (of: Snapshot): CodeFacts => factsOf(snapshotGraphOf(of));
