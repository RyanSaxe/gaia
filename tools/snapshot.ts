// Writes the engine's code model of a project to a JSON snapshot, through the
// same `project.open` the app calls. The terrain lab's "This codebase" world
// reads the committed snapshot of Gaia itself. Builds the engine first.
// Usage: pnpm snapshot [root] [out.json]

import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const root = resolve(process.argv[2] ?? repo);
const out = resolve(process.argv[3] ?? resolve(repo, "app/renderer/terrain/fixtures/gaia.json"));
const env = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` };
execFileSync("cargo", ["build", "-p", "gaia-engine", "--release", "--quiet"], { cwd: repo, env, stdio: "inherit" });

const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "project.open", params: { root } });
const t0 = performance.now();
const run = spawnSync(resolve(repo, "target/release/gaia-engine"), ["rpc"], { input: `${request}\n`, maxBuffer: 1 << 28 });
const ms = performance.now() - t0;
const response = JSON.parse(run.stdout.toString()) as { result?: unknown; error?: { message: string } };
if (response.result === undefined) throw new Error(response.error?.message ?? "project.open answered nothing");
writeFileSync(out, `${JSON.stringify(response.result)}\n`);
const model = response.result as { files: unknown[]; entities: unknown[] };
console.log(`${out}: ${model.files.length} files, ${model.entities.length} entities; project.open took ${ms.toFixed(0)} ms with the engine's start`);
