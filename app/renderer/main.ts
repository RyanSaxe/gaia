// The lab's shell: three tabs, one drawing loop for the open tab, and the
// engine's status. Each lab is built the first time its tab opens.

import "./lab.css";
import * as THREE from "three";
import { watchEngine } from "./engine-status.ts";
import { createFloraLab } from "./flora/lab.ts";
import type { Lab } from "./lab.ts";

THREE.ColorManagement.enabled = false;

const LABS = {
  flora: createFloraLab,
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

const statusBar = document.getElementById("status");
const statusLine = document.getElementById("status-text");
watchEngine((text, state) => {
  if (statusLine !== null) statusLine.textContent = text;
  if (statusBar !== null) statusBar.dataset.state = state;
});

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  labOf(current).frame(dt, now);
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
  status: () => statusLine?.textContent ?? "",
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
