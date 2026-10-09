// Which copies of each plant draw, and at which detail, in each pass. Copies
// stand in square cells. Before every pass (the view, the sun's shadow and
// the water's mirror) each blueprint draws only the cells that pass's camera
// can see, each cell at the detail its distance from the eye allows. A
// coarser level leaves out whole pieces, and a cell draws it only once every
// piece it leaves out has already left on screen at the cell's nearest
// point, so the switch changes no pixel. A pass drawn smaller than the view
// (the water's mirror) chooses by its own size: its pieces leave sooner. How
// a plant looks at each level is the plant's own (`createPlantInstances` in
// @gaia/render); this decides only which copies draw it.

import * as THREE from "three";
import type { Realized } from "@gaia/realize";
import { type InstanceSpot, type LevelCopies, type PlantView, type SceneLight, createPlantInstances } from "@gaia/render";

/** The side of a cell, in meters. */
export const COPY_CELL = 32;
/** Meters a cell's nearest point must lie past a level's distance before it draws that level. */
const LEVEL_MARGIN = 0.5;

/** How copies choose their detail: by distance from the eye, or forced, to prove that the switch never shows. */
export type DetailMode = "auto" | "full" | "far";

/** Every copy of one blueprint, and which of them each pass draws. */
export interface Copies extends PlantView {
  readonly count: number;
  /** The distance from which each level may draw, starting with 0 for the full detail. */
  readonly levels: readonly number[];
  /** Sets one copy's vitality; the shader reads it per instance. */
  setVitalityAt(index: number, v: number): void;
  /**
   * Draws, in the pass about to render through `camera`, only the cells it
   * can see, each at the detail its distance from the eye allows. A pass
   * drawn `smaller` times smaller than the view gives each cell the detail it
   * would have that many times farther away.
   */
  cull(camera: THREE.Camera, smaller?: number): void;
  /** Readies every level to draw, so its geometry uploads while a loading screen holds the frame; the next `cull` undoes it. */
  warm(): void;
  /** Moves the copies to new spots: a world's new bake stands the same blueprints elsewhere. */
  respot(spots: readonly InstanceSpot[]): void;
  /** How copies choose their detail; "auto" outside of tests. */
  detail: DetailMode;
  /** Copies and triangles the last pass drew. */
  drawn(): { copies: number; triangles: number };
}

interface Cell {
  /** Indices of the copies standing in the cell. */
  readonly copies: readonly number[];
  /** Encloses every copy as drawn, wind and growth included: for culling. */
  readonly bounds: THREE.Sphere;
  /** Encloses every copy as built, so no piece's center lies outside it: for choosing detail. */
  readonly built: THREE.Sphere;
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
    cells.push({ copies, built: b, bounds: new THREE.Sphere(b.center.clone(), b.radius + reach) });
  }
  return cells;
}

/** Stands `spots` copies of a realized plant, each pass drawing the ones it can see at the detail they need. */
export function createCopies(plant: Realized, light: SceneLight, spots: readonly InstanceSpot[]): Copies {
  const view = createPlantInstances(plant, light, spots);
  const levels = view.levels;
  let cells = cellsOf(spots, view.built, view.reach);
  let detail: DetailMode = "auto";
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const chosen: number[][] = levels.map(() => []);
  /** Each level's copies as last packed, kept while the same cells draw it. */
  let packed: LevelCopies[] = levels.map(() => ({ copies: [], key: "" }));

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
    setVitality: (v) => view.setVitality(v),
    setVitalityAt: (index, v) => view.setVitalityAt(index, v),
    cull(camera, smaller = 1) {
      frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      for (const list of chosen) list.length = 0;
      cells.forEach((cell, i) => {
        if (frustum.intersectsSphere(cell.bounds)) (chosen[levelFor(cell, smaller)] as number[]).push(i);
      });
      packed = chosen.map((picked, k) => {
        const key = picked.join(",");
        const was = packed[k] as LevelCopies;
        return was.key === key ? was : { key, copies: picked.flatMap((i) => (cells[i] as Cell).copies) };
      });
      view.draw(packed);
    },
    warm: () => view.warm(),
    respot(next) {
      view.respot(next);
      cells = cellsOf(next, view.built, view.reach);
      packed = levels.map(() => ({ copies: [], key: "" }));
    },
    drawn: () => view.drawn(),
    useDepth: (on) => view.useDepth(on),
    dispose: () => view.dispose(),
  };
}
