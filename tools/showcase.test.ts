import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "..");

describe("the showcase's code", () => {
  const dir = mkdtempSync(join(tmpdir(), "gaia-showcase-"));
  execFileSync(resolve(repo, "node_modules/.bin/tsx"), ["tools/showcase.ts", "--code", dir], { cwd: repo, stdio: "pipe" });
  const files = (readdirSync(dir, { recursive: true, withFileTypes: true }) as { name: string; parentPath: string; isFile(): boolean }[])
    .filter((f) => f.isFile())
    .map((f) => join(f.parentPath, f.name).slice(dir.length + 1))
    .sort();
  const text = (path: string): string => readFileSync(join(dir, path), "utf8");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("is code the engine can read: every TypeScript file parses", () => {
    const broken = files
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => (ts.transpileModule(text(f), { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ESNext } }).diagnostics ?? []).map((d) => `${f}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`));
    expect(broken).toEqual([]);
  });

  it("is written as well as each part fares: the old renderer in ruin, the rest kept", () => {
    const ruined = files.filter((f) => f.startsWith("v1/") && f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(ruined.length).toBeGreaterThan(4);
    for (const f of ruined) expect(text(f), f).toMatch(/\bvar |: any\b/);
    expect(ruined.filter((f) => /catch \(e\) \{\}/.test(text(f))).length).toBeGreaterThan(2);
    const kept = files.filter((f) => /^(site|engine|schema)\//.test(f) && f.endsWith(".ts"));
    for (const f of kept) expect(text(f), f).not.toMatch(/TODO|FIXME|HACK|catch \(e\) \{\}|: any\b/);
  });
});
