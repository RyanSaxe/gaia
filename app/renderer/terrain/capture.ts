// The world's own view of one thing, for its painting in the journal: the
// scene drawn from a camera stood back from the thing into a target of its
// own, and a mask of where the thing itself shows. The mask needs nothing
// from the thing's kind: the scene is drawn a second time without the
// ground, grass, water and sky, and the thing is wherever something stands
// frontmost inside its own bounds. The pixels are read back without waiting
// on the GPU, so the person's frames never stall.

import * as THREE from "three";

/** A capture as plain pixels: RGBA rows, top row first. */
export interface Pixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** Where the thing stands and how far it reaches: a cylinder from `base` up `height`, `reach` around (x, z). */
export interface CaptureBounds {
  readonly x: number;
  readonly z: number;
  readonly base: number;
  readonly height: number;
  readonly reach: number;
}

export interface Capture {
  /**
   * Draws `scene` from `camera` at `width` by `height` pixels, and again
   * without `ground`, and reads back the view and the mask of what stands
   * inside `bounds`. Every draw happens before it returns; only the reading
   * back waits.
   */
  shoot(scene: THREE.Scene, camera: THREE.PerspectiveCamera, ground: readonly THREE.Object3D[], bounds: CaptureBounds, width: number, height: number): Promise<{ color: Pixels; mask: Pixels }>;
  dispose(): void;
}

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// A pixel is the thing's when something stands frontmost there with the ground hidden as with it shown, and the
// point it shows lies inside the thing's cylinder.
const MASK_FS = /* glsl */ `
uniform sampler2D tAll;
uniform sampler2D tThings;
uniform mat4 uInverseProjection;
uniform mat4 uCameraWorld;
uniform vec3 uCenter;
uniform vec2 uSpan;
uniform float uReach;
varying vec2 vUv;
void main() {
  float all = texture2D(tAll, vUv).x;
  float things = texture2D(tThings, vUv).x;
  if (things >= 1.0 || abs(all - things) > 1e-5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec4 view = uInverseProjection * vec4(vUv * 2.0 - 1.0, all * 2.0 - 1.0, 1.0);
  vec3 world = (uCameraWorld * vec4(view.xyz / view.w, 1.0)).xyz;
  bool inside = length(world.xz - uCenter.xz) <= uReach && world.y >= uSpan.x && world.y <= uSpan.y;
  float m = inside ? 1.0 : 0.0;
  gl_FragColor = vec4(m, m, m, 1.0);
}`;

export function createCapture(renderer: THREE.WebGLRenderer): Capture {
  let size = { w: 0, h: 0 };
  let all: THREE.WebGLRenderTarget | null = null;
  let things: THREE.WebGLRenderTarget | null = null;
  let mask: THREE.WebGLRenderTarget | null = null;
  const targets = (w: number, h: number): void => {
    if (all !== null && size.w === w && size.h === h) return;
    for (const t of [all, things, mask]) t?.dispose();
    const depthTarget = (): THREE.WebGLRenderTarget => {
      const t = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
      t.depthTexture = new THREE.DepthTexture(w, h);
      return t;
    };
    all = depthTarget();
    things = depthTarget();
    mask = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
    size = { w, h };
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: QUAD_VS,
    fragmentShader: MASK_FS,
    uniforms: {
      tAll: { value: null },
      tThings: { value: null },
      uInverseProjection: { value: new THREE.Matrix4() },
      uCameraWorld: { value: new THREE.Matrix4() },
      uCenter: { value: new THREE.Vector3() },
      uSpan: { value: new THREE.Vector2() },
      uReach: { value: 1 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const quadGeometry = new THREE.BufferGeometry();
  quadGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(quadGeometry, material);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const read = async (target: THREE.WebGLRenderTarget, w: number, h: number): Promise<Pixels> => {
    const raw = new Uint8Array(w * h * 4);
    await renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h, raw);
    // GL's rows run bottom first.
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) data.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return { data, width: w, height: h };
  };

  return {
    async shoot(scene, camera, ground, bounds, w, h) {
      targets(w, h);
      const [a, b, m] = [all, things, mask] as [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      const before = renderer.getRenderTarget();
      renderer.setRenderTarget(a);
      renderer.clear();
      renderer.render(scene, camera);
      const shown = ground.map((o) => o.visible);
      for (const o of ground) o.visible = false;
      try {
        renderer.setRenderTarget(b);
        renderer.clear();
        renderer.render(scene, camera);
      } finally {
        ground.forEach((o, i) => (o.visible = shown[i] ?? true));
      }
      const u = material.uniforms as Record<string, THREE.IUniform>;
      (u.tAll as THREE.IUniform).value = a.depthTexture;
      (u.tThings as THREE.IUniform).value = b.depthTexture;
      (u.uInverseProjection as THREE.IUniform<THREE.Matrix4>).value.copy(camera.projectionMatrixInverse);
      (u.uCameraWorld as THREE.IUniform<THREE.Matrix4>).value.copy(camera.matrixWorld);
      (u.uCenter as THREE.IUniform<THREE.Vector3>).value.set(bounds.x, bounds.base, bounds.z);
      (u.uSpan as THREE.IUniform<THREE.Vector2>).value.set(bounds.base - 0.4, bounds.base + bounds.height * 1.1 + 0.3);
      (u.uReach as THREE.IUniform).value = bounds.reach * 1.1 + 0.2;
      renderer.setRenderTarget(m);
      renderer.clear();
      renderer.render(quadScene, quadCamera);
      renderer.setRenderTarget(before);
      const [color, masked] = await Promise.all([read(a, w, h), read(m, w, h)]);
      return { color, mask: masked };
    },
    dispose() {
      for (const t of [all, things, mask]) t?.dispose();
      material.dispose();
      quadGeometry.dispose();
    },
  };
}
