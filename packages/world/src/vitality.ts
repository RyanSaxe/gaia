// Vitality from named signals. Each signal gives a penalty from 0 to 1 and
// its weight sets how much that penalty can cost; penalties multiply.

import type { EntityFacts, FileFacts } from "@gaia/schema";

/**
 * What Jev judged about a file that its vitality reads: the facts say what a
 * tool can measure, and Jev what a tool cannot, such as whether a file holds
 * behavior that needs tests of its own.
 */
export interface FileJudged {
  /** Jev's probability that the file holds behavior a test should check. Without it, every file is taken to need tests. */
  readonly needsTests?: number;
}

export interface Signal {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  readonly penalty: (f: FileFacts, judged: FileJudged) => number;
  /** The facts behind the penalty in words. */
  readonly reading: (f: FileFacts, judged: FileJudged) => string;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** How far a file is from tested: none of its own entity's tests reach it (1), only other entities' tests reach it (0.5), or its own do (0). */
const untested = (f: FileFacts): number => (f.tests.own.length > 0 ? 0 : f.tests.coveredBy.length > 0 ? 0.5 : 1);
const testedWords = (f: FileFacts): string =>
  f.tests.own.length > 0 ? `${f.tests.own.length} of its own entity's tests reach it` : f.tests.coveredBy.length > 0 ? `only other entities' tests reach it (${f.tests.coveredBy.length})` : "no test reaches it";

export const TOOL_SIGNALS: readonly Signal[] = [
  {
    id: "tests",
    label: "Failing tests",
    weight: 0.8,
    penalty: (f) => (f.tests.failing.length > 0 ? 1 : 0),
    reading: (f) => `${f.tests.failing.length} of ${f.tests.coveredBy.length} covering tests failing`,
  },
  { id: "errors", label: "Compiler errors", weight: 0.7, penalty: (f) => clamp01(f.diagnostics.errors / 3), reading: (f) => `${f.diagnostics.errors} errors` },
  {
    id: "complexity",
    label: "Complexity",
    weight: 0.35,
    penalty: (f) => clamp01((f.complexity.longestFunction - 60) / 140 + (f.complexity.maxNesting - 4) / 6),
    reading: (f) => `longest function ${f.complexity.longestFunction} lines, nesting ${f.complexity.maxNesting} deep`,
  },
  {
    id: "untested",
    label: "Untested code",
    weight: 0.25,
    penalty: (f, j) => untested(f) * (j.needsTests ?? 1),
    reading: (f, j) => `${testedWords(f)}${j.needsTests === undefined ? "" : `; Jev: ${Math.round(j.needsTests * 100)}% that it needs tests of its own`}`,
  },
  { id: "lint", label: "Lint warnings", weight: 0.15, penalty: (f) => clamp01(f.diagnostics.lint / 10), reading: (f) => `${f.diagnostics.lint} warnings` },
  { id: "unused", label: "Unused code", weight: 0.2, penalty: (f) => (f.unused ? 1 : 0), reading: (f) => (f.unused ? "nothing imports it" : "in use") },
  { id: "debt", label: "Debt markers", weight: 0.15, penalty: (f) => clamp01(f.debtMarkers / 5), reading: (f) => `${f.debtMarkers} TODOs and FIXMEs` },
];

/** A named judgment Jev scores, cached by the file's content hash like any other answer. */
export interface JevSignal {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  /** Penalty from Jev's score, 0 to 1. */
  readonly penalty: number;
}

export interface VitalityReport {
  readonly vitality: number;
  readonly terms: readonly {
    readonly id: string;
    readonly label: string;
    readonly weight: number;
    readonly penalty: number;
    /** The facts behind the penalty in words, such as "2 of 14 test files failing". */
    readonly reading?: string;
  }[];
}

export function vitalityOf(f: FileFacts, jev: readonly JevSignal[] = [], judged: FileJudged = {}): VitalityReport {
  const terms = [
    ...TOOL_SIGNALS.map((s) => ({ id: s.id, label: s.label, weight: s.weight, penalty: s.penalty(f, judged), reading: s.reading(f, judged) })),
    ...jev.map((s) => ({ id: s.id, label: s.label, weight: s.weight, penalty: s.penalty })),
  ];
  const vitality = terms.reduce((v, term) => v * (1 - term.weight * term.penalty), 1);
  return { vitality, terms };
}

/** Activity is separate: recent change drives life and light, never decline. */
export const activityOf = (f: FileFacts): number => clamp01(f.git.commitsLast14Days / 10);

/** A signal about a whole entity, read from the facts summed over its files. */
export interface EntitySignal {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  readonly penalty: (e: EntityFacts) => number;
  readonly reading: (e: EntityFacts) => string;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * An entity's signals: the file signals, read as shares of the whole, so a
 * large package with one failing test declines a little and one with half
 * its tests failing declines a lot.
 */
export const ENTITY_SIGNALS: readonly EntitySignal[] = [
  {
    id: "tests",
    label: "Failing tests",
    weight: 0.8,
    penalty: (e) => (e.tests.files === 0 ? 0 : clamp01((e.tests.failing / e.tests.files) * 4)),
    reading: (e) => `${e.tests.failing} of ${plural(e.tests.files, "test file")} failing`,
  },
  { id: "errors", label: "Compiler errors", weight: 0.7, penalty: (e) => clamp01(e.diagnostics.errors / 6), reading: (e) => plural(e.diagnostics.errors, "error") },
  {
    id: "untested",
    label: "Untested code",
    weight: 0.35,
    penalty: (e) => clamp01(1 - e.tests.covered),
    reading: (e) => `${Math.round((1 - e.tests.covered) * 100)}% of files no test reaches`,
  },
  { id: "lint", label: "Lint warnings", weight: 0.15, penalty: (e) => clamp01(e.diagnostics.lint / 30), reading: (e) => plural(e.diagnostics.lint, "warning") },
  {
    id: "unused",
    label: "Unused exports",
    weight: 0.15,
    penalty: (e) => clamp01(e.unusedExports * 2),
    reading: (e) => `${Math.round(e.unusedExports * 100)}% of exports unused`,
  },
  { id: "debt", label: "Debt markers", weight: 0.15, penalty: (e) => clamp01(e.debtMarkers / 15), reading: (e) => plural(e.debtMarkers, "TODO or FIXME", "TODOs and FIXMEs") },
];

/** An entity's vitality: its signals' penalties multiplied, with any named Jev judgments. */
export function entityVitalityOf(e: EntityFacts, jev: readonly JevSignal[] = []): VitalityReport {
  const terms = [
    ...ENTITY_SIGNALS.map((s) => ({ id: s.id, label: s.label, weight: s.weight, penalty: s.penalty(e), reading: s.reading(e) })),
    ...jev.map((s) => ({ id: s.id, label: s.label, weight: s.weight, penalty: s.penalty })),
  ];
  const vitality = terms.reduce((v, term) => v * (1 - term.weight * term.penalty), 1);
  return { vitality, terms };
}
