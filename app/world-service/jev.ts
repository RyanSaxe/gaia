// Jev through the engine: the world service's JevClient. Requests asked
// together (the planner asks eight at a time) go to the engine as one
// `jev.batch`, which sends them to OpenRouter with the key from the macOS
// Keychain. The key never reaches this process. The engine refuses to send
// anything unless it runs with GAIA_JEV=live, so until the reviewer approves
// the spend, worlds are judged by `standInJev` from @gaia/world instead.

import type { EngineClient, JevClient, JevRequest, JevResponse } from "@gaia/schema";

export function engineJev(engine: EngineClient): JevClient {
  let queue: { request: JevRequest; resolve: (r: JevResponse) => void; reject: (e: unknown) => void }[] = [];
  const flush = (): void => {
    const batch = queue;
    queue = [];
    engine.call("jev.batch", { requests: batch.map((q) => q.request) }).then(
      ({ responses }) => batch.forEach((q, i) => (responses[i] === undefined ? q.reject(new Error("Jev answered fewer requests than it was asked.")) : q.resolve(responses[i]))),
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
