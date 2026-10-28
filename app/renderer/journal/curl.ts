// Bends a turning leaf and casts its shadow on the pages beneath. The leaf is
// cut into hinged strips, each showing its part of both faces, so the spine
// side leads and the free edge trails, most in mid-turn. The book's own leaf
// still turns out of sight, and each frame the strips follow its angle, so a
// drag bends the same way.

import "./curl.css";

/** How many strips a leaf is cut into, and how many degrees its free edge trails the spine at mid-turn. */
const STRIPS = 10;
const BEND = 54;
/**
 * How far in page pixels each strip's faces extend under the next strip. Two strips bent apart meet at a line that
 * both edges only half cover, which shows a pale seam, so each face extends a little past it.
 */
const OVERLAP = 1.5;
/** The leaf shadow's darkest opacity, and how far in book pixels it reaches across the page beneath. */
const SHADOW = { dark: 0.34, reach: 150 } as const;

export interface Curl {
  /**
   * Sets the strips for the leaf's current angle in degrees, from 0 lying on the right to -180 on the left. `forward`
   * means turning right to left. Returns the angle of the strip by the spine, which leads the leaf.
   */
  at(deg: number, forward: boolean): number;
  remove(): void;
}

/** A copy of `page` for one strip, with its canvases cropped to the strip's part, since cloning loses canvas content. `x0` and `w` are in page pixels. */
function stripOf(page: HTMLElement, x0: number, w: number, pw: number): HTMLElement {
  const copy = page.cloneNode(true) as HTMLElement;
  const from = [...page.querySelectorAll("canvas")];
  const to = [...copy.querySelectorAll("canvas")];
  from.forEach((c, k) => {
    const into = to[k];
    if (into === undefined) return;
    const sx = c.width / pw;
    const part = document.createElement("canvas");
    part.width = Math.max(1, Math.round(w * sx));
    part.height = c.height;
    part.getContext("2d")?.drawImage(c, x0 * sx, 0, w * sx, c.height, 0, 0, part.width, part.height);
    part.style.cssText = `position:absolute;left:${x0}px;top:0;right:auto;bottom:auto;width:${w}px;height:100%;`;
    into.replaceWith(part);
  });
  return copy;
}

/**
 * Cuts the leaf showing `front` and `back` into strips in `host`, which is
 * positioned like the leaf. `shades` are the layers over the right and left
 * pages that receive the leaf's shadow.
 */
export function createCurl(host: HTMLElement, front: HTMLElement | null, back: HTMLElement | null, pw: number, ph: number, bend: boolean, shades: { readonly right: HTMLElement; readonly left: HTMLElement }): Curl {
  const strips: HTMLElement[] = [];
  const faces: HTMLElement[] = [];
  const n = bend ? STRIPS : 0;
  const w = pw / Math.max(1, n);
  let holder = host;
  for (let i = 0; i < n; i++) {
    const strip = document.createElement("div");
    strip.className = "jb-strip";
    strip.style.width = `${w}px`;
    strip.style.height = `${ph}px`;
    // Every strip but the last extends under the next. The last ends at the page's edge.
    const over = i < n - 1 ? OVERLAP : 0;
    for (const [page, side] of [[front, "front"], [back, "back"]] as const) {
      const face = document.createElement("div");
      face.className = `jb-strip-face ${side}`;
      face.style.right = `${-over}px`;
      if (page !== null) {
        // The back is mirrored once the leaf is over, so strip i shows the back page's part counted from its far edge,
        // and its overlap extends on the page's near side.
        const x0 = side === "front" ? i * w : pw - (i + 1) * w - over;
        const copy = stripOf(page, x0, w + over, pw);
        copy.style.left = `${-x0}px`;
        copy.style.width = `${pw}px`;
        copy.style.right = "auto";
        face.append(copy);
      }
      const shade = document.createElement("i");
      shade.className = "jb-strip-shade";
      face.append(shade);
      faces.push(face);
      strip.append(face);
    }
    holder.append(strip);
    strips.push(strip);
    holder = strip;
  }
  const shade = (el: HTMLElement, from: number, to: number, dark: number): void => {
    el.style.opacity = dark <= 0.001 ? "0" : "1";
    el.style.background = `linear-gradient(90deg, rgba(30,16,6,0) ${from}px, rgba(30,16,6,${dark.toFixed(3)}) ${(from + 0.15 * (to - from)).toFixed(1)}px, rgba(30,16,6,0) ${to}px)`;
  };
  return {
    at(deg, forward) {
      const p = Math.min(1, Math.max(0, -deg / 180));
      const lift = Math.sin(Math.PI * p);
      // The bend at this angle. The spine strip leads the leaf's angle by half of it, and the free edge trails.
      const b = (bend ? BEND * lift : 0) * (forward ? 1 : -1);
      const spine = deg - b / 2;
      let angle = spine;
      strips.forEach((s, i) => {
        // Each strip turns back a little more than the one before, so the bend increases toward the edge.
        const step = i === 0 ? angle : (b * (2 * i)) / (n * (n - 1));
        if (i > 0) angle += step;
        s.style.transform = i === 0 ? `rotateY(${step.toFixed(2)}deg)` : `translateX(${w}px) rotateY(${step.toFixed(2)}deg)`;
        // Darkens both faces of a strip by how far it is turned from flat.
        const dim = 0.22 * Math.abs(Math.sin((angle * Math.PI) / 180)) ** 1.6;
        for (const face of [faces[2 * i], faces[2 * i + 1]]) (face?.lastElementChild as HTMLElement | undefined)?.style.setProperty("opacity", dim.toFixed(3));
      });
      // The shadow falls just past the leaf's edge on the page beneath: the right page before the leaf crosses the
      // spine, the left after. It is darkest when the leaf is upright and absent when it lies flat.
      const edge = pw * Math.cos((deg * Math.PI) / 180);
      const dark = SHADOW.dark * lift;
      const reach = 30 + SHADOW.reach * lift;
      if (edge >= 0) {
        shade(shades.right, edge, Math.min(pw, edge + reach), dark);
        shades.left.style.opacity = "0";
      } else {
        // The left page's layer runs from the fore-edge (0) to the spine (pw).
        const x = pw + edge;
        shades.left.style.opacity = dark <= 0.001 ? "0" : "1";
        shades.left.style.background = `linear-gradient(270deg, rgba(30,16,6,0) ${pw - x}px, rgba(30,16,6,${dark.toFixed(3)}) ${(pw - x + 0.15 * reach).toFixed(1)}px, rgba(30,16,6,0) ${(pw - x + reach).toFixed(1)}px)`;
        shades.right.style.opacity = "0";
      }
      return spine;
    },
    remove() {
      strips[0]?.remove();
      shades.right.style.opacity = "0";
      shades.left.style.opacity = "0";
    },
  };
}

/** A leaf's current angle in degrees, read from its computed transform this frame. */
export function angleOf(leaf: HTMLElement): number {
  const m = new DOMMatrixReadOnly(getComputedStyle(leaf).transform);
  // rotateY(θ) puts cos θ at m11 and -sin θ at m13.
  return (Math.atan2(-m.m13, m.m11) * 180) / Math.PI;
}
