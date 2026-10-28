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
/** Link pass requests, whose state has neither `file-axes` nor `folder-axes`. */
const ofLinks = (sent: Sent): Sent => sent.filter((r) => r.state["file-axes"] === undefined && r.state["folder-axes"] === undefined);
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

  it("asks again only about the file an edit changed, and a renamed file keeps its answers", async () => {
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
  }, 60_000);

  it("asks a file over Jev's window in pieces at its definitions, and judges the whole file from them", async () => {
    const big = Array.from({ length: 120 }, (_, i) => fn(`f${i}`, `return x * ${i} + ${"1 + ".repeat(350)}0;`)).join("\n");
    const root = codebase("big", { "src/big.ts": big });
    const engine = engineAt(join(scratch, "big-data"));
    const sent = aboutFiles(await understand(engine, root));
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every((r) => r.state.chunk !== undefined)).toBe(true);
    const graph: CodeGraph = await engine.call("project.graph", { root, judged: true });
    const file = graph.nodes.find((n) => n.id === "file:src/big.ts");
    expect(file?.judged?.value?.quality).toBeTypeOf("number");
  }, 120_000);

  it("cuts a file with more link questions than fit into pieces with their own source, asking each question once", async () => {
    // Two other files define `helper`, so Jev must choose the target of every call to it.
    const many = Array.from({ length: 300 }, (_, i) => `export const g${i} = (x: number): number => helper(x) + ${i};`).join("\n");
    const root = codebase("many", { "src/many.ts": many, "src/one.ts": fn("helper", "return x;"), "src/two.ts": fn("helper", "return -x;") });
    const requests = ofLinks(await understand(engineAt(join(scratch, "many-data")), root)).filter((r) => r.state.path === "src/many.ts");
    expect(requests.length).toBeGreaterThan(1);
    const asked = calleeQuestions(requests).map(([id]) => id);
    expect(asked.length).toBe(300);
    expect(new Set(asked).size).toBe(300);
    // The source goes out once, in pieces, rather than again with every batch of questions.
    const sourceSent = requests.reduce((n, r) => n + String(r.state.source).length, 0);
    expect(sourceSent).toBeLessThan(many.length * 1.05);
  }, 120_000);

  it("asks again about a reference whose candidates changed, and about nothing else of it", async () => {
    const root = codebase("relink", { "src/a.ts": fn("a", "return helper(x);"), "src/one.ts": fn("helper", "return x;"), "src/two.ts": fn("helper", "return -x;") });
    const data = join(scratch, "relink-data");
    expect(calleeQuestions(await understand(engineAt(data), root)).length).toBe(1);
    expect(calleeQuestions(await understand(engineAt(data), root)).length).toBe(0);
    writeFileSync(join(root, "src/three.ts"), fn("helper", "return 2 * x;"));
    const asked = calleeQuestions(await understand(engineAt(data), root));
    expect(asked.length).toBe(1);
    expect(Object.keys(asked[0]?.[1].criteria as Record<string, string>)).toContain("def:src/three.ts#helper");
  }, 60_000);

  it("counts the understanding pass in a plan before Jev's links are in, and sends it only after them", async () => {
    const root = codebase("waits", { "src/a.ts": fn("a", "return helper(x);"), "src/one.ts": fn("helper", "return x;"), "src/two.ts": fn("helper", "return -x;") });
    const engine = engineAt(join(scratch, "waits-data"));
    const plan = await engine.call("understanding.plan", { root });
    const of = (pass: string): number => plan.pending.find((p) => p.pass === pass)?.requests ?? 0;
    expect([of("link"), of("folders"), of("files")]).toEqual([1, 2, 3]);
    const before = standIn.received.length;
    await engine.call("understanding.next", { root });
    const first = standIn.received.slice(before).map((r) => Object.keys((r.body as Sent[number]).questions));
    expect(first).toHaveLength(1);
    expect(first[0]?.every((id) => id.startsWith("callee:"))).toBe(true);
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
    // Two stale held answers: one stored before link answers recorded their candidates, and one from an earlier
    // version of its call.
    for (const stale of [{ answer: value.answer, call: value.call }, { ...value, call: "callee@00000000-1" }]) {
      await engine.call("store.put", { project: projectId, writes: [{ table: "held", key, value: stale }] });
      expect(await jevCalls()).toBe(0);
      const before = standIn.received.length;
      await understand(engine, root);
      expect(standIn.received.length).toBe(before);
      expect(await jevCalls()).toBe(1);
    }
  }, 60_000);
});

describe("the understanding pass", () => {
  it("asks each folder in its parent's light and each file in its folder's, then gathers importance and quality", async () => {
    const root = codebase("axes", {
      "README.md": "# Tiny\n\nA tiny project that measures shapes.\n",
      "a/top.ts": fn("top", "return x;"),
      "a/b/mid.ts": fn("mid", "if (x > 1) { return x; }\n  for (const y of [x]) { x += y; }\n  return x;") + fn("other", "return x - 1;"),
    });
    const engine = engineAt(join(scratch, "axes-data"));
    const sent = await understand(engine, root);
    const folderAt = (path: string): number => sent.findIndex((r) => r.state["folder-axes"] !== undefined && r.state.path === path);
    const fileAt = (path: string): number => sent.findIndex((r) => r.state["file-axes"] !== undefined && r.state.path === path);
    // Requests go top-down: the root, then each folder, and each file only after its folder.
    expect(folderAt("(the repository's root)")).toBe(0);
    expect(folderAt("a")).toBeGreaterThan(folderAt("(the repository's root)"));
    expect(folderAt("a/b")).toBeGreaterThan(folderAt("a"));
    expect(fileAt("a/top.ts")).toBeGreaterThan(folderAt("a"));
    expect(fileAt("a/b/mid.ts")).toBeGreaterThan(folderAt("a/b"));
    // A file's request carries the project's own description and the judgments of the folders above it, as typed
    // values.
    const mid = sent[fileAt("a/b/mid.ts")] as (typeof sent)[number];
    const part = mid.state["file-axes"] as { project: string; above: { path: string; importance: number | null; cohesion: number | null }[]; importance: number | null };
    expect(part.project).toContain("measures shapes");
    expect(part.above.map((a) => a.path)).toEqual(["(the repository's root)", "a", "a/b"]);
    expect(part.above.slice(1).every((a) => typeof a.importance === "number")).toBe(true);
    expect(part.above.every((a) => typeof a.cohesion === "number")).toBe(true);
    expect(part.importance).toBeTypeOf("number");
    // The request asks Jev to pick among the file's definitions, and among the blocks of any definition with two or
    // more.
    expect(Object.keys(mid.questions)).toEqual(expect.arrayContaining(["pick-weak:mid", "importance:mid", "readability:mid", "robustness:mid", "own:cohesion"]));
    expect(Object.keys(mid.questions).filter((q) => q.endsWith(":file"))).toEqual([]);
    expect(Object.keys(mid.questions)).not.toContain("pick-key:other");
    // The engine aggregates the answers into each item's importance and quality, from 0 to 1, with the root's
    // importance at 1.
    const graph: CodeGraph = await engine.call("project.graph", { root, judged: true });
    const value = (id: string) => graph.nodes.find((n) => n.id === id)?.judged?.value;
    expect(value("dir:")?.importance).toBe(1);
    for (const id of ["dir:a", "file:a/b/mid.ts", "def:a/b/mid.ts#mid"]) {
      expect(value(id)?.importance, id).toBeGreaterThanOrEqual(0);
      expect(value(id)?.quality, id).toBeGreaterThanOrEqual(0);
      expect(value(id)?.quality, id).toBeLessThanOrEqual(1);
    }
    // Where Jev asked for more, the same questions went once more, with the readings Jev chose and no "more" question.
    const byFile = new Map<string, (typeof sent)[number][]>();
    for (const r of sent) if (r.state["file-axes"] !== undefined) byFile.set(r.state.path as string, [...(byFile.get(r.state.path as string) ?? []), r]);
    for (const [path, rs] of byFile) {
      expect(rs.length, path).toBeLessThanOrEqual(2);
      if (rs.length === 2) {
        expect((rs[1]?.state["file-axes"] as { readings?: object }).readings, path).toBeDefined();
        expect(Object.keys(rs[1]?.questions ?? {}).some((q) => q.startsWith("more:")), path).toBe(false);
      }
    }
    // Reopening asks nothing again.
    expect((await understand(engineAt(join(scratch, "axes-data")), root)).length).toBe(0);
  }, 60_000);

  it("cuts a big file so each piece holds as many definitions as fit, asking each once and the whole file only in the first", async () => {
    const big = Array.from({ length: 240 }, (_, i) => fn(`f${i}`, `return x + ${i};`)).join("\n");
    const root = codebase("axes-big", { "big.ts": big });
    const sent = (await understand(engineAt(join(scratch, "axes-big-data")), root)).filter((r) => {
      const part = r.state["file-axes"] as { readings?: object } | undefined;
      return part !== undefined && part.readings === undefined;
    });
    const asked = sent.map((r) => Object.keys(r.questions).filter((q) => q.startsWith("importance:")).length);
    expect(sent.length).toBeGreaterThan(1);
    expect(asked.reduce((a, b) => a + b, 0)).toBe(240);
    expect(asked.filter((n) => n > 0).every((n) => n >= 10)).toBe(true);
    expect(sent.filter((r) => Object.keys(r.questions).some((q) => q.startsWith("own:"))).length).toBe(1);
  }, 60_000);
});
