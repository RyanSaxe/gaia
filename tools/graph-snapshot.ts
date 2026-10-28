// Writes the engine's judged code graph of a project, trimmed to what the
// layout reads (`judgedGraph`), to a JSON snapshot that `pnpm jev-world` and
// `pnpm print-world-requests` lay the project's world out from (`factsOf`).
// Each node's importance and quality come from the Jev answers held in the store
// under GAIA_DATA_DIR, and nothing is sent to Jev. Opening a checkout updates its
// project's lineage record, so for an older commit point GAIA_DATA_DIR at a copy
// of the store. The snapshot goes outside the repository by default
// (`SNAPSHOT`), since the repository keeps only the showcase's. It builds the
// engine first.
// Usage: GAIA_DATA_DIR=dir pnpm graph-snapshot [root] [out.json]

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CodeGraph } from "@gaia/schema";
import { judgedGraph } from "../app/world-service/open-world.ts";
import { engineBinary } from "./engine-binary.ts";
import { cargoEnv } from "./cargo-env.ts";
import { SNAPSHOT } from "./snapshot-paths.ts";

const repo = resolve(import.meta.dirname, "..");
const root = resolve(process.argv[2] ?? repo);
const out = resolve(process.argv[3] ?? SNAPSHOT.graph);
if (process.env.GAIA_DATA_DIR === undefined) throw new Error("Set GAIA_DATA_DIR to the store that holds Jev's answers for this project.");
const env = cargoEnv();
execFileSync("cargo", ["build", "-p", "gaia-engine", "--release", "--quiet"], { cwd: repo, env, stdio: "inherit" });

const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "project.graph", params: { root, judged: true } });
const run = spawnSync(engineBinary(repo, "release"), ["rpc"], { input: `${request}\n`, env, maxBuffer: 1 << 30 });
const response = JSON.parse(run.stdout.toString()) as { result?: CodeGraph; error?: { message: string } };
if (response.result === undefined) throw new Error(response.error?.message ?? "project.graph answered nothing");
const graph = judgedGraph(response.result);
const defs = graph.nodes.filter((n) => n.kind === "def");
const withImportance = defs.filter((n) => typeof n.judged?.value?.importance === "number").length;
if (withImportance === 0) throw new Error(`No definition has an importance in ${process.env.GAIA_DATA_DIR}: Jev's answers for this project are not there.`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(graph)}\n`);
const files = graph.nodes.filter((n) => n.kind === "file").length;
console.log(`${out}: ${files} files, ${defs.length} definitions, ${withImportance} with an importance`);
