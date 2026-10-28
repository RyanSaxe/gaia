// Draws the trails into the ground and grass, and builds the things along
// them. A trail represents a dependency between two entities and follows the
// ways of one network. The trail distance is the ground texture's fourth
// channel, so the ground paints worn earth and the grass parts from the same
// samples.
//
// Each way's wear follows the vitality of every trail on it (`wayWear` in
// @gaia/terrain). A clipmap texture records which ways each sample lies on
// and how far along them, and a small texture stores each way's wear at a few
// stations and is rewritten live, so wear changes with nothing rebaked. The
// footbridges, stepping stones, edging stones and cairns use the plant
// material, so they decline with their way's vitality like everything else.

import * as THREE from "three";
import { type Built, type Library, seedOf } from "@gaia/schema";
import { buildCairn, buildEdgingStones, buildFootbridge, buildSteppingStones } from "@gaia/primitives";
import { type Realized, mergeParts } from "@gaia/realize";
import { type PlantView, type SceneLight, createPlant } from "@gaia/render";
import { type Crossing, type EdgeStone, type Terrain, type TrailNetwork, type Way, crossingSeed, edgeStones, junctionVitality, wayVitalityAt, wayWear } from "@gaia/terrain";

/**
 * GLSL for the signed distance in meters to the nearest way's edge, negative
 * on the tread, read with the mesh's own triangle interpolation, and for the
 * ways' wear at a point, blended between each way's stations as `wayWearAt`
 * in @gaia/terrain does. Where ways meet, the more worn one shows. Declare
 * the ground texture's uniforms (`GROUND_SAMPLE_GLSL`) first.
 */
export const TRAIL_GLSL = /* glsl */ `
uniform highp sampler2DArray uTrailPlace;
uniform sampler2D uTrailEnds;
float trailAt(vec2 xz) { return groundSample4(xz).w; }
// One way's wear at a packed place (its index, plus how far along it in the fraction), between its four stations.
float trailWearOf(float packed) {
  if (packed < 0.0) return 0.0;
  float k = floor(packed);
  vec4 s = texelFetch(uTrailEnds, ivec2(int(k), 0), 0);
  float f = clamp((packed - k) / 0.999, 0.0, 1.0) * 3.0;
  return f < 1.0 ? mix(s.x, s.y, f) : f < 2.0 ? mix(s.y, s.z, f - 1.0) : mix(s.z, s.w, f - 2.0);
}
float trailWearSample(ivec2 i, int level) {
  vec2 p = texelFetch(uTrailPlace, clipAt(i, level), 0).xy;
  return max(trailWearOf(p.x), trailWearOf(p.y));
}
float trailWearLevel(vec2 p, int level) {
  vec2 g = clipLatticeGrid(p, level);
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  float h00 = trailWearSample(i, level);
  float h10 = trailWearSample(i + ivec2(1, 0), level);
  float h01 = trailWearSample(i + ivec2(0, 1), level);
  float h11 = trailWearSample(i + ivec2(1, 1), level);
  if (f.x + f.y <= 1.0) return h00 + f.x * (h10 - h00) + f.y * (h01 - h00);
  return h11 + (1.0 - f.x) * (h01 - h11) + (1.0 - f.y) * (h10 - h11);
}
float trailWearAt(vec2 xz) {
  vec2 p = clipLattice(xz);
  float a;
  int k = clipLevel(clipWorld(p), a);
  float w = trailWearLevel(p, k);
  return a > 0.0 ? mix(w, trailWearLevel(p, k + 1), a) : w;
}
`;

const texture = (data: Float32Array, width: number, height: number, format: THREE.PixelFormat): THREE.DataTexture => {
  const t = new THREE.DataTexture(data, width, height, format, THREE.FloatType);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
};

/** Each way's wear at its stations, shared by the ground and the grass. */
export const trailUniforms = {
  uTrailEnds: { value: texture(new Float32Array(4), 1, 1, THREE.RGBAFormat) },
};

/**
 * Writes each way's wear at its stations from the vitality of the entities
 * every trail on it joins (`wayWear`). Call it whenever an entity's vitality
 * changes. It only rewrites a texel per way.
 */
export function setTrailEnds(network: TrailNetwork, vitalityOf: (place: string) => number): void {
  const n = Math.max(1, network.ways.length);
  let ends = trailUniforms.uTrailEnds.value;
  if (ends.image.width !== n) {
    ends.dispose();
    ends = texture(new Float32Array(n * 4), n, 1, THREE.RGBAFormat);
    trailUniforms.uTrailEnds.value = ends;
  }
  const data = ends.image.data as Float32Array;
  network.ways.forEach((_, i) => data.set(wayWear(network, i, vitalityOf), i * 4));
  ends.needsUpdate = true;
}

/** One thing built along the trails: a crossing, a square of a way's edging stones, or a cairn. */
export interface WayPiece {
  /** Its center, and its radius in meters. */
  readonly x: number;
  readonly z: number;
  readonly reach: number;
  /** The radius of the largest single thing in it, meters: a bridge, a stone, a cairn. */
  readonly size: number;
}

export interface Ways {
  /** Every component built along the trails that is placed now, for shadows and the mirror. */
  readonly views: readonly PlantView[];
  /** Every piece, placed by the tile that contains its center. */
  readonly pieces: readonly WayPiece[];
  /** The radius of the largest single thing among the pieces, meters. */
  readonly largest: number;
  /** Places exactly these pieces, building any not yet built and dropping the rest. */
  place(pieces: readonly WayPiece[]): void;
  /** Sets each crossing's, edging's and cairn's vitality from the trails on its way (`wayVitalityAt`, `junctionVitality`). */
  setVitality(vitalityOf: (place: string) => number): void;
  dispose(): void;
}

const STONE_PALETTE = (lib: Library): Realized["palette"] => {
  const palette = lib.get("palette@1");
  return (palette.build as (p: unknown) => Realized["palette"])({ family: "spring-meadow", contrast: 1 });
};

/** The vitality a way's crossing shows, from the way's trails at the crossing (`wayVitalityAt`). */
export const crossingVitality = (network: TrailNetwork, way: number, c: Crossing, of: (place: string) => number): number =>
  wayVitalityAt(network, way, alongOf(network.ways[way] as Way, c.x, c.z), of);

/** How far along a way (0 to 1) its center line passes nearest a point. */
function alongOf(trail: Way, x: number, z: number): number {
  const pts = trail.points;
  const count = pts.length / 2;
  let best = 0;
  let near = Infinity;
  for (let k = 0; k < count; k++) {
    const d = Math.hypot((pts[k * 2] as number) - x, (pts[k * 2 + 1] as number) - z);
    if (d < near) {
      near = d;
      best = k;
    }
  }
  return best / Math.max(1, count - 1);
}

/** Side in meters of the squares a way's edging stones are built in. Each square's stones are one mesh, kept while it is near. */
const EDGING_SQUARE = 256;

/**
 * Builds each way's crossings and edging stones, and each junction's cairn,
 * as pieces placed only while their tile is (`place`), with a way's edging
 * stones grouped by square. `edging` is each way's stones when the bake set
 * them on the whole land. Otherwise they are set on `t`.
 */
export function createWays(scene: THREE.Scene, light: SceneLight, lib: Library, t: Terrain, network: TrailNetwork, edging?: readonly (readonly EdgeStone[])[]): Ways {
  const palette = STONE_PALETTE(lib);
  interface Piece extends WayPiece {
    readonly build: () => { built: Built; at: readonly [number, number, number, number] };
    readonly vitality: (of: (place: string) => number) => number;
    view: PlantView | null;
  }
  const pieces: Piece[] = [];
  let vitalityOf: ((place: string) => number) | null = null;
  const piece = (x: number, z: number, reach: number, size: number, build: Piece["build"], vitality: Piece["vitality"]): void => void pieces.push({ x, z, reach, size, build, vitality, view: null });
  network.ways.forEach((trail, i) => {
    trail.crossings.forEach((c, k) => {
      const seed = crossingSeed(trail, k);
      const vitality = (of: (place: string) => number): number => crossingVitality(network, i, c, of);
      if (trail.style.crossing === "footbridge") piece(c.x, c.z, c.span, c.span / 2, () => ({ built: buildFootbridge(c.span, trail.style.width, seed), at: [c.x, c.bank, c.z, c.yaw] }), vitality);
      else piece(c.x, c.z, c.span, c.span / 2, () => ({ built: buildSteppingStones(c.span, seed), at: [c.x, c.level, c.z, c.yaw] }), vitality);
    });
    // A way's edging stones, one mesh per square, each following its way's vitality.
    const stones = edging?.[i] ?? edgeStones(t, trail, seedOf(`${trail.id}/edging`));
    const squares = new Map<string, EdgeStone[]>();
    for (const st of stones) {
      const key = `${Math.floor(st.x / EDGING_SQUARE)},${Math.floor(st.z / EDGING_SQUARE)}`;
      const list = squares.get(key);
      if (list === undefined) squares.set(key, [st]);
      else list.push(st);
    }
    for (const [key, list] of squares) {
      const [sx, sz] = key.split(",").map(Number) as [number, number];
      piece((sx + 0.5) * EDGING_SQUARE, (sz + 0.5) * EDGING_SQUARE, EDGING_SQUARE * Math.SQRT1_2, list.reduce((r, st) => Math.max(r, st.size / 2), 0), () => ({ built: buildEdgingStones(list, seedOf(`${trail.id}/edging-stones/${key}`)), at: [0, 0, 0, 0] }), (of) => wayVitalityAt(network, i, 0.5, of));
    }
  });
  // A small cairn beside each junction that has one.
  for (const j of network.junctions) {
    const cairn = j.cairn;
    if (cairn === null) continue;
    piece(cairn.x, cairn.z, 2, 0.8, () => ({ built: buildCairn(seedOf(`${j.id}/cairn`)), at: [cairn.x, cairn.y, cairn.z, seedOf(`${j.id}/turn`) % 628 / 100] }), (of) => junctionVitality(network, j, of));
  }
  const views: PlantView[] = [];
  const drop = (p: Piece): void => {
    if (p.view === null) return;
    scene.remove(p.view.object);
    p.view.dispose();
    views.splice(views.indexOf(p.view), 1);
    p.view = null;
  };
  return {
    views,
    largest: pieces.reduce((r, p) => Math.max(r, p.size), 0),
    setVitality(of) {
      vitalityOf = of;
      for (const p of pieces) p.view?.setVitality(p.vitality(of));
    },
    pieces,
    place(wanted) {
      const keep = new Set(wanted);
      for (const p of pieces) {
        if (!keep.has(p)) {
          drop(p);
          continue;
        }
        if (p.view !== null) continue;
        const { built, at } = p.build();
        if (built.parts.length === 0) continue;
        const view = createPlant({ parts: mergeParts(built.parts), motion: { sway: 0, frequency: 0 }, palette, slots: new Map() }, light);
        view.object.position.set(at[0], at[1], at[2]);
        view.object.rotation.y = at[3];
        if (vitalityOf !== null) view.setVitality(p.vitality(vitalityOf));
        scene.add(view.object);
        views.push(view);
        p.view = view;
      }
    },
    dispose() {
      for (const p of pieces) drop(p);
    },
  };
}
