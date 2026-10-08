// Judging a world with Jev's answers kept. Every request is keyed by the
// hash of exactly what Jev is sent, so reopening a world asks again only
// about things whose facts changed (the continuity agreement). A request Jev
// has answered before is answered from the store; one it has not goes to
// Jev, and its answer is kept; one Jev cannot answer, or answers outside the
// options it was given, is judged by the stand-in, and the world says so.

import { type JevAnswer, type JevClient, type JevRequest, type JevResponse, contentHash } from "@gaia/schema";
import type { WorldRequest } from "./code-world.ts";

/** Who judged a thing: Jev (now, or earlier from the store) or the deterministic stand-in. */
export type Judge = "jev" | "stand-in";

/** A request's key in the store: the hash of the whole request, so changed facts make a new key. */
export const requestKey = (request: JevRequest): string => contentHash(request);

/** The thing a planned request is about, such as "file:src/main.ts" or "entity:packages/world". */
export const judgedThing = (r: Pick<WorldRequest, "about" | "target">): string => `${r.about}:${r.target}`;

export interface Keeping {
  /** Jev's earlier answers, by request key. */
  readonly stored: ReadonlyMap<string, JevResponse>;
  /** Jev has just answered a request: keep its answer. */
  readonly keep: (key: string, response: JevResponse) => void;
  /** A request is settled: who judged it, and why Jev did not, if it was asked and failed. */
  readonly settled?: (key: string, judge: Judge, failure?: string) => void;
}

/** Whether a response answers every question with one of the options it offered. */
export function answersFit(request: JevRequest, response: JevResponse): boolean {
  return Object.entries(request.questions).every(([id, q]) => {
    const a: JevAnswer | undefined = response.answers?.[id];
    if (a === undefined || a.type !== q.type) return false;
    if (a.type === "choice") return q.type === "choice" && Object.hasOwn(q.criteria, a.choice);
    if (a.type === "noul") return Number.isFinite(a.noul) && a.noul >= 0 && a.noul <= 1;
    return q.type === "score" && Number.isFinite(a.score) && a.score >= 0 && a.score <= q.criteria.length - 1;
  });
}

/**
 * Jev with its answers kept. A stored answer that still fits is used without
 * asking. Otherwise the request goes to `jev` (null when Jev is not to be
 * asked: no key, off, or the person chose the stand-in), and an answer that
 * fits is kept. Anything else is answered by `standIn`.
 */
export function keptJev(jev: JevClient | null, standIn: JevClient, keeping: Keeping): JevClient {
  return {
    async ask(request) {
      const key = requestKey(request);
      const stored = keeping.stored.get(key);
      if (stored !== undefined && answersFit(request, stored)) {
        keeping.settled?.(key, "jev");
        return stored;
      }
      let failure: string | undefined;
      if (jev !== null) {
        try {
          const response = await jev.ask(request);
          if (answersFit(request, response)) {
            keeping.keep(key, response);
            keeping.settled?.(key, "jev");
            return response;
          }
          failure = "Jev answered outside the options it was given.";
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
        }
      }
      keeping.settled?.(key, "stand-in", failure);
      return standIn.ask(request);
    },
  };
}
