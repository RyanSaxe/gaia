// The messages the app's processes exchange. The main process only relays:
// engine lines go to the world service, and the world service talks to the
// renderer over its own MessagePort.

import type { CodeModel } from "@gaia/schema";
import type { CodeWorld, Judge } from "@gaia/world";

/** Main process → world service. */
export type FromMain =
  /** One line the engine wrote to its stdout. */
  | { readonly type: "engine.line"; readonly line: string }
  /** The engine process started; any earlier one is gone. */
  | { readonly type: "engine.up" }
  /** The engine process exited; main restarts it after a short backoff. */
  | { readonly type: "engine.down"; readonly reason: string }
  /** A new renderer page loaded; the message carries its MessagePort, and the folder its world is of. */
  | { readonly type: "renderer.port"; readonly root: string };

/** World service → main process. */
export type ToMain = { readonly type: "engine.send"; readonly line: string };

export type EngineStatus =
  | { readonly state: "starting" }
  | { readonly state: "connected"; readonly version: string }
  | { readonly state: "restarting" };

/** A codebase's world as the renderer receives it: the code, the world laid out from it, and who judged each thing. */
export interface WorldDocument {
  /** The folder it is the world of. */
  readonly root: string;
  readonly model: CodeModel;
  readonly world: CodeWorld;
  /** Who judged each thing, by `judgedThing` ("file:src/main.ts"); a thing missing here was judged by the stand-in. */
  readonly judges: Readonly<Record<string, Judge>>;
  /** How the judging went, in words for the status line, such as "248 judged by Jev". */
  readonly summary: string;
}

/** What a live run would send, shown to the person before anything is sent. */
export interface ConsentPlan {
  /** The repository's name. */
  readonly name: string;
  /** Things Jev has not judged yet: one request each. */
  readonly requests: number;
  readonly estimatedTokens: number;
  readonly estimatedUsd: number;
  readonly endpoint: string;
}

/** How opening a world is going. */
export type Opening =
  | { readonly stage: "reading"; readonly root: string }
  /** Asking Jev about the things it has not judged; `answered` counts those settled, `failed` those the stand-in took over. */
  | { readonly stage: "asking"; readonly name: string; readonly total: number; readonly answered: number; readonly failed: number };

/** World service → renderer. */
export type ToRenderer =
  | { readonly type: "engine.status"; readonly status: EngineStatus }
  | { readonly type: "world.progress"; readonly opening: Opening }
  /** Asks the person, once per project, whether to send `plan` to Jev; the renderer answers with `world.consent`. */
  | { readonly type: "world.consent"; readonly plan: ConsentPlan }
  | { readonly type: "world.document"; readonly document: WorldDocument }
  | { readonly type: "world.failed"; readonly root: string; readonly message: string };

/** Renderer → world service. */
export type FromRenderer =
  /** Opens the world of the folder main named for this page. */
  | { readonly type: "world.open" }
  /** The person's answer to `world.consent`. */
  | { readonly type: "world.consent"; readonly approve: boolean };

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
