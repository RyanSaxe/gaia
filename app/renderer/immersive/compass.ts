// The compass in the top right corner, where the menu's rose was: a round of
// the map's paper with an inked ring of ticks that stays put, its top tick
// marking the way the person faces, and a needle whose north half is in the
// traveller's vermilion. Only the needle turns, to point north, on a damped
// spring, so after a sudden turn it swings a little past and settles within
// about a second. A tap on it still opens the slip (`view.ts`).
//
// The face is drawn once and casts the shadow; the needle is its own layer,
// turned by a CSS transform, and touched only when it has moved by more than
// a tenth of a degree, so a person walking straight costs it nothing.

import { rand } from "@gaia/schema";

/** The needle: its angle on the screen, radians clockwise from up, and how fast it is turning, radians a second. */
export interface Needle {
  angle: number;
  speed: number;
}

/** How fast the needle answers a turn (radians a second) and how much it is damped: it swings about a tenth past and settles within about 1 s. */
export const NEEDLE = { rate: 7, damping: 0.6 } as const;

const TAU = Math.PI * 2;
/** The spring's step, seconds: short enough to stay steady at any frame rate. */
const STEP = 1 / 240;

/**
 * Swings the needle `dt` seconds toward `bearing` (radians clockwise from up),
 * always the short way round, as a damped spring.
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

/** One point of the needle, half shaded from the light as the field map inks its rose's. */
function point(length: number, half: number, turn: number, dark: string, light: string, line: string): string {
  return `<g transform="rotate(${turn})"><path d="M0 ${-length} L${-half} ${-half} L0 0Z" fill="${dark}" stroke="${line}" stroke-width=".5" stroke-linejoin="round"/><path d="M0 ${-length} L${half} ${-half} L0 0Z" fill="${light}" stroke="${line}" stroke-width=".5" stroke-linejoin="round"/></g>`;
}

/** A round of paper whose rim wanders a little, as a torn disc's does. */
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

/** The face: the paper, the ring and its ticks, and the mark at the top for the way you face. */
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

/** The needle, its north half vermilion and its south half ink, on a paper pin. */
const NEEDLE_SVG = /* html */ `<svg class="compass-needle" viewBox="-22 -22 44 44" aria-hidden="true">
  ${point(11.6, 2.3, 0, "#9b3823", "#cf6a4c", "#5a2414")}${point(11.6, 2.3, 180, INK, PAPER, INK)}
  <circle r="1.25" fill="#f1e3c0" stroke="${INK}" stroke-width=".6"/>
</svg>`;

export interface Compass {
  /** Follows the way the person faces (`yaw`, the walker's, radians) for `dt` seconds. */
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
