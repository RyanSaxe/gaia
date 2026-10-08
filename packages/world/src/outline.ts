// What Jev reads about a thing: its outline. A file's outline is its symbols
// (kind, name, whether it is exported, its size in words, its doc comment),
// the files it imports and that import it, its tests and its health: the
// structure a tree-sitter summary would give, built only from the facts the
// engine reports, never from source text. An area's outline is its files'
// and subdirectories' outlines, and an entity's its files' and its
// dependencies'. Every outline fits a token budget (`OUTLINE.tokens`): it is
// built at the richest level of detail that fits.
//
// Sizes are words, not line counts. Jev reads words better than numbers, and
// a request's key is the hash of what it sends, so a one-line edit that left
// a file "medium" must not make Jev judge it again. Line numbers stay out of
// the state for the same reason: they move with every edit above them.
// `FileOutline.spans` keeps them for the source-reading step, which reads
// only the symbols Jev names (docs/architecture.md, "Jev").

import type { CodeModel, EntityFacts, FileFacts, SymbolFact } from "@gaia/schema";

/** Bytes per token, as the engine's `jev.estimate` counts them (calibrated on OpenRouter's published example). */
export const BYTES_PER_TOKEN = 1.8;

/** The bytes of a value's JSON as UTF-8, which is what goes over the wire. */
export function jsonBytes(value: unknown): number {
  const text = JSON.stringify(value) ?? "";
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** Jev's input tokens for a value, estimated as the engine estimates them. */
export const tokensOf = (value: unknown): number => Math.ceil(jsonBytes(value) / BYTES_PER_TOKEN);

/** The budgets every outline and reading is held to. */
export const OUTLINE = {
  /** The most tokens each state may take. Jev's window is 32,000 for state and questions; accuracy falls long before that. */
  tokens: { file: 1200, area: 2000, entity: 1600, reading: 2400 },
  /** Levels of detail, richest first: an outline uses the first that fits its budget. */
  levels: [
    { symbols: 14, doc: 200, symbolDoc: 120, paths: 10, files: 14 },
    { symbols: 10, doc: 160, symbolDoc: 80, paths: 8, files: 10 },
    { symbols: 6, doc: 120, symbolDoc: 0, paths: 5, files: 6 },
    { symbols: 3, doc: 80, symbolDoc: 0, paths: 3, files: 3 },
    { symbols: 0, doc: 0, symbolDoc: 0, paths: 0, files: 0 },
  ],
} as const;

type Level = (typeof OUTLINE.levels)[number];

// ---------- words for sizes ----------

const bucket = (n: number, edges: readonly number[], words: readonly string[]): string => words[edges.findIndex((e) => n < e)] ?? (words[words.length - 1] as string);

/** A file's size in words. */
export const fileSize = (lines: number): string => bucket(lines, [30, 120, 400, 1000], ["tiny", "short", "medium", "long", "very long"]);
/** A function's or class's size in words. */
export const symbolSize = (lines: number): string => bucket(lines, [5, 25, 80, 200], ["a few lines", "short", "medium", "long", "very long"]);
/** A directory's or entity's size in words. */
export const bodySize = (lines: number): string => bucket(lines, [300, 1500, 6000, 20000], ["small", "medium", "large", "very large", "vast"]);
/** How many, in words: none, one, a few, several or many. */
export const howMany = (n: number): string => bucket(n, [1, 2, 5, 13], ["none", "one", "a few", "several", "many"]);

const trim = (text: string | undefined, n: number): string | undefined => {
  if (text === undefined || n <= 0) return undefined;
  return text.length <= n ? text : `${text.slice(0, n - 1).trimEnd()}…`;
};
const baseName = (path: string): string => path.split("/").pop() ?? path;
const parentOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const byPath = <T extends { readonly path: string }>(a: T, b: T): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The richest level whose build fits the budget; the barest otherwise. */
function fit<T>(budget: number, build: (level: Level) => T): T {
  for (const level of OUTLINE.levels) {
    const out = build(level);
    if (tokensOf(out) <= budget) return out;
  }
  return build(OUTLINE.levels[OUTLINE.levels.length - 1] as Level);
}

// ---------- files ----------

/** One symbol as Jev reads it: no line numbers, its size in words. */
export interface SymbolOutline {
  readonly name: string;
  readonly kind: SymbolFact["kind"];
  readonly exported: boolean;
  readonly size: string;
  readonly doc?: string;
}

export interface FileOutline {
  readonly path: string;
  readonly language: string;
  readonly kind: string;
  readonly size: string;
  readonly doc?: string;
  /** Exported symbols first, then the rest, largest first. */
  readonly symbols: readonly SymbolOutline[];
  /** Symbols the budget left out. */
  readonly moreSymbols?: number;
  /** Project paths it imports, and that import it; `*Count` says how many in words when the list is cut. */
  readonly imports: readonly string[];
  readonly importedBy: readonly string[];
  readonly importsCount: string;
  readonly importedByCount: string;
  readonly tests: { readonly coveredBy: readonly string[]; readonly failing: number };
  readonly health: { readonly errors: number; readonly warnings: number; readonly lint: number; readonly debtMarkers: number; readonly unused: boolean; readonly nesting: string };
}

/** The order symbols are outlined in: exported ones first, then by size, then by name. */
export function outlineOrder(f: FileFacts): SymbolFact[] {
  return [...f.symbols].sort((a, b) => Number(b.exported) - Number(a.exported) || (b.lines ?? 1) - (a.lines ?? 1) || (a.name < b.name ? -1 : 1));
}

/** Where each outlined symbol is in its file, for the source-reading step. Never sent as state. */
export function spansOf(f: FileFacts): Readonly<Record<string, { readonly line: number; readonly lines: number }>> {
  return Object.fromEntries(f.symbols.filter((s) => s.line !== undefined).map((s) => [s.name, { line: s.line as number, lines: s.lines ?? 1 }]));
}

function fileAt(f: FileFacts, level: Level): FileOutline {
  const ordered = outlineOrder(f);
  const shown = ordered.slice(0, level.symbols);
  const doc = trim(f.doc, level.doc);
  const nesting = f.complexity.maxNesting >= 6 ? "deep" : f.complexity.maxNesting >= 4 ? "moderate" : "shallow";
  return {
    path: f.path,
    language: f.language,
    kind: f.kind ?? "source",
    size: fileSize(f.lines),
    ...(doc === undefined ? {} : { doc }),
    symbols: shown.map((s) => {
      const sd = trim(s.doc, level.symbolDoc);
      return { name: s.name, kind: s.kind, exported: s.exported, size: symbolSize(s.lines ?? 1), ...(sd === undefined ? {} : { doc: sd }) };
    }),
    ...(ordered.length > shown.length ? { moreSymbols: ordered.length - shown.length } : {}),
    imports: [...f.imports].sort().slice(0, level.paths),
    importedBy: [...f.importedBy].sort().slice(0, level.paths),
    importsCount: howMany(f.imports.length),
    importedByCount: howMany(f.importedBy.length),
    tests: { coveredBy: [...f.tests.coveredBy].sort().slice(0, Math.min(4, level.paths)), failing: f.tests.failing.length },
    health: { errors: f.diagnostics.errors, warnings: f.diagnostics.warnings, lint: f.diagnostics.lint, debtMarkers: f.debtMarkers, unused: f.unused, nesting },
  };
}

/** A file's outline, as rich as `budget` tokens allow. */
export function fileOutline(f: FileFacts, budget: number = OUTLINE.tokens.file): FileOutline {
  return fit(budget, (level) => fileAt(f, level));
}

/** A file as one line of a larger outline: its name, part, size, doc and exported names. */
export interface FileBrief {
  readonly name: string;
  readonly kind: string;
  readonly size: string;
  readonly doc?: string;
  readonly exports?: readonly string[];
}

function briefAt(f: FileFacts, level: Level, name = baseName(f.path)): FileBrief {
  const doc = trim(f.doc, Math.min(level.doc, 120));
  const exports = outlineOrder(f).filter((s) => s.exported).slice(0, Math.min(5, level.symbols)).map((s) => s.name);
  return { name, kind: f.kind ?? "source", size: fileSize(f.lines), ...(doc === undefined ? {} : { doc }), ...(exports.length === 0 ? {} : { exports }) };
}

/** Files by how much they weigh in their place: source first, then the longest. */
const weightier = (a: FileFacts, b: FileFacts): number => Number((b.kind ?? "source") === "source") - Number((a.kind ?? "source") === "source") || b.lines - a.lines || byPath(a, b);

// ---------- areas ----------

export interface AreaOutline {
  readonly path: string;
  readonly size: string;
  readonly files: number;
  readonly languages: readonly string[];
  /** How many of its files play each part. */
  readonly kinds: Readonly<Record<string, number>>;
  /** The entity rooted here, if any: its name and form. */
  readonly entity?: string;
  /** Its own files, weightiest first. */
  readonly contents: readonly FileBrief[];
  readonly moreFiles?: number;
  readonly subdirectories: readonly { readonly name: string; readonly files: number; readonly size: string; readonly doc?: string }[];
  /** How its files import: among themselves, out to other directories, and in from them. */
  readonly imports: { readonly withinItself: number; readonly toOtherDirectories: number; readonly fromOtherDirectories: number };
}

const SOURCE = new Set(["typescript", "javascript", "rust", "python", "go"]);
function languagesOf(files: readonly FileFacts[]): string[] {
  const lines = new Map<string, number>();
  for (const f of files) lines.set(f.language, (lines.get(f.language) ?? 0) + f.lines);
  return [...lines].filter(([l]) => SOURCE.has(l)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([l]) => l);
}

const under = (files: readonly FileFacts[], dir: string): FileFacts[] => files.filter((f) => dir === "" || f.path.startsWith(`${dir}/`));
const directlyIn = (files: readonly FileFacts[], dir: string): FileFacts[] => files.filter((f) => parentOf(f.path) === dir);
function childDirs(files: readonly FileFacts[], dir: string): string[] {
  const out = new Set<string>();
  for (const f of under(files, dir)) {
    const rest = dir === "" ? f.path : f.path.slice(dir.length + 1);
    if (rest.includes("/")) out.add(dir === "" ? rest.slice(0, rest.indexOf("/")) : `${dir}/${rest.slice(0, rest.indexOf("/"))}`);
  }
  return [...out].sort();
}

/** The doc of a directory's own index or readme, if it has one: what the directory says it is. */
function dirDoc(files: readonly FileFacts[], dir: string): string | undefined {
  const own = directlyIn(files, dir);
  const pick = own.find((f) => /^(index|mod|lib|main)\.\w+$/.test(baseName(f.path))) ?? own.find((f) => /^readme\.md$/i.test(baseName(f.path)));
  return pick?.doc;
}

/** A directory's outline: its own files and its subdirectories, as rich as `budget` allows. */
export function areaOutline(model: CodeModel, dir: string, budget: number = OUTLINE.tokens.area): AreaOutline {
  const all = under(model.files, dir);
  const own = directlyIn(model.files, dir).sort(weightier);
  const kinds: Record<string, number> = {};
  for (const f of all) kinds[f.kind ?? "source"] = (kinds[f.kind ?? "source"] ?? 0) + 1;
  const inside = new Set(all.map((f) => f.path));
  const entity = model.entities.find((e) => e.path === dir);
  const imports = {
    withinItself: all.reduce((n, f) => n + f.imports.filter((i) => inside.has(i)).length, 0),
    toOtherDirectories: all.reduce((n, f) => n + f.imports.filter((i) => !inside.has(i)).length, 0),
    fromOtherDirectories: all.reduce((n, f) => n + f.importedBy.filter((i) => !inside.has(i)).length, 0),
  };
  const subs = childDirs(model.files, dir).map((c) => {
    const files = under(model.files, c);
    return { name: baseName(c), files: files.length, size: bodySize(files.reduce((n, f) => n + f.lines, 0)), doc: dirDoc(model.files, c) };
  });
  return fit(budget, (level) => ({
    path: dir === "" ? "(the repository's root)" : dir,
    size: bodySize(all.reduce((n, f) => n + f.lines, 0)),
    files: all.length,
    languages: languagesOf(all),
    kinds,
    ...(entity === undefined ? {} : { entity: `${entity.name} (${entity.form})` }),
    contents: own.slice(0, level.files).map((f) => briefAt(f, level)),
    ...(own.length > level.files ? { moreFiles: own.length - level.files } : {}),
    subdirectories: subs.slice(0, Math.max(level.files, 4)).map((s) => {
      const doc = trim(s.doc, Math.min(level.doc, 100));
      return { name: s.name, files: s.files, size: s.size, ...(doc === undefined ? {} : { doc }) };
    }),
    imports,
  }));
}

// ---------- entities ----------

export interface EntityOutline {
  readonly name: string;
  readonly path: string;
  readonly form: string;
  readonly doc?: string;
  readonly size: string;
  readonly files: number;
  readonly languages: readonly string[];
  /** How large its public surface is, in words. */
  readonly surface: string;
  readonly entry?: string;
  /** Its weightiest files. */
  readonly contents: readonly FileBrief[];
  /** The entities it leans on: each one's name, how many of its own files import it, and how many entities lean on that one. */
  readonly dependsOn: readonly { readonly name: string; readonly importers: string; readonly dependents: number }[];
  readonly dependents: readonly string[];
  readonly tests: { readonly files: number; readonly failing: number; readonly covered: string };
}

/** How many of `from`'s files import from `to`'s, the weight `layoutWorld` gives a trail. */
export function importersOf(model: CodeModel, from: EntityFacts, to: EntityFacts): number {
  const roots = model.entities.map((e) => e.path);
  const owner = (p: string): string | undefined => roots.filter((r) => r === "" || p === r || p.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
  return model.files.filter((f) => owner(f.path) === from.path && f.imports.some((i) => owner(i) === to.path)).length;
}

const share = (x: number): string => (x >= 0.9 ? "nearly all" : x >= 0.6 ? "most" : x >= 0.3 ? "some" : x > 0 ? "little" : "none");

/** An entity's outline, as rich as `budget` allows. */
export function entityOutline(model: CodeModel, e: EntityFacts, budget: number = OUTLINE.tokens.entity): EntityOutline {
  const entities = new Map(model.entities.map((x) => [x.path, x]));
  const roots = model.entities.map((x) => x.path);
  const own = model.files
    .filter((f) => roots.filter((r) => r === "" || f.path === r || f.path.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0] === e.path)
    .sort(weightier);
  const dependsOn = e.dependsOn.flatMap((p) => {
    const o = entities.get(p);
    return o === undefined ? [] : [{ name: o.name, importers: `${howMany(importersOf(model, e, o))} of its files`, dependents: o.dependents.length }];
  });
  return fit(budget, (level) => {
    const doc = trim(e.doc, level.doc + 100);
    return {
      name: e.name,
      path: e.path === "" ? "(the repository's root)" : e.path,
      form: e.form,
      ...(doc === undefined ? {} : { doc }),
      size: bodySize(e.lines),
      files: e.files,
      languages: e.languages,
      surface: `${howMany(e.exports)} exported symbols`,
      ...(e.entry === undefined ? {} : { entry: e.entry }),
      contents: own.slice(0, level.files).map((f) => briefAt(f, level, e.path === "" ? f.path : f.path.slice(e.path.length + 1))),
      dependsOn,
      dependents: e.dependents.map((p) => entities.get(p)?.name ?? p),
      tests: { files: e.tests.files, failing: e.tests.failing, covered: share(e.tests.covered) },
    };
  });
}

// ---------- readings: what a second request may add ----------

/** One piece of extra context a second request may carry, facts only. */
export interface OutlineReading {
  /** What Jev reads when it says whether this would help. */
  readonly describe: string;
  readonly state: Readonly<Record<string, unknown>>;
}

/** The readings a file's second request may carry: its imports', importers', tests' and neighbours' outlines. Empty readings are left out. */
export function fileReadings(model: CodeModel, f: FileFacts, budget: number = OUTLINE.tokens.reading): Record<string, OutlineReading> {
  const files = new Map(model.files.map((x) => [x.path, x]));
  const briefs = (paths: readonly string[]): FileBrief[] =>
    fit(budget, (level) => [...paths].sort().flatMap((p) => (files.has(p) ? [briefAt(files.get(p) as FileFacts, level, p)] : [])).slice(0, Math.max(level.files, 1)));
  const neighbours = directlyIn(model.files, parentOf(f.path)).filter((x) => x.path !== f.path).sort(weightier);
  const out: Record<string, OutlineReading> = {};
  if (f.imports.length > 0) out.imports = { describe: "the outlines of the files it imports", state: { itImports: briefs(f.imports) } };
  if (f.importedBy.length > 0) out.importers = { describe: "the outlines of the files that import it", state: { importedBy: briefs(f.importedBy) } };
  if (f.tests.coveredBy.length > 0) out.tests = { describe: "the outlines of the test files that cover it", state: { testedBy: briefs(f.tests.coveredBy) } };
  if (neighbours.length > 0) out.neighbours = { describe: "the outlines of the other files in its directory", state: { neighbours: briefs(neighbours.map((x) => x.path)) } };
  if (f.symbols.length > OUTLINE.levels[0].symbols || f.symbols.some((s) => (s.doc?.length ?? 0) > OUTLINE.levels[0].symbolDoc)) {
    out.symbols = { describe: "every symbol it declares, with its whole doc comment", state: { allSymbols: fit(budget, (level) => outlineOrder(f).slice(0, level.symbols * 4).map((s) => ({ name: s.name, kind: s.kind, exported: s.exported, size: symbolSize(s.lines ?? 1), ...(s.doc === undefined ? {} : { doc: trim(s.doc, level.doc * 2) }) }))) } };
  }
  return out;
}

/** The readings an area's second request may carry: every one of its files, and its sibling directories. */
export function areaReadings(model: CodeModel, dir: string, budget: number = OUTLINE.tokens.reading): Record<string, OutlineReading> {
  const all = under(model.files, dir).sort(weightier);
  const out: Record<string, OutlineReading> = {};
  if (all.length > 0) out.files = { describe: "the outlines of every file under this directory", state: { allFiles: fit(budget, (level) => all.slice(0, level.files * 3).map((f) => briefAt(f, level, dir === "" ? f.path : f.path.slice(dir.length + 1)))) } };
  if (dir !== "") {
    const siblings = childDirs(model.files, parentOf(dir)).filter((c) => c !== dir);
    if (siblings.length > 0) {
      out.neighbours = {
        describe: "the directories beside it, each with its size and what it says it is",
        state: { besideIt: fit(budget, (level) => siblings.slice(0, level.files).map((c) => ({ name: baseName(c), size: bodySize(under(model.files, c).reduce((n, f) => n + f.lines, 0)), ...(trim(dirDoc(model.files, c), level.doc) === undefined ? {} : { doc: trim(dirDoc(model.files, c), level.doc) }) }))) },
      };
    }
  }
  return out;
}

/** The readings an entity's second request may carry: the outlines of the entities it leans on, and of those that lean on it. */
export function entityReadings(model: CodeModel, e: EntityFacts, budget: number = OUTLINE.tokens.reading): Record<string, OutlineReading> {
  const entities = new Map(model.entities.map((x) => [x.path, x]));
  const brief = (paths: readonly string[]) =>
    fit(budget, (level) =>
      paths.flatMap((p) => {
        const o = entities.get(p);
        if (o === undefined) return [];
        const doc = trim(o.doc, level.doc);
        return [{ name: o.name, form: o.form, size: bodySize(o.lines), ...(doc === undefined ? {} : { doc }) }];
      }).slice(0, Math.max(level.files, 1)),
    );
  const out: Record<string, OutlineReading> = {};
  if (e.dependsOn.length > 0) out.dependencies = { describe: "the outlines of the entities it depends on", state: { leansOn: brief([...e.dependsOn].sort()) } };
  if (e.dependents.length > 0) out.dependents = { describe: "the outlines of the entities that depend on it", state: { leanedOnBy: brief([...e.dependents].sort()) } };
  return out;
}
