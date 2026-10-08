// Where a person is: the area (a directory) whose ground a point is, and the
// file whose patch is underfoot, if any. Past the codebase's land lies the
// wild, which stands for no directory. Everything that tells a person where
// they are (arrival titles or a slip, the field map, signposts) reads only
// `placeAt`, and anything that draws the areas reads `outlinesOf`.
//
// The land is divided into cells by one rule (`siteAt`): the terrain's
// regions follow it too, so a point's area, its landform and its cover always
// agree. A world laid out from code gives every file's patch and every
// entity's lot a cell; a world laid out as regions (the lab's sample world)
// gives each region one cell, and its files' patches are discs.

import type { CellPlace, PatchPlace, WorldPlaces } from "@gaia/schema";
import { siteAt } from "./land.ts";
import type { WorldSpec } from "./world.ts";

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
/** What a lookup reads quickly: disc patches by bucket, patches and areas by path, and the root. */
interface Index {
  readonly buckets: ReadonlyMap<number, readonly number[]>;
  readonly patches: ReadonlyMap<string, PatchPlace>;
  readonly byPath: ReadonlyMap<string, Area>;
  readonly root: Area | undefined;
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
    patches: new Map(world.patches.map((p) => [p.path, p])),
    byPath: new Map(world.areas.map((a) => [a.path, a])),
    root: world.areas.find((a) => a.parent === null),
  };
  indexes.set(world, index);
  return index;
}

/** The disc patch under (x, z), for a world whose cells say nothing of files. */
function discAt(world: WorldPlaces, index: Index, x: number, z: number): Place["file"] {
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
  return file;
}

/** The cell under (x, z), or -1 past the land or in a world with no cells. */
export function cellUnder(world: WorldPlaces, x: number, z: number): number {
  if (pastTheLand(world.size, x, z) || world.cells.length === 0) return -1;
  return siteAt(world.cells, x, z);
}

/** The area and the file patch under (x, z). */
export function placeAt(world: WorldPlaces, x: number, z: number): Place {
  if (pastTheLand(world.size, x, z)) return { area: WILD_AREA, file: null };
  const index = indexOf(world);
  const k = cellUnder(world, x, z);
  const cell = k < 0 ? undefined : (world.cells[k] as CellPlace);
  const area = (cell === undefined ? undefined : index.byPath.get(cell.area)) ?? index.root;
  let file: Place["file"];
  if (cell?.file === undefined) file = discAt(world, index, x, z);
  else {
    const p = cell.file === null ? undefined : index.patches.get(cell.file);
    file = p === undefined ? null : { path: p.path, name: p.name, vitality: p.vitality };
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
 * directory it stands for (its id) and one cell, and each file's patch a disc
 * of ground in the area that holds its middle.
 */
export function regionPlaces(spec: WorldSpec, name: string, files: readonly Omit<PatchPlace, "area">[]): WorldPlaces {
  const cells: CellPlace[] = spec.regions.map((r) => ({ area: pathParts(r.id).path, x: r.x, z: r.z, ...(r.reach === undefined ? {} : { reach: r.reach }) }));
  return {
    name,
    size: spec.size,
    areas: spec.regions.map((r) => ({ ...pathParts(r.id), x: r.x, z: r.z })),
    patches: files.map((f) => ({ ...f, area: (cells[siteAt(cells, f.x, f.z)] as CellPlace).area })),
    cells,
  };
}

/** One area's or patch's outline: closed rings of world points, [x0, z0, x1, z1, …], softened. */
export interface Outline {
  readonly path: string;
  /** An area's depth; for a patch, its area's depth plus one. */
  readonly depth: number;
  readonly rings: readonly (readonly number[])[];
}

/** Every area's and every file patch's outline, for drawing: what a map reads instead of guessing shapes. */
export interface Outlines {
  readonly areas: readonly Outline[];
  readonly patches: readonly Outline[];
}

/** Chains raster edges (pairs of corner indices, inside on one side) into closed rings. */
function ringsOf(edges: readonly number[]): number[][] {
  const next = new Map<number, number[]>();
  for (let k = 0; k < edges.length; k += 2) {
    const a = edges[k] as number;
    const list = next.get(a);
    if (list === undefined) next.set(a, [edges[k + 1] as number]);
    else list.push(edges[k + 1] as number);
  }
  const rings: number[][] = [];
  for (const start of [...next.keys()].sort((a, b) => a - b)) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const ring: number[] = [start];
      let at = start;
      for (;;) {
        const list = next.get(at);
        if (list === undefined || list.length === 0) break;
        const to = list.pop() as number;
        if (to === start) break;
        ring.push(to);
        at = to;
      }
      if (ring.length >= 3) rings.push(ring);
    }
  }
  return rings;
}

/** Softens a closed ring twice by cutting corners, so a raster's steps read as a hand-drawn line. */
function soften(points: readonly number[]): number[] {
  let pts = points;
  for (let pass = 0; pass < 2; pass++) {
    const out: number[] = [];
    const count = pts.length / 2;
    for (let k = 0; k < count; k++) {
      const ax = pts[k * 2] as number;
      const az = pts[k * 2 + 1] as number;
      const bx = pts[((k + 1) % count) * 2] as number;
      const bz = pts[((k + 1) % count) * 2 + 1] as number;
      out.push(ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25, ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75);
    }
    pts = out;
  }
  return pts.map((v) => Math.round(v * 10) / 10);
}

/**
 * Outlines every area and patch of a world, sampled every `step` meters over
 * its land with `placeAt`: an area's outline holds its own ground and its
 * subdirectories'; a patch's is its cell in a world laid out from code, or
 * its disc. The same world and step give the same outlines, traced once.
 */
const outlined = new WeakMap<WorldPlaces, Map<number, Outlines>>();

export function outlinesOf(world: WorldPlaces, step = 4): Outlines {
  const cached = outlined.get(world)?.get(step);
  if (cached !== undefined) return cached;
  const made = traceOutlines(world, step);
  const byStep = outlined.get(world) ?? new Map<number, Outlines>();
  byStep.set(step, made);
  outlined.set(world, byStep);
  return made;
}

function traceOutlines(world: WorldPlaces, step: number): Outlines {
  const half = world.size / 2;
  const n = Math.ceil(world.size / step);
  const x0 = -half;
  const areaAt = new Int32Array(n * n).fill(-1);
  const patchAt = new Int32Array(n * n).fill(-1);
  const areaIndex = new Map(world.areas.map((a, i) => [a.path, i]));
  const patchIndex = new Map(world.patches.map((p, i) => [p.path, i]));
  // Each owner's box on the raster, so tracing it reads only its own samples.
  const areaBox = world.areas.map(() => [n, n, -1, -1]);
  const patchBox = world.patches.map(() => [n, n, -1, -1]);
  const grow = (box: number[] | undefined, i: number, j: number): void => {
    if (box === undefined) return;
    box[0] = Math.min(box[0] as number, i);
    box[1] = Math.min(box[1] as number, j);
    box[2] = Math.max(box[2] as number, i);
    box[3] = Math.max(box[3] as number, j);
  };
  const parentOf = world.areas.map((a) => areaIndex.get(a.parent ?? "\u0000") ?? -1);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const place = placeAt(world, x0 + (i + 0.5) * step, x0 + (j + 0.5) * step);
      if (place.area.depth < 0) continue;
      const a = areaIndex.get(place.area.path) ?? -1;
      areaAt[j * n + i] = a;
      for (let k = a; k >= 0; k = parentOf[k] as number) grow(areaBox[k], i, j);
      const p = place.file === null ? -1 : (patchIndex.get(place.file.path) ?? -1);
      patchAt[j * n + i] = p;
      grow(patchBox[p], i, j);
    }
  }
  const corner = (i: number, j: number): number => j * (n + 1) + i;
  const toWorld = (ring: readonly number[]): number[] => soften(ring.flatMap((c) => [x0 + (c % (n + 1)) * step, x0 + Math.floor(c / (n + 1)) * step]));
  // The raster edges between a sample an owner holds and one it does not, chained into rings.
  const trace = (box: readonly number[], holds: (k: number) => boolean): number[][] => {
    const edges: number[] = [];
    const inside = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < n && j < n && holds(j * n + i);
    for (let j = box[1] as number; j <= (box[3] as number); j++) {
      for (let i = box[0] as number; i <= (box[2] as number); i++) {
        if (!inside(i, j)) continue;
        if (!inside(i, j - 1)) edges.push(corner(i, j), corner(i + 1, j));
        if (!inside(i + 1, j)) edges.push(corner(i + 1, j), corner(i + 1, j + 1));
        if (!inside(i, j + 1)) edges.push(corner(i + 1, j + 1), corner(i, j + 1));
        if (!inside(i - 1, j)) edges.push(corner(i, j + 1), corner(i, j));
      }
    }
    return ringsOf(edges).map(toWorld);
  };
  const within = world.areas.map((a) => {
    const set = new Set<number>();
    for (let p: string | null = a.path; p !== null; ) {
      const k = areaIndex.get(p);
      if (k === undefined) break;
      set.add(k);
      p = world.areas[k]?.parent ?? null;
    }
    return set;
  });
  const areas = world.areas.map((a, ai) => ({ path: a.path, depth: a.depth, rings: trace(areaBox[ai] as number[], (k) => (areaAt[k] as number) >= 0 && (within[areaAt[k] as number] as Set<number>).has(ai)) }));
  const patches = world.patches.map((p, pi) => ({ path: p.path, depth: (world.areas[areaIndex.get(p.area) ?? -1]?.depth ?? 0) + 1, rings: trace(patchBox[pi] as number[], (k) => patchAt[k] === pi) }));
  return { areas: areas.filter((a) => a.rings.length > 0), patches: patches.filter((p) => p.rings.length > 0) };
}
