// The world a codebase becomes, from the facts the engine's graph gives
// (`factsOf`): directories holding directories and files, files holding
// their functions, classes and exported definitions, entities rooted at
// directories, and the imports and dependencies between them. `layoutWorld`
// lays it out as land: each directory a region of ground built of its
// own files and its subdirectories, sized by their code, with organic borders
// (`divideLand`); each file a patch of that ground; each entity standing on a
// lot at its directory's heart; a file's finer entities standing on its patch;
// and the dependencies Jev would walk as trails. The engine gives structure
// and sizes. Jev gives meaning: every look, what each kind of symbol stands
// as, whether an area holds water and why, and which dependencies become
// trails, asked by `planWorldRequests` from the code's structure only. The
// same code and the same answers always give the same world.
//
// Until the reviewer approves live calls, `standInJev` answers those same
// requests: a deterministic stand-in that matches each option's `suits`
// against tags read from the facts. Swapping in Jev is one line: pass the
// engine's client to `judgeWorld` instead.

import {
  type AreaPlace,
  type Blueprint,
  type CellPlace,
  type CodeGraph,
  type CodeFacts,
  type EntityFacts,
  type FileFacts,
  type JevAnswer,
  type JevClient,
  type JevQuestion,
  type JevRequest,
  type PatchPlace,
  type SymbolFact,
  type WorldPlaces,
  rand,
  seedOf,
} from "@gaia/schema";
import { LAND_ASPECT, type LandSite, landArea } from "@gaia/terrain";
import { type StandingDef, definitionsOf } from "./definitions.ts";
import { type LandNode, divideLand, dividePlots } from "./land.ts";
import { certainty } from "./context.ts";
import { type OutlineReading, areaOutline, areaReadings, bodySize, entityOutline, entityReadings, fileOutline, fileReadings, fileSize, howMany, importersOf, outlineOrder, symbolSize, tokensOf } from "./outline.ts";
import { MODEL } from "./planner.ts";
import { type Composing, composeThings, composingState } from "./compose.ts";

/** One option Jev may choose: what it is like (Jev reads this) and the facts it suits (the stand-in reads these). */
export interface Look {
  readonly doc: string;
  readonly suits: readonly string[];
}

export type LookSet = Readonly<Record<string, Look>>;

/** The options for every judgment, by key. */
export interface Looks {
  /** What composes each building and landmark part by part: Jev chooses their parts, never a preset. */
  readonly compose: Composing;
  /** The repository's art direction: light, sky, season and wind. */
  readonly world: LookSet;
  /** A directory's land: landform and ground cover. */
  readonly land: LookSet;
  readonly building: LookSet;
  readonly landmark: LookSet;
  /** How a trail between two entities looks. */
  readonly trail: LookSet;
  /** What a file's finer entity (a function, a class, a type, a constant) stands as on its patch: a tree, a stone, a bush or flowers. */
  readonly form: LookSet;
  /** Whether an area's land holds water, and why: each option's words are the reason recorded with the choice. */
  readonly water: LookSet;
  /** An area's ground: its undergrowth, its open ground and how large its trees grow. */
  readonly character: LookSet;
}

/** One Jev request about one thing. */
export interface WorldRequest {
  readonly about: "world" | "area" | "file" | "entity";
  /** The thing's path: a directory, a file or an entity's root; "" for the repository. */
  readonly target: string;
  readonly request: JevRequest;
  /** For a design that escalates: the facts a second request may add, by reading. Sent only when Jev's answers call for them. */
  readonly readings?: Readonly<Record<string, OutlineReading>>;
  /** What the request decides, in words: each question about readings names it, because Jev answers every question on its own. */
  readonly decides?: string;
  /**
   * For a design that shares state: the things this one request judges, each
   * with its questions as sent (`form#plan@src/a.ts`) and as planned (`form#plan`).
   * Absent when the request judges only its own `about` and `target`.
   */
  readonly carries?: readonly CarriedThing[];
}

/** One thing a shared request judges, and which of its questions are that thing's. */
export interface CarriedThing {
  readonly about: "area" | "file";
  readonly target: string;
  /** Sent question id → the id the thing's own request would have asked. */
  readonly questions: Readonly<Record<string, string>>;
}

/** Everything Jev decided about a world. */
export interface Judgments {
  readonly world: string;
  /** Directory → land key, for the directories that are regions. */
  readonly lands: Readonly<Record<string, string>>;
  /**
   * Entity → whether a building or a landmark stands for it, and the blueprint Jev composed for it once the
   * understanding pass has judged the code (`composeWorld`); a thing not yet composed has none and stands nowhere.
   */
  readonly things: Readonly<Record<string, { readonly as: "building" | "landmark"; readonly blueprint?: Blueprint }>>;
  /** Dependencies Jev would walk, with how much it wants each and its look. */
  readonly trails: readonly CodeTrail[];
  /**
   * File → form key, by symbol kind (`function`) when a design asks about each
   * kind of a file's finer entities, or by `#` and its qualified name
   * (`#openWorld`, `#World.open`) when it asks about each one: what the file's
   * finer entities stand as.
   */
  readonly forms: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /**
   * File or directory → its quality, 0 to 1, for a world no engine graph
   * judges: the proving ground's, fixed with its looks. Vitality reads it
   * where the graph gives none.
   */
  readonly quality?: Readonly<Record<string, number>>;
  /** Directory → water key, for the directories that are regions. */
  readonly waters: Readonly<Record<string, string>>;
  /** Directory → character key, for the directories that are regions: its undergrowth, open ground and how large its trees grow. */
  readonly characters: Readonly<Record<string, string>>;
}

export interface CodeArea extends AreaPlace {
  /** The terrain region whose land this area's own ground shows. */
  readonly region: number;
  /** Square meters of land it holds, its subdirectories' included. */
  readonly ground: number;
}

export interface CodePatch extends PatchPlace {
  readonly lines: number;
  /** Square meters of ground its cell holds. */
  readonly ground: number;
  /** Its first cell in `cells`; its ground is every cell naming it. */
  readonly cell: number;
}

/** An entity standing in the world: a building or a landmark on its lot. */
export interface CodeThing {
  /** The entity's root path, its identity. */
  readonly path: string;
  readonly name: string;
  readonly as: "building" | "landmark";
  /** What it is built from: the parts and settings Jev composed for it. */
  readonly blueprint: Blueprint;
  /** The directory it stands in: its root. */
  readonly area: string;
  /** Its lot: the middle of the ground kept for it at its directory's heart, and how far a building may stand from it. */
  readonly x: number;
  readonly z: number;
  readonly lot: number;
  readonly vitality: number;
}

/** A definition standing on its file's patch, on its own plot: a function, a method, a class or a type. */
export interface CodeSymbol {
  /** `<file>#<name>`, qualified by what encloses it (`app/x.ts#World.open`): its identity. */
  readonly id: string;
  readonly file: string;
  /** The definition it sits inside, by id. */
  readonly parent?: string;
  readonly name: string;
  readonly kind: SymbolFact["kind"];
  readonly exported: boolean;
  /** Where it is declared and how many lines it spans. */
  readonly line: number;
  readonly lines: number;
  readonly doc?: string;
  /** How much it matters, 0 to 1, Jev's importance from Engine's graph; its size follows it. */
  readonly importance?: number;
  /** What it stands as: a form key Jev chose for it, or for its kind in its file. */
  readonly form: string;
  readonly x: number;
  readonly z: number;
  /** Its file's vitality. */
  readonly vitality: number;
}

export interface CodeTrail {
  readonly from: string;
  readonly to: string;
  /** Jev's probability that a person would walk between them, 0 to 1. */
  readonly want: number;
  readonly look: string;
  /** How many of `from`'s files import from `to`. */
  readonly weight?: number;
  /** Whether it joins two groups of entities no other chosen trail joins yet: these route first. */
  readonly spans?: boolean;
}

/** A terrain region: a directory whose land has its own landform and cover. */
export interface CodeRegion {
  readonly area: string;
  /** The middle of its land. */
  readonly x: number;
  readonly z: number;
  /** How far its land reaches from its middle on average, meters. */
  readonly reach: number;
  readonly land: string;
  /** Whether its land holds water: a water key, whose words say why. */
  readonly water: string;
  /** How its trees and open ground lie: a character key, whose words say why. */
  readonly character: string;
  /** The cells its land is made of: the sites of its files' patches and its lots (`RegionSpec.sites`). */
  readonly sites: readonly LandSite[];
}

/** A world document laid out from code: every area, patch, thing, symbol and trail, the land's cells, and the terrain's regions. */
export interface CodeWorld extends WorldPlaces {
  readonly projectId: string;
  /** Side of the walkable square, meters: it grows with the codebase. */
  readonly size: number;
  /** The world look key: the repository's art direction. */
  readonly world: string;
  readonly areas: readonly CodeArea[];
  readonly patches: readonly CodePatch[];
  /** Every cell of the land, each part of one file's patch or one entity's lot, naming its area and its file (null for a lot). */
  readonly cells: readonly CellPlace[];
  readonly things: readonly CodeThing[];
  readonly symbols: readonly CodeSymbol[];
  readonly trails: readonly CodeTrail[];
  readonly regions: readonly CodeRegion[];
}

export const LAYOUT = {
  /** Square meters of ground per line of code. */
  m2PerLine: 26,
  /** A file's lines count between these for its patch's size. */
  lines: [20, 1500],
  /**
   * Ground kept for an entity's lot at its directory's heart, square meters:
   * the same for a building or a landmark, so the land's division depends on
   * the code alone and is known before Jev answers (`landOf`).
   */
  lot: 900,
  /** How far a building or landmark may stand from its lot's middle, meters. */
  lotReach: { building: 9, landmark: 7 },
  /** The smallest world, meters across. */
  minSize: 320,
  /** A directory has its own land when it holds this share of the code's ground, not counting its own lands. */
  regionShare: 0.03,
  maxRegions: 24,
  /** Square meters each definition standing on a file's patch adds to it, on top of the file's lines. */
  defGround: 120,
  /** How many of a file's definitions one request asks a form for: a larger file's are asked over several, so each fits Jev's window. */
  formsPerRequest: 24,
} as const;

// ---------- the tree of directories ----------

interface Dir {
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly parent: string | null;
  readonly files: FileFacts[];
  readonly children: string[];
}

const parentOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const baseName = (path: string): string => path.split("/").pop() ?? path;
const weightOf = (f: FileFacts): number => Math.min(LAYOUT.lines[1], Math.max(LAYOUT.lines[0], f.lines));
const byPath = <T extends { readonly path: string }>(a: T, b: T): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function directoriesOf(facts: CodeFacts, name: string): Map<string, Dir> {
  const dirs = new Map<string, Dir>();
  const ensure = (path: string): Dir => {
    const had = dirs.get(path);
    if (had !== undefined) return had;
    const parent = path === "" ? null : parentOf(path);
    const dir: Dir = { path, name: path === "" ? name : baseName(path), depth: path === "" ? 0 : path.split("/").length, parent, files: [], children: [] };
    dirs.set(path, dir);
    if (parent !== null) ensure(parent).children.push(path);
    return dir;
  };
  ensure("");
  for (const f of [...facts.files].sort(byPath)) ensure(parentOf(f.path)).files.push(f);
  for (const d of dirs.values()) d.children.sort();
  return dirs;
}

/** Lines under a directory, each file's weight capped as its patch is. */
function linesUnder(dirs: Map<string, Dir>, path: string): number {
  const d = dirs.get(path) as Dir;
  return d.files.reduce((n, f) => n + weightOf(f), 0) + d.children.reduce((n, c) => n + linesUnder(dirs, c), 0);
}

/**
 * The directories with land of their own. Bottom up, a directory keeps the
 * lines of its subdirectories that have no land of their own; it has its own
 * land when those reach the threshold. The root always does.
 */
function regionPaths(dirs: Map<string, Dir>): string[] {
  const total = linesUnder(dirs, "");
  let threshold = total * LAYOUT.regionShare;
  for (;;) {
    const regions: string[] = [];
    const weigh = (path: string): number => {
      const d = dirs.get(path) as Dir;
      const kept = d.files.reduce((n, f) => n + weightOf(f), 0) + d.children.reduce((n, c) => n + weigh(c), 0);
      if (path === "" || kept >= threshold) {
        regions.push(path);
        return 0;
      }
      return kept;
    };
    weigh("");
    if (regions.length <= LAYOUT.maxRegions) return regions.sort();
    threshold *= 1.25;
  }
}

// ---------- asking Jev ----------

/** Option order seeded by the target, as the planner does: Jev leans toward the first option. A salt reorders every question at once. */
function shuffled<T>(items: readonly T[], label: string, target: string, salt = ""): T[] {
  const r = rand(seedOf(salt === "" ? target : `${target}~${salt}`)).fork(label);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function choice(instructions: string, options: Readonly<Record<string, string>>, label: string, target: string, salt = ""): JevQuestion {
  const keys = shuffled(Object.keys(options).sort(), label, target, salt);
  return { type: "choice", instructions, criteria: Object.fromEntries(keys.map((k) => [k, options[k] as string])) };
}

const docs = (set: LookSet): Record<string, string> => Object.fromEntries(Object.entries(set).map(([k, l]) => [k, l.doc]));
const SOURCE = new Set(["typescript", "javascript", "rust", "python", "go"]);

/** Languages by lines, largest first. */
function languagesOf(files: readonly FileFacts[]): string[] {
  const lines = new Map<string, number>();
  for (const f of files) lines.set(f.language, (lines.get(f.language) ?? 0) + f.lines);
  return [...lines].filter(([l]) => SOURCE.has(l)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([l]) => l);
}

const KIND_WORDS: Readonly<Record<SymbolFact["kind"], string>> = { function: "function", class: "class", type: "type", module: "module" };
const KIND_PLURALS: Readonly<Record<SymbolFact["kind"], string>> = { function: "functions", class: "classes", type: "types", module: "modules" };

/**
 * A file's definitions that may stand on its patch when there is no graph:
 * its functions and classes, each name once by its longest definition, the
 * largest first. The layout stands as many as the patch's ground allows.
 */
export function standingSymbols(f: FileFacts): SymbolFact[] {
  const byName = new Map<string, SymbolFact>();
  for (const s of f.symbols) {
    if (s.kind !== "function" && s.kind !== "class") continue;
    const had = byName.get(s.name);
    if (had === undefined || (s.lines ?? 1) > (had.lines ?? 1)) byName.set(s.name, s);
  }
  return [...byName.values()].sort((a, b) => (b.lines ?? 1) * (b.exported ? 1.5 : 1) - (a.lines ?? 1) * (a.exported ? 1.5 : 1) || (a.name < b.name ? -1 : 1));
}

// ---------- designs: what Jev sees and is asked ----------

/** How Gaia builds Jev's requests: what each state is made of, how the questions are worded, and whether context grows. */
export interface Design {
  /**
   * `facts`: each thing's summary facts. `outline`: its outline
   * (`fileOutline`, `areaOutline`, `entityOutline`), sizes in words. `words`:
   * the summary facts with every count and size in words, and what a file
   * declares, how far tests reach it and how often it changed
   * (`fileWords`, `areaWords`, `entityWords`).
   */
  readonly state: "facts" | "outline" | "words";
  /**
   * `first`: the questions as round 12 asked them. `revised`: round 13's
   * wording, with an entity's building-or-landmark asked on its own.
   * `judged`: `revised`'s, with each finer entity that may stand on a file's
   * patch asked about on its own (`form#<name>`), and whether a source file
   * holds behavior a test should check (`tests`), which vitality reads.
   */
  readonly questions: "first" | "revised" | "judged";
  /** Whether a request carries what was judged above it: the world's light for an area, its land's landform and water for a file or entity. Asked top-down, in three waves. */
  readonly character: boolean;
  /** Whether each request also asks which readings would help, and a request Jev was unsure about is asked again with the readings it chose. */
  readonly escalate: boolean;
  /**
   * `area`: one request per area carries its own questions and every
   * question about the files on its land, over one state holding the area's
   * facts and each file's (`SHARE`). Jev answers each question on its own
   * over the shared state, so a file's questions name the file they are about.
   */
  readonly share?: "area";
}

export const DESIGNS = {
  /** Round 12's requests, exactly. */
  first: { state: "facts", questions: "first", character: false, escalate: false },
  /** The same facts, round 13's questions and stable words for the repository: what the app asked until round 15. */
  revised: { state: "facts", questions: "revised", character: false, escalate: false },
  /** Each thing's outline, with what was judged above it. */
  outline: { state: "outline", questions: "revised", character: true, escalate: false },
  /** The outline, and a second request with the readings Jev chose wherever it was unsure. */
  escalate: { state: "outline", questions: "revised", character: true, escalate: true },
  /** `revised`'s facts and questions, one request per area carrying its files' questions over one shared state. */
  shared: { state: "facts", questions: "revised", character: false, escalate: false, share: "area" },
  /** The same, over outlines: the area's outline and each of its files', sizes in words, so a small edit asks again rarely. */
  "shared-outline": { state: "outline", questions: "revised", character: false, escalate: false, share: "area" },
  /** What the app asks: summary facts in words with areas compared, and every definition standing on a file's patch judged on its own. */
  judged: { state: "words", questions: "judged", character: false, escalate: false },
} as const satisfies Readonly<Record<string, Design>>;

export type DesignName = keyof typeof DESIGNS;
export const DEFAULT_DESIGN: DesignName = "judged";

/** Look keys judged so far, top-down, for a design that carries character. */
export interface Character {
  readonly world?: string;
  /** Region directory → land key and water key. */
  readonly lands?: Readonly<Record<string, string>>;
  readonly waters?: Readonly<Record<string, string>>;
}

export interface PlanOptions {
  readonly design?: DesignName | Design;
  /** Engine's graph, whose definitions stand on each file's patch as the layout stands them; without it, the facts' own. */
  readonly graph?: CodeGraph;
  /** What has been judged above each thing; `judgeWorld` fills it wave by wave. */
  readonly character?: Character;
  /** Reorders every question's options: the same requests in another order, to measure how much order sways Jev. */
  readonly shuffle?: string;
}

const designOf = (d: PlanOptions["design"]): Design => (d === undefined ? DESIGNS[DEFAULT_DESIGN] : typeof d === "string" ? DESIGNS[d] : d);

/** The prefix of the questions that ask which readings would help. */
export const MORE = "more:";
/** The reading Jev may ask for that Gaia cannot give yet: a symbol's source. Asked, recorded, never read until the reviewer approves sending source. */
export const SOURCE_WISH = `${MORE}source`;

/** The repository's size as words, so the world's request changes only when the repository does. */
const repoSize = (lines: number): string => (lines < 5000 ? "small" : lines < 25000 ? "modest" : lines < 80000 ? "substantial" : "large");
const about = (n: number): string => (n < 100 ? `${n}` : `about ${Number(n.toPrecision(2)).toLocaleString("en-US")}`);
const lookWords = (set: LookSet, key: string | undefined): string | undefined => (key === undefined || set[key] === undefined ? undefined : `${key}: ${set[key].doc}`);

/** A count per file in words: how much of something each of a directory's files does on average. */
const perFile = (n: number, files: number): string => {
  const r = n / Math.max(1, files);
  return r === 0 ? "none" : r < 0.5 ? "a little" : r < 1.5 ? "some" : "a lot";
};
/** A file as `judged` sends it: what it declares, its size and links in words, and the definitions standing on its patch that the request asks about. */
export function fileWords(f: FileFacts, standing: readonly StandingDef[] = []): Record<string, unknown> {
  const declares: Record<string, string> = {};
  for (const kind of ["function", "class", "type", "module"] as const) {
    const n = f.symbols.filter((s) => s.kind === kind).length;
    if (n > 0) declares[KIND_PLURALS[kind]] = howMany(n);
  }
  return {
    path: f.path,
    language: f.language,
    size: fileSize(f.lines),
    declares: Object.keys(declares).length === 0 ? "nothing of its own" : declares,
    exports: outlineOrder(f).filter((s) => s.exported).slice(0, 8).map((s) => s.name),
    imports: `${howMany(f.imports.length)} project files`,
    importedBy: `${howMany(f.importedBy.length)} project files`,
    ...(standing.length === 0 ? {} : { standing: standing.map((d) => ({ name: d.id.slice(d.file.length + 1), kind: d.kind, size: symbolSize(d.lines), exported: d.exported })) }),
  };
}

/** A directory's lines and how its files import, per file: what `judged` compares across the repository's areas. */
interface AreaMeasure {
  readonly lines: number;
  readonly within: number;
  readonly out: number;
  readonly in: number;
}

function measureArea(all: readonly FileFacts[]): AreaMeasure {
  const inside = new Set(all.map((f) => f.path));
  const n = Math.max(1, all.length);
  return {
    lines: all.reduce((x, f) => x + f.lines, 0),
    within: all.reduce((x, f) => x + f.imports.filter((i) => inside.has(i)).length, 0) / n,
    out: all.reduce((x, f) => x + f.imports.filter((i) => !inside.has(i)).length, 0) / n,
    in: all.reduce((x, f) => x + f.importedBy.filter((i) => !inside.has(i)).length, 0) / n,
  };
}

/**
 * Where a value stands among the repository's areas, in words. Jev answers
 * each area's request alone and never sees the others, so a judgment such as
 * "much of the code leans on this area" needs the comparison made for it.
 */
function standing(value: number, all: readonly number[]): string {
  if (all.length < 3) return "about the middle of this repository's areas";
  const below = all.filter((v) => v < value).length;
  const equal = all.filter((v) => v === value).length;
  const p = (below + (equal - 1) / 2) / (all.length - 1);
  return p >= 0.8 ? "among the most of this repository's areas" : p >= 0.6 ? "more than most of this repository's areas" : p > 0.4 ? "about the middle of this repository's areas" : p > 0.2 ? "less than most of this repository's areas" : "among the least of this repository's areas";
}

/** A directory as `judged` sends it: its size, parts and imports in words, per file where a count would grow with the directory, and each compared with the repository's other areas (`others`). */
export function areaWords(facts: CodeFacts, path: string, own: readonly FileFacts[], all: readonly FileFacts[], subdirectories: readonly string[], others: readonly AreaMeasure[] = []): Record<string, unknown> {
  const inside = new Set(all.map((f) => f.path));
  const entity = facts.entities.find((e) => e.path === path);
  const me = measureArea(all);
  return {
    path: path === "" ? "(the repository's root)" : path,
    size: bodySize(all.reduce((n, f) => n + f.lines, 0)),
    files: howMany(all.length),
    languages: languagesOf(all),
    ...(entity === undefined ? {} : { entity: `${entity.name} (${entity.form})` }),
    subdirectories: subdirectories.map(baseName),
    importsPerFile: {
      amongItsOwnFiles: perFile(all.reduce((n, f) => n + f.imports.filter((i) => inside.has(i)).length, 0), all.length),
      toOtherDirectories: perFile(all.reduce((n, f) => n + f.imports.filter((i) => !inside.has(i)).length, 0), all.length),
      fromOtherDirectories: perFile(all.reduce((n, f) => n + f.importedBy.filter((i) => !inside.has(i)).length, 0), all.length),
    },
    ...(others.length === 0
      ? {}
      : {
          comparedWithOtherAreas: {
            size: standing(me.lines, others.map((o) => o.lines)),
            importsAmongItsOwnFiles: standing(me.within, others.map((o) => o.within)),
            importsToOtherDirectories: standing(me.out, others.map((o) => o.out)),
            importedFromOtherDirectories: standing(me.in, others.map((o) => o.in)),
          },
        }),
    contents: [...own].sort((a, b) => b.lines - a.lines || byPath(a, b)).slice(0, 12).map((f) => ({ name: baseName(f.path), size: fileSize(f.lines) })),
  };
}

/** An entity as `judged` sends it: `revised`'s facts with every count and size in words. */
export function entityWords(facts: CodeFacts, e: EntityFacts): Record<string, unknown> {
  const entities = new Map(facts.entities.map((x) => [x.path, x]));
  return {
    name: e.name,
    path: e.path === "" ? "(the repository's root)" : e.path,
    form: e.form,
    size: bodySize(e.lines),
    files: howMany(e.files),
    surface: `${howMany(e.exports)} exported symbols`,
    dependsOn: e.dependsOn.flatMap((p) => {
      const o = entities.get(p);
      return o === undefined ? [] : [{ name: o.name, importers: `${howMany(importersOf(facts, e, o))} of its files`, dependedOnBy: `${howMany(o.dependents.length)} entities` }];
    }),
    dependents: e.dependents.map((p) => entities.get(p)?.name ?? p),
    dependedOnBy: howMany(e.dependents.length),
  };
}

/** The nearest directory with land of its own that holds a path's directory. */
function regionFor(regions: ReadonlySet<string>, dir: string): string {
  for (let p: string | null = dir; p !== null; p = p === "" ? null : parentOf(p)) if (regions.has(p)) return p;
  return "";
}

/** The request Jev gets about each thing. State carries the code's structure only, never source. */
export function planWorldRequests(facts: CodeFacts, looks: Looks, options: PlanOptions = {}): WorldRequest[] {
  const design = designOf(options.design);
  const revised = design.questions !== "first";
  const judged = design.questions === "judged";
  const salt = options.shuffle ?? "";
  const character = design.character ? (options.character ?? {}) : {};
  const dirs = directoriesOf(facts, facts.repository.name);
  const requests: WorldRequest[] = [];
  const ask = (about: WorldRequest["about"], target: string, state: unknown, questions: Record<string, JevQuestion>, extra: Pick<WorldRequest, "readings" | "decides"> = {}): void => {
    const readings = design.escalate ? extra.readings : undefined;
    const asked = { ...questions };
    if (readings !== undefined && extra.decides !== undefined) {
      for (const [id, reading] of Object.entries(readings)) {
        asked[`${MORE}${id}`] = {
          type: "noul",
          instructions: `Gaia is deciding ${extra.decides}. Would also reading ${reading.describe} make that decision clearer?`,
          criteria: { true: "Reading it would help decide.", false: "The facts given are enough to decide." },
        };
      }
      if (about === "file") {
        asked[SOURCE_WISH] = {
          type: "noul",
          instructions: `Gaia is deciding ${extra.decides}. Would reading the code of some of its functions and classes, beyond their names and sizes, make that decision clearer?`,
          criteria: { true: "Reading some of its code would help decide.", false: "The outline is enough to decide." },
        };
      }
    }
    requests.push({ about, target, request: { model: MODEL, state, questions: asked }, ...(readings === undefined ? {} : { readings, decides: extra.decides }) });
  };
  const r = facts.repository;
  ask(
    "world",
    "",
    revised
      ? { repository: { name: r.name, files: about(r.files), size: repoSize(r.lines), languages: languagesOf(facts.files) } }
      : { repository: { name: r.name, files: r.files, lines: r.lines, languages: languagesOf(facts.files) } },
    { world: choice("This repository becomes a whole world. Which art direction suits it: its light, sky, season and wind?", docs(looks.world), "world", "", salt) },
  );
  const regionList = regionPaths(dirs);
  const regions = new Set(regionList);
  const underDir = (p: string): FileFacts[] => {
    const x = dirs.get(p) as Dir;
    return [...x.files, ...x.children.flatMap(underDir)];
  };
  const measures = design.state === "words" ? regionList.map((p) => measureArea(underDir(p))) : [];
  const worldWords = lookWords(looks.world, character.world);
  for (const path of regionList) {
    const d = dirs.get(path) as Dir;
    const all: FileFacts[] = [];
    const gatherAll = (p: string): void => {
      const x = dirs.get(p) as Dir;
      all.push(...x.files);
      x.children.forEach(gatherAll);
    };
    gatherAll(path);
    const largest = [...d.files].sort((a, b) => b.lines - a.lines || byPath(a, b)).slice(0, 12);
    const inside = new Set(all.map((f) => f.path));
    const within = all.reduce((n, f) => n + f.imports.filter((i) => inside.has(i)).length, 0);
    const reaching = all.reduce((n, f) => n + f.imports.filter((i) => !inside.has(i)).length, 0);
    const reached = all.reduce((n, f) => n + f.importedBy.filter((i) => !inside.has(i)).length, 0);
    const state =
      design.state === "outline"
        ? { directory: areaOutline(facts, path), ...(worldWords === undefined ? {} : { world: worldWords }) }
        : design.state === "words"
          ? { directory: areaWords(facts, path, d.files, all, d.children, measures) }
          : {
            directory: {
              path: path === "" ? "(the repository's root)" : path,
              files: all.length,
              lines: all.reduce((n, f) => n + f.lines, 0),
              languages: languagesOf(all),
              subdirectories: d.children.map(baseName),
              imports: { withinItself: within, toOtherDirectories: reaching, fromOtherDirectories: reached },
              contents: largest.map((f) => ({ name: baseName(f.path) })),
            },
          };
    ask(
      "area",
      path,
      state,
      revised
        ? {
            land: choice("This directory becomes an area of the world. Which land suits it: its landform and its ground cover? Whether the land holds water is asked separately, so judge only its shape and its cover.", docs(looks.land), "land", path, salt),
            water: choice("Does this directory's land hold water? Each option gives a reason drawn from how the directory's code imports and is imported; choose the one whose reason fits it best.", docs(looks.water), "water", path, salt),
            character: choice("What is this area's ground like: what grows between the things standing on it, how its open ground lies and how large its trees grow? Choose the option whose reason fits this directory best.", docs(looks.character), "character", path, salt),
          }
        : {
            land: choice("This directory becomes an area of the world. Which land suits it: its landform and ground cover?", docs(looks.land), "land", path, salt),
            water: choice("Does this area's land hold water? Choose the option whose reason fits this directory best.", docs(looks.water), "water", path, salt),
          },
      { readings: areaReadings(facts, path), decides: "which land this directory's area has, whether that land holds water, and what its ground is like" },
    );
  }
  /** What was judged about the land a thing stands on, for a design that carries character. */
  const landOf = (dir: string): Record<string, unknown> => {
    const region = regionFor(regions, dir);
    const land = lookWords(looks.land, character.lands?.[region]);
    const water = lookWords(looks.water, character.waters?.[region]);
    if (land === undefined && water === undefined) return {};
    return { land: { area: region === "" ? "(the repository's root)" : region, ...(land === undefined ? {} : { landform: land }), ...(water === undefined ? {} : { water }) } };
  };
  const standingDefs = definitionsOf(facts, options.graph);
  for (const f of [...facts.files].sort(byPath)) {
    if (judged) {
      // Every definition standing on the file's patch is asked about on its own: what it stands as is Jev's call. A
      // large file's are asked over several requests, each listing the definitions it asks about.
      const defs = standingDefs.get(f.path) ?? [];
      for (let from = 0; from < defs.length; from += LAYOUT.formsPerRequest) {
        const some = defs.slice(from, from + LAYOUT.formsPerRequest);
        const forms: Record<string, JevQuestion> = {};
        for (const d of some) {
          const name = d.id.slice(d.file.length + 1);
          forms[`form#${name}`] = choice(
            `The ${KIND_WORDS[d.kind]} \`${name}\`, listed in \`standing\`, stands on this file's patch as one thing a person can walk up to and read about. Which suits it best? Judge by what its name says it does, its size and whether other files can use it.`,
            docs(looks.form),
            `form#${name}`,
            f.path,
            salt,
          );
        }
        ask("file", f.path, { file: fileWords(f, some) }, forms, { readings: fileReadings(facts, f), decides: "what this file's functions, classes, types and constants stand as" });
      }
      continue;
    }
    const standing = standingSymbols(f);
    const forms: Record<string, JevQuestion> = {};
    for (const kind of [...new Set(standing.map((s) => s.kind))].sort()) {
      forms[`form:${kind}`] = revised
        ? choice(`Each ${KIND_WORDS[kind]} declared in this file stands on the file's patch as one thing a person can walk up to and read about. Which suits this file's ${KIND_WORDS[kind]}s best?`, docs(looks.form), `form:${kind}`, f.path, salt)
        : choice(`Each ${KIND_WORDS[kind]} in this file stands on its patch as something a person can walk up to. What does each stand as?`, docs(looks.form), `form:${kind}`, f.path, salt);
    }
    // A file with nothing standing on its patch has nothing to ask.
    if (Object.keys(forms).length === 0) continue;
    const state =
      design.state === "outline"
        ? { file: fileOutline(f), ...landOf(parentOf(f.path)) }
        : design.state === "words"
          ? { file: fileWords(f) }
          : {
            file: {
              path: f.path,
              language: f.language,
              lines: f.lines,
              exports: f.symbols.filter((s) => s.exported).slice(0, 8).map((s) => s.name),
              importedBy: f.importedBy.length,
              ...(standing.length === 0 ? {} : { standing: standing.slice(0, 8).map((s) => ({ name: s.name, kind: s.kind, lines: s.lines ?? 1, exported: s.exported })) }),
            },
          };
    const kindsStanding = Object.keys(forms).map((id) => `${KIND_WORDS[id.slice("form:".length) as SymbolFact["kind"]]}s`);
    ask("file", f.path, state, forms, { readings: fileReadings(facts, f), decides: `what this file's ${kindsStanding.join(" and ")} stand as` });
  }
  const entities = new Map(facts.entities.map((e) => [e.path, e]));
  const things = {
    ...Object.fromEntries(Object.entries(looks.building).map(([k, l]) => [`building:${k}`, `A building: ${l.doc}`])),
    ...Object.fromEntries(Object.entries(looks.landmark).map(([k, l]) => [`landmark:${k}`, `A landmark seen from far away: ${l.doc}`])),
  };
  for (const e of [...facts.entities].sort(byPath)) {
    const questions: Record<string, JevQuestion> = revised
      ? {
          stands: choice(
            "This entity stands in the world as one thing. Should it be a building or a landmark? `dependedOnBy` says how many of the other entities depend on it.",
            {
              building: "A building a person can walk up to and look around: an entity that does its own work, which none or only a few of the others depend on.",
              landmark: "A landmark seen and steered by from far away: an entity several or many of the others depend on, which the rest of the world orients around.",
            },
            "stands",
            e.path,
            salt,
          ),
        }
      : {
          stands: choice(
            "This entity stands in the world as a building a person can walk up to, or as a landmark seen and steered by from far away. Which suits it?",
            things,
            "stands",
            e.path,
            salt,
          ),
        };
    for (const dep of e.dependsOn) {
      const other = entities.get(dep);
      if (other === undefined) continue;
      questions[`trail:${dep}`] = {
        type: "noul",
        instructions: revised
          ? `${e.name} depends on ${other.name}. \`dependsOn\` says how many of ${e.name}'s files import it. Would a person walk a worn trail between the two, because ${e.name} leans on it heavily?`
          : `${e.name} depends on ${other.name}. Would a person walk a worn trail between the two, because ${e.name} leans on it heavily?`,
        criteria: { true: "A trail joins them.", false: "No trail joins them." },
      };
      questions[`trail-look:${dep}`] = choice(
        revised ? `How does the trail from ${e.name} to ${other.name} look? \`dependsOn\` says how many of ${e.name}'s files import ${other.name}.` : `How does the trail from ${e.name} to ${other.name} look?`,
        docs(looks.trail),
        `trail-look:${dep}`,
        e.path,
        salt,
      );
    }
    const state =
      design.state === "outline"
        ? { entity: entityOutline(facts, e), ...landOf(e.path) }
        : design.state === "words"
          ? { entity: entityWords(facts, e) }
          : {
            entity: {
              name: e.name,
              path: e.path === "" ? "(the repository's root)" : e.path,
              form: e.form,
              files: e.files,
              lines: e.lines,
              exports: e.exports,
              dependsOn: e.dependsOn.flatMap((p) => {
                const o = entities.get(p);
                if (o === undefined) return [];
                return [revised ? { name: o.name, importers: `${howMany(importersOf(facts, e, o))} of its files`, dependents: o.dependents.length } : { name: o.name, dependents: o.dependents.length }];
              }),
              dependents: e.dependents.map((p) => entities.get(p)?.name ?? p),
              ...(revised ? { dependedOnBy: howMany(e.dependents.length) } : {}),
            },
          };
    ask("entity", e.path, state, questions, { readings: entityReadings(facts, e), decides: "whether this entity stands as a building or a landmark, which one, and which of its dependencies a trail follows" });
  }
  return design.share === "area" ? shareByArea(requests, (path) => regionFor(regions, parentOf(path))) : requests;
}

/** How a shared request is built: the most tokens one may take, and how a question names its file. */
export const SHARE = {
  /** Jev's window is 32,000 tokens of state and questions; an area with more files is asked in several requests, each with the area's facts. */
  tokens: 12000,
  /** Joins a planned question's id and the file it is about: `vibe@src/a.ts`. */
  separator: "@",
} as const;

/**
 * One request per area instead of one per file: the area's request carries
 * every question about the files on its land, over a state holding the
 * area's facts and each file's (`files`, keyed by path). Each file's
 * questions name the file, because Jev reads every question alone. An area
 * whose files outgrow `SHARE.tokens` is asked in several requests.
 */
function shareByArea(requests: readonly WorldRequest[], regionOf: (path: string) => string): WorldRequest[] {
  const files = new Map<string, WorldRequest[]>();
  for (const r of requests) if (r.about === "file") files.set(regionOf(r.target), [...(files.get(regionOf(r.target)) ?? []), r]);
  const out: WorldRequest[] = [];
  for (const r of requests) {
    if (r.about === "file") continue;
    if (r.about !== "area") {
      out.push(r);
      continue;
    }
    const base = r.request.state as Record<string, unknown>;
    let state: Record<string, unknown> = { ...base, files: {} };
    let questions: Record<string, JevQuestion> = { ...r.request.questions };
    let carries: CarriedThing[] = [{ about: "area", target: r.target, questions: Object.fromEntries(Object.keys(r.request.questions).map((id) => [id, id])) }];
    const flush = (): void => {
      out.push({ about: "area", target: r.target, request: { model: r.request.model, state, questions }, carries });
      state = { ...base, files: {} };
      questions = {};
      carries = [];
    };
    for (const f of files.get(r.target) ?? []) {
      const own = (f.request.state as { file: unknown }).file;
      const asked = Object.fromEntries(
        Object.entries(f.request.questions).map(([id, q]) => [`${id}${SHARE.separator}${f.target}`, { ...q, instructions: `About the file \`files["${f.target}"]\` in the state, not the others: ${q.instructions}` }]),
      );
      const grown = { model: r.request.model, state: { ...state, files: { ...(state.files as object), [f.target]: own } }, questions: { ...questions, ...asked } };
      if (carries.length > 0 && Object.keys(state.files as object).length > 0 && tokensOf(grown) > SHARE.tokens) flush();
      state = { ...state, files: { ...(state.files as object), [f.target]: own } };
      questions = { ...questions, ...asked };
      carries.push({ about: "file", target: f.target, questions: Object.fromEntries(Object.keys(f.request.questions).map((id) => [`${id}${SHARE.separator}${f.target}`, id])) });
    }
    if (carries.length > 0) flush();
  }
  return out;
}

/** What each thing a request judges was asked and answered, as if each had been asked on its own. */
export function unshare(p: WorldRequest, answers: Readonly<Record<string, JevAnswer>>): { p: WorldRequest; a: Readonly<Record<string, JevAnswer>> }[] {
  if (p.carries === undefined) return [{ p, a: answers }];
  return p.carries.map((t) => ({
    p: { about: t.about, target: t.target, request: { model: p.request.model, state: p.request.state, questions: Object.fromEntries(Object.entries(t.questions).map(([sent, id]) => [id, p.request.questions[sent] as JevQuestion])) } },
    a: Object.fromEntries(Object.entries(t.questions).flatMap(([sent, id]) => (answers[sent] === undefined ? [] : [[id, answers[sent] as JevAnswer]]))),
  }));
}

/**
 * The second request about a thing Jev was unsure of: the first request's
 * state with the readings Jev chose, asking again only the questions it was
 * unsure about, each with its options in the same order.
 */
export function planFollowUp(first: WorldRequest, read: readonly string[], unsure: readonly string[]): WorldRequest {
  const state = { ...(first.request.state as Record<string, unknown>) };
  for (const id of read) Object.assign(state, first.readings?.[id]?.state ?? {});
  const questions = Object.fromEntries(unsure.flatMap((id) => (first.request.questions[id] === undefined ? [] : [[id, first.request.questions[id] as JevQuestion]])));
  return { about: first.about, target: first.target, request: { model: first.request.model, state, questions } };
}

/** One thing's exchange with Jev: the first request, and the second if Jev was unsure and context grew. */
export interface Exchange {
  readonly about: WorldRequest["about"];
  readonly target: string;
  readonly first: { readonly request: JevRequest; readonly answers: Readonly<Record<string, JevAnswer>> };
  readonly second?: { readonly request: JevRequest; readonly answers: Readonly<Record<string, JevAnswer>>; readonly read: readonly string[]; readonly unsure: readonly string[] };
}

export interface JudgeOptions extends Omit<PlanOptions, "character"> {
  /** Requests in flight at once. */
  readonly concurrency?: number;
  /** Below this certainty an answer counts as unsure, for a design that escalates. */
  readonly threshold?: number;
  /** Called with each thing's exchange once it is settled. */
  readonly trace?: (exchange: Exchange) => void;
}

const pickOf = (a: JevAnswer | undefined): string | undefined => (a?.type === "choice" ? a.choice : undefined);

/** Asks every planned request through `jev`, `concurrency` at a time; for a design that carries character, top-down in three waves (the world, its areas, then files and entities). */
export async function judgeWorld(facts: CodeFacts, looks: Looks, jev: JevClient, options: JudgeOptions = {}): Promise<Judgments> {
  const design = designOf(options.design);
  const { concurrency = 8, threshold = 0.5, trace } = options;
  const askOne = async (p: WorldRequest): Promise<Readonly<Record<string, JevAnswer>>> => {
    const first = (await jev.ask(p.request)).answers;
    const readings = Object.keys(p.readings ?? {});
    const unsure = Object.keys(p.request.questions).filter((id) => !id.startsWith(MORE) && first[id] !== undefined && certainty(first[id] as JevAnswer) < threshold);
    if (!design.escalate || readings.length === 0 || unsure.length === 0) {
      for (const t of unshare(p, first)) trace?.({ about: t.p.about, target: t.p.target, first: { request: t.p.request, answers: t.a } });
      return first;
    }
    // Jev picks what to read; when it asks for nothing, the first reading in order.
    const wanted = readings.filter((id) => {
      const a = first[`${MORE}${id}`];
      return a?.type === "noul" && a.noul > 0.5;
    });
    const read = wanted.length > 0 ? wanted : readings.slice(0, 1);
    const second = planFollowUp(p, read, unsure);
    const again = (await jev.ask(second.request)).answers;
    trace?.({ about: p.about, target: p.target, first: { request: p.request, answers: first }, second: { request: second.request, answers: again, read, unsure } });
    return { ...first, ...Object.fromEntries(unsure.flatMap((id) => (again[id] === undefined ? [] : [[id, again[id] as JevAnswer]]))) };
  };
  const askAll = async (planned: readonly WorldRequest[]): Promise<Readonly<Record<string, JevAnswer>>[]> => {
    const out: Readonly<Record<string, JevAnswer>>[] = new Array(planned.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, planned.length) }, async () => {
        while (next < planned.length) {
          const i = next++;
          out[i] = await askOne(planned[i] as WorldRequest);
        }
      }),
    );
    return out;
  };
  const first = (set: LookSet): string => Object.keys(set).sort()[0] ?? "";
  const plan = (character: Character): WorldRequest[] => planWorldRequests(facts, looks, { design, character, ...(options.graph === undefined ? {} : { graph: options.graph }), ...(options.shuffle === undefined ? {} : { shuffle: options.shuffle }) });
  const answered: { p: WorldRequest; a: Readonly<Record<string, JevAnswer>> }[] = [];
  const run = async (planned: WorldRequest[]): Promise<void> => {
    const answers = await askAll(planned);
    planned.forEach((p, i) => answered.push(...unshare(p, answers[i] ?? {})));
  };
  if (!design.character) await run(plan({}));
  else {
    await run(plan({}).filter((p) => p.about === "world"));
    const world = pickOf(answered[0]?.a.world) ?? first(looks.world);
    await run(plan({ world }).filter((p) => p.about === "area"));
    const lands: Record<string, string> = {};
    const waters: Record<string, string> = {};
    for (const { p, a } of answered) {
      if (p.about !== "area") continue;
      lands[p.target] = pickOf(a.land) ?? first(looks.land);
      waters[p.target] = pickOf(a.water) ?? first(looks.water);
    }
    await run(plan({ world, lands, waters }).filter((p) => p.about === "file" || p.about === "entity"));
  }
  let world = first(looks.world);
  const lands: Record<string, string> = {};
  const things: Record<string, { as: "building" | "landmark" }> = {};
  const trails: CodeTrail[] = [];
  const forms: Record<string, Record<string, string>> = {};
  const waters: Record<string, string> = {};
  const characters: Record<string, string> = {};
  for (const { p, a } of answered) {
    if (p.about === "world") world = pickOf(a.world) ?? world;
    else if (p.about === "area") {
      lands[p.target] = pickOf(a.land) ?? first(looks.land);
      waters[p.target] = pickOf(a.water) ?? first(looks.water);
      characters[p.target] = pickOf(a.character) ?? first(looks.character);
    } else if (p.about === "file") {
      // A large file's forms are asked over several requests.
      const mine: Record<string, string> = { ...forms[p.target] };
      for (const id of Object.keys(p.request.questions)) {
        if (id.startsWith("form:")) mine[id.slice("form:".length)] = pickOf(a[id]) ?? first(looks.form);
        else if (id.startsWith("form#")) mine[id.slice("form".length)] = pickOf(a[id]) ?? first(looks.form);
      }
      if (Object.keys(mine).length > 0) forms[p.target] = mine;
    } else {
      // Whether a building or a landmark stands for the entity is Jev's first call about it; its parts are composed
      // later (`composeWorld`). Round 12's design asked one choice over both, as `landmark:` or `building:`.
      const stands = pickOf(a.stands);
      things[p.target] = { as: stands === "landmark" || stands?.startsWith("landmark:") === true ? "landmark" : "building" };
      for (const [id, answer] of Object.entries(a)) {
        if (!id.startsWith("trail:") || answer.type !== "noul") continue;
        const to = id.slice("trail:".length);
        trails.push({ from: p.target, to, want: answer.noul, look: pickOf(a[`trail-look:${to}`]) ?? first(looks.trail) });
      }
    }
  }
  return { world, lands, things, trails, forms, waters, characters };
}

/**
 * Composes every entity's building or landmark part by part, through `jev`, once the understanding pass has judged
 * the code: each composing request carries what `graph` holds about the entity (`composingState`), so it is asked
 * once and stays as it is while the code does.
 */
export async function composeWorld(facts: CodeFacts, looks: Looks, jev: JevClient, judged: Judgments, options: { readonly graph?: CodeGraph; readonly concurrency?: number } = {}): Promise<Judgments> {
  const standing = Object.entries(judged.things).map(([path, t]) => ({
    path,
    as: t.as,
    state: composingState(options.graph, facts.entities.find((e) => e.path === path) ?? { name: baseName(path), path }),
  }));
  const blueprints = await composeThings(looks.compose, jev, standing, options.concurrency ?? 8);
  return { ...judged, things: Object.fromEntries(standing.map((t) => [t.path, { as: t.as, blueprint: blueprints[t.path] as Blueprint }])) };
}

// ---------- the stand-in judge ----------

const STOP = new Set(["src", "the", "and", "for", "lib", "mod", "index", "main", "packages", "gaia"]);
const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
const sizeTag = (lines: number, small: number, large: number): string => (lines < small ? "small" : lines > large ? "large" : "medium");

/** A size tag from a count of lines, or from an outline's size words. */
const sizeOf = (value: unknown, small: number, large: number): string => {
  if (typeof value === "number") return sizeTag(value, small, large);
  const w = String(value);
  return /^(tiny|short|small|a few)/.test(w) ? "small" : /^(long|very|large|vast)/.test(w) ? "large" : "medium";
};

/** Tags read from the facts in a request's state: what the stand-in matches against each option's `suits`. Reads summary facts and outlines alike. */
function tagsOf(state: Record<string, unknown>): string[] {
  type Facts = Record<string, unknown> & { languages?: string[]; dependents?: unknown[] };
  const repo = state.repository as Facts | undefined;
  if (repo !== undefined) return [...(repo.languages ?? []).slice(0, 1), sizeOf(repo.lines ?? repo.size, 5000, 80000)];
  const dir = state.directory as Facts | undefined;
  if (dir !== undefined) {
    const imports = (dir.imports ?? {}) as { withinItself?: number; toOtherDirectories?: number; fromOtherDirectories?: number };
    const files = Math.max(1, dir.files as number);
    // How the directory's code moves: along chains of its own imports, out to others, or barely at all.
    const flow = (imports.withinItself ?? 0) >= files * 2 ? ["flow"] : (imports.fromOtherDirectories ?? 0) >= files * 2 ? ["crossroads"] : (imports.withinItself ?? 0) + (imports.toOtherDirectories ?? 0) < files * 0.3 ? ["still"] : ["dry"];
    return [...(dir.languages ?? []).slice(0, 1), sizeOf(dir.lines ?? dir.size, 600, 4000), ...flow, ...words(String(dir.path))];
  }
  const file = state.file as Facts | undefined;
  if (file !== undefined) {
    const path = String(file.path);
    const hub = typeof file.importedBy === "number" ? file.importedBy >= 4 : /^(several|many)/.test(String(file.importedByCount ?? file.importedBy));
    return [
      String(file.language),
      sizeOf(file.lines ?? file.size, 60, 300),
      ...(hub ? ["hub"] : []),
      ...(/(^|\/)(index|main|lib)\.\w+$/.test(path) ? ["entry"] : []),
      ...words(path),
    ];
  }
  const e = state.entity as Facts | undefined;
  if (e !== undefined) {
    const dependents = (e.dependents ?? []).length;
    const surface = typeof e.exports === "number" ? e.exports >= 40 : String(e.surface).startsWith("many");
    return [
      String(e.form),
      sizeOf(e.lines ?? e.size, 400, 3000),
      ...(dependents >= 6 ? ["hub"] : dependents === 0 ? ["leaf"] : []),
      ...(surface ? ["surface"] : []),
      ...(String(e.path).startsWith("(") ? ["root"] : []),
      ...words(`${String(e.name)} ${String(e.path)}`),
    ];
  }
  return [];
}

/**
 * The deterministic stand-in judge: answers the requests `planWorldRequests`
 * makes, exactly as Jev would receive them, without the network. Each option
 * scores one point per fact tag its look `suits`, plus a tie-break seeded by
 * the question and the option, so equal options spread across the world.
 * A trail's probability grows with how many entities lean on its far end.
 */
export function standInJev(looks: Looks): JevClient {
  const suits = new Map<string, readonly string[]>();
  for (const [prefix, set] of [["", looks.world], ["", looks.land], ["", looks.trail], ["", looks.form], ["", looks.water], ["", looks.character], ["building:", looks.building], ["landmark:", looks.landmark]] as const) {
    for (const [key, look] of Object.entries(set)) suits.set(`${prefix}${key}`, [...(suits.get(`${prefix}${key}`) ?? []), ...look.suits]);
  }
  const judge: JevClient = {
    async ask(request: JevRequest) {
      const state = (request.state ?? {}) as Record<string, unknown>;
      // A shared request: each file's questions are judged from that file's facts alone.
      const files = state.files as Record<string, unknown> | undefined;
      if (files !== undefined) {
        const answers: Record<string, JevAnswer> = {};
        const own: Record<string, JevQuestion> = {};
        const byFile = new Map<string, Record<string, JevQuestion>>();
        for (const [id, q] of Object.entries(request.questions)) {
          const at = id.indexOf(SHARE.separator);
          if (at < 0) own[id] = q;
          else byFile.set(id.slice(at + 1), { ...(byFile.get(id.slice(at + 1)) ?? {}), [id.slice(0, at)]: q });
        }
        const { files: _, ...rest } = state;
        if (Object.keys(own).length > 0) Object.assign(answers, (await judge.ask({ model: request.model, state: rest, questions: own })).answers);
        for (const [path, questions] of byFile) {
          const a = (await judge.ask({ model: request.model, state: { file: files[path] }, questions })).answers;
          for (const [id, answer] of Object.entries(a)) answers[`${id}${SHARE.separator}${path}`] = answer;
        }
        return { answers, model: "gaia/stand-in", costUsd: 0, ms: 0 };
      }
      const tags = new Set(tagsOf(state));
      const about = (state.file ?? state.entity ?? state.directory ?? {}) as { path?: string };
      const target = about.path ?? "";
      const answers: Record<string, JevAnswer> = {};
      for (const [id, q] of Object.entries(request.questions)) {
        if (q.type === "choice") {
          // Building or landmark is judged by how well the entity suits any building and any landmark.
          const split = id === "stands" && q.criteria.building !== undefined && q.criteria.landmark !== undefined;
          const r = rand(seedOf(`${target}:${split ? "stands" : id}`));
          // A form question is about one kind of symbol, or one symbol: its kind is a fact it suits.
          const named = id.startsWith("form#") ? ((state.file as { standing?: { name: string; kind: string }[] } | undefined)?.standing ?? []).find((s) => `form#${s.name}` === id)?.kind : undefined;
          const own = id.startsWith("form:") ? new Set([...tags, id.slice("form:".length)]) : named !== undefined ? new Set([...tags, named]) : tags;
          const keys = split ? [...Object.keys(looks.building).map((k) => `building:${k}`), ...Object.keys(looks.landmark).map((k) => `landmark:${k}`)] : Object.keys(q.criteria);
          const all = keys
            .sort()
            .map((key) => [key, (suits.get(key) ?? []).filter((s) => own.has(s)).length + r.next() * 0.6] as const);
          const scores = !split ? all : (["building", "landmark"] as const).map((as) => [as, Math.max(...all.filter(([k]) => k.startsWith(`${as}:`)).map(([, v]) => v))] as const);
          const total = scores.reduce((n, [, s]) => n + Math.exp(2 * s), 0);
          const probabilities = Object.fromEntries(scores.map(([k, s]) => [k, Math.exp(2 * s) / total]));
          const [best] = [...scores].sort((a, b) => b[1] - a[1])[0] ?? [""];
          answers[id] = { type: "choice", choice: best, probabilities, confidence: probabilities[best] ?? 0 };
        } else if (q.type === "noul" && id.startsWith(MORE)) {
          // Whether a reading would help: seeded, so some requests grow their context and the path is exercised.
          answers[id] = { type: "noul", noul: 0.2 + 0.6 * rand(seedOf(`${target}:${id}`)).next() };
        } else if (q.type === "noul") {
          const deps = ((state.entity as { dependsOn?: { name: string; dependents: number }[] } | undefined)?.dependsOn ?? []).find((d) => q.instructions.includes(`on ${d.name}.`));
          const form = (state.entity as { form?: string } | undefined)?.form;
          const p = 0.25 + 0.08 * Math.min(5, deps?.dependents ?? 0) + (form === "app" || form === "service" ? 0.1 : 0);
          answers[id] = { type: "noul", noul: Math.min(0.95, p) };
        } else {
          answers[id] = { type: "score", score: 0, probabilities: { 0: 1 }, confidence: 1 };
        }
      }
      return { answers, model: "gaia/stand-in", costUsd: 0, ms: 0 };
    },
  };
  return judge;
}

// ---------- laying the world out ----------

/** A file's ground, square meters: its lines, weighed by the part it plays, and room for each definition standing on it. */
const groundOfFile = (f: FileFacts, defs: number): number => weightOf(f) * LAYOUT.m2PerLine + defs * LAYOUT.defGround;

/**
 * The tree whose land `divideLand` divides: each directory's own ground (its
 * files and its entity's lot, the lot at its heart) and its subdirectories.
 * A directory's own ground starts at its heart, except the repository's,
 * which takes its place among the rest so trails between areas never all
 * cross it.
 */
function landTree(dirs: Map<string, Dir>, lots: ReadonlyMap<string, number>, defs: ReadonlyMap<string, readonly StandingDef[]>): LandNode {
  const node = (path: string): LandNode => {
    const d = dirs.get(path) as Dir;
    const own: LandNode[] = [];
    const lot = lots.get(path);
    if (lot !== undefined) own.push({ id: `lot:${path}`, ground: lot, children: [], heart: true });
    for (const f of d.files) own.push({ id: `file:${f.path}`, ground: groundOfFile(f, defs.get(f.path)?.length ?? 0), children: [] });
    const subs = d.children.map(node);
    if (subs.length === 0) return { id: `dir:${path}`, ground: 0, children: own };
    const children = own.length === 0 ? subs : [{ id: `own:${path}`, ground: 0, children: own, heart: path !== "" }, ...subs];
    return { id: `dir:${path}`, ground: 0, children };
  };
  return node("");
}

/**
 * Where a file's definitions stand: its patch divided among them the way the
 * land is divided, each definition's plot among the definitions inside it,
 * with the file's own ground (where its trees grow) at the heart. Each plot
 * is as large as its definition's own lines, plus
 * `LAYOUT.defGround`; every definition stands at its plot's middle.
 */
function plotDefinitions(f: FileFacts, defs: readonly StandingDef[], leaf: { readonly x: number; readonly z: number; readonly inner: readonly (readonly [number, number])[] }, step: number): { def: StandingDef; x: number; z: number }[] {
  if (defs.length === 0) return [];
  const perLine = LAYOUT.m2PerLine;
  const inside = new Map<string, StandingDef[]>();
  for (const d of defs) {
    const key = d.parent ?? "";
    const list = inside.get(key);
    if (list === undefined) inside.set(key, [d]);
    else list.push(d);
  }
  const own = (lines: number, within: readonly StandingDef[]): number => Math.max(1, lines - within.reduce((n, c) => n + c.lines, 0));
  const node = (d: StandingDef): LandNode => {
    const kids = inside.get(d.id) ?? [];
    const self: LandNode = { id: `def:${d.id}`, ground: own(d.lines, kids) * perLine + LAYOUT.defGround, children: [], heart: true };
    return kids.length === 0 ? self : { id: `in:${d.id}`, ground: 0, children: [self, ...kids.map(node)] };
  };
  const top = inside.get("") ?? [];
  const root: LandNode = { id: `file:${f.path}`, ground: 0, children: [{ id: `own:${f.path}`, ground: own(f.lines, top) * perLine, children: [], heart: true }, ...top.map(node)] };
  const plots = dividePlots(root, leaf.inner.length > 0 ? leaf.inner : [[leaf.x, leaf.z]], step);
  return defs.map((def) => {
    const p = plots.get(`def:${def.id}`) ?? { x: leaf.x, z: leaf.z };
    return { def, x: p.x, z: p.z };
  });
}

/**
 * The trails a world shows: every dependency Jev would walk (more than even
 * odds), first those that join groups of entities not yet joined, most
 * wanted and heaviest first, so every connected part of the code is walkable
 * and they route first; then the rest, most wanted first. The terrain walks
 * them all over one network of shared paths, which holds the composition by
 * its ground (`planTrails` in @gaia/terrain), so none is dropped here.
 */
function chooseTrails(wanted: readonly CodeTrail[], standing: readonly string[], weights: ReadonlyMap<string, number>): CodeTrail[] {
  const known = new Set(standing);
  const order = wanted
    .filter((t) => t.want > 0.5 && known.has(t.from) && known.has(t.to) && t.from !== t.to)
    .map((t) => ({ ...t, weight: weights.get(`${t.from}\n${t.to}`) ?? 1 }))
    .sort((a, b) => b.want - a.want || b.weight - a.weight || (a.from + a.to < b.from + b.to ? -1 : 1));
  const group = new Map(standing.map((p) => [p, p]));
  const root = (p: string): string => {
    const g = group.get(p) as string;
    if (g === p) return p;
    const r = root(g);
    group.set(p, r);
    return r;
  };
  const spanning: CodeTrail[] = [];
  const rest: CodeTrail[] = [];
  for (const t of order) {
    const a = root(t.from);
    const b = root(t.to);
    if (a !== b) {
      group.set(a, b);
      spanning.push({ ...t, spans: true });
    } else rest.push({ ...t, spans: false });
  }
  return [...spanning, ...rest];
}

interface Division {
  readonly dirs: ReturnType<typeof directoriesOf>;
  readonly size: number;
  readonly aspect: number;
  readonly land: ReturnType<typeof divideLand>;
  readonly defs: ReadonlyMap<string, readonly StandingDef[]>;
}

/** Each project's division of the land, made once for its facts and its graph: it depends on the code alone. */
const divided = new WeakMap<CodeFacts, Map<string, Division>>();
const graphIds = new WeakMap<CodeGraph, number>();
let graphCount = 0;
/** A key for a graph object (or none), so a division made on one graph is never mistaken for another's. */
function graphKey(graph: CodeGraph | undefined): string {
  if (graph === undefined) return "none";
  let id = graphIds.get(graph);
  if (id === undefined) graphIds.set(graph, (id = ++graphCount));
  return String(id);
}
function divisionOf(facts: CodeFacts, graph: CodeGraph | undefined, aspect: number): Division {
  const forModel = divided.get(facts) ?? new Map<string, Division>();
  divided.set(facts, forModel);
  const key = `${graphKey(graph)}|${aspect}`;
  const kept = forModel.get(key);
  if (kept !== undefined) return kept;
  const dirs = directoriesOf(facts, facts.repository.name);
  const defs = definitionsOf(facts, graph);
  const lots = new Map(facts.entities.map((e) => [e.path, LAYOUT.lot]));
  const total = facts.files.reduce((n, f) => n + groundOfFile(f, defs.get(f.path)?.length ?? 0), 0) + lots.size * LAYOUT.lot;
  // The land's width, so its rounded rectangle holds every square meter asked for.
  const size = Math.max(LAYOUT.minSize, Math.ceil(Math.sqrt(total / landArea({ size: 1, aspect })) / 10) * 10);
  const made = { dirs, size, aspect, land: divideLand(landTree(dirs, lots, defs), { size, aspect }), defs };
  forModel.set(key, made);
  return made;
}

/** Judgments that decide nothing: what the land is laid out with before Jev answers. */
/** What a definition stands as: the form Jev chose for it, or for its kind in its file; "" when Jev chose none. */
const formOf = (mine: Readonly<Record<string, string>> | undefined, def: StandingDef): string => mine?.[`#${def.id.slice(def.file.length + 1)}`] ?? mine?.[def.kind] ?? "";

const UNJUDGED: Judgments = { world: "", lands: {}, things: {}, trails: [], forms: {}, waters: {}, characters: {} };

/**
 * Where an entity's building or landmark will stand: its lot's middle, meters, a thing's `x` and `z`. Whichever it
 * turns out to be, it stands within `LAYOUT.lotReach` of it.
 */
export interface LotPlace {
  readonly x: number;
  readonly z: number;
}

/**
 * The world's land before anything is judged: every area, file patch, cell
 * and entity's lot exactly as `layoutWorld` lays them out once Jev has
 * answered, because the land's division depends on the code alone. Opening a
 * world shows it while Jev answers.
 */
export function landOf(facts: CodeFacts, graph?: CodeGraph, aspect: number = LAND_ASPECT): WorldPlaces & { readonly lots: readonly LotPlace[] } {
  const { world: w, lots } = layOut(facts, UNJUDGED, graph, aspect);
  return {
    name: w.name,
    size: w.size,
    aspect: w.aspect ?? aspect,
    areas: w.areas.map(({ path, name, depth, parent, x, z }) => ({ path, name, depth, parent, x, z })),
    patches: w.patches.map(({ path, name, area, x, z, radius, vitality }) => ({ path, name, area, x, z, radius, vitality })),
    cells: w.cells,
    lots,
  };
}

/** The land judged for each area's own ground, by the area's path: its region's land key. */
export function areaLands(world: Pick<CodeWorld, "areas" | "regions">): Record<string, string> {
  return Object.fromEntries(world.areas.flatMap((a) => {
    const region = world.regions[a.region];
    return region === undefined ? [] : [[a.path, region.land] as const];
  }));
}

/**
 * Lays out the world from the code and Jev's judgments. With Engine's graph,
 * every definition it holds stands, sized by its importance; without one, the code
 * facts's top-level symbols do.
 */
/**
 * Lays a world out from code. Its land takes the journal spread's proportions (`LAND_ASPECT`) unless `aspect` says
 * otherwise: the proving ground keeps a square, so its streams, bridges and ruins stay where its tests expect them.
 */
export function layoutWorld(facts: CodeFacts, judged: Judgments, graph?: CodeGraph, aspect: number = LAND_ASPECT): CodeWorld {
  return layOut(facts, judged, graph, aspect).world;
}

/** The world laid out, and every entity's lot, whether or not anything was composed to stand on it. */
function layOut(facts: CodeFacts, judged: Judgments, graph: CodeGraph | undefined, aspect: number): { readonly world: CodeWorld; readonly lots: readonly LotPlace[] } {
  const name = facts.repository.name;
  const { dirs, size, land, defs } = divisionOf(facts, graph, aspect);
  const entityAt = new Map(facts.entities.map((e) => [e.path, e]));
  const files = new Map(facts.files.map((f) => [f.path, f]));
  // Vitality is Jev's quality from the understanding pass, and a thing it didn't judge takes its nearest judged
  // folder's. A world no graph judges takes the quality fixed with its looks (the proving ground's), and a thing
  // nothing judged at all, as in a world opened without Jev, is whole.
  const quality = new Map((graph?.nodes ?? []).flatMap((n) => (n.kind !== "block" && typeof n.judged?.value?.quality === "number" ? [[n.id, n.judged.value.quality] as const] : [])));
  const folderQuality = (path: string): number | undefined => {
    for (let p: string | null = path; p !== null; p = p === "" ? null : parentOf(p)) {
      const q = quality.get(`dir:${p}`);
      if (q !== undefined) return q;
    }
    return undefined;
  };

  const regionsOf = regionPaths(dirs);
  const regionIndex = new Map(regionsOf.map((p, i) => [p, i]));
  const regionOfDir = (path: string): number => {
    for (let p: string | null = path; p !== null; p = p === "" ? null : parentOf(p)) {
      const i = regionIndex.get(p);
      if (i !== undefined) return i;
    }
    return 0;
  };

  const cells: CellPlace[] = [];
  const patches: CodePatch[] = [];
  const things: CodeThing[] = [];
  const lots: LotPlace[] = [];
  const symbols: CodeSymbol[] = [];
  /** Per directory: ground held and the ground-weighted sum of its leaves' hearts. */
  const held = new Map<string, { ground: number; x: number; z: number; hearts: { x: number; z: number }[] }>();
  const regionSites: LandSite[][] = regionsOf.map(() => []);
  const regionMass = regionsOf.map(() => ({ ground: 0, x: 0, z: 0 }));
  for (const leaf of land.leaves) {
    const [kind, path] = leaf.id.split(/:(.*)/s) as [string, string];
    const area = kind === "lot" ? path : parentOf(path);
    const cell = cells.length;
    for (const site of leaf.sites) cells.push({ area, file: kind === "file" ? path : null, x: site.x, z: site.z });
    const ri = regionOfDir(area);
    (regionSites[ri] as LandSite[]).push(...leaf.sites);
    const m = regionMass[ri] as { ground: number; x: number; z: number };
    m.ground += leaf.ground;
    m.x += leaf.x * leaf.ground;
    m.z += leaf.z * leaf.ground;
    for (let p: string | null = area; p !== null; p = p === "" ? null : parentOf(p)) {
      const h = held.get(p) ?? { ground: 0, x: 0, z: 0, hearts: [] };
      h.ground += leaf.ground;
      h.x += leaf.x * leaf.ground;
      h.z += leaf.z * leaf.ground;
      h.hearts.push({ x: leaf.x, z: leaf.z });
      held.set(p, h);
    }
    if (kind === "lot") {
      const e = entityAt.get(path) as EntityFacts;
      // An entity nothing was composed for keeps its lot as open ground: nothing stands there that Jev didn't choose.
      lots.push({ x: leaf.x, z: leaf.z });
      const t = judged.things[path];
      if (t?.blueprint !== undefined) things.push({ path, name: e.name, as: t.as, blueprint: t.blueprint, area: path, x: leaf.x, z: leaf.z, lot: LAYOUT.lotReach[t.as], vitality: folderQuality(path) ?? judged.quality?.[path] ?? 1 });
      continue;
    }
    const f = files.get(path) as FileFacts;
    const vitality = quality.get(`file:${path}`) ?? folderQuality(parentOf(path)) ?? judged.quality?.[path] ?? 1;
    patches.push({ path, name: baseName(path), area, x: leaf.x, z: leaf.z, radius: Math.sqrt(leaf.ground / Math.PI), vitality, lines: f.lines, ground: leaf.ground, cell });
    for (const { def, x, z } of plotDefinitions(f, defs.get(path) ?? [], leaf, land.step)) {
      symbols.push({
        id: def.id,
        file: path,
        ...(def.parent === undefined ? {} : { parent: def.parent }),
        name: def.name,
        kind: def.kind,
        exported: def.exported,
        line: def.line,
        lines: def.lines,
        ...(def.doc === undefined ? {} : { doc: def.doc }),
        ...(def.importance === undefined ? {} : { importance: def.importance }),
        form: formOf(judged.forms[path], def),
        x,
        z,
        vitality: quality.get(`def:${def.id}`) ?? vitality,
      });
    }
  }

  // Each area's heart: the middle of its ground, moved onto the nearest of its own leaves' hearts.
  const areas: CodeArea[] = [...dirs.values()]
    .filter((d) => held.has(d.path))
    .sort(byPath)
    .map((d) => {
      const h = held.get(d.path) as { ground: number; x: number; z: number; hearts: { x: number; z: number }[] };
      const mx = h.x / h.ground;
      const mz = h.z / h.ground;
      const heart = h.hearts.reduce((b, p) => (Math.hypot(p.x - mx, p.z - mz) < Math.hypot(b.x - mx, b.z - mz) ? p : b), h.hearts[0] as { x: number; z: number });
      return { path: d.path, name: d.name, depth: d.depth, parent: d.parent, x: heart.x, z: heart.z, region: regionOfDir(d.path), ground: h.ground };
    });

  const regions: CodeRegion[] = regionsOf.map((path, i) => {
    const m = regionMass[i] as { ground: number; x: number; z: number };
    return {
      area: path,
      x: m.ground > 0 ? m.x / m.ground : 0,
      z: m.ground > 0 ? m.z / m.ground : 0,
      reach: Math.sqrt(m.ground / Math.PI),
      land: judged.lands[path] ?? "",
      water: judged.waters[path] ?? "",
      character: judged.characters[path] ?? "",
      sites: regionSites[i] as LandSite[],
    };
  });

  // A dependency weighs as many of one entity's files as import from the other.
  const roots = facts.entities.map((e) => e.path);
  const owner = (p: string): string | undefined => roots.filter((r) => r === "" || p === r || p.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
  const weights = new Map<string, number>();
  const counted = new Set<string>();
  for (const f of facts.files) {
    const from = owner(f.path);
    if (from === undefined) continue;
    for (const to of f.imports) {
      const o = owner(to);
      const key = `${from}\n${o}`;
      if (o === undefined || o === from || counted.has(`${key}\n${f.path}`)) continue;
      counted.add(`${key}\n${f.path}`);
      weights.set(key, (weights.get(key) ?? 0) + 1);
    }
  }
  return {
    world: {
      name,
      projectId: facts.projectId,
      size,
      aspect,
      world: judged.world,
      areas,
      patches,
      cells,
      things,
      symbols,
      trails: chooseTrails(judged.trails, things.map((t) => t.path), weights),
      regions,
    },
    lots,
  };
}
