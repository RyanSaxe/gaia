// The engine protocol's client side: newline-delimited JSON-RPC over any line
// transport. The world service sends lines through the main process, which
// writes them to the engine's stdin and relays its stdout back.

import type { EngineClient, EngineEvent, EngineMethods } from "@gaia/schema";

export interface LineClient extends EngineClient {
  /** Feeds one line the engine wrote: a response or an event. */
  receive(line: string): void;
  /** Fails every call in flight; the engine that would have answered is gone. */
  disconnect(reason: string): void;
}

interface Pending {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
}

interface Response {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
  readonly event?: unknown;
}

export function createEngineClient(send: (line: string) => void): LineClient {
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const listeners = new Set<(e: EngineEvent) => void>();

  return {
    call<M extends keyof EngineMethods>(method: M, params: EngineMethods[M]["params"]): Promise<EngineMethods[M]["result"]> {
      const id = nextId++;
      return new Promise<EngineMethods[M]["result"]>((resolve, reject) => {
        pending.set(id, { resolve: (r) => resolve(r as EngineMethods[M]["result"]), reject });
        send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    receive(line) {
      let message: Response;
      try {
        message = JSON.parse(line) as Response;
      } catch {
        console.error(`gaia: the engine wrote a line that is not JSON: ${line}`);
        return;
      }
      if (typeof message.event === "string") {
        for (const listener of listeners) listener(message as EngineEvent);
        return;
      }
      const call = typeof message.id === "number" ? pending.get(message.id) : undefined;
      if (call === undefined) return;
      pending.delete(message.id as number);
      if (message.error !== undefined) call.reject(new Error(`${message.error.message} (${message.error.code})`));
      else call.resolve(message.result);
    },
    disconnect(reason) {
      for (const call of pending.values()) call.reject(new Error(reason));
      pending.clear();
    },
  };
}
