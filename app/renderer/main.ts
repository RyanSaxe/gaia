// The renderer's entry point. It shows the wait first, then builds the world
// (`terrain/world.ts`) with the immersive layer over it (`immersive/view.ts`)
// and draws both in one loop at the clock's hour. `window.__lab` holds the
// hooks that scripted checks call.

import "./lab.css";
import * as THREE from "three";
import { createClock } from "./clock.ts";
import { watchEngine } from "./engine-status.ts";
import { setFavicon } from "./brand/logo.ts";
import { createStats } from "./stats.ts";
import { reportStage, startTelemetry } from "./telemetry.ts";
import { OPENING_ASPECT, type World, createWorld } from "./terrain/world.ts";
import { worldHooks } from "./terrain/hooks.ts";
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

/** The last engine status text from the world service. */
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
/** The world's hooks for `__lab.terrain`, set once the world is created. */
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

// The wait's sheet shows first, so the world's empty first frame is never visible. The world is built after the
// sheet has been drawn.
// The start sky's darkness at the clock's hour, rounded to the nearest 0.05 as the world's first frame rounds it.
const sky = realizeSky({ blueprint: START_SKY, kind: worldKind }, new Library(WORLD_PRIMITIVES), seedOf("terrain-lab/sky"), clock.hour());
// In the app every world opens from the start page's map table, whether chosen there or opened directly, so the sheet
// starts under the table.
startWaitEarly(shell, Math.round(sky.light.nightness * 20) / 20, OPENING_ASPECT, window.gaiaShell !== undefined);
const drawn = new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
/** Resolves once the world is built. Scripted checks wait for it, so they see the world as a person does. */
const opened: Promise<World> = drawn.then(() => {
  const made = createWorld(root);
  // The immersive layer must exist before the world's first bake finishes, so its markers are placed on that bake.
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

// When `pnpm lab:serve` serves the page to a device, the page reports each
// opening stage and any error, so a failing device shows where it stopped.
reportStage("page");
window.addEventListener("error", (e) => reportStage("error", { message: String(e.message).slice(0, 300) }));
window.addEventListener("unhandledrejection", (e) => reportStage("error", { message: String((e.reason as Error | undefined)?.message ?? e.reason).slice(0, 300) }));

// When `pnpm lab:serve` serves the page to a device, the page reports its frame smoothness.
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
  /** Resolves once the first world is ready and three frames have drawn. The only view is "immersive". */
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
  /** The latest frame time, draw calls and the last ten seconds' smoothness. Counting starts with the first call. */
  stats: () => stats.read(),
  /** The smoothness probe's last ten seconds. */
  smoothness: () => stats.smoothness(),
  frames,
  /** The world's hooks (`terrain/hooks.ts`). */
  terrain: new Proxy({}, { get: (_, key: string) => hooks?.[key] }),
  /** The immersive layer's hooks, such as the map, a jump, the corner slip and the state of each wayfinding aid. */
  immersive: new Proxy({}, { get: (_, key: string) => immersive?.hook[key] }),
  /** The world's sound hooks (`sound/index.ts`). With `?sound=record`, they record what the person hears and render it offline. */
  sound: new Proxy({}, { get: (_, key: string) => sound?.hook[key] }),
};
