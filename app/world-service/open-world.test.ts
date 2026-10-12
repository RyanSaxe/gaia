import { describe, expect, it } from "vitest";
import type { CodeModel, EngineClient, JevRequest } from "@gaia/schema";
import { landOf, standInJev } from "@gaia/world";
import { LOOKS } from "../renderer/terrain/looks.ts";
import proving from "../renderer/terrain/fixtures/proving.json";
import { openWorld } from "./open-world.ts";
import type { Opening } from "./protocol.ts";

const model = proving as unknown as CodeModel;

/** An engine with Jev live and nothing kept, whose every batch of answers waits until `release` lets it go. */
function heldEngine(): { engine: EngineClient; held: (() => void)[] } {
  const standIn = standInJev(LOOKS);
  const held: (() => void)[] = [];
  const results: Record<string, (params: { requests: JevRequest[] }) => unknown> = {
    "project.open": () => model,
    "store.read": () => ({ records: {} }),
    "store.get": () => null,
    "store.put": () => ({ ok: true }),
    "jev.status": () => ({ live: true, key: true }),
    "jev.estimate": ({ requests }) => ({ endpoint: "held", requests: requests.length, questions: 0, bytes: 0, estimatedTokens: 0, estimatedUsd: 0, usdPerMillionInputTokens: 0, concurrency: 8, live: true }),
    // Nothing to understand: the proving ground has no graph here, so its symbols stand as the code model has them.
    "understanding.plan": () => ({
      pending: [],
      estimate: { endpoint: "held", requests: 0, questions: 0, bytes: 0, estimatedTokens: 0, estimatedUsd: 0, usdPerMillionInputTokens: 0, concurrency: 8, live: true },
      graph: { projectId: "proving", name: "proving", nodes: [], edges: [], pending: [] },
    }),
  };
  const engine = {
    call: async (method: string, params: { requests: JevRequest[] }) => {
      if (method !== "jev.batch") return results[method]?.(params);
      await new Promise<void>((resolve) => held.push(resolve));
      return { responses: await Promise.all(params.requests.map((r) => standIn.ask(r))) };
    },
    on: () => () => {},
  } as unknown as EngineClient;
  return { engine, held };
}

/** Every file named by the `health` messages shown, with its vitality, in order. */
const named = (shown: readonly Opening[]): [string, number][] => shown.flatMap((o) => (o.stage === "health" ? Object.entries(o.vitality) : []));

describe("opening a world", () => {
  // The proving ground is laid out twice (its land, then the finished world): about a second on a busy machine.
  it("names each file's health once, as the finished world has it, only once its judging is done", { timeout: 20_000 }, async () => {
    const shown: Opening[] = [];
    const { engine, held } = heldEngine();
    let done = false;
    const opened = openWorld({ engine, root: "proving", consent: async () => true, progress: (o) => shown.push(o) }).finally(() => (done = true));
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    while (held.length === 0) await tick();

    // Before any answer: the land, every file's patch as the finished world lays it out, and no health yet, since a
    // file's vitality is Jev's quality.
    const land = shown.find((o) => o.stage === "land");
    expect(land?.stage === "land" && land.patches.map((p) => p.path)).toEqual(landOf(model).patches.map((p) => p.path));
    expect(named(shown)).toEqual([]);

    while (!done) {
      for (const release of held.splice(0)) release();
      await tick();
    }
    const document = await opened;
    // Every file is named once, with the vitality the finished world gives it, before the document.
    const all = named(shown);
    expect(all.map(([path]) => path).sort()).toEqual(document.world.patches.map((p) => p.path).sort());
    expect(Object.fromEntries(all)).toEqual(Object.fromEntries(document.world.patches.map((p) => [p.path, p.vitality])));
  });
});
