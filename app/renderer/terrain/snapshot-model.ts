// Gaia's snapshot as the world reads it: the code model derived from the
// engine's graph of this repository (`fixtures/gaia-graph.json`), shared by
// the page and the thread that lays the snapshot out.

import type { CodeGraph, CodeModel } from "@gaia/schema";
import { codeModelOf } from "@gaia/world";
import snapshotGraph from "./fixtures/gaia-graph.json";

/** The snapshot's graph. */
export const snapshotGraphOf = (): CodeGraph => snapshotGraph as unknown as CodeGraph;

/** The snapshot's code model, read from its graph. */
export const snapshotModel = (): CodeModel => codeModelOf(snapshotGraphOf());
