// Where a person first stands in a world laid out from code: among the code,
// on the bank of a stream, looking downstream. Rivers run downhill to the
// land's edge, and the land the terrain composes can reach past the code's
// own (the wild a world's rim lies in), so a stream may run outside the
// code's land for part of its course. The person stands where the first
// stream with a stretch among the code comes nearest the repository's own
// area, on dry ground beside it, facing its water `OPENING.ahead` downstream;
// a stretch with less water than that left before the stream ends does not
// count. A world with no stream among the code lands on dry ground nearest
// that area's heart.

import type { WorldPlaces } from "@gaia/schema";
import { placeAt } from "./places.ts";
import { waterDepthAt } from "./walk.ts";
import type { Terrain } from "./world.ts";

export const OPENING = {
  /** How far to the side of the stream's middle the person stands, meters. */
  bank: 5,
  /** The deepest water that counts as dry ground, meters. */
  dry: 0.02,
  /** How far around the bank it looks for dry ground among the code, and its rings' spacing, meters. */
  reach: 40,
  ring: 1.5,
  /** How far downstream the person looks along, and so how much water must run on past where they stand, meters. */
  ahead: 30,
} as const;

/** Where a person first stands, and the way they face (the yaw a walk takes: 0 looks along -z). */
export interface OpeningSpot {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** Whether a point lies among the code: on a file's patch or an area's own ground, never in the wild past them. */
export const amongCode = (places: WorldPlaces, x: number, z: number): boolean => placeAt(places, x, z).area.depth >= 0;

export function openingSpot(t: Terrain, places: WorldPlaces): OpeningSpot {
  const root = places.areas.find((a) => a.path === "") ?? { x: 0, z: 0 };
  const dryAmong = (x: number, z: number): boolean => amongCode(places, x, z) && waterDepthAt(t, x, z) <= OPENING.dry;
  /** The dry ground among the code nearest (x, z), within `OPENING.reach`; null when there is none. */
  const nearestDry = (x: number, z: number): { x: number; z: number } | null => {
    for (let r = 0; r <= OPENING.reach; r += OPENING.ring) {
      const count = Math.max(1, Math.round((Math.PI * 2 * r) / OPENING.ring));
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (dryAmong(px, pz)) return { x: px, z: pz };
      }
    }
    return null;
  };
  for (const stream of t.streams) {
    const st = stream.stations;
    const end = st[st.length - 1];
    if (end === undefined) continue;
    let best = -1;
    let bestD = Infinity;
    st.forEach((s, k) => {
      // Only where the water runs on downstream far enough to look along it: a stream's end lies nearest the
      // repository's area as often as not, and past it there is no water to see.
      if (!amongCode(places, s.x, s.z) || Math.hypot(end.x - s.x, end.z - s.z) < OPENING.ahead) return;
      const d = Math.hypot(s.x - root.x, s.z - root.z);
      if (d < bestD) [best, bestD] = [k, d];
    });
    const here = st[best];
    if (here === undefined) continue;
    let ahead = best;
    while (Math.hypot((st[ahead] as typeof here).x - here.x, (st[ahead] as typeof here).z - here.z) < OPENING.ahead) ahead++;
    const there = st[ahead] as typeof here;
    const yaw = Math.atan2(-(there.x - here.x), -(there.z - here.z));
    // To the stream's right as the person faces downstream, on the nearest dry ground among the code.
    const spot = nearestDry(here.x + Math.cos(yaw) * OPENING.bank, here.z - Math.sin(yaw) * OPENING.bank);
    // Facing the water downstream, so a stream that bends away still runs into the view.
    if (spot !== null) return { ...spot, yaw: Math.atan2(-(there.x - spot.x), -(there.z - spot.z)) };
  }
  const spot = nearestDry(root.x, root.z) ?? { x: root.x, z: root.z };
  return { ...spot, yaw: 0 };
}
