// The world document: the world's source of truth, stored per project.
// Plain JSON. Geometry is never stored here; the realizer rebuilds it.

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

export interface Region {
  /** The directory's project-relative path. */
  readonly id: Path;
  readonly parent: Path | null;
  readonly biome: BlueprintId;
  /** Blueprints native to this region, which its files choose among first. */
  readonly pool: readonly BlueprintId[];
}

export interface Instance {
  readonly id: Path;
  readonly region: Path;
  readonly kind: string;
  readonly blueprint: BlueprintId;
}

export interface Link {
  readonly id: `${Path}->${Path}`;
  readonly from: Path;
  readonly to: Path;
  readonly blueprint: BlueprintId;
}

export interface Placement {
  readonly x: number;
  readonly z: number;
  readonly rotation: number;
  /** True once the person moved it; layout never moves a pinned item. */
  readonly pinned: boolean;
}

export interface WorldDocument {
  readonly schemaVersion: 1;
  readonly projectId: string;
  /** The Jev model build every stored answer came from, such as "typesafe/jev-1.13". */
  readonly model: string;
  readonly regions: Readonly<Record<Path, Region>>;
  readonly blueprints: Readonly<Record<BlueprintId, Blueprint>>;
  readonly instances: Readonly<Record<Path, Instance>>;
  readonly links: Readonly<Record<string, Link>>;
  readonly placements: Readonly<Record<Path, Placement>>;
}

/** A directory's land: the ground it holds, its own and its subdirectories'. */
export interface AreaPlace {
  /** The directory's project-relative path; "" is the repository's root. */
  readonly path: string;
  readonly name: string;
  /** 0 for the root, 1 for its subdirectories, and so on. */
  readonly depth: number;
  readonly parent: Path | null;
  /** Its heart: a point on its own ground near the middle of its land. */
  readonly x: number;
  readonly z: number;
}

/**
 * A file's patch of ground inside its directory's area. In a world laid out
 * from code its ground is its cell (`CellPlace.file`), and `x`, `z` and
 * `radius` are its heart and how far its ground reaches on average; in a
 * world laid out as regions it is the disc they describe.
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
 * One cell of the land. A point is the cell's when the cell's site is the
 * nearest to the point, measured from the point moved by the land's warp and
 * less each site's reach (`siteAt` in @gaia/terrain), so cells are organic
 * and fill the land. In a world laid out from code every cell is one file's
 * patch or one entity's lot; in a world laid out as regions each region is
 * one cell.
 */
export interface CellPlace {
  /** The area's path. */
  readonly area: Path;
  /**
   * The file whose patch this cell is; null for ground that is its area's
   * own and no file's (an entity's lot). Absent, the cell says nothing of
   * files, and patches are the discs `PatchPlace` describes.
   */
  readonly file?: Path | null;
  readonly x: number;
  readonly z: number;
  /** How far the cell's own ground reaches before a neighbor's begins, meters. */
  readonly reach?: number;
}

/**
 * Where every directory's area and every file's patch lies in a world, so
 * anything can ask what stands under a point (`placeAt` in @gaia/terrain).
 * The land is divided into cells; an area's land is every cell of its own
 * and of its subdirectories, so areas nest and fill the land.
 */
export interface WorldPlaces {
  /** The repository's name, which names the world. */
  readonly name: string;
  /** Side of the codebase's square of land, meters; past its rounded edge is the wild, which stands for no directory. */
  readonly size: number;
  readonly areas: readonly AreaPlace[];
  readonly patches: readonly PatchPlace[];
  readonly cells: readonly CellPlace[];
}
