// Judges a world with Jev's answers kept. Each request's key is the hash of
// exactly what Jev is sent, so reopening a world sends requests only for
// things whose facts changed. A stored answer is reused, and a new answer is
// kept. If Jev cannot answer after the engine's client retries, or answers
// outside the offered options, the world fails with the request and the
// reason. Nothing substitutes a guessed answer.

import { type JevAnswer, type JevClient, type JevRequest, type JevResponse, contentHash } from "@gaia/schema";
import type { WorldRequest } from "./code-world.ts";

/** A request's store key, which is the hash of the whole request. Changed facts give a new key. */
export const requestKey = (request: JevRequest): string => contentHash(request);

/** The directory path whose land a planned request's thing is on: a file's directory, the area or entity itself, or "" for the world. */
export const areaOfRequest = (r: Pick<WorldRequest, "about" | "target">): string =>
  r.about === "file" ? (r.target.includes("/") ? r.target.slice(0, r.target.lastIndexOf("/")) : "") : r.about === "world" ? "" : r.target;

export interface Keeping {
  /** Jev's earlier answers, by request key. */
  readonly stored: ReadonlyMap<string, JevResponse>;
  /** Called with each new answer from Jev, to store it. */
  readonly keep: (key: string, response: JevResponse) => void;
  /** Called with a request's key once the store or Jev answers it. */
  readonly settled?: (key: string) => void;
  /** Why Jev must not be asked, if so. A request with no stored answer fails with this reason. */
  readonly unasked?: string;
}

/** Describes in words what a request is about, from its state, for failure messages. */
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

/** A request Jev could not answer, with its subject and the reason. Any one fails the world. */
export class RequestFailed extends Error {
  constructor(
    readonly subject: string,
    readonly reason: string,
  ) {
    super(`Gaia could not finish ${subject}: ${reason}`);
    this.name = "RequestFailed";
  }
}

/** Whether a response answers every question within the options the request offered. */
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
 * Wraps Jev so its answers are kept. A stored answer that still fits is
 * returned without a request. Otherwise the request goes to `jev`, and an
 * answer that fits is kept. `jev` is null when Jev must not be asked, and
 * `keeping.unasked` gives the reason. Any other outcome rejects with
 * `RequestFailed`, naming the request and the reason. The engine's client has
 * already retried by then, and nothing substitutes a guess.
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
