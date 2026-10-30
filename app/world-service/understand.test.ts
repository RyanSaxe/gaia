// Tests the engine's Jev runner end to end. The real engine binary plans and
// sends the link pass and the understanding pass for small codebases to a
// local stand-in for OpenRouter's Decisions API. Nothing reaches OpenRouter,
// because the engine refuses any endpoint override that is not a loopback
// address.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CodeGraph, UnderstandPlan } from "@gaia/schema";
import { type StandIn, startOpenRouterStandIn } from "../../tools/openrouter-stand-in.ts";
import { cargoEnv } from "../../tools/cargo-env.ts";
import { createEngineClient } from "./engine-client.ts";

const REPO = resolve(import.meta.dirname, "../..");
const ENGINE = join(REPO, "target", "debug", process.platform === "win32" ? "gaia-engine.exe" : "gaia-engine");

let scratch = "";
let standIn: StandIn;
const engines: ChildProcess[] = [];

// A clean engine build takes minutes on CI's machines, and another test file's build may hold cargo's lock meanwhile.
beforeAll(async () => {
  execFileSync("cargo", ["build", "-p", "gaia-engine", "--quiet"], { cwd: REPO, env: cargoEnv(), stdio: "inherit" });
  scratch = mkdtempSync(join(tmpdir(), "gaia-understand-"));
  standIn = await startOpenRouterStandIn();
}, 900_000);

afterAll(async () => {
  for (const e of engines) e.kill();
  await standIn?.close();
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
});

/** Starts a new engine process, live against the stand-in, with its store in `data`. */
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

type Sent = { state: Record<string, unknown>; questions: Record<string, { criteria: unknown }> }[];

/** Runs `understanding.next` until nothing is left, and returns the requests the stand-in received meanwhile. */
async function understand(engine: ReturnType<typeof engineAt>, root: string): Promise<Sent> {
  const before = standIn.received.length;
  for (;;) {
    const p = await engine.call("understanding.next", { root });
    if (p.left === 0 || (p.sent === 0 && p.settled.length === 0)) break;
  }
  return standIn.received.slice(before).map((r) => r.body as Sent[number]);
}

const fn = (name: string, body: string): string => `export function ${name}(x: number): number {\n  ${body}\n}\n`;

/** Understanding requests about files, whose state has `file-axes`. */
const aboutFiles = (sent: Sent): Sent => sent.filter((r) => r.state["file-axes"] !== undefined);
const calleeQuestions = (sent: Sent) => sent.flatMap((r) => Object.entries(r.questions).filter(([id]) => id.startsWith("callee:")));

describe("the Jev runner", () => {
  it("keeps every answer, so reopening plans and sends nothing", async () => {
    const root = codebase("small", { "src/a.ts": fn("a", "return x + 1;"), "src/b.ts": fn("b", "return x * 2;") });
    const data = join(scratch, "small-data");
    expect(aboutFiles(await understand(engineAt(data), root)).length).toBeGreaterThanOrEqual(2);
    const again = engineAt(data);
    expect(pending(await again.call("understanding.plan", { root }))).toBe(0);
    const before = standIn.received.length;
    expect((await again.call("understanding.next", { root })).sent).toBe(0);
    expect(standIn.received.length).toBe(before);
  }, 60_000);

  it("asks again only about the file an edit changed and a link whose candidates changed, and a renamed file keeps its answers", async () => {
    const root = codebase("edits", { "src/a.ts": fn("a", "return x + 1;"), "src/b.ts": fn("b", "return x * 2;"), "src/c.ts": fn("c", "return x - 3;") });
    const data = join(scratch, "edits-data");
    await understand(engineAt(data), root);
    writeFileSync(join(root, "src/a.ts"), fn("a", "return x + 10;"));
    const edited = await understand(engineAt(data), root);
    expect([...new Set(edited.map((r) => r.state.path))]).toEqual(["src/a.ts"]);
    renameSync(join(root, "src/b.ts"), join(root, "src/renamed.ts"));
    // Before any new request, the renamed file already has the stored answers for its lineage.
    const graph: CodeGraph = await engineAt(data).call("project.graph", { root, judged: true });
    const file = graph.nodes.find((n) => n.id === "file:src/renamed.ts");
    expect(file?.judged?.value?.quality).toBeTypeOf("number");
    // A link is asked again only when its candidates changed.
    const linked = codebase("relink", { "src/a.ts": fn("a", "return helper(x);"), "src/one.ts": fn("helper", "return x;"), "src/two.ts": fn("helper", "return -x;") });
    const linkData = join(scratch, "relink-data");
    expect(calleeQuestions(await understand(engineAt(linkData), linked)).length).toBe(1);
    expect(calleeQuestions(await understand(engineAt(linkData), linked)).length).toBe(0);
    writeFileSync(join(linked, "src/three.ts"), fn("helper", "return 2 * x;"));
    const asked = calleeQuestions(await understand(engineAt(linkData), linked));
    expect(asked.length).toBe(1);
    expect(Object.keys(asked[0]?.[1].criteria as Record<string, string>)).toContain("def:src/three.ts#helper");
  }, 60_000);

  it("asks a file over Jev's window in pieces at its definitions, and judges the whole file from them", async () => {
    const big = Array.from({ length: 120 }, (_, i) => fn(`f${i}`, `return x * ${i} + ${"1 + ".repeat(350)}0;`)).join("\n");
    const root = codebase("big", { "src/big.ts": big });
    const engine = engineAt(join(scratch, "big-data"));
    const sent = aboutFiles(await understand(engine, root));
    expect(sent.length).toBeGreaterThan(1);
    const graph: CodeGraph = await engine.call("project.graph", { root, judged: true });
    const file = graph.nodes.find((n) => n.id === "file:src/big.ts");
    expect(file?.judged?.value?.quality).toBeTypeOf("number");
  }, 120_000);
});
