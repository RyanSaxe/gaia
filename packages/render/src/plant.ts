// A realized plant as Three.js meshes. One ShaderMaterial per part applies
// the vitality channels on the GPU, so vitality is a uniform and changing it
// never rebuilds geometry.

import * as THREE from "three";
import type { Part, Swatch } from "@gaia/schema";
import { CHANNEL_MATH, type Realized, spinAt } from "@gaia/realize";
import { LIGHT_GLSL, type SceneLight } from "./light.ts";
import { createSmokeMaterial } from "./smoke.ts";

const f = (x: number): string => x.toFixed(4);

const CHANNELS_GLSL = /* glsl */ `
attribute float aShade;
attribute float aTint;
attribute float aLoss;
attribute float aDroop;
attribute float aWither;
attribute float aGlow;
attribute vec3 aPivot;
attribute float aClose;
uniform float uVitality;
uniform float uNightness;
uniform float uSway;
uniform float uFrequency;
uniform float uHeight;
uniform float uFlutter;
uniform float uWind;

#ifdef RUIN
// A building's pieces also fall, grow and turn. These attributes exist only
// on parts that use them, so instanced plants never spend slots on them.
attribute vec4 aFall;
attribute float aGrow;
attribute float aRot;
attribute vec3 aSpin;
uniform float uTurn;

mat3 turnAbout(vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  vec3 t = (1.0 - c) * k;
  return mat3(
    t.x * k.x + c, t.x * k.y + s * k.z, t.x * k.z - s * k.y,
    t.y * k.x - s * k.z, t.y * k.y + c, t.y * k.z + s * k.x,
    t.z * k.x + s * k.y, t.z * k.y - s * k.x, t.z * k.z + c);
}

// A spinning piece turns about its pivot by the plant's accumulated turn;
// a falling piece then tips about the same pivot as vitality drops.
mat3 pieceTurn() {
  mat3 m = mat3(1.0);
  float rate = length(aSpin);
  if (rate > 0.0) m = turnAbout(aSpin / rate, uTurn * rate * 6.28318530718);
  float most = length(aFall.xyz);
  if (aFall.w > 0.0 && most > 0.0) {
    float fallen = 1.0 - smoothstep(aFall.w - ${f(CHANNEL_MATH.fallBand)}, aFall.w, uVitality);
    m = turnAbout(aFall.xyz / most, most * fallen) * m;
  }
  return m;
}
vec3 turnedNormal(vec3 n) { return pieceTurn() * n; }
// How far this surface has rotted through, for the fragment shader's holes.
float rotNow() { return aRot * ${f(CHANNEL_MATH.rotMost)} * clamp(1.0 - uVitality / ${f(CHANNEL_MATH.rotStart)}, 0.0, 1.0); }
#else
vec3 turnedNormal(vec3 n) { return n; }
#endif

// Loss collapses a piece to its pivot over a short band; droop bends the
// offset from the pivot toward the ground, keeping its length. At night a
// piece that closes (a flower's petals) folds part way toward its pivot.
vec3 applyChannels(vec3 p) {
  vec3 off = (p - aPivot) * (1.0 - aClose * uNightness * 0.7);
  float s = aDroop * (1.0 - uVitality);
  float d = length(off);
  if (s > 0.0 && d > 1e-5) {
    vec3 bent = off;
    bent.y -= s * d * ${f(CHANNEL_MATH.sag)};
    off = normalize(bent) * d;
  }
  float keep = aLoss > 0.0 ? smoothstep(aLoss, aLoss + ${f(CHANNEL_MATH.lossBand)}, uVitality) : 1.0;
#ifdef RUIN
  keep *= aGrow > 0.0 ? 1.0 - smoothstep(aGrow, aGrow + ${f(CHANNEL_MATH.lossBand)}, uVitality) : 1.0;
  return aPivot + pieceTurn() * (off * keep);
#else
  return aPivot + off * keep;
#endif
}

// The one wind field (v2's windAt), with the plant's response on top.
float windAt(vec2 p, float t) {
  return sin(t * 1.35 + p.x * 0.21 + p.y * 0.17) + 0.35 * sin(t * 2.9 + p.y * 0.43);
}

vec3 applyWind(vec3 p, vec3 root) {
  float t = uTime * (0.35 + uFrequency);
  float h = clamp(p.y / uHeight, 0.0, 1.4);
  float w = windAt(root.xz + p.xz * 0.08, t);
  vec3 lean = vec3(w, 0.0, w * 0.55) * uSway * uWind * 0.22 * h * h;
  float reach = min(length(p - aPivot), 2.5);
  float flutter = sin(t * 3.1 + dot(aPivot, vec3(1.7, 2.3, 1.3))) * uFlutter * uSway * uWind * 0.05 * reach;
  return p + lean + vec3(flutter, 0.0, flutter * 0.6);
}
`;

// Leaf cards: each card is cut to its leaves by a procedural mask, so a
// canopy has leafy edges with no texture. Values are signed, about a leaf's
// width: positive inside. As a card shrinks on screen its leaves merge into
// the card's plain outline, so distant canopies stay soft painted masses
// instead of sparkling. CUT in @gaia/schema names the cuts.
const CUTOUT_GLSL = /* glsl */ `
attribute vec3 aCutout;
varying vec3 vCut;
`;

// Rot: a surface rots through into ragged holes as vitality falls. The
// holes follow a noise fixed to the piece's own rest position, so they
// never crawl, and both faces of a roof open at the same spots.
const ROT_GLSL = /* glsl */ `
#ifdef RUIN
varying float vRot;
varying vec3 vRest;
float rotHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float rotValue(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(rotHash(i), rotHash(i + vec3(1, 0, 0)), u.x), mix(rotHash(i + vec3(0, 1, 0)), rotHash(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(rotHash(i + vec3(0, 0, 1)), rotHash(i + vec3(1, 0, 1)), u.x), mix(rotHash(i + vec3(0, 1, 1)), rotHash(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
// Distance above the hole's edge: negative inside a hole.
float rotEdge() {
  if (vRot <= 0.0) return 1.0;
  float n = rotValue(vRest * 1.1) * 0.65 + rotValue(vRest * 3.3 + 7.0) * 0.35;
  return n - vRot;
}
#else
float rotEdge() { return 1.0; }
#endif
`;

const LEAF_MASK_GLSL = /* glsl */ `
${ROT_GLSL}
varying vec3 vCut;
float leafHash(float x) { return fract(sin(x * 91.3458) * 47453.5453); }

// A pointed leaf from the origin along +x, \`len\` long and \`wide\` at its widest.
float leafShape(vec2 q, float len, float wide) {
  float t = clamp(q.x / len, 0.0, 1.0);
  float profile = wide * pow(sin(3.14159 * pow(t, 0.8)), 0.7);
  return min(profile - abs(q.y), min(q.x, len - q.x) * 0.6);
}

// Broad leaves fanned around the card's middle.
float clusterCut(vec2 p, float seed, float far) {
  // Far away, the cluster is a soft scalloped round.
  float outline = 0.78 + 0.08 * cos(atan(p.y, p.x) * 7.0 + seed * 6.2832) - length(p);
  if (far > 0.999) return outline;
  float d = 0.16 - length(p);
  for (int k = 0; k < 7; k++) {
    float fk = float(k);
    float a = seed * 6.2832 + fk * 0.8976 + (leafHash(seed * 13.1 + fk) - 0.5) * 0.6;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 q = vec2(dot(p, dir), dot(p, vec2(-dir.y, dir.x)));
    float len = 0.68 + 0.3 * leafHash(seed * 7.3 + fk * 3.1);
    d = max(d, leafShape(q, len, 0.2 + 0.06 * leafHash(seed * 3.7 + fk)));
  }
  return mix(d, outline, far);
}

// Small lance leaves hanging from a stem, alternating sides.
float strandCut(vec2 p, float seed, float far) {
  if (far > 0.999) return 0.55 - abs(p.x);
  float d = 0.05 - abs(p.x);
  float cell = 0.42;
  float i0 = floor(p.y / cell);
  for (int k = -2; k <= 0; k++) {
    float i = i0 + float(k);
    float side = mod(i, 2.0) < 1.0 ? 1.0 : -1.0;
    float h = leafHash(i * 1.37 + seed * 17.0);
    vec2 dir = normalize(vec2(side * (0.55 + 0.35 * h), 1.0));
    vec2 q = p - vec2(0.0, i * cell);
    q = vec2(dot(q, dir), dot(q, vec2(-dir.y, dir.x)));
    d = max(d, leafShape(q, 0.95 + 0.2 * h, 0.2));
  }
  return mix(d, 0.55 - abs(p.x), far);
}

// A needle spray: solid along the limb, combed into needles toward a jagged
// fringe, tapering to the tip.
float needleCut(vec2 p, float seed, float far) {
  float v = clamp(p.y, 0.0, 1.0);
  float edge = (1.0 - pow(v, 2.2)) * (0.8 + 0.2 * smoothstep(0.0, 0.25, v)) + 0.06;
  float u = abs(p.x) / edge;
  float plain = min((0.84 - u) * edge, min(p.y + 0.02, 1.0 - p.y));
  if (far > 0.999) return plain;
  // Needles sweep toward the tip; each reaches a slightly different length.
  float row = p.y * 15.0 - u * 1.3 + seed * 5.0;
  float comb = fract(row);
  float reach = 0.88 + 0.12 * leafHash(floor(row) + seed * 31.0);
  float needle = (0.3 - abs(comb - 0.5)) * 0.35;
  float body = (reach - u) * edge;
  float d = u < 0.62 ? body : min(body, needle);
  d = min(d, min(p.y + 0.02, 1.02 - p.y));
  return mix(d, plain, far);
}

// The card's leaves at this fragment: x is coverage, y a brightness that
// darkens each leaf's rim a little, so overlapping leaves read apart up close.
// Solid surfaces are (1, 1).
vec2 leafCut() {
  float form = floor(vCut.z + 0.5 / 1024.0);
  if (form < 0.5) return vec2(1.0);
  float seed = fract(vCut.z);
  vec2 p = vCut.xy;
#ifdef SHADOW_PASS
  // Shadows are too soft to show single leaves: cards cast their outline.
  float far = 1.0;
#else
  float far = smoothstep(0.05, 0.16, length(fwidth(p)));
#endif
  float d = form < 1.5 ? clusterCut(p, seed, far) : form < 2.5 ? strandCut(p, seed, far) : needleCut(p, seed, far);
  float rim = 0.86 + 0.14 * smoothstep(0.0, 0.07, d);
  if (form > 2.5) rim *= 0.9 + 0.1 * smoothstep(0.15, 0.45, abs(fract(p.y * 15.0 - abs(p.x) * 1.3 + seed * 5.0) - 0.5));
  return vec2(clamp(d / max(fwidth(d), 1e-4) + 0.5, 0.0, 1.0), mix(rim, 1.0, far));
}
`;

export const PLANT_VERT = /* glsl */ `
uniform float uTime;
${CHANNELS_GLSL}
${CUTOUT_GLSL}
#ifdef RUIN
varying float vRot;
varying vec3 vRest;
#endif
varying vec3 vNormal;
varying vec3 vWorld;
varying float vShade;
varying float vTint;
varying float vWither;
varying float vGlow;
void main() {
  vec3 root = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 p = applyWind(applyChannels(position), root);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * turnedNormal(normal));
#ifdef RUIN
  vRot = rotNow();
  vRest = position;
#endif
  vShade = aShade;
  vTint = aTint;
  vCut = aCutout;
  vWither = aWither * (1.0 - uVitality);
  vGlow = aGlow * uVitality * ${f(CHANNEL_MATH.glowStrength)} * (0.85 + 0.15 * sin(uTime * 1.3 + aPivot.x * 3.0 + aPivot.z * 2.0));
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const PLANT_FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
${LEAF_MASK_GLSL}
// Same YIQ rotation as hueRotate in @gaia/realize.
vec3 hueRotate(vec3 c, float turns) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float a = turns * 6.28318530718;
  float i2 = i * cos(a) - q * sin(a);
  float q2 = i * sin(a) + q * cos(a);
  return clamp(vec3(y + 0.956 * i2 + 0.621 * q2, y - 0.272 * i2 - 0.647 * q2, y - 1.106 * i2 + 1.703 * q2), 0.0, 1.0);
}
uniform vec3 uHealthy;
uniform vec3 uDecline;
uniform float uFoliage;
uniform float uLamp;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vShade;
varying float vTint;
varying float vWither;
varying float vGlow;
void main() {
  vec2 cut = leafCut();
  float cover = cut.x;
  // A card seen edge-on would show as a sliver: it fades out as it turns away.
  if (vCut.z > 0.5) {
    vec3 face = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    cover *= smoothstep(0.06, 0.28, abs(dot(face, normalize(cameraPosition - vWorld))));
  }
  if (cover < 0.02) discard;
  // A rotted hole is cut cleanly; its rim darkens like a broken, weathered edge.
  float edge = rotEdge();
  if (edge < 0.0) discard;
  float bright = mix(${f(CHANNEL_MATH.shadeLow)}, ${f(CHANNEL_MATH.shadeHigh)}, vShade) * cut.y * mix(0.45, 1.0, smoothstep(0.0, 0.09, edge));
  vec3 albedo = mix(hueRotate(uHealthy, vTint), uDecline, vWither) * bright;
  vec3 n = normalize(vNormal);
  if (uFoliage < 0.5 && !gl_FrontFacing) n = -n;
  // Window glass is a dark pane holding a little sky by day; from dusk the
  // lamp inside lights it, and its healthy color is the lamplight.
  float evening = smoothstep(0.08, 0.55, uNightness) * uLamp;
  if (uLamp > 0.5) albedo = mix(uDecline * 0.75 + skyColor(reflect(-normalize(cameraPosition - vWorld), n)) * 0.2, uDecline * 0.45, evening);
  // Foliage gets wrapped diffuse: leaves scatter light, so canopies never
  // fall into hard dark sides.
  float nDotL = dot(n, uSunDirection);
  float wrapped = mix(max(nDotL, 0.0), nDotL * 0.5 + 0.5, uFoliage * 0.85);
  float shadow = mix(0.4 + uFoliage * 0.15, 1.0, sunShadow(vWorld, 0.0025 + uFoliage * 0.007));
  float light = softCel(wrapped * shadow) * sunUp();
  vec3 toned = nightTone(albedo);
  vec3 lit = toned * (uSunColor * uSunIntensity * light + uAmbientColor * uAmbientIntensity);
  vec3 shadowed = toned * uShadowColor * (uAmbientIntensity + 0.75);
  vec3 color = mix(shadowed, lit, clamp(light + 0.35 + uFoliage * 0.12, 0.0, 1.0));
  // Backlit leaves glow warm, faintly.
  vec3 toEye = normalize(cameraPosition - vWorld);
  float back = pow(clamp(dot(-toEye, uSunDirection), 0.0, 1.0), 4.0) * uFoliage * 0.22 * shadow * min(uSunIntensity, 1.0);
  color += albedo * uSunColor * back;
  // Leaves between the eye and the moon catch a faint silver rim.
  float moonBack = pow(clamp(dot(-toEye, uMoonDirection), 0.0, 1.0), 3.0) * uFoliage * 0.5 * uMoonIntensity;
  color += nightTone(albedo) * uMoonColor * moonBack;
  color += nightLight(albedo, n, vWorld, uFoliage * 0.85, mix(1.0, shadow, uMoonShadow));
  // The world's own glow shows by contrast: a touch stronger in the dark,
  // and it carries through the night air a little farther than lit color.
  vec3 glow = uHealthy * vGlow * (1.0 + uNightness * 0.6) * mix(1.0, evening * 1.5, uLamp);
  gl_FragColor = vec4(aerial(shoulder(color), vWorld) + glow * (1.0 - uNightness * 0.35), cover);
}
`;

export const DEPTH_VERT = /* glsl */ `
uniform float uTime;
${CHANNELS_GLSL}
${CUTOUT_GLSL}
#ifdef RUIN
varying float vRot;
varying vec3 vRest;
#endif
void main() {
  vCut = aCutout;
#ifdef RUIN
  vRot = rotNow();
  vRest = position;
#endif
  vec3 root = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 p = applyWind(applyChannels(position), root);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
}
`;

// Leaf cards cast scalloped shadows: the sun shines through between them.
export const DEPTH_FRAG = /* glsl */ `
precision highp float;
#define SHADOW_PASS
${LEAF_MASK_GLSL}
void main() {
  if (leafCut().x < 0.5 || rotEdge() < 0.0) discard;
  gl_FragColor = vec4(1.0);
}
`;

export interface PlantView {
  readonly object: THREE.Group;
  /** Height of the plant's bounds, for wind and camera framing. */
  readonly height: number;
  /** Horizontal radius of the plant's bounds. */
  readonly radius: number;
  readonly triangles: number;
  /** The vitality the shader shows now. */
  readonly vitality: number;
  setVitality(v: number): void;
  /** Swaps every mesh to its depth material for the shadow pass, and back. */
  useDepth(on: boolean): void;
  dispose(): void;
}

const vec3Of = (c: readonly number[]): THREE.Vector3 => new THREE.Vector3(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);

/** A part whose pieces fall, grow, rot or spin, which its material compiles in. */
const hasRuin = (part: Part): boolean => {
  const c = part.channels;
  return c.fall !== undefined || c.grow !== undefined || c.rot !== undefined || c.spin !== undefined;
};

export function geometryOf(part: Part): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(part.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(part.normals, 3));
  g.setAttribute("aShade", new THREE.BufferAttribute(part.shade, 1));
  g.setAttribute("aTint", new THREE.BufferAttribute(part.tint, 1));
  g.setAttribute("aCutout", new THREE.BufferAttribute(part.cutout, 3));
  g.setAttribute("aLoss", new THREE.BufferAttribute(part.channels.loss, 1));
  g.setAttribute("aDroop", new THREE.BufferAttribute(part.channels.droop, 1));
  g.setAttribute("aWither", new THREE.BufferAttribute(part.channels.wither, 1));
  g.setAttribute("aGlow", new THREE.BufferAttribute(part.channels.glow, 1));
  g.setAttribute("aPivot", new THREE.BufferAttribute(part.channels.pivot, 3));
  g.setAttribute("aClose", new THREE.BufferAttribute(part.channels.close, 1));
  if (hasRuin(part)) {
    const n = part.shade.length;
    const c = part.channels;
    g.setAttribute("aFall", new THREE.BufferAttribute(c.fall ?? new Float32Array(n * 4), 4));
    g.setAttribute("aGrow", new THREE.BufferAttribute(c.grow ?? new Float32Array(n), 1));
    g.setAttribute("aRot", new THREE.BufferAttribute(c.rot ?? new Float32Array(n), 1));
    g.setAttribute("aSpin", new THREE.BufferAttribute(c.spin ?? new Float32Array(n * 3), 3));
  }
  g.setIndex(new THREE.BufferAttribute(part.indices, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Bark, stone and a building's fabric are solid; leaves, moss and blooms are thin and scatter light. */
export const FOLIAGE: Readonly<Record<string, number>> = {
  bark: 0, leaf: 1, bloom: 0.6, stone: 0, moss: 0.3, stem: 0.8, eye: 0.6,
  wall: 0, timber: 0, roof: 0.12, masonry: 0, trim: 0, glass: 0,
};
/** Swatches lit from inside at night, like window glass. */
const LAMP = new Set(["glass"]);
/** Closed shapes, drawn front-faced; a building's boards and panes show from both sides. */
const CLOSED = new Set(["bark", "stone"]);

export function createPlant(plant: Realized, light: SceneLight): PlantView {
  const object = new THREE.Group();
  const box = new THREE.Box3();
  const geometries = plant.parts.map(geometryOf);
  for (const g of geometries) if (g.boundingBox !== null) box.union(g.boundingBox);
  const height = Math.max(1, box.max.y);
  const radius = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z, 1);
  // Wind and decline move vertices a little past the built mesh. A padded
  // sphere lets every pass cull the plant without ever clipping a swaying tip.
  const bounds = box.getBoundingSphere(new THREE.Sphere());
  bounds.radius += 2 + 0.15 * height;
  for (const g of geometries) g.boundingSphere = bounds.clone();

  const shared = {
    uVitality: { value: 1 },
    uSway: { value: plant.motion.sway },
    uFrequency: { value: plant.motion.frequency },
    uHeight: { value: height },
    uTurn: { value: 0 },
  };
  // Spinning pieces turn by an accumulated phase, so their speed can follow
  // vitality without the turn ever jumping when vitality changes.
  let turnedAt = light.uTime.value;
  const advanceTurn = (): void => {
    const now = light.uTime.value;
    if (now === turnedAt) return;
    shared.uTurn.value += Math.max(0, now - turnedAt) * spinAt(shared.uVitality.value);
    turnedAt = now;
  };
  const materials: THREE.ShaderMaterial[] = [];
  const meshes: { mesh: THREE.Mesh; color: THREE.ShaderMaterial; depth: THREE.ShaderMaterial }[] = [];
  const veils: THREE.Mesh[] = [];
  plant.parts.forEach((part, i) => {
    const swatch: Swatch = plant.palette.swatches[part.swatch] ?? { healthy: [1, 0, 1], decline: [1, 0, 1] };
    if (part.swatch === "smoke") {
      // Smoke drifts in its own soft material and casts no shadow.
      const material = createSmokeMaterial(light, shared, vec3Of(swatch.healthy));
      const mesh = new THREE.Mesh(geometries[i], material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      object.add(mesh);
      materials.push(material);
      veils.push(mesh);
      return;
    }
    const foliage = FOLIAGE[part.swatch] ?? 0.5;
    const perPart = { uFlutter: { value: foliage === 0 ? 0 : 1 } };
    const defines = hasRuin(part) ? { RUIN: "" } : {};
    const color = new THREE.ShaderMaterial({
      defines,
      vertexShader: PLANT_VERT,
      fragmentShader: PLANT_FRAG,
      uniforms: {
        ...light,
        ...shared,
        ...perPart,
        uHealthy: { value: vec3Of(swatch.healthy) },
        uDecline: { value: vec3Of(swatch.decline) },
        uFoliage: { value: foliage },
        uLamp: { value: LAMP.has(part.swatch) ? 1 : 0 },
      },
      side: CLOSED.has(part.swatch) ? THREE.FrontSide : THREE.DoubleSide,
      // Leaf edges resolve through the multisampled canvas, not a hard alpha test.
      alphaToCoverage: part.cutout.some((c) => c !== 0),
    });
    const depth = new THREE.ShaderMaterial({
      defines,
      vertexShader: DEPTH_VERT,
      fragmentShader: DEPTH_FRAG,
      uniforms: { uTime: light.uTime, uWind: light.uWind, uNightness: light.uNightness, ...shared, ...perPart },
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometries[i], color);
    mesh.userData.part = part.swatch;
    if (part.channels.spin !== undefined) mesh.onBeforeRender = advanceTurn;
    object.add(mesh);
    materials.push(color, depth);
    meshes.push({ mesh, color, depth });
  });

  return {
    object,
    height,
    radius,
    triangles: plant.parts.reduce((n, p) => n + p.indices.length / 3, 0),
    get vitality() {
      return shared.uVitality.value;
    },
    setVitality(v) {
      shared.uVitality.value = Math.min(1, Math.max(0, v));
    },
    useDepth(on) {
      for (const m of meshes) m.mesh.material = on ? m.depth : m.color;
      for (const v of veils) v.visible = !on;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      object.removeFromParent();
    },
  };
}

/**
 * A renderer on an opaque canvas. Three always asks for a canvas with alpha,
 * and leaf-card edges resolve to partial alpha, so on such a canvas the page
 * behind would show through every leaf's edge as a pale outline.
 */
export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const context = canvas.getContext("webgl2", { alpha: false, antialias: true });
  if (context === null) throw new Error("WebGL 2 is unavailable.");
  return new THREE.WebGLRenderer({ canvas, context });
}
