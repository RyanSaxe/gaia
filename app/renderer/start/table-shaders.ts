// The map table's materials: paper, oak, glaze and brass, a quill's vane,
// the lantern's glass and flame, and the pass that blurs what lies out of
// focus. Every one is lit by the world's own light (`LIGHT_GLSL`): the same
// sun, sky, moon and lantern, and the same shadow map, as the land.

import { LIGHT_GLSL } from "@gaia/render";

/** The most things that shade the table and the sheet where they touch them. */
export const MAX_CASTERS = 12;

const NOISE = /* glsl */ `
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm4(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.03 + 11.0; a *= 0.5; }
  return v;
}
`;

/**
 * Light on the table's things. `contact` is the soft shade where something
 * touches the table or the sheet: each caster is a rounded box (its middle,
 * half size and turn) with how hard it presses down. `held` is the shadow
 * of a card being lifted from the table, a soft box where the sun's shadow
 * map would draw it, so it can soften and fade as the card rises. `softShadow` is the sun's
 * shadow map read more softly than the land reads it, since paper lies a few
 * millimetres from what shades it. `matte` lights a surface as the land's
 * materials are lit, with the lantern's warm pool falling off over the table.
 */
const SURFACE = /* glsl */ `
uniform vec4 uCasterBox[${MAX_CASTERS}];
uniform vec4 uCasterSoft[${MAX_CASTERS}];
uniform float uCasterCount;
uniform float uLifted;
float contact(vec3 w, float self) {
  float ao = 1.0;
  for (int i = 0; i < ${MAX_CASTERS}; i++) {
    if (float(i) >= uCasterCount) break;
    vec4 b = uCasterBox[i];
    vec4 s = uCasterSoft[i];
    if (abs(s.w - self) < 0.5) continue;
    vec2 d = w.xz - b.xy;
    float c = cos(s.x);
    float sn = sin(s.x);
    d = vec2(c * d.x + sn * d.y, -sn * d.x + c * d.y);
    vec2 q = abs(d) - b.zw;
    float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    ao *= 1.0 - s.y * exp(-max(sdf, 0.0) / s.z) * smoothstep(-0.004, 0.0, sdf);
  }
  return ao;
}
uniform vec4 uHeldBox;
uniform vec4 uHeldShade;
float held(vec3 w) {
  // Only what lies below the card: never the card itself.
  if (uHeldShade.y <= 0.0 || w.y > uHeldShade.w) return 1.0;
  vec2 d = w.xz - uHeldBox.xy;
  float c = cos(uHeldShade.x);
  float sn = sin(uHeldShade.x);
  d = vec2(c * d.x + sn * d.y, -sn * d.x + c * d.y);
  vec2 q = abs(d) - uHeldBox.zw;
  float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  return 1.0 - uHeldShade.y * (1.0 - smoothstep(-uHeldShade.z, uHeldShade.z, sdf));
}
float softShadow(vec3 w, float bias) {
  vec4 c4 = uShadowMatrix * vec4(w, 1.0);
  vec3 c = c4.xyz / c4.w * 0.5 + 0.5;
  if (c.x < 0.01 || c.x > 0.99 || c.y < 0.01 || c.y > 0.99 || c.z > 1.0) return 1.0;
  float lit = 0.0;
  for (int i = 0; i < 16; i++) {
    float r = sqrt((float(i) + 0.5) / 16.0) * 4.0;
    float a = float(i) * 2.39996;
    float depth = texture2D(uShadowMap, c.xy + vec2(cos(a), sin(a)) * r * uShadowTexel).r;
    lit += c.z - bias <= depth ? 1.0 : 0.0;
  }
  return lit / 16.0;
}
vec3 lampLight(vec3 albedo, vec3 n, vec3 w, float wrap) {
  if (uLanternIntensity <= 0.0) return vec3(0.0);
  vec3 toL = uLanternPosition - w;
  float d = max(length(toL), 1e-3);
  float facing = dot(n, toL / d);
  float lam = mix(max(facing, 0.0), facing * 0.5 + 0.5, wrap);
  float fall = 1.0 / (1.0 + d * d / (0.72 * 0.72));
  vec3 hue = mix(uLanternColor, vec3(1.0, 0.76, 0.46), 0.62);
  return albedo * hue * uLanternIntensity * fall * lam * 0.95;
}
vec3 matte(vec3 albedo, vec3 n, vec3 w, float wrap, float ao, float bias) {
  vec3 toned = nightTone(albedo);
  float sd = dot(n, normalize(uSunDirection));
  float lam = mix(max(sd, 0.0), sd * 0.5 + 0.5, wrap);
  float sh = max(softShadow(w, bias) * held(w), uLifted);
  float key = lam * mix(0.42, 1.0, sh) * sunUp();
  key = mix(key, softCel(key), 0.2);
  vec3 sky = uAmbientColor * uAmbientIntensity * (0.78 + 0.22 * n.y);
  vec3 lit = toned * (uSunColor * uSunIntensity * key + sky) * ao;
  vec3 shadowed = toned * uShadowColor * (uAmbientIntensity + 0.62) * ao;
  vec3 color = mix(shadowed, lit, clamp(key * 1.5 + 0.3, 0.0, 1.0));
  color += moonLight(albedo, n, wrap, mix(1.0, sh, uMoonShadow)) * ao * 0.7;
  color += lampLight(albedo, n, w, wrap) * mix(0.55, 1.0, ao);
  return color;
}
float sunSpec(vec3 n, vec3 w, float gloss) {
  vec3 V = normalize(cameraPosition - w);
  vec3 H = normalize(normalize(uSunDirection) + V);
  return pow(max(dot(n, H), 0.0), gloss) * sunUp() * uSunIntensity * max(softShadow(w, 0.0015) * held(w), uLifted);
}
float lampSpec(vec3 n, vec3 w, float gloss) {
  if (uLanternIntensity <= 0.0) return 0.0;
  vec3 V = normalize(cameraPosition - w);
  vec3 toL = uLanternPosition - w;
  float d = length(toL);
  vec3 H = normalize(toL / d + V);
  return pow(max(dot(n, H), 0.0), gloss) * uLanternIntensity / (1.0 + d * d / 0.09) * 0.5;
}
// The world's shoulder rolls highlights off early, for pale blossoms in full sun; paper must stay paper-white, so this one rolls off later.
vec3 roll(vec3 c) { return c / (1.0 + max(c - 0.9, 0.0) * 0.75); }
`;

export const VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
void main() {
  vUv = uv;
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

/**
 * Paper, made here rather than painted, so nothing is painted before the
 * first frame: a warm cream with broad mottling, darker toward its rim with
 * handling; short fibres lighter and darker than the sheet, about one to
 * 55 mm²; a few foxing spots; the creases of a sheet folded in four; and a
 * fine tooth the low sun rakes across. Its edge is torn, wandering in by a
 * few millimetres at three scales with loose fibres in the tear, paler and
 * lit through, and the sheet's thickness catches the light where the edge
 * faces the sun. On it lie the ink (Gaia's logo, the words and the names),
 * the line being written on, and on a card its world's picture.
 */
export const PAPER_FRAGMENT = /* glsl */ `
${LIGHT_GLSL}
${NOISE}
${SURFACE}
uniform vec2 uSize;
uniform float uSeed;
uniform vec3 uBase;
uniform float uTear;
uniform float uFolded;
uniform sampler2D uInk;
uniform float uHasInk;
uniform sampler2D uWriting;
uniform vec4 uWritingAt;
uniform float uHasWriting;
uniform sampler2D uPicture;
uniform float uHasPicture;
uniform float uInset;
uniform float uSelf;
uniform float uFlat;
uniform vec3 uAxisX;
uniform vec3 uAxisY;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;

const float MM = 0.001;
float seeded(float x) { return fract(sin(x * 127.1 + uSeed * 311.7) * 43758.5453); }
float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(seeded(i), seeded(i + 1.0), f * f * (3.0 - 2.0 * f)) * 2.0 - 1.0;
}
float seed2(vec2 p) { return hash2(p + uSeed * 17.31); }
float toSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
}

// Short fibres, one to a cell about 7.4 mm a side, each 0.8 to 4 mm long: three in five paler than the sheet.
vec3 fibres(vec2 p, vec3 c, float px) {
  const float CELL = 7.4 * MM;
  vec2 home = floor(p / CELL);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = home + vec2(float(i), float(j));
      float r1 = seed2(cell);
      float r2 = seed2(cell + 31.7);
      float r3 = seed2(cell + 57.3);
      float r4 = seed2(cell + 91.1);
      vec2 mid = (cell + vec2(r1, r2)) * CELL;
      float a = r3 * 6.2832;
      vec2 half_ = vec2(cos(a), sin(a)) * (0.4 + r4 * 1.6) * MM;
      float hw = (0.04 + fract(r1 * 7.0) * 0.06) * MM;
      float d = toSegment(p, mid - half_, mid + half_);
      // Thinner than a pixel, a fibre shows as a faint line: its share of the pixel it crosses.
      float cover = (1.0 - smoothstep(hw, hw + px, d)) * min(1.0, hw * 2.0 / px);
      bool pale = fract(r2 * 13.0) < 0.6;
      float alpha = pale ? 0.1 + fract(r3 * 5.0) * 0.14 : 0.05 + fract(r3 * 5.0) * 0.08;
      c = mix(c, pale ? vec3(1.0, 0.988, 0.941) : vec3(0.47, 0.345, 0.196), cover * alpha);
    }
  }
  return c;
}

// The paper's own color at a point, metres from its far left corner.
vec3 paperAt(vec2 p, float px) {
  vec3 c = uBase;
  float m = fbm4(p / (45.0 * MM) + uSeed * 3.1);
  c = mix(c, vec3(0.59, 0.44, 0.24), smoothstep(0.55, 0.78, m) * 0.08);
  c = mix(c, vec3(1.0, 0.98, 0.925), smoothstep(0.45, 0.22, m) * 0.1);
  c = mix(c, vec3(0.5, 0.36, 0.19), smoothstep(0.32 * min(uSize.x, uSize.y), 0.62 * max(uSize.x, uSize.y), length(p - uSize * 0.5)) * 0.16);
  // Foxing: about nine spots a square metre, each a millimetre or so across.
  vec2 spotCell = floor(p / 0.1);
  if (seed2(spotCell * 1.37) < 0.09) {
    vec2 at = (spotCell + vec2(seed2(spotCell + 3.3), seed2(spotCell + 7.7))) * 0.1;
    float rad = (0.3 + seed2(spotCell + 9.1) * 1.4) * MM;
    c = mix(c, vec3(0.59, 0.38, 0.17), (1.0 - smoothstep(rad - px, rad + px, length(p - at))) * (0.08 + seed2(spotCell + 2.2) * 0.12));
  }
  // A crease along each fold: a hairline of shade on one side and of light on the other.
  if (uFolded > 0.5) {
    float sigma = max(0.35 * MM, px * 0.7);
    float k = 0.35 * MM / sigma;
    for (int f = 0; f < 2; f++) {
      float s = f == 0 ? p.x - uSize.x * 0.5 : p.y - uSize.y * 0.5;
      s += (vnoise(vec2(f == 0 ? p.y : p.x, float(f)) / (2.0 * MM)) - 0.5) * 0.25 * MM;
      c = mix(c, vec3(0.43, 0.31, 0.17), exp(-pow((s + 0.6 * MM) / sigma, 2.0)) * 0.16 * k);
      c = mix(c, vec3(1.0, 0.98, 0.925), exp(-pow((s - 0.6 * MM) / sigma, 2.0)) * 0.35 * k);
    }
  }
  return c;
}

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  float px = max(length(fwidth(p)), 1e-5);

  // The torn edge: how far in from the nearest side, and where along the rim, walked round from the far left corner.
  float W = uSize.x;
  float H = uSize.y;
  float e = p.y;
  float along = p.x;
  vec2 out_ = vec2(0.0, -1.0);
  if (W - p.x < e) { e = W - p.x; along = W + p.y; out_ = vec2(1.0, 0.0); }
  if (H - p.y < e) { e = H - p.y; along = W + H + W - p.x; out_ = vec2(0.0, 1.0); }
  if (p.x < e) { e = p.x; along = 2.0 * W + H + H - p.y; out_ = vec2(-1.0, 0.0); }
  float inset = (3.2 + 1.9 * noise1(along / (38.0 * MM)) + 0.9 * noise1(along / (9.0 * MM) + 17.0) + 0.35 * noise1(along / (2.2 * MM) + 41.0)) * MM * uTear;
  float d = e - inset;
  float cover = smoothstep(-px * 0.6, px * 0.6, d);
  // Loose fibres stand out of the tear, half covering it, so the edge feathers.
  float loose = step(-1.3 * MM, d) * step(d, 0.0) * step(0.62, vnoise(vec2(along / (0.22 * MM), d / (0.45 * MM)) + uSeed)) * 0.55;
  cover = max(cover, loose);
  if (cover < 0.03) discard;

  vec3 albedo = paperAt(p, px);
  if (uHasPicture > 0.5) {
    vec2 q = (vec2(vUv.x, vUv.y) - uInset) / (1.0 - 2.0 * uInset);
    vec2 inside = smoothstep(vec2(0.0), vec2(0.004), q) * smoothstep(vec2(0.0), vec2(0.004), 1.0 - q);
    albedo *= mix(vec3(1.0), texture2D(uPicture, q).rgb, 0.97 * inside.x * inside.y);
  }
  albedo = fibres(p, albedo, px);
  if (uHasInk > 0.5) {
    vec4 ink = texture2D(uInk, vUv);
    albedo = mix(albedo, ink.rgb, ink.a);
  }
  if (uHasWriting > 0.5) {
    vec2 q = (vUv - uWritingAt.xy) / (uWritingAt.zw - uWritingAt.xy);
    if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) {
      vec4 ink = texture2D(uWriting, q);
      albedo = mix(albedo, ink.rgb, ink.a);
    }
  }
  // Risen into the wait's sheet, a card is the picture the wait shows: its paper as the wait's is after dark, a
  // little sepia and dimmer (wait.css), unlit by the table's light.
  float sepia = uNightness * 0.3;
  vec3 flat_ = mat3(0.393 + 0.607 * (1.0 - sepia), 0.349 * sepia, 0.272 * sepia, 0.769 * sepia, 0.686 + 0.314 * (1.0 - sepia), 0.534 * sepia, 0.189 * sepia, 0.168 * sepia, 0.131 + 0.869 * (1.0 - sepia)) * albedo * (1.0 - uNightness * 0.16);
  albedo *= 1.04;

  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  // The paper's tooth: a fine bump the low sun rakes across.
  vec2 t = p * 900.0;
  float h0 = vnoise(t);
  float h1 = vnoise(t * 0.21 + 7.0);
  n = normalize(n + (uAxisX * (h0 - vnoise(t + vec2(0.35, 0.0))) + uAxisY * (h0 - vnoise(t + vec2(0.0, 0.35)))) * 0.22 + uAxisX * (h1 - vnoise(t * 0.21 + vec2(7.3, 7.0))) * 0.1);
  // The torn fringe is thinner than the sheet: paler, and lit through.
  float rim = 1.0 - smoothstep(0.0, 1.4 * MM, d);
  albedo = mix(albedo, min(albedo * 1.06 + 0.035, vec3(1.0)), rim * 0.8);
  vec3 color = matte(albedo, n, vWorld, 0.35 + rim * 0.3, mix(contact(vWorld, uSelf), 1.0, uLifted), 0.0004);
  // The sheet's thickness catches the sun along the edges that face it.
  vec3 outward = normalize(uAxisX * out_.x + uAxisY * out_.y);
  float towardSun = dot(outward, normalize(vec3(uSunDirection.x, 0.0, uSunDirection.z) + 1e-5));
  color *= 1.0 + (1.0 - smoothstep(0.0, 0.5 * MM, d)) * (towardSun * 0.18 * sunUp() - 0.1);
  color = mix(roll(color), flat_, uFlat);
  gl_FragColor = vec4(aerial(color, vWorld), cover);
}
`;

/** Oak boards: long grain, thin dark latewood, streaks and pores, seams with eased edges, and a waxed sheen. */
export const WOOD_FRAGMENT = /* glsl */ `
${LIGHT_GLSL}
${NOISE}
${SURFACE}
uniform float uLeg;
uniform float uPlank;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
void main() {
  vec3 p = vLocal;
  float along = uLeg > 0.5 ? p.y : p.x;
  float across = uLeg > 0.5 ? p.x + p.z * 1.7 : p.z;
  float k = (across + 5.0) / uPlank;
  float plank = floor(k);
  float f = fract(k);
  float r = hash2(vec2(plank, 4.7));
  float local = across - plank * uPlank;
  float warp = fbm4(vec2(along * 0.7 + r * 40.0, local * 9.0 + r * 3.0));
  float phase = local * (38.0 + r * 18.0) + warp * 4.5 + along * 0.12 * (r - 0.5);
  float band = 0.5 + 0.5 * sin(phase * 6.2832);
  float line = pow(band, 12.0);
  float streak = vnoise(vec2(along * 3.0, local * 520.0 + r * 30.0));
  float pores = vnoise(vec2(along * 18.0, local * 1600.0));
  float figure = fbm4(vec2(along * 1.4 + r * 9.0, local * 14.0));
  float tone = 0.52 + (figure - 0.5) * 0.75 + (streak - 0.5) * 0.3 + (band - 0.5) * 0.1 - line * 0.22 + (r - 0.5) * 0.4;
  vec3 albedo = mix(vec3(0.29, 0.19, 0.12), vec3(0.56, 0.4, 0.27), clamp(tone, 0.0, 1.0));
  albedo *= 0.95 + 0.08 * pores;
  // Worn paler along the near edge, where hands rest.
  albedo = mix(albedo, albedo * 1.12 + 0.02, smoothstep(0.35, 0.56, p.z) * (1.0 - uLeg) * 0.5);
  vec3 n = normalize(vNormal);
  float top = (1.0 - uLeg) * step(0.9, n.y);
  float seam = min(f, 1.0 - f) * uPlank;
  float gap = 1.0 - smoothstep(0.0006, 0.0018, seam);
  float bevel = smoothstep(0.0045, 0.0012, seam) * (1.0 - gap);
  n = normalize(n + vec3(0.0, 0.0, (f < 0.5 ? 1.0 : -1.0) * bevel * 0.5 * top));
  n = normalize(n + vec3(0.0, 0.0, (pores - 0.5) * 0.04 + (band - 0.5) * 0.02) * top);
  albedo = mix(albedo, vec3(0.06, 0.035, 0.02), gap * top);
  float ao = contact(vWorld, -1.0);
  vec3 color = matte(albedo, n, vWorld, 0.1, ao, 0.0008);
  float gloss = (0.1 + 0.1 * figure) * (1.0 - gap) * (1.0 - line * 0.5);
  color += uSunColor * sunSpec(n, vWorld, 70.0) * gloss * ao;
  color += mix(uLanternColor, vec3(1.0, 0.8, 0.5), 0.6) * lampSpec(n, vWorld, 40.0) * gloss * 2.0;
  gl_FragColor = vec4(aerial(roll(color), vWorld), 1.0);
}
`;

/** Glaze, brass, wax and quill: a color with a sheen, metal tinting its own highlights, and the sky in what shines. */
export const SOLID_FRAGMENT = /* glsl */ `
${LIGHT_GLSL}
${NOISE}
${SURFACE}
uniform vec3 uColor;
uniform float uGloss;
uniform float uSpec;
uniform float uMetal;
uniform float uWrap;
uniform float uStain;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 albedo = mix(uColor, vec3(0.08, 0.06, 0.05), uStain * (1.0 - smoothstep(0.0, 0.06, vUv.x)));
  albedo *= 0.94 + 0.12 * vnoise(vWorld.xz * 600.0 + vWorld.y * 300.0);
  vec3 color = matte(albedo * (1.0 - uMetal * 0.55), n, vWorld, uWrap, contact(vWorld, -1.0), 0.0006);
  vec3 tint = mix(vec3(1.0), albedo * 1.4, uMetal);
  color += tint * uSunColor * sunSpec(n, vWorld, uGloss) * uSpec;
  color += tint * mix(uLanternColor, vec3(1.0, 0.8, 0.5), 0.6) * lampSpec(n, vWorld, uGloss * 0.6) * uSpec * 1.6;
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  color += tint * skyColor(reflect(-V, n)) * (0.06 + fres * 0.35) * uSpec * (1.0 - uNightness * 0.85);
  gl_FragColor = vec4(aerial(roll(color), vWorld), 1.0);
}
`;

/** A quill's vane: its barbs drawn on a strip, scattering the light through. */
export const FEATHER_FRAGMENT = /* glsl */ `
${LIGHT_GLSL}
${NOISE}
${SURFACE}
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  float fw = fwidth(tex.a) * 0.7 + 1e-4;
  float cov = smoothstep(0.45 - fw, 0.45 + fw, tex.a);
  if (cov < 0.03) discard;
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 color = matte(tex.rgb * 0.97, n, vWorld, 0.7, 1.0, 0.0006);
  color += uSunColor * sunSpec(n, vWorld, 24.0) * 0.08;
  gl_FragColor = vec4(aerial(roll(color), vWorld), cov);
}
`;

/** The lantern's glass: the sky in it, the sun's glint, and the candle's glow once it is lit. */
export const GLASS_FRAGMENT = /* glsl */ `
${LIGHT_GLSL}
uniform float uGlow;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(n, V)), 2.5);
  vec3 sky = skyColor(reflect(-V, n)) * (1.0 - uNightness * 0.8);
  float spec = pow(max(dot(n, normalize(normalize(uSunDirection) + V)), 0.0), 120.0) * sunUp() * uSunIntensity;
  vec3 color = sky * (0.12 + fres * 0.6) + uSunColor * spec + vec3(1.0, 0.62, 0.28) * uGlow * (0.55 + 0.45 * (1.0 - fres));
  gl_FragColor = vec4(color, clamp(0.1 + fres * 0.5 + spec + uGlow * 0.5, 0.0, 0.95));
}
`;

/** The candle's flame: still, since a flicker would ask for a frame every frame. */
export const FLAME_FRAGMENT = /* glsl */ `
uniform float uGlow;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float core = exp(-(p.x * p.x * 9.0 + pow(max(p.y + 0.15, 0.0), 2.0) * 2.2 + pow(min(p.y + 0.15, 0.0), 2.0) * 7.0));
  float halo = exp(-dot(p, p) * 2.2) * 0.35;
  gl_FragColor = vec4((vec3(1.0, 0.86, 0.55) * core * 1.6 + vec3(1.0, 0.55, 0.2) * halo) * uGlow, 1.0);
}
`;

/**
 * The pass to the screen. Everything between `uFocus` and `uFocusFar` is
 * sharp, so the whole sheet reads, and the blur grows outside that band, as
 * through a camera focused on the sheet. The table fades into the wait's
 * paper beneath the page as `uFade` rises, and a chosen card, drawn on its
 * own and in focus, lies over both. The canvas is premultiplied.
 */
export const POST_VERTEX = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const POST_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tLift;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uFocusFar;
uniform float uAperture;
uniform float uMaxBlur;
uniform float uFade;
uniform float uVignette;
uniform float uLifting;
float linear(float z) { float ndc = z * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear)); }
float coc(float d) { return clamp(max(max(1.0 / d - 1.0 / uFocus, 1.0 / uFocusFar - 1.0 / d), 0.0) * uAperture, 0.0, uMaxBlur); }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float d0 = linear(texture2D(tDepth, uv).r);
  float c0 = coc(d0);
  vec3 acc = texture2D(tColor, uv).rgb;
  float sum = 1.0;
  for (int i = 0; i < 48; i++) {
    float r = sqrt((float(i) + 0.5) / 48.0) * uMaxBlur;
    float a = float(i) * 2.39996;
    vec2 at = uv + vec2(cos(a), sin(a)) * r / uRes;
    float d = linear(texture2D(tDepth, at).r);
    float cs = coc(d);
    // A sample nearer than the middle blurs over it as far as its own blur reaches; a farther one no farther than the middle's.
    float reach = d < d0 ? cs : min(cs, c0);
    float w = smoothstep(r - 1.0, r + 0.5, reach);
    acc += texture2D(tColor, at).rgb * w;
    sum += w;
  }
  vec3 color = acc / sum;
  vec2 q = uv - 0.5;
  color *= 1.0 - uVignette * smoothstep(0.25, 0.85, length(q * vec2(1.0, 1.15)));
  vec4 table = vec4(color, 1.0) * (1.0 - uFade);
  vec4 lift = uLifting > 0.5 ? texture2D(tLift, uv) : vec4(0.0);
  gl_FragColor = lift + table * (1.0 - lift.a);
}
`;
