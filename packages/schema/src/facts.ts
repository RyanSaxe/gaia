// The facts the world is laid out from, which `factsOf` in @gaia/world derives
// from the engine's code graph. They cover only sizes, definitions, imports
// and the entities that manifests declare. Tool signals, test coverage,
// history and file kinds are not facts the world reads.

/**
 * One of a file's definitions, with the lines it spans. `factsOf` includes
 * every definition a file exports, and the functions and classes at its top
 * level with `exported: false`.
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

/** One file's facts. */
export interface FileFacts {
  /** Project-relative path, which identifies the file. */
  readonly path: string;
  /** The grammar the engine parsed it with, or "other". */
  readonly language: string;
  readonly lines: number;
  readonly symbols: readonly SymbolFact[];
  /** Project-relative paths this file imports. */
  readonly imports: readonly string[];
  readonly importedBy: readonly string[];
}

/** What declares an entity: a package's `package.json` or a crate's `Cargo.toml`. A file's name never makes one. */
export type EntityForm = "package" | "crate";

export interface EntityFacts {
  /** The entity's project-relative root directory, which identifies it. */
  readonly path: string;
  /** Its own name: the manifest's, else the root directory's. */
  readonly name: string;
  readonly form: EntityForm;
  /** The file that declares it, such as package.json. */
  readonly manifest: string;
  /** The file that defines its public API, such as src/index.ts or src/lib.rs. */
  readonly entry?: string;
  readonly files: number;
  readonly lines: number;
  /** How many definitions its entry exports, which measures its public API. */
  readonly exports: number;
  /** Paths of the entities it imports from. */
  readonly dependsOn: readonly string[];
  /** Paths of the entities that import from it. */
  readonly dependents: readonly string[];
}

/**
 * The facts a building's or landmark's numbers read from the code it
 * represents: an entity, whose facts include these, a file or a definition.
 * `dependents` are what depends on it: the entities that import an entity,
 * the files that import a file, or the definitions that call or name a
 * definition.
 */
export interface ThingFacts {
  /** An entity's root directory, a file's path or a definition's `<file>#<name>`. */
  readonly path: string;
  readonly name: string;
  readonly lines: number;
  /** How much of it other code may use: the count of an entity's or file's exported definitions, or 1 for an exported definition. */
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
 * reads. It has the importing entity and the entity it depends on, each with
 * its own facts, so a trail between them can use both.
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
  /** The repository's name from its remote, as the engine's graph gives it. */
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
