// Reports the engine's status text for `__lab.status`. Inside the app the
// world service sends it. A standalone page, such as the offline HTML, has no
// engine.

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
