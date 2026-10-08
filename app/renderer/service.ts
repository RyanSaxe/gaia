// The page's line to the world service. Inside the app, the preload passes in
// a MessagePort once the page has loaded; messages sent before then wait for
// it. A standalone page (the offline HTML, `pnpm lab:serve`) has no service.

import type { FromRenderer, ToRenderer } from "../world-service/protocol.ts";

declare global {
  interface Window {
    /** Set by the preload script when the page runs inside the app. */
    gaiaShell?: { readonly app: "electron"; readonly chooseFolder: () => Promise<string | null> };
  }
}

export interface WorldService {
  send(message: FromRenderer): void;
  /** Listens to everything the service says; returns a function that stops listening. */
  on(listener: (message: ToRenderer) => void): () => void;
}

let service: WorldService | null | undefined;

/** The world service, or null outside the app. The first call must come before the page finishes loading. */
export function worldService(): WorldService | null {
  if (service !== undefined) return service;
  if (window.gaiaShell === undefined) return (service = null);
  let port: MessagePort | null = null;
  const waiting: FromRenderer[] = [];
  const listeners = new Set<(message: ToRenderer) => void>();
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data !== "gaia:world-port") return;
    const next = event.ports[0];
    if (next === undefined) return;
    port = next;
    port.onmessage = (m: MessageEvent<ToRenderer>) => listeners.forEach((l) => l(m.data));
    for (const message of waiting.splice(0)) port.postMessage(message);
  });
  service = {
    send(message) {
      if (port === null) waiting.push(message);
      else port.postMessage(message);
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return service;
}
