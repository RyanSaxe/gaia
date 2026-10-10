// Writes the proving ground: a made-up codebase whose world holds every
// feature a world can show, so each can be walked up to and tested. It
// writes the code model (`app/renderer/terrain/fixtures/proving.json`, the
// shape `project.open` returns) and the choices Jev would make about it
// (`fixtures/proving-judged.json`, a `Judgments`), both from the plan below.
// The lab lays it out with the real `layoutWorld`, `standWorld` and bake
// (`?world=proving`), so what it shows is what any codebase would get.
//
// The plan holds, by construction:
// - areas, files and entities at every health from thriving to ruin: whole
//   areas in ruin, failing entities in thriving areas, mixed areas;
// - every building and landmark the judge can choose, each thriving, tired
//   and in ruin;
// - brooks, trickles and ponds, with dependencies drawn across them so trails
//   cross on footbridges and stepping stones;
// - large and tiny areas, deep nesting, and a hub many trails branch to;
// - every land, water, character, tree, bush and flower option.
// The generator checks the plan covers every option in `looks.ts`, and the
// lab's test checks the baked world shows each feature.
//
// `--code DIR` writes the proving ground's code instead: real source for
// every planned file, as poor as its health (tools/proving-code.ts), and a
// manifest saying how each was written, so the engine's bench can hold Jev's
// judgments to it. The manifest goes beside DIR (`DIR-manifest.json`, or
// `--manifest PATH`), never in it, where it would name every file and the
// engine would take each for used. Both must lie outside Gaia's own
// repository or under a node_modules folder, which Gaia's own world never
// reads.
//
// Usage: pnpm proving [--code DIR [--manifest PATH]]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { CodeModel, EntityFacts, EntityForm, FileFacts, FileKind, SymbolFact } from "@gaia/schema";
import { type Judgments, entityVitalityOf, layoutWorld } from "@gaia/world";
import { BUILDINGS, CHARACTERS, FORMS, LANDMARKS, LANDS, TRAILS, VIBES, WATERS } from "../app/renderer/terrain/looks.ts";
import { provingCode } from "./proving-code.ts";

/** How a file or an entity fares, from every signal clear to every signal failing; `decayed` is ruin with no tests at all, so it drags its entity down less. */
type Health = "thriving" | "well" | "tired" | "failing" | "ruin" | "decayed";

interface PlannedDir {
  readonly path: string;
  readonly health: Health;
  /** Each file as `name:lines`, or `name:lines:health` for one that fares differently from its directory. */
  readonly files: readonly string[];
  /** The land Jev would give it, when it is meant to have land of its own. */
  readonly land?: readonly [land: string, water: string, character: string];
  /** The entity rooted here, and what stands for it. */
  readonly entity?: { readonly form: EntityForm; readonly as: "building" | "landmark"; readonly look: string; readonly doc: string };
}

const B = (look: string, doc: string, form: EntityForm = "module") => ({ form, as: "building" as const, look, doc });
const L = (look: string, doc: string, form: EntityForm = "package") => ({ form, as: "landmark" as const, look, doc });

/**
 * The made-up codebase. Directory names say what each area is for, so the
 * minimap's name tells a person what they are looking at.
 */
const PLAN: readonly PlannedDir[] = [
  {
    path: "",
    health: "thriving",
    files: ["README.md:180", "CHANGELOG.md:260", "package.json:40", "tsconfig.json:30", "build.sh:70", "index.ts:160"],
    land: ["Home lawn", "No water", "Old meadow"],
    entity: L("Great willow", "The proving ground: a made-up codebase with every feature of a world in it, from thriving to ruin.", "package"),
  },
  // A brook runs through a thriving wood; its banks' entities lean on each other across it.
  { path: "crossings", health: "thriving", files: ["flow.ts:520", "channel.ts:480", "banks.ts:420", "weir.ts:360", "crossings.test.ts:180", "NOTES.md:90"], land: ["Brook valley", "A brook", "Deep wood"] },
  { path: "crossings/west-bank", health: "thriving", files: ["index.ts:140", "path.ts:300"], entity: B("Thatched cottage", "Keeps the west bank's paths: a small module doing one modest job.") },
  { path: "crossings/east-bank", health: "well", files: ["index.ts:120", "gate.ts:280"], entity: B("Storybook house", "The east bank's gatehouse: the process a person starts to cross.", "app") },
  { path: "crossings/mill", health: "thriving", files: ["package.json:30", "index.ts:160", "wheel.ts:380"], entity: B("Watermill", "Turns the brook's flow into work: a pipeline from one kind of data to another.", "package") },
  // A trickle through groves of mixed health, crossed by faint tracks on stepping stones.
  { path: "fords", health: "well", files: ["shallows.ts:460", "reeds.ts:380", "stones.ts:300", "fords.test.ts:140"], land: ["Meandering vale", "A trickle", "Groves and clearings"] },
  { path: "fords/jetty", health: "tired", files: ["index.ts:120", "landing.ts:340"], entity: B("Stone croft", "A plain, sturdy croft by the near side of the ford.", "crate") },
  { path: "fords/gravel", health: "tired", files: ["index.ts:110", "ring.ts:320"], entity: L("Stone ring", "The shared definitions both sides of the ford agree on.") },
  // A still pond in a wet hollow, and a meadow pond with a service on its shore.
  { path: "hollow", health: "thriving", files: ["package.json:30", "index.ts:220", "pool.ts:520", "depth.ts:420", "hollow.test.ts:160"], land: ["Mossy basin", "A still pond", "Wet hollow"], entity: L("Lantern tower", "Lights the rest: the entity every other area looks to.") },
  { path: "pondside", health: "well", files: ["server.ts:240", "queue.ts:420", "handoff.ts:380:failing", "pondside.test.ts:150"], land: ["Pond meadow", "A still pond", "Old meadow"], entity: B("Archive tower", "Keeps the records requests leave at the pond.", "service") },
  { path: "pondside/records", health: "tired", files: ["index.ts:100", "ledger.ts:300"], entity: B("Archive tower", "An archive gone tired: untested, complex, full of TODOs.") },
  // Hills, terraces, moor, dunes and downs: every remaining land, each without water so its own landform shows.
  { path: "hills", health: "thriving", files: ["slopes.ts:480", "crests.ts:420", "hills.test.ts:140"], land: ["Clover hills", "No water", "Groves and clearings"] },
  { path: "hills/kiln", health: "tired", files: ["index.ts:110", "fire.ts:300"], entity: B("Thatched cottage", "A cottage gone tired: untested and tangled.") },
  { path: "hills/oak", health: "thriving", files: ["package.json:30", "index.ts:180", "branches.ts:420"], entity: L("Great oak", "A large library the others build from.") },
  { path: "terraces", health: "thriving", files: ["steps.ts:420", "stages.test.ts:380", "order.test.ts:300", "pipeline.ts:360"], land: ["Silver terraces", "No water", "Rocky heath"] },
  { path: "terraces/croft", health: "thriving", files: ["Cargo.toml:30", "lib.rs:200", "press.rs:380"], entity: B("Stone croft", "Native code close to the machine, every test passing.", "crate") },
  { path: "terraces/ring", health: "ruin", files: ["package.json:30", "index.ts:160", "schema.ts:360"], entity: L("Stone ring", "Shared definitions in ruin: failing tests, compiler errors, nothing imports half of it.") },
  { path: "moor", health: "thriving", files: ["guide.md:620", "decisions.md:540", "glossary.md:360"], land: ["Heather moor", "No water", "Old meadow"] },
  { path: "moor/archive", health: "thriving", files: ["index.ts:120", "catalog.ts:320"], entity: B("Archive tower", "Keeps the definitions others read, in good order.") },
  { path: "moor/henge", health: "thriving", files: ["index.ts:120", "stones.ts:300"], entity: L("Stone ring", "The schema every entity agrees on, every test passing.") },
  { path: "dunes", health: "thriving", files: ["settings.json:700", "data.csv:900", "deploy.sh:220", "lint.toml:120"], land: ["Golden dunes", "No water", "Rocky heath"] },
  { path: "dunes/keep", health: "tired", files: ["Cargo.toml:30", "lib.rs:220", "guard.rs:380"], entity: L("Battlemented keep", "A guarded core gone tired.", "crate") },
  { path: "dunes/ledger", health: "ruin", files: ["index.ts:120", "entries.ts:300"], entity: B("Archive tower", "Records in ruin: failing tests and errors throughout.") },
  // The large area: a container of many subdirectories, nested deep, with a tiny one beside.
  { path: "downs", health: "thriving", files: ["index.ts:120", "atlas.ts:720", "survey.ts:640", "hedges.ts:520", "lanes.ts:460"], land: ["Broad downs", "No water", "Groves and clearings"], entity: L("Battlemented keep", "The guarded core the rest of the downs runs on.", "package") },
  { path: "downs/fields", health: "thriving", files: ["barley.ts:320", "rye.ts:280"] },
  { path: "downs/orchard", health: "well", files: ["apples.ts:300", "pears.ts:220", "orchard.test.ts:100"] },
  { path: "downs/oak", health: "tired", files: ["index.ts:120", "roots.ts:380"], entity: L("Great oak", "A great oak gone tired.") },
  { path: "downs/deep", health: "thriving", files: ["index.ts:120", "one.ts:160"], entity: B("Thatched cottage", "A module nested five deep, healthy at the top and in ruin at the bottom.") },
  { path: "downs/deep/deeper", health: "well", files: ["two.ts:140"] },
  { path: "downs/deep/deeper/deeper-still", health: "tired", files: ["three.ts:120"] },
  { path: "downs/deep/deeper/deeper-still/deepest", health: "failing", files: ["four.ts:110"] },
  { path: "downs/deep/deeper/deeper-still/deepest/bottom", health: "ruin", files: ["tmp2.ts:100"] },
  { path: "downs/tiny", health: "thriving", files: ["seed.ts:4"] },
  // Mixed: thriving files beside failing ones, one failing grove among them, and a tired mill and lantern.
  { path: "mixed", health: "thriving", files: ["main.ts:160", "sound.ts:520", "steady.ts:460", "failing-grove.ts:640:decayed", "patched.ts:420:tired", "mixed.test.ts:160"], land: ["Clover hills", "No water", "Deep wood"], entity: B("Watermill", "A pipeline with sound parts beside failing ones.", "package") },
  { path: "mixed/workshop", health: "tired", files: ["package.json:30", "index.ts:140", "gears.ts:400"], entity: B("Storybook house", "An application gone tired: untested and complex.", "app") },
  { path: "mixed/beacon", health: "tired", files: ["index.ts:120", "lamp.ts:340"], entity: L("Lantern tower", "A lantern tower gone tired.") },
  // Ruins: a whole area failing, its brook crossed by bridges in decline.
  { path: "ruins", health: "ruin", files: ["index.ts:140", "collapse.ts:620", "rubble.ts:520", "ruins.test.ts:160", "README.md:120"], land: ["Brook valley", "A brook", "Deep wood"], entity: L("Great willow", "A whole area in ruin: failing tests, compiler errors and dead code throughout.") },
  { path: "ruins/cottage", health: "ruin", files: ["index.ts:110", "hearth.ts:300"], entity: B("Thatched cottage", "A cottage in ruin.") },
  { path: "ruins/croft", health: "ruin", files: ["Cargo.toml:30", "lib.rs:200", "forge.rs:340"], entity: B("Stone croft", "A croft in ruin.", "crate") },
  { path: "ruins/house", health: "ruin", files: ["main.ts:150", "utils2.ts:320"], entity: B("Storybook house", "An application in ruin.", "app") },
  { path: "ruins/mill", health: "ruin", files: ["package.json:30", "index.ts:140", "race.ts:360"], entity: B("Watermill", "A mill in ruin.", "package") },
  { path: "ruins/keep", health: "ruin", files: ["Cargo.toml:30", "lib.rs:200", "walls.rs:380"], entity: L("Battlemented keep", "A keep in ruin.", "crate") },
  { path: "ruins/lighthouse", health: "ruin", files: ["index.ts:110", "lens.ts:300"], entity: L("Lantern tower", "A lantern tower in ruin.") },
  { path: "ruins/oak", health: "ruin", files: ["index.ts:110", "temp.ts:300"], entity: L("Great oak", "A great oak in ruin.") },
  { path: "hollow/willow", health: "tired", files: ["index.ts:110", "fronds.ts:300"], entity: L("Great willow", "A great willow gone tired.") },
];

/** Dependencies, as `from -> to`, with how a trail between them looks and how much Jev wants it. */
const TRAIL_PLAN: readonly (readonly [from: string, to: string, look: string, want: number])[] = [
  // Across the thriving brook: a footbridge (a worn footpath asks for one) and a stone-edged path.
  ["crossings/west-bank", "crossings/east-bank", "Worn footpath", 0.92],
  ["crossings/mill", "crossings/east-bank", "Stone-edged path", 0.8],
  ["crossings/west-bank", "crossings/mill", "Faint wandering track", 0.7],
  // Across the trickle: faint tracks only, so stepping stones.
  ["fords/jetty", "fords/gravel", "Faint wandering track", 0.9],
  // Across the ruined brook: a worn footpath and faint tracks between ruins.
  ["ruins/cottage", "ruins/mill", "Worn footpath", 0.9],
  ["ruins/croft", "ruins/keep", "Faint wandering track", 0.85],
  ["ruins/house", "ruins/lighthouse", "Stone-edged path", 0.8],
  ["ruins/oak", "ruins", "Faint wandering track", 0.75],
  ["ruins/keep", "ruins/house", "Faint wandering track", 0.7],
  // A hub: many entities lean on the hollow's lantern tower, so trunk paths branch at junctions.
  ["", "hollow", "Worn footpath", 0.95],
  ["crossings/mill", "hollow", "Worn footpath", 0.9],
  ["downs", "hollow", "Worn footpath", 0.88],
  ["hills/oak", "hollow", "Stone-edged path", 0.86],
  ["mixed", "hollow", "Stone-edged path", 0.84],
  ["pondside", "hollow", "Worn footpath", 0.83],
  ["terraces/croft", "hollow", "Faint wandering track", 0.8],
  ["fords/gravel", "hollow", "Stone-edged path", 0.78],
  ["ruins/mill", "hollow", "Faint wandering track", 0.76],
  // The rest of the world, joined.
  ["pondside/records", "pondside", "Faint wandering track", 0.7],
  ["hills/kiln", "hills/oak", "Faint wandering track", 0.7],
  ["terraces/ring", "terraces/croft", "Stone-edged path", 0.72],
  ["moor/archive", "", "Stone-edged path", 0.75],
  ["moor/henge", "moor/archive", "Faint wandering track", 0.7],
  ["dunes/keep", "downs", "Stone-edged path", 0.74],
  ["dunes/ledger", "dunes/keep", "Faint wandering track", 0.7],
  ["downs/oak", "downs", "Faint wandering track", 0.7],
  ["mixed/workshop", "mixed", "Stone-edged path", 0.72],
  ["mixed/beacon", "mixed", "Faint wandering track", 0.7],
  ["downs/deep", "downs", "Faint wandering track", 0.7],
  ["hollow/willow", "hollow", "Faint wandering track", 0.7],
  ["", "crossings/mill", "Stone-edged path", 0.7],
];

// ---------- facts from health ----------

const LANGUAGE: Readonly<Record<string, string>> = { ts: "typescript", rs: "rust", md: "markdown", json: "json", toml: "toml", sh: "shell", csv: "other" };
const KIND: Readonly<Record<string, FileKind>> = { ts: "source", rs: "source", md: "docs", json: "config", toml: "config", sh: "script", csv: "data" };
const kindOf = (name: string): FileKind => (/\.test\.ts$/.test(name) ? "test" : (KIND[name.split(".").pop() ?? ""] ?? "source"));

/** What each health means for a file's signals. */
const SIGNALS: Readonly<Record<Health, { tested: "own" | "none"; failing: boolean; errors: number; longest: number; nesting: number; lint: number; debt: number; unused: boolean; recent: number; lastDays: number }>> = {
  thriving: { tested: "own", failing: false, errors: 0, longest: 30, nesting: 2, lint: 0, debt: 0, unused: false, recent: 5, lastDays: 2 },
  well: { tested: "own", failing: false, errors: 0, longest: 80, nesting: 4, lint: 2, debt: 1, unused: false, recent: 2, lastDays: 9 },
  tired: { tested: "none", failing: false, errors: 0, longest: 130, nesting: 6, lint: 6, debt: 3, unused: false, recent: 0, lastDays: 70 },
  failing: { tested: "own", failing: true, errors: 0, longest: 70, nesting: 4, lint: 5, debt: 2, unused: false, recent: 1, lastDays: 30 },
  ruin: { tested: "own", failing: true, errors: 3, longest: 220, nesting: 9, lint: 10, debt: 5, unused: true, recent: 0, lastDays: 400 },
  decayed: { tested: "none", failing: false, errors: 3, longest: 220, nesting: 9, lint: 10, debt: 5, unused: true, recent: 0, lastDays: 400 },
};

const VERBS = ["gather", "weigh", "carry", "settle", "mend", "turn", "keep", "sort", "trace", "fold", "measure", "join"];
/** Who does each verb, where adding "er" misspells it. */
const AGENT: Readonly<Record<string, string>> = { carry: "carrier", settle: "settler", trace: "tracer", measure: "measurer" };
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const camel = (s: string): string => s.replace(/[-.](\w)/g, (_, c: string) => c.toUpperCase());

/** A source file's symbols: functions, a class, documented types and constants, sized from its lines. */
function symbolsFor(base: string, lines: number, index: number): SymbolFact[] {
  const stem = camel(base);
  const count = Math.max(1, Math.min(7, Math.round(lines / 70)));
  const out: SymbolFact[] = [];
  let line = 8;
  for (let k = 0; k < count; k++) {
    const verb = VERBS[(index * 5 + k) % VERBS.length] as string;
    const span = Math.max(4, Math.round((lines * 0.7) / count));
    const kind: SymbolFact["kind"] = k === 1 ? "class" : k === 2 ? "type" : k === 3 ? "constant" : "function";
    const name = kind === "class" ? `${cap(stem)}${cap(AGENT[verb] ?? `${verb}er`)}` : kind === "type" ? `${cap(stem)}${cap(verb)}` : kind === "constant" ? `${stem.toUpperCase()}_${verb.toUpperCase()}` : `${verb}${cap(stem)}`;
    out.push({ name, kind, exported: k % 3 !== 2 || kind === "type", doc: `${cap(verb)}s the ${base.replace(/-/g, " ")}.`, line, lines: kind === "type" || kind === "constant" ? Math.max(1, Math.round(span / 6)) : span });
    line += span + 2;
  }
  return out;
}

const hashOf = (text: string): string => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(2);
};

const parentOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const join = (dir: string, name: string): string => (dir === "" ? name : `${dir}/${name}`);

interface Drafted {
  path: string;
  dir: string;
  health: Health;
  kind: FileKind;
  lines: number;
  symbols: SymbolFact[];
  imports: Set<string>;
}

// The files, each with its health and symbols.
const drafted: Drafted[] = [];
PLAN.forEach((d) => {
  d.files.forEach((spec, i) => {
    const [name, lines, health] = spec.split(":") as [string, string, Health | undefined];
    const kind = kindOf(name);
    const base = name.replace(/\.(test\.)?\w+$/, "");
    drafted.push({ path: join(d.path, name), dir: d.path, health: health ?? d.health, kind, lines: Number(lines), symbols: kind === "source" ? symbolsFor(base === "index" || base === "lib" || base === "main" || base === "server" ? (d.path.split("/").pop() || "proving") : base, Number(lines), drafted.length + i) : [], imports: new Set() });
  });
});
const byPath = new Map(drafted.map((f) => [f.path, f]));
const entityDirs = PLAN.filter((d) => d.entity !== undefined).map((d) => d.path);
/** A path's innermost entity. */
const ownerOf = (path: string): string | undefined => entityDirs.filter((r) => r === "" || path === r || path.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
/** An entity's entry file: the one that gives it its public surface. */
const entryOf = (root: string): Drafted => {
  const own = drafted.filter((f) => f.dir === root && f.kind === "source");
  const entry = own.find((f) => /\/?(index|lib|main|server)\.\w+$/.test(f.path)) ?? own[0];
  if (entry === undefined) throw new Error(`${root} has no source file to be its entry.`);
  return entry;
};

// Imports: each directory's files import the one before (a chain the code flows along), a test imports
// its directory's sources, and every dependency in the trail plan is an import of the other's entry.
for (const d of PLAN) {
  const sources = drafted.filter((f) => f.dir === d.path && f.kind === "source");
  sources.forEach((f, i) => i > 0 && f.imports.add((sources[i - 1] as Drafted).path));
  for (const t of drafted.filter((f) => f.dir === d.path && f.kind === "test")) for (const s of sources) t.imports.add(s.path);
}
for (const [from, to] of TRAIL_PLAN) entryOf(from).imports.add(entryOf(to).path);

const importedBy = new Map<string, string[]>();
for (const f of drafted) for (const i of f.imports) importedBy.set(i, [...(importedBy.get(i) ?? []), f.path]);
/** The tests covering a file: test files importing it or a file it is imported by, transitively. */
const coveringTests = (path: string): string[] => {
  const seen = new Set<string>([path]);
  const queue = [path];
  const tests = new Set<string>();
  while (queue.length > 0) {
    const p = queue.shift() as string;
    for (const by of importedBy.get(p) ?? []) {
      if (seen.has(by)) continue;
      seen.add(by);
      if (byPath.get(by)?.kind === "test") tests.add(by);
      else queue.push(by);
    }
  }
  return [...tests].sort();
};

// A file its own entity tests is reached by the nearest test file up its tree, or by one named for it.
const testOf = (dir: string): string | undefined => {
  for (let p: string | null = dir; p !== null; p = p === "" ? null : parentOf(p)) {
    const t = drafted.find((f) => f.dir === p && f.kind === "test");
    if (t !== undefined) return t.path;
  }
  return undefined;
};

const files: FileFacts[] = drafted.map((f) => {
  const s = SIGNALS[f.health];
  const prose = f.kind !== "source" && f.kind !== "test";
  const near = testOf(f.dir);
  const covering = new Set(coveringTests(f.path));
  // Health decides whether tests reach it: its own entity's, or none.
  if (f.kind === "source" && s.tested !== "none" && near !== undefined) covering.add(near);
  const coveredBy = f.kind === "source" ? [...covering].sort() : [];
  const own = s.tested === "own" ? coveredBy.filter((t) => ownerOf(t) === ownerOf(f.path)) : [];
  const ownTests = s.tested === "own" && own.length === 0 && f.kind === "source" ? [`${f.dir === "" ? "" : `${f.dir}/`}${f.path.split("/").pop()?.replace(/\.\w+$/, "")}.test.ts`] : own;
  const reached = s.tested === "own" ? [...new Set([...coveredBy, ...ownTests])].sort() : [];
  const symbols = f.symbols;
  return {
    path: f.path,
    language: LANGUAGE[f.path.split(".").pop() ?? ""] ?? "other",
    kind: f.kind,
    contentHash: hashOf(`${f.path}:${f.lines}:${f.health}`),
    lines: f.lines,
    symbols,
    imports: [...f.imports].sort(),
    importedBy: [...(importedBy.get(f.path) ?? [])].sort(),
    ...(f.kind === "source" ? { doc: `The ${f.path.split("/").pop()?.replace(/\.\w+$/, "")} of ${f.dir === "" ? "the proving ground" : f.dir}, ${f.health}.` } : {}),
    tests: {
      coveredBy: f.kind === "source" ? reached : [],
      own: f.kind === "source" ? ownTests : [],
      failing: f.kind === "source" && s.failing ? reached : [],
    },
    complexity: prose ? { functions: 0, longestFunction: 0, maxNesting: 0 } : { functions: symbols.filter((y) => y.kind === "function").length, longestFunction: s.longest, maxNesting: s.nesting },
    diagnostics: { errors: s.errors, warnings: s.lint, lint: s.lint },
    debtMarkers: s.debt,
    unused: s.unused && f.kind === "source" && (importedBy.get(f.path) ?? []).every((b) => byPath.get(b)?.kind === "test"),
    git: { daysSinceFirstCommit: 420, daysSinceLastCommit: s.lastDays, commitsLast14Days: s.recent, commits: 6 + s.recent * 4, authors: f.health === "ruin" ? 1 : 3 },
  } satisfies FileFacts;
});

// ---------- entities, summed from their files ----------

/** Each entity's dependents: the entities with a file importing one of its files. */
const dependents = new Map<string, string[]>();
for (const f of files) {
  const from = ownerOf(f.path);
  for (const i of f.imports) {
    const to = ownerOf(i);
    if (from === undefined || to === undefined || to === from || dependents.get(to)?.includes(from)) continue;
    dependents.set(to, [...(dependents.get(to) ?? []), from].sort());
  }
}
const entities: EntityFacts[] = PLAN.filter((d) => d.entity !== undefined).map((d) => {
  const plan = d.entity as NonNullable<PlannedDir["entity"]>;
  const mine = files.filter((f) => ownerOf(f.path) === d.path);
  const sources = mine.filter((f) => f.kind === "source");
  const tests = mine.filter((f) => f.kind === "test");
  const depends = new Set<string>();
  for (const f of mine) for (const i of f.imports) {
    const o = ownerOf(i);
    if (o !== undefined && o !== d.path) depends.add(o);
  }
  const entry = entryOf(d.path);
  const exported = files.find((f) => f.path === entry.path)?.symbols.filter((s) => s.exported).length ?? 0;
  const manifest = mine.find((f) => /(^|\/)(package\.json|Cargo\.toml)$/.test(f.path) && parentOf(f.path) === d.path)?.path;
  const ownFailing = new Set(sources.flatMap((f) => f.tests.failing.filter((t) => ownerOf(t) === d.path)));
  const ownTests = new Set([...tests.map((t) => t.path), ...sources.flatMap((f) => f.tests.own)]);
  const sum = (pick: (f: FileFacts) => number): number => mine.reduce((n, f) => n + pick(f), 0);
  return {
    path: d.path,
    name: d.path === "" ? "proving" : (d.path.split("/").pop() as string),
    form: plan.form,
    ...(manifest === undefined ? {} : { manifest }),
    entry: entry.path,
    doc: plan.doc,
    files: mine.length,
    lines: sum((f) => f.lines),
    languages: [...new Set(mine.map((f) => f.language).filter((l) => l === "typescript" || l === "rust"))],
    exports: exported,
    dependsOn: [...depends].sort(),
    dependents: dependents.get(d.path) ?? [],
    tests: { files: ownTests.size, failing: ownFailing.size, covered: sources.length === 0 ? 1 : sources.filter((f) => f.tests.coveredBy.length > 0).length / sources.length },
    diagnostics: { errors: sum((f) => f.diagnostics.errors), warnings: sum((f) => f.diagnostics.warnings), lint: sum((f) => f.diagnostics.lint) },
    debtMarkers: sum((f) => f.debtMarkers),
    unusedExports: sources.length === 0 ? 0 : sources.filter((f) => f.unused).length / sources.length,
    git: { daysSinceFirstCommit: 420, commitsLast14Days: sum((f) => f.git.commitsLast14Days), contributors: d.health === "ruin" ? 1 : 3 },
  };
});

const languages: Record<string, number> = {};
for (const f of files) languages[f.language] = (languages[f.language] ?? 0) + f.lines;
const model: CodeModel = {
  projectId: "proving",
  repository: { name: "proving", files: files.length, lines: files.reduce((n, f) => n + f.lines, 0), languages, ageDays: 420, commitsLast30Days: 60, contributors: 3 },
  files: [...files].sort((a, b) => (a.path < b.path ? -1 : 1)),
  entities: [...entities].sort((a, b) => (a.path < b.path ? -1 : 1)),
};

// ---------- what Jev would choose ----------

const vibes: Record<string, string> = {};
const forms: Record<string, Record<string, string>> = {};
const needsTests: Record<string, number> = {};
const trees = Object.keys(VIBES).filter((v) => v !== "Open meadow");
const formKeys = Object.keys(FORMS);
let tree = 0;
let form = 0;
for (const f of model.files) {
  const acts = f.kind === "source" || f.kind === "script";
  vibes[f.path] = acts ? (trees[tree++ % trees.length] as string) : "Open meadow";
  needsTests[f.path] = f.kind === "source" ? 0.85 : 0.1;
  if (f.kind === "source" && f.symbols.length > 0) forms[f.path] = Object.fromEntries(f.symbols.map((s) => [`#${s.name}`, formKeys[form++ % formKeys.length] as string]));
}
const judged: Judgments = {
  world: "Meadow morning",
  lands: Object.fromEntries(PLAN.flatMap((d) => (d.land === undefined ? [] : [[d.path, d.land[0]]]))),
  waters: Object.fromEntries(PLAN.flatMap((d) => (d.land === undefined ? [] : [[d.path, d.land[1]]]))),
  characters: Object.fromEntries(PLAN.flatMap((d) => (d.land === undefined ? [] : [[d.path, d.land[2]]]))),
  vibes,
  things: Object.fromEntries(PLAN.flatMap((d) => (d.entity === undefined ? [] : [[d.path, { as: d.entity.as, look: d.entity.look }]]))),
  trails: TRAIL_PLAN.map(([from, to, look, want]) => ({ from, to, want, look })),
  forms,
  needsTests,
};

// ---------- the plan covers every option, and lays out as planned ----------

const missing = (what: string, options: Readonly<Record<string, unknown>>, used: Iterable<string>): string[] => {
  const seen = new Set(used);
  return Object.keys(options).filter((k) => !seen.has(k)).map((k) => `${what} "${k}"`);
};
const things = Object.values(judged.things);
const gaps = [
  ...missing("land", LANDS, Object.values(judged.lands)),
  ...missing("water", WATERS, Object.values(judged.waters)),
  ...missing("character", CHARACTERS, Object.values(judged.characters)),
  ...missing("vibe", VIBES, Object.values(vibes)),
  ...missing("form", FORMS, Object.values(forms).flatMap((f) => Object.values(f))),
  ...missing("trail", TRAILS, judged.trails.map((t) => t.look)),
  ...Object.keys(BUILDINGS).flatMap((b) => (things.filter((t) => t.as === "building" && t.look === b).length >= 3 ? [] : [`three buildings "${b}"`])),
  ...Object.keys(LANDMARKS).flatMap((l) => (things.filter((t) => t.as === "landmark" && t.look === l).length >= 3 ? [] : [`three landmarks "${l}"`])),
];
if (gaps.length > 0) throw new Error(`The proving ground lacks ${gaps.join(", ")}.`);
const world = layoutWorld(model, judged);
const regions = world.regions.map((r) => r.area);
const planned = Object.keys(judged.lands);
const astray = [...planned.filter((p) => !regions.includes(p)).map((p) => `${p || "(root)"} has no land of its own`), ...regions.filter((p) => !planned.includes(p)).map((p) => `${p} has land but no planned look`)];
if (astray.length > 0) throw new Error(`The proving ground lays out differently from its plan: ${astray.join("; ")}.`);

const repo = resolve(import.meta.dirname, "..");
const args = parseArgs({ options: { code: { type: "string" }, manifest: { type: "string" } } }).values;
if (args.code !== undefined) {
  const dir = resolve(args.code);
  const manifestPath = resolve(args.manifest ?? `${dir}-manifest.json`);
  for (const path of [dir, manifestPath]) {
    const inside = relative(repo, path);
    if (!inside.startsWith("..") && !inside.split("/").includes("node_modules")) throw new Error(`Write the proving ground's code and manifest outside Gaia's repository or under node_modules, or Gaia's own world reads them: ${path}.`);
  }
  if (!relative(dir, manifestPath).startsWith("..")) throw new Error(`Write the manifest beside the code, not in it, or the engine takes every file it names for used: ${manifestPath}.`);
  const vitality = new Map(world.patches.map((p) => [p.path, p.vitality]));
  const { code, manifest } = provingCode(files.map((facts, i) => ({ facts, health: (drafted[i] as Drafted).health, vitality: vitality.get(facts.path) ?? 1 })));
  for (const [path, text] of code) {
    mkdirSync(dirname(resolve(dir, path)), { recursive: true });
    writeFileSync(resolve(dir, path), text);
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
  const lines = [...code.values()].reduce((n, text) => n + text.split("\n").length - 1, 0);
  console.log(`proving: wrote ${code.size} files, ${lines.toLocaleString("en-US")} lines, to ${dir}, and the manifest of ${manifest.length} source files to ${manifestPath}`);
  process.exit(0);
}
const fixtures = resolve(repo, "app/renderer/terrain/fixtures");
writeFileSync(resolve(fixtures, "proving.json"), `${JSON.stringify(model)}\n`);
writeFileSync(resolve(fixtures, "proving-judged.json"), `${JSON.stringify(judged, null, 1)}\n`);
const band = (v: number): string => (v >= 0.85 ? "thriving" : v >= 0.6 ? "well" : v >= 0.35 ? "tired" : v >= 0.12 ? "failing" : "ruin");
const count = (vs: readonly number[]): string => Object.entries(vs.reduce<Record<string, number>>((n, v) => ((n[band(v)] = (n[band(v)] ?? 0) + 1), n), {})).map(([k, n]) => `${n} ${k}`).join(", ");
console.log(`proving: ${model.files.length} files, ${model.repository.lines.toLocaleString("en-US")} lines, ${entities.length} entities; a ${world.size} m world of ${world.regions.length} lands and ${world.areas.length} areas`);
console.log(`  files: ${count(world.patches.map((p) => p.vitality))}`);
console.log(`  entities: ${count(entities.map((e) => entityVitalityOf(e).vitality))}`);
