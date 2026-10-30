import { describe, expect, it } from "vitest";
import type { CodeGraph, DefNode, DirNode, FileNode, GraphEdge } from "@gaia/schema";
import { factsOf } from "@gaia/world";

const dir = (path: string, entity?: DirNode["entity"]): DirNode => ({ kind: "dir", id: `dir:${path}`, lineage: path, path, measures: { lines: 0 }, ...(entity === undefined ? {} : { entity }) });
const file = (path: string, lines: number): FileNode => ({ kind: "file", id: `file:${path}`, lineage: path, path, language: "typescript", bytes: 1, hash: "", binary: false, unparsed: 0, conventions: [], measures: { lines } });
const def = (path: string, name: string, role: string, exported: boolean, start: number, end: number, parent?: string): DefNode => ({
  kind: "def",
  id: `def:${path}#${parent === undefined ? name : `${parent}.${name}`}`,
  lineage: name,
  file: `file:${path}`,
  ...(parent === undefined ? {} : { parent: `def:${path}#${parent}` }),
  name,
  role,
  span: { start, end },
  signature: name,
  exported,
  measures: { lines: end - start + 1 },
});
const imports = (from: string, to: string): GraphEdge => ({ from, to: `file:${to}`, kind: "imports", by: { by: "rule" } });

const core = "packages/core";
const math = `${core}/src/math.ts`;
const index = `${core}/src/index.ts`;
const main = "packages/app/src/main.ts";
const GRAPH: CodeGraph = {
  projectId: "demo",
  name: "demo",
  pending: [],
  nodes: [
    dir(""),
    dir(core, { name: "@demo/core", form: "package", manifest: `${core}/package.json`, entry: index }),
    dir("packages/app", { name: "@demo/app", form: "package", manifest: "packages/app/package.json", entry: main }),
    file(index, 2),
    file(math, 120),
    file(main, 40),
    def(math, "add", "function", true, 1, 10),
    def(math, "Shape", "class", true, 12, 60),
    def(math, "area", "method", false, 20, 30, "Shape"),
    def(math, "helper", "function", false, 70, 90),
    def(math, "Row", "key", false, 100, 101),
    def(main, "start", "function", false, 1, 40),
  ],
  edges: [imports(`file:${index}`, math), imports(`def:${main}#start`, index), imports(`file:${main}`, main)],
};

describe("the code facts, read from the engine's graph alone", () => {
  const facts = factsOf(GRAPH);

  it("gives each declared entity its files, size, the surface its entry gathers, and the entities it leans on, from imports a file or a definition in it makes", () => {
    const e = facts.entities.find((x) => x.path === core);
    expect(e).toMatchObject({ name: "@demo/core", form: "package", entry: index, files: 2, lines: 122, exports: 2, dependents: ["packages/app"], dependsOn: [] });
    expect(facts.entities.find((x) => x.path === "packages/app")?.dependsOn).toEqual([core]);
    // An import within one file or one entity links nothing.
    expect(facts.entities.find((x) => x.path === "packages/app")?.dependents).toEqual([]);
  });
});
