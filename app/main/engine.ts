// Runs the engine binary and keeps it running: whenever it exits, it starts
// again after a short backoff that grows while it keeps failing.

import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface EngineEvents {
  /** A new engine process started. */
  readonly up: () => void;
  /** The engine process exited or could not start. */
  readonly down: (reason: string) => void;
  /** One line the engine wrote to stdout. */
  readonly line: (line: string) => void;
}

export interface Engine {
  /** Writes one line to the engine's stdin; false when no engine is running. */
  send(line: string): boolean;
  /** Stops the engine for good. */
  stop(): void;
}

const BACKOFF = {
  /** Wait before the first restart, milliseconds. */
  first: 250,
  max: 4000,
  /** A run this long resets the backoff. */
  stable: 10_000,
};

export function superviseEngine(command: string, args: readonly string[], on: EngineEvents): Engine {
  let child: ChildProcess | null = null;
  /** Exits in a row that came soon after a start. */
  let failures = 0;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const start = (): void => {
    const startedAt = Date.now();
    const proc = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
    child = proc;
    // Writing to an engine that just died must not crash the main process.
    proc.stdin?.on("error", () => {});
    if (proc.stdout !== null) createInterface({ input: proc.stdout }).on("line", on.line);
    proc.once("spawn", on.up);

    let ended = false;
    const end = (reason: string): void => {
      if (ended) return;
      ended = true;
      if (child === proc) child = null;
      on.down(reason);
      if (stopped) return;
      failures = Date.now() - startedAt >= BACKOFF.stable ? 1 : failures + 1;
      const delay = Math.min(BACKOFF.max, BACKOFF.first * 2 ** (failures - 1));
      console.error(`gaia: the engine ${reason}; restarting in ${delay} ms`);
      timer = setTimeout(start, delay);
    };
    proc.once("error", (error) => end(`could not start: ${error.message}`));
    proc.once("exit", (code, signal) => end(signal === null ? `exited with code ${code}` : `was killed by ${signal}`));
  };

  start();

  return {
    send(line) {
      const stdin = child?.stdin;
      if (stdin === null || stdin === undefined || !stdin.writable) return false;
      stdin.write(`${line}\n`);
      return true;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      child?.kill();
    },
  };
}
