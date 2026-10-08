// Markers in the world: where a trail crosses from one area into the next, a
// fingerpost stands beside it with an arm pointing each way along the trail,
// each painted with the name of the area that way, and across the trail a
// low boundary stone faces the tread, carved with the two areas' names, the
// one to the left above a cut line and the one to the right below it, each
// pointing its way. They draw as three instanced meshes, their
// names from two atlases, lit like everything else. An arm's paint fades and
// its wood greys, and it droops on its nail, with the vitality of the area it
// names; a stone's moss recedes and the stone bleaches with both areas'.

import * as THREE from "three";
import { LIGHT_GLSL, type SceneLight } from "@gaia/render";
import { type PlaceArea, type SolidShape, type Way, heightAt, waterDepthAt } from "@gaia/terrain";
import type { Furnishing, StoodWorld } from "../terrain/lab.ts";

/** The layer markers draw on: the view's camera sees it, the sun's shadow pass does not, since their material reads the shadow map. */
export const MARKER_LAYER = 1;

export interface Markers {
  readonly group: THREE.Group;
  /** Stands a fingerpost and a boundary stone wherever a trail crosses into another area: what they keep bare and what stops a walker. */
  place(stood: StoodWorld, areaAt: (x: number, z: number) => PlaceArea): Furnishing;
  /** Weathers each name with the vitality of the area it names. */
  vitality(of: (path: string) => number): void;
  /** Each crossing: where its post and stone stand and the areas on either side, for scripted checks. */
  crossings(): readonly MarkerCrossing[];
}

export interface MarkerCrossing {
  readonly x: number;
  readonly z: number;
  /** The area the trail comes from and the one it enters, by its points' order. */
  readonly from: PlaceArea;
  readonly to: PlaceArea;
  readonly post: { readonly x: number; readonly z: number };
  readonly stone: { readonly x: number; readonly z: number };
}

/** A run of a trail inside one area shorter than this, meters, is a border's wobble, not an area the trail passes through. */
const MIN_RUN = 14;
/** Two crossings between the same two areas closer than this, meters, share one set of markers. */
const SPACING = 40;
const ARM = { length: 1.15, height: 0.22, thick: 0.04, tip: 0.15, root: 0.07 };
const POST = { height: 2.3, half: 0.06, sink: 0.25 };
const STONE = { width: 0.64, height: 1, thick: 0.28, sink: 0.18 };
/** The stone's lettered band, meters above its foot. */
const BAND = { from: 0.34, to: 0.86 };
/** How far each arm turns away from the trail, radians, so its face meets a person walking the way it points. */
const SPLAY = 0.5;
// Each slot has its board's or band's own proportions, so letters keep their shape.
const ARM_SLOT = { w: 512, h: 120, cols: 4 };
const STONE_SLOT = { w: 512, h: 412, cols: 4 };

// ---------- geometry ----------

interface Build {
  pos: number[];
  nrm: number[];
  uv: number[];
  face: number[];
  idx: number[];
}
const build = (): Build => ({ pos: [], nrm: [], uv: [], face: [], idx: [] });

/** A flat polygon facing `n`, fanned from its first corner; `uv` per corner, `face` 1 where names are painted. */
function polygon(b: Build, corners: readonly (readonly [number, number, number])[], n: readonly [number, number, number], uv: readonly (readonly [number, number])[], face: number): void {
  const base = b.pos.length / 3;
  corners.forEach((c, i) => {
    b.pos.push(...c);
    b.nrm.push(...n);
    b.uv.push(...(uv[i] ?? [0, 0]));
    b.face.push(face);
  });
  // Wind so the face points along n.
  const [a, c1, c2] = [corners[0], corners[1], corners[2]] as const;
  const ux = (c1?.[0] ?? 0) - (a?.[0] ?? 0), uy = (c1?.[1] ?? 0) - (a?.[1] ?? 0), uz = (c1?.[2] ?? 0) - (a?.[2] ?? 0);
  const vx = (c2?.[0] ?? 0) - (a?.[0] ?? 0), vy = (c2?.[1] ?? 0) - (a?.[1] ?? 0), vz = (c2?.[2] ?? 0) - (a?.[2] ?? 0);
  const facing = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] > 0;
  for (let k = 1; k < corners.length - 1; k++) {
    if (facing) b.idx.push(base, base + k, base + k + 1);
    else b.idx.push(base, base + k + 1, base + k);
  }
}

/** A prism: the outline in x and y, extruded from z = -half to +half; front and back carry the outline's uvs, the back's mirrored. */
function prism(b: Build, outline: readonly (readonly [number, number])[], half: number, uvOf: (x: number, y: number) => readonly [number, number], painted: boolean): void {
  const front = outline.map(([x, y]) => [x, y, half] as const);
  const back = outline.map(([x, y]) => [x, y, -half] as const);
  polygon(b, front, [0, 0, 1], outline.map(([x, y]) => uvOf(x, y)), painted ? 1 : 0);
  polygon(b, back, [0, 0, -1], outline.map(([x, y]) => { const [u, v] = uvOf(x, y); return [1 - u, v] as const; }), painted ? 1 : 0);
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i] as readonly [number, number];
    const [x1, y1] = outline[(i + 1) % outline.length] as readonly [number, number];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const n = [(y1 - y0) / len, -(x1 - x0) / len, 0] as const;
    polygon(b, [[x0, y0, half], [x1, y1, half], [x1, y1, -half], [x0, y0, -half]], n, [], 0);
  }
}

function geometryOf(b: Build): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute("aUv", new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute("aFace", new THREE.Float32BufferAttribute(b.face, 1));
  g.setIndex(b.idx);
  return g;
}

/** An arm: a board from the post (x = 0) out to a pointed tip (x = length), its names on both faces. */
function armGeometry(): THREE.BufferGeometry {
  const { length: L, height: h, thick, tip, root } = ARM;
  const outline: [number, number][] = [[root, -h / 2], [L - tip, -h / 2], [L, 0], [L - tip, h / 2], [root, h / 2]];
  const b = build();
  // The name fills the board, short of the tip.
  prism(b, outline, thick / 2, (x, y) => [(x - root) / (L - tip - root), 0.5 - y / h], true);
  // A short block where the arm is nailed to the post.
  prism(b, [[0, -h * 0.4], [root, -h * 0.4], [root, h * 0.4], [0, h * 0.4]], thick * 0.8, () => [0, 0], false);
  return geometryOf(b);
}

/** A square post with a low pyramid cap. */
function postGeometry(): THREE.BufferGeometry {
  const { height: H, half: s, sink } = POST;
  const b = build();
  const sides: [number, number, number, number][] = [[s, s, 1, 0], [-s, -s, -1, 0], [-s, s, 0, 1], [s, -s, 0, -1]];
  for (const [ax, az, nx, nz] of sides) {
    const bx = nz !== 0 ? -ax : ax;
    const bz = nx !== 0 ? -az : az;
    polygon(b, [[ax, -sink, az], [bx, -sink, bz], [bx, H, bz], [ax, H, az]], [nx, 0, nz], [], 0);
    // The cap: each side slopes up to a point.
    const up = 0.08;
    const len = Math.hypot(up, s);
    polygon(b, [[ax, H, az], [bx, H, bz], [0, H + up, 0]], [(nx * up) / len, s / len, (nz * up) / len], [], 0);
  }
  return geometryOf(b);
}

/** A squat standing stone with a rounded top; its front (+z) carries the carving. */
function stoneGeometry(): THREE.BufferGeometry {
  const { width: w, height: H, thick, sink } = STONE;
  const outline: [number, number][] = [[-w / 2, -sink], [w / 2, -sink], [w / 2, H - w * 0.32]];
  // The rounded top, as a flattened arc.
  for (let k = 1; k < 10; k++) {
    const a = (k / 10) * Math.PI;
    outline.push([(Math.cos(a) * w) / 2, H - w * 0.32 + Math.sin(a) * w * 0.32]);
  }
  outline.push([-w / 2, H - w * 0.32]);
  const b = build();
  prism(b, outline, thick / 2, (x, y) => [x / w + 0.5, 1 - (y - BAND.from) / (BAND.to - BAND.from)], true);
  return geometryOf(b);
}

// ---------- shading ----------

const VERT = /* glsl */ `
attribute vec2 aUv;
attribute float aFace;
// Vitality, the atlas slot, and how far a failing arm droops on its nail.
attribute vec3 aMark;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec2 vUv;
varying vec2 vCell;
varying float vFace;
varying float vLife;
uniform vec2 uSlots;
uniform float uDroop;
void main() {
  float life = aMark.x;
  vec3 p = position;
  vec3 n = normal;
  // A failing area's arm sags on its nail, about the post end, tip down.
  float sag = uDroop * (1.0 - life) * (1.0 - life);
  float c = cos(-sag);
  float s = sin(-sag);
  p.xy = mat2(c, s, -s, c) * p.xy;
  n.xy = mat2(c, s, -s, c) * n.xy;
  vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vLocal = position;
  vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  vCell = vec2(mod(aMark.y, uSlots.x), floor(aMark.y / uSlots.x));
  vUv = aUv;
  vFace = aFace;
  vLife = life;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
uniform sampler2D uNames;
uniform vec2 uSlots;
uniform float uStone;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec2 vUv;
varying vec2 vCell;
varying float vFace;
varying float vLife;
// A name is painted only inside its slot: the face's uv runs 0 to 1 across the lettered part.
float named() { return vFace * step(0.0, vUv.x) * step(vUv.x, 1.0) * step(0.0, vUv.y) * step(vUv.y, 1.0); }
vec2 atlasUv(vec2 uv) { return (vCell + clamp(uv, 0.0, 1.0)) / uSlots; }
float grain(vec2 p) { return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(grain(i), grain(i + vec2(1.0, 0.0)), u.x), mix(grain(i + vec2(0.0, 1.0)), grain(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec3 n = normalize(vNormal);
  vec3 albedo;
  if (uStone > 0.5) {
    // Weathered stone, bleaching as the areas it parts decline; moss on its
    // shoulders that recedes, edge first, toward the top.
    float mottle = vnoise(vLocal.xy * 9.0 + vLocal.z * 5.0) * 0.6 + vnoise(vLocal.xy * 31.0) * 0.4;
    albedo = mix(vec3(0.55, 0.53, 0.48), vec3(0.7, 0.68, 0.63), (1.0 - vLife) * 0.7) * (0.85 + 0.25 * mottle);
    float up = clamp(n.y, 0.0, 1.0);
    float moss = smoothstep(0.35, 0.75, up + mottle * 0.5 - (1.0 - vLife) * 0.9) + smoothstep(0.1, -0.05, vLocal.y) * 0.5 * vLife;
    albedo = mix(albedo, vec3(0.36, 0.44, 0.22), clamp(moss, 0.0, 1.0) * 0.75);
    if (named() > 0.5) {
      // Carved letters: darker in the cut, with a lit lower lip where the sun catches it.
      float cut = texture2D(uNames, atlasUv(vUv)).r;
      float lip = texture2D(uNames, atlasUv(vUv + vec2(0.0, 0.012))).r;
      albedo *= 1.0 - 0.42 * cut;
      albedo += vec3(0.08) * max(0.0, cut - lip) * vLife;
    }
    // Earth darkens the stone where it meets the ground.
    albedo *= mix(0.7, 1.0, smoothstep(-0.05, 0.2, vLocal.y));
  } else {
    vec3 wood = mix(vec3(0.42, 0.3, 0.2), vec3(0.45, 0.43, 0.4), (1.0 - vLife) * 0.8);
    float streak = grain(vec2(vLocal.x * 40.0, vLocal.y * 3.0 + vLocal.z * 7.0));
    albedo = wood * (0.86 + 0.18 * streak);
    // Damp earth darkens a post's foot.
    albedo *= mix(0.62, 1.0, smoothstep(-0.05, 0.35, vLocal.y));
    if (named() > 0.5) {
      float ink = texture2D(uNames, atlasUv(vUv)).r;
      float flake = smoothstep(0.25, 0.75, grain(vUv * vec2(220.0, 40.0)) * 0.6 + 0.4 * (1.0 - vLife) + 0.2);
      float paint = ink * mix(0.95, 0.35, 1.0 - vLife) * mix(1.0, 1.0 - flake * 0.7, 1.0 - vLife);
      albedo = mix(albedo, vec3(0.93, 0.88, 0.76), paint);
    }
  }
  float shadow = mix(0.45, 1.0, sunShadow(vWorld, 0.003));
  float light = softCel(max(dot(n, uSunDirection), 0.0) * shadow) * sunUp();
  vec3 toned = nightTone(albedo);
  vec3 lit = toned * (uSunColor * uSunIntensity * light + uAmbientColor * uAmbientIntensity);
  vec3 shadowed = toned * uShadowColor * (uAmbientIntensity + 0.75);
  vec3 color = mix(shadowed, lit, clamp(light + 0.35, 0.0, 1.0));
  color += nightLight(albedo, n, vWorld, 0.0, mix(1.0, shadow, uMoonShadow));
  gl_FragColor = vec4(aerial(shoulder(color), vWorld), 1.0);
}
`;

// ---------- names ----------

const SERIF = `Georgia, "Iowan Old Style", "Times New Roman", serif`;

/** Fits `text` into `width` pixels, starting from `size`, and sets the font. */
function fit(ctx: CanvasRenderingContext2D, text: string, style: string, size: number, width: number): number {
  let s = size;
  ctx.font = `${style} ${s}px ${SERIF}`;
  while (ctx.measureText(text).width > width && s > 18) {
    s -= 2;
    ctx.font = `${style} ${s}px ${SERIF}`;
  }
  return s;
}

function atlas(cols: number, rows: number, slot: { w: number; h: number }): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture } {
  const canvas = document.createElement("canvas");
  canvas.width = slot.w * cols;
  canvas.height = Math.max(1, slot.h * rows);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { canvas, ctx, texture };
}

/** Where a trail runs from one area into the next, once each border's wobble is set aside. */
function crossingsOf(trail: Way, areaAt: (x: number, z: number) => PlaceArea): { i: number; from: PlaceArea; to: PlaceArea }[] {
  const p = trail.points;
  const count = p.length / 2;
  const runs: { area: PlaceArea; start: number; end: number }[] = [];
  for (let i = 0; i < count; i++) {
    const area = areaAt(p[i * 2] as number, p[i * 2 + 1] as number);
    const last = runs[runs.length - 1];
    if (last !== undefined && last.area.path === area.path && last.area.depth === area.depth) last.end = i;
    else runs.push({ area, start: i, end: i });
  }
  // A short run is a border's wobble: it joins the run before it.
  const kept: typeof runs = [];
  for (const r of runs) {
    const last = kept[kept.length - 1];
    if (last !== undefined && (r.end - r.start < MIN_RUN || (last.area.path === r.area.path && last.area.depth === r.area.depth))) last.end = r.end;
    else kept.push({ ...r });
  }
  const out: { i: number; from: PlaceArea; to: PlaceArea }[] = [];
  for (let k = 1; k < kept.length; k++) {
    const a = kept[k - 1] as (typeof kept)[number];
    const b = kept[k] as (typeof kept)[number];
    if (a.area.path !== b.area.path && a.area.depth >= 0 && b.area.depth >= 0) out.push({ i: b.start, from: a.area, to: b.area });
  }
  return out;
}

export function createMarkers(light: SceneLight): Markers {
  const group = new THREE.Group();
  group.name = "markers";
  const armGeo = armGeometry();
  const postGeo = postGeometry();
  const stoneGeo = stoneGeometry();
  let arms: THREE.InstancedMesh | null = null;
  let posts: THREE.InstancedMesh | null = null;
  let stones: THREE.InstancedMesh | null = null;
  let armAtlas: ReturnType<typeof atlas> | null = null;
  let stoneAtlas: ReturnType<typeof atlas> | null = null;
  let placed: MarkerCrossing[] = [];
  /** The path each arm names, and the two paths each stone parts. */
  let armNames: string[] = [];
  let stoneNames: [string, string][] = [];

  const material = (names: THREE.Texture, slots: THREE.Vector2, stone: boolean, droop: number): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...light, uNames: { value: names }, uSlots: { value: slots }, uStone: { value: stone ? 1 : 0 }, uDroop: { value: droop } },
    });

  function clear(): void {
    for (const m of [arms, posts, stones]) {
      if (m === null) continue;
      (m.material as THREE.Material).dispose();
      m.geometry.dispose();
      m.dispose();
      m.removeFromParent();
    }
    armAtlas?.texture.dispose();
    stoneAtlas?.texture.dispose();
    arms = posts = stones = null;
  }

  return {
    group,
    place(stood, areaAt) {
      clear();
      const t = stood.terrain;
      const found: { x: number; z: number; tx: number; tz: number; off: number; from: PlaceArea; to: PlaceArea }[] = [];
      for (const trail of stood.ways) {
        const p = trail.points;
        const count = p.length / 2;
        for (const c of crossingsOf(trail, areaAt)) {
          const x = p[c.i * 2] as number;
          const z = p[c.i * 2 + 1] as number;
          const a = Math.max(0, c.i - 4);
          const b = Math.min(count - 1, c.i + 4);
          const dx = (p[b * 2] as number) - (p[a * 2] as number);
          const dz = (p[b * 2 + 1] as number) - (p[a * 2 + 1] as number);
          const len = Math.hypot(dx, dz) || 1;
          const pair = [c.from.path, c.to.path].sort().join("|");
          if (found.some((f) => [f.from.path, f.to.path].sort().join("|") === pair && Math.hypot(f.x - x, f.z - z) < SPACING)) continue;
          const off = trail.style.width / 2 + 0.9;
          // Never in the water or at a crossing's footbridge.
          const dry = (sx: number, sz: number): boolean => waterDepthAt(t, sx, sz) <= 0 && trail.crossings.every((k) => Math.hypot(k.x - sx, k.z - sz) > k.span / 2 + 3);
          const nx = dz / len;
          const nz = -dx / len;
          if (!dry(x + nx * off, z + nz * off) || !dry(x - nx * off, z - nz * off)) continue;
          found.push({ x, z, tx: dx / len, tz: dz / len, off, from: c.from, to: c.to });
        }
      }

      const n = found.length;
      const armRows = Math.ceil((n * 2) / ARM_SLOT.cols);
      const stoneRows = Math.ceil(n / STONE_SLOT.cols);
      armAtlas = atlas(ARM_SLOT.cols, armRows, ARM_SLOT);
      stoneAtlas = atlas(STONE_SLOT.cols, stoneRows, STONE_SLOT);
      arms = new THREE.InstancedMesh(armGeo, material(armAtlas.texture, new THREE.Vector2(ARM_SLOT.cols, Math.max(1, armRows)), false, 0.32), Math.max(1, n * 2));
      posts = new THREE.InstancedMesh(postGeo, material(armAtlas.texture, new THREE.Vector2(1, 1), false, 0), Math.max(1, n));
      stones = new THREE.InstancedMesh(stoneGeo, material(stoneAtlas.texture, new THREE.Vector2(STONE_SLOT.cols, Math.max(1, stoneRows)), true, 0), Math.max(1, n));
      const armMark = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n * 2) * 3), 3);
      const postMark = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
      const stoneMark = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
      arms.geometry = armGeo.clone();
      posts.geometry = postGeo.clone();
      stones.geometry = stoneGeo.clone();
      arms.geometry.setAttribute("aMark", armMark);
      posts.geometry.setAttribute("aMark", postMark);
      stones.geometry.setAttribute("aMark", stoneMark);
      for (const m of [arms, posts, stones]) {
        m.count = n;
        m.frustumCulled = false;
        m.layers.set(MARKER_LAYER);
        group.add(m);
      }
      arms.count = n * 2;

      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const one = new THREE.Vector3(1, 1, 1);
      const actx = armAtlas.ctx;
      const sctx = stoneAtlas.ctx;
      actx.fillStyle = sctx.fillStyle = "#fff";
      actx.textAlign = sctx.textAlign = "center";
      actx.textBaseline = sctx.textBaseline = "middle";
      const solids: SolidShape[] = [];
      const capsules: Furnishing["capsules"][number][] = [];
      placed = [];
      armNames = [];
      stoneNames = [];
      found.forEach((f, k) => {
        // The post stands on the trail's right as it runs from `from` to `to`; the stone across from it.
        const nx = f.tz;
        const nz = -f.tx;
        const px = f.x + nx * f.off;
        const pz = f.z + nz * f.off;
        const sx = f.x - nx * f.off;
        const sz = f.z - nz * f.off;
        const py = heightAt(t.lattice, px, pz);
        m4.compose(new THREE.Vector3(px, py, pz), q.identity(), one);
        posts?.setMatrixAt(k, m4);
        postMark.setXYZ(k, 1, 0, 0);
        // Two arms, one each way along the trail, splayed away from it so a person walking that way reads it.
        for (const [j, dir, area, height] of [[0, 1, f.to, 2.0], [1, -1, f.from, 1.68]] as const) {
          const ax = f.tx * dir * Math.cos(SPLAY) + nx * Math.sin(SPLAY);
          const az = f.tz * dir * Math.cos(SPLAY) + nz * Math.sin(SPLAY);
          // Three's Y rotation turns local +x to (cos, -sin).
          q.setFromAxisAngle(up, Math.atan2(-az, ax));
          m4.compose(new THREE.Vector3(px + ax * POST.half, py + height, pz + az * POST.half), q, one);
          const slot = k * 2 + j;
          arms?.setMatrixAt(slot, m4);
          armMark.setXYZ(slot, 1, slot, 0);
          armNames.push(area.path);
          const cx = (slot % ARM_SLOT.cols) * ARM_SLOT.w + ARM_SLOT.w / 2;
          const cy = Math.floor(slot / ARM_SLOT.cols) * ARM_SLOT.h + ARM_SLOT.h / 2 + 3;
          fit(actx, area.name, "italic 600", 78, ARM_SLOT.w - 50);
          actx.fillText(area.name, cx, cy);
        }
        // The stone faces the tread; seen from the trail, each area's name is on its own side of the cut.
        const fx = nx;
        const fz = nz;
        const yaw = Math.atan2(fx, fz);
        const rightX = fz;
        const rightZ = -fx;
        const toOnRight = rightX * f.tx + rightZ * f.tz > 0;
        const [left, right] = toOnRight ? [f.from, f.to] : [f.to, f.from];
        let low = Infinity;
        for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
          low = Math.min(low, heightAt(t.lattice, sx + rightX * ox * STONE.width * 0.5 + fx * oz * STONE.thick * 0.5, sz + rightZ * ox * STONE.width * 0.5 + fz * oz * STONE.thick * 0.5));
        }
        q.setFromAxisAngle(up, yaw);
        m4.compose(new THREE.Vector3(sx, low - 0.04, sz), q, one);
        stones?.setMatrixAt(k, m4);
        stoneMark.setXYZ(k, 1, k, 0);
        stoneNames.push([left.path, right.path]);
        const ox = (k % STONE_SLOT.cols) * STONE_SLOT.w;
        const oy = Math.floor(k / STONE_SLOT.cols) * STONE_SLOT.h;
        const half = STONE_SLOT.w / 2;
        // Capitals, as stone is cut: the area to the left over a cut line, the one to the right beneath it, each pointing its way.
        for (const [text, cy] of [[`‹ ${left.name.toUpperCase()}`, 0.27], [`${right.name.toUpperCase()} ›`, 0.73]] as const) {
          fit(sctx, text, "600", 74, STONE_SLOT.w - 70);
          sctx.fillText(text, ox + half, oy + STONE_SLOT.h * cy);
        }
        sctx.fillRect(ox + half - 120, oy + STONE_SLOT.h * 0.5 - 3, 240, 6);

        solids.push({ x: px, z: pz, radius: POST.half * 1.5 });
        const hw = STONE.width / 2;
        const ht = STONE.thick / 2;
        solids.push({ points: [[-1, -1], [1, -1], [1, 1], [-1, 1]].flatMap(([a, b]) => [sx + rightX * (a as number) * hw + fx * (b as number) * ht, sz + rightZ * (a as number) * hw + fz * (b as number) * ht]) });
        capsules.push({ ax: sx - rightX * hw * 0.7, az: sz - rightZ * hw * 0.7, bx: sx + rightX * hw * 0.7, bz: sz + rightZ * hw * 0.7, radius: ht + 0.06 });
        placed.push({ x: f.x, z: f.z, from: f.from, to: f.to, post: { x: px, z: pz }, stone: { x: sx, z: sz } });
      });
      armAtlas.texture.needsUpdate = true;
      stoneAtlas.texture.needsUpdate = true;
      for (const m of [arms, posts, stones]) m.instanceMatrix.needsUpdate = true;
      return { capsules, solids };
    },
    vitality(of) {
      const armMark = arms?.geometry.getAttribute("aMark") as THREE.InstancedBufferAttribute | undefined;
      const stoneMark = stones?.geometry.getAttribute("aMark") as THREE.InstancedBufferAttribute | undefined;
      const postMark = posts?.geometry.getAttribute("aMark") as THREE.InstancedBufferAttribute | undefined;
      armNames.forEach((path, i) => armMark?.setX(i, of(path)));
      stoneNames.forEach(([a, b], i) => {
        const v = (of(a) + of(b)) / 2;
        stoneMark?.setX(i, v);
        postMark?.setX(i, v);
      });
      for (const a of [armMark, stoneMark, postMark]) if (a !== undefined) a.needsUpdate = true;
    },
    crossings: () => placed,
  };
}
