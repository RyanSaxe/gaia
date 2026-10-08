// A small picture of a world's land for the start page to paint: its areas
// to the second level, with their land and water, and where its buildings
// and landmarks stand, in the land's frame scaled to -1..1.

import { outlinesOf } from "@gaia/terrain";
import type { CodeWorld } from "@gaia/world";
import type { Postcard } from "./protocol.ts";

/** The most points a postcard keeps of one ring. */
const RING_POINTS = 48;

/** A small picture of a world's land: its areas to the second level with their land and water, and where its buildings and landmarks stand. */
export function postcardOf(world: CodeWorld): Postcard {
  const half = world.size / 2;
  const at = (v: number): number => Math.round((v / half) * 1000) / 1000;
  const regionOf = new Map(world.areas.map((a) => [a.path, world.regions[a.region]]));
  const areas = outlinesOf(world)
    .areas.filter((o) => o.depth <= 2)
    .sort((a, b) => a.depth - b.depth)
    .map((o) => {
      const region = regionOf.get(o.path);
      const rings = o.rings
        .map((ring) => {
          const count = ring.length / 2;
          const step = Math.max(1, Math.ceil(count / RING_POINTS));
          const kept: number[] = [];
          for (let k = 0; k < count; k += step) kept.push(at(ring[k * 2] as number), at(ring[k * 2 + 1] as number));
          return kept;
        })
        .filter((ring) => ring.length >= 6);
      return { depth: o.depth, land: region?.land ?? "", water: region?.water ?? "", rings };
    })
    .filter((a) => a.rings.length > 0);
  return { areas, things: world.things.map((t) => ({ x: at(t.x), z: at(t.z), as: t.as })) };
}
