// The status bar's engine line. Inside the app, the preload passes in a
// MessagePort to the world service, which reports the engine's state; a
// standalone page (the offline HTML) has no engine at all.

import { type EngineStatus, type ToRenderer, statusText } from "../world-service/protocol.ts";

declare global {
  interface Window {
    /** Set by the preload script when the page runs inside the app. */
    gaiaShell?: { readonly app: "electron" };
  }
}

export function watchEngine(show: (text: string, state: EngineStatus["state"] | "standalone") => void): void {
  if (window.gaiaShell === undefined) {
    show(statusText("standalone"), "standalone");
    return;
  }
  show(statusText({ state: "starting" }), "starting");
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data !== "gaia:world-port") return;
    const port = event.ports[0];
    if (port === undefined) return;
    port.onmessage = (m: MessageEvent<ToRenderer>) => {
      if (m.data.type === "engine.status") show(statusText(m.data.status), m.data.status.state);
    };
  });
}
