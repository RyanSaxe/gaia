// The page: the world, full screen at eye height, behind the wait until it
// stands. The world (`terrain/world.ts`) has the immersive layer over it
// (`immersive/view.ts`), both drawn by one loop at the clock's hour, and
// `window.__lab` holds the hooks scripted checks drive it through.

import "./lab.css";
import * as THREE from "three";
import { createClock } from "./clock.ts";
import { watchEngine } from "./engine-status.ts";
import { setFavicon } from "./brand/logo.ts";
import { createStats } from "./stats.ts";
import { reportStage, startTelemetry } from "./telemetry.ts";
import { OPENING_ASPECT, type World, createWorld, openingBuilds } from "./terrain/world.ts";
import { worldHooks } from "./terrain/hooks.ts";
import { makeAhead } from "./terrain/made.ts";
import { type Immersive, createImmersive } from "./immersive/view.ts";
import { type Sound, createSound } from "./sound/index.ts";
import { startWaitEarly } from "./wait/wait.ts";
import { Library, seedOf } from "@gaia/schema";
import { WORLD_PRIMITIVES } from "@gaia/primitives";
import { world as worldKind } from "@gaia/kinds";
import { realizeSky } from "@gaia/realize";
import { START_SKY } from "./start/table-scene.ts";

THREE.ColorManagement.enabled = false;
setFavicon();

const shell = document.getElementById("shell");
const root = document.querySelector<HTMLElement>(".world");
if (shell === null || root === null) throw new Error("Missing the world's container.");

// The first touch shows the touch controls, even where the primary pointer is a mouse.
window.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch") document.documentElement.classList.add("touch");
});

/** The engine's state in words, as the world service last reported it. */
let status = "";
watchEngine((text) => {
  status = text;
});

const clock = createClock();
// `?hour=22` pins the hour from the start, so a phone can see the world at night.
const askedHour = new URLSearchParams(location.search).get("hour");
if (askedHour !== null && Number.isFinite(Number(askedHour))) clock.pin(Number(askedHour));

const stats = createStats();

let world: World | null = null;
let immersive: Immersive | null = null;
let sound: Sound | null = null;
/** The world's hooks, `__lab.terrain`, once it is made. */
let hooks: Readonly<Record<string, unknown>> | null = null;

let last = performance.now();
function loop(now: number): void {
  const elapsed = (now - last) / 1000;
  const dt = Math.min(0.05, elapsed);
  last = now;
  if (world !== null) {
    stats.begin(world.renderer);
    world.frame(dt, now, clock.hour());
    immersive?.frame(dt);
    sound?.frame();
    stats.end(world.renderer, elapsed);
  }
  requestAnimationFrame(loop);
}

// The wait's sheet shows first, so no one ever sees the world's bare frame. The trees and bushes every world opens
// with are made on other threads meanwhile, and the world's page is built once they are and the sheet has been drawn.
const builds = makeAhead(openingBuilds());
// The start's night at the clock's hour, to the twentieth the world's first frame sets it to.
const sky = realizeSky({ blueprint: START_SKY, kind: worldKind }, new Library(WORLD_PRIMITIVES), seedOf("terrain-lab/sky"), clock.hour());
// In the app every world opens from the start's map table, chosen there or opened straight, so the sheet waits under it.
startWaitEarly(shell, Math.round(sky.light.nightness * 20) / 20, OPENING_ASPECT, window.gaiaShell !== undefined);
const drawn = new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
/** Settles once the world's page is built: scripted checks look at the world only after it, as a person sees it. */
const opened: Promise<World> = Promise.all([builds, drawn]).then(() => {
  const made = createWorld(root);
  // The immersive layer joins the world before its first bake lands, so the markers stand on it.
  immersive = createImmersive(root, made.handle);
  made.setActive(true);
  immersive.setActive(true);
  world = made;
  const shown = immersive;
  sound = createSound(made.handle, () => shown.book());
  hooks = worldHooks(made.inside);
  requestAnimationFrame(loop);
  return made;
});

// Served to a device by `pnpm lab:serve`, the page says how far it got opening
// a world, and any error on the way, so a device that fails says where.
reportStage("page");
window.addEventListener("error", (e) => reportStage("error", { message: String(e.message).slice(0, 300) }));
window.addEventListener("unhandledrejection", (e) => reportStage("error", { message: String((e.reason as Error | undefined)?.message ?? e.reason).slice(0, 300) }));

// Served to a device by `pnpm lab:serve`, the page reports how smooth it runs there.
if (
  startTelemetry(() => ({
    userAgent: navigator.userAgent,
    dpr: window.devicePixelRatio,
    viewport: [window.innerWidth, window.innerHeight],
    ...world?.report(),
    smooth: stats.smoothness(),
    ...stats.passes(),
  }))
) {
  stats.count(true);
}

/** Resolves after `n` frames. */
const frames = (n: number): Promise<void> =>
  new Promise((resolve) => {
    const step = (k: number): void => {
      if (k <= 0) resolve();
      else requestAnimationFrame(() => step(k - 1));
    };
    step(n);
  });

declare global {
  interface Window {
    __lab: unknown;
  }
}
window.__lab = {
  /** Waits until the world has something to show, its first world standing. The page shows only the world, "immersive". */
  open: async (view = "immersive") => {
    if (view !== "immersive") throw new Error(`No view named ${view}: the page shows only the world, "immersive".`);
    const made = await opened;
    await made.ready;
    await frames(3);
  },
  /** Pins the hour every world shows, or `null` to follow the clock. */
  hour: async (h: number | null) => {
    clock.pin(h);
    await frames(3);
  },
  /** The engine's state in words. */
  status: () => status,
  /** The latest frame time, draw calls and the last ten seconds' smoothness; counting starts with the first call. */
  stats: () => stats.read(),
  /** The smoothness probe's last ten seconds. */
  smoothness: () => stats.smoothness(),
  frames,
  /** The world's hooks (`terrain/hooks.ts`). */
  terrain: new Proxy({}, { get: (_, key: string) => hooks?.[key] }),
  /** The immersive world's hooks: the map, a jump, the slip in the corner, and what each way of knowing where you are shows. */
  immersive: new Proxy({}, { get: (_, key: string) => immersive?.hook[key] }),
  /** The world's sound (`sound/index.ts`): with `?sound=record`, what the person hears kept and rendered offline. */
  sound: new Proxy({}, { get: (_, key: string) => sound?.hook[key] }),
};
