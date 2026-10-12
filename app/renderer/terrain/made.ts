// Builds made ahead. The trees, landmarks and bushes every world opens with
// take most of a second to realize, so they are made on worker threads that
// start with the page (make-worker.ts) while the page's own thread draws the
// wait, and the page only takes them. A build asked for before it is made, or
// never made ahead, is realized in place: realize is pure, so the build is
// the same either way.

import type { Blueprint, Library } from "@gaia/schema";
import { flora, landmark, rock, structure, wildflowers } from "@gaia/kinds";
import { type Realized, realize } from "@gaia/realize";
import type { MakeReply } from "./make-worker.ts";
import MakeWorker from "./make-worker.ts?worker";

const KINDS = { flora, landmark, rock, structure, wildflowers } as const;
/** The kinds a build can be made ahead for. */
export type BuildKind = keyof typeof KINDS;

/** One build as plain data a worker can take: what realize is given. */
export interface BuildAsk {
  readonly kind: BuildKind;
  readonly blueprint: Blueprint;
  readonly seed: number;
  readonly facts: Readonly<Record<string, number>>;
}

/** Builds made ahead and not yet taken. */
const ready = new Map<string, Realized>();
/** Builds being made ahead that have not come yet. One asked for meanwhile is realized in place, and dropped when it comes. */
const making = new Set<string>();
const keyOf = (ask: BuildAsk): string => JSON.stringify([ask.kind, ask.seed, ask.facts, ask.blueprint]);

/**
 * Makes `asks` on worker threads, each taking the next build as it finishes
 * one; resolves once all are made. A thread that fails ends early, and what
 * it did not make is realized in place when asked for.
 */
export function makeAhead(asks: readonly BuildAsk[], threads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 2))): Promise<void> {
  const left = asks.filter((ask) => !ready.has(keyOf(ask)) && !making.has(keyOf(ask)));
  for (const ask of left) making.add(keyOf(ask));
  let next = 0;
  const work = (): Promise<void> =>
    new Promise((done) => {
      const worker = new MakeWorker();
      const finish = (): void => {
        worker.terminate();
        done();
      };
      const give = (): void => {
        const id = next++;
        const ask = left[id];
        if (ask === undefined) finish();
        else worker.postMessage({ id, ask });
      };
      worker.onmessage = (e: MessageEvent<MakeReply>) => {
        const ask = left[e.data.id];
        if (ask !== undefined && making.delete(keyOf(ask)) && "built" in e.data) ready.set(keyOf(ask), e.data.built);
        give();
      };
      worker.onerror = finish;
      give();
    });
  return Promise.all(Array.from({ length: Math.min(threads, left.length) }, work)).then(() => undefined);
}

/** The build `ask` names: the one made ahead, taken once, or else realized now from `lib`. */
export function made(ask: BuildAsk, lib: Library): Realized {
  const key = keyOf(ask);
  const built = ready.get(key);
  ready.delete(key);
  making.delete(key);
  return built ?? realize(ask.blueprint, KINDS[ask.kind], lib, { seed: ask.seed, facts: ask.facts });
}
