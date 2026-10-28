// Draws the drifts a region's biome sets in its air (`drift@1`, the accents
// Jev chooses for a directory): petals and leaves falling from the region's
// trees, and fireflies over its ground after dusk, all carried by the wind.
//
// Drifts exist only around the person, and the vertex shader places and fades
// each one. Fireflies fill a square anchored to the world and wrap to its far
// side only where distance has already faded them. Density follows each
// drift's region and thins with the land's decline and in the wild, so
// nothing appears or vanishes as the person moves.

import * as THREE from "three";
import type { AccentForm, AccentSpec } from "@gaia/schema";
import type { SceneLight } from "@gaia/render";
import { regionWeights, type WorldSpec } from "@gaia/terrain";
import { GROUND_SAMPLE_GLSL, type GroundTexture, WILD_GLSL } from "./ground.ts";
import { VITALITY_GLSL, vitalityUniforms } from "./vitality.ts";

/**
 * How a form moves and draws. `shape` is 0 for a soft dot, 1 for a petal and 2 for a leaf. `fall` is in meters a
 * second, `low` and `high` bound its height above the floor, and `wander` is how far it strays in meters.
 */
interface DriftForm {
  readonly shape: number;
  readonly fall: number;
  readonly low: number;
  readonly high: number;
  readonly wander: number;
  readonly blink: number;
  readonly opacity: number;
}

const DRIFT_FORMS: Readonly<Record<AccentForm, DriftForm>> = {
  petals: { shape: 1, fall: 0.35, low: 0, high: 9, wander: 0.6, blink: 0, opacity: 0.95 },
  fireflies: { shape: 0, fall: 0, low: 0.7, high: 2.6, wander: 0.9, blink: 1, opacity: 1 },
  leaves: { shape: 2, fall: 0.6, low: 0, high: 10, wander: 0.8, blink: 0, opacity: 1 },
};

/**
 * A firefly's glowing dot. Its core radius is `core` times the drift's size, but at least `angle` radians of the view
 * or `px` device pixels, so a far one or one on a small screen still reads as a point of light. In the dark a halo
 * reaches `halo` times as far at `haloAlpha` of the core's light. Between flashes it dims to `dim`.
 */
const GLOW = { core: 0.15, angle: 0.0028, px: 1.4, halo: 3, haloAlpha: 0.3, dim: 0.4 } as const;

/** Draws a drift's color and shape, lit like everything else, so petals darken at night while glowing things shine. */
const DRIFT_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;
uniform vec3 uMoonColor;
uniform float uMoonIntensity;
uniform float uGlow;
uniform float uShape;
uniform float uBlink;
uniform float uOpacity;
uniform float uHalo;
varying float vPhase;
varying float vFade;
varying float vCore;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  // One pixel, as a share of the point: a shape's edges soften over it, and a small point keeps its shape at least
  // a pixel and a half wide, so a drift far off still reads as a speck.
  float px = fwidth(gl_PointCoord.x);
  float a = vPhase * 6.283 + uTime * (0.6 + vPhase);
  float ca = cos(a);
  float sa = sin(a);
  vec2 r = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y);
  // 0: soft dot, 1: petal, 2: leaf. Petals and leaves tumble, so their width breathes.
  float tumble = max(0.35 + 0.65 * abs(sin(uTime * 2.1 + vPhase * 13.0)), 4.0 * px);
  // A glowing dot is a bright core vCore device pixels round and, in the dark, a faint halo round it.
  float cores = length(c) / max(px, 1e-4) / vCore;
  float disc = exp(-cores * cores) + exp(-cores * cores / ${(GLOW.halo * GLOW.halo).toFixed(1)}) * ${GLOW.haloAlpha.toFixed(2)} * uHalo;
  float petal = smoothstep(0.46 + max(0.04, px), 0.46 - max(0.04, px), length(vec2(r.x / (0.42 * tumble), r.y / 0.95)));
  float leaf = smoothstep(0.47 + max(0.03, px), 0.47 - max(0.03, px), length(vec2(r.x / (0.36 * tumble), r.y)) + abs(r.x) * 0.6);
  float shape = uShape < 0.5 ? disc : uShape < 1.5 ? petal : leaf;
  // A blinking thing flashes slowly, every five seconds or so, and dims to ${GLOW.dim} between flashes rather than
  // going out.
  float blink = mix(1.0, ${GLOW.dim.toFixed(2)} + ${(1 - GLOW.dim).toFixed(2)} * smoothstep(0.2, 1.0, sin(uTime * 1.2 + vPhase * 41.0)), uBlink);
  // Lit like everything else, so petals darken at night while glowing things shine.
  vec3 sky = uAmbientColor * uAmbientIntensity * 1.35 + uSunColor * uSunIntensity * 0.46 + uMoonColor * uMoonIntensity * 0.6;
  vec3 lit = uColor * mix(sky, vec3(1.0), uGlow);
  float alpha = shape * vFade * blink * uOpacity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(lit, alpha);
}
`;

/**
 * Drift distances in meters. Fireflies fill a square reaching `air` each way
 * and fade out from `fade` of that to its edge. Trees drop leaves and petals
 * out to `trees`, fading out from `fade` of it, and keep dropping them out to
 * `keep`, where the wind can carry none back into sight. A drift nearer the
 * eye than `near[1]` fades, and is gone at `near[0]`, so none fills the view.
 */
export const DRIFT_REACH = { air: 30, trees: 60, keep: 72, fade: 0.7, near: [0.6, 1.8] } as const;
/** Most drifts per form. */
const MOST = 2400;
/** Most trees dropping leaves or petals at once. Each drops up to `MOST / CROWNS`, which is 50, at a time. */
const CROWNS = 48;
/**
 * Scale from `drift@1`'s size to the drawn size. Its sizes were tuned in a debugging view whose 40° lens shows a thing
 * 1.5 times as large as the walked world's 58° lens. At walking distance, a 10 cm leaf at that size covered a few
 * pixels and was lost. A drift is never drawn under `MIN_PX` device pixels across, so far ones stay specks.
 */
const SCALE = 1.5;
const MIN_PX = 4;
/**
 * How a region's drift count sets its fill, the share of a form's drifts that show. `drift@1` counts are 70 for
 * "a few", 180 for "some" and 380 for "many". A tree in a region with "many" drops its full share. The air holds as
 * many drifts per square meter as the debugging view's 52 m by 60 m box did, so "some" is 0.06 a square meter.
 */
const FULL_TREE = 380;
const AIR_SHARE = (2 * DRIFT_REACH.air) ** 2 / (52 * 60) / MOST;
/**
 * How sharply a region's drifts thin past its edge: each region's blend weight (`regionWeights`) is raised to this
 * power. A region's air is full to about 25 m inside its edge and thins into the next region's over about 50 m. With
 * the plain weights the ground uses, a small world's regions all lie in each other's 130 m band, and the center of a
 * firefly region had only about a quarter of its fireflies.
 */
const EDGE = 12;
/**
 * The window of a form's fill around the person (`fillAround`): `samples` a side, `spacing` meters apart, on a grid
 * fixed to the world, so a point's fill is the same in any window. The window moves once the person is `recenter`
 * meters from its center. At 96 m a side it still covers the fireflies' square around them.
 */
const FILL = { samples: 13, spacing: 8, recenter: 16 } as const;
/** Seconds a tree newly near the person takes to reach its full drop rate, so its leaves never appear all at once. */
const CROWN_FADE = 3;
/** Meters a second the wind carries a falling leaf at a breeze. Fireflies move at a fraction of it. */
const CARRY = 0.6;
/** Largest drawn drift size in device pixels. */
const LARGEST = 64;
/** A glowing dot's point size in cores. It reaches 1.8 halos each side, where the halo has faded to nothing. */
const GLOW_POINT = 2 * 1.8 * GLOW.halo;
/** The forms that fall from trees. Fireflies float in the air instead. */
const FROM_TREES: ReadonlySet<AccentForm> = new Set(["petals", "leaves"]);

const DRIFT_VERT = /* glsl */ `
${GROUND_SAMPLE_GLSL}
${WILD_GLSL}
${VITALITY_GLSL}
#define CROWNS ${CROWNS}
uniform float uTime;
uniform float uWind;
uniform vec2 uWindDir;
uniform vec3 uEye;
uniform float uNightness;
// How far the wind has carried the air since the page opened, meters, held within one square.
uniform vec2 uCarried;
uniform float uPixels;
uniform float uSize;
uniform float uFall;
uniform float uLow;
uniform float uHigh;
uniform float uWander;
uniform float uShape;
// 1 for what shows only after dusk.
uniform float uDusk;
// 1 for what falls from the trees near the person.
uniform float uFromTrees;
// How full the air is round the person, as a share of uFull: samples uFillMap.z meters apart from (uFillMap.x, uFillMap.y),
// uFillMap.w a side.
uniform sampler2D uFill;
uniform vec4 uFillMap;
uniform float uFull;
// Each tree dropping leaves or petals: x, z, the lowest and highest it lets go from; its crown's reach, its
// ground, when it began (seconds of uTime) and how much of its share it drops, 0 to 1. A reach of 0 is no tree.
uniform vec4 uCrownAt[CROWNS];
uniform vec4 uCrownOf[CROWNS];
attribute vec4 aSeed; // place in the square or the crown (x, z), phase, rank among the form's
attribute vec2 aMore; // its tree, height seed
varying float vPhase;
varying float vFade;
varying float vCore;

// The ground or the water's face, whichever is higher.
float floorAt(vec2 xz) {
  if (inWild(xz)) return wildHeight(xz);
  vec2 g = groundAt(xz);
  return max(g.x, g.y);
}

// How much of its most this form holds in the air at a point: its region's (fillAround), none in the wild, thinning
// as the land declines.
float densityAt(vec2 xz) {
  vec2 uv = ((xz - uFillMap.xy) / uFillMap.z + 0.5) / uFillMap.w;
  return texture2D(uFill, uv).r * uFull * (1.0 - wildShare(xz)) * (1.0 - declineOf(landVitality(xz).y));
}

void main() {
  float phase = aSeed.z;
  float t = uTime;
  vec2 xz;
  float y;
  float fade;
  float density;
  if (uFromTrees > 0.5) {
    int slot = int(aMore.x + 0.5);
    vec4 at = uCrownAt[slot];
    vec4 of = uCrownOf[slot];
    // It lets go at the crown's widest reach, at a height between the crown's lowest and highest leaves, so it falls
    // outside the foliage where it can be seen; a leaf let go inside a crown fell hidden by its branches. It is
    // carried downwind and round as it goes.
    float letGo = mix(at.z, at.w, aMore.y);
    float span = max(letGo - of.y, 0.5) + 0.6;
    float cycle = span / uFall;
    float age = fract(t / cycle + phase) * cycle;
    float around = aSeed.x * 6.2832;
    float rim = of.x * mix(1.0, 1.15, aSeed.y);
    vec2 start = at.xy + vec2(cos(around), sin(around)) * rim;
    xz = start + uWindDir * uWind * ${CARRY.toFixed(2)} * age + vec2(sin(age * 1.3 + phase * 17.0), cos(age * 1.1 + phase * 23.0)) * uWander;
    y = letGo - uFall * age;
    float below = floorAt(xz);
    float reach = length(xz - uEye.xz);
    fade = step(0.01, of.x) * smoothstep(0.0, 1.2, age) * smoothstep(below, below + 0.4, y) * smoothstep(of.z, of.z + ${CROWN_FADE.toFixed(1)}, t)
      * (1.0 - smoothstep(${(DRIFT_REACH.trees * DRIFT_REACH.fade).toFixed(1)}, ${DRIFT_REACH.trees.toFixed(1)}, reach));
    density = of.w;
  } else {
    // A firefly: anchored to the world and nudged a little by the wind, held in the square round the eye, hovering
    // up and down between uLow and uHigh.
    vec2 p = aSeed.xy * ${(2 * DRIFT_REACH.air).toFixed(1)} + uCarried * 0.15
      + vec2(sin(t * 1.3 + phase * 17.0), cos(t * 1.1 + phase * 23.0)) * uWander;
    vec2 rel = mod(p - uEye.xz + ${DRIFT_REACH.air.toFixed(1)}, ${(2 * DRIFT_REACH.air).toFixed(1)}) - ${DRIFT_REACH.air.toFixed(1)};
    xz = uEye.xz + rel;
    float h = uLow + (0.5 + 0.5 * sin(t * 0.5 + phase * 31.0)) * (uHigh - uLow);
    y = floorAt(xz) + h;
    fade = (1.0 - smoothstep(${(DRIFT_REACH.air * DRIFT_REACH.fade).toFixed(1)}, ${DRIFT_REACH.air.toFixed(1)}, length(rel)))
      * smoothstep(0.0, 0.6, h - uLow) * smoothstep(0.0, 0.6, uHigh - h);
    density = fade > 0.0 ? densityAt(xz) : 0.0;
  }
  // Each drifting thing has its rank among its form's, so a region holding fewer shows the first of them. The last
  // twelfth of what the fullest region shows fades in one by one as the air fills, and the rest show whole however
  // few the land holds.
  fade *= clamp((density - aSeed.w) * 12.0 / max(uFull, 1e-3), 0.0, 1.0);
  fade *= mix(1.0, smoothstep(0.25, 0.65, uNightness), uDusk);
  vec4 mv = viewMatrix * vec4(xz.x, y, xz.y, 1.0);
  fade *= smoothstep(${DRIFT_REACH.near[0].toFixed(1)}, ${DRIFT_REACH.near[1].toFixed(1)}, -mv.z);
  vFade = fade;
  vPhase = phase;
  if (fade <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = projectionMatrix * mv;
  float size = uSize * uPixels / max(-mv.z, 0.5);
  if (uShape < 0.5) {
    // A glowing dot's point reaches out to where its halo has faded, and its core is never larger than the largest
    // point leaves room for.
    float core = max(size * ${GLOW.core.toFixed(2)}, max(uPixels * ${GLOW.angle.toFixed(4)}, ${GLOW.px.toFixed(1)}));
    vCore = min(core, ${(LARGEST / GLOW_POINT).toFixed(2)});
    gl_PointSize = vCore * ${GLOW_POINT.toFixed(1)};
  } else {
    vCore = 1.0;
    gl_PointSize = clamp(size, ${MIN_PX.toFixed(1)}, ${LARGEST.toFixed(1)});
  }
}
`;

/** A tree near the person that drops leaves or petals: its position, crown heights and radius, region and ground decline. */
export interface Crown {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  /** The ground at its foot, and its crown's lowest and highest, meters. */
  readonly ground: number;
  readonly low: number;
  readonly high: number;
  readonly reach: number;
  readonly region: number;
  /** Its ground's decline from 0 to 1 (`groundDecline`). */
  readonly decline: number;
}

export interface Drifts {
  readonly object: THREE.Group;
  /**
   * Sets each region's drift for `world`, by region index, as its biome
   * realizes it (`RegionLook.drift`), or null where it has none. Forms no
   * region uses draw nothing.
   */
  regions(world: WorldSpec, drifts: readonly (AccentSpec | null)[]): void;
  /**
   * Call every frame the person walks. It moves the air with the wind and
   * assigns the trees near the eye that drop leaves and petals. `crowns`
   * returns every tree within `reach` meters of (x, z), and `focal` is the
   * view's device pixels per radian.
   */
  follow(crowns: (x: number, z: number, reach: number) => readonly Crown[], focal: number): void;
  /** For each drawn form: its fullest region's fill, 0 to 1, how many of its drifts can show, and how many trees drop it now. */
  state(): Record<string, { readonly most: number; readonly drawn: number; readonly trees: number }>;
}

/** The uniforms that set how one form's drifts move and draw. */
function formUniforms(form: AccentForm, carried: THREE.Vector2) {
  const b = DRIFT_FORMS[form];
  return {
    uCarried: { value: carried },
    uPixels: { value: 1000 },
    uSize: { value: 0.06 },
    uFall: { value: b.fall },
    uLow: { value: b.low },
    uHigh: { value: b.high },
    uWander: { value: b.wander },
    uDusk: { value: form === "fireflies" ? 1 : 0 },
    uFromTrees: { value: FROM_TREES.has(form) ? 1 : 0 },
    uFill: { value: fillTexture() },
    uFillMap: { value: new THREE.Vector4(0, 0, FILL.spacing, FILL.samples) },
    uFull: { value: 0 },
    uCrownAt: { value: Array.from({ length: CROWNS }, () => new THREE.Vector4()) },
    uCrownOf: { value: Array.from({ length: CROWNS }, () => new THREE.Vector4()) },
    uColor: { value: new THREE.Vector3(1, 1, 1) },
    uGlow: { value: 0 },
    uShape: { value: b.shape },
    uBlink: { value: b.blink },
    uOpacity: { value: b.opacity },
    uHalo: { value: 0 },
  };
}

/** A form's fill texture around the person, `FILL.samples` a side, empty until first filled. */
function fillTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(FILL.samples * FILL.samples), FILL.samples, FILL.samples, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** One form's drifts: its points, the uniforms that set how they move, and each region's fill. */
interface FormPoints {
  readonly points: THREE.Points;
  readonly uniforms: ReturnType<typeof formUniforms>;
  /** The id of the tree in each slot that drops this form, or null. */
  readonly slots: (number | null)[];
  /** Each region's fill for this form, 0 to 1. It is 0 where the region has another drift or none. */
  full: readonly number[];
  spec: AccentSpec;
  /** The grid sample at the center of its fill window (`fillAround`), or null until the window is filled. */
  fillAt: readonly [number, number] | null;
}

const FORMS = Object.keys(DRIFT_FORMS) as AccentForm[];

export function createDrifts(light: SceneLight, ground: GroundTexture): Drifts {
  const object = new THREE.Group();
  const carried = new THREE.Vector2();
  let lastTime = light.uTime.value;
  const forms = new Map<AccentForm, FormPoints>();

  const makeForm = (form: AccentForm, seedBase: number, spec: AccentSpec): FormPoints => {
    const seeds = new Float32Array(MOST * 4);
    const more = new Float32Array(MOST * 2);
    let seed = seedBase >>> 0 || 1;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < MOST; i++) {
      seeds.set([next(), next(), next(), (i + next()) / MOST], i * 4);
      more.set([i % CROWNS, next()], i * 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MOST * 3), 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    geometry.setAttribute("aMore", new THREE.BufferAttribute(more, 2));
    const uniforms = formUniforms(form, carried);
    const material = new THREE.ShaderMaterial({
      vertexShader: DRIFT_VERT,
      fragmentShader: DRIFT_FRAG,
      uniforms: { ...light, ...ground.uniforms, ...vitalityUniforms, ...uniforms },
      transparent: true,
      depthWrite: false,
      // A glowing thing adds its light to what is behind it, so it brightens the dark rather than covering it.
      blending: spec.glow > 0.5 ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    // Draw after the water and the far forms' fading cards (renderOrder 2). Drifts write no depth, so those would paint over drifts drawn before them.
    points.renderOrder = 3;
    points.visible = false;
    object.add(points);
    return { points, uniforms, slots: new Array<number | null>(CROWNS).fill(null), full: [], spec, fillAt: null };
  };

  /** Sets a form's glow for the hour. Glowing things show by contrast, faint at noon and bright at dusk. */
  const shine = (f: FormPoints): void => {
    const dark = Math.min(1, Math.max(0, light.uNightness.value));
    const b = DRIFT_FORMS[f.spec.form];
    f.uniforms.uGlow.value = f.spec.glow * (0.35 + 0.65 * dark);
    f.uniforms.uOpacity.value = b.opacity * (f.spec.glow > 0.5 ? 0.45 + 0.55 * dark : 1);
    f.uniforms.uHalo.value = b.shape === 0 ? f.spec.glow * dark : 0;
  };

  let world: WorldSpec | null = null;
  let weights = new Float64Array(0);
  /**
   * Fills the window around (x, z) with the form's fill as a share of its fullest region's, blending regions by their
   * weights raised to `EDGE`.
   */
  const fillAround = (f: FormPoints, land: WorldSpec, x: number, z: number): void => {
    const half = (FILL.samples - 1) / 2;
    const i0 = Math.round(x / FILL.spacing) - half;
    const j0 = Math.round(z / FILL.spacing) - half;
    const most = Math.max(...f.full);
    const texture = f.uniforms.uFill.value;
    const data = texture.image.data as Uint8Array;
    for (let j = 0; j < FILL.samples; j++) {
      for (let i = 0; i < FILL.samples; i++) {
        regionWeights(land, (i0 + i) * FILL.spacing, (j0 + j) * FILL.spacing, weights);
        let sum = 0;
        let total = 0;
        weights.forEach((w, r) => {
          const share = w ** EDGE;
          sum += share * (f.full[r] ?? 0);
          total += share;
        });
        data[j * FILL.samples + i] = most > 0 && total > 0 ? Math.round((sum / total / most) * 255) : 0;
      }
    }
    texture.needsUpdate = true;
    f.uniforms.uFillMap.value.set(i0 * FILL.spacing, j0 * FILL.spacing, FILL.spacing, FILL.samples);
    f.fillAt = [i0 + half, j0 + half];
  };
  /** Whether the person at (x, z) is far enough from the center of the form's fill window to refill it around them. */
  const strayed = (f: FormPoints, x: number, z: number): boolean =>
    f.fillAt === null || Math.max(Math.abs(x - f.fillAt[0] * FILL.spacing), Math.abs(z - f.fillAt[1] * FILL.spacing)) > FILL.recenter;

  /**
   * Keeps each slot's tree while it stays within `DRIFT_REACH.keep`, so a slot frees only once nothing it dropped is
   * in sight. Fills free slots with the nearest trees first, and sets each tree's drop rate from its region's fill and
   * its ground's decline.
   */
  const tend = (f: FormPoints, near: readonly Crown[], x: number, z: number): void => {
    const at = f.uniforms.uCrownAt.value;
    const of = f.uniforms.uCrownOf.value;
    const mine = near.filter((c) => (f.full[c.region] ?? 0) > 0);
    const byId = new Map(mine.map((c) => [c.id, c]));
    f.slots.forEach((id, s) => {
      const c = id === null ? undefined : byId.get(id);
      if (id !== null && c === undefined) {
        f.slots[s] = null;
        (of[s] as THREE.Vector4).x = 0;
      } else if (c !== undefined) (of[s] as THREE.Vector4).w = (f.full[c.region] ?? 0) * (1 - c.decline);
    });
    const held = new Set(f.slots);
    const waiting = mine.filter((c) => !held.has(c.id)).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    for (const c of waiting) {
      const s = f.slots.indexOf(null);
      if (s < 0) break;
      f.slots[s] = c.id;
      (at[s] as THREE.Vector4).set(c.x, c.z, c.low, c.high);
      (of[s] as THREE.Vector4).set(c.reach, c.ground, light.uTime.value, (f.full[c.region] ?? 0) * (1 - c.decline));
    }
  };

  return {
    object,
    regions(land, drifts) {
      world = land;
      weights = new Float64Array(land.regions.length);
      FORMS.forEach((form, k) => {
        const spec = drifts.find((d): d is AccentSpec => d?.form === form);
        let f = forms.get(form);
        if (spec === undefined) {
          if (f !== undefined) f.points.visible = false;
          return;
        }
        f ??= makeForm(form, 991 + k * 7919, spec);
        forms.set(form, f);
        f.full = drifts.map((d) => (d?.form === form ? Math.min(1, FROM_TREES.has(form) ? d.count / FULL_TREE : d.count * AIR_SHARE) : 0));
        f.uniforms.uFull.value = Math.max(...f.full);
        f.fillAt = null;
        // A drift ranked past the fullest region's share never shows, so it is not drawn.
        f.points.geometry.setDrawRange(0, Math.min(MOST, Math.ceil(Math.max(...f.full) * MOST) + 1));
        // All regions' drifts of one form share one look, because `drift@1` gives each form one color and size.
        f.spec = spec;
        f.uniforms.uSize.value = spec.size * SCALE;
        f.uniforms.uColor.value.set(...spec.color);
        f.slots.fill(null);
        for (const v of f.uniforms.uCrownOf.value) v.x = 0;
        f.points.visible = true;
      });
    },
    state: () =>
      Object.fromEntries(
        [...forms]
          .filter(([, f]) => f.points.visible)
          .map(([form, f]) => [form, { most: +Math.max(...f.full).toFixed(3), drawn: f.points.geometry.drawRange.count, trees: f.slots.filter((s) => s !== null).length }]),
      ),
    follow(crowns, focal) {
      // The wind moves the air as the world's clock runs, and not while the clock is frozen.
      const t = light.uTime.value;
      const dt = Math.max(0, t - lastTime);
      lastTime = t;
      const wind = light.uWindDir.value;
      carried.x = (carried.x + wind.x * light.uWind.value * CARRY * dt) % (2 * DRIFT_REACH.air);
      carried.y = (carried.y + wind.y * light.uWind.value * CARRY * dt) % (2 * DRIFT_REACH.air);
      const eye = light.uEye.value;
      const near = [...forms.entries()].some(([form, f]) => f.points.visible && FROM_TREES.has(form)) ? crowns(eye.x, eye.z, DRIFT_REACH.keep) : [];
      for (const [form, f] of forms) {
        if (!f.points.visible) continue;
        f.uniforms.uPixels.value = focal;
        shine(f);
        if (FROM_TREES.has(form)) tend(f, near, eye.x, eye.z);
        else if (world !== null && strayed(f, eye.x, eye.z)) fillAround(f, world, eye.x, eye.z);
      }
    },
  };
}
