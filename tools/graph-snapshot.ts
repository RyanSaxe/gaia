// Writes the engine's judged code graph of a project, trimmed to what the
// layout reads (`standingGraph`), to a JSON snapshot for the terrain lab.
// Each node's stand comes from the Jev answers already held in the store
// under GAIA_DATA_DIR; nothing is asked. Take it from a checkout at the
// commit `gaia.json` was taken at, so the lab's code model and graph
// describe the same code. Opening a checkout updates its project's lineage
// record, so for an older commit point GAIA_DATA_DIR at a copy of the store.
// Builds the engine first.
// Usage: GAIA_DATA_DIR=dir pnpm graph-snapshot [root] [out.json]

import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CodeGraph } from "@gaia/schema";
import { standingGraph } from "../app/world-service/open-world.ts";

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
const graph = standingGraph(response.result);
const defs = graph.nodes.filter((n) => n.kind === "def");
const standing = defs.filter((n) => n.judged?.stand !== undefined).length;
if (standing === 0) throw new Error(`No definition has a stand in ${process.env.GAIA_DATA_DIR}: Jev's answers for this project are not there.`);
writeFileSync(out, `${JSON.stringify(graph)}\n`);
const files = graph.nodes.filter((n) => n.kind === "file").length;
console.log(`${out}: ${files} files, ${defs.length} definitions, ${standing} with a stand`);
