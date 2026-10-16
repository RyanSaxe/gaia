// The engine's state in words, for `__lab.status`. Inside the app the world
// service reports it; a standalone page (the offline HTML) has no engine at all.

import { statusText } from "../world-service/protocol.ts";
import { worldService } from "./service.ts";

export function watchEngine(show: (text: string) => void): void {
  const service = worldService();
  if (service === null) {
    show(statusText("standalone"));
    return;
  }
  show(statusText({ state: "starting" }));
  service.on((m) => {
    if (m.type === "engine.status") show(statusText(m.status));
  });
}
