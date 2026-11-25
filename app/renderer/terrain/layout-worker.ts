// A worker that lays out the bundled showcase snapshot (`laySnapshot`), so
// the page keeps drawing the wait screen meanwhile. It runs the same pure
// layout as the page, so the world is the same.

import type { CodeWorld } from "@gaia/world";
import { laySnapshot } from "./snapshot.ts";
import type { Snapshot } from "./snapshot-facts.ts";

export type LayoutRequest = { readonly why: string; readonly of: Snapshot };
export type LayoutReply =
  | { readonly world: CodeWorld; readonly summary: string }
  | { readonly failed: string };

interface WorkerScope {
  addEventListener(
    type: "message",
    listener: (e: MessageEvent<LayoutRequest>) => void,
  ): void;
  postMessage(message: LayoutReply, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
scope.addEventListener("message", (e): void => {
  laySnapshot(e.data.why, e.data.of).then(
    (laid) => scope.postMessage(laid, []),
    (error: unknown) =>
      scope.postMessage(
        {
          failed: error instanceof Error ? error.message : String(error),
        },
        [],
      ),
  );
});
