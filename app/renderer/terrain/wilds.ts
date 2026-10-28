// What grows on the wild land past the codebase's land: the wild's own two
// ground covers (tall green grass and tall dry grass, which the ground and the
// grass draw) and scattered thickets of the bush Jev composed for each cover
// from the world around it (`composeWorld`), drawn as instanced copies like
// the understory. It stands for nothing, so nothing here has a sign, a card
// or a vitality from code: it is always healthy.
//
// Bushes stand in seeded thickets on a fixed world grid, so a bush never
// moves, and each thicket is the bush of the cover it grows in. Only those
// near enough to be seen stand: around an anchor that follows the person in
// jumps, out to just past where land has fully dissolved into the sky
// (1.4 km). The copies that come and go when it jumps lie past that distance,
// so nothing ever appears or vanishes in view. A wild bush keeps the grass off
// its feet as a shrub on the land does (`SHRUB_CLEARS`): the clearings ask for
// the standing bushes near the grass as they draw their window.

import type * as THREE from "three";
import { type Blueprint, type GroundSpec, type Library, blueprintOf, seedOf } from "@gaia/schema";
import { biome } from "@gaia/kinds";
import { type Realized, realizeRegion } from "@gaia/realize";
import type { InstanceSpot, SceneLight } from "@gaia/render";
import { type Terrain, WILD_THICKETS, wildHeightAt, wildPatch, wildThicket } from "@gaia/terrain";
import type { Clearing, Clearings } from "./clearings.ts";
import { WILD_GROUNDS } from "./looks.ts";
import { type BuildAsk, made, makeLater, plantAsk } from "./made.ts";
import type { RegionCovers } from "./regions.ts";
import { SHRUB_CLEARS, outlineOf } from "./understory.ts";
import { type Copies, FAR, type FarForms, type FarOf, createCopies } from "./woods.ts";

export const WILD_GROWTH = {
  /**
   * Bushes stand within `reach` of the anchor, which jumps to the person once
   * they are `recenter` from it, meters: `reach - recenter` stays past the
   * 1.4 km where land has fully dissolved, so no copy that comes or goes is seen.
   */
  reach: 1640,
  recenter: 200,
  /** How far a bush sinks into the ground, meters. */
  sink: 0.08,
  /** Every wild thing is healthy. */
  vitality: 0.9,
  /** The wild's covers grow this share of their blades: a little sparser than the land, so the tall blades cost no more than a tall cover on the land. */
  density: 0.9,
} as const;

export interface WildGrowth {
  /** Every instanced blueprint, for culling each pass, warming and the sun's shadow. */
  readonly all: () => readonly Copies[];
  /** Each bush's blueprint, build and far form: what the swap test stands alone. */
  readonly farBuilds: () => readonly { readonly blueprint: Blueprint; readonly plant: () => Realized; readonly far: FarOf }[];
  /**
   * Makes the build of the bush Jev composed for each of the wild's grounds (`CodeWorld.wild`, in `WILD_GROUNDS`'
   * order), its far form and its instances, once, when the world opens and before anything stands.
   */
  build(blueprints: readonly Blueprint[]): void;
  /** Takes on a new bake: stands the bushes again around the anchor. */
  update(t: Terrain): void;
  /** Called every frame the person walks: the anchor jumps to them once they are far from it. */
  follow(x: number, z: number): void;
  /** Shows the bushes walking and hides them in views from above, where they would stand past the coarse wild ring. */
  show(on: boolean): void;
}

/** One world cell's thicket (`wildThicket`), if it holds one: the bush of the ground it grows in, and its bushes standing on the ground. */
function thicketIn(t: Terrain, ci: number, cj: number, grounds: number): { ground: number; spots: InstanceSpot[] } | null {
  const thicket = wildThicket(t, ci, cj);
  if (thicket === null) return null;
  const spots = thicket.bushes.map((b): InstanceSpot => {
    const y = wildHeightAt(t, b.x, b.z);
    return {
      x: b.x,
      y: y - WILD_GROWTH.sink,
      z: b.z,
      yaw: b.yaw,
      scale: b.scale,
      slope: [(wildHeightAt(t, b.x + 0.5, b.z) - y) * 2, (wildHeightAt(t, b.x, b.z + 0.5) - y) * 2],
      vitality: WILD_GROWTH.vitality,
      hue: b.hue,
      seed: b.seed,
    };
  });
  // The ground at the cell's middle, as the covers mingle: the first is the green grass, the last the golden steppe.
  const { cell } = WILD_THICKETS;
  return { ground: Math.min(grounds - 1, Math.floor(wildPatch((ci + 0.5) * cell, (cj + 0.5) * cell) * grounds)), spots };
}

/** Each cell's thicket, once seeded, by "ci,cj". */
type Thickets = Map<string, ReturnType<typeof thicketIn>>;

/** Cell (ci, cj)'s thicket, seeded once and kept in `cache`. */
function thicketOf(t: Terrain, ci: number, cj: number, grounds: number, cache: Thickets): ReturnType<typeof thicketIn> {
  const key = `${ci},${cj}`;
  let thicket = cache.get(key);
  if (thicket === undefined) {
    thicket = thicketIn(t, ci, cj, grounds);
    cache.set(key, thicket);
  }
  return thicket;
}

/** Whether cell (ci, cj)'s thicket stands around an anchor at (ax, az): its cell's middle within `WILD_GROWTH.reach`. */
const standsAround = (ci: number, cj: number, ax: number, az: number): boolean => Math.hypot((ci + 0.5) * WILD_THICKETS.cell - ax, (cj + 0.5) * WILD_THICKETS.cell - az) <= WILD_GROWTH.reach;

/**
 * Each ground's bush's copies within `WILD_GROWTH.reach` of (ax, az).
 * `cache` keeps each cell's thicket from one call to the next, so a jump of
 * the anchor seeds only the cells it newly reaches.
 */
function wildSpots(t: Terrain, ax: number, az: number, grounds: number, cache: Thickets): InstanceSpot[][] {
  const { reach } = WILD_GROWTH;
  const { cell } = WILD_THICKETS;
  const out: InstanceSpot[][] = Array.from({ length: grounds }, () => []);
  const lo = (v: number): number => Math.floor((v - reach) / cell);
  const hi = (v: number): number => Math.ceil((v + reach) / cell);
  for (let cj = lo(az); cj <= hi(az); cj++) {
    for (let ci = lo(ax); ci <= hi(ax); ci++) {
      if (!standsAround(ci, cj, ax, az)) continue;
      const thicket = thicketOf(t, ci, cj, grounds, cache);
      if (thicket !== null) out[thicket.ground]?.push(...thicket.spots);
    }
  }
  // Forget cells long out of reach, so a long walk keeps a bounded cache.
  if (cache.size > 40_000) cache.clear();
  return out;
}

/**
 * The ground kept clear of grass under every bush standing around (ax, az)
 * (`wildSpots`) that could reach from (x0, z0) to (x1, z1). `clears` holds
 * each ground's bush's cleared outline at scale 1.
 */
function wildClearings(t: Terrain, ax: number, az: number, x0: number, z0: number, x1: number, z1: number, clears: readonly Float32Array[], cache: Thickets): Clearing[] {
  const { cell, spread, scale } = WILD_THICKETS;
  let farthest = 0;
  for (const outline of clears) for (const r of outline) farthest = Math.max(farthest, r);
  // A bush stands within `spread` of its thicket's middle, which lies in the thicket's cell.
  const margin = spread + farthest * scale[1];
  const out: Clearing[] = [];
  for (let cj = Math.floor((z0 - margin) / cell); cj <= Math.floor((z1 + margin) / cell); cj++) {
    for (let ci = Math.floor((x0 - margin) / cell); ci <= Math.floor((x1 + margin) / cell); ci++) {
      if (!standsAround(ci, cj, ax, az)) continue;
      const thicket = thicketOf(t, ci, cj, clears.length, cache);
      const outline = thicket === null ? undefined : clears[thicket.ground];
      if (thicket === null || outline === undefined) continue;
      for (const s of thicket.spots) out.push({ x: s.x, z: s.z, yaw: s.yaw, scale: s.scale, outline });
    }
  }
  return out;
}

/** The wild's covers, realized as a region's cover is. */
function wildGround(lib: Library): [GroundSpec, GroundSpec] {
  const [a, b] = WILD_GROUNDS.map((params, i) => {
    const blueprint = blueprintOf("biome", {
      relief: { use: "meadow@1", params: { undulation: "softly undulating", tilt: "level", facing: "north" } },
      cover: { use: "ground-cover@1", params: { ...params } },
      natives: { use: "native-families@1", params: { families: [] } },
    });
    const ground = realizeRegion({ blueprint, kind: biome }, lib, seedOf(`wilds/cover-${i}`)).ground;
    return { ...ground, density: ground.density * WILD_GROWTH.density };
  });
  return [a as GroundSpec, b as GroundSpec];
}

/**
 * The wild's growth: hands the wild's covers to the ground and the grass,
 * and stands its bushes once a world gives them (`build`), each keeping the
 * grass off its feet in `clearings`. `biomeLib` holds the biome primitives,
 * `floraLib` the flora ones. `farForms` takes each bush's far form; without
 * it, none turns far.
 */
export function createWildGrowth(scene: THREE.Scene, light: SceneLight, covers: RegionCovers, biomeLib: Library, floraLib: Library, clearings: Clearings, farForms?: FarForms): WildGrowth {
  covers.wild(wildGround(biomeLib));
  let views: Copies[] = [];
  let builds: { readonly blueprint: Blueprint; readonly plant: () => Realized; readonly far: FarOf }[] = [];
  /** Each ground's bush's outline at the ground that keeps the grass off, at scale 1. */
  let clears: Float32Array[] = [];
  let shown = true;
  let terrain: Terrain | null = null;
  const cache: Thickets = new Map();
  const anchor = { x: 0, z: 0 };
  // Until the bushes are built there are none, and no thicket is seeded: a thicket's bush is one of the grounds' built bushes.
  clearings.setNear((x0, z0, x1, z1) => (terrain === null || clears.length === 0 ? [] : wildClearings(terrain, anchor.x, anchor.z, x0, z0, x1, z1, clears, cache)));
  /** Respots still to make, one blueprint a frame, so a jump never costs one frame much. */
  let queue: { view: Copies; spots: InstanceSpot[] }[] = [];
  const stand = (t: Terrain, now: boolean): void => {
    if (views.length === 0) return;
    const spots = wildSpots(t, anchor.x, anchor.z, views.length, cache);
    queue = views.map((view, i) => ({ view, spots: spots[i] ?? [] }));
    if (now) {
      for (const q of queue) q.view.respot(q.spots);
      queue = [];
    }
  };
  return {
    all: () => views,
    farBuilds: () => builds,
    build(blueprints) {
      if (views.length > 0) throw new Error("The wild builds a world's bushes once, when it opens.");
      if (blueprints.length !== WILD_GROUNDS.length) throw new Error(`The wild has ${WILD_GROUNDS.length} grounds, each with its own bush; the world gives ${blueprints.length}.`);
      const asks = blueprints.map(plantAsk);
      const plants = asks.map((ask) => made(ask, floraLib));
      clears = plants.map((p) => outlineOf(p).map((r) => r * SHRUB_CLEARS));
      const fars = plants.map((p, i) => farForms?.add(p, () => makeLater(asks[i] as BuildAsk, floraLib), FAR.bush));
      views = plants.map((p, i) => {
        const view = createCopies(p, light, [], fars[i]);
        view.object.visible = shown;
        scene.add(view.object);
        return view;
      });
      // A bush's build goes once its instances are made and its far form baked; the swap test realizes it again.
      builds = asks.flatMap((ask, i) => {
        const far = fars[i];
        return far === undefined ? [] : [{ blueprint: ask.blueprint, plant: () => made(ask, floraLib), far }];
      });
      if (terrain !== null) stand(terrain, true);
    },
    show(on) {
      shown = on;
      for (const v of views) v.object.visible = on;
    },
    update(t) {
      terrain = t;
      cache.clear();
      stand(t, true);
    },
    follow(x, z) {
      const next = queue.shift();
      if (next !== undefined) next.view.respot(next.spots);
      if (terrain === null || Math.hypot(x - anchor.x, z - anchor.z) <= WILD_GROWTH.recenter) return;
      anchor.x = Math.round(x / WILD_THICKETS.cell) * WILD_THICKETS.cell;
      anchor.z = Math.round(z / WILD_THICKETS.cell) * WILD_THICKETS.cell;
      stand(terrain, false);
    },
  };
}
