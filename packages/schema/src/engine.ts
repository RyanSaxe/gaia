// The protocol between the world service and the Rust engine, newline-delimited
// JSON-RPC over the engine's stdin and stdout. The Rust side derives the same
// shapes from its structs. The OpenRouter key never crosses this boundary.

import type { CodeGraph, NodeId } from "./graph.ts";
import type { JevRequest, JevResponse } from "./jev.ts";

export interface EngineMethods {
  /** Returns the engine's version. It is the app's first check that the engine is running. */
  "engine.ping": { params: Record<string, never>; result: { version: string } };
  /**
   * Walks and parses the project into its code graph: a node for every
   * directory, file, definition and block, with its lines and history, and
   * every reference the rules have not resolved as pending. The engine parses every language the
   * same way, through its grammar's queries in `engine/queries/`.
   */
  "project.graph": { params: { root: string; judged?: boolean }; result: CodeGraph };
  /**
   * Builds every request the engine would send Jev to understand the project,
   * the links first and then importance and quality at every level, and looks
   * each up in the store. It sends nothing. A request already answered is kept
   * and never sent again while its request hash is unchanged.
   */
  "understanding.plan": { params: { root: string }; result: UnderstandPlan };
  /**
   * A file's text by its path relative to the root, from the snapshot the
   * world reads. That is `commit`, the graph's commit, when given, or else the
   * checked-out commit, or the disk outside git. Null when that snapshot has no
   * such file, the file is binary, or the path leaves the root.
   */
  "project.source": { params: { root: string; path: string; commit?: string }; result: { lines: readonly string[] | null } };
  /**
   * The commit `project.graph` would read `root` at now: the checked-out
   * commit, or null when it would read the disk. The start screen compares it
   * with the last opened commit to show whether the code has changed.
   */
  "project.commit": { params: { root: string }; result: { commit: string | null } };
  /**
   * How many commits after `from` up to `to` changed a file under `root`, or
   * null when `from` is not in `to`'s history, as after a rebase or a switch to
   * another branch, or either is not a commit git knows. The start screen uses
   * it to show, on a world's card, the commits since the person last opened it.
   */
  "project.commits": { params: { root: string; from: string; to: string }; result: { commits: number | null } };
  /**
   * Sends every ready request, up to `max`, 256 by default, as many at once as
   * Jev accepts: the links first, then folders top-down and each file after
   * its folder. Returns the nodes whose answers are now held, so the waiting
   * screen can draw them. Call it until nothing is left.
   */
  "understanding.next": { params: { root: string; max?: number }; result: UnderstandProgress };
  /**
   * Checks a GitHub address before anything is cloned. It returns whether the
   * address names a public repository GitHub serves, using one `git ls-remote`,
   * and the folder for Gaia's copy. Only `https://github.com/OWNER/REPO` or
   * `github.com/OWNER/REPO`, with an optional `.git`, is an address.
   */
  "project.locate": { params: { address: string }; result: Located };
  /**
   * Clones a public GitHub repository into `<data>/clones/<owner>/<repo>` in
   * Gaia's app-data folder, or fetches into the copy already there. The copy
   * then opens like any folder. The clone runs no hooks, skips submodules and
   * LFS content, uses only https, keeps every commit but fetches file contents
   * only for the checked-out files, and stops past a size or time cap.
   */
  "project.clone": { params: { address: string }; result: Cloned };
  /**
   * Sends requests to Jev with OPENROUTER_API_KEY, up to the engine's
   * concurrency limit at once, and returns each response or the reason that
   * request failed, in request order. It fails as a whole only when nothing can
   * be sent, such as when the engine runs without GAIA_JEV=live.
   */
  "jev.batch": { params: { requests: JevRequest[] }; result: { responses: (JevResponse | JevFailure)[] } };
  /** What a batch would send and cost, without sending it or reading the key. */
  "jev.estimate": { params: { requests: JevRequest[] }; result: JevEstimate };
  /**
   * Whether OPENROUTER_API_KEY is nonempty and whether this engine runs with
   * GAIA_JEV=live. Only these two flags cross the protocol. The key never does.
   */
  "jev.status": { params: Record<string, never>; result: { key: boolean; live: boolean } };
  /** Reads one record from a project's app-data store. Null when it was never written. */
  "store.get": { params: { project: string; table: StoreTable; key: string }; result: { value: unknown } | null };
  /** Reads every record of one table of a project's store, by key. */
  "store.read": { params: { project: string; table: StoreTable }; result: { records: Record<string, unknown> } };
  /** Writes records atomically, so a world update is never half-saved. */
  "store.put": { params: { project: string; writes: { table: StoreTable; key: string; value: unknown }[] }; result: { ok: true } };
}

/**
 * Why Gaia can't open a GitHub address. `address` means it is not a
 * repository's address, `missing` that no public repository is there, `offline`
 * that GitHub could not be reached, and `large` or `slow` that the repository
 * is past the size or time cap.
 */
export type Unreachable = "address" | "missing" | "offline" | "large" | "slow";

/** Where a GitHub address leads (`project.locate`). `kept` is true when Gaia already has a copy. */
export type Located = { readonly found: true; readonly owner: string; readonly repo: string; readonly root: string; readonly kept: boolean } | { readonly found: false; readonly why: Unreachable };

/** A clone or an update (`project.clone`). `fetched` is true when a copy already there was updated rather than cloned anew. */
export type Cloned = { readonly cloned: true; readonly owner: string; readonly repo: string; readonly root: string; readonly fetched: boolean } | { readonly cloned: false; readonly why: Unreachable };

/**
 * The tables of a project's app-data store (`engine/src/store.rs`). `calls`
 * keeps Jev's raw responses by request hash, `held` the answer the graph
 * shows for each question by lineage, and `lineage` the last graph's
 * lineage map and definition fingerprints.
 */
export type StoreTable = "answers" | "calls" | "held" | "lineage" | "settings";

/** One request of a batch that failed on its own, and why. */
export interface JevFailure {
  readonly error: string;
}

/** What a batch of Jev requests would send and cost. Tokens are estimated from the bytes until a live run reports them. */
export interface JevEstimate {
  readonly endpoint: string;
  readonly requests: number;
  readonly questions: number;
  readonly bytes: number;
  readonly estimatedTokens: number;
  readonly estimatedUsd: number;
  readonly usdPerMillionInputTokens: number;
  readonly concurrency: number;
  /** Whether this engine would send them, which it does when it runs with GAIA_JEV=live. */
  readonly live: boolean;
}

/** The passes of understanding, in dependency order: links before folders, files after their folders. */
export type Pass = "link" | "folders" | "files";

/** What understanding a project would send, pass by pass, and what it would cost. */
export interface UnderstandPlan {
  readonly pending: readonly { readonly pass: Pass; readonly requests: number; readonly kept: number }[];
  readonly estimate: JevEstimate;
}

/** One slice of understanding. */
export interface UnderstandProgress {
  readonly sent: number;
  readonly failed: number;
  /** The first few requests that failed after the engine's client retried them, with each one's unit and error. */
  readonly failures: readonly { readonly unit: NodeId; readonly error: string }[];
  readonly left: number;
  /** Nodes whose requests are all answered. */
  readonly settled: readonly NodeId[];
  /** The quality, 0 to 1, of each file among `settled` that has one now, by path. The world shows it as the file's health. */
  readonly quality: Readonly<Record<string, number>>;
}

export interface EngineClient {
  call<M extends keyof EngineMethods>(method: M, params: EngineMethods[M]["params"]): Promise<EngineMethods[M]["result"]>;
}
