// The messages the app's processes exchange. The main process only relays:
// engine lines go to the world service, and the world service talks to the
// renderer over its own MessagePort.

import type { CodeModel, Unreachable } from "@gaia/schema";
import type { Outline } from "@gaia/terrain";
import type { CodeWorld, Judge } from "@gaia/world";

/** Main process → world service. */
export type FromMain =
  /** One line the engine wrote to its stdout. */
  | { readonly type: "engine.line"; readonly line: string }
  /** The engine process started; any earlier one is gone. */
  | { readonly type: "engine.up" }
  /** The engine process exited; main restarts it after a short backoff. */
  | { readonly type: "engine.down"; readonly reason: string }
  /** A new renderer page loaded; the message carries its MessagePort, and the folder its world is of, or null when none is named yet and the page offers the start. */
  | { readonly type: "renderer.port"; readonly root: string | null };

/** World service → main process. */
export type ToMain =
  | { readonly type: "engine.send"; readonly line: string }
  /** A world chosen on the start page opened: main names the window after it and reopens it when the page reloads. */
  | { readonly type: "world.opened"; readonly root: string; readonly name: string };

/** A small picture of a world's land, kept with each recent world for the start page to paint. */
export interface Postcard {
  /** Its areas down to the second level, deepest last, in the land's frame scaled to -1..1, each with its land's and water's keys. */
  readonly areas: readonly { readonly depth: number; readonly land: string; readonly water: string; readonly rings: readonly (readonly number[])[] }[];
  /** Where its buildings and landmarks stand, -1..1. */
  readonly things: readonly { readonly x: number; readonly z: number; readonly as: "building" | "landmark" }[];
}

/** A world opened before, newest first on the start page. */
export interface RecentWorld {
  /** The folder it is the world of; for a place on GitHub, Gaia's own copy. */
  readonly root: string;
  readonly name: string;
  /** "owner/repo" for a place on GitHub, reopened through its address so it is brought up to date. */
  readonly github?: string;
  /** When it was last opened, ms since the epoch. */
  readonly at: number;
  readonly postcard?: Postcard;
}

/** What the start page offers: the worlds opened before, and why the last address written led nowhere, if it did. */
export interface StartOffer {
  readonly recent: readonly RecentWorld[];
  readonly refused?: { readonly address: string; readonly why: Unreachable };
}

/** A place chosen on the start page: a folder on this computer, or an address on GitHub. */
export type StartChoice = { readonly folder: string } | { readonly address: string };

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

/** What a live run would send and cost, shown to the person only when it costs more than their spend limit. */
export interface ConsentPlan {
  /** The repository's name. */
  readonly name: string;
  /** Things Jev has not judged yet: one request each. */
  readonly requests: number;
  readonly estimatedTokens: number;
  readonly estimatedUsd: number;
  /** What judging one project may spend without asking, US dollars. */
  readonly limitUsd: number;
  readonly endpoint: string;
}

/** How opening a world is going. */
export type Opening =
  | { readonly stage: "reading"; readonly root: string }
  /**
   * The land is divided, before anything is judged: every area's outline,
   * exactly as the finished world's map draws it (`outlinesOf`), since the
   * division depends on the code alone. Sent once, before any judging.
   */
  | { readonly stage: "land"; readonly name: string; readonly size: number; readonly areas: readonly Outline[] }
  /**
   * Asking Jev about the things it has not judged; `answered` counts those settled, `failed` those the stand-in
   * took over, and `settled` names every area (a directory's path, "" for the root) whose things and land are all
   * judged, with the land judged for its own ground: a land's name in `looks.ts`, its region's for an area without
   * land of its own, as `areaLands` reads it from the finished world. `asking` names the areas with a question
   * to Jev in flight now, which the wait shows being worked on.
   */
  | { readonly stage: "asking"; readonly name: string; readonly total: number; readonly answered: number; readonly failed: number; readonly settled: Readonly<Record<string, string>>; readonly asking: readonly string[] };

/** World service → renderer. */
export type ToRenderer =
  | { readonly type: "engine.status"; readonly status: EngineStatus }
  | { readonly type: "world.progress"; readonly opening: Opening }
  /** Asks the person whether to send `plan` to Jev, only when it costs more than their spend limit; the renderer answers with `world.consent`. */
  | { readonly type: "world.consent"; readonly plan: ConsentPlan }
  /** No folder is named: the page offers the start, and answers with `world.choose`. Sent again, with `refused`, when a written address leads nowhere. */
  | { readonly type: "world.start"; readonly offer: StartOffer }
  | { readonly type: "world.document"; readonly document: WorldDocument }
  | { readonly type: "world.failed"; readonly root: string; readonly message: string };

/** Renderer → world service. */
export type FromRenderer =
  /** Opens the world of the folder main named for this page. */
  | { readonly type: "world.open" }
  /** The person's answer to `world.consent`. */
  | { readonly type: "world.consent"; readonly approve: boolean }
  /** The place chosen on the start page. */
  | { readonly type: "world.choose"; readonly place: StartChoice };

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
