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
// above that the far form draws over the full one (`farness`). How a plant
// looks at each level is the plant's own (`createPlantInstances` in
// @gaia/render); this decides only which copies draw it.

import * as THREE from "three";
import { AIR, type Realized } from "@gaia/realize";
import { FAR_COPY, type InstanceSpot, type LevelCopies, type PlantView, type SceneLight, copySeed, createPlantInstances } from "@gaia/render";

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
 * texel to a pixel.
 */
export const FAR = { swapPx: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 64 : 128, band: 1.25 } as const;

/**
 * How far toward its far form a crown spanning `px` device pixels is, where
 * trees turn far at `swapPx`: 0 draws the full form alone, 1 the far form
 * alone, and in between the far form over the full one, that far into the band.
 */
export function farness(px: number, swapPx: number = FAR.swapPx): number {
  const top = swapPx * FAR.band;
  if (px >= top) return 0;
  if (px <= swapPx) return 1;
  return (top - px) / (top - swapPx);
}

/**
 * The frame budget: full trees' triangles a view may draw. Past it, trees
 * turn far at a larger crown, by at most `rise` of the swap size a second, so
 * nearer trees turn far, each through its own band; never past `most` times
 * the size the far forms baked at, where a card's texel spans 1.5 pixels.
 * Below `ease` of the budget it eases back. At 2% a second a tree moves at
 * most 5% of the way across the band in half a second, the swap test's
 * middle step, which changes the picture less than the wind does.
 */
export const BUDGET = { triangles: 1_500_000, rise: 0.02, most: 1.5, ease: 0.8 } as const;

export interface FrameBudget {
  /** The crown span, in device pixels, below which a tree draws far now. */
  readonly swapPx: number;
  /** Takes in the full trees' triangles the last view drew and the seconds since the one before. */
  update(fullTriangles: number, dt: number): void;
}

export function createFrameBudget(): FrameBudget {
  let swap: number = FAR.swapPx;
  return {
    get swapPx() {
      return swap;
    },
    update(full, dt) {
      // `rise` a second, whatever the frame rate.
      const step = (1 + BUDGET.rise) ** dt;
      if (full > BUDGET.triangles) swap = Math.min(FAR.swapPx * BUDGET.most, swap * step);
      else if (full < BUDGET.triangles * BUDGET.ease) swap = Math.max(FAR.swapPx, swap / step);
    },
  };
}

/** What a pass's own size means for detail: how many times smaller than the view it draws, its device pixels per meter one meter away (per meter, for an orthographic pass), and the crown span trees turn far at (`FAR.swapPx` unless the frame budget asks for more). */
export interface PassSize {
  readonly smaller: number;
  readonly focal: number;
  readonly ortho: boolean;
  readonly swapPx?: number;
}

const VIEW_SIZE: PassSize = { smaller: 1, focal: 0, ortho: false };

/** Every far copy one pass draws, from every blueprint, laid out for the far cards (`FAR_COPY` floats each). */
export interface FarBatch {
  copies: Float32Array;
  count: number;
}

export function createFarBatch(): FarBatch {
  return { copies: new Float32Array(FAR_COPY * 256), count: 0 };
}

/** A blueprint's far form: its index among the far cards' forms, and the batch each pass gathers far copies into. */
export interface FarOf {
  readonly form: number;
  readonly batch: FarBatch;
}

/** Every copy of one blueprint, and which of them each pass draws. */
export interface Copies extends PlantView {
  readonly count: number;
  /** The distance from which each level may draw, starting with 0 for the full detail. */
  readonly levels: readonly number[];
  /** The crown each copy's size on screen is measured by: the plant's built bounds at scale 1 where it stands. */
  readonly crown: THREE.Sphere;
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

/** Each copy as its far form draws it: where it stands (x, y, z), its yaw, scale, vitality and seed. */
function placesOf(spots: readonly InstanceSpot[]): Float32Array {
  const places = new Float32Array(spots.length * 7);
  spots.forEach((s, k) => places.set([s.x, s.y, s.z, s.yaw, s.scale, s.vitality ?? 1, copySeed(s)], k * 7));
  return places;
}

/** Each copy's crown: the center and radius of its built bounds, four numbers per copy. */
function crownsOf(spots: readonly InstanceSpot[], sphere: THREE.Sphere): Float32Array {
  const crowns = new Float32Array(spots.length * 4);
  spots.forEach((s, k) => crowns.set([s.x + sphere.center.x * s.scale, s.y + sphere.center.y * s.scale, s.z + sphere.center.z * s.scale, sphere.radius * s.scale], k * 4));
  return crowns;
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
 * see at the detail they need. Given its far form, a copy whose crown is small
 * on a pass's screen goes into `far.batch` instead, or as well inside the band.
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
  /** Each level's copies as last packed, kept while the same cells draw it. */
  let packed: LevelCopies[] = levels.map(() => ({ copies: [], key: "" }));
  /** What each level draws in this pass: a whole cell by its index, or the copies kept from a cell straddling the band. */
  const parts: (number | readonly number[])[][] = levels.map(() => []);

  /** Puts copy `k` into the far batch, drawn that far into its far form. */
  const card = (k: number, fade: number): void => {
    if (far === undefined) return;
    const batch = far.batch;
    if ((batch.count + 1) * FAR_COPY > batch.copies.length) {
      const grown = new Float32Array(batch.copies.length * 2);
      grown.set(batch.copies);
      batch.copies = grown;
    }
    const o = batch.count * FAR_COPY;
    batch.copies[o] = far.form;
    batch.copies.set(places.subarray(k * 7, k * 7 + 7), o + 1);
    batch.copies[o + 8] = fade;
    batch.count++;
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
    setVitality(v) {
      view.setVitality(v);
      for (let k = 0; k < view.count; k++) places[k * 7 + 5] = view.vitality;
    },
    setVitalityAt(index, v) {
      view.setVitalityAt(index, v);
      places[index * 7 + 5] = Math.min(1, Math.max(0, v));
    },
    cull(camera, size = VIEW_SIZE) {
      frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      for (const list of parts) list.length = 0;
      const eye = light.uEye.value;
      // A crown's span on this pass's screen, in device pixels, at distance d.
      const span = (radius: number, d: number): number => (2 * radius * size.focal) / (size.ortho ? 1 : Math.max(d, 1));
      const swapping = far !== undefined && detail === "auto" && size.focal > 0;
      const swapPx = size.swapPx ?? FAR.swapPx;
      inBand = 0;
      farAway = 0;
      cells.forEach((cell, i) => {
        const d = cell.built.center.distanceTo(eye);
        // Past where the air dissolves everything into the sky, nothing shows.
        if (d - cell.built.radius >= AIR.dissolveEnd || !frustum.intersectsSphere(cell.bounds)) return;
        const level = parts[levelFor(cell, size.smaller)] as (number | readonly number[])[];
        // Whole cells settle at once; only a cell straddling the band looks at each copy.
        if (!swapping || span(cell.crowns[0], d + cell.built.radius) >= swapPx * FAR.band) {
          level.push(i);
          return;
        }
        if (span(cell.crowns[1], d - cell.built.radius) < swapPx) {
          for (const k of cell.copies) card(k, 1);
          farAway += cell.copies.length;
          return;
        }
        const kept: number[] = [];
        for (const k of cell.copies) {
          const f = farness(span(crowns[k * 4 + 3] as number, Math.hypot((crowns[k * 4] as number) - eye.x, (crowns[k * 4 + 1] as number) - eye.y, (crowns[k * 4 + 2] as number) - eye.z)), swapPx);
          if (f < 1) kept.push(k);
          if (f > 0) card(k, f);
          if (f >= 1) farAway++;
          else if (f > 0) inBand++;
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
    warm: () => view.warm(),
    respot(next) {
      view.respot(next);
      cells = cellsOf(next, view.built, view.reach);
      crowns = crownsOf(next, view.built);
      places = placesOf(next);
      packed = levels.map(() => ({ copies: [], key: "" }));
    },
    drawn: () => ({ ...view.drawn(), band: inBand, far: farAway }),
    useDepth: (on) => view.useDepth(on),
    dispose: () => view.dispose(),
  };
}
