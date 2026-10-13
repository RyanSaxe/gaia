// Gaia's snapshot as the world reads it: the facts derived from the
// engine's graph of this repository (`fixtures/gaia-graph.json`), shared by
// the page and the thread that lays the snapshot out.

import type { CodeGraph, CodeFacts } from "@gaia/schema";
import { factsOf } from "@gaia/world";
import snapshotGraph from "./fixtures/gaia-graph.json";

/** The snapshot's graph. */
export const snapshotGraphOf = (): CodeGraph => snapshotGraph as unknown as CodeGraph;

/** The snapshot's code facts, read from its graph. */
export const snapshotFacts = (): CodeFacts => factsOf(snapshotGraphOf());
