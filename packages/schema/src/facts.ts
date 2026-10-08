// The code model for one file. The Rust engine produces it; in the real
// repository this file is generated from the Rust structs, never hand-edited.

/**
 * One of a file's finer entities: every symbol it exports, and the functions
 * and classes declared at its top level without exporting them
 * (`exported: false`), each with its doc comment and the lines it spans.
 */
export interface SymbolFact {
  readonly name: string;
  readonly kind: "function" | "class" | "type" | "constant" | "module";
  readonly exported: boolean;
  readonly doc?: string;
  /** 1-based line of its declaration. */
  readonly line?: number;
  /** How many lines it spans, at least 1. */
  readonly lines?: number;
}

/** The part a file plays, which says what kind of ground its patch is. */
export type FileKind = "source" | "test" | "config" | "data" | "docs" | "script";

export interface FileFacts {
  /** Project-relative path. This is the item's identity. */
  readonly path: string;
  readonly language: string;
  /** What part the file plays; the engine always reports it. */
  readonly kind?: FileKind;
  readonly contentHash: string;
  readonly lines: number;
  readonly symbols: readonly SymbolFact[];
  /** Project-relative paths this file imports. */
  readonly imports: readonly string[];
  readonly importedBy: readonly string[];
  /** The file's leading comment, if any. */
  readonly doc?: string;
  readonly tests: {
    /** Test files that import this file, directly or through others. */
    readonly coveredBy: readonly string[];
    /** Those of them failing in the project's latest test report. */
    readonly failing: readonly string[];
  };
  readonly complexity: {
    readonly functions: number;
    readonly longestFunction: number;
    readonly maxNesting: number;
  };
  readonly diagnostics: { readonly errors: number; readonly warnings: number; readonly lint: number };
  readonly debtMarkers: number;
  readonly unused: boolean;
  readonly git: {
    readonly daysSinceFirstCommit: number;
    readonly commitsLast14Days: number;
  };
}

/**
 * How the engine found an entity's boundary: a manifest (`package`, `crate`),
 * a deployable entry point (`service`, `app`), or a directory whose index
 * file gives it a public surface (`module`).
 */
export type EntityForm = "package" | "crate" | "service" | "app" | "module";

/**
 * Facts about one entity: a named unit of the code with a boundary, a public
 * surface, things that depend on it and a health of its own, such as a
 * package, a crate, a service or a module. Structures stand for entities.
 * The engine finds them from manifests (package.json, Cargo.toml,
 * pyproject.toml, go.mod), binary and server entry points, and directories
 * with an index file (index.ts, mod.rs, __init__.py), and sums their files'
 * facts. Entities may nest; each file belongs to its innermost entity.
 */
export interface EntityFacts {
  /** The entity's root directory, project-relative. This is its identity. */
  readonly path: string;
  /** Its own name: the manifest's, else the root directory's. */
  readonly name: string;
  readonly form: EntityForm;
  /** The file that declares it, such as package.json; absent for a module. */
  readonly manifest?: string;
  /** The file that defines its public surface, such as src/index.ts or src/lib.rs. */
  readonly entry?: string;
  /** The manifest's description, else the entry file's leading comment. */
  readonly doc?: string;
  readonly files: number;
  readonly lines: number;
  readonly languages: readonly string[];
  /** Symbols its entry exports: the size of its public surface. */
  readonly exports: number;
  /** Paths of the entities it imports from. */
  readonly dependsOn: readonly string[];
  /** Paths of the entities that import from it. */
  readonly dependents: readonly string[];
  readonly tests: {
    /** Its own test files. */
    readonly files: number;
    /** Those of them failing in the project's latest test report. */
    readonly failing: number;
    /** Share of its source files that some test imports, 0 to 1. */
    readonly covered: number;
  };
  /** Summed over its files. */
  readonly diagnostics: { readonly errors: number; readonly warnings: number; readonly lint: number };
  readonly debtMarkers: number;
  /** Share of its exported symbols nothing imports, 0 to 1. */
  readonly unusedExports: number;
  readonly git: {
    readonly daysSinceFirstCommit: number;
    readonly commitsLast14Days: number;
    readonly contributors: number;
  };
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

/** Facts about the whole repository, which the world kind reads. */
export interface RepositoryFacts {
  readonly name: string;
  readonly files: number;
  readonly lines: number;
  /** Lines per language. */
  readonly languages: Readonly<Record<string, number>>;
  readonly ageDays: number;
  readonly commitsLast30Days: number;
  readonly contributors: number;
}
