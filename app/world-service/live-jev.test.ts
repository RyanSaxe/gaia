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
import { createEngineClient } from "./engine-client.ts";
import { openWorld, setSpendLimit } from "./open-world.ts";
import type { ConsentPlan, Opening } from "./protocol.ts";

const REPO = resolve(import.meta.dirname, "../..");
const ENGINE = join(REPO, "target", "debug", "gaia-engine");
/** A line of source that must never reach Jev: only facts and doc comments do. */
const SOURCE_ONLY = "const secretSourceLine = 42;";

let scratch = "";
let standIn: StandIn;
/** Whether the stand-in refuses the root area's request, as OpenRouter might refuse a bad one. */
let refuseRoot = false;
const engines: ChildProcess[] = [];

// A clean engine build takes minutes on CI's machines, and another test file's build may hold cargo's lock meanwhile.
beforeAll(async () => {
  execFileSync("cargo", ["build", "-p", "gaia-engine", "--quiet"], { cwd: REPO, env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` }, stdio: "inherit" });
  scratch = mkdtempSync(join(tmpdir(), "gaia-live-jev-"));
  standIn = await startOpenRouterStandIn({ refuse: ({ state, questions }) => refuseRoot && "water" in questions && (state as { directory?: { path?: string } }).directory?.path === "(the repository's root)" });
}, 900_000);

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
    const s = body.state as Record<string, { path?: string; name?: string } | string>;
    // Understanding's requests name their file or directory by its path at the top of the state.
    if (typeof s.path === "string") return `understand:${s.path}`;
    const { file, entity, directory, repository, trail } = s as Record<string, { path?: string; name?: string } | undefined>;
    // Composing the sky, a land, a building, a landmark or a trail asks its parts, then each stage's details: one
    // request a wave, each its own.
    const ids = Object.keys(body.questions as object);
    if (s.decided !== undefined || ids.some((id) => /^[a-z]+\.(use|present)$/.test(id))) {
      const of = repository !== undefined ? "world" : trail !== undefined ? "trail" : (entity ?? directory)?.path;
      return `compose:${of}:${ids.sort().join(",")}`;
    }
    return file ? `file:${file.path}` : entity ? `entity:${entity.path}` : directory ? `area:${directory.path}` : "repository";
  });
  return { document, asked, shown, sent, about };
}

describe("judging a codebase with Jev", () => {
  it("sends only facts, keeps Jev's answers, asks again only what changed, and judges everything with Jev", async () => {
    const root = codebase("tiny");
    const data = join(scratch, "data-live");

    const first = await open(root, data, false);
    // Judging costs less than the default limit, so Gaia asks Jev with no question at all.
    expect(first.asked).toHaveLength(0);
    expect(first.sent.length).toBeGreaterThan(0);
    // The land's outlines, every file's patch and every lot come before any judging, exactly as the finished world has them.
    const land = first.shown.findIndex((o) => o.stage === "land");
    expect(land).toBeGreaterThan(first.shown.findIndex((o) => o.stage === "reading"));
    expect(land).toBeLessThan(first.shown.findIndex((o) => o.stage === "asking"));
    const patches = first.document.world.patches.map(({ path, name, area, x, z, radius }) => ({ path, name, area, x, z, radius }));
    const lots = first.document.world.things.map(({ x, z }) => ({ x, z }));
    expect(first.shown[land]).toEqual({ stage: "land", name: "tiny", size: first.document.world.size, aspect: first.document.world.aspect, areas: outlinesOf(first.document.world).areas, patches, lots });
    // Each file's health is named once, as the finished world has it, once the understanding pass has judged it.
    expect(first.shown.findIndex((o) => o.stage === "health")).toBeGreaterThan(first.shown.findIndex((o) => o.stage === "asking"));
    const health = first.shown.flatMap((o) => (o.stage === "health" ? Object.entries(o.vitality) : []));
    expect(health.map(([path]) => path).sort()).toEqual(patches.map((p) => p.path).sort());
    expect(Object.fromEntries(health)).toEqual(Object.fromEntries(first.document.world.patches.map((p) => [p.path, p.vitality])));
    // Each area is named once everything on its land is judged, and stays named; by the end, every area is.
    let named: readonly string[] = [];
    for (const o of first.shown) {
      if (o.stage !== "asking") continue;
      expect(o.settled).toEqual(expect.arrayContaining([...named]));
      named = o.settled;
    }
    expect([...named].sort()).toEqual(first.document.world.areas.map((a) => a.path).sort());
    // Every request went out once, with the placeholder key and nothing but the model, its state and questions. Judging
    // the looks reads facts only; understanding reads the source, as the reviewer allowed.
    for (const [i, { authorization, body }] of first.sent.entries()) {
      expect(authorization).toBe("Bearer local-stand-in");
      expect(Object.keys(body).sort()).toEqual(["model", "questions", "state"]);
      if (!first.about[i]?.startsWith("understand:")) expect(JSON.stringify(body)).not.toContain("secretSourceLine");
    }
    const judging = first.about.filter((a) => !a.startsWith("understand:"));
    expect(new Set(judging).size).toBe(judging.length);
    expect(first.about).toEqual(expect.arrayContaining(["area:(the repository's root)", "file:src/shape.ts", "understand:src/shape.ts"]));
    // A file with nothing standing on its patch is never asked about.
    expect(first.about).not.toContain("file:README.md");
    // The understanding pass asked every folder and file, and every definition stands by Jev's importance; the
    // document carries what it judged, every score from 0 to 1.
    const states = first.sent.map(({ body }) => body.state as Record<string, unknown>);
    expect(states.some((s) => s["folder-axes"] !== undefined)).toBe(true);
    expect(states.some((s) => s["file-axes"] !== undefined && s.path === "src/shape.ts")).toBe(true);
    expect(first.document.world.symbols.find((s) => s.name === "shape")?.importance).toEqual(expect.any(Number));
    const shape = first.document.judged["src/shape.ts#shape"];
    expect(shape?.quality).toBeGreaterThanOrEqual(0);
    expect(shape?.quality).toBeLessThanOrEqual(1);
    expect(Object.keys(shape?.concepts ?? {})).toContain("readability");
    // Jev judged everything.
    expect(new Set(Object.values(first.document.judges))).toEqual(new Set(["jev"]));
    expect(first.document.summary).not.toContain("stand-in");
    const asking = first.shown.filter((o) => o.stage === "asking");
    // Composing follows from the answers, so it is never planned or counted ahead; every building and landmark was composed.
    const composed = first.about.filter((a) => a.startsWith("compose:")).length;
    expect(composed).toBeGreaterThan(0);
    expect(asking.at(-1)).toMatchObject({ total: first.sent.length - composed, answered: first.sent.length - composed, asking: [] });
    // While a question is out, its area is named as being worked on, for the wait to show.
    expect(asking.some((o) => o.asking.length > 0)).toBe(true);

    // Reopening on a new engine asks nothing it has answered, and never asks the person again.
    const second = await open(root, data, true);
    expect(second.asked).toHaveLength(0);
    expect(second.about).toEqual([]);
    expect(second.document.world).toEqual(first.document.world);

    // A file that changed is asked about again, with what its facts touch; untouched files are not.
    appendFileSync(join(root, "src/shape.ts"), `\n/** The area of a circle. */\nexport const circle = (r: number): number => Math.PI * r * r;\n`);
    const third = await open(root, data, true);
    expect(third.about).toEqual(expect.arrayContaining(["file:src/shape.ts"]));
    expect(third.about).not.toContain("file:src/index.ts");
    expect(third.about).not.toContain("file:package.json");
  }, 60_000);

  it("fails the opening when Jev refuses a request the client has retried, naming it and why, with nothing guessed", async () => {
    const root = codebase("refused");
    refuseRoot = true;
    try {
      await expect(open(root, join(scratch, "data-refused"), true)).rejects.toThrow(/Gaia could not finish judging the area \(the repository's root\): .*refused by the stand-in/);
    } finally {
      refuseRoot = false;
    }
  }, 60_000);

  it("asks before spending past the limit, sends nothing and opens nothing when the person declines, and asks again next time", async () => {
    const root = codebase("declined");
    const data = join(scratch, "data-declined");
    await setSpendLimit(engineAt(data), 0);
    const before = standIn.received.length;
    const asked: ConsentPlan[] = [];
    const declined = openWorld({ engine: engineAt(data), root, consent: async (plan) => (asked.push(plan), false), progress: () => {} });
    // Past the limit the person is asked once, shown exactly what would go out and what they allow.
    await expect(declined).rejects.toThrow(/you chose not to go ahead/);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ name: "declined", limitUsd: 0, endpoint: standIn.endpoint });
    expect(asked[0]?.estimatedUsd).toBeGreaterThan(0);
    expect(asked[0]?.estimatedTokens).toBeGreaterThan(0);
    expect(standIn.received.length).toBe(before);
    // Declining isn't remembered: the next opening asks again, and going ahead sends every request it planned, and at
    // most one more round of the understanding pass's where Jev asked for more. Composing follows from the answers, so
    // it is never planned ahead.
    const third = await open(root, data, true);
    expect(third.asked).toHaveLength(1);
    const planned = third.sent.length - third.about.filter((a) => a.startsWith("compose:")).length;
    expect(planned).toBeGreaterThanOrEqual(third.asked[0]?.requests ?? Number.POSITIVE_INFINITY);
    expect(planned).toBeLessThanOrEqual(2 * (third.asked[0]?.requests ?? 0));
  }, 60_000);
});
