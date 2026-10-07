// A realized plant as Three.js meshes. One ShaderMaterial per part applies
// the vitality channels on the GPU, so vitality is a uniform and changing it
// never rebuilds geometry.

import * as THREE from "three";
import { CUT, type Part, type Swatch } from "@gaia/schema";
import { CHANNEL_MATH, type Realized } from "@gaia/realize";
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
  return aPivot + off * keep;
}

// Copies of one component vary their shape a little, seeded by where each
// stands: taller or squatter, a lean, and a bulge to one side that grows from
// nothing at the ground, so neighbors never look stamped and the footprint
// the grass is cleared from stays put. uVariety is 0 unless the material sets
// it, as instanced copies do.
uniform float uVariety;
vec3 applyVariety(vec3 p, vec3 root) {
  if (uVariety <= 0.0) return p;
  vec3 h = fract(sin(vec3(dot(root.xz, vec2(12.9898, 78.233)), dot(root.xz, vec2(39.346, 11.135)), dot(root.xz, vec2(73.156, 52.235)))) * 43758.5453);
  float up = clamp(p.y / uHeight, 0.0, 1.2);
  float squash = (h.x - 0.5) * 0.26 * uVariety;
  float bulge = 1.0 + 0.09 * uVariety * sin(atan(p.z, p.x) * 2.0 + h.y * 6.2832) * up;
  vec3 q = vec3(p.x * (1.0 - squash * 0.3) * bulge, p.y * (1.0 + squash), p.z * (1.0 - squash * 0.3) * bulge);
  q.xz += (h.yz - 0.5) * 0.12 * uVariety * uHeight * up * up;
  return q;
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
// A patch (moss) recedes from its edge as vitality falls: its depth shrinks
// before the fragment cuts it, so the edge creeps back smoothly.
vec3 cardCut() {
  vec3 c = aCutout;
  if (abs(floor(c.z) - ${CUT.patch.toFixed(1)}) < 0.5) c.x -= 0.5 * (1.0 - uVitality);
  return c;
}
`;

const LEAF_MASK_GLSL = /* glsl */ `
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

// A rounded oval leaf from the origin along +x.
float ovalShape(vec2 q, float len, float wide) {
  float t = clamp(q.x / len, 0.0, 1.0);
  float profile = wide * pow(4.0 * t * (1.0 - t), 0.55) * (1.0 - 0.2 * t);
  return min(profile - abs(q.y), min(q.x, len - q.x) * 0.7);
}

// Small oval leaves on short stalks, each starting a little off the card's
// middle, so a cluster reads as leaves on twigs rather than a rosette.
float ovalCut(vec2 p, float seed, float far) {
  float outline = 0.8 + 0.07 * cos(atan(p.y, p.x) * 9.0 + seed * 6.2832) - length(p);
  if (far > 0.999) return outline;
  float d = 0.1 - length(p);
  for (int k = 0; k < 8; k++) {
    float fk = float(k);
    float a = seed * 6.2832 + fk * 0.785 + (leafHash(seed * 11.3 + fk) - 0.5) * 0.5;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 side = vec2(-dir.y, dir.x);
    vec2 r = p - dir * (0.06 + 0.12 * leafHash(seed * 5.1 + fk * 2.3)) - side * (leafHash(seed * 2.9 + fk) - 0.5) * 0.2;
    vec2 q = vec2(dot(r, dir), dot(r, side));
    d = max(d, ovalShape(q, 0.48 + 0.24 * leafHash(seed * 7.7 + fk * 3.3), 0.19 + 0.05 * leafHash(seed * 4.1 + fk)));
  }
  return mix(d, outline, far);
}

// A palmate leaf facing +x from its stalk: five pointed lobes, the side ones
// shorter, with deep sinuses between them.
float lobedShape(vec2 q, float size) {
  vec2 c = q - vec2(size * 0.4, 0.0);
  float th = atan(c.y, c.x);
  float lobes = pow(0.5 + 0.5 * cos(th * 8.4), 2.2);
  float reach = size * (0.3 + 0.34 * lobes * (1.0 - 0.45 * smoothstep(0.5, 1.6, abs(th))));
  reach = mix(reach, size * 0.24, smoothstep(1.75, 2.5, abs(th)));
  return reach - length(c);
}

// A few maple-like leaves splayed from the card's middle.
float lobedCut(vec2 p, float seed, float far) {
  float outline = 0.76 + 0.1 * cos(atan(p.y, p.x) * 5.0 + seed * 6.2832) - length(p);
  if (far > 0.999) return outline;
  float d = 0.08 - length(p);
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    float a = seed * 6.2832 + fk * 1.5708 + (leafHash(seed * 9.7 + fk) - 0.5) * 0.9;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 q = vec2(dot(p, dir), dot(p, vec2(-dir.y, dir.x)));
    d = max(d, lobedShape(q, 0.6 + 0.22 * leafHash(seed * 3.3 + fk * 1.7)));
  }
  return mix(d, outline, far);
}

// Moss on stone: the patch ends where its depth, jittered per vertex, falls
// below a fifth, so the edge follows a soft winding contour.
float patchCut(vec2 p) {
  return (p.x + 0.24 * (p.y - 0.5) - 0.2) * 0.25;
}

// A five-petaled flower: rounded petals around its heart, a plain round far away.
float blossomCut(vec2 p, float seed, float far) {
  float r = length(p);
  float outline = 0.86 - r;
  if (far > 0.999) return outline;
  float th = atan(p.y, p.x) + seed * 6.2832;
  float petal = pow(abs(cos(th * 2.5)), 0.7);
  return mix((0.5 + 0.46 * petal - r) * 0.6, outline, far);
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
  float d = form < 1.5 ? clusterCut(p, seed, far)
    : form < 2.5 ? strandCut(p, seed, far)
    : form < 3.5 ? needleCut(p, seed, far)
    : form < 4.5 ? ovalCut(p, seed, far)
    : form < 5.5 ? lobedCut(p, seed, far)
    : form < 6.5 ? patchCut(p)
    : blossomCut(p, seed, far);
  float rim = 0.86 + 0.14 * smoothstep(0.0, 0.07, d);
  if (form > 2.5 && form < 3.5) rim *= 0.9 + 0.1 * smoothstep(0.15, 0.45, abs(fract(p.y * 15.0 - abs(p.x) * 1.3 + seed * 5.0) - 0.5));
  return vec2(clamp(d / max(fwidth(d), 1e-4) + 0.5, 0.0, 1.0), mix(rim, 1.0, far));
}
`;

export const PLANT_VERT = /* glsl */ `
uniform float uTime;
${CHANNELS_GLSL}
${CUTOUT_GLSL}
varying vec3 vNormal;
varying vec3 vWorld;
varying float vShade;
varying float vTint;
varying float vWither;
varying float vGlow;
void main() {
  vec3 root = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 p = applyWind(applyVariety(applyChannels(position), root), root);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vShade = aShade;
  vTint = aTint;
  vCut = cardCut();
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
  if (vCut.z > 0.5 && abs(floor(vCut.z) - ${CUT.patch.toFixed(1)}) > 0.5) {
    vec3 face = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    cover *= smoothstep(0.06, 0.28, abs(dot(face, normalize(cameraPosition - vWorld))));
  }
  if (cover < 0.02) discard;
  float bright = mix(${f(CHANNEL_MATH.shadeLow)}, ${f(CHANNEL_MATH.shadeHigh)}, vShade) * cut.y;
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
void main() {
  vCut = cardCut();
  vec3 root = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 p = applyWind(applyVariety(applyChannels(position), root), root);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
}
`;

// Leaf cards cast scalloped shadows: the sun shines through between them.
export const DEPTH_FRAG = /* glsl */ `
precision highp float;
#define SHADOW_PASS
${LEAF_MASK_GLSL}
void main() {
  if (leafCut().x < 0.5) discard;
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
    const color = new THREE.ShaderMaterial({
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
      vertexShader: DEPTH_VERT,
      fragmentShader: DEPTH_FRAG,
      uniforms: { uTime: light.uTime, uWind: light.uWind, uNightness: light.uNightness, ...shared, ...perPart },
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometries[i], color);
    mesh.userData.part = part.swatch;
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
