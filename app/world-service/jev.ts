// The world service's `JevClient`, which sends the requests made in one tick
// to the engine as one `jev.batch`. The engine reads OPENROUTER_API_KEY
// itself, so the key never crosses the protocol. A failed request rejects only
// its own `ask`, and the engine refuses a whole batch unless it runs with
// GAIA_JEV=live.

import type { EngineClient, JevClient, JevRequest, JevResponse } from "@gaia/schema";

export function engineJev(engine: EngineClient): JevClient {
  let queue: { request: JevRequest; resolve: (r: JevResponse) => void; reject: (e: unknown) => void }[] = [];
  const flush = (): void => {
    const batch = queue;
    queue = [];
    engine.call("jev.batch", { requests: batch.map((q) => q.request) }).then(
      ({ responses }) =>
        batch.forEach((q, i) => {
          const r = responses[i];
          if (r === undefined) q.reject(new Error("Jev answered fewer requests than it was asked."));
          else if ("error" in r) q.reject(new Error(r.error));
          else q.resolve(r);
        }),
      (error: unknown) => batch.forEach((q) => q.reject(error)),
    );
  };
  return {
    ask(request) {
      return new Promise((resolve, reject) => {
        if (queue.length === 0) setTimeout(flush, 0);
        queue.push({ request, resolve, reject });
      });
    },
  };
}
