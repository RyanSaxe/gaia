import { describe, expect, it } from "vitest";
import type { EngineEvent } from "@gaia/schema";
import { createEngineClient } from "./engine-client.ts";

describe("the engine client", () => {
  it("matches responses to calls by id, in any order, and passes events on", async () => {
    const sent: { id: number; method: string; params: unknown }[] = [];
    const client = createEngineClient((line) => sent.push(JSON.parse(line) as (typeof sent)[number]));
    const events: EngineEvent[] = [];
    client.on((e) => events.push(e));

    const ping = client.call("engine.ping", {});
    const open = client.call("project.open", { root: "/repo" });
    const [first, second] = sent;
    expect(first).toMatchObject({ jsonrpc: "2.0", method: "engine.ping", params: {} });
    expect(second).toMatchObject({ method: "project.open", params: { root: "/repo" } });

    client.receive(JSON.stringify({ jsonrpc: "2.0", id: second?.id, error: { code: -32601, message: "Unknown method project.open" } }));
    client.receive(JSON.stringify({ event: "engine.error", message: "disk full" }));
    client.receive(JSON.stringify({ jsonrpc: "2.0", id: first?.id, result: { version: "0.1.0" } }));

    await expect(ping).resolves.toEqual({ version: "0.1.0" });
    await expect(open).rejects.toThrow("Unknown method project.open");
    expect(events).toEqual([{ event: "engine.error", message: "disk full" }]);
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
