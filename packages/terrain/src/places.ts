// Where a person is: the area (a directory) and the patch (a file) under a
// point. Areas are nested circles from the world's layout, so the deepest
// circle holding a point is the directory whose ground it is; past every
// circle is the repository's own wild land.

import type { WorldPlaces } from "@gaia/schema";

export type { AreaPlace, PatchPlace, WorldPlaces } from "@gaia/schema";

export interface Place {
  /** The directory whose ground this is. */
  readonly area: { readonly path: string; readonly name: string; readonly depth: number };
  /** The file whose patch this is, if any. */
  readonly file: { readonly path: string; readonly name: string; readonly vitality: number } | null;
}

/** The area and file patch under (x, z). */
export function placeAt(world: WorldPlaces, x: number, z: number): Place {
  let area = world.areas.find((a) => a.parent === null) ?? { path: "", name: world.name, depth: 0 };
  for (const a of world.areas) {
    if (a.depth > area.depth && Math.hypot(x - a.x, z - a.z) <= a.radius) area = a;
  }
  let file: Place["file"] = null;
  let nearest = Infinity;
  for (const p of world.patches) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d <= p.radius && d / p.radius < nearest) {
      nearest = d / p.radius;
      file = { path: p.path, name: p.name, vitality: p.vitality };
    }
  }
  return { area: { path: area.path, name: area.name, depth: area.depth }, file };
}
