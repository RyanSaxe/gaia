// Runs the real engine binary against a local stand-in for OpenRouter's
// Decisions API to judge small codebases end to end. Nothing reaches
// OpenRouter. The engine refuses any endpoint override that is not a loopback
// address, and sends a local endpoint a placeholder key instead of the
// configured one.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type StandIn, startOpenRouterStandIn } from "../../tools/openrouter-stand-in.ts";
import { outlinesOf } from "@gaia/terrain";
import type { JevRequest } from "@gaia/schema";
import { cargoEnv } from "../../tools/cargo-env.ts";
import { createEngineClient } from "./engine-client.ts";
import { openWorld, setSpendLimit } from "./open-world.ts";
import type { ConsentPlan, Opening } from "./protocol.ts";

const REPO = resolve(import.meta.dirname, "../..");
const ENGINE = join(REPO, "target", "debug", process.platform === "win32" ? "gaia-engine.exe" : "gaia-engine");
/** A source marker that distinguishes understanding requests from design requests. */
const SOURCE_ONLY = "const secretSourceLine = 42;";

let scratch = "";
let standIn: StandIn;
/** Whether the stand-in refuses the root area's request, as OpenRouter might refuse a bad one. */
let refuseRoot = false;
const engines: ChildProcess[] = [];

// A clean engine build takes minutes on CI's machines, and another test file's build may hold cargo's lock meanwhile.
beforeAll(async () => {
  execFileSync("cargo", ["build", "-p", "gaia-engine", "--quiet"], { cwd: REPO, env: cargoEnv(), stdio: "inherit" });
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

/**
 * A codebase with imports only Jev can resolve. Two modules are named `helpers`, and `main.py` imports them by that
 * name alone, so the rules leave the import to Jev. Each file's imports and importers change once Jev resolves the
 * links.
 */
function linkedCodebase(name: string): string {
  const root = join(scratch, name);
  for (const dir of ["src/app", "src/lend", "src/keep"]) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  writeFileSync(join(root, "src/lend/helpers.py"), `"""Lending things out."""\n\n\ndef lend(item):\n    """Lends an item."""\n    return [item]\n`);
  writeFileSync(join(root, "src/keep/helpers.py"), `"""Keeping things."""\n\n\ndef keep(item):\n    """Keeps an item."""\n    return {item: True}\n`);
  writeFileSync(join(root, "src/app/main.py"), `"""The app: lends what it is asked for."""\nimport helpers\nfrom helpers import lend\n\n\ndef run(item):\n    """Runs the app on one item."""\n    return lend(item) + helpers.lend(item)\n`);
  writeFileSync(join(root, "src/app/report.py"), `"""Reports on what was lent."""\nfrom helpers import lend\n\n\ndef report(items):\n    """Reports every item lent."""\n    return [lend(i) for i in items]\n`);
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
    // An understanding request names its file or directory with `path` at the top level of its state.
    if (typeof s.path === "string") return `understand:${s.path}`;
    const { file, entity, directory, repository, trail } = s as Record<string, { path?: string; name?: string } | undefined>;
    // Composing the sky, a land, a building, a landmark or a trail asks for its parts first, then for each stage's
    // details, with one request per wave.
    const ids = Object.keys(body.questions as object);
    if (s.decided !== undefined || ids.some((id) => /^[a-z]+\.(use|present)$/.test(id))) {
      const of = repository !== undefined ? "world" : trail !== undefined ? "trail" : (entity ?? directory)?.path;
      return `compose:${of}:${ids.sort().join(",")}`;
    }
    return file ? `file:${file.path}` : entity ? `entity:${entity.path}` : directory ? `area:${directory.path}` : "repository";
  });
  return { document, asked, shown, sent, about };
}

it("delivers a request larger than Windows' command-line limit with its text intact", async () => {
  const request: JevRequest = {
    model: "typesafe/jev-1.13",
    state: { source: '"quoted"\\path\\café\r\n\t'.repeat(4096) },
    questions: { ok: { type: "noul", instructions: "Is this text present?" } },
  };
  expect(Buffer.byteLength(JSON.stringify(request))).toBeGreaterThan(32_768);
  const before = standIn.received.length;
  const result = await engineAt(join(scratch, "large-request-data")).call("jev.batch", { requests: [request] });
  expect(result.responses[0]).toHaveProperty("answers.ok");
  expect(standIn.received.slice(before)).toEqual([{ authorization: "Bearer local-stand-in", body: request }]);
});

describe("judging a codebase with Jev", () => {
  it("sends only facts, keeps Jev's answers, asks again only what changed, and judges everything with Jev", async () => {
    const root = codebase("tiny");
    const data = join(scratch, "data-live");

    const first = await open(root, data, false);
    // Judging costs less than the default limit, so Gaia sends requests to Jev without asking the person.
    expect(first.asked).toHaveLength(0);
    expect(first.sent.length).toBeGreaterThan(0);
    // The land message arrives before any judging, with outlines, file patches and lots that match the finished world.
    const land = first.shown.findIndex((o) => o.stage === "land");
    expect(land).toBeGreaterThan(first.shown.findIndex((o) => o.stage === "reading"));
    expect(land).toBeLessThan(first.shown.findIndex((o) => o.stage === "asking"));
    const patches = first.document.world.patches.map(({ path, name, area, x, z, radius }) => ({ path, name, area, x, z, radius }));
    // Every entity's lot, whatever form Jev chose for the entity. The entity is placed at its lot's center.
    const byPlace = (a: { x: number; z: number }, b: { x: number; z: number }): number => a.x - b.x || a.z - b.z;
    const lots = [...first.document.world.things.filter((t) => t.of === undefined), ...first.document.world.plants.filter((s) => s.of === "entity")].map(({ x, z }) => ({ x, z })).sort(byPlace);
    const shownLand = first.shown[land];
    if (shownLand?.stage !== "land") throw new Error("The land was never shown.");
    expect({ ...shownLand, lots: [...shownLand.lots].sort(byPlace) }).toEqual({ stage: "land", name: "tiny", size: first.document.world.size, aspect: first.document.world.aspect, areas: outlinesOf(first.document.world).areas, patches, lots });
    // Each file's vitality arrives once, after asking starts, and matches the finished world.
    expect(first.shown.findIndex((o) => o.stage === "health")).toBeGreaterThan(first.shown.findIndex((o) => o.stage === "asking"));
    const health = first.shown.flatMap((o) => (o.stage === "health" ? Object.entries(o.vitality) : []));
    expect(health.map(([path]) => path).sort()).toEqual(patches.map((p) => p.path).sort());
    expect(Object.fromEntries(health)).toEqual(Object.fromEntries(first.document.world.patches.map((p) => [p.path, p.vitality])));
    // An area joins `settled` once everything on its land is answered, and never leaves it. By the end, every area is
    // settled.
    let named: readonly string[] = [];
    for (const o of first.shown) {
      if (o.stage !== "asking") continue;
      expect(o.settled).toEqual(expect.arrayContaining([...named]));
      named = o.settled;
    }
    expect([...named].sort()).toEqual(first.document.world.areas.map((a) => a.path).sort());
    // Every request carries the placeholder key and only the model, state and questions. Design requests read facts,
    // and only understanding requests read source.
    for (const [i, { authorization, body }] of first.sent.entries()) {
      expect(authorization).toBe("Bearer local-stand-in");
      expect(Object.keys(body).sort()).toEqual(["model", "questions", "state"]);
      if (!first.about[i]?.startsWith("understand:")) expect(JSON.stringify(body)).not.toContain("secretSourceLine");
    }
    // No design request goes out twice. A look may be asked twice, before and after Jev's links change the facts it
    // reads, but the two requests differ.
    const judging = first.sent.filter((_, i) => !first.about[i]?.startsWith("understand:")).map(({ body }) => JSON.stringify(body));
    expect(new Set(judging).size).toBe(judging.length);
    expect(first.about).toEqual(expect.arrayContaining(["area:(the repository's root)", "file:src/shape.ts", "understand:src/shape.ts"]));
    // Every file gets a form request, including one that defines nothing.
    expect(first.about).toContain("file:README.md");
    // The understanding pass asked about folders and files, and every definition has Jev's importance. The document
    // carries the pass's judgments, with every score from 0 to 1.
    const states = first.sent.map(({ body }) => body.state as Record<string, unknown>);
    expect(states.some((s) => s["folder-axes"] !== undefined)).toBe(true);
    expect(states.some((s) => s["file-axes"] !== undefined && s.path === "src/shape.ts")).toBe(true);
    expect(first.document.world.symbols.find((s) => s.name === "shape")?.importance).toEqual(expect.any(Number));
    const shape = first.document.judged["src/shape.ts#shape"];
    expect(shape?.quality).toBeGreaterThanOrEqual(0);
    expect(shape?.quality).toBeLessThanOrEqual(1);
    expect(Object.keys(shape?.concepts ?? {})).toContain("readability");
    // Jev judged everything.
    expect(first.document.summary).toContain("judged by Jev");
    const asking = first.shown.filter((o) => o.stage === "asking");
    // Composing requests went out, and the last `asking` message counts every request sent, form and composing
    // requests included.
    const composed = first.about.filter((a) => a.startsWith("compose:")).length;
    expect(composed).toBeGreaterThan(0);
    expect(asking.at(-1)).toMatchObject({ total: first.sent.length, answered: first.sent.length, asking: [] });
    // While a request is in flight, its area appears in `asking`, for the wait to show.
    expect(asking.some((o) => o.asking.length > 0)).toBe(true);
    // After the understanding pass, `composed` messages list each file whose forms Jev chose, and each file and area
    // whose building, landmark, land or sky it composed, each once, so the wait's pencil keeps moving.
    const after = first.shown.map((o) => o.stage).lastIndexOf("understood");
    const composedStages = first.shown.flatMap((o, i) => (o.stage === "composed" ? [{ i, o }] : []));
    expect(composedStages.length).toBeGreaterThan(0);
    expect(composedStages.every(({ i }) => i > after)).toBe(true);
    const chosen = composedStages.flatMap(({ o }) => o.chosen.files);
    expect([...chosen].sort()).toEqual(first.document.world.patches.map((p) => p.path).sort());
    expect(new Set(chosen).size).toBe(chosen.length);
    expect(composedStages.flatMap(({ o }) => o.composed.areas)).toContain("");

    // Reopening on a new engine sends no request already answered and does not ask the person.
    const second = await open(root, data, true);
    expect(second.asked).toHaveLength(0);
    expect(second.about).toEqual([]);
    expect(second.document.world).toEqual(first.document.world);

    // A changed file is asked about again, with the requests its facts touch, and fewer requests go out than the first
    // time. A form request goes out again where the offered forms or the importance changed. One more definition
    // shifts every importance rank a little, and in a world this small that moves most things into another form's
    // range.
    appendFileSync(join(root, "src/shape.ts"), `\n/** The area of a circle. */\nexport const circle = (r: number): number => Math.PI * r * r;\n`);
    const third = await open(root, data, true);
    expect(third.about).toEqual(expect.arrayContaining(["file:src/shape.ts"]));
    expect(third.sent.length).toBeLessThan(first.sent.length);
  }, 60_000);

  it("opens a world the same way twice from the same answers, asking nothing new, even where Jev's links change what the code imports", async () => {
    const root = linkedCodebase("linked");
    const data = join(scratch, "data-linked");
    const first = await open(root, data, true);
    expect(first.sent.length).toBeGreaterThan(0);
    const second = await open(root, data, true);
    // Jev resolved the import the rules could not, so the world's facts changed during the first opening.
    expect(second.document.facts.files.find((f) => f.path === "src/app/main.py")?.imports.length).toBeGreaterThan(0);
    expect(second.about).toEqual([]);
    expect(second.document.facts).toEqual(first.document.facts);
    expect(second.document.world).toEqual(first.document.world);
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
    // Above the limit, the person is asked once and shown the plan and their limit.
    await expect(declined).rejects.toThrow(/you chose not to go ahead/);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ name: "declined", limitUsd: 0, endpoint: standIn.endpoint });
    expect(asked[0]?.estimatedUsd).toBeGreaterThan(0);
    expect(asked[0]?.estimatedTokens).toBeGreaterThan(0);
    expect(standIn.received.length).toBe(before);
    // Gaia does not store a decline, so the next opening asks again. Going ahead sends about as many requests as
    // the plan showed: every planned request, at most one more round of understanding requests where Jev asked for
    // more, and the composing requests, estimated at about two per thing.
    const third = await open(root, data, true);
    expect(third.asked).toHaveLength(1);
    const shown = third.asked[0]?.requests ?? 0;
    expect(third.sent.length).toBeGreaterThanOrEqual(shown / 2);
    expect(third.sent.length).toBeLessThanOrEqual(2 * shown);
  }, 60_000);
});
