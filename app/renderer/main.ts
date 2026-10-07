// The lab's shell: three tabs, one drawing loop for the open tab, and the
// engine's status. Each lab is built the first time its tab opens.

import "./lab.css";
import * as THREE from "three";
import { createClock } from "./clock.ts";
import { watchEngine } from "./engine-status.ts";
import { createFloraLab } from "./flora/lab.ts";
import type { Lab } from "./lab.ts";
import { createStats } from "./stats.ts";
import { createTerrainLab } from "./terrain/lab.ts";
import { createWorldLab } from "./world/lab.ts";

THREE.ColorManagement.enabled = false;

const LABS = {
  flora: createFloraLab,
  terrain: createTerrainLab,
  world: createWorldLab,
} as const satisfies Record<string, (root: HTMLElement) => Lab>;
type Tab = keyof typeof LABS;
const TABS = Object.keys(LABS) as Tab[];

const built = new Map<Tab, Lab>();
let current: Tab = "flora";

function labOf(tab: Tab): Lab {
  let lab = built.get(tab);
  if (lab === undefined) {
    const root = document.querySelector<HTMLElement>(`[data-lab="${tab}"]`);
    if (root === null) throw new Error(`Missing the ${tab} lab's container.`);
    lab = LABS[tab](root);
    built.set(tab, lab);
  }
  return lab;
}

function open(tab: Tab): void {
  current = tab;
  for (const t of TABS) {
    const on = t === tab;
    document.querySelector<HTMLElement>(`[data-lab="${t}"]`)?.toggleAttribute("hidden", !on);
    const button = document.querySelector<HTMLElement>(`[data-tab="${t}"]`);
    button?.classList.toggle("on", on);
    button?.setAttribute("aria-selected", String(on));
  }
  for (const [t, lab] of built) if (t !== tab) lab.setActive(false);
  labOf(tab).setActive(true);
}

for (const button of document.querySelectorAll<HTMLElement>("[data-tab]")) {
  const tab = button.dataset.tab as Tab;
  if (tab in LABS) button.addEventListener("click", () => open(tab));
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

const statsToggle = document.getElementById("stats-toggle");
const statsReadout = document.getElementById("stats");
if (!(statsToggle instanceof HTMLButtonElement) || statsReadout === null) throw new Error("Missing the dev readout's elements.");
const stats = createStats(statsToggle, statsReadout);

let last = performance.now();
function loop(now: number): void {
  const elapsed = (now - last) / 1000;
  const dt = Math.min(0.05, elapsed);
  last = now;
  const lab = labOf(current);
  stats.begin(lab.renderer);
  lab.frame(dt, now, clock.hour());
  stats.end(lab.renderer, elapsed);
  requestAnimationFrame(loop);
}

open("flora");
requestAnimationFrame(loop);

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
  open: async (tab: Tab) => {
    open(tab);
    await frames(3);
  },
  tab: () => current,
  /** Pins the hour every world shows, or `null` to follow the clock. */
  hour: async (h: number | null) => {
    clock.pin(h);
    await frames(3);
  },
  status: () => statusLine?.textContent ?? "",
  /** The dev readout's latest frame time and draw calls, or null while it is off. */
  stats: () => stats.read(),
  frames,
  shots: () => allShots().map((s) => s.shot.name),
  stage: async (name: string) => {
    const found = allShots().find((s) => s.shot.name === name);
    if (found === undefined) throw new Error(`No shot named ${name}.`);
    open(found.tab);
    found.shot.stage();
    await frames(6);
  },
  ...Object.fromEntries(TABS.map((tab) => [tab, new Proxy({}, { get: (_, key: string) => labOf(tab).hook[key] })])),
};
