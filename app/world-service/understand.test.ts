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

type Sent = Awaited<ReturnType<typeof understand>>;
/** Requests about files, as opposed to directories, whose state holds the directory call's part. */
const aboutFiles = (sent: Sent): Sent => sent.filter((r) => r.state.directory === undefined);

describe("the Jev runner", () => {
  it("asks every call about one file in one request, and reopening sends nothing", async () => {
    const root = codebase("small", { "src/a.ts": fn("a", "return x + 1;"), "src/b.ts": fn("b", "return x * 2;") });
    const data = join(scratch, "small-data");
    const sent = aboutFiles(await understand(engineAt(data), root));
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
    const edited = aboutFiles(await understand(engineAt(data), root));
    expect(edited.map((r) => r.state.path)).toEqual(["src/a.ts"]);
    renameSync(join(root, "src/b.ts"), join(root, "src/renamed.ts"));
    const engine = engineAt(data);
    const renamed = aboutFiles(await understand(engine, root));
    expect(renamed.map((r) => r.state.path)).toEqual(["src/renamed.ts"]);
    const graph: CodeGraph = await engine.call("project.graph", { root, judged: true });
    const file = graph.nodes.find((n) => n.id === "file:src/renamed.ts");
    expect(file?.judged?.kind?.choice).toBeTypeOf("string");
  }, 60_000);

  it("asks a file over Jev's window in pieces at its definitions, and judges the whole file from them", async () => {
    const big = Array.from({ length: 1400 }, (_, i) => fn(`f${i}`, `return x * ${i} + ${"1 + ".repeat(20)}0;`)).join("\n");
    const root = codebase("big", { "src/big.ts": big });
    const engine = engineAt(join(scratch, "big-data"));
    const sent = aboutFiles(await understand(engine, root));
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every((r) => r.state.chunk !== undefined)).toBe(true);
    const graph: CodeGraph = await engine.call("project.graph", { root, judged: true });
    const file = graph.nodes.find((n) => n.id === "file:src/big.ts");
    expect(file?.judged?.kind?.choice).toBeTypeOf("string");
  }, 120_000);

  it("cuts a file with more questions than fit into pieces with their own source, asking each question once", async () => {
    // Two files beside it define `helper`, so every call to it waits for Jev to choose.
    const many = Array.from({ length: 300 }, (_, i) => `export const g${i} = (x: number): number => helper(x) + ${i};`).join("\n");
    const root = codebase("many", { "src/many.ts": many, "src/one.ts": fn("helper", "return x;"), "src/two.ts": fn("helper", "return -x;") });
    const sent = aboutFiles(await understand(engineAt(join(scratch, "many-data")), root)).filter((r) => r.state.path === "src/many.ts");
    const asking = (prefix: string): Sent => sent.filter((r) => Object.keys(r.questions).some((id) => id.startsWith(prefix)));
    for (const prefix of ["screen:def:", "callee:"]) {
      const requests = asking(prefix);
      expect(requests.length).toBeGreaterThan(1);
      const asked = requests.flatMap((r) => Object.keys(r.questions).filter((id) => id.startsWith(prefix)));
      expect(asked.length).toBe(300);
      expect(new Set(asked).size).toBe(300);
      // The source goes out once per pass, in pieces, rather than again with every batch of questions.
      const sourceSent = requests.reduce((n, r) => n + String(r.state.source).length, 0);
      expect(sourceSent).toBeLessThan(many.length * 1.05);
    }
    // A question about the whole file goes in the first piece only.
    const kinds = sent.filter((r) => "profile:kind" in r.questions);
    expect(kinds.length).toBe(1);
    expect((kinds[0]?.state.chunk as { lines: number[] } | undefined)?.lines[0]).toBe(1);
  }, 120_000);

  it("asks again about a reference whose candidates changed, and about nothing else of it", async () => {
    const root = codebase("relink", { "src/a.ts": fn("a", "return helper(x);"), "src/one.ts": fn("helper", "return x;"), "src/two.ts": fn("helper", "return -x;") });
    const data = join(scratch, "relink-data");
    const calleeQuestions = (sent: Sent) => sent.flatMap((r) => Object.entries(r.questions).filter(([id]) => id.startsWith("callee:")));
    expect(calleeQuestions(await understand(engineAt(data), root)).length).toBe(1);
    expect(calleeQuestions(await understand(engineAt(data), root)).length).toBe(0);
    writeFileSync(join(root, "src/three.ts"), fn("helper", "return 2 * x;"));
    const asked = calleeQuestions(await understand(engineAt(data), root));
    expect(asked.length).toBe(1);
    expect(Object.keys((asked[0]?.[1] as { criteria: Record<string, string> }).criteria)).toContain("def:src/three.ts#helper");
  }, 60_000);

  it("holds an answered link again without asking, when its held answer is out of date", async () => {
    const root = codebase("reheld", { "src/a.ts": fn("a", "return helper(x);"), "src/one.ts": fn("helper", "return x;"), "src/two.ts": fn("helper", "return -x;") });
    const engine = engineAt(join(scratch, "reheld-data"));
    await understand(engine, root);
    const jevCalls = async (): Promise<number> => {
      const graph: CodeGraph = await engine.call("project.graph", { root, judged: true });
      return graph.edges.filter((e) => e.kind === "calls" && e.by.by === "jev").length;
    };
    expect(await jevCalls()).toBe(1);
    const { projectId } = await engine.call("project.graph", { root });
    const { records } = await engine.call("store.read", { project: projectId, table: "held" });
    const [key, value] = Object.entries(records).find(([k]) => k.startsWith("link|")) as [string, { answer: unknown; call: string; candidates: string[] }];
    // A held answer from before link answers kept their candidates, and one from an earlier version of its call.
    for (const stale of [{ answer: value.answer, call: value.call }, { ...value, call: "callee@00000000-1" }]) {
      await engine.call("store.put", { project: projectId, writes: [{ table: "held", key, value: stale }] });
      expect(await jevCalls()).toBe(0);
      const before = standIn.received.length;
      for (;;) if ((await engine.call("understand.next", { root })).left === 0) break;
      expect(standIn.received.length).toBe(before);
      expect(await jevCalls()).toBe(1);
    }
  }, 60_000);

  it("asks about a directory only once everything under it is answered, the root last", async () => {
    const root = codebase("nested", { "a/b/c/deep.ts": fn("deep", "return x;"), "a/b/mid.ts": fn("mid", "return x;"), "a/top.ts": fn("top", "return x;") });
    const sent = await understand(engineAt(join(scratch, "nested-data")), root);
    const at = (pred: (r: Sent[number]) => boolean): number => sent.findIndex(pred);
    const dirAt = (path: string): number => at((r) => r.state.directory !== undefined && r.state.path === path);
    const fileAt = (path: string): number => at((r) => r.state.directory === undefined && r.state.path === path);
    expect(dirAt("a/b/c")).toBeGreaterThan(fileAt("a/b/c/deep.ts"));
    expect(dirAt("a/b")).toBeGreaterThan(dirAt("a/b/c"));
    expect(dirAt("a/b")).toBeGreaterThan(fileAt("a/b/mid.ts"));
    expect(dirAt("a")).toBeGreaterThan(dirAt("a/b"));
    expect(sent.at(-1)?.state.path).toBe("(the repository's root)");
  }, 60_000);

  it("asks the deep questions about exactly the nodes the world chose", async () => {
    const root = codebase("deepen", { "src/a.ts": fn("chosen", "return x + 1;") + fn("other", "return x - 1;") });
    const engine = engineAt(join(scratch, "deepen-data"));
    await understand(engine, root);
    const before = standIn.received.length;
    await engine.call("understand.deepen", { root, nodes: ["def:src/a.ts#chosen"] });
    for (;;) if ((await engine.call("understand.next", { root })).left === 0) break;
    const deepIds = standIn.received.slice(before).flatMap((r) => Object.keys((r.body as { questions: Record<string, unknown> }).questions)).filter((id) => id.startsWith("definition:"));
    expect(deepIds.length).toBeGreaterThan(0);
    expect(deepIds.every((id) => id.startsWith("definition:chosen:"))).toBe(true);
    const graph: CodeGraph = await engine.call("project.graph", { root, judged: true });
    const chosen = graph.nodes.find((n) => n.id === "def:src/a.ts#chosen");
    expect(chosen?.judged?.role?.choice).toBeTypeOf("string");
    expect(chosen?.judged?.quality?.readability).toBeDefined();
  }, 60_000);
});
