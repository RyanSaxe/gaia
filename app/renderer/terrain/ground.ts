// The baked lattice as Three.js: the ground around the person as nested
// rings that follow them, the same rings at a quarter of their detail for the
// water's mirror, a coarse whole-world mesh and a coarse ring of the wild
// land past the rim for views from above, built only once a view from above
// asks for them, the lattice as a clipmap around the person for every shader that
// stands on the ground (`CLIP`), and the painterly ground material, colored by each region's ground
// cover and dried by the ground's vitality. Past the land the rings draw the
// wild land themselves, from the same function the walk stands on
// (`wildHeightAt` and its twin here, `WILD_GLSL`), so wherever the person
// goes the ground goes on.
//
// The rings never change shape on the CPU: each is a fixed grid, and its
// vertex shader reads heights from its own level of the clipmap. Every ring's vertices
// are lattice samples, each coarser ring's a strict subset of the finer one's.
// Toward its outer edge a ring morphs, by the person's distance, into exactly
// the next ring's surface (the lattice's own triangle split makes the fine
// triangles lie on the coarse ones), so where rings meet there is no seam,
// and as the person walks and the rings follow, no vertex ever jumps.

import * as THREE from "three";
import { LIGHT_GLSL, type SceneLight, hexToVec3 } from "@gaia/render";
import { SHORE_CAP, TRAILS, type Terrain, WILDS, frameOf, landHalf, wildBase, wildsRing } from "@gaia/terrain";
import { CLIP, type PageLand } from "./land.ts";
import { SWARD_GLSL } from "../world/environment.ts";
import { REGIONS_GLSL, type RegionCovers, TUFT_GLSL } from "./regions.ts";
import { TRAIL_GLSL, trailUniforms } from "./trails.ts";
import { VITALITY_GLSL, vitalityUniforms } from "./vitality.ts";
import { GROUND_DECLINE } from "@gaia/terrain";

/**
 * The land as a clipmap: every texture that holds a value per lattice sample
 * (the ground's height, water level and distances to the water and to the
 * nearest trail's edge; the covers; the ways each sample lies on), held only
 * around the person, as games hold their terrain. Level k holds every 2^k-th
 * lattice sample in a square of `CLIP.size` of them centered near the
 * person, on the world's own grid of 2^k spacings, which is where ring k of
 * the ground's rings sets its vertices: so each ring reads exactly the
 * samples it drew from before, and the land's memory on the GPU is the same
 * at any world size. Every texture shares the same windows, laid again
 * together. Readers between samples take the finest level that holds the
 * point, blended into the next one near its window's edge (`clipLevel`).
 */
export { CLIP };

/** The land around the person, for shaders that sample it: the ground, its covers and the ways on it. */
export interface GroundTexture {
  /** Height, water level, distance to the water and to the nearest trail's edge. */
  readonly texture: THREE.DataArrayTexture;
  readonly uniforms: {
    readonly uClip: { value: THREE.DataArrayTexture };
    /** Each level's first sample, in that level's own grid units (world over spacing times 2^k). */
    readonly uClipOrigin: { value: THREE.Vector2[] };
    /** The layer each level is read from: its own, but while a painting of a far place is drawn (`PageLand.aside`). */
    readonly uClipLayer: { value: number[] };
    /** Each sample's cover as the bake gave it (`Terrain.coverRegions` and `coverShares`), read by `REGIONS_GLSL`. */
    readonly uCoverRegions: { value: THREE.DataArrayTexture };
    readonly uCoverShares: { value: THREE.DataArrayTexture };
    /** Which ways each sample lies on and how far along them (`trailPlacesOn`), read by `TRAIL_GLSL`. */
    readonly uTrailPlace: { value: THREE.DataArrayTexture };
    readonly uGroundN: { value: number };
    readonly uGroundOrigin: { value: number };
    readonly uGroundSpacing: { value: number };
    /** 1 where a sample's nearest water is a pond's (`Terrain.nearPond`): its banks keep their full sand (`bankWidth`). */
    readonly uNearPond: { value: THREE.DataArrayTexture };
    /** The half side of the land's square, where it hands over to the wild land, and the wild roll's middle. */
    readonly uLand: { value: number };
    readonly uWildBase: { value: number };
  };
  /** Takes on the world the land just opened. */
  update(t: Terrain): void;
}

/**
 * A texture over every layer of the page's land, `data` layer after layer: the levels', then those set aside for a
 * painting. A layer uploads in the frame after it changes.
 */
function clipTexture(data: Float32Array | Uint8Array, format: THREE.PixelFormat, type: THREE.TextureDataType): THREE.DataArrayTexture {
  const texture = new THREE.DataArrayTexture(data, CLIP.size, CLIP.size, CLIP.levels + CLIP.aside);
  texture.format = format;
  texture.type = type;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  // Three uploads only the layers marked since the last upload; a new world marks none and uploads all.
  texture.onUpdate = () => texture.clearLayerUpdates();
  return texture;
}

/** The land's textures over `land`'s levels, whose data they are: every level's layers and its window move together. */
export function createGroundTexture(land: PageLand): GroundTexture {
  const { levels } = CLIP;
  const ground = clipTexture(land.ground, THREE.RGBAFormat, THREE.FloatType);
  const coverRegions = clipTexture(land.coverRegions, THREE.RGBAFormat, THREE.UnsignedByteType);
  const coverShares = clipTexture(land.coverShares, THREE.RGBAFormat, THREE.UnsignedByteType);
  const places = clipTexture(land.trailPlaces, THREE.RGFormat, THREE.FloatType);
  const nearPond = clipTexture(land.nearPond, THREE.RedFormat, THREE.UnsignedByteType);
  const textures = [ground, coverRegions, coverShares, places, nearPond];
  const origins = Array.from({ length: levels }, () => new THREE.Vector2());
  const layers = Array.from({ length: levels }, (_, k) => k);
  const frame = frameOf(land.terrain.spec);
  const uniforms = {
    uClip: { value: ground },
    uClipOrigin: { value: origins },
    uClipLayer: { value: layers },
    uCoverRegions: { value: coverRegions },
    uCoverShares: { value: coverShares },
    uTrailPlace: { value: places },
    uGroundN: { value: frame.n },
    uGroundOrigin: { value: frame.origin },
    uGroundSpacing: { value: frame.spacing },
    uNearPond: { value: nearPond },
    uLand: { value: landHalf(land.terrain) },
    uWildBase: { value: 0 },
  };
  const show = (k: number): void => {
    const o = land.origins[k] as { x: number; z: number };
    (origins[k] as THREE.Vector2).set(o.x, o.z);
    layers[k] = land.layers[k] as number;
  };
  land.onMoved = (k, fresh) => {
    show(k);
    if (!fresh) return;
    for (const t of textures) {
      t.addLayerUpdate(land.layers[k] as number);
      t.needsUpdate = true;
    }
  };
  return {
    texture: ground,
    uniforms,
    update(t) {
      const world = frameOf(t.spec);
      uniforms.uGroundN.value = world.n;
      uniforms.uGroundOrigin.value = world.origin;
      uniforms.uGroundSpacing.value = world.spacing;
      uniforms.uLand.value = landHalf(t);
      uniforms.uWildBase.value = wildBase(t);
      for (let k = 0; k < levels; k++) show(k);
      for (const tex of textures) {
        tex.clearLayerUpdates();
        tex.needsUpdate = true;
      }
    },
  };
}

/**
 * The sand beside water, meters: `narrow` along a straight stretch and the outside of a bend, `wide` round the
 * inside of a bend and round a pond, between a contour curvature of `straight` and `curved` (one over the radius), measured
 * `along` meters either way along the shore's contour.
 */
export const BANKS = { narrow: 0.7, wide: 2.6, straight: 0.012, curved: 0.04, along: 2.5 } as const;

/** GLSL that reads the ground texture with the mesh's own triangle interpolation. */
export const GROUND_SAMPLE_GLSL = /* glsl */ `
uniform highp sampler2DArray uClip;
uniform vec2 uClipOrigin[${CLIP.levels}];
// The layer each level is read from: its own, but while a painting of a far place is drawn (PageLand.aside).
uniform int uClipLayer[${CLIP.levels}];
uniform float uGroundN;
uniform float uGroundOrigin;
uniform float uGroundSpacing;
uniform highp sampler2DArray uNearPond;
// A point in level k's grid units, where its samples lie on whole numbers.
vec2 clipGrid(vec2 xz, int k) { return xz / (uGroundSpacing * exp2(float(k))) - uClipOrigin[k]; }
// Whether level k's window holds the cell around grid point g, with room to spare.
bool clipHolds(vec2 g, float margin) { return all(greaterThanEqual(g, vec2(margin))) && all(lessThan(g, vec2(${CLIP.size}.0 - 1.0 - margin))); }
// Texel i of level k, held within the window.
ivec3 clipAt(ivec2 i, int k) { return ivec3(clamp(i, ivec2(0), ivec2(${CLIP.size - 1})), uClipLayer[k]); }
vec4 clipTexel(ivec2 i, int k) { return texelFetch(uClip, clipAt(i, k), 0); }
// The finest level whose window holds a point's nearest sample, for readers of that one sample.
int clipNearest(vec2 xz) {
  for (int k = 0; k < ${CLIP.levels - 1}; k++) if (clipHolds(clipGrid(xz, k), 1.0)) return k;
  return ${CLIP.levels - 1};
}
// Level k between its samples, with the mesh's own triangle interpolation.
vec4 clipSample(vec2 xz, int k) {
  vec2 g = clipGrid(xz, k);
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  vec4 h00 = clipTexel(i, k);
  vec4 h10 = clipTexel(i + ivec2(1, 0), k);
  vec4 h01 = clipTexel(i + ivec2(0, 1), k);
  vec4 h11 = clipTexel(i + ivec2(1, 1), k);
  if (f.x + f.y <= 1.0) return h00 + f.x * (h10 - h00) + f.y * (h01 - h00);
  return h11 + (1.0 - f.x) * (h01 - h11) + (1.0 - f.y) * (h10 - h11);
}
// The level to read a point from between samples: the finest whose window holds it, with room for its cell; and
// how far it blends into the next level (0 to 1, in blend) over its window's last few samples. Every reader of the
// clipmap between samples follows this rule.
int clipLevel(vec2 xz, out float blend) {
  for (int k = 0; k < ${CLIP.levels - 1}; k++) {
    vec2 g = clipGrid(xz, k);
    if (!clipHolds(g, 2.0)) continue;
    float edge = min(min(g.x, g.y), min(${CLIP.size}.0 - 1.0 - g.x, ${CLIP.size}.0 - 1.0 - g.y));
    blend = 1.0 - smoothstep(2.0, 18.0, edge);
    return k;
  }
  blend = 0.0;
  return ${CLIP.levels - 1};
}
// A point's place on the lattice, in samples from its first, held within the lattice, whose edge carries on past
// it: the covers and the trails read the land from here.
vec2 clipLattice(vec2 xz) { return clamp((xz - uGroundOrigin) / uGroundSpacing, vec2(0.0), vec2(uGroundN - 1.001)); }
// That place in level k's grid units. At level 0 it is the lattice's own, less a whole number, so the covers and
// the trails take there the very samples and weights they took from the whole lattice.
vec2 clipLatticeGrid(vec2 lattice, int k) {
  float s = exp2(float(k));
  return lattice / s - (uClipOrigin[k] - uGroundOrigin / (uGroundSpacing * s));
}
// The world point at a place on the lattice.
vec2 clipWorld(vec2 lattice) { return uGroundOrigin + lattice * uGroundSpacing; }
// Height, water level, distance to the water and signed distance to a trail's edge (x, y, z, w).
vec4 groundSample4(vec2 xz) {
  float a;
  int k = clipLevel(xz, a);
  vec4 here = clipSample(xz, k);
  return a > 0.0 ? mix(here, clipSample(xz, k + 1), a) : here;
}
vec3 groundSample(vec2 xz) { return groundSample4(xz).xyz; }
vec2 groundAt(vec2 xz) { return groundSample(xz).xy; }
// How far from the water its sand runs at a point beside it, meters, for the sand banks and the grass's edge alike:
// ${BANKS.narrow.toFixed(2)} along a straight stretch and the outside of a bend, out to ${BANKS.wide.toFixed(2)} where the water wraps
// round the land, the point bar inside a bend a stream leaves bare, and round a pond. The curve is the shore's own, along its contour:
// where water wraps round the land the shore falls either way along it.
float bankWidth(vec2 xz, float shore) {
  if (shore > ${BANKS.wide.toFixed(1)} + 1.0) return ${BANKS.narrow.toFixed(2)};
  // A pond keeps its full ring of sand: the land marks each sample whose nearest water is a pond's.
  int k = clipNearest(xz);
  if (texelFetch(uNearPond, clipAt(ivec2(floor(clipGrid(xz, k) + 0.5)), k), 0).r > 0.0) return ${BANKS.wide.toFixed(2)};
  float e = 0.75;
  vec2 g = vec2(groundSample(xz + vec2(e, 0.0)).z - groundSample(xz - vec2(e, 0.0)).z, groundSample(xz + vec2(0.0, e)).z - groundSample(xz - vec2(0.0, e)).z);
  float len = length(g);
  if (len < 1e-3) return ${BANKS.narrow.toFixed(2)};
  vec2 t = vec2(-g.y, g.x) / len;
  float h = ${BANKS.along.toFixed(1)};
  float curve = (groundSample(xz + t * h).z + groundSample(xz - t * h).z - 2.0 * shore) / (h * h);
  return mix(${BANKS.narrow.toFixed(2)}, ${BANKS.wide.toFixed(2)}, smoothstep(${BANKS.straight.toFixed(3)}, ${BANKS.curved.toFixed(3)}, -curve));
}
`;


/**
 * The wild land past the hand-over circle, the twin of `wildHeightAt` and
 * `wildNoise` in @gaia/terrain: the same integer hash, so the drawn ground
 * and the ground the walk stands on agree. Needs GROUND_SAMPLE_GLSL first.
 */
export const WILD_GLSL = /* glsl */ `
uniform float uLand;
uniform float uWildBase;
float wildHash(ivec2 i, int octave) {
  uint h = (uint(i.x) * 0x27d4eb2du) ^ (uint(i.y) * 0x165667b1u) ^ (uint(octave + 1) * 0x5bd1e995u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  h ^= h >> 15u;
  return float(h) / 4294967296.0;
}
float wildNoise(vec2 p) {
  float sum = 0.0;
  float amp = 1.0;
  float norm = 0.0;
  float wave = ${WILDS.wavelength.toFixed(1)};
  for (int o = 0; o < ${WILDS.octaves}; o++) {
    vec2 g = p / wave;
    vec2 i = floor(g);
    vec2 f = g - i;
    vec2 u = f * f * (3.0 - 2.0 * f);
    ivec2 c = ivec2(i);
    float a = wildHash(c, o);
    float b = wildHash(c + ivec2(1, 0), o);
    float e = wildHash(c + ivec2(0, 1), o);
    float d = wildHash(c + ivec2(1, 1), o);
    sum += amp * (a + (b - a) * u.x + (e - a + (a - b - e + d) * u.x) * u.y - 0.5) * 2.0;
    norm += amp;
    amp *= 0.5;
    wave *= 0.5;
  }
  return sum / norm;
}
// Whether a point lies past the land's square, and how far: negative inside it.
bool inWild(vec2 xz) { return max(abs(xz.x), abs(xz.y)) > uLand; }
float wildPast(vec2 xz) {
  vec2 q = abs(xz) - uLand;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
float wildHeight(vec2 xz) {
  vec2 e = clamp(xz, -uLand, uLand);
  float edge = groundSample(e).x;
  float past = length(xz - e);
  float w = clamp((past - ${WILDS.hillsIn[0].toFixed(1)}) / ${(WILDS.hillsIn[1] - WILDS.hillsIn[0]).toFixed(1)}, 0.0, 1.0);
  // The hills' noise only where they have begun to swell.
  float hill = w > 0.0 ? clamp(wildNoise(xz * ${WILDS.hillScale.toFixed(3)} + vec2(5000.0, -3000.0)) * 1.6, -1.0, 1.0) : 0.0;
  float roll = uWildBase + clamp(wildNoise(xz) * 1.6, -1.0, 1.0) * ${(WILDS.variation / 2).toFixed(2)} + w * w * (3.0 - 2.0 * w) * hill * ${(WILDS.hills / 2).toFixed(2)};
  float s = clamp(past / ${WILDS.settle.toFixed(1)}, 0.0, 1.0);
  return edge + (roll - edge) * s * s * (3.0 - 2.0 * s);
}
// The ground's height anywhere, as the walk stands on it.
float groundHeight(vec2 xz) { return inWild(xz) ? wildHeight(xz) : groundSample(xz).x; }
// The wild's covers, twins of wildShare, wildScrub and wildPatch in
// @gaia/terrain, which the thickets and the field map read: how much of the
// wild's own cover grows at a point, none on the land and all of it some way
// out, drifting in from the land's covers in islands.
float wildShare(vec2 xz) {
  float past = wildPast(xz);
  if (past < -40.0) return 0.0;
  return smoothstep(0.0, 1.0, (past - 20.0 + wildNoise(xz * 8.0 + 311.0) * 55.0) / 22.0);
}
// Where the wild runs to scrub, 0 to 1, in patches a few hundred meters across;
// the wild's thickets gather there too.
float wildScrub(vec2 xz) { return smoothstep(-0.1, 0.5, wildNoise(xz * 0.6 + 1000.0)); }
// Which of the wild's two covers grows at a point, 0 to 1, in broad swathes a hundred meters and more across.
float wildPatch(vec2 xz) { return smoothstep(-0.3, 0.3, wildNoise(xz * 1.5 + 97.0)); }
`;

/** The rings around the person: how many, and how many quads on a side each. */
export const RINGS = {
  levels: 5,
  /** Quads per side of every ring; ring k's quads are 2^k lattice spacings wide, so it reaches 2^k * 128 m each way. */
  quads: 256,
  /** Quad size of the whole-world mesh a view from above draws, and of the mirror's innermost ring, in lattice spacings. */
  coarse: 4,
  /** Quads per side of each of the mirror's rings: with quads `coarse` times as large, about six of the mirror's pixels each at any distance. */
  mirrorQuads: 128,
} as const;

/** The rings' center moves in steps of the coarsest ring's quad, so every ring's grid stays on its own lattice samples. */
const SNAP = 2 ** (RINGS.levels - 1);

const VERT = /* glsl */ `
varying float vTrail;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vWater;
varying float vShore;
#ifdef WILDS
attribute float aWater;
attribute float aShore;
attribute float aTrail;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normal;
  vWater = aWater;
  vShore = aShore;
  vTrail = aTrail;
  gl_Position = projectionMatrix * viewMatrix * world;
}
#else
// position: a vertex's column and row on its ring's grid, and the ring.
${GROUND_SAMPLE_GLSL}
${WILD_GLSL}
uniform vec2 uCenter;
uniform vec2 uViewer;
uniform float uBase;
uniform float uMorph;
uniform float uQuads;
uniform float uLevels;
uniform float uSnap;

uniform float uBaseLevel;
// The clip level a ring of the given level draws from: its quads are as wide as that level's samples.
int ringLevel(float ring) { return min(int(ring + uBaseLevel + 0.5), ${CLIP.levels - 1}); }
// Height, water level, distance to water and to a trail's edge at a sample of level k, or of the first coarser level
// whose window holds it.
vec4 latticeAt(vec2 xz, int level) {
  for (int k = level; k < ${CLIP.levels}; k++) {
    vec2 g = clipGrid(xz, k);
    if (clipHolds(g, 1.0) || k == ${CLIP.levels - 1}) return clipTexel(ivec2(floor(g + 0.5)), k);
  }
  return vec4(0.0);
}

struct GroundVertex { float y; float water; float shore; float trail; vec3 normal; };

// A lattice sample's height on the land, the wild land's past it.
float heightOf(vec2 q, int level) { return inWild(q) ? wildHeight(q) : latticeAt(q, level).x; }

// A vertex on a grid of quads s meters wide: its height, water depth, shore
// and trail distances, and the normal from its grid neighbors. The wild land
// has no water and no trails.
GroundVertex vertexAt(vec2 q, float s, int level) {
  float gx = (heightOf(q + vec2(s, 0.0), level) - heightOf(q - vec2(s, 0.0), level)) / (2.0 * s);
  float gz = (heightOf(q + vec2(0.0, s), level) - heightOf(q - vec2(0.0, s), level)) / (2.0 * s);
  vec3 n = normalize(vec3(-gx, 1.0, -gz));
  if (inWild(q)) return GroundVertex(wildHeight(q), -5.0, ${SHORE_CAP.toFixed(1)}, ${TRAILS.reach.toFixed(1)}, n);
  vec4 c = latticeAt(q, level);
  return GroundVertex(c.x, c.y > -500.0 ? c.y - c.x : -5.0, c.z, c.w, n);
}

void main() {
  float s = uBase * exp2(position.y);
  vec2 p = uCenter + position.xz * s;
  int level = ringLevel(position.y);
  GroundVertex v = vertexAt(p, s, level);
  float y = v.y;
  float water = v.water;
  float shore = v.shore;
  float trail = v.trail;
  vec3 n = v.normal;
  if (uMorph > 0.5 && position.y < uLevels - 1.5) {
    // Fully the next ring's surface wherever the next ring could take over
    // once the rings move, and not at all where the inner ring could.
    float reach = uQuads * 0.5 * s;
    float d = max(abs(p.x - uViewer.x), abs(p.y - uViewer.y));
    float start = position.y < 0.5 ? reach * 0.5 : reach * 0.5 + uSnap * 0.5;
    float a = smoothstep(start, reach - uSnap * 0.5, d);
    if (a > 0.0) {
      // The next ring's surface here: its vertex, or the middle of its edge or
      // of its cell's diagonal, which runs as the lattice splits its cells.
      vec2 odd = mod(position.xz, 2.0);
      vec2 e = odd.x > 0.5 && odd.y > 0.5 ? vec2(s, -s) : odd.x > 0.5 ? vec2(s, 0.0) : odd.y > 0.5 ? vec2(0.0, s) : vec2(0.0);
      GroundVertex c0 = vertexAt(p + e, 2.0 * s, level);
      GroundVertex c1 = vertexAt(p - e, 2.0 * s, level);
      y = mix(y, 0.5 * (c0.y + c1.y), a);
      water = mix(water, 0.5 * (c0.water + c1.water), a);
      shore = mix(shore, 0.5 * (c0.shore + c1.shore), a);
      trail = mix(trail, 0.5 * (c0.trail + c1.trail), a);
      n = mix(n, 0.5 * (c0.normal + c1.normal), a);
    }
  }
  vec4 world = vec4(p.x, y, p.y, 1.0);
  vWorld = world.xyz;
  vNormal = n;
  vWater = water;
  vShore = shore;
  vTrail = trail;
  gl_Position = projectionMatrix * viewMatrix * world;
}
#endif
`;

const FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
${GROUND_SAMPLE_GLSL}
${REGIONS_GLSL}
${TUFT_GLSL}
${WILD_GLSL}
${TRAIL_GLSL}
${VITALITY_GLSL}
uniform vec3 uTrailEarth;
varying float vTrail;
uniform vec3 uDry;
uniform vec3 uBare;
uniform vec3 uSand;
uniform vec3 uBed;
uniform vec2 uHeightRange;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vWater;
varying float vShore;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}
${SWARD_GLSL}
void main() {
#ifdef WILDS
  // Over the land's square the whole-world mesh draws the ground.
  if (!inWild(vWorld.xz)) discard;
#endif
  vec3 n = normalize(vNormal);
  float broad = fbm(vWorld.xz * 0.045);
  float fine = fbm(vWorld.xz * 0.6);
  // The regions' covers, blended where their heights blend. Low ground is
  // lush and deep; high ground is lighter and drier.
  GroundCover cover = groundCoverAt(vWorld.xz);
  // Past the land the wild's own covers drift in, in islands, and take over.
  float wild = wildShare(vWorld.xz);
  if (wild > 0.0) cover = mixCover(cover, wildCover(wildPatch(vWorld.xz)), wild);
  // Declined ground (VITALITY_GLSL) dries toward straw, its dabs and all.
  float decline = declineOf(landVitality(vWorld.xz).x);
  if (decline > 0.0) {
    float dry = ${GROUND_DECLINE.dry.toFixed(3)} * decline;
    cover.low = mix(cover.low, uStrawLow, dry);
    cover.high = mix(cover.high, uStrawHigh, dry);
    cover.tip = mix(cover.tip, uStrawTip, dry);
  }
  float rel = clamp((vWorld.y - uHeightRange.x) / max(1.0, uHeightRange.y - uHeightRange.x), 0.0, 1.0);
  vec3 albedo = sward(vWorld, cover.low, cover.high, cover.tip, (broad - 0.5) * 0.5 + (rel - 0.4) * 0.45);
  // A clumped cover leaves its own soil showing between the tufts.
  albedo = mix(cover.soil, albedo, mix(1.0, tuftMask(vWorld.xz) * 0.75, cover.clump));
  albedo = mix(albedo, uDry, smoothstep(0.6, 0.82, fbm(vWorld.xz * 0.08 + 40.0) + rel * 0.18) * 0.28);
  // Bare earth shows on steep risers and banks.
  float steep = 1.0 - n.y;
  albedo = mix(albedo, uBare, smoothstep(0.075, 0.17, steep + (fine - 0.5) * 0.05) * 0.8);
  // And in patches where the ground has declined, where the grass leaves it bare.
  if (decline > 0.0) {
    float bare = bareEarth(vWorld.xz, decline, 0.1);
    if (bare > 0.0) {
      // Painted in the same short dabs as the sward, in the earth's own tones.
      vec3 earth = mix(cover.soil, uBareEarth, 0.88);
      albedo = mix(albedo, sward(vWorld, earth * 0.9, earth * 1.04, earth * 1.12, (broad - 0.5) * 0.4) * (0.96 + 0.1 * fine), bare);
    }
  }
  // Hollows hold a deeper green; the broad patches carry more contrast.
  albedo *= 0.94 + 0.12 * smoothstep(0.2, 0.8, broad);
  // In the wild, low brush darkens the ground in dabs several meters across,
  // crowding together where the wild runs to scrub, so it reads as brush from afar.
  if (wild > 0.0) {
    float scrub = wildScrub(vWorld.xz);
    float brush = smoothstep(0.62, 0.74, fbm(vWorld.xz * 0.13 + 53.0) + wildNoise(vWorld.xz * 2.2 + 41.0) * 0.12 + scrub * 0.16);
    albedo = mix(albedo, cover.low * vec3(0.52, 0.6, 0.42), brush * wild * 0.85);
    albedo *= 1.0 - 0.08 * scrub * wild;
  }
  // Sand banks, darker and wet at the waterline, a narrow strip along a straight stretch and wider where the
  // waterline curves (bankWidth), with a ragged edge where the grass (which reads the same distance) thins out.
  float wide = bankWidth(vWorld.xz, vShore);
  float sand = 1.0 - smoothstep(wide * 0.46, wide, vShore + (fine - 0.5) * 1.2 * wide / ${BANKS.wide.toFixed(1)});
  albedo = mix(albedo, uSand * mix(0.82, 1.0, smoothstep(0.2, 1.0, vShore)), sand * 0.85);
  // Trails: worn earth with a ragged, grassy edge, darker and smoother down
  // the trodden middle, with a dulled, trampled margin just outside.
  // The finest ring's vertices are the lattice's own samples, so its varying
  // is exact; the coarse overview mesh reads the texture at full resolution.
#ifdef TRAIL_TEXTURE
  float edge = trailAt(vWorld.xz);
#else
  float edge = vTrail;
#endif
  // Each trail's wear follows the vitality of the two entities it joins.
  float wear = edge < 2.0 ? trailWearAt(vWorld.xz) : 0.0;
  if (wear > 0.0) {
    float ragged = (fine - 0.5) * 0.8 + (noise(vWorld.xz * 2.3) - 0.5) * 0.45;
    float tread = (1.0 - smoothstep(-0.4, 0.35, edge + ragged * (0.6 + 0.5 * (1.0 - wear)))) * wear;
    vec3 earth = mix(uTrailEarth, cover.soil, 0.22) * (0.88 + 0.22 * fine);
    earth *= 1.0 - 0.12 * (1.0 - smoothstep(-0.9, -0.25, edge));
    earth = mix(earth, earth * 1.22 + 0.03, step(0.8, noise(vWorld.xz * 7.0)) * 0.6);
    albedo = mix(albedo, earth, tread);
    float margin = (1.0 - smoothstep(0.0, 1.6, edge + ragged)) * (1.0 - tread) * 0.4 * wear;
    albedo = mix(albedo, mix(albedo, uDry, 0.55), margin);
  }
  albedo = mix(albedo, uBed, smoothstep(0.1, 0.5, vWater));
  albedo *= 0.94 + 0.1 * fine;

  // Hillshade: slopes turned to the sun brighten and slopes turned away darken
  // more than plain diffuse would, so low relief still reads.
  float level = max(uSunDirection.y, 0.05);
  float nDotL = max(level + (dot(n, uSunDirection) - level) * 1.6, 0.0);
  float shadow = mix(0.45, 1.0, sunShadow(vWorld, n, 0.0015));
  float direct = nDotL * shadow;
  // Half cel, half smooth: slopes read as painted planes without hard contour bands.
  float light = mix(direct, softCel(direct), 0.5) * sunUp();
  vec3 toned = nightTone(albedo);
  vec3 lit = toned * (uSunColor * uSunIntensity * light + uAmbientColor * uAmbientIntensity);
  vec3 shadowed = toned * uShadowColor * (uAmbientIntensity + 0.75);
  vec3 color = mix(shadowed, lit, clamp(light + 0.3, 0.0, 1.0));
  color += nightLight(albedo, n, vWorld, 0.3, mix(1.0, shadow, uMoonShadow));

  gl_FragColor = vec4(aerial(shoulder(color), vWorld), 1.0);
}
`;

export interface GroundMesh {
  /** The ground around the person, as nested rings that follow them. */
  readonly fine: THREE.Mesh;
  /** The whole lattice, coarsely, for a view from above and its water's mirror: empty until `aerial` builds it. */
  readonly coarse: THREE.Mesh;
  /**
   * The rings at `RINGS.coarse` times their quad size, around the person,
   * for the water's mirror while they walk: as fine as the whole-world mesh
   * near them, and as cheap however large the world grows.
   */
  readonly mirror: THREE.Mesh;
  /** A coarse ring of the wild land past the rim, for views from above: empty until `aerial` builds it. Walking, the rings draw the wild land. */
  readonly wilds: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  /** Takes on a new bake. */
  update(t: Terrain): void;
  /** Builds `coarse` and `wilds` for the land now baked, and again on every bake after, since only a view from above draws them. */
  aerial(): void;
  /** Centers the rings on the person; call every frame they walk. */
  follow(x: number, z: number): void;
}

/** A grid of quads, `quads` on a side around its center, as columns and rows; `keep` says which quads to draw. */
function grid(quads: number, level: number, keep: (i: number, j: number) => boolean, into: { pos: number[]; index: number[] }): void {
  const first = into.pos.length / 3;
  const side = quads + 1;
  const h = quads / 2;
  for (let j = 0; j <= quads; j++) for (let i = 0; i <= quads; i++) into.pos.push(i - h, level, j - h);
  for (let j = 0; j < quads; j++) {
    for (let i = 0; i < quads; i++) {
      if (!keep(i - h, j - h)) continue;
      const a = first + j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      // Split along b-c, as the lattice's heightAt interpolates.
      into.index.push(a, c, b, b, c, d);
    }
  }
}

function meshOf(pos: number[], index: number[], material: THREE.ShaderMaterial): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  const mesh = new THREE.Mesh(g, material);
  // The vertex shader places every vertex; the grid's own positions mean nothing to culling.
  mesh.frustumCulled = false;
  return mesh;
}

/** The rings: ring 0 whole, each ring after it with a hole where the ring inside it lies. */
function ringsMesh(material: THREE.ShaderMaterial, q: number = RINGS.quads): THREE.Mesh {
  const into = { pos: [] as number[], index: [] as number[] };
  for (let level = 0; level < RINGS.levels; level++) {
    grid(q, level, (i, j) => level === 0 || !(i >= -q / 4 && i < q / 4 && j >= -q / 4 && j < q / 4), into);
  }
  return meshOf(into.pos, into.index, material);
}

/** The wild ring as geometry the ground material can draw: no water anywhere near. */
function wildsGeometry(t: Terrain): THREE.BufferGeometry {
  const ring = wildsRing(t);
  const count = ring.positions.length / 3;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(ring.positions, 3));
  g.setAttribute("aWater", new THREE.BufferAttribute(new Float32Array(count).fill(-5), 1));
  g.setAttribute("aShore", new THREE.BufferAttribute(new Float32Array(count).fill(SHORE_CAP), 1));
  g.setAttribute("aTrail", new THREE.BufferAttribute(new Float32Array(count).fill(TRAILS.reach), 1));
  g.setIndex(new THREE.BufferAttribute(ring.indices, 1));
  g.computeVertexNormals();
  return g;
}

export function createGround(t: Terrain, light: SceneLight, covers: RegionCovers, tex: GroundTexture): GroundMesh {
  const uniforms = {
    ...light,
    ...covers.uniforms,
    ...tex.uniforms,
    ...trailUniforms,
    ...vitalityUniforms,
    uTrailEarth: { value: hexToVec3(0x9c8462) },
    uDry: { value: hexToVec3(0xbba878) },
    uBare: { value: hexToVec3(0x9a7d58) },
    uSand: { value: hexToVec3(0xcdbb8a) },
    uBed: { value: hexToVec3(0x6d7a58) },
    uHeightRange: { value: new THREE.Vector2(t.report.min, t.report.max) },
    uQuads: { value: RINGS.quads },
    uLevels: { value: RINGS.levels },
    uSnap: { value: SNAP * t.lattice.spacing },
  };
  const ringUniforms = { ...uniforms, uCenter: { value: new THREE.Vector2() }, uViewer: { value: new THREE.Vector2() }, uBase: { value: t.lattice.spacing }, uBaseLevel: { value: 0 }, uMorph: { value: 1 } };
  const coarseUniforms = { ...uniforms, uCenter: { value: new THREE.Vector2() }, uViewer: { value: new THREE.Vector2() }, uBase: { value: t.lattice.spacing * RINGS.coarse }, uBaseLevel: { value: Math.log2(RINGS.coarse) }, uMorph: { value: 0 } };
  const material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: ringUniforms });
  const fine = ringsMesh(material);
  // The coarse grid seen from above reads the trails from the texture at full resolution.
  const coarseMaterial = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: coarseUniforms, defines: { TRAIL_TEXTURE: "" } });
  // The whole lattice: the same grid, one level, centered on the world.
  const coarseOf = (l: { readonly n: number; readonly spacing: number }): THREE.Mesh => {
    const quads = 2 * Math.ceil(((l.n - 1) * l.spacing) / (2 * RINGS.coarse * l.spacing));
    const into = { pos: [] as number[], index: [] as number[] };
    grid(quads, 0, () => true, into);
    return meshOf(into.pos, into.index, coarseMaterial);
  };
  const coarse = meshOf([], [], coarseMaterial);
  let coarseN = 0;
  const mirrorUniforms = { ...uniforms, uCenter: { value: new THREE.Vector2() }, uViewer: { value: new THREE.Vector2() }, uBase: { value: t.lattice.spacing * RINGS.coarse }, uBaseLevel: { value: Math.log2(RINGS.coarse) }, uMorph: { value: 1 }, uQuads: { value: RINGS.mirrorQuads }, uSnap: { value: SNAP * t.lattice.spacing * RINGS.coarse } };
  const mirror = ringsMesh(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: mirrorUniforms, defines: { TRAIL_TEXTURE: "" } }), RINGS.mirrorQuads);
  mirror.visible = false;
  const wilds = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, defines: { WILDS: "" } }));
  wilds.frustumCulled = false;
  let baked = t;
  let aerial = false;
  const fillAerial = (): void => {
    const world = frameOf(baked.spec);
    if (world.n !== coarseN) {
      coarseN = world.n;
      coarse.geometry.dispose();
      coarse.geometry = coarseOf(world).geometry;
    }
    wilds.geometry.dispose();
    wilds.geometry = wildsGeometry(baked);
  };
  const update = (next: Terrain): void => {
    baked = next;
    uniforms.uHeightRange.value.set(next.report.min, next.report.max);
    if (aerial) fillAerial();
  };
  update(t);
  const snap = SNAP * t.lattice.spacing;
  return {
    fine,
    coarse,
    mirror,
    wilds,
    material,
    update,
    aerial() {
      if (aerial) return;
      aerial = true;
      fillAerial();
    },
    follow(x, z) {
      ringUniforms.uViewer.value.set(x, z);
      ringUniforms.uCenter.value.set(Math.round(x / snap) * snap, Math.round(z / snap) * snap);
      const mirrorSnap = snap * RINGS.coarse;
      mirrorUniforms.uViewer.value.set(x, z);
      mirrorUniforms.uCenter.value.set(Math.round(x / mirrorSnap) * mirrorSnap, Math.round(z / mirrorSnap) * mirrorSnap);
    },
  };
}
