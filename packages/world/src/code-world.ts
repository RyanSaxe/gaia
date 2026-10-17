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
  type Need,
  type PatchPlace,
  type SymbolFact,
  type ThingFacts,
  type WorldPlaces,
  meets,
  rand,
  seedOf,
} from "@gaia/schema";
import { LAND_ASPECT, type LandSite, landArea } from "@gaia/terrain";
import { type StandingDef, definitionsOf } from "./definitions.ts";
import { type LandNode, divideLand, dividePlots } from "./land.ts";
import { MODEL } from "./planner.ts";
import { type Composed, type Composing, areaState, composeThing, composeThings, composingState, definitionState, fileState, repositoryState, share, trailState, trim } from "./compose.ts";

/** One option Jev may choose: what it is like, in the words Jev reads. */
export interface Look {
  readonly doc: string;
  /** What a place with this look has that a part may need, such as running water for a waterwheel. */
  readonly holds?: readonly string[];
  /**
   * What a thing must be for this look to be offered it, as a primitive's needs
   * say (`meets`): for a form, the range of rank by importance among the
   * world's own things that it suits.
   */
  readonly needs?: readonly Need[];
  /** For a form: the kind Jev composes it from part by part once chosen. A form without one stands as its own blueprint. */
  readonly composes?: "building" | "landmark";
  /**
   * For a water: what choosing it settles in the land composed for its area, per field path (a valley's
   * `relief.stream`, a basin's `relief.pond`), filled in there and never asked again.
   */
  readonly settles?: Readonly<Record<string, string | boolean>>;
}

export type LookSet = Readonly<Record<string, Look>>;

/** The options for every judgment, by key. */
export interface Looks {
  /** What composes the world part by part (its sky, lands, buildings, landmarks and trails): Jev chooses their parts, never a preset. */
  readonly compose: Composing;
  /**
   * What any entity, file or definition stands as: flowers, a stone, a bush, a
   * tree, a building or a landmark. Each form's `needs` give the range of rank
   * by importance it is offered to, and one that `composes` is composed part
   * by part.
   */
  readonly form: LookSet;
  /** Whether an area's land holds water, and why: each option's words are the reason recorded with the choice. */
  readonly water: LookSet;
}

/** One Jev request about one thing. */
export interface WorldRequest {
  readonly about: "world" | "area" | "file" | "entity";
  /** The thing's path: a directory, a file or an entity's root; "" for the repository. */
  readonly target: string;
  readonly request: JevRequest;
  /** For a request about what things stand as (`planStanding`): the thing each question is about, by question id. */
  readonly stands?: Readonly<Record<string, string>>;
}

/** Everything Jev decided about a world. */
export interface Judgments {
  /** The whole world's light, sky and wind, as Jev composed them (`composeWorld`); none until then. */
  readonly sky?: Blueprint;
  /** Directory → the land Jev composed for it, for the directories that are regions (`composeWorld`). */
  readonly lands: Readonly<Record<string, Blueprint>>;
  /**
   * What every entity, file and definition stands as, by its id (an entity's root directory, a file's path or a
   * definition's `<file>#<name>`): the form Jev chose for it among those its importance is offered, asked once the
   * understanding pass has judged the code (`composeWorld`).
   */
  readonly stands?: Readonly<Record<string, string>>;
  /**
   * Each thing that stands as a building or a landmark, by its id as in `stands`, and the blueprint Jev composed for
   * it (`composeWorld`); a thing not yet composed has none and stands nowhere.
   */
  readonly things: Readonly<Record<string, { readonly as: "building" | "landmark"; readonly blueprint?: Blueprint }>>;
  /** Dependencies Jev would walk, with how much it wants each and, once composed, how each trail looks. */
  readonly trails: readonly CodeTrail[];
  /**
   * File or directory → its quality, 0 to 1, for a world no engine graph
   * judges: the proving ground's, fixed with its looks. Vitality reads it
   * where the graph gives none.
   */
  readonly quality?: Readonly<Record<string, number>>;
  /** Directory → water key, for the directories that are regions. */
  readonly waters: Readonly<Record<string, string>>;
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

/**
 * A building or a landmark in the world: an entity's on its lot, a file's at
 * its patch's heart, or a definition's on its own plot.
 */
export interface CodeThing {
  /** Its identity: an entity's root path, a file's path or a definition's `<file>#<name>`. */
  readonly path: string;
  /** What it stands for; an entity when absent. */
  readonly of?: "entity" | "file" | "definition";
  readonly name: string;
  readonly as: "building" | "landmark";
  /** What it is built from: the parts and settings Jev composed for it. */
  readonly blueprint: Blueprint;
  /** The directory it stands in: an entity's root, or a file's directory. */
  readonly area: string;
  /** Where it stands (an entity's lot, a file's heart, a definition's plot), and how far it may stand from there. */
  readonly x: number;
  readonly z: number;
  readonly lot: number;
  /** The file whose patch it stands on, for a file's or a definition's. */
  readonly file?: string;
  /** What a file's or a definition's building or landmark reads its numbers from; an entity's are its own facts. */
  readonly facts?: ThingFacts;
  readonly vitality: number;
}

/** A file or an entity standing as flowers, a stone, a bush or a tree: at its patch's heart, or on its lot. */
export interface CodeStanding {
  readonly of: "file" | "entity";
  /** A file's path or an entity's root path. */
  readonly path: string;
  readonly name: string;
  /** The form Jev chose for it. */
  readonly form: string;
  readonly lines: number;
  /** How much it matters, 0 to 1: Jev's importance; its size follows it. */
  readonly importance?: number;
  readonly x: number;
  readonly z: number;
  /** The file whose patch it stands on; none for an entity, which stands on its lot. */
  readonly file?: string;
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
  /** What it stands as: the form key Jev chose for it; "" before anything is judged. */
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
  /** How it looks, as Jev composed it: a link blueprint whose route keeps its own width, wear, edging, winding and crossing. */
  readonly route?: Blueprint;
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
  /** Its land as Jev composed it: a biome blueprint. None for a world laid out before composing. */
  readonly biome?: Blueprint;
  /** Whether its land holds water: a water key, whose words say why. */
  readonly water: string;
  /** The cells its land is made of: the sites of its files' patches and its lots (`RegionSpec.sites`). */
  readonly sites: readonly LandSite[];
}

/** A world document laid out from code: every area, patch, thing, symbol and trail, the land's cells, and the terrain's regions. */
export interface CodeWorld extends WorldPlaces {
  readonly projectId: string;
  /** Side of the walkable square, meters: it grows with the codebase. */
  readonly size: number;
  /** The repository's art direction, its light, sky and wind, as Jev composed them. */
  readonly sky?: Blueprint;
  readonly areas: readonly CodeArea[];
  readonly patches: readonly CodePatch[];
  /** Every cell of the land, each part of one file's patch or one entity's lot, naming its area and its file (null for a lot). */
  readonly cells: readonly CellPlace[];
  readonly things: readonly CodeThing[];
  /** Every definition standing on its file's patch: as flowers, a stone, a bush or a tree, or as one of `things`. */
  readonly symbols: readonly CodeSymbol[];
  /** Each file and entity that stands as flowers, a stone, a bush or a tree. */
  readonly standing: readonly CodeStanding[];
  readonly trails: readonly CodeTrail[];
  readonly regions: readonly CodeRegion[];
}

export const LAYOUT = {
  /** Square meters of ground per line of code. */
  m2PerLine: 10,
  /** A file's lines count between these for its patch's size. */
  lines: [20, 1500],
  /**
   * Ground kept for an entity's lot at its directory's heart, square meters:
   * the same for a building or a landmark, so the land's division depends on
   * the code alone and is known before Jev answers (`landOf`).
   */
  lot: 600,
  /** How far a building or landmark may stand from its lot's middle, meters. */
  lotReach: { building: 7, landmark: 6 },
  /** The smallest world, meters across. */
  minSize: 260,
  /** A directory has its own land when it holds this share of the code's ground, not counting its own lands. */
  regionShare: 0.03,
  maxRegions: 24,
  /**
   * The share of a file's patch its definitions are plotted on, the part nearest its middle: they gather into a copse
   * there with open ground round it, so woods and meadows alternate.
   */
  cluster: 0.3,
  /** Square meters each definition standing on a file's patch adds to it, on top of the file's lines. */
  defGround: 50,
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

/** Option order seeded by the target, as the planner does: Jev leans toward the first option. */
function shuffled<T>(items: readonly T[], label: string, target: string): T[] {
  const r = rand(seedOf(target)).fork(label);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function choice(instructions: string, options: Readonly<Record<string, string>>, label: string, target: string): JevQuestion {
  const keys = shuffled(Object.keys(options).sort(), label, target);
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

// ---------- what Jev is sent ----------

const bucket = (n: number, edges: readonly number[], words: readonly string[]): string => words[edges.findIndex((e) => n < e)] ?? (words[words.length - 1] as string);

// Sizes are words, not line counts: Jev reads words better than numbers, and a request's key is the hash of what it
// sends, so a one-line edit that leaves a file "medium" never asks Jev again.
/** A file's size in words. */
const fileSize = (lines: number): string => bucket(lines, [30, 120, 400, 1000], ["tiny", "short", "medium", "long", "very long"]);
/** A function's or class's size in words. */
const symbolSize = (lines: number): string => bucket(lines, [5, 25, 80, 200], ["a few lines", "short", "medium", "long", "very long"]);
/** A directory's or entity's size in words. */
const bodySize = (lines: number): string => bucket(lines, [300, 1500, 6000, 20000], ["small", "medium", "large", "very large", "vast"]);
/** How many, in words: none, one, a few, several or many. */
const howMany = (n: number): string => bucket(n, [1, 2, 5, 13], ["none", "one", "a few", "several", "many"]);

/** The order a file's symbols are named in: exported ones first, then by size, then by name. */
const outlineOrder = (f: FileFacts): SymbolFact[] => [...f.symbols].sort((a, b) => Number(b.exported) - Number(a.exported) || (b.lines ?? 1) - (a.lines ?? 1) || (a.name < b.name ? -1 : 1));

/** How many of `from`'s files import from `to`. */
function importersOf(facts: CodeFacts, from: EntityFacts, to: EntityFacts): number {
  const roots = facts.entities.map((e) => e.path);
  const owner = (p: string): string | undefined => roots.filter((r) => r === "" || p === r || p.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
  return facts.files.filter((f) => owner(f.path) === from.path && f.imports.some((i) => owner(i) === to.path)).length;
}

/** Engine's graph, whose definitions stand on each file's patch as the layout stands them; without it, the facts' own. */
export interface PlanOptions {
  readonly graph?: CodeGraph;
}

const lookWords = (set: LookSet, key: string | undefined): string | undefined => (key === undefined || set[key] === undefined ? undefined : `${key}: ${set[key].doc}`);

/** A count per file in words: how much of something each of a directory's files does on average. */
const perFile = (n: number, files: number): string => {
  const r = n / Math.max(1, files);
  return r === 0 ? "none" : r < 0.5 ? "a little" : r < 1.5 ? "some" : "a lot";
};
/**
 * A file as `judged` sends it: what it declares, its size and links in words, and the definitions standing on its
 * patch that the request asks about. Asked what things stand as, it also says how much the file and each definition
 * matter (Jev's importance) and each definition's doc.
 */
export function fileWords(f: FileFacts, standing: readonly StandingDef[] = [], importance?: number): Record<string, unknown> {
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
    ...(share(importance) === undefined ? {} : { importance: share(importance) }),
    ...(standing.length === 0
      ? {}
      : {
          standing: standing.map((d) => ({
            name: d.id.slice(d.file.length + 1),
            kind: d.kind,
            size: symbolSize(d.lines),
            exported: d.exported,
            ...(share(d.importance) === undefined ? {} : { importance: share(d.importance) }),
            ...(d.doc === undefined ? {} : { doc: trim(d.doc, 100) }),
          })),
        }),
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
 * Where a value ranks among values sorted from least to most: 0 below every
 * other, 1 above every other, and values that tie take the middle of the
 * places they share. It is how a thing's importance ranks among the world's
 * own things, which each form's range is read against, and how an area
 * compares with the others.
 */
export function rankAmong(value: number, sorted: readonly number[]): number {
  if (sorted.length < 2) return 0.5;
  const first = (above: (v: number) => boolean): number => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (above(sorted[mid] as number)) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  const below = first((v) => v >= value);
  const equal = first((v) => v > value) - below;
  return (below + (Math.max(1, equal) - 1) / 2) / (sorted.length - 1);
}

/**
 * Where a value stands among the repository's areas, in words. Jev answers
 * each area's request alone and never sees the others, so a judgment such as
 * "much of the code leans on this area" needs the comparison made for it.
 */
function standing(value: number, all: readonly number[]): string {
  if (all.length < 3) return "about the middle of this repository's areas";
  const p = rankAmong(value, [...all].sort((a, b) => a - b));
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

/**
 * The request Jev gets about each area and each entity, from the code's structure only, never source: whether each
 * area's land holds water, and which of each entity's dependencies a person would walk a trail along. What every
 * entity, file and definition stands as is asked once the understanding pass has judged how much each matters
 * (`planStanding`).
 */
export function planWorldRequests(facts: CodeFacts, looks: Looks): WorldRequest[] {
  const dirs = directoriesOf(facts, facts.repository.name);
  const requests: WorldRequest[] = [];
  const ask = (about: WorldRequest["about"], target: string, state: unknown, questions: Record<string, JevQuestion>): void => {
    requests.push({ about, target, request: { model: MODEL, state, questions } });
  };
  // The whole world's light, sky and wind are composed part by part once the code is understood (`composeWorld`), so
  // nothing about the repository as a whole is asked here.
  const regionList = regionPaths(dirs);
  const underDir = (p: string): FileFacts[] => {
    const x = dirs.get(p) as Dir;
    return [...x.files, ...x.children.flatMap(underDir)];
  };
  const measures = regionList.map((p) => measureArea(underDir(p)));
  for (const path of regionList) {
    const d = dirs.get(path) as Dir;
    ask("area", path, { directory: areaWords(facts, path, d.files, underDir(path), d.children, measures) }, {
      water: choice("Does this directory's land hold water? Each option gives a reason drawn from how the directory's code imports and is imported; choose the one whose reason fits it best.", docs(looks.water), "water", path),
    });
  }
  const entities = new Map(facts.entities.map((e) => [e.path, e]));
  for (const e of [...facts.entities].sort(byPath)) {
    const questions: Record<string, JevQuestion> = {};
    for (const dep of e.dependsOn) {
      const other = entities.get(dep);
      if (other === undefined) continue;
      questions[`trail:${dep}`] = {
        type: "noul",
        instructions: `${e.name} depends on ${other.name}. \`dependsOn\` says how many of ${e.name}'s files import it. Would a person walk a worn trail between the two, because ${e.name} leans on it heavily?`,
        criteria: { true: "A trail joins them.", false: "No trail joins them." },
      };
    }
    if (Object.keys(questions).length > 0) ask("entity", e.path, { entity: entityWords(facts, e) }, questions);
  }
  return requests;
}

// ---------- what each thing stands as ----------

/** One thing that stands for code: an entity, a file or a definition, with Jev's importance once the understanding pass has judged it. */
export interface StandingThing {
  readonly of: "entity" | "file" | "definition";
  /** An entity's root path, a file's path or a definition's `<file>#<name>`: its id in `Judgments.stands`. */
  readonly id: string;
  readonly importance?: number;
}

/** Every entity, file and definition that stands in the world, each with its importance: the things ranks are read among. */
export function standingThings(facts: CodeFacts, graph?: CodeGraph): StandingThing[] {
  const importance = new Map((graph?.nodes ?? []).flatMap((n) => (n.kind !== "block" && typeof n.judged?.value?.importance === "number" ? [[n.id, n.judged.value.importance] as const] : [])));
  const thing = (of: StandingThing["of"], id: string, value: number | undefined): StandingThing => ({ of, id, ...(value === undefined ? {} : { importance: value }) });
  return [
    ...[...facts.entities].sort(byPath).map((e) => thing("entity", e.path, importance.get(`dir:${e.path}`))),
    ...[...facts.files].sort(byPath).map((f) => thing("file", f.path, importance.get(`file:${f.path}`))),
    ...[...definitionsOf(facts, graph).values()].flat().map((d) => thing("definition", d.id, d.importance)),
  ];
}

/**
 * Each thing's rank by importance among the world's own entities, files and
 * definitions together, by its id (`rankAmong`): 0 the least important, 1 the
 * most. A thing the understanding pass gave no importance ranks as if it had
 * none. A rank is a share of the world's own things, so a form's range offers
 * it to the same share of things in a world of any size.
 */
export function rankThings(facts: CodeFacts, graph?: CodeGraph): ReadonlyMap<string, number> {
  const things = standingThings(facts, graph);
  const sorted = things.map((t) => t.importance ?? 0).sort((a, b) => a - b);
  return new Map(things.map((t) => [t.id, rankAmong(t.importance ?? 0, sorted)]));
}

/** The forms a thing of this rank is offered: every form whose needs it meets (`meets`), by key. */
export function formsFor(looks: Looks, rank: number): string[] {
  return Object.keys(looks.form)
    .sort()
    .filter((k) => meets(looks.form[k]?.needs, { has: [], rank }));
}

/** How what each thing stands as is asked: the requests, and what each thing offered one form alone stands as, unasked. */
export interface StandingPlan {
  readonly requests: readonly WorldRequest[];
  readonly only: Readonly<Record<string, string>>;
}

/**
 * The requests that ask what every entity, file and definition stands as,
 * once the understanding pass has judged how much each matters: one question
 * a thing, among the forms its rank is offered (`formsFor`), with its
 * importance in the state. A file's own question goes with the first of its
 * definitions', `LAYOUT.formsPerRequest` of them to a request; an entity has a
 * request of its own.
 */
export function planStanding(facts: CodeFacts, looks: Looks, options: PlanOptions = {}): StandingPlan {
  const { graph } = options;
  const ranks = rankThings(facts, graph);
  const importance = new Map(standingThings(facts, graph).flatMap((t) => (t.importance === undefined ? [] : [[t.id, t.importance] as const])));
  const only: Record<string, string> = {};
  const requests: WorldRequest[] = [];
  const RARE = "Only the forms that suit how much it matters (`importance`) are offered; choose by character.";
  /** The question about one thing, or none when its rank is offered one form alone, which it then stands as. */
  const question = (id: string, instructions: string, label: string, target: string): JevQuestion | undefined => {
    const offered = formsFor(looks, ranks.get(id) ?? 0.5);
    if (offered.length === 0) throw new Error(`No form is offered to ${id || "the repository's root"}: the forms' ranges must cover every rank.`);
    if (offered.length === 1) {
      only[id] = offered[0] as string;
      return undefined;
    }
    return choice(`${instructions} ${RARE}`, Object.fromEntries(offered.map((k) => [k, (looks.form[k] as Look).doc])), label, target);
  };
  const push = (about: WorldRequest["about"], target: string, state: unknown, asked: readonly (readonly [string, string, JevQuestion | undefined])[]): void => {
    const questions: Record<string, JevQuestion> = {};
    const stands: Record<string, string> = {};
    for (const [qid, id, q] of asked) {
      if (q === undefined) continue;
      questions[qid] = q;
      stands[qid] = id;
    }
    if (Object.keys(questions).length > 0) requests.push({ about, target, request: { model: MODEL, state, questions }, stands });
  };
  const defs = definitionsOf(facts, graph);
  for (const f of [...facts.files].sort(byPath)) {
    const mine = defs.get(f.path) ?? [];
    const own = question(f.path, "This file stands in the world as one thing at the heart of its patch, which a person can walk up to and read about. Which one's character suits the file best?", "form", f.path);
    for (let from = 0; from === 0 || from < mine.length; from += LAYOUT.formsPerRequest) {
      const some = mine.slice(from, from + LAYOUT.formsPerRequest);
      const asked = some.map((d) => {
        const name = d.id.slice(d.file.length + 1);
        const q = question(d.id, `The ${KIND_WORDS[d.kind]} \`${name}\`, listed in \`standing\`, stands in the world as one thing a person can walk up to and read about. Which one's character suits it best?`, `form#${name}`, f.path);
        return [`form#${name}`, d.id, q] as const;
      });
      const file = importance.get(f.path);
      push("file", f.path, { file: fileWords(f, some, file) }, [...(from === 0 ? [["form", f.path, own] as const] : []), ...asked]);
    }
  }
  for (const e of [...facts.entities].sort(byPath)) {
    const value = importance.get(e.path);
    const q = question(e.path, `This ${e.form} stands in the world as one thing on the ground kept for it at its folder's heart, which a person can walk up to and read about. Which one's character suits it best?`, "form", e.path);
    push("entity", e.path, { entity: { ...entityWords(facts, e), ...(share(value) === undefined ? {} : { importance: share(value) }) } }, [["form", e.path, q]]);
  }
  return { requests, only };
}

export interface JudgeOptions {
  /** Requests in flight at once. */
  readonly concurrency?: number;
}

const pickOf = (a: JevAnswer | undefined): string | undefined => (a?.type === "choice" ? a.choice : undefined);

/** Jev's pick for a question: every question asked is answered (`keptJev` fails a request otherwise), so a missing one is a fault, never a default. */
const picked = (a: Readonly<Record<string, JevAnswer>>, id: string, about: string): string => {
  const choice = pickOf(a[id]);
  if (choice === undefined) throw new Error(`Jev gave no choice for ${id} about ${about || "the repository's root"}.`);
  return choice;
};

/** Runs `each` over every item, `concurrency` at a time, keeping the results in the items' order. */
async function inTurn<T, R>(items: readonly T[], concurrency: number, each: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await each(items[i] as T);
      }
    }),
  );
  return out;
}

/** Asks every planned request through `jev`, `concurrency` at a time: each area's water and each entity's trails. */
export async function judgeWorld(facts: CodeFacts, looks: Looks, jev: JevClient, options: JudgeOptions = {}): Promise<Judgments> {
  const planned = planWorldRequests(facts, looks);
  const answered = await inTurn(planned, options.concurrency ?? 8, async (p) => (await jev.ask(p.request)).answers);
  const trails: CodeTrail[] = [];
  const waters: Record<string, string> = {};
  planned.forEach((p, i) => {
    const a = answered[i] ?? {};
    if (p.about === "area") waters[p.target] = picked(a, "water", p.target);
    for (const [id, answer] of Object.entries(a)) if (id.startsWith("trail:") && answer.type === "noul") trails.push({ from: p.target, to: id.slice("trail:".length), want: answer.noul });
  });
  // The sky, each region's land, what every thing stands as and each trail's look are composed once the code is
  // understood (`composeWorld`).
  return { lands: {}, things: {}, trails, waters };
}

/** Where a land names its native families, and the field a building or a landmark chooses its colors in, among them. */
const NATIVE_COLORS = { land: "natives", thing: "palette.family" } as const;

/** A land's native families: none when it names none, and then every family suits what stands on it. */
function nativesOf(land: Blueprint | undefined): readonly string[] {
  const families = land?.slots[NATIVE_COLORS.land]?.params.families;
  return Array.isArray(families) ? families : [];
}

/** What a thing's id names: an entity's root directory, a file's path, or else a definition's `<file>#<name>`. */
function thingKind(facts: CodeFacts, id: string): StandingThing["of"] {
  if (facts.entities.some((e) => e.path === id)) return "entity";
  return facts.files.some((f) => f.path === id) ? "file" : "definition";
}

/** The file a thing stands on: a file's own path, or a definition's file; none for an entity. */
const fileOfThing = (of: StandingThing["of"], id: string): string | undefined => (of === "entity" ? undefined : of === "file" ? id : id.slice(0, id.indexOf("#")));

export interface ComposeOptions {
  readonly graph?: CodeGraph;
  readonly concurrency?: number;
}

/**
 * Composes the world part by part, through `jev`, once the understanding pass has judged the code. First, unless the
 * judgments already say, what every entity, file and definition stands as (`planStanding`); then its sky, each region's land, each building or landmark of any thing that stands as one, and
 * each trail Jev would walk. A building or a landmark waits for its land and chooses its colors among the land's
 * native families. Each composing request carries what `graph` holds about its part of the code
 * (`repositoryState`, `areaState`, `composingState`, `fileState`, `definitionState`, `trailState`), so it is asked
 * once and stays as it is while the code does. Jev never names a preset.
 */
export async function composeWorld(facts: CodeFacts, looks: Looks, jev: JevClient, judged: Judgments, options: ComposeOptions = {}): Promise<Judgments> {
  const graph = options.graph;
  const concurrency = options.concurrency ?? 8;
  const entity = (path: string): Pick<EntityFacts, "path" | "name"> & Partial<EntityFacts> => facts.entities.find((e) => e.path === path) ?? { name: baseName(path) || facts.repository.name, path };
  const regions = Object.keys(judged.waters).sort();
  const regionSet = new Set(regions);
  // The lands come first: a building or a landmark takes its colors from among its land's native families.
  // A land's stream or pond is its area's water, asked once (`Look.settles`).
  const lands = composeThings(
    looks.compose,
    jev,
    regions.map((path): Composed => {
      const settles = looks.water[judged.waters[path] ?? ""]?.settles;
      return { path: `land:${path}`, as: "biome", state: areaState(graph, path, lookWords(looks.water, judged.waters[path])), ...(settles === undefined ? {} : { fixed: settles }) };
    }),
    concurrency,
  );
  /**
   * A building or a landmark to compose for a thing, with what the graph holds about it, once its land is composed:
   * its place has what its region's water holds, and its colors are among its land's native families.
   */
  const raised = async (id: string, as: "building" | "landmark"): Promise<Composed> => {
    const of = thingKind(facts, id);
    const region = regionFor(regionSet, of === "entity" ? id : parentOf(fileOfThing(of, id) as string));
    const place = { has: looks.water[judged.waters[region] ?? ""]?.holds ?? [], narrow: { [NATIVE_COLORS.thing]: nativesOf((await lands)[`land:${region}`]) } };
    if (of === "entity") return { path: id, as, state: composingState(graph, entity(id)), ...place };
    return { path: id, as, state: of === "file" ? fileState(graph, id) : definitionState(graph, id), ...place };
  };
  const trailId = (t: CodeTrail): string => `trail:${t.from}->${t.to}`;
  // The sky and the trails do not wait on the lands, nor on what things stand as: they are composed meanwhile.
  const skyAndTrails = composeThings(
    looks.compose,
    jev,
    [{ path: "world:", as: "world", state: repositoryState(graph, facts.repository.name) }, ...judged.trails.map((t): Composed => ({ path: trailId(t), as: "link", state: trailState(graph, entity(t.from), entity(t.to)) }))],
    concurrency,
  );
  // What every entity, file and definition stands as, unless the judgments already say; each thing Jev raises to a building or a landmark is composed as soon as its answer is in and its land is composed.
  const things: Record<string, { as: "building" | "landmark"; blueprint?: Blueprint }> = { ...judged.things };
  const rising: Promise<unknown>[] = [];
  const compose = (id: string, as: "building" | "landmark"): void => {
    rising.push(raised(id, as).then((thing) => composeThing(looks.compose, jev, thing)).then((blueprint) => (things[id] = { as, blueprint })));
  };
  for (const [id, t] of Object.entries(judged.things)) compose(id, t.as);
  const raise = (id: string, form: string): void => {
    const as = looks.form[form]?.composes;
    if (as === undefined || judged.things[id] !== undefined) return;
    things[id] = { as };
    compose(id, as);
  };
  let stands = judged.stands;
  if (stands === undefined) {
    const plan = planStanding(facts, looks, graph === undefined ? {} : { graph });
    const out: Record<string, string> = { ...plan.only };
    for (const [id, form] of Object.entries(plan.only)) raise(id, form);
    await inTurn(plan.requests, concurrency, async (p) => {
      const a = (await jev.ask(p.request)).answers;
      for (const [qid, id] of Object.entries(p.stands ?? {})) {
        out[id] = picked(a, qid, id);
        raise(id, out[id]);
      }
    });
    // In the order things are planned, so the same answers give the same judgments.
    stands = Object.fromEntries(standingThings(facts, graph).flatMap((t) => (out[t.id] === undefined ? [] : [[t.id, out[t.id] as string] as const])));
  } else for (const [id, form] of Object.entries(stands ?? {})) raise(id, form);
  const [composedLands, composedSkyAndTrails] = await Promise.all([lands, skyAndTrails, Promise.all(rising)]);
  const blueprints = { ...composedLands, ...composedSkyAndTrails };
  const of = (id: string): Blueprint => blueprints[id] ?? (things[id]?.blueprint as Blueprint);
  return {
    ...judged,
    ...(stands === undefined ? {} : { stands }),
    sky: of("world:"),
    lands: Object.fromEntries(regions.map((path) => [path, of(`land:${path}`)])),
    things: Object.fromEntries(Object.keys(things).sort().map((id) => [id, { as: (things[id] as { as: "building" | "landmark" }).as, blueprint: of(id) }])),
    trails: judged.trails.map((t) => ({ ...t, route: of(trailId(t)) })),
  };
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
 * with the file's own ground at the heart, where the file itself stands, on
 * the part of the patch nearest its middle (`LAYOUT.cluster`). Each plot is
 * as large as its definition's own lines, plus `LAYOUT.defGround`; every
 * definition stands at its plot's middle.
 */
function plotDefinitions(f: FileFacts, defs: readonly StandingDef[], leaf: { readonly x: number; readonly z: number; readonly inner: readonly (readonly [number, number])[] }, step: number): { own: { x: number; z: number }; defs: { def: StandingDef; x: number; z: number }[] } {
  if (defs.length === 0) return { own: { x: leaf.x, z: leaf.z }, defs: [] };
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
  const near = (c: readonly [number, number]): number => (c[0] - leaf.x) ** 2 + (c[1] - leaf.z) ** 2;
  const core = [...leaf.inner].sort((a, b) => near(a) - near(b)).slice(0, Math.ceil(leaf.inner.length * LAYOUT.cluster));
  const plots = dividePlots(root, core.length > 0 ? core : [[leaf.x, leaf.z]], step);
  const heart = plots.get(`own:${f.path}`) ?? { x: leaf.x, z: leaf.z };
  return {
    own: { x: heart.x, z: heart.z },
    defs: defs.map((def) => {
      const p = plots.get(`def:${def.id}`) ?? { x: leaf.x, z: leaf.z };
      return { def, x: p.x, z: p.z };
    }),
  };
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
const UNJUDGED: Judgments = { lands: {}, things: {}, trails: [], waters: {} };

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
  const importance = new Map((graph?.nodes ?? []).flatMap((n) => (n.kind !== "block" && typeof n.judged?.value?.importance === "number" ? [[n.id, n.judged.value.importance] as const] : [])));
  const stands = judged.stands ?? {};
  // What leans on each definition: the definitions and files that call or name it.
  const leaning = new Map<string, Set<string>>();
  for (const e of graph?.edges ?? []) {
    if ((e.kind !== "calls" && e.kind !== "references") || !e.to.startsWith("def:")) continue;
    const set = leaning.get(e.to) ?? new Set<string>();
    set.add(e.from);
    leaning.set(e.to, set);
  }
  /** A building or landmark Jev composed for a thing, if one stands for it. */
  const composed = (id: string): { as: "building" | "landmark"; blueprint: Blueprint } | undefined => {
    const t = judged.things[id];
    return t?.blueprint === undefined ? undefined : { as: t.as, blueprint: t.blueprint };
  };
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
  const standing: CodeStanding[] = [];
  /** A file or an entity standing as flowers, a stone, a bush or a tree, when Jev chose it one. */
  const stand = (of: CodeStanding["of"], path: string, name: string, lines: number, at: { x: number; z: number }, vitality: number, value: number | undefined, file?: string): void => {
    const form = stands[path];
    if (form === undefined || composed(path) !== undefined) return;
    standing.push({ of, path, name, form, lines, ...(value === undefined ? {} : { importance: value }), x: at.x, z: at.z, ...(file === undefined ? {} : { file }), vitality });
  };
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
      // An entity nothing was chosen or composed for keeps its lot as open ground: nothing stands there that Jev didn't choose.
      lots.push({ x: leaf.x, z: leaf.z });
      const vitality = folderQuality(path) ?? judged.quality?.[path] ?? 1;
      const t = composed(path);
      if (t !== undefined) things.push({ path, name: e.name, as: t.as, blueprint: t.blueprint, area: path, x: leaf.x, z: leaf.z, lot: LAYOUT.lotReach[t.as], vitality });
      stand("entity", path, e.name, e.lines, leaf, vitality, importance.get(`dir:${path}`));
      continue;
    }
    const f = files.get(path) as FileFacts;
    const vitality = quality.get(`file:${path}`) ?? folderQuality(parentOf(path)) ?? judged.quality?.[path] ?? 1;
    patches.push({ path, name: baseName(path), area, x: leaf.x, z: leaf.z, radius: Math.sqrt(leaf.ground / Math.PI), vitality, lines: f.lines, ground: leaf.ground, cell });
    const plotted = plotDefinitions(f, defs.get(path) ?? [], leaf, land.step);
    // The file itself stands at its patch's heart: as a building or a landmark Jev composed, or as the form Jev chose.
    const own = composed(path);
    const fileFacts: ThingFacts = { path, name: baseName(path), lines: f.lines, exports: f.symbols.filter((x) => x.exported).length, dependents: f.importedBy };
    if (own !== undefined) things.push({ path, of: "file", name: baseName(path), as: own.as, blueprint: own.blueprint, area, x: plotted.own.x, z: plotted.own.z, lot: LAYOUT.lotReach[own.as], file: path, facts: fileFacts, vitality });
    stand("file", path, baseName(path), f.lines, plotted.own, vitality, importance.get(`file:${path}`), path);
    for (const { def, x, z } of plotted.defs) {
      const mine = quality.get(`def:${def.id}`) ?? vitality;
      // A definition standing as a building or a landmark stands on its own plot as one of the world's things.
      const t = composed(def.id);
      const defFacts: ThingFacts = { path: def.id, name: def.name, lines: def.lines, exports: def.exported ? 1 : 0, dependents: [...(leaning.get(`def:${def.id}`) ?? [])].sort() };
      if (t !== undefined) things.push({ path: def.id, of: "definition", name: def.name, as: t.as, blueprint: t.blueprint, area, x, z, lot: LAYOUT.lotReach[t.as], file: path, facts: defFacts, vitality: mine });
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
        form: stands[def.id] ?? "",
        x,
        z,
        vitality: mine,
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
      ...(judged.lands[path] === undefined ? {} : { biome: judged.lands[path] }),
      water: judged.waters[path] ?? "",
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
      ...(judged.sky === undefined ? {} : { sky: judged.sky }),
      areas,
      patches,
      cells,
      things,
      symbols,
      standing,
      // A trail joins two entities, whatever each stands as.
      trails: chooseTrails(judged.trails, [...things.filter((t) => (t.of ?? "entity") === "entity").map((t) => t.path), ...standing.filter((s) => s.of === "entity").map((s) => s.path)], weights),
      regions,
    },
    lots,
  };
}
