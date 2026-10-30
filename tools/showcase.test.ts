import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { CodeGraph } from "@gaia/schema";
import { factsOf, landOf } from "@gaia/world";
import fixedGraph from "../app/renderer/terrain/fixtures/showcase-fixed-graph.json";
import graph from "../app/renderer/terrain/fixtures/showcase-graph.json";

const repo = resolve(import.meta.dirname, "..");

/** The showcase's code as `pnpm showcase --code` writes it, with its old `v1/` as it is or fixed, by path. */
function written(v1: "broken" | "fixed"): { dir: string; files: string[]; text: (path: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), "gaia-showcase-"));
  execFileSync(process.execPath, ["--import", "tsx", "tools/showcase.ts", "--code", dir, "--v1", v1], { cwd: repo, stdio: "pipe" });
  const files = (readdirSync(dir, { recursive: true, withFileTypes: true }) as { name: string; parentPath: string; isFile(): boolean }[])
    .filter((f) => f.isFile())
    .map((f) => relative(dir, join(f.parentPath, f.name)).split(sep).join("/"))
    .sort();
  return { dir, files, text: (path) => readFileSync(join(dir, path), "utf8") };
}

/** Where a graph's land lays everything out, without how healthy each patch is. */
function places(of: CodeGraph): string {
  const land = landOf(factsOf(of), of);
  return JSON.stringify({ ...land, patches: land.patches.map(({ vitality: _, ...place }) => place) });
}

describe("the showcase's code", () => {
  const broken = written("broken");
  const fixed = written("fixed");
  afterAll(() => [broken, fixed].forEach((w) => rmSync(w.dir, { recursive: true, force: true })));

  it("is the code each showcase was judged and laid out from: run pnpm showcase --judge jev [--v1 fixed] after changing it", () => {
    for (const [{ files, text }, judged] of [[broken, graph], [fixed, fixedGraph]] as const) {
      const read = new Map((judged as unknown as CodeGraph).nodes.flatMap((n) => (n.kind === "file" ? [[n.path, n.measures.lines] as const] : [])));
      expect(files).toEqual([...read.keys()].sort());
      for (const f of files) expect(text(f).split("\n").length - 1, f).toBe(read.get(f));
    }
  });

  it("changes only how v1 is written when v1 is fixed: the same files, and the same land to the cell", () => {
    expect(fixed.files).toEqual(broken.files);
    expect(fixed.files.filter((f) => fixed.text(f) !== broken.text(f)).every((f) => f.startsWith("v1/"))).toBe(true);
    expect(places(fixedGraph as unknown as CodeGraph)).toBe(places(graph as unknown as CodeGraph));
  });
});
