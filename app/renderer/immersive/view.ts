// The immersive world: the terrain lab's world, full screen, with nothing on
// it but the world itself and three quiet ways of knowing where you are, all
// at once, drawn on one field sheet (docs/design-system.md, "The field
// sheet"): the minimap, a torn scrap of the field map low at the right that
// turns with the person and letters the area's name (`minimap.ts`), the field
// map that unfolds out of it, and markers in the world. Touching the world
// only ever moves you (docs/design-system.md, "One way to touch the world");
// walking up to a thing, the scrap rings it, and stopping at a thing raises
// its page at the lower left (`sketch.ts`). The compass in the top right corner points north
// (`compass.ts`) and opens the one other paper, the slip, with Gaia's mark,
// how to wander, and the way back to the lab's debugging views.
// Walking, tapping a thing to walk up to it, the lantern and the hour all
// come from the terrain lab. Once the world stands and its map is painted, a
// picture of the whole map goes to the world service, which keeps it with the
// world for the start (`picture.ts`).

import type { PlaceArea } from "@gaia/terrain";
import { areaVitality, entityOf, journalOf, ownOf } from "@gaia/world";
import { SLIP_LOGO } from "../brand/logo.ts";
import { onTap } from "../lab.ts";
import { worldService } from "../service.ts";
import type { Landing, WorldHandle } from "../terrain/lab.ts";
import { createCompass } from "./compass.ts";
import { createJournalBook } from "../journal/book.ts";
import { type Findable, createFinder, findablesOf } from "../journal/finder.ts";
import { drawMapPage, halfOf } from "../journal/maps.ts";
import { ROOM, journalPages } from "../journal/pages.ts";
import { createPaintings } from "../journal/paintings.ts";
import { browserPaintings } from "../journal/painting-store.ts";
import { createSourceText } from "../journal/source.ts";
import type { WordsSource } from "../journal/words.ts";
import { createFieldMap } from "./field-map.ts";
import { MARKER_LAYER, createMarkers } from "./markers.ts";
import { createMinimap } from "./minimap.ts";
import { paintPicture } from "./picture.ts";

/** The lab's debugging views, which the slip leads back to. */
/** The painter the journal's kept paintings were made by: a new one paints them all afresh. */
const PAINTER = "painter-1";
/** The things near the person painted while they stand still: within `reach` meters, the nearest `count`, looked at every `every` ms once they have moved `moved` meters. */
const NEAR = { reach: 120, count: 24, every: 3000, moved: 15 } as const;

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

/** How to wander, as the slip says it: a mouse and keys, or a finger. */
const WANDER = /* html */ `
  <dl class="slip-wander">
    <dt><span class="mouse-only">Click</span><span class="touch-only">Tap</span> the land</dt><dd>go there</dd>
    <dt><span class="mouse-only">Click</span><span class="touch-only">Tap</span> a thing</dt><dd>walk up and see its page</dd>
    <dt>Drag</dt><dd>look around</dd>
    <dt class="mouse-only">W A S D</dt><dd class="mouse-only">walk, Shift to hurry</dd>
    <dt><span class="mouse-only">Click</span><span class="touch-only">Tap</span> the minimap</dt><dd>unfold the map<span class="mouse-only"> (M); Esc folds it</span></dd>
    <dt><span class="mouse-only">Click</span><span class="touch-only">Tap</span> its edge</dt><dd>tuck it away, and again to bring it back</dd>
    <dt><span class="mouse-only">Click</span><span class="touch-only">Tap</span> the map</dt><dd>go to that place</dd>
  </dl>`;

export function createImmersive(container: HTMLElement, world: WorldHandle, lab: LabViews): Immersive {
  const layer = document.createElement("div");
  layer.className = "wayfinding";
  container.append(layer);

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
    const at = world.landing(x, z, heart);
    return at !== null && jumpTo(at);
  }
  function jumpTo(at: Landing): boolean {
    if (jumping) return false;
    jumping = true;
    map.open(false);
    cover.classList.add("on");
    window.setTimeout(() => {
      world.place(at);
      // The new place writes its name as the world dissolves in.
      minimap.show(active);
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
  const minimap = createMinimap(layer, map, world.stood, world.places, () => journal.open());

  // ---------- the traveller's journal, closed in the corner with the minimap on its cover ----------

  const service = worldService();
  const source = createSourceText(service);
  /** What the journal's pages are read from, for the world standing now. */
  let words: WordsSource | null = null;
  /**
   * Each painting's key where it is kept: its world, its thing and the
   * thing's vitality, which its painting shows, so a thing that changed is
   * painted afresh. A new painter makes every painting afresh.
   */
  const keyOf = (thing: string, wide: boolean): string | null => {
    const code = world.code();
    if (code === null || words === null) return null;
    const of = words.journal.entry(entityOf(thing)) !== undefined ? entityOf(thing) : thing;
    return [code.projectId, Math.round(code.size), PAINTER, wide ? `wide:${thing}` : thing, words.vitality(of).toFixed(2)].join("|");
  };
  /** Each thing's painting: the world's own view of it, made before its page is ever seen, and kept with the world. */
  const paintings = createPaintings({ view: world.view, store: browserPaintings(), keyOf, idle: () => !world.person().walking });
  /** Where each thing a page is about stands: buildings and landmarks, definitions, and each file's patch. */
  let paintable: readonly { readonly id: string; readonly x: number; readonly z: number }[] = [];
  let paintedFrom = { x: Infinity, z: Infinity };
  // While the person stands still, the things nearest them are painted, so a page they walk up to is ready.
  window.setInterval(() => {
    const p = world.person();
    if (paintable.length === 0 || p.walking || Math.hypot(p.x - paintedFrom.x, p.z - paintedFrom.z) < NEAR.moved) return;
    paintedFrom = { x: p.x, z: p.z };
    const by = (t: { x: number; z: number }): number => Math.hypot(t.x - p.x, t.z - p.z);
    paintings.near([...paintable].filter((t) => by(t) < NEAR.reach).sort((a, b) => by(a) - by(b)).slice(0, NEAR.count).map((t) => t.id));
  }, NEAR.every);
  /**
   * What stands in the world for a page: an entity's building or landmark by its path, a file's own page by the
   * file, a file or a definition as itself.
   */
  const standsFor = (of: string): string => (of.startsWith("entity:") ? of.slice("entity:".length) : of.startsWith("own:") ? of.slice("own:".length) : of);
  /** Each map the journal holds, drawn once per painted paper: the whole land across the endpapers, and each folder's. */
  let maps: { paper: unknown; drawn: Map<string, HTMLCanvasElement | null> } | null = null;
  function mapOf(area: string, w: number, h: number, fold: boolean): HTMLCanvasElement | null {
    const paper = map.paper();
    if (paper === null) return null;
    if (maps?.paper !== paper) maps = { paper, drawn: new Map() };
    if (!maps.drawn.has(area)) maps.drawn.set(area, drawMapPage({ paper: map.paper, stood: world.stood, places: world.places, placeAt: world.placeAt }, area, w, h, fold));
    return maps.drawn.get(area) ?? null;
  }
  const journal = createJournalBook(
    layer,
    journalPages({
      words: () => words,
      endpaper: (side) => {
        const spread = mapOf("", 1040, 660, true);
        return spread === null ? null : halfOf(spread, side);
      },
      map: (area) => mapOf(area, 520, 660, false),
      picture: (of) => paintings.picture(standsFor(of)),
      painted: (of) => (of === "" ? paintings.painted("", true) : paintings.painted(standsFor(of))),
      frontispiece: () => paintings.picture("", true),
      ahead: (ofs) => paintings.ahead(ofs.map(standsFor)),
      turnTo: (at) => journal.turnTo(at),
      person: () => world.person(),
      mapped: () =>
        new Promise<void>((resolve) => {
          const look = (): void => void (map.paper() !== null ? resolve() : window.setTimeout(look, 150));
          look();
        }),
      // Words turn pages; a map's land and a page's picture take the person into the world, the book shutting as they go.
      travelTo: (x, z) => {
        journal.close();
        jump(x, z);
      },
      travel: (of) => {
        const at = world.seenFrom(standsFor(of));
        if (at === null) return;
        journal.close();
        jumpTo(at);
      },
      text: (path) => source.when(path),
    }),
    (open) => {
      if (open) setSlip(false);
    },
    // The lower left is being tried (`?journal=left`); the lower right is where it rests.
    new URLSearchParams(location.search).get("journal") === "left" ? "left" : "right",
  );
  source.onArrive(() => journal.refresh());
  // The minimap lies on the slip under the strap across the journal's cover.
  const scrap = layer.querySelector(".minimap");
  if (scrap !== null) journal.slip.append(scrap);
  // The journal opens only when asked: a tap on the closed book opens it at the map, and a tap on a thing in the
  // world opens it at that thing's page, where the person stands. It never opens on its own.
  world.onPick((id) => {
    if (!active) return;
    // A building or landmark is its entity's page, a file's tree its file's own page, and anything else its own.
    const at = [entityOf(id), ownOf(id), id].find((of) => words?.journal.entry(of) !== undefined);
    if (at !== undefined) journal.open(at);
  });
  world.onHeading((thing) => minimap.heading(thing));
  const markers = createMarkers(world.light);
  world.scene.add(markers.group);
  world.camera.layers.enable(MARKER_LAYER);
  world.furnishingSolid(true);

  // The first place writes its name as the wait gives way to the world, not under it.
  world.onLifted(() => minimap.show(active));
  // Markers stand beside the trails on every bake, before the grass and the walk read the ground.
  world.furnish((stood) => markers.place(stood, (x, z): PlaceArea => world.placeAt(x, z).area));
  /** Whether a world stands yet: until the first bake lands, nothing names a place. */
  let standing = false;
  world.onStood(() => {
    standing = true;
    // A world stood afresh is painted afresh, or found kept: its title page first, out of sight.
    paintings.clear();
    paintings.ahead([""], true);
    const stood = world.code();
    if (stood !== null) {
      const patches = new Map<string, { x: number; z: number; n: number }>();
      for (const k of stood.cells) {
        if (k.file === null || k.file === undefined) continue;
        const at = patches.get(k.file) ?? { x: 0, z: 0, n: 0 };
        patches.set(k.file, { x: at.x + k.x, z: at.z + k.z, n: at.n + 1 });
      }
      paintable = [
        ...stood.things.map((t) => ({ id: t.path, x: t.x, z: t.z })),
        ...stood.symbols.map((d) => ({ id: d.id, x: d.x, z: d.z })),
        ...[...patches].map(([id, at]) => ({ id, x: at.x / at.n, z: at.z / at.n })),
      ];
      paintedFrom = { x: Infinity, z: Infinity };
    }
    // The ways of knowing where you are come in as the veil lifts: nothing names a place before the world stands.
    layer.classList.add("standing");
    // A new world writes where the person stands afresh.
    minimap.show(active);
    map.invalidate();
    worldName.textContent = world.places().name;
    const code = world.code();
    if (code !== null) {
      const pooled = areaVitality(code.patches.map((p) => ({ area: p.area, vitality: p.vitality, size: p.radius * p.radius })));
      // Every item's own vitality, as the world carries it: a definition's is its own slot, whatever fills it.
      const own = new Map([...code.patches.map((p) => [p.path, p.vitality] as const), ...code.symbols.map((d) => [d.id, d.vitality] as const), ...code.things.map((t) => [entityOf(t.path), t.vitality] as const)]);
      words = { journal: journalOf(code, ROOM), world: code, vitality: (of) => own.get(of) ?? own.get(standsFor(of)) ?? pooled.get(of) ?? 1, lines: (path) => source.lines(path) ?? undefined, judged: (of) => world.judged(standsFor(of)) };
    }
    // A directory's vitality: its files', its subdirectories' included, pooled by the ground each holds, as the map washes it.
    const vitality = areaVitality(world.places().patches.map((p) => ({ area: p.area, vitality: p.vitality, size: p.radius * p.radius })));
    markers.vitality((path) => vitality.get(path) ?? 1);
  });

  // The first map painted after the world stands is pictured for the start; a page with no world service keeps none.
  let pictured = false;
  map.onPainted(() => {
    const paper = map.paper();
    if (pictured || !standing || service === null || paper === null) return;
    pictured = true;
    paintPicture(paper, world.stood()).then(
      (picture) => service.send({ type: "world.picture", picture }),
      (error: unknown) => console.error(`gaia: no picture of this world: ${(error as Error).message}`),
    );
  });

  // ---------- the compass, and the slip it opens: Gaia's mark, how to wander, and the way back to the lab ----------

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "way-button menu-button";
  menuButton.setAttribute("aria-label", "About this world, and the lab");
  menuButton.setAttribute("aria-expanded", "false");
  const compass = createCompass(menuButton);
  const slip = document.createElement("div");
  slip.className = "way-slip";
  slip.setAttribute("role", "dialog");
  slip.setAttribute("aria-label", "Gaia");
  slip.innerHTML = /* html */ `
    <img class="slip-mark" src="${SLIP_LOGO}" alt="Gaia">
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
  /** Everything the finder turns the journal to, for the world standing now. */
  let findable: { readonly words: WordsSource; readonly items: readonly Findable[] } | null = null;
  const finder = createFinder(
    layer,
    () => {
      if (words === null) return [];
      if (findable?.words !== words) findable = { words, items: findablesOf(words.journal) };
      return findable.items;
    },
    (at) => journal.open(at),
  );
  // Escape folds whatever paper is open before anything under it hears the key.
  window.addEventListener(
    "keydown",
    (e) => {
      if (!active || e.target instanceof HTMLInputElement) return;
      // "/" lays the finder over the world, or over the open book.
      if (e.key === "/" && !jumping) {
        finder.open();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // M opens the journal, at the map; while it is open, the book has every key.
      if (e.code === "KeyM" && !jumping && !journal.isOpen) {
        journal.open();
        e.stopPropagation();
        return;
      }
      if (e.code !== "Escape") return;
      if (map.isOpen) map.open(false);
      else if (slip.classList.contains("open")) setSlip(false);
      else return;
      e.stopPropagation();
    },
    true,
  );

  let active = false;
  function apply(): void {
    map.show(active);
    minimap.show(active);
  }

  apply();
  let night = -1;
  return {
    setActive(on) {
      active = on;
      layer.hidden = !on;
      if (!on) {
        setSlip(false);
        finder.close();
        journal.close();
      }
      apply();
    },
    frame(dt) {
      if (!active || !standing) return;
      const p = world.person();
      const place = world.placeAt(p.x, p.z);
      // After dark, paper is read by the lantern: lab.css warms and dims it by this.
      const n = Math.round(world.light.uNightness.value * 20) / 20;
      if (n !== night) {
        night = n;
        container.style.setProperty("--night", String(n));
      }
      minimap.frame(p.x, p.z, p.yaw, place, dt);
      compass.turn(p.yaw, dt);
      map.frame(p.x, p.z, p.yaw, place);
    },
    hook: {
      /** Unfolds or folds the field map. */
      map: (on: boolean) => map.open(on),
      /** Sends the person to (x, z) as a tap on the map would; false if nowhere near is fit. */
      jump: (x: number, z: number) => jump(x, z),
      /** Whether a jump is under way. */
      jumping: () => jumping,
      /** Opens or closes the slip in the corner. */
      slip: (on: boolean) => setSlip(on),
      /** Opens the journal at a place (the map, "contents", or a thing's path or id), or shuts it with null. */
      journal: (at?: string | null) => (at === null ? journal.close() : journal.open(at)),
      /** How far the painting of a page's thing is: waiting, painting, done, or none when nothing stands for it. */
      painting: (of: string) => paintings.state(standsFor(of)),
      /** Tucks the minimap below the screen's foot, or brings it back, as a tap on its edge does. */
      tuck: (on: boolean) => minimap.tuck(on),
      /** Where the person is, what each way of knowing it shows now, and the page of the thing they stopped at. */
      state: () => {
        const p = world.person();
        return { place: world.placeAt(p.x, p.z), minimap: minimap.state(), compass: compass.state(), map: map.state(), markers: markers.crossings().length, journal: journal.state() };
      },
      crossings: () => markers.crossings(),
      /** A picture of the whole map as the start lays it on its table: a WebP data URL, or null before the map is painted. */
      picture: () => {
        const paper = map.paper();
        return paper === null ? null : paintPicture(paper, world.stood());
      },
    },
  };
}
