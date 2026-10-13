// The own atlas: every far copy's own views in four shared layers, as a far
// form's atlas lays them out, so the cards of every plant read them from one
// set of textures (`createFarCards`, `FarCards.own`). A copy takes room for
// 2 by 2 tiles of one size: the four views nearest the eye. The atlas keeps
// its width and grows in height, by doubling, up to the size it may reach on
// this device. Views bake into a small stage first and reach the atlas in one
// copy a layer a frame: drawing into the large atlas is what costs, and it
// costs the same for one tile as for a hundred.

import * as THREE from "three";
import { type FarViews, farViewLayers } from "./far.ts";

/** Room for one copy's 2 by 2 tiles: where they start in the atlas, in texels, and a tile's size. */
export interface OwnSlot {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

export interface OwnAtlas {
  /** The atlas's four layers, as they stand now: they are made anew when the atlas grows (`onGrow`). */
  readonly layers: readonly THREE.Texture[];
  readonly width: number;
  readonly height: number;
  /** Takes room for 2 by 2 tiles of `size` texels, or null when the atlas cannot grow to hold them. */
  take(size: number): OwnSlot | null;
  /** Gives the room back. */
  give(slot: OwnSlot): void;
  /**
   * Bakes view (i, j) of `views` into tile (c, r) of `slot`, staged until
   * `flush`; false when the stage is full until then. Given `saved`, it reads
   * the view's four layers back and hands them over, to keep.
   */
  bake(views: FarViews, i: number, j: number, slot: OwnSlot, c: number, r: number, saved?: (layers: Uint8Array[]) => void): boolean;
  /** Writes a view kept from an earlier bake, its four layers' texels, into tile (c, r) of `slot`. */
  upload(slot: OwnSlot, c: number, r: number, layers: readonly Uint8Array[]): void;
  /** Copies every view staged since the last flush into the atlas. */
  flush(): void;
  /** Bytes the tiles taken hold, and bytes the atlas holds on the GPU. */
  bytes(): { readonly taken: number; readonly allocated: number };
  /** Calls `listener` whenever the atlas grows into new layers. */
  onGrow(listener: () => void): void;
  dispose(): void;
}

/** The stage's side, in texels: it holds a frame's views before they reach the atlas. */
const STAGE = 512;
/** Bytes a texel holds across the four layers. */
const TEXEL = 16;
/** Most tiles one flush copies. */
const COPIES = 1024;

const COPY_VERT = /* glsl */ `
attribute vec4 aDst; // x, y, width, height in the target, in texels
attribute vec2 aSrc; // x, y in the source, in texels
uniform vec2 uSize;
varying vec2 vSrc;
varying vec2 vDst;
void main() {
  vSrc = aSrc;
  vDst = aDst.xy;
  gl_Position = vec4((aDst.xy + position.xy * aDst.zw) / uSize * 2.0 - 1.0, 0.0, 1.0);
}`;
const COPY_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uSrc;
varying vec2 vSrc;
varying vec2 vDst;
void main() {
  gl_FragColor = texelFetch(uSrc, ivec2(vSrc + floor(gl_FragCoord.xy - vDst)), 0);
}`;

/** An own atlas `width` texels wide, growing to at most `maxHeight`. */
export function createOwnAtlas(renderer: THREE.WebGLRenderer, width: number, maxHeight: number): OwnAtlas {
  let height = Math.min(512, maxHeight);
  let layers = farViewLayers(width, height);
  const stage = farViewLayers(STAGE, STAGE);
  for (const target of [...layers, ...stage]) renderer.initRenderTarget(target);
  const listeners: (() => void)[] = [];

  // Shelves of slots, each as tall as one size's slot, laid down the atlas as sizes need them.
  const shelves: { y: number; size: number; next: number }[] = [];
  const free = new Map<number, OwnSlot[]>();
  let top = 0;
  let taken = 0;

  // The copy: one quad a tile, from a source's texels to a target's.
  const unit = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
  const quads = new THREE.InstancedBufferGeometry();
  quads.index = unit.index;
  quads.setAttribute("position", unit.getAttribute("position"));
  const dst = new THREE.InstancedBufferAttribute(new Float32Array(COPIES * 4), 4);
  const src = new THREE.InstancedBufferAttribute(new Float32Array(COPIES * 2), 2);
  quads.setAttribute("aDst", dst);
  quads.setAttribute("aSrc", src);
  const uniforms = { uSrc: { value: null as THREE.Texture | null }, uSize: { value: new THREE.Vector2() } };
  const material = new THREE.ShaderMaterial({ vertexShader: COPY_VERT, fragmentShader: COPY_FRAG, uniforms, blending: THREE.NoBlending, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(quads, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene().add(mesh);
  const camera = new THREE.Camera();

  /** Copies `count` staged rectangles from `from`'s layers into `to`'s. */
  const copy = (from: readonly THREE.WebGLRenderTarget[], to: readonly THREE.WebGLRenderTarget[], count: number): void => {
    if (count === 0) return;
    dst.needsUpdate = true;
    src.needsUpdate = true;
    quads.instanceCount = count;
    const was = { target: renderer.getRenderTarget(), auto: renderer.autoClear };
    renderer.autoClear = false;
    to.forEach((target, n) => {
      uniforms.uSrc.value = (from[n] as THREE.WebGLRenderTarget).texture;
      uniforms.uSize.value.set(target.width, target.height);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    });
    renderer.setRenderTarget(was.target);
    renderer.autoClear = was.auto;
  };

  // The stage packs a frame's views in rows; the copies wait in `dst` and `src`.
  let stageX = 0;
  let stageY = 0;
  let rowHeight = 0;
  let staged = 0;
  const flush = (): void => {
    copy(stage, layers, staged);
    staged = 0;
    stageX = 0;
    stageY = 0;
    rowHeight = 0;
  };

  const grow = (): boolean => {
    if (height >= maxHeight) return false;
    // What is staged reaches the old layers first, then the old layers reach the new.
    flush();
    const next = farViewLayers(width, Math.min(maxHeight, height * 2));
    for (const target of next) renderer.initRenderTarget(target);
    dst.array.set([0, 0, width, height], 0);
    src.array.set([0, 0], 0);
    copy(layers, next, 1);
    for (const layer of layers) layer.dispose();
    layers = next;
    height = next[0]?.height ?? height;
    for (const listener of listeners) listener();
    return true;
  };

  return {
    get layers() {
      return layers.map((l) => l.texture);
    },
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    take(size) {
      const reused = free.get(size)?.pop();
      if (reused !== undefined) {
        taken += 4 * size * size * TEXEL;
        return reused;
      }
      const side = 2 * size;
      if (side > width) return null;
      let shelf = shelves.find((s) => s.size === size && s.next + side <= width);
      if (shelf === undefined) {
        while (top + side > height) if (!grow()) return null;
        shelf = { y: top, size, next: 0 };
        shelves.push(shelf);
        top += side;
      }
      const slot = { x: shelf.next, y: shelf.y, size };
      shelf.next += side;
      taken += 4 * size * size * TEXEL;
      return slot;
    },
    give(slot) {
      const list = free.get(slot.size) ?? [];
      list.push(slot);
      free.set(slot.size, list);
      taken -= 4 * slot.size * slot.size * TEXEL;
    },
    bake(views, i, j, slot, c, r, saved) {
      const size = slot.size;
      if (staged >= COPIES) return false;
      if (stageX + size > STAGE) {
        stageX = 0;
        stageY += rowHeight;
        rowHeight = 0;
      }
      if (stageY + size > STAGE) return false;
      views.bake(i, j, size, stage, stageX, stageY);
      if (saved !== undefined) {
        const [x, y] = [stageX, stageY];
        void Promise.all(stage.map((target) => renderer.readRenderTargetPixelsAsync(target, x, y, size, size, new Uint8Array(size * size * 4)) as Promise<Uint8Array>))
          .then(saved)
          .catch(() => undefined);
      }
      dst.array.set([slot.x + c * size, slot.y + r * size, size, size], staged * 4);
      src.array.set([stageX, stageY], staged * 2);
      staged++;
      stageX += size;
      rowHeight = Math.max(rowHeight, size);
      return true;
    },
    flush,
    upload(slot, c, r, texels) {
      const size = slot.size;
      const at = new THREE.Vector2(slot.x + c * size, slot.y + r * size);
      layers.forEach((layer, n) => {
        const data = texels[n];
        if (data === undefined || data.length !== size * size * 4) throw new Error(`A kept view of ${size} texels needs ${size * size * 4} bytes a layer.`);
        const texture = new THREE.DataTexture(data, size, size);
        renderer.copyTextureToTexture(texture, layer.texture, null, at);
      });
    },
    bytes: () => ({ taken, allocated: width * height * TEXEL }),
    onGrow(listener) {
      listeners.push(listener);
    },
    dispose() {
      for (const layer of [...layers, ...stage]) layer.dispose();
      unit.dispose();
      quads.dispose();
      material.dispose();
    },
  };
}
