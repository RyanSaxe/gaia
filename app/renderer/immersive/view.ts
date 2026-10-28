// Builds the layer over the world: the journal, field map, minimap, compass
// and help slip. A pick in the world opens the thing's journal page without
// moving the person, and a pick on a map or a page's picture moves them there.
// The world service keeps where the person stands and a painting of their view
// for the next visit.

import { type PlaceArea, stoodBy } from "@gaia/terrain";
import { type CodeWorld, areaVitality, entityOf, journalOf } from "@gaia/world";
import { SLIP_LOGO } from "../brand/logo.ts";
import { onTap } from "../tap.ts";
import { worldService } from "../service.ts";
import type { Landing, TripUnderWay, WorldHandle } from "../terrain/world.ts";
import { createCompass } from "./compass.ts";
import { createJournalBook } from "../journal/book.ts";
import { type Findable, createFinder, findablesOf } from "../journal/finder.ts";
import { drawMapPage, halfOf } from "../journal/maps.ts";
import { ROOM, journalPages } from "../journal/pages.ts";
import { createPaintings, paintKept } from "../journal/paintings.ts";
import { browserPaintings } from "../journal/painting-store.ts";
import { createSourceText } from "../journal/source.ts";
import { carriedSource } from "../terrain/code-world.ts";
import type { WordsSource } from "../journal/words.ts";
import { createFieldMap, drawLand } from "./field-map.ts";
import { MARKER_LAYER, createMarkers } from "./markers.ts";
import { createMinimap } from "./minimap.ts";
import { type Levels, soundLevels } from "../sound/levels.ts";

/** Painter version in every painting's key. Changing it invalidates every kept painting. */
const PAINTER = "painter-1";
/** Framing version in the title page's painting key. Changing it repaints only the title page. */
const FRONTISPIECE = "wide-2";
/** Every `every` ms while the person stands still, paints the nearest `count` things within `reach` meters, if they have moved `moved` meters since the last pass. */
const NEAR = { reach: 120, count: 24, every: 3000, moved: 15 } as const;
/**
 * `keepStood` runs every `check` ms and sends the person's position (`world.stood`) once they have moved `moved`
 * meters or turned `turned` degrees since the last send. While they walk, it sends at most every `every` ms. It also
 * sends on pagehide. Each send rewrites the app's settings, about a megabyte.
 */
const KEEP = { check: 3000, every: 30_000, moved: 2, turned: 20 } as const;
/**
 * Width in pixels of the view `paintStood` captures for this world's card on the start screen (`world.painting`). The
 * height follows the land's aspect ratio, and the journal's painter paints at twice this size. `paintStood` paints
 * again when the person stands still after moving or turning past the `KEEP` thresholds.
 */
const CARD_VIEW = 520;

export interface Immersive {
  setActive(on: boolean): void;
  frame(dt: number): void;
  /** Whether the journal is open and whether a page is turning. */
  book(): { readonly open: boolean; readonly turning: boolean };
  readonly hook: Readonly<Record<string, unknown>>;
}

/**
 * Covered jump timing. `coverMs` is how long the paper takes to cover the view, `settleFrames` the frames drawn under
 * it before it lifts and `revealMs` how long it takes to lift. `span` is the width in meters of the map on the paper.
 */
const JUMP = { coverMs: 480, settleFrames: 4, revealMs: 1100, span: 190 };

/** The slip's list of controls. `mouse-only` and `touch-only` spans hold the words for each kind of input. */
const WANDER = /* html */ `
  <dl class="slip-wander">
    <dt><span class="mouse-only">Click</span><span class="touch-only">Tap</span> the land</dt><dd>go there</dd>
    <dt><span class="mouse-only">Click</span><span class="touch-only">Tap</span> a thing</dt><dd>see its journal page</dd>
    <dt>Drag</dt><dd>look around</dd>
    <dt class="mouse-only">W A S D</dt><dd class="mouse-only">walk, Shift to hurry</dd>
    <dt><span class="mouse-only">Click</span><span class="touch-only">Tap</span> the minimap</dt><dd>open the journal map<span class="mouse-only"> (M); Esc folds it</span></dd>
    <dt><span class="mouse-only">Click</span><span class="touch-only">Tap</span> its edge</dt><dd>tuck it away, and again to bring it back</dd>
    <dt><span class="mouse-only">Click</span><span class="touch-only">Tap</span> the map</dt><dd>mark a place, then tap its mark to travel</dd>
  </dl>`;

export function createImmersive(container: HTMLElement, world: WorldHandle): Immersive {
  const layer = document.createElement("div");
  layer.className = "wayfinding";
  container.append(layer);

  // lab.css washes the world with `.reading` while the field map or the slip is open. A tap on it closes them and does not move the person.
  const reading = document.createElement("div");
  reading.className = "reading";
  layer.append(reading);
  // `cover` hides a jump. It fades in over the view in the paper's color while the map closes. `jumpTo` moves the
  // person under it and fades it out once the ground and grass at the new place have loaded.
  const cover = document.createElement("div");
  cover.className = "jump-cover";
  layer.append(cover);
  let jumping = false;
  function jump(x: number, z: number, center?: { readonly x: number; readonly z: number }, watch = false): boolean {
    const at = world.landing(x, z, center);
    if (at === null) {
      console.warn(`map: nowhere to land near (${Math.round(x)}, ${Math.round(z)})`);
      return false;
    }
    return jumpTo(at, false, watch);
  }
  /** The running trip started from the journal's map. The book stays open on the map until it arrives. */
  let watching: Readonly<TripUnderWay> | null = null;
  /**
   * Moves the person to a landing. `world.travel` walks them along the trails
   * or across the land, and the field map closes. If it finds no route, the
   * journal closes and a covered jump places them. With `watch`, used by the
   * journal's map, the book stays open on the map during the trip and closes
   * on arrival. With `face`, the person ends facing the landing's direction.
   */
  function jumpTo(at: Landing, face: boolean, watch = false): boolean {
    if (jumping) {
      console.warn("map: a jump is still under way, so this pick goes nowhere");
      return false;
    }
    if (world.travel(at, face)) {
      map.open(false);
      watching = watch ? world.trip() : null;
      return true;
    }
    journal.close();
    jumping = true;
    map.open(false);
    layPlace(at);
    cover.classList.add("on");
    window.setTimeout(async () => {
      // Bakes the land around the new place while the cover hides the view.
      await world.place(at);
      // The minimap writes the new place's name as the cover lifts.
      minimap.show(active);
      let frames = 0;
      const settle = (): void => {
        if (++frames < JUMP.settleFrames) {
          requestAnimationFrame(settle);
          return;
        }
        cover.classList.remove("on");
        window.setTimeout(() => {
          jumping = false;
          cover.replaceChildren();
        }, JUMP.revealMs);
      };
      requestAnimationFrame(settle);
    }, JUMP.coverMs);
    return true;
  }
  /**
   * Draws the field map around the landing onto the jump cover, so the cover is never blank however long the land
   * takes to load. lab.css `.jump-map` slowly zooms it toward the place.
   */
  function layPlace(at: Landing): void {
    const paper = map.paper();
    const w = layer.clientWidth;
    const h = layer.clientHeight;
    if (paper === null || w === 0 || h === 0) {
      cover.replaceChildren();
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement("canvas");
    canvas.className = "jump-map";
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.scale(dpr, dpr);
    drawLand(ctx, w, h, paper, world.baked(), { x: at.x, z: at.z, zoom: Math.max(w, h) / JUMP.span }, 1.35);
    cover.replaceChildren(canvas);
  }
  const map = createFieldMap(
    layer,
    { baked: world.baked, placeAt: world.placeAt, places: world.places },
    (open) => {
      if (open) setSlip(false);
    },
    jump,
  );
  const minimap = createMinimap(layer, map, world.baked, world.places, () => journal.open());

  // ---------- the journal, shut in the corner with the minimap on its cover ----------

  const service = worldService();
  const source = createSourceText(service, carriedSource());
  /** The journal's data for the current world. Null until a world loads. */
  let words: WordsSource | null = null;
  /**
   * Each thing's blueprint id or form in the current world, cached for
   * `keyOf`. A painting's key joins the project, world size, `PAINTER`, thing
   * id, this form and the thing's vitality, so a change to any of them repaints it.
   */
  let standsAs: { readonly code: CodeWorld; readonly as: ReadonlyMap<string, string> } | null = null;
  const keyOf = (thing: string, wide: boolean): string | null => {
    const code = world.code();
    if (code === null || words === null) return null;
    if (standsAs?.code !== code) standsAs = { code, as: new Map([...[...code.symbols.map((s) => [s.id, s] as const), ...code.plants.map((s) => [s.path, s] as const)].map(([id, s]) => [id, s.blueprint?.id ?? s.form] as const), ...code.things.map((t) => [t.path, t.blueprint.id] as const)]) };
    const of = words.journal.entry(entityOf(thing)) !== undefined ? entityOf(thing) : thing;
    return [code.projectId, Math.round(code.size), PAINTER, wide ? `${FRONTISPIECE}:${thing}` : thing, standsAs.as.get(thing) ?? "", words.vitality(of).toFixed(2)].join("|");
  };
  /** Paints each thing from the world's view before its page opens, only while the person is not walking, and stores the paintings in `browserPaintings`. */
  const paintings = createPaintings({ view: world.view, store: browserPaintings(), keyOf, idle: () => !world.person().walking });
  /** Positions of the things pages are about: buildings and landmarks, definitions, and each file's patch center. */
  let paintable: readonly { readonly id: string; readonly x: number; readonly z: number }[] = [];
  let paintedFrom = { x: Infinity, z: Infinity };
  // While the person stands still, paints the things nearest them so their pages are ready.
  window.setInterval(() => {
    const p = world.person();
    if (paintable.length === 0 || p.walking || Math.hypot(p.x - paintedFrom.x, p.z - paintedFrom.z) < NEAR.moved) return;
    paintedFrom = { x: p.x, z: p.z };
    const by = (t: { x: number; z: number }): number => Math.hypot(t.x - p.x, t.z - p.z);
    paintings.near([...paintable].filter((t) => by(t) < NEAR.reach).sort((a, b) => by(a) - by(b)).slice(0, NEAR.count).map((t) => t.id));
  }, NEAR.every);
  /**
   * Maps a page id to the id of its thing in the world. `entity:<path>` maps to the entity's path, `own:<file>` to the
   * file, and any other id to itself.
   */
  const standsFor = (of: string): string => (of.startsWith("entity:") ? of.slice("entity:".length) : of.startsWith("own:") ? of.slice("own:".length) : of);
  /**
   * The journal's map canvases by area, drawn once per field map paper: the whole land ("") for the endpapers and one
   * per folder. While the paper repaints after a vitality change, `mapOf` returns the map drawn from the previous paper.
   */
  let maps: { paper: unknown; drawn: Map<string, HTMLCanvasElement | null> } | null = null;
  function mapOf(area: string, w: number, h: number, fold: boolean): HTMLCanvasElement | null {
    const paper = map.paper();
    if (paper === null) return maps?.drawn.get(area) ?? null;
    if (maps?.paper !== paper) maps = { paper, drawn: new Map() };
    if (!maps.drawn.has(area)) maps.drawn.set(area, drawMapPage({ paper: map.paper, baked: world.baked, places: world.places, placeAt: world.placeAt }, area, w, h, fold));
    return maps.drawn.get(area) ?? null;
  }
  const pages = journalPages({
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
    trip: () => world.trip(),
    // A tap on a map's land calls `travelTo`, and the book stays open on the map during the trip. It closes if there is
    // nowhere to land. A tap on a page's picture calls `travel`, which closes the book.
    travelTo: (x, z) => {
      if (!jump(x, z, undefined, true)) journal.close();
    },
    travel: (of) => {
      const at = world.seenFrom(standsFor(of));
      if (at === null) return;
      journal.close();
      jumpTo(at, true);
    },
    text: (path) => source.when(path),
  });
  const journal = createJournalBook(layer, pages, (open) => {
    if (open) setSlip(false);
  });
  source.onArrive(() => journal.refresh());
  // A repainted field map paper redraws the open page's map.
  map.onPainted(() => journal.refresh());
  // Moves the minimap onto `journal.slip`, the slip under the strap on the journal's cover.
  const scrap = layer.querySelector(".minimap");
  if (scrap !== null) journal.slip.append(scrap);
  // The journal opens only on a tap. A tap on the closed book opens it at the map. A tap on a thing in the world opens
  // it at that thing's page and leaves the person where they are.
  world.onPick((id) => {
    if (!active) return;
    // A building or landmark opens its entity's page. A definition opens its own page, whatever its form.
    const at = [entityOf(id), id].find((of) => words?.journal.entry(of) !== undefined);
    if (at !== undefined) journal.open(at);
  });
  world.onHeading((thing) => minimap.heading(thing));
  const markers = createMarkers(world.light);
  world.scene.add(markers.group);
  world.camera.layers.enable(MARKER_LAYER);
  world.furnishingSolid(true);

  // The minimap writes the first place's name after the loading screen lifts, not while it covers the world.
  let lifted = false;
  world.onLifted(() => {
    lifted = true;
    minimap.show(active);
  });

  /** Paints the person's view with the journal's painter at the land's aspect ratio, as a WebP data URL. Null before a world loads. */
  async function paintWhereYouStand(): Promise<string | null> {
    const code = world.code();
    if (code === null) return null;
    const h = Math.round(CARD_VIEW / Math.max(1, code.aspect ?? 1));
    const kept = await paintKept(await world.look(CARD_VIEW, h), CARD_VIEW * 2, h * 2, `card:${code.projectId}`);
    if (kept === null) return null;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("the painting could not be read"));
      reader.readAsDataURL(kept);
    });
  }

  // Sends the person's position to the world service as they walk, so the next open starts there. Without a world service, nothing is kept.
  if (service !== null) {
    let kept: { readonly x: number; readonly z: number; readonly yaw: number; readonly at: number } | null = null;
    const keepStood = (): void => {
      const code = world.code();
      if (!lifted || code === null) return;
      const p = world.person();
      const now = performance.now();
      if (kept !== null) {
        const turned = Math.abs(Math.atan2(Math.sin(p.yaw - kept.yaw), Math.cos(p.yaw - kept.yaw))) * (180 / Math.PI);
        if (Math.hypot(p.x - kept.x, p.z - kept.z) < KEEP.moved && turned < KEEP.turned) return;
        if (p.walking && now - kept.at < KEEP.every) return;
      }
      kept = { x: p.x, z: p.z, yaw: p.yaw, at: now };
      service.send({ type: "world.stood", stood: stoodBy(code, p.x, p.z, p.yaw) });
    };
    // The opening position counts as sent, so nothing is sent until the person moves.
    world.onLifted(() => {
      const p = world.person();
      kept = { x: p.x, z: p.z, yaw: p.yaw, at: performance.now() };
    });
    // Paints the view where the person stands still for the start screen's card. The next open starts in that view.
    let painted: { readonly x: number; readonly z: number; readonly yaw: number } | null = null;
    let painting = false;
    const paintStood = (): void => {
      const code = world.code();
      const p = world.person();
      if (!lifted || code === null || painting || p.walking) return;
      if (painted !== null) {
        const turned = Math.abs(Math.atan2(Math.sin(p.yaw - painted.yaw), Math.cos(p.yaw - painted.yaw))) * (180 / Math.PI);
        if (Math.hypot(p.x - painted.x, p.z - painted.z) < KEEP.moved && turned < KEEP.turned) return;
      }
      painted = { x: p.x, z: p.z, yaw: p.yaw };
      painting = true;
      void paintWhereYouStand()
        .then((done) => done !== null && service.send({ type: "world.painting", painting: done }))
        .catch((error: unknown) => console.error(`gaia: no painting of where you stand: ${(error as Error).message}`))
        .finally(() => (painting = false));
    };
    window.setInterval(() => {
      keepStood();
      paintStood();
    }, KEEP.check);
    window.addEventListener("pagehide", () => {
      if (kept !== null) kept = { ...kept, at: -Infinity };
      keepStood();
    });
  }
  // Places the trail markers on every bake, before the grass and walking read the ground.
  world.furnish((baked) => markers.place(baked, (x, z): PlaceArea => world.placeAt(x, z).area));
  /** Whether the first bake has landed. Until then, no place names show. */
  let standing = false;
  world.onBaked(() => {
    standing = true;
    // A new world clears the paintings and paints its title page first, or loads a kept one, while the journal is shut.
    paintings.clear();
    paintings.ahead([""], true);
    const codeWorld = world.code();
    if (codeWorld !== null) {
      const patches = new Map<string, { x: number; z: number; n: number }>();
      for (const k of codeWorld.cells) {
        if (k.file === null || k.file === undefined) continue;
        const at = patches.get(k.file) ?? { x: 0, z: 0, n: 0 };
        patches.set(k.file, { x: at.x + k.x, z: at.z + k.z, n: at.n + 1 });
      }
      paintable = [
        ...codeWorld.things.map((t) => ({ id: t.path, x: t.x, z: t.z })),
        ...codeWorld.symbols.map((d) => ({ id: d.id, x: d.x, z: d.z })),
        ...[...patches].map(([id, at]) => ({ id, x: at.x / at.n, z: at.z / at.n })),
      ];
      paintedFrom = { x: Infinity, z: Infinity };
    }
    // `.standing` shows the wayfinding controls. No place name shows before the first bake.
    layer.classList.add("standing");
    // Writes the place name again for the new world.
    minimap.show(active);
    // Paints the field map paper behind the loading screen, so the minimap, which is cut from it, is ready when it shows.
    map.invalidate(!lifted);
    map.show(active);
    worldName.textContent = world.places().name;
    readVitality();
    // Gives the shut book's tabs the new world's chapters.
    journal.refresh();
  });
  /** Reads every thing's vitality from the current world into the journal's `words` and the markers' wear. */
  function readVitality(): void {
    const code = world.code();
    if (code !== null) {
      const pooled = areaVitality(code.patches.map((p) => ({ area: p.area, vitality: p.vitality, size: p.radius * p.radius })));
      // Each patch, definition and entity's own vitality. A definition uses its own value, whatever its form.
      const own = new Map([...code.patches.map((p) => [p.path, p.vitality] as const), ...code.symbols.map((d) => [d.id, d.vitality] as const), ...code.things.map((t) => [entityOf(t.path), t.vitality] as const)]);
      words = { journal: journalOf(code, ROOM), world: code, vitality: (of) => own.get(of) ?? own.get(standsFor(of)) ?? pooled.get(of) ?? 1, lines: (path) => source.lines(path) ?? undefined, thing: (of) => world.thing(standsFor(of)) };
    }
    // A directory's vitality pools its files and subdirectories, weighted by patch area, as the map's wash does.
    const vitality = areaVitality(world.places().patches.map((p) => ({ area: p.area, vitality: p.vitality, size: p.radius * p.radius })));
    markers.vitality((path) => vitality.get(path) ?? 1);
  }
  // Vitality changes in place, such as when the world updates to a new commit. A microtask batches the changes a tool
  // makes in a row. For each batch, the map's wash redraws while the page is idle, the changed things repaint and the
  // open page redraws. A thing shows its old painting until the new one is done.
  let changed: Set<string> | null = null;
  world.onVitality((ids) => {
    if (changed === null) {
      changed = new Set();
      queueMicrotask(() => {
        const all = [...(changed ?? [])];
        changed = null;
        readVitality();
        map.invalidate();
        paintings.repaint(all);
        journal.refresh();
      });
    }
    for (const id of ids) changed.add(id);
  });

  // ---------- the compass and its slip: Gaia's logo, the controls and the volume sliders ----------

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "way-button menu-button";
  menuButton.setAttribute("aria-label", "About this world");
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
    <div class="slip-head">Sound</div>
    <div class="slip-sound">
      <label class="slip-level"><span>Music</span><input type="range" min="0" max="100" step="1" data-ref="music"></label>
      <label class="slip-level"><span>World</span><input type="range" min="0" max="100" step="1" data-ref="world"></label>
    </div>`;
  layer.append(menuButton, slip);
  const worldName = slip.querySelector("[data-ref=world-name]") as HTMLElement;
  // Music and world volume, each from 0 (silent) to 1 (as mixed). `--level` sets how much of the slider is inked.
  const levels = soundLevels();
  for (const part of ["music", "world"] as const satisfies readonly (keyof Levels)[]) {
    const slider = slip.querySelector(`[data-ref=${part}]`) as HTMLInputElement;
    levels.watch((l) => {
      slider.value = String(Math.round(l[part] * 100));
      slider.style.setProperty("--level", `${l[part] * 100}%`);
    });
    slider.addEventListener("input", () => levels.set(part, Number(slider.value) / 100));
  }
  function setSlip(on: boolean): void {
    if (on) map.open(false);
    // A slider left focused would take the keys meant for walking.
    if (!on && slip.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    slip.classList.toggle("open", on);
    menuButton.setAttribute("aria-expanded", String(on));
  }
  menuButton.addEventListener("click", () => setSlip(!slip.classList.contains("open")));
  onTap(reading, () => {
    setSlip(false);
    map.open(false);
  });
  /** The finder's items for the current world, rebuilt when `words` changes. */
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
  // Listens in the capture phase, so Escape closes the open paper before any other handler gets the key.
  window.addEventListener(
    "keydown",
    (e) => {
      if (!active || e.target instanceof HTMLInputElement) return;
      // "/" opens the finder over the world or the open book.
      if (e.key === "/" && !jumping) {
        finder.open();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // M opens the journal at the map. While the journal is open, it handles every key.
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
    // The field map paints its paper only after the first bake. Before that it would paint the placeholder land and
    // keep it.
    map.show(active && standing);
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
    book: () => journal.state(),
    frame(dt) {
      if (!active || !standing) return;
      const p = world.person();
      const place = world.placeAt(p.x, p.z);
      // lab.css warms and dims the paper by `--night` after dark.
      const n = Math.round(world.light.uNightness.value * 20) / 20;
      if (n !== night) {
        night = n;
        container.style.setProperty("--night", String(n));
      }
      minimap.frame(p.x, p.z, p.yaw, place, dt);
      compass.turn(p.yaw, dt);
      map.frame(p.x, p.z, p.yaw, place);
      // The open book hides the world, so a trip may speed up. If the book shuts early, the trip returns to its normal speed.
      world.hurry(journal.isOpen);
      if (journal.isOpen) pages.follow();
      // A trip from the journal's map shuts the book once it arrives and the land around the person has loaded, so the
      // world never shows coarse ground. If another trip replaced it, the book stays as it is.
      if (watching !== null && world.trip() !== watching) {
        const arrived = watching.at.done;
        watching = null;
        if (arrived)
          void world.around(p.x, p.z).then(() => {
            if (watching === null) journal.close();
          });
      }
      // During any trip, lab.css darkens the wash over the world under the open book.
      layer.classList.toggle("travelling", world.trip() !== null);
    },
    hook: {
      /** Opens or closes the field map. */
      map: (on: boolean) => map.open(on),
      /** Sends the person to (x, z) as a tap on the map does. Returns false if there is nowhere to land nearby. */
      jump: (x: number, z: number) => jump(x, z),
      jumping: () => jumping,
      /** Opens or closes the slip in the corner. */
      slip: (on: boolean) => setSlip(on),
      /** Opens the journal at the map, "contents", or a thing's path or id. Null shuts it. */
      journal: (at?: string | null) => (at === null ? journal.close() : journal.open(at)),
      /** The state of a page's painting: waiting, painting, done, or none when no thing in the world matches the page. */
      painting: (of: string) => paintings.state(standsFor(of)),
      /** Tucks the minimap below the bottom of the screen or brings it back, as a tap on its edge does. */
      tuck: (on: boolean) => minimap.tuck(on),
      /** The person's place, the state of the minimap, compass, field map and journal, and the number of marked trail crossings. */
      state: () => {
        const p = world.person();
        return { place: world.placeAt(p.x, p.z), minimap: minimap.state(), compass: compass.state(), map: map.state(), markers: markers.crossings().length, journal: journal.state() };
      },
      crossings: () => markers.crossings(),
      /** The painting `paintStood` sends for the start screen's card (`world.painting`), as a WebP data URL. Null before a world loads. */
      look: () => paintWhereYouStand(),
    },
  };
}
