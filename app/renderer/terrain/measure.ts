// Measuring a frame: what each kind of thing draws in each pass, and how much
// the picture changes between two frames. The lab's hooks use these to find
// where frame time goes and to prove that a change of detail goes unseen: a
// step of walking may change the picture by less than the wind already does.

import type * as THREE from "three";

/** The passes of one frame: the sun's shadow, the water's mirror and the view. */
export type Pass = "shadow" | "mirror" | "view";

export interface Drawn {
  calls: number;
  triangles: number;
}

/** Each kind's draw calls and triangles, per pass. */
export type Tally = Record<Pass, Record<string, Drawn>>;

/**
 * Draws one frame with `draw` while counting what each kind of object draws
 * in each pass. An object's kind is that of its nearest ancestor in `kinds`,
 * or "other". The pass is told by its camera: `view` draws the view, an
 * orthographic camera the sun's shadow, and any other camera the mirror.
 */
export function tallyFrame(renderer: THREE.WebGLRenderer, scene: THREE.Scene, view: THREE.Camera, kinds: ReadonlyMap<THREE.Object3D, string>, draw: () => void): Tally {
  const tally: Tally = { shadow: {}, mirror: {}, view: {} };
  const info = renderer.info.render;
  const restore: (() => void)[] = [];
  scene.traverse((o) => {
    const drawable = o as Partial<THREE.Mesh & THREE.Points & THREE.Line & THREE.Sprite>;
    if (drawable.isMesh !== true && drawable.isPoints !== true && drawable.isLine !== true && drawable.isSprite !== true) return;
    let kind = "other";
    for (let a: THREE.Object3D | null = o; a !== null; a = a.parent) {
      const k = kinds.get(a);
      if (k !== undefined) {
        kind = k;
        break;
      }
    }
    const before = o.onBeforeRender;
    const after = o.onAfterRender;
    let calls = 0;
    let triangles = 0;
    o.onBeforeRender = function (...args) {
      before.apply(this, args);
      calls = info.calls;
      triangles = info.triangles;
    };
    o.onAfterRender = function (...args) {
      after.apply(this, args);
      const camera = args[2] as THREE.Camera & { isOrthographicCamera?: boolean };
      const pass: Pass = camera === view ? "view" : camera.isOrthographicCamera === true ? "shadow" : "mirror";
      const sum = (tally[pass][kind] ??= { calls: 0, triangles: 0 });
      sum.calls += info.calls - calls;
      sum.triangles += info.triangles - triangles;
    };
    restore.push(() => {
      o.onBeforeRender = before;
      o.onAfterRender = after;
    });
  });
  try {
    draw();
  } finally {
    for (const r of restore) r();
  }
  return tally;
}

export interface Change {
  /** The mean change over the whole frame, in 8-bit levels averaged over red, green and blue. */
  readonly mean: number;
  /** The mean change in the frame's most-changed square block: where a pop would show. */
  readonly worst: number;
}

/** A part of a frame, in pixels: [x0, y0, x1, y1), rows counted as the frame stores them. */
export type PixelRect = readonly [number, number, number, number];

/**
 * How much the picture changed between two frames of `width` by `height`
 * RGBA pixels, over the whole frame or only within `rect`. A pop changes one
 * place a lot, so the most-changed block of `block` pixels square tells it
 * apart from change spread thin.
 */
export function pictureChange(a: Uint8Array, b: Uint8Array, width: number, height: number, block = 64, rect?: PixelRect): Change {
  if (a.length !== width * height * 4 || b.length !== a.length) throw new Error(`Frames must both hold ${width}x${height} RGBA pixels.`);
  const [x0, y0, x1, y1] = rect ?? [0, 0, width, height];
  const cols = Math.ceil(width / block);
  const sums = new Float64Array(cols * Math.ceil(height / block));
  const counts = new Uint32Array(sums.length);
  let total = 0;
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
    const row = Math.floor(y / block) * cols;
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
      const i = (y * width + x) * 4;
      const d = (Math.abs((a[i] as number) - (b[i] as number)) + Math.abs((a[i + 1] as number) - (b[i + 1] as number)) + Math.abs((a[i + 2] as number) - (b[i + 2] as number))) / 3;
      const k = row + Math.floor(x / block);
      sums[k] = (sums[k] as number) + d;
      counts[k] = (counts[k] as number) + 1;
      total += d;
    }
  }
  let worst = 0;
  let area = 0;
  sums.forEach((s, k) => {
    const n = counts[k] as number;
    area += n;
    if (n > 0) worst = Math.max(worst, s / n);
  });
  return { mean: area > 0 ? total / area : 0, worst };
}
