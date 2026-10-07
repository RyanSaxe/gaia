// Vitality from named signals. Each signal gives a penalty from 0 to 1 and
// its weight sets how much that penalty can cost; penalties multiply.

import type { FileFacts } from "@gaia/schema";

export interface Signal {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  readonly penalty: (f: FileFacts) => number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export const TOOL_SIGNALS: readonly Signal[] = [
  { id: "tests", label: "Failing tests", weight: 0.8, penalty: (f) => (f.tests.failing.length > 0 ? 1 : 0) },
  { id: "errors", label: "Compiler errors", weight: 0.7, penalty: (f) => clamp01(f.diagnostics.errors / 3) },
  {
    id: "complexity",
    label: "Complexity",
    weight: 0.35,
    penalty: (f) => clamp01((f.complexity.longestFunction - 60) / 140 + (f.complexity.maxNesting - 4) / 6),
  },
  { id: "untested", label: "Untested code", weight: 0.25, penalty: (f) => (f.tests.coveredBy.length === 0 ? 1 : 0) },
  { id: "lint", label: "Lint warnings", weight: 0.15, penalty: (f) => clamp01(f.diagnostics.lint / 10) },
  { id: "unused", label: "Unused code", weight: 0.2, penalty: (f) => (f.unused ? 1 : 0) },
  { id: "debt", label: "Debt markers", weight: 0.15, penalty: (f) => clamp01(f.debtMarkers / 5) },
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
  readonly terms: readonly { readonly id: string; readonly label: string; readonly weight: number; readonly penalty: number }[];
}

export function vitalityOf(f: FileFacts, jev: readonly JevSignal[] = []): VitalityReport {
  const terms = [
    ...TOOL_SIGNALS.map((s) => ({ id: s.id, label: s.label, weight: s.weight, penalty: s.penalty(f) })),
    ...jev.map((s) => ({ id: s.id, label: s.label, weight: s.weight, penalty: s.penalty })),
  ];
  const vitality = terms.reduce((v, term) => v * (1 - term.weight * term.penalty), 1);
  return { vitality, terms };
}

/** Activity is separate: recent change drives life and light, never decline. */
export const activityOf = (f: FileFacts): number => clamp01(f.git.commitsLast14Days / 10);
