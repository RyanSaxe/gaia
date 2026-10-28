// Lays out a codebase as a world from the facts that `factsOf` derives.
// `layoutWorld` uses `divideLand` to give each directory an area sized by its
// code, each file a patch in that area, each entity a lot near the center of
// its directory's area, and each of a file's definitions a plot on its patch.
//
// The engine supplies structure and sizes. Jev chooses every look, each
// thing's form, each area's water and which dependencies become trails. The
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
import { type PlacedDef, definitionsOf } from "./definitions.ts";
import { type LandNode, divideLand, dividePlots, nearestRung, rung } from "./land.ts";
import { MODEL, planStructure } from "./planner.ts";
import { type Composed, type Composing, areaState, composeThing, composeThings, composingState, definitionState, fileState, repositoryState, share, trailState, trim, wildState } from "./compose.ts";

/** The form a thing appears as in the world. */
export type FormKind = "building" | "landmark" | "tree" | "bush" | "stone" | "flowers";

/** Whether `layOut` places a thing with this form as a `CodeThing`. */
export const raisedAs = (as: FormKind): as is "building" | "landmark" => as === "building" || as === "landmark";

/** One option in a Jev choice. `doc` is the text Jev reads for it. */
export interface Look {
  readonly doc: string;
  /** Features a place with this look provides to parts that need them, such as running water for a waterwheel. */
  readonly holds?: readonly string[];
  /**
   * Conditions, checked by `meets`, that a thing must satisfy to be offered
   * this look. For a form, they give the range of importance rank among the
   * world's things that the form suits.
   */
  readonly needs?: readonly Need[];
  /** For a form, what the thing appears as. Jev composes that blueprint part by part. */
  readonly composes?: FormKind;
  /**
   * For a small form Jev composes, the part a person sees first, such as a fir's frame or a weeping tree's frame and
   * habit. Choosing the form fills in this part, so Jev is never asked about it. Jev composes the rest.
   */
  readonly first?: { readonly slot: string; readonly use: string; readonly fixed?: Readonly<Record<string, string | boolean>> };
  /**
   * For a water, the values it fixes in its area's composed land, by field path, such as a valley's
   * `relief.stream` or a basin's `relief.pond`. Jev is not asked about these fields again.
   */
  readonly settles?: Readonly<Record<string, string | boolean>>;
}

export type LookSet = Readonly<Record<string, Look>>;

/** One ground of the wild past the land's edge, as ground cover settings in words. */
export type WildGround = Readonly<Record<string, string>>;

/** The options for every judgment, by key. */
export interface Looks {
  /** Part libraries for the sky, lands, buildings, landmarks and trails. Jev chooses each part, never a preset. */
  readonly compose: Composing;
  /**
   * Forms for any entity, file or definition: flowers, a stone, a bush, a tree,
   * a building or a landmark. A form's `needs` set the importance ranks it is
   * offered to. A form with `composes` is composed part by part.
   */
  readonly form: LookSet;
  /** Water options for an area's land. Each option's text is the reason recorded with the choice. */
  readonly water: LookSet;
  /**
   * Grounds for the wild past the land's edge, which represents no code. `composeWorld` has Jev compose a bush for
   * each from the world around it.
   */
  readonly wild: readonly WildGround[];
}

export interface WorldRequest {
  readonly about: "world" | "area" | "file" | "entity";
  /** The path of a directory, file or entity root, or "" for the repository. */
  readonly target: string;
  readonly request: JevRequest;
  /** For a `planForms` request, the id of the thing each question is about, by question id. */
  readonly thingByQuestion?: Readonly<Record<string, string>>;
}

/** Everything Jev decided about a world. */
export interface Judgments {
  /** The world's light, sky and wind. Undefined until `composeWorld` runs. */
  readonly sky?: Blueprint;
  /** The land `composeWorld` composed for each region directory, by path. */
  readonly lands: Readonly<Record<string, Blueprint>>;
  /** The bush for each ground in `Looks.wild`, in the same order. Undefined until `composeWorld` runs. */
  readonly wild?: readonly Blueprint[];
  /**
   * The form key Jev chose for every entity, file and definition, by id. An id is an entity's root directory, a
   * file's path or a definition's `<file>#<name>`. `composeWorld` requests these from Jev after the understanding pass
   * has judged the code, and offers each thing only the forms its importance allows.
   */
  readonly forms?: Readonly<Record<string, string>>;
  /**
   * What each thing appears as and its blueprint from `composeWorld`, by the same ids as `forms`. `layOut` places
   * no building or landmark that lacks a blueprint.
   */
  readonly things: Readonly<Record<string, { readonly as: FormKind; readonly blueprint?: Blueprint }>>;
  /** Every entity dependency Jev rated as a trail, with its `want`. `composeWorld` adds each trail's `route`. */
  readonly trails: readonly CodeTrail[];
  /**
   * Quality from 0 to 1 by file or directory path, for a world with no engine
   * graph, such as the proving ground, which fixes it with its looks. Vitality
   * uses it where the graph gives none.
   */
  readonly quality?: Readonly<Record<string, number>>;
  /** The water key for each region directory, by path. */
  readonly waters: Readonly<Record<string, string>>;
}

export interface CodeArea extends AreaPlace {
  /** Index of the terrain region that this area's own ground belongs to. */
  readonly region: number;
  /** Square meters, including its subdirectories. */
  readonly ground: number;
}

export interface CodePatch extends PatchPlace {
  readonly lines: number;
  /** Square meters. */
  readonly ground: number;
  /** Index of its first cell in `CodeWorld.cells`. Every cell that names this file belongs to the patch. */
  readonly cell: number;
}

/**
 * A building or landmark in the world. An entity's is placed on its lot, a
 * file's on the file's own plot within its patch, and a definition's on the
 * definition's plot.
 */
export interface CodeThing {
  /** An entity's root path, a file's path or a definition's `<file>#<name>`. */
  readonly path: string;
  /** The kind of code it represents. Absent means an entity. */
  readonly of?: "entity" | "file" | "definition";
  readonly name: string;
  readonly as: "building" | "landmark";
  readonly blueprint: Blueprint;
  /** Its directory: an entity's root, or a file's directory. */
  readonly area: string;
  /** x and z are the center of its lot or plot. `lot` is the farthest it may be placed from there, in meters. */
  readonly x: number;
  readonly z: number;
  readonly lot: number;
  /** For a file's or definition's thing, the file whose patch holds it. */
  readonly file?: string;
  /** Facts for a file's or definition's building or landmark. An entity's thing uses the entity's own facts. */
  readonly facts?: ThingFacts;
  readonly vitality: number;
}

/** A file or entity that appears as flowers, a stone, a bush or a tree, placed on the file's own plot or on the entity's lot. */
export interface CodeStanding {
  readonly of: "file" | "entity";
  /** A file's path or an entity's root path. */
  readonly path: string;
  readonly name: string;
  /** The form Jev chose for it. */
  readonly form: string;
  /** What it appears as and its blueprint, once composed. */
  readonly as?: FormKind;
  readonly blueprint?: Blueprint;
  readonly lines: number;
  /** Jev's importance, 0 to 1. Its rendered size scales with this. */
  readonly importance?: number;
  readonly x: number;
  readonly z: number;
  /** The file whose patch holds it. Undefined for an entity, which is on its lot. */
  readonly file?: string;
  readonly vitality: number;
}

/** A function, method, class or type placed on its own plot within its file's patch. */
export interface CodeSymbol {
  /** `<file>#<name>`, with the name qualified by its enclosing definitions, such as `app/x.ts#World.open`. */
  readonly id: string;
  readonly file: string;
  /** The id of the enclosing definition. */
  readonly parent?: string;
  readonly name: string;
  readonly kind: SymbolFact["kind"];
  readonly exported: boolean;
  /** Where it is declared and how many lines it spans. */
  readonly line: number;
  readonly lines: number;
  readonly doc?: string;
  /** Jev's importance from the engine graph, 0 to 1. Its rendered size scales with this. */
  readonly importance?: number;
  /** The form key Jev chose for it, or "" before judging. */
  readonly form: string;
  /** What it appears as and its blueprint, once composed. */
  readonly as?: FormKind;
  readonly blueprint?: Blueprint;
  readonly x: number;
  readonly z: number;
  /** The definition's own quality, or its file's vitality when the graph has none. */
  readonly vitality: number;
}

export interface CodeTrail {
  readonly from: string;
  readonly to: string;
  /** Jev's probability that a person would walk between them, 0 to 1. */
  readonly want: number;
  /** The link blueprint Jev composed, which sets the trail's width, wear, edging, winding and crossings. */
  readonly route?: Blueprint;
  /** How many of `from`'s files import from `to`. */
  readonly weight?: number;
  /** Whether it joins two groups of entities that no earlier trail in the order joins. These trails route first. */
  readonly spans?: boolean;
}

/** A terrain region: a directory whose land has its own landform and cover. */
export interface CodeRegion {
  readonly area: string;
  /** The area-weighted mean of its leaves' centers. */
  readonly x: number;
  readonly z: number;
  /** Radius in meters of a disc with the region's area. */
  readonly reach: number;
  /** The biome blueprint Jev composed for its land. Undefined before `composeWorld`. */
  readonly biome?: Blueprint;
  /** The water key Jev chose. That key's text in `Looks.water` gives the reason. */
  readonly water: string;
  /** The sites of every patch and lot in the region, as `RegionSpec.sites` takes them. */
  readonly sites: readonly LandSite[];
}

export interface CodeWorld extends WorldPlaces {
  readonly projectId: string;
  /** The land's `LandOutline.size` in meters. It grows with the codebase. */
  readonly size: number;
  /** The light, sky and wind Jev composed for the repository. */
  readonly sky?: Blueprint;
  /** The bush Jev composed for each wild ground past the land's edge. The wild represents no code. */
  readonly wild?: readonly Blueprint[];
  readonly areas: readonly CodeArea[];
  readonly patches: readonly CodePatch[];
  /** Every land cell. Each belongs to one file's patch or one entity's lot, and a lot's cells have a null `file`. */
  readonly cells: readonly CellPlace[];
  readonly things: readonly CodeThing[];
  /** Every definition placed on its file's patch. One that appears as a building or landmark is also in `things`. */
  readonly symbols: readonly CodeSymbol[];
  /** Each file and entity that appears as flowers, a stone, a bush or a tree. */
  readonly standing: readonly CodeStanding[];
  readonly trails: readonly CodeTrail[];
  readonly regions: readonly CodeRegion[];
}

export const LAYOUT = {
  /** Square meters of ground per line of code. */
  m2PerLine: 10,
  /** A file's line count is clamped to this range when sizing its patch. */
  lines: [20, 1500],
  /**
   * Square meters reserved for an entity's lot. It is the same for a building
   * or a landmark, so the land division depends only on the code and is known
   * before Jev answers (`landOf`).
   */
  lot: 600,
  /** How far in meters a building or landmark may be placed from its lot's center. */
  lotReach: { building: 7, landmark: 6 },
  /** Minimum world size in meters. */
  minSize: 260,
  /** A directory becomes a region when its lines outside sub-regions reach the rung nearest this share of all lines (`regionPaths`). */
  regionShare: 0.03,
  maxRegions: 24,
  /**
   * The share of a file's patch, nearest its center, that holds its definitions' plots. The definitions form a copse
   * there with open ground around it, so woods and meadows alternate.
   */
  cluster: 0.3,
  /** Square meters each definition adds to its file's patch, on top of the file's lines. */
  defGround: 50,
  /** Most definitions one form request covers. A larger file's definitions split over several requests so each fits Jev's window. */
  formsPerRequest: 12,
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

/** Lines under a directory, with each file clamped by `weightOf` as for its patch. */
function linesUnder(dirs: Map<string, Dir>, path: string): number {
  const d = dirs.get(path) as Dir;
  return d.files.reduce((n, f) => n + weightOf(f), 0) + d.children.reduce((n, c) => n + linesUnder(dirs, c), 0);
}

/**
 * Returns the directories that get their own terrain region. Working bottom
 * up, a directory's kept lines are its files' lines plus those of
 * subdirectories that are not regions. It becomes a region when its kept
 * lines reach the threshold, and the root is always one. The threshold is the
 * rung nearest `LAYOUT.regionShare` of all lines (`nearestRung`). It changes
 * only when the total crosses a rung, and a directory becomes or stops being a
 * region only when its kept lines cross the threshold.
 */
function regionPaths(dirs: Map<string, Dir>): string[] {
  let threshold = nearestRung(linesUnder(dirs, "") * LAYOUT.regionShare);
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
    // threshold is a rung, so 1.1 times it rounds up to the next rung.
    threshold = rung(threshold * 1.1);
  }
}

// ---------- asking Jev ----------

/** Shuffles options with a seed from the target, as the planner does, because Jev picks the first option more often. */
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

// Sizes go to Jev as words, not line counts, because Jev judges words more reliably than numbers. A request's key is
// the hash of what it sends, so a one-line edit that leaves a file "medium" sends no new request.
const fileSize = (lines: number): string => bucket(lines, [30, 120, 400, 1000], ["tiny", "short", "medium", "long", "very long"]);
/** A directory's or entity's size in words. */
const bodySize = (lines: number): string => bucket(lines, [300, 1500, 6000, 20000], ["small", "medium", "large", "very large", "vast"]);
const howMany = (n: number): string => bucket(n, [1, 2, 5, 13], ["none", "one", "a few", "several", "many"]);

const outlineOrder = (f: FileFacts): SymbolFact[] => [...f.symbols].sort((a, b) => Number(b.exported) - Number(a.exported) || (b.lines ?? 1) - (a.lines ?? 1) || (a.name < b.name ? -1 : 1));

/** How many of `from`'s files import from `to`. */
function importersOf(facts: CodeFacts, from: EntityFacts, to: EntityFacts): number {
  const roots = facts.entities.map((e) => e.path);
  const owner = (p: string): string | undefined => roots.filter((r) => r === "" || p === r || p.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
  return facts.files.filter((f) => owner(f.path) === from.path && f.imports.some((i) => owner(i) === to.path)).length;
}

/** With `graph`, the definitions on each file's patch come from the engine graph, as in the layout. Without it, they come from the facts. */
export interface PlanOptions {
  readonly graph?: CodeGraph;
}

const lookWords = (set: LookSet, key: string | undefined): string | undefined => (key === undefined || set[key] === undefined ? undefined : `${key}: ${set[key].doc}`);

/** The average count per file, in words. */
const perFile = (n: number, files: number): string => {
  const r = n / Math.max(1, files);
  return r === 0 ? "none" : r < 0.5 ? "a little" : r < 1.5 ? "some" : "a lot";
};
/**
 * The file description sent to Jev: its declarations and links in words, and the definitions on its patch that
 * the request asks about. It has no line counts because a form's size follows importance, so a short definition
 * that matters can be as tall as a long one. In a form request it also carries Jev's importance for the file and
 * each definition, and each definition's doc.
 */
export function fileWords(f: FileFacts, defs: readonly PlacedDef[] = [], importance?: number): Record<string, unknown> {
  const declares: Record<string, string> = {};
  for (const kind of ["function", "class", "type", "module"] as const) {
    const n = f.symbols.filter((s) => s.kind === kind).length;
    if (n > 0) declares[KIND_PLURALS[kind]] = howMany(n);
  }
  return {
    path: f.path,
    language: f.language,
    declares: Object.keys(declares).length === 0 ? "nothing of its own" : declares,
    exports: outlineOrder(f).filter((s) => s.exported).slice(0, 8).map((s) => s.name),
    imports: `${howMany(f.imports.length)} project files`,
    importedBy: `${howMany(f.importedBy.length)} project files`,
    ...(share(importance) === undefined ? {} : { importance: share(importance) }),
    ...(defs.length === 0
      ? {}
      : {
          standing: defs.map((d) => ({
            name: d.id.slice(d.file.length + 1),
            kind: d.kind,
            exported: d.exported,
            ...(share(d.importance) === undefined ? {} : { importance: share(d.importance) }),
            ...(d.doc === undefined ? {} : { doc: trim(d.doc, 100) }),
          })),
        }),
  };
}

/** A directory's lines and its per-file import counts, which `areaWords` compares across the repository's areas. */
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
 * Where `value` ranks among the ascending `sorted`, from 0 below every other
 * value to 1 above every other. Tied values share the middle of their
 * positions. It ranks a thing's importance among the world's things for the
 * form ranges, and compares an area with the others.
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
 * Describes in words where a value ranks among the repository's areas. Jev
 * answers each area's request without seeing the others, so a judgment such
 * as "much of the code depends on this area" needs the comparison given to it.
 */
function standing(value: number, all: readonly number[]): string {
  if (all.length < 3) return "about the middle of this repository's areas";
  const p = rankAmong(value, [...all].sort((a, b) => a - b));
  return p >= 0.8 ? "among the most of this repository's areas" : p >= 0.6 ? "more than most of this repository's areas" : p > 0.4 ? "about the middle of this repository's areas" : p > 0.2 ? "less than most of this repository's areas" : "among the least of this repository's areas";
}

/** The directory description sent to Jev, in words. Counts that grow with the directory are per file, and each is compared with `others`. */
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

/** The entity description sent to Jev, with every count and size in words. */
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

/** The nearest region directory at or above `dir`. */
function regionFor(regions: ReadonlySet<string>, dir: string): string {
  for (let p: string | null = dir; p !== null; p = p === "" ? null : parentOf(p)) if (regions.has(p)) return p;
  return "";
}

/**
 * Builds the Jev requests for areas and entities from code structure only, never source. Each area gets a question
 * on whether its land holds water. Each entity gets a question per dependency on whether a person would walk a
 * trail along it. `planForms` builds the form requests later, after the understanding pass has judged importance.
 */
export function planWorldRequests(facts: CodeFacts, looks: Looks): WorldRequest[] {
  const dirs = directoriesOf(facts, facts.repository.name);
  const requests: WorldRequest[] = [];
  const ask = (about: WorldRequest["about"], target: string, state: unknown, questions: Record<string, JevQuestion>): void => {
    requests.push({ about, target, request: { model: MODEL, state, questions } });
  };
  // composeWorld composes the light, sky and wind after the understanding pass, so no request here covers the whole
  // repository.
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

// ---------- choosing each thing's form ----------

/** An entity, file or definition that gets a form, with Jev's importance once the understanding pass has judged it. */
export interface PlacedThing {
  readonly of: "entity" | "file" | "definition";
  /** An entity's root path, a file's path or a definition's `<file>#<name>`. It is the key in `Judgments.forms`. */
  readonly id: string;
  readonly importance?: number;
}

/** Every entity, file and definition placed in the world, with its importance. `rankThings` ranks among these. */
export function placedThings(facts: CodeFacts, graph?: CodeGraph): PlacedThing[] {
  const importance = new Map((graph?.nodes ?? []).flatMap((n) => (n.kind !== "block" && typeof n.judged?.value?.importance === "number" ? [[n.id, n.judged.value.importance] as const] : [])));
  const thing = (of: PlacedThing["of"], id: string, value: number | undefined): PlacedThing => ({ of, id, ...(value === undefined ? {} : { importance: value }) });
  return [
    ...[...facts.entities].sort(byPath).map((e) => thing("entity", e.path, importance.get(`dir:${e.path}`))),
    ...[...facts.files].sort(byPath).map((f) => thing("file", f.path, importance.get(`file:${f.path}`))),
    ...[...definitionsOf(facts, graph).values()].flat().map((d) => thing("definition", d.id, d.importance)),
  ];
}

/**
 * Entities rank from this value up to 1, so every package gets a large form.
 * The least important entity ranks with things offered only trees. The rest
 * rank with things offered a building or, at the top, a landmark.
 */
const ENTITY_RANKS = 0.85;

/**
 * Each thing's importance rank by id, from 0 for the least important to 1 for
 * the most (`rankAmong`). Files and definitions rank together. Entities rank
 * among entities, mapped onto `ENTITY_RANKS` to 1. The understanding pass
 * judges an entity's importance against its folder's neighbors, not against
 * the definitions inside it. Ranked among definitions, a package was offered
 * only small forms. A thing with no importance ranks as importance 0. A rank
 * is a share, so a form's range covers the same share of things in a world of
 * any size.
 */
export function rankThings(facts: CodeFacts, graph?: CodeGraph): ReadonlyMap<string, number> {
  const things = placedThings(facts, graph);
  const sortedOf = (of: (t: PlacedThing) => boolean): number[] => things.filter(of).map((t) => t.importance ?? 0).sort((a, b) => a - b);
  const entities = sortedOf((t) => t.of === "entity");
  const rest = sortedOf((t) => t.of !== "entity");
  return new Map(things.map((t) => [t.id, t.of === "entity" ? ENTITY_RANKS + (1 - ENTITY_RANKS) * rankAmong(t.importance ?? 0, entities) : rankAmong(t.importance ?? 0, rest)]));
}

/** Keys of every form whose `needs` a thing of this rank meets, sorted. */
export function formsFor(looks: Looks, rank: number): string[] {
  return Object.keys(looks.form)
    .sort()
    .filter((k) => meets(looks.form[k]?.needs, { has: [], rank }));
}

/** The form requests, and the form of each thing offered only one, which needs no question. */
export interface FormPlan {
  readonly requests: readonly WorldRequest[];
  readonly only: Readonly<Record<string, string>>;
}

/**
 * Builds the requests that choose a form for every entity, file and definition
 * after the understanding pass has judged importance. Each thing gets one
 * question among the forms its rank allows (`formsFor`), with its importance
 * in the state. A file's question shares a request with its first
 * `LAYOUT.formsPerRequest` definitions. Each entity gets its own request.
 */
export function planForms(facts: CodeFacts, looks: Looks, options: PlanOptions = {}): FormPlan {
  const { graph } = options;
  const ranks = rankThings(facts, graph);
  const importance = new Map(placedThings(facts, graph).flatMap((t) => (t.importance === undefined ? [] : [[t.id, t.importance] as const])));
  const only: Record<string, string> = {};
  const requests: WorldRequest[] = [];
  const RARE = "Only the forms that suit how much it matters (`importance`) are offered, so a form's size already follows how much it matters, never how long its code is; choose by character.";
  /** The question about one thing. When its rank allows only one form, records that form in `only` and returns undefined. */
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
    const thingByQuestion: Record<string, string> = {};
    for (const [qid, id, q] of asked) {
      if (q === undefined) continue;
      questions[qid] = q;
      thingByQuestion[qid] = id;
    }
    if (Object.keys(questions).length > 0) requests.push({ about, target, request: { model: MODEL, state, questions }, thingByQuestion });
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
    const { size: _lines, ...words } = entityWords(facts, e);
    push("entity", e.path, { entity: { ...words, ...(share(value) === undefined ? {} : { importance: share(value) }) } }, [["form", e.path, q]]);
  }
  return { requests, only };
}

export interface JudgeOptions {
  readonly concurrency?: number;
}

const pickOf = (a: JevAnswer | undefined): string | undefined => (a?.type === "choice" ? a.choice : undefined);

/** Jev's pick for a question. `keptJev` fails a request with an unanswered question, so a missing pick throws instead of using a default. */
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

/** Sends every `planWorldRequests` request through `jev`, `concurrency` at a time, and collects each area's water and each entity's trails. */
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
  // composeWorld fills in the sky, region lands, forms and trail routes after the understanding pass.
  return { lands: {}, things: {}, trails, waters };
}

/** The land slot that lists its native color families, and the thing field whose choices are narrowed to them. */
const NATIVE_COLORS = { land: "natives", thing: "palette.family" } as const;

/** A land's native color families. An empty list means any family suits things on that land. */
function nativesOf(land: Blueprint | undefined): readonly string[] {
  const families = land?.slots[NATIVE_COLORS.land]?.params.families;
  return Array.isArray(families) ? families : [];
}

/** Whether an id is an entity's root directory, a file's path, or else a definition's `<file>#<name>`. */
function thingKind(facts: CodeFacts, id: string): PlacedThing["of"] {
  if (facts.entities.some((e) => e.path === id)) return "entity";
  return facts.files.some((f) => f.path === id) ? "file" : "definition";
}

/** The file whose patch holds a thing: a file's own path or a definition's file. Undefined for an entity. */
const fileOfThing = (of: PlacedThing["of"], id: string): string | undefined => (of === "entity" ? undefined : of === "file" ? id : id.slice(0, id.indexOf("#")));

/** About how many requests composing a world's things takes after their forms are chosen, and one sample request for pricing. */
export interface ComposingEstimate {
  readonly requests: number;
  readonly sample: JevRequest;
}

/**
 * Estimates the Jev requests for composing a world's things, for pricing before any request is sent. It counts two
 * requests per thing and per wild bush, one for parts and one for their settings. Each is about the size of the
 * request that composes the first thing as a tree. Lands, sky, buildings, landmarks and trails add few requests by
 * comparison. Returns null for a world with no things or no tree form to price by.
 */
export function composingEstimate(facts: CodeFacts, looks: Looks, graph?: CodeGraph): ComposingEstimate | null {
  const things = placedThings(facts, graph);
  const first = things[0];
  const form = Object.entries(looks.form).find(([, look]) => look.composes === "tree" && look.first !== undefined);
  if (first === undefined || form === undefined) return null;
  const [name, look] = form;
  const state = first.of === "entity" ? composingState(graph, { path: first.id, name: baseName(first.id) || facts.repository.name }) : first.of === "file" ? fileState(graph, first.id) : definitionState(graph, first.id);
  const uses = look.first === undefined ? {} : { [look.first.slot]: look.first.use };
  const wave = planStructure(looks.compose.tree, looks.compose.offered?.tree ?? looks.compose.lib, { id: first.id, state: { ...state, standsAs: { form: name, words: look.doc } }, uses });
  return { requests: (things.length + looks.wild.length) * 2, sample: wave.request };
}

export interface ComposeOptions {
  readonly graph?: CodeGraph;
  readonly concurrency?: number;
}

/**
 * Composes the world part by part through `jev` after the understanding pass has judged the code. Unless
 * `judged.forms` is set, it first has Jev choose a form for every entity, file and definition (`planForms`). It then
 * composes the sky, each region's land, each thing with a composing form, and each trail. A thing is composed after
 * its land, with its colors narrowed to the land's native families. Each request carries what `graph` holds about
 * its part of the code (`repositoryState`, `areaState`, `composingState`, `fileState`, `definitionState`,
 * `trailState`), so its key changes only when that code does. Wild bushes represent no code. Each is composed after
 * the sky and lands, from them and its own ground (`wildState`), with colors narrowed to every land's native
 * families. Jev never names a preset.
 */
export async function composeWorld(facts: CodeFacts, looks: Looks, jev: JevClient, judged: Judgments, options: ComposeOptions = {}): Promise<Judgments> {
  const graph = options.graph;
  const concurrency = options.concurrency ?? 8;
  const entity = (path: string): Pick<EntityFacts, "path" | "name"> & Partial<EntityFacts> => facts.entities.find((e) => e.path === path) ?? { name: baseName(path) || facts.repository.name, path };
  const regions = Object.keys(judged.waters).sort();
  const regionSet = new Set(regions);
  // Lands go first because a thing's colors are narrowed to its land's native families.
  // The area's water fixes the land's stream or pond through `Look.settles`, so Jev is not asked again.
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
   * The compose input for a thing, built after its land is composed. Its place provides what its region's water
   * holds, and its colors are narrowed to its land's native families.
   */
  const raised = async (id: string, as: FormKind, form?: string): Promise<Composed> => {
    const of = thingKind(facts, id);
    const region = regionFor(regionSet, of === "entity" ? id : parentOf(fileOfThing(of, id) as string));
    const place = { has: looks.water[judged.waters[region] ?? ""]?.holds ?? [], narrow: { [NATIVE_COLORS.thing]: nativesOf((await lands)[`land:${region}`]) } };
    const state = of === "entity" ? composingState(graph, entity(id)) : of === "file" ? fileState(graph, id) : definitionState(graph, id);
    // A tree, bush, stone or flowers is composed as the form Jev chose. The request names the form, and the form's
    // `first` part is filled in.
    const look = form === undefined ? undefined : looks.form[form];
    const first = look?.first;
    if (raisedAs(as) || look === undefined || first === undefined) return { path: id, as, state, ...place };
    return { path: id, as, state: { ...state, standsAs: { form, words: look.doc } }, ...place, uses: { [first.slot]: first.use }, ...(first.fixed === undefined ? {} : { fixed: first.fixed }) };
  };
  const trailId = (t: CodeTrail): string => `trail:${t.from}->${t.to}`;
  // The sky and trails depend on neither the lands nor the forms, so they compose in parallel with both.
  const sky = composeThing(looks.compose, jev, { path: "world:", as: "world", state: repositoryState(graph, facts.repository.name) });
  const trails = composeThings(looks.compose, jev, judged.trails.map((t): Composed => ({ path: trailId(t), as: "link", state: trailState(graph, entity(t.from), entity(t.to)) })), concurrency);
  // Wild bushes are composed from the sky and every land, so they start after both.
  const wildId = (i: number): string => `wild:${i}`;
  const wild = Promise.all([sky, lands]).then(([s, l]) => {
    const around = regions.map((path) => l[`land:${path}`] as Blueprint);
    const families = [...new Set(around.flatMap(nativesOf))].sort();
    const place = { has: [], narrow: { [NATIVE_COLORS.thing]: families } };
    return composeThings(looks.compose, jev, looks.wild.map((ground, i): Composed => ({ path: wildId(i), as: "wildBush", state: wildState(ground, s, around, looks.compose.biome), ...place })), concurrency);
  });
  // Choose each thing's form unless `judged.forms` has it. A thing with a composing form is composed as soon as its answer arrives and its land is composed.
  const things: Record<string, { as: FormKind; blueprint?: Blueprint }> = { ...judged.things };
  const rising: Promise<unknown>[] = [];
  const compose = (id: string, as: FormKind, form?: string): void => {
    rising.push(raised(id, as, form).then((thing) => composeThing(looks.compose, jev, thing)).then((blueprint) => (things[id] = { as, blueprint })));
  };
  for (const [id, t] of Object.entries(judged.things)) if (t.blueprint === undefined) compose(id, t.as);
  const raise = (id: string, form: string): void => {
    const as = looks.form[form]?.composes;
    if (as === undefined || judged.things[id] !== undefined) return;
    things[id] = { as };
    compose(id, as, form);
  };
  let forms = judged.forms;
  if (forms === undefined) {
    const plan = planForms(facts, looks, graph === undefined ? {} : { graph });
    const out: Record<string, string> = { ...plan.only };
    for (const [id, form] of Object.entries(plan.only)) raise(id, form);
    await inTurn(plan.requests, concurrency, async (p) => {
      const a = (await jev.ask(p.request)).answers;
      for (const [qid, id] of Object.entries(p.thingByQuestion ?? {})) {
        out[id] = picked(a, qid, id);
        raise(id, out[id]);
      }
    });
    // Answers arrive in any order. Rebuilding in planning order makes the same answers give the same judgments.
    forms = Object.fromEntries(placedThings(facts, graph).flatMap((t) => (out[t.id] === undefined ? [] : [[t.id, out[t.id] as string] as const])));
  } else for (const [id, form] of Object.entries(forms ?? {})) raise(id, form);
  const [composedLands, composedSky, composedTrails, composedWild] = await Promise.all([lands, sky, trails, wild, Promise.all(rising)]);
  const blueprints = { ...composedLands, ...composedTrails, ...composedWild };
  const of = (id: string): Blueprint => blueprints[id] ?? (things[id]?.blueprint as Blueprint);
  return {
    ...judged,
    ...(forms === undefined ? {} : { forms }),
    sky: composedSky,
    lands: Object.fromEntries(regions.map((path) => [path, of(`land:${path}`)])),
    wild: looks.wild.map((_, i) => of(wildId(i))),
    things: Object.fromEntries(Object.keys(things).sort().map((id) => [id, { as: (things[id] as { as: FormKind }).as, blueprint: of(id) }])),
    trails: judged.trails.map((t) => ({ ...t, route: of(trailId(t)) })),
  };
}

// ---------- laying the world out ----------

/** A file's ground in square meters: its lines clamped by `weightOf` times `LAYOUT.m2PerLine`, plus `LAYOUT.defGround` per definition. */
const groundOfFile = (f: FileFacts, defs: number): number => weightOf(f) * LAYOUT.m2PerLine + defs * LAYOUT.defGround;

/**
 * Builds the tree that `divideLand` divides. A directory node holds its own
 * ground, which holds its files and its entity's lot, and its subdirectories.
 * The lot's site starts at the center of the own ground, and the own ground's
 * site starts at the center of the directory. The repository root is the
 * exception. Its own ground is placed among the subdirectories so that trails
 * between areas do not all cross it.
 */
function landTree(dirs: Map<string, Dir>, lots: ReadonlyMap<string, number>, defs: ReadonlyMap<string, readonly PlacedDef[]>): LandNode {
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
 * Places a file's definitions. The part of the patch nearest its center
 * (`LAYOUT.cluster`) is divided like the land, with the file's own plot at the
 * center, where the file itself is placed. Each definition's plot is divided
 * again among the definitions inside it. A plot's ground comes from its
 * definition's own lines plus `LAYOUT.defGround`. Each definition is placed at
 * its plot's center.
 */
function plotDefinitions(f: FileFacts, defs: readonly PlacedDef[], leaf: { readonly x: number; readonly z: number; readonly inner: readonly (readonly [number, number])[] }, step: number): { own: { x: number; z: number }; defs: { def: PlacedDef; x: number; z: number }[] } {
  if (defs.length === 0) return { own: { x: leaf.x, z: leaf.z }, defs: [] };
  const perLine = LAYOUT.m2PerLine;
  const inside = new Map<string, PlacedDef[]>();
  for (const d of defs) {
    const key = d.parent ?? "";
    const list = inside.get(key);
    if (list === undefined) inside.set(key, [d]);
    else list.push(d);
  }
  const own = (lines: number, within: readonly PlacedDef[]): number => Math.max(1, lines - within.reduce((n, c) => n + c.lines, 0));
  const node = (d: PlacedDef): LandNode => {
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
 * Returns the trails a world shows, which are the dependencies Jev rated above
 * even odds. Trails that join groups of entities not yet joined come first, by
 * `want` and then weight, so every connected part of the code is walkable and
 * those trails route first. The rest follow by `want`. The terrain routes all
 * of them over one shared path network (`planTrails` in @gaia/terrain), so
 * none is dropped here.
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
  readonly defs: ReadonlyMap<string, readonly PlacedDef[]>;
}

/** Cached land divisions per facts object, keyed by graph and aspect. A division depends only on the code. */
const divided = new WeakMap<CodeFacts, Map<string, Division>>();
const graphIds = new WeakMap<CodeGraph, number>();
let graphCount = 0;
/** A key per graph object, or "none", so a division cached for one graph is never used for another. */
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
  // Size the land so its rounded rectangle holds the total ground rounded up by `rung`. The size changes only when the
  // total crosses a rung, and then every part scales in proportion.
  const size = Math.max(LAYOUT.minSize, Math.ceil(Math.sqrt(rung(total) / landArea({ size: 1, aspect })) / 10) * 10);
  const made = { dirs, size, aspect, land: divideLand(landTree(dirs, lots, defs), { size, aspect }), defs };
  forModel.set(key, made);
  return made;
}

/** Empty judgments, used to lay out the land before Jev answers. */
const UNJUDGED: Judgments = { lands: {}, things: {}, trails: [], waters: {} };

/**
 * The center of an entity's lot in meters, which becomes its thing's `x` and `z`. A building or landmark placed
 * there stays within `LAYOUT.lotReach` of it.
 */
export interface LotPlace {
  readonly x: number;
  readonly z: number;
}

/**
 * The world's land before Jev answers. Every area, patch, cell and lot is
 * exactly where `layoutWorld` places it afterwards, because the division
 * depends only on the code. Opening a world shows this while Jev answers.
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
 * Lays out the world from the code and Jev's judgments. With the engine graph, every definition in it is placed
 * and sized by its importance. Without one, the facts' top-level symbols are placed. The land uses the journal
 * spread's proportions (`LAND_ASPECT`) unless `aspect` overrides them. The proving ground passes a square so its
 * streams, bridges and ruins stay where its tests expect them.
 */
export function layoutWorld(facts: CodeFacts, judged: Judgments, graph?: CodeGraph, aspect: number = LAND_ASPECT): CodeWorld {
  return layOut(facts, judged, graph, aspect).world;
}

/** Lays out the world and returns every entity's lot, including lots with nothing composed on them. */
function layOut(facts: CodeFacts, judged: Judgments, graph: CodeGraph | undefined, aspect: number): { readonly world: CodeWorld; readonly lots: readonly LotPlace[] } {
  const name = facts.repository.name;
  const { dirs, size, land, defs } = divisionOf(facts, graph, aspect);
  const entityAt = new Map(facts.entities.map((e) => [e.path, e]));
  const files = new Map(facts.files.map((f) => [f.path, f]));
  // Vitality is Jev's quality from the understanding pass. A thing with no judged quality takes its nearest judged
  // folder's. A world with no graph uses `judged.quality`, as the proving ground does. A thing with no quality from
  // any source, as in a world opened without Jev, gets vitality 1.
  const quality = new Map((graph?.nodes ?? []).flatMap((n) => (n.kind !== "block" && typeof n.judged?.value?.quality === "number" ? [[n.id, n.judged.value.quality] as const] : [])));
  const importance = new Map((graph?.nodes ?? []).flatMap((n) => (n.kind !== "block" && typeof n.judged?.value?.importance === "number" ? [[n.id, n.judged.value.importance] as const] : [])));
  const forms = judged.forms ?? {};
  // For each definition, the ids of the definitions and files that call or reference it.
  const leaning = new Map<string, Set<string>>();
  for (const e of graph?.edges ?? []) {
    if ((e.kind !== "calls" && e.kind !== "references") || !e.to.startsWith("def:")) continue;
    const set = leaning.get(e.to) ?? new Set<string>();
    set.add(e.from);
    leaning.set(e.to, set);
  }
  /** The building or landmark Jev composed for a thing, if it has one. */
  const composed = (id: string): { as: "building" | "landmark"; blueprint: Blueprint } | undefined => {
    const t = judged.things[id];
    return t?.blueprint === undefined || !raisedAs(t.as) ? undefined : { as: t.as, blueprint: t.blueprint };
  };
  /** The tree, bush, stone or flowers composed for a thing, if it has one. */
  const small = (id: string): { as: FormKind; blueprint: Blueprint } | Record<string, never> => {
    const t = judged.things[id];
    return t?.blueprint === undefined || raisedAs(t.as) ? {} : { as: t.as, blueprint: t.blueprint };
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
  /** Adds a `CodeStanding` for a file or entity that has a form and no building or landmark. */
  const stand = (of: CodeStanding["of"], path: string, name: string, lines: number, at: { x: number; z: number }, vitality: number, value: number | undefined, file?: string): void => {
    const form = forms[path];
    if (form === undefined || composed(path) !== undefined) return;
    standing.push({ of, path, name, form, ...small(path), lines, ...(value === undefined ? {} : { importance: value }), x: at.x, z: at.z, ...(file === undefined ? {} : { file }), vitality });
  };
  /** Per directory: total ground, the ground-weighted sum of its leaves' centers, and the centers themselves. */
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
      // The lot is recorded even when nothing was chosen or composed for the entity. It stays open ground, since only Jev's choices are placed.
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
    // The file itself is placed on its own plot, as a building or landmark Jev composed or as the form Jev chose.
    const own = composed(path);
    const fileFacts: ThingFacts = { path, name: baseName(path), lines: f.lines, exports: f.symbols.filter((x) => x.exported).length, dependents: f.importedBy };
    if (own !== undefined) things.push({ path, of: "file", name: baseName(path), as: own.as, blueprint: own.blueprint, area, x: plotted.own.x, z: plotted.own.z, lot: LAYOUT.lotReach[own.as], file: path, facts: fileFacts, vitality });
    stand("file", path, baseName(path), f.lines, plotted.own, vitality, importance.get(`file:${path}`), path);
    for (const { def, x, z } of plotted.defs) {
      const mine = quality.get(`def:${def.id}`) ?? vitality;
      // A definition with a building or landmark is also added to `things`, on its own plot.
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
        form: forms[def.id] ?? "",
        ...small(def.id),
        x,
        z,
        vitality: mine,
      });
    }
  }

  // An area's point is the leaf center nearest the ground-weighted mean of its leaves' centers.
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

  // A dependency's weight is the number of the importing entity's files that import from the other entity.
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
      ...(judged.wild === undefined ? {} : { wild: judged.wild }),
      areas,
      patches,
      cells,
      things,
      symbols,
      standing,
      // Trails join entities, whatever form each has.
      trails: chooseTrails(judged.trails, [...things.filter((t) => (t.of ?? "entity") === "entity").map((t) => t.path), ...standing.filter((s) => s.of === "entity").map((s) => s.path)], weights),
      regions,
    },
    lots,
  };
}
