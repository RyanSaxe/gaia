import { spawnSync } from "node:child_process";
import { cargoEnv } from "./cargo-env.ts";

const result = spawnSync("cargo", process.argv.slice(2), { env: cargoEnv(), stdio: "inherit" });
if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
