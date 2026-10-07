// Signs in the world that say what things are: a wooden signboard on a post
// at the end of each building's walk, and a small plaque on a stake at the
// foot of each tree, each with its name painted on. They are always there,
// so nothing appears as a person walks up; the name simply becomes readable
// as they come near, the way a real sign does, and the lantern lights it at
// night. All of them draw as one instanced mesh, their names from one atlas.
// A sign answers to the vitality of what it names: its paint fades and
// flakes, its wood greys, and it leans on its post.

import * as THREE from "three";
import { LIGHT_GLSL, type SceneLight } from "@gaia/render";

export interface Sign {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The way the painted face looks, about y. */
  readonly yaw: number;
  /** 1 is a building's signboard; smaller is a tree's plaque. */
  readonly scale: number;
  readonly name: string;
  /** A smaller second line, such as what the thing is. */
  readonly note: string;
  readonly vitality: number;
}

export interface Signs {
  readonly mesh: THREE.InstancedMesh;
  /** Replaces every sign. */
  set(signs: readonly Sign[]): void;
  setVitality(index: number, v: number): void;
  dispose(): void;
}

/** Board and post in meters, at scale 1: a board 1.1 m wide under a cross-arm, on a post 1.75 m tall. */
const BOARD = { w: 1.1, h: 0.5, d: 0.05, bottom: 1.05, post: 0.1, top: 1.75 };
const SLOT = { w: 512, h: 224, cols: 2, rows: 16 };

const SIGN_VERT = /* glsl */ `
attribute float aFace;
attribute vec2 aUv;
attribute vec4 aSign;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
varying float vFace;
varying float vLife;
mat3 turnAbout(vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  vec3 t = (1.0 - c) * k;
  return mat3(
    t.x * k.x + c, t.x * k.y + s * k.z, t.x * k.z - s * k.y,
    t.y * k.x - s * k.z, t.y * k.y + c, t.y * k.z + s * k.x,
    t.z * k.x + s * k.y, t.z * k.y - s * k.x, t.z * k.z + c);
}
void main() {
  float life = aSign.x;
  // A failing thing's sign leans on its post, more the further it has gone.
  float lean = (1.0 - life) * (1.0 - life) * 0.32;
  float a = aSign.y;
  mat3 tilt = turnAbout(vec3(cos(a), 0.0, sin(a)), lean);
  vec3 p = tilt * position;
  vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * (tilt * normal));
  float slot = aSign.z;
  vec2 cell = vec2(mod(slot, ${SLOT.cols}.0), floor(slot / ${SLOT.cols}.0));
  vUv = (cell + aUv) / vec2(${SLOT.cols}.0, ${SLOT.rows}.0);
  vFace = aFace;
  vLife = life;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SIGN_FRAG = /* glsl */ `
precision highp float;
${LIGHT_GLSL}
uniform sampler2D uNames;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
varying float vFace;
varying float vLife;
float grain(vec2 p) { return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  // Weathered boards: warm brown, greying as what it names declines.
  vec3 wood = mix(vec3(0.42, 0.3, 0.2), vec3(0.44, 0.42, 0.39), (1.0 - vLife) * 0.8);
  float streak = grain(vWorld.xz * vec2(3.0, 40.0) + vWorld.y * 9.0);
  vec3 albedo = wood * (0.86 + 0.18 * streak);
  if (vFace > 0.5) {
    float ink = texture2D(uNames, vUv).r;
    // Paint flakes off a failing thing's sign in patches.
    float flake = smoothstep(0.25, 0.75, grain(vUv * vec2(260.0, 120.0)) * 0.6 + 0.4 * (1.0 - vLife) + 0.2);
    float paint = ink * mix(0.95, 0.35, (1.0 - vLife)) * mix(1.0, 1.0 - flake * 0.7, 1.0 - vLife);
    albedo = mix(albedo, vec3(0.93, 0.88, 0.76), paint);
  }
  vec3 n = normalize(vNormal);
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

/** One box's faces into the arrays; `face` marks the painted front, with its atlas coordinates. */
function addBox(out: { pos: number[]; nrm: number[]; face: number[]; uv: number[]; idx: number[] }, c: readonly number[], half: readonly number[], painted: boolean): void {
  const axes: readonly (readonly [number, number, number])[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let i = 0; i < 3; i++) {
    for (const sign of [-1, 1]) {
      const n = (axes[i] as readonly number[]).map((x) => x * sign);
      const t1 = axes[(i + 1) % 3] as readonly [number, number, number];
      const t2 = axes[(i + 2) % 3] as readonly [number, number, number];
      const h1 = half[(i + 1) % 3] as number;
      const h2 = half[(i + 2) % 3] as number;
      const base = out.pos.length / 3;
      const front = painted && i === 2 && sign === 1;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        for (let k = 0; k < 3; k++) out.pos.push((c[k] as number) + (n[k] as number) * (half[i] as number) + (t1[k] as number) * u * h1 + (t2[k] as number) * v * h2);
        out.nrm.push(...n);
        out.face.push(front ? 1 : 0);
        // On the front (+z) face, t1 is x and t2 is y.
        out.uv.push(front ? (u + 1) / 2 : 0, front ? 1 - (v + 1) / 2 : 0);
      }
      const [ax, ay, az] = t1;
      const [bx, by, bz] = t2;
      const facing = (ay * bz - az * by) * (n[0] as number) + (az * bx - ax * bz) * (n[1] as number) + (ax * by - ay * bx) * (n[2] as number) > 0;
      if (facing) out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else out.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
}

function signGeometry(): THREE.BufferGeometry {
  const out = { pos: [] as number[], nrm: [] as number[], face: [] as number[], uv: [] as number[], idx: [] as number[] };
  const b = BOARD;
  // The post, sunk a little; the cross-arm the board hangs from; the board.
  addBox(out, [0, b.top / 2 - 0.1, -0.06], [b.post / 2, b.top / 2 + 0.1, b.post / 2], false);
  addBox(out, [0, b.bottom + b.h + 0.12, -0.06], [b.w / 2 + 0.08, 0.04, 0.05], false);
  addBox(out, [0, b.bottom + b.h / 2, 0], [b.w / 2, b.h / 2, b.d / 2], true);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(out.nrm, 3));
  g.setAttribute("aFace", new THREE.Float32BufferAttribute(out.face, 1));
  g.setAttribute("aUv", new THREE.Float32BufferAttribute(out.uv, 2));
  g.setIndex(out.idx);
  return g;
}

/** Paints each name and note into its slot of the atlas, shrinking a long name to fit. */
function paintNames(canvas: HTMLCanvasElement, signs: readonly Sign[]): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  signs.forEach((sign, i) => {
    const x = (i % SLOT.cols) * SLOT.w + SLOT.w / 2;
    const y = Math.floor(i / SLOT.cols) * SLOT.h;
    let size = 92;
    ctx.font = `italic 600 ${size}px Georgia, "Iowan Old Style", "Times New Roman", serif`;
    while (ctx.measureText(sign.name).width > SLOT.w - 56 && size > 40) {
      size -= 4;
      ctx.font = `italic 600 ${size}px Georgia, "Iowan Old Style", "Times New Roman", serif`;
    }
    ctx.fillText(sign.name, x, y + SLOT.h * (sign.note === "" ? 0.5 : 0.42));
    if (sign.note !== "") {
      ctx.font = `600 30px Georgia, "Times New Roman", serif`;
      ctx.fillText(sign.note.toUpperCase().split("").join(" "), x, y + SLOT.h * 0.8);
    }
  });
}

export function createSigns(light: SceneLight, capacity = SLOT.cols * SLOT.rows): Signs {
  const canvas = document.createElement("canvas");
  canvas.width = SLOT.w * SLOT.cols;
  canvas.height = SLOT.h * SLOT.rows;
  const names = new THREE.CanvasTexture(canvas);
  names.colorSpace = THREE.NoColorSpace;
  // Slots count down from the canvas's top, as the shader reads them.
  names.flipY = false;
  names.anisotropy = 8;
  names.generateMipmaps = true;
  names.minFilter = THREE.LinearMipmapLinearFilter;
  const geometry = signGeometry();
  const life = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  geometry.setAttribute("aSign", life);
  const material = new THREE.ShaderMaterial({ vertexShader: SIGN_VERT, fragmentShader: SIGN_FRAG, uniforms: { ...light, uNames: { value: names } } });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  return {
    mesh,
    set(signs) {
      const shown = signs.slice(0, capacity);
      paintNames(canvas, shown);
      names.needsUpdate = true;
      shown.forEach((s, i) => {
        q.setFromAxisAngle(up, s.yaw);
        m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.scale, s.scale, s.scale));
        mesh.setMatrixAt(i, m);
        // Each sign leans its own way: mostly back or to one side, never into the reader.
        life.setXYZW(i, s.vitality, ((i * 2.399) % (Math.PI * 2)) * 0.5 + 0.2, i, 0);
      });
      mesh.count = shown.length;
      mesh.instanceMatrix.needsUpdate = true;
      life.needsUpdate = true;
    },
    setVitality(index, v) {
      life.setX(index, Math.min(1, Math.max(0, v)));
      life.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      names.dispose();
      mesh.removeFromParent();
    },
  };
}
