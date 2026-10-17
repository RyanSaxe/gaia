// The world service: a utility process between the renderer and the engine.
// It pings the engine whenever one starts and tells the renderer whether it
// is connected, and it opens the world of the folder main names for each
// page: the engine reads the code, Jev judges it, and the
// laid-out world goes to the renderer over its MessagePort. When main names
// no folder, the page offers the start (the worlds opened before, a folder,
// or an address on GitHub) and the service opens whatever is chosen there,
// cloning a place on GitHub into the app's own data first. Once a world
// stands, its page sends where the person stands as they walk, which the
// world's next open lands them at, and a painting of where they stand still,
// which the start lays on its table as the world's card: both kept with it
// among the recent worlds. While a world stands, its folder is asked now and
// then for a new commit, and on one the world is judged again and the page
// sent each thing's new vitality (`world.vitality`), which it eases to in
// place.

import type { Unreachable } from "@gaia/schema";
import type { MessagePortMain } from "electron";
import { createEngineClient } from "./engine-client.ts";
import { healWorld, openWorld } from "./open-world.ts";
import type { EngineStatus, FromMain, FromRenderer, StartChoice, ToMain, ToRenderer, WorldDocument } from "./protocol.ts";
import { keepPainting, keepRecent, keepStood, offeredWorlds, stoodIn } from "./recent.ts";

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

/** The folder whose world each page opened and the commit it was built from or healed onto: what the page sends is kept with it, and the journal reads that commit. */
const openedOn = new WeakMap<MessagePortMain, { readonly folder: string; readonly commit?: string }>();
/** Writes to the recent worlds, one after another, so a painting never races the visit it belongs to. */
let keeping: Promise<void> = Promise.resolve();
function keep(write: () => Promise<void>): Promise<void> {
  keeping = keeping.then(write).catch((error: unknown) => console.error(`gaia: could not keep the recent worlds: ${(error as Error).message}`));
  return keeping;
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
    const recent = await offeredWorlds(engine);
    send(port, { type: "world.start", offer: refused === undefined ? { recent } : { recent, refused } });
  } catch (error) {
    send(port, { type: "world.failed", root: "", message: (error as Error).message });
  }
}

/**
 * Sends a file of the world `port` opened, as its lines, read by the engine from the commit that world was built
 * from or healed onto; null when it can't be read or lies outside that folder.
 */
async function sendSource(port: MessagePortMain, path: string): Promise<void> {
  const opened = openedOn.get(port);
  let lines: readonly string[] | null = null;
  if (opened !== undefined) {
    try {
      lines = (await engine.call("project.source", { root: opened.folder, path, ...(opened.commit === undefined ? {} : { commit: opened.commit }) })).lines;
    } catch {
      lines = null;
    }
  }
  send(port, { type: "world.source", path, lines });
}

/**
 * How often the folder of the world a page shows is asked which commit it is read from now, ms. A commit shows in the
 * world within a few seconds of being made, and each ask is two git commands in the engine (about 10 ms for Gaia's 500
 * files), so the engine, which serves one call at a time, spends well under 1% of its time on it.
 */
const COMMIT_EVERY_MS = 4_000;

/** The page whose world's folder is watched for new commits, and the timer that asks. */
let watching: { readonly port: MessagePortMain; readonly timer: ReturnType<typeof setInterval> } | null = null;

function stopWatching(): void {
  if (watching !== null) clearInterval(watching.timer);
  watching = null;
}

/**
 * Heals the world `port` shows as its folder's code moves on: on each new commit the world is judged again
 * (`healWorld`) and the page is sent each thing's new vitality. One heal runs at a time, and a heal that fails waits
 * for the next commit. A world read from disk has no commits to notice.
 */
function watchCommits(port: MessagePortMain, document: WorldDocument): void {
  stopWatching();
  if (document.commit === undefined) return;
  let shown = document;
  let judgedAt = document.commit;
  let healing = false;
  const heal = async (): Promise<void> => {
    // The engine restarting answers nothing for a moment; the next ask tries again.
    const now = (await engine.call("project.commit", { root: shown.root }).catch(() => ({ commit: null }))).commit;
    if (now === null || now === judgedAt) return;
    judgedAt = now;
    const started = Date.now();
    const healed = await healWorld(engine, shown);
    if (watching?.port !== port) return;
    shown = healed.shown;
    openedOn.set(port, { folder: shown.root, ...(shown.commit === undefined ? {} : { commit: shown.commit }) });
    if (healed.heal !== null) send(port, healed.heal);
    const changed = Object.keys(healed.heal?.vitality ?? {}).length;
    console.log(`gaia: healed ${shown.root} at ${now.slice(0, 8)} in ${Date.now() - started} ms: ${changed} things' vitality changed${shown.commit === now ? "" : "; the land moved, so its new shape waits for the next open"}`);
  };
  const timer = setInterval(() => {
    if (healing) return;
    healing = true;
    heal()
      .catch((error: unknown) => console.error(`gaia: could not heal ${shown.root}: ${(error as Error).message}`))
      .finally(() => (healing = false));
  }, COMMIT_EVERY_MS);
  watching = { port, timer };
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
    const stood = await stoodIn(engine, folder);
    send(port, { type: "world.document", document, ...(stood === undefined ? {} : { stood }) });
    const name = github ?? document.facts.repository.name;
    toMain({ type: "world.opened", root: folder, name });
    openedOn.set(port, { folder, ...(document.commit === undefined ? {} : { commit: document.commit }) });
    watchCommits(port, document);
    await keep(() => keepRecent(engine, { root: folder, name, ...(github === undefined ? {} : { github }), at: Date.now(), ...(document.commit === undefined ? {} : { commit: document.commit }) }));
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
      stopWatching();
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
        else if (m.type === "world.source") void sendSource(port, m.path);
        else if (m.type === "world.painting") {
          const opened = openedOn.get(port);
          if (opened !== undefined) void keep(() => keepPainting(engine, opened.folder, m.painting));
        } else if (m.type === "world.stood") {
          const opened = openedOn.get(port);
          if (opened !== undefined) void keep(() => keepStood(engine, opened.folder, m.stood));
        }
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
