// Sample code for the terrain lab, standing in for what the engine will
// report: six of Gaia's own entities, which become its buildings, more for
// its landmarks, and files for its trees, each with a vitality from thriving
// to ruin (`SAMPLE_VITALITY`), so the lab shows every state before a
// codebase is opened, and a thing's card says what it looks like.

import { STRUCTURE_PRESETS } from "@gaia/realize";
import type { Blueprint, EntityFacts, FileFacts } from "@gaia/schema";

/** Something in the world a person can walk up to and ask about. */
export interface Represented {
  /** Its path: its identity. */
  readonly id: string;
  /** The name painted on its sign. */
  readonly name: string;
  /** What it is, in a few words, such as "Package · TypeScript". */
  readonly what: string;
  readonly doc: string;
  /** Where it lives in the code. */
  readonly where: string;
  /** Its size in words, such as "14 files · 2,140 lines · 38 exports". */
  readonly size: string;
  readonly dependsOn: readonly string[];
  readonly dependents: readonly string[];
  /** How it is doing, 0 to 1: Jev's quality in a codebase's world, the sample's own in the lab's. */
  readonly vitality: number;
}

/** An entity and the building that stands for it. */
export interface SampleEntity {
  readonly facts: EntityFacts;
  readonly vitality: number;
  /** What its building is built from: the parts Jev composed for it, or a sample's hand-filled building. */
  readonly blueprint: Blueprint;
  /** What the building is called, such as "Watermill". */
  readonly kindName: string;
}

/** A sample's hand-filled building, by its name. */
const preset = (name: string): Pick<SampleEntity, "blueprint" | "kindName"> => {
  const found = STRUCTURE_PRESETS.find((p) => p.name === name);
  if (found === undefined) throw new Error(`There is no building called ${name}.`);
  return { blueprint: found.blueprint, kindName: found.name };
};

const entity = (e: Partial<EntityFacts> & Pick<EntityFacts, "path" | "name" | "form">): EntityFacts => ({
  files: 10,
  lines: 1500,
  exports: 20,
  dependsOn: [],
  dependents: [],
  ...e,
});

export const SAMPLE_ENTITIES: readonly SampleEntity[] = [
  {
    ...preset("Thatched cottage"),
    vitality: 0.97,
    facts: entity({
      path: "packages/schema",
      name: "@gaia/schema",
      form: "package",
      manifest: "packages/schema/package.json",
      entry: "packages/schema/src/index.ts",
      files: 11,
      lines: 1180,
      exports: 64,
      dependents: ["packages/primitives", "packages/kinds", "packages/world", "packages/realize", "packages/render", "packages/terrain", "app"],
    }),
  },
  {
    ...preset("Watermill"),
    vitality: 0.48,
    facts: entity({
      path: "packages/realize",
      name: "@gaia/realize",
      form: "package",
      manifest: "packages/realize/package.json",
      entry: "packages/realize/src/index.ts",
      files: 8,
      lines: 2140,
      exports: 38,
      dependsOn: ["packages/schema", "packages/primitives"],
      dependents: ["packages/render", "packages/terrain", "app"],
    }),
  },
  {
    ...preset("Archive tower"),
    vitality: 0.06,
    facts: entity({
      path: "engine",
      name: "gaia-engine",
      form: "crate",
      manifest: "engine/Cargo.toml",
      entry: "engine/src/main.rs",
      files: 6,
      lines: 3400,
      exports: 22,
      dependents: ["app", "packages/world", "packages/schema", "packages/terrain", "packages/realize", "packages/render"],
    }),
  },
  {
    ...preset("Merchant's hall"),
    vitality: 0.86,
    facts: entity({
      path: "app/world-service",
      name: "world-service",
      form: "service",
      entry: "app/world-service/index.ts",
      files: 9,
      lines: 2600,
      exports: 46,
      dependsOn: ["packages/schema", "packages/world", "packages/kinds", "packages/primitives"],
      dependents: ["app"],
    }),
  },
  {
    ...preset("Gathered farmstead"),
    vitality: 0.66,
    facts: entity({
      path: "app/renderer/terrain",
      name: "terrain lab",
      form: "module",
      entry: "app/renderer/terrain/lab.ts",
      files: 17,
      lines: 4600,
      exports: 18,
      dependsOn: ["packages/terrain", "packages/render", "packages/realize"],
    }),
  },
  {
    ...preset("Stone croft"),
    vitality: 0.1,
    facts: entity({
      path: "app/main",
      name: "main",
      form: "module",
      entry: "app/main/index.ts",
      files: 4,
      lines: 420,
      exports: 6,
      dependsOn: ["packages/schema"],
      dependents: ["app"],
    }),
  },
];

/**
 * The entities the lab's landmarks stand for, in the order landmarks stand
 * (a world with more landmarks than these repeats them): more of Gaia's own
 * packages, from thriving to failing, so the trails between them and the
 * buildings show each entity's health.
 */
export const LANDMARK_ENTITIES: readonly EntityFacts[] = [
  entity({
    path: "packages/terrain",
    name: "@gaia/terrain",
    form: "package",
    files: 17,
    lines: 4200,
    exports: 70,
    dependsOn: ["packages/schema", "packages/primitives", "packages/realize"],
    dependents: ["app"],
  }),
  entity({
    path: "app",
    name: "@gaia/app",
    form: "app",
    files: 40,
    lines: 9800,
    exports: 6,
    dependsOn: ["packages/schema", "packages/world", "packages/realize", "packages/render", "packages/terrain", "engine"],
  }),
  entity({
    path: "packages/primitives",
    name: "@gaia/primitives",
    form: "package",
    files: 28,
    lines: 7600,
    exports: 90,
    dependsOn: ["packages/schema"],
    dependents: ["packages/realize", "packages/terrain", "app"],
  }),
  entity({
    path: "packages/render",
    name: "@gaia/render",
    form: "package",
    files: 7,
    lines: 1900,
    exports: 24,
    dependsOn: ["packages/schema", "packages/realize"],
    dependents: ["app"],
  }),
  entity({
    path: "packages/world",
    name: "@gaia/world",
    form: "package",
    files: 9,
    lines: 980,
    exports: 31,
    dependsOn: ["packages/schema"],
    dependents: ["app", "packages/realize"],
  }),
  entity({
    path: "tools",
    name: "tools",
    form: "module",
    files: 6,
    lines: 700,
    exports: 4,
  }),
  entity({
    path: "packages/kinds",
    name: "@gaia/kinds",
    form: "package",
    files: 9,
    lines: 260,
    exports: 8,
    dependsOn: ["packages/schema"],
    dependents: ["app", "packages/world"],
  }),
];

const file = (path: string, lines: number): FileFacts => ({
  path,
  language: path.endsWith(".rs") ? "rust" : "typescript",
  lines,
  symbols: [],
  imports: [],
  importedBy: [],
});

/** The samples' vitality, by path: a file or entity not named here is whole. */
export const SAMPLE_VITALITY: Readonly<Record<string, number>> = {
  "packages/schema": 0.97,
  "packages/realize": 0.48,
  "engine": 0.06,
  "app/world-service": 0.86,
  "app/renderer/terrain": 0.66,
  "app/main": 0.1,
  "packages/terrain": 0.98,
  "app": 0.07,
  "packages/primitives": 0.96,
  "packages/render": 0.29,
  "packages/world": 0.95,
  "tools": 0.1,
  "packages/kinds": 0.86,
  "packages/primitives/src/geometry/foliage.ts": 0.66,
  "app/renderer/terrain/cover.ts": 0.75,
  "packages/world/src/context.ts": 0.2,
  "engine/src/rpc.rs": 0.1,
  "app/renderer/flora/lab.ts": 0.68,
  "app/world-service/index.ts": 0.75,
};

/** One file for each tree in the lab, in the order the trees are planted. */
export const SAMPLE_FILES: readonly FileFacts[] = [
  file("packages/render/src/plant.ts", 470),
  file("packages/terrain/src/water.ts", 232),
  file("packages/world/src/planner.ts", 306),
  file("packages/primitives/src/geometry/foliage.ts", 757),
  file("packages/realize/src/sky.ts", 94),
  file("app/renderer/terrain/cover.ts", 284),
  file("packages/terrain/src/walk.ts", 142),
  file("packages/schema/src/fields.ts", 126),
  file("packages/world/src/context.ts", 91),
  file("packages/render/src/light.ts", 321),
  file("packages/terrain/src/scatter.ts", 181),
  file("packages/primitives/src/palettes.ts", 131),
  file("engine/src/rpc.rs", 140),
  file("packages/realize/src/day.ts", 70),
  file("app/renderer/flora/lab.ts", 455),
  file("packages/terrain/src/site.ts", 165),
  file("packages/world/src/answers.ts", 53),
  file("packages/primitives/src/geometry/skeleton.ts", 263),
  file("packages/render/src/shadow.ts", 78),
  file("packages/terrain/src/flow.ts", 79),
  file("app/world-service/index.ts", 51),
  file("packages/schema/src/hash.ts", 34),
];

const FORMS: Readonly<Record<EntityFacts["form"], string>> = { package: "Package", crate: "Rust crate", service: "Service", app: "App", module: "Module" };
const LANGUAGES: Readonly<Record<string, string>> = { typescript: "TypeScript", rust: "Rust" };
const count = (n: number, one: string): string => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;
/** The last part of a path, which names an entity among its neighbors; the root's entity is the repository's own. */
export const shortName = (path: string): string => path.split("/").filter(Boolean).pop() ?? "the repository";

export function representEntity(e: EntityFacts, vitality: number): Represented {
  return {
    id: e.path,
    name: e.name,
    what: FORMS[e.form],
    doc: "",
    where: e.path,
    size: [count(e.files, "file"), count(e.lines, "line"), count(e.exports, "export")].join(" · "),
    dependsOn: e.dependsOn.map(shortName),
    dependents: e.dependents.map(shortName),
    vitality,
  };
}

/** What a card says about a file. */
export function representFile(f: FileFacts, vitality: number): Represented {
  return {
    id: f.path,
    name: shortName(f.path),
    what: `File · ${LANGUAGES[f.language] ?? f.language}`,
    doc: "",
    where: f.path,
    size: count(f.lines, "line"),
    dependsOn: f.imports.map(shortName),
    dependents: f.importedBy.map(shortName),
    vitality,
  };
}
