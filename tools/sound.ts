// Rebuilds Gaia's sound files into app/renderer/sound/assets/: fetches what they are made from into a cache outside
// the repository, then cuts the world's sounds and composes, renders, mixes and encodes the music. The work is Python
// in tools/sound/ (its README says what it needs), run through uv.
// Usage: pnpm sound [world|music] [--out DIR] [--keep]

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const project = resolve(import.meta.dirname, "sound");
const args = ["run", "--project", project, "--frozen", "python", resolve(project, "build.py"), ...process.argv.slice(2)];
const run = spawnSync("uv", args, { stdio: "inherit" });
if (run.error) {
  console.error(`pnpm sound runs its Python through uv (https://docs.astral.sh/uv/): ${run.error.message}`);
  process.exit(1);
}
process.exit(run.status ?? 1);
