// The world a codebase becomes. The engine's facts become one code graph
// (`codeGraph`): directories holding directories and files, files holding
// their functions, classes and exported symbols, entities rooted at
// directories, and the imports and dependencies between them. `layoutWorld`
// lays that graph out as land: each directory a region of ground built of its
// own files and its subdirectories, sized by their code, with organic borders
// (`divideLand`); each file a patch of that ground; each entity standing on a
// lot at its directory's heart; a file's finer entities standing on its patch;
// and the dependencies Jev would walk as trails. The engine gives structure
// and sizes. Jev gives meaning: every look, what each kind of symbol stands
// as, whether an area holds water and why, and which dependencies become
// trails, asked by `planWorldRequests` from facts and doc comments only. The
// same code and the same answers always give the same world.
//
// Until the reviewer approves live calls, `standInJev` answers those same
// requests: a deterministic stand-in that matches each option's `suits`
// against tags read from the facts. Swapping in Jev is one line: pass the
// engine's client to `judgeWorld` instead.

import {
  type AreaPlace,
  type CellPlace,
  type CodeModel,
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
import type { LandSite } from "@gaia/terrain";
import { symbolsOf } from "./graph.ts";
import { LAND_SHARE, type LandNode, divideLand } from "./land.ts";
import { certainty } from "./context.ts";
import { type OutlineReading, areaOutline, areaReadings, entityOutline, entityReadings, fileOutline, fileReadings, howMany, importersOf, tokensOf } from "./outline.ts";
import { MODEL } from "./planner.ts";
import { entityVitalityOf, vitalityOf } from "./vitality.ts";

/** One option Jev may choose: what it is like (Jev reads this) and the facts it suits (the stand-in reads these). */
export interface Look {
  readonly doc: string;
  readonly suits: readonly string[];
}

export type LookSet = Readonly<Record<string, Look>>;

/** The options for every judgment, by key. */
export interface Looks {
  /** The repository's art direction: light, sky, season and wind. */
  readonly world: LookSet;
  /** A directory's land: landform and ground cover. */
  readonly land: LookSet;
  /** What grows on a file's patch. */
  readonly vibe: LookSet;
  readonly building: LookSet;
  readonly landmark: LookSet;
  /** How a trail between two entities looks. */
  readonly trail: LookSet;
  /** What a file's finer entity (a function, a class, a type, a constant) stands as on its patch. */
  readonly form: LookSet;
  /** Whether an area's land holds water, and why: each option's words are the reason recorded with the choice. */
  readonly water: LookSet;
  /** How an area's trees and open ground lie: a deep wood, groves and clearings, a meadow with a few old trees, a heath, a wet hollow. */
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
   * with its questions as sent (`vibe@src/a.ts`) and as planned (`vibe`).
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
  /** File → vibe key. */
  readonly vibes: Readonly<Record<string, string>>;
  /** Entity → whether a building or a landmark stands for it, and which. */
  readonly things: Readonly<Record<string, { readonly as: "building" | "landmark"; readonly look: string }>>;
  /** Dependencies Jev would walk, with how much it wants each and its look. */
  readonly trails: readonly CodeTrail[];
  /** File → symbol kind → form key: what each kind of the file's finer entities stands as. */
  readonly forms: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Directory → water key, for the directories that are regions. */
  readonly waters: Readonly<Record<string, string>>;
  /** Directory → character key, for the directories that are regions: how its trees and open ground lie. */
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
  readonly kind: string;
  /** What grows on it: a vibe key. */
  readonly vibe: string;
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
  /** The building's or landmark's look key. */
  readonly look: string;
  /** The directory it stands in: its root. */
  readonly area: string;
  /** Its lot: the middle of the ground kept for it at its directory's heart, and how far a building may stand from it. */
  readonly x: number;
  readonly z: number;
  readonly lot: number;
  readonly vitality: number;
}

/** A file's finer entity standing on its patch: a function, a class, a type or a constant. */
export interface CodeSymbol {
  /** `<file>#<name>`, its identity. */
  readonly id: string;
  readonly file: string;
  readonly name: string;
  readonly kind: SymbolFact["kind"];
  readonly exported: boolean;
  /** Where it is declared and how many lines it spans. */
  readonly line: number;
  readonly lines: number;
  readonly doc?: string;
  /** What it stands as: a form key Jev chose for its kind in its file. */
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
  /** How much a line weighs by the part its file plays: code most, configuration and data least. */
  kindWeight: { source: 1, test: 0.85, docs: 0.6, script: 0.6, config: 0.4, data: 0.3 },
  /** Ground kept for an entity's lot at its directory's heart, square meters. */
  lot: { building: 900, landmark: 700 },
  /** How far a building or landmark may stand from its lot's middle, meters. */
  lotReach: { building: 9, landmark: 7 },
  /** The smallest world, meters across. */
  minSize: 320,
  /** A directory has its own land when it holds this share of the code's ground, not counting its own lands. */
  regionShare: 0.03,
  maxRegions: 24,
  /** Square meters of a patch for each finer entity standing on it, the most on one patch, and in the world. */
  symbolGround: 240,
  symbolsPerPatch: 6,
  symbols: 420,
  /** Meters between things standing on a patch, and kept clear around its first tree. */
  symbolGap: 4.5,
  treeClear: 5,
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
const weightOf = (f: FileFacts): number => Math.min(LAYOUT.lines[1], Math.max(LAYOUT.lines[0], f.lines)) * LAYOUT.kindWeight[f.kind ?? "source"];
const byPath = <T extends { readonly path: string }>(a: T, b: T): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function directoriesOf(model: CodeModel, name: string): Map<string, Dir> {
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
  for (const f of [...model.files].sort(byPath)) ensure(parentOf(f.path)).files.push(f);
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
const trim = (text: string | undefined, n: number): string | undefined => (text === undefined || text.length <= n ? text : `${text.slice(0, n - 1).trimEnd()}…`);
const SOURCE = new Set(["typescript", "javascript", "rust", "python", "go"]);

/** Languages by lines, largest first. */
function languagesOf(files: readonly FileFacts[]): string[] {
  const lines = new Map<string, number>();
  for (const f of files) lines.set(f.language, (lines.get(f.language) ?? 0) + f.lines);
  return [...lines].filter(([l]) => SOURCE.has(l)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([l]) => l);
}

const KIND_WORDS: Readonly<Record<SymbolFact["kind"], string>> = { function: "function", class: "class", type: "type", constant: "constant", module: "module" };

/**
 * A file's finer entities that may stand on its patch: its functions and
 * classes, and the exported types and constants a doc comment describes, the
 * largest first. The layout stands as many as the patch's ground allows.
 */
export function standingSymbols(f: FileFacts): SymbolFact[] {
  if ((f.kind ?? "source") !== "source" && f.kind !== "test") return [];
  return symbolsOf(f)
    .filter((s) => s.kind === "function" || s.kind === "class" || (s.exported && s.doc !== undefined && (s.kind === "type" || s.kind === "constant")))
    .sort((a, b) => (b.lines ?? 1) * (b.exported ? 1.5 : 1) - (a.lines ?? 1) * (a.exported ? 1.5 : 1) || (a.name < b.name ? -1 : 1));
}

// ---------- designs: what Jev sees and is asked ----------

/** How Gaia builds Jev's requests: what each state is made of, how the questions are worded, and whether context grows. */
export interface Design {
  /** `facts`: each thing's summary facts. `outline`: its outline (`fileOutline`, `areaOutline`, `entityOutline`), sizes in words. */
  readonly state: "facts" | "outline";
  /** `first`: the questions as round 12 asked them. `revised`: round 13's wording, with an entity's building-or-landmark asked on its own. */
  readonly questions: "first" | "revised";
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
  /** The same facts, round 13's questions and stable words for the repository: what the app asks. */
  revised: { state: "facts", questions: "revised", character: false, escalate: false },
  /** Each thing's outline, with what was judged above it. */
  outline: { state: "outline", questions: "revised", character: true, escalate: false },
  /** The outline, and a second request with the readings Jev chose wherever it was unsure. */
  escalate: { state: "outline", questions: "revised", character: true, escalate: true },
  /** `revised`'s facts and questions, one request per area carrying its files' questions over one shared state. */
  shared: { state: "facts", questions: "revised", character: false, escalate: false, share: "area" },
  /** The same, over outlines: the area's outline and each of its files', sizes in words, so a small edit asks again rarely. */
  "shared-outline": { state: "outline", questions: "revised", character: false, escalate: false, share: "area" },
} as const satisfies Readonly<Record<string, Design>>;

export type DesignName = keyof typeof DESIGNS;
export const DEFAULT_DESIGN: DesignName = "revised";

/** Look keys judged so far, top-down, for a design that carries character. */
export interface Character {
  readonly world?: string;
  /** Region directory → land key and water key. */
  readonly lands?: Readonly<Record<string, string>>;
  readonly waters?: Readonly<Record<string, string>>;
}

export interface PlanOptions {
  readonly design?: DesignName | Design;
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

/** The repository's size, age and activity as words, so the world's request changes only when the repository does. */
const repoSize = (lines: number): string => (lines < 5000 ? "small" : lines < 25000 ? "modest" : lines < 80000 ? "substantial" : "large");
const ageWords = (days: number): string => (days < 60 ? "new: under two months old" : days < 365 ? "under a year old" : days < 730 ? "a year or two old" : "older than two years");
const activityWords = (commits: number): string => (commits === 0 ? "dormant" : commits < 10 ? "quiet" : commits < 50 ? "steady" : "busy");
const about = (n: number): string => (n < 100 ? `${n}` : `about ${Number(n.toPrecision(2)).toLocaleString("en-US")}`);
const lookWords = (set: LookSet, key: string | undefined): string | undefined => (key === undefined || set[key] === undefined ? undefined : `${key}: ${set[key].doc}`);

/** The nearest directory with land of its own that holds a path's directory. */
function regionFor(regions: ReadonlySet<string>, dir: string): string {
  for (let p: string | null = dir; p !== null; p = p === "" ? null : parentOf(p)) if (regions.has(p)) return p;
  return "";
}

/** The request Jev gets about each thing. State carries facts and doc comments only, never source. */
export function planWorldRequests(model: CodeModel, looks: Looks, options: PlanOptions = {}): WorldRequest[] {
  const design = designOf(options.design);
  const revised = design.questions === "revised";
  const salt = options.shuffle ?? "";
  const character = design.character ? (options.character ?? {}) : {};
  const dirs = directoriesOf(model, model.repository.name);
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
          instructions: `Gaia is deciding ${extra.decides}. Would reading the code of some of its functions and classes, beyond their names, sizes and doc comments, make that decision clearer?`,
          criteria: { true: "Reading some of its code would help decide.", false: "The outline is enough to decide." },
        };
      }
    }
    requests.push({ about, target, request: { model: MODEL, state, questions: asked }, ...(readings === undefined ? {} : { readings, decides: extra.decides }) });
  };
  const r = model.repository;
  ask(
    "world",
    "",
    revised
      ? { repository: { name: r.name, files: about(r.files), size: repoSize(r.lines), languages: languagesOf(model.files), age: ageWords(r.ageDays), activity: activityWords(r.commitsLast30Days), contributors: r.contributors } }
      : { repository: { name: r.name, files: r.files, lines: r.lines, languages: languagesOf(model.files), ageDays: r.ageDays, commitsLast30Days: r.commitsLast30Days, contributors: r.contributors } },
    { world: choice("This repository becomes a whole world. Which art direction suits it: its light, sky, season and wind?", docs(looks.world), "world", "", salt) },
  );
  const regionList = regionPaths(dirs);
  const regions = new Set(regionList);
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
    const kinds: Record<string, number> = {};
    for (const f of all) kinds[f.kind ?? "source"] = (kinds[f.kind ?? "source"] ?? 0) + 1;
    const largest = [...d.files].sort((a, b) => b.lines - a.lines || byPath(a, b)).slice(0, 12);
    const inside = new Set(all.map((f) => f.path));
    const within = all.reduce((n, f) => n + f.imports.filter((i) => inside.has(i)).length, 0);
    const reaching = all.reduce((n, f) => n + f.imports.filter((i) => !inside.has(i)).length, 0);
    const reached = all.reduce((n, f) => n + f.importedBy.filter((i) => !inside.has(i)).length, 0);
    const state =
      design.state === "outline"
        ? { directory: areaOutline(model, path), ...(worldWords === undefined ? {} : { world: worldWords }) }
        : {
            directory: {
              path: path === "" ? "(the repository's root)" : path,
              files: all.length,
              lines: all.reduce((n, f) => n + f.lines, 0),
              languages: languagesOf(all),
              kinds,
              subdirectories: d.children.map(baseName),
              imports: { withinItself: within, toOtherDirectories: reaching, fromOtherDirectories: reached },
              contents: largest.map((f) => ({ name: baseName(f.path), ...(f.doc === undefined ? {} : { doc: trim(f.doc, 160) }) })),
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
            character: choice("How do this area's trees and open ground lie? Choose the option whose reason fits this directory best.", docs(looks.character), "character", path, salt),
          }
        : {
            land: choice("This directory becomes an area of the world. Which land suits it: its landform and ground cover?", docs(looks.land), "land", path, salt),
            water: choice("Does this area's land hold water? Choose the option whose reason fits this directory best.", docs(looks.water), "water", path, salt),
          },
      { readings: areaReadings(model, path), decides: "which land this directory's area has, whether that land holds water, and how its trees and open ground lie" },
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
  for (const f of [...model.files].sort(byPath)) {
    const standing = standingSymbols(f);
    const forms: Record<string, JevQuestion> = {};
    for (const kind of [...new Set(standing.map((s) => s.kind))].sort()) {
      forms[`form:${kind}`] = revised
        ? choice(`Each ${KIND_WORDS[kind]} declared in this file stands on the file's patch as one small thing a person can walk up to and read about. Which suits this file's ${KIND_WORDS[kind]}s best?`, docs(looks.form), `form:${kind}`, f.path, salt)
        : choice(`Each ${KIND_WORDS[kind]} in this file stands on its patch as something a person can walk up to. What does each stand as?`, docs(looks.form), `form:${kind}`, f.path, salt);
    }
    const state =
      design.state === "outline"
        ? { file: fileOutline(f), ...landOf(parentOf(f.path)) }
        : {
            file: {
              path: f.path,
              language: f.language,
              kind: f.kind ?? "source",
              lines: f.lines,
              ...(f.doc === undefined ? {} : { doc: trim(f.doc, 300) }),
              exports: f.symbols.filter((s) => s.exported).slice(0, 8).map((s) => (s.doc === undefined ? s.name : `${s.name}: ${trim(s.doc, 100)}`)),
              importedBy: f.importedBy.length,
              coveredByTests: f.tests.coveredBy.length,
              ...(standing.length === 0 ? {} : { standing: standing.slice(0, 8).map((s) => ({ name: s.name, kind: s.kind, lines: s.lines ?? 1, exported: s.exported, ...(s.doc === undefined ? {} : { doc: trim(s.doc, 100) }) })) }),
            },
          };
    const vibe = revised
      ? choice("This file becomes a patch of ground in its directory's area, and what grows there shows what the file is and does. Which suits this file? Judge by the part it plays, its size and how much code imports it, not by what its words are about: a file about light or grass is judged like any other.", docs(looks.vibe), "vibe", f.path, salt)
      : choice("This file becomes a patch of ground in its directory's area. What grows on it?", docs(looks.vibe), "vibe", f.path, salt);
    const kindsStanding = Object.keys(forms).map((id) => `${KIND_WORDS[id.slice("form:".length) as SymbolFact["kind"]]}s`);
    ask("file", f.path, state, { vibe, ...forms }, { readings: fileReadings(model, f), decides: `what grows on this file's patch${kindsStanding.length === 0 ? "" : ` and what its ${kindsStanding.join(" and ")} stand as`}` });
  }
  const entities = new Map(model.entities.map((e) => [e.path, e]));
  const things = {
    ...Object.fromEntries(Object.entries(looks.building).map(([k, l]) => [`building:${k}`, `A building: ${l.doc}`])),
    ...Object.fromEntries(Object.entries(looks.landmark).map(([k, l]) => [`landmark:${k}`, `A landmark seen from far away: ${l.doc}`])),
  };
  for (const e of [...model.entities].sort(byPath)) {
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
          building: choice("If this entity stands as a building, which building suits it?", docs(looks.building), "building", e.path, salt),
          landmark: choice("If this entity stands as a landmark, which landmark suits it?", docs(looks.landmark), "landmark", e.path, salt),
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
        ? { entity: entityOutline(model, e), ...landOf(e.path) }
        : {
            entity: {
              name: e.name,
              path: e.path === "" ? "(the repository's root)" : e.path,
              form: e.form,
              ...(e.doc === undefined ? {} : { doc: trim(e.doc, 300) }),
              files: e.files,
              lines: e.lines,
              languages: e.languages,
              exports: e.exports,
              dependsOn: e.dependsOn.flatMap((p) => {
                const o = entities.get(p);
                if (o === undefined) return [];
                return [revised ? { name: o.name, importers: `${howMany(importersOf(model, e, o))} of its files`, dependents: o.dependents.length } : { name: o.name, dependents: o.dependents.length }];
              }),
              dependents: e.dependents.map((p) => entities.get(p)?.name ?? p),
              ...(revised ? { dependedOnBy: howMany(e.dependents.length) } : {}),
            },
          };
    ask("entity", e.path, state, questions, { readings: entityReadings(model, e), decides: "whether this entity stands as a building or a landmark, which one, and which of its dependencies a trail follows" });
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
export async function judgeWorld(model: CodeModel, looks: Looks, jev: JevClient, options: JudgeOptions = {}): Promise<Judgments> {
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
  const plan = (character: Character): WorldRequest[] => planWorldRequests(model, looks, { design, character, ...(options.shuffle === undefined ? {} : { shuffle: options.shuffle }) });
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
  const vibes: Record<string, string> = {};
  const things: Record<string, { as: "building" | "landmark"; look: string }> = {};
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
      vibes[p.target] = pickOf(a.vibe) ?? first(looks.vibe);
      const mine: Record<string, string> = {};
      for (const id of Object.keys(p.request.questions)) if (id.startsWith("form:")) mine[id.slice("form:".length)] = pickOf(a[id]) ?? first(looks.form);
      if (Object.keys(mine).length > 0) forms[p.target] = mine;
    } else {
      // Revised questions ask building-or-landmark on its own, then each look; the first asked one choice over both.
      const stands = pickOf(a.stands);
      if (stands === "building" || stands === "landmark") things[p.target] = { as: stands, look: pickOf(a[stands]) ?? first(looks[stands]) };
      else {
        const [as, look] = (stands ?? `building:${first(looks.building)}`).split(/:(.*)/s) as [string, string];
        things[p.target] = { as: as === "landmark" ? "landmark" : "building", look };
      }
      for (const [id, answer] of Object.entries(a)) {
        if (!id.startsWith("trail:") || answer.type !== "noul") continue;
        const to = id.slice("trail:".length);
        trails.push({ from: p.target, to, want: answer.noul, look: pickOf(a[`trail-look:${to}`]) ?? first(looks.trail) });
      }
    }
  }
  return { world, lands, vibes, things, trails, forms, waters, characters };
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
  type Facts = Record<string, unknown> & { languages?: string[]; kinds?: Record<string, number>; dependents?: unknown[] };
  const repo = state.repository as Facts | undefined;
  if (repo !== undefined) {
    const busy = repo.activity !== undefined ? repo.activity === "busy" : (repo.commitsLast30Days as number) >= 50;
    const young = repo.age !== undefined ? String(repo.age).startsWith("new") : (repo.ageDays as number) < 60;
    return [...(repo.languages ?? []).slice(0, 1), busy ? "busy" : "quiet", young ? "young" : "old", sizeOf(repo.lines ?? repo.size, 5000, 80000)];
  }
  const dir = state.directory as Facts | undefined;
  if (dir !== undefined) {
    const kinds = Object.entries(dir.kinds ?? {}).sort((a, b) => b[1] - a[1]);
    const imports = (dir.imports ?? {}) as { withinItself?: number; toOtherDirectories?: number; fromOtherDirectories?: number };
    const files = Math.max(1, dir.files as number);
    // How the directory's code moves: along chains of its own imports, out to others, or barely at all.
    const flow = (imports.withinItself ?? 0) >= files * 2 ? ["flow"] : (imports.fromOtherDirectories ?? 0) >= files * 2 ? ["crossroads"] : (imports.withinItself ?? 0) + (imports.toOtherDirectories ?? 0) < files * 0.3 ? ["still"] : ["dry"];
    return [kinds[0]?.[0] ?? "source", ...(dir.languages ?? []).slice(0, 1), sizeOf(dir.lines ?? dir.size, 600, 4000), ...flow, ...words(String(dir.path))];
  }
  const file = state.file as Facts | undefined;
  if (file !== undefined) {
    const path = String(file.path);
    const hub = typeof file.importedBy === "number" ? file.importedBy >= 4 : ["several", "many"].includes(String(file.importedByCount));
    return [
      String(file.kind),
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
      ...(e.languages ?? []),
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
  for (const [prefix, set] of [["", looks.world], ["", looks.land], ["", looks.vibe], ["", looks.trail], ["", looks.form], ["", looks.water], ["", looks.character], ["building:", looks.building], ["landmark:", looks.landmark]] as const) {
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
          // Building-or-landmark and each look, asked apart, are judged as the one choice over both: the same thing stands either way.
          const split = request.questions.building !== undefined && (id === "stands" || id === "building" || id === "landmark");
          const r = rand(seedOf(`${target}:${split ? "stands" : id}`));
          // A form question is about one kind of symbol: the kind is a fact it suits.
          const own = id.startsWith("form:") ? new Set([...tags, id.slice("form:".length)]) : tags;
          const keys = split ? [...Object.keys(looks.building).map((k) => `building:${k}`), ...Object.keys(looks.landmark).map((k) => `landmark:${k}`)] : Object.keys(q.criteria);
          const all = keys
            .sort()
            .map((key) => [key, (suits.get(key) ?? []).filter((s) => own.has(s)).length + r.next() * 0.6] as const);
          const scores = !split ? all : id === "stands" ? (["building", "landmark"] as const).map((as) => [as, Math.max(...all.filter(([k]) => k.startsWith(`${as}:`)).map(([, v]) => v))] as const) : all.filter(([k]) => k.startsWith(`${id}:`)).map(([k, v]) => [k.slice(id.length + 1), v] as const);
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

/** A file's ground, square meters: its lines, weighed by the part it plays. */
const groundOfFile = (f: FileFacts): number => weightOf(f) * LAYOUT.m2PerLine;

/**
 * The tree whose land `divideLand` divides: each directory's own ground (its
 * files and its entity's lot, the lot at its heart) and its subdirectories.
 * A directory's own ground starts at its heart, except the repository's,
 * which takes its place among the rest so trails between areas never all
 * cross it.
 */
function landTree(dirs: Map<string, Dir>, lots: ReadonlyMap<string, number>): LandNode {
  const node = (path: string): LandNode => {
    const d = dirs.get(path) as Dir;
    const own: LandNode[] = [];
    const lot = lots.get(path);
    if (lot !== undefined) own.push({ id: `lot:${path}`, ground: lot, children: [], heart: true });
    for (const f of d.files) own.push({ id: `file:${f.path}`, ground: groundOfFile(f), children: [] });
    const subs = d.children.map(node);
    if (subs.length === 0) return { id: `dir:${path}`, ground: 0, children: own };
    const children = own.length === 0 ? subs : [{ id: `own:${path}`, ground: 0, children: own, heart: path !== "" }, ...subs];
    return { id: `dir:${path}`, ground: 0, children };
  };
  return node("");
}

/**
 * Where a patch's finer entities stand: spread over its ground, each the
 * farthest it can get from its first tree and the others, at least
 * `LAYOUT.symbolGap` apart; as many as its ground allows, largest first.
 */
function standSymbols(f: FileFacts, heart: { x: number; z: number }, inner: readonly (readonly [number, number])[], ground: number, room: number): { symbol: SymbolFact; x: number; z: number }[] {
  const want = Math.min(LAYOUT.symbolsPerPatch, Math.floor(ground / LAYOUT.symbolGround), room);
  const candidates = standingSymbols(f).slice(0, Math.max(0, want));
  // Each placed thing keeps others this far off: the first tree its crown, a symbol the gap.
  const placed: { x: number; z: number; keep: number }[] = [{ ...heart, keep: LAYOUT.treeClear }];
  const out: { symbol: SymbolFact; x: number; z: number }[] = [];
  for (const symbol of candidates) {
    const r = rand(seedOf(`${f.path}#${symbol.name}`));
    let best: readonly [number, number] | null = null;
    let score = -Infinity;
    for (const p of inner) {
      const room = Math.min(...placed.map((q) => Math.hypot(p[0] - q.x, p[1] - q.z) - q.keep));
      if (room < 0) continue;
      const s = Math.min(room, 9) + r.next() * 1.5;
      if (s > score) {
        score = s;
        best = p;
      }
    }
    if (best === null) continue;
    placed.push({ x: best[0], z: best[1], keep: LAYOUT.symbolGap });
    out.push({ symbol, x: best[0], z: best[1] });
  }
  return out;
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

/** Lays out the world from the code and Jev's judgments. */
export function layoutWorld(model: CodeModel, judged: Judgments): CodeWorld {
  const name = model.repository.name;
  const dirs = directoriesOf(model, name);
  const entityAt = new Map(model.entities.map((e) => [e.path, e]));
  const files = new Map(model.files.map((f) => [f.path, f]));
  const asOf = (path: string): "building" | "landmark" => (judged.things[path]?.as === "landmark" ? "landmark" : "building");
  const lots = new Map(model.entities.map((e) => [e.path, LAYOUT.lot[asOf(e.path)]]));
  const tree = landTree(dirs, lots);
  const total = model.files.reduce((n, f) => n + groundOfFile(f), 0) + [...lots.values()].reduce((a, b) => a + b, 0);
  const size = Math.max(LAYOUT.minSize, Math.ceil(Math.sqrt(total / LAND_SHARE) / 10) * 10);
  const land = divideLand(tree, size);

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
      const t = judged.things[path] ?? { as: "building", look: "" };
      things.push({ path, name: e.name, as: t.as, look: t.look, area: path, x: leaf.x, z: leaf.z, lot: LAYOUT.lotReach[t.as], vitality: entityVitalityOf(e).vitality });
      continue;
    }
    const f = files.get(path) as FileFacts;
    const vitality = vitalityOf(f).vitality;
    patches.push({ path, name: baseName(path), area, x: leaf.x, z: leaf.z, radius: Math.sqrt(leaf.ground / Math.PI), vitality, lines: f.lines, kind: f.kind ?? "source", vibe: judged.vibes[path] ?? "", ground: leaf.ground, cell });
    for (const s of standSymbols(f, leaf, leaf.inner, leaf.ground, LAYOUT.symbols - symbols.length)) {
      symbols.push({
        id: `${path}#${s.symbol.name}`,
        file: path,
        name: s.symbol.name,
        kind: s.symbol.kind,
        exported: s.symbol.exported,
        line: s.symbol.line ?? 0,
        lines: s.symbol.lines ?? 1,
        ...(s.symbol.doc === undefined ? {} : { doc: s.symbol.doc }),
        form: judged.forms[path]?.[s.symbol.kind] ?? "",
        x: s.x,
        z: s.z,
        vitality,
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
  const roots = model.entities.map((e) => e.path);
  const owner = (p: string): string | undefined => roots.filter((r) => r === "" || p === r || p.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
  const weights = new Map<string, number>();
  const counted = new Set<string>();
  for (const f of model.files) {
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
    name,
    projectId: model.projectId,
    size,
    world: judged.world,
    areas,
    patches,
    cells,
    things,
    symbols,
    trails: chooseTrails(judged.trails, things.map((t) => t.path), weights),
    regions,
  };
}
