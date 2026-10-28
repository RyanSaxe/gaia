// The compass in the top right corner, which also opens the slip (`view.ts`).
// Its face is a fixed SVG whose top tick marks the way the person faces. Only
// the needle turns to point north, on a damped spring, and its CSS transform
// changes only when it moves more than a tenth of a degree.

import { rand } from "@gaia/schema";

/** The needle's screen angle in radians clockwise from up, and its angular speed in radians per second. */
export interface Needle {
  angle: number;
  speed: number;
}

/** The spring's natural frequency in radians per second and its damping ratio. The needle overshoots by about a tenth and settles within about 1 s. */
export const NEEDLE = { rate: 7, damping: 0.6 } as const;

const TAU = Math.PI * 2;
/** The spring's integration step in seconds, short enough to stay stable at any frame rate. */
const STEP = 1 / 240;

/**
 * Advances the needle's damped spring `dt` seconds toward `bearing`, in
 * radians clockwise from up, always the short way around.
 */
export function swing(needle: Needle, bearing: number, dt: number): void {
  const target = needle.angle + ((((bearing - needle.angle) % TAU) + TAU * 1.5) % TAU) - Math.PI;
  const { rate, damping } = NEEDLE;
  for (let left = dt; left > 1e-9; left -= STEP) {
    const h = Math.min(left, STEP);
    needle.speed += (-2 * damping * rate * needle.speed - rate * rate * (needle.angle - target)) * h;
    needle.angle += needle.speed * h;
  }
}

const INK = "#4a3c2c";
const PAPER = "#f4ecd6";

/** One point of the needle as SVG, with a dark half and a light half, as the field map draws its rose. */
function point(length: number, half: number, turn: number, dark: string, light: string, line: string): string {
  return `<g transform="rotate(${turn})"><path d="M0 ${-length} L${-half} ${-half} L0 0Z" fill="${dark}" stroke="${line}" stroke-width=".5" stroke-linejoin="round"/><path d="M0 ${-length} L${half} ${-half} L0 0Z" fill="${light}" stroke="${line}" stroke-width=".5" stroke-linejoin="round"/></g>`;
}

/** An SVG path for a paper disc whose rim varies by about `wander` around `radius`, like a torn edge. */
function disc(radius: number, wander: number): string {
  const r = rand(3);
  const phase = [r.next() * TAU, r.next() * TAU];
  let d = "";
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * TAU;
    const k = radius + wander * (0.6 * Math.sin(a * 7 + (phase[0] as number)) + 0.4 * Math.sin(a * 17 + (phase[1] as number))) + (r.next() - 0.5) * wander * 0.8;
    d += `${i === 0 ? "M" : "L"}${(Math.sin(a) * k).toFixed(2)} ${(-Math.cos(a) * k).toFixed(2)}`;
  }
  return `${d}Z`;
}

/** The face SVG: the paper disc, the ring and ticks, and the top mark for the way the person faces. */
const FACE = ((): string => {
  let ticks = "";
  for (let k = 1; k < 16; k++) {
    const long = k % 4 === 0;
    ticks += `<path transform="rotate(${k * 22.5})" d="M0 -16.6V${long ? -13.6 : -14.9}" stroke="${INK}" stroke-width="${long ? 0.8 : 0.5}" stroke-linecap="round"/>`;
  }
  return /* html */ `<svg class="compass-face" viewBox="-22 -22 44 44" aria-hidden="true">
    <defs><radialGradient id="compass-paper" cx="34%" cy="28%" r="85%"><stop offset="0" stop-color="#faf4e4"/><stop offset="1" stop-color="#ece0c1"/></radialGradient></defs>
    <path d="${disc(20.6, 0.45)}" fill="url(#compass-paper)"/>
    <circle r="16.6" fill="none" stroke="${INK}" stroke-width=".85"/>
    <circle r="13.6" fill="none" stroke="${INK}" stroke-width=".4" opacity=".8"/>${ticks}
    <path d="M0 -16.2 L1.6 -13.1 L-1.6 -13.1Z" fill="${INK}"/>
  </svg>`;
})();

/** The needle SVG: a vermilion north half and an ink south half on a paper-colored pin. */
const NEEDLE_SVG = /* html */ `<svg class="compass-needle" viewBox="-22 -22 44 44" aria-hidden="true">
  ${point(11.6, 2.3, 0, "#9b3823", "#cf6a4c", "#5a2414")}${point(11.6, 2.3, 180, INK, PAPER, INK)}
  <circle r="1.25" fill="#f1e3c0" stroke="${INK}" stroke-width=".6"/>
</svg>`;

export interface Compass {
  /** Swings the needle for `dt` seconds toward the person's `yaw` in radians. */
  turn(yaw: number, dt: number): void;
  /** The needle's angle on the screen, degrees clockwise from up, for scripted checks. */
  state(): { readonly needle: number };
}

/** Draws the compass inside `button`. */
export function createCompass(button: HTMLElement): Compass {
  button.innerHTML = FACE + NEEDLE_SVG;
  const svg = button.querySelector(".compass-needle") as SVGSVGElement;
  const needle: Needle = { angle: 0, speed: 0 };
  let started = false;
  /** The angle last written to the page, radians. */
  let shown = Number.NaN;
  return {
    turn(yaw, dt) {
      // The ring's top is the way the person faces, so north lies their yaw clockwise from it.
      if (!started) {
        needle.angle = yaw;
        started = true;
      } else swing(needle, yaw, dt);
      if (Math.abs(needle.angle - shown) < 0.0017) return;
      shown = needle.angle;
      const degrees = ((((needle.angle * 180) / Math.PI) % 360) + 360) % 360;
      svg.style.transform = `rotate(${degrees.toFixed(2)}deg)`;
    },
    state: () => ({ needle: +(((((needle.angle * 180) / Math.PI) % 360) + 360) % 360).toFixed(1) }),
  };
}
