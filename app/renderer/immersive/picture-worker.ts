// The picture's own thread. It lays each tile the page drew onto the picture
// and waits for the GPU to finish drawing it before asking for the next, so
// the GPU's work is spread over many frames, and then encodes the picture as
// WebP. Reading pixels back on the page's thread would wait on the GPU long
// enough to drop frames.

/** What the page sends: a tile to lay at (x, y), or the word to encode the picture. */
export type PictureJob = { readonly tile: ImageBitmap; readonly x: number; readonly y: number } | { readonly encode: number };
/** What the picture's thread answers: a tile laid, the picture, or why it failed. */
export type PictureReply = { readonly laid: true } | { readonly picture: string } | { readonly failed: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<PictureJob & { readonly side: number }>) => void) | null;
  postMessage(message: PictureReply): void;
}

const scope = globalThis as unknown as WorkerScope;
let canvas: OffscreenCanvas | null = null;

scope.onmessage = (e) => {
  const job = e.data;
  canvas ??= new OffscreenCanvas(job.side, job.side);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  if ("tile" in job) {
    ctx.drawImage(job.tile, job.x, job.y);
    job.tile.close();
    // Reading one pixel back waits here, off the page's thread, until the GPU has drawn the tile.
    ctx.getImageData(job.x, job.y, 1, 1);
    scope.postMessage({ laid: true });
    return;
  }
  canvas
    .convertToBlob({ type: "image/webp", quality: job.encode })
    .then((blob) => blob.arrayBuffer())
    .then((bytes) => {
      let binary = "";
      const view = new Uint8Array(bytes);
      for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
      scope.postMessage({ picture: `data:image/webp;base64,${btoa(binary)}` });
    })
    .catch((error: unknown) => scope.postMessage({ failed: (error as Error).message }));
};
