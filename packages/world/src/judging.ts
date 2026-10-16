// Judging a world with Jev's answers kept. Every request is keyed by the
// hash of exactly what Jev is sent, so reopening a world asks again only
// about things whose facts changed (the continuity agreement). A request Jev
// has answered before is answered from the store; one it has not goes to
// Jev, and its answer is kept. One Jev cannot answer, once the engine's
// client has retried it, or answers outside the options it was given, fails
// the world, saying which request and why: nothing guesses an answer in its
// place.

import { type JevAnswer, type JevClient, type JevRequest, type JevResponse, contentHash } from "@gaia/schema";
import type { WorldRequest } from "./code-world.ts";

/** A request's key in the store: the hash of the whole request, so changed facts make a new key. */
export const requestKey = (request: JevRequest): string => contentHash(request);

/** The area (a directory's path, "" for the repository's root) whose land a planned request's thing stands on: a file's directory, an area or entity itself, the root for the world. */
export const areaOfRequest = (r: Pick<WorldRequest, "about" | "target">): string =>
  r.about === "file" ? (r.target.includes("/") ? r.target.slice(0, r.target.lastIndexOf("/")) : "") : r.about === "world" ? "" : r.target;

export interface Keeping {
  /** Jev's earlier answers, by request key. */
  readonly stored: ReadonlyMap<string, JevResponse>;
  /** Jev has just answered a request: keep its answer. */
  readonly keep: (key: string, response: JevResponse) => void;
  /** A request is settled from the store or by Jev: its key. */
  readonly settled?: (key: string) => void;
  /** Why Jev is not to be asked, when it is not: the reason a request with no kept answer fails. */
  readonly unasked?: string;
}

/** What a request is about, in words, from its state: what a failure names. */
export function requestSubject(request: JevRequest): string {
  const s = (request.state ?? {}) as Record<string, { path?: string; name?: string; file?: string; from?: { path?: string }; to?: { path?: string } } | undefined>;
  const at = (path: string | undefined): string => (path === undefined || path === "" ? "(the repository's root)" : path);
  const composing = Object.keys(request.questions).some((id) => /^[a-z]+\.(use|present)$/.test(id)) || (s as Record<string, unknown>).decided !== undefined;
  const verb = composing ? "composing" : "judging";
  if (s.file !== undefined) return `${verb} the file ${at(s.file.path)}`;
  if (s.definition !== undefined) return `${verb} ${s.definition.file ?? ""}#${s.definition.name ?? ""}'s building or landmark`;
  if (s.entity !== undefined) return `${verb} ${at(s.entity.path)}'s ${composing ? "building or landmark" : "entity"}`;
  if (s.directory !== undefined) return `${verb} the area ${at(s.directory.path)}${composing ? "'s land" : ""}`;
  if (s.trail !== undefined) return `${verb} the trail from ${at(s.trail.from?.path)} to ${at(s.trail.to?.path)}`;
  if (s.repository !== undefined) return `${verb} the world's sky`;
  return `a request (${requestKey(request).slice(0, 12)})`;
}

/** A request Jev could not answer: which one, and why. A world with one fails. */
export class RequestFailed extends Error {
  constructor(
    readonly subject: string,
    readonly reason: string,
  ) {
    super(`Gaia could not finish ${subject}: ${reason}`);
    this.name = "RequestFailed";
  }
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
 * asked, with `keeping.unasked` saying why), and an answer that fits is kept.
 * Anything else rejects with `RequestFailed`, naming the request and why:
 * the engine's client has already retried it, and nothing guesses instead.
 */
export function keptJev(jev: JevClient | null, keeping: Keeping): JevClient {
  return {
    async ask(request) {
      const key = requestKey(request);
      const stored = keeping.stored.get(key);
      if (stored !== undefined && answersFit(request, stored)) {
        keeping.settled?.(key);
        return stored;
      }
      if (jev === null) throw new RequestFailed(requestSubject(request), `there is no answer kept for it, and ${keeping.unasked ?? "Jev is not asked"}`);
      let response: JevResponse;
      try {
        response = await jev.ask(request);
      } catch (error) {
        throw new RequestFailed(requestSubject(request), error instanceof Error ? error.message : String(error));
      }
      if (!answersFit(request, response)) throw new RequestFailed(requestSubject(request), "Jev answered outside the options it was given");
      keeping.keep(key, response);
      keeping.settled?.(key);
      return response;
    },
  };
}
