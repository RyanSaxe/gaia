import type { FileFacts, JevAnswer, JevRequest } from "@gaia/schema";

/** Facts for this mock's subject file, shaped as the Rust engine would send them. */
export const SCANNER: FileFacts = {
  path: "src-tauri/src/scanner.rs",
  language: "rust",
  contentHash: "9f1c…",
  lines: 299,
  symbols: [
    { name: "scan_project", kind: "function", exported: true, doc: "Walks the project and hashes every file." },
    { name: "FileEntry", kind: "type", exported: true },
    { name: "DirectorySummary", kind: "type", exported: true },
  ],
  imports: ["src-tauri/src/lib.rs"],
  importedBy: ["src-tauri/src/commands.rs"],
  doc: "Walks a project with gitignore support and records hashes, line counts and languages.",
  tests: { coveredBy: [], own: [], failing: [] },
  complexity: { functions: 9, longestFunction: 58, maxNesting: 4 },
  diagnostics: { errors: 0, warnings: 1, lint: 2 },
  debtMarkers: 2,
  unused: false,
  git: { daysSinceFirstCommit: 171, daysSinceLastCommit: 2, commitsLast14Days: 0, commits: 3, authors: 1 },
};

/**
 * A stand-in for Jev that answers every question deterministically, with a
 * probability spread shaped like a real response. Tests never call the network.
 */
export function fakeJev(request: JevRequest, prefer: Readonly<Record<string, string | number | boolean>> = {}) {
  const answers: Record<string, JevAnswer> = {};
  for (const [id, q] of Object.entries(request.questions)) {
    if (q.type === "noul") {
      const want = prefer[id];
      answers[id] = { type: "noul", noul: want === false ? 0.2 : 0.8 };
    } else if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      const choice = typeof prefer[id] === "string" && keys.includes(prefer[id] as string) ? (prefer[id] as string) : keys.sort()[0]!;
      const probabilities = Object.fromEntries(keys.map((k) => [k, k === choice ? 0.7 : 0.3 / (keys.length - 1)]));
      answers[id] = { type: "choice", choice, probabilities, confidence: 0.6 };
    } else {
      const level = typeof prefer[id] === "number" ? (prefer[id] as number) : Math.floor((q.criteria.length - 1) / 2);
      const probabilities = Object.fromEntries(q.criteria.map((_, i) => [String(i), i === level ? 0.7 : 0.3 / (q.criteria.length - 1)]));
      answers[id] = { type: "score", score: level, probabilities, confidence: 0.6 };
    }
  }
  return answers;
}
