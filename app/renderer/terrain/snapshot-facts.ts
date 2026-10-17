// The codebases a page with no engine carries, as the world reads them: the
// facts derived from each one's judged graph, shared by the page and the
// thread that lays a snapshot out. Gaia's own (`fixtures/gaia-graph.json`,
// written by `pnpm graph-snapshot`), and the showcase's
// (`fixtures/showcase-graph.json`, written by `pnpm showcase`), with its old
// `v1/` as it is or fixed (`fixtures/showcase-fixed-graph.json`, written by
// `pnpm showcase --v1 fixed`).

import type { CodeGraph, CodeFacts } from "@gaia/schema";
import { factsOf } from "@gaia/world";
import gaiaGraph from "./fixtures/gaia-graph.json";
import showcaseFixedGraph from "./fixtures/showcase-fixed-graph.json";
import showcaseGraph from "./fixtures/showcase-graph.json";

/** Which carried codebase: Gaia's own, or the showcase's, with its `v1/` as it is or fixed. */
export type Snapshot = "gaia" | "showcase" | "showcase-fixed";

const GRAPHS: Readonly<Record<Snapshot, unknown>> = { gaia: gaiaGraph, showcase: showcaseGraph, "showcase-fixed": showcaseFixedGraph };

/** A snapshot's graph. */
export const snapshotGraphOf = (of: Snapshot = "gaia"): CodeGraph => GRAPHS[of] as CodeGraph;

/** A snapshot's code facts, read from its graph. */
export const snapshotFacts = (of: Snapshot = "gaia"): CodeFacts => factsOf(snapshotGraphOf(of));
