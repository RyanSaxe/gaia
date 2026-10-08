// The immersive world: the terrain lab's world, full screen, with nothing on
// it but the world itself and three quiet ways of knowing where you are, all
// at once: arrival titles, the field map, and markers in the world with a
// compass. Touching the world only ever moves you (docs/design-system.md,
// "One way to touch the world"); everything else is paper opened from the
// corner: the map, and a slip with Gaia's mark, how to wander, and the way
// back to the lab's debugging views. Walking, tapping a thing to walk up and
// read its card, the lantern and the hour all come from the terrain lab.

import type { PlaceArea } from "@gaia/terrain";
import { LOGO_SVG } from "../brand/logo.ts";
import { onTap } from "../lab.ts";
import type { WorldHandle } from "../terrain/lab.ts";
import { createArrival } from "./arrival.ts";
import { createCompass } from "./compass.ts";
import { createFieldMap } from "./field-map.ts";
import type { MapStyleName } from "./map-styles.ts";
import { MARKER_LAYER, createMarkers } from "./markers.ts";

/** The lab's debugging views, which the slip leads back to. */
export interface LabViews {
  readonly views: readonly { readonly id: string; readonly name: string }[];
  leave(id: string): void;
}

export interface Immersive {
  setActive(on: boolean): void;
  frame(dt: number): void;
  readonly hook: Readonly<Record<string, unknown>>;
}

/** A jump's timing, matching lab.css: the paper clouds over and holds a moment, frames for the ground and grass to follow under it, and the world dissolving in, ms. */
const JUMP = { coverMs: 480, settleFrames: 4, revealMs: 1100 };

const ROSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M12 4.5 13.6 12 12 19.5 10.4 12Z" fill="currentColor" opacity=".85"/><path d="M4.5 12 12 10.6 19.5 12 12 13.4Z" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;

/** How to wander, as the slip says it: a mouse and keys, or a finger. */
const WANDER = /* html */ `
  <dl class="slip-wander">
    <dt><span class="mouse-only">Click</span><span class="touch-only">Tap</span> the land</dt><dd>go there</dd>
    <dt><span class="mouse-only">Click</span><span class="touch-only">Tap</span> a thing</dt><dd>walk up and read its card</dd>
    <dt>Drag</dt><dd>look around</dd>
    <dt class="mouse-only">W A S D</dt><dd class="mouse-only">walk, Shift to hurry</dd>
    <dt class="mouse-only">M</dt><dd class="mouse-only">the map; Esc folds it</dd>
    <dt><span class="mouse-only">Click</span><span class="touch-only">Tap</span> the map</dt><dd>go to that place</dd>
  </dl>`;

export function createImmersive(container: HTMLElement, world: WorldHandle, lab: LabViews): Immersive {
  const layer = document.createElement("div");
  layer.className = "wayfinding";
  container.append(layer);

  const arrival = createArrival(layer);
  const compass = createCompass(layer);
  // While paper opened from the corner is read, the world waits under a faint wash: a tap there folds the paper and moves no one.
  const reading = document.createElement("div");
  reading.className = "reading";
  layer.append(reading);
  // A jump from the map: the map folds as the view clouds over in the paper's own color, the person is
  // placed under it, and once the ground and grass have followed them the world dissolves in at the new place.
  const cover = document.createElement("div");
  cover.className = "jump-cover";
  layer.append(cover);
  let jumping = false;
  function jump(x: number, z: number, heart?: { readonly x: number; readonly z: number }): boolean {
    if (jumping) return false;
    const at = world.landing(x, z, heart);
    if (at === null) return false;
    jumping = true;
    map.open(false);
    cover.classList.add("on");
    window.setTimeout(() => {
      world.place(at);
      // The old place's title goes with it; the new place announces itself as the world dissolves in.
      arrival.show(false);
      arrival.show(active);
      let frames = 0;
      const settle = (): void => {
        if (++frames < JUMP.settleFrames) {
          requestAnimationFrame(settle);
          return;
        }
        cover.classList.remove("on");
        window.setTimeout(() => (jumping = false), JUMP.revealMs);
      };
      requestAnimationFrame(settle);
    }, JUMP.coverMs);
    return true;
  }
  const map = createFieldMap(
    layer,
    { stood: world.stood, placeAt: world.placeAt, places: world.places },
    (open) => {
      if (open) setSlip(false);
    },
    jump,
  );
  const markers = createMarkers(world.light);
  world.scene.add(markers.group);
  world.camera.layers.enable(MARKER_LAYER);
  world.furnishingSolid(true);

  // Markers stand beside the trails on every bake, before the grass and the walk read the ground.
  world.furnish((stood) => markers.place(stood, (x, z): PlaceArea => world.placeAt(x, z).area));
  /** Whether a world stands yet: until the first bake lands, nothing names a place. */
  let standing = false;
  world.onStood(() => {
    standing = true;
    // The ways of knowing where you are come in as the veil lifts: nothing names a place before the world stands.
    layer.classList.add("standing");
    // A new world announces where the person stands afresh.
    arrival.show(active);
    map.invalidate();
    worldName.textContent = world.places().name;
    // A directory's vitality: the mean of its files', its subdirectories' included.
    const sums = new Map<string, { v: number; n: number }>();
    for (const p of world.places().patches) {
      const parts = p.area.split("/").filter(Boolean);
      for (let k = 0; k <= parts.length; k++) {
        const path = parts.slice(0, k).join("/");
        const s = sums.get(path) ?? { v: 0, n: 0 };
        s.v += p.vitality;
        s.n += 1;
        sums.set(path, s);
      }
    }
    markers.vitality((path) => {
      const s = sums.get(path);
      return s === undefined ? 1 : s.v / s.n;
    });
  });

  // ---------- the slip: Gaia's mark, how to wander, and the way back to the lab ----------

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "way-button menu-button";
  menuButton.setAttribute("aria-label", "About this world, and the lab");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.innerHTML = ROSE;
  const slip = document.createElement("div");
  slip.className = "way-slip";
  slip.setAttribute("role", "dialog");
  slip.setAttribute("aria-label", "Gaia");
  slip.innerHTML = /* html */ `
    <div class="slip-mark">${LOGO_SVG}</div>
    <div class="slip-world">the world of <i data-ref="world-name"></i></div>
    <div class="slip-head">Wandering</div>
    ${WANDER}
    <div class="slip-head">The lab</div>
    <div class="slip-views">${lab.views.map((v) => `<button type="button" class="slip-view" data-view="${v.id}">${v.name}</button>`).join("")}</div>`;
  layer.append(menuButton, slip);
  const worldName = slip.querySelector("[data-ref=world-name]") as HTMLElement;
  function setSlip(on: boolean): void {
    if (on) map.open(false);
    slip.classList.toggle("open", on);
    menuButton.setAttribute("aria-expanded", String(on));
  }
  menuButton.addEventListener("click", () => setSlip(!slip.classList.contains("open")));
  for (const b of slip.querySelectorAll<HTMLElement>("[data-view]")) {
    b.addEventListener("click", () => {
      setSlip(false);
      lab.leave(b.dataset.view ?? "");
    });
  }
  onTap(reading, () => {
    setSlip(false);
    map.open(false);
  });
  // Escape folds whatever paper is open before anything under it hears the key.
  window.addEventListener(
    "keydown",
    (e) => {
      if (!active || e.code !== "Escape") return;
      if (map.isOpen) map.open(false);
      else if (slip.classList.contains("open")) setSlip(false);
      else return;
      e.stopPropagation();
    },
    true,
  );

  let active = false;
  function apply(): void {
    arrival.show(active);
    map.show(active);
    compass.show(active);
  }

  let still = 0;
  let last = { x: Number.NaN, z: Number.NaN };
  let night = -1;
  return {
    setActive(on) {
      active = on;
      layer.hidden = !on;
      if (!on) setSlip(false);
      apply();
    },
    frame(dt) {
      if (!active || !standing) return;
      const p = world.person();
      const moved = Math.hypot(p.x - last.x, p.z - last.z) > 0.02;
      still = moved || p.walking ? 0 : still + dt;
      last = { x: p.x, z: p.z };
      const place = world.placeAt(p.x, p.z);
      // After dark, paper is read by the lantern: lab.css warms and dims it by this.
      const n = Math.round(world.light.uNightness.value * 20) / 20;
      if (n !== night) {
        night = n;
        container.style.setProperty("--night", String(n));
      }
      arrival.frame(place, still, dt);
      compass.frame(p.x, p.z, p.yaw, world.placeAt);
      map.frame(p.x, p.z, p.yaw, place);
    },
    hook: {
      /** Unfolds or folds the field map. */
      map: (on: boolean) => map.open(on),
      /** Paints the field map in another direction: "painted", "sketchbook" or "explorer". */
      mapStyle: (name: MapStyleName) => map.restyle(name),
      /** Sends the person to (x, z) as a tap on the map would; false if nowhere near is fit. */
      jump: (x: number, z: number) => jump(x, z),
      /** Whether a jump is under way. */
      jumping: () => jumping,
      /** Opens or closes the slip in the corner. */
      slip: (on: boolean) => setSlip(on),
      /** Where the person is, and what each way of knowing it shows now. */
      state: () => {
        const p = world.person();
        return { place: world.placeAt(p.x, p.z), titles: arrival.state(), compass: compass.state(), map: map.state(), markers: markers.crossings().length };
      },
      crossings: () => markers.crossings(),
    },
  };
}
