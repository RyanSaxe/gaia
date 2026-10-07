// Where a person is: the area (a directory) whose land they stand in, and the
// file whose patch of ground is underfoot, if any. Past the codebase's land
// lies the wild, which stands for nothing. Everything that tells a person
// where they are (arrival titles, the field map, signposts and the compass)
// reads only `placeAt`, so a world built from real code facts swaps in its
// own areas and patches behind the same interface.

import { type Terrain, type WorldSpec, regionWeights } from "./world.ts";

/** A directory, as the area of land that stands for it. */
export interface PlaceArea {
  /** The directory's project-relative path: its identity. "" is the repository's root. */
  readonly path: string;
  /** The directory's own name, the last part of its path. */
  readonly name: string;
  /** How many directories deep it is: 1 for a top-level directory; -1 for the wild. */
  readonly depth: number;
}

/** A file, as the patch of ground that stands for it. */
export interface PlaceFile {
  readonly path: string;
  readonly name: string;
  readonly vitality: number;
}

/** Where a point is: its area, and the file whose patch it is on, if any. */
export interface Place {
  readonly area: PlaceArea;
  readonly file: PlaceFile | null;
}

/** The wild land past the codebase's: an area that stands for no directory. */
export const WILD_AREA: PlaceArea = { path: "", name: "The wilds", depth: -1 };

/** The area that stands for a directory path. */
export function areaOfPath(path: string): PlaceArea {
  const parts = path.split("/").filter(Boolean);
  return { path: parts.join("/"), name: parts[parts.length - 1] ?? "", depth: parts.length };
}

/** A file's patch of ground: a disc around where it stands. In the sample world, the ground around the tree that stands for it. */
export interface FilePatch {
  readonly x: number;
  readonly z: number;
  /** How far the patch reaches from (x, z), meters. */
  readonly reach: number;
  readonly file: PlaceFile;
}

/** What `placeAt` reads: a world's regions, the areas they stand for, and its files' patches. */
export interface WorldPlaces {
  /** The world's regions: a point's area is the region whose warped cell holds it, as its landform does. */
  readonly spec: WorldSpec;
  /** Each region's area, in the order of `spec.regions`. */
  readonly areas: readonly PlaceArea[];
  readonly patches: readonly FilePatch[];
  /** Patches by bucket, so a lookup reads only the few near a point. */
  readonly buckets: ReadonlyMap<number, readonly number[]>;
  /** Room for the regions' weights at a point. */
  readonly weights: Float64Array;
}

/** Side of a patch bucket, meters. */
const BUCKET = 8;
const bucketKey = (bx: number, bz: number): number => (bx + 32768) * 65536 + (bz + 32768);

/**
 * A baked world's places: each region is the area of the directory it stands
 * for, and `patches` are its files. An area's border runs where its region's
 * landform gives way to the next, not through the islands where ground
 * covers drift into each other.
 */
export function worldPlaces(t: Terrain, patches: readonly FilePatch[]): WorldPlaces {
  const buckets = new Map<number, number[]>();
  patches.forEach((p, i) => {
    for (let bx = Math.floor((p.x - p.reach) / BUCKET); bx <= Math.floor((p.x + p.reach) / BUCKET); bx++) {
      for (let bz = Math.floor((p.z - p.reach) / BUCKET); bz <= Math.floor((p.z + p.reach) / BUCKET); bz++) {
        const key = bucketKey(bx, bz);
        const list = buckets.get(key);
        if (list === undefined) buckets.set(key, [i]);
        else list.push(i);
      }
    }
  });
  return { spec: t.spec, areas: t.spec.regions.map((r) => areaOfPath(r.id)), patches, buckets, weights: new Float64Array(t.spec.regions.length) };
}

/** Whether (x, z) lies past the land's rounded square, in the wild. */
export function inWild(size: number, x: number, z: number): boolean {
  return Math.abs(x) ** 4 + Math.abs(z) ** 4 > (size / 2) ** 4;
}

/** Where (x, z) is: the area whose land it is, and the nearest file whose patch reaches it. */
export function placeAt(w: WorldPlaces, x: number, z: number): Place {
  if (inWild(w.spec.size, x, z)) return { area: WILD_AREA, file: null };
  regionWeights(w.spec, x, z, w.weights);
  let region = 0;
  for (let i = 1; i < w.weights.length; i++) if ((w.weights[i] as number) > (w.weights[region] as number)) region = i;
  const area = w.areas[region] ?? WILD_AREA;
  let file: PlaceFile | null = null;
  let best = Infinity;
  for (const i of w.buckets.get(bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET))) ?? []) {
    const p = w.patches[i] as FilePatch;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d <= p.reach && d < best) {
      best = d;
      file = p.file;
    }
  }
  return { area, file };
}
