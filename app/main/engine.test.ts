import { afterEach, describe, expect, it } from "vitest";
import { type Engine, superviseEngine } from "./engine.ts";

// A stand-in engine: echoes each line, and exits with code 3 on "quit".
const ECHO = "require('readline').createInterface({ input: process.stdin }).on('line', (l) => (l === 'quit' ? process.exit(3) : console.log(l)))";

/** A promise and the function that settles it. */
function signal(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

let engine: Engine | undefined;
afterEach(() => engine?.stop());

describe("the engine supervisor", () => {
  it("relays lines both ways and restarts the engine when it exits", async () => {
    const events: string[] = [];
    let ups = 0;
    const steps = { first: signal(), echoed: signal(), second: signal() };
    engine = superviseEngine(process.execPath, ["-e", ECHO], {
      up: () => {
        events.push("up");
        (++ups === 1 ? steps.first : steps.second).resolve();
      },
      down: (reason) => events.push(`down: ${reason}`),
      line: (line) => {
        events.push(`line: ${line}`);
        steps.echoed.resolve();
      },
    });
    await steps.first.promise;
    expect(engine.send("hello")).toBe(true);
    await steps.echoed.promise;
    engine.send("quit");
    await steps.second.promise;
    expect(events).toEqual(["up", "line: hello", "down: exited with code 3", "up"]);
  });
});
