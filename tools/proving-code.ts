// The proving ground's code: real source for every file the proving ground
// plans (tools/proving.ts), so the same files test both the world and Jev's
// judgments of code. Each file is written as its planned health says: a
// thriving file is small, named and documented steps; a ruined one is long
// tangles with letters for names, docs about something else, emptied error
// handlers, state hidden at module level, unrelated helpers, shims marked
// HACK, copied blocks and TODOs. The manifest says, by the engine's question
// names, how each file was written, so the bench can hold Jev's answers to it.
// The same plan always writes the same code.

import type { FileFacts, SymbolFact } from "@gaia/schema";

export type Health = "thriving" | "well" | "tired" | "failing" | "ruin" | "decayed";

/** A planned file: its facts, as the proving ground's code model holds them, its health, and the vitality its patch has in the proving ground's world. */
export interface PlannedFile {
  readonly facts: FileFacts;
  readonly health: Health;
  readonly vitality: number;
}

/** What a question should find in a file: the engine's own question names. */
export type Level = "good" | "fair" | "poor";

/** How one file was written, keyed by the engine's question names. */
export interface ManifestEntry {
  readonly path: string;
  /** The vitality the file's patch has in the proving ground's world, 0 to 1: what a page shows (decision 43). */
  readonly vitality: number;
  /** The plan's word for how the file fares, which picks how it is written; a page never shows it. */
  readonly health: Health;
  readonly planned: number;
  readonly lines: number;
  readonly naming: Level;
  readonly doc: Level;
  readonly readability: Level;
  readonly errors: Level;
  readonly change: Level;
  readonly cohesion: Level;
  /** Whether nothing but tests reaches it. */
  readonly dead: boolean;
  /** The reasons to look a callout should find, besides "routine". */
  readonly attention: readonly string[];
}

/** How a health spoils a file. Length, nesting and TODOs come from the file's own facts. */
interface Spoil {
  /** Share of functions written as one long tangle rather than small named steps. */
  readonly tangled: number;
  /** naming: share of names cut to a letter or an abbreviation. */
  readonly names: number;
  /** doc: every doc says what the code does, half the docs are gone, or the docs describe something else. */
  readonly docs: "fit" | "some" | "wrong";
  /** errors: handlers emptied. */
  readonly swallowed: number;
  /** change: module-level state the functions read and write, and a call order nothing enforces. */
  readonly hidden: boolean;
  /** cohesion: helpers about unrelated things. */
  readonly unrelated: number;
  /** workaround: special cases shimmed in, marked HACK. */
  readonly hacks: number;
  /** Blocks copied with a small change. */
  readonly copies: number;
}

const SPOIL: Readonly<Record<Health, Spoil>> = {
  thriving: { tangled: 0, names: 0, docs: "fit", swallowed: 0, hidden: false, unrelated: 0, hacks: 0, copies: 0 },
  well: { tangled: 0.2, names: 0, docs: "fit", swallowed: 0, hidden: false, unrelated: 0, hacks: 0, copies: 0 },
  tired: { tangled: 0.5, names: 0.4, docs: "some", swallowed: 1, hidden: true, unrelated: 1, hacks: 1, copies: 1 },
  failing: { tangled: 0.3, names: 0.2, docs: "fit", swallowed: 1, hidden: false, unrelated: 0, hacks: 1, copies: 0 },
  ruin: { tangled: 1, names: 1, docs: "wrong", swallowed: 3, hidden: true, unrelated: 3, hacks: 2, copies: 2 },
  decayed: { tangled: 1, names: 1, docs: "wrong", swallowed: 3, hidden: true, unrelated: 3, hacks: 2, copies: 2 },
};

/** A small deterministic random stream, seeded by a file's path. */
function streamOf(seed: string): { next(): number; pick<T>(items: readonly T[]): T } {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  const next = (): number => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, pick: (items) => items[Math.floor(next() * items.length)] as (typeof items)[number] };
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const baseOf = (path: string): string => (path.split("/").pop() ?? path).replace(/\.(test\.)?\w+$/, "");
const nounOf = (path: string): string => {
  const base = baseOf(path);
  const dir = path.split("/").slice(0, -1).pop() ?? "proving";
  return (["index", "lib", "main", "server", "mod"].includes(base) ? dir : base).replace(/-/g, " ");
};
const relative = (from: string, to: string): string => {
  const a = from.split("/").slice(0, -1);
  const b = to.split("/");
  let k = 0;
  while (k < a.length && k < b.length - 1 && a[k] === b[k]) k++;
  const up = a.length - k;
  const path = [...(up === 0 ? ["."] : Array.from({ length: up }, () => "..")), ...b.slice(k)].join("/");
  return path;
};

/** The words a file's code is about: its noun, the record its functions handle, and the limit it exports. */
interface Words {
  readonly noun: string;
  /** The noun as one capitalized word, for names. */
  readonly stem: string;
  /** The record the file's functions handle: its type symbol, or a local interface. */
  readonly record: string;
  readonly recordExported: boolean;
  /** Its constant symbol: the most readings one call takes. */
  readonly limit?: string;
}

function wordsOf(f: FileFacts): Words {
  const type = f.symbols.find((s) => s.kind === "type");
  const constant = f.symbols.find((s) => s.kind === "constant");
  const noun = nounOf(f.path);
  const stem = cap(noun.replace(/ (\w)/g, (_, c: string) => c.toUpperCase()));
  return { noun, stem, record: type?.name ?? `${stem}Reading`, recordExported: type !== undefined, ...(constant === undefined ? {} : { limit: constant.name }) };
}

// ---------- TypeScript ----------

/** The steps a well-written file shares between its functions. */
const HELPERS: Readonly<Record<string, (w: Words) => string[]>> = {
  within: (w) => [`/** Whether a level lies within the ${w.noun}'s bounds. */`, `function withinBounds(level: number): boolean {`, `  return level >= BOUNDS.least && level <= BOUNDS.most;`, `}`],
  sum: () => [`/** The sum of some numbers, 0 for none. */`, `function sumOf(values: readonly number[]): number {`, `  return values.reduce((total, value) => total + value, 0);`, `}`],
  byRate: (w) => [`/** Orders readings by rate, fastest first, then by id so equal rates keep one order. */`, `function byRateDescending(a: ${w.record}, b: ${w.record}): number {`, `  return b.rate - a.rate || a.id.localeCompare(b.id);`, `}`],
  newer: (w) => [`/** The later of two readings of the same thing. */`, `function newerOf(a: ${w.record}, b: ${w.record}): ${w.record} {`, `  return b.at > a.at ? b : a;`, `}`],
  clamp: (w) => [`/** A level moved into the ${w.noun}'s bounds. */`, `function clampLevel(level: number): number {`, `  return Math.min(BOUNDS.most, Math.max(BOUNDS.least, level));`, `}`],
};

/** One thing a function can do with the file's readings, written well: its doc, signature and body, and the helpers it needs. */
interface Recipe {
  readonly doc: (w: Words) => string;
  readonly helpers: readonly string[];
  readonly lines: (name: string, w: Words) => string[];
}

const merge: Recipe = {
  doc: (w) => `Joins two lists of the ${w.noun}'s readings into one by id; where both hold one, the later reading wins.`,
  helpers: ["newer"],
  lines: (name, w) => [
    `export function ${name}(older: readonly ${w.record}[], newer: readonly ${w.record}[]): ${w.record}[] {`,
    `  const byId = new Map<string, ${w.record}>();`,
    `  for (const reading of [...older, ...newer]) {`,
    `    const had = byId.get(reading.id);`,
    `    byId.set(reading.id, had === undefined ? reading : newerOf(had, reading));`,
    `  }`,
    `  return [...byId.values()].sort((a, b) => a.at - b.at);`,
    `}`,
  ],
};
const summarize: Recipe = {
  doc: (w) => `Adds up the levels of the ${w.noun}'s readings within bounds: how many there were, their total, their mean and the highest.`,
  helpers: ["within", "sum"],
  lines: (name, w) => [
    `export function ${name}(readings: readonly ${w.record}[]): { count: number; total: number; mean: number; highest: number } {`,
    `  const levels = readings.map((reading) => reading.level).filter(withinBounds);`,
    `  if (levels.length === 0) return { count: 0, total: 0, mean: 0, highest: 0 };`,
    `  const total = sumOf(levels);`,
    `  return { count: levels.length, total, mean: total / levels.length, highest: Math.max(...levels) };`,
    `}`,
  ],
};

/** What each verb a planned function's name starts with does, so every name says what its code does. */
const RECIPES: Readonly<Record<string, Recipe>> = {
  gather: {
    doc: (w) => `Gathers the ${w.noun}'s readings that carry \`mark\`, oldest first.`,
    helpers: [],
    lines: (name, w) => [`export function ${name}(readings: readonly ${w.record}[], mark: string): ${w.record}[] {`, `  return readings.filter((reading) => reading.marks.includes(mark)).sort((a, b) => a.at - b.at);`, `}`],
  },
  join: merge,
  weigh: {
    doc: (w) => `Weighs the ${w.noun}'s readings: each level within bounds counts as much as its rate.`,
    helpers: ["within", "sum"],
    lines: (name, w) => [`export function ${name}(readings: readonly ${w.record}[]): number {`, `  return sumOf(readings.filter((reading) => withinBounds(reading.level)).map((reading) => reading.level * reading.rate));`, `}`],
  },
  measure: summarize,
  fold: {
    doc: (w) => `Folds the ${w.noun}'s readings into one total level, counting only levels within bounds.`,
    helpers: ["within", "sum"],
    lines: (name, w) => [`export function ${name}(readings: readonly ${w.record}[]): number {`, `  return sumOf(readings.map((reading) => reading.level).filter(withinBounds));`, `}`],
  },
  keep: {
    doc: (w) => `Keeps the \`count\` fastest of the ${w.noun}'s readings whose level lies within bounds.`,
    helpers: ["within", "byRate"],
    lines: (name, w) => [
      `export function ${name}(readings: readonly ${w.record}[], count: number${w.limit === undefined ? "" : ` = ${w.limit}`}): ${w.record}[] {`,
      `  if (count <= 0) return [];`,
      `  return readings.filter((reading) => withinBounds(reading.level)).sort(byRateDescending).slice(0, count);`,
      `}`,
    ],
  },
  sort: {
    doc: (w) => `The ${w.noun}'s readings sorted by rate, fastest first; equal rates keep their order by id.`,
    helpers: ["byRate"],
    lines: (name, w) => [`export function ${name}(readings: readonly ${w.record}[]): ${w.record}[] {`, `  return [...readings].sort(byRateDescending);`, `}`],
  },
  turn: {
    doc: (w) => `The ${w.noun}'s readings turned to newest first, as a person reading the latest wants them.`,
    helpers: [],
    lines: (name, w) => [`export function ${name}(readings: readonly ${w.record}[]): ${w.record}[] {`, `  return [...readings].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));`, `}`],
  },
  trace: {
    doc: (w) => `Traces one reading of the ${w.noun} through time: every reading with \`id\`, oldest first.`,
    helpers: [],
    lines: (name, w) => [`export function ${name}(readings: readonly ${w.record}[], id: string): ${w.record}[] {`, `  return readings.filter((reading) => reading.id === id).sort((a, b) => a.at - b.at);`, `}`],
  },
  settle: {
    doc: (w) => `Settles a level toward \`target\` a step at a time, kept within the ${w.noun}'s bounds, until it is within \`tolerance\` or \`limit\` steps have passed. Returns the level and the steps taken.`,
    helpers: ["clamp"],
    lines: (name) => [
      `export function ${name}(level: number, target: number, tolerance = 0.5, limit = 100): { level: number; steps: number } {`,
      `  let current = clampLevel(level);`,
      `  let steps = 0;`,
      `  while (Math.abs(target - current) > tolerance && steps < limit) {`,
      `    const step = Math.sign(target - current) * Math.min(BOUNDS.step, Math.abs(target - current));`,
      `    current = clampLevel(current + step);`,
      `    steps++;`,
      `  }`,
      `  return { level: current, steps };`,
      `}`,
    ],
  },
  mend: {
    doc: (w) => `Mends the ${w.noun}'s readings: drops those without an id, and moves every level back within bounds.`,
    helpers: ["clamp"],
    lines: (name, w) => [
      `export function ${name}(readings: readonly ${w.record}[]): ${w.record}[] {`,
      `  return readings.filter((reading) => reading.id !== "").map((reading) => ({ ...reading, level: clampLevel(reading.level) }));`,
      `}`,
    ],
  },
  carry: {
    doc: (w) => `Carries the ${w.noun}'s readings into \`slots\` loads whose total rates stay as even as they can: the fastest go first, each into the lightest load so far.`,
    helpers: ["byRate"],
    lines: (name, w) => [
      `export function ${name}(readings: readonly ${w.record}[], slots: number): ${w.record}[][] {`,
      `  const loads: ${w.record}[][] = Array.from({ length: Math.max(1, slots) }, () => []);`,
      `  const totals = loads.map(() => 0);`,
      `  for (const reading of [...readings].sort(byRateDescending)) {`,
      `    const lightest = totals.indexOf(Math.min(...totals));`,
      `    loads[lightest]?.push(reading);`,
      `    totals[lightest] = (totals[lightest] ?? 0) + reading.rate;`,
      `  }`,
      `  return loads;`,
      `}`,
    ],
  },
};
/** What a class named for a verb gives besides keeping readings: its method, and the helpers it needs. */
const METHODS: Readonly<Record<string, { readonly helpers: readonly string[]; readonly lines: (w: Words) => string[] }>> = {
  gather: { helpers: [], lines: (w) => [`/** Gathers more readings, keeping the newest of each id. */`, `gather(readings: readonly ${w.record}[]): void {`, `  for (const reading of readings) this.add(reading);`, `}`] },
  join: { helpers: [], lines: (w) => [`/** Joins another keeper's readings into this one, the newest of each id winning. */`, `join(other: { all(): ${w.record}[] }): void {`, `  for (const reading of other.all()) this.add(reading);`, `}`] },
  weigh: { helpers: ["within", "sum"], lines: () => [`/** The total level of the readings kept whose level lies within bounds. */`, `weigh(): number {`, `  return sumOf(this.all().map((reading) => reading.level).filter(withinBounds));`, `}`] },
  measure: { helpers: ["within"], lines: () => [`/** How many readings kept lie within bounds. */`, `measure(): number {`, `  return this.all().filter((reading) => withinBounds(reading.level)).length;`, `}`] },
  fold: { helpers: ["sum"], lines: () => [`/** Every level kept, folded into one total. */`, `fold(): number {`, `  return sumOf(this.all().map((reading) => reading.level));`, `}`] },
  keep: { helpers: ["byRate"], lines: (w) => [`/** The \`count\` fastest readings kept. */`, `fastest(count: number): ${w.record}[] {`, `  return this.all().sort(byRateDescending).slice(0, Math.max(0, count));`, `}`] },
  sort: { helpers: ["byRate"], lines: (w) => [`/** The readings kept, fastest first. */`, `sorted(): ${w.record}[] {`, `  return this.all().sort(byRateDescending);`, `}`] },
  turn: { helpers: [], lines: (w) => [`/** The readings kept, newest first. */`, `newestFirst(): ${w.record}[] {`, `  return this.all().reverse();`, `}`] },
  trace: { helpers: [], lines: (w) => [`/** The reading kept for \`id\`, if there is one. */`, `trace(id: string): ${w.record} | undefined {`, `  return this.all().find((reading) => reading.id === id);`, `}`] },
  settle: { helpers: ["clamp"], lines: (w) => [`/** The readings kept, each level moved back within bounds. */`, `settled(): ${w.record}[] {`, `  return this.all().map((reading) => ({ ...reading, level: clampLevel(reading.level) }));`, `}`] },
  mend: { helpers: [], lines: (w) => [`/** The readings kept that have an id; the rest are dropped. */`, `mended(): ${w.record}[] {`, `  return this.all().filter((reading) => reading.id !== "");`, `}`] },
  carry: { helpers: ["sum"], lines: () => [`/** The total rate of every reading kept: what this carrier carries. */`, `load(): number {`, `  return sumOf(this.all().map((reading) => reading.rate));`, `}`] },
};
/** The verb a class's name is made from, after the file's stem: "FlowSorter" sorts. */
const verbOf = (agent: string): string => Object.keys(RECIPES).find((verb) => agent.toLowerCase().startsWith(verb.slice(0, 4))) ?? "measure";
const recipeOf = (name: string): Recipe => RECIPES[Object.keys(RECIPES).find((verb) => name.startsWith(verb)) ?? "measure"] as Recipe;

/** What another file's doc would say: a doc that describes something else. */
const WRONG_DOCS = [
  "Parses the configuration file and returns the defaults.",
  "Opens a connection to the database and retries on failure.",
  "Renders the header for the settings page.",
  "Deprecated: use the new scheduler instead.",
  "Converts a date to the user's local time zone.",
  "Sends the queued emails in batches of fifty.",
];

/** Unrelated helpers a poorly kept file collects: what a file of misc things is made of. */
const UNRELATED: readonly ((n: string) => string[])[] = [
  (n) => [`export function ${n}(s: string): string {`, `  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");`, `}`],
  (n) => [`export function ${n}(d: Date): string {`, `  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();`, `}`],
  (n) => [`export function ${n}(hex: string): number[] {`, `  const h = hex.replace("#", "");`, `  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));`, `}`],
  (n) => [`export function ${n}(ms: number): Promise<void> {`, `  return new Promise((r) => setTimeout(r, ms));`, `}`],
];
const UNRELATED_NAMES = ["slug", "fmtDate", "hexToRgb", "sleep2"];

const LETTERS = ["a", "b", "c", "d", "x", "y", "t", "n", "v", "o"];
const ABBREVIATIONS = ["tmp", "val", "res", "obj", "arr", "cnt", "dat", "flg", "buf", "ret"];
const TODOS = [
  "TODO: handle negative rates",
  "FIXME: this breaks when the list is empty",
  "TODO: why 37?",
  "XXX: copied from the old version, check",
  "TODO: remove after the migration",
  "FIXME: off by one at the boundary",
  "TODO: make this configurable",
];
const HACKS = [
  (_w: Words) => [`// HACK: the east gauge reports twice; skip its second reading until it is fixed upstream`, `if (r.id === "east-7" && r.at % 2 === 1) continue;`],
  (w: Words) => [`// HACK: old ${w.noun} records stored levels in tenths; scale them until the data is migrated`, `if (r.at < 1500000000) lvl = lvl / 10;`],
];

/**
 * A function written as one tangle: `length` lines nested `depth` deep,
 * computing roughly what `recipe` would in the worst way, with letters or
 * abbreviations for names, magic numbers, an emptied handler, copied blocks
 * and TODOs, as `spoil` says.
 */
function tangle(name: string, w: Words, length: number, depth: number, spoil: Spoil, r: ReturnType<typeof streamOf>, todo: () => string | null, hack: () => string[] | null, swallow: () => boolean, hidden: boolean): string[] {
  const letter = (): string => (spoil.names >= 0.8 ? r.pick(LETTERS) : spoil.names > 0 && r.next() < spoil.names ? r.pick(ABBREVIATIONS) : r.pick(["total", "count", "level", "best", "seen", "result"]));
  const acc = [letter(), letter(), letter()].map((v, i) => `${v}${i + 1}`);
  const out: string[] = [];
  const pad = (k: number): string => "  ".repeat(k);
  const param = spoil.names >= 0.8 ? "l" : "items";
  out.push(`export function ${name}(${param}: any, o?: any): any {`);
  out.push(`  let ${acc[0]} = 0;`, `  let ${acc[1]} = 0;`, `  let ${acc[2]}: any = [];`);
  if (hidden) out.push(`  if (!ready) init();`, `  calls++;`);
  out.push(`  for (let i = 0; i < ${param}.length; i++) {`, `    const r = ${param}[i];`, `    let lvl = r.level;`);
  const h = hack();
  if (h !== null) for (const line of h) out.push(`    ${line}`);
  // Nest condition inside condition down to `depth`.
  const conds = ["r.rate > 0", "lvl > 3", "r.marks && r.marks.length > 0", "r.marks[0] != \"skip\"", "lvl < 97", "r.at > 0", "i % 2 == 0 || lvl > 50", "r.id", "!o || !o.strict", "lvl != 42", "r.rate < 1000"];
  let k = 2;
  for (let d = 0; d < Math.max(0, depth - 2); d++) {
    const t = todo();
    if (t !== null) out.push(`${pad(k)}// ${t}`);
    out.push(`${pad(k)}if (${conds[d % conds.length]}) {`);
    k++;
    out.push(`${pad(k)}${acc[0]} = ${acc[0]} + lvl * ${(1 + d * 0.5).toFixed(1)};`);
  }
  out.push(`${pad(k)}${acc[1]}++;`, `${pad(k)}${acc[2]}.push(r);`);
  while (k > 2) {
    k--;
    out.push(`${pad(k)}} else {`, `${pad(k + 1)}${acc[0]} = ${acc[0]} - ${r.pick(["1", "0.5", "2", "37"])};`, `${pad(k)}}`);
  }
  out.push(`  }`);
  // The rest of the length: steps one after another, some copied, one handler emptied.
  let copy = 0;
  let step = 0;
  while (out.length < length - 3) {
    const t = todo();
    if (t !== null) out.push(`  // ${t}`);
    if (swallow()) {
      out.push(`  try {`, `    ${acc[2]} = ${acc[2]}.sort((p: any, q: any) => q.rate - p.rate);`, `  } catch (e) {}`);
      continue;
    }
    const block = [`  if (${acc[1]} > ${step + 2}) {`, `    ${acc[0]} = ${acc[0]} / ${acc[1]};`, `    if (${acc[0]} > ${90 - step}) ${acc[0]} = ${90 - step};`, `  }`];
    out.push(...block);
    if (copy < spoil.copies && step % 3 === 1) {
      out.push(`  // copied from above`, ...block.map((l) => l.replace(`> ${step + 2}`, `>= ${step + 2}`)));
      copy++;
    }
    out.push(`  // ${acc[2]} = ${acc[2]}.filter((z: any) => z.level > ${step});`);
    step++;
  }
  out.push(`  return { t: ${acc[0]}, n: ${acc[1]}, all: ${acc[2]} };`, `}`);
  return out;
}

/** A file's symbols in the order they are written, with the doc each gets. */
function documented(s: SymbolFact, recipe: Recipe | undefined, w: Words, spoil: Spoil, r: ReturnType<typeof streamOf>, index: number): string[] {
  if (spoil.docs === "some" && index % 2 === 1) return [];
  const text = spoil.docs === "wrong" ? r.pick(WRONG_DOCS) : recipe?.doc(w) ?? s.doc ?? "";
  return text === "" ? [] : [`/** ${text} */`];
}

function writeTypeScript(file: PlannedFile, importable: ReadonlyMap<string, FileFacts>): { text: string; entry: Omit<ManifestEntry, "path" | "vitality" | "health" | "planned" | "lines" | "dead"> } {
  const f = file.facts;
  const spoil = SPOIL[file.health];
  const r = streamOf(f.path);
  const w = wordsOf(f);
  const longest = Math.max(12, f.complexity.longestFunction);
  const depth = Math.max(2, f.complexity.maxNesting);
  let todos = f.debtMarkers;
  const todo = (): string | null => (todos > 0 && r.next() < 0.35 ? (todos--, r.pick(TODOS)) : null);
  let hacks = spoil.hacks;
  const hack = (): string[] | null => (hacks > 0 ? (hacks--, (HACKS[hacks % HACKS.length] as (w: Words) => string[])(w)) : null);
  let swallows = spoil.swallowed;
  // The first chance always takes a planned swallow, so even a short tangle empties one handler.
  const swallow = (): boolean => swallows > 0 && (swallows === spoil.swallowed || r.next() < 0.3) && (swallows--, true);
  const out: string[] = [];
  const good = spoil.docs === "fit";
  out.push(good ? `/**\n * The ${w.noun}: its readings, what they add up to and how they settle.\n */` : spoil.docs === "some" ? `// ${w.noun}` : `// old ${w.noun} stuff, see the wiki`);
  out.push("");
  for (const target of f.imports) {
    const other = importable.get(target);
    const name = other?.symbols.find((s) => s.exported && s.kind === "function")?.name;
    if (name !== undefined && target.endsWith(".ts")) out.push(`import { ${name} } from "${relative(f.path, target)}";`);
  }
  out.push("");
  if (spoil.hidden) out.push(`// set by init(); everything below assumes it ran first`, `let ready = false;`, `let calls = 0;`, `let cache: Record<string, any> = {};`, `export function init(seed?: any) {`, `  cache = seed || {};`, `  ready = true;`, `}`, "");
  // The record and the bounds.
  out.push(...(good ? [`/** One reading of the ${w.noun}: what it is, its level and rate, when it was taken and how it is marked. */`] : []));
  out.push(`${w.recordExported ? "export " : ""}interface ${w.record} {`, `  readonly id: string;`, `  readonly level: number;`, `  readonly rate: number;`, `  readonly at: number;`, `  readonly marks: readonly string[];`, `}`, "");
  out.push(...(good ? [`/** The lowest and highest level a reading may have, and how far one settling step moves it. */`] : []));
  out.push(`const BOUNDS = { least: 0, most: 100, step: 5 } as const;`, "");
  if (w.limit !== undefined) out.push(...(good ? [`/** The most readings of the ${w.noun} one call takes when it isn't told how many. */`] : []), `export const ${w.limit} = 64;`, "");
  // Each function and class symbol: a recipe written well, or a tangle.
  const functions = f.symbols.filter((s) => s.kind === "function");
  const tangledCount = Math.round(functions.length * spoil.tangled);
  const helpers = new Set<string>();
  const bodies: string[] = [];
  functions.forEach((s, i) => {
    const recipe = recipeOf(s.name);
    bodies.push(...documented(s, recipe, w, spoil, r, i));
    // The last functions tangle first, so the first, which tests import, stays well written unless the whole file is not.
    const worst = functions.length - tangledCount;
    if (i >= worst) {
      const length = i === worst ? longest : Math.max(12, Math.round(longest * (0.4 + r.next() * 0.4)));
      bodies.push(...tangle(s.name, w, length, i === worst ? depth : Math.max(2, depth - 2), spoil, r, todo, hack, swallow, spoil.hidden));
    } else {
      for (const h of recipe.helpers) helpers.add(h);
      bodies.push(...recipe.lines(s.name, w));
    }
    bodies.push("");
  });
  for (const s of f.symbols.filter((sym) => sym.kind === "class")) {
    helpers.add("newer");
    const agent = s.name.slice(w.stem.length);
    const method = METHODS[verbOf(agent)] as (typeof METHODS)[string];
    if (spoil.docs === "fit") bodies.push(`/** The ${w.noun}'s ${agent.toLowerCase()}: keeps its readings by id, the newest of each. */`);
    else bodies.push(...documented(s, undefined, w, spoil, r, 0));
    if (spoil.tangled >= 0.5) {
      bodies.push(`export class ${s.name} {`, `  items: any[] = [];`, `  // call load() before total(), or total() is wrong`, `  load(x: any) {`, `    this.items = x;`, `    cache["last"] = x;`, `  }`, `  total() {`, `    let t = 0;`, `    for (const i of this.items) t += i.level;`, `    return t;`, `  }`, `}`);
    } else {
      for (const h of method.helpers) helpers.add(h);
      bodies.push(
        `export class ${s.name} {`,
        `  readonly #byId = new Map<string, ${w.record}>();`,
        "",
        `  /** Keeps a reading, replacing an older one with the same id. */`,
        `  add(reading: ${w.record}): void {`,
        `    const had = this.#byId.get(reading.id);`,
        `    this.#byId.set(reading.id, had === undefined ? reading : newerOf(had, reading));`,
        `  }`,
        "",
        `  /** Every reading kept, oldest first. */`,
        `  all(): ${w.record}[] {`,
        `    return [...this.#byId.values()].sort((a, b) => a.at - b.at);`,
        `  }`,
        "",
        ...method.lines(w).map((line) => `  ${line}`),
        `}`,
      );
    }
    bodies.push("");
  }
  // Unrelated helpers in a poorly kept file.
  for (let k = 0; k < spoil.unrelated; k++) bodies.push(...(UNRELATED[k % UNRELATED.length] as (n: string) => string[])(UNRELATED_NAMES[k % UNRELATED_NAMES.length] as string), "");
  // Shared helpers come first, then the functions; a well-kept file fills out its planned length with more small steps.
  for (const h of helpers) out.push(...(HELPERS[h] as (w: Words) => string[])(w), "");
  out.push(...bodies);
  // A well-kept file fills out toward its planned length with the steps it doesn't have yet, each under its own name.
  const taken = new Set(f.symbols.map((sym) => sym.name));
  for (const [verb, recipe] of Object.entries(RECIPES)) {
    if (out.length >= f.lines - 8 || spoil.tangled >= 1) break;
    const name = `${verb}${w.stem}`;
    if (taken.has(name)) continue;
    taken.add(name);
    for (const h of recipe.helpers) {
      if (helpers.has(h)) continue;
      helpers.add(h);
      out.push(...(HELPERS[h] as (w: Words) => string[])(w), "");
    }
    out.push(`/** ${recipe.doc(w)} */`, ...recipe.lines(name, w), "");
  }
  while (out.length < f.lines - 8 && spoil.tangled >= 1) out.push(...tangle(`${r.pick(["doIt", "run2", "proc", "handle", "go"])}${out.length}`, w, Math.min(longest, f.lines - out.length - 2), depth, spoil, r, todo, hack, swallow, spoil.hidden), "");
  const level = (bad: boolean, fair: boolean): Level => (bad ? "poor" : fair ? "fair" : "good");
  const ruin = spoil.tangled >= 1;
  const tired = spoil.tangled >= 0.5 && !ruin;
  const text = `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
  // Handlers, TODOs and shims are counted in what was written, not what was planned.
  const swallowed = text.split("catch (e) {}").length - 1;
  return {
    text,
    entry: {
      naming: level(spoil.names >= 0.8, spoil.names > 0),
      doc: level(spoil.docs === "wrong", spoil.docs === "some"),
      readability: level(ruin, tired || spoil.tangled > 0),
      errors: level(swallowed >= 2, swallowed === 1),
      change: level(spoil.hidden && ruin, spoil.hidden),
      cohesion: level(spoil.unrelated >= 2, spoil.unrelated === 1),
      attention: [...(/TODO|FIXME|XXX/.test(text) ? ["unfinished"] : []), ...(text.includes("HACK:") ? ["workaround"] : []), ...(ruin && f.importedBy.length >= 2 ? ["fragile"] : [])],
    },
  };
}

/** Two readings every test starts from, and what each verb's function gives for them. */
const WEST = `{ id: "west-1", level: 20, rate: 3, at: 1, marks: ["west"] }`;
const EAST = `{ id: "east-2", level: 40, rate: 5, at: 2, marks: ["east"] }`;
const EXPECT: Readonly<Record<string, { readonly what: string; readonly call: (name: string) => string; readonly gives: string }>> = {
  gather: { what: "gathers the readings that carry a mark", call: (n) => `${n}([west, east], "west")`, gives: "[west]" },
  join: { what: "keeps the later of two readings with the same id", call: (n) => `${n}([west], [east, { ...west, level: 25, at: 3 }])`, gives: "[east, { ...west, level: 25, at: 3 }]" },
  weigh: { what: "counts each level as much as its rate", call: (n) => `${n}([west, east])`, gives: "260" },
  measure: { what: "adds up the levels within bounds", call: (n) => `${n}([west, east, { ...east, id: "high", level: 140 }])`, gives: "{ count: 2, total: 60, mean: 30, highest: 40 }" },
  fold: { what: "folds the levels within bounds into one total", call: (n) => `${n}([west, east])`, gives: "60" },
  keep: { what: "keeps the fastest readings", call: (n) => `${n}([west, east], 1)`, gives: "[east]" },
  sort: { what: "puts the fastest first", call: (n) => `${n}([west, east])`, gives: "[east, west]" },
  turn: { what: "puts the newest first", call: (n) => `${n}([west, east])`, gives: "[east, west]" },
  trace: { what: "follows one id through time", call: (n) => `${n}([east, west, { ...west, at: 5 }], "west-1")`, gives: "[west, { ...west, at: 5 }]" },
  settle: { what: "moves a level to its target a step at a time", call: (n) => `${n}(10, 20)`, gives: "{ level: 20, steps: 2 }" },
  mend: { what: "drops readings without an id and moves levels back within bounds", call: (n) => `${n}([{ ...west, level: 130 }, { ...east, id: "" }])`, gives: "[{ ...west, level: 100 }]" },
  carry: { what: "shares the readings between loads", call: (n) => `${n}([west, east], 2)`, gives: "[[east], [west]]" },
};

/** A test of a file in this health fails, as its facts say its tests do. */
const FAILS: ReadonlySet<Health> = new Set(["failing", "ruin", "decayed"]);

function writeTest(file: PlannedFile, importable: ReadonlyMap<string, FileFacts>, health: ReadonlyMap<string, Health>): string {
  const f = file.facts;
  const out: string[] = [`import { describe, expect, it } from "vitest";`];
  const subjects: { name: string; noun: string; fails: boolean }[] = [];
  for (const target of f.imports) {
    const other = importable.get(target);
    const fn = other?.symbols.find((s) => s.exported && s.kind === "function");
    if (other !== undefined && fn !== undefined && target.endsWith(".ts")) {
      out.push(`import { ${fn.name} } from "${relative(f.path, target)}";`);
      subjects.push({ name: fn.name, noun: nounOf(target), fails: FAILS.has(health.get(target) ?? "thriving") });
    }
  }
  out.push("", `const west = ${WEST};`, `const east = ${EAST};`, "");
  subjects.forEach((s, k) => {
    const verb = Object.keys(EXPECT).find((v) => s.name.startsWith(v)) ?? "measure";
    const e = EXPECT[verb] as (typeof EXPECT)[string];
    out.push(`describe("${s.name}", () => {`);
    if (s.fails) {
      out.push(`  it("works", () => {`, `    const r: any = ${s.name}([west] as any, 1 as any);`, `    expect(r).toEqual(${k % 4 === 0 ? "42" : "undefined"});`, `  });`);
      if (k % 4 === 2) out.push(`  it.skip("handles the empty case", () => {});`);
    } else {
      out.push(`  it("${e.what} of the ${s.noun}", () => {`, `    expect(${e.call(s.name)}).toEqual(${e.gives});`, `  });`);
    }
    out.push(`});`, "");
  });
  return `${out.join("\n").trimEnd()}\n`;
}

// ---------- Rust ----------

/** What each verb does in a well-kept crate: its doc and its body, over a slice of the crate's record. */
const RUST: Readonly<Record<string, { readonly doc: string; readonly lines: (name: string, record: string) => string[] }>> = {
  gather: { doc: "Gathers the readings at or above `least`, in their order.", lines: (n, r) => [`pub fn ${n}(readings: &[${r}], least: f64) -> Vec<${r}> {`, `    readings.iter().filter(|reading| reading.level >= least).cloned().collect()`, `}`] },
  join: { doc: "Joins two lists of readings by id; where both hold one, the second list's wins.", lines: (n, r) => [`pub fn ${n}(first: &[${r}], second: &[${r}]) -> Vec<${r}> {`, `    let mut joined: Vec<${r}> = first.iter().filter(|reading| !second.iter().any(|other| other.id == reading.id)).cloned().collect();`, `    joined.extend(second.iter().cloned());`, `    joined`, `}`] },
  weigh: { doc: "Weighs the readings: each level counts as much as its rate.", lines: (n, r) => [`pub fn ${n}(readings: &[${r}]) -> f64 {`, `    readings.iter().map(|reading| reading.level * reading.rate).sum()`, `}`] },
  measure: { doc: "How many readings lie between `least` and `most`, and the sum of their levels.", lines: (n, r) => [`pub fn ${n}(readings: &[${r}], least: f64, most: f64) -> (usize, f64) {`, `    let kept: Vec<f64> = readings.iter().map(|reading| reading.level).filter(|level| (least..=most).contains(level)).collect();`, `    (kept.len(), kept.iter().sum())`, `}`] },
  fold: { doc: "Every level folded into one total.", lines: (n, r) => [`pub fn ${n}(readings: &[${r}]) -> f64 {`, `    readings.iter().map(|reading| reading.level).sum()`, `}`] },
  keep: { doc: "Keeps the `count` fastest readings.", lines: (n, r) => [`pub fn ${n}(readings: &[${r}], count: usize) -> Vec<${r}> {`, `    let mut kept = readings.to_vec();`, `    kept.sort_by(|a, b| b.rate.total_cmp(&a.rate));`, `    kept.truncate(count);`, `    kept`, `}`] },
  sort: { doc: "The readings sorted by rate, fastest first.", lines: (n, r) => [`pub fn ${n}(readings: &[${r}]) -> Vec<${r}> {`, `    let mut sorted = readings.to_vec();`, `    sorted.sort_by(|a, b| b.rate.total_cmp(&a.rate));`, `    sorted`, `}`] },
  turn: { doc: "The readings in the opposite order.", lines: (n, r) => [`pub fn ${n}(readings: &[${r}]) -> Vec<${r}> {`, `    readings.iter().rev().cloned().collect()`, `}`] },
  trace: { doc: "The reading with `id`, if there is one.", lines: (n, r) => [`pub fn ${n}<'a>(readings: &'a [${r}], id: &str) -> Option<&'a ${r}> {`, `    readings.iter().find(|reading| reading.id == id)`, `}`] },
  settle: { doc: "Every reading with its level moved between `least` and `most`.", lines: (n, r) => [`pub fn ${n}(readings: &[${r}], least: f64, most: f64) -> Vec<${r}> {`, `    readings.iter().map(|reading| ${r} { level: reading.level.clamp(least, most), ..reading.clone() }).collect()`, `}`] },
  mend: { doc: "The readings that have an id; the rest are dropped.", lines: (n, r) => [`pub fn ${n}(readings: &[${r}]) -> Vec<${r}> {`, `    readings.iter().filter(|reading| !reading.id.is_empty()).cloned().collect()`, `}`] },
  carry: { doc: "The total rate the readings carry.", lines: (n, r) => [`pub fn ${n}(readings: &[${r}]) -> f64 {`, `    readings.iter().map(|reading| reading.rate).sum()`, `}`] },
};

function writeRust(file: PlannedFile, crateFiles: readonly PlannedFile[]): { text: string; entry: Omit<ManifestEntry, "path" | "vitality" | "health" | "planned" | "lines" | "dead"> } {
  const f = file.facts;
  const spoil = SPOIL[file.health];
  const r = streamOf(f.path);
  const w = wordsOf(f);
  const ruin = spoil.tangled >= 1;
  const tired = spoil.tangled >= 0.5 && !ruin;
  const out: string[] = [];
  const isLib = baseOf(f.path) === "lib";
  const record = w.record.replace(/[^A-Za-z0-9]/g, "");
  if (isLib) {
    out.push(spoil.docs === "fit" ? `//! The ${w.noun} crate: readings, their bounds, and how they add up.` : `// ${w.noun}`);
    for (const other of crateFiles) if (other !== file && other.facts.path.endsWith(".rs")) out.push(`pub mod ${baseOf(other.facts.path)};`);
    out.push("");
  } else out.push(spoil.docs === "fit" ? `//! Part of the ${w.noun} crate.` : "");
  if (spoil.tangled > 0) out.push(`use std::collections::HashMap;`);
  out.push("");
  if (spoil.docs === "fit") out.push(`/// One reading: what it is, its level and its rate.`);
  out.push(`#[derive(Clone, Debug, PartialEq)]`, `pub struct ${record} {`, `    pub id: String,`, `    pub level: f64,`, `    pub rate: f64,`, `}`, "");
  if (spoil.hidden) out.push(`static mut READY: bool = false;`, "");
  let todos = f.debtMarkers;
  let n = 0;
  for (const s of f.symbols.filter((sym) => sym.kind === "function")) {
    const name = s.name.replace(/([A-Z])/g, "_$1").toLowerCase();
    const tangled = n < Math.round(f.symbols.length * spoil.tangled);
    const recipe = RUST[Object.keys(RUST).find((verb) => name.startsWith(verb)) ?? "measure"] as (typeof RUST)[string];
    if (spoil.docs === "fit") out.push(`/// ${recipe.doc}`);
    else if (spoil.docs === "wrong") out.push(`/// ${r.pick(WRONG_DOCS)}`);
    if (!tangled) {
      out.push(...recipe.lines(name, record), "");
    } else {
      out.push(`pub fn ${name}(v: &Vec<${record}>, a: f64) -> f64 {`, `    let mut t = 0.0;`, `    let mut m: HashMap<String, f64> = HashMap::new();`);
      if (spoil.hidden) out.push(`    unsafe { if !READY { READY = true; } }`);
      out.push(`    for x in v.iter() {`);
      let k = 2;
      for (let d = 0; d < Math.max(0, f.complexity.maxNesting - 2); d++) {
        if (todos > 0 && r.next() < 0.4) {
          out.push(`${"    ".repeat(k)}// ${r.pick(TODOS)}`);
          todos--;
        }
        out.push(`${"    ".repeat(k)}if x.level > ${d * 7}.0 && x.rate != ${d}.0 {`);
        k++;
        out.push(`${"    ".repeat(k)}t = t + x.level * ${(1 + d / 2).toFixed(1)};`);
      }
      out.push(`${"    ".repeat(k)}m.insert(x.id.clone(), t);`);
      while (k > 2) {
        k--;
        out.push(`${"    ".repeat(k)}}`);
      }
      out.push(`    }`);
      let step = 0;
      while (out.length < f.lines - 6 && step < f.complexity.longestFunction / 4) {
        out.push(`    if t > ${100 - step}.0 { t = t / a; }`, `    let _ = m.get("${r.pick(["x", "tmp", "old"])}").unwrap_or(&0.0); // ${step % 3 === 0 ? "TODO: remove" : "unused"}`);
        step++;
      }
      out.push(`    t`, `}`, "");
    }
    n++;
  }
  // A well-kept crate fills out toward its planned length with the verbs it doesn't have yet.
  const stem = w.stem.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
  const taken = new Set(f.symbols.map((sym) => sym.name.replace(/([A-Z])/g, "_$1").toLowerCase()));
  for (const [verb, recipe] of Object.entries(RUST)) {
    if (out.length >= f.lines - 6 || ruin) break;
    const name = `${verb}_${stem}`;
    if (taken.has(name)) continue;
    out.push(`/// ${recipe.doc}`, ...recipe.lines(name, record), "");
  }
  const level = (bad: boolean, fair: boolean): Level => (bad ? "poor" : fair ? "fair" : "good");
  return {
    text: `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`,
    entry: {
      naming: level(ruin, tired),
      doc: level(spoil.docs === "wrong", spoil.docs === "some"),
      readability: level(ruin, tired),
      errors: "good",
      change: level(spoil.hidden && ruin, spoil.hidden),
      cohesion: "good",
      attention: f.debtMarkers > 0 ? ["unfinished"] : [],
    },
  };
}

// ---------- everything else ----------

function writeOther(file: PlannedFile): string {
  const f = file.facts;
  const ext = f.path.split(".").pop() ?? "";
  const w = wordsOf(f);
  const poor = SPOIL[file.health].docs !== "fit";
  const out: string[] = [];
  if (ext === "md") {
    out.push(`# ${cap(w.noun)}`, "", poor ? `TODO: write this. Most of what follows is out of date.` : `How the ${w.noun} works, what it depends on and how to change it.`, "");
    let k = 0;
    while (out.length < f.lines) {
      out.push(`## ${["Overview", "Readings", "Bounds", "Settling", "Testing", "Changes"][k % 6]} ${k >= 6 ? Math.floor(k / 6) + 1 : ""}`.trimEnd(), "", poor ? `See the old notes. ${k % 2 === 0 ? "This changed in v2 but nobody updated it." : ""}` : `Each reading has an id, a level between the bounds, a rate and a time. This part explains how the ${w.noun} handles them, step by step, and what a change here affects.`, "");
      k++;
    }
  } else if (ext === "json") {
    const name = f.path.replace(/\//g, "-").replace(/\.json$/, "");
    out.push(`{`, `  "name": "${name}",`, `  "version": "1.${f.path.length % 9}.0",`, `  "private": true,`);
    let k = 0;
    for (; out.length < f.lines - 2; k++) out.push(`  "setting${k}": ${k % 3 === 0 ? `"${w.noun}-${k}"` : k % 3 === 1 ? String(k * 7) : "true"},`);
    out.push(`  "end": true`, `}`);
  } else if (ext === "toml") {
    out.push(`[package]`, `name = "${w.noun.replace(/ /g, "-")}"`, `version = "0.1.0"`, `edition = "2021"`, "");
    let k = 0;
    for (; out.length < f.lines; k++) out.push(`# setting ${k}`, `option_${k} = ${k % 2 === 0 ? "true" : String(k)}`);
  } else if (ext === "sh") {
    out.push(`#!/usr/bin/env bash`, poor ? `# builds stuff` : `# Builds and checks the ${w.noun}; stops at the first failure.`, poor ? "" : `set -euo pipefail`, "");
    let k = 0;
    for (; out.length < f.lines; k++) out.push(poor ? `cd dir${k} && make || true` : `echo "step ${k}: checking ${w.noun}"`, poor ? "" : `test -d "./part-${k}" || mkdir -p "./part-${k}"`);
  } else {
    out.push(`id,level,rate,at`);
    for (let k = 1; out.length < f.lines; k++) out.push(`${w.noun.replace(/ /g, "-")}-${k},${(k * 37) % 100},${(k * 13) % 50},${1700000000 + k * 60}`);
  }
  return `${out.join("\n").trimEnd()}\n`;
}

/** Every planned file's code, by path, and the manifest of how each was written. */
export function provingCode(files: readonly PlannedFile[]): { code: Map<string, string>; manifest: ManifestEntry[] } {
  const facts = new Map(files.map((f) => [f.facts.path, f.facts]));
  const health = new Map(files.map((f) => [f.facts.path, f.health]));
  const code = new Map<string, string>();
  const manifest: ManifestEntry[] = [];
  for (const file of files) {
    const f = file.facts;
    const dead = f.kind === "source" && f.importedBy.every((by) => facts.get(by)?.kind === "test");
    let text: string;
    let entry: Omit<ManifestEntry, "path" | "vitality" | "health" | "planned" | "lines" | "dead"> | null = null;
    if (f.kind === "test") text = writeTest(file, facts, health);
    else if (f.path.endsWith(".ts")) ({ text, entry } = writeTypeScript(file, facts));
    else if (f.path.endsWith(".rs")) {
      const dir = f.path.split("/").slice(0, -1).join("/");
      ({ text, entry } = writeRust(file, files.filter((o) => o.facts.path.split("/").slice(0, -1).join("/") === dir)));
    } else text = writeOther(file);
    code.set(f.path, text);
    if (entry !== null) manifest.push({ path: f.path, vitality: Math.round(file.vitality * 100) / 100, health: file.health, planned: f.lines, lines: text.split("\n").length - 1, ...entry, dead });
  }
  return { code, manifest };
}
