// Makes builds ahead on worker threads. The trees, landmarks and bushes every
// world opens with take most of a second to realize, so workers make them
// (make-worker.ts) while the main thread draws the wait screen. A build
// requested before it is ready, or never made ahead, is realized in place,
// and since realize is pure the build is the same either way.

import { type Blueprint, type Library, seedOf } from "@gaia/schema";
import { bush, landmark, rock, structure, tree, wildflowers } from "@gaia/kinds";
import { type Realized, realize } from "@gaia/realize";
import type { MakeReply } from "./make-worker.ts";
import MakeWorker from "./make-worker.ts?worker";

const KINDS = { tree, bush, landmark, rock, structure, wildflowers } as const;
/** The kinds a build can be made ahead for. */
export type BuildKind = keyof typeof KINDS;

/**
 * The single build request for a tree, bush, stone or flowers blueprint, which every thing with that blueprint copies.
 * Its seed comes from the blueprint's content alone, so the same blueprint builds the same in every world.
 */
export function plantAsk(blueprint: Blueprint): BuildAsk {
  if (!(blueprint.kind in KINDS)) throw new Error(`No build is made for a ${blueprint.kind} blueprint.`);
  return { kind: blueprint.kind as BuildKind, blueprint, seed: seedOf(`build/${blueprint.id}`), facts: { scale: 1, age: 120 } };
}

/** One build request as plain data a worker accepts: the inputs to realize. */
export interface BuildAsk {
  readonly kind: BuildKind;
  readonly blueprint: Blueprint;
  readonly seed: number;
  readonly facts: Readonly<Record<string, number>>;
}

/** Builds made ahead and not yet taken. */
const ready = new Map<string, Realized>();
/** Builds being made ahead that have not arrived. One requested meanwhile is realized in place, and the worker's copy is dropped on arrival. */
const making = new Set<string>();
const keyOf = (ask: BuildAsk): string => JSON.stringify([ask.kind, ask.seed, ask.facts, ask.blueprint]);

/**
 * Makes `asks` on worker threads, each taking the next build as it finishes
 * one, and resolves once all are made. A thread that fails ends early, and the
 * builds it did not make are realized in place when requested.
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

/** Returns the build `ask` names: the one made ahead, which can be taken once, or else one realized now from `lib`. */
export function made(ask: BuildAsk, lib: Library): Realized {
  const key = keyOf(ask);
  const built = ready.get(key);
  ready.delete(key);
  making.delete(key);
  return built ?? realize(ask.blueprint, KINDS[ask.kind], lib, { seed: ask.seed, facts: ask.facts });
}

/** Makes the build `ask` names on a worker thread now, so a build dropped earlier returns without blocking the page. */
export async function makeLater(ask: BuildAsk, lib: Library): Promise<Realized> {
  await makeAhead([ask], 1);
  return made(ask, lib);
}
