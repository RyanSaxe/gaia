// Which copies of each plant draw, and at which detail, in each pass. Copies
// stand in square cells. Before every pass (the view, the sun's shadow and
// the water's mirror) each blueprint draws only the cells that pass's camera
// can see, each cell at the detail its distance from the eye allows. A
// coarser level leaves out whole pieces, and a cell draws it only once every
// piece it leaves out has already left on screen at the cell's nearest
// point, so the switch changes no pixel. A pass drawn smaller than the view
// (the water's mirror) chooses by its own size: its pieces leave sooner.
// Nothing past where the air has dissolved it into the sky draws at all.
// Every copy's crown also has a size on each pass's screen: a crown under
// `FAR.swapPx` device pixels draws as the plant's far form, and across a band
// above that the far form draws over the full one (`farChoice` in
// @gaia/render). Just past the band, where the far form already draws whole,
// the full form dissolves before it leaves (`FAR.leave`). The woods choose
// only the full form; each copy's card is chosen by the card's own shader, by
// the same rule, from buffers written when the copies are placed. Whatever
// its form, a crown too small to see dissolves and goes (`GONE`). How a plant
// looks at each level is the plant's own (`createPlantInstances` in
// @gaia/render); this decides only which copies draw it.

import * as THREE from "three";
import { AIR, type Realized, shownVitality } from "@gaia/realize";
import { type FarCards, type FarCopies, type FarTurn, type InstanceSpot, type LevelCopies, type PlantView, type SceneLight, createPlantInstances, crownsOf, farChoice, farness as farnessOf, PLACE_STRIDE, placesOf } from "@gaia/render";

/** The side of a cell, in meters. */
export const COPY_CELL = 32;
/** Meters a cell's nearest point must lie past a level's distance before it draws that level. */
const LEVEL_MARGIN = 0.5;

/** How copies choose their detail: by distance from the eye, or forced, to prove that the switch never shows. */
export type DetailMode = "auto" | "full" | "far";

/**
 * A crown spanning fewer device pixels than `swapPx` draws as its plant's
 * far form, where one texel of the baked views covers one pixel. Up to `band`
 * times that, the far form draws over the full one, so a tree never changes
 * form in a single frame. A touch-first screen (a phone) bakes and turns far
 * at half the size: a quarter of the memory and the bake, and still one
 * texel to a pixel. Bushes bake and turn far at `bush` of the trees' size, a
 * sixteenth of a tree form's memory: a bush turns far some 120 to 230 m
 * away, and most bushes in view stand farther (in the proving ground's
 * valley, 36 of 601 stay full).
 */
export const FAR = { swapPx: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 64 : 128, band: 1.25, bush: 0.25, leave: 1.15 } as const;

/**
 * Too small to see: a copy whose crown spans fewer device pixels than `start`
 * on a pass's screen dissolves, through the plant's own dissolve, full form
 * or far, and by `end` it is gone; a cell whose largest crown spans fewer
 * than `end` at its nearest point does not draw at all. A crown is its plant's
 * built bounds, times the copy's scale. Past its reach a thing is gone as the
 * grass is past its own.
 */
export const GONE = { start: 8, end: 4 } as const;

/** Meters from the eye past which a crown of `radius` meters is gone, on a pass of `focal` device pixels' focal length. */
export const goneAt = (radius: number, focal: number): number => (2 * radius * focal) / GONE.end;

/** When every copy turns far and goes, as the far cards' shader reads it. */
export const TURN: FarTurn = { band: FAR.band, leave: FAR.leave, gone: GONE };

/**
 * How far toward its far form a crown spanning `px` device pixels is, where
 * trees turn far at `swapPx`: 0 draws the full form alone, 1 the far form
 * alone, and in between the far form over the full one, that far into the band.
 */
export const farness = (px: number, swapPx: number = FAR.swapPx): number => farnessOf(px, swapPx, FAR.band);

/** What a pass's own size means for detail: how many times smaller than the view it draws, and its device pixels per meter one meter away (per meter, for an orthographic pass). */
export interface PassSize {
  readonly smaller: number;
  readonly focal: number;
  readonly ortho: boolean;
}

const VIEW_SIZE: PassSize = { smaller: 1, focal: 0, ortho: false };

/** A blueprint's far form: its index among its set's forms, and the set, whose cards draw it once baked. */
export interface FarOf {
  readonly form: number;
  readonly forms: FarForms;
  /** The crown span its form baked at, as a share of `FAR.swapPx`, and so of the size every pass turns it far at; 1 when omitted. */
  readonly share?: number;
}

/** Plants that take far forms, in their far cards' form order, and the cards once their forms have baked. */
export interface FarForms {
  readonly count: number;
  /** The cards of every form, once baked: until then every copy draws its full form. */
  cards: FarCards | null;
  /** Gives `plant` a far form baked at `share` of `FAR.swapPx`: what its copies take as their `far`. */
  add(plant: Realized, share?: number): FarOf;
  /**
   * Every plant added, in form order, and the crown span in device pixels its form bakes and turns far at. Nothing
   * may be added after, and the forms keep the plants no longer: the caller holds them only while their forms bake.
   */
  close(): readonly { readonly plant: Realized; readonly px: number }[];
}

export function createFarForms(): FarForms {
  const plants: { plant: Realized; px: number }[] = [];
  let count = 0;
  let closed = false;
  const forms: FarForms = {
    cards: null,
    get count() {
      return count;
    },
    add(plant, share = 1) {
      if (closed) throw new Error("The far forms are already baking; add every plant before they bake.");
      plants.push({ plant, px: FAR.swapPx * share });
      count = plants.length;
      return { form: count - 1, forms, share };
    },
    close() {
      closed = true;
      return plants.splice(0);
    },
  };
  return forms;
}

/** Every copy of one blueprint, and which of them each pass draws. */
export interface Copies extends PlantView {
  readonly count: number;
  /** The distance from which each level may draw, starting with 0 for the full detail. */
  readonly levels: readonly number[];
  /** The crown each copy's size on screen is measured by: the plant's built bounds at scale 1 where it stands. */
  readonly crown: THREE.Sphere;
  /** Its far form, when a copy small on screen turns far. */
  readonly far: FarOf | undefined;
  /** Its copies' far cards, once its far form has baked: they stand inside `object`. */
  readonly cards: THREE.Object3D | null;
  /** Sets one copy's vitality; the shader reads it per instance. */
  setVitalityAt(index: number, v: number): void;
  /**
   * Draws, in the pass about to render through `camera`, only the cells it
   * can see, each at the detail its distance from the eye allows. A pass
   * drawn `size.smaller` times smaller than the view gives each cell the
   * detail it would have that many times farther away.
   */
  cull(camera: THREE.Camera, size?: PassSize): void;
  /** Readies every level to draw, so its geometry uploads while a loading screen holds the frame; the next `cull` undoes it. */
  warm(): void;
  /** Moves the copies to new spots: a world's new bake stands the same blueprints elsewhere. */
  respot(spots: readonly InstanceSpot[]): void;
  /** How copies choose their detail; "auto" outside of tests. */
  detail: DetailMode;
  /**
   * Copies and triangles the last pass drew, and how many of those copies
   * were in the band or would be far forms by their crowns' size on its
   * screen. Until the plant has a far form, those draw the full form.
   */
  drawn(): { copies: number; triangles: number; band: number; far: number };
}

interface Cell {
  /** Indices of the copies standing in the cell. */
  readonly copies: readonly number[];
  /** Encloses every copy as drawn, wind and growth included: for culling. */
  readonly bounds: THREE.Sphere;
  /** Encloses every copy as built, so no piece's center lies outside it: for choosing detail. */
  readonly built: THREE.Sphere;
  /** The smallest and largest crown among its copies, as radii of their built bounds. */
  readonly crowns: readonly [number, number];
}

/** The cells copies of a plant stand in, given the plant's built bounds at scale 1 and how far past them it reaches as drawn. */
function cellsOf(spots: readonly InstanceSpot[], sphere: THREE.Sphere, reach: number): Cell[] {
  const byCell = new Map<string, number[]>();
  spots.forEach((s, k) => {
    const key = `${Math.floor(s.x / COPY_CELL)},${Math.floor(s.z / COPY_CELL)}`;
    const list = byCell.get(key);
    if (list === undefined) byCell.set(key, [k]);
    else list.push(k);
  });
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  const point = new THREE.Vector3();
  const cells: Cell[] = [];
  for (const copies of byCell.values()) {
    const built = new THREE.Box3();
    for (const k of copies) {
      const s = spots[k] as InstanceSpot;
      const tilt = 1 + Math.hypot(...(s.slope ?? [0, 0]));
      center.copy(sphere.center).multiplyScalar(s.scale).add(point.set(s.x, s.y, s.z));
      built.union(new THREE.Box3().setFromCenterAndSize(center, size.setScalar(sphere.radius * 2 * s.scale * tilt)));
    }
    const b = built.getBoundingSphere(new THREE.Sphere());
    const radii = copies.map((k) => sphere.radius * (spots[k] as InstanceSpot).scale);
    cells.push({ copies, built: b, bounds: new THREE.Sphere(b.center.clone(), b.radius + reach), crowns: [Math.min(...radii), Math.max(...radii)] });
  }
  return cells;
}

/**
 * Stands `spots` copies of a realized plant, each pass drawing the ones it can
 * see at the detail they need. Given its far form, once that has baked each
 * copy also has a card, which draws itself where the copy is small on a
 * pass's screen; the full form leaves there.
 */
export function createCopies(plant: Realized, light: SceneLight, spots: readonly InstanceSpot[], far?: FarOf): Copies {
  const view = createPlantInstances(plant, light, spots);
  const levels = view.levels;
  let cells = cellsOf(spots, view.built, view.reach);
  let crowns = crownsOf(spots, view.built);
  let places = placesOf(spots);
  let inBand = 0;
  let farAway = 0;
  let detail: DetailMode = "auto";
  /** The copies' cards, made once the far form has baked. */
  let cards: FarCopies | null = null;
  /** Whether the copies draw their depth, for the sun's shadow: cards made meanwhile must too. */
  let depth = false;
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  /** Each level's copies as last packed, kept while the same cells draw it. */
  let packed: LevelCopies[] = levels.map(() => ({ copies: [], key: "" }));
  /** What each level draws in this pass: a whole cell by its index, or the copies kept from a cell straddling the band. */
  const parts: (number | readonly number[])[][] = levels.map(() => []);

  /** The copies' cards, made from their places and crowns the first time they are wanted once the far form has baked. */
  const cardsNow = (): FarCopies | null => {
    const baked = far?.forms.cards ?? null;
    if (cards === null && baked !== null && far !== undefined) {
      cards = baked.copies(far.form);
      cards.place(places, crowns);
      // Made in the middle of the sun's shadow pass, they draw its depth, never their color into the map they read.
      cards.useDepth(depth);
      view.object.add(cards.object);
    }
    return cards;
  };

  const levelFor = (cell: Cell, smaller: number): number => {
    if (detail === "full") return 0;
    if (detail === "far") return levels.length - 1;
    const near = (cell.built.center.distanceTo(light.uEye.value) - cell.built.radius) * smaller;
    let pick = 0;
    for (let k = 1; k < levels.length; k++) if ((levels[k] as number) <= near - LEVEL_MARGIN) pick = k;
    return pick;
  };

  return {
    object: view.object,
    height: view.height,
    radius: view.radius,
    levels,
    crown: view.built.clone(),
    far,
    get cards() {
      return cards?.object ?? null;
    },
    get count() {
      return view.count;
    },
    get triangles() {
      return view.triangles;
    },
    get vitality() {
      return view.vitality;
    },
    get detail() {
      return detail;
    },
    set detail(mode: DetailMode) {
      detail = mode;
    },
    // `places` is what cards made later stand from, so it holds how each copy's vitality shows (as `placesOf` writes it), never the vitality.
    setVitality(v) {
      view.setVitality(v);
      for (let k = 0; k < view.count; k++) {
        places[k * PLACE_STRIDE + 5] = shownVitality(view.vitality);
        cards?.setVitalityAt(k, view.vitality);
      }
    },
    setVitalityAt(index, v) {
      view.setVitalityAt(index, v);
      places[index * PLACE_STRIDE + 5] = shownVitality(v);
      cards?.setVitalityAt(index, v);
    },
    cull(camera, size = VIEW_SIZE) {
      frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      for (const list of parts) list.length = 0;
      const eye = light.uEye.value;
      // A crown's span on this pass's screen, in device pixels, at distance d.
      const span = (radius: number, d: number): number => (2 * radius * size.focal) / (size.ortho ? 1 : Math.max(d, 1));
      const sized = size.focal > 0;
      const card = cardsNow();
      // Each card chooses itself on the GPU, by the same rule as the full form below; forced detail draws none.
      if (card !== null) card.object.visible = detail === "auto";
      const swapping = card !== null && detail === "auto" && sized;
      const swapPx = FAR.swapPx * (far?.share ?? 1);
      // Past the band's end a perspective pass's full form dissolves under its whole card until its crown spans
      // `leavePx`; the sun's shadow, a flat pass, keeps the full form to the band's end, as the card casts from there.
      const leaves = swapping && !size.ortho;
      const leavePx = leaves ? swapPx / FAR.leave : swapPx;
      view.nearLeaves(sized && !size.ortho ? size.focal : 0, leaves ? swapPx : 0, leaves ? leavePx : 0, [GONE.start, GONE.end]);
      inBand = 0;
      farAway = 0;
      cells.forEach((cell, i) => {
        const d = cell.built.center.distanceTo(eye);
        // Past where the air dissolves everything into the sky, nothing shows; nor does a cell whose every crown is too small to see.
        if (d - cell.built.radius >= AIR.dissolveEnd || !frustum.intersectsSphere(cell.bounds)) return;
        if (sized && !size.ortho && span(cell.crowns[1], d - cell.built.radius) <= GONE.end) return;
        const level = parts[levelFor(cell, size.smaller)] as (number | readonly number[])[];
        // Whole cells settle at once; only a cell straddling the band looks at each copy.
        if (!swapping || span(cell.crowns[0], d + cell.built.radius) >= swapPx * FAR.band) {
          level.push(i);
          return;
        }
        if (span(cell.crowns[1], d - cell.built.radius) < leavePx) {
          farAway += cell.copies.length;
          return;
        }
        const kept: number[] = [];
        for (const k of cell.copies) {
          const px = span(crowns[k * 4 + 3] as number, Math.hypot((crowns[k * 4] as number) - eye.x, (crowns[k * 4 + 1] as number) - eye.y, (crowns[k * 4 + 2] as number) - eye.z));
          const { full, card: fade } = farChoice(px, swapPx, TURN, size.ortho);
          if (full) kept.push(k);
          else if (fade > 0) farAway++;
          if (full && fade > 0) inBand++;
        }
        if (kept.length === cell.copies.length) level.push(i);
        else if (kept.length > 0) level.push(kept);
      });
      packed = parts.map((list, k) => {
        const key = list.map((p) => (typeof p === "number" ? p : `[${p.join(".")}]`)).join(",");
        const was = packed[k] as LevelCopies;
        return was.key === key ? was : { key, copies: list.flatMap((p) => (typeof p === "number" ? (cells[p] as Cell).copies : p)) };
      });
      view.draw(packed);
    },
    warm() {
      view.warm();
      // The cards stand in the scene from here, so their shaders compile with everything else.
      cardsNow();
    },
    respot(next) {
      view.respot(next);
      cells = cellsOf(next, view.built, view.reach);
      crowns = crownsOf(next, view.built);
      places = placesOf(next);
      cards?.place(places, crowns);
      packed = levels.map(() => ({ copies: [], key: "" }));
    },
    drawn: () => ({ ...view.drawn(), band: inBand, far: farAway }),
    useDepth(on) {
      depth = on;
      view.useDepth(on);
      cards?.useDepth(on);
    },
    dispose() {
      cards?.dispose();
      view.dispose();
    },
  };
}
