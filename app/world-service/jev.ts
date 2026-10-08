// Jev through the engine: the world service's JevClient. Requests asked
// together (the planner asks eight at a time) go to the engine as one
// `jev.batch`, which sends them to OpenRouter with the key from the macOS
// Keychain. The key never reaches this process. A request that fails on its
// own fails only its own `ask`; the engine refuses the whole batch unless it
// runs with GAIA_JEV=live. `openWorld` decides whether Jev is asked at all.

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
