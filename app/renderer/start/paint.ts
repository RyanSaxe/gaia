// Painting for the start: a world's postcard as a small watercolor map sheet,
// and the torn edge of a sheet of paper. Everything is SVG drawn once, so
// nothing here redraws per frame.

import type { Postcard } from "../../world-service/protocol.ts";

export const SVG = "http://www.w3.org/2000/svg";

/** A repeatable 0..1 from a word and a number. */
export function hashOf(word: string, k = 0): number {
  let h = 2166136261 ^ k;
  for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Each land's wash, after its ground cover. */
const LAND_WASH: Readonly<Record<string, string>> = {
  "Brook valley": "#93b765",
  "Clover hills": "#a3c272",
  "Silver terraces": "#b3bf9c",
  "Mossy basin": "#7d9d58",
  "Heather moor": "#ad97b0",
  "Meandering vale": "#a6c47a",
  "Golden dunes": "#d6bd78",
  "Pond meadow": "#98bb6c",
  "Broad downs": "#b5c19a",
  "Home lawn": "#bcd38c",
};
const WATER = "#7fa8bf";

/** A ring as a smooth path through the middles of its edges, as a brush follows it. */
function ringPath(ring: readonly number[], at: (v: number) => number): string {
  const n = ring.length / 2;
  const p = (k: number): [number, number] => {
    const i = ((k % n) + n) % n;
    return [at(ring[i * 2] as number), at(ring[i * 2 + 1] as number)];
  };
  const f = (v: number): string => v.toFixed(2);
  let [bx, by] = p(1);
  const [ax, ay] = p(0);
  let d = `M${f((ax + bx) / 2)} ${f((ay + by) / 2)}`;
  for (let k = 1; k <= n; k++) {
    const [cx, cy] = p(k + 1);
    d += `Q${f(bx)} ${f(by)} ${f((bx + cx) / 2)} ${f((by + cy) / 2)}`;
    [bx, by] = [cx, cy];
  }
  return `${d}Z`;
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

/** A world's postcard: its land washed in watercolor on a small sheet, its water, and its buildings and landmarks inked small. */
export function paintPostcard(card: Postcard | undefined, seed: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");
  const at = (v: number): number => 50 + v * 43;
  let body = `<rect x="0" y="0" width="100" height="100" fill="transparent"/>`;
  if (card !== undefined) {
    let washes = "";
    let water = "";
    for (const [i, area] of card.areas.entries()) {
      const fill = LAND_WASH[area.land] ?? "#b9c792";
      const d = area.rings.map((r) => ringPath(r, at)).join("");
      // Pigment pools at a wash's edge: a darker rim under a lighter body.
      washes += `<path d="${d}" fill="${fill}" fill-opacity="${area.depth === 0 ? 0.42 : 0.5}" stroke="${fill}" stroke-opacity="0.9" stroke-width="${area.depth === 0 ? 0.9 : 0.6}" stroke-linejoin="round"/>`;
      const ring = area.rings[0] ?? [];
      let cx = 0;
      let cz = 0;
      for (let k = 0; k < ring.length; k += 2) {
        cx += ring[k] as number;
        cz += ring[k + 1] as number;
      }
      cx = at(cx / Math.max(1, ring.length / 2));
      cz = at(cz / Math.max(1, ring.length / 2));
      if (area.depth > 1) continue;
      if (area.water === "A still pond") water += `<ellipse cx="${cx.toFixed(1)}" cy="${cz.toFixed(1)}" rx="${(3.2 + 2 * hashOf(seed, i)).toFixed(1)}" ry="${(2.2 + 1.4 * hashOf(seed, i + 7)).toFixed(1)}" fill="${WATER}" fill-opacity="0.75"/>`;
      else if (area.water === "A brook" || area.water === "A trickle") {
        const a = hashOf(seed, i + 3) * Math.PI;
        const r = 9;
        const [dx, dz] = [Math.cos(a) * r, Math.sin(a) * r];
        water += `<path d="M${(cx - dx).toFixed(1)} ${(cz - dz).toFixed(1)} Q${(cx + dz * 0.5).toFixed(1)} ${(cz - dx * 0.5).toFixed(1)} ${cx.toFixed(1)} ${cz.toFixed(1)} T${(cx + dx).toFixed(1)} ${(cz + dz).toFixed(1)}" fill="none" stroke="${WATER}" stroke-width="${area.water === "A brook" ? 1.1 : 0.7}" stroke-linecap="round" stroke-opacity="0.7"/>`;
      }
    }
    let things = "";
    for (const t of card.things) {
      const x = at(t.x);
      const z = at(t.z);
      things +=
        t.as === "building"
          ? `<path d="M${x - 1.6} ${z + 1.3}h3.2v-1.8l-1.6-1.4l-1.6 1.4z" fill="#ead9b8" stroke="#6b4b33" stroke-width="0.45" stroke-linejoin="round"/><path d="M${x - 2} ${z - 0.4}l2-1.8l2 1.8" fill="none" stroke="#9a4b30" stroke-width="0.8" stroke-linecap="round"/>`
          : `<circle cx="${x}" cy="${z - 0.6}" r="1.9" fill="#5d7a45" fill-opacity="0.85"/><path d="M${x} ${z + 1.2}v1.1" stroke="#5b4430" stroke-width="0.5"/>`;
    }
    body += `<g filter="url(#start-wash)">${washes}${water}</g>${things}`;
  }
  body += `<rect x="0" y="0" width="100" height="100" filter="url(#start-tooth)"/>`;
  svg.innerHTML = body;
  return svg;
}
