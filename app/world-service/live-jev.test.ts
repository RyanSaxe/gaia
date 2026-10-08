// End to end: the real engine binary judges a small codebase through a local
// stand-in for OpenRouter's Decisions API. Nothing here reaches OpenRouter:
// the engine refuses any endpoint override that is not a loopback address,
// and sends a local endpoint a placeholder key, never the Keychain's.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type StandIn, startOpenRouterStandIn } from "../../tools/openrouter-stand-in.ts";
import { outlinesOf } from "@gaia/terrain";
import { areaLands } from "@gaia/world";
import { createEngineClient } from "./engine-client.ts";
import { openWorld, setSpendLimit } from "./open-world.ts";
import type { ConsentPlan, Opening } from "./protocol.ts";

const REPO = resolve(import.meta.dirname, "../..");
const ENGINE = join(REPO, "target", "debug", "gaia-engine");
/** A line of source that must never reach Jev: only facts and doc comments do. */
const SOURCE_ONLY = "const secretSourceLine = 42;";

let scratch = "";
let standIn: StandIn;
const engines: ChildProcess[] = [];

beforeAll(async () => {
  execFileSync("cargo", ["build", "-p", "gaia-engine", "--quiet"], { cwd: REPO, env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` }, stdio: "inherit" });
  scratch = mkdtempSync(join(tmpdir(), "gaia-live-jev-"));
  // The stand-in refuses one request, as OpenRouter might.
  standIn = await startOpenRouterStandIn({ refuse: ({ state }) => (state as { file?: { path?: string } }).file?.path === "README.md" });
}, 300_000);

afterAll(async () => {
  for (const e of engines) e.kill();
  await standIn?.close();
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
});

/** A tiny codebase: a package with two source files, a test and a readme. */
function codebase(name: string): string {
  const root = join(scratch, name);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name, version: "1.0.0", exports: { ".": "./src/index.ts" } }));
  writeFileSync(join(root, "README.md"), "# Tiny\n\nA tiny codebase for the test.\n");
  writeFileSync(join(root, "src/index.ts"), `/** The entry. */\nexport { shape } from "./shape.ts";\n`);
  writeFileSync(join(root, "src/shape.ts"), `/** Shapes and their areas. */\n\n/** The area of a square. */\nexport function shape(side: number): number {\n  ${SOURCE_ONLY}\n  return side * side + secretSourceLine * 0;\n}\n`);
  writeFileSync(join(root, "src/shape.test.ts"), `import { shape } from "./shape.ts";\nif (shape(2) !== 4) throw new Error("bad");\n`);
  return root;
}

/** Starts the engine binary, live, against the stand-in, keeping its store in `data`. */
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

/** Opens a world on a fresh engine process, recording what the person was asked and shown. */
async function open(root: string, data: string, approve: boolean) {
  const asked: ConsentPlan[] = [];
  const shown: Opening[] = [];
  const before = standIn.received.length;
  const document = await openWorld({
    engine: engineAt(data),
    root,
    consent: async (plan) => (asked.push(plan), approve),
    progress: (o) => shown.push(o),
  });
  const sent = standIn.received.slice(before);
  const about = sent.map(({ body }) => {
    const s = body.state as Record<string, { path?: string; name?: string }>;
    return s.file ? `file:${s.file.path}` : s.entity ? `entity:${s.entity.path}` : s.directory ? `area:${s.directory.path}` : "world";
  });
  return { document, asked, shown, sent, about };
}

describe("judging a codebase with Jev", () => {
  it("sends only facts, keeps Jev's answers, asks again only what changed, and leaves a failure to the stand-in", async () => {
    const root = codebase("tiny");
    const data = join(scratch, "data-live");

    const first = await open(root, data, false);
    // Judging costs less than the default limit, so Gaia asks Jev with no question at all.
    expect(first.asked).toHaveLength(0);
    expect(first.sent.length).toBeGreaterThan(0);
    // The land's outlines come before any judging, exactly as the finished world's map draws them.
    const land = first.shown.findIndex((o) => o.stage === "land");
    expect(land).toBeGreaterThan(first.shown.findIndex((o) => o.stage === "reading"));
    expect(land).toBeLessThan(first.shown.findIndex((o) => o.stage === "asking"));
    expect(first.shown[land]).toEqual({ stage: "land", name: "tiny", size: first.document.world.size, areas: outlinesOf(first.document.world).areas });
    // Each area is named once everything on its land is judged, with the land judged for its ground, and stays named
    // with that land; by the end, every area, each with the finished world's land.
    let named: Readonly<Record<string, string>> = {};
    for (const o of first.shown) {
      if (o.stage !== "asking") continue;
      expect(o.settled).toMatchObject(named);
      named = o.settled;
    }
    expect(Object.keys(named).sort()).toEqual(first.document.world.areas.map((a) => a.path).sort());
    expect(named).toEqual(areaLands(first.document.world));
    // Every request went out once, with the placeholder key and nothing but the model, facts and questions.
    for (const { authorization, body } of first.sent) {
      expect(authorization).toBe("Bearer local-stand-in");
      expect(Object.keys(body).sort()).toEqual(["model", "questions", "state"]);
      expect(JSON.stringify(body)).not.toContain("secretSourceLine");
    }
    expect(new Set(first.about).size).toBe(first.sent.length);
    expect(first.about).toEqual(expect.arrayContaining(["world", "file:src/shape.ts", "file:README.md"]));
    // Jev judged everything but the request it refused, which the stand-in judged.
    expect(first.document.judges["file:README.md"]).toBe("stand-in");
    expect(Object.entries(first.document.judges).filter(([, j]) => j === "stand-in").map(([t]) => t)).toEqual(["file:README.md"]);
    expect(first.document.summary).toContain("1 request failed");
    const asking = first.shown.filter((o) => o.stage === "asking");
    expect(asking.at(-1)).toMatchObject({ total: first.sent.length, answered: first.sent.length, failed: 1, asking: [] });
    // While a question is out, its area is named as being worked on, for the wait to show.
    expect(asking.some((o) => o.asking.length > 0)).toBe(true);

    // Reopening on a new engine asks nothing it has answered, and never asks the person again.
    const second = await open(root, data, true);
    expect(second.asked).toHaveLength(0);
    expect(second.about).toEqual(["file:README.md"]);
    expect(second.document.world).toEqual(first.document.world);

    // A file that changed is asked about again, with what its facts touch; untouched files are not.
    appendFileSync(join(root, "src/shape.ts"), `\n/** The area of a circle. */\nexport const circle = (r: number): number => Math.PI * r * r;\n`);
    const third = await open(root, data, true);
    expect(third.about).toEqual(expect.arrayContaining(["file:src/shape.ts", "file:README.md"]));
    expect(third.about).not.toContain("file:src/index.ts");
    expect(third.about).not.toContain("file:package.json");
  }, 60_000);

  it("asks before spending past the limit, sends nothing when the person keeps the stand-in, and remembers that until the limit changes", async () => {
    const root = codebase("declined");
    const data = join(scratch, "data-declined");
    await setSpendLimit(engineAt(data), 0);
    const first = await open(root, data, false);
    // Past the limit the person is asked once, shown exactly what would go out and what they allow.
    expect(first.asked).toHaveLength(1);
    expect(first.asked[0]).toMatchObject({ name: "declined", limitUsd: 0, endpoint: standIn.endpoint });
    expect(first.asked[0]?.estimatedUsd).toBeGreaterThan(0);
    expect(first.asked[0]?.estimatedTokens).toBeGreaterThan(0);
    expect(first.sent).toHaveLength(0);
    expect(new Set(Object.values(first.document.judges))).toEqual(new Set(["stand-in"]));
    expect(first.document.summary).toContain("you chose the stand-in");
    // The choice holds for the project while the limit stands.
    const second = await open(root, data, true);
    expect(second.asked).toHaveLength(0);
    expect(second.sent).toHaveLength(0);
    // A new limit, still under the cost, asks again; going ahead sends every request.
    await setSpendLimit(engineAt(data), 1e-9);
    const third = await open(root, data, true);
    expect(third.asked).toHaveLength(1);
    expect(third.sent).toHaveLength(third.asked[0]?.requests ?? -1);
  }, 60_000);
});
