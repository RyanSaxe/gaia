// A compass at the top of the view, like a brass ruler: the points of the
// compass slide past as the person turns, and under its needle it names the
// area ahead, the first one along the way they face that is not the one they
// stand in. North is -z, as on the field map.

import type { Place } from "@gaia/terrain";

export interface Compass {
  /** Follows the person: where they stand and which way they look (yaw, radians). */
  frame(x: number, z: number, yaw: number, placeAt: (x: number, z: number) => Place): void;
  show(on: boolean): void;
  /** The heading in degrees and the area named ahead, for scripted checks. */
  state(): { readonly heading: number; readonly ahead: string | null };
}

/** Pixels per degree of heading along the strip. */
const SCALE = 2.2;
/** How far ahead the compass looks for the next area, and in what steps, meters. */
const LOOK = { reach: 520, step: 8 };
const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Heading in degrees, clockwise from north (-z), for a yaw where 0 looks toward -z. */
export const headingOf = (yaw: number): number => ((((-yaw * 180) / Math.PI) % 360) + 360) % 360;

export function createCompass(root: HTMLElement): Compass {
  const box = document.createElement("div");
  box.className = "compass";
  box.setAttribute("aria-hidden", "true");
  const strip = document.createElement("div");
  strip.className = "compass-strip";
  // Three turns of ticks, so the strip never shows its end while it slides.
  for (let d = -360; d <= 720; d += 15) {
    const tick = document.createElement("span");
    const p = ((d % 360) + 360) % 360;
    const point = p % 45 === 0 ? POINTS[p / 45] : undefined;
    tick.className = point === undefined ? "tick" : p % 90 === 0 ? "tick cardinal" : "tick ordinal";
    if (point !== undefined) tick.textContent = point;
    tick.style.left = `${d * SCALE}px`;
    strip.append(tick);
  }
  const needle = document.createElement("div");
  needle.className = "compass-needle";
  const ahead = document.createElement("div");
  ahead.className = "compass-ahead";
  const aheadParent = document.createElement("span");
  aheadParent.className = "compass-ahead-parent";
  const aheadName = document.createElement("span");
  aheadName.className = "compass-ahead-name";
  ahead.append(aheadParent, aheadName);
  box.append(strip, needle);
  root.append(box, ahead);

  let heading = 0;
  let named: string | null = null;
  let last = { x: Infinity, z: Infinity, heading: Infinity };

  function look(x: number, z: number, yaw: number, placeAt: (x: number, z: number) => Place): void {
    const here = placeAt(x, z).area;
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    for (let s = LOOK.step; s <= LOOK.reach; s += LOOK.step) {
      const there = placeAt(x + dx * s, z + dz * s).area;
      if (there.path !== here.path || there.depth !== here.depth) {
        const key = `${there.depth}:${there.path}`;
        if (key !== named) {
          named = key;
          aheadParent.textContent = there.depth < 0 ? "" : there.path.split("/").slice(0, -1).join(" / ");
          aheadName.textContent = there.name;
          // Each new name settles in from a soft blur, never snapping.
          ahead.classList.remove("settle");
          void ahead.offsetWidth;
          ahead.classList.add("settle");
        }
        ahead.classList.add("on");
        return;
      }
    }
    named = null;
    ahead.classList.remove("on");
  }

  return {
    frame(x, z, yaw, placeAt) {
      heading = headingOf(yaw);
      strip.style.transform = `translateX(${-heading * SCALE}px)`;
      // Looking ahead marches the places along the view: only when the person has turned or moved enough to change it.
      const turned = Math.abs(((heading - last.heading + 540) % 360) - 180);
      if (turned > 2 || Math.hypot(x - last.x, z - last.z) > 4) {
        last = { x, z, heading };
        look(x, z, yaw, placeAt);
      }
    },
    show(on) {
      box.classList.toggle("on", on);
      if (!on) ahead.classList.remove("on");
      last = { x: Infinity, z: Infinity, heading: Infinity };
      named = null;
    },
    state: () => ({ heading, ahead: ahead.classList.contains("on") ? aheadName.textContent : null }),
  };
}
