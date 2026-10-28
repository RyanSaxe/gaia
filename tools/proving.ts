// Writes the proving ground, a made-up codebase whose world contains every
// feature a world can show, so each can be walked up to and tested. It writes
// the facts its world is laid out from (`CodeFacts`, in
// `app/renderer/terrain/fixtures/proving.json`) and the choices Jev would make
// about it (a `Judgments`, in `fixtures/proving-judged.json`), both from the
// plan below, or into `--out DIR`. They are never committed. The lab, the app
// and the tests generate them from this plan as they build
// (tools/proving-ground.ts). The lab lays the world out with the real
// `layoutWorld`, `standWorld` and bake (`?world=proving`), so it shows what
// any codebase would get.
//
// The plan contains, by construction:
// - areas, files and entities at every health from `thriving` to `ruin`, with
//   whole areas in ruin, failing entities in thriving areas, and mixed areas
// - brooks, trickles and ponds, with dependencies drawn across them so trails
//   cross on footbridges and stepping stones
// - large and tiny areas, deep nesting, and a hub many trails branch to
// - every water, tree, bush and flower option Jev is offered
// Its sky, lands, buildings, landmarks, trails, trees, bushes, stones and
// flowers come from the sweep of what Jev composes them from (`sweep` in
// @gaia/world): every part of every slot and every frame with every crown, at
// each of three healths, and every option of every part. Each is placed where
// its place allows, such as a waterwheel only by running water. The generator
// fails while any sweep leaves something missing, and then the plan needs
// another place for it. The lab's test checks that the baked world shows each
// feature.
//
// `--code DIR` writes the proving ground's code instead: real source for every
// planned file, as poor as its health (tools/proving-code.ts), and a manifest
// of how each was written. The manifest goes beside DIR (`DIR-manifest.json`,
// or `--manifest PATH`), never in it, where it would name every file and the
// engine would count each as used. Both must be outside Gaia's own repository
// or under a node_modules folder, which Gaia's own world never reads.
//
// Usage: pnpm proving [--out DIR] [--code DIR [--manifest PATH]]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import type { AnyKind, Blueprint, CodeFacts, EntityFacts, EntityForm, FileFacts, Library, SymbolFact } from "@gaia/schema";
import { type Judgments, type Look, type FormKind, type SweepPlace, layoutWorld, raisedAs, sweep } from "@gaia/world";
import { COMPOSED_FORMS, COMPOSING, FORMS, WATERS, WILD_GROUNDS } from "../app/renderer/terrain/looks.ts";
import { fixtureJson } from "./fixture-json.ts";
import { provingCode } from "./proving-code.ts";

/** A planned file's or entity's health, from `thriving` to `ruin`. `decayed` is ruin with no tests at all, so it lowers its entity's quality less. */
type Health = "thriving" | "well" | "tired" | "failing" | "ruin" | "decayed";

/** The quality each health represents, on the scale of Jev's quality, which sets the proving ground's vitality. */
const QUALITY: Readonly<Record<Health, number>> = { thriving: 1, well: 0.75, tired: 0.5, failing: 0.25, decayed: 0.1, ruin: 0.03 };

interface PlannedDir {
  readonly path: string;
  readonly health: Health;
  /** Each file as `name:lines`, or `name:lines:health` for one whose health differs from its directory's. */
  readonly files: readonly string[];
  /** The water key for its land (`WATERS`), for a directory meant to have land of its own. */
  readonly water?: string;
  /** The landform its land uses when its name promises one, such as a directory called "dunes". Otherwise the sweep chooses. */
  readonly landform?: string;
  /** The entity rooted here, whether it appears as a building or a landmark, and what it does. */
  readonly entity?: { readonly form: EntityForm; readonly as: "building" | "landmark"; readonly doc: string };
}

const B = (doc: string, form: EntityForm = "package") => ({ form, as: "building" as const, doc });
const L = (doc: string, form: EntityForm = "package") => ({ form, as: "landmark" as const, doc });

/**
 * The made-up codebase. Directory names describe what each area is for, so
 * the minimap's labels show a person what they are looking at.
 */
const PLAN: readonly PlannedDir[] = [
  {
    path: "",
    health: "thriving",
    files: ["README.md:180", "CHANGELOG.md:260", "package.json:40", "tsconfig.json:30", "build.sh:70", "index.ts:160"],
    water: "No water",
    entity: L("The proving ground: a made-up codebase with every feature of a world in it, from thriving to ruin.", "package"),
  },
  // A brook runs through a thriving wood, and the entities on its banks depend on each other across it.
  { path: "crossings", health: "thriving", files: ["flow.ts:520", "channel.ts:480", "banks.ts:420", "weir.ts:360", "crossings.test.ts:180", "NOTES.md:90"], water: "A brook" },
  { path: "crossings/west-bank", health: "thriving", files: ["package.json:30", "index.ts:140", "path.ts:300"], entity: B("Keeps the west bank's paths: a small module doing one modest job.") },
  { path: "crossings/east-bank", health: "thriving", files: ["package.json:30", "index.ts:120", "gate.ts:280"], entity: B("The east bank's gatehouse: the process a person starts to cross.") },
  { path: "crossings/mill", health: "thriving", files: ["package.json:30", "index.ts:160", "wheel.ts:380"], entity: B("Turns the brook's flow into work: a pipeline from one kind of data to another.", "package") },
  // A trickle through groves of mixed health.
  { path: "fords", health: "well", files: ["shallows.ts:460", "reeds.ts:380", "stones.ts:300", "fords.test.ts:140"], water: "A trickle" },
  { path: "fords/jetty", health: "tired", files: ["Cargo.toml:30", "index.ts:120", "landing.ts:340"], entity: B("Lands what comes across the ford: a small crate gone tired.", "crate") },
  { path: "fords/gravel", health: "tired", files: ["package.json:30", "index.ts:110", "ring.ts:320"], entity: L("The shared definitions both sides of the ford agree on.") },
  // A still pond in a wet hollow, and a meadow pond with a service on its shore.
  { path: "hollow", health: "thriving", files: ["package.json:30", "index.ts:220", "pool.ts:520", "depth.ts:420", "hollow.test.ts:160"], water: "A still pond", entity: L("Lights the rest: the entity every other area looks to.") },
  { path: "pondside", health: "well", files: ["package.json:30", "server.ts:240", "queue.ts:420", "inlet.ts:520", "eddies.ts:480", "handoff.ts:380:failing", "pondside.test.ts:150"], water: "A still pond", entity: B("Keeps the records requests leave at the pond.") },
  { path: "pondside/records", health: "tired", files: ["package.json:30", "index.ts:100", "ledger.ts:300"], entity: B("Old records gone tired: untested, complex, full of TODOs.") },
  // Areas without water, each named for its landform, so that landform shows.
  { path: "hills", health: "thriving", files: ["slopes.ts:480", "crests.ts:420", "hills.test.ts:140"], water: "No water", landform: "rolling-hills@1" },
  { path: "hills/kiln", health: "tired", files: ["package.json:30", "index.ts:110", "fire.ts:300"], entity: B("Fires the hills' clay: a module gone tired, untested and tangled.") },
  { path: "hills/oak", health: "thriving", files: ["package.json:30", "index.ts:180", "branches.ts:420"], entity: L("A large library the others build from.") },
  { path: "terraces", health: "thriving", files: ["steps.ts:420", "stages.test.ts:380", "order.test.ts:300", "pipeline.ts:360"], water: "No water", landform: "terraces@1" },
  { path: "terraces/croft", health: "thriving", files: ["Cargo.toml:30", "lib.rs:200", "press.rs:380"], entity: B("Native code close to the machine, every test passing.", "crate") },
  { path: "terraces/ring", health: "ruin", files: ["package.json:30", "index.ts:160", "schema.ts:360"], entity: L("Shared definitions in ruin: failing tests, compiler errors, nothing imports half of it.") },
  { path: "moor", health: "thriving", files: ["guide.md:620", "decisions.md:540", "glossary.md:360"], water: "No water", landform: "meadow@1" },
  { path: "moor/archive", health: "thriving", files: ["package.json:30", "index.ts:120", "catalog.ts:320"], entity: B("Keeps the definitions others read, in good order.") },
  { path: "moor/henge", health: "thriving", files: ["package.json:30", "index.ts:120", "stones.ts:300"], entity: L("The schema every entity agrees on, every test passing.") },
  { path: "dunes", health: "thriving", files: ["settings.json:700", "data.csv:900", "deploy.sh:220", "lint.toml:120"], water: "No water", landform: "dunes@1" },
  { path: "dunes/keep", health: "tired", files: ["Cargo.toml:30", "lib.rs:220", "guard.rs:380"], entity: L("A guarded core gone tired.", "crate") },
  { path: "dunes/ledger", health: "ruin", files: ["package.json:30", "index.ts:120", "entries.ts:300"], entity: B("Records in ruin: failing tests and errors throughout.") },
  // The large area: a container of many subdirectories, nested deep, with a tiny one beside.
  { path: "downs", health: "thriving", files: ["package.json:30", "index.ts:120", "atlas.ts:720", "survey.ts:640", "hedges.ts:520", "lanes.ts:460"], water: "No water", landform: "rolling-hills@1", entity: L("The guarded core the rest of the downs runs on.", "package") },
  { path: "downs/fields", health: "thriving", files: ["barley.ts:320", "rye.ts:280"] },
  { path: "downs/orchard", health: "well", files: ["apples.ts:300", "pears.ts:220", "orchard.test.ts:100"] },
  { path: "downs/oak", health: "tired", files: ["package.json:30", "index.ts:120", "roots.ts:380"], entity: L("The downs' roots: a library gone tired.") },
  { path: "downs/deep", health: "thriving", files: ["package.json:30", "index.ts:120", "one.ts:160"], entity: B("A module nested five deep, healthy at the top and in ruin at the bottom.") },
  { path: "downs/deep/deeper", health: "well", files: ["two.ts:140"] },
  { path: "downs/deep/deeper/deeper-still", health: "tired", files: ["three.ts:120"] },
  { path: "downs/deep/deeper/deeper-still/deepest", health: "failing", files: ["four.ts:110"] },
  { path: "downs/deep/deeper/deeper-still/deepest/bottom", health: "ruin", files: ["tmp2.ts:100"] },
  { path: "downs/tiny", health: "thriving", files: ["seed.ts:4"] },
  // Mixed: thriving files beside failing ones, one failing grove among them, and tired entities.
  { path: "mixed", health: "thriving", files: ["package.json:30", "main.ts:160", "sound.ts:520", "steady.ts:460", "failing-grove.ts:640:decayed", "patched.ts:420:tired", "mixed.test.ts:160"], water: "No water", entity: B("A plain, sturdy package whose sound parts stand beside failing ones.", "package") },
  { path: "mixed/workshop", health: "tired", files: ["package.json:30", "index.ts:140", "gears.ts:400"], entity: B("An application gone tired: untested and complex.") },
  { path: "mixed/beacon", health: "tired", files: ["package.json:30", "index.ts:120", "lamp.ts:340"], entity: L("Signals the others: a module gone tired.") },
  // Ruins: a whole area failing, its brook crossed by bridges in decline.
  { path: "ruins", health: "ruin", files: ["package.json:30", "index.ts:140", "collapse.ts:620", "rubble.ts:520", "ruins.test.ts:160", "README.md:120"], water: "A brook", entity: L("A whole area in ruin: failing tests, compiler errors and dead code throughout.") },
  { path: "ruins/cottage", health: "ruin", files: ["package.json:30", "index.ts:110", "hearth.ts:300"], entity: B("A home's hearth in ruin.") },
  { path: "ruins/croft", health: "ruin", files: ["Cargo.toml:30", "lib.rs:200", "forge.rs:340"], entity: B("A forge in ruin.", "crate") },
  { path: "ruins/house", health: "ruin", files: ["package.json:30", "main.ts:150", "utils2.ts:280"], entity: B("An application in ruin.") },
  { path: "ruins/mill", health: "ruin", files: ["package.json:30", "index.ts:140", "race.ts:360"], entity: B("A mill race in ruin.", "package") },
  { path: "ruins/keep", health: "ruin", files: ["Cargo.toml:30", "lib.rs:200", "walls.rs:380"], entity: L("A crate's walls in ruin.", "crate") },
  { path: "ruins/lighthouse", health: "ruin", files: ["package.json:30", "index.ts:110", "lens.ts:300"], entity: L("A lens in ruin.") },
  { path: "ruins/oak", health: "ruin", files: ["package.json:30", "index.ts:110", "temp.ts:300"], entity: L("Temporary code in ruin.") },
  { path: "hollow/willow", health: "tired", files: ["package.json:30", "index.ts:110", "fronds.ts:300"], entity: L("The hollow's fronds gone tired.") },
  // More lands, so every landform appears thriving, tired and in ruin.
  { path: "legacy", health: "ruin", files: ["old-api.ts:640", "compat.ts:560", "adapters.ts:480", "legacy.test.ts:160"], water: "No water" },
  { path: "attic", health: "ruin", files: ["boxes.ts:600", "trunk.ts:520", "dust.ts:460", "attic.test.ts:140"], water: "No water" },
  { path: "scrapyard", health: "decayed", files: ["wreck.ts:620", "parts.ts:540", "rust.ts:480"], water: "No water" },
  { path: "cellar", health: "ruin", files: ["damp.ts:580", "barrels.ts:520", "mould.ts:460", "cellar.test.ts:150"], water: "No water" },
  { path: "graveyard", health: "ruin", files: ["epitaphs.ts:560", "dead-code.ts:620", "tombs.ts:440", "graveyard.test.ts:140"], water: "No water" },
  { path: "backlog", health: "tired", files: ["queue.ts:620", "triage.ts:540", "stale.ts:480", "backlog.test.ts:200"], water: "No water" },
  { path: "patches", health: "tired", files: ["hotfix.ts:560", "shim.ts:480", "workaround.ts:520", "patches.test.ts:180"], water: "No water" },
  { path: "sidings", health: "well", files: ["switch.ts:600", "spur.ts:520", "buffers.ts:440", "sidings.test.ts:180"], water: "No water" },
  { path: "gardens", health: "thriving", files: ["beds.ts:560", "borders.ts:480", "hedgerows.ts:440", "gardens.test.ts:180"], water: "No water" },
  { path: "lookout", health: "thriving", files: ["sightlines.ts:580", "horizon.ts:500", "beacons.ts:420", "lookout.test.ts:170"], water: "No water" },
  { path: "library", health: "thriving", files: ["shelves.ts:560", "catalogue.ts:500", "reading.ts:440", "library.test.ts:170"], water: "No water" },
];

/**
 * Dependencies as `from -> to`, with Jev's `want` for each trail. The trails that cross a stream come first, so the
 * sweep's crossings alternate across the brooks and the trickle.
 */
const TRAIL_PLAN: readonly (readonly [from: string, to: string, want: number])[] = [
  // Across the thriving brook.
  ["crossings/west-bank", "crossings/east-bank", 0.92],
  ["crossings/mill", "crossings/east-bank", 0.8],
  ["crossings/west-bank", "crossings/mill", 0.7],
  // Across the trickle.
  ["fords/jetty", "fords/gravel", 0.9],
  // Across the ruined brook, between ruins.
  ["ruins/cottage", "ruins/mill", 0.9],
  ["ruins/croft", "ruins/keep", 0.85],
  ["ruins/house", "ruins/lighthouse", 0.8],
  ["ruins/oak", "ruins", 0.75],
  ["ruins/keep", "ruins/house", 0.7],
  // The ruins' own hub. The oak, the mill and the lighthouse all depend on the willow, so their paths meet in the ruins.
  ["ruins/mill", "ruins", 0.72],
  ["ruins/lighthouse", "ruins", 0.71],
  // A hub. Many entities depend on the hollow's lantern tower, so trunk paths branch at junctions.
  ["", "hollow", 0.95],
  ["crossings/mill", "hollow", 0.9],
  ["downs", "hollow", 0.88],
  ["hills/oak", "hollow", 0.86],
  ["mixed", "pondside", 0.84],
  ["pondside", "fords/gravel", 0.83],
  ["terraces/croft", "hollow", 0.8],
  ["fords/gravel", "hollow", 0.78],
  // The rest of the world, joined.
  ["pondside/records", "pondside", 0.7],
  ["hills/kiln", "hills/oak", 0.7],
  ["terraces/ring", "terraces/croft", 0.72],
  ["moor/archive", "", 0.75],
  ["moor/henge", "moor/archive", 0.7],
  ["dunes/keep", "downs", 0.74],
  ["dunes/ledger", "dunes/keep", 0.7],
  ["downs/oak", "downs", 0.7],
  ["mixed/workshop", "mixed", 0.72],
  ["mixed/beacon", "mixed", 0.7],
  ["downs/deep", "downs", 0.7],
  ["hollow/willow", "hollow", 0.7],
  ["", "crossings/mill", 0.7],
];

// ---------- facts from health ----------

/** The part a planned file plays, which decides how its code is written. Never a fact the world reads. */
type FileKind = "source" | "test" | "config" | "data" | "docs" | "script";

/**
 * The share of its planned size each kind of file keeps. The plan's sizes date
 * from when the land gave a line of a test, a document or a configuration file
 * less ground than a line of code. Every line now gets the same ground, so
 * these factors shrink those files, and the land, its streams and the
 * crossings stay where the plan put them.
 */
const GROUND: Readonly<Record<FileKind, number>> = { source: 1, test: 0.85, docs: 0.6, script: 0.6, config: 0.4, data: 0.3 };

/** A planned definition: the world's fact, with the doc and the constants the written code includes. */
export interface PlannedSymbol {
  readonly name: string;
  readonly kind: SymbolFact["kind"] | "constant";
  readonly exported: boolean;
  readonly doc?: string;
  readonly line?: number;
  readonly lines?: number;
}

/** A planned file: its facts, and how to write its code as poor as its health. */
export interface PlannedFacts extends Omit<FileFacts, "symbols"> {
  readonly kind: FileKind;
  readonly symbols: readonly PlannedSymbol[];
  readonly doc?: string;
  readonly tests: { readonly coveredBy: readonly string[]; readonly own: readonly string[]; readonly failing: readonly string[] };
  readonly complexity: { readonly functions: number; readonly longestFunction: number; readonly maxNesting: number };
  readonly debtMarkers: number;
}

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
function symbolsFor(base: string, lines: number, index: number): PlannedSymbol[] {
  const stem = camel(base);
  const count = Math.max(1, Math.min(7, Math.round(lines / 70)));
  const out: PlannedSymbol[] = [];
  let line = 8;
  for (let k = 0; k < count; k++) {
    const verb = VERBS[(index * 5 + k) % VERBS.length] as string;
    const span = Math.max(4, Math.round((lines * 0.7) / count));
    const kind: PlannedSymbol["kind"] = k === 1 ? "class" : k === 2 ? "type" : k === 3 ? "constant" : "function";
    const name = kind === "class" ? `${cap(stem)}${cap(AGENT[verb] ?? `${verb}er`)}` : kind === "type" ? `${cap(stem)}${cap(verb)}` : kind === "constant" ? `${stem.toUpperCase()}_${verb.toUpperCase()}` : `${verb}${cap(stem)}`;
    out.push({ name, kind, exported: k % 3 !== 2 || kind === "type", doc: `${cap(verb)}s the ${base.replace(/-/g, " ")}.`, line, lines: kind === "type" || kind === "constant" ? Math.max(1, Math.round(span / 6)) : span });
    line += span + 2;
  }
  return out;
}

const parentOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const join = (dir: string, name: string): string => (dir === "" ? name : `${dir}/${name}`);

interface Drafted {
  path: string;
  dir: string;
  health: Health;
  kind: FileKind;
  lines: number;
  symbols: PlannedSymbol[];
  imports: Set<string>;
}

// The files, each with its health and symbols.
const drafted: Drafted[] = [];
PLAN.forEach((d) => {
  d.files.forEach((spec, i) => {
    const [name, lines, health] = spec.split(":") as [string, string, Health | undefined];
    const kind = kindOf(name);
    const base = name.replace(/\.(test\.)?\w+$/, "");
    drafted.push({ path: join(d.path, name), dir: d.path, health: health ?? d.health, kind, lines: Math.max(1, Math.round(Number(lines) * GROUND[kind])), symbols: kind === "source" ? symbolsFor(base === "index" || base === "lib" || base === "main" || base === "server" ? (d.path.split("/").pop() || "proving") : base, Number(lines), drafted.length + i) : [], imports: new Set() });
  });
});
const byPath = new Map(drafted.map((f) => [f.path, f]));
const entityDirs = PLAN.filter((d) => d.entity !== undefined).map((d) => d.path);
/** A path's innermost entity. */
const ownerOf = (path: string): string | undefined => entityDirs.filter((r) => r === "" || path === r || path.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
/** An entity's entry file, which defines its public API. */
const entryOf = (root: string): Drafted => {
  const own = drafted.filter((f) => f.dir === root && f.kind === "source");
  const entry = own.find((f) => /\/?(index|lib|main|server)\.\w+$/.test(f.path)) ?? own[0];
  if (entry === undefined) throw new Error(`${root} has no source file to be its entry.`);
  return entry;
};

// Imports. Each directory's files import the one before, forming a chain, a test imports its directory's sources,
// and every dependency in the trail plan is an import of the other entity's entry.
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

// The nearest test file in `dir` or up its tree, which covers a file its own entity tests.
const testOf = (dir: string): string | undefined => {
  for (let p: string | null = dir; p !== null; p = p === "" ? null : parentOf(p)) {
    const t = drafted.find((f) => f.dir === p && f.kind === "test");
    if (t !== undefined) return t.path;
  }
  return undefined;
};

const files: PlannedFacts[] = drafted.map((f) => {
  const s = SIGNALS[f.health];
  const prose = f.kind !== "source" && f.kind !== "test";
  const near = testOf(f.dir);
  const covering = new Set(coveringTests(f.path));
  // Its health decides whether tests cover it: its own entity's tests, or none.
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
    debtMarkers: s.debt,
  } satisfies PlannedFacts;
});

/** What the world reads of a planned file: its size, language, definitions and imports. */
const factsOfPlan = (f: PlannedFacts): FileFacts => ({
  path: f.path,
  language: f.language,
  lines: f.lines,
  symbols: f.symbols.flatMap((y) => (y.kind === "constant" ? [] : [{ name: y.name, kind: y.kind, exported: y.exported, ...(y.line === undefined ? {} : { line: y.line }), ...(y.lines === undefined ? {} : { lines: y.lines }) }])),
  imports: f.imports,
  importedBy: f.importedBy,
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
  const depends = new Set<string>();
  for (const f of mine) for (const i of f.imports) {
    const o = ownerOf(i);
    if (o !== undefined && o !== d.path) depends.add(o);
  }
  const entry = entryOf(d.path);
  const exported = files.find((f) => f.path === entry.path)?.symbols.filter((s) => s.exported).length ?? 0;
  const manifest = mine.find((f) => /(^|\/)(package\.json|Cargo\.toml)$/.test(f.path) && parentOf(f.path) === d.path)?.path;
  if (manifest === undefined) throw new Error(`${d.path || "The root"} is planned as an entity but has no package.json or Cargo.toml to declare it.`);
  const sum = (pick: (f: PlannedFacts) => number): number => mine.reduce((n, f) => n + pick(f), 0);
  return {
    path: d.path,
    name: d.path === "" ? "proving" : (d.path.split("/").pop() as string),
    form: plan.form,
    manifest,
    entry: entry.path,
    files: mine.length,
    lines: sum((f) => f.lines),
    exports: exported,
    dependsOn: [...depends].sort(),
    dependents: dependents.get(d.path) ?? [],
  };
});

const facts: CodeFacts = {
  projectId: "proving",
  repository: { name: "proving", files: files.length, lines: files.reduce((n, f) => n + f.lines, 0) },
  files: [...files].sort((a, b) => (a.path < b.path ? -1 : 1)).map(factsOfPlan),
  entities: [...entities].sort((a, b) => (a.path < b.path ? -1 : 1)),
};

// ---------- what Jev would choose ----------

// Every other definition of a source file appears as a tree, so each file has trees at its health, and the rest cycle
// through the stones, bushes and flowers.
const forms: Record<string, string> = {};
const trees = Object.keys(FORMS).filter((k) => FORMS[k]?.composes === "tree");
const others = Object.keys(FORMS).filter((k) => FORMS[k]?.composes !== "tree");
let tree = 0;
let other = 0;
for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
  if (f.kind === "source") f.symbols.forEach((s, k) => (forms[`${f.path}#${s.name}`] = k % 2 === 0 ? (trees[tree++ % trees.length] as string) : (others[other++ % others.length] as string)));
}
/** The forms other than a building or a landmark: a tree, a bush, a stone or flowers. */
type SmallFormKind = Exclude<FormKind, "building" | "landmark">;
/** The forms of the definitions. */
const definitionForms = (): string[] => Object.entries(forms).flatMap(([id, form]) => (id.includes("#") ? [form] : []));
// Every file also appears as one thing at its patch's center, cycling through every form. A few files and definitions
// appear as a building or a landmark, so the proving ground shows a thing of every size at every level of the code.
const small = Object.keys(FORMS);
const sources = [...files].sort((a, b) => (a.path < b.path ? -1 : 1)).filter((f) => f.kind === "source" && f.symbols.length > 0);
/** Every thing that appears as a building or a landmark, by id: the plan's entities, then the raised files and definitions. */
const raised = new Map<string, "building" | "landmark">(PLAN.flatMap((d) => (d.entity === undefined ? [] : [[d.path, d.entity.as] as const])));
const raise = (id: string, as: "building" | "landmark"): void => {
  forms[id] = Object.keys(COMPOSED_FORMS).find((key) => COMPOSED_FORMS[key]?.composes === as) as string;
  raised.set(id, as);
};
[...files].sort((a, b) => (a.path < b.path ? -1 : 1)).forEach((f, k) => (forms[f.path] = small[k % small.length] as string));
// Every seventh source file is raised, alternating building and landmark, and every eleventh raises its first
// definition, alternating landmark and building.
sources.forEach((f, k) => {
  // A file under 40 lines raises nothing, because on its tiny patch a building or a landmark would overlap its neighbors'.
  if (f.lines < 40) return;
  if (k % 7 === 3) raise(f.path, (k / 7) % 2 < 1 ? "building" : "landmark");
  const first = f.symbols[0];
  if (first !== undefined && k % 11 === 5) raise(`${f.path}#${first.name}`, (k / 11) % 2 < 1 ? "landmark" : "building");
});

// Every file's quality by its health, and every entity's its own files' pooled by their lines.
const quality: Record<string, number> = Object.fromEntries([
  ...drafted.map((f) => [f.path, QUALITY[f.health]] as const),
  ...PLAN.flatMap((d) => {
    if (d.entity === undefined) return [];
    const own = drafted.filter((f) => f.dir === d.path);
    const lines = own.reduce((n, f) => n + f.lines, 0);
    return [[d.path, lines === 0 ? QUALITY[d.health] : own.reduce((n, f) => n + QUALITY[f.health] * f.lines, 0) / lines] as const];
  }),
]);

/**
 * The three health bands every part must appear in, as the proving ground's test reads them: `thriving` from 0.85,
 * `tired` from 0.35, and `ruin` below 0.12. A value from 0.12 up to 0.35 counts toward none.
 */
const bandOf = (v: number): { label?: string } => (v >= 0.85 ? { label: "thriving" } : v >= 0.35 ? { label: "tired" } : v < 0.12 ? { label: "ruin" } : {});

// What Jev would compose from: the sweep of every part, each placed where its place allows and at every health.
const { lib } = COMPOSING;
const gaps: string[] = [];
const swept = (what: string, k: AnyKind, places?: readonly SweepPlace[], parts: Library = lib, pairs?: readonly (readonly [string, string])[]): readonly Blueprint[] => {
  const { blueprints, missing } = sweep(k, parts, { ...(places === undefined ? {} : { places }), ...(pairs === undefined ? {} : { pairs }) });
  gaps.push(...missing.map((m) => `${what} ${m}`));
  return blueprints;
};

/** The planned directory whose land a path is on: the nearest one up its tree with a `water`. */
const regionOf = (path: string): PlannedDir => {
  for (let p: string | null = path; p !== null; p = p === "" ? null : parentOf(p)) {
    const d = PLAN.find((x) => x.path === p && x.water !== undefined);
    if (d !== undefined) return d;
  }
  throw new Error(`${path || "The root"} stands on no planned land.`);
};
const regions = PLAN.filter((d) => d.water !== undefined);
const waterOf = (d: PlannedDir): Look => {
  const water = WATERS[d.water ?? ""];
  if (water === undefined) throw new Error(`${d.path || "The root"} plans a water Jev is never offered: ${d.water}.`);
  return water;
};

// Each land's health is its own ground's, pooled by size over the files on it, as the world lays it out.
const unlanded = layoutWorld(facts, { lands: {}, things: {}, trails: [], waters: {}, quality }, undefined, 1);
const regionPath = new Map(unlanded.areas.map((a) => [a.path, unlanded.regions[a.region]?.area ?? ""]));
const ground = new Map<string, { sum: number; size: number }>();
for (const p of unlanded.patches) {
  const r = regionPath.get(p.area) ?? "";
  const g = ground.get(r) ?? { sum: 0, size: 0 };
  ground.set(r, { sum: g.sum + p.vitality * p.radius * p.radius, size: g.size + p.radius * p.radius });
}
const landHealth = (path: string): number => {
  const g = ground.get(path);
  return g === undefined || g.size === 0 ? 1 : g.sum / g.size;
};

// A land's water sets its landform's water. A brook or a trickle runs in a valley and a pond lies in a basin, as the
// page sets water in a land (`withWater`). A land whose name promises a landform uses it.
const lands = swept(
  "a land's",
  COMPOSING.biome,
  regions.map((d) => {
    const settles = waterOf(d).settles ?? {};
    const stream = settles["relief.stream"];
    const relief = stream === "brook" || stream === "trickle" ? "valley@1" : settles["relief.pond"] === true ? "basin@1" : d.landform;
    return { fixed: settles, ...(relief === undefined ? {} : { uses: { relief } }), ...bandOf(landHealth(d.path)) };
  }),
);
// Buildings and landmarks in the plan's order, each where its land's water allows, such as a waterwheel only by running water.
const placeOf = (id: string): SweepPlace => {
  const file = id.split("#")[0] as string;
  const dir = byPath.has(file) ? parentOf(file) : file;
  return { has: waterOf(regionOf(dir)).holds ?? [], ...bandOf(quality[file] ?? 1) };
};
const thingsAs = (as: "building" | "landmark"): string[] => [...raised].flatMap(([id, a]) => (a === as ? [id] : []));
const composed = (as: "building" | "landmark", k: AnyKind): [string, { as: "building" | "landmark"; blueprint: Blueprint }][] => {
  const ids = thingsAs(as);
  const blueprints = swept(`a ${as}'s`, k, ids.map(placeOf));
  return ids.map((id, i) => [id, { as, blueprint: blueprints[i] as Blueprint }]);
};
// Every tree, bush, stone and drift of flowers takes a blueprint from its form's sweep, every frame with every crown.
// Each health's things cycle through the whole sweep, so every row appears thriving, tired and in ruin.
const smallSweeps: Readonly<Record<SmallFormKind, readonly Blueprint[]>> = {
  tree: swept("a tree's", COMPOSING.tree, undefined, COMPOSING.offered?.tree, [["form", "crown"]]),
  bush: swept("a bush's", COMPOSING.bush, undefined, COMPOSING.offered?.bush, [["form", "crown"]]),
  stone: swept("a stone's", COMPOSING.stone),
  flowers: swept("a drift's", COMPOSING.flowers),
};
const turns = new Map<string, number>();
const smallThings = Object.entries(forms).flatMap(([id, form]): [string, { as: SmallFormKind; blueprint: Blueprint }][] => {
  const as = FORMS[form]?.composes;
  if (as === undefined || raisedAs(as)) return [];
  const rows = smallSweeps[as];
  const turn = `${as} ${bandOf(quality[id.split("#")[0] as string] ?? 1).label ?? ""}`;
  const k = turns.get(turn) ?? 0;
  turns.set(turn, k + 1);
  return [[id, { as, blueprint: rows[k % rows.length] as Blueprint }]];
});
const things = Object.fromEntries([...composed("building", COMPOSING.building), ...composed("landmark", COMPOSING.landmark), ...smallThings]);
const routes = swept("a trail's", COMPOSING.link, TRAIL_PLAN.map(([from, to]) => bandOf(((quality[from] ?? 1) + (quality[to] ?? 1)) / 2)));
// The sky is the first of the sweep's skies. `__lab.terrain.sky(k)` shows the others.
const skies = swept("the sky's", COMPOSING.world);
// Each wild ground gets the next blueprint of the wild bush's sweep, which uses the bush's own parts. The land's bushes
// already show every part, so the wild's two grounds leave nothing missing.
const wild = sweep(COMPOSING.wildBush, COMPOSING.offered?.wildBush ?? lib, { places: WILD_GROUNDS.map(() => ({})) }).blueprints;

// The proving ground's judgments are written here, not asked of Jev. What Jev would choose is fixed, and every part is
// swept.
const judged: Judgments = {
  sky: skies[0] as Blueprint,
  lands: Object.fromEntries(regions.map((d, i) => [d.path, lands[i] as Blueprint])),
  wild,
  waters: Object.fromEntries(regions.map((d) => [d.path, d.water as string])),
  things,
  forms: forms,
  trails: TRAIL_PLAN.map(([from, to, want], i) => ({ from, to, want, route: routes[i] as Blueprint })),
  quality,
};

// ---------- the plan covers every option and every part, and lays out as planned ----------

const missing = (what: string, options: Readonly<Record<string, unknown>>, used: Iterable<string>): string[] => {
  const seen = new Set(used);
  return Object.keys(options).filter((k) => !seen.has(k)).map((k) => `${what} "${k}"`);
};
gaps.push(...missing("water", WATERS, Object.values(judged.waters)), ...missing("form", FORMS, definitionForms()), ...missing("raised form", COMPOSED_FORMS, Object.values(forms)));
if (gaps.length > 0) throw new Error(`The proving ground lacks ${gaps.join(", ")}.`);
const world = layoutWorld(facts, judged, undefined, 1);
const laidOut = world.regions.map((r) => r.area);
const planned = Object.keys(judged.lands);
const astray = [...planned.filter((p) => !laidOut.includes(p)).map((p) => `${p || "(root)"} has no land of its own`), ...laidOut.filter((p) => !planned.includes(p)).map((p) => `${p} has land but no planned look`)];
if (astray.length > 0) throw new Error(`The proving ground lays out differently from its plan: ${astray.join("; ")}.`);

const repo = resolve(import.meta.dirname, "..");
const args = parseArgs({ options: { code: { type: "string" }, manifest: { type: "string" }, out: { type: "string" } } }).values;
if (args.code !== undefined) {
  const dir = resolve(args.code);
  const manifestPath = resolve(args.manifest ?? `${dir}-manifest.json`);
  for (const path of [dir, manifestPath]) {
    const inside = relative(repo, path);
    const outside = inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
    if (!outside && !inside.split(sep).includes("node_modules")) throw new Error(`Write the proving ground's code and manifest outside Gaia's repository or under node_modules, or Gaia's own world reads them: ${path}.`);
  }
  const manifestRelative = relative(dir, manifestPath);
  const manifestOutside = manifestRelative === ".." || manifestRelative.startsWith(`..${sep}`) || isAbsolute(manifestRelative);
  if (!manifestOutside) throw new Error(`Write the manifest beside the code, not in it, or the engine takes every file it names for used: ${manifestPath}.`);
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
const fixtures = resolve(args.out ?? resolve(repo, "app/renderer/terrain/fixtures"));
mkdirSync(fixtures, { recursive: true });
writeFileSync(resolve(fixtures, "proving.json"), `${JSON.stringify(facts)}\n`);
writeFileSync(resolve(fixtures, "proving-judged.json"), fixtureJson(judged));
const band = (v: number): string => (v >= 0.85 ? "thriving" : v >= 0.6 ? "well" : v >= 0.35 ? "tired" : v >= 0.12 ? "failing" : "ruin");
const count = (vs: readonly number[]): string => Object.entries(vs.reduce<Record<string, number>>((n, v) => ((n[band(v)] = (n[band(v)] ?? 0) + 1), n), {})).map(([k, n]) => `${n} ${k}`).join(", ");
console.log(`proving: ${facts.files.length} files, ${facts.repository.lines.toLocaleString("en-US")} lines, ${entities.length} entities; a ${world.size} m world of ${world.regions.length} lands and ${world.areas.length} areas`);
console.log(`  files: ${count(world.patches.map((p) => p.vitality))}`);
console.log(`  lands: ${count(world.regions.map((r) => landHealth(r.area)))}; ${lands.length} swept lands, ${skies.length} skies`);
console.log(`  entities: ${count(world.things.filter((t) => (t.of ?? "entity") === "entity").map((t) => t.vitality))}`);
console.log(`  raised: ${world.things.filter((t) => t.of === "file").length} files and ${world.things.filter((t) => t.of === "definition").length} definitions as buildings or landmarks; ${world.standing.length} files standing as plants, stones or flowers`);
