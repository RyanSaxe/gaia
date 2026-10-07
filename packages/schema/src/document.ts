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
