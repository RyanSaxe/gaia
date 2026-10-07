// The answer store's rules. Gaia asks Jev again only when the facts a
// question reads have changed, and even then a stored answer stays unless
// the new response clearly prefers another option.

import { type JevAnswer, contentHash } from "@gaia/schema";

export interface StoredAnswer {
  /** Changes only when the question, the model or the facts it reads change. */
  readonly key: string;
  readonly value: string | boolean;
  readonly model: string;
}

export function answerKey(questionId: string, questionVersion: number, model: string, factsRead: unknown): string {
  return contentHash({ questionId, questionVersion, model, factsRead });
}

/** How much more probable a new option must be before it replaces a stored one. Tuned in slice 5. */
export const DEFAULT_MARGIN = 0.15;

/**
 * Decides which value to keep after Jev answers a question whose key changed.
 * The response already holds a probability for the stored option, so Gaia
 * compares the two options inside the same response.
 */
export function reconcile(
  stored: StoredAnswer | undefined,
  fresh: JevAnswer,
  margin: number = DEFAULT_MARGIN,
): string | boolean {
  switch (fresh.type) {
    case "noul": {
      const now = fresh.noul > 0.5;
      if (stored === undefined || stored.value === now) return now;
      return Math.abs(fresh.noul - 0.5) >= margin / 2 ? now : stored.value;
    }
    case "choice":
    case "score": {
      const [best, bestP] = top(fresh.probabilities);
      const latest = fresh.type === "choice" ? fresh.choice : best;
      if (stored === undefined || typeof stored.value !== "string") return latest;
      const storedP = fresh.probabilities[stored.value] ?? 0;
      return bestP - storedP >= margin ? latest : stored.value;
    }
  }
}

function top(probabilities: Readonly<Record<string, number>>): [string, number] {
  let best = "";
  let bestP = -1;
  for (const [option, p] of Object.entries(probabilities)) if (p > bestP) [best, bestP] = [option, p];
  return [best, bestP];
}
