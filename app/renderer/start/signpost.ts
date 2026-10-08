// The world's edge: standing where the land begins, at the hour it is, by a
// signpost. Its arms name the worlds walked before, one points somewhere on
// this computer, and one is blank, to write an address on. The hills fall
// away into haze behind it; after dark its lantern is lit and a few
// fireflies drift. Choosing a place, the view dissolves into the wait's
// paper.

import type { StartChoice, StartOffer } from "../../world-service/protocol.ts";
import { hashOf } from "./paint.ts";
import { REFUSALS, type StartPage, askFolder, placeOf } from "./choice.ts";

/** The edge's painting: sky, sun and moon, hills in haze, the path setting out, and the grass at the person's feet. */
const SCENE = /* svg */ `
<svg class="edge-scene" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs>
    <linearGradient id="edge-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="sky-top"/><stop offset="0.55" class="sky-mid"/><stop offset="0.8" class="sky-low"/>
    </linearGradient>
    <radialGradient id="edge-glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" class="glow-in"/><stop offset="1" class="glow-out"/></radialGradient>
    <linearGradient id="edge-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="far-top"/><stop offset="1" class="far-low"/></linearGradient>
    <linearGradient id="edge-mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="mid-top"/><stop offset="1" class="mid-low"/></linearGradient>
    <linearGradient id="edge-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="near-top"/><stop offset="1" class="near-low"/></linearGradient>
    <linearGradient id="edge-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ground-top"/><stop offset="1" class="ground-low"/></linearGradient>
    <filter id="edge-soft" x="-10%" y="-150%" width="120%" height="400%"><feGaussianBlur stdDeviation="16"/></filter>
    <filter id="edge-brush" x="-2%" y="-2%" width="104%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.012 0.04" numOctaves="3" seed="3" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
  <rect width="1600" height="1000" fill="url(#edge-sky)"/>
  <g class="edge-stars">${stars()}</g>
  <circle class="edge-sun-glow" cx="1180" cy="430" r="260" fill="url(#edge-glow)"/>
  <circle class="edge-sun" cx="1180" cy="430" r="26"/>
  <circle class="edge-moon" cx="1260" cy="190" r="20"/>
  <g filter="url(#edge-brush)">
    <path class="edge-cloud" d="M120 250 q80 -40 170 -8 q60 -30 130 4 q50 -6 70 16 q-200 18 -370 -12z"/>
    <path class="edge-cloud" d="M880 170 q90 -34 190 -4 q70 -26 140 8 q-170 14 -330 -4z"/>
    <path fill="url(#edge-far)" d="M0 560 C 120 520 210 470 330 488 C 440 500 520 430 640 446 C 760 462 820 520 930 512 C 1060 500 1130 420 1260 432 C 1380 444 1470 500 1600 492 L1600 1100 L0 1100Z"/>
    <rect class="edge-mist" x="0" y="520" width="1600" height="80" filter="url(#edge-soft)"/>
    <path fill="url(#edge-mid)" d="M0 640 C 140 600 260 590 380 612 C 520 638 600 590 740 580 C 880 570 980 626 1120 618 C 1260 610 1380 572 1600 600 L1600 1100 L0 1100Z"/>
    <g class="edge-woods">${woods()}</g>
    <rect class="edge-mist" x="0" y="640" width="1600" height="70" filter="url(#edge-soft)"/>
    <path fill="url(#edge-near)" d="M0 730 C 200 700 360 716 520 740 C 700 766 860 720 1040 712 C 1220 704 1400 742 1600 728 L1600 1100 L0 1100Z"/>
    <path fill="url(#edge-ground)" d="M0 820 C 220 800 420 808 620 826 C 820 844 1080 812 1280 806 C 1420 802 1520 812 1600 818 L1600 1100 L0 1100Z"/>
    <path class="edge-path" d="M760 1000 C 800 930 860 880 930 846 C 990 818 1060 800 1120 780 C 1150 770 1180 756 1196 742 L 1204 744 C 1192 760 1166 776 1132 792 C 1080 818 1020 842 972 872 C 910 912 880 960 880 1000Z"/>
  </g>
  <g class="edge-grass">${grass("grass", 150)}</g>
</svg>`;

/** Grass in front of the signpost's foot. */
const FORE = /* svg */ `<svg class="edge-fore" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><g class="edge-grass">${grass("fore", 60, 0.3, 0.42)}</g></svg>`;

function stars(): string {
  let s = "";
  for (let i = 0; i < 70; i++) {
    const x = hashOf("star", i) * 1600;
    const y = hashOf("star", i + 100) * 420;
    const r = 0.6 + hashOf("star", i + 200) * 1.3;
    s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(2)}" style="--tw:${(2 + hashOf("star", i + 300) * 4).toFixed(1)}s"/>`;
  }
  return s;
}

function woods(): string {
  let s = "";
  for (let i = 0; i < 26; i++) {
    const x = 60 + hashOf("wood", i) * 1500;
    const base = 610 + Math.sin(x / 210) * 14 + hashOf("wood", i + 50) * 14;
    const r = 10 + hashOf("wood", i + 9) * 16;
    s += `<ellipse cx="${x.toFixed(0)}" cy="${(base - r * 0.6).toFixed(0)}" rx="${(r * 0.9).toFixed(0)}" ry="${r.toFixed(0)}"/>`;
  }
  return s;
}

/** Blades of grass across [from, to] of the width, rooted near the foot of the view. */
function grass(seed: string, count: number, from = 0, to = 1): string {
  let s = "";
  for (let i = 0; i < count; i++) {
    const x = (from + hashOf(seed, i) * (to - from)) * 1640 - 20;
    const y = 1004 - hashOf(seed, i + 7) * 110;
    const h = 30 + hashOf(seed, i + 13) * 50 * (1 - (1000 - y) / 200);
    const lean = (hashOf(seed, i + 21) - 0.5) * 24;
    s += `<path d="M${x.toFixed(0)} ${y.toFixed(0)} q${(lean * 0.4).toFixed(0)} ${(-h * 0.6).toFixed(0)} ${lean.toFixed(0)} ${(-h).toFixed(0)}" style="--d:${(hashOf(seed, i + 31) * -6).toFixed(1)}s"/>`;
  }
  return s;
}

const baseName = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;
const nameOf = (r: StartOffer["recent"][number]): string => (r.github !== undefined ? (r.github.split("/")[1] ?? r.name) : r.name);
const whereOf = (r: StartOffer["recent"][number]): string => (r.github !== undefined ? `GitHub · ${r.github.split("/")[0] ?? ""}` : (r.root.includes("/") ? baseName(r.root.slice(0, r.root.lastIndexOf("/"))) : ""));

export function createSignpost(veil: HTMLElement): StartPage {
  const root = document.createElement("div");
  root.className = "start start-signpost";
  root.innerHTML = /* html */ `
    ${SCENE}
    <div class="edge-post">
      <div class="post-pole"></div>
      <div class="post-lantern"><span></span></div>
      <div class="post-arms"></div>
      <p class="edge-answer" aria-live="polite"></p>
    </div>
    ${FORE}
    <div class="edge-flies">${Array.from({ length: 9 }, (_, i) => `<span style="--x:${(8 + hashOf("fly", i) * 84).toFixed(1)}%;--y:${(48 + hashOf("fly", i + 9) * 40).toFixed(1)}%;--d:${(hashOf("fly", i + 18) * -9).toFixed(1)}s"></span>`).join("")}</div>`;
  veil.append(root);
  const arms = root.querySelector(".post-arms") as HTMLElement;
  const answer = root.querySelector(".edge-answer") as HTMLElement;

  // The blank arm, to write on, and the one pointing somewhere on this computer.
  const blank = document.createElement("form");
  blank.className = "arm arm-blank";
  blank.setAttribute("autocomplete", "off");
  blank.innerHTML = `<input name="address" type="text" placeholder="write an address · github.com/…" aria-label="The address of a place on GitHub" spellcheck="false" autocapitalize="off" autocomplete="off">`;
  const input = blank.querySelector("input") as HTMLInputElement;
  const folder = document.createElement("button");
  folder.type = "button";
  folder.className = "arm arm-folder";
  folder.innerHTML = `<span class="arm-name">somewhere on this computer</span>`;

  let settle: ((place: StartChoice) => void) | null = null;
  const choose = (place: StartChoice): void => {
    const s = settle;
    settle = null;
    s?.(place);
  };
  blank.addEventListener("submit", (e) => {
    e.preventDefault();
    const address = input.value.trim();
    if (address === "" || settle === null) return;
    root.classList.remove("refused");
    blank.classList.add("reading");
    choose({ address });
  });
  input.addEventListener("input", () => root.classList.remove("refused"));
  folder.addEventListener("click", () => {
    void askFolder().then((f) => {
      if (f !== null) choose({ folder: f });
    });
  });

  return {
    offer(offer) {
      const named = offer.recent.slice(0, 5).map((r, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `arm ${i % 2 === 0 ? "arm-east" : "arm-west"}`;
        b.style.setProperty("--tilt", `${((hashOf(r.root) - 0.5) * 7).toFixed(2)}deg`);
        const name = document.createElement("span");
        name.className = "arm-name";
        name.textContent = nameOf(r);
        const where = document.createElement("span");
        where.className = "arm-where";
        where.textContent = whereOf(r);
        b.append(name, where);
        b.addEventListener("click", () => {
          if (settle === null) return;
          b.classList.add("chosen");
          choose(placeOf(r));
        });
        return b;
      });
      folder.classList.toggle("arm-east", named.length % 2 === 0);
      folder.classList.toggle("arm-west", named.length % 2 === 1);
      folder.style.setProperty("--tilt", "1.6deg");
      blank.classList.add(named.length % 2 === 0 ? "arm-west" : "arm-east");
      blank.style.setProperty("--tilt", "-1.2deg");
      arms.replaceChildren(...named, folder, blank);
      blank.classList.remove("reading");
      if (offer.refused !== undefined) {
        input.value = offer.refused.address;
        answer.textContent = REFUSALS[offer.refused.why];
        root.classList.remove("refused");
        void root.offsetWidth;
        root.classList.add("refused");
        input.focus({ preventScroll: true });
      }
      requestAnimationFrame(() => root.classList.add("shown"));
      return new Promise((resolve) => (settle = resolve));
    },
    leave() {
      settle = null;
      root.classList.add("leaving");
      window.setTimeout(() => root.remove(), 1400);
    },
  };
}
