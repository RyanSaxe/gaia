// Far plants' own views. A copy that stands for something of the code (a
// definition, or a sample world's thing) draws its far card from its own
// views: the four nearest the eye, two azimuths by two elevations, baked from
// its own build at the power of two just above the size its crown covers, into
// the own atlas (`createOwnAtlas` in @gaia/render). Past the haze, where a
// crown is small and far enough that another build's card changes no block
// of the screen by a level of 255 (round 23's look-alike test), it draws its
// build's shared card instead, as every copy that stands for nothing does.
//
// Each frame, before anything draws, `update` finds every such copy's views:
// a copy turning toward a new pair of views drops the old column or row and
// bakes the new one, and until it has, the views it holds take the missing
// one's weight; a copy whose crown has grown past its tiles, or shrunk to a
// quarter of them, bakes a second set at the new size and swaps once all four
// are in. Copies bake ahead of need: before they reach the band where the
// card meets the full form, and before they come out of the haze. A copy
// coming out of the haze shows its own views only once all four are baked.
// Every view baked under the wait is kept in the far store, keyed by its
// build, size and direction, and read back instead of baked when it is needed
// again, in this visit or the next. Views baked while walking are not kept:
// reading a view back from the GPU costs a walking frame more than baking it.

import * as THREE from "three";
import { AIR, type Realized } from "@gaia/realize";
import { FAR_BAKE_VERSION, FAR_VIEWS, type FarCards, type FarViews, type OwnAtlas, type OwnSlot, createOwnAtlas, startFarViews } from "@gaia/render";
import { type FarStore, contentHash } from "./far-store.ts";
import { type Copies, FAR, GONE } from "./woods.ts";

const COARSE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/**
 * - `haze`: meters past which, with its crown under `hazeShare` of the size
 *   its plant turns far at, a copy draws its build's shared card. At device
 *   pixel ratio 2, trees of 32 px stood 548 to 997 m away, and another tree's
 *   card changed no block by more than 0.1 of a level there (round 23).
 * - `ratio`: each tile size over the next smaller. A copy takes a larger
 *   tile once its crown outgrows its own, and a smaller one only once its
 *   crown spans a quarter of it: each change bakes four views.
 * - `ahead`: how far ahead of need a copy bakes: that many times the band's
 *   size, and that many times nearer than the haze.
 * - `spread`: a walking frame looks at one in this many copies, in turn, as
 *   a far copy's views change over many frames.
 * - `views`: views a frame may bake while walking, and under the wait or
 *   after the eye jumps more than `jump` meters between frames, until it has
 *   caught up.
 * - `atlas`: the own atlas's width and the height it may grow to.
 */
export const OWN = {
  haze: 550,
  hazeShare: 0.25,
  ratio: 2,
  ahead: 1.15,
  spread: 4,
  views: { walking: 4, wait: 48 },
  jump: 100,
  atlas: COARSE ? { width: 2048, maxHeight: 2048 } : { width: 4096, maxHeight: 4096 },
} as const;

/** Copies of one plant, the plant to bake their views from, and which of them stand for something of the code (1). */
export interface OwnSet {
  readonly copies: Copies;
  readonly plant: Realized;
  readonly own: Uint8Array;
}

/** What the own views hold and did, since they were last read. */
export interface OwnStats {
  /** Copies drawing their own views, and copies holding tiles (drawn or baking ahead). */
  readonly shown: number;
  readonly held: number;
  /** Views a copy drawing its own views needs and has not baked yet, and views any copy holding tiles has yet to bake. */
  readonly missing: number;
  readonly pending: number;
  /** Bytes the tiles held take, and the atlas allocates. */
  readonly bytes: number;
  readonly allocated: number;
  /**
   * Since last read: views baked, views read back from the far store,
   * milliseconds spent baking on the page's thread, and the times a copy
   * needed views from its build: coming into range, a new tile size or a new
   * pair of views.
   */
  readonly baked: number;
  readonly kept: number;
  readonly bakeMs: number;
  /** Milliseconds every update took on the page's thread, since last read. */
  readonly updateMs: number;
  readonly entered: number;
  readonly resized: number;
  readonly turned: number;
}

/** A copy's tiles of one size: which azimuths its columns and elevations its rows hold, and which of the four are baked. */
interface Tiles {
  readonly slot: OwnSlot;
  readonly az: [number, number];
  readonly el: [number, number];
  mask: number;
}

interface Kept {
  now: Tiles | null;
  next: Tiles | null;
  /** Whether it draws its own views as soon as it holds any (near the band), or only once it holds all four (out of the haze). */
  show: boolean;
  /** What its card was last told (`OwnViews`), so it is told again only when that changes. */
  readonly written: Float32Array;
}

interface Job {
  readonly set: OwnSet;
  readonly tiles: Tiles;
  readonly i: number;
  readonly j: number;
  /** A view a copy drawn now is missing. */
  readonly urgent: boolean;
  readonly order: number;
}

/** Kept views a frame may read back from the far store and write into the atlas. */
const READS = 64;
/** Answers from the far store held at most. */
const ANSWERS = 8192;
const COLS = FAR_VIEWS.azimuths;
const ROWS = FAR_VIEWS.elevations.length;

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Where an elevation falls among the views' elevations, as a row index and its fraction. */
function rowAt(degrees: number): number {
  const e = FAR_VIEWS.elevations;
  if (degrees <= (e[0] as number)) return 0;
  for (let k = 0; k < e.length - 1; k++) {
    const lo = e[k] as number;
    const hi = e[k + 1] as number;
    if (degrees < hi) return k + (degrees - lo) / (hi - lo);
  }
  return e.length - 1;
}

/** Tile sizes from `top`, the size a plant turns far at, down to where a crown is gone. */
function sizesFrom(top: number): number[] {
  const sizes: number[] = [];
  for (let s = top; s > GONE.end * 0.99; s /= OWN.ratio) sizes.push(Math.round(s));
  return sizes;
}

export interface OwnViewsHandle {
  /**
   * Finds and bakes, within `views` views, every own view an eye at `eye`
   * needs: the point detail thins from, which the view's `camera` looks from
   * outside the walk test. `focal` is the view's device pixels a radian.
   */
  update(sets: readonly OwnSet[], eye: THREE.Vector3, camera: THREE.Camera, focal: number, views?: number): void;
  /** Bakes, a frame at a time under the wait, until every copy holding tiles has all four views; at most `frames` frames. */
  fill(sets: () => readonly OwnSet[], camera: THREE.Camera, focal: () => number, frames?: number): Promise<void>;
  /** Reads every card set's own views from the atlas, now and after it grows. */
  read(cards: FarCards): void;
  /** For measuring what walking costs: views a walking frame bakes, and whether it keeps them in the store. */
  tune(walking: { readonly views?: number; readonly keep?: boolean }): void;
  /** For testing a handover: `copies` draw their shared cards whatever they hold, until called with null. */
  share(copies: Copies | null): void;
  stats(): OwnStats;
  dispose(): void;
}

/** Views kept in the far store, each its four layers' texels. */
const isKept = (data: unknown, size: number): data is Uint8Array[] => Array.isArray(data) && data.length === 4 && data.every((layer) => layer instanceof Uint8Array && layer.length === size * size * 4);

/** Own views baked with `renderer`, kept in `store` when there is one. */
export function createOwnViews(renderer: THREE.WebGLRenderer, store: Promise<FarStore | null>): OwnViewsHandle {
  let kept: FarStore | null = null;
  void store.then((s) => (kept = s));
  /** Each plant's part of its views' keys: everything a view of it is baked from. */
  const plantKeys = new Map<Realized, string>();
  const keyOf = (plant: Realized, size: number, i: number, j: number): string => {
    let base = plantKeys.get(plant);
    if (base === undefined) plantKeys.set(plant, (base = contentHash(plant.parts, plant.motion, plant.palette, FAR_BAKE_VERSION)));
    return `${base}/${size}/${i}/${j}`;
  };
  /** What the store answered for each view asked of it, until the view is drawn in. */
  const answers = new Map<string, "asked" | "absent" | Uint8Array[]>();
  const atlas: OwnAtlas = createOwnAtlas(renderer, OWN.atlas.width, OWN.atlas.maxHeight);
  const readers = new Set<FarCards>();
  atlas.onGrow(() => {
    for (const cards of readers) cards.own(atlas.layers, atlas.width, atlas.height);
  });
  /**
   * Each plant's single-view bake. A bake used before its shaders have
   * compiled off the page's thread compiles them on it, so the wait readies
   * every plant's first (`fill`), and one asked for later, as a test's plant,
   * still bakes at once.
   */
  const rigs = new Map<Realized, FarViews>();
  const rigFor = (plant: Realized, maxPx: number): FarViews => {
    let rig = rigs.get(plant);
    if (rig === undefined) rigs.set(plant, (rig = startFarViews(renderer, plant, maxPx)));
    return rig;
  };
  /** Each set's copies' state, made anew when the set's copies move (`Copies.respot`). */
  const states = new Map<Copies, { places: Float32Array; kept: Kept[] }>();
  const give = (tiles: Tiles | null): void => {
    if (tiles !== null) atlas.give(tiles.slot);
  };
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const crown = new THREE.Sphere();
  /** The copies this frame finds views for, three entries each: set, index and state, kept between frames. */
  const touched: (OwnSet | number | Kept)[] = [];
  /** Copies drawing their own views, and holding tiles. */
  let shownNow = 0;
  let heldNow = 0;
  let frame = 0;
  const lastEye = new THREE.Vector3(Number.NaN, 0, 0);
  /** For measuring: views a walking frame bakes, and whether it keeps them in the store too. */
  let walkingViews: number = OWN.views.walking;
  let keepWalking = false;
  let shared: Copies | null = null;
  let catchingUp = false;
  let last = { shown: 0, held: 0, missing: 0, pending: 0 };
  let since = { baked: 0, kept: 0, bakeMs: 0, updateMs: 0, entered: 0, resized: 0, turned: 0 };
  /** Tells copy `k`'s card what it holds (`tiles`, or none), when that has changed. */
  const tell = (set: OwnSet, k: number, kept: Kept, tiles: Tiles | null): void => {
    const w = kept.written;
    const drawn = tiles !== null;
    if (drawn ? w[0] === tiles.slot.x && w[1] === tiles.slot.y && w[2] === tiles.slot.size && w[3] === tiles.mask && w[4] === tiles.az[0] && w[5] === tiles.az[1] && w[6] === tiles.el[0] && w[7] === tiles.el[1] : w[3] === 0) return;
    if (drawn !== (w[3] as number) > 0) shownNow += drawn ? 1 : -1;
    if (drawn) {
      w[0] = tiles.slot.x;
      w[1] = tiles.slot.y;
      w[2] = tiles.slot.size;
      w[3] = tiles.mask;
      w[4] = tiles.az[0];
      w[5] = tiles.az[1];
      w[6] = tiles.el[0];
      w[7] = tiles.el[1];
    } else w.fill(0);
    set.copies.setOwn(k, w);
  };

  /** Points `tiles`' columns and rows at the views the eye needs, dropping what they held there. */
  /** Points column `i % 2` at azimuth `i`, dropping what it held: true when it turned. */
  const column = (tiles: Tiles, i: number): boolean => {
    const c = i % 2;
    if (tiles.az[c] === i) return false;
    tiles.az[c] = i;
    tiles.mask &= ~((1 << c) | (1 << (c + 2)));
    return true;
  };
  /** Points row `j % 2` at elevation `j`, dropping what it held: true when it turned. */
  const row = (tiles: Tiles, j: number): boolean => {
    const r = j % 2;
    if (tiles.el[r] === j) return false;
    tiles.el[r] = j;
    tiles.mask &= ~(3 << (2 * r));
    return true;
  };
  /** Points `tiles`' columns and rows at the views the eye needs, dropping what they held there. */
  const aim = (tiles: Tiles, i0: number, j0: number): boolean => {
    const a = column(tiles, i0);
    const b = column(tiles, mod(i0 + 1, COLS));
    const c = row(tiles, j0);
    const d = row(tiles, j0 + 1);
    return a || b || c || d;
  };
  const tilesOf = (size: number, i0: number, j0: number): Tiles | null => {
    const slot = atlas.take(size);
    if (slot === null) return null;
    const tiles: Tiles = { slot, az: [-1, -1], el: [-1, -1], mask: 0 };
    aim(tiles, i0, j0);
    return tiles;
  };

  function update(sets: readonly OwnSet[], eye: THREE.Vector3, camera: THREE.Camera, focal: number, views: number = walkingViews, waiting = false): void {
    const started = performance.now();
    // An eye that jumped, as a test or a hook moves it, bakes as the wait does until it has caught up.
    if (!(lastEye.distanceTo(eye) <= OWN.jump)) catchingUp = true;
    lastEye.copy(eye);
    if (catchingUp) views = Math.max(views, OWN.views.wait);
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const jobs: Job[] = [];
    touched.length = 0;
    // Walking, a frame looks at a share of the copies in turn; under the wait, or catching up, at every one.
    const spread = waiting || catchingUp ? 1 : OWN.spread;
    frame = (frame + 1) % OWN.spread;
    for (const set of sets) {
      const far = set.copies.far;
      if (far === undefined) continue;
      const { crowns, places } = set.copies.placed;
      let state = states.get(set.copies);
      // A set whose copies just moved is looked at whole this frame.
      let every = spread;
      if (state === undefined || state.places !== places) {
        every = 1;
        // The set's copies moved, as standing does tile by tile as the person walks: a copy still standing where one
        // stood keeps its tiles, and its card, made anew, is told them again.
        const where = (at: Float32Array, k: number): string => `${at[k * 7]},${at[k * 7 + 2]},${at[k * 7 + 3]}`;
        const before = new Map<string, Kept>();
        state?.kept.forEach((kept, k) => before.set(where(state?.places as Float32Array, k), kept));
        const next = Array.from({ length: places.length / 7 }, (_, k): Kept => {
          const kept = before.get(where(places, k));
          if (kept === undefined) return { now: null, next: null, show: false, written: new Float32Array(8) };
          before.delete(where(places, k));
          // The card was made anew with no views.
          if (kept.written[3] !== 0) shownNow--;
          kept.written.fill(0);
          return kept;
        });
        for (const gone of before.values()) {
          if (gone.now !== null) heldNow--;
          if (gone.written[3] !== 0) shownNow--;
          give(gone.now);
          give(gone.next);
        }
        state = { places, kept: next };
        states.set(set.copies, state);
      }
      const top = FAR.swapPx * (far.share ?? 1);
      const band = top * FAR.band;
      const hazePx = top * OWN.hazeShare;
      const sizes = sizesFrom(top);
      state.kept.forEach((kept, k) => {
        // A copy still baking is looked at every frame, so the frame's views go to what is missing.
        if (set.own[k] !== 1 || ((k + frame) % every !== 0 && (kept.now === null || (kept.now.mask === 15 && kept.next === null)))) return;
        const cx = crowns[k * 4] as number;
        const cy = crowns[k * 4 + 1] as number;
        const cz = crowns[k * 4 + 2] as number;
        const r = crowns[k * 4 + 3] as number;
        const dx = eye.x - cx;
        const dy = eye.y - cy;
        const dz = eye.z - cz;
        const d = Math.max(Math.hypot(dx, dy, dz), 1e-3);
        const px = (2 * r * focal) / Math.max(d, 1);
        const inRange = d - r < AIR.dissolveEnd && px > GONE.end;
        // Past the haze the shared card shows; nearer, or larger, the copy's own views do, and it bakes them ahead.
        const hazed = px <= hazePx && d >= OWN.haze;
        const wanted = inRange && px <= band * OWN.ahead && !(px <= hazePx / OWN.ahead && d >= OWN.haze * OWN.ahead);
        if (!wanted) {
          if (kept.now !== null) heldNow--;
          give(kept.now);
          give(kept.next);
          kept.now = null;
          kept.next = null;
          tell(set, k, kept, null);
          return;
        }
        // The eye's direction in the copy's own frame, as the card's shader finds it.
        const yaw = places[k * 7 + 3] as number;
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        const gi = mod((Math.atan2((s * dx + c * dz) / d, (c * dx - s * dz) / d) / (2 * Math.PI)) * COLS, COLS);
        const i0 = Math.floor(gi) % COLS;
        const j0 = Math.min(ROWS - 2, Math.floor(rowAt((Math.asin(Math.max(-1, Math.min(1, dy / d))) * 180) / Math.PI)));
        const size = sizes.reduce((best, t) => (t >= px * 0.999 ? t : best), sizes[0] as number);
        if (kept.now === null) {
          kept.now = tilesOf(size, i0, j0);
          if (kept.now === null) return;
          heldNow++;
          since.entered++;
        } else if (aim(kept.now, i0, j0)) since.turned++;
        // A crown grown past its tiles, or shrunk to a quarter of them, bakes a second set at its size.
        const now = kept.now;
        if (size > now.slot.size || size * 4 <= now.slot.size) {
          if (kept.next === null || kept.next.slot.size !== size) {
            give(kept.next);
            kept.next = tilesOf(size, i0, j0);
            if (kept.next !== null) since.resized++;
          } else aim(kept.next, i0, j0);
        } else if (kept.next !== null) {
          give(kept.next);
          kept.next = null;
        }
        const showing = px <= band && !hazed;
        crown.center.set(cx, cy, cz);
        crown.radius = r;
        const seen = frustum.intersectsSphere(crown);
        // Missing views of a copy drawn now come first, nearest the band first, in view before out of it.
        const ask = (tiles: Tiles, urgent: boolean): void => {
          for (let bit = 0; bit < 4; bit++) {
            if ((tiles.mask & (1 << bit)) !== 0) continue;
            jobs.push({ set, tiles, i: tiles.az[bit % 2] as number, j: tiles.el[bit >> 1] as number, urgent, order: ((urgent ? 0 : 2) + (seen ? 0 : 1)) * 1e4 - px });
          }
        };
        if (now.mask !== 15) ask(now, showing);
        if (kept.next !== null && kept.next.mask !== 15) ask(kept.next, false);
        kept.show = showing || px > band;
        touched.push(set, k, kept);
      });
    }

    // Read kept views back, and bake the rest within the frame's views, then copy those into the atlas at once.
    jobs.sort((a, b) => a.order - b.order);
    // Answers for views no copy needed in the end are dropped, now and then, rather than held for a walk's length.
    if (answers.size > ANSWERS) answers.clear();
    const t0 = performance.now();
    const done: Job[] = [];
    let baked = 0;
    let read = 0;
    const store = kept;
    for (const job of jobs) {
      if (baked >= views && read >= READS) break;
      const size = job.tiles.slot.size;
      const c = job.i % 2;
      const r = job.j % 2;
      const key = keyOf(job.set.plant, size, job.i, job.j);
      // A view a drawn copy is missing bakes at once, sooner than the store would answer, but under the wait.
      if (store !== null && (waiting || !job.urgent)) {
        const answer = answers.get(key);
        if (answer === undefined) {
          answers.set(key, "asked");
          store.get(key).then(
            (data) => answers.set(key, isKept(data, size) ? data : "absent"),
            () => answers.set(key, "absent"),
          );
          continue;
        }
        if (answer === "asked") continue;
        if (answer !== "absent") {
          if (read >= READS) continue;
          atlas.upload(job.tiles.slot, c, r, answer);
          answers.delete(key);
          job.tiles.mask |= 1 << (c + 2 * r);
          read++;
          continue;
        }
      }
      if (baked >= views) continue;
      const far = job.set.copies.far;
      const rig = rigFor(job.set.plant, FAR.swapPx * (far?.share ?? 1));
      const save = store === null || !(waiting || keepWalking) ? undefined : (layers: Uint8Array[]) => void store.put(key, layers).catch(() => undefined);
      if (!atlas.bake(rig, job.i, job.j, job.tiles.slot, c, r, save)) break;
      answers.delete(key);
      done.push(job);
      baked++;
    }
    atlas.flush();
    for (const job of done) job.tiles.mask |= 1 << ((job.i % 2) + 2 * (job.j % 2));
    since.baked += baked;
    since.kept += read;
    since.bakeMs += performance.now() - t0;

    // Swap in a second set once all four views are baked, then tell each card what it holds.
    let missing = 0;
    for (let n = 0; n < touched.length; n += 3) {
      const set = touched[n] as OwnSet;
      const k = touched[n + 1] as number;
      const kept = touched[n + 2] as Kept;
      const show = kept.show;
      if (kept.next !== null && kept.next.mask === 15) {
        give(kept.now);
        kept.now = kept.next;
        kept.next = null;
      }
      const now = kept.now as Tiles;
      const drawn = now.mask !== 0 && (show || now.mask === 15) && set.copies !== shared;
      if (drawn) missing += 4 - ((now.mask & 1) + ((now.mask >> 1) & 1) + ((now.mask >> 2) & 1) + ((now.mask >> 3) & 1));
      tell(set, k, kept, drawn ? now : null);
    }
    last = { shown: shownNow, held: heldNow, missing, pending: jobs.length - done.length - read };
    if (last.pending === 0) catchingUp = false;
    since.updateMs += performance.now() - started;
  }

  return {
    update,
    async fill(sets, camera, focal, frames = 900) {
      // Every plant's shaders compile off the page's thread first.
      await Promise.all(sets().map((set) => rigFor(set.plant, FAR.swapPx * (set.copies.far?.share ?? 1)).ready));
      for (let f = 0; f < frames; f++) {
        camera.updateMatrixWorld();
        update(sets(), camera.position, camera, focal(), OWN.views.wait, true);
        if (last.pending === 0) return;
        await new Promise((r) => requestAnimationFrame(r));
      }
    },
    share(copies) {
      shared = copies;
    },
    tune(walking) {
      walkingViews = walking.views ?? walkingViews;
      keepWalking = walking.keep ?? keepWalking;
    },
    read(cards) {
      readers.add(cards);
      cards.own(atlas.layers, atlas.width, atlas.height);
    },
    stats() {
      const { taken, allocated } = atlas.bytes();
      const out = { ...last, bytes: taken, allocated, ...since };
      since = { baked: 0, kept: 0, bakeMs: 0, updateMs: 0, entered: 0, resized: 0, turned: 0 };
      return out;
    },
    dispose() {
      for (const rig of rigs.values()) rig.dispose();
      rigs.clear();
      states.clear();
      atlas.dispose();
    },
  };
}
