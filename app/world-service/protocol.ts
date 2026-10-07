// The messages the app's processes exchange. The main process only relays:
// engine lines go to the world service, and the world service talks to the
// renderer over its own MessagePort.

/** Main process → world service. */
export type FromMain =
  /** One line the engine wrote to its stdout. */
  | { readonly type: "engine.line"; readonly line: string }
  /** The engine process started; any earlier one is gone. */
  | { readonly type: "engine.up" }
  /** The engine process exited; main restarts it after a short backoff. */
  | { readonly type: "engine.down"; readonly reason: string }
  /** A new renderer page loaded; the message carries its MessagePort. */
  | { readonly type: "renderer.port" };

/** World service → main process. */
export type ToMain = { readonly type: "engine.send"; readonly line: string };

export type EngineStatus =
  | { readonly state: "starting" }
  | { readonly state: "connected"; readonly version: string }
  | { readonly state: "restarting" };

/** World service → renderer. */
export type ToRenderer = { readonly type: "engine.status"; readonly status: EngineStatus };

/** The status bar's words for each state. */
export function statusText(status: EngineStatus | "standalone"): string {
  if (status === "standalone") return "No engine (standalone)";
  switch (status.state) {
    case "starting":
      return "Engine starting";
    case "connected":
      return `Engine ${status.version} connected`;
    case "restarting":
      return "Engine restarting";
  }
}
