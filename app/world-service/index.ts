// The world service: a utility process between the renderer and the engine.
// It pings the engine whenever one starts and tells the renderer whether it
// is connected, and it opens the world of the folder main names for each
// page: the engine reads the code, Jev (or the stand-in) judges it, and the
// laid-out world goes to the renderer over its MessagePort. When main names
// no folder, the page offers the start (the worlds opened before, a folder,
// or an address on GitHub) and the service opens whatever is chosen there,
// cloning a place on GitHub into the app's own data first.

import type { Unreachable } from "@gaia/schema";
import type { MessagePortMain } from "electron";
import { createEngineClient } from "./engine-client.ts";
import { openWorld } from "./open-world.ts";
import type { EngineStatus, FromMain, FromRenderer, StartChoice, ToMain, ToRenderer } from "./protocol.ts";
import { keepRecent, postcardOf, recentWorlds } from "./recent.ts";

const parent = process.parentPort;
const toMain = (message: ToMain): void => parent.postMessage(message);

const engine = createEngineClient((line) => toMain({ type: "engine.send", line }));
let status: EngineStatus = { state: "starting" };
let renderer: MessagePortMain | null = null;
let root: string | null = null;

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

/** Waits for an engine, for at most 20 seconds. */
async function engineUp(): Promise<void> {
  const up = await Promise.race([connected.promise.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 20_000))]);
  if (!up) throw new Error("The engine did not start. Build it with pnpm engine.");
}

/** Offers the start on one page: the worlds opened before, and why the last address led nowhere, if it did. */
async function offerStart(port: MessagePortMain, refused?: { address: string; why: Unreachable }): Promise<void> {
  try {
    await engineUp();
    const recent = await recentWorlds(engine);
    send(port, { type: "world.start", offer: refused === undefined ? { recent } : { recent, refused } });
  } catch (error) {
    send(port, { type: "world.failed", root: "", message: (error as Error).message });
  }
}

/** Opens the world for one page; whatever it says goes to that page's port only. `github` names a place cloned from GitHub. */
async function open(port: MessagePortMain, folder: string, github?: string): Promise<void> {
  try {
    await engineUp();
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
    const name = github ?? document.model.repository.name;
    toMain({ type: "world.opened", root: folder, name });
    await keepRecent(engine, { root: folder, name, ...(github === undefined ? {} : { github }), at: Date.now(), postcard: postcardOf(document.world) });
  } catch (error) {
    const message = (error as Error).message;
    console.error(`gaia: could not open ${folder}: ${message}`);
    send(port, { type: "world.failed", root: folder, message });
  }
}

/**
 * Opens the place chosen on the start page. An address is asked of GitHub
 * first, while the start page still shows, so one that leads nowhere is
 * answered there; then the wait covers the clone (or the fetch into the copy
 * kept from before) as the code being read.
 */
async function choose(port: MessagePortMain, place: StartChoice): Promise<void> {
  if ("folder" in place) return open(port, place.folder);
  const started = Date.now();
  try {
    await engineUp();
    const located = await engine.call("project.locate", { address: place.address });
    if (!located.found) return offerStart(port, { address: place.address, why: located.why });
    send(port, { type: "world.progress", opening: { stage: "reading", root: located.root } });
    const cloned = await engine.call("project.clone", { address: place.address });
    if (!cloned.cloned) return offerStart(port, { address: place.address, why: cloned.why });
    console.log(`gaia: ${cloned.fetched ? "fetched into" : "cloned"} ${cloned.owner}/${cloned.repo} in ${Date.now() - started} ms`);
    return open(port, cloned.root, `${cloned.owner}/${cloned.repo}`);
  } catch (error) {
    console.error(`gaia: could not reach ${place.address}: ${(error as Error).message}`);
    return offerStart(port, { address: place.address, why: "offline" });
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
        if (m.type === "world.open") void (root === null ? offerStart(port) : open(port, root));
        else if (m.type === "world.choose") void choose(port, m.place);
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
