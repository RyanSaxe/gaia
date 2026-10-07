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
  /** Sends one request to Jev with the key from the macOS Keychain. Fails unless the engine runs with GAIA_JEV=live. */
  "jev.ask": { params: { request: JevRequest }; result: JevResponse };
  /** Sends many requests, eight at a time, answering in the order asked. Fails unless the engine runs with GAIA_JEV=live. */
  "jev.batch": { params: { requests: JevRequest[] }; result: { responses: JevResponse[] } };
  /** What a batch would send and cost, without sending it or reading the key. */
  "jev.estimate": { params: { requests: JevRequest[] }; result: JevEstimate };
  /** Reads one record from the project's app-data store. */
  "store.get": { params: { table: StoreTable; key: string }; result: { value: unknown } | null };
  /** Writes records atomically, so a world update is never half-saved. */
  "store.put": { params: { writes: { table: StoreTable; key: string; value: unknown }[] }; result: { ok: true } };
}

export type StoreTable = "answers" | "blueprints" | "document" | "placements";

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
