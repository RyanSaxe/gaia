// The immersive world: the terrain lab's world, full screen, with nothing on
// it but the world itself and one quiet way of knowing where you are. A small
// round button in the corner opens a paper slip that chooses that way (arrival
// titles, the field map, or markers in the world) and leads back to the lab's
// debugging views. Walking, tapping a thing to walk up and read its card, the
// lantern and the hour all come from the terrain lab.

import type { PlaceArea } from "@gaia/terrain";
import type { WorldHandle } from "../terrain/lab.ts";
import { createArrival } from "./arrival.ts";
import { createCompass } from "./compass.ts";
import { createFieldMap } from "./field-map.ts";
import { MARKER_LAYER, createMarkers } from "./markers.ts";

/** The ways of knowing where you are that the reviewer chooses between. */
export const WAYS = ["titles", "map", "markers"] as const;
export type Way = (typeof WAYS)[number];
const WAY_NAMES: Readonly<Record<Way, { name: string; note: string }>> = {
  titles: { name: "Arrival titles", note: "An area's name rises as you enter it" },
  map: { name: "Field map", note: "A hand-drawn map, from the corner" },
  markers: { name: "Markers", note: "Signposts, boundary stones and a compass" },
};

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

const STORE = "gaia.lab.way";
const readWay = (): Way => {
  const asked = new URLSearchParams(location.search).get("way");
  if (WAYS.includes(asked as Way)) return asked as Way;
  try {
    const kept = localStorage.getItem(STORE);
    if (WAYS.includes(kept as Way)) return kept as Way;
  } catch {
    // Storage may be blocked; the default serves.
  }
  return "titles";
};

const ROSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M12 4.5 13.6 12 12 19.5 10.4 12Z" fill="currentColor" opacity=".85"/><path d="M4.5 12 12 10.6 19.5 12 12 13.4Z" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;

export function createImmersive(container: HTMLElement, world: WorldHandle, lab: LabViews): Immersive {
  const layer = document.createElement("div");
  layer.className = "wayfinding";
  container.append(layer);

  const arrival = createArrival(layer);
  const compass = createCompass(layer);
  const map = createFieldMap(layer, { stood: world.stood, placeAt: world.placeAt });
  const markers = createMarkers(world.light);
  world.scene.add(markers.group);
  world.camera.layers.enable(MARKER_LAYER);

  // Markers stand beside the trails on every bake, before the grass and the walk read the ground.
  world.furnish((stood) => markers.place(stood, (x, z): PlaceArea => world.placeAt(x, z).area));
  world.onStood(() => {
    map.invalidate();
    // Each area's vitality: the mean of its files'.
    const sums = new Map<string, { v: number; n: number }>();
    for (const t of world.stood().trees) {
      const path = world.placeAt(t.x, t.z).area.path;
      const s = sums.get(path) ?? { v: 0, n: 0 };
      s.v += t.vitality;
      s.n += 1;
      sums.set(path, s);
    }
    markers.vitality((path) => {
      const s = sums.get(path);
      return s === undefined ? 1 : s.v / s.n;
    });
  });

  // ---------- the slip: choosing the way, and the way back to the lab ----------

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "way-button menu-button";
  menuButton.setAttribute("aria-label", "Ways of finding your way, and the lab");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.innerHTML = ROSE;
  const slip = document.createElement("div");
  slip.className = "way-slip";
  slip.setAttribute("role", "dialog");
  slip.setAttribute("aria-label", "Finding your way");
  slip.innerHTML = /* html */ `
    <div class="slip-head">Finding your way</div>
    <div class="slip-ways" role="radiogroup">
      ${WAYS.map((w) => `<button type="button" role="radio" class="slip-way" data-way="${w}"><b>${WAY_NAMES[w].name}</b><small>${WAY_NAMES[w].note}</small></button>`).join("")}
    </div>
    <div class="slip-head">The lab</div>
    <div class="slip-views">${lab.views.map((v) => `<button type="button" class="slip-view" data-view="${v.id}">${v.name}</button>`).join("")}</div>`;
  layer.append(menuButton, slip);
  const setSlip = (on: boolean): void => {
    slip.classList.toggle("open", on);
    menuButton.setAttribute("aria-expanded", String(on));
  };
  menuButton.addEventListener("click", () => setSlip(!slip.classList.contains("open")));
  for (const b of slip.querySelectorAll<HTMLElement>("[data-way]")) b.addEventListener("click", () => choose(b.dataset.way as Way));
  for (const b of slip.querySelectorAll<HTMLElement>("[data-view]")) {
    b.addEventListener("click", () => {
      setSlip(false);
      lab.leave(b.dataset.view ?? "");
    });
  }
  // A tap anywhere in the world folds the slip away.
  container.addEventListener("pointerdown", (e) => {
    if (slip.classList.contains("open") && !slip.contains(e.target as Node) && !menuButton.contains(e.target as Node)) setSlip(false);
  });

  let way: Way = readWay();
  let active = false;
  function apply(): void {
    for (const b of slip.querySelectorAll<HTMLElement>("[data-way]")) {
      const on = b.dataset.way === way;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
    }
    arrival.show(active && way === "titles");
    map.show(active && way === "map");
    compass.show(active && way === "markers");
    markers.group.visible = way === "markers";
    // Hidden markers stop no one.
    world.furnishingSolid(way === "markers");
    layer.dataset.way = way;
  }
  function choose(next: Way): void {
    way = next;
    try {
      localStorage.setItem(STORE, next);
    } catch {
      // Remembering is a convenience only.
    }
    apply();
  }
  apply();

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
      if (!active) return;
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
      if (way === "titles") arrival.frame(place, still, dt);
      else if (way === "markers") compass.frame(p.x, p.z, p.yaw, world.placeAt);
      else map.frame(p.x, p.z, p.yaw, place);
    },
    hook: {
      /** Chooses the way of finding one's way: "titles", "map" or "markers". */
      way: (next?: Way) => {
        if (next !== undefined) choose(next);
        return way;
      },
      /** Unfolds or folds the field map. */
      map: (on: boolean) => map.open(on),
      /** Opens or closes the slip in the corner. */
      slip: (on: boolean) => setSlip(on),
      /** Where the person is, and what each way shows now. */
      state: () => {
        const p = world.person();
        return { place: world.placeAt(p.x, p.z), titles: arrival.state(), compass: compass.state(), map: map.state(), markers: markers.crossings().length };
      },
      crossings: () => markers.crossings(),
    },
  };
}
