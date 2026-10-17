// Drifts: the small living things a region's biome sets drifting through its
// air (`drift@1`, the accents Jev chooses for a directory, or none). Petals
// and leaves fall from the region's trees, and fireflies hover over its
// ground after dusk, each in the color its accents give it. The world's wind
// carries them all.
//
// They gather only around the person. Fireflies fill a square around them,
// anchored to the world, each wrapping to the square's far side only where
// distance has already faded it out; a falling leaf lets go of a tree near
// the person and fades out as it lands. Each firefly shows by the region it
// floats in, as a tree drops its own region's, so the middle of a firefly
// land is full and its air thins across the land's edge into the next. Each
// thins as its land declines and none drift in the wild, so nothing appears
// or vanishes as the person moves. The page keeps the trees near the person
// once a frame; the shader places and fades every drift.

import * as THREE from "three";
import type { AccentForm, AccentSpec } from "@gaia/schema";
import type { SceneLight } from "@gaia/render";
import { regionWeights, type WorldSpec } from "@gaia/terrain";
import { GROUND_SAMPLE_GLSL, type GroundTexture, WILD_GLSL } from "./ground.ts";
import { VITALITY_GLSL, vitalityUniforms } from "./vitality.ts";

/** How each form moves and shows: its shape (0 a soft dot, 1 a petal, 2 a leaf), how fast it falls, meters a second, the heights it keeps between, how far it wanders, how much it blinks, and its opacity. */
interface DriftForm {
  readonly shape: number;
  readonly fall: number;
  readonly low: number;
  readonly high: number;
  readonly wander: number;
  readonly blink: number;
  readonly opacity: number;
}

/** Every drifting form. */
const DRIFT_FORMS: Readonly<Record<AccentForm, DriftForm>> = {
  petals: { shape: 1, fall: 0.35, low: 0, high: 9, wander: 0.6, blink: 0, opacity: 0.95 },
  fireflies: { shape: 0, fall: 0, low: 0.7, high: 2.6, wander: 0.9, blink: 1, opacity: 1 },
  leaves: { shape: 2, fall: 0.6, low: 0, high: 10, wander: 0.8, blink: 0, opacity: 1 },
};

/** A drifting thing's color and shape, lit as everything else is: petals darken at night while glowing things shine. */
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
void main() {
  vec2 c = gl_PointCoord - 0.5;
  // One pixel, as a share of the point: a shape's edges soften over it, and a small point keeps its shape at least
  // a pixel and a half wide and a glowing core at least a pixel round, so a drift far off still reads as a speck.
  float px = fwidth(gl_PointCoord.x);
  // In the dark a glowing mote keeps its small core and gains a soft halo.
  float grow = min(1.0 + uHalo * 3.0, 0.22 / max(px, 1e-3));
  float a = vPhase * 6.283 + uTime * (0.6 + vPhase);
  float ca = cos(a);
  float sa = sin(a);
  vec2 r = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y);
  // 0: soft dot, 1: petal, 2: leaf. Petals and leaves tumble, so their width breathes.
  float tumble = max(0.35 + 0.65 * abs(sin(uTime * 2.1 + vPhase * 13.0)), 4.0 * px);
  float disc = exp(-dot(c, c) * 14.0 * grow * grow) + exp(-dot(c, c) * 18.0) * uHalo * 0.5;
  float petal = smoothstep(0.46 + max(0.04, px), 0.46 - max(0.04, px), length(vec2(r.x / (0.42 * tumble), r.y / 0.95)));
  float leaf = smoothstep(0.47 + max(0.03, px), 0.47 - max(0.03, px), length(vec2(r.x / (0.36 * tumble), r.y)) + abs(r.x) * 0.6);
  float shape = uShape < 0.5 ? disc : uShape < 1.5 ? petal : leaf;
  // A blinking thing dims to a quarter between flashes rather than going out.
  float blink = mix(1.0, 0.25 + 0.75 * smoothstep(0.2, 1.0, sin(uTime * 1.6 + vPhase * 41.0)), uBlink);
  // Lit like everything else, so petals darken at night while glowing things shine.
  vec3 sky = uAmbientColor * uAmbientIntensity * 1.35 + uSunColor * uSunIntensity * 0.46 + uMoonColor * uMoonIntensity * 0.6;
  vec3 lit = uColor * mix(sky, vec3(1.0), uGlow);
  float alpha = shape * vFade * blink * uOpacity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(lit * (1.0 + uGlow * 0.6), alpha);
}
`;

/**
 * Where drifts gather round the person, meters: fireflies fill a square `air`
 * each way, fading out from `fade` of that to its edge; trees drop leaves and
 * petals out to `trees`, fading out from `fade` of it, and keep dropping them
 * until `keep` away, where the wind has carried none back into sight; and
 * anything nearer the eye than `near` fades, so none fills the view.
 */
export const DRIFT_REACH = { air: 30, trees: 60, keep: 72, fade: 0.7, near: [0.6, 1.8] } as const;
/** Each form's drifting things at most. */
const MOST = 2400;
/** Trees that drop leaves or petals at once, each letting go of up to `MOST / CROWNS` (50) at a time. */
const CROWNS = 48;
/**
 * How much larger than `drift@1`'s size a drift draws. Its sizes were set in a debugging view, whose 40° lens shows a
 * thing 1.5 times as large as the walked world's 58° does; at walking distance a 10 cm leaf at that size covered a
 * few pixels and was lost. A drift is never drawn under `MIN_PX` device pixels across, so far ones stay specks.
 */
const SCALE = 1.5;
const MIN_PX = 4;
/**
 * How full a region's drift fills its form's things, by the drift's count (`drift@1`'s "a few" 70, "some" 180,
 * "many" 380): a tree in a region with many drops all of its share; the air holds as many a square meter as the
 * debugging view's 52 m by 60 m box held, so "some" is 0.06 a square meter.
 */
const FULL_TREE = 380;
const AIR_SHARE = (2 * DRIFT_REACH.air) ** 2 / (52 * 60) / MOST;
/**
 * How sharply a region's air thins past its edge: each region's blend weight (`regionWeights`) to this power. A
 * region's air is full to about 25 m inside its edge and thins across it into the next region's over about 50 m.
 * Weighed by the plain weights, as the ground blends, a small world's regions all lie in each other's 130 m band, and
 * the middle of a firefly land held about a quarter of its fireflies.
 */
const EDGE = 12;
/**
 * The window of a form's fill round the person (`fillAround`): `samples` a side, `spacing` meters apart, on a grid
 * fixed to the world, so a point's fill is the same whichever window holds it. The window moves once the person is
 * `recenter` meters from its middle; 96 m a side, it still holds the fireflies' square round them.
 */
const FILL = { samples: 13, spacing: 8, recenter: 16 } as const;
/** Seconds a tree newly near the person takes to start dropping leaves fully, so none appear at once. */
const CROWN_FADE = 3;
/** How fast the wind carries a falling leaf, and nudges fireflies a little, meters a second at a breeze. */
const CARRY = 0.6;
/** The largest a drifting thing is drawn, device pixels. */
const LARGEST = 64;
/** The forms that fall from trees; fireflies ride the air. */
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
// A glowing thing's halo in the dark, which the point grows to hold.
uniform float uHalo;
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
  // Each drifting thing has its rank among its form's, so a region holding fewer shows the first of them.
  fade *= clamp((density - aSeed.w) * 12.0, 0.0, 1.0);
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
  gl_PointSize = clamp(uSize * uPixels / max(-mv.z, 0.5) * (1.0 + uHalo * 3.0), ${MIN_PX.toFixed(1)}, ${LARGEST.toFixed(1)});
}
`;

/** A tree near the person that drops leaves or petals: where it stands, how high its crown reaches and how wide, its region and how far its ground has declined. */
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
  /** How far its ground has declined, 0 thriving to 1 (`groundDecline`). */
  readonly decline: number;
}

export interface Drifts {
  readonly object: THREE.Group;
  /**
   * Takes each region of `world` and its drift, by region, as its biome
   * realizes it (`RegionLook.drift`), null where it has none. Forms no region
   * holds draw nothing.
   */
  regions(world: WorldSpec, drifts: readonly (AccentSpec | null)[]): void;
  /**
   * Each frame the person walks: carries the air on the wind and keeps the
   * trees near the eye dropping leaves and petals. `crowns` gives every tree
   * within `reach` meters of (x, z); `focal` is the view's device pixels a
   * radian.
   */
  follow(crowns: (x: number, z: number, reach: number) => readonly Crown[], focal: number): void;
  /** Each form drawn: how full its fullest region holds it, 0 to 1, how many of its things can show, and how many trees drop it now. */
  state(): Record<string, { readonly most: number; readonly drawn: number; readonly trees: number }>;
}

/** How one form's drifting things move and show, as its material reads them. */
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

/** A form's fill round the person, `FILL.samples` a side, empty until first filled. */
function fillTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(FILL.samples * FILL.samples), FILL.samples, FILL.samples, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** One form's drifting things: the material whose uniforms say how they move, and how full each region holds them. */
interface FormPoints {
  readonly points: THREE.Points;
  readonly uniforms: ReturnType<typeof formUniforms>;
  /** Each tree dropping this form, by slot, and the id of the tree in it. */
  readonly slots: (number | null)[];
  /** How much of its things each region holds, 0 to 1, by region: 0 where the region has another drift or none. */
  full: readonly number[];
  spec: AccentSpec;
  /** The grid sample at the middle of its fill's window (`fillAround`), or null until the window is filled. */
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
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    // After the water and the far forms' fading cards (renderOrder 2), which would paint over drifts drawn before them, since drifts write no depth.
    points.renderOrder = 3;
    points.visible = false;
    object.add(points);
    return { points, uniforms, slots: new Array<number | null>(CROWNS).fill(null), full: [], spec, fillAt: null };
  };

  /** Glowing things show by contrast: faint at noon, bright at dusk. */
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
   * Fills the window round (x, z) with how full the form's air is, as a share of its fullest region's: each region's
   * by its share where it lies (`EDGE`).
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
  /** Whether the person at (x, z) has walked far enough from the middle of the form's fill to fill it round them again. */
  const strayed = (f: FormPoints, x: number, z: number): boolean =>
    f.fillAt === null || Math.max(Math.abs(x - f.fillAt[0] * FILL.spacing), Math.abs(z - f.fillAt[1] * FILL.spacing)) > FILL.recenter;

  /**
   * Keeps each slot's tree while it stays within `keep`, so a slot frees only once nothing it dropped is in sight,
   * fills free slots nearest first, and sets how much each tree drops from its region and its ground now.
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
        // A thing ranked past the fullest region's share never shows, so it is not drawn.
        f.points.geometry.setDrawRange(0, Math.min(MOST, Math.ceil(Math.max(...f.full) * MOST) + 1));
        // Every region's drift of one form shares one look: `drift@1` gives each form one color and size.
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
      // The wind carries the air on as the world's clock runs, never while it is held.
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
