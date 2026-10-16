// The codebases a page with no engine carries, as the world reads them: the
// facts derived from each one's judged graph, shared by the page and the
// thread that lays a snapshot out. Gaia's own (`fixtures/gaia-graph.json`,
// written by `pnpm graph-snapshot`), and the showcase's, folio
// (`fixtures/showcase-graph.json`, written by `pnpm showcase`).

import type { CodeGraph, CodeFacts } from "@gaia/schema";
import { factsOf } from "@gaia/world";
import gaiaGraph from "./fixtures/gaia-graph.json";
import showcaseGraph from "./fixtures/showcase-graph.json";

/** Which carried codebase: Gaia's own, or the showcase's. */
export type Snapshot = "gaia" | "showcase";

/** A snapshot's graph. */
export const snapshotGraphOf = (of: Snapshot = "gaia"): CodeGraph => (of === "showcase" ? showcaseGraph : gaiaGraph) as unknown as CodeGraph;

/** A snapshot's code facts, read from its graph. */
export const snapshotFacts = (of: Snapshot = "gaia"): CodeFacts => factsOf(snapshotGraphOf(of));
