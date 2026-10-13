// A picture of the whole field map, kept with the world so the start can lay
// it on its table (`RecentWorld.picture`). It is the map's own drawing
// (`drawLand`) of the whole land in health's colors, with its hills, water,
// trails, trees and marks and no names, painted once the field map's paper is,
// in the land's own shape: as wide as the sheet and as deep as the land and
// its margin, so the wait's sheet can take it as its own.
// The page draws it a tile at a time in its idle time; the picture's own
// thread (`picture-worker.ts`) lays each tile once the GPU has drawn it and
// encodes the whole as WebP, so walking never hitches.

import type { StoodWorld } from "../terrain/lab.ts";
import { type Paper, drawLand, landDepth, whenIdle } from "./field-map.ts";
import type { PictureJob, PictureReply } from "./picture-worker.ts";
import PictureWorker from "./picture-worker.ts?worker";

/** The picture's width, pixels: sharp on the start's table, and on its way up into the wait's sheet. */
export const PICTURE_PX = 800;
/** Tiles a side: each a few milliseconds of the page's and the GPU's time. */
const TILES = 4;
/** WebP's quality: about 80 to 110 KB for a world's map. */
const QUALITY = 0.8;

/** Paints the picture and resolves with it as a WebP data URL. */
export async function paintPicture(paper: Paper, stood: StoodWorld): Promise<string> {
  const worker = new PictureWorker();
  // The land's box on the square the map is drawn over: the whole width, and the land's depth with its margin.
  const height = Math.round((PICTURE_PX * landDepth(paper)) / paper.reach);
  const top = (PICTURE_PX - height) / 2;
  const ask = (job: PictureJob, transfer: Transferable[] = []): Promise<PictureReply> =>
    new Promise((resolve) => {
      worker.onmessage = (e: MessageEvent<PictureReply>) => resolve(e.data);
      worker.postMessage({ ...job, width: PICTURE_PX, height }, transfer);
    });
  try {
    const side = PICTURE_PX / TILES;
    const zoom = PICTURE_PX / (paper.reach * 2);
    // Each tile is the whole picture's drawing shifted by whole pixels, so no seam shows; only the tiles over the land's box are drawn.
    const at = (k: number): number => ((k + 0.5) * side - PICTURE_PX / 2) / zoom;
    for (let k = 0; k < TILES * TILES; k++) {
      const [i, j] = [k % TILES, Math.floor(k / TILES)];
      if ((j + 1) * side <= top || j * side >= top + height) continue;
      const tile = await new Promise<HTMLCanvasElement>((resolve) =>
        whenIdle(() => {
          const c = document.createElement("canvas");
          c.width = c.height = side;
          // Trees and ways at the size the field map draws them across a sheet about this size. Wild ink not yet
          // inked is left out: the land's paint covers the whole square.
          drawLand(c.getContext("2d") as CanvasRenderingContext2D, side, side, paper, stood, { x: at(i), z: at(j), zoom }, PICTURE_PX / 1200, false);
          resolve(c);
          return true;
        }),
      );
      const bitmap = await createImageBitmap(tile);
      await ask({ tile: bitmap, x: i * side, y: j * side - top }, [bitmap]);
    }
    const reply = await ask({ encode: QUALITY });
    if ("picture" in reply) return reply.picture;
    throw new Error("failed" in reply ? reply.failed : "The picture was not encoded.");
  } finally {
    worker.terminate();
  }
}
