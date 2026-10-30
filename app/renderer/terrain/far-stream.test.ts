import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { Realized } from "@gaia/realize";
import { DROOP_CELLS, FAR_BAKE_VERSION, FAR_VIEWS, type FarFormData, createSceneLight } from "@gaia/render";
import type { FarStore } from "./far-store.ts";
import { FAR_TURN, createFarStream } from "./far-stream.ts";
import { FAR, createFarForms } from "./woods.ts";

// Runs animation frames on timers, since a stored form read after the world opens uploads one atlas layer a frame.
vi.stubGlobal("requestAnimationFrame", (step: FrameRequestCallback) => setTimeout(() => step(performance.now()), 0));

/** A stored far form with one texel per view, which the stream reads instead of baking. */
const stored: FarFormData = {
  version: FAR_BAKE_VERSION,
  bounds: { center: [0, 3, 0], radius: 4, height: 8 },
  frame: 1,
  sway: 0.2,
  frequency: 1,
  droop: { cells: new Uint8Array(DROOP_CELLS ** 3 * 4).fill(128), scale: 0, reach: 0 },
  width: FAR_VIEWS.azimuths,
  height: FAR_VIEWS.elevations.length,
  layers: [0, 1, 2, 3].map(() => new Uint8Array(FAR_VIEWS.azimuths * FAR_VIEWS.elevations.length * 4)),
};
const store: FarStore = { get: () => Promise.resolve(stored), put: () => Promise.resolve() };
/** Stubs the renderer calls that loading a form makes. Only a GPU would see their effect. */
const renderer = { initTexture: () => undefined, initRenderTarget: () => undefined, copyTextureToTexture: () => undefined } as unknown as THREE.WebGLRenderer;
const plant = { parts: [], motion: { sway: 0.2, frequency: 1 }, palette: { swatches: {} } } as unknown as Realized;
const PACE = { opening: { views: 24, ms: 6 }, walking: { views: 24, ms: 2 } } as const;
const eye = new THREE.Vector3();

/** Four forms sharing two slots, weighted by `weights`, and a stream over them. */
function streamOf(weights: number[]) {
  const forms = createFarForms(createSceneLight(), 2);
  for (const k of weights.keys()) {
    const { form } = forms.add(plant, () => Promise.resolve(plant));
    forms.join(form, new THREE.Group(), () => weights[k] ?? 0);
  }
  return { forms, stream: createFarStream(renderer, forms, Promise.resolve(store), PACE) };
}
/** Runs `seconds` of frames at 20 frames a second, letting loads finish between them. */
async function frames(stream: ReturnType<typeof streamOf>["stream"], seconds: number): Promise<void> {
  for (let t = 0; t < seconds; t += 0.05) {
    stream.follow(eye, 1000, 0.05);
    await Promise.resolve();
  }
}

describe("the far forms the slots hold", () => {
  it("trade a slot only for a form many times heavier, which turns in once the lighter has turned out", async () => {
    const weights = [5, 3, 1, 0];
    const { forms, stream } = streamOf(weights);
    await stream.open(eye, 1000);
    // A form slightly heavier than one with a slot doesn't take the slot.
    weights[2] = 6;
    await frames(stream, 1);
    expect(forms.swapPx(1)).toBe(FAR.swapPx);
    expect(forms.slotOf(2)).toBe(-1);
    // A form many times heavier takes the lighter form's slot, which fades out over many frames.
    weights[2] = 30;
    await frames(stream, FAR_TURN.seconds / 2);
    expect(forms.swapPx(1)).toBeGreaterThan(0);
    expect(forms.swapPx(1)).toBeLessThan(FAR.swapPx);
    expect(forms.slotOf(2)).toBe(-1);
    await frames(stream, FAR_TURN.seconds / 2 + 1);
    expect(forms.slotOf(1)).toBe(-1);
    await vi.waitFor(() => expect(forms.slotOf(2)).toBeGreaterThanOrEqual(0));
    // Then the heavier form fades in, its `swapPx` growing to its own.
    await frames(stream, FAR_TURN.seconds / 2);
    expect(forms.swapPx(2)).toBeGreaterThan(0);
    expect(forms.swapPx(2)).toBeLessThan(FAR.swapPx);
    await frames(stream, FAR_TURN.seconds / 2 + 1);
    expect(forms.swapPx(2)).toBe(FAR.swapPx);
    await expect(Promise.race([stream.settled(), frames(stream, 1).then(() => "busy")])).resolves.toBeUndefined();
  });
});
