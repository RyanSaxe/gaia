// The painter's own thread: it paints each view it is sent (`painter.ts`)
// and sends the painting back, with a copy encoded for keeping, so painting
// never takes the page's time.

import { type PaintJob, paint } from "./painter.ts";

/** What the page sends: a view to paint, named so its painting can be told apart. */
export interface PainterJob extends PaintJob {
  readonly id: number;
}
/** What the painter's thread answers: the painting with its copy for keeping, or why it failed. */
export type PainterReply =
  | { readonly id: number; readonly painting: ImageBitmap; readonly kept: Blob | null }
  | { readonly id: number; readonly failed: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<PainterJob>) => void) | null;
  postMessage(message: PainterReply, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

/** WebP's quality for a kept painting: about 150 KB a page. */
const KEPT = 0.82;

scope.onmessage = async (e) => {
  const { id } = e.data;
  try {
    const canvas = paint(e.data);
    const kept = await canvas.convertToBlob({ type: "image/webp", quality: KEPT }).catch(() => null);
    const painting = canvas.transferToImageBitmap();
    scope.postMessage({ id, painting, kept }, [painting]);
  } catch (error) {
    scope.postMessage({ id, failed: (error as Error).message });
  }
};
