// The code model for one file. The Rust engine produces it; in the real
// repository this file is generated from the Rust structs, never hand-edited.

export interface SymbolFact {
  readonly name: string;
  readonly kind: "function" | "class" | "type" | "constant" | "module";
  readonly exported: boolean;
  readonly doc?: string;
}

export interface FileFacts {
  /** Project-relative path. This is the item's identity. */
  readonly path: string;
  readonly language: string;
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
