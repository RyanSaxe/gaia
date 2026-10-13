// The facts the world is laid out from: each file's and entity's code
// structure, as the world derives it from the engine's code graph
// (`factsOf` in @gaia/world). Only what the new engine uses, or what
// composing needs, is here: sizes, definitions, imports and the entities
// manifests declare. Tool signals, test coverage, history and file kinds are
// not facts the world reads.

/**
 * One of a file's definitions as the world reads it: every one it exports,
 * and the functions and classes at its top level (`exported: false`), with
 * the lines it spans.
 */
export interface SymbolFact {
  readonly name: string;
  readonly kind: "function" | "class" | "type" | "module";
  readonly exported: boolean;
  /** 1-based line of its declaration. */
  readonly line?: number;
  /** How many lines it spans, at least 1. */
  readonly lines?: number;
}

/** One file as the world reads it. */
export interface FileFacts {
  /** Project-relative path. This is the item's identity. */
  readonly path: string;
  /** The grammar the engine read it with, or "other". */
  readonly language: string;
  readonly lines: number;
  readonly symbols: readonly SymbolFact[];
  /** Project-relative paths this file imports. */
  readonly imports: readonly string[];
  readonly importedBy: readonly string[];
}

/** What declares an entity: a package's manifest (`package.json`) or a crate's (`Cargo.toml`). No file's name makes one. */
export type EntityForm = "package" | "crate";

export interface EntityFacts {
  /** The entity's root directory, project-relative. This is its identity. */
  readonly path: string;
  /** Its own name: the manifest's, else the root directory's. */
  readonly name: string;
  readonly form: EntityForm;
  /** The file that declares it, such as package.json. */
  readonly manifest: string;
  /** The file that defines its public surface, such as src/index.ts or src/lib.rs. */
  readonly entry?: string;
  readonly files: number;
  readonly lines: number;
  /** Definitions its entry exports: the size of its public surface. */
  readonly exports: number;
  /** Paths of the entities it imports from. */
  readonly dependsOn: readonly string[];
  /** Paths of the entities that import from it. */
  readonly dependents: readonly string[];
}

/**
 * What any thing that stands for code is, as a building's or a landmark's
 * numbers read it: an entity (whose facts are these and more), a file or a
 * definition. `dependents` are what lean on it: the entities that import an
 * entity, the files that import a file, the definitions that call or name a
 * definition.
 */
export interface ThingFacts {
  /** Its identity: an entity's root directory, a file's path or a definition's `<file>#<name>`. */
  readonly path: string;
  readonly name: string;
  readonly lines: number;
  /** How much of it others may use: an entity's exported definitions, a file's, or 1 for an exported definition. */
  readonly exports: number;
  readonly dependents: readonly string[];
}

/** Facts about one directory, which becomes a region. */
export interface RegionFacts {
  readonly path: string;
  readonly files: number;
  readonly lines: number;
  readonly languages: readonly string[];
  /** Meters across, from the world layout. */
  readonly extent: number;
}

/**
 * Facts about one dependency between two entities, which the link kind
 * reads: the entity that imports and the entity it leans on, each with its
 * own facts, so a trail between them can follow both.
 */
export interface DependencyFacts {
  /** The entity that depends on the other. */
  readonly from: EntityFacts;
  /** The entity it depends on. */
  readonly to: EntityFacts;
  /** How many of `from`'s files import from `to`. */
  readonly importers: number;
}

export interface RepositoryFacts {
  /** By its remote, as the engine's graph names it. */
  readonly name: string;
  readonly files: number;
  readonly lines: number;
}

/** The facts one project's world is laid out from, as `factsOf` in @gaia/world derives them from its code graph. */
export interface CodeFacts {
  readonly projectId: string;
  readonly files: readonly FileFacts[];
  readonly entities: readonly EntityFacts[];
  readonly repository: RepositoryFacts;
}
