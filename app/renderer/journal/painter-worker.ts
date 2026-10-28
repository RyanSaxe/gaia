// The painter's worker. It paints each view it receives (`painter.ts`) and
// posts back the painting with a WebP copy for storage, so painting stays off
// the main thread.

import { type PaintJob, paint } from "./painter.ts";

/** A job from the page: a view to paint, with an id that matches its reply. */
export interface PainterJob extends PaintJob {
  readonly id: number;
}
/** The worker's reply: the painting with its stored copy, or the failure message. */
export type PainterReply =
  | { readonly id: number; readonly painting: ImageBitmap; readonly kept: Blob | null }
  | { readonly id: number; readonly failed: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<PainterJob>) => void) | null;
  postMessage(message: PainterReply, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

/** WebP quality for a stored painting, about 150 KB per page. */
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
