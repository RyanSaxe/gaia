// The protocol between the world service and the Rust engine: newline-delimited
// JSON-RPC over the engine's stdin and stdout. The Rust side derives the same
// shapes from its structs. The OpenRouter key never crosses this boundary.

import type { EntityFacts, FileFacts, RepositoryFacts } from "./facts.ts";
import type { JevRequest, JevResponse } from "./jev.ts";

export interface EngineMethods {
  /** Answers with the engine's version; the app's first sign the engine is alive. */
  "engine.ping": { params: Record<string, never>; result: { version: string } };
  /**
   * Scans the project (respecting .gitignore) and returns every file's facts,
   * every entity it found and the repository's own facts. The project's ID is
   * its root commit, so it names the project wherever it is cloned. Watching
   * the project for `facts.changed` is not built yet.
   */
  "project.open": { params: { root: string }; result: CodeModel };
  /**
   * Where a GitHub address leads, before anything is cloned: whether it names
   * a public repository GitHub will hand over (one `git ls-remote`), and the
   * folder Gaia keeps its copy in. Only `https://github.com/OWNER/REPO` or
   * `github.com/OWNER/REPO`, with an optional `.git`, is an address.
   */
  "project.locate": { params: { address: string }; result: Located };
  /**
   * Clones a public GitHub repository into Gaia's app-data folder
   * (`<data>/clones/<owner>/<repo>`), or fetches into the copy already there;
   * the copy then opens with `project.open` like any folder. The clone runs no
   * hooks, skips submodules and LFS content, speaks only https, keeps every
   * commit but fetches file contents only for the files checked out, and
   * gives up past a size or time cap.
   */
  "project.clone": { params: { address: string }; result: Cloned };
  /** Sends one request to Jev with the key from the macOS Keychain. Fails unless the engine runs with GAIA_JEV=live. */
  "jev.ask": { params: { request: JevRequest }; result: JevResponse };
  /**
   * Sends many requests, eight at a time, answering in the order asked: each
   * a response, or the reason that one request failed. Fails as a whole only
   * when nothing can be sent, such as when the engine runs without GAIA_JEV=live.
   */
  "jev.batch": { params: { requests: JevRequest[] }; result: { responses: (JevResponse | JevFailure)[] } };
  /** What a batch would send and cost, without sending it or reading the key. */
  "jev.estimate": { params: { requests: JevRequest[] }; result: JevEstimate };
  /**
   * Whether an OpenRouter key is in the Keychain (asked without reading it)
   * and whether this engine runs with GAIA_JEV=live. Only these two flags
   * cross; the key never does.
   */
  "jev.status": { params: Record<string, never>; result: { key: boolean; live: boolean } };
  /** Reads one record from a project's app-data store; null when it was never written. */
  "store.get": { params: { project: string; table: StoreTable; key: string }; result: { value: unknown } | null };
  /** Reads every record of one table of a project's store, by key. */
  "store.read": { params: { project: string; table: StoreTable }; result: { records: Record<string, unknown> } };
  /** Writes records atomically, so a world update is never half-saved. */
  "store.put": { params: { project: string; writes: { table: StoreTable; key: string; value: unknown }[] }; result: { ok: true } };
}

/**
 * Why a GitHub address leads nowhere Gaia can go: it is not a repository's
 * address; no public repository is there (missing, or private); GitHub could
 * not be reached; or the repository is past the size or the time cap.
 */
export type Unreachable = "address" | "missing" | "offline" | "large" | "slow";

/** Where a GitHub address leads (`project.locate`). `kept` is true when Gaia already holds a copy. */
export type Located = { readonly found: true; readonly owner: string; readonly repo: string; readonly root: string; readonly kept: boolean } | { readonly found: false; readonly why: Unreachable };

/** A clone or an update (`project.clone`). `fetched` is true when a copy already there was updated rather than cloned anew. */
export type Cloned = { readonly cloned: true; readonly owner: string; readonly repo: string; readonly root: string; readonly fetched: boolean } | { readonly cloned: false; readonly why: Unreachable };

/** The tables of a project's app-data store (`engine/src/store.rs`). */
export type StoreTable = "answers" | "blueprints" | "document" | "placements" | "settings";

/** One request of a batch that failed on its own, and why. */
export interface JevFailure {
  readonly error: string;
}

/** The code model of one project, as `project.open` reports it. */
export interface CodeModel {
  readonly projectId: string;
  readonly files: readonly FileFacts[];
  readonly entities: readonly EntityFacts[];
  readonly repository: RepositoryFacts;
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
  /** Whether this engine would really send them: it runs with GAIA_JEV=live. */
  readonly live: boolean;
}

/** Pushed by the engine without a request. */
export type EngineEvent =
  | { event: "facts.changed"; changed: FileFacts[]; removed: string[]; entities: EntityFacts[]; entitiesRemoved: string[] }
  | { event: "tests.reported"; failing: string[]; at: string }
  | { event: "engine.error"; message: string };

export interface EngineClient {
  call<M extends keyof EngineMethods>(method: M, params: EngineMethods[M]["params"]): Promise<EngineMethods[M]["result"]>;
  on(listener: (e: EngineEvent) => void): () => void;
}
