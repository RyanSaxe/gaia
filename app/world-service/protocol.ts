// The messages the app's processes exchange. The main process only relays:
// engine lines go to the world service, and the world service talks to the
// renderer over its own MessagePort.

import type { CodeFacts, PatchPlace, Span, Unreachable } from "@gaia/schema";
import type { Outline, StoodSpot } from "@gaia/terrain";
import type { CodeWorld, Judge, LotPlace } from "@gaia/world";

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

/** A world opened before, newest first on the start page. */
export interface RecentWorld {
  /** The folder it is the world of; for a place on GitHub, Gaia's own copy. */
  readonly root: string;
  readonly name: string;
  /** "owner/repo" for a place on GitHub, reopened through its address so it is brought up to date. */
  readonly github?: string;
  /** When it was last opened, ms since the epoch. */
  readonly at: number;
  /**
   * Its whole field map in health's colors, as its page painted it once the world last stood (`world.picture`): a
   * WebP data URL about 800 pixels a side (`paintPicture` in `app/renderer/immersive/picture.ts`). A world kept
   * before pictures were, or whose page painted none, has none. The start is offered it only while the folder's code
   * is still the commit it was painted from.
   */
  readonly picture?: string;
  /**
   * The commit the world was read from when the person last opened it, absent when it was read from disk. Its picture
   * pictures this commit: a picture never comes without it.
   */
  readonly commit?: string;
  /**
   * Where the person stood when they last left this world (`world.stood`), so the next open lands them there. It is
   * kept here, with the app's settings, rather than in the project's own store, because every write rewrites a
   * store whole and a project's holds all of Jev's answers.
   */
  readonly stood?: StoodSpot;
  /**
   * Offered only: how many commits have touched the folder since the person last opened it, when its code has moved
   * on from `commit`, or null when that commit is no longer in its history, as after a rebase.
   */
  readonly commitsSince?: number | null;
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

/** What the understanding pass judged about a folder, file or definition: every score from 0 to 1. */
export interface JudgedThing {
  readonly quality: number | null;
  readonly importance: number | null;
  /** Each concept Jev answered; null where the answer doesn't count, such as robustness's "nothing here can fail". */
  readonly concepts: Readonly<Record<string, number | null>>;
  /** The blocks Jev picked inside a definition, by their lines; absent where it chose none. */
  readonly picks: { readonly key?: Span; readonly weak?: Span };
}

/** A codebase's world as the renderer receives it: the code, the world laid out from it, and who judged each thing. */
export interface WorldDocument {
  /** The folder it is the world of. */
  readonly root: string;
  /** The commit it was built from, whose files the journal reads; absent when the folder was read from disk. */
  readonly commit?: string;
  readonly facts: CodeFacts;
  readonly world: CodeWorld;
  /** Who judged each thing, by `judgedThing` ("file:src/main.ts"); a thing missing here was judged by the stand-in. */
  readonly judges: Readonly<Record<string, Judge>>;
  /** How the judging went, in words for the status line, such as "248 judged by Jev". */
  readonly summary: string;
  /**
   * What the understanding pass judged, by path for folders and files ("app/world-service") and by path and
   * qualified name for definitions ("app/world-service/open-world.ts#openWorld.ask"), as the journal names them.
   */
  readonly judged: Readonly<Record<string, JudgedThing>>;
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

/** A file's patch of ground: where it lies on the land and how far its ground reaches, without its vitality. */
export type FilePatch = Omit<PatchPlace, "vitality">;

/** How opening a world is going. */
export type Opening =
  | { readonly stage: "reading"; readonly root: string }
  /**
   * The land is divided, before anything is judged: every area's outline,
   * exactly as the finished world's map draws it (`outlinesOf`), every
   * file's patch and every entity's lot, where its building or landmark will
   * stand, as the finished world lays them out, since the division depends on
   * the code alone. Every lot is the same ground whatever stands on it, so
   * its place is all a sheet needs to keep names off the mark to come. Sent
   * once, before any judging.
   */
  | { readonly stage: "land"; readonly name: string; readonly size: number; readonly aspect?: number; readonly areas: readonly Outline[]; readonly patches: readonly FilePatch[]; readonly lots: readonly LotPlace[] }
  /**
   * Asking Jev about the things it has not judged; `answered` counts those settled, and `total` every request to be
   * asked: under a spend limit the understanding pass's are planned and counted from the start, and with none they
   * are counted as the pass goes. `settled` names every area (a directory's path, "" for the root) whose things are
   * all judged, its region's own request included. Its land is composed later, once the code is understood, so no
   * land is named here. `asking` names the areas with a question to Jev in flight now. A request Jev cannot answer
   * fails the opening (`world.failed`), so none is counted as failed here.
   */
  | { readonly stage: "asking"; readonly name: string; readonly total: number; readonly answered: number; readonly settled: readonly string[]; readonly asking: readonly string[] }
  /**
   * Files whose health has settled since the last `health`, by path: each one's vitality, exactly as the finished
   * world has it, so nothing judged later changes it. A file whose vitality reads nothing Jev judges is settled with
   * the land; any other once the answer it reads is in, whoever gave it. Every file is named once, all of them
   * before the world's document, whether or not Jev is asked.
   */
  | { readonly stage: "health"; readonly vitality: Readonly<Record<string, number>> }
  /**
   * What a slice of the understanding pass has just read: the files and the areas (a directory's path, "" for the
   * root) whose requests in one of its passes are all answered now. A file comes once for its links and again for
   * itself; an area once, as the pass goes down the folders. The wait shows this as the pencil going over that code.
   */
  | { readonly stage: "understood"; readonly files: readonly string[]; readonly areas: readonly string[] }
  /**
   * What Jev has just settled after the understanding pass: the files and areas whose things Jev chose what they
   * stand as (`chosen`: a file's own request, or an entity's, by its area), and those whose building, landmark,
   * land or sky it composed (`composed`: a file's or a definition's by its file; an entity's, a land's or, as "",
   * the sky's by its area). Each comes once. The wait shows this as one more pencil stroke over that code, so the
   * sheet keeps moving until the world stands.
   */
  | { readonly stage: "standing"; readonly chosen: Settled; readonly composed: Settled };

/** Files and areas (a directory's path, "" for the root) that something settled. */
export interface Settled {
  readonly files: readonly string[];
  readonly areas: readonly string[];
}

/** World service → renderer. */
export type ToRenderer =
  | { readonly type: "engine.status"; readonly status: EngineStatus }
  | { readonly type: "world.progress"; readonly opening: Opening }
  /** Asks the person whether to send `plan` to Jev, only when it costs more than their spend limit; the renderer answers with `world.consent`. */
  | { readonly type: "world.consent"; readonly plan: ConsentPlan }
  /** No folder is named: the page offers the start, and answers with `world.choose`. Sent again, with `refused`, when a written address leads nowhere. */
  | { readonly type: "world.start"; readonly offer: StartOffer }
  /** The world laid out, and where the person stood when they last left it, if they were here before (`RecentWorld.stood`). */
  | { readonly type: "world.document"; readonly document: WorldDocument; readonly stood?: StoodSpot }
  | { readonly type: "world.failed"; readonly root: string; readonly message: string }
  /** A file's text, answering `world.source`: its lines, or null when it can't be read or lies outside the folder. */
  | { readonly type: "world.source"; readonly path: string; readonly lines: readonly string[] | null };

/** Renderer → world service. */
export type FromRenderer =
  /** Opens the world of the folder main named for this page. */
  | { readonly type: "world.open" }
  /** The person's answer to `world.consent`. */
  | { readonly type: "world.consent"; readonly approve: boolean }
  /** The place chosen on the start page. */
  | { readonly type: "world.choose"; readonly place: StartChoice }
  /** A picture of the world this page opened (`RecentWorld.picture`), painted once its field map is: kept with it among the recent worlds. */
  | { readonly type: "world.picture"; readonly picture: string }
  /** Asks for a file of the world this page opened, by its project-relative path, for the journal's code pages. */
  | { readonly type: "world.source"; readonly path: string }
  /** Where the person stands in the world this page opened, sent now and then as they walk and when the page goes: kept with it among the recent worlds. */
  | { readonly type: "world.stood"; readonly stood: StoodSpot };

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
