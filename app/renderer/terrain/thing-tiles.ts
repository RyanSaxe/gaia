// Places the world's things one land tile at a time, so a world of any size
// keeps only what can be seen. Each component adds a `TileLayer` that gives its
// largest thing's size, the things in a tile, and a `place` call that places a
// set of them. A thing is visible only while it spans a few pixels (`GONE` in
// woods.ts), so a layer's tiles reach as far as its largest thing can be
// seen, up to where the air dissolves the land.

import { AIR } from "@gaia/realize";
import { TILE, type WorldSpec, frameOf, worldOf } from "@gaia/terrain";
import { goneAt } from "./woods.ts";

/** How far a thing of `radius` meters stays visible on a screen of `focal` device pixels per radian: until it is too small (`goneAt`) or the air dissolves it. */
export const seenTo = (radius: number, focal: number): number => Math.min(AIR.dissolveEnd, goneAt(radius, focal));

export interface TileLayer<T> {
  /** Its name in reports. */
  readonly name: string;
  /** The radius in meters of its largest thing. Its tiles are placed as far out as that thing can be seen (`seenTo`). */
  readonly largest: () => number;
  /** The things in tile (ti, tj), at once or from a worker. Null when another world has opened since the request. */
  tile(ti: number, tj: number): readonly T[] | Promise<readonly T[] | null>;
  /** Places exactly these things, the things of every held tile. */
  place(things: readonly T[]): void;
}

export interface ThingTiles {
  add<T>(layer: TileLayer<T>): void;
  /**
   * Opens a new world and drops every tile. `given` has the things the bake
   * already placed for some tiles, by layer name and then by "ti,tj".
   */
  open(spec: WorldSpec, given?: ReadonlyMap<string, ReadonlyMap<string, readonly unknown[]>>): void;
  /**
   * Call every frame with the person's position. It keeps the near tiles,
   * drops far ones, and places one changed layer. Without `requesting` it
   * requests no tiles of its own, as while a trip requests what its way will
   * see.
   */
  follow(x: number, z: number, requesting?: boolean): void;
  /** Resolves once every layer's tiles within sight of (x, z) are placed. */
  ready(x: number, z: number): Promise<void>;
  /**
   * Resolves once every layer has its tiles within sight of (x, z),
   * including those already requested, for later frames to place one
   * layer at a time. A trip uses it for the way ahead. It requests no lead
   * past sight, since a trip's marks are close enough that their sights cover
   * everything visible from its way.
   */
  fetch(x: number, z: number): Promise<void>;
  /**
   * Each tile placed since the last call while the person was within its
   * layer's sight, so its things could have been seen appearing: the
   * layer, the person's distance and that sight.
   */
  late(): readonly { readonly layer: string; readonly distance: number; readonly sight: number }[];
  /** How many tiles each layer has, for reports. */
  held(): Record<string, number>;
  /** The tiles each layer has requested and not yet received, by name: a count and a few keys. */
  pending(): Record<string, { readonly count: number; readonly some: readonly string[] }>;
}

/** Meters beyond its sight at which a tile is requested, so a tile from a worker arrives before any of it can be seen. */
const AHEAD = 150;
/** Meters beyond that at which a held tile is dropped, so stepping back and forth keeps it. */
const LET_GO = 200;
/** Meters the person walks before the tiles near them are checked again. */
const STEP = 24;

interface Held<T> {
  readonly layer: TileLayer<T>;
  readonly tiles: Map<string, readonly T[]>;
  /** The tiles requested and not yet received, each with its promise. */
  readonly pending: Map<string, Promise<void>>;
  /** The tiles whose things were last placed. */
  placed: Set<string>;
  dirty: boolean;
}

/** `focal` is the view's device pixels per radian, which sets how far a thing of a given size can be seen. */
export function createThingTiles(focal: () => number): ThingTiles {
  const all: Held<unknown>[] = [];
  let spec: WorldSpec | null = null;
  let generation = 0;
  let at = { x: Number.NaN, z: Number.NaN };
  /** Where walking last requested tiles. */
  let requestedAt = { x: Number.NaN, z: Number.NaN };
  /** Where the person was at the last follow. */
  let person = { x: Number.NaN, z: Number.NaN };
  let lates: { layer: string; distance: number; sight: number }[] = [];
  /** Distance from (x, z) to the nearest point of tile (ti, tj), meters. */
  const distance = (ti: number, tj: number, x: number, z: number): number => {
    const frame = frameOf(spec as WorldSpec);
    const x0 = worldOf(frame, ti * TILE.size);
    const z0 = worldOf(frame, tj * TILE.size);
    const x1 = worldOf(frame, (ti + 1) * TILE.size);
    const z1 = worldOf(frame, (tj + 1) * TILE.size);
    return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
  };
  /** Every tile of the land within `reach` of (x, z). */
  const within = (x: number, z: number, reach: number): [number, number][] => {
    const frame = frameOf(spec as WorldSpec);
    const per = Math.ceil(frame.n / TILE.size);
    const out: [number, number][] = [];
    for (let tj = 0; tj < per; tj++) for (let ti = 0; ti < per; ti++) if (distance(ti, tj, x, z) <= reach) out.push([ti, tj]);
    return out;
  };
  /** How far a layer's tiles reach: as far as its largest thing can be seen. */
  const sight = <T>(h: Held<T>): number => seenTo(h.layer.largest(), focal());
  /**
   * Requests every tile within the layer's sight of (x, z) plus `lead`
   * meters that it does not have. The promises resolve when the tiles arrive.
   * A failed tile is dropped with a warning and requested again next time.
   */
  const request = <T>(h: Held<T>, x: number, z: number, lead = AHEAD): Promise<void>[] => {
    const mine = generation;
    const waits: Promise<void>[] = [];
    for (const [ti, tj] of within(x, z, sight(h) + lead)) {
      const key = `${ti},${tj}`;
      if (h.tiles.has(key)) continue;
      const coming = h.pending.get(key);
      if (coming !== undefined) {
        waits.push(coming);
        continue;
      }
      const got = h.layer.tile(ti, tj);
      if (!(got instanceof Promise)) {
        h.tiles.set(key, got);
        h.dirty = true;
        continue;
      }
      const wait = got.then(
        (things) => {
          h.pending.delete(key);
          if (things === null || mine !== generation) return;
          h.tiles.set(key, things);
          h.dirty = true;
        },
        (error: unknown) => {
          h.pending.delete(key);
          console.warn(`standing: ${h.layer.name} tile ${key} failed and will be asked for again`, error);
        },
      );
      h.pending.set(key, wait);
      waits.push(wait);
    }
    return waits;
  };
  const placeLayer = <T>(h: Held<T>): void => {
    h.dirty = false;
    const keys = [...h.tiles.keys()].sort();
    if (!Number.isNaN(person.x)) {
      for (const key of keys) {
        if (h.placed.has(key)) continue;
        const [ti, tj] = key.split(",").map(Number) as [number, number];
        const d = distance(ti, tj, person.x, person.z);
        if (d < sight(h)) lates.push({ layer: h.layer.name, distance: Math.round(d), sight: Math.round(sight(h)) });
      }
    }
    h.placed = new Set(keys);
    const things: T[] = [];
    for (const key of keys) for (const t of h.tiles.get(key) as readonly T[]) things.push(t);
    h.layer.place(things);
  };
  return {
    add(layer) {
      all.push({ layer: layer, tiles: new Map(), pending: new Map(), placed: new Set(), dirty: false } as Held<unknown>);
    },
    open(next, given) {
      spec = next;
      generation++;
      at = { x: Number.NaN, z: Number.NaN };
      requestedAt = { x: Number.NaN, z: Number.NaN };
      person = { x: Number.NaN, z: Number.NaN };
      for (const h of all) {
        h.tiles.clear();
        h.pending.clear();
        h.placed = new Set();
        for (const [key, things] of given?.get(h.layer.name) ?? []) h.tiles.set(key, things);
        h.dirty = true;
      }
    },
    follow(x, z, requesting = true) {
      if (spec === null) return;
      person = { x, z };
      if (!(Math.hypot(x - at.x, z - at.z) < STEP)) {
        at = { x, z };
        for (const h of all) {
          for (const key of [...h.tiles.keys()]) {
            const [ti, tj] = key.split(",").map(Number) as [number, number];
            if (distance(ti, tj, x, z) <= sight(h) + AHEAD + LET_GO) continue;
            h.tiles.delete(key);
            h.dirty = true;
          }
        }
      }
      // Clear the last request spot while not requesting, so requests resume at once when requesting does, as when a trip ends.
      if (!requesting) requestedAt = { x: Number.NaN, z: Number.NaN };
      else if (!(Math.hypot(x - requestedAt.x, z - requestedAt.z) < STEP)) {
        requestedAt = { x, z };
        for (const h of all) void request(h, x, z);
      }
      // Place one layer a frame, so no frame places everything at once.
      const next = all.find((h) => h.dirty);
      if (next !== undefined) placeLayer(next);
    },
    async ready(x, z) {
      if (spec === null) return;
      await Promise.all(all.flatMap((h) => request(h, x, z)));
      for (const h of all) if (h.dirty) placeLayer(h);
    },
    async fetch(x, z) {
      if (spec === null) return;
      await Promise.all(all.flatMap((h) => request(h, x, z, 0)));
    },
    late() {
      const out = lates;
      lates = [];
      return out;
    },
    held: () => Object.fromEntries(all.map((h) => [h.layer.name, h.tiles.size])),
    pending: () => Object.fromEntries(all.map((h) => [h.layer.name, { count: h.pending.size, some: [...h.pending.keys()].slice(0, 6) }])),
  };
}
