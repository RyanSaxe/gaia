// The thread a page lays a bundled snapshot out on (`laySnapshot`): Gaia's
// own with no engine, or the showcase's, so the page keeps drawing the wait
// meanwhile. It runs the same pure layout the page would, so the world is the
// same.

import type { CodeWorld, Judge } from "@gaia/world";
import { type SnapshotJudge, laySnapshot } from "./snapshot.ts";
import type { Snapshot } from "./snapshot-facts.ts";

export type LayoutRequest = { readonly judge: SnapshotJudge; readonly why: string; readonly of: Snapshot };
export type LayoutReply = { readonly world: CodeWorld; readonly judges: Record<string, Judge>; readonly summary: string } | { readonly failed: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(message: LayoutReply): void;
}

const scope = globalThis as unknown as WorkerScope;
scope.onmessage = (e) => {
  laySnapshot(e.data.judge, e.data.why, e.data.of).then(
    (laid) => scope.postMessage(laid),
    (error: unknown) => scope.postMessage({ failed: error instanceof Error ? error.message : String(error) }),
  );
};
