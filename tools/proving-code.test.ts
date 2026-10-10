import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import type { ManifestEntry } from "./proving-code.ts";

const repo = resolve(import.meta.dirname, "..");

describe("the proving ground's code", () => {
  const dir = mkdtempSync(join(tmpdir(), "gaia-proving-"));
  execFileSync(resolve(repo, "node_modules/.bin/tsx"), ["tools/proving.ts", "--code", dir], { cwd: repo, stdio: "pipe" });
  const manifest = JSON.parse(readFileSync(`${dir}-manifest.json`, "utf8")) as ManifestEntry[];
  const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => /\.(ts|rs)$/.test(f));
  const text = (path: string): string => readFileSync(join(dir, path), "utf8");
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(`${dir}-manifest.json`, { force: true });
  });

  it("is code the engine can read: every TypeScript file parses", () => {
    const broken = files
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => (ts.transpileModule(text(f), { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ESNext } }).diagnostics ?? []).map((d) => `${f}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`));
    expect(broken).toEqual([]);
  });

  it("says how every source file was written, and writes it that way", () => {
    expect(manifest.map((e) => e.path).sort()).toEqual(files.filter((f) => !f.endsWith(".test.ts")).sort());
    const questions = ["naming", "doc", "readability", "errors", "change", "cohesion"] as const;
    for (const e of manifest) {
      const code = text(e.path);
      expect(e.vitality, e.path).toBeGreaterThanOrEqual(0);
      expect(e.vitality, e.path).toBeLessThanOrEqual(1);
      if (e.health === "thriving") {
        // A thriving file has nothing for a question to find.
        for (const q of questions) expect(e[q], `${e.path} ${q}`).toBe("good");
        expect(code).not.toMatch(/TODO|FIXME|HACK|catch \(e\) \{\}|: any\b/);
      }
      if (e.health === "ruin" && e.path.endsWith(".ts")) {
        // A ruined one has every fault the plan gives ruin, where the engine's questions look.
        for (const q of questions) expect(e[q], `${e.path} ${q}`).toBe("poor");
        expect(code).toMatch(/HACK:/);
        expect(code).toMatch(/catch \(e\) \{\}/);
        expect(code).toMatch(/let ready = false;/);
      }
    }
  });
});
