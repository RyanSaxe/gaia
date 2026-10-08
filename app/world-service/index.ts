// The world service: a utility process between the renderer and the engine.
// It pings the engine whenever one starts and tells the renderer whether it
// is connected, and it opens the world of the folder main names for each
// page: the engine reads the code, Jev (or the stand-in) judges it, and the
// laid-out world goes to the renderer over its MessagePort.

import type { MessagePortMain } from "electron";
import { createEngineClient } from "./engine-client.ts";
import { openWorld } from "./open-world.ts";
import type { EngineStatus, FromMain, FromRenderer, ToMain, ToRenderer } from "./protocol.ts";

const parent = process.parentPort;
const toMain = (message: ToMain): void => parent.postMessage(message);

const engine = createEngineClient((line) => toMain({ type: "engine.send", line }));
let status: EngineStatus = { state: "starting" };
let renderer: MessagePortMain | null = null;
let root = "";

/** Settles once an engine has answered a ping; a new one replaces it whenever the engine goes down. */
let connected = settleable();
function settleable(): { promise: Promise<void>; resolve: () => void; settled: boolean } {
  const s = { promise: Promise.resolve(), resolve: () => {}, settled: false };
  s.promise = new Promise<void>((resolve) => {
    s.resolve = () => {
      s.settled = true;
      resolve();
    };
  });
  return s;
}

/** The person's answer to the question in flight, if any: dropped when its page goes away. */
let consenting: { resolve: (approve: boolean) => void; reject: (e: Error) => void } | null = null;

function send(port: MessagePortMain | null, message: ToRenderer): void {
  port?.postMessage(message);
}

function report(next: EngineStatus): void {
  status = next;
  send(renderer, { type: "engine.status", status });
}

async function connect(): Promise<void> {
  try {
    const { version } = await engine.call("engine.ping", {});
    report({ state: "connected", version });
    connected.resolve();
  } catch (error) {
    // The engine went down mid-ping; its restart pings again.
    console.error(`gaia: engine.ping failed: ${(error as Error).message}`);
  }
}

/** Opens the world for one page; whatever it says goes to that page's port only. */
async function open(port: MessagePortMain, folder: string): Promise<void> {
  try {
    const up = await Promise.race([connected.promise.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 20_000))]);
    if (!up) throw new Error("The engine did not start. Build it with pnpm engine.");
    const document = await openWorld({
      engine,
      root: folder,
      progress: (opening) => send(port, { type: "world.progress", opening }),
      consent: (plan) =>
        new Promise<boolean>((resolve, reject) => {
          consenting = { resolve, reject };
          send(port, { type: "world.consent", plan });
        }),
    });
    console.log(`gaia: opened ${folder}: ${document.summary}`);
    send(port, { type: "world.document", document });
  } catch (error) {
    const message = (error as Error).message;
    console.error(`gaia: could not open ${folder}: ${message}`);
    send(port, { type: "world.failed", root: folder, message });
  }
}

parent.on("message", (event) => {
  const message = event.data as FromMain;
  switch (message.type) {
    case "engine.up":
      void connect();
      break;
    case "engine.down":
      engine.disconnect(`The engine ${message.reason}.`);
      if (connected.settled) connected = settleable();
      report({ state: "restarting" });
      break;
    case "engine.line":
      engine.receive(message.line);
      break;
    case "renderer.port": {
      renderer?.close();
      // A question asked of a page that is gone is never answered; the next page asks again.
      consenting?.reject(new Error("The page that was asked went away."));
      consenting = null;
      root = message.root;
      const port = event.ports[0] ?? null;
      renderer = port;
      port?.on("message", (e) => {
        const m = e.data as FromRenderer;
        if (m.type === "world.open") void open(port, root);
        else if (m.type === "world.consent") {
          consenting?.resolve(m.approve);
          consenting = null;
        }
      });
      port?.start();
      report(status);
      break;
    }
  }
});
