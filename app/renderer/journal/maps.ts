// The journal's maps, drawn by the field map's own hand (`drawLand`) in the
// page's own shape: the whole land across the endpapers, a folder's land on
// its chapter's left-hand page, and a file's patch on the left-hand page of a
// file with definitions. Every map runs off the page's edges. It names the
// folders it opens onto, large, at the middle of their land, and the next
// level down smaller wherever the map's own lettering finds room on its land;
// every name keeps clear of the page's edge and of the fold. Close in, as on
// the field map, each file's patch shows its bounds in fine dotted ink and
// its name small upon it, and a tap on the name turns to its page.

import type { Place, WorldPlaces } from "@gaia/terrain";
import { landReach, pastTheEdge } from "@gaia/terrain";
import { CLOSE, type Paper, drawLand, haloOf, letter, letterName } from "../immersive/field-map.ts";
import { SERIF, canvasMeasure, nameFont, nameSpacing, placeNames } from "../immersive/map-names.ts";
import type { StoodWorld } from "../terrain/lab.ts";

export interface MapSource {
  paper(): Paper | null;
  stood(): StoodWorld;
  places(): WorldPlaces;
  placeAt(x: number, z: number): Place;
}

/** The size of a large name and the least clearance names keep from the page's edge and the fold, px. */
const NAME = { large: 22, small: 14, edge: 14, fold: 10 } as const;
/** Device pixels a page's pixel takes, so a map stays sharp on a dense screen. */
const DPR = 2;

type Box = [number, number, number, number];

/** What a tap on a map finds: the spot in the world under it, or the folder whose name it falls on. */
export interface MapTaps {
  at(px: number, py: number): { readonly x: number; readonly z: number };
  name(px: number, py: number): string | null;
  /** The box a name under (px, py) is lettered in, in the page's pixels, or null over the land. */
  nameBox(px: number, py: number): readonly [number, number, number, number] | null;
  /** Where a spot in the world lies on the page, in its pixels. */
  page(x: number, z: number): { readonly px: number; readonly py: number };
}
const taps = new WeakMap<HTMLCanvasElement, MapTaps>();
/** How to read a tap on a map the journal drew, in its page's pixels; null for anything else. */
export const tapsOf = (canvas: HTMLElement | null): MapTaps | null => (canvas instanceof HTMLCanvasElement ? (taps.get(canvas) ?? null) : null);

/**
 * A map `w` by `h` pixels of the land of the folder or the file at `area`
 * ("" for the whole land): the whole land covers the page, so a land in the
 * page's shape fills it; a folder's land or a file's patch is framed whole,
 * the land around it running on to the edges. `fold` keeps names off a
 * spread's middle.
 */
export function drawMapPage(src: MapSource, area: string, w: number, h: number, fold: boolean): HTMLCanvasElement | null {
  const paper = src.paper();
  if (paper === null) return null;
  const places = src.places();
  const canvas = document.createElement("canvas");
  canvas.width = w * DPR;
  canvas.height = h * DPR;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.scale(DPR, DPR);
  const mine = (path: string): boolean => area === "" || path === area || path.startsWith(`${area}/`);
  const reach = landReach(places);
  /** The zoom at which the land is as tall or as wide as the page: the whole sheet's, as the field map counts closeness. */
  const whole = Math.max(w / (reach.x * 2), h / (reach.z * 2));
  let view: { x: number; z: number; zoom: number };
  if (area === "") view = { x: 0, z: 0, zoom: whole * 1.02 };
  else if (places.patches.some((p) => p.path === area)) view = folderView(places, (k) => k.file === area, w, h, FILE_CLOSEST);
  else view = folderView(places, (k) => k.area === area || k.area.startsWith(`${area}/`), w, h, FOLDER_CLOSEST);
  drawLand(ctx, w, h, paper, src.stood(), view, 1.35, true);
  const sx = (x: number): number => (x - view.x) * view.zoom + w / 2;
  const sy = (z: number): number => (z - view.z) * view.zoom + h / 2;
  const close = Math.max(0, Math.min(1, (view.zoom / whole - CLOSE) / 0.8));
  if (close > 0) {
    ctx.save();
    ctx.translate(w / 2 - view.x * view.zoom, h / 2 - view.z * view.zoom);
    ctx.scale(view.zoom, view.zoom);
    ctx.lineWidth = 1 / view.zoom;
    ctx.setLineDash([2.2 / view.zoom, 3.2 / view.zoom]);
    ctx.strokeStyle = `rgba(74,60,44,${(0.42 * close).toFixed(3)})`;
    for (const p of paper.patches) ctx.stroke(p.path);
    ctx.restore();
  }
  const mx = (px: number): number => (px - w / 2) / view.zoom + view.x;
  const mz = (py: number): number => (py - h / 2) / view.zoom + view.z;
  const taken: Box[] = [];
  /** Each name lettered, and the folder it names. */
  const named: { readonly box: Box; readonly path: string }[] = [];
  taps.set(canvas, {
    at: (px, py) => ({ x: mx(px), z: mz(py) }),
    page: (x, z) => ({ px: sx(x), py: sy(z) }),
    name: (px, py) => named.find(({ box: b }) => px >= b[0] && px <= b[2] && py >= b[1] && py <= b[3])?.path ?? null,
    nameBox: (px, py) => named.find(({ box: b }) => px >= b[0] && px <= b[2] && py >= b[1] && py <= b[3])?.box ?? null,
  });
  const clear = (b: Box): boolean => taken.every((o) => b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]);
  const onPage = (b: Box): boolean => b[0] > NAME.edge && b[1] > NAME.edge && b[2] < w - NAME.edge && b[3] < h - NAME.edge;
  const offFold = (b: Box): boolean => !fold || b[2] < w / 2 - NAME.fold || b[0] > w / 2 + NAME.fold;
  const ownAt = (path: string, x: number, y: number): boolean => {
    const at = src.placeAt(mx(x), mz(y)).area.path;
    return at === path || at.startsWith(`${path}/`);
  };
  const depth = area === "" ? 0 : (places.areas.find((a) => a.path === area)?.depth ?? 0);

  // The folders the map opens onto, large, nearest the middle of their land where the whole name sits on it; a
  // folder with too little land for a large name gets a small one, and one with too little for that, a small one
  // lettered beside its land.
  for (const a of places.areas.filter((a) => a.depth === depth + 1 && mine(a.path))) {
    const cells = places.cells.filter((k) => k.area === a.path || k.area.startsWith(`${a.path}/`));
    if (cells.length === 0) continue;
    const cx = sx(cells.reduce((n, k) => n + k.x, 0) / cells.length);
    const cy = sy(cells.reduce((n, k) => n + k.z, 0) / cells.length);
    let spot: { x: number; y: number; size: number; box: Box } | null = null;
    for (const [size, own] of [[NAME.large, true], [NAME.small, true], [NAME.small, false]] as const) {
      ctx.font = nameFont(size);
      ctx.letterSpacing = `${nameSpacing(size)}px`;
      const half = ctx.measureText(a.name.toUpperCase()).width / 2 + 6;
      ctx.letterSpacing = "0px";
      for (let r = 0; r < 300 && spot === null; r += 4) {
        const around = Math.max(1, Math.round(r / 3));
        for (let k = 0; k < around && spot === null; k++) {
          const x = cx + Math.cos((k / around) * Math.PI * 2) * r;
          const y = cy + Math.sin((k / around) * Math.PI * 2) * r;
          const box: Box = [x - half, y - size * 0.7, x + half, y + size * 0.7];
          if (onPage(box) && offFold(box) && clear(box) && (!own || ownAt(a.path, x, y))) spot = { x, y, size, box };
        }
      }
      if (spot !== null) break;
    }
    if (spot === null) continue;
    taken.push(spot.box);
    named.push({ box: spot.box, path: a.path });
    letterName(ctx, { area: { name: a.name }, angle: 0, above: "" } as never, spot.x, spot.y, spot.size, paper.style);
  }

  // The next level down, where the map's own lettering puts it, wherever it has room on the page.
  const steps = placeNames(paper.names, Math.min(view.zoom * paper.reach * 2, 4096), canvasMeasure(ctx));
  let step = steps.next();
  while (step.done !== true) step = steps.next();
  for (const p of step.value.places) {
    if (p.label.area.depth !== depth + 2 || !mine(p.label.area.path)) continue;
    const x = sx(p.x);
    const y = sy(p.z);
    const box: Box = [x + p.box[0], y + p.box[1], x + p.box[2], y + p.box[3]];
    if (!onPage(box) || !offFold(box) || !clear(box)) continue;
    taken.push(box);
    named.push({ box, path: p.label.area.path });
    letterName(ctx, p.label, x, y, p.size, paper.style);
  }

  // Close in, each file's name small on its patch, the largest first, as the field map letters them.
  if (close > 0) {
    ctx.font = `italic 12px ${SERIF}`;
    ctx.globalAlpha = close;
    for (const p of [...paper.patches].sort((a, b) => b.radius - a.radius)) {
      if (p.radius * view.zoom < 15) continue;
      const [x, y] = [sx(p.x), sy(p.z)];
      const half = ctx.measureText(p.name).width / 2 + 2;
      const box: Box = [x - half, y - 7, x + half, y + 7];
      if (!onPage(box) || !offFold(box) || !clear(box)) continue;
      taken.push(box);
      named.push({ box, path: p.area === "" ? p.name : `${p.area}/${p.name}` });
      letter(ctx, p.name, x, y, "rgba(58,47,34,0.92)", haloOf(paper.style), 2.5);
    }
    ctx.globalAlpha = 1;
  }
  return canvas;
}

/** How far inside the land's rim every corner of a folder's map keeps, meters, so the page is painted to its edges. */
const INSIDE = 6;
/**
 * How close a folder's map and a file's come, as a multiple of the whole sheet's zoom: a folder's holds some of
 * the land around it at a scale its trees and ways still read at, and a file's comes as close as the field map.
 */
const FOLDER_CLOSEST = 5;
const FILE_CLOSEST = 7;

/**
 * The view of a folder's map, or a file's: of every page-shaped window that
 * fits wholly inside the land, the one most nearly the cells it `owns`, the
 * most of them and the least of the land around them. The page is painted
 * to its edges, and land that is not the page's shape runs off them.
 */
function folderView(places: WorldPlaces, owns: (cell: WorldPlaces["cells"][number]) => boolean, w: number, h: number, closestBy: number): { x: number; z: number; zoom: number } {
  const reach = landReach(places);
  // The land's cells counted on a grid, the folder's and all, summed so any window's count is four lookups.
  const n = 96;
  const [bx, bz] = [(reach.x * 2) / n, (reach.z * 2) / n];
  const sums = [new Float64Array((n + 1) * (n + 1)), new Float64Array((n + 1) * (n + 1))] as const;
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
  [mx, mz] = [mx / Math.max(1, own), mz / Math.max(1, own)];
  const v = (t: Float64Array, i: number, j: number): number => t[j * (n + 1) + i] as number;
  for (const t of sums) for (let j = 1; j <= n; j++) for (let i = 1; i <= n; i++) t[j * (n + 1) + i] = v(t, i, j) + v(t, i, j - 1) + v(t, i - 1, j) - v(t, i - 1, j - 1);
  const count = (t: Float64Array, x: number, z: number, hw: number, hh: number): number => {
    const i0 = Math.max(0, Math.min(n, Math.round((x - hw + reach.x) / bx)));
    const i1 = Math.max(0, Math.min(n, Math.round((x + hw + reach.x) / bx)));
    const j0 = Math.max(0, Math.min(n, Math.round((z - hh + reach.z) / bz)));
    const j1 = Math.max(0, Math.min(n, Math.round((z + hh + reach.z) / bz)));
    return v(t, i1, j1) - v(t, i1, j0) - v(t, i0, j1) + v(t, i0, j0);
  };
  // The land is convex, so a window is inside it when its corners are.
  const fits = (x: number, z: number, hw: number, hh: number): boolean => [-1, 1].every((sx) => [-1, 1].every((sz) => pastTheEdge(places, x + sx * hw, z + sz * hh) <= -INSIDE));
  /**
   * How nearly a window is the folder's land: what it holds of the folder over all the land the two cover, a little
   * less the farther it sits from the folder's middle, so a small folder's map is centered on it.
   */
  const share = (x: number, z: number, hw: number, hh: number): number => {
    const mine = count(sums[1], x, z, hw, hh);
    return (mine / (own + count(sums[0], x, z, hw, hh) - mine)) * (1 - 0.25 * Math.min(1, Math.hypot(x - mx, z - mz) / Math.hypot(hw, hh)));
  };
  let best = { x: 0, z: 0, zoom: Math.max(w / (reach.x * 2), h / (reach.z * 2)), share: -1 };
  const consider = (x: number, z: number, zoom: number): void => {
    const [hw, hh] = [w / 2 / zoom, h / 2 / zoom];
    if (zoom > closest || !fits(x, z, hw, hh)) return;
    const s = share(x, z, hw, hh);
    if (s > best.share) best = { x, z, zoom, share: s };
  };
  // The widest window that fits is a page as tall as the land; the narrowest, `closestBy` times closer.
  const widest = Math.max(w / (reach.x * 2), h / (reach.z * 2));
  const closest = widest * closestBy;
  for (let zoom = widest; zoom <= closest; zoom *= 1.08) {
    for (let j = 0; j <= 24; j++) for (let i = 0; i <= 24; i++) consider(-reach.x + (reach.x * 2 * i) / 24, -reach.z + (reach.z * 2 * j) / 24, zoom);
  }
  // Then finer, around the best.
  for (let step = (reach.x * 2) / 48; step > 1; step /= 2) {
    const { x, z, zoom } = best;
    for (const [dx, dz, dzoom] of [[step, 0, 1], [-step, 0, 1], [0, step, 1], [0, -step, 1], [0, 0, 1.03], [0, 0, 1 / 1.03]] as const) consider(x + dx, z + dz, zoom * dzoom);
  }
  return { x: best.x, z: best.z, zoom: best.zoom };
}

/** A page-sized half of a spread's map, as a canvas of its own. */
export function halfOf(spread: HTMLCanvasElement, side: "left" | "right"): HTMLCanvasElement {
  const half = document.createElement("canvas");
  half.width = spread.width / 2;
  half.height = spread.height;
  (half.getContext("2d") as CanvasRenderingContext2D).drawImage(spread, side === "left" ? 0 : -spread.width / 2, 0);
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
