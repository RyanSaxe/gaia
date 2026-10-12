// What stands on the land, a tile at a time. Every component that stands in
// the world adds a stander: how large its largest thing can be, what stands in
// a tile of the land, and how to stand a set of its things. A thing is seen
// only while it spans a few pixels on screen (`GONE`), as the grass ends a
// short way out, so how far a stander's tiles reach follows from its largest
// thing's size, up to where the air dissolves the land. The world holds every
// tile within that reach of the person, asks for a tile's things as it comes
// near (at once from the world's plan, or from a worker), lets go of a tile
// left well behind, and stands a stander's things again when its tiles
// change, one stander a frame. A new component stands by tiles by adding a
// stander, with no tiling of its own; a world of any size holds only what can
// be seen.

import { AIR } from "@gaia/realize";
import { TILE, type WorldSpec, frameOf, worldOf } from "@gaia/terrain";

/** A thing spanning fewer device pixels than `end` on screen is not drawn: it has dissolved away by then. */
export const GONE = { end: 4 } as const;

/** How far a thing of `radius` meters stays seen, for a screen of `focal` device pixels a radian: until it spans `GONE.end` pixels, or the air dissolves it. */
export const seenTo = (radius: number, focal: number): number => Math.min(AIR.dissolveEnd, (2 * radius * focal) / GONE.end);

export interface Stander<T> {
  /** Names it in reports. */
  readonly name: string;
  /** The radius, meters, of the largest thing it stands: its tiles stand as far out as that can be seen (`seenTo`). */
  readonly largest: () => number;
  /** What stands in tile (ti, tj): at once, or from a worker; null when another world has opened since it was asked. */
  tile(ti: number, tj: number): readonly T[] | Promise<readonly T[] | null>;
  /** Stands exactly these: the things of every tile held, tile by tile. */
  stand(things: readonly T[]): void;
}

export interface Standing {
  add<T>(stander: Stander<T>): void;
  /**
   * Takes on a new world, letting go of every tile. `given` is what the bake
   * already stood for some tiles, by stander name and then by "ti,tj".
   */
  open(spec: WorldSpec, given?: ReadonlyMap<string, ReadonlyMap<string, readonly unknown[]>>): void;
  /** Called every frame with the person's place: holds the tiles near, lets far ones go, and stands one changed stander. */
  follow(x: number, z: number): void;
  /** Resolves once every stander's tiles within sight of (x, z) stand. */
  ready(x: number, z: number): Promise<void>;
  /** How many tiles each stander holds, for reports. */
  held(): Record<string, number>;
}

/** How far past its sight a held tile goes, meters: a step back and forth keeps it. */
const LET_GO = 200;
/** How far the person walks before the tiles near them are weighed again, meters. */
const STEP = 24;

interface Held<T> {
  readonly stander: Stander<T>;
  readonly tiles: Map<string, readonly T[]>;
  readonly asking: Set<string>;
  dirty: boolean;
}

/** `focal` is the view's device pixels a radian, which says how far a thing of a given size can be seen. */
export function createStanding(focal: () => number): Standing {
  const all: Held<unknown>[] = [];
  let spec: WorldSpec | null = null;
  let generation = 0;
  let at = { x: Number.NaN, z: Number.NaN };
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
  /** How far a stander's tiles reach: as far as its largest thing can be seen. */
  const sight = <T>(h: Held<T>): number => seenTo(h.stander.largest(), focal());
  /** Asks for every tile within the stander's sight of (x, z) that it does not hold; resolves when all have come. */
  const ask = <T>(h: Held<T>, x: number, z: number): Promise<void>[] => {
    const mine = generation;
    const waits: Promise<void>[] = [];
    for (const [ti, tj] of within(x, z, sight(h))) {
      const key = `${ti},${tj}`;
      if (h.tiles.has(key) || h.asking.has(key)) continue;
      const got = h.stander.tile(ti, tj);
      if (!(got instanceof Promise)) {
        h.tiles.set(key, got);
        h.dirty = true;
        continue;
      }
      h.asking.add(key);
      waits.push(
        got.then((things) => {
          h.asking.delete(key);
          if (things === null || mine !== generation) return;
          h.tiles.set(key, things);
          h.dirty = true;
        }),
      );
    }
    return waits;
  };
  const stand = <T>(h: Held<T>): void => {
    h.dirty = false;
    const keys = [...h.tiles.keys()].sort();
    const things: T[] = [];
    for (const key of keys) for (const t of h.tiles.get(key) as readonly T[]) things.push(t);
    h.stander.stand(things);
  };
  return {
    add(stander) {
      all.push({ stander, tiles: new Map(), asking: new Set(), dirty: false } as Held<unknown>);
    },
    open(next, given) {
      spec = next;
      generation++;
      at = { x: Number.NaN, z: Number.NaN };
      for (const h of all) {
        h.tiles.clear();
        h.asking.clear();
        for (const [key, things] of given?.get(h.stander.name) ?? []) h.tiles.set(key, things);
        h.dirty = true;
      }
    },
    follow(x, z) {
      if (spec === null) return;
      if (!(Math.hypot(x - at.x, z - at.z) < STEP)) {
        at = { x, z };
        for (const h of all) {
          for (const key of [...h.tiles.keys()]) {
            const [ti, tj] = key.split(",").map(Number) as [number, number];
            if (distance(ti, tj, x, z) <= sight(h) + LET_GO) continue;
            h.tiles.delete(key);
            h.dirty = true;
          }
          void ask(h, x, z);
        }
      }
      // One stander a frame, so no frame stands everything at once.
      const next = all.find((h) => h.dirty);
      if (next !== undefined) stand(next);
    },
    async ready(x, z) {
      if (spec === null) return;
      await Promise.all(all.flatMap((h) => ask(h, x, z)));
      for (const h of all) if (h.dirty) stand(h);
    },
    held: () => Object.fromEntries(all.map((h) => [h.stander.name, h.tiles.size])),
  };
}
