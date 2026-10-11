// The journal's maps, drawn by the field map's own hand (`drawLand`) in the
// page's own shape: the whole land across the endpapers, and a folder's land
// on its chapter's left-hand page. Every map runs off the page's edges. It
// names the folders it opens onto, large, at the middle of their land, and
// the next level down smaller wherever the map's own lettering finds room
// on its land; every name keeps clear of the page's edge and of the fold.

import type { Place, WorldPlaces } from "@gaia/terrain";
import { landReach } from "@gaia/terrain";
import { type Paper, drawLand, letterName } from "../immersive/field-map.ts";
import { canvasMeasure, nameFont, nameSpacing, placeNames } from "../immersive/map-names.ts";
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

/**
 * A map `w` by `h` pixels of the land of the folder at `area` ("" for the
 * whole land): the whole land covers the page, so a land in the page's shape
 * fills it; a folder's land is framed whole, the land around it running on to
 * the edges. `fold` keeps names off a spread's middle.
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
  let view: { x: number; z: number; zoom: number };
  if (area === "") {
    const reach = landReach(places);
    view = { x: 0, z: 0, zoom: Math.max(w / (reach.x * 2), h / (reach.z * 2)) * 1.02 };
  } else {
    const own = places.cells.filter((k) => mine(k.area));
    const xs = own.map((k) => k.x);
    const zs = own.map((k) => k.z);
    const [x0, x1, z0, z1] = [Math.min(...xs) - 12, Math.max(...xs) + 12, Math.min(...zs) - 12, Math.max(...zs) + 12];
    view = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, zoom: Math.min(w / (x1 - x0), h / (z1 - z0)) };
  }
  drawLand(ctx, w, h, paper, src.stood(), view, 1.35, true);
  const sx = (x: number): number => (x - view.x) * view.zoom + w / 2;
  const sy = (z: number): number => (z - view.z) * view.zoom + h / 2;
  const mx = (px: number): number => (px - w / 2) / view.zoom + view.x;
  const mz = (py: number): number => (py - h / 2) / view.zoom + view.z;
  const taken: Box[] = [];
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
    letterName(ctx, p.label, x, y, p.size, paper.style);
  }
  return canvas;
}

/** A page-sized half of a spread's map, as a canvas of its own. */
export function halfOf(spread: HTMLCanvasElement, side: "left" | "right"): HTMLCanvasElement {
  const half = document.createElement("canvas");
  half.width = spread.width / 2;
  half.height = spread.height;
  (half.getContext("2d") as CanvasRenderingContext2D).drawImage(spread, side === "left" ? 0 : -spread.width / 2, 0);
  return half;
}
