import { describe, expect, it } from "vitest";
import { createEngineClient } from "./engine-client.ts";

describe("the engine client", () => {
  it("matches responses to calls by id, in any order", async () => {
    const sent: { id: number; method: string; params: unknown }[] = [];
    const client = createEngineClient((line) => sent.push(JSON.parse(line) as (typeof sent)[number]));

    const ping = client.call("engine.ping", {});
    const open = client.call("project.graph", { root: "/repo" });
    const [first, second] = sent;
    expect(first).toMatchObject({ jsonrpc: "2.0", method: "engine.ping", params: {} });
    expect(second).toMatchObject({ method: "project.graph", params: { root: "/repo" } });

    client.receive(JSON.stringify({ jsonrpc: "2.0", id: second?.id, error: { code: -32601, message: "Unknown method project.graph" } }));
    client.receive(JSON.stringify({ jsonrpc: "2.0", id: first?.id, result: { version: "0.1.0" } }));

    await expect(ping).resolves.toEqual({ version: "0.1.0" });
    await expect(open).rejects.toThrow("Unknown method project.graph");
  });

  it("fails calls in flight when the engine goes down, and ignores late answers", async () => {
    const sent: { id: number }[] = [];
    const client = createEngineClient((line) => sent.push(JSON.parse(line) as { id: number }));
    const ping = client.call("engine.ping", {});
    client.disconnect("The engine exited with code 1.");
    await expect(ping).rejects.toThrow("The engine exited with code 1.");
    expect(() => client.receive(JSON.stringify({ jsonrpc: "2.0", id: sent[0]?.id, result: { version: "0.1.0" } }))).not.toThrow();
  });
});
