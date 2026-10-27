import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { Realized } from "@gaia/realize";
import { FAR_BAKE_VERSION, FAR_VIEWS, type FarFormData, createSceneLight } from "@gaia/render";
import type { FarStore } from "./far-store.ts";
import { FAR_TURN, createFarStream } from "./far-stream.ts";
import { FAR, createFarForms } from "./woods.ts";

// A form read while the world shows uploads an atlas a frame.
vi.stubGlobal("requestAnimationFrame", (step: FrameRequestCallback) => setTimeout(() => step(performance.now()), 0));

/** A stored form one texel a view: what the stream reads instead of baking. */
const stored: FarFormData = {
  version: FAR_BAKE_VERSION,
  bounds: { center: [0, 3, 0], radius: 4, height: 8 },
  frame: 1,
  sway: 0.2,
  frequency: 1,
  width: FAR_VIEWS.azimuths,
  height: FAR_VIEWS.elevations.length,
  layers: [0, 1, 2, 3].map(() => new Uint8Array(FAR_VIEWS.azimuths * FAR_VIEWS.elevations.length * 4)),
};
const store: FarStore = { get: () => Promise.resolve(stored), put: () => Promise.resolve() };
/** The renderer's part in bringing a form: uploads and copies, which only a GPU sees. */
const renderer = { initTexture: () => undefined, initRenderTarget: () => undefined, copyTextureToTexture: () => undefined } as unknown as THREE.WebGLRenderer;
const plant = { parts: [], motion: { sway: 0.2, frequency: 1 }, palette: { swatches: {} } } as unknown as Realized;
const PACE = { opening: { views: 24, ms: 6 }, walking: { views: 24, ms: 2 } } as const;
const eye = new THREE.Vector3();

/** Four forms in two slots, each weighing what `weights` says, and a stream over them. */
function streamOf(weights: number[]) {
  const forms = createFarForms(createSceneLight(), 2);
  for (const k of weights.keys()) {
    const { form } = forms.add(plant, () => Promise.resolve(plant));
    forms.join(form, new THREE.Group(), () => weights[k] ?? 0);
  }
  return { forms, stream: createFarStream(renderer, forms, Promise.resolve(store), PACE) };
}
/** `seconds` of frames, a frame a twentieth of a second, letting what is being brought arrive between them. */
async function frames(stream: ReturnType<typeof streamOf>["stream"], seconds: number): Promise<void> {
  for (let t = 0; t < seconds; t += 0.05) {
    stream.follow(eye, 1000, 0.05);
    await Promise.resolve();
  }
}

describe("the far forms the slots hold", () => {
  it("are the heaviest, turned in at once before the world shows; every other keeps its full form", async () => {
    const { forms, stream } = streamOf([5, 3, 1, 0]);
    await stream.open(eye, 1000);
    expect([0, 1, 2, 3].map((k) => forms.slotOf(k) >= 0)).toEqual([true, true, false, false]);
    expect([0, 1, 2, 3].map((k) => forms.swapPx(k))).toEqual([FAR.swapPx, FAR.swapPx, 0, 0]);
    expect(stream.stats()).toMatchObject({ slots: 2, held: 2, turnedIn: 2, wanted: 3, farCopies: 9, carded: 8, read: 2, baked: 0 });
  });

  it("trade a slot only for a form many times heavier, which turns in once the lighter has turned out", async () => {
    const weights = [5, 3, 1, 0];
    const { forms, stream } = streamOf(weights);
    await stream.open(eye, 1000);
    // A little heavier than a form holding a slot is not enough.
    weights[2] = 6;
    await frames(stream, 1);
    expect(forms.swapPx(1)).toBe(FAR.swapPx);
    expect(forms.slotOf(2)).toBe(-1);
    // Many times heavier, it takes the lighter one's slot: that turns out over the frames, never at once.
    weights[2] = 30;
    await frames(stream, FAR_TURN.seconds / 2);
    expect(forms.swapPx(1)).toBeGreaterThan(0);
    expect(forms.swapPx(1)).toBeLessThan(FAR.swapPx);
    expect(forms.slotOf(2)).toBe(-1);
    await frames(stream, FAR_TURN.seconds / 2 + 1);
    expect(forms.slotOf(1)).toBe(-1);
    await vi.waitFor(() => expect(forms.slotOf(2)).toBeGreaterThanOrEqual(0));
    // Then it turns in, its copies turning far at a size growing to its own.
    await frames(stream, FAR_TURN.seconds / 2);
    expect(forms.swapPx(2)).toBeGreaterThan(0);
    expect(forms.swapPx(2)).toBeLessThan(FAR.swapPx);
    await frames(stream, FAR_TURN.seconds / 2 + 1);
    expect(forms.swapPx(2)).toBe(FAR.swapPx);
    await expect(Promise.race([stream.settled(), frames(stream, 1).then(() => "busy")])).resolves.toBeUndefined();
  });

  it("keep a form whose copies have all come near while no other waits for its slot", async () => {
    const weights = [5, 3, 0, 0];
    const { forms, stream } = streamOf(weights);
    await stream.open(eye, 1000);
    weights[1] = 0;
    await frames(stream, FAR_TURN.seconds + 1);
    expect(forms.swapPx(1)).toBe(FAR.swapPx);
    // One that does wait takes it, once it has turned out.
    weights[3] = 2;
    await frames(stream, FAR_TURN.seconds + 1);
    await vi.waitFor(() => expect(forms.slotOf(3)).toBeGreaterThanOrEqual(0));
    expect(forms.slotOf(1)).toBe(-1);
  });

  it("make room at once for the swap test's form, turned all the way in, and keep it while it is held", async () => {
    const { forms, stream } = streamOf([5, 3, 1, 0]);
    await stream.open(eye, 1000);
    const release = await stream.hold(3);
    expect(forms.swapPx(3)).toBe(FAR.swapPx);
    expect(forms.slotOf(1)).toBe(-1);
    await frames(stream, 1);
    expect(forms.swapPx(3)).toBe(FAR.swapPx);
    release();
  });
});
