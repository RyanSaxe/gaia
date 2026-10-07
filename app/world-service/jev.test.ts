import { describe, expect, it } from "vitest";
import type { EngineClient, JevRequest } from "@gaia/schema";
import { engineJev } from "./jev.ts";

describe("Jev through the engine", () => {
  it("sends requests asked together as one batch and answers each in order", async () => {
    const calls: { method: string; params: unknown }[] = [];
    const engine = {
      call: async (method: string, params: { requests: JevRequest[] }) => {
        calls.push({ method, params });
        return { responses: params.requests.map((r) => ({ answers: {}, model: String(r.state), costUsd: 0, ms: 1 })) };
      },
      on: () => () => {},
    } as unknown as EngineClient;
    const jev = engineJev(engine);
    const ask = (state: string) => jev.ask({ model: "typesafe/jev-1.13", state, questions: {} });
    const answers = await Promise.all([ask("a"), ask("b"), ask("c")]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("jev.batch");
    expect(answers.map((a) => a.model)).toEqual(["a", "b", "c"]);
  });
});
