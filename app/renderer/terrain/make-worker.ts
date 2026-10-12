// A thread that makes builds ahead of the page (made.ts): it realizes each
// build it is handed and hands back its geometry, moved rather than copied.
// It runs the same pure realize the page would, so a build made here is the
// same, byte for byte, as one made on the page.

import { type AnyKind, Library } from "@gaia/schema";
import { FLORA_PRIMITIVES, LANDMARK_PRIMITIVES, ROCK_PRIMITIVES, STRUCTURE_PRIMITIVES, WILDFLOWER_PRIMITIVES } from "@gaia/primitives";
import { flora, landmark, rock, structure, wildflowers } from "@gaia/kinds";
import { type Realized, realize } from "@gaia/realize";
import type { BuildAsk } from "./made.ts";

export type MakeRequest = { readonly id: number; readonly ask: BuildAsk };
export type MakeReply = { readonly id: number; readonly built: Realized } | { readonly id: number; readonly failed: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<MakeRequest>) => void) | null;
  postMessage(message: MakeReply, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
const KINDS: Readonly<Record<BuildAsk["kind"], AnyKind>> = { flora, landmark, rock, structure, wildflowers };
// Realize looks primitives up by id alone, so one library of every kind's primitives builds what each kind's own would.
const lib = new Library([...FLORA_PRIMITIVES, ...LANDMARK_PRIMITIVES, ...ROCK_PRIMITIVES, ...STRUCTURE_PRIMITIVES, ...WILDFLOWER_PRIMITIVES]);

/** Every buffer under `x`, once each, to move with the reply. */
function buffersOf(x: unknown, found = new Set<ArrayBuffer>(), seen = new Set<object>()): Set<ArrayBuffer> {
  if (x === null || typeof x !== "object" || seen.has(x)) return found;
  seen.add(x);
  if (ArrayBuffer.isView(x)) {
    if (x.buffer instanceof ArrayBuffer) found.add(x.buffer);
  } else for (const v of x instanceof Map ? x.values() : Object.values(x)) buffersOf(v, found, seen);
  return found;
}

scope.onmessage = (e) => {
  const { id, ask } = e.data;
  try {
    const built = realize(ask.blueprint, KINDS[ask.kind], lib, { seed: ask.seed, facts: ask.facts });
    scope.postMessage({ id, built }, [...buffersOf(built)]);
  } catch (error) {
    scope.postMessage({ id, failed: error instanceof Error ? error.message : String(error) }, []);
  }
};
