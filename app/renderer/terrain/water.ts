// Water surfaces at their solved levels. Streams run downstream along their
// solved flow, ponds lie still with now and then a ring; both mirror the sky
// and the banks, clear and see-through looking down and a mirror at a
// grazing angle, show their bed where they are shallow and deepen in color
// where they are deep. Rings spread from the person's legs as they wade.
// At night the moon lays a sparkling path, the lantern a warm one, and
// living water glows faintly with its vitality.

import * as THREE from "three";
import { LIGHT_GLSL, type SceneLight, hexToVec3 } from "@gaia/render";
import { FLOW, type Terrain, flowAt, streamFlow, surfaceHalfWidth, waterDepthAt } from "@gaia/terrain";
import { GROUND_SAMPLE_GLSL, type GroundTexture } from "./ground.ts";

/** Wading rings alive at once. */
const RINGS = 8;
const RING = {
  /** Seconds a ring lives. */
  life: 2.6,
  /** A ring per step: meters walked between rings, and the shortest gap between them in seconds. */
  stride: 0.6,
  gap: 0.2,
  /** How far apart the legs stand, and how far the rings start ahead of the eyes, meters. */
  legs: 0.13,
  ahead: 0.35,
  /** Water shallower than this makes no rings, meters. */
  shallowest: 0.04,
  /** Seconds over which the water around the legs rises when moving and settles when still. */
  settle: 0.5,
} as const;
/** The mirror is drawn at this share of the canvas's size in CSS pixels: it is blurred anyway. */
const MIRROR_SCALE = 0.5;
/** Seconds over which the mirror's plane settles on a new water level. */
const MIRROR_SETTLE = 0.8;

const WATER_VERT = /* glsl */ `
uniform mat4 uMirrorMatrix;
#ifdef STREAM
attribute vec4 aFlow; // heading x, z; speed, m/s; seconds the water took to get here from the spring
attribute float aAcross; // meters across from the centerline
varying vec4 vFlow;
varying float vAcross;
#endif
varying vec3 vWorld;
varying vec4 vMirror;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
#ifdef STREAM
  vFlow = aFlow;
  vAcross = aAcross;
#endif
  vMirror = uMirrorMatrix * world;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const WATER_FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
${GROUND_SAMPLE_GLSL}
#define RINGS ${RINGS}
uniform sampler2D uMirror;
uniform vec2 uMirrorTexel;
uniform float uMirrorLevel;
uniform float uMirrorOn;
uniform vec3 uClear;
uniform vec3 uDeep;
uniform vec3 uMurk;
uniform vec3 uFoam;
uniform float uVitality;
uniform vec4 uRings[RINGS];
uniform vec2 uRingDrift[RINGS];
uniform vec4 uWader; // where the person stands (x, z), which way they move (x, z) times how hard they push the water
#ifdef STREAM
varying vec4 vFlow;
varying float vAcross;
#endif
varying vec3 vWorld;
varying vec4 vMirror;

const float PACE = ${FLOW.pace.toFixed(2)};

// A hash without sine stays stable at the large coordinates a long walk reaches.
float whash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Value noise and its gradient.
vec3 wnoise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = whash(i);
  float b = whash(i + vec2(1.0, 0.0));
  float c = whash(i + vec2(0.0, 1.0));
  float d = whash(i + vec2(1.0, 1.0));
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * (vec2(b - a, c - a) + k * u.yx));
}

// The surface's slope (x, z), a finer slope that only catches glints, a
// painterly streak along the flow and where it breaks, and where the living
// water's motes are.
struct Surface {
  vec2 slope;
  vec2 fine;
  float streak;
  float dash;
  vec2 motes;
};

#ifdef STREAM
// Every layer is sampled across the stream and along the time the water took
// to arrive, so the pattern runs downstream with the water itself: stretched
// where it runs fast, bunched where it slows, and never sheared.
Surface surface(float near) {
  Surface s;
  vec2 dir = vFlow.xy / max(length(vFlow.xy), 1e-4);
  vec2 side = vec2(-dir.y, dir.x);
  float stretch = PACE / max(vFlow.z, 0.05);
  float along = (vFlow.w - uTime) * PACE;
  // A second layer runs a little ahead, so the surface churns as it flows.
  float churn = (vFlow.w - uTime * 1.35) * PACE;
  vec2 g = vec2(0.0);
  vec3 n = wnoise(vec2(vAcross * 0.5, along * 0.2));
  g += n.yz * vec2(0.5, 0.2 * stretch) * 0.16;
  n = wnoise(vec2(vAcross * 1.4, churn * 0.55) + 11.0);
  g += n.yz * vec2(1.4, 0.55 * stretch) * 0.07 * near;
  n = wnoise(vec2(vAcross * 3.4, along * 1.4) + 29.0);
  g += n.yz * vec2(3.4, 1.4 * stretch) * 0.03 * near;
  n = wnoise(vec2(vAcross * 9.0, churn * 3.6) + 47.0);
  vec2 f = n.yz * vec2(9.0, 3.6 * stretch) * 0.02;
  s.slope = side * g.x + dir * g.y;
  s.fine = side * f.x + dir * f.y;
  s.streak = wnoise(vec2(vAcross * 0.9, along * 0.11) + 5.0).x;
  s.dash = smoothstep(0.58, 0.82, wnoise(vec2(vAcross * 0.7 + 3.0, along * 0.32)).x);
  s.motes = vec2(vAcross, along) * 1.8;
  return s;
}
#else
// A ring now and then, as if something touched the water: each 6 m cell holds
// one ring at a time, at a fresh spot on each of its cycles, on some cycles only.
vec2 pondRings(vec2 p, inout float crest) {
  vec2 g = vec2(0.0);
  vec2 base = floor(p / 6.0 - 0.5);
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 cell = base + vec2(float(i), float(j));
      float h = whash(cell * 1.37 + 3.1);
      float period = 7.0 + h * 9.0;
      float t = uTime + h * period;
      float cycle = floor(t / period);
      float age = t - cycle * period;
      if (whash(cell + cycle * 7.13) > 0.3) continue;
      vec2 c = (cell + 0.25 + 0.5 * vec2(whash(cell + cycle * 3.7 + 1.1), whash(cell + cycle * 5.3 + 2.3))) * 6.0;
      vec2 d = p - c;
      float dist = length(d) + 1e-4;
      float x = dist - age * 0.42;
      float env = exp(-x * x * 14.0) * exp(-age * 0.6) * smoothstep(0.0, 0.4, age);
      g += d / dist * cos(x * 15.0) * env * 0.05;
      crest += env * max(sin(x * 15.0), 0.0);
    }
  }
  return g;
}

// A pond is nearly a mirror: a slow breath of wind and the odd ring.
Surface surface(float near) {
  Surface s;
  vec2 p = vWorld.xz;
  vec2 g = vec2(0.0);
  vec3 n = wnoise(p * 0.3 + uTime * vec2(0.05, 0.02));
  g += n.yz * 0.3 * 0.03;
  n = wnoise(p * 1.1 - uTime * vec2(0.04, 0.07) + 7.0);
  g += n.yz * 1.1 * 0.01 * near;
  n = wnoise(p * 4.0 + uTime * vec2(0.09, -0.05) + 19.0);
  s.slope = g;
  s.fine = n.yz * 4.0 * 0.012;
  s.streak = 0.0;
  s.dash = 0.0;
  s.motes = p * 1.8 + uTime * vec2(0.05, 0.08);
  return s;
}
#endif

// Rings that spread from the person's legs while they wade, drifting with the water.
vec2 wadeRings(vec2 p, inout float crest) {
  vec2 g = vec2(0.0);
  for (int i = 0; i < RINGS; i++) {
    vec4 r = uRings[i];
    float age = uTime - r.z;
    if (age <= 0.0 || age > ${RING.life.toFixed(1)}) continue;
    vec2 d = p - (r.xy + uRingDrift[i] * age);
    float dist = length(d) + 1e-4;
    // Quick at first, slowing as it spreads.
    float x = dist - (0.1 + 1.1 * age - 0.16 * age * age);
    float fade = 1.0 - age / ${RING.life.toFixed(1)};
    float env = exp(-x * x * 22.0) * fade * fade * smoothstep(0.0, 0.12, age) * r.w;
    g += d / dist * cos(x * 20.0) * env * 0.09;
    crest += env * max(sin(x * 20.0), 0.0);
  }
  return g;
}

// Living water: a speck in some cells of a grid, each twinkling at its own pace.
float motes(vec2 p) {
  vec2 cell = floor(p);
  float h = whash(cell + 17.0);
  vec2 c = 0.2 + 0.6 * vec2(h, whash(cell + 41.0));
  float alive = step(0.72, whash(cell + 5.0));
  float twinkle = 0.55 + 0.45 * sin(uTime * (0.7 + h * 1.6) + h * 40.0);
  return smoothstep(0.06, 0.0, length(fract(p) - c)) * twinkle * alive;
}

// While the person moves, the water heaps up around their legs, highest in
// front, and small waves run outward from them.
vec2 bow(vec2 p, inout float crest) {
  float push = length(uWader.zw);
  if (push < 1e-3) return vec2(0.0);
  vec2 d = p - uWader.xy;
  float dist = length(d) + 1e-4;
  float ahead = dot(d / dist, uWader.zw / push);
  float x = dist - (0.34 + 0.2 * max(ahead, 0.0));
  float env = exp(-x * x * 12.0) * (0.35 + 0.45 * max(ahead, 0.0)) * push;
  float wave = x * 22.0 - uTime * 9.0;
  crest += env * max(sin(wave), 0.0);
  return d / dist * cos(wave) * env * 0.08;
}

// The mirror, softened: a few taps around the rippled lookup.
vec3 mirrorAt(vec2 uv) {
  vec2 o = uMirrorTexel * 1.6;
  vec3 c = texture2D(uMirror, uv).rgb * 0.36;
  c += texture2D(uMirror, uv + vec2(o.x, o.y)).rgb * 0.16;
  c += texture2D(uMirror, uv + vec2(-o.x, o.y)).rgb * 0.16;
  c += texture2D(uMirror, uv + vec2(o.x, -o.y)).rgb * 0.16;
  c += texture2D(uMirror, uv + vec2(-o.x, -o.y)).rgb * 0.16;
  return c;
}

// Sunlight focused by the ripples onto a shallow bed: a pattern that tiles every 5 m.
float caustic(vec2 p) {
  vec2 q = mod(p * 1.2566, 6.2832) - 250.0;
  float t = uTime * 0.6;
  vec2 i = q;
  float c = 1.0;
  for (int n = 0; n < 3; n++) {
    float tn = t * (1.0 - 3.5 / float(n + 1));
    i = q + vec2(cos(tn - i.x) + sin(tn + i.y), sin(tn - i.y) + cos(tn + i.x));
    c += 1.0 / length(vec2(q.x / (sin(i.x + tn) * 200.0), q.y / (cos(i.y + tn) * 200.0)));
  }
  c = 1.17 - pow(c / 3.0, 1.4);
  return min(pow(abs(c), 8.0), 1.5);
}

void main() {
  float depth = vWorld.y - groundAt(vWorld.xz).x;
  if (depth <= 0.0) discard;
  vec3 toEye = cameraPosition - vWorld;
  float dist = length(toEye);
  vec3 V = toEye / dist;
  // Fine ripples fade with distance, so far water never shimmers.
  float near = 1.0 - smoothstep(18.0, 110.0, dist);

  float crest = 0.0;
  Surface s = surface(near);
  vec2 slope = s.slope;
#ifndef STREAM
  slope += pondRings(vWorld.xz, crest) * near;
#endif
  slope += wadeRings(vWorld.xz, crest) + bow(vWorld.xz, crest);
  // The thinnest water at the shore barely moves.
  slope *= mix(0.35, 1.0, smoothstep(0.0, 0.3, depth));
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 nf = normalize(vec3(-(slope.x + s.fine.x * near), 1.0, -(slope.y + s.fine.y * near)));
  float cosV = clamp(dot(n, V), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  // At night a faint sheen of the sky stays even looking down, so the water never reads as a hole.
  fresnel = max(fresnel, 0.06 * uNightness);
  vec3 R = reflect(-V, n);
  R.y = abs(R.y);

  // What the water mirrors: the banks, trees and clouds drawn from below its
  // level, softened and rippled; the sky alone where this water lies far from
  // the mirror's plane.
  vec2 uv = vMirror.xy / vMirror.w + slope * (0.015 + 0.9 / max(dist, 1.0));
  float onPlane = uMirrorOn * (1.0 - smoothstep(0.45, 1.4, abs(vWorld.y - uMirrorLevel)));
  vec3 mirror = mix(skyColor(R), mirrorAt(uv), onPlane);

  // Light through the water: the bed shows where it is shallow and clear;
  // deeper, the water's own color fills in. Decline clouds the water.
  float cosR = sqrt(1.0 - (1.0 - cosV * cosV) / 1.78);
  float path = depth / max(cosR, 0.25);
  float through = exp(-path * mix(2.8, 0.85, uVitality));
  vec3 tint = mix(uClear, uDeep, smoothstep(0.15, 1.5, depth));
  tint = mix(uMurk, tint, smoothstep(0.15, 0.85, uVitality));
  float sunLit = max(uSunDirection.y, 0.0) * sunUp();
  vec3 inLight = uSunColor * uSunIntensity * (0.2 + 0.5 * sunLit) * sunUp() + uAmbientColor * uAmbientIntensity * 0.9;
  vec3 body = nightTone(tint) * inLight * 0.8 + moonLight(tint, vec3(0.0, 1.0, 0.0), 0.6, 1.0) * 0.7;
  // The lantern's warmth reaches into the water near it.
  body += lanternLight(tint + 0.15, n, vWorld, 0.7) * 0.55;
  // Ripples tilted toward the sun read lighter, tilted away darker: painted light that flows.
  body *= 1.0 + clamp(-dot(slope, uSunDirection.xz) * 2.0, -0.1, 0.1) * sunUp();
  vec3 under = body * (1.0 - through);
  // Sunlight dances on a clear, shallow bed.
  vec3 refr = refract(-V, n, 0.75);
  vec2 bed = vWorld.xz + refr.xz / max(-refr.y, 0.3) * depth;
  under += uSunColor * vec3(1.0, 0.96, 0.82) * caustic(bed) * through * sunLit * uSunIntensity * 0.3 * uVitality * smoothstep(0.02, 0.15, depth);

  // Premultiplied: the mirror covers fresnel of the view; what remains looks
  // into the water, which lets its bed through.
  vec3 color = mirror * fresnel + under * (1.0 - fresnel);
  float alpha = 1.0 - (1.0 - fresnel) * through;

  // Painterly streaks of light run along the current.
  float streak = (1.0 - smoothstep(0.0, 0.03, abs(s.streak - 0.5))) * s.dash * near * smoothstep(3.0, 9.0, dist);
  color += (mirror * 0.35 + inLight * 0.12) * streak * 0.18;
  // Crests of the rings catch the light.
  color += (inLight * 0.35 + mirror * 0.25 + uLanternColor * uLanternIntensity * lanternReach(vWorld) * 0.4) * min(crest, 1.0) * 0.26;

  // Sun glints sparkle on the fine ripples; the moon lays a path of them;
  // the lantern scatters warm ones close by.
  vec3 Rf = reflect(-V, nf);
  float sunGlint = pow(max(dot(Rf, uSunDirection), 0.0), 900.0) * 2.4 + pow(max(dot(R, uSunDirection), 0.0), 140.0) * 0.2;
  color += uSunColor * sunGlint * min(uSunIntensity, 1.2) * sunUp() * mix(0.3, 1.0, uVitality);
  float moonUp = smoothstep(-0.02, 0.1, uMoonDirection.y);
  float moonGlint = pow(max(dot(Rf, uMoonDirection), 0.0), 380.0) * 2.2 + pow(max(dot(R, uMoonDirection), 0.0), 36.0) * 0.22;
  color += uMoonColor * moonGlint * uMoonIntensity * moonUp;
  vec3 toLantern = uLanternPosition - vWorld;
  float lanternDist = length(toLantern);
  vec3 L = toLantern / max(lanternDist, 1e-3);
  float lanternGlint = pow(max(dot(Rf, L), 0.0), 500.0) * 1.2 + pow(max(dot(R, L), 0.0), 40.0) * 0.05;
  color += uLanternColor * uLanternIntensity * lanternGlint / (1.0 + lanternDist * lanternDist * 0.05);

  // Living water: faint motes drift with it and glow in the dark, as alive as its vitality.
  color += vec3(0.3, 0.8, 0.72) * motes(s.motes) * near * uNightness * uVitality * 0.5 * smoothstep(0.1, 0.5, depth) * (1.0 - fresnel);

  // Foam laps at the shore: a soft broken line, flowing with a stream and
  // breathing in and out on a pond.
#ifdef STREAM
  float lap = (wnoise(vec2(vAcross * 2.0, (vFlow.w - uTime) * PACE * 1.2)).x - 0.5) * 0.08;
#else
  float lap = 0.025 * sin(uTime * 0.8 + dot(vWorld.xz, vec2(0.21, 0.13))) + (wnoise(vWorld.xz * 1.5).x - 0.5) * 0.06;
#endif
  float foam = (1.0 - smoothstep(0.0, 0.085, depth + lap)) * 0.34 * mix(0.55, 1.0, uVitality) * smoothstep(0.0, 0.015, depth);
  vec3 foamLit = nightTone(uFoam) * inLight + moonLight(uFoam, vec3(0.0, 1.0, 0.0), 0.5, 1.0) + lanternLight(uFoam, vec3(0.0, 1.0, 0.0), vWorld, 0.5);
  color = color * (1.0 - foam) + foamLit * foam;
  alpha = alpha * (1.0 - foam) + foam;

  // The edge of the water softens into the shore, over more of it where the
  // shore is seen at a grazing angle, so the lattice never shows in the waterline.
  float edge = smoothstep(0.0, max(0.02, fwidth(depth) * 3.0), depth);
  color *= edge;
  alpha *= edge;

  // Aerial perspective is affine in color, so it applies to premultiplied
  // light as offset plus scale: the air covers only the water's own share.
  vec3 air = aerial(vec3(0.0), vWorld);
  vec3 keep = aerial(vec3(1.0), vWorld) - air;
  gl_FragColor = vec4(shoulder(color) * keep + air * alpha, alpha);
}
`;

export interface Water {
  readonly group: THREE.Group;
  update(t: Terrain): void;
  /**
   * Draws what the water mirrors: `scene` seen from below the nearest water's
   * level, without `hide` and with `show` drawn instead. Skipped when no water
   * is in view. Returns the draw calls it made.
   */
  mirror(renderer: THREE.WebGLRenderer, scene: THREE.Scene, view: THREE.PerspectiveCamera, hide: readonly THREE.Object3D[], show: readonly THREE.Object3D[], dt: number): number;
  /** Rings spread from the person's legs when they move through water: where they stand, which way they face, how far they moved. */
  wade(x: number, z: number, yaw: number, walked: number, dt: number): void;
  /** How alive the water is, 0 to 1: clear and glowing, or clouded and dull. */
  vitality(v: number): void;
  stats(): { mirrorCalls: number; mirrorLevel: number; mirrored: boolean; moon: number[] };
}

interface Ribbon {
  readonly positions: Float32Array;
  readonly flow: Float32Array;
  readonly across: Float32Array;
  readonly index: number[];
}

/** Past each end the surface runs on this far, so it covers the channel's rounded end; the bank clips it. */
const RUN_ON = 3.5;

function ribbon(stream: Terrain["streams"][number]): Ribbon {
  const st = stream.stations;
  const velocity = streamFlow(stream);
  const n = st.length;
  const count = n + 2;
  const positions = new Float32Array(count * 2 * 3);
  const flow = new Float32Array(count * 2 * 4);
  const across = new Float32Array(count * 2);
  const index: number[] = [];
  // Seconds the water took to reach each station from the spring.
  const arrival = new Float64Array(n);
  const speed = (i: number): number => Math.hypot(velocity[i * 2] as number, velocity[i * 2 + 1] as number) || FLOW.slowest;
  for (let i = 1; i < n; i++) {
    const a = st[i - 1]!;
    const b = st[i]!;
    arrival[i] = (arrival[i - 1] as number) + Math.hypot(b.x - a.x, b.z - a.z) / ((speed(i - 1) + speed(i)) / 2);
  }
  const put = (k: number, x: number, z: number, level: number, half: number, i: number, time: number): void => {
    const a = st[Math.max(0, i - 1)]!;
    const b = st[Math.min(n - 1, i + 1)]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    const v = speed(i);
    for (const [j, sign] of [[0, -1], [1, 1]] as const) {
      const vi = k * 2 + j;
      positions.set([x + nx * half * sign, level, z + nz * half * sign], vi * 3);
      flow.set([(velocity[i * 2] as number) / v, (velocity[i * 2 + 1] as number) / v, v, time], vi * 4);
      across[vi] = half * sign;
    }
  };
  // The run-on past the spring, every station, and the run-on past the mouth.
  const first = st[0]!;
  const second = st[Math.min(1, n - 1)]!;
  const last = st[n - 1]!;
  const before = st[Math.max(0, n - 2)]!;
  const lead = Math.hypot(second.x - first.x, second.z - first.z) || 1;
  const tail = Math.hypot(last.x - before.x, last.z - before.z) || 1;
  put(0, first.x - ((second.x - first.x) / lead) * RUN_ON, first.z - ((second.z - first.z) / lead) * RUN_ON, first.level, surfaceHalfWidth(first), 0, -RUN_ON / speed(0));
  st.forEach((s, i) => put(i + 1, s.x, s.z, s.level, surfaceHalfWidth(s), i, arrival[i] as number));
  put(n + 1, last.x + ((last.x - before.x) / tail) * RUN_ON, last.z + ((last.z - before.z) / tail) * RUN_ON, last.level, surfaceHalfWidth(last), n - 1, (arrival[n - 1] as number) + RUN_ON / speed(n - 1));
  for (let k = 0; k + 1 < count; k++) index.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3);
  return { positions, flow, across, index };
}

function streamGeometry(stream: Terrain["streams"][number]): THREE.BufferGeometry {
  const r = ribbon(stream);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(r.positions, 3));
  g.setAttribute("aFlow", new THREE.BufferAttribute(r.flow, 4));
  g.setAttribute("aAcross", new THREE.BufferAttribute(r.across, 1));
  g.setIndex(r.index);
  g.computeBoundingSphere();
  return g;
}

function disc(x: number, z: number, radius: number, level: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(radius, 72);
  g.rotateX(-Math.PI / 2);
  g.translate(x, level, z);
  return g;
}

/** The level of the water nearest to a point. */
function nearestLevel(t: Terrain, x: number, z: number): number | null {
  let best = Infinity;
  let level: number | null = null;
  for (const stream of t.streams) {
    for (const s of stream.stations) {
      const d = Math.hypot(x - s.x, z - s.z) - surfaceHalfWidth(s);
      if (d < best) {
        best = d;
        level = s.level;
      }
    }
  }
  for (const p of t.ponds) {
    const d = Math.hypot(x - p.x, z - p.z) - p.reach;
    if (d < best) {
      best = d;
      level = p.level;
    }
  }
  return level;
}

/** The planar mirror: the scene drawn from a camera reflected through the water's plane, clipped at it. */
function createMirror() {
  const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, generateMipmaps: false });
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  const camera = new THREE.PerspectiveCamera();
  const matrix = new THREE.Matrix4();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const size = new THREE.Vector2();
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  const up = new THREE.Vector3();
  const rotation = new THREE.Matrix4();
  const plane = new THREE.Plane();
  const clip = new THREE.Vector4();
  const q = new THREE.Vector4();
  const texel = new THREE.Vector2(1, 1);

  return {
    texture: target.texture,
    matrix,
    texel,
    render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, view: THREE.PerspectiveCamera, level: number): void {
      renderer.getSize(size);
      const w = Math.max(16, Math.round(size.x * MIRROR_SCALE));
      const h = Math.max(16, Math.round(size.y * MIRROR_SCALE));
      if (target.width !== w || target.height !== h) target.setSize(w, h);
      texel.set(1 / w, 1 / h);

      // The camera reflected through the plane y = level.
      view.updateMatrixWorld();
      eye.setFromMatrixPosition(view.matrixWorld);
      rotation.extractRotation(view.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(rotation).add(eye);
      up.set(0, 1, 0).applyMatrix4(rotation);
      camera.position.set(eye.x, 2 * level - eye.y, eye.z);
      camera.up.set(up.x, -up.y, up.z);
      camera.lookAt(look.x, 2 * level - look.y, look.z);
      camera.near = view.near;
      camera.far = view.far;
      camera.updateMatrixWorld();
      camera.projectionMatrix.copy(view.projectionMatrix);
      camera.projectionMatrixInverse.copy(view.projectionMatrixInverse);
      matrix.copy(bias).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);

      // An oblique near plane at the water, so nothing beneath it is mirrored.
      plane.normal.set(0, 1, 0);
      plane.constant = -level;
      plane.applyMatrix4(camera.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const e = camera.projectionMatrix.elements;
      q.set((Math.sign(clip.x) + (e[8] as number)) / (e[0] as number), (Math.sign(clip.y) + (e[9] as number)) / (e[5] as number), -1, (1 + (e[10] as number)) / (e[14] as number));
      clip.multiplyScalar(2 / clip.dot(q));
      e[2] = clip.x;
      e[6] = clip.y;
      e[10] = clip.z + 1;
      e[14] = clip.w;

      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
    },
  };
}

export function createWater(t: Terrain, light: SceneLight, ground: GroundTexture): Water {
  let terrain = t;
  const mirror = createMirror();
  const rings = new Float32Array(RINGS * 4).fill(-1000);
  const drift = new Float32Array(RINGS * 2);
  const uniforms = {
    ...light,
    ...ground.uniforms,
    uMirror: { value: mirror.texture },
    uMirrorMatrix: { value: mirror.matrix },
    uMirrorTexel: { value: mirror.texel },
    uMirrorLevel: { value: 0 },
    uMirrorOn: { value: 0 },
    uClear: { value: hexToVec3(0x4fa89a) },
    uDeep: { value: hexToVec3(0x1f5e7e) },
    uMurk: { value: hexToVec3(0x7c7a52) },
    uFoam: { value: hexToVec3(0xf2f4ee) },
    uVitality: { value: 1 },
    uRings: { value: rings },
    uRingDrift: { value: drift },
    uWader: { value: new THREE.Vector4() },
  };
  const make = (defines: Record<string, string>): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms,
      defines,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  const streamMaterial = make({ STREAM: "" });
  const pondMaterial = make({});

  const group = new THREE.Group();
  const update = (next: Terrain): void => {
    terrain = next;
    for (const child of [...group.children]) {
      (child as THREE.Mesh).geometry.dispose();
      group.remove(child);
    }
    for (const s of next.streams) group.add(new THREE.Mesh(streamGeometry(s), streamMaterial));
    for (const p of next.ponds) group.add(new THREE.Mesh(disc(p.x, p.z, p.reach, p.level), pondMaterial));
    for (const m of group.children) m.renderOrder = 2;
    level = Number.NaN;
  };

  // The mirror's plane follows the nearest water's level, settling smoothly.
  let level = Number.NaN;
  let mirrorCalls = 0;
  let mirrored = false;
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const hidden: boolean[] = [];
  const shown: boolean[] = [];
  const inView = (view: THREE.Camera): boolean => {
    viewProjection.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    for (const m of group.children) if (frustum.intersectsObject(m)) return true;
    return false;
  };

  // Wading: a ring per step, from alternate legs.
  let next = 0;
  let sinceRing = Infinity;
  let walkedSince = 0;
  let push = 0;

  update(t);
  return {
    group,
    update,
    mirror(renderer, scene, view, hide, show, dt) {
      view.updateMatrixWorld();
      mirrored = group.children.length > 0 && inView(view);
      uniforms.uMirrorOn.value = mirrored ? 1 : 0;
      mirrorCalls = 0;
      if (!mirrored) return 0;
      const target = nearestLevel(terrain, view.position.x, view.position.z);
      if (target === null) return 0;
      level = Number.isNaN(level) || Math.abs(target - level) > 3 ? target : level + (target - level) * (1 - Math.exp(-dt / MIRROR_SETTLE));
      uniforms.uMirrorLevel.value = level;
      for (let i = 0; i < hide.length; i++) {
        const o = hide[i] as THREE.Object3D;
        hidden[i] = o.visible;
        o.visible = false;
      }
      for (let i = 0; i < show.length; i++) {
        const o = show[i] as THREE.Object3D;
        shown[i] = o.visible;
        o.visible = true;
      }
      const water = group.visible;
      group.visible = false;
      mirror.render(renderer, scene, view, level);
      mirrorCalls = renderer.info.render.calls;
      group.visible = water;
      for (let i = 0; i < hide.length; i++) (hide[i] as THREE.Object3D).visible = hidden[i] ?? true;
      for (let i = 0; i < show.length; i++) (show[i] as THREE.Object3D).visible = shown[i] ?? false;
      return mirrorCalls;
    },
    wade(x, z, yaw, walked, dt) {
      sinceRing += dt;
      walkedSince += walked;
      const depth = waterDepthAt(terrain, x, z);
      const moving = dt > 0 && walked / dt > 0.3;
      const pushing = depth >= RING.shallowest && moving ? Math.min(1, depth / 0.25) * Math.min(1, walked / dt / 2.5) : 0;
      push += (pushing - push) * (1 - Math.exp(-dt / RING.settle));
      uniforms.uWader.value.set(x, z, -Math.sin(yaw) * push, -Math.cos(yaw) * push);
      if (depth < RING.shallowest || !moving) {
        walkedSince = RING.stride;
        return;
      }
      if (walkedSince < RING.stride || sinceRing < RING.gap) return;
      walkedSince = 0;
      sinceRing = 0;
      const slot = next % RINGS;
      const leg = next % 2 === 0 ? 1 : -1;
      next++;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const cx = x + fx * RING.ahead - fz * RING.legs * leg;
      const cz = z + fz * RING.ahead + fx * RING.legs * leg;
      const v = flowAt(terrain, cx, cz);
      const speed = walked / dt;
      rings.set([cx, cz, light.uTime.value, Math.min(1, depth / 0.25) * Math.min(1, 0.4 + speed / 4)], slot * 4);
      drift.set([v.x, v.z], slot * 2);
    },
    vitality(v) {
      uniforms.uVitality.value = Math.max(0, Math.min(1, v));
    },
    stats: () => ({ mirrorCalls, mirrorLevel: level, mirrored, moon: light.uMoonDirection.value.toArray() }),
  };
}
