// Where a person is: the area (a directory) whose ground a point is, and the
// file whose patch is underfoot, if any. Past the codebase's land lies the
// wild, which stands for no directory. Everything that tells a person where
// they are (arrival titles, the field map, signposts, the compass) reads only
// `placeAt`.
//
// A world lays its areas out one of two ways. A world laid out from code
// gives each directory a circle nested in its parent's, and the deepest
// circle holding a point is its directory; land no circle holds is the
// repository's own common ground. A world laid out as regions (the lab's
// sample world) names each area's land as a terrain region, and a point is
// the area whose region's warped cell holds it, as its landform is.

import type { CellPlace, PatchPlace, WorldPlaces } from "@gaia/schema";
import { type WorldSpec, cellAt } from "./world.ts";

export type { AreaPlace, CellPlace, PatchPlace, WorldPlaces } from "@gaia/schema";

/** Where a point is: the directory whose ground it is, and the file whose patch it is on, if any. */
export interface Place {
  readonly area: { readonly path: string; readonly name: string; readonly depth: number };
  readonly file: { readonly path: string; readonly name: string; readonly vitality: number } | null;
}

/** A directory, as the area of land that stands for it: `depth` is 0 for the repository's root and -1 for the wild. */
export type PlaceArea = Place["area"];

/** The wild land past the codebase's: an area that stands for no directory. */
export const WILD_AREA: PlaceArea = { path: "", name: "The wilds", depth: -1 };

/** Whether (x, z) lies past the codebase's land: its rounded square, where the rim crests. */
function pastTheLand(size: number, x: number, z: number): boolean {
  return Math.abs(x) ** 4 + Math.abs(z) ** 4 > (size / 2) ** 4;
}

/** Side of a patch bucket, meters. */
const BUCKET = 8;
const bucketKey = (bx: number, bz: number): number => (bx + 32768) * 65536 + (bz + 32768);

type Area = WorldPlaces["areas"][number];
/** What a lookup reads quickly: patches by bucket, areas by path, the root, and the circles deepest first. */
interface Index {
  readonly buckets: ReadonlyMap<number, readonly number[]>;
  readonly byPath: ReadonlyMap<string, Area>;
  readonly root: Area | undefined;
  readonly circles: readonly Area[];
}
const indexes = new WeakMap<WorldPlaces, Index>();
function indexOf(world: WorldPlaces): Index {
  let index = indexes.get(world);
  if (index !== undefined) return index;
  const buckets = new Map<number, number[]>();
  world.patches.forEach((p, i) => {
    for (let bx = Math.floor((p.x - p.radius) / BUCKET); bx <= Math.floor((p.x + p.radius) / BUCKET); bx++) {
      for (let bz = Math.floor((p.z - p.radius) / BUCKET); bz <= Math.floor((p.z + p.radius) / BUCKET); bz++) {
        const key = bucketKey(bx, bz);
        const list = buckets.get(key);
        if (list === undefined) buckets.set(key, [i]);
        else list.push(i);
      }
    }
  });
  index = {
    buckets,
    byPath: new Map(world.areas.map((a) => [a.path, a])),
    root: world.areas.find((a) => a.parent === null),
    // Deepest first, so the first circle holding a point is its directory.
    circles: world.areas.filter((a) => a.radius > 0).sort((a, b) => b.depth - a.depth),
  };
  indexes.set(world, index);
  return index;
}

/** The area and the file patch under (x, z). */
export function placeAt(world: WorldPlaces, x: number, z: number): Place {
  if (pastTheLand(world.size, x, z)) return { area: WILD_AREA, file: null };
  const index = indexOf(world);
  let area = index.circles.find((a) => Math.hypot(x - a.x, z - a.z) <= a.radius);
  if (area === undefined && world.cells !== undefined && world.cells.length > 0) {
    area = index.byPath.get((world.cells[cellAt(world.cells, x, z)] as CellPlace).area);
  }
  area ??= index.root;
  let file: Place["file"] = null;
  let nearest = Infinity;
  for (const i of index.buckets.get(bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET))) ?? []) {
    const p = world.patches[i] as PatchPlace;
    // The patch whose middle is nearest for its size: a small patch inside a large one's edge still shows.
    const d = Math.hypot(x - p.x, z - p.z) / p.radius;
    if (d <= 1 && d < nearest) {
      nearest = d;
      file = { path: p.path, name: p.name, vitality: p.vitality };
    }
  }
  return { area: area === undefined ? { path: "", name: world.name, depth: 0 } : { path: area.path, name: area.name, depth: area.depth }, file };
}

/** A directory's path, its own name, how deep it is and its parent's path. */
function pathParts(path: string): { path: string; name: string; depth: number; parent: string | null } {
  const parts = path.split("/").filter(Boolean);
  return { path: parts.join("/"), name: parts[parts.length - 1] ?? "", depth: parts.length, parent: parts.length === 0 ? null : parts.slice(0, -1).join("/") };
}

/**
 * The places of a world laid out as regions: each region the area of the
 * directory it stands for (its id), and each file's patch a disc of ground in
 * the area that holds its middle.
 */
export function regionPlaces(spec: WorldSpec, name: string, files: readonly Omit<PatchPlace, "area">[]): WorldPlaces {
  const cells: CellPlace[] = spec.regions.map((r) => ({ area: pathParts(r.id).path, x: r.x, z: r.z, ...(r.reach === undefined ? {} : { reach: r.reach }) }));
  return {
    name,
    size: spec.size,
    areas: spec.regions.map((r) => ({ ...pathParts(r.id), x: r.x, z: r.z, radius: 0 })),
    patches: files.map((f) => ({ ...f, area: (cells[cellAt(cells, f.x, f.z)] as CellPlace).area })),
    cells,
  };
}
