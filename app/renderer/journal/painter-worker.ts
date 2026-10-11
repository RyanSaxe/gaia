// The painter's own thread: it paints each view it is sent (`painter.ts`)
// and sends the painting back, so painting never takes the page's time.

import { type PaintJob, paint } from "./painter.ts";

/** What the page sends: a view to paint, named so its painting can be told apart. */
export interface PainterJob extends PaintJob {
  readonly id: number;
}
/** What the painter's thread answers: the painting so far, the painting, or why it failed. */
export type PainterReply =
  | { readonly id: number; readonly partial: ImageBitmap }
  | { readonly id: number; readonly painting: ImageBitmap }
  | { readonly id: number; readonly failed: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<PainterJob>) => void) | null;
  postMessage(message: PainterReply, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id } = e.data;
  try {
    const painting = paint(e.data, (so) => {
      const partial = so.transferToImageBitmap();
      // Handing the strokes over clears the canvas, so they go straight back under the next ones.
      (so.getContext("2d") as OffscreenCanvasRenderingContext2D).drawImage(partial, 0, 0);
      scope.postMessage({ id, partial }, [partial]);
    }).transferToImageBitmap();
    scope.postMessage({ id, painting }, [painting]);
  } catch (error) {
    scope.postMessage({ id, failed: (error as Error).message });
  }
};
