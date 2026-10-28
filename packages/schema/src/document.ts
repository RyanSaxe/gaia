// Blueprints and the places of a world, as plain JSON. Geometry is never
// stored, because the realizer rebuilds it.

import type { PrimitiveId } from "./primitive.ts";

export type Path = string;
export type BlueprintId = `bp-${string}`;

/** A filled slot: the chosen primitive, the stored words for its params, and its own slots. */
export interface FilledSlot {
  readonly use: PrimitiveId;
  readonly params: Readonly<Record<string, string | boolean | readonly string[]>>;
  readonly slots?: Readonly<Record<string, FilledSlot>>;
}

/** A filled kind. Its ID is a hash of its contents, so equal answers name the same blueprint. */
export interface Blueprint {
  readonly id: BlueprintId;
  readonly kind: string;
  readonly slots: Readonly<Record<string, FilledSlot>>;
}

/** A directory's land, which includes its subdirectories' land. */
export interface AreaPlace {
  /** The directory's project-relative path; "" is the repository's root. */
  readonly path: string;
  readonly name: string;
  /** 0 for the root, 1 for its subdirectories, and so on. */
  readonly depth: number;
  readonly parent: Path | null;
  /** A point on its own ground near the center of its land. */
  readonly x: number;
  readonly z: number;
}

/**
 * A file's patch of ground inside its directory's area. In a world laid out
 * from code, its ground is its cell (`CellPlace.file`), `x` and `z` are its
 * center, and `radius` is how far its ground reaches on average. In a world
 * laid out as regions, it is the disc they describe.
 */
export interface PatchPlace {
  readonly path: string;
  readonly name: string;
  /** Its directory's path. */
  readonly area: Path;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  /** The file's vitality now, 0 to 1. */
  readonly vitality: number;
}

/**
 * One cell of the land. A point belongs to the cell whose site is nearest,
 * measured from the point moved by the land's warp, less each site's reach
 * (`siteAt` in @gaia/terrain), so cells have irregular shapes and fill the
 * land. In a world laid out from code, every cell is one file's patch or one
 * entity's lot. In a world laid out as regions, each region is one cell.
 */
export interface CellPlace {
  /** The area's path. */
  readonly area: Path;
  /**
   * The file whose patch this cell is, or null for an entity's lot, which
   * belongs to the area and no file. When absent, the cell has no file
   * information, and patches are the discs `PatchPlace` describes.
   */
  readonly file?: Path | null;
  readonly x: number;
  readonly z: number;
  /** How far the cell's own ground reaches before a neighbor's begins, meters. */
  readonly reach?: number;
}

/**
 * Where every directory's area and every file's patch is in a world, so
 * `placeAt` in @gaia/terrain can find what is under a point. The land is
 * divided into cells. An area's land is its own cells and its subdirectories'
 * cells, so areas nest and fill the land.
 */
export interface WorldPlaces {
  /** The repository's name, which names the world. */
  readonly name: string;
  /** The width of the codebase's land, west to east, in meters. Past its rounded edge is the wild, which represents no directory. */
  readonly size: number;
  /** How much wider than deep the land is, or 1 for a square when absent. A world laid out from code uses the journal spread's proportions. */
  readonly aspect?: number;
  readonly areas: readonly AreaPlace[];
  readonly patches: readonly PatchPlace[];
  readonly cells: readonly CellPlace[];
}
