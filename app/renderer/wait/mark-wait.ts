// The mark gathers: Gaia's mark on the sky, its firefly glowing over the
// "i", and fireflies drifting in from the edges to gather into that glow as
// the world is read, judged and baked. The glow grows with how much is
// done; nothing counts or speaks. Each firefly drifts by its own CSS
// animation and gathers by a CSS transition, so they keep moving on the
// compositor while the page's thread stands the world.

import { LOGO_SVG } from "../brand/logo.ts";
import type { WaitView } from "./wait.ts";

/** How many fireflies gather in all (each flies into the glow over 2.6 s, in wait.css). */
const FIREFLIES = 34;
/** How much of the work is done once the land is divided and once Jev has judged, the most the bake reaches before the world stands, and about how long a bake takes, ms. When nothing was asked, the bake takes all of what is left. */
const SHARE = { land: 0.12, judged: 0.6, baked: 0.96, bakeMs: 4200 };
/** Where the firefly over the "i" glows in the wordmark, as a share of its width and height (its viewBox is 5 25 188 104; the dot is at 123.4, 44.5). */
const DOT = { x: (123.4 - 5) / 188, y: (44.5 - 25) / 104 };

const hash = (k: number, s: number): number => {
  const v = Math.sin(k * 127.1 + s * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

export function createMarkWait(veil: HTMLElement): WaitView {
  veil.innerHTML = /* html */ `
    <div class="wait-sky"></div>
    <div class="wait-flies"></div>
    <div class="wait-mark"><div class="wait-glow"></div>${LOGO_SVG}</div>`;
  const flies = veil.querySelector(".wait-flies") as HTMLElement;
  const mark = veil.querySelector(".wait-mark") as HTMLElement;
  const glow = veil.querySelector(".wait-glow") as HTMLElement;
  glow.style.left = `${DOT.x * 100}%`;
  glow.style.top = `${DOT.y * 100}%`;

  // Each firefly starts somewhere about the screen's edges, drifting on its own slow loop.
  const swarm = Array.from({ length: FIREFLIES }, (_, k) => {
    const wrap = document.createElement("div");
    wrap.className = "fly";
    const angle = hash(k, 1) * Math.PI * 2;
    const far = 0.34 + hash(k, 2) * 0.16;
    const x = 50 + Math.cos(angle) * far * 100 * 1.1;
    const y = 50 + Math.sin(angle) * far * 100 * 0.95;
    wrap.style.left = `${Math.max(3, Math.min(97, x))}%`;
    wrap.style.top = `${Math.max(4, Math.min(96, y))}%`;
    const light = document.createElement("i");
    light.style.animationDuration = `${(7 + hash(k, 3) * 6).toFixed(2)}s, ${(2.2 + hash(k, 4) * 2.4).toFixed(2)}s`;
    light.style.animationDelay = `${(-hash(k, 5) * 10).toFixed(2)}s, ${(-hash(k, 6) * 4).toFixed(2)}s`;
    wrap.append(light);
    flies.append(wrap);
    return { wrap, gathered: false };
  });

  let done = 0;
  let asked = false;
  let baking = 0;
  let timer = 0;
  /** Shows how much is done: as many fireflies gather as that share, and the glow grows with it. */
  function show(share: number): void {
    done = Math.max(done, Math.min(1, share));
    glow.style.transform = `translate(-50%, -50%) scale(${(0.55 + done * 0.85).toFixed(3)})`;
    glow.style.opacity = (0.45 + done * 0.55).toFixed(3);
    const want = Math.round(done * FIREFLIES);
    const box = mark.getBoundingClientRect();
    const tx = box.left + box.width * DOT.x;
    const ty = box.top + box.height * DOT.y;
    for (const f of swarm) {
      if (swarm.filter((s) => s.gathered).length >= want) break;
      if (f.gathered) continue;
      f.gathered = true;
      const at = f.wrap.getBoundingClientRect();
      f.wrap.style.transform = `translate(${(tx - (at.left + at.width / 2)).toFixed(1)}px, ${(ty - (at.top + at.height / 2)).toFixed(1)}px)`;
      f.wrap.classList.add("gathered");
    }
  }
  show(0.02);

  return {
    opening(o) {
      if (o.stage === "land") show(SHARE.land);
      else if (o.stage === "asking") {
        asked = true;
        show(SHARE.land + (SHARE.judged - SHARE.land) * (o.answered / Math.max(1, o.total)));
      }
    },
    baking() {
      const from = asked ? SHARE.judged : Math.max(done, SHARE.land);
      show(from);
      baking = performance.now();
      // The bake says nothing as it goes: ease toward its end over about as long as one takes.
      timer = window.setInterval(() => {
        const t = Math.min(1, (performance.now() - baking) / SHARE.bakeMs);
        show(from + (SHARE.baked - from) * (1 - (1 - t) ** 2));
      }, 400);
    },
    night(n) {
      veil.style.setProperty("--night", n.toFixed(2));
    },
    async lift() {
      window.clearInterval(timer);
      show(1);
      await wait(900);
      veil.classList.add("lifted");
      await wait(900);
      // Nothing of the wait keeps animating, or holds its canvases, under the world.
      veil.replaceChildren();
    },
  };
}
