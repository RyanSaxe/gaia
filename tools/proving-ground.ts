// Builds the proving ground for the lab, the app and the tests: its facts and
// the choices fixed for it, generated from the plan in tools/proving.ts and
// never committed. The plan is bundled with everything it reads, in about
// 40 ms, and the bundle is the cache key. While it is unchanged, the files
// generated last time (`fixtures/proving.json` and `proving-judged.json`,
// beside the key in `proving.key`) are reused. Otherwise the bundle runs and
// writes them again, in about two seconds. Each bundler imports them as one
// module, `virtual:proving-ground` (declared in app/renderer/env.d.ts):
// `provingGroundVite()` for the app's renderer and the tests, and
// `provingGroundEsbuild` for the one-file lab.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { type Plugin, build } from "esbuild";

/** The module the page imports the proving ground from. */
const MODULE = "virtual:proving-ground";

// Resolved from the module's own URL, which stays correct in a bundled Vite or electron-vite config.
const repo = fileURLToPath(new URL("..", import.meta.url));
const fixtures = resolve(repo, "app/renderer/terrain/fixtures");
const FILES = { facts: "proving.json", judged: "proving-judged.json", key: "proving.key" } as const;

/** Writes `text` to `file` whole or not at all, so a build reading it meanwhile never reads half of it. */
function writeWhole(file: string, text: string): void {
  writeFileSync(`${file}.part`, text);
  renameSync(`${file}.part`, file);
}

/** The proving ground's module, and every file its plan reads. A change to any of them regenerates it. */
export async function provingGround(): Promise<{ code: string; inputs: string[] }> {
  const bundled = await build({ entryPoints: [resolve(repo, "tools/proving.ts")], absWorkingDir: repo, bundle: true, platform: "node", format: "esm", target: "node22", write: false, metafile: true, logLevel: "silent" });
  const plan = bundled.outputFiles[0]?.text ?? "";
  const key = createHash("sha256").update(plan).digest("hex");
  const at = (file: string): string => join(fixtures, file);
  const made = existsSync(at(FILES.key)) && readFileSync(at(FILES.key), "utf8") === key && existsSync(at(FILES.facts)) && existsSync(at(FILES.judged));
  if (!made) {
    const dir = mkdtempSync(join(tmpdir(), "gaia-proving-"));
    try {
      writeFileSync(join(dir, "proving.mjs"), plan);
      // Run without Maglev, as the tests run (vitest.config.ts), because Maglev can lay the same facts out differently
      // and the plan checks its layout.
      await promisify(execFile)(process.execPath, ["--no-maglev", join(dir, "proving.mjs"), "--out", dir], { maxBuffer: 1 << 24 }).catch((error: { stderr?: string; message: string }) => {
        throw new Error(`The proving ground could not be made from its plan (tools/proving.ts): ${error.stderr?.trim() || error.message}`);
      });
      writeWhole(at(FILES.facts), readFileSync(join(dir, FILES.facts), "utf8"));
      writeWhole(at(FILES.judged), readFileSync(join(dir, FILES.judged), "utf8"));
      writeWhole(at(FILES.key), key);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const code = `export const facts = ${readFileSync(at(FILES.facts), "utf8")};\nexport const judged = ${readFileSync(at(FILES.judged), "utf8")};\n`;
  return { code, inputs: Object.keys(bundled.metafile.inputs).map((f) => resolve(repo, f)) };
}

/** `virtual:proving-ground` for esbuild, the one-file lab's bundler: `pnpm lab:serve` regenerates it when the plan or anything it reads changes. */
export const provingGroundEsbuild: Plugin = {
  name: "proving-ground",
  setup(b) {
    b.onResolve({ filter: /^virtual:proving-ground$/ }, () => ({ path: MODULE, namespace: "proving-ground" }));
    b.onLoad({ filter: /.*/, namespace: "proving-ground" }, async () => {
      const { code, inputs } = await provingGround();
      return { loader: "js", contents: code, watchFiles: inputs };
    });
  },
};

/** `virtual:proving-ground` for Vite, which builds the app's renderer and the tests, and generates it once per run. */
export function provingGroundVite(): { name: string; resolveId(source: string): string | null; load(this: { addWatchFile(file: string): void }, id: string): Promise<string | null> } {
  const resolved = `\0${MODULE}`;
  return {
    name: "proving-ground",
    resolveId: (source) => (source === MODULE ? resolved : null),
    async load(id) {
      if (id !== resolved) return null;
      const { code, inputs } = await provingGround();
      for (const file of inputs) this.addWatchFile(file);
      return code;
    },
  };
}
