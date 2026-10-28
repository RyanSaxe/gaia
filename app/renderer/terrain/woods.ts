// Chooses which copies of each plant each pass draws, and at which level of
// detail. A pass draws only the `COPY_CELL` cells its camera sees, and a cell
// takes a coarser level only where every piece that level omits already draws
// nothing, so the switch changes no pixel. A copy whose crown is small on
// screen draws as its plant's far form while the form has a slot (`FAR`,
// `FAR_SLOTS`), and the card shader makes the same choice with `farChoice`
// from @gaia/render.

import * as THREE from "three";
import { AIR, type Realized, shownVitality } from "@gaia/realize";
import { type FarCards, type FarCopies, type FarTurn, type InstanceSpot, type LevelCopies, type PlantView, type SceneLight, createFarCards, createPlantInstances, crownsOf, farChoice, farness as farnessOf, PLACE_STRIDE, placesOf } from "@gaia/render";

/** The side of a cell, in meters. */
export const COPY_CELL = 32;
/** Meters a cell's nearest point must lie past a level's distance before it draws that level. */
const LEVEL_MARGIN = 0.5;

/** How `cull` picks levels. "auto" picks by distance from the eye. Tests force the finest or coarsest level to prove the switch changes no pixel. */
export type DetailMode = "auto" | "full" | "far";

/**
 * Far form thresholds, as crown spans in device pixels. A crown under
 * `swapPx` draws as its plant's far form, baked at one texel per pixel.
 * Between `swapPx` and `band` times it, the far form draws over the full
 * form, so a tree never changes form in a single frame. Below `swapPx`, a
 * perspective pass dissolves the full form until the crown spans
 * `swapPx / leave`. A coarse-pointer screen, such as a phone, halves
 * `swapPx`, which quarters the memory and the bake time. Bushes bake and
 * switch at `bush` times the trees' size, a sixteenth of a tree form's
 * memory. A bush switches 120 to 230 m away, so most bushes in view draw
 * their far form. In the proving ground's valley, 36 of 601 keep the full form.
 */
export const FAR = { swapPx: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 64 : 128, band: 1.25, bush: 0.25, leave: 1.15 } as const;

/**
 * Far form slots per card set, fixed for any world size. A tree form's slot
 * takes 32 MiB at a `swapPx` of 128 and 8 MiB at 64. A slot for bushes,
 * stones and flowers takes a sixteenth of that. far-stream.ts gives the slots
 * to the builds with the most copies drawn far, and every copy of any other
 * build keeps its full form. All 115 tree builds of Gaia's own world are in
 * range of every spot, and the 24 with the most far copies cover four in five
 * of its trees.
 */
export const FAR_SLOTS = { trees: 24, bushes: 96 } as const;

/**
 * Crown spans in device pixels below which a copy is too small to see. Under
 * `start`, a copy dissolves through the plant's own dissolve in its full or
 * far form, and at `end` it is gone. A cell whose largest crown spans fewer
 * than `end` pixels at its nearest point does not draw. A crown is the
 * plant's built bounds times the copy's scale.
 */
export const GONE = { start: 8, end: 4 } as const;

/** Meters from the eye past which a crown of `radius` meters is gone, on a pass of `focal` device pixels' focal length. */
export const goneAt = (radius: number, focal: number): number => (2 * radius * focal) / GONE.end;

/** The `FAR` and `GONE` thresholds in the form the far card shader takes. */
export const TURN: FarTurn = { band: FAR.band, leave: FAR.leave, gone: GONE };

/**
 * The far form's share for a crown spanning `px` device pixels, where trees
 * switch at `swapPx`. 0 draws the full form alone, 1 draws the far form
 * alone, and a value between draws the far form over the full one.
 */
export const farness = (px: number, swapPx: number = FAR.swapPx): number => farnessOf(px, swapPx, FAR.band);

/**
 * A pass's scale for choosing detail. `smaller` is how many times smaller than the view it draws. `focal` is its
 * device pixels per meter at one meter's distance, or per meter for an orthographic pass.
 */
export interface PassSize {
  readonly smaller: number;
  readonly focal: number;
  readonly ortho: boolean;
}

const VIEW_SIZE: PassSize = { smaller: 1, focal: 0, ortho: false };

/** A blueprint's far form, as its index in `forms`. The set's cards draw it while it has a slot. */
export interface FarOf {
  readonly form: number;
  readonly forms: FarForms;
  /** The crown span the form bakes and switches at, as a fraction of `FAR.swapPx`. Defaults to 1. */
  readonly share?: number;
}

/** A plant with a far form. */
export interface FarPlant {
  /** Crown span in device pixels at which its form bakes and its copies switch to it. */
  readonly px: number;
  /** The realized plant. far-stream.ts sets it to null once the far form is made, or when the world opens without a slot for it. */
  plant: Realized | null;
  /** Realizes the same plant again, off the main thread where possible, to bake its form later. */
  readonly again: () => Promise<Realized>;
}

/**
 * Plants with far forms, in form order, and the cards that draw them. The
 * cards have `FAR_SLOTS` slots. A form without a slot draws no card, and its
 * copies keep their full form.
 */
export interface FarForms {
  readonly count: number;
  readonly plants: readonly FarPlant[];
  /** The cards that draw each form's copies while the form has a slot. */
  readonly cards: FarCards;
  /** Adds a far form for `plant`, baked at `share` times `FAR.swapPx`, and returns the `FarOf` its copies take. `again` realizes the plant anew. */
  add(plant: Realized, again: () => Promise<Realized>, share?: number): FarOf;
  /** The slot of `form`, or -1 for none. */
  slotOf(form: number): number;
  /** The crown span in device pixels at which copies of `form` switch to it now, or 0 while it has no slot. */
  swapPx(form: number): number;
  /** Puts `form` in `slot`, or in none for -1, with its copies switching at `swapPx`. Its cards and full forms change from the next pass. */
  set(form: number, slot: number, swapPx: number): void;
  /** Returns the cards for one plant's copies of `form`, which draw while `anchor` is visible. `far` counts how many of them a view would draw far. */
  join(form: number, anchor: THREE.Object3D, far: (eye: THREE.Vector3, focal: number) => number): FarCopies;
  /** Counts, for each form, the copies a view from `eye` with a focal length of `focal` device pixels would draw far in any direction. */
  weigh(eye: THREE.Vector3, focal: number): Float64Array;
}

/** Whether `o` and every ancestor are visible. */
const shows = (o: THREE.Object3D): boolean => {
  for (let a: THREE.Object3D | null = o; a !== null; a = a.parent) if (!a.visible) return false;
  return true;
};

/** Creates far forms whose cards have `slots` slots and use `light`. `bareEdge` sharpens a bare copy's card (`createFarCards`). */
export function createFarForms(light: SceneLight, slots: number, bareEdge?: readonly [number, number]): FarForms {
  const plants: FarPlant[] = [];
  const state: { slot: number; swapPx: number }[] = [];
  const members: { copies: FarCopies; anchor: THREE.Object3D; far: (eye: THREE.Vector3, focal: number) => number }[][] = [];
  const cards = createFarCards(light, TURN, slots, bareEdge);
  const forms: FarForms = {
    get count() {
      return plants.length;
    },
    plants,
    cards,
    add(plant, again, share = 1) {
      plants.push({ px: FAR.swapPx * share, plant, again });
      state.push({ slot: -1, swapPx: 0 });
      members.push([]);
      return { form: plants.length - 1, forms, share };
    },
    slotOf: (form) => state[form]?.slot ?? -1,
    swapPx: (form) => state[form]?.swapPx ?? 0,
    set(form, slot, swapPx) {
      const s = state[form];
      if (s === undefined) throw new Error(`No far form ${form}; there are ${plants.length}.`);
      s.slot = slot;
      s.swapPx = slot < 0 ? 0 : swapPx;
      if (slot >= 0) cards.turnAt(slot, s.swapPx);
      for (const m of members[form] ?? []) m.copies.slot = slot;
    },
    join(form, anchor, far) {
      const list = members[form];
      if (list === undefined) throw new Error(`No far form ${form}; there are ${plants.length}.`);
      const own = cards.copies(anchor);
      own.slot = forms.slotOf(form);
      const copies: FarCopies = {
        place: (places, crowns) => own.place(places, crowns),
        setVitalityAt: (index, v) => own.setVitalityAt(index, v),
        useDepth: (on) => own.useDepth(on),
        get slot() {
          return own.slot;
        },
        set slot(slot: number) {
          own.slot = slot;
        },
        dispose() {
          const k = list.indexOf(member);
          if (k >= 0) list.splice(k, 1);
          own.dispose();
        },
      };
      const member = { copies, anchor, far };
      list.push(member);
      return copies;
    },
    // A hidden plant draws nothing far, such as the swap test's copies between its runs.
    weigh(eye, focal) {
      return Float64Array.from(members, (list) => list.reduce((n, m) => n + (shows(m.anchor) ? m.far(eye, focal) : 0), 0));
    },
  };
  return forms;
}

/** Every copy of one blueprint, and which of them each pass draws. */
export interface Copies extends PlantView {
  readonly count: number;
  /** The distance from which each level may draw, starting with 0 for the full detail. */
  readonly levels: readonly number[];
  /** The plant's built bounds at scale 1, which measure each copy's size on screen. */
  readonly crown: THREE.Sphere;
  /** The far form that copies small on screen switch to, if any. */
  readonly far: FarOf | undefined;
  /** Sets one copy's vitality. The shader reads it per instance. */
  setVitalityAt(index: number, v: number): void;
  /**
   * Sets up the pass about to render through `camera` to draw only the cells
   * it sees, each at the level its distance from the eye allows. A pass drawn
   * `size.smaller` times smaller than the view gives each cell the level it
   * would have that many times farther away.
   */
  cull(camera: THREE.Camera, size?: PassSize): void;
  /** Sets every level to draw, so its geometry uploads while a loading screen shows. The next `cull` undoes it. */
  warm(): void;
  /** Moves the copies to new spots, for a new bake that places the same blueprints elsewhere. */
  respot(spots: readonly InstanceSpot[]): void;
  /** How `cull` picks levels. Always "auto" outside tests. */
  detail: DetailMode;
  /**
   * Copies and triangles the last pass drew, and how many of those copies
   * were in the band or small enough for the far form. While the far form
   * has no slot, those copies draw the full form.
   */
  drawn(): { copies: number; triangles: number; band: number; far: number };
  /**
   * How many of its copies a view from `eye`, at `focal` device pixels per
   * radian, would draw as far forms in any direction once the form has a
   * slot. far-stream.ts ranks far forms by this count.
   */
  farCount(eye: THREE.Vector3, focal: number): number;
}

interface Cell {
  /** Indices of the copies in the cell. */
  readonly copies: readonly number[];
  /** Encloses every copy as drawn, including wind and growth. Culling uses it. */
  readonly bounds: THREE.Sphere;
  /** Encloses every copy as built, so no piece's center lies outside it. Level choice uses it. */
  readonly built: THREE.Sphere;
  /** The smallest and largest crown among its copies, as radii of their built bounds. */
  readonly crowns: readonly [number, number];
}

/** Groups a plant's copies into cells, given the plant's built bounds at scale 1 and how far past them it reaches as drawn. */
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
 * Places a copy of a realized plant at each of `spots`, and each pass draws
 * the copies it sees at the level they need. With `far`, while the far form
 * has a slot, each copy also has a card that draws where the copy is small on
 * a pass's screen, and the full form stops drawing there.
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
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  /** Each level's copies as last packed, reused while the same cells draw that level. */
  let packed: LevelCopies[] = levels.map(() => ({ copies: [], key: "" }));
  /** What each level draws in this pass: whole cells by index, or the copies kept from a cell that straddles the band. */
  const parts: (number | readonly number[])[][] = levels.map(() => []);
  /** Crown span in device pixels at which the far form bakes and, while it has a slot, the copies switch to it. */
  const formPx = FAR.swapPx * (far?.share ?? 1);

  /** Counts the copies a view from `eye` would draw far: those whose crowns span at most the band's top and more than `GONE.end`. */
  const farCount = (eye: THREE.Vector3, focal: number): number => {
    let n = 0;
    const top = formPx * FAR.band;
    for (let k = 0; k < crowns.length; k += 4) {
      const r = crowns[k + 3] as number;
      const d = Math.hypot((crowns[k] as number) - eye.x, (crowns[k + 1] as number) - eye.y, (crowns[k + 2] as number) - eye.z);
      if (d - r >= AIR.dissolveEnd) continue;
      const px = (2 * r * focal) / Math.max(d, 1);
      if (px > GONE.end && px <= top) n++;
    }
    return n;
  };
  /** The copies' cards, which draw from their form's slot while it has one. */
  const cards: FarCopies | null = far === undefined ? null : far.forms.join(far.form, view.object, farCount);
  cards?.place(places, crowns);

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
    // The cards rebuild from `places` whenever they repack their copies, so it stores each copy's shown vitality as `placesOf` writes it, not the raw vitality.
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
      // The card shader chooses each card on the GPU by the same rule as the full form below, at the form's current
      // `swapPx`. No card draws while the form has no slot or while detail is forced.
      const swapPx = far === undefined ? 0 : far.forms.swapPx(far.form);
      if (cards !== null && far !== undefined) cards.slot = detail === "auto" ? far.forms.slotOf(far.form) : -1;
      const swapping = swapPx > 0 && detail === "auto" && sized;
      // Below `swapPx`, a perspective pass dissolves the full form under its whole card until the crown spans
      // `leavePx`. The sun's shadow is orthographic, so it keeps the full form down to `swapPx` and the card casts the
      // shadow below that.
      const leaves = swapping && !size.ortho;
      const leavePx = leaves ? swapPx / FAR.leave : swapPx;
      view.nearLeaves(sized && !size.ortho ? size.focal : 0, leaves ? swapPx : 0, leaves ? leavePx : 0, [GONE.start, GONE.end]);
      inBand = 0;
      farAway = 0;
      cells.forEach((cell, i) => {
        const d = cell.built.center.distanceTo(eye);
        // Skip a cell past `AIR.dissolveEnd`, outside the frustum, or whose largest crown is too small to see.
        if (d - cell.built.radius >= AIR.dissolveEnd || !frustum.intersectsSphere(cell.bounds)) return;
        if (sized && !size.ortho && span(cell.crowns[1], d - cell.built.radius) <= GONE.end) return;
        const level = parts[levelFor(cell, size.smaller)] as (number | readonly number[])[];
        // A cell wholly above the band draws whole, and one wholly below `leavePx` draws only cards. Only a cell that
        // straddles the band checks each copy.
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
    farCount,
    useDepth(on) {
      view.useDepth(on);
      cards?.useDepth(on);
    },
    dispose() {
      cards?.dispose();
      view.dispose();
    },
  };
}
