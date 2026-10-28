// Defines the messages between the main process, the world service and the
// renderer. Main only relays engine lines to and from the world service. The
// world service talks to the renderer over its own MessagePort.

import type { CodeFacts, PatchPlace, Span, Unreachable } from "@gaia/schema";
import type { Outline, LastSpot } from "@gaia/terrain";
import type { CodeWorld, DefinitionLines, LotPlace } from "@gaia/world";

/** Main process → world service. */
export type FromMain =
  /** One line the engine wrote to its stdout. */
  | { readonly type: "engine.line"; readonly line: string }
  /** The engine process started. Any earlier engine process has exited. */
  | { readonly type: "engine.up" }
  /** The engine process exited. Main restarts it after a backoff. */
  | { readonly type: "engine.down"; readonly reason: string }
  /** A renderer page loaded. The message carries the page's MessagePort and the folder to open, or null for the start page. */
  | { readonly type: "renderer.port"; readonly root: string | null };

/** World service → main process. */
export type ToMain =
  | { readonly type: "engine.send"; readonly line: string }
  /** The world chosen on the start page opened. Main titles the window with its name and reopens it when the page reloads. */
  | { readonly type: "world.opened"; readonly root: string; readonly name: string };

/** A world opened before. The start page lists them newest first. */
export interface RecentWorld {
  /** The world's folder. For a GitHub repository, this is Gaia's own clone. */
  readonly root: string;
  readonly name: string;
  /** "owner/repo" for a GitHub repository. The start page reopens it by this address, which updates the clone first. */
  readonly github?: string;
  /** When it was last opened, ms since the epoch. */
  readonly at: number;
  /**
   * A painting of the view where the person last stopped in this world, made the way the journal paints and sent with
   * `world.painting`. It is a WebP data URL 1,040 pixels wide, with a height set by the land's aspect. The start page
   * shows it on the table as the world's card. It is absent for records stored before paintings existed and for worlds
   * the person left before stopping anywhere.
   */
  readonly painting?: string;
  /** The commit the world was built from when the person last opened it. Absent when the folder was read from disk. */
  readonly commit?: string;
  /**
   * Where the person was when they last left this world, from `world.stood`. The next open starts them there. It is
   * stored with the app settings, not in the project's store, because each write rewrites a whole store and a
   * project's store holds all of Jev's answers.
   */
  readonly stood?: LastSpot;
  /**
   * Set only in the start page's offer, when the folder's code has moved on from `commit`. It counts the commits that
   * touched the folder since then, or is null when `commit` is no longer in its history, such as after a rebase.
   */
  readonly commitsSince?: number | null;
}

/** The start page's content: the worlds opened before, and why the last typed address failed, if it did. */
export interface StartOffer {
  readonly recent: readonly RecentWorld[];
  readonly refused?: { readonly address: string; readonly why: Unreachable };
}

/** A choice on the start page: a local folder or a GitHub address. */
export type StartChoice = { readonly folder: string } | { readonly address: string };

export type EngineStatus =
  | { readonly state: "starting" }
  | { readonly state: "connected"; readonly version: string }
  | { readonly state: "restarting" };

/** The understanding pass's judgment of a folder, file or definition. Every score is from 0 to 1. */
export interface JudgedThing {
  readonly quality: number | null;
  readonly importance: number | null;
  /** Jev's score for each concept. Null where the answer does not count, such as robustness's "nothing here can fail". */
  readonly concepts: Readonly<Record<string, number | null>>;
  /** The line spans of the blocks Jev picked inside a definition. A pick is absent when Jev chose none. */
  readonly picks: { readonly key?: Span; readonly weak?: Span };
}

/** A codebase's world as the renderer receives it: the code's facts, the laid-out world and a judging summary. */
export interface WorldDocument {
  /** The world's folder. */
  readonly root: string;
  /** The commit the world was built from, whose files the journal reads. Absent when the folder was read from disk. */
  readonly commit?: string;
  readonly facts: CodeFacts;
  readonly world: CodeWorld;
  /** A judging summary for the status line, such as "248 things judged by Jev". */
  readonly summary: string;
  /**
   * The understanding pass's judgments, keyed as the journal names things: by path for folders and files, such as
   * "app/world-service", and by path and qualified name for definitions, such as
   * "app/world-service/open-world.ts#openWorld.ask".
   */
  readonly judged: Readonly<Record<string, JudgedThing>>;
}

/** What a live run would send and cost. The person sees it only when the cost exceeds their spend limit. */
export interface ConsentPlan {
  /** The repository's name. */
  readonly name: string;
  /** Requests to send to Jev, including the understanding pass's and the composing requests. */
  readonly requests: number;
  readonly estimatedTokens: number;
  readonly estimatedUsd: number;
  /** The spend limit, in US dollars, for judging one project without asking. */
  readonly limitUsd: number;
  readonly endpoint: string;
}

/** A file's patch: its position and radius on the land, without vitality. */
export type FilePatch = Omit<PatchPlace, "vitality">;

/** Progress messages while a world opens. */
export type Opening =
  | { readonly stage: "reading"; readonly root: string }
  /**
   * The divided land, sent once before any judging. It has every area's
   * outline as the finished map draws it (`outlinesOf`), every file's patch
   * and every entity's lot. These match the finished world because the
   * division depends only on the code. A lot has the same size whatever Jev
   * places on it, so its position is enough for the wait's sheet to keep
   * names clear of the building or landmark to come.
   */
  | { readonly stage: "land"; readonly name: string; readonly size: number; readonly aspect?: number; readonly areas: readonly Outline[]; readonly patches: readonly FilePatch[]; readonly lots: readonly LotPlace[] }
  /**
   * Jev is answering requests. `answered` counts the requests Jev has answered in this opening, and `total` counts
   * every request to send. With a spend limit, `total` includes the planned understanding requests from the start.
   * Without one, it grows as the pass finds requests. `settled` lists every area whose requests are all answered,
   * including its region's own request. An area is a directory's path, or "" for the root. Land is composed after the
    * understanding pass, so `settled` does not cover land. `asking` lists the areas with a request to Jev in
   * flight. A request Jev cannot answer fails the opening with `world.failed`, so this message has no failure count.
   */
  | { readonly stage: "asking"; readonly name: string; readonly total: number; readonly answered: number; readonly settled: readonly string[]; readonly asking: readonly string[] }
  /**
   * The final vitality of each file settled since the last `health` message, by path. Each value matches the finished
   * world. Files are sent as the understanding pass judges them, and files it did not cover are sent just before
   * `world.document`. Every file appears exactly once, whether or not Jev is asked.
   */
  | { readonly stage: "health"; readonly vitality: Readonly<Record<string, number>> }
  /**
   * The files and areas whose requests in one stage of the understanding pass are now all answered. A file appears
   * once for its links and again for itself. An area appears once, as the pass works down the folders. The wait draws
   * a pencil stroke over that code.
   */
  | { readonly stage: "understood"; readonly files: readonly string[]; readonly areas: readonly string[] }
  /**
   * Requests Jev settled after the understanding pass (`settledByState`). `chosen` lists the files and areas whose
   * forms Jev chose, with an entity's listed by its area. `composed` lists those whose building, landmark, land or sky
   * Jev composed: a file's or definition's by its file, and an entity's, land's or the sky's by its area, with "" for
   * the sky. Each appears once. The wait draws one more pencil stroke over that code, so the sheet keeps changing until
   * the world is laid out.
   */
  | { readonly stage: "standing"; readonly chosen: Settled; readonly composed: Settled };

/** Files and areas that a request settled. An area is a directory's path, or "" for the root. */
export interface Settled {
  readonly files: readonly string[];
  readonly areas: readonly string[];
}

/** World service → renderer. */
export type ToRenderer =
  | { readonly type: "engine.status"; readonly status: EngineStatus }
  | { readonly type: "world.progress"; readonly opening: Opening }
  /** Asks the person whether to send `plan` to Jev, only when its cost exceeds the spend limit. The renderer answers with `world.consent`. */
  | { readonly type: "world.consent"; readonly plan: ConsentPlan }
  /** No folder is named, so the page shows the start page and answers with `world.choose`. Sent again with `refused` when a typed address fails. */
  | { readonly type: "world.start"; readonly offer: StartOffer }
  /** The laid-out world, and where the person was when they last left it, if they opened it before (`RecentWorld.stood`). */
  | { readonly type: "world.document"; readonly document: WorldDocument; readonly stood?: LastSpot }
  | { readonly type: "world.failed"; readonly root: string; readonly message: string }
  /** The answer to `world.source`: the file's lines, or null when it cannot be read or is outside the folder. */
  | { readonly type: "world.source"; readonly path: string; readonly lines: readonly string[] | null }
  /**
   * The shown world's folder has a new commit, and `healWorld` judged the world again from it. `vitality` gives the
   * new vitality of each thing in the shown world whose vitality changed, by id: a file's path, a definition's
   * `<file>#<name>` or an entity's root path. Only vitality changes live. Nothing moves or changes shape, and Jev's
   * forms stay until the next open.
   *
   * When the new code divides the land as before, three more fields are set. `judged` holds the understanding pass's
   * changed judgments, keyed as in `WorldDocument.judged`. `symbols` holds each definition whose code moved to other
   * lines, by id (`withLines`). `commit` is the commit the journal now reads files from (`world.source`). Most commits
   * keep the land, because a file's or folder's area changes it only when it crosses a rung. When a file is added,
   * removed or renamed, a definition is added or removed, or an area crosses a rung, all three fields are absent.
   * Things that keep their id take their new vitality, and the rest waits for the next open.
   */
  | {
      readonly type: "world.vitality";
      readonly vitality: Readonly<Record<string, number>>;
      readonly judged?: Readonly<Record<string, JudgedThing>>;
      readonly symbols?: Readonly<Record<string, DefinitionLines>>;
      readonly commit?: string;
    };

/** The `world.vitality` message that `healWorld` returns for a new commit. */
export type Heal = Extract<ToRenderer, { readonly type: "world.vitality" }>;

/** Renderer → world service. */
export type FromRenderer =
  /** Opens the folder that main named for this page. */
  | { readonly type: "world.open" }
  /** The person's answer to `world.consent`. */
  | { readonly type: "world.consent"; readonly approve: boolean }
  /** The place chosen on the start page. */
  | { readonly type: "world.choose"; readonly place: StartChoice }
  /** A painting of the view where the person stopped in this page's world. The world service stores it as `RecentWorld.painting`. */
  | { readonly type: "world.painting"; readonly painting: string }
  /** Asks for a file's text by project-relative path, for the journal's code pages. The service reads it at the world's commit, or the commit it healed onto (`world.vitality`). */
  | { readonly type: "world.source"; readonly path: string }
  /** Where the person is in this page's world, sent periodically as they walk and when the page unloads. The world service stores it as `RecentWorld.stood`. */
  | { readonly type: "world.stood"; readonly stood: LastSpot };

/** Returns the status bar text for an engine state. */
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
