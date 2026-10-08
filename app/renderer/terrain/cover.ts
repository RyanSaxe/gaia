// What covers the ground: wind-swayed grass that travels with the viewer and
// stands on the baked lattice, grown from each region's ground cover, and
// past the land on the wild land, grown from the wild's own covers. It reads
// the same ground texture the mesh was built from.

import * as THREE from "three";
import { CLEARINGS_GLSL, type Clearing, LIGHT_GLSL, type SceneLight, createClearings, hexToVec3 } from "@gaia/render";
import { GROUND_SAMPLE_GLSL, type GroundTexture, WILD_GLSL } from "./ground.ts";
import { REGIONS_GLSL, type RegionCovers, TUFT_GLSL } from "./regions.ts";
import { CLEARING_GLSL, type Clearings } from "./clearings.ts";
import { TRAIL_GLSL, trailUniforms } from "./trails.ts";

const GRASS_VERT = /* glsl */ `
${CLEARINGS_GLSL}
uniform float uTime;
uniform float uWind;
uniform vec3 uCenter;
${GROUND_SAMPLE_GLSL}
${WILD_GLSL}
${TRAIL_GLSL}
${REGIONS_GLSL}
${TUFT_GLSL}
${CLEARING_GLSL}
attribute vec4 aBlade; // x, z as a share of the blade's patch, rotation, height
attribute vec4 aSeed; // tint, flower, keep, cover pick
attribute vec2 aThin; // where in the thinning band the blade narrows away, 0 to 1; its reach
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vGroundNormal;
varying float vT;
varying float vTint;
varying float vFlower;
varying float vGust;
varying vec3 vLow;
varying vec3 vHigh;
varying vec3 vTip;
varying vec3 vBloom;

// The wind blows from one side of the world. Gusts travel downwind as broad,
// soft bands, so waves roll across the field; a slower sway and a little
// flutter ride on top.
const vec2 WIND_DIR = vec2(0.94, 0.34);
float gustAt(vec2 p, float t) {
  float along = dot(p, WIND_DIR) * 0.1 - t * 0.85 + tuftNoise(p * 0.025) * 3.0;
  return smoothstep(0.35, 1.0, 0.5 + 0.5 * sin(along));
}

// A blade's spine: it leans along its facing, arcs over toward the tip and
// bends with the wind, integrated in four steps so its length never changes.
vec3 spine(float t, vec2 facing, float lean, float arc, vec2 wind, out vec3 tangent) {
  vec3 p = vec3(0.0);
  float dt = t / 4.0;
  for (int i = 0; i < 4; i++) {
    float u = (float(i) + 0.5) * dt;
    vec2 v = facing * (lean + arc * u) + wind * u * u;
    float a = min(length(v), 1.45);
    vec2 dir = v / max(length(v), 1e-4);
    p += vec3(dir.x * sin(a), cos(a), dir.y * sin(a)) * dt;
  }
  vec2 v = facing * (lean + arc * t) + wind * t * t;
  float a = min(length(v), 1.45);
  vec2 dir = v / max(length(v), 1e-4);
  tangent = vec3(dir.x * sin(a), cos(a), dir.y * sin(a));
  return p;
}

void main() {
  // Each blade wraps to stay within its reach of the viewer, so the field
  // travels with them while every blade keeps a fixed spot on the ground.
  float reach = aThin.y;
  vec2 xz = uCenter.xz + mod(aBlade.xy * reach * 2.0 - uCenter.xz + reach, reach * 2.0) - reach;
  // Past the land the blade stands on the wild land: no water, no trails. The
  // wild land is gentle and each sample of it costs noise, so its slope is
  // read forward, from two samples rather than four.
  bool wild = inWild(xz);
  vec4 g4 = wild ? vec4(wildHeight(xz), -1000.0, 1000.0, 1000.0) : groundSample4(xz);
  vec3 g = g4.xyz;
  float e = 0.6;
  float sx = wild ? (wildHeight(xz + vec2(e, 0.0)) - g.x) * 2.0 : groundAt(xz + vec2(e, 0.0)).x - groundAt(xz - vec2(e, 0.0)).x;
  float sz = wild ? (wildHeight(xz + vec2(0.0, e)) - g.x) * 2.0 : groundAt(xz + vec2(0.0, e)).x - groundAt(xz - vec2(0.0, e)).x;
  float grade = length(vec2(sx, sz)) / (2.0 * e);
  vGroundNormal = normalize(vec3(-sx / (2.0 * e), 1.0, -sz / (2.0 * e)));

  // A blade's height never changes with distance, so it never grows out of
  // the ground. Toward its reach the field thins continuously: each blade
  // narrows to nothing across its own seeded band, which starts between 50%
  // and 80% of its reach and runs a fifth of the reach, so no blade ever
  // appears or vanishes between one step and the next. On steep risers and
  // over the sand toward the water blades thin whole, by their fixed spot on
  // the ground, so walking never changes which of them stand.
  float r2 = fract(aSeed.x * 7.13 + aSeed.z * 3.71);
  float r3 = fract(aSeed.y * 5.31 + aThin.x * 9.17);
  float from = reach * mix(0.5, 0.8, aThin.x);
  float near = 1.0 - smoothstep(from, from + reach * 0.2, length(xz - uCenter.xz));
  float banks = step(mix(1.3, 3.0, r2), g.z);
  float steep = step(r3, 1.0 - smoothstep(0.35, 0.7, grade) * 0.8);

  // The blade grows one region's cover: its height, width, density, clumping,
  // form and flowers. Past the land, blades drift into the wild's own two
  // covers, each blade at its own seeded share, so the covers mingle; where
  // the wild has only begun, its blades stand lower, so tall grass rises
  // out of the land's cover as a verge rather than in lone spikes.
  int k = coverPick(xz, aSeed.w);
  float wildness = wildShare(xz);
  bool wildBlade = fract(aSeed.w * 7.31 + aThin.x * 3.17) < wildness;
  if (wildBlade) k = fract(aSeed.w * 5.77 + aSeed.y * 2.3) < wildPatch(xz) ? WILD_B : WILD_A;
  vec4 shape = uCoverShape[k];
  vec3 form = uCoverForm[k];
  float tuft = tuftMask(xz);
  float tufted = step(fract(aBlade.w * 13.7 + aSeed.w * 5.3) * 0.999, mix(1.0, tuft, shape.w));
  float keep = step(aSeed.z, shape.z) * banks * steep * tufted;
  float flowers = uCoverFlowers[k];
  float flower = step(aSeed.y, flowers);
  // Tufts dome: their middles stand a little taller than their edges.
  float h = aBlade.w * shape.x * keep * mix(1.0, 0.72 + 0.28 * tuft, shape.w) * (1.0 + flower * 0.25) * clearing(xz);
  if (wildBlade) h *= mix(0.35, 1.0, smoothstep(0.0, 0.9, wildness));
  // Nothing grows under a stone or a bush.
  h *= step(clearingAt(xz), 0.5);
  // A trail parts the grass: each blade stands only past its own seeded edge,
  // so the tread's border is ragged, and a faint trail keeps more blades on
  // it. Blades along the margin are trampled a little shorter.
  // Each trail's wear follows the vitality of the two entities it joins: a
  // failing entity's trail grows over, its blades returning across the tread.
  float edge = g4.w;
  float wear = edge < 2.0 ? trailWearAt(xz) : 0.0;
  float r4 = fract(aSeed.z * 11.3 + aBlade.x * 7.1 + aBlade.y * 3.7);
  h *= step(mix(-0.45, 0.55, r4) - (1.0 - wear) * 1.3, edge);
  h *= mix(0.55, 1.0, smoothstep(-0.3, 1.3, edge + (1.0 - wear)));

  float side = position.x;
  // A flower's rows crowd toward its top, so its head is a small round dab on a long stem.
  float t = mix(position.y, position.y < 0.75 ? position.y * 1.24 : 0.88 + (position.y - 0.71) * 0.41, flower);
  // Outline: a pointed blade that stays full to near its soft tip, or a round leaf.
  float lance = pow(1.0 - t, 0.7) * (1.0 + 0.6 * t);
  float leaf = sqrt(max(0.0, 1.0 - pow(2.0 * t - 1.0, 2.0))) * 1.15 + 0.12 * (1.0 - t);
  float outline = mix(lance, leaf, form.y);
  // A flower is a slim stem that opens a small round head at its top. Seen
  // at eye height, a head any larger reads as confetti.
  float head = smoothstep(0.9, 0.94, t);
  float wide = shape.y * keep * near * mix(outline, mix(0.18, 0.95, head), flower);

  vec2 facing = vec2(-sin(aBlade.z), cos(aBlade.z));
  vec3 across = vec3(cos(aBlade.z), 0.0, sin(aBlade.z));
  // Flowers hold their heads up even where their cover's leaves lie low.
  float lean = form.x * 1.25 * (0.45 + 1.1 * aSeed.x) * (1.0 - flower * 0.7);
  float arc = form.z * (0.6 + 0.8 * r3);
  float gust = gustAt(xz, uTime);
  float sway = sin(uTime * 1.3 + xz.x * 0.21 + xz.y * 0.17) * 0.5 + 0.5;
  float flutter = sin(uTime * 3.7 + xz.x * 0.9 + xz.y * 1.3 + aSeed.x * 6.28);
  // Low leaves lying near the ground barely move; tall blades bow with each gust.
  float give = uWind * (1.0 - form.x * 0.7);
  vec2 wind = WIND_DIR * give * (0.1 + 0.12 * sway + 0.5 * gust) + vec2(-WIND_DIR.y, WIND_DIR.x) * flutter * 0.05 * give;
  vec3 tangent;
  vec3 local = spine(t, facing, lean, arc, wind, tangent) * h + across * side * wide;
  vec3 world = vec3(xz.x, g.x - 0.02, xz.y) + local;
  // The blade's face, rounded across its width so it shades like a soft leaf.
  vNormal = normalize(cross(across, tangent) + across * side * 0.55);
  vWorld = world;
  vT = t;
  vTint = aSeed.x;
  vGust = gust;
  float pick = aSeed.y / max(flowers, 1e-4);
  vFlower = flower;
  vBloom = pick < 0.4 ? uFlowerA[k] : pick < 0.75 ? uFlowerB[k] : uFlowerC[k];
  // Broad patches shift a cover between its low and high colors, so a field never reads as one flat green.
  float patchy = tuftNoise(xz * 0.07 + 3.0) - 0.5;
  vLow = uCoverLow[k] * (1.0 + patchy * 0.16);
  vHigh = mix(uCoverHigh[k], uCoverLow[k], max(-patchy, 0.0) * 0.35);
  vTip = uCoverTip[k];
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const GRASS_FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
uniform vec3 uDry;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vGroundNormal;
varying float vT;
varying float vTint;
varying float vFlower;
varying float vGust;
varying vec3 vLow;
varying vec3 vHigh;
varying vec3 vTip;
varying vec3 vBloom;
void main() {
  // Deep at the base, the cover's own green through the middle, a soft warm tip.
  vec3 albedo = mix(vLow, vHigh, smoothstep(0.05, 0.85, vT * 0.85 + (vTint - 0.5) * 0.35));
  albedo = mix(albedo, vTip, smoothstep(0.7, 1.0, vT) * 0.45);
  albedo = mix(albedo, uDry, step(0.94, vTint) * 0.35);
  albedo *= mix(0.68, 1.0, smoothstep(0.0, 0.55, vT)) * (0.94 + 0.12 * vTint);
  // A gust bows the blades over and shows their paler sheen.
  albedo = mix(albedo, vTip, vGust * 0.14 * smoothstep(0.2, 0.9, vT));
  // Flowers fade into their blades at night, so the dark meadow never reads as confetti.
  if (vFlower > 0.5 && vT > 0.86) albedo = mix(vBloom * (0.9 + 0.1 * vT), albedo, uNightness * 0.75);

  // Blades take the light of the ground they stand on, turned a little by
  // their own face, so the field reads as one painted surface that ripples.
  vec3 face = normalize(gl_FrontFacing ? vNormal : -vNormal);
  vec3 n = normalize(vGroundNormal + face * 0.45);
  float level = max(uSunDirection.y, 0.05);
  float nDotL = max(level + (dot(n, uSunDirection) - level) * 1.3, 0.0);
  float shadow = mix(0.45, 1.0, sunShadow(vWorld, 0.0015));
  float direct = nDotL * shadow;
  float light = mix(direct, softCel(direct), 0.5) * sunUp();
  vec3 toned = nightTone(albedo);
  vec3 lit = toned * (uSunColor * uSunIntensity * light + uAmbientColor * uAmbientIntensity);
  vec3 shadowed = toned * uShadowColor * (uAmbientIntensity + 0.75);
  vec3 color = mix(shadowed, lit, clamp(light + 0.35, 0.0, 1.0));
  // Looking toward the sun, thin blades glow a little where light comes through.
  vec3 view = normalize(vWorld - cameraPosition);
  float through = pow(max(dot(view, uSunDirection), 0.0), 3.0) * smoothstep(0.3, 1.0, vT) * shadow * sunUp();
  color += toned * uSunColor * through * 0.22;
  // Blades scatter light, so the moon and the lantern wrap well around them.
  color += nightLight(albedo, n, vWorld, 0.6, mix(1.0, shadow, uMoonShadow));
  gl_FragColor = vec4(aerial(shoulder(color), vWorld), 1.0);
}
`;

export interface Grass {
  readonly mesh: THREE.Mesh;
  follow(center: THREE.Vector3): void;
  /** Where no grass grows, such as under a house and along its walk. */
  clear(list: readonly Clearing[]): void;
}

/**
 * Tiers of blades by reach: a quarter reach only 14 m and another third 30 m,
 * so the grass is densest close by, where each blade can be seen.
 */
const TIERS = [
  { share: 0.25, reach: 14 },
  { share: 0.32, reach: 30 },
] as const;

/**
 * Wind-swayed blades around the viewer; each region's cover decides what
 * grows where and in what form. Blades keep their full height at every
 * distance: toward their reach each one narrows smoothly to nothing over its
 * own seeded band, so none appears or vanishes as the viewer moves.
 */
export function createGrass(light: SceneLight, ground: GroundTexture, covers: RegionCovers, under: Clearings, count = 150000, radius = 60): Grass {
  // One blade, one unit wide and tall: five rows and a soft tip. The vertex
  // shader gives it its cover's outline, lean and arc.
  const rows = [0, 0.26, 0.5, 0.71, 0.87];
  const blade = new THREE.BufferGeometry();
  const verts: number[] = [];
  for (const t of rows) verts.push(-1, t, 0, 1, t, 0);
  verts.push(0, 1, 0);
  const index: number[] = [];
  for (let r = 0; r + 1 < rows.length; r++) {
    const a = r * 2;
    index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const top = (rows.length - 1) * 2;
  index.push(top, top + 1, top + 2);
  blade.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  blade.setIndex(index);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = blade.index;
  geometry.setAttribute("position", blade.getAttribute("position"));
  const data = new Float32Array(count * 4);
  const seeds = new Float32Array(count * 4);
  const thin = new Float32Array(count * 2);
  let seed = 1234567;
  const next = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const reachOf = (i: number): number => {
    let edge = 0;
    for (const tier of TIERS) {
      edge += tier.share * count;
      if (i < edge) return tier.reach;
    }
    return radius;
  };
  for (let i = 0; i < count; i++) {
    data[i * 4] = next();
    data[i * 4 + 1] = next();
    data[i * 4 + 2] = next() * Math.PI * 2;
    data[i * 4 + 3] = 0.6 + next() * 0.7;
    for (let k = 0; k < 4; k++) seeds[i * 4 + k] = next();
    thin[i * 2] = next();
    thin[i * 2 + 1] = reachOf(i);
  }
  geometry.setAttribute("aBlade", new THREE.InstancedBufferAttribute(data, 4));
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.setAttribute("aThin", new THREE.InstancedBufferAttribute(thin, 2));
  geometry.instanceCount = count;
  const center = { value: new THREE.Vector3() };
  const clearings = createClearings();
  const material = new THREE.ShaderMaterial({
    vertexShader: GRASS_VERT,
    fragmentShader: GRASS_FRAG,
    uniforms: {
      ...light,
      ...clearings.uniforms,
      ...ground.uniforms,
      ...covers.uniforms,
      uCenter: center,
      ...trailUniforms,
      ...under.uniforms,
      uDry: { value: hexToVec3(0xc4b47e) },
    },
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, follow: (c) => center.value.copy(c), clear: (list) => clearings.set(list) };
}
