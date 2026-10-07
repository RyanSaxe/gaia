// The faint ring that marks where a tap or click sent the walker. It lies on
// the ground, or on the water over it, and fades once the walk ends. Far away
// it grows, so it stays about as easy to see at 30 m as at 8 m.

import * as THREE from "three";
import { type Terrain, heightAt, waterDepthAt } from "@gaia/terrain";

const SEGMENTS = 48;
/** Radii of the ring's soft band, meters, up close: transparent at both edges, most opaque between. */
const RADII = [0.42, 0.6, 0.78] as const;
/** Past this distance, meters, the ring grows with it, up to `MAX_GROWTH` times. */
const GROW_FROM = 8;
const MAX_GROWTH = 4;
const LIFT = 0.04;
const OPACITY = 0.6;
/** Seconds to appear, and to fade once the walk ends. */
const FADE_IN = 0.15;
const FADE_OUT = 0.7;

const VERT = /* glsl */ `
uniform float uGrass;
uniform vec3 uNormal;
attribute float aBand;
varying float vBand;
void main() {
  vBand = aBand;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * world;
  // Drawn where it lies, but depth-tested as if it lay on top of the grass:
  // sliding a point along its view ray keeps it on the same pixel. The pull is
  // the grass's depth along this ray, so blades never hide the ring and hills still do.
  vec3 toEye = cameraPosition - world.xyz;
  float d = length(toEye);
  float pull = min(uGrass / max(0.04, dot(toEye / d, uNormal)), d * 0.6);
  mv.xyz *= 1.0 - pull / d;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vBand;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vBand);
}
`;

export interface WalkMarker {
  readonly mesh: THREE.Mesh;
  /** Shows the ring at a point, fitted to the ground or water there. */
  place(t: Terrain, x: number, z: number): void;
  /** Lets the ring fade away where it is. */
  fade(): void;
  /** Advances the fade and sizes the ring for an eye at `eye`; `nightness` dims it after dark so it never reads as a light. */
  frame(dt: number, eye: THREE.Vector3, nightness: number): void;
  readonly opacity: () => number;
}

export function createWalkMarker(): WalkMarker {
  const positions = new Float32Array(SEGMENTS * RADII.length * 3);
  const band = new Float32Array(SEGMENTS * RADII.length);
  const index: number[] = [];
  for (let s = 0; s < SEGMENTS; s++) {
    for (let r = 0; r < RADII.length; r++) band[s * RADII.length + r] = r === 1 ? 1 : 0;
    const next = (s + 1) % SEGMENTS;
    for (let r = 0; r < RADII.length - 1; r++) {
      const a = s * RADII.length + r;
      const b = next * RADII.length + r;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3);
  geometry.setAttribute("position", position);
  geometry.setAttribute("aBand", new THREE.BufferAttribute(band, 1));
  geometry.setIndex(index);
  const uniforms = {
    uColor: { value: new THREE.Color(1, 0.97, 0.88) },
    uOpacity: { value: 0 },
    uGrass: { value: 1.4 },
    uNormal: { value: new THREE.Vector3(0, 1, 0) },
  };
  const material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 2;

  let shown = 0;
  let showing = false;
  let ground: Terrain | null = null;
  let growth = 0;
  /** Lays the ring on the ground around its center at `scale` times its radii. */
  function fit(t: Terrain, scale: number): void {
    const { x, z } = mesh.position;
    const surface = (px: number, pz: number): number => heightAt(t.lattice, px, pz) + waterDepthAt(t, px, pz);
    const y0 = surface(x, z);
    for (let s = 0; s < SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2;
      for (let r = 0; r < RADII.length; r++) {
        const radius = (RADII[r] as number) * scale;
        const px = Math.cos(a) * radius;
        const pz = Math.sin(a) * radius;
        positions.set([px, surface(x + px, z + pz) - y0 + LIFT, pz], (s * RADII.length + r) * 3);
      }
    }
    position.needsUpdate = true;
    const e = t.lattice.spacing;
    uniforms.uNormal.value.set(surface(x - e, z) - surface(x + e, z), 2 * e, surface(x, z - e) - surface(x, z + e)).normalize();
    mesh.position.y = y0;
    growth = scale;
  }
  return {
    mesh,
    place(t, x, z) {
      ground = t;
      mesh.position.set(x, 0, z);
      fit(t, 1);
      mesh.visible = true;
      showing = true;
    },
    fade() {
      showing = false;
    },
    frame(dt, eye, nightness) {
      shown = showing ? Math.min(1, shown + dt / FADE_IN) : Math.max(0, shown - dt / FADE_OUT);
      const scale = Math.min(MAX_GROWTH, Math.max(1, eye.distanceTo(mesh.position) / GROW_FROM));
      if (ground !== null && shown > 0 && Math.abs(scale - growth) > 0.02) fit(ground, scale);
      const eased = shown * shown * (3 - 2 * shown);
      uniforms.uOpacity.value = OPACITY * eased * (1 - 0.5 * nightness);
      mesh.visible = shown > 0;
    },
    opacity: () => uniforms.uOpacity.value,
  };
}
