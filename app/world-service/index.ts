// The world service, a utility process between the renderer and the engine.
// It opens the world for each page's folder, or offers the start page when main
// names none, and sends progress and the finished `WorldDocument` over the
// page's MessagePort. While a world is open, it polls the folder for new commits
// and sends each thing's new vitality from `refreshWorld`.

import type { Unreachable } from "@gaia/schema";
import type { MessagePortMain } from "electron";
import { createEngineClient } from "./engine-client.ts";
import { refreshWorld, openWorld } from "./open-world.ts";
import type { EngineStatus, FromMain, FromRenderer, StartChoice, ToMain, ToRenderer, WorldDocument } from "./protocol.ts";
import { keepPainting, keepRecent, keepLastSpot, offeredWorlds, lastSpotIn } from "./recent.ts";

const parent = process.parentPort;
const toMain = (message: ToMain): void => parent.postMessage(message);

const engine = createEngineClient((line) => toMain({ type: "engine.send", line }));
let status: EngineStatus = { state: "starting" };
let renderer: MessagePortMain | null = null;
let root: string | null = null;

/** Resolves once an engine answers a ping. The `engine.down` handler replaces it with an unresolved one. */
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

/** The folder each page opened and the commit its world was built from or refreshed onto. The page's paintings and positions are stored with that folder, and `sendSource` reads files at that commit. */
const openedOn = new WeakMap<MessagePortMain, { readonly folder: string; readonly commit?: string }>();
/** Runs writes to the recent worlds one at a time, so a painting's write cannot overlap the write of the visit it belongs to. */
let keeping: Promise<void> = Promise.resolve();
function keep(write: () => Promise<void>): Promise<void> {
  keeping = keeping.then(write).catch((error: unknown) => console.error(`gaia: could not keep the recent worlds: ${(error as Error).message}`));
  return keeping;
}

/** Settles the pending consent question, if any. A new page load rejects it. */
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
    // The engine exited during the ping. Its restart sends `engine.up`, which pings again.
    console.error(`gaia: engine.ping failed: ${(error as Error).message}`);
  }
}

/** Waits for an engine, for at most 20 seconds. */
async function engineUp(): Promise<void> {
  const up = await Promise.race([connected.promise.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 20_000))]);
  if (!up) throw new Error("The engine did not start. Build it with pnpm engine.");
}

/** Sends one page the start page's offer: the worlds opened before, and why the last address failed, if it did. */
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
 * Sends the lines of a file in the world `port` opened, which the engine reads at that world's commit. Sends null
 * when the file cannot be read or is outside the folder.
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
 * How often, in milliseconds, the service checks the shown world's folder for a new commit. A commit reaches the
 * world within a few seconds. Each check runs two git commands in the engine, about 10 ms for Gaia's 500 files, so
 * the engine, which serves one call at a time, spends well under 1% of its time on it.
 */
const COMMIT_EVERY_MS = 4_000;

/** The page whose folder is polled for new commits, and the polling timer. */
let watching: { readonly port: MessagePortMain; readonly timer: ReturnType<typeof setInterval> } | null = null;

function stopWatching(): void {
  if (watching !== null) clearInterval(watching.timer);
  watching = null;
}

/**
 * Polls the folder of the world `port` shows. On each new commit, `refreshWorld` judges the world again and the page
 * gets each thing's new vitality. One refresh runs at a time, and after a failed refresh the next commit tries again. A
 * world read from disk has no commit, so it is not polled.
 */
function watchCommits(port: MessagePortMain, document: WorldDocument): void {
  stopWatching();
  if (document.commit === undefined) return;
  let shown = document;
  let judgedAt = document.commit;
  let refreshing = false;
  const refresh = async (): Promise<void> => {
    // A restarting engine fails the call. The next poll tries again.
    const now = (await engine.call("project.commit", { root: shown.root }).catch(() => ({ commit: null }))).commit;
    if (now === null || now === judgedAt) return;
    judgedAt = now;
    const started = Date.now();
    const refreshed = await refreshWorld(engine, shown);
    if (watching?.port !== port) return;
    shown = refreshed.shown;
    openedOn.set(port, { folder: shown.root, ...(shown.commit === undefined ? {} : { commit: shown.commit }) });
    if (refreshed.update !== null) send(port, refreshed.update);
    const changed = Object.keys(refreshed.update?.vitality ?? {}).length;
    console.log(`gaia: refreshed ${shown.root} at ${now.slice(0, 8)} in ${Date.now() - started} ms: ${changed} things' vitality changed${shown.commit === now ? "" : "; the land changed, so its new layout appears at the next open"}`);
  };
  const timer = setInterval(() => {
    if (refreshing) return;
    refreshing = true;
    refresh()
      .catch((error: unknown) => console.error(`gaia: could not refresh ${shown.root}: ${(error as Error).message}`))
      .finally(() => (refreshing = false));
  }, COMMIT_EVERY_MS);
  watching = { port, timer };
}

/** Opens the world for one page and sends every message to that page's port only. `github` is the "owner/repo" of a clone. */
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
    const stood = await lastSpotIn(engine, folder);
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
 * Opens the place chosen on the start page. The engine checks an address with
 * GitHub while the start page still shows, so a bad address is reported there.
 * The wait then shows the clone, or the fetch into an earlier clone, as the
 * reading stage.
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
      // The old page can no longer answer the consent question. The next page's opening asks again.
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
          if (opened !== undefined) void keep(() => keepLastSpot(engine, opened.folder, m.stood));
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
