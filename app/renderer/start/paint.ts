// Painting for the start: the torn edge of a sheet of paper, and the paper's
// tooth. Everything is SVG drawn once, so nothing here redraws per frame.

export const SVG = "http://www.w3.org/2000/svg";

/** A repeatable 0..1 from a word and a number. */
export function hashOf(word: string, k = 0): number {
  let h = 2166136261 ^ k;
  for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** A sheet's torn edge: a polygon in percent, wandering a little in and out along each side. */
export function deckle(seed: string, steps = 18, depth = 1.1): string {
  const pts: string[] = [];
  const side = (k: number, x0: number, y0: number, x1: number, y1: number, nx: number, ny: number): void => {
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const j = (hashOf(seed, k * 100 + i) - 0.3) * depth;
      pts.push(`${(x0 + (x1 - x0) * t + nx * j).toFixed(2)}% ${(y0 + (y1 - y0) * t + ny * j).toFixed(2)}%`);
    }
  };
  side(0, 0, 0, 100, 0, 0, 1);
  side(1, 100, 0, 100, 100, -1, 0);
  side(2, 100, 100, 0, 100, 0, -1);
  side(3, 0, 100, 0, 0, 1, 0);
  return `polygon(${pts.join(", ")})`;
}

/** The filters every painting on the start shares: a wobble for washes, and paper's tooth. Inlined once in the page. */
export const FILTERS = /* svg */ `
<svg xmlns="${SVG}" width="0" height="0" style="position:absolute" aria-hidden="true">
  <filter id="start-wash" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="4" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="start-tooth" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="9"/>
    <feColorMatrix values="0 0 0 0 0.42  0 0 0 0 0.33  0 0 0 0 0.2  0 0 0 0.11 0"/>
  </filter>
</svg>`;
