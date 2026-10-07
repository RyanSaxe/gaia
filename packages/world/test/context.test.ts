import { describe, expect, it } from "vitest";
import type { JevAnswer, JevClient, JevQuestion } from "@gaia/schema";
import { type ContextSource, gather } from "@gaia/world";

const questions: Record<string, JevQuestion> = {
  "form.use": { type: "choice", instructions: "Which form?", criteria: { a: "A", b: "B" } },
  "crown.present": { type: "noul", instructions: "A crown?" },
};

const source: ContextSource = {
  facts: { path: "src/scan.rs" },
  readings: {
    docs: { describe: "The file's doc comments.", state: () => ({ docs: "Walks the project." }) },
    importers: { describe: "The files that import it.", state: () => ({ importers: ["src/cli.rs"] }) },
    signatures: { describe: "Its exported signatures.", state: () => ({ signatures: ["fn scan(root: &Path)"] }) },
  },
};

/**
 * A fake Jev: sure about the form from facts alone, sure about the crown only
 * once it has seen the importers, and it says the importers would help.
 */
function fake(log: string[][]): JevClient {
  return {
    async ask(request) {
      log.push(Object.keys(request.state as object).filter((k) => k !== "path"));
      const seenImporters = "importers" in (request.state as object);
      const answers: Record<string, JevAnswer> = {};
      for (const id of Object.keys(request.questions)) {
        if (id === "form.use") answers[id] = { type: "choice", choice: "a", probabilities: { a: 0.9, b: 0.1 }, confidence: 0.8 };
        else if (id === "crown.present") answers[id] = { type: "noul", noul: seenImporters ? 0.9 : 0.55 };
        else answers[id] = { type: "noul", noul: id === "read:importers" ? 0.8 : 0.2 };
      }
      return { answers, model: request.model, costUsd: 0, ms: 0 };
    },
  };
}

describe("gathering context", () => {
  it("reads what Jev asks for, and only for the answers it was unsure about", async () => {
    const log: string[][] = [];
    const result = await gather(fake(log), questions, source);
    expect(log).toEqual([[], ["importers"]]);
    expect(result.read).toEqual({ "form.use": [], "crown.present": ["importers"] });
    expect(result.requests).toBe(2);
  });

  it("escalates in order when Jev is not asked", async () => {
    const log: string[][] = [];
    await gather(fake(log), questions, source, { letJevChoose: false });
    expect(log).toEqual([[], ["docs"], ["docs", "importers"]]);
  });
});
