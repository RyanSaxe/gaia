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
}

/** One Jev request about one thing. */
export interface WorldRequest {
  readonly about: "world" | "area" | "file" | "entity";
  /** The thing's path: a directory, a file or an entity's root; "" for the repository. */
  readonly target: string;
  readonly request: JevRequest;
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
  /** The most trails a world shows: this many per standing entity. */
  trailsPerEntity: 1.4,
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

/** The request Jev gets about each thing. State carries facts and doc comments only, never source. */
export function planWorldRequests(model: CodeModel, looks: Looks): WorldRequest[] {
  const dirs = directoriesOf(model, model.repository.name);
  const requests: WorldRequest[] = [];
  const ask = (about: WorldRequest["about"], target: string, state: unknown, questions: Record<string, JevQuestion>): void => {
    requests.push({ about, target, request: { model: MODEL, state, questions } });
  };
  const r = model.repository;
  ask(
    "world",
    "",
    { repository: { name: r.name, files: r.files, lines: r.lines, languages: languagesOf(model.files), ageDays: r.ageDays, commitsLast30Days: r.commitsLast30Days, contributors: r.contributors } },
    { world: choice("This repository becomes a whole world. Which art direction suits it: its light, sky, season and wind?", docs(looks.world), "world", "") },
  );
  for (const path of regionPaths(dirs)) {
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
    ask(
      "area",
      path,
      {
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
      },
      {
        land: choice("This directory becomes an area of the world. Which land suits it: its landform and ground cover?", docs(looks.land), "land", path),
        water: choice("Does this area's land hold water? Choose the option whose reason fits this directory best.", docs(looks.water), "water", path),
      },
    );
  }
  for (const f of [...model.files].sort(byPath)) {
    const standing = standingSymbols(f);
    const forms: Record<string, JevQuestion> = {};
    for (const kind of [...new Set(standing.map((s) => s.kind))].sort()) {
      forms[`form:${kind}`] = choice(`Each ${KIND_WORDS[kind]} in this file stands on its patch as something a person can walk up to. What does each stand as?`, docs(looks.form), `form:${kind}`, f.path);
    }
    ask(
      "file",
      f.path,
      {
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
      },
      { vibe: choice("This file becomes a patch of ground in its directory's area. What grows on it?", docs(looks.vibe), "vibe", f.path), ...forms },
    );
  }
  const entities = new Map(model.entities.map((e) => [e.path, e]));
  const things = {
    ...Object.fromEntries(Object.entries(looks.building).map(([k, l]) => [`building:${k}`, `A building: ${l.doc}`])),
    ...Object.fromEntries(Object.entries(looks.landmark).map(([k, l]) => [`landmark:${k}`, `A landmark seen from far away: ${l.doc}`])),
  };
  for (const e of [...model.entities].sort(byPath)) {
    const questions: Record<string, JevQuestion> = {
      stands: choice(
        "This entity stands in the world as a building a person can walk up to, or as a landmark seen and steered by from far away. Which suits it?",
        things,
        "stands",
        e.path,
      ),
    };
    for (const dep of e.dependsOn) {
      const other = entities.get(dep);
      if (other === undefined) continue;
      questions[`trail:${dep}`] = {
        type: "noul",
        instructions: `${e.name} depends on ${other.name}. Would a person walk a worn trail between the two, because ${e.name} leans on it heavily?`,
        criteria: { true: "A trail joins them.", false: "No trail joins them." },
      };
      questions[`trail-look:${dep}`] = choice(`How does the trail from ${e.name} to ${other.name} look?`, docs(looks.trail), `trail-look:${dep}`, e.path);
    }
    ask(
      "entity",
      e.path,
      {
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
            return o === undefined ? [] : [{ name: o.name, dependents: o.dependents.length }];
          }),
          dependents: e.dependents.map((p) => entities.get(p)?.name ?? p),
        },
      },
      questions,
    );
  }
  return requests;
}

const pickOf = (a: JevAnswer | undefined): string | undefined => (a?.type === "choice" ? a.choice : undefined);

/** Asks every planned request, `concurrency` at a time, and reads the answers into judgments. */
export async function judgeWorld(model: CodeModel, looks: Looks, jev: JevClient, concurrency = 8): Promise<Judgments> {
  const planned = planWorldRequests(model, looks);
  const answers: Readonly<Record<string, JevAnswer>>[] = new Array(planned.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, planned.length) }, async () => {
      while (next < planned.length) {
        const i = next++;
        answers[i] = (await jev.ask((planned[i] as WorldRequest).request)).answers;
      }
    }),
  );
  const first = (set: LookSet): string => Object.keys(set).sort()[0] ?? "";
  let world = first(looks.world);
  const lands: Record<string, string> = {};
  const vibes: Record<string, string> = {};
  const things: Record<string, { as: "building" | "landmark"; look: string }> = {};
  const trails: CodeTrail[] = [];
  const forms: Record<string, Record<string, string>> = {};
  const waters: Record<string, string> = {};
  planned.forEach((p, i) => {
    const a = answers[i] ?? {};
    if (p.about === "world") world = pickOf(a.world) ?? world;
    else if (p.about === "area") {
      lands[p.target] = pickOf(a.land) ?? first(looks.land);
      waters[p.target] = pickOf(a.water) ?? first(looks.water);
    } else if (p.about === "file") {
      vibes[p.target] = pickOf(a.vibe) ?? first(looks.vibe);
      const mine: Record<string, string> = {};
      for (const id of Object.keys(p.request.questions)) if (id.startsWith("form:")) mine[id.slice("form:".length)] = pickOf(a[id]) ?? first(looks.form);
      if (Object.keys(mine).length > 0) forms[p.target] = mine;
    } else {
      const [as, look] = (pickOf(a.stands) ?? `building:${first(looks.building)}`).split(/:(.*)/s) as [string, string];
      things[p.target] = { as: as === "landmark" ? "landmark" : "building", look };
      for (const [id, answer] of Object.entries(a)) {
        if (!id.startsWith("trail:") || answer.type !== "noul") continue;
        const to = id.slice("trail:".length);
        trails.push({ from: p.target, to, want: answer.noul, look: pickOf(a[`trail-look:${to}`]) ?? first(looks.trail) });
      }
    }
  });
  return { world, lands, vibes, things, trails, forms, waters };
}

// ---------- the stand-in judge ----------

const STOP = new Set(["src", "the", "and", "for", "lib", "mod", "index", "main", "packages", "gaia"]);
const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
const sizeTag = (lines: number, small: number, large: number): string => (lines < small ? "small" : lines > large ? "large" : "medium");

/** Tags read from the facts in a request's state: what the stand-in matches against each option's `suits`. */
function tagsOf(state: Record<string, unknown>): string[] {
  type Facts = Record<string, unknown> & { languages?: string[]; kinds?: Record<string, number>; dependents?: unknown[] };
  const repo = state.repository as Facts | undefined;
  if (repo !== undefined) {
    return [...(repo.languages ?? []).slice(0, 1), (repo.commitsLast30Days as number) >= 50 ? "busy" : "quiet", (repo.ageDays as number) < 60 ? "young" : "old", sizeTag(repo.lines as number, 5000, 80000)];
  }
  const dir = state.directory as Facts | undefined;
  if (dir !== undefined) {
    const kinds = Object.entries(dir.kinds ?? {}).sort((a, b) => b[1] - a[1]);
    const imports = (dir.imports ?? {}) as { withinItself?: number; toOtherDirectories?: number; fromOtherDirectories?: number };
    const files = Math.max(1, dir.files as number);
    // How the directory's code moves: along chains of its own imports, out to others, or barely at all.
    const flow = (imports.withinItself ?? 0) >= files * 2 ? ["flow"] : (imports.fromOtherDirectories ?? 0) >= files * 2 ? ["crossroads"] : (imports.withinItself ?? 0) + (imports.toOtherDirectories ?? 0) < files * 0.3 ? ["still"] : ["dry"];
    return [kinds[0]?.[0] ?? "source", ...(dir.languages ?? []).slice(0, 1), sizeTag(dir.lines as number, 600, 4000), ...flow, ...words(String(dir.path))];
  }
  const file = state.file as Facts | undefined;
  if (file !== undefined) {
    const path = String(file.path);
    return [
      String(file.kind),
      String(file.language),
      sizeTag(file.lines as number, 60, 300),
      ...((file.importedBy as number) >= 4 ? ["hub"] : []),
      ...(/(^|\/)(index|main|lib)\.\w+$/.test(path) ? ["entry"] : []),
      ...words(path),
    ];
  }
  const e = state.entity as Facts | undefined;
  if (e !== undefined) {
    const dependents = (e.dependents ?? []).length;
    return [
      String(e.form),
      sizeTag(e.lines as number, 400, 3000),
      ...(dependents >= 6 ? ["hub"] : dependents === 0 ? ["leaf"] : []),
      ...((e.exports as number) >= 40 ? ["surface"] : []),
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
  for (const [prefix, set] of [["", looks.world], ["", looks.land], ["", looks.vibe], ["", looks.trail], ["", looks.form], ["", looks.water], ["building:", looks.building], ["landmark:", looks.landmark]] as const) {
    for (const [key, look] of Object.entries(set)) suits.set(`${prefix}${key}`, [...(suits.get(`${prefix}${key}`) ?? []), ...look.suits]);
  }
  return {
    async ask(request: JevRequest) {
      const state = (request.state ?? {}) as Record<string, unknown>;
      const tags = new Set(tagsOf(state));
      const about = (state.file ?? state.entity ?? state.directory ?? {}) as { path?: string };
      const target = about.path ?? "";
      const answers: Record<string, JevAnswer> = {};
      for (const [id, q] of Object.entries(request.questions)) {
        if (q.type === "choice") {
          const r = rand(seedOf(`${target}:${id}`));
          // A form question is about one kind of symbol: the kind is a fact it suits.
          const own = id.startsWith("form:") ? new Set([...tags, id.slice("form:".length)]) : tags;
          const scores = Object.keys(q.criteria)
            .sort()
            .map((key) => [key, (suits.get(key) ?? []).filter((s) => own.has(s)).length + r.next() * 0.6] as const);
          const total = scores.reduce((n, [, s]) => n + Math.exp(2 * s), 0);
          const probabilities = Object.fromEntries(scores.map(([k, s]) => [k, Math.exp(2 * s) / total]));
          const [best] = [...scores].sort((a, b) => b[1] - a[1])[0] ?? [""];
          answers[id] = { type: "choice", choice: best, probabilities, confidence: probabilities[best] ?? 0 };
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
 * The trails a world shows: of the dependencies Jev would walk (more than
 * even odds), first those that join groups of entities not yet joined, most
 * wanted and heaviest first, so every connected part of the code is walkable;
 * then the most wanted of the rest, up to the composition budget.
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
  const budget = Math.round(standing.length * LAYOUT.trailsPerEntity);
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
  return [...spanning, ...rest].slice(0, Math.max(spanning.length, budget));
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
