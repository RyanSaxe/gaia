// Sample code for the terrain lab, standing in for what the engine will
// report: six of Gaia's own entities, which become its buildings, more for
// its landmarks, and files for its trees. Their vitality comes from the same
// formulas the world service will run, so what a building or tree looks like
// and what its card says always agree.

import type { EntityFacts, FileFacts } from "@gaia/schema";
import { type VitalityReport, entityVitalityOf, vitalityOf } from "@gaia/world";

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
  readonly report: VitalityReport;
}

/** An entity and the building that stands for it. */
export interface SampleEntity {
  readonly facts: EntityFacts;
  /** The hand-filled building Jev might choose for it. */
  readonly building: string;
}

const entity = (e: Partial<EntityFacts> & Pick<EntityFacts, "path" | "name" | "form" | "doc">): EntityFacts => ({
  files: 10,
  lines: 1500,
  languages: ["typescript"],
  exports: 20,
  dependsOn: [],
  dependents: [],
  tests: { files: 4, failing: 0, covered: 0.9 },
  diagnostics: { errors: 0, warnings: 0, lint: 0 },
  debtMarkers: 0,
  unusedExports: 0,
  git: { daysSinceFirstCommit: 40, commitsLast14Days: 4, contributors: 2 },
  ...e,
});

export const SAMPLE_ENTITIES: readonly SampleEntity[] = [
  {
    building: "Thatched cottage",
    facts: entity({
      path: "packages/schema",
      name: "@gaia/schema",
      form: "package",
      manifest: "packages/schema/package.json",
      entry: "packages/schema/src/index.ts",
      doc: "The type builder, ports and vitality channels, primitive and kind contracts, code facts, the world document and Jev's wire format.",
      files: 11,
      lines: 1180,
      exports: 64,
      dependents: ["packages/primitives", "packages/kinds", "packages/world", "packages/realize", "packages/render", "packages/terrain", "app"],
      tests: { files: 3, failing: 0, covered: 0.92 },
      diagnostics: { errors: 0, warnings: 0, lint: 1 },
      debtMarkers: 0,
    }),
  },
  {
    building: "Watermill",
    facts: entity({
      path: "packages/realize",
      name: "@gaia/realize",
      form: "package",
      manifest: "packages/realize/package.json",
      entry: "packages/realize/src/index.ts",
      doc: "Turns stored blueprints into geometry: world and region looks at an hour, the light between a day's keys, the sky and the air.",
      files: 8,
      lines: 2140,
      exports: 38,
      dependsOn: ["packages/schema", "packages/primitives"],
      dependents: ["packages/render", "packages/terrain", "app"],
      tests: { files: 8, failing: 1, covered: 0.75 },
      diagnostics: { errors: 0, warnings: 2, lint: 12 },
      debtMarkers: 4,
      unusedExports: 0.1,
    }),
  },
  {
    building: "Archive tower",
    facts: entity({
      path: "engine",
      name: "gaia-engine",
      form: "crate",
      manifest: "engine/Cargo.toml",
      entry: "engine/src/main.rs",
      doc: "Files, parsing, git, test reports, the code model, the app-data store and the Jev client.",
      files: 6,
      lines: 3400,
      languages: ["rust"],
      exports: 22,
      dependents: ["app", "packages/world", "packages/schema", "packages/terrain", "packages/realize", "packages/render"],
      tests: { files: 5, failing: 3, covered: 0.4 },
      diagnostics: { errors: 4, warnings: 9, lint: 21 },
      debtMarkers: 11,
      unusedExports: 0.3,
    }),
  },
  {
    building: "Merchant's hall",
    facts: entity({
      path: "app/world-service",
      name: "world-service",
      form: "service",
      entry: "app/world-service/index.ts",
      doc: "The world service: kinds, primitives, the question planner, answer rules, vitality and the world document.",
      files: 9,
      lines: 2600,
      exports: 46,
      dependsOn: ["packages/schema", "packages/world", "packages/kinds", "packages/primitives"],
      dependents: ["app"],
      tests: { files: 3, failing: 0, covered: 0.7 },
      diagnostics: { errors: 0, warnings: 1, lint: 3 },
      debtMarkers: 2,
    }),
  },
  {
    building: "Gathered farmstead",
    facts: entity({
      path: "app/renderer/terrain",
      name: "terrain lab",
      form: "module",
      entry: "app/renderer/terrain/lab.ts",
      doc: "The terrain lab: a whole world baked on workers, walked at eye height.",
      files: 17,
      lines: 4600,
      exports: 18,
      dependsOn: ["packages/terrain", "packages/render", "packages/realize"],
      tests: { files: 1, failing: 0, covered: 0.3 },
      diagnostics: { errors: 0, warnings: 3, lint: 8 },
      debtMarkers: 5,
      unusedExports: 0.15,
    }),
  },
  {
    building: "Stone croft",
    facts: entity({
      path: "app/main",
      name: "main",
      form: "module",
      entry: "app/main/index.ts",
      doc: "Electron's main process: the window and the app's lifecycle, the engine and the world service.",
      files: 4,
      lines: 420,
      exports: 6,
      dependsOn: ["packages/schema"],
      dependents: ["app"],
      tests: { files: 1, failing: 1, covered: 0.25 },
      diagnostics: { errors: 1, warnings: 4, lint: 6 },
      debtMarkers: 6,
      unusedExports: 0.4,
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
    doc: "Relief, the baked heightfield, water, walking and swimming, and where everything stands.",
    files: 17,
    lines: 4200,
    exports: 70,
    dependsOn: ["packages/schema", "packages/primitives", "packages/realize"],
    dependents: ["app"],
    tests: { files: 4, failing: 0, covered: 0.95 },
  }),
  entity({
    path: "app",
    name: "@gaia/app",
    form: "app",
    doc: "Electron main, the world service and the renderer: the lab.",
    files: 40,
    lines: 9800,
    exports: 6,
    dependsOn: ["packages/schema", "packages/world", "packages/realize", "packages/render", "packages/terrain", "engine"],
    tests: { files: 4, failing: 3, covered: 0.25 },
    diagnostics: { errors: 3, warnings: 14, lint: 30 },
    debtMarkers: 16,
    unusedExports: 0.2,
  }),
  entity({
    path: "packages/primitives",
    name: "@gaia/primitives",
    form: "package",
    doc: "Primitive declarations and geometry, palettes and the manifest.",
    files: 28,
    lines: 7600,
    exports: 90,
    dependsOn: ["packages/schema"],
    dependents: ["packages/realize", "packages/terrain", "app"],
    tests: { files: 1, failing: 0, covered: 0.9 },
  }),
  entity({
    path: "packages/render",
    name: "@gaia/render",
    form: "package",
    doc: "Three.js materials, light and shadow, and instanced copies of a component.",
    files: 7,
    lines: 1900,
    exports: 24,
    dependsOn: ["packages/schema", "packages/realize"],
    dependents: ["app"],
    tests: { files: 5, failing: 1, covered: 0.6 },
    diagnostics: { errors: 0, warnings: 3, lint: 6 },
    debtMarkers: 3,
  }),
  entity({
    path: "packages/world",
    name: "@gaia/world",
    form: "package",
    doc: "The question planner, answer rules, context gathering, vitality and the world document.",
    files: 9,
    lines: 980,
    exports: 31,
    dependsOn: ["packages/schema"],
    dependents: ["app", "packages/realize"],
    tests: { files: 4, failing: 0, covered: 0.9 },
    diagnostics: { errors: 0, warnings: 0, lint: 2 },
    debtMarkers: 1,
  }),
  entity({
    path: "tools",
    name: "tools",
    form: "module",
    doc: "The lab's build, phone serving and telemetry scripts.",
    files: 6,
    lines: 700,
    exports: 4,
    tests: { files: 2, failing: 2, covered: 0.2 },
    diagnostics: { errors: 1, warnings: 6, lint: 8 },
    debtMarkers: 6,
    unusedExports: 0.5,
  }),
  entity({
    path: "packages/kinds",
    name: "@gaia/kinds",
    form: "package",
    doc: "The flora, structure, rock, wildflowers, landmark, link, biome and world kinds.",
    files: 9,
    lines: 260,
    exports: 8,
    dependsOn: ["packages/schema"],
    dependents: ["app", "packages/world"],
    tests: { files: 1, failing: 0, covered: 0.6 },
  }),
];

const file = (path: string, lines: number, doc: string, health: Partial<FileFacts> = {}): FileFacts => ({
  path,
  language: path.endsWith(".rs") ? "rust" : "typescript",
  contentHash: "",
  lines,
  symbols: [],
  imports: [],
  importedBy: [],
  doc,
  tests: { coveredBy: ["test"], failing: [] },
  complexity: { functions: 8, longestFunction: 40, maxNesting: 3 },
  diagnostics: { errors: 0, warnings: 0, lint: 0 },
  debtMarkers: 0,
  unused: false,
  git: { daysSinceFirstCommit: 30, commitsLast14Days: 2 },
  ...health,
});

const untested = { tests: { coveredBy: [], failing: [] } };
const failing = { tests: { coveredBy: ["test"], failing: ["test"] } };

/** One file for each tree in the lab, in the order the trees are planted. */
export const SAMPLE_FILES: readonly FileFacts[] = [
  file("packages/render/src/plant.ts", 470, "A realized plant as Three.js meshes, its vitality channels applied on the GPU."),
  file("packages/terrain/src/water.ts", 232, "Streams and ponds solved from the ground and cut into it."),
  file("packages/world/src/planner.ts", 306, "Turns a kind into Jev questions and Jev answers into a blueprint."),
  file("packages/primitives/src/geometry/foliage.ts", 757, "Leaf clumps, strands and needle sprays on a skeleton's tips.", { complexity: { functions: 22, longestFunction: 150, maxNesting: 6 } }),
  file("packages/realize/src/sky.ts", 94, "The sky and the air between the eye and the land."),
  file("app/renderer/terrain/cover.ts", 284, "Grass blades in each region's cover, thinning whole with distance.", untested),
  file("packages/terrain/src/walk.ts", 142, "Walking and wading: every step is pure, so tests check each one."),
  file("packages/schema/src/fields.ts", 126, "The type language: every field is a closed set."),
  file("packages/world/src/context.ts", 91, "Grows Jev's context only where it is unsure.", failing),
  file("packages/render/src/light.ts", 321, "Scene-wide light, shared by reference with every material."),
  file("packages/terrain/src/scatter.ts", 181, "Rocks in groups, bushes in thickets and flowers in drifts."),
  file("packages/primitives/src/palettes.ts", 131, "Color families from the world design system."),
  file("engine/src/rpc.rs", 140, "Newline-delimited JSON-RPC over the engine's stdin and stdout.", { ...failing, diagnostics: { errors: 2, warnings: 3, lint: 6 } }),
  file("packages/realize/src/day.ts", 70, "The light at any hour, between a day's keys."),
  file("app/renderer/flora/lab.ts", 455, "The flora lab: a row of plants and a cottage, at any vitality.", { ...untested, debtMarkers: 3 }),
  file("packages/terrain/src/site.ts", 165, "Where a building stands and how it meets the ground."),
  file("packages/world/src/answers.ts", 53, "Keeps a stored answer unless a fresh one wins by a margin."),
  file("packages/primitives/src/geometry/skeleton.ts", 263, "Branching trunks and limbs."),
  file("packages/render/src/shadow.ts", 78, "The sun's shadow, world-locked so it never shimmers."),
  file("packages/terrain/src/flow.ts", 79, "Which way and how fast each stream runs."),
  file("app/world-service/index.ts", 51, "The world service: kinds, primitives, the planner and the document.", untested),
  file("packages/schema/src/hash.ts", 34, "Content identity: equal answers name the same blueprint."),
];

const FORMS: Readonly<Record<EntityFacts["form"], string>> = { package: "Package", crate: "Rust crate", service: "Service", app: "App", module: "Module" };
const LANGUAGES: Readonly<Record<string, string>> = { typescript: "TypeScript", rust: "Rust" };
const count = (n: number, one: string): string => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;
/** The last part of a path, which names an entity among its neighbors. */
export const shortName = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;

export function representEntity(e: EntityFacts): Represented {
  return {
    id: e.path,
    name: e.name,
    what: [FORMS[e.form], ...e.languages.map((l) => LANGUAGES[l] ?? l)].join(" · "),
    doc: e.doc ?? "",
    where: e.path,
    size: [count(e.files, "file"), count(e.lines, "line"), count(e.exports, "export")].join(" · "),
    dependsOn: e.dependsOn.map(shortName),
    dependents: e.dependents.map(shortName),
    report: entityVitalityOf(e),
  };
}

export function representFile(f: FileFacts): Represented {
  return {
    id: f.path,
    name: shortName(f.path),
    what: `File · ${LANGUAGES[f.language] ?? f.language}`,
    doc: f.doc ?? "",
    where: f.path,
    size: count(f.lines, "line"),
    dependsOn: f.imports.map(shortName),
    dependents: f.importedBy.map(shortName),
    report: vitalityOf(f),
  };
}
