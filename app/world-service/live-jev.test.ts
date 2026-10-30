// Runs the real engine binary against a local stand-in for OpenRouter's
// Decisions API to judge small codebases end to end. Nothing reaches
// OpenRouter. The engine refuses any endpoint override that is not a loopback
// address, and sends a local endpoint a placeholder key instead of the
// configured one.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type StandIn, startOpenRouterStandIn } from "../../tools/openrouter-stand-in.ts";
import { type BuildingPlan, type Built, type JevRequest, seedOf } from "@gaia/schema";
import { landmark, structure } from "@gaia/kinds";
import { realize } from "@gaia/realize";
import { OPENING, amongCode, bakeTerrain, clearOfCode, extentOf, openingSpot, waterDepthAt } from "@gaia/terrain";
import { cargoEnv } from "../../tools/cargo-env.ts";
import { openedWorld } from "../renderer/terrain/code-world.ts";
import { COMPOSING } from "../renderer/terrain/looks.ts";
import { landmarkBase, placeWorld } from "../renderer/terrain/place.ts";
import { createEngineClient } from "./engine-client.ts";
import { openWorld, setSpendLimit } from "./open-world.ts";
import type { ConsentPlan, WorldDocument } from "./protocol.ts";

const REPO = resolve(import.meta.dirname, "../..");
const ENGINE = join(REPO, "target", "debug", process.platform === "win32" ? "gaia-engine.exe" : "gaia-engine");
/** A source marker that distinguishes understanding requests from design requests. */
const SOURCE_ONLY = "const secretSourceLine = 42;";

let scratch = "";
let standIn: StandIn;
const engines: ChildProcess[] = [];

// A clean engine build takes minutes on CI's machines, and another test file's build may hold cargo's lock meanwhile.
beforeAll(async () => {
  execFileSync("cargo", ["build", "-p", "gaia-engine", "--quiet"], { cwd: REPO, env: cargoEnv(), stdio: "inherit" });
  scratch = mkdtempSync(join(tmpdir(), "gaia-live-jev-"));
  standIn = await startOpenRouterStandIn();
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

/** Opens a world on a fresh engine process, recording what the person was asked and what was sent to Jev. */
async function open(root: string, data: string, approve: boolean) {
  const asked: ConsentPlan[] = [];
  const before = standIn.received.length;
  const document = await openWorld({
    engine: engineAt(data),
    root,
    consent: async (plan) => (asked.push(plan), approve),
    progress: () => {},
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
  return { document, asked, sent, about };
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
  it("sends Jev facts alone in every request about the world's design, and source only to the understanding pass", async () => {
    const root = codebase("tiny");
    const first = await open(root, join(scratch, "data-live"), false);
    // Judging costs less than the default limit, so Gaia sends requests to Jev without asking the person.
    expect(first.asked).toHaveLength(0);
    expect(first.sent.length).toBeGreaterThan(0);
    // Every request carries the placeholder key and only the model, state and questions.
    for (const [i, { authorization, body }] of first.sent.entries()) {
      expect(authorization).toBe("Bearer local-stand-in");
      expect(Object.keys(body).sort()).toEqual(["model", "questions", "state"]);
      if (!first.about[i]?.startsWith("understand:")) expect(JSON.stringify(body), first.about[i]).not.toContain("secretSourceLine");
    }
    expect(first.sent.some(({ body }, i) => first.about[i] === "understand:src/shape.ts" && JSON.stringify(body).includes("secretSourceLine"))).toBe(true);
    // No request about the design goes out twice.
    const judging = first.sent.filter((_, i) => !first.about[i]?.startsWith("understand:")).map(({ body }) => JSON.stringify(body));
    expect(new Set(judging).size).toBe(judging.length);
    expect(first.document.summary).toContain("judged by Jev");
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

describe("opening an unusual codebase", () => {
  /** A folder holding `files`, made a Git repository. */
  function repository(name: string, files: Record<string, string>): string {
    const root = join(scratch, name);
    mkdirSync(root, { recursive: true });
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    return root;
  }

  /** Lays the world out, bakes and places it as the page does, and checks that the person first stands among the code on dry ground. */
  function expectWalkable(document: WorldDocument, files: readonly string[]): void {
    expect(document.world.patches.map((p) => p.path).sort()).toEqual([...files].sort());
    const code = openedWorld(document);
    const terrain = bakeTerrain(code.spec, COMPOSING.lib);
    placeWorld(terrain, {
      buildings: code.buildings.map((b) => {
        const built = realize(b.blueprint, structure, COMPOSING.lib, { seed: seedOf(`terrain-lab/${b.facts.path}`), facts: Object.fromEntries(Object.entries(structure.facts).map(([k, bind]) => [k, bind(b.facts)])) });
        return { name: b.facts.path, plan: built.slots.get("footprint")?.output as BuildingPlan, beside: extentOf(built.slots.get("feature")?.output as Built | undefined) };
      }),
      landmarks: code.landmarks.map((l) => ({ tree: false, base: landmarkBase(realize(l.blueprint, landmark, COMPOSING.lib, { seed: seedOf(`terrain-lab/landmark/${l.path}`), facts: Object.fromEntries(Object.entries(landmark.facts).map(([k, bind]) => [k, bind(l.facts)])) })) })),
      trees: { bases: code.naturalBuilds.trees.map(() => 0.5), crowns: code.naturalBuilds.trees.map(() => 4) },
      code: code.layout,
    });
    const at = openingSpot(terrain, document.world);
    expect(amongCode(document.world, at.x, at.z)).toBe(true);
    expect(waterDepthAt(terrain, at.x, at.z)).toBeLessThanOrEqual(OPENING.dry);
    expect(clearOfCode(document.world, at.x, at.z)).toBe(true);
  }

  it("fails to open an empty repository, saying it has no files to make a world from, and sends nothing", async () => {
    const before = standIn.received.length;
    await expect(open(repository("empty", {}), join(scratch, "data-empty"), true)).rejects.toThrow(/empty has no files Gaia can read/);
    expect(standIn.received.length).toBe(before);
  }, 60_000);

  // Each opens on the real engine, then bakes its small land whole, in a few seconds.
  it.each([
    ["a single file", { "main.py": "def main():\n    return 1\n" }],
    ["no packages", { "src/a.ts": "export function a(): number {\n  return 1;\n}\n", "src/b/c.ts": 'import { a } from "../a.ts";\nexport const c = a();\n', "README.md": "# Loose files\n" }],
    ["no definitions", { "README.md": "# Notes\n\nJust words.\n", "docs/guide.md": "# Guide\n", "data/config.json": '{ "a": 1 }\n' }],
  ])("opens a repository with %s into a world a person can walk", async (what, files) => {
    const { document } = await open(repository(what.replaceAll(" ", "-"), files), join(scratch, `data-${what.replaceAll(" ", "-")}`), true);
    expectWalkable(document, Object.keys(files));
  }, 60_000);
});
