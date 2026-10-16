import type { AnyKind, FileFacts, FilledSlot, JevAnswer, JevRequest, Library } from "@gaia/schema";

/** Facts for this mock's subject file, shaped as the Rust engine would send them. */
export const SCANNER: FileFacts = {
  path: "src-tauri/src/scanner.rs",
  language: "rust",
  lines: 299,
  symbols: [
    { name: "scan_project", kind: "function", exported: true },
    { name: "FileEntry", kind: "type", exported: true },
    { name: "DirectorySummary", kind: "type", exported: true },
  ],
  imports: ["src-tauri/src/lib.rs"],
  importedBy: ["src-tauri/src/commands.rs"],
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

const pick = <T>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length)] as T;

/** A kind's slots drawn uniformly: each optional slot's presence, each slot's primitive, and each parameter. */
export function randomSlots(k: AnyKind, lib: Library, random: () => number): Record<string, FilledSlot> {
  const slots: Record<string, FilledSlot> = {};
  for (const [name, s] of Object.entries(k.slots)) {
    if (s.optional && random() < 0.5) continue;
    if (s.on !== undefined && !(s.on in slots)) continue;
    const p = pick(lib.forRole(s.role), random);
    const params: Record<string, string | boolean | string[]> = {};
    for (const [param, f] of Object.entries(p.params)) {
      if (f.type === "scale") params[param] = pick(f.levels, random).words;
      else if (f.type === "choice") params[param] = pick(Object.keys(f.options), random);
      else if (f.type === "flag") params[param] = random() < 0.5;
      else params[param] = Object.keys(f.members).filter(() => random() < 0.5);
    }
    slots[name] = { use: p.id, params };
  }
  return slots;
}
