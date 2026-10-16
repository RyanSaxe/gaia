// The showcase's codebase: folio, a made-up static site generator whose
// world is composed for Gaia's film. A wood, a meadow, a village of houses
// on a brook, a hub's tower on a hill, and past it an old renderer gone to
// ruin.
//
// folio's source is real code, kept as one text file
// (`app/renderer/terrain/fixtures/showcase-code.txt`, each file under its
// `=== path ===` line), so Gaia's own world reads one file rather than a
// codebase of its own. Each part is written as well or as poorly as it
// fares: the old renderer in `v1/` is tangled, untested and full of emptied
// error handlers; the search index in `find/` has gone tired; the rest is
// kept. Folder names place each area on the land (a folder's place is seeded
// by its path), so they were chosen, from names a real project might use,
// for where they put the places the film walks.
//
// `--code DIR` writes folio's source to DIR, outside Gaia's repository or
// under node_modules, so Gaia's own world never reads it.
//
// `--judge jev|local` opens folio as the app opens any folder (`openWorld`):
// the engine reads it, Jev's understanding pass judges how much each part
// matters and how well it is made, and Jev judges and composes its world.
// The answers are kept in the store under GAIA_DATA_DIR, beside folio's
// source, so a later run asks only what changed. It then writes the page's
// copy of that world, as `pnpm graph-snapshot` and `pnpm jev-world` write
// Gaia's: the judged graph (`fixtures/showcase-graph.json`), what was judged
// about each thing for the journal (`showcase-judged.json`), and every answer
// the world is laid out from, by request key (`showcase-jev.json`). `local`
// asks the OpenRouter stand-in on this machine and sends nothing; `jev` asks
// Jev, only with GAIA_JEV=live, the Keychain's key and `--spend-up-to`
// covering twice the engine's estimate.
//
// Usage: pnpm showcase --code DIR
//        GAIA_DATA_DIR=dir pnpm showcase --judge jev|local [--spend-up-to 0.3]

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import type { CodeGraph, JevResponse } from "@gaia/schema";
import { DEFAULT_DESIGN, composeWorld, factsOf, judgeWorld, keptJev, layoutWorld, planStanding, planWorldRequests, requestKey } from "@gaia/world";
import { LOOKS } from "../app/renderer/terrain/looks.ts";
import { folioFiles } from "../app/renderer/terrain/showcase-code.ts";
import { createEngineClient } from "../app/world-service/engine-client.ts";
import { judgedGraph, judgedThings, openWorld } from "../app/world-service/open-world.ts";
import { startOpenRouterStandIn } from "./openrouter-stand-in.ts";

const repo = resolve(import.meta.dirname, "..");
const fixtures = resolve(repo, "app/renderer/terrain/fixtures");
const args = parseArgs({ options: { code: { type: "string" }, judge: { type: "string" }, "spend-up-to": { type: "string" } } }).values;
const files = folioFiles(readFileSync(resolve(fixtures, "showcase-code.txt"), "utf8"));

/** Writes folio's source to a folder outside Gaia's repository. */
function writeCode(dir: string): void {
  const inside = relative(repo, dir);
  if (!inside.startsWith("..") && !inside.split("/").includes("node_modules")) throw new Error(`Write folio's code outside Gaia's repository or under node_modules, or Gaia's own world reads it: ${dir}.`);
  for (const [path, text] of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

if (args.code !== undefined) {
  writeCode(resolve(args.code));
  console.log(`showcase: wrote folio's ${files.size} files to ${resolve(args.code)}`);
  process.exit(0);
}

const judge = args.judge;
if (judge !== "jev" && judge !== "local") throw new Error("Write folio's source (--code DIR) or judge its world (--judge jev|local).");
const data = process.env.GAIA_DATA_DIR;
if (data === undefined) throw new Error("Set GAIA_DATA_DIR to the store that keeps Jev's answers about folio, so a later run asks only what changed.");
// folio is read from the same folder on every run, so the store finds its answers under the same project.
const folio = resolve(data, "folio");
writeCode(folio);

/** The answers the page lays folio out from, by request key, as `pnpm jev-world` keeps Gaia's. */
interface Kept {
  readonly design: string;
  readonly answers: Record<string, JevResponse>;
}
const keptFile = resolve(fixtures, "showcase-jev.json");
const kept: Kept = existsSync(keptFile) ? (JSON.parse(readFileSync(keptFile, "utf8")) as Kept) : { design: DEFAULT_DESIGN, answers: {} };

const standIn = judge === "local" ? await startOpenRouterStandIn({ delayMs: 0 }) : undefined;
execFileSync("cargo", ["build", "-p", "gaia-engine", "--release", "--quiet"], { cwd: repo, env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` }, stdio: "inherit" });
const engine: ChildProcess = spawn(resolve(repo, "target/release/gaia-engine"), ["rpc"], {
  env: { ...process.env, GAIA_DATA_DIR: resolve(data), ...(standIn === undefined ? {} : { GAIA_JEV: "live", GAIA_JEV_ENDPOINT: standIn.endpoint }) },
  stdio: ["pipe", "pipe", "inherit"],
});
const client = createEngineClient((line) => engine.stdin?.write(`${line}\n`));
if (engine.stdout !== null) createInterface({ input: engine.stdout }).on("line", (line) => client.receive(line));

/** What every answer the store keeps for folio was billed: the understanding pass's calls and the world's answers. */
async function billed(project: string): Promise<{ requests: number; inputTokens: number; usd: number }> {
  let requests = 0;
  let inputTokens = 0;
  let usd = 0;
  for (const table of ["calls", "answers"] as const) {
    const { records } = await client.call("store.read", { project, table });
    for (const value of Object.values(records as Record<string, Partial<JevResponse>>)) {
      requests++;
      inputTokens += value.inputTokens ?? 0;
      usd += Number.isFinite(value.costUsd) ? (value.costUsd as number) : 0;
    }
  }
  return { requests, inputTokens, usd };
}

try {
  const status = await client.call("jev.status", {});
  if (!status.live || !status.key) throw new Error("Jev needs GAIA_JEV=live and the gaia-openrouter key in the Keychain.");
  const first = await client.call("project.graph", { root: folio, judged: true });
  const project = first.projectId;
  // The answers kept before go into the store, so only what changed is asked.
  if (Object.keys(kept.answers).length > 0) await client.call("store.put", { project, writes: Object.entries(kept.answers).map(([key, value]) => ({ table: "answers" as const, key, value })) });
  const before = await billed(project);

  // What the run would send: the understanding pass, then the looks and what every thing stands as on the graph as it
  // stands. Composing follows from those answers, so it is not planned ahead.
  const understanding = await client.call("understanding.plan", { root: folio });
  const graph0 = judgedGraph(first);
  const facts0 = factsOf(graph0);
  const looks = [...planWorldRequests(facts0, LOOKS, { graph: graph0 }), ...planStanding(facts0, LOOKS, { graph: graph0 }).requests].filter((p) => kept.answers[requestKey(p.request)] === undefined);
  const judging = await client.call("jev.estimate", { requests: looks.map((p) => p.request) });
  const estimate = understanding.estimate.estimatedUsd + judging.estimatedUsd;
  console.error(`showcase: about ${understanding.estimate.requests + judging.requests} requests before composing, about $${estimate.toFixed(4)}`);
  const allowed = Number(args["spend-up-to"] ?? "0");
  if (judge === "jev" && !(allowed >= estimate * 2)) throw new Error(`Refusing to spend: pass --spend-up-to ${(estimate * 2).toFixed(4)} or more to ask Jev.`);

  // folio opened as the app opens any folder.
  const document = await openWorld({ engine: client, root: folio, consent: () => Promise.resolve(judge === "local"), progress: () => undefined });
  console.error(`showcase: ${document.summary}`);

  // The page's copy: the graph as judged, and every answer its world is laid out from, asked again with nothing to ask.
  const read = await client.call("project.graph", { root: folio, judged: true });
  const snapshot: CodeGraph = { ...judgedGraph(read), projectId: "showcase" };
  const { records } = await client.call("store.read", { project, table: "answers" });
  const stored = new Map(Object.entries(records as Record<string, JevResponse>));
  const used: Record<string, JevResponse> = {};
  const facts = factsOf(snapshot);
  const jev = keptJev(null, { stored, keep: () => undefined, settled: (key) => (used[key] = stored.get(key) as JevResponse), unasked: "the run's answers do not cover it" });
  const world = layoutWorld(facts, await composeWorld(facts, LOOKS, jev, await judgeWorld(facts, LOOKS, jev, { graph: snapshot }), { graph: snapshot }), snapshot);
  writeFileSync(resolve(fixtures, "showcase-graph.json"), `${JSON.stringify(snapshot)}\n`);
  writeFileSync(resolve(fixtures, "showcase-judged.json"), `${JSON.stringify(judgedThings(read))}\n`);
  writeFileSync(keptFile, `${JSON.stringify({ design: DEFAULT_DESIGN, answers: Object.fromEntries(Object.entries(used).sort(([a], [b]) => (a < b ? -1 : 1))) }, null, 1)}\n`);
  const after = await billed(project);
  console.log(
    JSON.stringify({
      judge,
      requests: after.requests - before.requests,
      inputTokens: after.inputTokens - before.inputTokens,
      usd: +(after.usd - before.usd).toFixed(6),
      kept: Object.keys(used).length,
      world: { size: world.size, lands: world.regions.length, buildings: world.things.filter((t) => t.as === "building").length, landmarks: world.things.filter((t) => t.as === "landmark").length, trails: world.trails.length },
    }),
  );
} finally {
  engine.kill();
  await standIn?.close();
}
