// The world a codebase becomes. The repository is the world; each directory
// is an area, nested inside its parent's; each file is a patch of ground in
// its directory's area, sized by its lines; each entity is a building or a
// landmark standing in its root directory's area; and a dependency between
// two entities may become a trail. Jev judges what each thing looks like:
// `planWorldRequests` asks it, one request per thing, from facts and doc
// comments only. `layoutWorld` then places everything by rule, so the same
// code and the same answers always give the same world.
//
// Until the reviewer approves live calls, `standInJev` answers those same
// requests: a deterministic stand-in that matches each option's `suits`
// against tags read from the facts. Swapping in Jev is one line: pass the
// engine's client to `judgeWorld` instead.

import {
  type AreaPlace,
  type CodeModel,
  type EntityFacts,
  type FileFacts,
  type JevAnswer,
  type JevClient,
  type JevQuestion,
  type JevRequest,
  type PatchPlace,
  type WorldPlaces,
  rand,
  seedOf,
} from "@gaia/schema";
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
}

export interface CodeArea extends AreaPlace {
  /** The terrain region whose land this area's own ground shows. */
  readonly region: number;
}

export interface CodePatch extends PatchPlace {
  readonly lines: number;
  readonly kind: string;
  /** What grows on it: a vibe key. */
  readonly vibe: string;
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
  /** Its lot: ground kept for it in its area. */
  readonly x: number;
  readonly z: number;
  readonly lot: number;
  readonly vitality: number;
}

export interface CodeTrail {
  readonly from: string;
  readonly to: string;
  /** Jev's probability that a person would walk between them, 0 to 1. */
  readonly want: number;
  readonly look: string;
}

/** A terrain region: a directory whose land has its own landform and cover. */
export interface CodeRegion {
  readonly area: string;
  readonly x: number;
  readonly z: number;
  /** How far its land reaches before a neighbor's begins, meters. */
  readonly reach: number;
  readonly land: string;
}

/** A world document laid out from code: every area, patch, thing and trail, and the terrain's regions. */
export interface CodeWorld extends WorldPlaces {
  readonly projectId: string;
  /** Side of the walkable square, meters: it grows with the codebase. */
  readonly size: number;
  /** The world look key: the repository's art direction. */
  readonly world: string;
  readonly areas: readonly CodeArea[];
  readonly patches: readonly CodePatch[];
  readonly things: readonly CodeThing[];
  readonly trails: readonly CodeTrail[];
  readonly regions: readonly CodeRegion[];
}

export const LAYOUT = {
  /** Square meters of ground per line of a file. */
  m2PerLine: 2.5,
  /** A file's lines count between these for its patch's size. */
  lines: [12, 1200],
  /** Meters between neighboring patches. */
  patchGap: 1.5,
  /** Meters between neighboring subdirectory areas. */
  areaGap: 6,
  /** Common ground around a directory's contents, meters. */
  border: 5,
  /** The ground kept for a building or a landmark, meters across its middle. */
  lot: { building: 15, landmark: 12 },
  /** From the land's edge to the walkable square's edge, meters: room for the rim. */
  rim: 70,
  /** The smallest world, meters across. */
  minSize: 320,
  /** A directory has its own land when it holds this share of the code's lines, not counting its own lands. */
  regionShare: 0.03,
  maxRegions: 24,
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
          contents: largest.map((f) => ({ name: baseName(f.path), ...(f.doc === undefined ? {} : { doc: trim(f.doc, 160) }) })),
        },
      },
      { land: choice("This directory becomes an area of the world. Which land suits it: its landform and ground cover?", docs(looks.land), "land", path) },
    );
  }
  for (const f of [...model.files].sort(byPath)) {
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
        },
      },
      { vibe: choice("This file becomes a patch of ground in its directory's area. What grows on it?", docs(looks.vibe), "vibe", f.path) },
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
  planned.forEach((p, i) => {
    const a = answers[i] ?? {};
    if (p.about === "world") world = pickOf(a.world) ?? world;
    else if (p.about === "area") lands[p.target] = pickOf(a.land) ?? first(looks.land);
    else if (p.about === "file") vibes[p.target] = pickOf(a.vibe) ?? first(looks.vibe);
    else {
      const [as, look] = (pickOf(a.stands) ?? `building:${first(looks.building)}`).split(/:(.*)/s) as [string, string];
      things[p.target] = { as: as === "landmark" ? "landmark" : "building", look };
      for (const [id, answer] of Object.entries(a)) {
        if (!id.startsWith("trail:") || answer.type !== "noul") continue;
        const to = id.slice("trail:".length);
        trails.push({ from: p.target, to, want: answer.noul, look: pickOf(a[`trail-look:${to}`]) ?? first(looks.trail) });
      }
    }
  });
  return { world, lands, vibes, things, trails };
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
    return [kinds[0]?.[0] ?? "source", ...(dir.languages ?? []).slice(0, 1), sizeTag(dir.lines as number, 600, 4000), ...words(String(dir.path))];
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
  for (const [prefix, set] of [["", looks.world], ["", looks.land], ["", looks.vibe], ["", looks.trail], ["building:", looks.building], ["landmark:", looks.landmark]] as const) {
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
          const scores = Object.keys(q.criteria)
            .sort()
            .map((key) => [key, (suits.get(key) ?? []).filter((s) => tags.has(s)).length + r.next() * 0.6] as const);
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

interface Disc {
  r: number;
  x: number;
  z: number;
}

/**
 * Packs discs around the origin in order: each takes the nearest free spot
 * on rings growing outward, keeping `gap` from the others; the first sits
 * at the origin. Each ring's angles start at a rotation seeded by `seed`.
 */
function pack(discs: readonly Disc[], gap: number, seed: string): void {
  const placed: Disc[] = [];
  const r0 = rand(seedOf(seed));
  for (const d of discs) {
    if (placed.length === 0) {
      d.x = 0;
      d.z = 0;
      placed.push(d);
      continue;
    }
    const step = Math.max(0.75, d.r * 0.25);
    const turn = r0.next() * Math.PI * 2;
    // The placed discs' middle, weighted by area: free spots nearest it keep the cluster round.
    const mass = placed.reduce((n, p) => n + p.r * p.r, 0);
    const mx = placed.reduce((n, p) => n + p.x * p.r * p.r, 0) / mass;
    const mz = placed.reduce((n, p) => n + p.z * p.r * p.r, 0) / mass;
    let best: [number, number] | null = null;
    for (let rho = step; best === null; rho += step) {
      const count = Math.max(12, Math.ceil((Math.PI * 2 * rho) / step));
      let near = Infinity;
      for (let k = 0; k < count; k++) {
        const a = turn + (k * Math.PI * 2) / count;
        const x = Math.cos(a) * rho;
        const z = Math.sin(a) * rho;
        const dm = Math.hypot(x - mx, z - mz);
        if (dm < near && placed.every((p) => Math.hypot(p.x - x, p.z - z) >= p.r + d.r + gap)) {
          near = dm;
          best = [x, z];
        }
      }
    }
    [d.x, d.z] = best;
    placed.push(d);
  }
}

/** The middle of a near-smallest circle enclosing every disc (Bădoiu and Clarkson's iteration). */
function enclosing(discs: readonly Disc[]): [number, number] {
  if (discs.length === 0) return [0, 0];
  let cx = discs.reduce((n, d) => n + d.x, 0) / discs.length;
  let cz = discs.reduce((n, d) => n + d.z, 0) / discs.length;
  for (let k = 1; k <= 200; k++) {
    let far = discs[0] as Disc;
    let reach = -1;
    for (const d of discs) {
      const r = Math.hypot(d.x - cx, d.z - cz) + d.r;
      if (r > reach) [far, reach] = [d, r];
    }
    const dist = Math.hypot(far.x - cx, far.z - cz) || 1;
    const px = far.x + ((far.x - cx) / dist) * far.r;
    const pz = far.z + ((far.z - cz) / dist) * far.r;
    cx += (px - cx) / (k + 1);
    cz += (pz - cz) / (k + 1);
  }
  return [cx, cz];
}

/** A directory's contents laid out around its own origin. */
interface Block {
  readonly radius: number;
  /** Positions relative to the block's origin. */
  readonly lot: Disc | null;
  readonly patches: ReadonlyMap<string, Disc>;
  readonly children: ReadonlyMap<string, Disc>;
}

const patchRadius = (f: FileFacts): number => Math.sqrt((weightOf(f) * LAYOUT.m2PerLine) / Math.PI);

/** Lays out the world from the code and Jev's judgments. */
export function layoutWorld(model: CodeModel, judged: Judgments): CodeWorld {
  const name = model.repository.name;
  const dirs = directoriesOf(model, name);
  const entityAt = new Map(model.entities.map((e) => [e.path, e]));
  const blocks = new Map<string, Block>();

  // Bottom up: a directory's lot first, then its own files, then its subdirectories' areas.
  const build = (path: string): Block => {
    const d = dirs.get(path) as Dir;
    for (const c of d.children) build(c);
    const thing = judged.things[path];
    const lot: Disc | null = entityAt.has(path) ? { r: thing?.as === "landmark" ? LAYOUT.lot.landmark : LAYOUT.lot.building, x: 0, z: 0 } : null;
    const files = [...d.files].sort((a, b) => b.lines - a.lines || byPath(a, b));
    const patches = new Map(files.map((f) => [f.path, { r: patchRadius(f), x: 0, z: 0 }]));
    const kids = [...d.children].sort((a, b) => (blocks.get(b)?.radius ?? 0) - (blocks.get(a)?.radius ?? 0) || (a < b ? -1 : 1));
    const children = new Map(kids.map((c) => [c, { r: (blocks.get(c) as Block).radius, x: 0, z: 0 }]));
    const discs = [...(lot === null ? [] : [lot]), ...patches.values()];
    pack(discs, LAYOUT.patchGap, `${path}/own`);
    // Subdirectories ring the directory's own ground.
    const all = [...discs, ...children.values()];
    if (discs.length > 0) {
      const own = discs.reduce((m, p) => Math.max(m, Math.hypot(p.x, p.z) + p.r), 0);
      pack([{ r: own, x: 0, z: 0 }, ...children.values()], LAYOUT.areaGap, `${path}/areas`);
    } else {
      pack([...children.values()], LAYOUT.areaGap, `${path}/areas`);
    }
    // The block's origin moves to the middle of its smallest enclosing circle, so areas stay tight at every depth.
    const [cx, cz] = enclosing(all);
    for (const p of all) {
      p.x -= cx;
      p.z -= cz;
    }
    const radius = all.reduce((m, p) => Math.max(m, Math.hypot(p.x, p.z) + p.r), 0) + LAYOUT.border;
    const block: Block = { radius, lot, patches, children };
    blocks.set(path, block);
    return block;
  };
  const root = build("");

  // Top down: every block's origin in the world.
  const areas: CodeArea[] = [];
  const patches: CodePatch[] = [];
  const things: CodeThing[] = [];
  const regionsOf = regionPaths(dirs);
  const regionIndex = new Map(regionsOf.map((p, i) => [p, i]));
  const regionOfDir = (path: string): number => {
    for (let p: string | null = path; p !== null; p = p === "" ? null : parentOf(p)) {
      const i = regionIndex.get(p);
      if (i !== undefined) return i;
    }
    return 0;
  };
  const files = new Map(model.files.map((f) => [f.path, f]));
  const place = (path: string, ox: number, oz: number): void => {
    const d = dirs.get(path) as Dir;
    const b = blocks.get(path) as Block;
    areas.push({ path, name: d.name, depth: d.depth, parent: d.parent, x: ox, z: oz, radius: b.radius, region: regionOfDir(path) });
    if (b.lot !== null) {
      const e = entityAt.get(path) as EntityFacts;
      const t = judged.things[path] ?? { as: "building", look: "" };
      things.push({ path, name: e.name, as: t.as, look: t.look, area: path, x: ox + b.lot.x, z: oz + b.lot.z, lot: b.lot.r, vitality: entityVitalityOf(e).vitality });
    }
    for (const [p, disc] of b.patches) {
      const f = files.get(p) as FileFacts;
      patches.push({ path: p, name: baseName(p), area: path, x: ox + disc.x, z: oz + disc.z, radius: disc.r, vitality: vitalityOf(f).vitality, lines: f.lines, kind: f.kind ?? "source", vibe: judged.vibes[p] ?? "" });
    }
    for (const [c, disc] of b.children) place(c, ox + disc.x, oz + disc.z);
  };
  place("", 0, 0);

  // Each region's land centers on its own files (and lot), reaching as far as their ground.
  const regions: CodeRegion[] = regionsOf.map((path, i) => {
    const mine = patches.filter((p) => areas.find((a) => a.path === p.area)?.region === i);
    const lots = things.filter((t) => areas.find((a) => a.path === t.area)?.region === i).map((t) => ({ x: t.x, z: t.z, radius: t.lot }));
    const discs = [...mine, ...lots];
    const weight = discs.reduce((n, p) => n + p.radius * p.radius, 0);
    const area = areas.find((a) => a.path === path) as CodeArea;
    const x = weight > 0 ? discs.reduce((n, p) => n + p.x * p.radius * p.radius, 0) / weight : area.x;
    const z = weight > 0 ? discs.reduce((n, p) => n + p.z * p.radius * p.radius, 0) / weight : area.z;
    return { area: path, x, z, reach: 0.6 * Math.sqrt(weight), land: judged.lands[path] ?? "" };
  });

  const size = Math.max(LAYOUT.minSize, Math.ceil((2 * (root.radius + LAYOUT.rim)) / 10) * 10);
  const known = new Set(things.map((t) => t.path));
  return {
    name,
    projectId: model.projectId,
    size,
    world: judged.world,
    areas,
    patches,
    things,
    trails: judged.trails.filter((t) => t.want > 0.5 && known.has(t.from) && known.has(t.to)),
    regions,
  };
}
