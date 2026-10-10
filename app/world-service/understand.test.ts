// The engine's Jev runner, end to end: the real engine binary plans and asks
// its calls about small codebases through a local stand-in for OpenRouter's
// Decisions API. Nothing here reaches OpenRouter: the engine refuses any
// endpoint override that is not a loopback address.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CodeGraph, UnderstandPlan } from "@gaia/schema";
import { type StandIn, startOpenRouterStandIn } from "../../tools/openrouter-stand-in.ts";
import { createEngineClient } from "./engine-client.ts";

const REPO = resolve(import.meta.dirname, "../..");
const ENGINE = join(REPO, "target", "debug", "gaia-engine");

let scratch = "";
let standIn: StandIn;
const engines: ChildProcess[] = [];

beforeAll(async () => {
  execFileSync("cargo", ["build", "-p", "gaia-engine", "--quiet"], { cwd: REPO, env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` }, stdio: "inherit" });
  scratch = mkdtempSync(join(tmpdir(), "gaia-understand-"));
  standIn = await startOpenRouterStandIn();
}, 300_000);

afterAll(async () => {
  for (const e of engines) e.kill();
  await standIn?.close();
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
});

/** A fresh engine process, live against the stand-in, keeping its store in `data`. */
function engineAt(data: string) {
  const child = spawn(ENGINE, ["rpc"], {
    env: { ...process.env, GAIA_JEV: "live", GAIA_JEV_ENDPOINT: standIn.endpoint, GAIA_DATA_DIR: data },
    stdio: ["pipe", "pipe", "inherit"],
  });
  engines.push(child);
  const client = createEngineClient((line) => child.stdin?.write(`${line}\n`));
  if (child.stdout !== null) createInterface({ input: child.stdout }).on("line", (line) => client.receive(line));
  return client;
}

function codebase(name: string, files: Record<string, string>): string {
  const root = join(scratch, name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const pending = (plan: UnderstandPlan): number => plan.pending.reduce((n, p) => n + p.requests, 0);

/** Plans and sends until nothing is left; returns the requests the stand-in received meanwhile. */
async function understand(engine: ReturnType<typeof engineAt>, root: string) {
  const before = standIn.received.length;
  await engine.call("understand.plan", { root });
  for (;;) {
    const p = await engine.call("understand.next", { root });
    if (p.left === 0) break;
  }
  return standIn.received.slice(before).map((r) => r.body as { state: Record<string, unknown>; questions: Record<string, unknown> });
}

const fn = (name: string, body: string): string => `export function ${name}(x: number): number {\n  ${body}\n}\n`;

describe("the Jev runner", () => {
  it("asks every call about one file in one request, and reopening sends nothing", async () => {
    const root = codebase("small", { "src/a.ts": fn("a", "return x + 1;"), "src/b.ts": fn("b", "return x * 2;") });
    const data = join(scratch, "small-data");
    const sent = await understand(engineAt(data), root);
    expect(sent.map((r) => r.state.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
    for (const r of sent) {
      const ids = Object.keys(r.questions);
      expect(ids.some((id) => id.startsWith("profile:"))).toBe(true);
      expect(ids.some((id) => id.startsWith("screen:"))).toBe(true);
    }
    const again = engineAt(data);
    const plan = await again.call("understand.plan", { root });
    expect(pending(plan)).toBe(0);
    const before = standIn.received.length;
    expect((await again.call("understand.next", { root })).sent).toBe(0);
    expect(standIn.received.length).toBe(before);
  }, 60_000);

  it("asks again only the requests whose state an edit changed, and a renamed file keeps its answers", async () => {
    const root = codebase("edits", { "src/a.ts": fn("a", "return x + 1;"), "src/b.ts": fn("b", "return x * 2;"), "src/c.ts": fn("c", "return x - 3;") });
    const data = join(scratch, "edits-data");
    await understand(engineAt(data), root);
    writeFileSync(join(root, "src/a.ts"), fn("a", "return x + 10;"));
    const edited = await understand(engineAt(data), root);
    expect(edited.map((r) => r.state.path)).toEqual(["src/a.ts"]);
    renameSync(join(root, "src/b.ts"), join(root, "src/renamed.ts"));
    const engine = engineAt(data);
    const renamed = await understand(engine, root);
    expect(renamed.map((r) => r.state.path)).toEqual(["src/renamed.ts"]);
    const graph: CodeGraph = await engine.call("project.graph", { root, judged: true });
    const file = graph.nodes.find((n) => n.id === "file:src/renamed.ts");
    expect(file?.judged?.kind?.choice).toBeTypeOf("string");
  }, 60_000);

  it("asks a file over Jev's window in pieces at its definitions, and combines their answers", async () => {
    const big = Array.from({ length: 1400 }, (_, i) => fn(`f${i}`, `return x * ${i} + ${"1 + ".repeat(20)}0;`)).join("\n");
    const root = codebase("big", { "src/big.ts": big });
    const engine = engineAt(join(scratch, "big-data"));
    const sent = await understand(engine, root);
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every((r) => r.state.chunk !== undefined)).toBe(true);
    const graph: CodeGraph = await engine.call("project.graph", { root, judged: true });
    const file = graph.nodes.find((n) => n.id === "file:src/big.ts");
    expect(file?.judged?.kind?.choice).toBeTypeOf("string");
  }, 120_000);

  it("cuts a file with more questions than fit into pieces with their own source, asking each question once", async () => {
    const many = Array.from({ length: 300 }, (_, i) => `export const g${i} = (x: number): number => x + ${i};`).join("\n");
    const root = codebase("many", { "src/many.ts": many });
    const sent = await understand(engineAt(join(scratch, "many-data")), root);
    expect(sent.length).toBeGreaterThan(1);
    const asked = sent.flatMap((r) => Object.keys(r.questions).filter((id) => id.startsWith("screen:def:")));
    expect(asked.length).toBe(300);
    expect(new Set(asked).size).toBe(300);
    // The source goes out once, in pieces, rather than again with every batch of questions.
    const sourceSent = sent.reduce((n, r) => n + String(r.state.source).length, 0);
    expect(sourceSent).toBeLessThan(many.length * 1.05);
  }, 120_000);
});
