// The lab's shell. It opens into the world, full screen and immersive; its
// debugging views (Components, Terrain and Skies) sit behind tabs, with one
// drawing loop for the open view and the engine's status. The immersive
// world is the terrain lab's world without its chrome. Each lab is built the
// first time its view opens.

import "./lab.css";
import * as THREE from "three";
import { createClock } from "./clock.ts";
import { watchEngine } from "./engine-status.ts";
import { createFloraLab } from "./flora/lab.ts";
import type { Lab } from "./lab.ts";
import { createStats } from "./stats.ts";
import { startTelemetry } from "./telemetry.ts";
import { type TerrainLab, createTerrainLab } from "./terrain/lab.ts";
import { type Immersive, createImmersive } from "./immersive/view.ts";
import { createWorldLab } from "./world/lab.ts";

THREE.ColorManagement.enabled = false;

const LABS = {
  flora: createFloraLab,
  terrain: createTerrainLab,
  world: createWorldLab,
} as const satisfies Record<string, (root: HTMLElement) => Lab>;
type Tab = keyof typeof LABS;
const TABS = Object.keys(LABS) as Tab[];
/** What the shell can show: the immersive world, or one lab's debugging view. */
type View = Tab | "immersive";
const VIEWS: readonly View[] = ["immersive", ...TABS];
const DEBUG_VIEWS = [
  { id: "flora", name: "Components" },
  { id: "terrain", name: "Terrain" },
  { id: "world", name: "Skies" },
] as const;
/** The immersive world is the terrain lab's world, shown without its chrome. */
const tabOf = (view: View): Tab => (view === "immersive" ? "terrain" : view);

const shell = document.getElementById("shell");
const built = new Map<Tab, Lab>();
let immersive: Immersive | null = null;
let current: View = "immersive";

function labOf(tab: Tab): Lab {
  let lab = built.get(tab);
  if (lab === undefined) {
    const root = document.querySelector<HTMLElement>(`[data-lab="${tab}"]`);
    if (root === null) throw new Error(`Missing the ${tab} lab's container.`);
    lab = LABS[tab](root);
    built.set(tab, lab);
    // The immersive layer joins the terrain lab before its first bake lands, so the markers stand on it.
    if (tab === "terrain") immersive = createImmersive(root, (lab as TerrainLab).world, { views: DEBUG_VIEWS, leave: (id) => open(id as View) });
  }
  return lab;
}

function open(view: View): void {
  current = view;
  const tab = tabOf(view);
  shell?.classList.toggle("immersive", view === "immersive");
  for (const t of TABS) document.querySelector<HTMLElement>(`[data-lab="${t}"]`)?.toggleAttribute("hidden", t !== tab);
  for (const v of VIEWS) {
    const button = document.querySelector<HTMLElement>(`[data-tab="${v}"]`);
    button?.classList.toggle("on", v === view);
    button?.setAttribute("aria-selected", String(v === view));
  }
  for (const [t, lab] of built) if (t !== tab) lab.setActive(false);
  const lab = labOf(tab);
  if (tab === "terrain") (lab as TerrainLab).world.immersive(view === "immersive");
  lab.setActive(true);
  immersive?.setActive(view === "immersive");
}

for (const button of document.querySelectorAll<HTMLElement>("[data-tab]")) {
  const view = button.dataset.tab as View;
  if (VIEWS.includes(view)) button.addEventListener("click", () => open(view));
}

// The first touch shows the touch controls, even where the primary pointer is a mouse.
window.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch") document.documentElement.classList.add("touch");
});

const statusBar = document.getElementById("status");
const statusLine = document.getElementById("status-text");
watchEngine((text, state) => {
  if (statusLine !== null) statusLine.textContent = text;
  if (statusBar !== null) statusBar.dataset.state = state;
});

const clockRoot = document.getElementById("clock");
if (clockRoot === null) throw new Error("Missing the time control's container.");
const clock = createClock(clockRoot);
// `?hour=22` pins the hour from the start, so a phone can see the world at night without the lab's clock.
const askedHour = new URLSearchParams(location.search).get("hour");
if (askedHour !== null && Number.isFinite(Number(askedHour))) clock.pin(Number(askedHour));

const statsToggle = document.getElementById("stats-toggle");
const statsReadout = document.getElementById("stats");
if (!(statsToggle instanceof HTMLButtonElement) || statsReadout === null) throw new Error("Missing the dev readout's elements.");
const stats = createStats(statsToggle, statsReadout);

let last = performance.now();
function loop(now: number): void {
  const elapsed = (now - last) / 1000;
  const dt = Math.min(0.05, elapsed);
  last = now;
  const lab = labOf(tabOf(current));
  stats.begin(lab.renderer);
  lab.frame(dt, now, clock.hour());
  if (current === "immersive") immersive?.frame(dt);
  stats.end(lab.renderer, elapsed);
  requestAnimationFrame(loop);
}

// `?view=terrain` opens a debugging view first; the lab otherwise opens into the world.
const askedView = new URLSearchParams(location.search).get("view") as View | null;
open(askedView !== null && VIEWS.includes(askedView) ? askedView : "immersive");
requestAnimationFrame(loop);

// Served to a device by `pnpm lab:serve`, the lab reports how smooth it runs there.
if (
  startTelemetry(() => ({
    userAgent: navigator.userAgent,
    dpr: window.devicePixelRatio,
    viewport: [window.innerWidth, window.innerHeight],
    tab: current,
    ...labOf(tabOf(current)).report?.(),
    smooth: stats.smoothness(),
    ...stats.passes(),
  }))
) {
  stats.count(true);
}

// A hook for scripted checks and `pnpm shots`.
const frames = (n: number): Promise<void> =>
  new Promise((resolve) => {
    const step = (k: number): void => {
      if (k <= 0) resolve();
      else requestAnimationFrame(() => step(k - 1));
    };
    step(n);
  });

const allShots = () => TABS.flatMap((tab) => labOf(tab).shots().map((shot) => ({ tab, shot })));

declare global {
  interface Window {
    __lab: unknown;
  }
}
window.__lab = {
  /** Opens a view ("immersive", or a lab's tab) and waits until it has something to show, such as its first baked world. */
  open: async (view: View) => {
    open(view);
    await labOf(tabOf(view)).ready;
    await frames(3);
  },
  tab: () => current,
  /** Pins the hour every world shows, or `null` to follow the clock. */
  hour: async (h: number | null) => {
    clock.pin(h);
    await frames(3);
  },
  status: () => statusLine?.textContent ?? "",
  /** The dev readout's latest frame time, draw calls and the last ten seconds' smoothness, or null while it is off. */
  stats: () => stats.read(),
  /** The smoothness probe's last ten seconds, whether or not the readout shows. */
  smoothness: () => stats.smoothness(),
  frames,
  shots: () => allShots().map((s) => s.shot.name),
  stage: async (name: string) => {
    const found = allShots().find((s) => s.shot.name === name);
    if (found === undefined) throw new Error(`No shot named ${name}.`);
    open(found.tab);
    await labOf(found.tab).ready;
    await found.shot.stage();
    await frames(6);
  },
  ...Object.fromEntries(TABS.map((tab) => [tab, new Proxy({}, { get: (_, key: string) => labOf(tab).hook[key] })])),
  /** The immersive world's hooks: its way of finding one's way, the map, and what each shows. */
  immersive: new Proxy({}, { get: (_, key: string) => (labOf("terrain"), immersive?.hook[key]) }),
};
