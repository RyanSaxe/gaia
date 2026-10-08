// A realized plant as Three.js meshes. One ShaderMaterial per part applies
// the vitality channels on the GPU, so vitality is a uniform and changing it
// never rebuilds geometry.

import * as THREE from "three";
import { CUT, type Part, SPRAYS, type Swatch } from "@gaia/schema";
import { CHANNEL_MATH, DETAIL, type Realized, pieceFrames, spinAt } from "@gaia/realize";
import { LIGHT_GLSL, type SceneLight } from "./light.ts";
import { WIND_GLSL } from "./wind.ts";
import { createSmokeMaterial } from "./smoke.ts";

const f = (x: number): string => x.toFixed(4);

/** Where a fir frond's heart is gone and where it is whole, in multiples of its own size from the eye. */
const CORE_NEAR = { gone: 3, whole: 8 } as const;

// The scalar channels ride four to an attribute (see \`geometryOf\`), so an
// instanced plant stays well inside WebGL's 16 attribute slots.
const CHANNELS_GLSL = /* glsl */ `
attribute vec4 aLook;
attribute vec4 aLife;
attribute vec3 aPivot;
attribute vec3 aBough;
attribute vec3 aTwig;
attribute vec4 aPiece;
attribute vec3 aCutout;
#define aShade aLook.x
#define aTint aLook.y
#define aLoss aLook.z
#define aDroop aLook.w
#define aWither aLife.x
#define aGlow aLife.y
#define aClose aLife.z
#define aLeave aLife.w
uniform float uVitality;
uniform float uSeed;
uniform vec3 uEye;
uniform float uDetail;
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

// A spray's leaves drop in place, cut away per fragment (see sprayCut), so
// only other pieces collapse.
bool onSpray() {
  float form = floor(aCutout.z);
  return ${[...SPRAYS].map((c) => `abs(form - ${c.toFixed(1)}) < 0.5`).join(" || ")};
}

// Loss collapses a piece onto its pivot over a short band, and at night a
// piece that closes (a flower's petals) folds part way toward it, in the
// plant's rest shape.
vec3 applyChannels(vec3 p) {
  vec3 off = (p - aPivot) * (1.0 - aClose * uNightness * 0.7);
  float keep = aLoss > 0.0 && !onSpray() ? smoothstep(aLoss, aLoss + ${f(CHANNEL_MATH.lossBand)}, uVitality) : 1.0;
#ifdef RUIN
  keep *= aGrow > 0.0 ? 1.0 - smoothstep(aGrow, aGrow + ${f(CHANNEL_MATH.lossBand)}, uVitality) : 1.0;
  return aPivot + pieceTurn() * (off * keep);
#else
  return aPivot + off * keep;
#endif
}

// Droop, last of all: the whole bough bends down about its joint, keeping
// each point's distance from it, so whatever the bough carries sags with it.
vec3 applyDroop(vec3 p, vec3 bough) {
  vec3 o = p - bough;
  float s = aDroop * (1.0 - uVitality);
  float d = length(o);
  if (s <= 0.0 || d <= 1e-5) return p;
  o.y -= s * d * ${f(CHANNEL_MATH.sag)};
  return bough + normalize(o) * d;
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

// Distance thins detail (DETAIL in @gaia/realize): each piece leaves whole at
// its own seeded distance from the person's eye, smallest first, shrinking to
// its center over the last stretch. Until then a piece past its start grows
// with distance, so it keeps covering about a pixel and a drift keeps its
// color. Every pass measures from the eye, so shadows and the mirror show the
// same pieces. Returns how much to scale the piece about its center, or -1
// once it has left.
float pieceScale(mat4 model) {
  if (uDetail < 0.5) return 1.0;
  float d = distance((model * vec4(aPiece.xyz, 1.0)).xyz, uEye);
  if (d >= aLeave) return -1.0;
  float grow = max(1.0, d / max(aPiece.w, 1e-3));
  return grow * (1.0 - smoothstep(aLeave * ${f(1 - DETAIL.band)}, aLeave, d));
}

${WIND_GLSL}
// A level's push in the copy's own frame, so a turned copy bends downwind.
vec3 pushOf(vec3 level, float give, float gust, float phase, vec2 along) {
  return pushAlong(windPush(level, give, uFrequency, gust, uTime, phase), along);
}

// The plant in the wind, level by level (WIND and swayAt in @gaia/realize):
// a leaf flutters on its stalk in a gust, its twig bends about where it
// leaves the bough, the bough about where it leaves the trunk, and the
// whole plant from its base. Each level bends whatever it carries, so
// nothing parts from what holds it. Joints take the copy's own shape.
vec3 applyWind(vec3 p, mat4 model, vec3 root) {
  float give = uWind * uSway;
  if (give <= 0.0) return p;
  vec3 wd = transpose(mat3(model)) * vec3(WIND_DIR.x, 0.0, WIND_DIR.y);
  vec2 along = normalize(wd.xz + vec2(1e-6, 0.0));
  if (uFlutter > 0.0) {
    vec3 j = applyVariety(aPivot, root);
    float g = gustAt((model * vec4(j, 1.0)).xz, uTime);
    float amp = give * WIND_LEAF.y * g * g * sin(uTime * (0.5 + uFrequency) * WIND_LEAF.z + jointPhase(aPivot, uSeed));
    p = windBend(p, j, normal * amp, WIND_SMALL.y);
  }
  if (distance(aTwig, aBough) > 1e-4) {
    vec3 j = applyVariety(aTwig, root);
    float g = gustAt((model * vec4(j, 1.0)).xz, uTime);
    p = windBend(p, j, pushOf(WIND_TWIG, give, g, jointPhase(aTwig, uSeed), along), WIND_SMALL.x);
  }
  if (length(aBough) > 1e-4) {
    vec3 j = applyVariety(aBough, root);
    float g = gustAt((model * vec4(j, 1.0)).xz, uTime);
    p = windBend(p, j, pushOf(WIND_BOUGH, give, g, jointPhase(aBough, uSeed), along), clamp(WIND_REACH.x * uHeight, WIND_REACH.y, WIND_REACH.z));
  }
  return bendUp(p, pushOf(WIND_TRUNK, give, gustAt(root.xz, uTime), uSeed * 6.28318530718, along), uHeight);
}
`;

// Leaf cards: each card is cut to its leaves by a procedural mask, so a
// canopy has leafy edges with no texture. Values are signed, about a leaf's
// width: positive inside. As a card shrinks on screen its leaves merge into
// the card's plain outline, so distant canopies stay soft painted masses
// instead of sparkling. CUT in @gaia/schema names the cuts.
const CUTOUT_GLSL = /* glsl */ `
varying vec3 vCut;
varying vec2 vLife;
// A patch (moss) recedes from its edge as vitality falls: its depth shrinks
// before the fragment cuts it, so the edge creeps back smoothly.
vec3 cardCut() {
  vec3 c = aCutout;
  if (abs(floor(c.z) - ${CUT.patch.toFixed(1)}) < 0.5) c.x -= 0.5 * (1.0 - uVitality);
  return c;
}
// A frond's heart stands in for its inner needles only while they merge into
// a mass: as the eye comes near enough to see single needles, it shrinks
// smoothly to its center, so up close the gaps show limbs, deeper needles and
// sky, never a ball. It measures from the eye by its own size, gone within
// ${CORE_NEAR.gone} sizes and whole past ${CORE_NEAR.whole}. Its shadow stays: it stands for the
// crown's dense shade wherever the person walks.
float coreKeep(mat4 model) {
  if (abs(floor(aCutout.z) - ${CUT.core.toFixed(1)}) > 0.5) return 1.0;
  float size = aPiece.w / ${f(DETAIL.reach)};
  float d = distance((model * vec4(aPiece.xyz, 1.0)).xyz, uEye);
  return smoothstep(size * ${f(CORE_NEAR.gone)}, size * ${f(CORE_NEAR.whole)}, d);
}
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
// Two values in [0, 1) for a grid cell, from arithmetic alone (no sine).
vec2 cellHash(vec2 c) {
  vec3 q = fract(vec3(c.xyx) * vec3(0.1031, 0.103, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

// A pointed leaf from the origin along +x, \`len\` long and \`wide\` at its widest.
float leafShape(vec2 q, float len, float wide) {
  float t = clamp(q.x / len, 0.0, 1.0);
  float profile = wide * pow(sin(3.14159 * pow(t, 0.8)), 0.7);
  return min(profile - abs(q.y), min(q.x, len - q.x) * 0.6);
}

// A rounded oval leaf from the origin along +x.
float ovalShape(vec2 q, float len, float wide) {
  float t = clamp(q.x / len, 0.0, 1.0);
  float profile = wide * pow(4.0 * t * (1.0 - t), 0.55) * (1.0 - 0.2 * t);
  return min(profile - abs(q.y), min(q.x, len - q.x) * 0.7);
}

// A palmate leaf facing +x from its stalk: five pointed lobes, the side ones
// shorter, with deep sinuses between them, on a short stalk.
float lobedShape(vec2 q, float size) {
  vec2 c = q - vec2(size * 0.4, 0.0);
  float th = atan(c.y, c.x);
  float lobes = pow(0.5 + 0.5 * cos(th * 8.4), 2.2);
  float reach = size * (0.3 + 0.34 * lobes * (1.0 - 0.45 * smoothstep(0.5, 1.6, abs(th))));
  reach = mix(reach, size * 0.24, smoothstep(1.75, 2.5, abs(th)));
  float stalk = min(0.02 - abs(q.y), min(q.x, size * 0.3 - q.x));
  return max(reach - length(c), stalk);
}

// A leaf drops in place as vitality falls past its own threshold, spread
// about the card's loss: it erodes from its edge, so nothing flies anywhere.
varying vec2 vLife;
float dropAt(float h) {
  if (vLife.x <= 0.0) return 0.0;
  float th = clamp(vLife.x + (h - 0.5) * ${f(2 * CHANNEL_MATH.dropSpread)}, 0.01, 0.95);
  return 1.0 - smoothstep(th, th + ${f(CHANNEL_MATH.lossBand)}, vLife.y);
}
// Where a spray shows its stalk (bark) and its few fresh leaves (stem green).
float gBark = 0.0;
float gGreen = 0.0;

// A five-petaled flower of radius R at the origin, each petal with a small notch.
float flowerShape(vec2 q, float R, float turn) {
  float r = length(q);
  float lobe = cos((atan(q.y, q.x) + turn) * 2.5);
  float petal = 0.5 + 0.5 * pow(abs(lobe), 0.55);
  float notch = 0.16 * pow(abs(lobe), 60.0);
  return (R * (petal - notch) - r) * 0.7;
}

// A spray: a stalk from the card's base (along -1) curving toward its tip,
// with leaves on short stalks alternating along it (kind 0 oval, 1 lobed,
// 3 pointed), or umbels of three or four flowers on fine stalks with a
// small fresh leaf at every third node (kind 2). Returns (distance, tone).
vec2 sprayCut(vec2 p, float seed, float px, int kind) {
  float bend = (fract(seed * 7.13) - 0.5) * 0.5;
  float y = p.y;
  float sx = bend * (y + 1.0) * (y + 1.0) * 0.22;
  float sw = mix(0.026, 0.01, clamp((y + 1.0) * 0.5, 0.0, 1.0));
  float d = min(sw - abs(p.x - sx), min(y + 1.02, 0.78 - y) * 0.5);
  float tone = 0.9;
  float bark = 1.0;
  float green = 0.0;
  int n = kind == 2 ? 6 : 5;
  for (int k = 0; k < 6; k++) {
    if (k >= n) break;
    float t = (float(k) + 0.6) / float(n);
    float ny = -0.8 + 1.55 * t;
    vec2 node = vec2(bend * (ny + 1.0) * (ny + 1.0) * 0.22, ny);
    vec2 r = p - node;
    if (dot(r, r) > 0.42) continue;
    float side = mod(float(k) + floor(seed * 2.0), 2.0) < 1.0 ? 1.0 : -1.0;
    vec2 h = cellHash(vec2(float(k), seed * 113.0));
    float a = mix(0.55 + 0.45 * h.x, 0.1, k == n - 1 ? 1.0 : 0.0);
    vec2 dir = normalize(vec2(side * sin(a), cos(a)));
    if (kind == 2) {
      vec2 c = node + dir * (0.13 + 0.05 * h.y);
      // An umbel reaches about a third of the card from its middle: skip it from farther.
      if (dot(p - c, p - c) < 0.12) {
        for (int m = 0; m < 4; m++) {
          vec2 g = cellHash(vec2(float(m) + 7.0, seed * 59.0 + float(k) * 3.1));
          if (m == 3 && g.x < 0.5) break;
          float ang = float(m) * 2.1 + g.y * 1.2 + seed * 6.2832;
          vec2 fc = c + vec2(cos(ang), sin(ang)) * (0.07 + 0.03 * g.x);
          vec2 seg = fc - node;
          float u = clamp(dot(r, seg) / dot(seg, seg), 0.0, 1.0);
          float ped = 0.012 - length(r - seg * u);
          if (ped > d) { d = ped; tone = 0.8; bark = 0.6; green = 0.0; }
          float R = 0.105 * (0.85 + 0.3 * g.y);
          float di = flowerShape(p - fc, R, g.x * 6.2832) - dropAt(fract(h.x * 3.7 + g.x)) * 0.12;
          float cov = clamp(di / px + 0.5, 0.0, 1.0);
          tone = mix(tone, (0.92 + 0.1 * g.y) * mix(0.9, 1.05, smoothstep(0.1, 0.8, length(p - fc) / R)), cov);
          bark = mix(bark, 0.0, cov);
          green = mix(green, 0.0, cov);
          d = max(d, di);
        }
      }
      if (mod(float(k), 3.0) < 0.5) {
        vec2 ld = normalize(vec2(-dir.x, dir.y * 0.6 + 0.2));
        vec2 q = r - ld * 0.03;
        q = vec2(dot(q, ld), dot(q, vec2(-ld.y, ld.x)));
        float di = ovalShape(q, 0.24, 0.07) - dropAt(h.y) * 0.12;
        float cov = clamp(di / px + 0.5, 0.0, 1.0);
        tone = mix(tone, 0.8 + 0.2 * clamp(q.x / 0.24, 0.0, 1.0), cov);
        bark = mix(bark, 0.0, cov);
        green = mix(green, 1.0, cov);
        d = max(d, di);
      }
    } else {
      float len = (kind == 1 ? 0.5 : kind == 3 ? 0.52 : 0.46) * (1.0 - 0.25 * t) * (0.85 + 0.3 * h.y);
      vec2 q = r - dir * 0.05;
      q = vec2(dot(q, dir), dot(q, vec2(-dir.y, dir.x)));
      float pet = min(0.012 - abs(q.y), min(q.x + 0.05, 0.06 - q.x));
      if (pet > d) { d = pet; tone = 0.8; bark = 0.7; }
      vec2 lq = q - vec2(0.04, 0.0);
      float di = (kind == 1 ? lobedShape(lq, len) : kind == 3 ? leafShape(lq, len, len * 0.24) : ovalShape(lq, len, len * 0.42)) - dropAt(h.x) * 0.4 * len;
      float ti = (0.82 + 0.2 * h.x) * (0.88 + 0.18 * clamp(lq.x / len, 0.0, 1.0));
      ti *= mix(0.88, 1.0, smoothstep(0.0, 0.01 + px, abs(lq.y)));
      float cov = clamp(di / px + 0.5, 0.0, 1.0);
      tone = mix(tone, ti, cov);
      bark = mix(bark, 0.0, cov);
      d = max(d, di);
    }
  }
  gBark = bark * step(0.0, d);
  gGreen = green;
  return vec2(d, tone);
}

// A spray up close, merging far away into a soft scalloped round whose edge
// erodes as its leaves drop, so a far canopy is a painted mass that thins.
vec2 sprayLeaves(vec2 p, float seed, float px, float merged, int kind) {
  vec2 c = merged > 0.999 ? vec2(0.0, 1.0) : sprayCut(p, seed, px, kind);
  vec2 o = p - vec2(0.0, 0.05);
  float outline = 0.8 + 0.07 * cos((atan(o.y, o.x) + seed * 6.2832) * 9.0) - length(o * vec2(1.0, 0.92));
  float bare = vLife.x > 0.0 ? 1.0 - smoothstep(vLife.x, vLife.x + 0.2, vLife.y) : 0.0;
  gBark *= 1.0 - merged;
  gGreen *= 1.0 - merged;
  return vec2(mix(c.x, outline - 1.2 * bare, merged), mix(c.y, 1.0, merged));
}
// Moss on stone: the patch ends where its depth, jittered per vertex, falls
// below a fifth, so the edge follows a soft winding contour.
float patchCut(vec2 p) {
  return (p.x + 0.24 * (p.y - 0.5) - 0.2) * 0.25;
}

// Small lance leaves hanging from a stem, alternating sides.
float strandCut(vec2 p, float seed, float far) {
  // Far away a strand swells and narrows along its length, as its leaves
  // bunch, so a curtain reads as hanging leaves rather than ribbons.
  float plain = 0.55 + 0.1 * sin(p.y * 1.9 + seed * 6.2832) - abs(p.x);
  if (far > 0.999) return plain;
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
  return mix(d, plain, far);
}

// A needle spray: solid along the limb, combed into needles toward a jagged
// fringe, tapering to the tip. Close enough to see single needles, the comb
// reaches in nearly to the limb, so a spray is feathery, never a plate.
float needleCut(vec2 p, float seed, float far, float px) {
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
  float solid = mix(0.22, 0.62, smoothstep(0.03, 0.08, px));
  float d = min(body, max(needle, (solid - u) * edge));
  d = min(d, min(p.y + 0.02, 1.02 - p.y));
  return mix(d, plain, far);
}

// The tone of a frond's heart: it reads only as the shade between needles.
const float CORE_TONE = 0.75;

// The card's leaves at this fragment: x is coverage, y a tone that sets
// leaves apart up close. Solid surfaces are (1, 1); a frond's heart is solid
// and dark. \`thin\` (0 to 1) is how nearly edge-on the card is seen: its
// leaves narrow toward nothing, so a card turning away never shows as a
// sliver or a stippled ghost.
vec2 leafCut(float thin) {
  float form = floor(vCut.z + 0.5 / 1024.0);
  if (form < 0.5) return vec2(1.0);
  if (abs(form - ${CUT.core.toFixed(1)}) < 0.5) return vec2(1.0, CORE_TONE);
  float seed = fract(vCut.z);
  vec2 p = vCut.xy;
  // A pixel's footprint on the card, by its area, so a card seen at a slant
  // keeps its leaves as long as one seen face on of the same size.
  vec2 dx = dFdx(p);
  vec2 dy = dFdy(p);
  float px = max(sqrt(abs(dx.x * dy.y - dx.y * dy.x) * 2.0), 1e-4);
#ifdef SHADOW_PASS
  // Shadows are too soft to show single leaves: cards cast their outline.
  float far = 1.0;
#else
  float far = smoothstep(0.05, 0.16, px);
#endif
  // A spray's small leaves merge sooner than a card's coarser cuts: once they
  // are a few pixels across they read only as the outline's texture.
  float merged = max(far, smoothstep(0.04, 0.11, px));
  vec2 c = form < 1.5 ? sprayLeaves(p, seed, px, merged, 3)
    : form < 2.5 ? vec2(strandCut(p, seed, far), 1.0)
    : form < 3.5 ? vec2(needleCut(p, seed, far, px), 1.0)
    : form < 4.5 ? sprayLeaves(p, seed, px, merged, 0)
    : form < 5.5 ? sprayLeaves(p, seed, px, merged, 1)
    : form < 6.5 ? vec2(patchCut(p), 1.0)
    : sprayLeaves(p, seed, px, merged, 2);
  if (form > 1.5 && form < 3.5 || abs(form - ${CUT.patch.toFixed(1)}) < 0.5) c.y = mix(0.86 + 0.14 * smoothstep(0.0, 0.07, c.x), 1.0, far);
  if (form > 2.5 && form < 3.5) c.y *= 0.9 + 0.1 * smoothstep(0.15, 0.45, abs(fract(p.y * 15.0 - abs(p.x) * 1.3 + seed * 5.0) - 0.5));
  // Edge-on, every leaf erodes from its edge; at fully edge-on nothing is left.
  float d = c.x * (1.0 - thin) - thin * 0.05;
  return vec2(clamp(d / max(fwidth(d), 1e-4) + 0.5, 0.0, 1.0), c.y);
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
  float k = pieceScale(modelMatrix);
  // A piece that has left sits wholly outside the view, so it draws nothing.
  if (k < 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  k *= coreKeep(modelMatrix);
  vec3 root = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 p = applyDroop(applyWind(applyVariety(applyChannels(aPiece.xyz + (position - aPiece.xyz) * k), root), modelMatrix, root), applyVariety(aBough, root));
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * turnedNormal(normal));
#ifdef RUIN
  vRot = rotNow();
  vRest = position;
#endif
  vShade = aShade;
  vTint = aTint;
  vCut = cardCut();
  vLife = vec2(aLoss, uVitality);
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
uniform vec3 uBark;
uniform vec3 uStem;
uniform float uFoliage;
uniform float uLamp;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vShade;
varying float vTint;
varying float vWither;
varying float vGlow;
void main() {
  // A card seen edge-on would show as a sliver: its leaves thin as it turns away.
  float thin = 0.0;
  float form = floor(vCut.z);
  if (form > 0.5 && abs(form - ${CUT.patch.toFixed(1)}) > 0.5 && abs(form - ${CUT.core.toFixed(1)}) > 0.5) {
    vec3 face = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    thin = 1.0 - smoothstep(0.06, 0.45, abs(dot(face, normalize(cameraPosition - vWorld))));
  }
  vec2 cut = leafCut(thin);
  float cover = cut.x;
  if (cover < 0.02) discard;
  // A rotted hole is cut cleanly; its rim darkens like a broken, weathered edge.
  float edge = rotEdge();
  if (edge < 0.0) discard;
  float bright = mix(${f(CHANNEL_MATH.shadeLow)}, ${f(CHANNEL_MATH.shadeHigh)}, vShade) * cut.y * mix(0.45, 1.0, smoothstep(0.0, 0.09, edge));
  vec3 albedo = mix(hueRotate(uHealthy, vTint), uDecline, vWither) * bright;
  // A spray's stalks are bark; a blossom spray's few fresh leaves are the family's stem green.
  albedo = mix(albedo, mix(uStem, uDecline, vWither) * bright, gGreen);
  albedo = mix(albedo, uBark * 0.55, gBark);
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
  vCut = cardCut();
  vLife = vec2(aLoss, uVitality);
#ifdef RUIN
  vRot = rotNow();
  vRest = position;
#endif
  float k = pieceScale(modelMatrix);
  if (k < 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 root = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 p = applyDroop(applyWind(applyVariety(applyChannels(aPiece.xyz + (position - aPiece.xyz) * k), root), modelMatrix, root), applyVariety(aBough, root));
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
}
`;

// Leaf cards cast scalloped shadows: the sun shines through between them.
export const DEPTH_FRAG = /* glsl */ `
precision highp float;
#define SHADOW_PASS
${LEAF_MASK_GLSL}
void main() {
  if (leafCut(0.0).x < 0.5 || rotEdge() < 0.0) discard;
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

/** Interleaves four per-vertex scalars into one vec4 attribute. */
function four(a: Float32Array, b: Float32Array, c: Float32Array, d: Float32Array): THREE.BufferAttribute {
  const out = new Float32Array(a.length * 4);
  for (let i = 0; i < a.length; i++) {
    out[i * 4] = a[i] as number;
    out[i * 4 + 1] = b[i] as number;
    out[i * 4 + 2] = c[i] as number;
    out[i * 4 + 3] = d[i] as number;
  }
  return new THREE.BufferAttribute(out, 4);
}
/** A part whose pieces fall, grow, rot or spin, which its material compiles in. */
const hasRuin = (part: Part): boolean => {
  const c = part.channels;
  return c.fall !== undefined || c.grow !== undefined || c.rot !== undefined || c.spin !== undefined;
};

export function geometryOf(part: Part): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const ch = part.channels;
  const n = part.shade.length;
  const frames = pieceFrames(part);
  const start = new Float32Array(n);
  const leave = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    start[i] = frames.reach[i * 2] as number;
    leave[i] = frames.reach[i * 2 + 1] as number;
  }
  const center = (k: number): Float32Array => frames.center.filter((_, i) => i % 3 === k);
  g.setAttribute("position", new THREE.BufferAttribute(part.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(part.normals, 3));
  g.setAttribute("aCutout", new THREE.BufferAttribute(part.cutout, 3));
  g.setAttribute("aPivot", new THREE.BufferAttribute(ch.pivot, 3));
  g.setAttribute("aBough", new THREE.BufferAttribute(ch.bough, 3));
  g.setAttribute("aTwig", new THREE.BufferAttribute(ch.twig, 3));
  g.setAttribute("aLook", four(part.shade, part.tint, ch.loss, ch.droop));
  g.setAttribute("aLife", four(ch.wither, ch.glow, ch.close, leave));
  g.setAttribute("aPiece", four(center(0), center(1), center(2), start));
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
/** The colors a spray borrows: its stalks the bark's, a blossom spray's few fresh leaves the family's stem green. */
export const sprayColors = (plant: Realized): { uBark: { value: THREE.Vector3 }; uStem: { value: THREE.Vector3 } } => ({
  uBark: { value: vec3Of(plant.palette.swatches.bark?.healthy ?? [0.4, 0.33, 0.3]) },
  uStem: { value: vec3Of(plant.palette.swatches.stem?.healthy ?? plant.palette.swatches.leaf?.healthy ?? [0.4, 0.6, 0.3]) },
});
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
    // A single plant keeps its full detail: thinning is for the many copies a world places.
    uDetail: { value: 0 },
    uSeed: { value: 0 },
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
        ...sprayColors(plant),
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
      uniforms: { uTime: light.uTime, uWind: light.uWind, uNightness: light.uNightness, uEye: light.uEye, ...shared, ...perPart },
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
