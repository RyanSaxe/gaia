// The status bar's engine line. Inside the app the world service reports the
// engine's state; a standalone page (the offline HTML) has no engine at all.

import { type EngineStatus, statusText } from "../world-service/protocol.ts";
import { worldService } from "./service.ts";

export function watchEngine(show: (text: string, state: EngineStatus["state"] | "standalone") => void): void {
  const service = worldService();
  if (service === null) {
    show(statusText("standalone"), "standalone");
    return;
  }
  show(statusText({ state: "starting" }), "starting");
  service.on((m) => {
    if (m.type === "engine.status") show(statusText(m.status), m.status.state);
  });
}
