// What covers the ground: wind-swayed grass that travels with the viewer and
// stands on the baked lattice, grown from each region's ground cover, and
// past the land on the wild land, grown from the wild's own covers. It reads
// the same ground texture the mesh was built from, and the ground's vitality:
// where the ground declines, the grass thins, shortens and turns to straw.

import * as THREE from "three";
import { CLEARINGS_GLSL, type Clearing, LIGHT_GLSL, type SceneLight, WIND_FIELD_GLSL, createClearings, hexToVec3 } from "@gaia/render";
import { BANKS, GROUND_SAMPLE_GLSL, type GroundTexture, WILD_GLSL } from "./ground.ts";
import { REGIONS_GLSL, type RegionCovers, TUFT_GLSL } from "./regions.ts";
import { CLEARING_GLSL, type Clearings } from "./clearings.ts";
import { TRAIL_GLSL, trailUniforms } from "./trails.ts";
import { VITALITY_GLSL, vitalityUniforms } from "./vitality.ts";
import { GROUND_DECLINE } from "@gaia/terrain";

/**
 * The farthest any point of a blade reaches from its foot, meters: the
 * tallest blade is 1.3 times its cover's height, a fourth taller again with
 * a flower, and the tallest cover (silver grass) is 0.85 m, so 1.4 m; a
 * blade's spine keeps its length however it bends.
 */
const BLADE_REACH = 2;
/** Three's frustum planes are right, left, bottom, top, far and near; the far plane culls nothing a blade's reach does not. */
const CULLING_PLANES = [0, 1, 2, 3, 5] as const;

const GRASS_VERT = /* glsl */ `
${CLEARINGS_GLSL}
uniform float uTime;
uniform float uWind;
uniform vec3 uCenter;
// The drawing camera's frustum, but its far plane: each plane's inward normal and offset.
uniform vec4 uFrustum[5];
${GROUND_SAMPLE_GLSL}
${WILD_GLSL}
${TRAIL_GLSL}
${REGIONS_GLSL}
${TUFT_GLSL}
${CLEARING_GLSL}
${VITALITY_GLSL}
attribute vec4 aBlade; // x, z as a share of the blade's patch, rotation, height
attribute vec4 aSeed; // tint, flower, keep, cover pick
attribute vec2 aThin; // where in the thinning band the blade narrows away, 0 to 1; its reach
attribute vec3 aBloom; // where a flower's vertex lies: round its bloom's rim, or on its stem (z 0)
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
varying vec2 vRound;

// The world's one wind field (WIND_FIELD_GLSL): over a light breeze,
// irregular gusts travel downwind as soft fronts, so waves roll across the
// field and on into the trees; a slower sway and a little flutter ride on top.
${WIND_FIELD_GLSL}

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
  // Most blades draw nothing: past their thinning band (below) they have
  // narrowed to nothing, and most of the rest lie outside the view. Such a
  // blade skips the work below and collapses outside the view, so it costs
  // a few instructions and draws exactly the nothing it drew before.
  float from = reach * mix(0.5, 0.8, aThin.x);
  float far = length(xz - uCenter.xz);
  if (far >= from + reach * 0.2) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // Past the land the blade stands on the wild land: no water, no trails. The
  // wild land is gentle and each sample of it costs noise, so its slope is
  // read forward, from two samples rather than four.
  bool wild = inWild(xz);
  vec4 g4 = wild ? vec4(wildHeight(xz), -1000.0, 1000.0, 1000.0) : groundSample4(xz);
  vec3 g = g4.xyz;
  for (int i = 0; i < 5; i++) {
    if (dot(uFrustum[i].xyz, vec3(xz.x, g.x, xz.y)) + uFrustum[i].w < -${BLADE_REACH.toFixed(1)}) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
  }
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
  float near = 1.0 - smoothstep(from, from + reach * 0.2, far);
  // Grass grows up to the sand, which is wider where the waterline curves (bankWidth).
  float banks = step(mix(1.3, 3.0, r2) * bankWidth(xz, g.z) / ${BANKS.wide.toFixed(1)}, g.z);
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
  // Declined ground (VITALITY_GLSL): blades thin one by one, each at its own
  // seeded share, narrowing to nothing by the same continuous rule as
  // distance, and none stands on bare earth; those left stand shorter and
  // turn to straw, each at its own seeded point, so a failing field is a
  // mottle of straw and the last of the green.
  float decline = wild ? 0.0 : declineOf(landVitality(xz).x);
  float standing = 1.0;
  float straw = 0.0;
  if (decline > 0.0) {
    float r5 = fract(aSeed.w * 3.91 + aBlade.y * 5.13 + aThin.x * 2.71);
    float r6 = fract(aSeed.x * 9.73 + aBlade.x * 3.31 + aSeed.z * 1.7);
    float left = 1.0 - ${(1 - GROUND_DECLINE.blades).toFixed(3)} * decline;
    // Toward bare earth blades give out one by one across a wide edge, so a patch opens in the grass rather than behind a wall of it.
    float r7 = fract(aSeed.z * 5.37 + aBlade.y * 2.11);
    standing = (1.0 - smoothstep(left, left + 0.1, r5)) * (1.0 - smoothstep(r7 - 0.1, r7 + 0.1, bareEarth(xz, decline, 0.24) * 1.2));
    h *= 1.0 - ${(1 - GROUND_DECLINE.height).toFixed(3)} * decline;
    straw = max(smoothstep(r6 - 0.1, r6 + 0.1, decline), decline * 0.35);
  }

  float side = position.x;
  float t = position.y;
  // Outline: a pointed blade that stays full to near its soft tip, or a round leaf.
  float lance = pow(1.0 - t, 0.7) * (1.0 + 0.6 * t);
  float leaf = sqrt(max(0.0, 1.0 - pow(2.0 * t - 1.0, 2.0))) * 1.15 + 0.12 * (1.0 - t);
  float outline = mix(lance, leaf, form.y);
  float wide = shape.y * keep * near * standing * mix(outline, 0.18, flower);

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
  // The blade's face, rounded across its width so it shades like a soft leaf.
  vNormal = normalize(cross(across, tangent) + across * side * 0.55);
  vT = t;
  vRound = aBloom.xy;
  if (flower > 0.5) {
    // A flower is a slim stem crowned by a round bloom turned to the eye, so
    // from every side it reads as a bloom rather than a card. The bloom rides
    // the top of the blade's spine, so it sways with the grass. Its area is a
    // ninth of its blade's width times its height: 3 to 6 cm across.
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 eye = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
    float radius = 0.19 * sqrt(shape.y * h) * keep * near * standing;
    vec3 middle = spine(1.0, facing, lean, arc, wind, tangent) * h - up * radius;
    vec3 rim = right * aBloom.x + up * aBloom.y;
    local = aBloom.z > 0.5 ? middle + rim * radius : (aBloom.y < 0.0 ? middle - up * radius : vec3(0.0)) + right * side * wide;
    // The bloom shades as a low dome facing the eye; the stem as a round stalk.
    vNormal = normalize(eye + (aBloom.z > 0.5 ? rim * 0.8 : right * side * 0.55));
    vT = aBloom.z > 0.5 ? 0.96 : -aBloom.y * 0.9;
  }
  vec3 world = vec3(xz.x, g.x - 0.02, xz.y) + local;
  vWorld = world;
  vTint = aSeed.x;
  vGust = gust;
  float pick = aSeed.y / max(flowers, 1e-4);
  vFlower = flower;
  vBloom = pick < 0.4 ? uFlowerA[k] : pick < 0.75 ? uFlowerB[k] : uFlowerC[k];
  // Broad patches shift a cover between its low and high colors, so a field never reads as one flat green.
  float patchy = tuftNoise(xz * 0.07 + 3.0) - 0.5;
  // Straw goes gold, or for some blades a withered grey-brown.
  float withered = straw > 0.0 ? smoothstep(0.55, 0.95, fract(aSeed.y * 13.7 + aBlade.x * 2.9)) * 0.8 : 0.0;
  vLow = mix(uCoverLow[k] * (1.0 + patchy * 0.16), mix(uStrawLow, uStrawDead * 0.85, withered), straw);
  vHigh = mix(mix(uCoverHigh[k], uCoverLow[k], max(-patchy, 0.0) * 0.35), mix(uStrawHigh, uStrawDead, withered), straw);
  vTip = mix(uCoverTip[k], mix(uStrawTip, uStrawDead * 1.1, withered), straw);
  vBloom = mix(vBloom, uStrawTip, straw);
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
varying vec2 vRound;
void main() {
  // Deep at the base, the cover's own green through the middle, a soft warm tip.
  vec3 albedo = mix(vLow, vHigh, smoothstep(0.05, 0.85, vT * 0.85 + (vTint - 0.5) * 0.35));
  albedo = mix(albedo, vTip, smoothstep(0.7, 1.0, vT) * 0.45);
  albedo = mix(albedo, uDry, step(0.94, vTint) * 0.35);
  albedo *= mix(0.68, 1.0, smoothstep(0.0, 0.55, vT)) * (0.94 + 0.12 * vTint);
  // A gust bows the blades over and shows their paler sheen.
  albedo = mix(albedo, vTip, vGust * 0.14 * smoothstep(0.2, 0.9, vT));
  bool bloom = vFlower > 0.5 && vT > 0.9;
  if (bloom) {
    // Five rounded petals round a warm eye, paler at their tips; between
    // and past the petals the bloom's rim shows the green it grows from.
    float r = length(vRound) / (0.86 + 0.14 * cos(atan(vRound.y, vRound.x) * 5.0 + vTint * 6.28));
    vec3 petals = mix(vBloom * vec3(0.95, 0.8, 0.45), vBloom * (0.9 + 0.1 * r), smoothstep(0.16, 0.3, r));
    // Flowers fade into their blades at night, so the dark meadow never reads as confetti.
    albedo = mix(mix(petals, vHigh * 0.85, smoothstep(0.86, 1.0, r)), albedo, uNightness * 0.75);
  }

  // Blades take the light of the ground they stand on, turned a little by
  // their own face, so the field reads as one painted surface that ripples.
  // A bloom's face is a low dome that always faces the eye.
  vec3 face = normalize(gl_FrontFacing || bloom ? vNormal : -vNormal);
  vec3 n = normalize(vGroundNormal + face * 0.45);
  float level = max(uSunDirection.y, 0.05);
  vec3 view = normalize(vWorld - cameraPosition);
  float nDotL = max(max(level + (dot(n, uSunDirection) - level) * 1.3, 0.0), swardCatch(vGroundNormal, view));
  float shadow = mix(0.45, 1.0, sunShadow(vWorld, vGroundNormal, 0.0015));
  float direct = nDotL * shadow;
  float light = mix(direct, softCel(direct), 0.5) * sunUp();
  vec3 toned = nightTone(albedo);
  vec3 lit = toned * (uSunColor * uSunIntensity * light + uAmbientColor * uAmbientIntensity);
  vec3 shadowed = toned * uShadowColor * (uAmbientIntensity + 0.75);
  vec3 color = mix(shadowed, lit, clamp(light + 0.35, 0.0, 1.0));
  // Looking toward the sun, thin blades glow a little where light comes
  // through, more when the sun is low behind them.
  float through = pow(max(dot(view, uSunDirection), 0.0), 3.0) * smoothstep(0.3, 1.0, vT) * shadow * sunUp();
  color += toned * uSunColor * through * (0.22 + 0.45 * (1.0 - smoothstep(0.1, 0.5, uSunDirection.y)));
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
  // shader gives it its cover's outline, lean and arc. A flower draws the
  // same vertices as a stem, its first two rows, and a bloom: the stem's top
  // is the bloom's foot, and the other rows go round it to its top, at
  // these angles from the bloom's middle, so the bloom is an octagon.
  const rows = [0, 0.26, 0.5, 0.71, 0.87];
  const round = [-90, -90, -45, 0, 45].map((deg) => (deg * Math.PI) / 180);
  const blade = new THREE.BufferGeometry();
  const verts: number[] = [];
  const bloom: number[] = [];
  rows.forEach((t, r) => {
    verts.push(-1, t, 0, 1, t, 0);
    const a = round[r] as number;
    const onRim = r >= 2 ? 1 : 0;
    // The stem's foot (0, 0) and top (0, -1); the rim's points left and right of the bloom's middle.
    for (const side of [-1, 1]) bloom.push(onRim === 1 ? side * Math.cos(a) : 0, r === 0 ? 0 : Math.sin(a), onRim);
  });
  verts.push(0, 1, 0);
  bloom.push(0, 1, 1);
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
  geometry.setAttribute("aBloom", new THREE.Float32BufferAttribute(bloom, 3));
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
  const frustumPlanes = { value: Array.from({ length: 5 }, () => new THREE.Vector4()) };
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
      uFrustum: frustumPlanes,
      ...trailUniforms,
      ...under.uniforms,
      ...vitalityUniforms,
      uDry: { value: hexToVec3(0xc4b47e) },
    },
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Each camera that draws the grass (the view, a painting's) culls its blades by its own frustum.
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (let i = 0; i < CULLING_PLANES.length; i++) {
      const plane = frustum.planes[CULLING_PLANES[i] as number] as THREE.Plane;
      (frustumPlanes.value[i] as THREE.Vector4).set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    }
    material.uniformsNeedUpdate = true;
  };
  return {
    mesh,
    follow(c) {
      center.value.copy(c);
      // The clearings' mask lies around the grass, wherever it gathers.
      under.follow(c.x, c.z);
    },
    clear: (list) => clearings.set(list),
  };
}
