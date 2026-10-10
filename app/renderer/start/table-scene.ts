// The map table in 3D: an oak table with a folded sheet on it, the worlds
// walked before as cards laid on the sheet, a quill, an inkwell and a brass
// lantern, lit by the world's own sun, sky, moon and lantern at the hour
// (`@gaia/render`'s light, with the light of "Meadow morning", since no
// world is open yet), and seen from a little above, the table past the sheet
// out of focus. The ground beyond the table is the world lab's meadow.
//
// It draws a frame only when asked (`render`): the page asks when something
// changes. The sun's shadow map is drawn again only when the light changes
// or a card moves.
//
// Choosing a card lifts it 4 cm and straightens it over half a second, then
// it rises toward the person over 1.3 s and turns to face them while the eye
// follows it and the table fades into the wait's paper beneath the page; it
// ends at the wait's sheet's size and place, as the picture the wait shows.

import * as THREE from "three";
import { Library, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES, WORLD_PRIMITIVES } from "@gaia/primitives";
import { biome, world as worldKind } from "@gaia/kinds";
import { WORLD_PRESETS, type WorldLook, realizeWorld } from "@gaia/realize";
import { LANTERN, applyLight, applySky, createSceneLight, createSunShadow, hexToVec3 } from "@gaia/render";
import type { StartOffer } from "../../world-service/protocol.ts";
import { createGround } from "../world/environment.ts";
import { type SheetBox, type Writing, paintFeather, paintSheetInk, paintWriting, seeded, writingBox, writingCanvas } from "./table-ink.ts";
import type { TableLayout } from "./table-layout.ts";
import { FEATHER_FRAGMENT, FLAME_FRAGMENT, GLASS_FRAGMENT, MAX_CASTERS, PAPER_FRAGMENT, POST_FRAGMENT, POST_VERTEX, SOLID_FRAGMENT, VERTEX, WOOD_FRAGMENT } from "./table-shaders.ts";

/** The table top's height, metres. */
const TOP = 0.76;
const TABLE_THICK = 0.045;
/** Choosing a card: lifting and straightening it, then its rise to the wait's sheet, seconds. */
export const LIFT_S = 0.5;
export const RISE_S = 1.3;
/** The share of a card the picture leaves to its paper on every side. */
const INSET = 0.035;
/** Where the sun stands over the table at every hour (its bearing, radians): behind it on the left, so its light rakes across the paper toward the person. */
const SUN_FROM = Math.atan2(-0.57, -0.82);

/** A rectangle on the page, CSS pixels. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface TableScene {
  readonly canvas: HTMLCanvasElement;
  /** Lights the table as the world is lit at hour `h`. */
  hour(h: number): void;
  /** Writes on the line. */
  write(w: Writing): void;
  /** Card `index`, `t` seconds after it was chosen, ending at the wait's sheet `to` (CSS pixels on the canvas); null puts every card back. */
  choose(index: number | null, t: number, to?: Rect): void;
  resize(w: number, h: number, dpr: number): void;
  /** Draws one frame. */
  render(): void;
  /** Where to touch, on the canvas: each card, the line and the folder's words. */
  hits(): { readonly cards: readonly Rect[]; readonly line: Rect; readonly folder: Rect };
  /** Compiles every material before the first frame, off the page's thread where the browser can. */
  compile(): Promise<void>;
  dispose(): void;
}

export interface TableWorld {
  readonly world: StartOffer["recent"][number];
  /** Its picture, decoded; null for a world with none. */
  readonly picture: HTMLImageElement | null;
}

interface Card {
  readonly caster: number;
  /** How far it is turned at rest, radians. */
  readonly restTurnAngle: number;
  readonly group: THREE.Group;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly rest: Float32Array;
  readonly flat: Float32Array;
  readonly restAt: THREE.Vector3;
  readonly restTurn: THREE.Quaternion;
  readonly side: number;
}

const ease = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** The light of "Meadow morning", the world lab's first world, at hour `h`. */
const meadow = (() => {
  const lib = new Library([...WORLD_PRIMITIVES, ...BIOME_PRIMITIVES, ...RELIEF_PRIMITIVES]);
  const preset = WORLD_PRESETS.find((p) => p.name === "Meadow morning") ?? WORLD_PRESETS[0];
  if (preset === undefined) throw new Error("There are no named worlds.");
  return (h: number): WorldLook => realizeWorld({ blueprint: preset.world, kind: worldKind }, { blueprint: preset.biome, kind: biome }, lib, seedOf("start/table"), h);
})();

export function createTableScene(l: TableLayout, worlds: readonly TableWorld[], logo: HTMLImageElement, size: { w: number; h: number; dpr: number }): TableScene {
  const canvas = document.createElement("canvas");
  // Alpha, so the table can fade into the wait's own paper beneath the page.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const light = createSceneLight();
  const scene = new THREE.Scene();
  const ground = createGround(light, { uVitality: { value: 0.9 } });
  scene.add(ground.mesh);
  const shadow = createSunShadow(light, 2048);
  shadow.frame(new THREE.Vector3(0, TOP, 0), 1.2);
  let shadowDirty = true;

  // ---------- contact shade where things touch the table and the sheet ----------
  const casterBox = Array.from({ length: MAX_CASTERS }, () => new THREE.Vector4());
  const casterSoft = Array.from({ length: MAX_CASTERS }, () => new THREE.Vector4());
  const casterCount = { value: 0 };
  /** The shadow of a card being lifted: its box on the table, and its turn, strength, softness and the height above which nothing takes it. */
  const heldBox = new THREE.Vector4();
  const heldShade = new THREE.Vector4();
  const surface = { uCasterBox: { value: casterBox }, uCasterSoft: { value: casterSoft }, uCasterCount: casterCount, uHeldBox: { value: heldBox }, uHeldShade: { value: heldShade } };
  /** A caster: its middle on the table, half size, turn, how dark its shade, how far it spreads, and the surface it belongs to. */
  const addCaster = (x: number, z: number, hx: number, hz: number, turn: number, dark: number, soft: number, self: number): number => {
    const i = Math.min(MAX_CASTERS - 1, casterCount.value++);
    casterBox[i]?.set(x, z, hx, hz);
    casterSoft[i]?.set(turn, dark, soft, self);
    return i;
  };
  const material = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, extra: THREE.ShaderMaterialParameters = {}): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader, uniforms: { ...light, ...surface, uLifted: { value: 0 }, ...uniforms }, ...extra });

  // ---------- the table ----------
  const table = new THREE.Group();
  const plank = { value: l.table.d / 5 };
  const top = new THREE.Mesh(new THREE.BoxGeometry(l.table.w, TABLE_THICK, l.table.d), material(WOOD_FRAGMENT, { uLeg: { value: 0 }, uPlank: plank }));
  top.position.y = TOP - TABLE_THICK / 2;
  table.add(top);
  const legWood = material(WOOD_FRAGMENT, { uLeg: { value: 1 }, uPlank: plank });
  const under = TOP - TABLE_THICK;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.065, under, 0.065), legWood);
    leg.position.set(x * (l.table.w / 2 - 0.09), under / 2, z * (l.table.d / 2 - 0.09));
    table.add(leg);
  }
  for (const [w, d, x, z] of [[l.table.w - 0.2, 0.025, 0, -1], [l.table.w - 0.2, 0.025, 0, 1], [0.025, l.table.d - 0.2, -1, 0], [0.025, l.table.d - 0.2, 1, 0]] as const) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, d), legWood);
    rail.position.set(x * (l.table.w / 2 - 0.09), under - 0.045, z * (l.table.d / 2 - 0.09));
    table.add(rail);
  }
  scene.add(table);

  // ---------- the sheet, folded in four ----------
  const { w: sw, h: sh, turn: sheetTurn } = l.sheet;
  /** How far the sheet lifts off the table at a point of it: settling into its folds, two corners curling, a slight wave. */
  const sheetLift = (sx: number, sy: number): number => {
    const u = sx / sw;
    const v = sy / sh;
    const corner = (cu: number, cv: number, k: number): number => k * Math.pow(Math.max(0, 1 - Math.hypot(u - cu, (v - cv) * (sh / sw)) / 0.2), 2.4);
    return 0.0006 + 0.0035 * Math.abs(2 * u - 1) + 0.0022 * (1 - Math.abs(2 * v - 1)) + corner(1, 1, 0.016) + corner(0, 0, 0.009) + corner(1, 0, 0.004) + Math.max(0, 0.0012 * Math.sin(u * 7.3 + v * 3.1) * Math.sin(v * 5.2));
  };
  const cosT = Math.cos(sheetTurn);
  const sinT = Math.sin(sheetTurn);
  /** A point of the sheet (metres from its far left corner) in the world, `above` its surface. */
  const onSheet = (sx: number, sy: number, above = 0): THREE.Vector3 => {
    const lx = sx - sw / 2;
    const lz = sy - sh / 2;
    return new THREE.Vector3(l.sheet.x + cosT * lx - sinT * lz, TOP + sheetLift(sx, sy) + above, l.sheet.z + sinT * lx + cosT * lz);
  };
  const axisX = new THREE.Vector3(cosT, 0, sinT);
  const axisY = new THREE.Vector3(-sinT, 0, cosT);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 3000);
  let restFocus = 1.4;
  let restFar = 1.6;
  place();
  // The ink at about the screen's own resolution: the sheet's width on the screen, with some to spare.
  const across = (() => {
    const a = onSheet(0, sh / 2).project(camera);
    const b = onSheet(sw, sh / 2).project(camera);
    return (Math.abs(b.x - a.x) / 2) * size.w * size.dpr;
  })();
  const pxPerM = Math.min(3600, Math.max(1200, (across / sw) * 1.15));
  const ink = new THREE.CanvasTexture(paintSheetInk(l, worlds.map((w) => w.world), logo, pxPerM));
  const writingPaint = writingCanvas(l, pxPerM);
  const writing = new THREE.CanvasTexture(writingPaint);
  for (const t of [ink, writing]) {
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 8;
  }
  const [wx0, wy0, wx1, wy1] = writingBox(l);
  let folder: SheetBox = [0, 0, 0, 0];
  const paper = (o: { size: [number, number]; seed: number; base: number; tear: number; self: number; folded?: boolean; picture?: THREE.Texture | null }): THREE.ShaderMaterial =>
    material(
      PAPER_FRAGMENT,
      {
        uSize: { value: new THREE.Vector2(...o.size) },
        uSeed: { value: o.seed },
        uBase: { value: hexToVec3(o.base) },
        uTear: { value: o.tear },
        uFolded: { value: o.folded === true ? 1 : 0 },
        uInk: { value: o.folded === true ? ink : null },
        uHasInk: { value: o.folded === true ? 1 : 0 },
        uWriting: { value: o.folded === true ? writing : null },
        uWritingAt: { value: new THREE.Vector4(wx0 / sw, 1 - wy1 / sh, wx1 / sw, 1 - wy0 / sh) },
        uHasWriting: { value: o.folded === true ? 1 : 0 },
        uPicture: { value: o.picture ?? null },
        uHasPicture: { value: o.picture === null || o.picture === undefined ? 0 : 1 },
        uInset: { value: INSET },
        uSelf: { value: o.self },
        uFlat: { value: 0 },
        uAxisX: { value: axisX.clone() },
        uAxisY: { value: axisY.clone() },
      },
      { side: THREE.DoubleSide, alphaToCoverage: true },
    );
  const sheet = new THREE.Mesh(grid(sw, sh, l.phone ? 90 : 160, l.phone ? 150 : 106, onSheet), paper({ size: [sw, sh], seed: 7, base: 0xf4e2cf, tear: 1.4, self: 0, folded: true }));
  scene.add(sheet);
  const middle = onSheet(sw / 2, sh / 2);
  addCaster(middle.x, middle.z, sw / 2 - 0.004, sh / 2 - 0.004, sheetTurn, 0.45, 0.005, 0);

  // ---------- the cards: each world's map on its own torn card, laid a little askew, bowed, one corner lifted ----------
  const pictures: THREE.Texture[] = [];
  const cards: Card[] = worlds.flatMap((w, i): Card[] => {
    const c = l.cards[i];
    if (c === undefined) return [];
    const r = seeded(500 + i * 13);
    const turn = (r() - 0.5) * 0.09;
    const curled = Math.floor(r() * 4);
    const segs = 56;
    const [cu, cv] = ([[0, 0], [1, 0], [1, 1], [0, 1]] as const)[curled] ?? [1, 1];
    const rest = new Float32Array((segs + 1) ** 2 * 3);
    const flat = new Float32Array((segs + 1) ** 2 * 3);
    const uvs = new Float32Array((segs + 1) ** 2 * 2);
    // The card's own frame: x to the right, y up from the paper, z toward the person.
    for (let iy = 0; iy <= segs; iy++) {
      for (let ix = 0; ix <= segs; ix++) {
        const [u, v] = [ix / segs, iy / segs];
        const k = iy * (segs + 1) + ix;
        const lx = (u - 0.5) * c.side;
        const lz = (v - 0.5) * c.side;
        // At rest it follows the sheet's folds beneath it, with its own bow and its curled corner.
        const under = sheetLift(c.x + Math.cos(turn) * lx - Math.sin(turn) * lz, c.y + Math.sin(turn) * lx + Math.cos(turn) * lz) - sheetLift(c.x, c.y);
        const own = 0.0022 * (2 * u - 1) ** 2 + 0.009 * Math.max(0, 1 - Math.hypot(u - cu, v - cv) / 0.32) ** 2.2;
        rest.set([lx, under + own, lz], k * 3);
        flat.set([lx, 0, lz], k * 3);
        uvs.set([u, 1 - v], k * 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(rest.slice(), 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices(segs, segs));
    geometry.computeVertexNormals();
    let picture: THREE.Texture | null = null;
    if (w.picture !== null) {
      picture = new THREE.Texture(w.picture);
      picture.colorSpace = THREE.NoColorSpace;
      picture.anisotropy = 8;
      picture.needsUpdate = true;
      pictures.push(picture);
    }
    const mesh = new THREE.Mesh(geometry, paper({ size: [c.side, c.side], seed: 40 + i, base: 0xf2e8cc, tear: 0.9, self: i + 1, picture }));
    const group = new THREE.Group();
    group.add(mesh);
    group.position.copy(onSheet(c.x, c.y, 0.0009));
    group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -(turn + sheetTurn));
    mesh.material.uniforms.uAxisX?.value.set(1, 0, 0).applyQuaternion(group.quaternion);
    mesh.material.uniforms.uAxisY?.value.set(0, 0, 1).applyQuaternion(group.quaternion);
    scene.add(group);
    const caster = addCaster(group.position.x, group.position.z, c.side / 2 - 0.006, c.side / 2 - 0.006, turn + sheetTurn, 0.38, 0.0045, i + 1);
    return [{ caster, restTurnAngle: turn + sheetTurn, group, mesh, rest, flat, restAt: group.position.clone(), restTurn: group.quaternion.clone(), side: c.side }];
  });

  // ---------- the inkwell, the lantern and the quill ----------
  const solid = (hex: number, o: { gloss?: number; spec?: number; metal?: number; wrap?: number; stain?: number } = {}): THREE.ShaderMaterial =>
    material(SOLID_FRAGMENT, { uColor: { value: hexToVec3(hex) }, uGloss: { value: o.gloss ?? 30 }, uSpec: { value: o.spec ?? 0.2 }, uMetal: { value: o.metal ?? 0 }, uWrap: { value: o.wrap ?? 0.1 }, uStain: { value: o.stain ?? 0 } }, { side: THREE.DoubleSide });
  const brass = solid(0xb8904a, { gloss: 46, spec: 1.2, metal: 1 });
  // A squat glazed pot with a brass collar.
  const [ix, iz] = l.inkwell;
  const pot = new THREE.Mesh(
    new THREE.LatheGeometry(
      ([[0, 0], [0.033, 0], [0.037, 0.004], [0.038, 0.022], [0.034, 0.036], [0.022, 0.044], [0.0155, 0.048], [0.0155, 0.054], [0.0135, 0.0545], [0.012, 0.05], [0, 0.049]] as const).map(([x, y]) => new THREE.Vector2(x, y)),
      40,
    ),
    solid(0x1a2230, { gloss: 140, spec: 1.6, wrap: 0 }),
  );
  pot.position.set(ix, TOP, iz);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.0158, 0.0022, 10, 40), brass);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(ix, TOP + 0.0505, iz);
  const inkPool = new THREE.Mesh(new THREE.CircleGeometry(0.012, 24), solid(0x07060a, { gloss: 200, spec: 2 }));
  inkPool.rotation.x = -Math.PI / 2;
  inkPool.position.set(ix, TOP + 0.0495, iz);
  scene.add(pot, collar, inkPool);
  addCaster(ix, iz, 0.032, 0.032, 0, 0.7, 0.014, -2);

  // A brass lantern with glass and a candle, lit once the night comes.
  const lantern = new THREE.Group();
  const lanternPart = (geometry: THREE.BufferGeometry, y: number, m: THREE.Material = brass): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, m);
    mesh.position.y = y;
    lantern.add(mesh);
    return mesh;
  };
  lanternPart(new THREE.CylinderGeometry(0.052, 0.058, 0.016, 28), 0.008);
  lanternPart(new THREE.ConeGeometry(0.058, 0.045, 28, 1, true), 0.1685);
  lanternPart(new THREE.CylinderGeometry(0.056, 0.056, 0.008, 28, 1, true), 0.146);
  lanternPart(new THREE.TorusGeometry(0.024, 0.0028, 8, 30), 0.206);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    lanternPart(new THREE.CylinderGeometry(0.0032, 0.0032, 0.13, 8), 0.081).position.set(Math.cos(a) * 0.05, 0.081, Math.sin(a) * 0.05);
  }
  lanternPart(new THREE.CylinderGeometry(0.014, 0.015, 0.05, 20), 0.041, solid(0xeee2c4, { wrap: 0.6, spec: 0.1 }));
  const glow = { glass: { value: 0 }, flame: { value: 0 } };
  const glass = lanternPart(new THREE.CylinderGeometry(0.046, 0.046, 0.13, 32, 1, true), 0.081, new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: GLASS_FRAGMENT, uniforms: { ...light, uGlow: glow.glass }, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  glass.renderOrder = 2;
  const flame = lanternPart(new THREE.PlaneGeometry(0.03, 0.05), 0.086, new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FLAME_FRAGMENT, uniforms: { uGlow: glow.flame }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.renderOrder = 3;
  lantern.position.set(l.lantern[0], TOP, l.lantern[1]);
  scene.add(lantern);
  addCaster(l.lantern[0], l.lantern[1], 0.05, 0.05, 0, 0.65, 0.018, -3);

  // A quill resting by the line, its tip stained with ink.
  const nib = onSheet(l.quill.nib[0], l.quill.nib[1]);
  const tip = onSheet(Math.min(l.quill.tip[0], sw - 0.01), l.quill.tip[1]);
  if (l.quill.tip[0] > sw) tip.x += l.quill.tip[0] - sw;
  const featherTexture = new THREE.CanvasTexture(paintFeather(512, 128, 77));
  featherTexture.colorSpace = THREE.NoColorSpace;
  featherTexture.anisotropy = 8;
  const quill = buildQuill(nib, tip, solid(0xe8e0cc, { gloss: 60, spec: 0.5, wrap: 0.5, stain: 1 }), material(FEATHER_FRAGMENT, { uMap: { value: featherTexture } }, { side: THREE.DoubleSide, alphaToCoverage: true }));
  scene.add(quill);
  const along = nib.clone().lerp(tip, 0.5);
  addCaster(along.x, along.z, nib.distanceTo(tip) * 0.4, 0.002, Math.atan2(tip.z - nib.z, tip.x - nib.x), 0.3, 0.004, -4);

  // ---------- the focus: everything at the sheet's distance is sharp ----------
  let target: THREE.WebGLRenderTarget | null = null;
  let liftTarget: THREE.WebGLRenderTarget | null = null;
  const post = new THREE.ShaderMaterial({
    vertexShader: POST_VERTEX,
    fragmentShader: POST_FRAGMENT,
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
      tLift: { value: null },
      uRes: { value: new THREE.Vector2() },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uFocus: { value: restFocus },
      uFocusFar: { value: restFar },
      uAperture: { value: l.phone ? 50 : 60 },
      uMaxBlur: { value: 9 },
      uFade: { value: 0 },
      uVignette: { value: 0.2 },
      uLifting: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post);
  postQuad.frustumCulled = false;
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pu = post.uniforms as Record<string, THREE.IUniform>;
  const setU = (name: string, value: number): void => void ((pu[name] as THREE.IUniform).value = value);

  /** Backs the camera off until the whole sheet fits, with the table showing round it, seen from a little above. */
  function place(): void {
    camera.aspect = size.w / size.h;
    camera.fov = l.phone ? 38 : 30;
    const pitch = THREE.MathUtils.degToRad(l.phone ? 64 : 56);
    const at = onSheet(sw / 2, sh * (l.phone ? 0.5 : 0.52));
    const back = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
    const corners = [onSheet(0, 0), onSheet(sw, 0), onSheet(0, sh), onSheet(sw, sh)];
    for (let d = 0.6; d < 6; d += 0.01) {
      camera.position.copy(at).addScaledVector(back, d);
      camera.lookAt(at);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      const fits = corners.every((c) => {
        const p = c.clone().project(camera);
        return Math.abs(p.x) < (l.phone ? 0.97 : 0.86) && p.y < (l.phone ? 0.86 : 0.9) && p.y > (l.phone ? -0.93 : -0.92);
      });
      if (fits) break;
    }
    const reach = corners.map((c) => camera.position.distanceTo(c));
    restFocus = Math.min(...reach) * 0.97;
    restFar = Math.max(...reach) * 1.03;
  }

  // ---------- the hour ----------
  let lit = Number.NaN;
  function hour(h: number): void {
    if (Math.abs(h - lit) < 1 / 60) return;
    lit = h;
    const look = meadow(h);
    applyLight(light, look.light);
    applySky(light, look);
    // The table faces so the sun comes from behind it on the left, raking across the paper toward the person.
    const turn = SUN_FROM - Math.atan2(light.uSunDirection.value.x, light.uSunDirection.value.z);
    const up = new THREE.Vector3(0, 1, 0);
    light.uSunDirection.value.applyAxisAngle(up, turn);
    light.uMoonDirection.value.applyAxisAngle(up, turn);
    ground.apply(look);
    shadow.frame(new THREE.Vector3(0, TOP, 0), 1.2);
    shadowDirty = true;
    light.uLanternPosition.value.set(l.lantern[0], TOP + flame.position.y, l.lantern[1]);
    glow.flame.value = light.uLanternIntensity.value / LANTERN.intensity;
    glow.glass.value = glow.flame.value * 0.9;
  }

  // ---------- choosing ----------
  let lifted: Card | null = null;
  function shape(c: Card, flatness: number): void {
    const position = c.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const at = position.array as Float32Array;
    for (let i = 0; i < at.length; i++) at[i] = (c.rest[i] as number) + ((c.flat[i] as number) - (c.rest[i] as number)) * flatness;
    position.needsUpdate = true;
    c.mesh.geometry.computeVertexNormals();
  }
  function choose(index: number | null, t: number, to?: Rect): void {
    for (const c of cards) {
      c.group.position.copy(c.restAt);
      c.group.quaternion.copy(c.restTurn);
      c.group.visible = true;
      shape(c, 0);
      const u = c.mesh.material.uniforms;
      (u.uFlat as THREE.IUniform).value = 0;
      (u.uLifted as THREE.IUniform).value = 0;
      (casterSoft[c.caster] as THREE.Vector4).y = 0.38;
    }
    heldShade.y = 0;
    setU("uFade", 0);
    setU("uFocus", restFocus);
    setU("uFocusFar", restFar);
    shadowDirty = true;
    const c = index === null ? undefined : cards[index];
    lifted = c ?? null;
    if (c === undefined) return;
    const a = ease(t / LIFT_S);
    const b = ease((t - LIFT_S) / RISE_S);
    shape(c, Math.max(a, b));
    const raised = c.restAt.clone().add(new THREE.Vector3(0, 0.04 * a, 0));
    const straight = c.restTurn.clone().slerp(new THREE.Quaternion(), a);
    // The wait's sheet: the card square to the view, as large on the screen and where the wait's sheet is.
    const end = to ?? { x: size.w * 0.05, y: (size.h - size.w * 0.9) / 2, w: size.w * 0.9, h: size.w * 0.9 };
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const depth = (c.side * size.h) / (2 * end.h * tan);
    const ndcX = ((end.x + end.w / 2) / size.w) * 2 - 1;
    const ndcY = 1 - ((end.y + end.h / 2) / size.h) * 2;
    const finalAt = new THREE.Vector3(ndcX * depth * tan * camera.aspect, ndcY * depth * tan, -depth).applyMatrix4(camera.matrixWorld);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const facing = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
    const finalTurn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, facing, up.clone().negate()));
    c.group.position.copy(raised).lerp(finalAt, b);
    c.group.position.y += Math.sin(b * Math.PI) * 0.05;
    c.group.quaternion.copy(straight).slerp(finalTurn, b);
    // As it rises it leaves the table's light and becomes the picture the wait shows.
    const u = c.mesh.material.uniforms;
    (u.uFlat as THREE.IUniform).value = ease((t - 0.6) / 1.0);
    (u.uLifted as THREE.IUniform).value = b > 0 ? 1 : 0;
    (casterSoft[c.caster] as THREE.Vector4).y = 0.38 * (1 - a);
    // Its shadow is a soft box where the sun's shadow map would draw it, so it softens, slides away from the light
    // and fades as the card rises, and never pops off the table.
    const height = c.group.position.y - c.restAt.y;
    const from = light.uSunIntensity.value > 0.05 ? light.uSunDirection.value : light.uMoonDirection.value;
    const away = height / Math.max(0.35, from.y);
    heldBox.set(c.restAt.x - from.x * away, c.restAt.z - from.z * away, c.side / 2 - 0.004, c.side / 2 - 0.004);
    // Soft as paper's shadow is under an open sky: its edge spreads over a few centimetres as the card rises.
    heldShade.set(c.restTurnAngle * (1 - a), 0.75 * THREE.MathUtils.smoothstep(height, 0, 0.01) * (1 - THREE.MathUtils.smoothstep(height, 0.03, 0.3)), 0.004 + height * 0.3, c.group.position.y - 0.003);
    setU("uFade", ease((t - 0.55) / 1.2));
    // The eye follows the card up, so the table falls out of focus as it goes.
    const toCard = camera.position.distanceTo(c.group.position);
    setU("uFocus", THREE.MathUtils.lerp(restFocus, toCard * 0.97, b));
    setU("uFocusFar", THREE.MathUtils.lerp(restFar, toCard * 1.03, b));
  }

  // ---------- drawing ----------
  const depthOnly = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  function render(): void {
    const w = Math.round(size.w * size.dpr);
    const h = Math.round(size.h * size.dpr);
    if (target === null || target.width !== w || target.height !== h) {
      target?.dispose();
      target = new THREE.WebGLRenderTarget(w, h, { samples: 4, depthTexture: new THREE.DepthTexture(w, h) });
      (pu.tColor as THREE.IUniform).value = target.texture;
      (pu.tDepth as THREE.IUniform).value = target.depthTexture;
      (pu.uRes as THREE.IUniform<THREE.Vector2>).value.set(w, h);
    }
    light.uEye.value.copy(camera.position);
    const rising = lifted !== null && (lifted.mesh.material.uniforms.uLifted as THREE.IUniform).value > 0;
    if (shadowDirty || lifted !== null) {
      // Once lit, the lantern's own light washes out the long shadow the moon would give it.
      scene.overrideMaterial = depthOnly;
      // A chosen card shades the table with its own soft box instead (`choose`).
      shadow.render(renderer, scene, [], [ground.mesh, glass, flame, ...(light.uLanternIntensity.value > 0.3 ? [lantern] : []), ...(lifted === null ? [] : [lifted.group])]);
      scene.overrideMaterial = null;
      shadowDirty = false;
    }
    if (lifted !== null) lifted.group.visible = !rising;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    if (lifted !== null && rising) {
      if (liftTarget === null || liftTarget.width !== w || liftTarget.height !== h) {
        liftTarget?.dispose();
        liftTarget = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
        (pu.tLift as THREE.IUniform).value = liftTarget.texture;
      }
      lifted.group.visible = true;
      renderer.setRenderTarget(liftTarget);
      renderer.clear();
      renderer.render(lifted.group, camera);
    }
    setU("uLifting", rising ? 1 : 0);
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(postQuad, postCamera);
  }

  /** Where a box on the sheet lies on the canvas. */
  const onScreen = (box: SheetBox): Rect => {
    const points = [onSheet(box[0], box[1]), onSheet(box[2], box[1]), onSheet(box[0], box[3]), onSheet(box[2], box[3])].map((p) => p.project(camera));
    const xs = points.map((p) => ((p.x + 1) / 2) * size.w);
    const ys = points.map((p) => ((1 - p.y) / 2) * size.h);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };

  const api: TableScene = {
    canvas,
    hour,
    write(w) {
      const g = writingPaint.getContext("2d") as CanvasRenderingContext2D;
      folder = paintWriting(g, l, w, pxPerM);
      writing.needsUpdate = true;
    },
    choose,
    resize(w, h, dpr) {
      size.w = w;
      size.h = h;
      size.dpr = dpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      place();
      setU("uFocus", restFocus);
      setU("uFocusFar", restFar);
      setU("uMaxBlur", 9 * dpr);
      // The flame always faces the person.
      flame.quaternion.copy(camera.quaternion);
    },
    render,
    hits() {
      return {
        cards: cards.map((c, i) => {
          const at = l.cards[i] as (typeof l.cards)[number];
          const half = c.side / 2 + 0.004;
          return onScreen([at.x - half, at.y - half, at.x + half, at.y + half]);
        }),
        line: onScreen([l.line.x0 - 0.02, l.line.y - l.line.size * 2, l.line.x1 + 0.02, l.line.y + l.line.size * 0.6]),
        folder: onScreen([folder[0] - 0.01, folder[1], folder[2] + 0.01, folder[3]]),
      };
    },
    async compile() {
      // The table's materials, the shadow pass's and the focus pass's, so the first frame waits on none of them.
      await renderer.compileAsync(scene, camera);
      scene.overrideMaterial = depthOnly;
      await renderer.compileAsync(scene, camera);
      scene.overrideMaterial = null;
      await renderer.compileAsync(postQuad, postCamera);
    },
    dispose() {
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) (m as THREE.Material).dispose();
      });
      for (const t of [ink, writing, featherTexture, ...pictures]) t.dispose();
      postQuad.geometry.dispose();
      post.dispose();
      depthOnly.dispose();
      target?.dispose();
      liftTarget?.dispose();
      shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
  api.resize(size.w, size.h, size.dpr);
  return api;
}

/** The triangles of a grid `nx` by `ny` cells. */
function indices(nx: number, ny: number): number[] {
  const out: number[] = [];
  for (let iy = 0; iy < ny; iy++)
    for (let ix = 0; ix < nx; ix++) {
      const a = iy * (nx + 1) + ix;
      out.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  return out;
}

/** A grid over the sheet, `nx` by `ny` cells, each point placed in the world by `at`. */
function grid(w: number, h: number, nx: number, ny: number, at: (sx: number, sy: number) => THREE.Vector3): THREE.BufferGeometry {
  const position = new Float32Array((nx + 1) * (ny + 1) * 3);
  const uv = new Float32Array((nx + 1) * (ny + 1) * 2);
  for (let iy = 0; iy <= ny; iy++)
    for (let ix = 0; ix <= nx; ix++) {
      const k = iy * (nx + 1) + ix;
      const p = at((ix / nx) * w, (iy / ny) * h);
      position.set([p.x, p.y, p.z], k * 3);
      uv.set([ix / nx, 1 - iy / ny], k * 2);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(indices(nx, ny));
  geometry.computeVertexNormals();
  return geometry;
}

/** A quill from its nib to the tip of its vane: a tapering shaft that bows and rises off the paper, and a vane resting tilted on one edge. */
function buildQuill(nib: THREE.Vector3, tip: THREE.Vector3, shaft: THREE.Material, vane: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const dir = tip.clone().sub(nib);
  const len = dir.length();
  dir.normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const at = (t: number): THREE.Vector3 =>
    nib
      .clone()
      .addScaledVector(dir, t * len)
      .addScaledVector(up, 0.0022 + Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * 0.006 * (1 - t * 0.4))
      .addScaledVector(side, Math.sin(t * Math.PI) * 0.012);
  const rings = 70;
  const segs = 10;
  const position: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const c = at(t);
    const along = at(Math.min(1, t + 0.01)).sub(at(Math.max(0, t - 0.01))).normalize();
    const n1 = new THREE.Vector3().crossVectors(along, up).normalize();
    const n2 = new THREE.Vector3().crossVectors(n1, along).normalize();
    // The cut end is a slanted nib.
    const r = (0.0024 * (1 - t * 0.78) + 0.0003) * (t < 0.035 ? 0.35 + (t / 0.035) * 0.65 : 1);
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const p = c.clone().addScaledVector(n1, Math.cos(a) * r).addScaledVector(n2, Math.sin(a) * r);
      position.push(p.x, p.y, p.z);
      uv.push(t, j / segs);
    }
  }
  const tube = new THREE.BufferGeometry();
  tube.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  tube.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  tube.setIndex(indices(segs, rings));
  tube.computeVertexNormals();
  group.add(new THREE.Mesh(tube, shaft));

  const vanePosition: number[] = [];
  const vaneUv: number[] = [];
  const lengthwise = 80;
  const crosswise = 8;
  for (let i = 0; i <= lengthwise; i++) {
    const t = i / lengthwise;
    const c = at(t);
    for (let j = 0; j <= crosswise; j++) {
      const s = (j / crosswise) * 2 - 1;
      const p = c
        .clone()
        .addScaledVector(side, s * 0.026)
        .addScaledVector(up, s * 0.0055 + s * s * 0.004 + 0.0004);
      vanePosition.push(p.x, p.y, p.z);
      vaneUv.push(t, j / crosswise);
    }
  }
  const strip = new THREE.BufferGeometry();
  strip.setAttribute("position", new THREE.Float32BufferAttribute(vanePosition, 3));
  strip.setAttribute("uv", new THREE.Float32BufferAttribute(vaneUv, 2));
  strip.setIndex(indices(crosswise, lengthwise));
  strip.computeVertexNormals();
  group.add(new THREE.Mesh(strip, vane));
  return group;
}

