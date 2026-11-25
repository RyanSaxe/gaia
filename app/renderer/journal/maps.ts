// Draws the journal's map pages with the field map's `drawLand`: the whole
// land across the endpapers, a folder's land on its chapter's left-hand page,
// and a file's patch on the left-hand page of a file with definitions. Every
// map runs off the page's edges, and its names keep clear of the edges and the
// fold. A tap on a name turns to that folder's or file's page.

import type { Place, WorldPlaces } from "@gaia/terrain";
import { landReach, pastTheEdge } from "@gaia/terrain";
import {
  CLOSE,
  type Paper,
  drawLand,
  haloOf,
  letter,
  letterName,
} from "../immersive/field-map.ts";
import {
  SERIF,
  canvasMeasure,
  nameFont,
  nameSpacing,
  placeNames,
} from "../immersive/map-names.ts";
import type { BakedWorld } from "../terrain/world.ts";

export interface MapSource {
  paper(): Paper | null;
  baked(): BakedWorld;
  places(): WorldPlaces;
  placeAt(x: number, z: number): Place;
}

/** In px, the large and small name sizes and the least clearance names keep from the page's edge and the fold. */
const NAME = { large: 22, small: 14, edge: 14, fold: 10 } as const;
/** Device pixels per page pixel, so a map stays sharp on a dense screen. */
const DPR = 2;

type Box = [number, number, number, number];

/** Hit testing for a map page: the world spot under a tap, or the path of the name it falls on. */
export interface MapTaps {
  at(px: number, py: number): { readonly x: number; readonly z: number };
  name(px: number, py: number): string | null;
  /** The box a name under (px, py) is lettered in, in the page's pixels, or null over the land. */
  nameBox(
    px: number,
    py: number,
  ): readonly [number, number, number, number] | null;
  /** Projects a world spot onto the page, in its pixels. */
  page(x: number, z: number): { readonly px: number; readonly py: number };
}
const taps = new WeakMap<HTMLCanvasElement, MapTaps>();
/** The hit testing for a map canvas the journal drew, or null for any other element. */
export const tapsOf = (canvas: HTMLElement | null): MapTaps | null =>
  canvas instanceof HTMLCanvasElement ? (taps.get(canvas) ?? null) : null;

interface MapView {
  readonly x: number;
  readonly z: number;
  readonly zoom: number;
}

interface LabelPlacement {
  readonly ctx: CanvasRenderingContext2D;
  readonly paper: Paper;
  readonly places: WorldPlaces;
  readonly view: MapView;
  readonly sx: (x: number) => number;
  readonly sy: (z: number) => number;
  readonly mine: (path: string) => boolean;
  readonly canPlace: (box: Box) => boolean;
  readonly ownAt: (path: string, x: number, y: number) => boolean;
  readonly taken: Box[];
  readonly named: { readonly box: Box; readonly path: string }[];
  readonly depth: number;
}

function chooseMapView(
  places: WorldPlaces,
  area: string,
  w: number,
  h: number,
  whole: number,
): MapView {
  if (area === "") return { x: 0, z: 0, zoom: whole * 1.02 };
  if (places.patches.some((p) => p.path === area)) {
    return folderView(places, (k) => k.file === area, w, h, FILE_CLOSEST);
  }
  return folderView(
    places,
    (k) => k.area === area || k.area.startsWith(`${area}/`),
    w,
    h,
    FOLDER_CLOSEST,
  );
}

function drawPatchOutlines(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  paper: Paper,
  view: MapView,
  close: number,
): void {
  if (close <= 0) return;
  ctx.save();
  ctx.translate(w / 2 - view.x * view.zoom, h / 2 - view.z * view.zoom);
  ctx.scale(view.zoom, view.zoom);
  ctx.lineWidth = 1 / view.zoom;
  ctx.setLineDash([2.2 / view.zoom, 3.2 / view.zoom]);
  ctx.strokeStyle = `rgba(74,60,44,${(0.42 * close).toFixed(3)})`;
  for (const p of paper.patches) ctx.stroke(p.path);
  ctx.restore();
}

function searchLabelSpot(
  p: LabelPlacement,
  areaPath: string,
  cx: number,
  cy: number,
  half: number,
  size: number,
  own: boolean,
): { x: number; y: number; size: number; box: Box } | null {
  for (let r = 0; r < 300; r += 4) {
    const around = Math.max(1, Math.round(r / 3));
    for (let k = 0; k < around; k++) {
      const x = cx + Math.cos((k / around) * Math.PI * 2) * r;
      const y = cy + Math.sin((k / around) * Math.PI * 2) * r;
      const box: Box = [x - half, y - size * 0.7, x + half, y + size * 0.7];
      if (p.canPlace(box) && (!own || p.ownAt(areaPath, x, y))) {
        return { x, y, size, box };
      }
    }
  }
  return null;
}

function findFolderSpot(
  p: LabelPlacement,
  areaName: string,
  areaPath: string,
  cx: number,
  cy: number,
): { x: number; y: number; size: number; box: Box } | null {
  for (const [size, own] of [
    [NAME.large, true],
    [NAME.small, true],
    [NAME.small, false],
  ] as const) {
    p.ctx.font = nameFont(size);
    p.ctx.letterSpacing = `${nameSpacing(size)}px`;
    const half = p.ctx.measureText(areaName.toUpperCase()).width / 2 + 6;
    p.ctx.letterSpacing = "0px";
    const spot = searchLabelSpot(p, areaPath, cx, cy, half, size, own);
    if (spot !== null) return spot;
  }
  return null;
}

function drawChildFolders(p: LabelPlacement): void {
  // Letters each child folder large, as near the center of its land as fits with the whole name on its land. A folder
  // with too little land gets a small name, and one with too little for that gets a small name beside its land.
  const children = p.places.areas.filter(
    (item) => item.depth === p.depth + 1 && p.mine(item.path),
  );
  for (const a of children) {
    const cells = p.places.cells.filter(
      (k) => k.area === a.path || k.area.startsWith(`${a.path}/`),
    );
    if (cells.length === 0) continue;
    const cx = p.sx(cells.reduce((n, k) => n + k.x, 0) / cells.length);
    const cy = p.sy(cells.reduce((n, k) => n + k.z, 0) / cells.length);
    const spot = findFolderSpot(p, a.name, a.path, cx, cy);
    if (spot === null) continue;
    p.taken.push(spot.box);
    p.named.push({ box: spot.box, path: a.path });
    letterName(
      p.ctx,
      { area: { name: a.name }, angle: 0, above: "" } as never,
      spot.x,
      spot.y,
      spot.size,
      p.paper.style,
    );
  }
}

function drawGrandchildFolders(p: LabelPlacement): void {
  // Grandchild folders, where `placeNames` puts them, wherever they fit on the page.
  const steps = placeNames(
    p.paper.names,
    Math.min(p.view.zoom * p.paper.reach * 2, 4096),
    canvasMeasure(p.ctx),
  );
  let step = steps.next();
  while (step.done !== true) step = steps.next();
  for (const place of step.value.places) {
    if (
      place.label.area.depth !== p.depth + 2 ||
      !p.mine(place.label.area.path)
    ) {
      continue;
    }
    const x = p.sx(place.x);
    const y = p.sy(place.z);
    const box: Box = [
      x + place.box[0],
      y + place.box[1],
      x + place.box[2],
      y + place.box[3],
    ];
    if (!p.canPlace(box)) continue;
    p.taken.push(box);
    p.named.push({ box, path: place.label.area.path });
    letterName(p.ctx, place.label, x, y, place.size, p.paper.style);
  }
}

function drawPatchNames(p: LabelPlacement, close: number): void {
  // Zoomed in close, each file's name small on its patch, largest patches first, as on the field map.
  if (close <= 0) return;
  p.ctx.font = `italic 12px ${SERIF}`;
  p.ctx.globalAlpha = close;
  for (const patch of p.paper.patches.toSorted((a, b) => b.radius - a.radius)) {
    if (patch.radius * p.view.zoom < 15) continue;
    const [x, y] = [p.sx(patch.x), p.sy(patch.z)];
    const half = p.ctx.measureText(patch.name).width / 2 + 2;
    const box: Box = [x - half, y - 7, x + half, y + 7];
    if (!p.canPlace(box)) continue;
    p.taken.push(box);
    p.named.push({
      box,
      path: patch.area === "" ? patch.name : `${patch.area}/${patch.name}`,
    });
    letter(
      p.ctx,
      patch.name,
      x,
      y,
      "rgba(58,47,34,0.92)",
      haloOf(p.paper.style),
      2.5,
    );
  }
  p.ctx.globalAlpha = 1;
}

/**
 * Draws a `w` by `h` px map of the folder or file at `area`, or of the whole
 * land for "". The whole land covers the page. A folder's land or a file's
 * patch is framed whole, with the land around it running to the edges.
 * `fold` keeps names off a spread's center. Returns null before the field
 * map's paper is painted.
 */
export function drawMapPage(
  src: MapSource,
  area: string,
  w: number,
  h: number,
  fold: boolean,
): HTMLCanvasElement | null {
  const paper = src.paper();
  if (paper === null) return null;
  const places = src.places();
  const canvas = document.createElement("canvas");
  canvas.width = w * DPR;
  canvas.height = h * DPR;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.scale(DPR, DPR);
  const mine = (path: string): boolean =>
    area === "" || path === area || path.startsWith(`${area}/`);
  const reach = landReach(places);
  /** The zoom at which the land just covers the page, the base for `CLOSE` as on the field map. */
  const whole = Math.max(w / (reach.x * 2), h / (reach.z * 2));
  const view = chooseMapView(places, area, w, h, whole);
  drawLand(ctx, w, h, paper, src.baked(), view, 1.35, true);
  const sx = (x: number): number => (x - view.x) * view.zoom + w / 2;
  const sy = (z: number): number => (z - view.z) * view.zoom + h / 2;
  const close = Math.max(0, Math.min(1, (view.zoom / whole - CLOSE) / 0.8));
  drawPatchOutlines(ctx, w, h, paper, view, close);
  const mx = (px: number): number => (px - w / 2) / view.zoom + view.x;
  const mz = (py: number): number => (py - h / 2) / view.zoom + view.z;
  const taken: Box[] = [];
  /** Each lettered name's box and path. */
  const named: { readonly box: Box; readonly path: string }[] = [];
  taps.set(canvas, {
    at: (px, py) => ({ x: mx(px), z: mz(py) }),
    page: (x, z) => ({ px: sx(x), py: sy(z) }),
    name: (px, py) =>
      named.find(
        ({ box: b }) => px >= b[0] && px <= b[2] && py >= b[1] && py <= b[3],
      )?.path ?? null,
    nameBox: (px, py) =>
      named.find(
        ({ box: b }) => px >= b[0] && px <= b[2] && py >= b[1] && py <= b[3],
      )?.box ?? null,
  });
  const canPlace = (b: Box): boolean =>
    b[0] > NAME.edge &&
    b[1] > NAME.edge &&
    b[2] < w - NAME.edge &&
    b[3] < h - NAME.edge &&
    (!fold || b[2] < w / 2 - NAME.fold || b[0] > w / 2 + NAME.fold) &&
    taken.every(
      (o) => b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3],
    );
  const ownAt = (path: string, x: number, y: number): boolean => {
    const at = src.placeAt(mx(x), mz(y)).area.path;
    return at === path || at.startsWith(`${path}/`);
  };
  const depth =
    area === "" ? 0 : (places.areas.find((a) => a.path === area)?.depth ?? 0);
  const placement: LabelPlacement = {
    ctx,
    paper,
    places,
    view,
    sx,
    sy,
    mine,
    canPlace,
    ownAt,
    taken,
    named,
    depth,
  };
  drawChildFolders(placement);
  drawGrandchildFolders(placement);
  drawPatchNames(placement, close);
  return canvas;
}

/** How far in meters inside the land's edge every corner of a folder's map stays, so the page is painted to its edges. */
const INSIDE = 6;
/**
 * The most a folder's map and a file's map zoom in, as multiples of the whole sheet's zoom. A folder's map keeps some
 * surrounding land at a scale where trees and trails still read, and a file's map zooms as close as the field map.
 */
const FOLDER_CLOSEST = 5;
const FILE_CLOSEST = 7;

function buildSummedTables(
  places: WorldPlaces,
  owns: (cell: WorldPlaces["cells"][number]) => boolean,
  reach: { readonly x: number; readonly z: number },
  n: number,
): {
  readonly sums: readonly [Float64Array, Float64Array];
  readonly own: number;
  readonly mx: number;
  readonly mz: number;
  readonly bx: number;
  readonly bz: number;
} {
  const [bx, bz] = [(reach.x * 2) / n, (reach.z * 2) / n];
  const sums = [
    new Float64Array((n + 1) * (n + 1)),
    new Float64Array((n + 1) * (n + 1)),
  ] as const;
  let own = 0;
  let [mx, mz] = [0, 0];
  for (const k of places.cells) {
    const i = Math.max(0, Math.min(n - 1, Math.floor((k.x + reach.x) / bx)));
    const j = Math.max(0, Math.min(n - 1, Math.floor((k.z + reach.z) / bz)));
    const at = (j + 1) * (n + 1) + i + 1;
    sums[0][at] = (sums[0][at] as number) + 1;
    if (owns(k)) {
      sums[1][at] = (sums[1][at] as number) + 1;
      own++;
      mx += k.x;
      mz += k.z;
    }
  }
  const v = (t: Float64Array, i: number, j: number): number =>
    t[j * (n + 1) + i] as number;
  for (const t of sums) {
    for (let j = 1; j <= n; j++) {
      for (let i = 1; i <= n; i++) {
        t[j * (n + 1) + i] =
          v(t, i, j) + v(t, i, j - 1) + v(t, i - 1, j) - v(t, i - 1, j - 1);
      }
    }
  }
  return {
    sums,
    own,
    mx: mx / Math.max(1, own),
    mz: mz / Math.max(1, own),
    bx,
    bz,
  };
}

/**
 * Chooses the view of a folder's or file's map: of the page-shaped windows
 * that fit inside the land, the one that best matches the cells it `owns`,
 * covering most of them with the least surrounding land. The page is painted
 * to its edges, and land outside the window runs off them.
 */
function folderView(
  places: WorldPlaces,
  owns: (cell: WorldPlaces["cells"][number]) => boolean,
  w: number,
  h: number,
  closestBy: number,
): { x: number; z: number; zoom: number } {
  const reach = landReach(places);
  // Counts all cells and the owned cells on a grid as summed-area tables, so any window's count takes four lookups.
  const n = 96;
  const { sums, own, mx, mz, bx, bz } = buildSummedTables(
    places,
    owns,
    reach,
    n,
  );
  const v = (t: Float64Array, i: number, j: number): number =>
    t[j * (n + 1) + i] as number;
  const count = (
    t: Float64Array,
    x: number,
    z: number,
    hw: number,
    hh: number,
  ): number => {
    const i0 = Math.max(0, Math.min(n, Math.round((x - hw + reach.x) / bx)));
    const i1 = Math.max(0, Math.min(n, Math.round((x + hw + reach.x) / bx)));
    const j0 = Math.max(0, Math.min(n, Math.round((z - hh + reach.z) / bz)));
    const j1 = Math.max(0, Math.min(n, Math.round((z + hh + reach.z) / bz)));
    return v(t, i1, j1) - v(t, i1, j0) - v(t, i0, j1) + v(t, i0, j0);
  };
  // The land is convex, so a window is inside it when its corners are.
  const fits = (x: number, z: number, hw: number, hh: number): boolean =>
    [-1, 1].every((sx) =>
      [-1, 1].every(
        (sz) => pastTheEdge(places, x + sx * hw, z + sz * hh) <= -INSIDE,
      ),
    );
  /**
   * How well a window matches the folder: owned cells inside it over the union of the window's cells and the
   * folder's, reduced by up to a quarter the farther it sits from the folder's center, so a small folder's map
   * centers on it.
   */
  const share = (x: number, z: number, hw: number, hh: number): number => {
    const mine = count(sums[1], x, z, hw, hh);
    return (
      (mine / (own + count(sums[0], x, z, hw, hh) - mine)) *
      (1 - 0.25 * Math.min(1, Math.hypot(x - mx, z - mz) / Math.hypot(hw, hh)))
    );
  };
  let best = {
    x: 0,
    z: 0,
    zoom: Math.max(w / (reach.x * 2), h / (reach.z * 2)),
    share: -1,
  };
  const consider = (x: number, z: number, zoom: number): void => {
    const [hw, hh] = [w / 2 / zoom, h / 2 / zoom];
    if (zoom > closest || !fits(x, z, hw, hh)) return;
    const s = share(x, z, hw, hh);
    if (s > best.share) best = { x, z, zoom, share: s };
  };
  // Searches zooms from the widest, where the land just covers the page, to `closestBy` times closer.
  const widest = Math.max(w / (reach.x * 2), h / (reach.z * 2));
  const closest = widest * closestBy;
  for (let zoom = widest; zoom <= closest; zoom *= 1.08) {
    for (let j = 0; j <= 24; j++) {
      for (let i = 0; i <= 24; i++) {
        consider(
          -reach.x + (reach.x * 2 * i) / 24,
          -reach.z + (reach.z * 2 * j) / 24,
          zoom,
        );
      }
    }
  }
  // Then refines around the best window.
  for (let step = (reach.x * 2) / 48; step > 1; step /= 2) {
    const { x, z, zoom } = best;
    for (const [dx, dz, dzoom] of [
      [step, 0, 1],
      [-step, 0, 1],
      [0, step, 1],
      [0, -step, 1],
      [0, 0, 1.03],
      [0, 0, 1 / 1.03],
    ] as const) {
      consider(x + dx, z + dz, zoom * dzoom);
    }
  }
  return { x: best.x, z: best.z, zoom: best.zoom };
}

/** A page-sized half of a spread's map, as a canvas of its own. */
export function halfOf(
  spread: HTMLCanvasElement,
  side: "left" | "right",
): HTMLCanvasElement {
  const half = document.createElement("canvas");
  half.width = spread.width / 2;
  half.height = spread.height;
  (half.getContext("2d") as CanvasRenderingContext2D).drawImage(
    spread,
    side === "left" ? 0 : -spread.width / 2,
    0,
  );
  const whole = taps.get(spread);
  const shift = side === "left" ? 0 : spread.width / 2 / DPR;
  if (whole !== undefined) {
    taps.set(half, {
      at: (px, py) => whole.at(px + shift, py),
      name: (px, py) => whole.name(px + shift, py),
      nameBox: (px, py) => {
        const b = whole.nameBox(px + shift, py);
        return b === null ? null : [b[0] - shift, b[1], b[2] - shift, b[3]];
      },
      page: (x, z) => {
        const at = whole.page(x, z);
        return { px: at.px - shift, py: at.py };
      },
    });
  }
  return half;
}
