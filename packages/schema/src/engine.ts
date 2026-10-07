// The protocol between the world service and the Rust engine: newline-delimited
// JSON-RPC over the engine's stdin and stdout. The Rust side derives the same
// shapes from its structs. The OpenRouter key never crosses this boundary.

import type { FileFacts } from "./facts.ts";
import type { JevRequest, JevResponse } from "./jev.ts";

export interface EngineMethods {
  /** Scans the project, starts watching it, and returns every file's facts. */
  "project.open": { params: { root: string }; result: { projectId: string; files: FileFacts[] } };
  /** Sends one request to Jev with the key from the macOS Keychain. */
  "jev.ask": { params: { request: JevRequest }; result: JevResponse };
  /** Reads one record from the project's app-data store. */
  "store.get": { params: { table: StoreTable; key: string }; result: { value: unknown } | null };
  /** Writes records atomically, so a world update is never half-saved. */
  "store.put": { params: { writes: { table: StoreTable; key: string; value: unknown }[] }; result: { ok: true } };
}

export type StoreTable = "answers" | "blueprints" | "document" | "placements";

/** Pushed by the engine without a request. */
export type EngineEvent =
  | { event: "facts.changed"; changed: FileFacts[]; removed: string[] }
  | { event: "tests.reported"; failing: string[]; at: string }
  | { event: "engine.error"; message: string };

export interface EngineClient {
  call<M extends keyof EngineMethods>(method: M, params: EngineMethods[M]["params"]): Promise<EngineMethods[M]["result"]>;
  on(listener: (e: EngineEvent) => void): () => void;
}
