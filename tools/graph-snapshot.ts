// Writes the engine's judged code graph of a project, trimmed to what the
// layout reads (`judgedGraph`), to a JSON snapshot for the terrain lab.
// Each node's importance and quality come from the Jev answers held in the store
// under GAIA_DATA_DIR; nothing is asked. The lab lays its world out from
// this graph alone (`codeModelOf`). Opening a checkout updates its project's
// lineage record, so for an older commit point GAIA_DATA_DIR at a copy of
// the store.
// Builds the engine first.
// It writes beside it `gaia-judged.json`, what the understanding pass judged
// about every folder, file and definition (`judgedThings`), for the journal.
// Usage: GAIA_DATA_DIR=dir pnpm graph-snapshot [root] [out.json]

import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CodeGraph } from "@gaia/schema";
import { judgedGraph, judgedThings } from "../app/world-service/open-world.ts";

const repo = resolve(import.meta.dirname, "..");
const root = resolve(process.argv[2] ?? repo);
const out = resolve(process.argv[3] ?? resolve(repo, "app/renderer/terrain/fixtures/gaia-graph.json"));
if (process.env.GAIA_DATA_DIR === undefined) throw new Error("Set GAIA_DATA_DIR to the store that holds Jev's answers for this project.");
const env = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` };
execFileSync("cargo", ["build", "-p", "gaia-engine", "--release", "--quiet"], { cwd: repo, env, stdio: "inherit" });

const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "project.graph", params: { root, judged: true } });
const run = spawnSync(resolve(repo, "target/release/gaia-engine"), ["rpc"], { input: `${request}\n`, env, maxBuffer: 1 << 30 });
const response = JSON.parse(run.stdout.toString()) as { result?: CodeGraph; error?: { message: string } };
if (response.result === undefined) throw new Error(response.error?.message ?? "project.graph answered nothing");
const graph = judgedGraph(response.result);
const defs = graph.nodes.filter((n) => n.kind === "def");
const standing = defs.filter((n) => typeof n.judged?.value?.importance === "number").length;
if (standing === 0) throw new Error(`No definition has an importance in ${process.env.GAIA_DATA_DIR}: Jev's answers for this project are not there.`);
writeFileSync(out, `${JSON.stringify(graph)}\n`);
const things = judgedThings(response.result);
writeFileSync(resolve(dirname(out), "gaia-judged.json"), `${JSON.stringify(things)}\n`);
const files = graph.nodes.filter((n) => n.kind === "file").length;
console.log(`${out}: ${files} files, ${defs.length} definitions, ${standing} with an importance; ${Object.keys(things).length} judged things beside it`);
