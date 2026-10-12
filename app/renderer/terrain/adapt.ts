// Detail that gives way only while frames come late. A device that keeps
// its screen's pace draws exactly what Gaia draws at full detail; one that
// cannot steps down, least visible first: far cards read the one baked view
// nearest the eye, then the sun's shadow and the water's reflection redraw on
// alternate frames, then the view draws fewer pixels and is scaled up
// sharply, a few percent at a time. Once frames keep the pace again it steps
// back up, and a step up that brought late frames back waits ever longer
// before it is tried again, so detail settles and never hunts.

import * as THREE from "three";

/** What the frame draws now. */
export interface Detail {
  /** Far cards read only the view nearest the eye. */
  readonly cards: boolean;
  /** The shadow and the reflection are drawn on alternate frames, each keeping the last one's between. */
  readonly alternate: boolean;
  /** The view's share of the screen's pixels, per side; 1 draws them all. */
  readonly scale: number;
}

export const FULL: Detail = { cards: false, alternate: false, scale: 1 };

/**
 * Detail a page asks to hold, to judge a step by eye: `?detail=full` keeps
 * today's look whatever the frames do, `?detail=least` the lowest step, and
 * a share such as `?detail=0.7` every step down with the view at that scale.
 * Null lets frames choose.
 */
export function askedDetail(search: string): Detail | null {
  const asked = new URLSearchParams(search).get("detail");
  if (asked === null) return null;
  if (asked === "full") return FULL;
  if (asked === "least") return { cards: true, alternate: true, scale: GOVERN.scaleLeast };
  const scale = Number(asked);
  return Number.isFinite(scale) && scale > 0 && scale <= 1 ? { cards: true, alternate: true, scale } : null;
}

/** The governor's settings, milliseconds and shares. */
const GOVERN = {
  /** The refresh no device is held to more than: 60 a second. */
  slowestRefresh: 1000 / 60,
  /** A frame this many times the refresh apart from the last came late. */
  late: 1.5,
  /** One this many times the refresh apart is a stall, the page busy with other work, which less detail would not cure: it counts neither way. */
  stall: 3,
  /** How far back late frames are counted. */
  window: 2000,
  /** The share of late frames in the window that steps detail down. */
  pressure: 0.1,
  /** How often detail may step down. */
  stepDown: 500,
  /** How long frames must keep the pace after a step down before detail steps up. */
  calm: 8000,
  /** The share of late frames over the calm that still lets detail step up: a stray hitch from elsewhere on the device does not hold it down. */
  calmLate: 0.01,
  /** The longest a step up that brought late frames back waits before it is tried again, doubling each time it does. */
  calmMost: 64000,
  /** The scale's step, and the least it falls to. */
  scaleStep: 0.04,
  scaleLeast: 0.5,
} as const;

export interface Governor {
  readonly detail: Detail;
  /** Takes in the interval since the last frame, ms, at time `now`, ms. */
  update(interval: number, now: number): void;
  /** Holds detail at `detail`, or lets frames choose again with null; for checks and pictures. */
  hold(detail: Detail | null): void;
  /** Ignores frames until `until`, ms, or longer if already resting: while a world opens or changes, frames come late for reasons detail does not touch. */
  rest(until: number): void;
  /** Ends a rest at `at`, ms, however long it was to be. */
  wake(at: number): void;
}

/** Where a device's detail settled last time, so the next visit starts there rather than at full. */
const REMEMBERED = "gaia-detail";
const remembered = (): Detail => {
  try {
    const d = JSON.parse(localStorage.getItem(REMEMBERED) ?? "null") as Detail | null;
    if (d !== null && typeof d.cards === "boolean" && typeof d.alternate === "boolean" && d.scale >= GOVERN.scaleLeast && d.scale <= 1) return d;
  } catch {
    // No storage, or something else in it: start at full.
  }
  return FULL;
};
const remember = (d: Detail): void => {
  try {
    localStorage.setItem(REMEMBERED, JSON.stringify(d));
  } catch {
    // Without storage the next visit starts at full.
  }
};

export function createGovernor(): Governor {
  let detail: Detail = remembered();
  let held: Detail | null = null;
  let restUntil = -Infinity;
  // Frames since detail last changed: when each came and how long after the one before.
  const at: number[] = [];
  const gap: number[] = [];
  // When each frame over the last calm came, and when each late one did.
  const calmFrames: number[] = [];
  const calmLates: number[] = [];
  let lastStepDown = -Infinity;
  let lastStepUp = -Infinity;
  // The step up that last brought late frames back, by `stepOf`, and until when it waits.
  let failed = -1;
  let failedUntil = -Infinity;
  let backoff: number = GOVERN.calm;
  const down = (d: Detail): Detail =>
    !d.cards ? { ...d, cards: true } : !d.alternate ? { ...d, alternate: true } : { ...d, scale: Math.max(GOVERN.scaleLeast, +(d.scale - GOVERN.scaleStep).toFixed(2)) };
  const up = (d: Detail): Detail =>
    d.scale < 1 ? { ...d, scale: Math.min(1, +(d.scale + GOVERN.scaleStep).toFixed(2)) } : d.alternate ? { ...d, alternate: false } : { ...d, cards: false };
  /** How many steps down from full a detail is. */
  const stepOf = (d: Detail): number => (d.cards ? 1 : 0) + (d.alternate ? 1 : 0) + Math.round((1 - d.scale) / GOVERN.scaleStep);
  /** Takes on `next`, judging it only by the frames that follow. */
  const become = (next: Detail): void => {
    detail = next;
    remember(next);
    at.length = 0;
    gap.length = 0;
  };
  return {
    get detail() {
      return held ?? detail;
    },
    hold(next) {
      held = next;
    },
    rest(until) {
      restUntil = Math.max(restUntil, until);
      at.length = 0;
      gap.length = 0;
      calmFrames.length = 0;
      calmLates.length = 0;
    },
    wake(when) {
      restUntil = when;
    },
    update(interval, now) {
      // A paused page or a hidden tab says nothing about how the frame draws.
      if (!(interval > 0) || interval > 250 || now < restUntil) return;
      at.push(now);
      gap.push(interval);
      while (at.length > 0 && now - (at[0] as number) > GOVERN.window) {
        at.shift();
        gap.shift();
      }
      // The display's refresh: the quickest frames lately, but never held to more than 60 a second.
      const quick = [...gap].sort((a, b) => a - b)[Math.floor(gap.length * 0.05)] ?? GOVERN.slowestRefresh;
      const refresh = Math.min(GOVERN.slowestRefresh, quick);
      const isLate = (g: number): boolean => g > refresh * GOVERN.late && g <= refresh * GOVERN.stall;
      calmFrames.push(now);
      if (isLate(interval)) calmLates.push(now);
      while (calmFrames.length > 0 && now - (calmFrames[0] as number) > GOVERN.calm) calmFrames.shift();
      while (calmLates.length > 0 && now - (calmLates[0] as number) > GOVERN.calm) calmLates.shift();
      const late = gap.filter(isLate).length / gap.length;
      if (late > GOVERN.pressure && gap.length >= 20 && now - lastStepDown > GOVERN.stepDown) {
        const next = down(detail);
        if (stepOf(next) === stepOf(detail)) return;
        // A step up that brought late frames back waits twice as long before it is tried again.
        if (now - lastStepUp < GOVERN.calm) {
          failed = stepOf(detail);
          backoff = Math.min(GOVERN.calmMost, backoff * 2);
          failedUntil = now + backoff;
        }
        become(next);
        lastStepDown = now;
        return;
      }
      // Up a step once frames have kept the pace for the calm since the last step down, then a step every quarter of it while they still do.
      const settled = now - lastStepDown > GOVERN.calm && now - lastStepUp > GOVERN.calm / 4 && calmLates.length <= calmFrames.length * GOVERN.calmLate;
      if (!settled || stepOf(detail) === 0) return;
      const next = up(detail);
      if (stepOf(next) <= failed && now < failedUntil) return;
      become(next);
      lastStepUp = now;
    },
  };
}

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Catmull-Rom from nine bilinear taps (after Jimenez), which keeps edges
// crisp where a plain bilinear stretch would blur them, then a light
// contrast-adaptive sharpening across the four neighbours, held back where
// the neighbourhood already has strong contrast so edges never ring.
const UPSCALE_FS = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uSrcSize;
uniform vec2 uDstSize;
uniform float uSharp;
varying vec2 vUv;
vec3 catmullRom(vec2 uv) {
  vec2 pos = uv * uSrcSize;
  vec2 t1 = floor(pos - 0.5) + 0.5;
  vec2 f = pos - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (t1 - 1.0) / uSrcSize;
  vec2 t3 = (t1 + 2.0) / uSrcSize;
  vec2 t12 = (t1 + w2 / w12) / uSrcSize;
  vec3 c = vec3(0.0);
  c += texture2D(tSrc, vec2(t0.x, t0.y)).rgb * w0.x * w0.y;
  c += texture2D(tSrc, vec2(t12.x, t0.y)).rgb * w12.x * w0.y;
  c += texture2D(tSrc, vec2(t3.x, t0.y)).rgb * w3.x * w0.y;
  c += texture2D(tSrc, vec2(t0.x, t12.y)).rgb * w0.x * w12.y;
  c += texture2D(tSrc, vec2(t12.x, t12.y)).rgb * w12.x * w12.y;
  c += texture2D(tSrc, vec2(t3.x, t12.y)).rgb * w3.x * w12.y;
  c += texture2D(tSrc, vec2(t0.x, t3.y)).rgb * w0.x * w3.y;
  c += texture2D(tSrc, vec2(t12.x, t3.y)).rgb * w12.x * w3.y;
  c += texture2D(tSrc, vec2(t3.x, t3.y)).rgb * w3.x * w3.y;
  return c;
}
void main() {
  vec3 c = catmullRom(vUv);
  vec2 px = 1.0 / uDstSize;
  vec3 n = texture2D(tSrc, vUv + vec2(0.0, px.y)).rgb;
  vec3 s = texture2D(tSrc, vUv - vec2(0.0, px.y)).rgb;
  vec3 e = texture2D(tSrc, vUv + vec2(px.x, 0.0)).rgb;
  vec3 w = texture2D(tSrc, vUv - vec2(px.x, 0.0)).rgb;
  vec3 lo = min(c, min(min(n, s), min(e, w)));
  vec3 hi = max(c, max(max(n, s), max(e, w)));
  // How much room the neighbourhood leaves before the sharpened color would overshoot it.
  vec3 room = clamp(min(lo, 1.0 - hi) / max(hi, 1e-4), 0.0, 1.0);
  vec3 amount = -sqrt(room) * uSharp;
  vec3 sharpened = (c + (n + s + e + w) * amount) / (1.0 + 4.0 * amount);
  gl_FragColor = vec4(clamp(sharpened, 0.0, 1.0), 1.0);
}`;

/** Draws the view into a smaller multisampled target, then scales it up onto the canvas. */
export function createUpscaler() {
  const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, depthBuffer: true, type: THREE.UnsignedByteType });
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  target.texture.generateMipmaps = false;
  const srcSize = new THREE.Vector2();
  const dstSize = new THREE.Vector2();
  const material = new THREE.ShaderMaterial({
    vertexShader: QUAD_VS,
    fragmentShader: UPSCALE_FS,
    uniforms: { tSrc: { value: target.texture }, uSrcSize: { value: srcSize }, uDstSize: { value: dstSize }, uSharp: { value: 0.12 } },
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2();
  return {
    /** Renders `world` from `view` at `share` of the drawing buffer a side, and scales it up onto the canvas. */
    render(renderer: THREE.WebGLRenderer, world: THREE.Scene, view: THREE.Camera, share: number): void {
      renderer.getDrawingBufferSize(size);
      const w = Math.max(1, Math.round(size.x * share));
      const h = Math.max(1, Math.round(size.y * share));
      if (target.width !== w || target.height !== h) target.setSize(w, h);
      srcSize.set(w, h);
      dstSize.copy(size);
      renderer.setRenderTarget(target);
      renderer.render(world, view);
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    },
  };
}
