// The thread a page with no engine lays Gaia's snapshot out on
// (`laySnapshot`), so the page keeps drawing the wait meanwhile. It runs the
// same pure layout the page would, so the world is the same.

import type { CodeWorld, Judge } from "@gaia/world";
import { type SnapshotJudge, laySnapshot } from "./snapshot.ts";

export type LayoutRequest = { readonly judge: SnapshotJudge; readonly why: string };
export type LayoutReply = { readonly world: CodeWorld; readonly judges: Record<string, Judge>; readonly summary: string } | { readonly failed: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(message: LayoutReply): void;
}

const scope = globalThis as unknown as WorkerScope;
scope.onmessage = (e) => {
  laySnapshot(e.data.judge, e.data.why).then(
    (laid) => scope.postMessage(laid),
    (error: unknown) => scope.postMessage({ failed: error instanceof Error ? error.message : String(error) }),
  );
};
